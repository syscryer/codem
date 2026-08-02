//! Claude CLI `--fork-session` 协议桥。
//!
//! 一次性、无 prompt 的进程：使用 `--resume <源 session> --fork-session` 恢复
//! 源会话并确认 `system/init` 事件中的新原生 session ID。本模块只负责协议解析与
//! 进程生命周期，不依赖 `backend.rs`，方便单独做单元测试。

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;

/// 等待 `system/init` 返回新 session ID 的协议超时。
const FORK_PROTOCOL_TIMEOUT: Duration = Duration::from_secs(10);

/// 收到 init 并关闭 stdin / stdout EOF 后，等待进程自行退出的宽限期；超时才强制结束。
const FORK_GRACEFUL_EXIT_TIMEOUT: Duration = Duration::from_secs(2);

/// 对外暴露的 stderr / 进程输出归一化后最大字符数。
const PUBLIC_OUTPUT_LIMIT: usize = 512;

/// 一次性 Fork 进程可能出现的失败语义。
///
/// - `Rejected`：协议明确拒绝创建新会话，例如 init 事件缺少 session ID 或返回了源 ID。
/// - `Uncertain`：无法确认是否已创建新会话（超时、EOF 前未收到 init、进程退出码异常等）。
///
/// 注意：不支持 `--fork-session`（旧版 CLI）不算错误，由 [`probe_fork_session`] 用
/// `Ok(false)` 表达；这里只保留确实会发生的失败分支，避免出现永不构造的死变体。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ClaudeSessionForkError {
    Rejected(String),
    Uncertain(String),
}

/// 精确识别 `claude --help` 输出中是否存在独立的 `--fork-session` 标志。
pub(crate) fn help_supports_fork_session(output: &str) -> bool {
    output
        .split_whitespace()
        .any(|token| token.trim_matches(|ch: char| ch == ',' || ch == ';') == "--fork-session")
}

/// 解析单行 stream-json 事件，仅接受携带新 session ID 的 `system/init`。
///
/// 非 JSON、非 init 事件返回 `Ok(None)`；init 事件缺少 session ID 或返回源 ID 视为
/// `Rejected`；init 事件携带与源 ID 不同的有效 session ID 返回 `Ok(Some(...))`。
pub(crate) fn extract_fork_session_id(
    line: &str,
    source_session_id: &str,
) -> Result<Option<String>, ClaudeSessionForkError> {
    let payload: Value = match serde_json::from_str(line) {
        Ok(payload) => payload,
        Err(_) => return Ok(None),
    };
    if payload.get("type").and_then(Value::as_str) != Some("system")
        || payload.get("subtype").and_then(Value::as_str) != Some("init")
    {
        return Ok(None);
    }
    let session_id = payload
        .get("session_id")
        .or_else(|| payload.get("sessionId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ClaudeSessionForkError::Rejected(
                "Claude Fork 初始化事件缺少有效 session ID".to_string(),
            )
        })?;
    if session_id == source_session_id {
        return Err(ClaudeSessionForkError::Rejected(
            "Claude Fork 返回了源 session ID".to_string(),
        ));
    }
    Ok(Some(session_id.to_string()))
}

/// 逐行读取 stream-json，直到拿到携带新 session ID 的 `system/init`。
///
/// 非 init / 非 JSON 行被忽略；遇到 EOF 仍未拿到 init 视为 `Uncertain`，因为无法确认
/// Claude 服务端是否已创建新会话。
pub(crate) async fn read_fork_session_id<R>(
    reader: R,
    source_session_id: &str,
) -> Result<String, ClaudeSessionForkError>
where
    R: tokio::io::AsyncBufRead + Unpin,
{
    let mut lines = reader.lines();
    loop {
        let line = match lines.next_line().await.map_err(|error| {
            ClaudeSessionForkError::Uncertain(format!("读取 Claude Fork 输出失败: {error}"))
        })? {
            Some(line) => line,
            None => {
                return Err(ClaudeSessionForkError::Uncertain(
                    "Claude Fork 进程结束前未收到 init 事件".to_string(),
                ));
            }
        };
        if let Some(session_id) = extract_fork_session_id(&line, source_session_id)? {
            return Ok(session_id);
        }
    }
}

