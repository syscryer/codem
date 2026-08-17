use futures_util::{stream::SplitStream, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    net::{TcpListener, TcpStream},
    process::{Child, Command},
    sync::Mutex as AsyncMutex,
};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

const READY_TIMEOUT: Duration = Duration::from_secs(45);
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_LOG_LINES: usize = 500;
const MAX_LOG_LINE_BYTES: usize = 4 * 1024;

type DshSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Clone, Default)]
pub(crate) struct DshService {
    backends: Arc<AsyncMutex<HashMap<String, Arc<DshBackend>>>>,
}

struct DshBackend {
    base_url: String,
    mux_ws_url: String,
    child: AsyncMutex<Child>,
    logs: Arc<Mutex<VecDeque<String>>>,
    http: reqwest::Client,
    model_patch: Option<PathBuf>,
}

pub(crate) struct DshClient {
    backend: Arc<DshBackend>,
    read: SplitStream<DshSocket>,
}

#[derive(Clone, Debug)]
pub(crate) struct DshSession {
    pub session_id: String,
    pub resumed: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct DshRuntimeEvent {
    pub rpc_id: String,
    pub event_type: String,
    pub session_id: Option<String>,
    pub payload: Value,
}

impl DshService {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) async fn connect(
        &self,
        command: &str,
        working_directory: &Path,
        environment: &BTreeMap<String, String>,
        fingerprint: Option<&str>,
        model: Option<&str>,
        tools_mode: &str,
        permission_mode: &str,
    ) -> Result<DshClient, String> {
        let key = serde_json::to_string(&json!([
            command,
            working_directory.to_string_lossy(),
            fingerprint.unwrap_or("system"),
            model,
            tools_mode,
            permission_mode,
        ]))
        .map_err(|error| format!("生成 DSH Runtime 标识失败: {error}"))?;
        let backend = self
            .ensure_backend(
                key,
                command,
                working_directory,
                environment,
                model,
                tools_mode,
                permission_mode,
            )
            .await?;
        let (socket, _) = connect_async(&backend.mux_ws_url)
            .await
            .map_err(|error| format!("连接 DSH WebSocket 失败: {error}"))?;
        let (_, read) = socket.split();
        Ok(DshClient { backend, read })
    }

    pub(crate) async fn projections(&self, session_id: &str) -> Result<Value, String> {
        let backends = self.backends.lock().await;
        let candidates = backends.values().cloned().collect::<Vec<_>>();
        drop(backends);

        let mut last_error = None;
        for backend in candidates {
            if !backend.is_running().await {
                continue;
            }
            match backend
                .rpc(
                    "session.history",
                    json!({
                        "sessionId": session_id,
                        "maxMessages": 1,
                        "includeProjections": true,
                    }),
                )
                .await
            {
                Ok(value) => {
                    return Ok(value
                        .pointer("/projections/values")
                        .cloned()
                        .unwrap_or(Value::Null));
                }
                Err(error) => last_error = Some(error),
            }
        }

        Err(last_error.unwrap_or_else(|| "当前没有可复用的 DSH Runtime".to_string()))
    }

    async fn ensure_backend(
        &self,
        key: String,
        command: &str,
        working_directory: &Path,
        environment: &BTreeMap<String, String>,
        model: Option<&str>,
        tools_mode: &str,
        permission_mode: &str,
    ) -> Result<Arc<DshBackend>, String> {
        let mut backends = self.backends.lock().await;
        if let Some(existing) = backends.get(&key).cloned() {
            if existing.is_running().await {
                return Ok(existing);
            }
            existing.shutdown().await;
            backends.remove(&key);
        }
        let backend = Arc::new(
            spawn_backend(
                command,
                working_directory,
                environment,
                model,
                tools_mode,
                permission_mode,
            )
            .await?,
        );
        backends.insert(key, backend.clone());
        Ok(backend)
    }
}

