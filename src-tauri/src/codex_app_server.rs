use crate::agent_runtime::{
    AgentApprovalOption, AgentApprovalRequest, AgentControlCommand, AgentPermissionDecision,
    AgentUsageSnapshot, AgentUserInputOption, AgentUserInputQuestion, AgentUserInputRequest,
};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fmt,
    path::Path,
    process::Stdio,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{mpsc, oneshot, watch},
    task::JoinHandle,
    time::{sleep, timeout},
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const TURN_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const COMPACT_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_EVENT_TEXT_BYTES: usize = 256 * 1024;
const MAX_JSON_STRING_BYTES: usize = 8 * 1024;
const MAX_JSON_ARRAY_ITEMS: usize = 32;
const MAX_JSON_OBJECT_FIELDS: usize = 64;
const MAX_JSON_DEPTH: usize = 6;

#[derive(Debug)]
pub enum CodexAppServerError {
    Io(std::io::Error),
    Json(serde_json::Error),
    Rpc {
        code: i64,
        message: String,
    },
    Execution(String),
    Protocol(String),
    Timeout(&'static str),
    ForkHistory {
        provider_thread_id: String,
        source: Box<CodexAppServerError>,
    },
}

impl CodexAppServerError {
    pub fn public_message(&self) -> String {
        match self {
            Self::Io(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                "Codex CLI 无法由 CodeM 启动，请安装独立 CLI 或设置 CODEX_CLI_PATH".to_string()
            }
            Self::Io(_) => "Codex App Server 子进程通信失败".to_string(),
            Self::Json(_) => "Codex App Server 返回了无效 JSON".to_string(),
            Self::Rpc { message, .. } => bounded_string(message, MAX_JSON_STRING_BYTES),
            Self::Execution(message) => bounded_string(message, MAX_JSON_STRING_BYTES),
            Self::Protocol(_) => "Codex App Server 返回了不兼容的协议消息".to_string(),
            Self::Timeout(operation) => format!("Codex App Server 响应超时：{operation}"),
            Self::ForkHistory {
                provider_thread_id,
                source,
            } => format!(
                "Codex 已创建新聊天 {provider_thread_id}，但读取历史失败：{}",
                source.public_message()
            ),
        }
    }
}

impl fmt::Display for CodexAppServerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "Codex App Server I/O error: {error}"),
            Self::Json(error) => write!(formatter, "Codex App Server JSON error: {error}"),
            Self::Rpc { code, message } => {
                write!(formatter, "Codex App Server RPC error {code}: {message}")
            }
            Self::Execution(message) => write!(formatter, "Codex turn failed: {message}"),
            Self::Protocol(message) => {
                write!(formatter, "Codex App Server protocol error: {message}")
            }
            Self::Timeout(operation) => write!(formatter, "Codex App Server timeout: {operation}"),
            Self::ForkHistory {
                provider_thread_id,
                source,
            } => write!(
                formatter,
                "Codex fork {provider_thread_id} history read failed: {source}"
            ),
        }
    }
}

impl std::error::Error for CodexAppServerError {}

