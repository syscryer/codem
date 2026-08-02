//! Claude CLI `--fork-session` 协议桥。
//!
//! 一次性、无 prompt 的进程：使用 `--resume <源 session> --fork-session` 恢复
//! 源会话并确认 `system/init` 事件中的新原生 session ID。本模块只负责协议解析与
//! 进程生命周期，不依赖 `backend.rs`，方便单独做单元测试。

use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;

/// 等待 `system/init` 返回新 session ID 的协议超时。
const FORK_PROTOCOL_TIMEOUT: Duration = Duration::from_secs(10);

/// 收到 init 并关闭 stdin 后，等待进程自行退出的宽限期；超时才强制结束。
const FORK_GRACEFUL_EXIT_TIMEOUT: Duration = Duration::from_secs(2);

/// 对外暴露的 stderr / 进程输出归一化后最大字符数。
const PUBLIC_OUTPUT_LIMIT: usize = 512;

/// 一次性 Fork 进程可能出现的失败语义。
///
/// - `Unsupported`：当前 Claude CLI 不支持 `--fork-session`（如 `--help` 缺少该标志）。
/// - `Rejected`：协议明确拒绝创建新会话，例如 init 事件缺少 session ID 或返回了源 ID。
/// - `Uncertain`：无法确认是否已创建新会话（超时、EOF 前未收到 init、进程退出码异常等）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ClaudeSessionForkError {
    Unsupported(String),
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
/// 成功运行 `--help` 时按是否包含精确标志返回 `Ok(true)` / `Ok(false)`；无法运行或超时
/// 返回 `Err(Uncertain(..))`，由调用方映射为能力检查失败而非旧版本不支持。
pub(crate) async fn probe_fork_session(command: &str) -> Result<bool, ClaudeSessionForkError> {
    let mut process = Command::new(command);
    configure_no_window(&mut process);
    process
        .arg("--help")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);

    let output = match tokio::time::timeout(FORK_PROTOCOL_TIMEOUT, process.output()).await {
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
        ClaudeSessionForkError::Uncertain(format!("启动 Claude Fork 进程失败: {error}"))
    })?;

    let stdout = child.stdout.take().ok_or_else(|| {
        ClaudeSessionForkError::Uncertain("Claude Fork stdout 不可读".to_string())
    })?;
    let stderr_handle = child.stderr.take();
    // 显式持有 stdin，确保 init 前管道保持打开；drop 后才会关闭，提示 CLI 优雅退出。
    let stdin_handle = child.stdin.take();

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
            Err(annotate_with_stderr(rejected, stderr_handle).await)
        }
        Ok(Err(uncertain)) => {
            // stdout 已结束但没有可信 init：尽快回收进程。
            drop(stdin_handle);
            let _ = child.wait().await;
            Err(annotate_with_stderr(uncertain, stderr_handle).await)
        }
        Err(_) => {
            // 协议超时前未拿到 init：直接结束进程，避免长时间挂起。
            drop(stdin_handle);
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err(annotate_with_stderr(
                ClaudeSessionForkError::Uncertain(
                    "Claude Fork 协议在超时前未返回 init 事件".to_string(),
                ),
                stderr_handle,
            )
            .await)
        }
    };

    outcome
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

/// 把归一化（控制字符 / 连续空白折叠、长度截断）后的 CLI stderr 附到失败原因上。
///
/// 成功路径不会调用本函数，因此不会泄露 CLI 的原始多行输出。
async fn annotate_with_stderr(
    error: ClaudeSessionForkError,
    stderr: Option<tokio::process::ChildStderr>,
) -> ClaudeSessionForkError {
    let Some(mut stderr) = stderr else {
        return error;
    };
    let mut buffer = Vec::new();
    if stderr.read_to_end(&mut buffer).await.is_err() {
        return error;
    }
    let normalized = normalize_message(&String::from_utf8_lossy(&buffer));
    if normalized.is_empty() {
        return error;
    }
    match error {
        ClaudeSessionForkError::Unsupported(message) => {
            ClaudeSessionForkError::Unsupported(format!("{message}（{normalized}）"))
        }
        ClaudeSessionForkError::Rejected(message) => {
            ClaudeSessionForkError::Rejected(format!("{message}（{normalized}）"))
        }
        ClaudeSessionForkError::Uncertain(message) => {
            ClaudeSessionForkError::Uncertain(format!("{message}（{normalized}）"))
        }
    }
}

/// 折叠控制字符与连续空白，去掉首尾空白并按字符截断到 [`PUBLIC_OUTPUT_LIMIT`]。
fn normalize_message(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len().min(PUBLIC_OUTPUT_LIMIT + 8));
    let mut previous_was_space = false;
    for ch in value.chars() {
        if ch.is_control() || ch.is_whitespace() {
            if !previous_was_space {
                normalized.push(' ');
                previous_was_space = true;
            }
            continue;
        }
        normalized.push(ch);
        previous_was_space = false;
    }
    let trimmed = normalized.trim();
    if trimmed.chars().count() <= PUBLIC_OUTPUT_LIMIT {
        return trimmed.to_string();
    }
    trimmed.chars().take(PUBLIC_OUTPUT_LIMIT).collect()
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
        read_fork_session_id, ClaudeSessionForkError, ClaudeSessionForkLaunch,
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
        let working_directory = fork_working_directory();
        let launch = launch_hanging(&working_directory);

        let outcome = create_session_fork_with_timeout(&launch, Duration::from_millis(500)).await;
        assert!(
            matches!(&outcome, Err(ClaudeSessionForkError::Uncertain(_))),
            "expected uncertain outcome on timeout, got {outcome:?}"
        );

        let _ = std::fs::remove_dir_all(&working_directory);
    }
}