impl DshBackend {
    async fn rpc(&self, method: &str, payload: Value) -> Result<Value, String> {
        let rpc_id = uuid::Uuid::new_v4().to_string();
        let response = self
            .http
            .post(format!("{}/api/{method}", self.base_url))
            .json(&json!({
                "type": "client-request",
                "rpcId": rpc_id,
                "method": method,
                "payload": payload,
            }))
            .send()
            .await
            .map_err(|error| format!("调用 DSH API 失败: {error}"))?;
        let status = response.status();
        let value: Value = response
            .json()
            .await
            .map_err(|error| format!("DSH API 返回了无效 JSON: {error}"))?;
        if !status.is_success() {
            return Err(format!(
                "DSH API 返回 {}: {}",
                status.as_u16(),
                public_json(&value)
            ));
        }
        if value.get("rpcId").and_then(Value::as_str) != Some(rpc_id.as_str()) {
            return Err("DSH API 返回了不匹配的 rpcId".to_string());
        }
        let result = value
            .get("result")
            .ok_or_else(|| "DSH API 响应缺少 result".to_string())?;
        if result.get("ok").and_then(Value::as_bool) == Some(true) {
            Ok(result.get("value").cloned().unwrap_or(Value::Null))
        } else {
            Err(result
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("DSH API 请求失败")
                .to_string())
        }
    }

    async fn respond(&self, rpc_id: &str, result: Value) -> Result<(), String> {
        let response = self
            .http
            .post(format!("{}/api/respond", self.base_url))
            .json(&json!({
                "type": "client-response",
                "rpcId": rpc_id,
                "result": result,
            }))
            .send()
            .await
            .map_err(|error| format!("提交 DSH 交互响应失败: {error}"))?;
        let status = response.status();
        let value: Value = response
            .json()
            .await
            .map_err(|error| format!("DSH 交互接口返回了无效 JSON: {error}"))?;
        if !status.is_success() || value.get("accepted").and_then(Value::as_bool) != Some(true) {
            return Err(format!("DSH 未接受交互响应: {}", public_json(&value)));
        }
        Ok(())
    }

    async fn is_running(&self) -> bool {
        self.child.lock().await.try_wait().ok().flatten().is_none()
    }

    async fn shutdown(&self) {
        let mut child = self.child.lock().await;
        let _ = child.kill().await;
        let _ = child.wait().await;
        if let Some(path) = &self.model_patch {
            let _ = std::fs::remove_file(path);
        }
    }
}

impl DshClient {
    pub(crate) fn web_ui_url(&self) -> &str {
        &self.backend.base_url
    }

    pub(crate) async fn call(&self, method: &str, payload: Value) -> Result<Value, String> {
        self.backend.rpc(method, payload).await
    }