/// 一次性 Fork 进程的启动配置，全部来自后端可信的源 thread 字段。
#[derive(Debug)]
pub(crate) struct ClaudeSessionForkLaunch {
    pub command: String,
    pub args: Vec<String>,
    pub working_directory: String,
    pub environment: HashMap<String, String>,
    pub source_session_id: String,
}

/// 成功创建 Fork 后确认到的新原生 session ID。
#[derive(Debug)]
pub(crate) struct ClaudeSessionForkOutcome {
    pub session_id: String,
}

/// 只读探测当前 Claude CLI 是否支持 `--fork-session`。
///
/// 成功运行 `<command> --help` 时按是否包含精确标志返回：
/// - `Ok(true)`：支持 `--fork-session`。
/// - `Ok(false)`：旧版本不支持（`--help` 缺少该标志），不是错误。
///
/// 无法运行命令或探测超时返回 `Err(Uncertain(..))`，由调用方映射为能力检查失败。
pub(crate) async fn probe_fork_session(command: &str) -> Result<bool, ClaudeSessionForkError> {
    probe_fork_session_with_timeout(command, FORK_PROTOCOL_TIMEOUT).await
}

async fn probe_fork_session_with_timeout(
    command: &str,
    timeout: Duration,
) -> Result<bool, ClaudeSessionForkError> {
    let mut process = Command::new(command);
    configure_no_window(&mut process);
    process
        .arg("--help")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);

    let output = match tokio::time::timeout(timeout, process.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => {
            return Err(ClaudeSessionForkError::Uncertain(format!(
                "无法运行 Claude CLI 能力探测: {error}"
            )));
        }
        Err(_) => {
            return Err(ClaudeSessionForkError::Uncertain(
                "Claude CLI 能力探测超时".to_string(),
            ));
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(help_supports_fork_session(&stdout))
}

/// 启动一次性 Fork 进程并确认新 session ID。
///
/// 使用固定 10 秒协议超时；init 之前保持 stdin 打开，收到 init 后关闭 stdin 优先等待
/// 优雅退出，仅宽限期超时才 kill。EOF、超时或进程在可信 init 前结束都返回 `Uncertain`。
pub(crate) async fn create_session_fork(
    launch: &ClaudeSessionForkLaunch,
) -> Result<ClaudeSessionForkOutcome, ClaudeSessionForkError> {
    create_session_fork_with_timeout(launch, FORK_PROTOCOL_TIMEOUT).await
}

async fn create_session_fork_with_timeout(
    launch: &ClaudeSessionForkLaunch,
    protocol_timeout: Duration,
) -> Result<ClaudeSessionForkOutcome, ClaudeSessionForkError> {
    let mut command = Command::new(&launch.command);
    configure_no_window(&mut command);
    command
        .args(&launch.args)
        .current_dir(&launch.working_directory)
        .envs(&launch.environment)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = command.spawn().map_err(|error| {
        ClaudeSessionForkError::Uncertain(normalize_message(&format!(
            "启动 Claude Fork 进程失败: {error}"
        )))
    })?;

    let stdout = child.stdout.take().ok_or_else(|| {
        ClaudeSessionForkError::Uncertain("Claude Fork stdout 不可读".to_string())
    })?;
    let stderr_handle = child.stderr.take();
    // 显式持有 stdin，确保 init 前管道保持打开；drop 后才会关闭，提示 CLI 优雅退出。
    let stdin_handle = child.stdin.take();

    // 进程一启动就并发持续排空 stderr，避免子进程在 init 前写满管道造成死锁。
    // 只在 StderrSummary 中保留有界公开摘要，达到上限后仍继续 drain。
    let (stderr_summary, stderr_done) = stderr_summary_task(stderr_handle);

    let init_future = read_fork_session_id(BufReader::new(stdout), &launch.source_session_id);
    let outcome = match tokio::time::timeout(protocol_timeout, init_future).await {
        Ok(Ok(session_id)) => {
            // 收到可信 init：关闭 stdin，优先等待优雅退出。
            drop(stdin_handle);
            let _ = wait_or_kill(&mut child, FORK_GRACEFUL_EXIT_TIMEOUT).await;
            Ok(ClaudeSessionForkOutcome { session_id })
        }
        Ok(Err(rejected @ ClaudeSessionForkError::Rejected(_))) => {
            // init 携带非法 session ID：仍给 CLI 一次优雅退出的机会。
            drop(stdin_handle);
            let _ = wait_or_kill(&mut child, FORK_GRACEFUL_EXIT_TIMEOUT).await;
            Err(rejected)
        }
        Ok(Err(uncertain)) => {
            // stdout 已结束但没有可信 init：宽限期内优先优雅回收，超时才 kill。
            drop(stdin_handle);
            let _ = wait_or_kill(&mut child, FORK_GRACEFUL_EXIT_TIMEOUT).await;
            Err(uncertain)
        }
        Err(_) => {
            // 协议超时前未拿到 init：直接结束进程，避免长时间挂起。
            drop(stdin_handle);
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err(ClaudeSessionForkError::Uncertain(
                "Claude Fork 协议在超时前未返回 init 事件".to_string(),
            ))
        }
    };

    // 进程已结束，等待 stderr drain 任务读到 EOF 后取出有界摘要再注释错误。
    let summary = finish_stderr_summary(stderr_summary, stderr_done).await;
    match outcome {
        Ok(outcome) => Ok(outcome),
        Err(error) => Err(annotate_with_summary(error, &summary)),
    }
}

/// 等待进程在宽限期内自行退出，超时才 kill。
async fn wait_or_kill(
    child: &mut tokio::process::Child,
    grace: Duration,
) -> Option<std::process::ExitStatus> {
    match tokio::time::timeout(grace, child.wait()).await {
        Ok(result) => result.ok(),
        Err(_) => {
            let _ = child.kill().await;
            child.wait().await.ok()
        }
    }
}

/// 启动后台任务持续 drain stderr 到一个有界摘要，返回共享句柄与完成信号。
///
/// 任务一直读取直到 stderr EOF，即便摘要已满也继续排空管道。这保证子进程写满 stderr
/// 时不会被阻塞，从而能正常写出 init 事件。
fn stderr_summary_task(
    stderr: Option<tokio::process::ChildStderr>,
) -> (
    Arc<Mutex<StderrSummary>>,
    tokio::sync::oneshot::Receiver<()>,
) {
    let summary = Arc::new(Mutex::new(StderrSummary::new()));
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    let Some(mut stderr) = stderr else {
        let _ = done_tx.send(());
        return (summary, done_rx);
    };
    let summary_clone = Arc::clone(&summary);
    tokio::spawn(async move {
        let mut buffer = [0u8; 8192];
        loop {
            match stderr.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if let Ok(mut guard) = summary_clone.lock() {
                        guard.push_bytes(&buffer[..read]);
                    }
                }
            }
        }
        let _ = done_tx.send(());
    });
    (summary, done_rx)
}

