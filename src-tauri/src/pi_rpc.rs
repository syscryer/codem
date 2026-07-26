use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    fmt,
    path::Path,
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{Child, ChildStdin, Command},
    sync::{mpsc, oneshot, Mutex as AsyncMutex},
    task::JoinHandle,
};

pub const MAX_PI_RPC_LINE_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_PI_STDERR_TAIL_BYTES: usize = 64 * 1024;
const PI_RPC_READ_CHUNK_BYTES: usize = 8 * 1024;
const PI_RPC_COMMAND_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug)]
pub struct PiRpcError {
    message: String,
}

impl PiRpcError {
    fn protocol(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for PiRpcError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for PiRpcError {}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiModel {
    pub id: String,
    pub name: String,
    pub provider: String,
    #[serde(default)]
    pub reasoning: bool,
    #[serde(default)]
    pub input: Vec<String>,
    pub context_window: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiState {
    pub model: Option<PiModel>,
    pub thinking_level: String,
    #[serde(default)]
    pub is_streaming: bool,
    pub session_file: Option<String>,
    pub session_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiImage {
    #[serde(rename = "type")]
    pub kind: String,
    pub data: String,
    pub mime_type: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PiPromptInput {
    pub message: String,
    pub images: Vec<PiImage>,
    pub streaming_behavior: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum PiRuntimeEvent {
    TextDelta(String),
    ThinkingDelta(String),
    ToolStart {
        tool_call_id: String,
        tool_name: String,
        args: Value,
    },
    ToolEnd {
        tool_call_id: String,
        tool_name: String,
        result: Value,
        is_error: bool,
    },
    MessageEnd(Value),
    AgentEnd {
        will_retry: bool,
    },
    AgentSettled,
    ExtensionUiRequest(Value),
    TransportError(String),
    Unknown(Value),
}

pub struct PiJsonlReader<R> {
    reader: R,
    buffer: Vec<u8>,
}

impl<R: AsyncRead + Unpin> PiJsonlReader<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader,
            buffer: Vec::new(),
        }
    }

    pub async fn read_value(&mut self) -> Result<Value, PiRpcError> {
        loop {
            if let Some(newline) = self.buffer.iter().position(|byte| *byte == b'\n') {
                let mut record = self.buffer.drain(..=newline).collect::<Vec<_>>();
                record.pop();
                if record.last() == Some(&b'\r') {
                    record.pop();
                }
                if record.is_empty() {
                    continue;
                }
                return parse_record(&record);
            }
            if self.buffer.len() > MAX_PI_RPC_LINE_BYTES {
                return Err(PiRpcError::protocol("Pi RPC 单条消息过大"));
            }

            let mut chunk = [0_u8; PI_RPC_READ_CHUNK_BYTES];
            let read = self
                .reader
                .read(&mut chunk)
                .await
                .map_err(|error| PiRpcError::protocol(format!("读取 Pi RPC 失败: {error}")))?;
            if read == 0 {
                if self.buffer.is_empty() {
                    return Err(PiRpcError::protocol("Pi RPC 输出已结束"));
                }
                let record = std::mem::take(&mut self.buffer);
                return parse_record(&record);
            }
            self.buffer.extend_from_slice(&chunk[..read]);
        }
    }
}

fn parse_record(record: &[u8]) -> Result<Value, PiRpcError> {
    if record.len() > MAX_PI_RPC_LINE_BYTES {
        return Err(PiRpcError::protocol("Pi RPC 单条消息过大"));
    }
    serde_json::from_slice(record)
        .map_err(|error| PiRpcError::protocol(format!("Pi RPC JSON 无效: {error}")))
}

#[derive(Default)]
pub struct PiResponseRouter {
    pending: HashMap<String, oneshot::Sender<Value>>,
}

impl PiResponseRouter {
    pub fn register(&mut self, id: &str) -> Result<oneshot::Receiver<Value>, PiRpcError> {
        if id.trim().is_empty() {
            return Err(PiRpcError::protocol("Pi RPC 请求 ID 不能为空"));
        }
        let (sender, receiver) = oneshot::channel();
        if self.pending.insert(id.to_string(), sender).is_some() {
            return Err(PiRpcError::protocol("Pi RPC 请求 ID 重复"));
        }
        Ok(receiver)
    }

    pub fn route(&mut self, value: Value) -> Result<Option<Value>, PiRpcError> {
        if value.get("type").and_then(Value::as_str) != Some("response") {
            return Ok(Some(value));
        }
        let id = value
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| PiRpcError::protocol("Pi RPC response 缺少请求 ID"))?;
        let sender = self
            .pending
            .remove(id)
            .ok_or_else(|| PiRpcError::protocol(format!("Pi RPC response 请求 ID 未知: {id}")))?;
        sender
            .send(value)
            .map_err(|_| PiRpcError::protocol("Pi RPC response 接收端已关闭"))?;
        Ok(None)
    }
}

pub struct PiStdioClient {
    child: Child,
    stdin: Arc<AsyncMutex<ChildStdin>>,
    router: Arc<Mutex<PiResponseRouter>>,
    events: mpsc::UnboundedReceiver<Value>,
    stderr_tail: Arc<Mutex<Vec<u8>>>,
    stdout_task: JoinHandle<()>,
    stderr_task: JoinHandle<()>,
    next_request_id: AtomicU64,
}

impl PiStdioClient {
    pub async fn spawn_with_options(
        program: &str,
        cwd: &Path,
        environment: &BTreeMap<String, String>,
        arguments: &[String],
    ) -> Result<Self, PiRpcError> {
        let mut command = Command::new(program);
        command
            .args(arguments)
            .current_dir(cwd)
            .envs(environment)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        {
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|error| PiRpcError::protocol(format!("无法启动 Pi RPC 子进程: {error}")))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| PiRpcError::protocol("Pi RPC stdin 不可用"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| PiRpcError::protocol("Pi RPC stdout 不可用"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| PiRpcError::protocol("Pi RPC stderr 不可用"))?;

        let router = Arc::new(Mutex::new(PiResponseRouter::default()));
        let (event_sender, events) = mpsc::unbounded_channel();
        let stdout_router = Arc::clone(&router);
        let stdout_task = tokio::spawn(async move {
            let mut reader = PiJsonlReader::new(stdout);
            loop {
                match reader.read_value().await {
                    Ok(value) => {
                        let routed = stdout_router
                            .lock()
                            .map_err(|_| PiRpcError::protocol("Pi RPC 路由锁已损坏"))
                            .and_then(|mut router| router.route(value));
                        match routed {
                            Ok(Some(event)) => {
                                if event_sender.send(event).is_err() {
                                    break;
                                }
                            }
                            Ok(None) => {}
                            Err(error) => {
                                let _ = event_sender.send(json!({
                                    "type": "codem_transport_error",
                                    "message": error.to_string(),
                                }));
                                break;
                            }
                        }
                    }
                    Err(error) => {
                        let _ = event_sender.send(json!({
                            "type": "codem_transport_error",
                            "message": error.to_string(),
                        }));
                        break;
                    }
                }
            }
        });

        let stderr_tail = Arc::new(Mutex::new(Vec::new()));
        let task_tail = Arc::clone(&stderr_tail);
        let stderr_task = tokio::spawn(async move {
            let mut stderr = stderr;
            let mut chunk = [0_u8; PI_RPC_READ_CHUNK_BYTES];
            while let Ok(read) = stderr.read(&mut chunk).await {
                if read == 0 {
                    break;
                }
                if let Ok(mut tail) = task_tail.lock() {
                    tail.extend_from_slice(&chunk[..read]);
                    if tail.len() > MAX_PI_STDERR_TAIL_BYTES {
                        let excess = tail.len() - MAX_PI_STDERR_TAIL_BYTES;
                        tail.drain(..excess);
                    }
                }
            }
        });

        Ok(Self {
            child,
            stdin: Arc::new(AsyncMutex::new(stdin)),
            router,
            events,
            stderr_tail,
            stdout_task,
            stderr_task,
            next_request_id: AtomicU64::new(1),
        })
    }

    async fn send_command(&self, mut command: Value) -> Result<Value, PiRpcError> {
        let id = format!(
            "codem-pi-{}",
            self.next_request_id.fetch_add(1, Ordering::Relaxed)
        );
        command["id"] = Value::String(id.clone());
        let receiver = self
            .router
            .lock()
            .map_err(|_| PiRpcError::protocol("Pi RPC 路由锁已损坏"))?
            .register(&id)?;
        self.write_value(&command).await?;
        let response = tokio::time::timeout(PI_RPC_COMMAND_TIMEOUT, receiver)
            .await
            .map_err(|_| PiRpcError::protocol("Pi RPC 命令响应超时"))?
            .map_err(|_| PiRpcError::protocol("Pi RPC 命令响应通道已关闭"))?;
        if response.get("success").and_then(Value::as_bool) != Some(true) {
            let message = response
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Pi RPC 命令失败");
            return Err(PiRpcError::protocol(message));
        }
        Ok(response.get("data").cloned().unwrap_or(Value::Null))
    }

    async fn write_value(&self, value: &Value) -> Result<(), PiRpcError> {
        let mut encoded = serde_json::to_vec(value)
            .map_err(|error| PiRpcError::protocol(format!("编码 Pi RPC 命令失败: {error}")))?;
        encoded.push(b'\n');
        self.stdin
            .lock()
            .await
            .write_all(&encoded)
            .await
            .map_err(|error| PiRpcError::protocol(format!("写入 Pi RPC 命令失败: {error}")))
    }

    pub async fn get_state(&self) -> Result<PiState, PiRpcError> {
        decode_data(
            self.send_command(json!({"type": "get_state"})).await?,
            "state",
        )
    }

    pub async fn get_available_models(&self) -> Result<Vec<PiModel>, PiRpcError> {
        #[derive(Deserialize)]
        struct Models {
            models: Vec<PiModel>,
        }
        Ok(decode_data::<Models>(
            self.send_command(json!({"type": "get_available_models"}))
                .await?,
            "models",
        )?
        .models)
    }

    pub async fn get_available_thinking_levels(&self) -> Result<Vec<String>, PiRpcError> {
        #[derive(Deserialize)]
        struct Levels {
            levels: Vec<String>,
        }
        Ok(decode_data::<Levels>(
            self.send_command(json!({"type": "get_available_thinking_levels"}))
                .await?,
            "thinking levels",
        )?
        .levels)
    }

    pub async fn set_model(&self, provider: &str, model_id: &str) -> Result<(), PiRpcError> {
        self.send_command(json!({
            "type": "set_model",
            "provider": provider,
            "modelId": model_id,
        }))
        .await?;
        Ok(())
    }

    pub async fn set_thinking_level(&self, level: &str) -> Result<(), PiRpcError> {
        self.send_command(json!({
            "type": "set_thinking_level",
            "level": level,
        }))
        .await?;
        Ok(())
    }

    pub async fn prompt(&self, input: PiPromptInput) -> Result<(), PiRpcError> {
        self.send_command(pi_prompt_command("prompt", input))
            .await?;
        Ok(())
    }

    pub async fn steer(&self, input: PiPromptInput) -> Result<(), PiRpcError> {
        self.send_command(pi_prompt_command("steer", input)).await?;
        Ok(())
    }

    pub async fn follow_up(&self, input: PiPromptInput) -> Result<(), PiRpcError> {
        self.send_command(pi_prompt_command("follow_up", input))
            .await?;
        Ok(())
    }

    pub async fn extension_ui_response(&self, response: Value) -> Result<(), PiRpcError> {
        if response.get("type").and_then(Value::as_str) != Some("extension_ui_response")
            || response.get("id").and_then(Value::as_str).is_none()
        {
            return Err(PiRpcError::protocol(
                "Pi Extension UI response 缺少类型或请求 ID",
            ));
        }
        self.write_value(&response).await
    }

    pub async fn get_session_stats(&self) -> Result<Value, PiRpcError> {
        self.send_command(json!({"type": "get_session_stats"}))
            .await
    }

    pub async fn prompt_with_behavior(
        &self,
        mut input: PiPromptInput,
        behavior: &str,
    ) -> Result<(), PiRpcError> {
        input.streaming_behavior = Some(behavior.to_string());
        let command = pi_prompt_command("prompt", input);
        self.send_command(command).await?;
        Ok(())
    }

    pub async fn abort(&self) -> Result<(), PiRpcError> {
        self.send_command(json!({"type": "abort"})).await?;
        Ok(())
    }

    pub async fn next_event(&mut self) -> Result<PiRuntimeEvent, PiRpcError> {
        let value = self
            .events
            .recv()
            .await
            .ok_or_else(|| PiRpcError::protocol("Pi RPC 事件流已关闭"))?;
        Ok(parse_runtime_event(value))
    }

    pub fn is_running(&mut self) -> bool {
        self.child.try_wait().ok().flatten().is_none()
    }

    pub fn stderr_tail(&self) -> String {
        self.stderr_tail
            .lock()
            .map(|tail| String::from_utf8_lossy(&tail).into_owned())
            .unwrap_or_default()
    }

    pub async fn shutdown(mut self) {
        if self.is_running() {
            let _ = self.child.kill().await;
        }
        let _ = self.child.wait().await;
        self.stdout_task.abort();
        self.stderr_task.abort();
    }
}

fn pi_prompt_command(command_type: &str, input: PiPromptInput) -> Value {
    let mut command = json!({
        "type": command_type,
        "message": input.message,
        "images": input.images,
    });
    if let Some(behavior) = input.streaming_behavior {
        command["streamingBehavior"] = Value::String(behavior);
    }
    command
}

fn decode_data<T: for<'de> Deserialize<'de>>(value: Value, label: &str) -> Result<T, PiRpcError> {
    serde_json::from_value(value)
        .map_err(|error| PiRpcError::protocol(format!("Pi RPC {label} 无效: {error}")))
}

fn parse_runtime_event(value: Value) -> PiRuntimeEvent {
    match value.get("type").and_then(Value::as_str) {
        Some("message_update") => match value
            .get("assistantMessageEvent")
            .and_then(|event| event.get("type"))
            .and_then(Value::as_str)
        {
            Some("text_delta") => value
                .get("assistantMessageEvent")
                .and_then(|event| event.get("delta"))
                .and_then(Value::as_str)
                .map(|text| PiRuntimeEvent::TextDelta(text.to_string()))
                .unwrap_or(PiRuntimeEvent::Unknown(value)),
            Some("thinking_delta") => value
                .get("assistantMessageEvent")
                .and_then(|event| event.get("delta"))
                .and_then(Value::as_str)
                .map(|text| PiRuntimeEvent::ThinkingDelta(text.to_string()))
                .unwrap_or(PiRuntimeEvent::Unknown(value)),
            _ => PiRuntimeEvent::Unknown(value),
        },
        Some("agent_settled") => PiRuntimeEvent::AgentSettled,
        Some("tool_execution_start") => {
            let tool_call_id = value
                .get("toolCallId")
                .and_then(Value::as_str)
                .map(str::to_string);
            let tool_name = value
                .get("toolName")
                .and_then(Value::as_str)
                .map(str::to_string);
            match (tool_call_id, tool_name) {
                (Some(tool_call_id), Some(tool_name)) => PiRuntimeEvent::ToolStart {
                    tool_call_id,
                    tool_name,
                    args: value.get("args").cloned().unwrap_or(Value::Null),
                },
                _ => PiRuntimeEvent::Unknown(value),
            }
        }
        Some("tool_execution_end") => {
            let tool_call_id = value
                .get("toolCallId")
                .and_then(Value::as_str)
                .map(str::to_string);
            let tool_name = value
                .get("toolName")
                .and_then(Value::as_str)
                .map(str::to_string);
            match (tool_call_id, tool_name) {
                (Some(tool_call_id), Some(tool_name)) => PiRuntimeEvent::ToolEnd {
                    tool_call_id,
                    tool_name,
                    result: value.get("result").cloned().unwrap_or(Value::Null),
                    is_error: value
                        .get("isError")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                },
                _ => PiRuntimeEvent::Unknown(value),
            }
        }
        Some("message_end") => value
            .get("message")
            .cloned()
            .map(PiRuntimeEvent::MessageEnd)
            .unwrap_or(PiRuntimeEvent::Unknown(value)),
        Some("agent_end") => PiRuntimeEvent::AgentEnd {
            will_retry: value
                .get("willRetry")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        },
        Some("extension_ui_request") => PiRuntimeEvent::ExtensionUiRequest(value),
        Some("codem_transport_error") => PiRuntimeEvent::TransportError(
            value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Pi RPC 传输失败")
                .to_string(),
        ),
        _ => PiRuntimeEvent::Unknown(value),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        PiJsonlReader, PiPromptInput, PiResponseRouter, PiRuntimeEvent, PiStdioClient,
        MAX_PI_RPC_LINE_BYTES,
    };
    use serde_json::json;
    use std::{collections::BTreeMap, fs};
    use tokio::io::{duplex, AsyncWriteExt};

    #[tokio::test]
    async fn pi_jsonl_reader_handles_fragmented_lf_records_and_unicode_separators() {
        let (mut writer, reader) = duplex(256);
        let write = tokio::spawn(async move {
            writer
                .write_all("{\"type\":\"event\",\"text\":\"a\u{2028}".as_bytes())
                .await
                .unwrap();
            tokio::task::yield_now().await;
            writer
                .write_all("b\"}\n{\"type\":\"event\",\"text\":\"c\"}\r\n".as_bytes())
                .await
                .unwrap();
        });
        let mut reader = PiJsonlReader::new(reader);

        assert_eq!(
            reader.read_value().await.unwrap(),
            json!({"type": "event", "text": "a\u{2028}b"})
        );
        assert_eq!(
            reader.read_value().await.unwrap(),
            json!({"type": "event", "text": "c"})
        );
        write.await.unwrap();
    }

    #[tokio::test]
    async fn pi_jsonl_reader_rejects_invalid_and_oversized_records() {
        let invalid = b"{not-json}\n";
        let mut reader = PiJsonlReader::new(&invalid[..]);
        assert!(reader
            .read_value()
            .await
            .unwrap_err()
            .to_string()
            .contains("JSON"));

        let oversized = format!("{{\"value\":\"{}\"}}\n", "x".repeat(MAX_PI_RPC_LINE_BYTES));
        let mut reader = PiJsonlReader::new(oversized.as_bytes());
        assert!(reader
            .read_value()
            .await
            .unwrap_err()
            .to_string()
            .contains("过大"));
    }

    #[tokio::test]
    async fn pi_response_router_correlates_out_of_order_responses_and_keeps_events() {
        let mut router = PiResponseRouter::default();
        let first = router.register("req-1").unwrap();
        let second = router.register("req-2").unwrap();

        let event = json!({"type": "message_update", "delta": "hello"});
        assert_eq!(router.route(event.clone()).unwrap(), Some(event));
        assert_eq!(
            router
                .route(json!({
                    "id": "req-2",
                    "type": "response",
                    "command": "get_state",
                    "success": true
                }))
                .unwrap(),
            None
        );
        assert_eq!(
            router
                .route(json!({
                    "id": "req-1",
                    "type": "response",
                    "command": "get_available_models",
                    "success": true
                }))
                .unwrap(),
            None
        );

        assert_eq!(second.await.unwrap()["id"], "req-2");
        assert_eq!(first.await.unwrap()["id"], "req-1");
    }

    #[test]
    fn pi_runtime_event_parser_keeps_tool_and_message_lifecycle() {
        assert_eq!(
            super::parse_runtime_event(json!({
                "type": "tool_execution_start",
                "toolCallId": "tool-1",
                "toolName": "bash",
                "args": {"command": "pwd"}
            })),
            PiRuntimeEvent::ToolStart {
                tool_call_id: "tool-1".to_string(),
                tool_name: "bash".to_string(),
                args: json!({"command": "pwd"}),
            }
        );
        assert_eq!(
            super::parse_runtime_event(json!({
                "type": "tool_execution_end",
                "toolCallId": "tool-1",
                "toolName": "bash",
                "result": {"content": [{"type": "text", "text": "ok"}]},
                "isError": false
            })),
            PiRuntimeEvent::ToolEnd {
                tool_call_id: "tool-1".to_string(),
                tool_name: "bash".to_string(),
                result: json!({"content": [{"type": "text", "text": "ok"}]}),
                is_error: false,
            }
        );
        let message = json!({"role": "assistant", "stopReason": "stop"});
        assert_eq!(
            super::parse_runtime_event(json!({
                "type": "message_end",
                "message": message.clone()
            })),
            PiRuntimeEvent::MessageEnd(message)
        );
        assert_eq!(
            super::parse_runtime_event(json!({
                "type": "agent_end",
                "messages": [],
                "willRetry": true
            })),
            PiRuntimeEvent::AgentEnd { will_retry: true }
        );
    }

    #[tokio::test]
    async fn client_reads_state_models_thinking_and_stream_events() {
        let root = std::env::temp_dir().join(format!("codem-pi-rpc-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let script = root.join("fake-pi.mjs");
        fs::write(
            &script,
            r#"
import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const command = JSON.parse(line);
  const response = (data = undefined) => {
    const value = { id: command.id, type: 'response', command: command.type, success: true };
    if (data !== undefined) value.data = data;
    process.stdout.write(JSON.stringify(value) + '\n');
  };
  if (command.type === 'get_state') {
    response({
      model: { id: 'model-1', name: 'Model One', provider: 'openai', reasoning: true, input: ['text', 'image'], contextWindow: 200000 },
      thinkingLevel: 'high',
      isStreaming: false,
      sessionFile: '/tmp/session.jsonl',
      sessionId: 'session-1'
    });
  } else if (command.type === 'get_available_models') {
    response({ models: [
      { id: 'model-1', name: 'Model One', provider: 'openai', reasoning: true, input: ['text', 'image'], contextWindow: 200000 }
    ]});
  } else if (command.type === 'get_available_thinking_levels') {
    response({ levels: ['off', 'high'] });
  } else if (command.type === 'get_session_stats') {
    response({ totalMessages: 2, cost: 0.1 });
  } else if (command.type === 'extension_ui_response') {
    continue;
  } else if (command.type === 'prompt') {
    response();
    process.stdout.write(JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'reasoning' }
    }) + '\n');
    process.stdout.write(JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'hello' }
    }) + '\n');
    process.stdout.write(JSON.stringify({ type: 'agent_settled' }) + '\n');
  } else {
    response();
  }
}
"#,
        )
        .unwrap();

        let mut client = PiStdioClient::spawn_with_options(
            "node",
            &root,
            &BTreeMap::new(),
            &[script.to_string_lossy().to_string()],
        )
        .await
        .unwrap();
        let state = client.get_state().await.unwrap();
        assert_eq!(state.session_id, "session-1");
        assert_eq!(state.thinking_level, "high");
        assert_eq!(
            state.model.as_ref().map(|model| model.id.as_str()),
            Some("model-1")
        );
        assert_eq!(
            client.get_available_models().await.unwrap()[0].provider,
            "openai"
        );
        assert_eq!(
            client.get_available_thinking_levels().await.unwrap(),
            vec!["off", "high"]
        );
        client.set_model("openai", "model-1").await.unwrap();
        client.set_thinking_level("high").await.unwrap();
        client
            .prompt(PiPromptInput {
                message: "hello".to_string(),
                images: Vec::new(),
                streaming_behavior: None,
            })
            .await
            .unwrap();
        assert_eq!(
            client.next_event().await.unwrap(),
            PiRuntimeEvent::ThinkingDelta("reasoning".to_string())
        );
        assert_eq!(
            client.next_event().await.unwrap(),
            PiRuntimeEvent::TextDelta("hello".to_string())
        );
        assert_eq!(
            client.next_event().await.unwrap(),
            PiRuntimeEvent::AgentSettled
        );
        client
            .steer(PiPromptInput {
                message: "steer".to_string(),
                images: Vec::new(),
                streaming_behavior: None,
            })
            .await
            .unwrap();
        client
            .follow_up(PiPromptInput {
                message: "follow".to_string(),
                images: Vec::new(),
                streaming_behavior: None,
            })
            .await
            .unwrap();
        client
            .extension_ui_response(json!({
                "type": "extension_ui_response",
                "id": "ui-1",
                "confirmed": true,
            }))
            .await
            .unwrap();
        assert_eq!(
            client.get_session_stats().await.unwrap()["totalMessages"],
            2
        );
        client.abort().await.unwrap();
        client.shutdown().await;
        fs::remove_dir_all(root).unwrap();
    }
}