    pub(crate) async fn create_or_resume_session(
        &self,
        requested_session_id: Option<&str>,
        cwd: &Path,
        agent_preset: &str,
    ) -> Result<DshSession, String> {
        if let Some(session_id) = requested_session_id {
            self.backend
                .rpc(
                    "session.history",
                    json!({ "sessionId": session_id, "maxMessages": 1 }),
                )
                .await?;
            return Ok(DshSession {
                session_id: session_id.to_string(),
                resumed: true,
            });
        }
        let value = self
            .backend
            .rpc(
                "session.create",
                json!({
                    "cwd": cwd.to_string_lossy(),
                    "agentPreset": agent_preset,
                }),
            )
            .await?;
        let session_id = value
            .get("sessionId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "DSH session.create 未返回 sessionId".to_string())?;
        Ok(DshSession {
            session_id: session_id.to_string(),
            resumed: false,
        })
    }

    pub(crate) async fn prompt(&self, session_id: &str, text: &str) -> Result<(), String> {
        self.backend
            .rpc(
                "session.prompt",
                json!({
                    "sessionId": session_id,
                    "mode": "queue",
                    "content": [{ "type": "text", "text": text }],
                    "clientTimeZone": "Asia/Singapore",
                }),
            )
            .await?;
        Ok(())
    }

    pub(crate) async fn select_model(
        &self,
        session_id: &str,
        selection: &str,
        reasoning_effort: Option<&str>,
    ) -> Result<(), String> {
        let selection = selection.trim();
        let (provider, model) = if selection.contains('/') {
            resolve_model_selection(selection, &Value::Null)?
        } else {
            let catalog = self.backend.rpc("llm.models", json!({})).await?;
            resolve_model_selection(selection, &catalog)?
        };
        self.backend
            .rpc(
                "session.selectModel",
                dsh_select_model_payload(session_id, &provider, &model, reasoning_effort),
            )
            .await?;
        Ok(())
    }

    pub(crate) async fn projections(&self, session_id: &str) -> Result<Value, String> {
        let value = self
            .backend
            .rpc(
                "session.history",
                json!({
                    "sessionId": session_id,
                    "maxMessages": 1,
                    "includeProjections": true,
                }),
            )
            .await?;
        Ok(value
            .pointer("/projections/values")
            .cloned()
            .unwrap_or(Value::Null))
    }

    pub(crate) async fn cancel(&self, session_id: &str) -> Result<(), String> {
        self.backend
            .rpc("session.cancel", json!({ "sessionId": session_id }))
            .await?;
        Ok(())
    }

    pub(crate) async fn respond_approval(
        &self,
        rpc_id: &str,
        session_id: &str,
        approval_id: &str,
        approved: bool,
    ) -> Result<(), String> {
        self.backend
            .respond(
                rpc_id,
                json!({
                    "ok": true,
                    "value": {
                        "sessionId": session_id,
                        "approvalId": approval_id,
                        "outcome": if approved { "allowed-once" } else { "rejected" },
                    }
                }),
            )
            .await
    }

    pub(crate) async fn respond_questions(
        &self,
        rpc_id: &str,
        session_id: &str,
        answers: &serde_json::Map<String, Value>,
    ) -> Result<(), String> {
        let answers = answers
            .iter()
            .map(|(id, value)| {
                let selected = value
                    .as_array()
                    .map(|values| values.iter().filter_map(Value::as_str).collect::<Vec<_>>())
                    .unwrap_or_default();
                let custom = value.as_str().filter(|value| !value.is_empty());
                json!({ "id": id, "selected": selected, "custom": custom })
            })
            .collect::<Vec<_>>();
        self.backend
            .respond(
                rpc_id,
                json!({
                    "ok": true,
                    "value": { "sessionId": session_id, "answer": { "answers": answers } }
                }),
            )
            .await
    }

    pub(crate) async fn next_event(&mut self) -> Result<DshRuntimeEvent, String> {
        while let Some(message) = self.read.next().await {
            let message = message.map_err(|error| format!("读取 DSH WebSocket 失败: {error}"))?;
            let Message::Text(text) = message else {
                continue;
            };
            let value: Value = serde_json::from_str(&text)
                .map_err(|error| format!("DSH WebSocket 返回了无效 JSON: {error}"))?;
            let payload = value.get("payload").cloned().unwrap_or(Value::Null);
            return Ok(DshRuntimeEvent {
                rpc_id: value
                    .get("rpcId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                event_type: payload
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                session_id: payload
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                payload,
            });
        }
        Err("DSH WebSocket 已关闭".to_string())
    }

    pub(crate) async fn close(self) {}
}

fn dsh_select_model_payload(
    session_id: &str,
    provider: &str,
    model: &str,
    reasoning_effort: Option<&str>,
) -> Value {
    let mut payload = json!({
        "sessionId": session_id,
        "provider": provider,
        "model": model,
    });
    if let Some(reasoning_effort) = reasoning_effort.filter(|value| !value.trim().is_empty()) {
        payload["reasoningEffort"] = json!(reasoning_effort);
    }
    payload
}

fn resolve_model_selection(selection: &str, catalog: &Value) -> Result<(String, String), String> {
    let selection = selection.trim();
    if let Some((provider, model)) = selection.split_once('/') {
        if !provider.trim().is_empty() && !model.trim().is_empty() {
            return Ok((provider.trim().to_string(), model.trim().to_string()));
        }
    }

    let matches = catalog
        .get("groups")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|group| {
            let provider = group.get("id").and_then(Value::as_str).unwrap_or_default();
            group
                .get("models")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(move |model| {
                    let model_id = model.get("id").and_then(Value::as_str)?;
                    (model_id == selection && !provider.is_empty())
                        .then(|| (provider.to_string(), model_id.to_string()))
                })
        })
        .collect::<Vec<_>>();

    match matches.as_slice() {
        [resolved] => Ok(resolved.clone()),
        [] => Err(format!("DSH 模型 {selection} 未在模型目录中找到")),
        _ => Err(format!(
            "DSH 模型 {selection} 对应多个供应商，请重新选择模型"
        )),
    }
}

async fn spawn_backend(
    command: &str,
    working_directory: &Path,
    environment: &BTreeMap<String, String>,
    model: Option<&str>,
    tools_mode: &str,
    permission_mode: &str,
) -> Result<DshBackend, String> {
    let port = reserve_loopback_port().await?;
    let model_patch = match model.filter(|model| !model.trim().is_empty() && *model != "__default")
    {
        Some(model) => Some(write_model_patch(model)?),
        None => None,
    };
    let logs = Arc::new(Mutex::new(VecDeque::new()));
    let mut process = dsh_process_command(command);
    process.current_dir(working_directory);
    process.args(web_arguments(model_patch.as_deref(), port));
    process
        .envs(environment)
        .env("DSH_TOOLS_MODE", tools_mode)
        .env("DSH_PERMISSION_MODE", permission_mode)
        .env("NO_COLOR", "1")
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(api_key) = environment.get("CODEM_AGENT_CHANNEL_API_KEY") {
        process.env("DEEPSEEK_API_KEY", api_key);
    }
    let mut child = process
        .spawn()
        .map_err(|error| format!("启动 DSH Web Host 失败: {error}"))?;
    if let Some(stdout) = child.stdout.take() {
        spawn_log_reader(stdout, logs.clone(), "stdout");
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_log_reader(stderr, logs.clone(), "stderr");
    }
    let http = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .no_proxy()
        .build()
        .map_err(|error| format!("创建 DSH HTTP 客户端失败: {error}"))?;
    let backend = DshBackend {
        base_url: format!("http://127.0.0.1:{port}"),
        mux_ws_url: format!("ws://127.0.0.1:{port}/api/events.mux"),
        child: AsyncMutex::new(child),
        logs,
        http,
        model_patch,
    };
    wait_until_ready(&backend).await?;
    Ok(backend)
}

fn web_arguments(model_patch: Option<&Path>, port: u16) -> Vec<OsString> {
    let mut arguments = vec![OsString::from("--profile"), OsString::from("web")];
    if let Some(path) = model_patch {
        arguments.push(OsString::from("--patch"));
        arguments.push(path.as_os_str().to_owned());
    }
    arguments.extend([
        OsString::from("--host"),
        OsString::from("127.0.0.1"),
        OsString::from("--port"),
        OsString::from(port.to_string()),
    ]);
    arguments
}

async fn reserve_loopback_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("为 DSH 分配本地端口失败: {error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("读取 DSH 本地端口失败: {error}"))
}

async fn wait_until_ready(backend: &DshBackend) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + READY_TIMEOUT;
    loop {
        if !backend.is_running().await {
            return Err(format!(
                "DSH Web Host 在就绪前退出\n{}",
                log_tail(&backend.logs, 20)
            ));
        }
        if backend.rpc("host.describe", json!({})).await.is_ok() {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "等待 DSH Web Host 就绪超时\n{}",
                log_tail(&backend.logs, 20)
            ));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn dsh_process_command(command: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        let path = Path::new(command);
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if extension.eq_ignore_ascii_case("ps1") {
            let mut process = Command::new("powershell.exe");
            process.creation_flags(0x08000000);
            process.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
            process.arg(path);
            return process;
        }
        if extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat") {
            let powershell_script = path.with_extension("ps1");
            if powershell_script.is_file() {
                let mut process = Command::new("powershell.exe");
                process.creation_flags(0x08000000);
                process.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
                process.arg(powershell_script);
                return process;
            }
            let mut process = Command::new("cmd.exe");
            process.creation_flags(0x08000000);
            process.args(["/D", "/S", "/C"]);
            process.arg(path);
            return process;
        }
    }
    Command::new(command)
}