/// 等待 stderr drain 任务排空管道（读到 EOF）后取出最终有界摘要。
///
/// 本函数总是在进程被 kill/reap 之后调用，因此 stderr 必然会 EOF，等待是有限的。
async fn finish_stderr_summary(
    summary: Arc<Mutex<StderrSummary>>,
    done: tokio::sync::oneshot::Receiver<()>,
) -> String {
    let _ = done.await;
    match summary.lock() {
        Ok(mut guard) => guard.take_finished(),
        Err(_) => String::new(),
    }
}

/// 把归一化后有界的 CLI stderr 摘要附到失败原因上。
///
/// 成功路径不会调用本函数，因此不会泄露 CLI 的原始多行输出；摘要本身也已折叠控制字符、
/// 连续空白并截断到 [`PUBLIC_OUTPUT_LIMIT`]，不会包含多行原始输出。
fn annotate_with_summary(error: ClaudeSessionForkError, summary: &str) -> ClaudeSessionForkError {
    if summary.is_empty() {
        return error;
    }
    match error {
        ClaudeSessionForkError::Rejected(message) => {
            ClaudeSessionForkError::Rejected(format!("{message}（{summary}）"))
        }
        ClaudeSessionForkError::Uncertain(message) => {
            ClaudeSessionForkError::Uncertain(format!("{message}（{summary}）"))
        }
    }
}