impl From<std::io::Error> for CodexAppServerError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for CodexAppServerError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexProbeSummary {
    pub authenticated: bool,
    pub auth_mode: Option<String>,
    pub requires_openai_auth: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexReasoningEffortSummary {
    pub id: String,
    pub description: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexModelSummary {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
    pub is_default: bool,
    pub default_reasoning_effort: Option<String>,
    pub supported_reasoning_efforts: Vec<CodexReasoningEffortSummary>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CodexTurnPolicy {
    pub approval_policy: &'static str,
    pub sandbox_policy: Value,
}

pub fn codex_turn_policy(permission_mode: &str, cwd: &Path) -> Option<CodexTurnPolicy> {
    let workspace_write = || {
        json!({
            "type": "workspaceWrite",
            "writableRoots": [cwd.to_string_lossy()],
            "networkAccess": false,
        })
    };
    match permission_mode {
        "default" => Some(CodexTurnPolicy {
            approval_policy: "untrusted",
            sandbox_policy: workspace_write(),
        }),
        "auto" => Some(CodexTurnPolicy {
            approval_policy: "on-request",
            sandbox_policy: workspace_write(),
        }),
        "bypassPermissions" => Some(CodexTurnPolicy {
            approval_policy: "never",
            sandbox_policy: json!({ "type": "dangerFullAccess" }),
        }),
        _ => None,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum CodexRuntimeEvent {
    Status {
        message: String,
    },
    Thinking,
    TextDelta {
        text: String,
    },
    Usage {
        usage: AgentUsageSnapshot,
    },
    ToolStarted {
        tool_id: String,
        name: String,
        input: Option<Value>,
    },
    ToolCompleted {
        tool_id: String,
        content: String,
        is_error: bool,
    },
    ApprovalRequest {
        request: AgentApprovalRequest,
    },
    UserInputRequest {
        request: AgentUserInputRequest,
    },
    InteractionResolved {
        request_id: String,
    },
    CompactionStarted {
        provider_turn_id: Option<String>,
        provider_item_id: Option<String>,
    },
    CompactionCompleted {
        provider_turn_id: String,
        provider_item_id: Option<String>,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct CodexTurnOutcome {
    pub stop_reason: String,
    pub text: String,
    pub text_truncated: bool,
    pub cancel_sent: bool,
    pub usage: AgentUsageSnapshot,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CodexCompactCapability {
    Supported,
    Unsupported,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CodexForkCapability {
    Supported,
    Unsupported,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CodexForkOutcome {
    pub provider_thread_id: String,
    pub forked_from_id: Option<String>,
    pub turns: Vec<CodexStoredTurn>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CodexStoredTurn {
    pub id: String,
    pub status: String,
    pub items: Vec<CodexStoredItem>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum CodexStoredItem {
    UserMessage {
        id: String,
        content: Vec<CodexUserInput>,
    },
    AgentMessage {
        id: String,
        text: String,
    },
    Tool {
        id: String,
        name: String,
        input: Option<Value>,
        result: String,
        is_error: bool,
    },
    ContextCompaction {
        id: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CodexCompactionEvent {
    Started {
        provider_turn_id: Option<String>,
        provider_item_id: Option<String>,
    },
    Completed {
        provider_turn_id: String,
        provider_item_id: Option<String>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CodexCompactionOutcome {
    pub provider_thread_id: String,
    pub provider_turn_id: String,
    pub provider_item_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CodexCompactionHistoryState {
    Confirmed(CodexCompactionOutcome),
    Unconfirmed,
    NotFound,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "type")]
pub enum CodexUserInput {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image { url: String },
    #[serde(rename = "localImage")]
    LocalImage { path: String },
}

#[derive(Debug)]
enum CodexMessage {
    Response {
        id: Value,
        result: Option<Value>,
        error: Option<CodexRpcError>,
    },
    Request {
        id: Value,
        method: String,
        params: Value,
    },
    Notification {
        method: String,
        params: Value,
    },
}

#[derive(Debug)]
struct CodexRpcError {
    code: i64,
    message: String,
}

#[derive(Clone, Debug)]
enum PendingInteractionKind {
    Permission { params: Value },
    UserInput,
}

#[derive(Clone, Debug)]
struct PendingInteraction {
    rpc_id: Value,
    method: String,
    kind: PendingInteractionKind,
}

#[derive(Debug)]
enum CodexTurnTerminal {
    Completed,
    Interrupted,
    Failed(String),
}

#[derive(Default)]
struct RuntimeCompactionState {
    provider_turn_id: Option<String>,
    provider_item_id: Option<String>,
    item_completed: bool,
    started_emitted: bool,
}

pub struct CodexConnection<R, W> {
    lines: Lines<BufReader<R>>,
    writer: W,
    next_request_id: u64,
}

impl<R, W> CodexConnection<R, W>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    pub fn new(reader: R, writer: W) -> Self {
        Self {
            lines: BufReader::new(reader).lines(),
            writer,
            next_request_id: 1,
        }
    }

    pub async fn initialize(&mut self, client_version: &str) -> Result<(), CodexAppServerError> {
        self.request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "codem",
                    "title": "CodeM",
                    "version": client_version,
                },
                "capabilities": {
                    "experimentalApi": true,
                },
            }),
            REQUEST_TIMEOUT,
        )
        .await?;
        self.send_notification("initialized", json!({})).await
    }

    pub async fn account_summary(&mut self) -> Result<CodexProbeSummary, CodexAppServerError> {
        let result = self
            .request(
                "account/read",
                json!({ "refreshToken": false }),
                REQUEST_TIMEOUT,
            )
            .await?;
        let requires_openai_auth = result
            .get("requiresOpenaiAuth")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let account = result.get("account").filter(|value| !value.is_null());
        let auth_mode = account
            .and_then(|value| value.get("type"))
            .and_then(Value::as_str)
            .map(ToString::to_string);
        Ok(CodexProbeSummary {
            authenticated: account.is_some() || !requires_openai_auth,
            auth_mode,
            requires_openai_auth,
        })
    }

    pub async fn probe_compact_capability(
        &mut self,
    ) -> Result<CodexCompactCapability, CodexAppServerError> {
        match self
            .request("thread/compact/start", json!({}), REQUEST_TIMEOUT)
            .await
        {
            Err(CodexAppServerError::Rpc { code: -32602, .. }) => {
                Ok(CodexCompactCapability::Supported)
            }
            Err(CodexAppServerError::Rpc {
                code: -32600,
                message,
            }) if message.contains("missing field") && message.contains("threadId") => {
                Ok(CodexCompactCapability::Supported)
            }
            Err(CodexAppServerError::Rpc { code: -32601, .. }) => {
                Ok(CodexCompactCapability::Unsupported)
            }
            Ok(_) => Err(CodexAppServerError::Protocol(
                "thread/compact/start 缺少 threadId 时意外成功".to_string(),
            )),
            Err(error) => Err(error),
        }
    }

    pub async fn probe_fork_capability(
        &mut self,
    ) -> Result<CodexForkCapability, CodexAppServerError> {
        match self
            .request("thread/fork", json!({}), REQUEST_TIMEOUT)
            .await
        {
            Err(CodexAppServerError::Rpc { code: -32602, .. }) => {
                Ok(CodexForkCapability::Supported)
            }
            Err(CodexAppServerError::Rpc {
                code: -32600,
                message,
            }) if message.contains("missing field") && message.contains("threadId") => {
                Ok(CodexForkCapability::Supported)
            }
            Err(CodexAppServerError::Rpc { code: -32601, .. }) => {
                Ok(CodexForkCapability::Unsupported)
            }
            Ok(_) => Err(CodexAppServerError::Protocol(
                "thread/fork 缺少 threadId 时意外成功".to_string(),
            )),
            Err(error) => Err(error),
        }
    }

    pub async fn read_thread_snapshot(
        &mut self,
        thread_id: &str,
    ) -> Result<Vec<CodexStoredTurn>, CodexAppServerError> {
        let result = self
            .request(
                "thread/read",
                json!({
                    "threadId": thread_id,
                    "includeTurns": true,
                }),
                REQUEST_TIMEOUT,
            )
            .await?;
        parse_thread_snapshot(&result, thread_id)
    }

    pub async fn fork_thread_snapshot(
        &mut self,
        source_thread_id: &str,
    ) -> Result<CodexForkOutcome, CodexAppServerError> {
        let source_result = self
            .request(
                "thread/read",
                json!({
                    "threadId": source_thread_id,
                    "includeTurns": false,
                }),
                REQUEST_TIMEOUT,
            )
            .await?;
        let source_thread = checked_thread(&source_result, source_thread_id, "thread/read")?;
        if source_thread
            .get("status")
            .and_then(|status| status.get("type"))
            .and_then(Value::as_str)
            == Some("active")
        {
            return Err(CodexAppServerError::Execution(
                "Codex 源聊天正在运行中，暂时不能在新聊天中继续".to_string(),
            ));
        }

        let fork_result = self
            .request(
                "thread/fork",
                json!({ "threadId": source_thread_id }),
                REQUEST_TIMEOUT,
            )
            .await?;
        let fork_thread = fork_result.get("thread").ok_or_else(|| {
            CodexAppServerError::Protocol("thread/fork 响应缺少 thread".to_string())
        })?;
        let provider_thread_id =
            optional_non_empty_string(fork_thread.get("id")).ok_or_else(|| {
                CodexAppServerError::Protocol("thread/fork 响应缺少有效 thread.id".to_string())
            })?;
        if provider_thread_id == source_thread_id {
            return Err(CodexAppServerError::Protocol(
                "thread/fork 返回了源 thread.id".to_string(),
            ));
        }
        let forked_from_id = optional_non_empty_string(fork_thread.get("forkedFromId"));
        let turns = self
            .read_thread_snapshot(&provider_thread_id)
            .await
            .map_err(|source| CodexAppServerError::ForkHistory {
                provider_thread_id: provider_thread_id.clone(),
                source: Box::new(source),
            })?;

        Ok(CodexForkOutcome {
            provider_thread_id,
            forked_from_id,
            turns,
        })
    }

    pub async fn find_fork_candidates(
        &mut self,
        source_thread_id: &str,
        started_at_seconds: i64,
    ) -> Result<Vec<String>, CodexAppServerError> {
        const SOURCE_KINDS: [&str; 10] = [
            "cli",
            "vscode",
            "exec",
            "appServer",
            "subAgent",
            "subAgentReview",
            "subAgentCompact",
            "subAgentThreadSpawn",
            "subAgentOther",
            "unknown",
        ];
        const CLOCK_SKEW_SECONDS: i64 = 5;

        let latest_created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|duration| i64::try_from(duration.as_secs()).ok())
            .unwrap_or(i64::MAX)
            .saturating_add(CLOCK_SKEW_SECONDS);
        let earliest_created_at = started_at_seconds.saturating_sub(CLOCK_SKEW_SECONDS);
        let mut candidates = Vec::new();
        let mut seen_thread_ids = HashSet::new();
        let mut seen_cursors = HashSet::new();
        let mut cursor = None::<String>;

        for _ in 0..100 {
            let result = self
                .request(
                    "thread/list",
                    json!({
                        "cursor": cursor,
                        "limit": 100,
                        "sortKey": "created_at",
                        "sortDirection": "desc",
                        "sourceKinds": SOURCE_KINDS,
                        "archived": false,
                    }),
                    REQUEST_TIMEOUT,
                )
                .await?;
            let page = result
                .get("data")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    CodexAppServerError::Protocol("thread/list 响应缺少 data".to_string())
                })?;
            for thread in page {
                if thread.get("forkedFromId").and_then(Value::as_str) != Some(source_thread_id)
                    || thread
                        .get("ephemeral")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                {
                    continue;
                }
                let Some(created_at) = thread.get("createdAt").and_then(Value::as_i64) else {
                    continue;
                };
                if created_at < earliest_created_at || created_at > latest_created_at {
                    continue;
                }
                let Some(thread_id) = optional_non_empty_string(thread.get("id")) else {
                    continue;
                };
                if thread_id != source_thread_id && seen_thread_ids.insert(thread_id.clone()) {
                    candidates.push(thread_id);
                }
            }

            let next_cursor = optional_non_empty_string(result.get("nextCursor"));
            let Some(next_cursor) = next_cursor else {
                return Ok(candidates);
            };
            if !seen_cursors.insert(next_cursor.clone()) {
                return Err(CodexAppServerError::Protocol(
                    "thread/list 返回了重复游标".to_string(),
                ));
            }
            cursor = Some(next_cursor);
        }

        Err(CodexAppServerError::Protocol(
            "thread/list 分页超过安全上限".to_string(),
        ))
    }

    pub async fn list_models(&mut self) -> Result<Vec<CodexModelSummary>, CodexAppServerError> {
        let mut models = Vec::new();
        let mut seen_model_ids = HashSet::new();
        let mut seen_cursors = HashSet::new();
        let mut cursor = None::<String>;

        for _ in 0..100 {
            let result = self
                .request(
                    "model/list",
                    json!({
                        "cursor": cursor,
                        "includeHidden": false,
                        "limit": 100,
                    }),
                    REQUEST_TIMEOUT,
                )
                .await?;
            let page = result
                .get("data")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    CodexAppServerError::Protocol("model/list 响应缺少 data".to_string())
                })?;
            for value in page {
                let Some(model) = summarize_model(value) else {
                    continue;
                };
                if seen_model_ids.insert(model.id.clone()) {
                    models.push(model);
                }
            }

            let next_cursor = optional_non_empty_string(result.get("nextCursor"));
            let Some(next_cursor) = next_cursor else {
                return Ok(models);
            };
            if !seen_cursors.insert(next_cursor.clone()) {
                return Err(CodexAppServerError::Protocol(
                    "model/list 返回了重复游标".to_string(),
                ));
            }
            cursor = Some(next_cursor);
        }

        Err(CodexAppServerError::Protocol(
            "model/list 分页超过安全上限".to_string(),
        ))
    }

    pub async fn start_or_resume_thread(
        &mut self,
        requested_thread_id: Option<&str>,
        cwd: &Path,
    ) -> Result<String, CodexAppServerError> {
        let (method, params) = if let Some(thread_id) = requested_thread_id {
            (
                "thread/resume",
                json!({
                    "threadId": thread_id,
                    "cwd": cwd.to_string_lossy(),
                }),
            )
        } else {
            (
                "thread/start",
                json!({
                    "cwd": cwd.to_string_lossy(),
                    "serviceName": "codem",
                }),
            )
        };
        let result = self.request(method, params, REQUEST_TIMEOUT).await?;
        result
            .get("thread")
            .and_then(|thread| thread.get("id"))
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .ok_or_else(|| CodexAppServerError::Protocol(format!("{method} 响应缺少 thread.id")))
    }

    pub async fn run_text_turn<F>(
        &mut self,
        thread_id: &str,
        cwd: &Path,
        text: &str,
        permission_mode: &str,
        model: Option<&str>,
        reasoning_effort: Option<&str>,
        cancel: watch::Receiver<bool>,
        control: &mut mpsc::UnboundedReceiver<AgentControlCommand>,
        on_event: F,
    ) -> Result<CodexTurnOutcome, CodexAppServerError>
    where
        F: FnMut(CodexRuntimeEvent),
    {
        let input = [CodexUserInput::Text {
            text: text.to_string(),
        }];
        self.run_turn(
            thread_id,
            cwd,
            &input,
            permission_mode,
            model,
            reasoning_effort,
            cancel,
            control,
            on_event,
        )
        .await
    }

    pub async fn start_compaction<F>(
        &mut self,
        thread_id: &str,
        mut on_event: F,
    ) -> Result<CodexCompactionOutcome, CodexAppServerError>
    where
        F: FnMut(CodexCompactionEvent),
    {
        let request_id = self
            .send_request(
                "thread/compact/start",
                json!({
                    "threadId": thread_id,
                }),
            )
            .await?;
        let deadline = sleep(COMPACT_TIMEOUT);
        tokio::pin!(deadline);
        let mut accepted = false;
        let mut provider_turn_id = None::<String>;
        let mut provider_item_id = None::<String>;
        let mut new_item_observed = false;
        let mut item_completed = false;
        let mut deprecated_completed = false;
        let mut terminal_completed = false;

        loop {
            tokio::select! {
                _ = &mut deadline => return Err(CodexAppServerError::Timeout("thread/compact/start")),
                message = self.read_message() => {
                    match message? {
                        CodexMessage::Response { id, result, error } if id == json!(request_id) => {
                            finish_response(result, error)?;
                            accepted = true;
                        }
                        CodexMessage::Request { id, .. } => {
                            self.respond_error(
                                id,
                                -32601,
                                "CodeM 压缩阶段不支持这个客户端请求",
                            ).await?;
                        }
                        CodexMessage::Notification { method, params } => {
                            if params
                                .get("threadId")
                                .and_then(Value::as_str)
                                .is_some_and(|value| value != thread_id)
                            {
                                continue;
                            }
                            match method.as_str() {
                                "turn/started" => {
                                    provider_turn_id = params
                                        .get("turn")
                                        .and_then(|turn| turn.get("id"))
                                        .and_then(Value::as_str)
                                        .map(ToString::to_string)
                                        .or(provider_turn_id);
                                }
                                "item/started" => {
                                    let item = params.get("item");
                                    if item
                                        .and_then(|item| item.get("type"))
                                        .and_then(Value::as_str)
                                        == Some("contextCompaction")
                                    {
                                        new_item_observed = true;
                                        provider_turn_id = params
                                            .get("turnId")
                                            .and_then(Value::as_str)
                                            .map(ToString::to_string)
                                            .or(provider_turn_id);
                                        provider_item_id = item
                                            .and_then(|item| item.get("id"))
                                            .and_then(Value::as_str)
                                            .map(ToString::to_string)
                                            .or(provider_item_id);
                                        on_event(CodexCompactionEvent::Started {
                                            provider_turn_id: provider_turn_id.clone(),
                                            provider_item_id: provider_item_id.clone(),
                                        });
                                    }
                                }
                                "item/completed" => {
                                    let item = params.get("item");
                                    if item
                                        .and_then(|item| item.get("type"))
                                        .and_then(Value::as_str)
                                        == Some("contextCompaction")
                                    {
                                        new_item_observed = true;
                                        provider_turn_id = params
                                            .get("turnId")
                                            .and_then(Value::as_str)
                                            .map(ToString::to_string)
                                            .or(provider_turn_id);
                                        provider_item_id = item
                                            .and_then(|item| item.get("id"))
                                            .and_then(Value::as_str)
                                            .map(ToString::to_string)
                                            .or(provider_item_id);
                                        item_completed = true;
                                    }
                                }
                                "thread/compacted" => {
                                    provider_turn_id = params
                                        .get("turnId")
                                        .and_then(Value::as_str)
                                        .map(ToString::to_string)
                                        .or(provider_turn_id);
                                    if !new_item_observed {
                                        deprecated_completed = true;
                                    }
                                }
                                "turn/completed" => {
                                    let turn = params.get("turn").ok_or_else(|| {
                                        CodexAppServerError::Protocol(
                                            "compact turn/completed 缺少 turn".to_string(),
                                        )
                                    })?;
                                    provider_turn_id = turn
                                        .get("id")
                                        .and_then(Value::as_str)
                                        .map(ToString::to_string)
                                        .or(provider_turn_id);
                                    match turn.get("status").and_then(Value::as_str) {
                                        Some("completed") => terminal_completed = true,
                                        Some("failed") => {
                                            let message = turn
                                                .get("error")
                                                .and_then(|error| error.get("message"))
                                                .and_then(Value::as_str)
                                                .unwrap_or("Codex 上下文压缩失败");
                                            return Err(CodexAppServerError::Execution(
                                                bounded_string(message, MAX_JSON_STRING_BYTES),
                                            ));
                                        }
                                        Some("interrupted") => {
                                            return Err(CodexAppServerError::Execution(
                                                "Codex 上下文压缩已中断".to_string(),
                                            ));
                                        }
                                        Some(status) => {
                                            return Err(CodexAppServerError::Protocol(format!(
                                                "compact turn/completed status 不受支持：{status}"
                                            )));
                                        }
                                        None => {
                                            return Err(CodexAppServerError::Protocol(
                                                "compact turn/completed 缺少 status".to_string(),
                                            ));
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                        _ => {}
                    }
                }
            }

            if accepted && terminal_completed && (item_completed || deprecated_completed) {
                let provider_turn_id = provider_turn_id.clone().ok_or_else(|| {
                    CodexAppServerError::Protocol("Codex 压缩完成但缺少 turn id".to_string())
                })?;
                on_event(CodexCompactionEvent::Completed {
                    provider_turn_id: provider_turn_id.clone(),
                    provider_item_id: provider_item_id.clone(),
                });
                return Ok(CodexCompactionOutcome {
                    provider_thread_id: thread_id.to_string(),
                    provider_turn_id,
                    provider_item_id,
                });
            }
        }
    }

    pub async fn read_compaction_history(
        &mut self,
        thread_id: &str,
        provider_turn_id: Option<&str>,
        provider_item_id: Option<&str>,
    ) -> Result<CodexCompactionHistoryState, CodexAppServerError> {
        if provider_turn_id.is_none() && provider_item_id.is_none() {
            return Ok(CodexCompactionHistoryState::Unconfirmed);
        }
        let result = self
            .request(
                "thread/read",
                json!({
                    "threadId": thread_id,
                    "includeTurns": true,
                }),
                REQUEST_TIMEOUT,
            )
            .await?;
        let thread = result.get("thread").ok_or_else(|| {
            CodexAppServerError::Protocol("thread/read 响应缺少 thread".to_string())
        })?;
        let response_thread_id = thread.get("id").and_then(Value::as_str).ok_or_else(|| {
            CodexAppServerError::Protocol("thread/read 响应缺少 thread.id".to_string())
        })?;
        if response_thread_id != thread_id {
            return Err(CodexAppServerError::Protocol(
                "thread/read 响应 thread.id 与请求不一致".to_string(),
            ));
        }
        let turns = thread
            .get("turns")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                CodexAppServerError::Protocol("thread/read 响应缺少 thread.turns".to_string())
            })?;
        for turn in turns {
            let Some(turn_id) = turn.get("id").and_then(Value::as_str) else {
                continue;
            };
            if provider_turn_id.is_some_and(|expected| expected != turn_id) {
                continue;
            }
            let Some(items) = turn.get("items").and_then(Value::as_array) else {
                continue;
            };
            for item in items {
                if item.get("type").and_then(Value::as_str) != Some("contextCompaction") {
                    continue;
                }
                let item_id = item.get("id").and_then(Value::as_str);
                if provider_item_id.is_some_and(|expected| Some(expected) != item_id) {
                    continue;
                }
                if turn.get("status").and_then(Value::as_str) != Some("completed") {
                    return Ok(CodexCompactionHistoryState::Unconfirmed);
                }
                return Ok(CodexCompactionHistoryState::Confirmed(
                    CodexCompactionOutcome {
                        provider_thread_id: response_thread_id.to_string(),
                        provider_turn_id: turn_id.to_string(),
                        provider_item_id: item_id.map(ToString::to_string),
                    },
                ));
            }
        }
        Ok(CodexCompactionHistoryState::NotFound)
    }

    pub async fn run_turn<F>(
        &mut self,
        thread_id: &str,
        cwd: &Path,
        input: &[CodexUserInput],
        permission_mode: &str,
        model: Option<&str>,
        reasoning_effort: Option<&str>,
        mut cancel: watch::Receiver<bool>,
        control: &mut mpsc::UnboundedReceiver<AgentControlCommand>,
        mut on_event: F,
    ) -> Result<CodexTurnOutcome, CodexAppServerError>
    where
        F: FnMut(CodexRuntimeEvent),
    {
        if *cancel.borrow() {
            return Ok(CodexTurnOutcome {
                stop_reason: "cancelled".to_string(),
                text: String::new(),
                text_truncated: false,
                cancel_sent: false,
                usage: AgentUsageSnapshot::default(),
            });
        }
        let policy = codex_turn_policy(permission_mode, cwd)
            .ok_or_else(|| CodexAppServerError::Protocol("Codex 权限模式不受支持".to_string()))?;
        let mut turn_params = json!({
            "threadId": thread_id,
            "input": input,
            "cwd": cwd.to_string_lossy(),
            "approvalPolicy": policy.approval_policy,
            "sandboxPolicy": policy.sandbox_policy,
        });
        if let Some(params) = turn_params.as_object_mut() {
            if let Some(model) = model {
                params.insert("model".to_string(), json!(model));
            }
            if let Some(reasoning_effort) = reasoning_effort {
                params.insert("effort".to_string(), json!(reasoning_effort));
            }
        }
        let turn_request_id = self.send_request("turn/start", turn_params).await?;
        let mut turn_id = None::<String>;
        let mut turn_started = false;
        let mut collected_text = String::new();
        let mut text_truncated = false;
        let mut last_error = None::<String>;
        let mut active_tools = HashSet::<String>::new();
        let mut completed_tools = HashSet::<String>::new();
        let mut file_change_patches = HashMap::<String, Value>::new();
        let mut pending_interactions = HashMap::<String, PendingInteraction>::new();
        let mut cancel_sent = false;
        let mut usage = AgentUsageSnapshot::default();
        let mut compaction = RuntimeCompactionState::default();
        let mut cancel_channel_open = true;
        let mut control_channel_open = true;
        let mut interrupt_request_ids = HashSet::<u64>::new();
        let mut guide_requests = HashMap::<u64, oneshot::Sender<Result<(), String>>>::new();
        let deadline = sleep(TURN_TIMEOUT);
        tokio::pin!(deadline);

        loop {
            tokio::select! {
                _ = &mut deadline => return Err(CodexAppServerError::Timeout("turn/start")),
                changed = cancel.changed(), if cancel_channel_open && !cancel_sent => {
                    match changed {
                        Ok(()) if *cancel.borrow() => {
                            if turn_started {
                                if let Some(active_turn_id) = turn_id.as_deref() {
                                    interrupt_request_ids.insert(
                                        self.send_interrupt(thread_id, active_turn_id).await?
                                    );
                                    cancel_sent = true;
                                }
                            }
                        }
                        Ok(()) => {}
                        Err(_) => cancel_channel_open = false,
                    }
                }
                command = control.recv(), if control_channel_open => {
                    match command {
                        Some(AgentControlCommand::Guide { text, acknowledgement }) => {
                            let cancel_requested = *cancel.borrow();
                            self.handle_guide_command(
                                thread_id,
                                turn_id.as_deref().filter(|_| turn_started),
                                cancel_requested,
                                cancel_sent,
                                !pending_interactions.is_empty(),
                                text,
                                acknowledgement,
                                &mut guide_requests,
                            ).await?;
                        }
                        Some(command) => {
                            self.apply_control_command(
                                &mut pending_interactions,
                                command,
                                &mut on_event,
                            ).await?;
                        }
                        None => control_channel_open = false,
                    }
                }
                message = self.read_message() => {
                    match message? {
                        CodexMessage::Response { id, result, error }
                            if id == json!(turn_request_id) =>
                        {
                            let result = finish_response(result, error)?;
                            turn_id = result
                                .get("turn")
                                .and_then(|turn| turn.get("id"))
                                .and_then(Value::as_str)
                                .map(ToString::to_string)
                                .or(turn_id);
                            if *cancel.borrow() && turn_started && !cancel_sent {
                                if let Some(active_turn_id) = turn_id.as_deref() {
                                    interrupt_request_ids.insert(
                                        self.send_interrupt(thread_id, active_turn_id).await?
                                    );
                                    cancel_sent = true;
                                }
                            }
                        }
                        CodexMessage::Response { id, result, error } => {
                            if let Some(acknowledgement) = id
                                .as_u64()
                                .and_then(|value| guide_requests.remove(&value))
                            {
                                if let Some(result) = classify_guide_response(result, error) {
                                    let _ = acknowledgement.send(result);
                                }
                            } else if id.as_u64().is_some_and(|value| interrupt_request_ids.remove(&value)) {
                                finish_response(result, error)?;
                            }
                        }
                        CodexMessage::Request { id, method, params } => {
                            self.handle_server_request(
                                id,
                                method,
                                params,
                                &mut pending_interactions,
                                &mut on_event,
                            ).await?;
                        }
                        CodexMessage::Notification { method, params } => {
                            if method == "turn/started"
                                && params
                                    .get("threadId")
                                    .and_then(Value::as_str)
                                    .is_none_or(|value| value == thread_id)
                            {
                                turn_started = true;
                            }
                            let terminal = process_notification(
                                &method,
                                &params,
                                thread_id,
                                &mut turn_id,
                                &mut collected_text,
                                &mut text_truncated,
                                &mut last_error,
                                &mut active_tools,
                                &mut completed_tools,
                                &mut file_change_patches,
                                &mut pending_interactions,
                                &mut usage,
                                &mut compaction,
                                &mut on_event,
                            )?;
                            if terminal.is_none()
                                && *cancel.borrow()
                                && turn_started
                                && !cancel_sent
                            {
                                if let Some(active_turn_id) = turn_id.as_deref() {
                                    interrupt_request_ids.insert(
                                        self.send_interrupt(thread_id, active_turn_id).await?
                                    );
                                    cancel_sent = true;
                                }
                            }
                            if let Some(terminal) = terminal {
                                return match terminal {
                                    CodexTurnTerminal::Completed => Ok(CodexTurnOutcome {
                                        stop_reason: "end_turn".to_string(),
                                        text: collected_text,
                                        text_truncated,
                                        cancel_sent,
                                        usage,
                                    }),
                                    CodexTurnTerminal::Interrupted => Ok(CodexTurnOutcome {
                                        stop_reason: "cancelled".to_string(),
                                        text: collected_text,
                                        text_truncated,
                                        cancel_sent,
                                        usage,
                                    }),
                                    CodexTurnTerminal::Failed(message) => Err(
                                        CodexAppServerError::Execution(
                                            if message.trim().is_empty() {
                                                "Codex turn 执行失败".to_string()
                                            } else {
                                                message
                                            }
                                        )
                                    ),
                                };
                            }
                        }
                    }
                }
            }
        }
    }

    async fn handle_guide_command(
        &mut self,
        thread_id: &str,
        active_turn_id: Option<&str>,
        cancel_requested: bool,
        cancel_sent: bool,
        has_pending_interactions: bool,
        text: String,
        acknowledgement: oneshot::Sender<Result<(), String>>,
        guide_requests: &mut HashMap<u64, oneshot::Sender<Result<(), String>>>,
    ) -> Result<(), CodexAppServerError> {
        let Some(active_turn_id) = active_turn_id else {
            let _ = acknowledgement.send(Err("Codex 当前没有可引导的活动 turn".to_string()));
            return Ok(());
        };
        if cancel_requested || cancel_sent {
            let _ = acknowledgement.send(Err("Codex 当前运行正在停止，暂不能引导".to_string()));
            return Ok(());
        }
        if has_pending_interactions {
            let _ = acknowledgement.send(Err("Codex 正在等待审批或回答，暂不能引导".to_string()));
            return Ok(());
        }
        let request_id = self
            .send_request(
                "turn/steer",
                json!({
                    "threadId": thread_id,
                    "expectedTurnId": active_turn_id,
                    "input": [{ "type": "text", "text": text }],
                }),
            )
            .await?;
        guide_requests.insert(request_id, acknowledgement);
        Ok(())
    }

    async fn send_interrupt(
        &mut self,
        thread_id: &str,
        turn_id: &str,
    ) -> Result<u64, CodexAppServerError> {
        self.send_request(
            "turn/interrupt",
            json!({ "threadId": thread_id, "turnId": turn_id }),
        )
        .await
    }

    async fn handle_server_request<F>(
        &mut self,
        id: Value,
        method: String,
        params: Value,
        pending: &mut HashMap<String, PendingInteraction>,
        on_event: &mut F,
    ) -> Result<(), CodexAppServerError>
    where
        F: FnMut(CodexRuntimeEvent),
    {
        let request_id = request_id_string(&id)?;
        let (kind, event) = match method.as_str() {
            "item/commandExecution/requestApproval" => (
                PendingInteractionKind::Permission {
                    params: params.clone(),
                },
                CodexRuntimeEvent::ApprovalRequest {
                    request: build_command_approval_request(&request_id, &params),
                },
            ),
            "item/fileChange/requestApproval" => (
                PendingInteractionKind::Permission {
                    params: params.clone(),
                },
                CodexRuntimeEvent::ApprovalRequest {
                    request: build_file_approval_request(&request_id, &params),
                },
            ),
            "item/permissions/requestApproval" => (
                PendingInteractionKind::Permission {
                    params: params.clone(),
                },
                CodexRuntimeEvent::ApprovalRequest {
                    request: build_permissions_approval_request(&request_id, &params),
                },
            ),
            "item/tool/requestUserInput" => (
                PendingInteractionKind::UserInput,
                CodexRuntimeEvent::UserInputRequest {
                    request: build_user_input_request(&request_id, &params)?,
                },
            ),
            _ => {
                return self
                    .respond_error(id, -32601, "CodeM 暂不支持这个 Codex 客户端请求")
                    .await;
            }
        };
        pending.insert(
            request_id,
            PendingInteraction {
                rpc_id: id,
                method,
                kind,
            },
        );
        on_event(event);
        Ok(())
    }

    async fn apply_control_command<F>(
        &mut self,
        pending: &mut HashMap<String, PendingInteraction>,
        command: AgentControlCommand,
        on_event: &mut F,
    ) -> Result<(), CodexAppServerError>
    where
        F: FnMut(CodexRuntimeEvent),
    {
        match command {
            AgentControlCommand::Guide {
                acknowledgement, ..
            } => {
                let _ = acknowledgement.send(Err("Codex 当前没有可引导的活动 turn".to_string()));
            }
            AgentControlCommand::Permission {
                request_id,
                decision,
                option_id: _,
                acknowledgement,
            } => {
                let Some(interaction) = pending.get(&request_id).cloned() else {
                    let _ = acknowledgement.send(Err("Codex 权限请求不存在或已结束".to_string()));
                    return Ok(());
                };
                let PendingInteractionKind::Permission { params } = &interaction.kind else {
                    let _ =
                        acknowledgement.send(Err("当前 Codex 请求正在等待用户输入".to_string()));
                    return Ok(());
                };
                let response = build_permission_response(&interaction.method, params, decision);
                let result = self
                    .respond_server_request(
                        interaction.rpc_id.clone(),
                        &interaction.method,
                        response,
                    )
                    .await;
                match result {
                    Ok(()) => {
                        pending.remove(&request_id);
                        let _ = acknowledgement.send(Ok(()));
                        on_event(CodexRuntimeEvent::InteractionResolved { request_id });
                    }
                    Err(error) => {
                        let _ = acknowledgement.send(Err(error.public_message()));
                        return Err(error);
                    }
                }
            }
            AgentControlCommand::UserInput {
                request_id,
                answers,
                acknowledgement,
            } => {
                let Some(interaction) = pending.get(&request_id).cloned() else {
                    let _ = acknowledgement.send(Err("Codex 提问请求不存在或已结束".to_string()));
                    return Ok(());
                };
                if !matches!(interaction.kind, PendingInteractionKind::UserInput) {
                    let _ =
                        acknowledgement.send(Err("当前 Codex 请求正在等待权限决定".to_string()));
                    return Ok(());
                }
                let response = build_user_input_response(answers)?;
                let result = self
                    .respond_server_request(
                        interaction.rpc_id.clone(),
                        &interaction.method,
                        response,
                    )
                    .await;
                match result {
                    Ok(()) => {
                        pending.remove(&request_id);
                        let _ = acknowledgement.send(Ok(()));
                        on_event(CodexRuntimeEvent::InteractionResolved { request_id });
                    }
                    Err(error) => {
                        let _ = acknowledgement.send(Err(error.public_message()));
                        return Err(error);
                    }
                }
            }
        }
        Ok(())
    }

    async fn request(
        &mut self,
        method: &str,
        params: Value,
        timeout_duration: Duration,
    ) -> Result<Value, CodexAppServerError> {
        let request_id = self.send_request(method, params).await?;
        timeout(timeout_duration, self.wait_for_response(request_id))
            .await
            .map_err(|_| CodexAppServerError::Timeout("request"))?
    }

    async fn wait_for_response(&mut self, request_id: u64) -> Result<Value, CodexAppServerError> {
        loop {
            match self.read_message().await? {
                CodexMessage::Response { id, result, error } if id == json!(request_id) => {
                    return finish_response(result, error);
                }
                CodexMessage::Request { id, .. } => {
                    self.respond_error(id, -32601, "CodeM 初始化阶段不支持这个客户端请求")
                        .await?;
                }
                _ => {}
            }
        }
    }

    async fn send_request(
        &mut self,
        method: &str,
        params: Value,
    ) -> Result<u64, CodexAppServerError> {
        let request_id = self.next_request_id;
        self.next_request_id += 1;
        self.write_message(&json!({
            "id": request_id,
            "method": method,
            "params": params,
        }))
        .await?;
        Ok(request_id)
    }

    async fn send_notification(
        &mut self,
        method: &str,
        params: Value,
    ) -> Result<(), CodexAppServerError> {
        self.write_message(&json!({ "method": method, "params": params }))
            .await
    }

    async fn respond_server_request(
        &mut self,
        id: Value,
        method: &str,
        response: Value,
    ) -> Result<(), CodexAppServerError> {
        self.write_message(&json!({
            "method": method,
            "id": id,
            "response": response,
        }))
        .await
    }

    async fn respond_error(
        &mut self,
        id: Value,
        code: i64,
        message: &str,
    ) -> Result<(), CodexAppServerError> {
        self.write_message(&json!({
            "id": id,
            "error": { "code": code, "message": message },
        }))
        .await
    }

    async fn write_message(&mut self, payload: &Value) -> Result<(), CodexAppServerError> {
        let mut encoded = serde_json::to_vec(payload)?;
        encoded.push(b'\n');
        self.writer.write_all(&encoded).await?;
        self.writer.flush().await?;
        Ok(())
    }

    async fn read_message(&mut self) -> Result<CodexMessage, CodexAppServerError> {
        loop {
            let line = self.lines.next_line().await?.ok_or_else(|| {
                CodexAppServerError::Protocol("Codex App Server stdout 已关闭".to_string())
            })?;
            if line.trim().is_empty() {
                continue;
            }
            if line.len() > MAX_MESSAGE_BYTES {
                return Err(CodexAppServerError::Protocol(
                    "Codex App Server 消息超过大小限制".to_string(),
                ));
            }
            return parse_message(&line);
        }
    }
}

pub struct CodexStdioClient {
    child: Child,
    connection: CodexConnection<ChildStdout, ChildStdin>,
    stderr_task: JoinHandle<()>,
}

impl CodexStdioClient {
    pub async fn spawn(program: &str, cwd: &Path) -> Result<Self, CodexAppServerError> {
        Self::spawn_with_options(program, cwd, &[], &BTreeMap::new()).await
    }

    pub async fn spawn_with_options(
        program: &str,
        cwd: &Path,
        config_overrides: &[String],
        environment: &BTreeMap<String, String>,
    ) -> Result<Self, CodexAppServerError> {
        let mut command = Command::new(program);
        for config in config_overrides {
            command.arg("-c").arg(config);
        }
        command
            .arg("app-server")
            .envs(environment)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        configure_background_command(&mut command);
        let mut child = command.spawn()?;
        let stdin = child.stdin.take().ok_or_else(|| {
            CodexAppServerError::Protocol("Codex App Server stdin 不可用".to_string())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            CodexAppServerError::Protocol("Codex App Server stdout 不可用".to_string())
        })?;
        let mut stderr = child.stderr.take().ok_or_else(|| {
            CodexAppServerError::Protocol("Codex App Server stderr 不可用".to_string())
        })?;
        let stderr_task = tokio::spawn(async move {
            let mut buffer = [0_u8; 4096];
            while stderr.read(&mut buffer).await.is_ok_and(|read| read > 0) {}
        });
        Ok(Self {
            child,
            connection: CodexConnection::new(stdout, stdin),
            stderr_task,
        })
    }

    pub async fn initialize(&mut self, client_version: &str) -> Result<(), CodexAppServerError> {
        self.connection.initialize(client_version).await
    }

    pub async fn account_summary(&mut self) -> Result<CodexProbeSummary, CodexAppServerError> {
        self.connection.account_summary().await
    }

    pub async fn probe_compact_capability(
        &mut self,
    ) -> Result<CodexCompactCapability, CodexAppServerError> {
        self.connection.probe_compact_capability().await
    }

    pub async fn probe_fork_capability(
        &mut self,
    ) -> Result<CodexForkCapability, CodexAppServerError> {
        self.connection.probe_fork_capability().await
    }

    pub async fn read_thread_snapshot(
        &mut self,
        thread_id: &str,
    ) -> Result<Vec<CodexStoredTurn>, CodexAppServerError> {
        self.connection.read_thread_snapshot(thread_id).await
    }

    pub async fn fork_thread_snapshot(
        &mut self,
        source_thread_id: &str,
    ) -> Result<CodexForkOutcome, CodexAppServerError> {
        self.connection.fork_thread_snapshot(source_thread_id).await
    }

    pub async fn find_fork_candidates(
        &mut self,
        source_thread_id: &str,
        started_at_seconds: i64,
    ) -> Result<Vec<String>, CodexAppServerError> {
        self.connection
            .find_fork_candidates(source_thread_id, started_at_seconds)
            .await
    }

    pub async fn list_models(&mut self) -> Result<Vec<CodexModelSummary>, CodexAppServerError> {
        self.connection.list_models().await
    }

    pub async fn start_or_resume_thread(
        &mut self,
        requested_thread_id: Option<&str>,
        cwd: &Path,
    ) -> Result<String, CodexAppServerError> {
        self.connection
            .start_or_resume_thread(requested_thread_id, cwd)
            .await
    }

    pub async fn run_text_turn<F>(
        &mut self,
        thread_id: &str,
        cwd: &Path,
        text: &str,
        permission_mode: &str,
        model: Option<&str>,
        reasoning_effort: Option<&str>,
        cancel: watch::Receiver<bool>,
        control: &mut mpsc::UnboundedReceiver<AgentControlCommand>,
        on_event: F,
    ) -> Result<CodexTurnOutcome, CodexAppServerError>
    where
        F: FnMut(CodexRuntimeEvent),
    {
        self.connection
            .run_text_turn(
                thread_id,
                cwd,
                text,
                permission_mode,
                model,
                reasoning_effort,
                cancel,
                control,
                on_event,
            )
            .await
    }

    pub async fn start_compaction<F>(
        &mut self,
        thread_id: &str,
        on_event: F,
    ) -> Result<CodexCompactionOutcome, CodexAppServerError>
    where
        F: FnMut(CodexCompactionEvent),
    {
        self.connection.start_compaction(thread_id, on_event).await
    }

    pub async fn read_compaction_history(
        &mut self,
        thread_id: &str,
        provider_turn_id: Option<&str>,
        provider_item_id: Option<&str>,
    ) -> Result<CodexCompactionHistoryState, CodexAppServerError> {
        self.connection
            .read_compaction_history(thread_id, provider_turn_id, provider_item_id)
            .await
    }

    pub async fn run_turn<F>(
        &mut self,
        thread_id: &str,
        cwd: &Path,
        input: &[CodexUserInput],
        permission_mode: &str,
        model: Option<&str>,
        reasoning_effort: Option<&str>,
        cancel: watch::Receiver<bool>,
        control: &mut mpsc::UnboundedReceiver<AgentControlCommand>,
        on_event: F,
    ) -> Result<CodexTurnOutcome, CodexAppServerError>
    where
        F: FnMut(CodexRuntimeEvent),
    {
        self.connection
            .run_turn(
                thread_id,
                cwd,
                input,
                permission_mode,
                model,
                reasoning_effort,
                cancel,
                control,
                on_event,
            )
            .await
    }

    pub fn is_running(&mut self) -> bool {
        self.child.try_wait().is_ok_and(|status| status.is_none())
    }

    pub async fn shutdown(mut self) {
        let _ = self.child.start_kill();
        let _ = timeout(Duration::from_secs(2), self.child.wait()).await;
        self.stderr_task.abort();
    }
}

pub async fn probe_codex_app_server(
    program: &str,
    cwd: &Path,
    client_version: &str,
) -> Result<CodexProbeSummary, CodexAppServerError> {
    let mut client = CodexStdioClient::spawn(program, cwd).await?;
    let result = async {
        client.initialize(client_version).await?;
        client.account_summary().await
    }
    .await;
    client.shutdown().await;
    result
}

fn process_notification<F>(
    method: &str,
    params: &Value,
    expected_thread_id: &str,
    turn_id: &mut Option<String>,
    collected_text: &mut String,
    text_truncated: &mut bool,
    last_error: &mut Option<String>,
    active_tools: &mut HashSet<String>,
    completed_tools: &mut HashSet<String>,
    file_change_patches: &mut HashMap<String, Value>,
    pending_interactions: &mut HashMap<String, PendingInteraction>,
    usage: &mut AgentUsageSnapshot,
    compaction: &mut RuntimeCompactionState,
    on_event: &mut F,
) -> Result<Option<CodexTurnTerminal>, CodexAppServerError>
where
    F: FnMut(CodexRuntimeEvent),
{
    if params
        .get("threadId")
        .and_then(Value::as_str)
        .is_some_and(|value| value != expected_thread_id)
    {
        return Ok(None);
    }
    match method {
        "thread/tokenUsage/updated" => {
            if let Some(token_usage) = params.get("tokenUsage") {
                if let Some(parsed) = parse_codex_usage(token_usage) {
                    *usage = parsed;
                    on_event(CodexRuntimeEvent::Usage {
                        usage: usage.clone(),
                    });
                }
            }
        }
        "turn/started" => {
            *turn_id = params
                .get("turn")
                .and_then(|turn| turn.get("id"))
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .or_else(|| turn_id.clone());
        }
        "item/agentMessage/delta" => {
            if let Some(delta) = params.get("delta").and_then(Value::as_str) {
                *text_truncated |= !append_bounded(collected_text, delta, MAX_EVENT_TEXT_BYTES);
                on_event(CodexRuntimeEvent::TextDelta {
                    text: bounded_string(delta, MAX_EVENT_TEXT_BYTES),
                });
            }
        }
        "item/reasoning/summaryTextDelta"
        | "item/reasoning/summaryPartAdded"
        | "item/reasoning/textDelta"
        | "item/plan/delta" => {
            on_event(CodexRuntimeEvent::Thinking);
        }
        "item/started" => {
            if let Some(item) = params.get("item") {
                if item.get("type").and_then(Value::as_str) == Some("contextCompaction") {
                    compaction.provider_turn_id = params
                        .get("turnId")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                        .or_else(|| compaction.provider_turn_id.clone());
                    compaction.provider_item_id = item
                        .get("id")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                        .or_else(|| compaction.provider_item_id.clone());
                    if !compaction.started_emitted {
                        compaction.started_emitted = true;
                        on_event(CodexRuntimeEvent::CompactionStarted {
                            provider_turn_id: compaction.provider_turn_id.clone(),
                            provider_item_id: compaction.provider_item_id.clone(),
                        });
                    }
                }
                if matches!(
                    item.get("type").and_then(Value::as_str),
                    Some("reasoning" | "plan")
                ) {
                    on_event(CodexRuntimeEvent::Thinking);
                }
                if let Some((tool_id, name, input)) = tool_started_event(item) {
                    if active_tools.insert(tool_id.clone()) {
                        on_event(CodexRuntimeEvent::ToolStarted {
                            tool_id,
                            name,
                            input,
                        });
                    }
                }
            }
        }
        "item/fileChange/patchUpdated" => {
            if let (Some(item_id), Some(changes)) = (
                params.get("itemId").and_then(Value::as_str),
                params.get("changes").filter(|value| value.is_array()),
            ) {
                file_change_patches.insert(item_id.to_string(), sanitize_json_value(changes, 0));
            }
        }
        "item/completed" => {
            if let Some(item) = params.get("item") {
                if item.get("type").and_then(Value::as_str) == Some("contextCompaction") {
                    compaction.provider_turn_id = params
                        .get("turnId")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                        .or_else(|| compaction.provider_turn_id.clone());
                    compaction.provider_item_id = item
                        .get("id")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                        .or_else(|| compaction.provider_item_id.clone());
                    compaction.item_completed = true;
                }
                if item.get("type").and_then(Value::as_str) == Some("agentMessage")
                    && collected_text.is_empty()
                {
                    if let Some(text) = item.get("text").and_then(Value::as_str) {
                        *text_truncated |=
                            !append_bounded(collected_text, text, MAX_EVENT_TEXT_BYTES);
                        on_event(CodexRuntimeEvent::TextDelta {
                            text: bounded_string(text, MAX_EVENT_TEXT_BYTES),
                        });
                    }
                }
                let patch = item
                    .get("id")
                    .and_then(Value::as_str)
                    .and_then(|tool_id| file_change_patches.remove(tool_id));
                if let Some((tool_id, content, is_error)) =
                    tool_completed_event(item, patch.as_ref())
                {
                    active_tools.remove(&tool_id);
                    if completed_tools.insert(tool_id.clone()) {
                        on_event(CodexRuntimeEvent::ToolCompleted {
                            tool_id,
                            content,
                            is_error,
                        });
                    }
                }
            }
        }
        "serverRequest/resolved" => {
            if let Some(id) = params.get("requestId") {
                let request_id = request_id_string(id)?;
                if pending_interactions.remove(&request_id).is_some() {
                    on_event(CodexRuntimeEvent::InteractionResolved { request_id });
                }
            }
        }
        "warning" => {
            if let Some(message) = params.get("message").and_then(Value::as_str) {
                on_event(CodexRuntimeEvent::Status {
                    message: bounded_string(message, MAX_JSON_STRING_BYTES),
                });
            }
        }
        "error" => {
            let will_retry = params
                .get("willRetry")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let message = params
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("Codex turn 执行失败");
            if will_retry {
                on_event(CodexRuntimeEvent::Status {
                    message: bounded_string(message, MAX_JSON_STRING_BYTES),
                });
            } else {
                *last_error = Some(bounded_string(message, MAX_JSON_STRING_BYTES));
            }
        }
        "turn/completed" => {
            let turn = params.get("turn").ok_or_else(|| {
                CodexAppServerError::Protocol("turn/completed 缺少 turn".to_string())
            })?;
            let status = turn.get("status").and_then(Value::as_str).ok_or_else(|| {
                CodexAppServerError::Protocol("turn/completed 缺少 status".to_string())
            })?;
            let terminal_turn_id = turn
                .get("id")
                .and_then(Value::as_str)
                .or(turn_id.as_deref());
            if status == "completed"
                && compaction.item_completed
                && terminal_turn_id.is_some()
                && compaction
                    .provider_turn_id
                    .as_deref()
                    .is_none_or(|value| Some(value) == terminal_turn_id)
            {
                on_event(CodexRuntimeEvent::CompactionCompleted {
                    provider_turn_id: terminal_turn_id
                        .expect("checked terminal turn id")
                        .to_string(),
                    provider_item_id: compaction.provider_item_id.clone(),
                });
            }
            return Ok(Some(match status {
                "completed" => CodexTurnTerminal::Completed,
                "interrupted" => CodexTurnTerminal::Interrupted,
                "failed" => CodexTurnTerminal::Failed(
                    turn.get("error")
                        .and_then(|error| error.get("message"))
                        .and_then(Value::as_str)
                        .map(|value| bounded_string(value, MAX_JSON_STRING_BYTES))
                        .or_else(|| last_error.clone())
                        .unwrap_or_else(|| "Codex turn 执行失败".to_string()),
                ),
                other => {
                    return Err(CodexAppServerError::Protocol(format!(
                        "turn/completed status 不受支持：{other}"
                    )))
                }
            }));
        }
        _ => {}
    }
    Ok(None)
}

fn parse_codex_usage(token_usage: &Value) -> Option<AgentUsageSnapshot> {
    let last = token_usage.get("last")?;
    let cached_input = last.get("cachedInputTokens").and_then(Value::as_u64);
    let full_input = last.get("inputTokens").and_then(Value::as_u64);
    Some(AgentUsageSnapshot {
        input_tokens: full_input.map(|tokens| tokens.saturating_sub(cached_input.unwrap_or(0))),
        output_tokens: last.get("outputTokens").and_then(Value::as_u64),
        cache_creation_input_tokens: None,
        cache_read_input_tokens: cached_input,
        model_context_window: token_usage
            .get("modelContextWindow")
            .and_then(Value::as_u64),
        total_cost_usd: None,
    })
}

fn tool_started_event(item: &Value) -> Option<(String, String, Option<Value>)> {
    let item_type = item.get("type")?.as_str()?;
    let tool_id = item.get("id")?.as_str()?.to_string();
    let (name, input) = match item_type {
        "commandExecution" => (
            "Bash".to_string(),
            Some(json!({
                "command": item.get("command").cloned().unwrap_or(Value::Null),
                "cwd": item.get("cwd").cloned().unwrap_or(Value::Null),
            })),
        ),
        "fileChange" => (
            "Edit".to_string(),
            Some(json!({
                "changes": item.get("changes").cloned().unwrap_or(Value::Null),
            })),
        ),
        "mcpToolCall" => (
            item.get("tool")
                .and_then(Value::as_str)
                .map(|tool| format!("MCP: {tool}"))
                .unwrap_or_else(|| "MCP".to_string()),
            item.get("arguments").cloned(),
        ),
        "dynamicToolCall" => (
            item.get("tool")
                .and_then(Value::as_str)
                .unwrap_or("DynamicTool")
                .to_string(),
            item.get("arguments").cloned(),
        ),
        "webSearch" => ("WebSearch".to_string(), item.get("action").cloned()),
        "collabAgentToolCall" => (
            "Agent".to_string(),
            item.get("prompt").map(|prompt| json!({ "prompt": prompt })),
        ),
        _ => return None,
    };
    Some((
        tool_id,
        name,
        input.as_ref().map(|value| sanitize_json_value(value, 0)),
    ))
}

fn tool_completed_event(
    item: &Value,
    file_change_patch: Option<&Value>,
) -> Option<(String, String, bool)> {
    let item_type = item.get("type")?.as_str()?;
    if !matches!(
        item_type,
        "commandExecution"
            | "fileChange"
            | "mcpToolCall"
            | "dynamicToolCall"
            | "webSearch"
            | "collabAgentToolCall"
    ) {
        return None;
    }
    let tool_id = item.get("id")?.as_str()?.to_string();
    let status = item
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("completed");
    let exit_failed = item
        .get("exitCode")
        .and_then(Value::as_i64)
        .is_some_and(|value| value != 0);
    let is_error = matches!(status, "failed" | "declined")
        || item.get("error").is_some_and(|value| !value.is_null())
        || exit_failed;
    let content_value = match item_type {
        "commandExecution" => json!({
            "status": status,
            "exitCode": item.get("exitCode").cloned().unwrap_or(Value::Null),
            "output": item.get("aggregatedOutput").cloned().unwrap_or(Value::Null),
            "changes": if is_error {
                Value::Null
            } else {
                parse_command_apply_patch_changes(item).unwrap_or(Value::Null)
            },
        }),
        "fileChange" => json!({
            "status": status,
            "changes": file_change_patch
                .cloned()
                .or_else(|| item.get("changes").cloned())
                .unwrap_or(Value::Null),
        }),
        "mcpToolCall" => json!({
            "status": status,
            "result": item.get("result").cloned().unwrap_or(Value::Null),
            "error": item.get("error").cloned().unwrap_or(Value::Null),
        }),
        _ => sanitize_json_value(item, 0),
    };
    Some((tool_id, safe_json_to_string(&content_value), is_error))
}

fn parse_command_apply_patch_changes(item: &Value) -> Option<Value> {
    let command = match item.get("command")? {
        Value::String(command) => command.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" "),
        _ => return None,
    };
    if !command.contains("apply_patch") && !command.contains("--codex-run-as-apply-patch") {
        return None;
    }
    let patch_start = command.find("*** Begin Patch")?;
    let patch = &command[patch_start + "*** Begin Patch".len()..];
    let patch_end = patch.find("*** End Patch")?;
    let raw_patch = &patch[..patch_end];
    let decoded_patch = if !raw_patch.contains('\n')
        && command[..patch_start].contains("[string]::Join")
        && raw_patch.contains("','")
    {
        Some(raw_patch.replace("','", "\n").replace("\\\"", "\""))
    } else {
        None
    };
    let lines = decoded_patch
        .as_deref()
        .unwrap_or(raw_patch)
        .lines()
        .map(|line| line.trim_end_matches('\r'))
        .collect::<Vec<_>>();
    let mut changes = Vec::new();
    let mut index = 0;

    while index < lines.len() && changes.len() < MAX_JSON_ARRAY_ITEMS {
        let Some((path, change_type)) = parse_apply_patch_file_header(lines[index]) else {
            index += 1;
            continue;
        };
        index += 1;
        let move_path = if change_type == "update" {
            lines
                .get(index)
                .and_then(|line| line.strip_prefix("*** Move to: "))
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .map(|path| {
                    index += 1;
                    path.to_string()
                })
        } else {
            None
        };
        let diff_start = index;
        while index < lines.len() && parse_apply_patch_file_header(lines[index]).is_none() {
            index += 1;
        }
        if !path.is_empty() {
            let kind = if let Some(move_path) = move_path {
                json!({ "type": change_type, "move_path": move_path })
            } else {
                json!({ "type": change_type })
            };
            changes.push(json!({
                "path": path,
                "kind": kind,
                "diff": lines[diff_start..index].join("\n"),
            }));
        }
    }

    (!changes.is_empty()).then(|| Value::Array(changes))
}

fn parse_apply_patch_file_header(line: &str) -> Option<(&str, &'static str)> {
    [
        ("*** Add File: ", "add"),
        ("*** Update File: ", "update"),
        ("*** Delete File: ", "delete"),
    ]
    .into_iter()
    .find_map(|(prefix, kind)| line.strip_prefix(prefix).map(|path| (path.trim(), kind)))
}

fn build_command_approval_request(request_id: &str, params: &Value) -> AgentApprovalRequest {
    let description = join_description([
        params.get("reason").and_then(Value::as_str),
        params.get("command").and_then(Value::as_str),
        params.get("cwd").and_then(Value::as_str),
    ]);
    AgentApprovalRequest {
        request_id: request_id.to_string(),
        kind: "command".to_string(),
        title: "Codex 请求执行命令".to_string(),
        description,
        danger: if params.get("networkApprovalContext").is_some() {
            "high".to_string()
        } else {
            "medium".to_string()
        },
        options: approval_options(),
    }
}

fn build_file_approval_request(request_id: &str, params: &Value) -> AgentApprovalRequest {
    AgentApprovalRequest {
        request_id: request_id.to_string(),
        kind: "file-change".to_string(),
        title: "Codex 请求修改文件".to_string(),
        description: join_description([
            params.get("reason").and_then(Value::as_str),
            params.get("grantRoot").and_then(Value::as_str),
        ]),
        danger: "medium".to_string(),
        options: approval_options(),
    }
}

fn build_permissions_approval_request(request_id: &str, params: &Value) -> AgentApprovalRequest {
    AgentApprovalRequest {
        request_id: request_id.to_string(),
        kind: "permissions".to_string(),
        title: "Codex 请求额外权限".to_string(),
        description: join_description([
            params.get("reason").and_then(Value::as_str),
            params.get("cwd").and_then(Value::as_str),
        ]),
        danger: "high".to_string(),
        options: approval_options(),
    }
}

fn approval_options() -> Vec<AgentApprovalOption> {
    vec![
        AgentApprovalOption {
            id: "accept".to_string(),
            label: "允许".to_string(),
            kind: "allow_once".to_string(),
        },
        AgentApprovalOption {
            id: "decline".to_string(),
            label: "拒绝".to_string(),
            kind: "reject_once".to_string(),
        },
    ]
}

fn build_permission_response(
    method: &str,
    params: &Value,
    decision: AgentPermissionDecision,
) -> Value {
    if method == "item/permissions/requestApproval" {
        return json!({
            "permissions": if decision == AgentPermissionDecision::Approve {
                params.get("permissions").cloned().unwrap_or_else(|| json!({}))
            } else {
                json!({})
            },
            "scope": "turn",
        });
    }
    json!({
        "decision": if decision == AgentPermissionDecision::Approve {
            "accept"
        } else {
            "decline"
        },
    })
}

fn build_user_input_request(
    request_id: &str,
    params: &Value,
) -> Result<AgentUserInputRequest, CodexAppServerError> {
    let questions = params
        .get("questions")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            CodexAppServerError::Protocol("item/tool/requestUserInput 缺少 questions".to_string())
        })?
        .iter()
        .filter_map(|question| {
            let id = question.get("id")?.as_str()?.to_string();
            let text = question.get("question")?.as_str()?.to_string();
            let options = question
                .get("options")
                .and_then(Value::as_array)
                .map(|options| {
                    options
                        .iter()
                        .filter_map(|option| {
                            let label = option.get("label")?.as_str()?.to_string();
                            Some(AgentUserInputOption {
                                value: label.clone(),
                                label,
                                description: option
                                    .get("description")
                                    .and_then(Value::as_str)
                                    .map(ToString::to_string),
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Some(AgentUserInputQuestion {
                id,
                header: question
                    .get("header")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                question: text,
                input_type: if options.is_empty() {
                    "text".to_string()
                } else {
                    "select".to_string()
                },
                options,
                multi_select: false,
                required: true,
                secret: question
                    .get("isSecret")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect::<Vec<_>>();
    if questions.is_empty() {
        return Err(CodexAppServerError::Protocol(
            "item/tool/requestUserInput 没有有效问题".to_string(),
        ));
    }
    Ok(AgentUserInputRequest {
        request_id: request_id.to_string(),
        title: Some("Codex 需要补充信息".to_string()),
        description: "请回答后继续当前 Codex 任务。".to_string(),
        questions,
    })
}

fn build_user_input_response(answers: Map<String, Value>) -> Result<Value, CodexAppServerError> {
    if answers.is_empty() {
        return Err(CodexAppServerError::Protocol(
            "Codex 用户回答不能为空".to_string(),
        ));
    }
    let mut normalized = Map::new();
    for (question_id, answer) in answers {
        let values = match answer {
            Value::String(value) if !value.trim().is_empty() => vec![Value::String(value)],
            Value::Array(values) => values
                .into_iter()
                .filter_map(|value| value.as_str().map(|value| Value::String(value.to_string())))
                .collect::<Vec<_>>(),
            _ => Vec::new(),
        };
        if !values.is_empty() {
            normalized.insert(question_id, json!({ "answers": values }));
        }
    }
    if normalized.is_empty() {
        return Err(CodexAppServerError::Protocol(
            "Codex 用户回答没有有效文本".to_string(),
        ));
    }
    Ok(json!({ "answers": normalized }))
}

fn checked_thread<'a>(
    result: &'a Value,
    expected_thread_id: &str,
    method: &str,
) -> Result<&'a Value, CodexAppServerError> {
    let thread = result
        .get("thread")
        .ok_or_else(|| CodexAppServerError::Protocol(format!("{method} 响应缺少 thread")))?;
    let response_thread_id = thread
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| CodexAppServerError::Protocol(format!("{method} 响应缺少 thread.id")))?;
    if response_thread_id != expected_thread_id {
        return Err(CodexAppServerError::Protocol(format!(
            "{method} 响应 thread.id 与请求不一致"
        )));
    }
    Ok(thread)
}

fn parse_thread_snapshot(
    result: &Value,
    expected_thread_id: &str,
) -> Result<Vec<CodexStoredTurn>, CodexAppServerError> {
    let thread = checked_thread(result, expected_thread_id, "thread/read")?;
    let turns = thread
        .get("turns")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            CodexAppServerError::Protocol("thread/read 响应缺少 thread.turns".to_string())
        })?;

    Ok(turns.iter().filter_map(parse_stored_turn).collect())
}

fn parse_stored_turn(turn: &Value) -> Option<CodexStoredTurn> {
    let id = optional_non_empty_string(turn.get("id"))?;
    let status = optional_non_empty_string(turn.get("status"))?;
    let items = turn
        .get("items")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(parse_stored_item)
        .collect();
    Some(CodexStoredTurn { id, status, items })
}

fn parse_stored_item(item: &Value) -> Option<CodexStoredItem> {
    let item_type = item.get("type")?.as_str()?;
    let id = optional_non_empty_string(item.get("id"))?;
    match item_type {
        "userMessage" => {
            let content = item
                .get("content")
                .and_then(Value::as_array)?
                .iter()
                .filter_map(parse_stored_user_input)
                .collect::<Vec<_>>();
            (!content.is_empty()).then_some(CodexStoredItem::UserMessage { id, content })
        }
        "agentMessage" => {
            item.get("text")
                .and_then(Value::as_str)
                .map(|text| CodexStoredItem::AgentMessage {
                    id,
                    text: bounded_string(text, MAX_EVENT_TEXT_BYTES),
                })
        }
        "contextCompaction" => Some(CodexStoredItem::ContextCompaction { id }),
        _ => {
            let (_, name, input) = tool_started_event(item)?;
            let (_, result, is_error) = tool_completed_event(item, None)?;
            Some(CodexStoredItem::Tool {
                id,
                name,
                input,
                result,
                is_error,
            })
        }
    }
}

fn parse_stored_user_input(value: &Value) -> Option<CodexUserInput> {
    match value.get("type").and_then(Value::as_str)? {
        "text" => value
            .get("text")
            .and_then(Value::as_str)
            .map(|text| CodexUserInput::Text {
                text: bounded_string(text, MAX_EVENT_TEXT_BYTES),
            }),
        "localImage" => value
            .get("path")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .map(|path| CodexUserInput::LocalImage {
                path: bounded_string(path, MAX_JSON_STRING_BYTES),
            }),
        "image" => value
            .get("url")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|url| !url.is_empty() && !url.starts_with("data:"))
            .map(|url| CodexUserInput::Image {
                url: bounded_string(url, MAX_JSON_STRING_BYTES),
            }),
        _ => None,
    }
}

fn summarize_model(value: &Value) -> Option<CodexModelSummary> {
    if value
        .get("hidden")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return None;
    }
    let id = value.get("id")?.as_str()?.trim();
    if id.is_empty() || id.len() > 512 {
        return None;
    }
    let label = value
        .get("displayName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|label| !label.is_empty())
        .or_else(|| {
            value
                .get("model")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|label| !label.is_empty())
        })
        .unwrap_or(id);
    let default_reasoning_effort = optional_non_empty_string(value.get("defaultReasoningEffort"));
    let mut seen_efforts = HashSet::new();
    let mut supported_reasoning_efforts = value
        .get("supportedReasoningEfforts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(MAX_JSON_ARRAY_ITEMS)
        .filter_map(|effort| {
            let effort_id = effort.get("reasoningEffort")?.as_str()?.trim();
            if effort_id.is_empty() || effort_id.len() > 512 || !seen_efforts.insert(effort_id) {
                return None;
            }
            Some(CodexReasoningEffortSummary {
                id: effort_id.to_string(),
                description: optional_non_empty_string(effort.get("description"))
                    .map(|value| bounded_string(&value, MAX_JSON_STRING_BYTES)),
            })
        })
        .collect::<Vec<_>>();
    if let Some(default_effort) = default_reasoning_effort.as_deref() {
        if seen_efforts.insert(default_effort) {
            supported_reasoning_efforts.push(CodexReasoningEffortSummary {
                id: default_effort.to_string(),
                description: None,
            });
        }
    }

    Some(CodexModelSummary {
        id: id.to_string(),
        label: bounded_string(label, MAX_JSON_STRING_BYTES),
        description: optional_non_empty_string(value.get("description"))
            .map(|value| bounded_string(&value, MAX_JSON_STRING_BYTES)),
        is_default: value
            .get("isDefault")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        default_reasoning_effort,
        supported_reasoning_efforts,
    })
}

fn optional_non_empty_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn parse_message(line: &str) -> Result<CodexMessage, CodexAppServerError> {
    let payload = serde_json::from_str::<Value>(line)?;
    let object = payload.as_object().ok_or_else(|| {
        CodexAppServerError::Protocol("Codex JSON-RPC message 不是对象".to_string())
    })?;
    if let Some(method) = object.get("method").and_then(Value::as_str) {
        let params = object.get("params").cloned().unwrap_or(Value::Null);
        return Ok(if let Some(id) = object.get("id") {
            CodexMessage::Request {
                id: id.clone(),
                method: method.to_string(),
                params,
            }
        } else {
            CodexMessage::Notification {
                method: method.to_string(),
                params,
            }
        });
    }
    let id = object.get("id").cloned().ok_or_else(|| {
        CodexAppServerError::Protocol("Codex JSON-RPC response 缺少 id".to_string())
    })?;
    Ok(CodexMessage::Response {
        id,
        result: object.get("result").cloned(),
        error: object.get("error").map(parse_rpc_error).transpose()?,
    })
}

fn parse_rpc_error(value: &Value) -> Result<CodexRpcError, CodexAppServerError> {
    let code = value
        .get("code")
        .and_then(Value::as_i64)
        .ok_or_else(|| CodexAppServerError::Protocol("Codex RPC error 缺少 code".to_string()))?;
    let message = value
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("Codex App Server 拒绝了请求")
        .to_string();
    Ok(CodexRpcError { code, message })
}

fn finish_response(
    result: Option<Value>,
    error: Option<CodexRpcError>,
) -> Result<Value, CodexAppServerError> {
    if let Some(error) = error {
        return Err(CodexAppServerError::Rpc {
            code: error.code,
            message: error.message,
        });
    }
    result
        .ok_or_else(|| CodexAppServerError::Protocol("Codex RPC response 缺少 result".to_string()))
}

fn classify_guide_response(
    result: Option<Value>,
    error: Option<CodexRpcError>,
) -> Option<Result<(), String>> {
    if error.is_some() {
        return Some(
            finish_response(result, error)
                .map(|_| ())
                .map_err(|error| error.public_message()),
        );
    }
    result.map(|_| Ok(()))
}

fn request_id_string(value: &Value) -> Result<String, CodexAppServerError> {
    match value {
        Value::String(value) if !value.trim().is_empty() => Ok(value.clone()),
        Value::Number(value) => Ok(value.to_string()),
        _ => Err(CodexAppServerError::Protocol(
            "Codex 客户端请求 id 无效".to_string(),
        )),
    }
}

fn join_description<'a>(values: impl IntoIterator<Item = Option<&'a str>>) -> Option<String> {
    let parts = values
        .into_iter()
        .flatten()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| bounded_string(value, MAX_JSON_STRING_BYTES))
        .collect::<Vec<_>>();
    (!parts.is_empty()).then(|| parts.join("\n"))
}

fn safe_json_to_string(value: &Value) -> String {
    serde_json::to_string(&sanitize_json_value(value, 0)).unwrap_or_else(|_| "{}".to_string())
}

fn sanitize_json_value(value: &Value, depth: usize) -> Value {
    if depth >= MAX_JSON_DEPTH {
        return Value::String("[truncated]".to_string());
    }
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => value.clone(),
        Value::String(value) => Value::String(bounded_string(value, MAX_JSON_STRING_BYTES)),
        Value::Array(values) => Value::Array(
            values
                .iter()
                .take(MAX_JSON_ARRAY_ITEMS)
                .map(|value| sanitize_json_value(value, depth + 1))
                .collect(),
        ),
        Value::Object(values) => {
            let mut sanitized = Map::new();
            for (key, value) in values.iter().take(MAX_JSON_OBJECT_FIELDS) {
                if is_sensitive_key(key) {
                    sanitized.insert(key.clone(), Value::String("[redacted]".to_string()));
                } else {
                    sanitized.insert(key.clone(), sanitize_json_value(value, depth + 1));
                }
            }
            Value::Object(sanitized)
        }
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "token",
        "secret",
        "password",
        "authorization",
        "cookie",
        "api_key",
        "apikey",
        "accesskey",
        "privatekey",
    ]
    .iter()
    .any(|needle| key.contains(needle))
}

fn bounded_string(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &value[..end])
}

fn append_bounded(target: &mut String, value: &str, max_bytes: usize) -> bool {
    if target.len() >= max_bytes {
        return false;
    }
    let remaining = max_bytes - target.len();
    if value.len() <= remaining {
        target.push_str(value);
        return true;
    }
    let mut end = remaining;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    target.push_str(&value[..end]);
    false
}

#[cfg(target_os = "windows")]
fn configure_background_command(command: &mut Command) {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn configure_background_command(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tokio::{
        io::{
            duplex, split, AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, Lines,
            ReadHalf, WriteHalf,
        },
        sync::{mpsc, oneshot, watch},
        time::{timeout, Duration},
    };

    type MockLines = Lines<BufReader<ReadHalf<DuplexStream>>>;
    type MockWriter = WriteHalf<DuplexStream>;

    #[test]
    fn codex_usage_uses_last_turn_and_separates_cached_input() {
        let usage = parse_codex_usage(&json!({
            "last": {
                "inputTokens": 120,
                "cachedInputTokens": 20,
                "outputTokens": 7
            },
            "total": {
                "inputTokens": 9999,
                "cachedInputTokens": 8888,
                "outputTokens": 7777
            },
            "modelContextWindow": 353400
        }))
        .expect("usage");
        assert_eq!(usage.input_tokens, Some(100));
        assert_eq!(usage.cache_read_input_tokens, Some(20));
        assert_eq!(usage.output_tokens, Some(7));
        assert_eq!(usage.model_context_window, Some(353400));
    }

    #[test]
    fn successful_command_execution_exposes_complete_apply_patch_changes() {
        let item = json!({
            "id": "tool-patch",
            "type": "commandExecution",
            "status": "completed",
            "exitCode": 0,
            "command": "apply_patch \"*** Begin Patch\n*** Add File: docs/report.md\n+# Report\n+done\n*** End Patch\"",
            "aggregatedOutput": "Success. Updated the following files:\nA docs/report.md"
        });

        let (_, content, is_error) =
            tool_completed_event(&item, None).expect("completed command event");
        let content: Value = serde_json::from_str(&content).expect("command result json");

        assert!(!is_error);
        assert_eq!(content["changes"][0]["path"], "docs/report.md");
        assert_eq!(content["changes"][0]["kind"]["type"], "add");
        assert_eq!(content["changes"][0]["diff"], "+# Report\n+done");
    }

    #[test]
    fn command_apply_patch_preserves_update_delete_move_and_hunks() {
        let item = json!({
            "id": "tool-patch",
            "type": "commandExecution",
            "status": "completed",
            "exitCode": 0,
            "command": [
                "pwsh.exe",
                "-Command",
                "apply_patch \"*** Begin Patch\n*** Update File: src/main.rs\n@@ -1 +1 @@\n-old\n+new\n@@ -8 +8 @@\n-before\n+after\n*** Update File: src/old.rs\n*** Move to: src/new.rs\n@@ -1 +1 @@\n-old name\n+new name\n*** Delete File: docs/old.md\n*** End Patch\""
            ],
            "aggregatedOutput": "Success"
        });

        let (_, content, is_error) =
            tool_completed_event(&item, None).expect("completed command event");
        let content: Value = serde_json::from_str(&content).expect("command result json");
        let changes = content["changes"].as_array().expect("apply patch changes");

        assert!(!is_error);
        assert_eq!(changes.len(), 3);
        assert_eq!(changes[0]["path"], "src/main.rs");
        assert_eq!(changes[0]["kind"]["type"], "update");
        assert_eq!(
            changes[0]["diff"],
            "@@ -1 +1 @@\n-old\n+new\n@@ -8 +8 @@\n-before\n+after"
        );
        assert_eq!(changes[1]["path"], "src/old.rs");
        assert_eq!(changes[1]["kind"]["type"], "update");
        assert_eq!(changes[1]["kind"]["move_path"], "src/new.rs");
        assert_eq!(changes[1]["diff"], "@@ -1 +1 @@\n-old name\n+new name");
        assert_eq!(changes[2]["path"], "docs/old.md");
        assert_eq!(changes[2]["kind"]["type"], "delete");
    }

    #[test]
    fn failed_command_execution_does_not_expose_apply_patch_changes() {
        let item = json!({
            "id": "tool-patch",
            "type": "commandExecution",
            "status": "failed",
            "exitCode": 1,
            "command": "apply_patch \"*** Begin Patch\n*** Add File: report.md\n+not written\n*** End Patch\"",
            "aggregatedOutput": "Invalid patch text"
        });

        let (_, content, is_error) =
            tool_completed_event(&item, None).expect("completed command event");
        let content: Value = serde_json::from_str(&content).expect("command result json");

        assert!(is_error);
        assert!(content["changes"].is_null());
    }

    #[test]
    fn successful_non_apply_patch_command_does_not_expose_printed_patch_text() {
        let item = json!({
            "id": "tool-print",
            "type": "commandExecution",
            "status": "completed",
            "exitCode": 0,
            "command": "Write-Output \"*** Begin Patch\n*** Add File: report.md\n+not written\n*** End Patch\"",
            "aggregatedOutput": "*** Begin Patch\n*** Add File: report.md\n+not written\n*** End Patch"
        });

        let (_, content, is_error) =
            tool_completed_event(&item, None).expect("completed command event");
        let content: Value = serde_json::from_str(&content).expect("command result json");

        assert!(!is_error);
        assert!(content["changes"].is_null());
    }

    #[test]
    fn command_apply_patch_decodes_windows_joined_patch_lines() {
        let item = json!({
            "id": "tool-patch",
            "type": "commandExecution",
            "status": "completed",
            "exitCode": 0,
            "command": "$patch = [string]::Join(\"`n\", @('*** Begin Patch','*** Update File: sample.ts','@@','-export const version = \\\"1.0.1\\\";','+export const version = \\\"1.0.2\\\";','*** Add File: final.md','+# Codex Final','+','+[Open review](review.md)','*** End Patch')); codex.exe --codex-run-as-apply-patch \"$patch\"",
            "aggregatedOutput": "Success"
        });

        let (_, content, is_error) =
            tool_completed_event(&item, None).expect("completed command event");
        let content: Value = serde_json::from_str(&content).expect("command result json");
        let changes = content["changes"].as_array().expect("apply patch changes");

        assert!(!is_error);
        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0]["path"], "sample.ts");
        assert_eq!(
            changes[0]["diff"],
            "@@\n-export const version = \"1.0.1\";\n+export const version = \"1.0.2\";"
        );
        assert_eq!(changes[1]["path"], "final.md");
        assert_eq!(
            changes[1]["diff"],
            "+# Codex Final\n+\n+[Open review](review.md)"
        );
    }

    fn mock_connection() -> (
        CodexConnection<ReadHalf<DuplexStream>, WriteHalf<DuplexStream>>,
        MockLines,
        MockWriter,
    ) {
        let (client, server) = duplex(64 * 1024);
        let (client_reader, client_writer) = split(client);
        let (server_reader, server_writer) = split(server);
        (
            CodexConnection::new(client_reader, client_writer),
            BufReader::new(server_reader).lines(),
            server_writer,
        )
    }

    async fn read_wire(lines: &mut MockLines) -> Value {
        let line = timeout(Duration::from_secs(2), lines.next_line())
            .await
            .expect("mock server read timeout")
            .expect("mock server read")
            .expect("mock client closed");
        serde_json::from_str(&line).expect("valid client JSON")
    }

    async fn write_wire(writer: &mut MockWriter, payload: Value) {
        let mut encoded = serde_json::to_vec(&payload).expect("encode mock response");
        encoded.push(b'\n');
        writer
            .write_all(&encoded)
            .await
            .expect("write mock response");
        writer.flush().await.expect("flush mock response");
    }

    async fn probe_fork_with_response(
        response: Value,
    ) -> Result<CodexForkCapability, CodexAppServerError> {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let client = tokio::spawn(async move { connection.probe_fork_capability().await });

        let request = read_wire(&mut lines).await;
        assert_eq!(request["method"], "thread/fork");
        assert_eq!(request["params"], json!({}));
        let mut response = response;
        response["id"] = request["id"].clone();
        write_wire(&mut writer, response).await;

        client.await.expect("fork probe task")
    }

    async fn find_fork_candidates_from_single_page(data: Value) -> Vec<String> {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let client = tokio::spawn(async move {
            connection
                .find_fork_candidates("source-thread", 1_000)
                .await
        });
        let request = read_wire(&mut lines).await;
        write_wire(
            &mut writer,
            json!({
                "id": request["id"],
                "result": { "data": data, "nextCursor": null }
            }),
        )
        .await;
        client
            .await
            .expect("candidate task")
            .expect("candidate result")
    }

    #[tokio::test]
    async fn fork_probe_classifies_supported_and_method_not_found() {
        assert_eq!(
            probe_fork_with_response(json!({
                "error": { "code": -32602, "message": "missing field threadId" }
            }))
            .await
            .expect("invalid params means supported"),
            CodexForkCapability::Supported,
        );
        assert_eq!(
            probe_fork_with_response(json!({
                "error": {
                    "code": -32600,
                    "message": "Invalid request: missing field `threadId`"
                }
            }))
            .await
            .expect("strict missing thread id means supported"),
            CodexForkCapability::Supported,
        );
        assert_eq!(
            probe_fork_with_response(json!({
                "error": { "code": -32601, "message": "method not found" }
            }))
            .await
            .expect("method not found means unsupported"),
            CodexForkCapability::Unsupported,
        );
        assert!(matches!(
            probe_fork_with_response(json!({
                "error": { "code": -32603, "message": "provider unavailable" }
            }))
            .await,
            Err(CodexAppServerError::Rpc {
                code: -32603,
                message,
            }) if message == "provider unavailable"
        ));
        assert!(matches!(
            probe_fork_with_response(json!({
                "error": { "code": -32600, "message": "Invalid request envelope" }
            }))
            .await,
            Err(CodexAppServerError::Rpc { code: -32600, .. })
        ));
    }

    #[tokio::test]
    async fn fork_thread_omits_last_turn_and_ephemeral_then_reads_full_history() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let client =
            tokio::spawn(async move { connection.fork_thread_snapshot("source-thread").await });

        let source_read = read_wire(&mut lines).await;
        assert_eq!(source_read["method"], "thread/read");
        assert_eq!(
            source_read["params"],
            json!({ "threadId": "source-thread", "includeTurns": false })
        );
        write_wire(
            &mut writer,
            json!({
                "id": source_read["id"],
                "result": {
                    "thread": {
                        "id": "source-thread",
                        "status": { "type": "idle" }
                    }
                }
            }),
        )
        .await;

        let fork = read_wire(&mut lines).await;
        assert_eq!(fork["method"], "thread/fork");
        assert_eq!(fork["params"], json!({ "threadId": "source-thread" }));
        assert!(fork["params"].get("lastTurnId").is_none());
        assert!(fork["params"].get("ephemeral").is_none());
        write_wire(
            &mut writer,
            json!({
                "id": fork["id"],
                "result": {
                    "thread": {
                        "id": "fork-thread",
                        "forkedFromId": "source-thread",
                        "ephemeral": false
                    }
                }
            }),
        )
        .await;

        let history = read_wire(&mut lines).await;
        assert_eq!(history["method"], "thread/read");
        assert_eq!(
            history["params"],
            json!({ "threadId": "fork-thread", "includeTurns": true })
        );
        write_wire(
            &mut writer,
            json!({
                "id": history["id"],
                "result": {
                    "thread": {
                        "id": "fork-thread",
                        "turns": [{
                            "id": "turn-1",
                            "status": "completed",
                            "items": [
                                {
                                    "id": "user-1",
                                    "type": "userMessage",
                                    "content": [{ "type": "text", "text": "hello" }]
                                },
                                {
                                    "id": "agent-1",
                                    "type": "agentMessage",
                                    "text": "done"
                                },
                                {
                                    "id": "command-1",
                                    "type": "commandExecution",
                                    "status": "completed",
                                    "exitCode": 0,
                                    "command": "pwd",
                                    "cwd": "D:/repo",
                                    "aggregatedOutput": "D:/repo"
                                },
                                {
                                    "id": "file-1",
                                    "type": "fileChange",
                                    "status": "completed",
                                    "changes": [{ "path": "README.md", "kind": "update" }]
                                },
                                { "id": "compact-1", "type": "contextCompaction" }
                            ]
                        }]
                    }
                }
            }),
        )
        .await;

        let outcome = client.await.expect("fork task").expect("fork outcome");
        assert_eq!(outcome.provider_thread_id, "fork-thread");
        assert_eq!(outcome.forked_from_id.as_deref(), Some("source-thread"));
        assert_eq!(outcome.turns.len(), 1);
        assert_eq!(outcome.turns[0].id, "turn-1");
        assert_eq!(outcome.turns[0].status, "completed");
        assert!(matches!(
            outcome.turns[0].items.as_slice(),
            [
                CodexStoredItem::UserMessage { id: user_id, .. },
                CodexStoredItem::AgentMessage { id: agent_id, text },
                CodexStoredItem::Tool { id: command_id, name: command_name, .. },
                CodexStoredItem::Tool { id: file_id, name: file_name, .. },
                CodexStoredItem::ContextCompaction { id: compact_id },
            ] if user_id == "user-1"
                && agent_id == "agent-1"
                && text == "done"
                && command_id == "command-1"
                && command_name == "Bash"
                && file_id == "file-1"
                && file_name == "Edit"
                && compact_id == "compact-1"
        ));
    }

    #[tokio::test]
    async fn fork_rejects_active_source_and_invalid_child_id() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let active_client =
            tokio::spawn(async move { connection.fork_thread_snapshot("source-thread").await });
        let source_read = read_wire(&mut lines).await;
        write_wire(
            &mut writer,
            json!({
                "id": source_read["id"],
                "result": {
                    "thread": {
                        "id": "source-thread",
                        "status": { "type": "active", "activeFlags": ["turn"] }
                    }
                }
            }),
        )
        .await;
        assert!(matches!(
            active_client.await.expect("active fork task"),
            Err(CodexAppServerError::Execution(message)) if message.contains("运行中")
        ));
        let next_message = timeout(Duration::from_millis(25), lines.next_line()).await;
        assert!(matches!(next_message, Err(_) | Ok(Ok(None))));

        for child_id in ["", "source-thread"] {
            let (mut connection, mut lines, mut writer) = mock_connection();
            let client =
                tokio::spawn(async move { connection.fork_thread_snapshot("source-thread").await });
            let source_read = read_wire(&mut lines).await;
            write_wire(
                &mut writer,
                json!({
                    "id": source_read["id"],
                    "result": {
                        "thread": {
                            "id": "source-thread",
                            "status": { "type": "idle" }
                        }
                    }
                }),
            )
            .await;
            let fork = read_wire(&mut lines).await;
            write_wire(
                &mut writer,
                json!({
                    "id": fork["id"],
                    "result": { "thread": { "id": child_id } }
                }),
            )
            .await;
            assert!(matches!(
                client.await.expect("invalid child task"),
                Err(CodexAppServerError::Protocol(_))
            ));
        }
    }

    #[tokio::test]
    async fn fork_history_failure_preserves_created_provider_id() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let client =
            tokio::spawn(async move { connection.fork_thread_snapshot("source-thread").await });

        let source_read = read_wire(&mut lines).await;
        write_wire(
            &mut writer,
            json!({
                "id": source_read["id"],
                "result": {
                    "thread": {
                        "id": "source-thread",
                        "status": { "type": "idle" }
                    }
                }
            }),
        )
        .await;
        let fork = read_wire(&mut lines).await;
        write_wire(
            &mut writer,
            json!({
                "id": fork["id"],
                "result": {
                    "thread": {
                        "id": "fork-thread",
                        "forkedFromId": "source-thread"
                    }
                }
            }),
        )
        .await;
        let history = read_wire(&mut lines).await;
        write_wire(
            &mut writer,
            json!({
                "id": history["id"],
                "error": { "code": -32603, "message": "history unavailable" }
            }),
        )
        .await;

        assert!(matches!(
            client.await.expect("fork history task"),
            Err(CodexAppServerError::ForkHistory {
                provider_thread_id,
                ..
            }) if provider_thread_id == "fork-thread"
        ));
    }

    #[tokio::test]
    async fn fork_candidate_scan_filters_locally_without_experimental_fields() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let client = tokio::spawn(async move {
            connection
                .find_fork_candidates("source-thread", 1_000)
                .await
        });

        let first_page = read_wire(&mut lines).await;
        assert_eq!(first_page["method"], "thread/list");
        assert_eq!(first_page["params"]["cursor"], Value::Null);
        assert_eq!(first_page["params"]["limit"], 100);
        assert_eq!(first_page["params"]["sortKey"], "created_at");
        assert_eq!(first_page["params"]["sortDirection"], "desc");
        assert_eq!(first_page["params"]["archived"], false);
        assert!(first_page["params"].get("parentThreadId").is_none());
        assert!(first_page["params"].get("ancestorThreadId").is_none());
        let source_kinds = first_page["params"]["sourceKinds"]
            .as_array()
            .expect("public source kinds");
        assert!(source_kinds.contains(&json!("appServer")));
        write_wire(
            &mut writer,
            json!({
                "id": first_page["id"],
                "result": {
                    "data": [
                        {
                            "id": "valid-child-1",
                            "forkedFromId": "source-thread",
                            "createdAt": 1_001,
                            "ephemeral": false
                        },
                        {
                            "id": "old-child",
                            "forkedFromId": "source-thread",
                            "createdAt": 900,
                            "ephemeral": false
                        },
                        {
                            "id": "other-parent",
                            "forkedFromId": "other-thread",
                            "createdAt": 1_002,
                            "ephemeral": false
                        },
                        {
                            "id": "ephemeral-child",
                            "forkedFromId": "source-thread",
                            "createdAt": 1_003,
                            "ephemeral": true
                        }
                    ],
                    "nextCursor": "page-2"
                }
            }),
        )
        .await;

        let second_page = read_wire(&mut lines).await;
        assert_eq!(second_page["params"]["cursor"], "page-2");
        assert!(second_page["params"].get("parentThreadId").is_none());
        write_wire(
            &mut writer,
            json!({
                "id": second_page["id"],
                "result": {
                    "data": [
                        {
                            "id": "valid-child-2",
                            "forkedFromId": "source-thread",
                            "createdAt": 1_004,
                            "ephemeral": false
                        }
                    ],
                    "nextCursor": null
                }
            }),
        )
        .await;

        assert_eq!(
            client.await.expect("candidate task").expect("candidates"),
            vec!["valid-child-1".to_string(), "valid-child-2".to_string()]
        );
        assert!(find_fork_candidates_from_single_page(json!([]))
            .await
            .is_empty());
        assert_eq!(
            find_fork_candidates_from_single_page(json!([{
                "id": "only-child",
                "forkedFromId": "source-thread",
                "createdAt": 1_000,
                "ephemeral": false
            }]))
            .await,
            vec!["only-child".to_string()]
        );
    }

    #[tokio::test]
    async fn fork_stored_snapshot_redacts_private_reasoning_and_unknown_raw_items() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let client =
            tokio::spawn(async move { connection.read_thread_snapshot("fork-thread").await });

        let request = read_wire(&mut lines).await;
        assert_eq!(request["method"], "thread/read");
        write_wire(
            &mut writer,
            json!({
                "id": request["id"],
                "result": {
                    "thread": {
                        "id": "fork-thread",
                        "turns": [{
                            "id": "turn-1",
                            "status": "completed",
                            "items": [
                                {
                                    "id": "user-1",
                                    "type": "userMessage",
                                    "content": [
                                        { "type": "text", "text": "hello" },
                                        { "type": "image", "url": "data:image/png;base64,SECRET" },
                                        { "type": "localImage", "path": "D:/images/example.png", "bytes": "SECRET" }
                                    ]
                                },
                                { "id": "reason-1", "type": "reasoning", "text": "private" },
                                { "id": "plan-1", "type": "plan", "text": "private plan" },
                                { "id": "unknown-1", "type": "futurePrivateItem", "raw": "SECRET" },
                                {
                                    "id": "tool-1",
                                    "type": "mcpToolCall",
                                    "tool": "lookup",
                                    "status": "completed",
                                    "arguments": {
                                        "authorization": "Bearer secret",
                                        "query": "visible"
                                    },
                                    "result": {
                                        "apiKey": "secret-key",
                                        "value": "visible-result"
                                    }
                                }
                            ]
                        }]
                    }
                }
            }),
        )
        .await;

        let turns = client.await.expect("snapshot task").expect("snapshot");
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].items.len(), 2);
        let CodexStoredItem::UserMessage { content, .. } = &turns[0].items[0] else {
            panic!("first stored item must be a user message");
        };
        assert_eq!(
            content,
            &vec![
                CodexUserInput::Text {
                    text: "hello".to_string()
                },
                CodexUserInput::LocalImage {
                    path: "D:/images/example.png".to_string()
                }
            ]
        );
        let CodexStoredItem::Tool { input, result, .. } = &turns[0].items[1] else {
            panic!("second stored item must be a tool");
        };
        assert_eq!(
            input.as_ref().expect("sanitized tool input")["authorization"],
            "[redacted]"
        );
        assert!(result.contains("[redacted]"));
        assert!(!result.contains("secret-key"));
        assert!(!format!("{turns:?}").contains("private"));
        assert!(!format!("{turns:?}").contains("SECRET"));

        for invalid_thread in [
            json!({ "id": "other-thread", "turns": [] }),
            json!({ "id": "fork-thread", "turns": {} }),
        ] {
            let (mut connection, mut lines, mut writer) = mock_connection();
            let client =
                tokio::spawn(async move { connection.read_thread_snapshot("fork-thread").await });
            let request = read_wire(&mut lines).await;
            write_wire(
                &mut writer,
                json!({
                    "id": request["id"],
                    "result": { "thread": invalid_thread }
                }),
            )
            .await;
            assert!(matches!(
                client.await.expect("invalid snapshot task"),
                Err(CodexAppServerError::Protocol(_))
            ));
        }
    }

    #[tokio::test]
    async fn compact_probe_maps_invalid_params_to_supported() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let client = tokio::spawn(async move { connection.probe_compact_capability().await });

        let request = read_wire(&mut lines).await;
        assert_eq!(request["method"], "thread/compact/start");
        assert_eq!(request["params"], json!({}));
        write_wire(
            &mut writer,
            json!({
                "id": request["id"],
                "error": { "code": -32602, "message": "missing field threadId" }
            }),
        )
        .await;

        assert_eq!(
            client.await.expect("probe task").expect("probe result"),
            CodexCompactCapability::Supported,
        );
    }

    #[tokio::test]
    async fn compact_probe_maps_invalid_request_missing_thread_id_to_supported() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let client = tokio::spawn(async move { connection.probe_compact_capability().await });

        let request = read_wire(&mut lines).await;
        assert_eq!(request["method"], "thread/compact/start");
        assert_eq!(request["params"], json!({}));
        write_wire(
            &mut writer,
            json!({
                "id": request["id"],
                "error": {
                    "code": -32600,
                    "message": "Invalid request: missing field `threadId`"
                }
            }),
        )
        .await;

        assert_eq!(
            client.await.expect("probe task").expect("probe result"),
            CodexCompactCapability::Supported,
        );
    }

    #[tokio::test]
    async fn compact_probe_preserves_other_invalid_request_errors() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let client = tokio::spawn(async move { connection.probe_compact_capability().await });

        let request = read_wire(&mut lines).await;
        write_wire(
            &mut writer,
            json!({
                "id": request["id"],
                "error": { "code": -32600, "message": "Invalid request envelope" }
            }),
        )
        .await;

        assert!(matches!(
            client.await.expect("probe task"),
            Err(CodexAppServerError::Rpc { code: -32600, .. })
        ));
    }

    #[tokio::test]
    async fn compact_probe_maps_method_not_found_to_unsupported() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let client = tokio::spawn(async move { connection.probe_compact_capability().await });

        let request = read_wire(&mut lines).await;
        write_wire(
            &mut writer,
            json!({
                "id": request["id"],
                "error": { "code": -32601, "message": "method not found" }
            }),
        )
        .await;

        assert_eq!(
            client.await.expect("probe task").expect("probe result"),
            CodexCompactCapability::Unsupported,
        );
    }

    #[tokio::test]
    async fn compact_probe_preserves_unexpected_rpc_errors() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let client = tokio::spawn(async move { connection.probe_compact_capability().await });

        let request = read_wire(&mut lines).await;
        write_wire(
            &mut writer,
            json!({
                "id": request["id"],
                "error": { "code": -32603, "message": "internal error" }
            }),
        )
        .await;

        assert!(matches!(
            client.await.expect("probe task"),
            Err(CodexAppServerError::Rpc { code: -32603, .. })
        ));
    }

    #[tokio::test]
    async fn compaction_history_confirms_matching_turn_and_item_ids() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let client = tokio::spawn(async move {
            connection
                .read_compaction_history(
                    "provider-thread-1",
                    Some("compact-turn-1"),
                    Some("compact-item-1"),
                )
                .await
        });

        let request = read_wire(&mut lines).await;
        assert_eq!(request["method"], "thread/read");
        assert_eq!(
            request["params"],
            json!({ "threadId": "provider-thread-1", "includeTurns": true })
        );
        write_wire(
            &mut writer,
            json!({
                "id": request["id"],
                "result": {
                    "thread": {
                        "id": "provider-thread-1",
                        "turns": [
                            {
                                "id": "other-turn",
                                "status": "completed",
                                "items": [{ "id": "other-item", "type": "contextCompaction" }]
                            },
                            {
                                "id": "compact-turn-1",
                                "status": "completed",
                                "items": [{ "id": "compact-item-1", "type": "contextCompaction" }]
                            }
                        ]
                    }
                }
            }),
        )
        .await;

        assert_eq!(
            client.await.expect("history task").expect("history result"),
            CodexCompactionHistoryState::Confirmed(CodexCompactionOutcome {
                provider_thread_id: "provider-thread-1".to_string(),
                provider_turn_id: "compact-turn-1".to_string(),
                provider_item_id: Some("compact-item-1".to_string()),
            })
        );
    }

    #[tokio::test]
    async fn compaction_history_resolves_a_single_saved_provider_id() {
        for (provider_turn_id, provider_item_id) in [
            (Some("compact-turn-1"), None),
            (None, Some("compact-item-1")),
        ] {
            let (mut connection, mut lines, mut writer) = mock_connection();
            let client = tokio::spawn(async move {
                connection
                    .read_compaction_history(
                        "provider-thread-1",
                        provider_turn_id,
                        provider_item_id,
                    )
                    .await
            });
            let request = read_wire(&mut lines).await;
            write_wire(
                &mut writer,
                json!({
                    "id": request["id"],
                    "result": {
                        "thread": {
                            "id": "provider-thread-1",
                            "turns": [{
                                "id": "compact-turn-1",
                                "status": "completed",
                                "items": [{ "id": "compact-item-1", "type": "contextCompaction" }]
                            }]
                        }
                    }
                }),
            )
            .await;
            assert!(matches!(
                client.await.expect("history task").expect("history result"),
                CodexCompactionHistoryState::Confirmed(_)
            ));
        }
    }

    #[tokio::test]
    async fn compaction_history_without_provider_ids_stays_unconfirmed() {
        let (mut connection, _lines, _writer) = mock_connection();
        assert_eq!(
            connection
                .read_compaction_history("provider-thread-1", None, None)
                .await
                .expect("history result"),
            CodexCompactionHistoryState::Unconfirmed
        );
    }

    #[tokio::test]
    async fn compaction_history_distinguishes_unconfirmed_from_not_found() {
        for (status, expected) in [
            ("failed", CodexCompactionHistoryState::Unconfirmed),
            ("completed", CodexCompactionHistoryState::NotFound),
        ] {
            let (mut connection, mut lines, mut writer) = mock_connection();
            let client = tokio::spawn(async move {
                connection
                    .read_compaction_history(
                        "provider-thread-1",
                        Some("compact-turn-1"),
                        Some("compact-item-1"),
                    )
                    .await
            });
            let request = read_wire(&mut lines).await;
            let (turn_id, item_id) = if status == "completed" {
                ("different-turn", "different-item")
            } else {
                ("compact-turn-1", "compact-item-1")
            };
            write_wire(
                &mut writer,
                json!({
                    "id": request["id"],
                    "result": {
                        "thread": {
                            "id": "provider-thread-1",
                            "turns": [{
                                "id": turn_id,
                                "status": status,
                                "items": [{ "id": item_id, "type": "contextCompaction" }]
                            }]
                        }
                    }
                }),
            )
            .await;
            assert_eq!(
                client.await.expect("history task").expect("history result"),
                expected
            );
        }
    }

    #[tokio::test]
    async fn compact_waits_for_context_item_and_successful_terminal_turn() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
        let mut client = tokio::spawn(async move {
            connection
                .start_compaction("thread-1", |event| {
                    let _ = event_sender.send(event);
                })
                .await
        });

        let request = read_wire(&mut lines).await;
        assert_eq!(request["method"], "thread/compact/start");
        assert_eq!(request["params"], json!({ "threadId": "thread-1" }));
        write_wire(&mut writer, json!({ "id": request["id"], "result": {} })).await;

        assert!(timeout(Duration::from_millis(25), &mut client)
            .await
            .is_err());
        write_wire(
            &mut writer,
            json!({
                "method": "turn/started",
                "params": { "threadId": "thread-1", "turn": { "id": "turn-compact-1" } }
            }),
        )
        .await;
        write_wire(
            &mut writer,
            json!({
                "method": "item/started",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-compact-1",
                    "item": { "id": "compact-item-1", "type": "contextCompaction" }
                }
            }),
        )
        .await;
        assert!(matches!(
            timeout(Duration::from_secs(2), event_receiver.recv())
                .await
                .expect("started event timeout")
                .expect("started event"),
            CodexCompactionEvent::Started {
                provider_turn_id: Some(turn_id),
                provider_item_id: Some(item_id),
            } if turn_id == "turn-compact-1" && item_id == "compact-item-1"
        ));

        write_wire(
            &mut writer,
            json!({
                "method": "item/completed",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-compact-1",
                    "item": { "id": "compact-item-1", "type": "contextCompaction" }
                }
            }),
        )
        .await;
        assert!(timeout(Duration::from_millis(25), &mut client)
            .await
            .is_err());
        write_wire(
            &mut writer,
            json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "thread-1",
                    "turn": { "id": "turn-compact-1", "status": "completed" }
                }
            }),
        )
        .await;

        let outcome = client
            .await
            .expect("compact task")
            .expect("compact outcome");
        assert_eq!(outcome.provider_thread_id, "thread-1");
        assert_eq!(outcome.provider_turn_id, "turn-compact-1");
        assert_eq!(outcome.provider_item_id.as_deref(), Some("compact-item-1"));
        assert!(matches!(
            timeout(Duration::from_secs(2), event_receiver.recv())
                .await
                .expect("completed event timeout")
                .expect("completed event"),
            CodexCompactionEvent::Completed {
                provider_turn_id,
                provider_item_id: Some(provider_item_id),
            } if provider_turn_id == "turn-compact-1" && provider_item_id == "compact-item-1"
        ));
    }

    #[tokio::test]
    async fn compact_rejects_completed_turn_without_context_item() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let mut client =
            tokio::spawn(async move { connection.start_compaction("thread-1", |_| {}).await });

        let request = read_wire(&mut lines).await;
        write_wire(&mut writer, json!({ "id": request["id"], "result": {} })).await;
        write_wire(
            &mut writer,
            json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "thread-1",
                    "turn": { "id": "turn-compact-1", "status": "completed" }
                }
            }),
        )
        .await;

        assert!(
            timeout(Duration::from_millis(25), &mut client)
                .await
                .is_err(),
            "completed turn without a contextCompaction item must not succeed"
        );
        write_wire(
            &mut writer,
            json!({
                "method": "item/completed",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-compact-1",
                    "item": { "id": "compact-item-1", "type": "contextCompaction" }
                }
            }),
        )
        .await;

        let outcome = client
            .await
            .expect("compact task")
            .expect("compact outcome");
        assert_eq!(outcome.provider_turn_id, "turn-compact-1");
        assert_eq!(outcome.provider_item_id.as_deref(), Some("compact-item-1"));
    }

    #[tokio::test]
    async fn compact_reports_failed_terminal_turn() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let client =
            tokio::spawn(async move { connection.start_compaction("thread-1", |_| {}).await });

        let request = read_wire(&mut lines).await;
        write_wire(&mut writer, json!({ "id": request["id"], "result": {} })).await;
        write_wire(
            &mut writer,
            json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "thread-1",
                    "turn": {
                        "id": "turn-compact-1",
                        "status": "failed",
                        "error": { "message": "compaction failed" }
                    }
                }
            }),
        )
        .await;

        assert!(matches!(
            client.await.expect("compact task"),
            Err(CodexAppServerError::Execution(message)) if message == "compaction failed"
        ));
    }

    #[tokio::test]
    async fn compact_reports_interrupted_terminal_turn() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let client =
            tokio::spawn(async move { connection.start_compaction("thread-1", |_| {}).await });

        let request = read_wire(&mut lines).await;
        write_wire(&mut writer, json!({ "id": request["id"], "result": {} })).await;
        write_wire(
            &mut writer,
            json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "thread-1",
                    "turn": { "id": "turn-compact-1", "status": "interrupted" }
                }
            }),
        )
        .await;

        assert!(matches!(
            client.await.expect("compact task"),
            Err(CodexAppServerError::Execution(message)) if message.contains("中断")
        ));
    }

    #[tokio::test]
    async fn compact_deduplicates_deprecated_thread_compacted() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
        let client = tokio::spawn(async move {
            connection
                .start_compaction("thread-1", |event| {
                    let _ = event_sender.send(event);
                })
                .await
        });

        let request = read_wire(&mut lines).await;
        write_wire(&mut writer, json!({ "id": request["id"], "result": {} })).await;
        write_wire(
            &mut writer,
            json!({
                "method": "item/started",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-compact-1",
                    "item": { "id": "compact-item-1", "type": "contextCompaction" }
                }
            }),
        )
        .await;
        write_wire(
            &mut writer,
            json!({
                "method": "thread/compacted",
                "params": { "threadId": "thread-1", "turnId": "turn-compact-1" }
            }),
        )
        .await;
        write_wire(
            &mut writer,
            json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "thread-1",
                    "turn": { "id": "turn-compact-1", "status": "completed" }
                }
            }),
        )
        .await;

        let mut client = client;
        assert!(
            timeout(Duration::from_millis(25), &mut client)
                .await
                .is_err(),
            "deprecated signal must not win after a contextCompaction item was observed"
        );
        write_wire(
            &mut writer,
            json!({
                "method": "item/completed",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-compact-1",
                    "item": { "id": "compact-item-1", "type": "contextCompaction" }
                }
            }),
        )
        .await;

        client
            .await
            .expect("compact task")
            .expect("compact outcome");
        let events = std::iter::from_fn(|| event_receiver.try_recv().ok()).collect::<Vec<_>>();
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event, CodexCompactionEvent::Completed { .. }))
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn automatic_compact_waits_for_successful_terminal_turn_before_completion_event() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let (_cancel_sender, cancel_receiver) = watch::channel(false);
        let (_control_sender, mut control_receiver) = mpsc::unbounded_channel();
        let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
        let cwd = PathBuf::from("D:/workspace");
        let client = tokio::spawn(async move {
            connection
                .run_text_turn(
                    "thread-1",
                    &cwd,
                    "continue",
                    "default",
                    None,
                    None,
                    cancel_receiver,
                    &mut control_receiver,
                    |event| {
                        let _ = event_sender.send(event);
                    },
                )
                .await
        });

        let start = read_wire(&mut lines).await;
        write_wire(
            &mut writer,
            json!({ "id": start["id"], "result": { "turn": { "id": "turn-1" } } }),
        )
        .await;
        write_wire(
            &mut writer,
            json!({
                "method": "item/started",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "item": { "id": "compact-item-1", "type": "contextCompaction" }
                }
            }),
        )
        .await;
        assert!(matches!(
            next_event(&mut event_receiver).await,
            CodexRuntimeEvent::CompactionStarted {
                provider_turn_id: Some(turn_id),
                provider_item_id: Some(item_id),
            } if turn_id == "turn-1" && item_id == "compact-item-1"
        ));

        write_wire(
            &mut writer,
            json!({
                "method": "item/completed",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "item": { "id": "compact-item-1", "type": "contextCompaction" }
                }
            }),
        )
        .await;
        assert!(
            timeout(Duration::from_millis(25), event_receiver.recv())
                .await
                .is_err(),
            "item completion must not emit compaction completion early"
        );

        write_wire(
            &mut writer,
            json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "thread-1",
                    "turn": { "id": "turn-1", "status": "completed" }
                }
            }),
        )
        .await;
        assert!(matches!(
            next_event(&mut event_receiver).await,
            CodexRuntimeEvent::CompactionCompleted {
                provider_turn_id,
                provider_item_id: Some(item_id),
            } if provider_turn_id == "turn-1" && item_id == "compact-item-1"
        ));
        let outcome = client.await.expect("client task").expect("turn outcome");
        assert_eq!(outcome.stop_reason, "end_turn");
    }

    #[test]
    fn codex_user_input_serializes_image_variants_from_current_app_server_schema() {
        let input = vec![
            CodexUserInput::Text {
                text: "检查截图".to_string(),
            },
            CodexUserInput::LocalImage {
                path: "D:/workspace/screenshot.png".to_string(),
            },
            CodexUserInput::Image {
                url: "data:image/png;base64,aGVsbG8=".to_string(),
            },
        ];

        assert_eq!(
            serde_json::to_value(input).expect("serialize Codex input"),
            json!([
                { "type": "text", "text": "检查截图" },
                { "type": "localImage", "path": "D:/workspace/screenshot.png" },
                { "type": "image", "url": "data:image/png;base64,aGVsbG8=" }
            ])
        );
    }

    async fn next_event(
        events: &mut mpsc::UnboundedReceiver<CodexRuntimeEvent>,
    ) -> CodexRuntimeEvent {
        timeout(Duration::from_secs(2), events.recv())
            .await
            .expect("runtime event timeout")
            .expect("runtime event channel closed")
    }

    #[test]
    fn permission_modes_map_to_codex_approval_and_sandbox_policies() {
        let cwd = Path::new("D:/workspace");
        let default = codex_turn_policy("default", cwd).expect("default policy");
        assert_eq!(default.approval_policy, "untrusted");
        assert_eq!(default.sandbox_policy["type"], "workspaceWrite");
        assert_eq!(default.sandbox_policy["networkAccess"], false);

        let auto = codex_turn_policy("auto", cwd).expect("auto policy");
        assert_eq!(auto.approval_policy, "on-request");
        assert_eq!(auto.sandbox_policy["type"], "workspaceWrite");

        let bypass = codex_turn_policy("bypassPermissions", cwd).expect("bypass policy");
        assert_eq!(bypass.approval_policy, "never");
        assert_eq!(bypass.sandbox_policy, json!({ "type": "dangerFullAccess" }));
        assert!(codex_turn_policy("unknown", cwd).is_none());
    }

    #[tokio::test]
    async fn initializes_and_starts_or_resumes_threads_over_jsonl() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let cwd = PathBuf::from("D:/workspace");
        let client = tokio::spawn(async move {
            connection.initialize("1.2.3").await?;
            let started = connection.start_or_resume_thread(None, &cwd).await?;
            let resumed = connection
                .start_or_resume_thread(Some("thread-existing"), &cwd)
                .await?;
            Ok::<_, CodexAppServerError>((started, resumed))
        });

        let initialize = read_wire(&mut lines).await;
        assert_eq!(initialize["method"], "initialize");
        assert_eq!(initialize["params"]["clientInfo"]["version"], "1.2.3");
        write_wire(&mut writer, json!({ "id": initialize["id"], "result": {} })).await;

        let initialized = read_wire(&mut lines).await;
        assert_eq!(
            initialized,
            json!({ "method": "initialized", "params": {} })
        );

        let start = read_wire(&mut lines).await;
        assert_eq!(start["method"], "thread/start");
        assert_eq!(start["params"]["serviceName"], "codem");
        write_wire(
            &mut writer,
            json!({ "id": start["id"], "result": { "thread": { "id": "thread-new" } } }),
        )
        .await;

        let resume = read_wire(&mut lines).await;
        assert_eq!(resume["method"], "thread/resume");
        assert_eq!(resume["params"]["threadId"], "thread-existing");
        write_wire(
            &mut writer,
            json!({ "id": resume["id"], "result": { "thread": { "id": "thread-existing" } } }),
        )
        .await;

        let (started, resumed) = client
            .await
            .expect("client task")
            .expect("thread lifecycle");
        assert_eq!(started, "thread-new");
        assert_eq!(resumed, "thread-existing");
    }

    #[tokio::test]
    async fn model_list_paginates_and_keeps_only_public_picker_fields() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let client = tokio::spawn(async move { connection.list_models().await });

        let first_page = read_wire(&mut lines).await;
        assert_eq!(first_page["method"], "model/list");
        assert_eq!(first_page["params"]["includeHidden"], false);
        assert_eq!(first_page["params"]["limit"], 100);
        assert!(first_page["params"]["cursor"].is_null());
        write_wire(
            &mut writer,
            json!({
                "id": first_page["id"],
                "result": {
                    "data": [
                        {
                            "id": "gpt-codex-default",
                            "model": "gpt-codex-default",
                            "displayName": "GPT Codex Default",
                            "description": "Default coding model",
                            "hidden": false,
                            "isDefault": true,
                            "defaultReasoningEffort": "medium",
                            "supportedReasoningEfforts": [
                                { "reasoningEffort": "low", "description": "Faster" },
                                { "reasoningEffort": "medium", "description": "Balanced" }
                            ],
                            "privateMetadata": "must-not-escape"
                        },
                        {
                            "id": "hidden-model",
                            "model": "hidden-model",
                            "displayName": "Hidden",
                            "description": "Hidden",
                            "hidden": true,
                            "isDefault": false,
                            "defaultReasoningEffort": "high",
                            "supportedReasoningEfforts": []
                        }
                    ],
                    "nextCursor": "page-2"
                }
            }),
        )
        .await;

        let second_page = read_wire(&mut lines).await;
        assert_eq!(second_page["method"], "model/list");
        assert_eq!(second_page["params"]["cursor"], "page-2");
        write_wire(
            &mut writer,
            json!({
                "id": second_page["id"],
                "result": {
                    "data": [{
                        "id": "gpt-codex-fast",
                        "model": "gpt-codex-fast",
                        "displayName": "GPT Codex Fast",
                        "description": "Fast coding model",
                        "hidden": false,
                        "isDefault": false,
                        "defaultReasoningEffort": "low",
                        "supportedReasoningEfforts": []
                    }],
                    "nextCursor": null
                }
            }),
        )
        .await;

        let models = client.await.expect("client task").expect("model catalog");
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gpt-codex-default");
        assert!(models[0].is_default);
        assert_eq!(
            models[0].default_reasoning_effort.as_deref(),
            Some("medium")
        );
        assert_eq!(models[0].supported_reasoning_efforts.len(), 2);
        assert_eq!(models[1].id, "gpt-codex-fast");
        assert_eq!(models[1].supported_reasoning_efforts[0].id, "low");
        let serialized = serde_json::to_string(&models).expect("serialize model catalog");
        assert!(!serialized.contains("privateMetadata"));
        assert!(!serialized.contains("must-not-escape"));
    }

    #[tokio::test]
    async fn streams_text_tools_and_resolves_codex_interactions() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let (cancel_sender, cancel_receiver) = watch::channel(false);
        let (control_sender, mut control_receiver) = mpsc::unbounded_channel();
        let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
        let cwd = PathBuf::from("D:/workspace");
        let client = tokio::spawn(async move {
            connection
                .run_text_turn(
                    "thread-1",
                    &cwd,
                    "inspect the project",
                    "auto",
                    Some("gpt-codex-test"),
                    Some("high"),
                    cancel_receiver,
                    &mut control_receiver,
                    |event| {
                        let _ = event_sender.send(event);
                    },
                )
                .await
        });

        let start = read_wire(&mut lines).await;
        assert_eq!(start["method"], "turn/start");
        assert_eq!(start["params"]["threadId"], "thread-1");
        assert_eq!(start["params"]["approvalPolicy"], "on-request");
        assert_eq!(start["params"]["sandboxPolicy"]["type"], "workspaceWrite");
        assert_eq!(start["params"]["input"][0]["text"], "inspect the project");
        assert_eq!(start["params"]["model"], "gpt-codex-test");
        assert_eq!(start["params"]["effort"], "high");
        write_wire(
            &mut writer,
            json!({ "id": start["id"], "result": { "turn": { "id": "turn-1" } } }),
        )
        .await;
        write_wire(
            &mut writer,
            json!({ "method": "turn/started", "params": { "threadId": "thread-1", "turn": { "id": "turn-1" } } }),
        )
        .await;
        write_wire(
            &mut writer,
            json!({ "method": "item/reasoning/summaryTextDelta", "params": { "threadId": "thread-1", "turnId": "turn-1", "itemId": "reasoning-1", "summaryIndex": 0, "delta": "private summary" } }),
        )
        .await;
        write_wire(
            &mut writer,
            json!({ "method": "item/agentMessage/delta", "params": { "threadId": "thread-1", "turnId": "turn-1", "delta": "hello" } }),
        )
        .await;
        write_wire(
            &mut writer,
            json!({ "method": "item/started", "params": { "threadId": "thread-1", "turnId": "turn-1", "item": { "id": "tool-1", "type": "commandExecution", "command": "pwd", "cwd": "D:/workspace", "status": "inProgress" } } }),
        )
        .await;
        write_wire(
            &mut writer,
            json!({ "method": "item/completed", "params": { "threadId": "thread-1", "turnId": "turn-1", "item": { "id": "tool-1", "type": "commandExecution", "command": "pwd", "cwd": "D:/workspace", "status": "completed", "exitCode": 0, "aggregatedOutput": "D:/workspace" } } }),
        )
        .await;

        assert!(matches!(
            next_event(&mut event_receiver).await,
            CodexRuntimeEvent::Thinking
        ));
        assert!(matches!(
            next_event(&mut event_receiver).await,
            CodexRuntimeEvent::TextDelta { text } if text == "hello"
        ));
        assert!(matches!(
            next_event(&mut event_receiver).await,
            CodexRuntimeEvent::ToolStarted { tool_id, name, .. }
                if tool_id == "tool-1" && name == "Bash"
        ));
        assert!(matches!(
            next_event(&mut event_receiver).await,
            CodexRuntimeEvent::ToolCompleted { tool_id, is_error: false, .. }
                if tool_id == "tool-1"
        ));
        write_wire(
            &mut writer,
            json!({ "method": "item/fileChange/patchUpdated", "params": { "threadId": "thread-1", "turnId": "turn-1", "itemId": "tool-2", "changes": [{ "path": "src/main.rs", "kind": { "type": "update" }, "diff": "@@ -1 +1 @@\n-old\n+new" }] } }),
        )
        .await;
        write_wire(
            &mut writer,
            json!({ "method": "item/completed", "params": { "threadId": "thread-1", "turnId": "turn-1", "item": { "id": "tool-2", "type": "fileChange", "status": "completed", "changes": [{ "path": "src/main.rs", "kind": "update" }] } } }),
        )
        .await;
        let file_change_event = next_event(&mut event_receiver).await;
        let CodexRuntimeEvent::ToolCompleted {
            tool_id,
            content,
            is_error: false,
        } = file_change_event
        else {
            panic!("expected completed file change event");
        };
        assert_eq!(tool_id, "tool-2");
        let file_change_content: Value =
            serde_json::from_str(&content).expect("file change content json");
        assert_eq!(
            file_change_content["changes"][0]["diff"],
            "@@ -1 +1 @@\n-old\n+new"
        );

        write_wire(
            &mut writer,
            json!({ "id": "approval-1", "method": "item/commandExecution/requestApproval", "params": { "threadId": "thread-1", "turnId": "turn-1", "command": "cargo test", "cwd": "D:/workspace", "reason": "run tests" } }),
        )
        .await;
        assert!(matches!(
            next_event(&mut event_receiver).await,
            CodexRuntimeEvent::ApprovalRequest { request }
                if request.request_id == "approval-1"
        ));
        let (approval_ack, approval_result) = oneshot::channel();
        control_sender
            .send(AgentControlCommand::Permission {
                request_id: "approval-1".to_string(),
                decision: AgentPermissionDecision::Approve,
                option_id: Some("accept".to_string()),
                acknowledgement: approval_ack,
            })
            .expect("submit approval");
        let approval_response = read_wire(&mut lines).await;
        assert_eq!(
            approval_response["method"],
            "item/commandExecution/requestApproval"
        );
        assert_eq!(approval_response["id"], "approval-1");
        assert_eq!(approval_response["response"]["decision"], "accept");
        approval_result
            .await
            .expect("approval acknowledgement")
            .expect("approval accepted");
        assert!(matches!(
            next_event(&mut event_receiver).await,
            CodexRuntimeEvent::InteractionResolved { request_id }
                if request_id == "approval-1"
        ));

        write_wire(
            &mut writer,
            json!({ "id": "input-1", "method": "item/tool/requestUserInput", "params": { "threadId": "thread-1", "turnId": "turn-1", "questions": [{ "id": "choice", "header": "Mode", "question": "Continue?", "options": [{ "label": "yes", "description": "continue" }] }] } }),
        )
        .await;
        assert!(matches!(
            next_event(&mut event_receiver).await,
            CodexRuntimeEvent::UserInputRequest { request }
                if request.request_id == "input-1" && request.questions.len() == 1
        ));
        let (input_ack, input_result) = oneshot::channel();
        let mut answers = Map::new();
        answers.insert("choice".to_string(), Value::String("yes".to_string()));
        control_sender
            .send(AgentControlCommand::UserInput {
                request_id: "input-1".to_string(),
                answers,
                acknowledgement: input_ack,
            })
            .expect("submit input");
        let input_response = read_wire(&mut lines).await;
        assert_eq!(input_response["method"], "item/tool/requestUserInput");
        assert_eq!(input_response["id"], "input-1");
        assert_eq!(
            input_response["response"]["answers"]["choice"]["answers"],
            json!(["yes"])
        );
        input_result
            .await
            .expect("input acknowledgement")
            .expect("input accepted");
        assert!(matches!(
            next_event(&mut event_receiver).await,
            CodexRuntimeEvent::InteractionResolved { request_id }
                if request_id == "input-1"
        ));

        write_wire(
            &mut writer,
            json!({ "method": "turn/completed", "params": { "threadId": "thread-1", "turn": { "id": "turn-1", "status": "completed" } } }),
        )
        .await;
        let outcome = client.await.expect("client task").expect("turn outcome");
        assert_eq!(outcome.stop_reason, "end_turn");
        assert_eq!(outcome.text, "hello");
        assert!(!outcome.text_truncated);
        assert!(!outcome.cancel_sent);
        drop(cancel_sender);
    }

    #[tokio::test]
    async fn cancellation_sends_turn_interrupt_and_waits_for_terminal_event() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let (cancel_sender, cancel_receiver) = watch::channel(false);
        let (control_sender, mut control_receiver) = mpsc::unbounded_channel();
        let cwd = PathBuf::from("D:/workspace");
        let client = tokio::spawn(async move {
            connection
                .run_text_turn(
                    "thread-1",
                    &cwd,
                    "stop me",
                    "default",
                    None,
                    None,
                    cancel_receiver,
                    &mut control_receiver,
                    |_| {},
                )
                .await
        });

        let start = read_wire(&mut lines).await;
        cancel_sender.send(true).expect("request cancellation");
        write_wire(
            &mut writer,
            json!({ "id": start["id"], "result": { "turn": { "id": "turn-1" } } }),
        )
        .await;
        write_wire(
            &mut writer,
            json!({ "method": "turn/status/changed", "params": { "threadId": "thread-1", "turnId": "turn-1" } }),
        )
        .await;
        assert!(
            timeout(Duration::from_millis(20), read_wire(&mut lines))
                .await
                .is_err(),
            "turn/start response alone must not trigger an early interrupt"
        );
        write_wire(
            &mut writer,
            json!({ "method": "turn/started", "params": { "threadId": "thread-1", "turn": { "id": "turn-1" } } }),
        )
        .await;

        let interrupt = read_wire(&mut lines).await;
        assert_eq!(start["method"], "turn/start");
        assert_eq!(interrupt["method"], "turn/interrupt");
        assert_eq!(interrupt["params"]["threadId"], "thread-1");
        assert_eq!(interrupt["params"]["turnId"], "turn-1");
        let (guide_ack, guide_result) = oneshot::channel();
        control_sender
            .send(AgentControlCommand::Guide {
                text: "too late".to_string(),
                acknowledgement: guide_ack,
            })
            .expect("submit guide while cancelling");
        let guide_error = guide_result
            .await
            .expect("guide acknowledgement")
            .expect_err("guide while cancelling must fail");
        assert!(guide_error.contains("正在停止"));
        write_wire(&mut writer, json!({ "id": interrupt["id"], "result": {} })).await;
        write_wire(
            &mut writer,
            json!({ "method": "turn/completed", "params": { "threadId": "thread-1", "turn": { "id": "turn-1", "status": "interrupted" } } }),
        )
        .await;

        let outcome = client.await.expect("client task").expect("cancelled turn");
        assert_eq!(outcome.stop_reason, "cancelled");
        assert!(outcome.cancel_sent);
    }

    #[tokio::test]
    async fn guide_does_not_write_when_cancel_is_requested_before_interrupt_is_sent() {
        let (mut connection, mut lines, _writer) = mock_connection();
        let mut guide_requests = HashMap::new();
        let (acknowledgement, acknowledgement_result) = oneshot::channel();

        connection
            .handle_guide_command(
                "thread-1",
                Some("turn-1"),
                true,
                false,
                false,
                "too late".to_string(),
                acknowledgement,
                &mut guide_requests,
            )
            .await
            .expect("reject guide without closing the connection");

        let error = acknowledgement_result
            .await
            .expect("guide acknowledgement")
            .expect_err("cancelled turn must reject guide");
        assert!(error.contains("正在停止"));
        assert!(guide_requests.is_empty());
        assert!(
            timeout(Duration::from_millis(20), lines.next_line())
                .await
                .is_err(),
            "cancelled turn must not write turn/steer"
        );
    }

    #[tokio::test]
    async fn guide_steers_the_active_turn_and_acknowledges_only_after_rpc_success() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let (_cancel_sender, cancel_receiver) = watch::channel(false);
        let (control_sender, mut control_receiver) = mpsc::unbounded_channel();
        let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
        let cwd = PathBuf::from("D:/workspace");
        let client = tokio::spawn(async move {
            connection
                .run_text_turn(
                    "thread-1",
                    &cwd,
                    "start",
                    "default",
                    None,
                    None,
                    cancel_receiver,
                    &mut control_receiver,
                    |event| {
                        let _ = event_sender.send(event);
                    },
                )
                .await
        });

        let start = read_wire(&mut lines).await;
        write_wire(
            &mut writer,
            json!({ "id": start["id"], "result": { "turn": { "id": "turn-1" } } }),
        )
        .await;
        write_wire(
            &mut writer,
            json!({ "method": "turn/started", "params": { "threadId": "thread-1", "turn": { "id": "turn-1" } } }),
        )
        .await;
        write_wire(
            &mut writer,
            json!({ "method": "item/reasoning/summaryTextDelta", "params": { "threadId": "thread-1", "turnId": "turn-1", "itemId": "reasoning-1", "summaryIndex": 0, "delta": "working" } }),
        )
        .await;
        assert!(matches!(
            next_event(&mut event_receiver).await,
            CodexRuntimeEvent::Thinking
        ));

        let (acknowledgement, acknowledgement_result) = oneshot::channel();
        control_sender
            .send(AgentControlCommand::Guide {
                text: "check the failing test".to_string(),
                acknowledgement,
            })
            .expect("submit guide");
        let steer = read_wire(&mut lines).await;
        assert_eq!(steer["method"], "turn/steer");
        assert_eq!(steer["params"]["threadId"], "thread-1");
        assert_eq!(steer["params"]["expectedTurnId"], "turn-1");
        assert_eq!(
            steer["params"]["input"],
            json!([{ "type": "text", "text": "check the failing test" }])
        );
        let mut acknowledgement_result = Box::pin(acknowledgement_result);
        assert!(
            timeout(Duration::from_millis(20), acknowledgement_result.as_mut())
                .await
                .is_err(),
            "guide must remain unacknowledged until the matching response"
        );

        write_wire(&mut writer, json!({ "id": steer["id"], "result": {} })).await;
        acknowledgement_result
            .await
            .expect("guide acknowledgement")
            .expect("guide accepted");
        write_wire(
            &mut writer,
            json!({ "id": "approval-1", "method": "item/commandExecution/requestApproval", "params": { "threadId": "thread-1", "turnId": "turn-1", "command": "cargo test", "cwd": "D:/workspace", "reason": "run tests" } }),
        )
        .await;
        assert!(matches!(
            next_event(&mut event_receiver).await,
            CodexRuntimeEvent::ApprovalRequest { request }
                if request.request_id == "approval-1"
        ));
        let (pending_guide_ack, pending_guide_result) = oneshot::channel();
        control_sender
            .send(AgentControlCommand::Guide {
                text: "answer before approval".to_string(),
                acknowledgement: pending_guide_ack,
            })
            .expect("submit guide while approval is pending");
        let pending_guide_error = pending_guide_result
            .await
            .expect("guide acknowledgement")
            .expect_err("guide while approval is pending must fail");
        assert!(pending_guide_error.contains("等待审批或回答"));
        assert!(
            timeout(Duration::from_millis(20), lines.next_line())
                .await
                .is_err(),
            "rejected guide must not write a request"
        );
        write_wire(
            &mut writer,
            json!({ "method": "turn/completed", "params": { "threadId": "thread-1", "turn": { "id": "turn-1", "status": "completed" } } }),
        )
        .await;
        client.await.expect("client task").expect("turn outcome");
    }

    #[tokio::test]
    async fn guide_without_an_active_turn_is_rejected_without_writing_to_the_wire() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let (_cancel_sender, cancel_receiver) = watch::channel(false);
        let (control_sender, mut control_receiver) = mpsc::unbounded_channel();
        let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
        let cwd = PathBuf::from("D:/workspace");
        let client = tokio::spawn(async move {
            connection
                .run_text_turn(
                    "thread-1",
                    &cwd,
                    "start",
                    "default",
                    None,
                    None,
                    cancel_receiver,
                    &mut control_receiver,
                    |event| {
                        let _ = event_sender.send(event);
                    },
                )
                .await
        });

        let start = read_wire(&mut lines).await;
        let (acknowledgement, acknowledgement_result) = oneshot::channel();
        control_sender
            .send(AgentControlCommand::Guide {
                text: "too early".to_string(),
                acknowledgement,
            })
            .expect("submit guide");
        let error = acknowledgement_result
            .await
            .expect("guide acknowledgement")
            .expect_err("guide without active turn must fail");
        assert!(error.contains("活动 turn"));
        assert!(
            timeout(Duration::from_millis(20), lines.next_line())
                .await
                .is_err(),
            "rejected guide must not write a request"
        );

        write_wire(
            &mut writer,
            json!({ "id": start["id"], "result": { "turn": { "id": "turn-1" } } }),
        )
        .await;
        write_wire(
            &mut writer,
            json!({ "method": "turn/started", "params": { "threadId": "thread-1", "turn": { "id": "turn-1" } } }),
        )
        .await;
        write_wire(
            &mut writer,
            json!({ "method": "item/reasoning/summaryTextDelta", "params": { "threadId": "thread-1", "turnId": "turn-1", "itemId": "reasoning-1", "summaryIndex": 0, "delta": "working" } }),
        )
        .await;
        assert!(matches!(
            next_event(&mut event_receiver).await,
            CodexRuntimeEvent::Thinking
        ));
        write_wire(
            &mut writer,
            json!({ "method": "turn/completed", "params": { "threadId": "thread-1", "turn": { "id": "turn-1", "status": "completed" } } }),
        )
        .await;
        client.await.expect("client task").expect("turn outcome");
    }

    #[tokio::test]
    async fn guide_rpc_error_is_acknowledged_as_a_known_failure() {
        let (mut connection, mut lines, mut writer) = mock_connection();
        let (_cancel_sender, cancel_receiver) = watch::channel(false);
        let (control_sender, mut control_receiver) = mpsc::unbounded_channel();
        let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
        let cwd = PathBuf::from("D:/workspace");
        let client = tokio::spawn(async move {
            connection
                .run_text_turn(
                    "thread-1",
                    &cwd,
                    "start",
                    "default",
                    None,
                    None,
                    cancel_receiver,
                    &mut control_receiver,
                    |event| {
                        let _ = event_sender.send(event);
                    },
                )
                .await
        });

        let start = read_wire(&mut lines).await;
        write_wire(
            &mut writer,
            json!({ "id": start["id"], "result": { "turn": { "id": "turn-1" } } }),
        )
        .await;
        write_wire(
            &mut writer,
            json!({ "method": "turn/started", "params": { "threadId": "thread-1", "turn": { "id": "turn-1" } } }),
        )
        .await;
        write_wire(
            &mut writer,
            json!({ "method": "item/reasoning/summaryTextDelta", "params": { "threadId": "thread-1", "turnId": "turn-1", "itemId": "reasoning-1", "summaryIndex": 0, "delta": "working" } }),
        )
        .await;
        assert!(matches!(
            next_event(&mut event_receiver).await,
            CodexRuntimeEvent::Thinking
        ));

        let (acknowledgement, acknowledgement_result) = oneshot::channel();
        control_sender
            .send(AgentControlCommand::Guide {
                text: "unsupported steer".to_string(),
                acknowledgement,
            })
            .expect("submit guide");
        let steer = read_wire(&mut lines).await;
        write_wire(
            &mut writer,
            json!({
                "id": steer["id"],
                "error": { "code": -32601, "message": "Method not found: turn/steer" }
            }),
        )
        .await;
        let error = acknowledgement_result
            .await
            .expect("guide acknowledgement")
            .expect_err("RPC rejection must fail the guide");
        assert!(error.contains("Method not found"));

        write_wire(
            &mut writer,
            json!({ "method": "turn/completed", "params": { "threadId": "thread-1", "turn": { "id": "turn-1", "status": "completed" } } }),
        )
        .await;
        client.await.expect("client task").expect("turn outcome");
    }

    #[test]
    fn guide_response_requires_result_or_explicit_rpc_error() {
        assert_eq!(classify_guide_response(Some(json!({})), None), Some(Ok(())));
        assert!(matches!(
            classify_guide_response(
                None,
                Some(CodexRpcError {
                    code: -32601,
                    message: "Method not found".to_string(),
                }),
            ),
            Some(Err(message)) if message.contains("Method not found")
        ));
        assert_eq!(classify_guide_response(None, None), None);
    }

    #[test]
    fn tool_payloads_redact_secrets_and_bound_nested_content() {
        let sanitized = sanitize_json_value(
            &json!({
                "authorization": "Bearer secret",
                "nested": { "apiKey": "secret", "visible": "ok" },
            }),
            0,
        );
        assert_eq!(sanitized["authorization"], "[redacted]");
        assert_eq!(sanitized["nested"]["apiKey"], "[redacted]");
        assert_eq!(sanitized["nested"]["visible"], "ok");
    }
}