fn write_model_patch(model: &str) -> Result<PathBuf, String> {
    let directory = std::env::temp_dir().join("codem").join("dsh-web-patches");
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("创建 DSH 临时配置目录失败: {error}"))?;
    let path = directory.join(format!("{}.yml", uuid::Uuid::new_v4()));
    let model =
        serde_json::to_string(model).map_err(|error| format!("序列化 DSH 模型失败: {error}"))?;
    std::fs::write(
        &path,
        format!("- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: {model}\n"),
    )
    .map_err(|error| format!("写入 DSH 临时模型配置失败: {error}"))?;
    Ok(path)
}

fn spawn_log_reader<R>(reader: R, logs: Arc<Mutex<VecDeque<String>>>, source: &'static str)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let mut line = line.trim().to_string();
            if line.len() > MAX_LOG_LINE_BYTES {
                line.truncate(MAX_LOG_LINE_BYTES);
                line.push_str(" [truncated]");
            }
            if let Ok(mut logs) = logs.lock() {
                logs.push_back(format!("[{source}] {line}"));
                while logs.len() > MAX_LOG_LINES {
                    logs.pop_front();
                }
            }
        }
    });
}

fn log_tail(logs: &Mutex<VecDeque<String>>, count: usize) -> String {
    logs.lock()
        .map(|logs| {
            logs.iter()
                .rev()
                .take(count)
                .cloned()
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

fn public_json(value: &Value) -> String {
    let mut text = value.to_string();
    if text.len() > 2048 {
        text.truncate(2048);
        text.push_str(" [truncated]");
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_create_payload_includes_agent_preset() {
        let payload = json!({
            "cwd": Path::new("D:/workspace").to_string_lossy(),
            "agentPreset": "standard",
        });
        assert_eq!(payload["agentPreset"], "standard");
    }

    #[test]
    fn web_profile_precedes_patch_and_web_arguments() {
        let arguments = web_arguments(Some(Path::new("model.yml")), 3000);
        assert_eq!(
            arguments,
            [
                OsString::from("--profile"),
                OsString::from("web"),
                OsString::from("--patch"),
                OsString::from("model.yml"),
                OsString::from("--host"),
                OsString::from("127.0.0.1"),
                OsString::from("--port"),
                OsString::from("3000")
            ]
        );
    }

    #[test]
    fn model_patch_targets_dsh_default_model() {
        let path = write_model_patch("deepseek-chat").expect("write patch");
        let contents = std::fs::read_to_string(&path).expect("read patch");
        let _ = std::fs::remove_file(path);
        assert!(contents.contains("id: agent-default-model"));
        assert!(contents.contains("model: \"deepseek-chat\""));
    }

    #[test]
    fn dsh_resolves_legacy_bare_model_from_catalog() {
        let catalog = json!({
            "groups": [{
                "id": "deepseek-official",
                "models": [{ "id": "deepseek-v4-flash" }]
            }]
        });
        assert_eq!(
            resolve_model_selection("deepseek-v4-flash", &catalog),
            Ok((
                "deepseek-official".to_string(),
                "deepseek-v4-flash".to_string()
            ))
        );
    }

    #[test]
    fn dsh_keeps_provider_qualified_model_selection() {
        assert_eq!(
            resolve_model_selection("deepseek-official/deepseek-v4-flash", &Value::Null),
            Ok((
                "deepseek-official".to_string(),
                "deepseek-v4-flash".to_string()
            ))
        );
    }

    #[test]
    fn dsh_select_model_omits_absent_reasoning_effort() {
        let payload = dsh_select_model_payload(
            "session-dsh",
            "deepseek-official",
            "deepseek-v4-flash",
            None,
        );
        assert_eq!(payload["sessionId"], "session-dsh");
        assert!(payload.get("reasoningEffort").is_none());

        let payload = dsh_select_model_payload(
            "session-dsh",
            "deepseek-official",
            "deepseek-v4-flash",
            Some("high"),
        );
        assert_eq!(payload["reasoningEffort"], "high");
    }
}