/// 流式、有界的 stderr 归一化摘要。
///
/// 折叠控制字符与连续空白为单个空格，按字符截断到 [`PUBLIC_OUTPUT_LIMIT`]。达到上限后
/// 不再存储更多字符，但 [`StderrSummary::push_bytes`] 仍是空操作而非阻塞，调用方（drain
/// 任务）会继续读取并丢弃，保证管道不会因摘要已满而被写满。
#[derive(Default)]
struct StderrSummary {
    normalized: String,
    char_count: usize,
    previous_was_space: bool,
}

impl StderrSummary {
    fn new() -> Self {
        Self::default()
    }

    fn push_bytes(&mut self, bytes: &[u8]) {
        if self.char_count >= PUBLIC_OUTPUT_LIMIT {
            return;
        }
        for ch in String::from_utf8_lossy(bytes).chars() {
            if self.char_count >= PUBLIC_OUTPUT_LIMIT {
                break;
            }
            if ch.is_control() || ch.is_whitespace() {
                if !self.previous_was_space {
                    self.normalized.push(' ');
                    self.char_count += 1;
                    self.previous_was_space = true;
                }
            } else {
                self.normalized.push(ch);
                self.char_count += 1;
                self.previous_was_space = false;
            }
        }
    }

    /// 取出归一化后的有界摘要，去掉首尾空白。
    fn take_finished(&mut self) -> String {
        self.previous_was_space = false;
        self.char_count = 0;
        let trimmed = self.normalized.trim();
        let finished = trimmed.to_string();
        self.normalized.clear();
        finished
    }
}

/// 折叠控制字符与连续空白，去掉首尾空白并按字符截断到 [`PUBLIC_OUTPUT_LIMIT`]。
///
/// 复用 [`StderrSummary`] 的有界归一化逻辑；用于一次性处理已知较小的字符串（如启动
/// 错误），进程 stderr 的持续 drain 不经过本函数，而是直接增量喂给 [`StderrSummary`]。
fn normalize_message(value: &str) -> String {
    let mut summary = StderrSummary::new();
    summary.push_bytes(value.as_bytes());
    summary.take_finished()
}

#[cfg(target_os = "windows")]
fn configure_no_window(command: &mut Command) {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn configure_no_window(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::{
        create_session_fork_with_timeout, extract_fork_session_id, help_supports_fork_session,
        normalize_message, probe_fork_session_with_timeout, read_fork_session_id,
        ClaudeSessionForkError, ClaudeSessionForkLaunch, PUBLIC_OUTPUT_LIMIT,
    };
    use std::collections::HashMap;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    #[test]
    fn claude_session_fork_help_requires_exact_flag() {
        assert!(help_supports_fork_session(
            "--fork-session  When resuming, create a new session ID"
        ));
        assert!(!help_supports_fork_session("--resume <value>"));
        assert!(!help_supports_fork_session("fork session documentation"));
    }

    #[test]
    fn claude_session_fork_accepts_only_a_new_init_session_id() {
        let line = r#"{"type":"system","subtype":"init","session_id":"child-session"}"#;
        assert_eq!(
            extract_fork_session_id(line, "source-session").unwrap(),
            Some("child-session".to_string())
        );
        let same = r#"{"type":"system","subtype":"init","session_id":"source-session"}"#;
        assert!(extract_fork_session_id(same, "source-session").is_err());
        let assistant = r#"{"type":"assistant","session_id":"child-session"}"#;
        assert_eq!(
            extract_fork_session_id(assistant, "source-session").unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn claude_session_fork_reads_init_and_ignores_other_events() {
        let input = concat!(
            "not-json\n",
            "{\"type\":\"system\",\"subtype\":\"status\"}\n",
            "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"child\"}\n"
        );
        let reader = tokio::io::BufReader::new(input.as_bytes());
        let session_id = read_fork_session_id(reader, "source").await.unwrap();
        assert_eq!(session_id, "child");
    }

    #[tokio::test]
    async fn claude_session_fork_eof_without_init_is_uncertain() {
        let reader = tokio::io::BufReader::new("{\"type\":\"system\"}\n".as_bytes());
        assert!(matches!(
            read_fork_session_id(reader, "source").await,
            Err(ClaudeSessionForkError::Uncertain(_))
        ));
    }

    #[test]
    fn claude_session_fork_normalize_collapses_control_and_whitespace() {
        assert_eq!(normalize_message("  a\tb\n\rc\u{0}d  \n "), "a b c d");
        assert_eq!(normalize_message("\n\t  hi  \n"), "hi");
        assert_eq!(normalize_message("already   clean"), "already clean");
    }

    #[test]
    fn claude_session_fork_normalize_truncates_unicode_at_limit() {
        let cjk: String = "字".repeat(PUBLIC_OUTPUT_LIMIT + 100);
        let normalized = normalize_message(&cjk);
        assert_eq!(normalized.chars().count(), PUBLIC_OUTPUT_LIMIT);
        assert!(normalized.chars().all(|ch| ch == '字'));

        let mixed = format!("{}{}", "é".repeat(10), "字".repeat(PUBLIC_OUTPUT_LIMIT));
        let normalized = normalize_message(&mixed);
        assert_eq!(normalized.chars().count(), PUBLIC_OUTPUT_LIMIT);
        assert!(normalized.starts_with(&"é".repeat(10)));
    }

    fn node_available() -> bool {
        std::process::Command::new("node")
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .and_then(|mut child| child.wait())
            .map(|status| status.success())
            .unwrap_or(false)
    }

    #[tokio::test]
    async fn claude_session_fork_probe_start_failure_is_uncertain() {
        let outcome = probe_fork_session_with_timeout(
            "definitely-not-a-real-claude-binary-xyz",
            Duration::from_secs(2),
        )
        .await;
        assert!(
            matches!(outcome, Err(ClaudeSessionForkError::Uncertain(_))),
            "expected uncertain on spawn failure, got {outcome:?}"
        );
    }

    #[tokio::test]
    async fn claude_session_fork_probe_unsupported_when_help_lacks_flag() {
        if !node_available() {
            return;
        }
        let outcome = probe_fork_session_with_timeout("node", Duration::from_secs(5)).await;
        // `node --help` 不会包含 --fork-session，因此探测为不支持（Ok(false)）。
        assert_eq!(outcome, Ok(false));
    }

    #[tokio::test]
    async fn claude_session_fork_probe_timeout_is_uncertain() {
        if !node_available() {
            return;
        }
        let outcome = probe_fork_session_with_timeout("node", Duration::from_millis(1)).await;
        assert!(
            matches!(outcome, Err(ClaudeSessionForkError::Uncertain(_))),
            "expected uncertain on probe timeout, got {outcome:?}"
        );
    }

    fn fork_working_directory() -> PathBuf {
        let mut directory = std::env::temp_dir();
        directory.push(format!("codem-claude-fork-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("create temp working directory");
        directory
    }

    fn write_fixture(working_directory: &Path, contents: &str) -> String {
        let filename = format!("codem-claude-fork-{}.jsonl", uuid::Uuid::new_v4());
        let path = working_directory.join(&filename);
        std::fs::File::create(&path)
            .and_then(|mut file| file.write_all(contents.as_bytes()))
            .expect("write fixture file");
        filename
    }

    fn write_node_script(working_directory: &Path, body: &str) -> String {
        let filename = format!("codem-claude-fork-{}.js", uuid::Uuid::new_v4());
        let path = working_directory.join(&filename);
        std::fs::File::create(&path)
            .and_then(|mut file| file.write_all(body.as_bytes()))
            .expect("write node script");
        filename
    }

    fn launch_dumping(working_directory: &Path, filename: &str) -> ClaudeSessionForkLaunch {
        if cfg!(windows) {
            ClaudeSessionForkLaunch {
                command: "cmd".to_string(),
                args: vec!["/c".to_string(), "type".to_string(), filename.to_string()],
                working_directory: working_directory.to_string_lossy().to_string(),
                environment: HashMap::new(),
                source_session_id: "source-session".to_string(),
            }
        } else {
            ClaudeSessionForkLaunch {
                command: "sh".to_string(),
                args: vec!["-c".to_string(), format!("cat {filename}")],
                working_directory: working_directory.to_string_lossy().to_string(),
                environment: HashMap::new(),
                source_session_id: "source-session".to_string(),
            }
        }
    }

    fn launch_hanging(working_directory: &Path) -> ClaudeSessionForkLaunch {
        if cfg!(windows) {
            ClaudeSessionForkLaunch {
                command: "cmd".to_string(),
                args: vec!["/c".to_string(), "ping -n 4 127.0.0.1 >nul".to_string()],
                working_directory: working_directory.to_string_lossy().to_string(),
                environment: HashMap::new(),
                source_session_id: "source-session".to_string(),
            }
        } else {
            ClaudeSessionForkLaunch {
                command: "sh".to_string(),
                args: vec!["-c".to_string(), "sleep 3".to_string()],
                working_directory: working_directory.to_string_lossy().to_string(),
                environment: HashMap::new(),
                source_session_id: "source-session".to_string(),
            }
        }
    }

    fn launch_node(
        working_directory: &Path,
        filename: &str,
        source_session_id: &str,
    ) -> ClaudeSessionForkLaunch {
        ClaudeSessionForkLaunch {
            command: "node".to_string(),
            args: vec![filename.to_string()],
            working_directory: working_directory.to_string_lossy().to_string(),
            environment: HashMap::new(),
            source_session_id: source_session_id.to_string(),
        }
    }

    /// 从 `prefix（summary）` 形式的错误消息中取出归一化后的 stderr 摘要部分。
    fn stderr_portion(message: &str) -> String {
        message
            .split_once('（')
            .map(|(_, rest)| rest.trim_end_matches('）').to_string())
            .unwrap_or_default()
    }

    #[tokio::test]
    async fn claude_session_fork_process_returns_new_session_id() {
        let working_directory = fork_working_directory();
        let filename = write_fixture(
            &working_directory,
            "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"child-session\"}\n",
        );
        let launch = launch_dumping(&working_directory, &filename);

        let outcome = create_session_fork_with_timeout(&launch, Duration::from_secs(10))
            .await
            .expect("fork process should return the new session id");
        assert_eq!(outcome.session_id, "child-session");

        let _ = std::fs::remove_dir_all(&working_directory);
    }

    #[tokio::test]
    async fn claude_session_fork_process_eof_without_init_is_uncertain() {
        let working_directory = fork_working_directory();
        let filename = write_fixture(
            &working_directory,
            "{\"type\":\"system\",\"subtype\":\"status\"}\n",
        );
        let launch = launch_dumping(&working_directory, &filename);

        let outcome = create_session_fork_with_timeout(&launch, Duration::from_secs(10)).await;
        assert!(
            matches!(&outcome, Err(ClaudeSessionForkError::Uncertain(_))),
            "expected uncertain outcome, got {outcome:?}"
        );

        let _ = std::fs::remove_dir_all(&working_directory);
    }

    #[tokio::test]
    async fn claude_session_fork_process_timeout_is_uncertain() {
        let start = std::time::Instant::now();
        let working_directory = fork_working_directory();
        let launch = launch_hanging(&working_directory);

        let outcome = create_session_fork_with_timeout(&launch, Duration::from_millis(500)).await;
        assert!(
            matches!(&outcome, Err(ClaudeSessionForkError::Uncertain(_))),
            "expected uncertain outcome on timeout, got {outcome:?}"
        );
        // 挂起进程必须被 kill+reap，不能无限挂住测试。
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "hanging process should be killed+reaped promptly, took {:?}",
            start.elapsed()
        );

        let _ = std::fs::remove_dir_all(&working_directory);
    }

    #[tokio::test]
    async fn claude_session_fork_process_drains_stderr_flood_then_reads_init() {
        // 子进程用 fs.writeSync(2, ...) 同步写满 stderr 管道后再写 init；若启动后不并发
        // 排空 stderr，子进程会阻塞在同步写上、永远写不出 init，从而死锁到协议超时。
        if !node_available() {
            return;
        }
        let working_directory = fork_working_directory();
        let script = write_node_script(
            &working_directory,
            "const fs=require('fs');fs.writeSync(2,Buffer.alloc(100000,65));process.stdout.write('{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"child-session\"}\\n');",
        );
        let launch = launch_node(&working_directory, &script, "source-session");

        let outcome = create_session_fork_with_timeout(&launch, Duration::from_secs(10))
            .await
            .expect("concurrent stderr drain should let init through");
        assert_eq!(outcome.session_id, "child-session");

        let _ = std::fs::remove_dir_all(&working_directory);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn claude_session_fork_eof_branch_kills_loitering_process() {
        // Unix：写一行非 init 后用 `exec 1>&-` 真正关闭 stdout 再 sleep；EOF 分支必须用
        // 有界 wait_or_kill 回收，否则会无限等待驻留进程。Windows 进程只在退出时关闭
        // stdout，无法构造此场景，故仅 Unix 覆盖该 kill 路径。
        let start = std::time::Instant::now();
        let working_directory = fork_working_directory();
        let launch = ClaudeSessionForkLaunch {
            command: "sh".to_string(),
            args: vec![
                "-c".to_string(),
                "printf 'not-init\\n'; exec 1>&-; sleep 15".to_string(),
            ],
            working_directory: working_directory.to_string_lossy().to_string(),
            environment: HashMap::new(),
            source_session_id: "source-session".to_string(),
        };

        let outcome = create_session_fork_with_timeout(&launch, Duration::from_secs(10)).await;
        assert!(
            matches!(&outcome, Err(ClaudeSessionForkError::Uncertain(_))),
            "expected uncertain outcome, got {outcome:?}"
        );
        assert!(
            start.elapsed() < Duration::from_secs(8),
            "EOF branch should reap within the grace window, took {:?}",
            start.elapsed()
        );

        let _ = std::fs::remove_dir_all(&working_directory);
    }

    #[tokio::test]
    async fn claude_session_fork_rejected_annotates_bounded_single_line_stderr() {
        // init 返回源 session ID -> Rejected；多行 stderr 必须折叠成单行有界摘要。
        if !node_available() {
            return;
        }
        let working_directory = fork_working_directory();
        let script = write_node_script(
            &working_directory,
            "const fs=require('fs');fs.writeSync(2,'detail line one\\ndetail line two\\ndetail line three\\n'.repeat(200));process.stdout.write('{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"source-session\"}\\n');",
        );
        let launch = launch_node(&working_directory, &script, "source-session");

        let outcome = create_session_fork_with_timeout(&launch, Duration::from_secs(10)).await;
        let message = match outcome {
            Err(ClaudeSessionForkError::Rejected(message)) => message,
            other => panic!("expected rejected, got {other:?}"),
        };
        assert!(message.contains("detail line one"));
        assert!(
            !message.contains('\n'),
            "annotated message must stay single-line"
        );
        let portion = stderr_portion(&message);
        assert!(
            portion.chars().count() <= PUBLIC_OUTPUT_LIMIT,
            "stderr portion must be bounded, got {} chars",
            portion.chars().count()
        );
        assert!(!portion.is_empty(), "stderr portion should capture output");

        let _ = std::fs::remove_dir_all(&working_directory);
    }

    #[tokio::test]
    async fn claude_session_fork_uncertain_annotates_bounded_single_line_stderr() {
        // 写多行 stderr 后只写非 init 行即退出 -> EOF Uncertain；注释仍单行有界。
        if !node_available() {
            return;
        }
        let working_directory = fork_working_directory();
        let script = write_node_script(
            &working_directory,
            "const fs=require('fs');fs.writeSync(2,'detail line one\\ndetail line two\\n'.repeat(200));process.stdout.write('{\"type\":\"system\",\"subtype\":\"status\"}\\n');",
        );
        let launch = launch_node(&working_directory, &script, "source-session");

        let outcome = create_session_fork_with_timeout(&launch, Duration::from_secs(10)).await;
        let message = match outcome {
            Err(ClaudeSessionForkError::Uncertain(message)) => message,
            other => panic!("expected uncertain, got {other:?}"),
        };
        assert!(message.contains("detail line one"));
        assert!(
            !message.contains('\n'),
            "annotated message must stay single-line"
        );
        let portion = stderr_portion(&message);
        assert!(
            portion.chars().count() <= PUBLIC_OUTPUT_LIMIT,
            "stderr portion must be bounded, got {} chars",
            portion.chars().count()
        );

        let _ = std::fs::remove_dir_all(&working_directory);
    }
}
