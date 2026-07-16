use crate::agent_runtime::{AgentControlCommand, AgentPermissionDecision, AgentUsageSnapshot};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    path::Path,
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{mpsc, watch},
    task::JoinHandle,
    time::{sleep, timeout},
};

const JSONRPC_VERSION: &str = "2.0";
const MAX_AGENT_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_EVENT_TEXT_BYTES: usize = 256 * 1024;
const MAX_JSON_STRING_BYTES: usize = 8 * 1024;
const MAX_JSON_ARRAY_ITEMS: usize = 32;
const MAX_JSON_OBJECT_FIELDS: usize = 64;
const MAX_JSON_DEPTH: usize = 6;
pub const ACP_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
pub const ACP_PROMPT_TIMEOUT: Duration = Duration::from_secs(5 * 60);

#[derive(Debug)]
pub enum AcpError {
    Io(std::io::Error),
    Json(serde_json::Error),
    Rpc { code: i64, message: String },
    Protocol(String),
    Timeout(&'static str),
}

impl AcpError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::Io(_) => "ACP 子进程通信失败",
            Self::Json(_) => "ACP Provider 返回了无效 JSON",
            Self::Rpc { .. } => "ACP Provider 拒绝了请求",
            Self::Protocol(_) => "ACP Provider 返回了不兼容的协议消息",
            Self::Timeout(_) => "ACP Provider 响应超时",
        }
    }
}

impl fmt::Display for AcpError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "ACP I/O error: {error}"),
            Self::Json(error) => write!(formatter, "ACP JSON error: {error}"),
            Self::Rpc { code, message } => write!(formatter, "ACP RPC error {code}: {message}"),
            Self::Protocol(message) => write!(formatter, "ACP protocol error: {message}"),
            Self::Timeout(operation) => write!(formatter, "ACP timeout: {operation}"),
        }
    }
}

impl std::error::Error for AcpError {}

impl From<std::io::Error> for AcpError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for AcpError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpAuthMethodSummary {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpModelSummary {
    pub model_id: String,
    pub name: String,
    pub context_tokens: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpPromptCapabilities {
    pub image: bool,
    pub audio: bool,
    pub embedded_context: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpMcpCapabilities {
    pub http: bool,
    pub sse: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpInitializeSummary {
    pub protocol_version: u64,
    pub load_session: bool,
    pub prompt_capabilities: AcpPromptCapabilities,
    pub mcp_capabilities: AcpMcpCapabilities,
    pub auth_methods: Vec<AcpAuthMethodSummary>,
    pub default_auth_method_id: Option<String>,
    pub agent_version: Option<String>,
    pub current_model_id: Option<String>,
    pub models: Vec<AcpModelSummary>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpProbeSummary {
    pub initialize: AcpInitializeSummary,
    pub authenticated: bool,
    pub auth_method_id: Option<String>,
    pub auth_error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpSessionSummary {
    pub session_id: String,
    pub current_model_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpPromptOutcome {
    pub stop_reason: String,
    pub text: String,
    pub text_truncated: bool,
    pub thought_chunk_count: u64,
    pub update_counts: BTreeMap<String, u64>,
    pub client_request_methods: Vec<String>,
    pub cancel_sent: bool,
    pub usage: AgentUsageSnapshot,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpEmbeddedResource {
    pub uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "type")]
pub enum AcpPromptInput {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image {
        #[serde(rename = "mimeType")]
        mime_type: String,
        data: String,
    },
    #[serde(rename = "resource")]
    Resource { resource: AcpEmbeddedResource },
    #[serde(rename = "resource_link")]
    ResourceLink {
        uri: String,
        name: String,
        #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
        mime_type: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        size: Option<u64>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpPermissionOption {
    pub option_id: String,
    pub name: String,
    pub kind: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpToolCall {
    pub tool_call_id: String,
    pub title: String,
    pub kind: Option<String>,
    pub status: Option<String>,
    pub input: Option<Value>,
    pub content: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpToolCallUpdate {
    pub tool_call_id: String,
    pub title: Option<String>,
    pub kind: Option<String>,
    pub status: Option<String>,
    pub input: Option<Value>,
    pub content: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpPermissionRequest {
    #[serde(skip_serializing)]
    pub session_id: String,
    pub request_id: String,
    pub tool_call_id: String,
    pub title: String,
    pub options: Vec<AcpPermissionOption>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpUserInputOption {
    pub label: String,
    pub value: String,
    pub description: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpUserInputQuestion {
    pub id: String,
    pub header: Option<String>,
    pub question: String,
    pub input_type: String,
    pub options: Vec<AcpUserInputOption>,
    pub multi_select: bool,
    pub required: bool,
    pub secret: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpUserInputRequest {
    #[serde(skip_serializing)]
    pub session_id: String,
    pub request_id: String,
    pub title: Option<String>,
    pub description: String,
    pub questions: Vec<AcpUserInputQuestion>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum AcpRuntimeEvent {
    TextDelta { text: String },
    ThoughtChunk,
    Usage { usage: AgentUsageSnapshot },
    ToolCall { call: AcpToolCall },
    ToolCallUpdate { update: AcpToolCallUpdate },
    PermissionRequest { request: AcpPermissionRequest },
    UserInputRequest { request: AcpUserInputRequest },
    InteractionResolved { request_id: String },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AcpPermissionPolicy {
    Interactive,
    AutoApproveOnce,
    AutoApproveAlways,
}

#[derive(Debug)]
enum AcpMessage {
    Response {
        id: Value,
        result: Option<Value>,
        error: Option<AcpRpcError>,
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
struct AcpRpcError {
    code: i64,
    message: String,
}

pub struct AcpConnection<R, W> {
    lines: Lines<BufReader<R>>,
    writer: W,
    next_request_id: u64,
}

impl<R, W> AcpConnection<R, W>
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

    pub async fn initialize(
        &mut self,
        client_name: &str,
        client_title: &str,
        client_version: &str,
    ) -> Result<AcpInitializeSummary, AcpError> {
        let result = self
            .request(
                "initialize",
                json!({
                    "protocolVersion": 1,
                    "clientCapabilities": {
                        "fs": {
                            "readTextFile": false,
                            "writeTextFile": false,
                        },
                        "terminal": false,
                        "elicitation": {
                            "form": {},
                        },
                    },
                    "clientInfo": {
                        "name": client_name,
                        "title": client_title,
                        "version": client_version,
                    },
                }),
                ACP_REQUEST_TIMEOUT,
            )
            .await?;
        summarize_initialize_result(&result)
    }

    pub async fn authenticate(&mut self, method_id: &str) -> Result<(), AcpError> {
        // The response may contain account details. Deliberately discard the entire payload.
        self.request(
            "authenticate",
            json!({ "methodId": method_id }),
            ACP_REQUEST_TIMEOUT,
        )
        .await?;
        Ok(())
    }

    pub async fn new_session(&mut self, cwd: &Path) -> Result<AcpSessionSummary, AcpError> {
        let result = self
            .request(
                "session/new",
                json!({
                    "cwd": cwd.to_string_lossy(),
                    "mcpServers": [],
                }),
                ACP_REQUEST_TIMEOUT,
            )
            .await?;
        summarize_session_result(&result, None)
    }

    pub async fn load_session(
        &mut self,
        session_id: &str,
        cwd: &Path,
    ) -> Result<AcpSessionSummary, AcpError> {
        let result = self
            .request(
                "session/load",
                json!({
                    "sessionId": session_id,
                    "cwd": cwd.to_string_lossy(),
                    "mcpServers": [],
                }),
                ACP_REQUEST_TIMEOUT,
            )
            .await?;
        summarize_session_result(&result, Some(session_id))
    }

    pub async fn set_model(&mut self, session_id: &str, model_id: &str) -> Result<(), AcpError> {
        // Grok Build 0.2.x still exposes this ACP compatibility method even though
        // newer ACP drafts model selection as a config option.
        self.request(
            "session/set_model",
            json!({
                "sessionId": session_id,
                "modelId": model_id,
            }),
            ACP_REQUEST_TIMEOUT,
        )
        .await?;
        Ok(())
    }

    pub async fn set_config_option(
        &mut self,
        session_id: &str,
        config_id: &str,
        value: &str,
    ) -> Result<(), AcpError> {
        self.request(
            "session/set_config_option",
            json!({
                "sessionId": session_id,
                "configId": config_id,
                "value": value,
            }),
            ACP_REQUEST_TIMEOUT,
        )
        .await?;
        Ok(())
    }

    pub async fn prompt_text(
        &mut self,
        session_id: &str,
        text: &str,
        cancel: watch::Receiver<bool>,
    ) -> Result<AcpPromptOutcome, AcpError> {
        let (control_sender, mut control) = mpsc::unbounded_channel();
        drop(control_sender);
        self.prompt_text_stream(session_id, text, cancel, &mut control, |_| {})
            .await
    }

    pub async fn prompt_text_stream<F>(
        &mut self,
        session_id: &str,
        text: &str,
        cancel: watch::Receiver<bool>,
        control: &mut mpsc::UnboundedReceiver<AgentControlCommand>,
        on_event: F,
    ) -> Result<AcpPromptOutcome, AcpError>
    where
        F: FnMut(AcpRuntimeEvent),
    {
        let prompt = [AcpPromptInput::Text {
            text: text.to_string(),
        }];
        self.prompt_stream(session_id, &prompt, cancel, control, on_event)
            .await
    }

    pub async fn prompt_stream<F>(
        &mut self,
        session_id: &str,
        prompt: &[AcpPromptInput],
        cancel: watch::Receiver<bool>,
        control: &mut mpsc::UnboundedReceiver<AgentControlCommand>,
        on_event: F,
    ) -> Result<AcpPromptOutcome, AcpError>
    where
        F: FnMut(AcpRuntimeEvent),
    {
        self.prompt_stream_with_permission_policy(
            session_id,
            prompt,
            cancel,
            control,
            AcpPermissionPolicy::Interactive,
            on_event,
        )
        .await
    }

    pub async fn prompt_stream_with_permission_policy<F>(
        &mut self,
        session_id: &str,
        prompt: &[AcpPromptInput],
        mut cancel: watch::Receiver<bool>,
        control: &mut mpsc::UnboundedReceiver<AgentControlCommand>,
        permission_policy: AcpPermissionPolicy,
        mut on_event: F,
    ) -> Result<AcpPromptOutcome, AcpError>
    where
        F: FnMut(AcpRuntimeEvent),
    {
        let request_id = self
            .send_request(
                "session/prompt",
                json!({
                    "sessionId": session_id,
                    "prompt": prompt,
                }),
            )
            .await?;
        let mut outcome = AcpPromptOutcome {
            stop_reason: String::new(),
            text: String::new(),
            text_truncated: false,
            thought_chunk_count: 0,
            update_counts: BTreeMap::new(),
            client_request_methods: Vec::new(),
            cancel_sent: false,
            usage: AgentUsageSnapshot::default(),
        };
        let mut cancel_channel_open = true;
        let deadline = sleep(ACP_PROMPT_TIMEOUT);
        tokio::pin!(deadline);

        if *cancel.borrow() {
            self.send_cancel(session_id).await?;
            outcome.cancel_sent = true;
        }

        loop {
            tokio::select! {
                _ = &mut deadline => return Err(AcpError::Timeout("session/prompt")),
                changed = cancel.changed(), if cancel_channel_open && !outcome.cancel_sent => {
                    match changed {
                        Ok(()) if *cancel.borrow() => {
                            self.send_cancel(session_id).await?;
                            outcome.cancel_sent = true;
                        }
                        Ok(()) => {}
                        Err(_) => cancel_channel_open = false,
                    }
                }
                message = self.read_message() => {
                    match message? {
                        AcpMessage::Response { id, result, error } if id == json!(request_id) => {
                            let result = finish_response(result, error)?;
                            let reported_stop_reason = result
                                .get("stopReason")
                                .and_then(Value::as_str)
                                .ok_or_else(|| AcpError::Protocol("session/prompt 缺少 stopReason".to_string()))?
                                .to_string();
                            outcome.stop_reason = if outcome.cancel_sent {
                                "cancelled".to_string()
                            } else {
                                reported_stop_reason
                            };
                            let final_usage = parse_acp_usage(
                                result
                                    .get("usage")
                                    .or_else(|| result.get("_meta").and_then(|value| value.get("usage"))),
                            );
                            outcome.usage = final_usage;
                            return Ok(outcome);
                        }
                        AcpMessage::Request { id, method, params } => {
                            outcome.client_request_methods.push(method.clone());
                            match method.as_str() {
                                "session/request_permission" => {
                                    let request = parse_permission_request(session_id, &id, &params)?;
                                    let cancelled = self
                                        .handle_permission_request(
                                            id,
                                            request,
                                            &mut cancel,
                                            control,
                                            permission_policy,
                                            outcome.cancel_sent,
                                            &mut on_event,
                                        )
                                        .await?;
                                    outcome.cancel_sent |= cancelled;
                                }
                                "elicitation/create" => {
                                    let request = parse_user_input_request(session_id, &id, &params)?;
                                    let cancelled = self
                                        .handle_user_input_request(
                                            id,
                                            request,
                                            &mut cancel,
                                            control,
                                            outcome.cancel_sent,
                                            &mut on_event,
                                        )
                                        .await?;
                                    outcome.cancel_sent |= cancelled;
                                }
                                _ => self.respond_to_server_request(id, &method, &params).await?,
                            }
                        }
                        AcpMessage::Notification { method, params } if method == "session/update" => {
                            for event in collect_session_update(session_id, &params, &mut outcome) {
                                on_event(event);
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    async fn handle_permission_request<F>(
        &mut self,
        rpc_id: Value,
        request: AcpPermissionRequest,
        cancel: &mut watch::Receiver<bool>,
        control: &mut mpsc::UnboundedReceiver<AgentControlCommand>,
        permission_policy: AcpPermissionPolicy,
        cancel_already_sent: bool,
        on_event: &mut F,
    ) -> Result<bool, AcpError>
    where
        F: FnMut(AcpRuntimeEvent),
    {
        let request_id = request.request_id.clone();
        if *cancel.borrow() {
            if permission_policy == AcpPermissionPolicy::Interactive {
                on_event(AcpRuntimeEvent::PermissionRequest {
                    request: request.clone(),
                });
            }
            if !cancel_already_sent {
                self.send_cancel_request(&request, &rpc_id).await?;
            } else {
                self.respond_result(rpc_id, json!({ "outcome": { "outcome": "cancelled" } }))
                    .await?;
            }
            on_event(AcpRuntimeEvent::InteractionResolved { request_id });
            return Ok(true);
        }
        if let Some(option_id) = automatic_permission_option(&request.options, permission_policy) {
            self.respond_result(
                rpc_id,
                json!({
                    "outcome": {
                        "outcome": "selected",
                        "optionId": option_id,
                    },
                }),
            )
            .await?;
            on_event(AcpRuntimeEvent::InteractionResolved { request_id });
            return Ok(cancel_already_sent);
        }
        on_event(AcpRuntimeEvent::PermissionRequest {
            request: request.clone(),
        });
        let mut cancel_channel_open = true;

        loop {
            tokio::select! {
                changed = cancel.changed(), if cancel_channel_open => {
                    match changed {
                        Ok(()) if *cancel.borrow() => {
                            if !cancel_already_sent {
                                self.send_cancel_request(&request, &rpc_id).await?;
                            } else {
                                self.respond_result(
                                    rpc_id,
                                    json!({ "outcome": { "outcome": "cancelled" } }),
                                ).await?;
                            }
                            on_event(AcpRuntimeEvent::InteractionResolved { request_id });
                            return Ok(true);
                        }
                        Ok(()) => {}
                        Err(_) => cancel_channel_open = false,
                    }
                }
                command = control.recv() => {
                    let Some(command) = command else {
                        self.respond_result(
                            rpc_id,
                            json!({ "outcome": { "outcome": "cancelled" } }),
                        ).await?;
                        on_event(AcpRuntimeEvent::InteractionResolved { request_id });
                        return Ok(cancel_already_sent);
                    };
                    match command {
                        AgentControlCommand::Permission {
                            request_id: submitted_request_id,
                            decision,
                            option_id,
                            acknowledgement,
                        } => {
                            if submitted_request_id != request_id {
                                let _ = acknowledgement.send(Err("权限请求 ID 与当前待处理请求不匹配".to_string()));
                                continue;
                            }
                            let selected_option_id = match select_permission_option(
                                &request.options,
                                decision,
                                option_id.as_deref(),
                            ) {
                                Ok(option_id) => option_id,
                                Err(message) => {
                                    let _ = acknowledgement.send(Err(message));
                                    continue;
                                }
                            };
                            if let Err(error) = self.respond_result(
                                rpc_id,
                                json!({
                                    "outcome": {
                                        "outcome": "selected",
                                        "optionId": selected_option_id,
                                    },
                                }),
                            ).await {
                                let _ = acknowledgement.send(Err(error.public_message().to_string()));
                                return Err(error);
                            }
                            let _ = acknowledgement.send(Ok(()));
                            on_event(AcpRuntimeEvent::InteractionResolved { request_id });
                            return Ok(cancel_already_sent);
                        }
                        AgentControlCommand::UserInput { acknowledgement, .. } => {
                            let _ = acknowledgement.send(Err("当前 Agent 正在等待权限决定".to_string()));
                        }
                    }
                }
            }
        }
    }

    async fn handle_user_input_request<F>(
        &mut self,
        rpc_id: Value,
        request: AcpUserInputRequest,
        cancel: &mut watch::Receiver<bool>,
        control: &mut mpsc::UnboundedReceiver<AgentControlCommand>,
        cancel_already_sent: bool,
        on_event: &mut F,
    ) -> Result<bool, AcpError>
    where
        F: FnMut(AcpRuntimeEvent),
    {
        let request_id = request.request_id.clone();
        on_event(AcpRuntimeEvent::UserInputRequest {
            request: request.clone(),
        });
        if *cancel.borrow() {
            if !cancel_already_sent {
                self.send_cancel(&request.session_id).await?;
            }
            self.respond_result(rpc_id, json!({ "action": "cancel" }))
                .await?;
            on_event(AcpRuntimeEvent::InteractionResolved { request_id });
            return Ok(true);
        }
        let mut cancel_channel_open = true;

        loop {
            tokio::select! {
                changed = cancel.changed(), if cancel_channel_open => {
                    match changed {
                        Ok(()) if *cancel.borrow() => {
                            if !cancel_already_sent {
                                self.send_cancel(&request.session_id).await?;
                            }
                            self.respond_result(rpc_id, json!({ "action": "cancel" })).await?;
                            on_event(AcpRuntimeEvent::InteractionResolved { request_id });
                            return Ok(true);
                        }
                        Ok(()) => {}
                        Err(_) => cancel_channel_open = false,
                    }
                }
                command = control.recv() => {
                    let Some(command) = command else {
                        self.respond_result(rpc_id, json!({ "action": "cancel" })).await?;
                        on_event(AcpRuntimeEvent::InteractionResolved { request_id });
                        return Ok(cancel_already_sent);
                    };
                    match command {
                        AgentControlCommand::UserInput {
                            request_id: submitted_request_id,
                            answers,
                            acknowledgement,
                        } => {
                            if submitted_request_id != request_id {
                                let _ = acknowledgement.send(Err("提问请求 ID 与当前待处理请求不匹配".to_string()));
                                continue;
                            }
                            let answers = match validate_user_input_answers(&request, answers) {
                                Ok(answers) => answers,
                                Err(message) => {
                                    let _ = acknowledgement.send(Err(message));
                                    continue;
                                }
                            };
                            if let Err(error) = self.respond_result(
                                rpc_id,
                                json!({ "action": "accept", "content": answers }),
                            ).await {
                                let _ = acknowledgement.send(Err(error.public_message().to_string()));
                                return Err(error);
                            }
                            let _ = acknowledgement.send(Ok(()));
                            on_event(AcpRuntimeEvent::InteractionResolved { request_id });
                            return Ok(cancel_already_sent);
                        }
                        AgentControlCommand::Permission { acknowledgement, .. } => {
                            let _ = acknowledgement.send(Err("当前 Agent 正在等待用户输入".to_string()));
                        }
                    }
                }
            }
        }
    }

    async fn send_cancel_request(
        &mut self,
        request: &AcpPermissionRequest,
        rpc_id: &Value,
    ) -> Result<(), AcpError> {
        self.send_cancel(&request.session_id).await?;
        self.respond_result(
            rpc_id.clone(),
            json!({ "outcome": { "outcome": "cancelled" } }),
        )
        .await
    }

    pub async fn send_cancel(&mut self, session_id: &str) -> Result<(), AcpError> {
        self.send_notification(
            "session/cancel",
            json!({
                "sessionId": session_id,
            }),
        )
        .await
    }

    async fn request(
        &mut self,
        method: &str,
        params: Value,
        timeout_duration: Duration,
    ) -> Result<Value, AcpError> {
        let request_id = self.send_request(method, params).await?;
        timeout(timeout_duration, self.wait_for_response(request_id))
            .await
            .map_err(|_| AcpError::Timeout("request"))?
    }

    async fn wait_for_response(&mut self, request_id: u64) -> Result<Value, AcpError> {
        loop {
            match self.read_message().await? {
                AcpMessage::Response { id, result, error } if id == json!(request_id) => {
                    return finish_response(result, error);
                }
                AcpMessage::Request { id, method, params } => {
                    self.respond_to_server_request(id, &method, &params).await?;
                }
                _ => {}
            }
        }
    }

    async fn send_request(&mut self, method: &str, params: Value) -> Result<u64, AcpError> {
        let request_id = self.next_request_id;
        self.next_request_id += 1;
        self.write_message(&json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": request_id,
            "method": method,
            "params": params,
        }))
        .await?;
        Ok(request_id)
    }

    async fn send_notification(&mut self, method: &str, params: Value) -> Result<(), AcpError> {
        self.write_message(&json!({
            "jsonrpc": JSONRPC_VERSION,
            "method": method,
            "params": params,
        }))
        .await
    }

    async fn respond_to_server_request(
        &mut self,
        id: Value,
        method: &str,
        _params: &Value,
    ) -> Result<(), AcpError> {
        let response = if method == "session/request_permission" {
            json!({
                "jsonrpc": JSONRPC_VERSION,
                "id": id,
                "result": {
                    "outcome": {
                        "outcome": "cancelled",
                    },
                },
            })
        } else {
            json!({
                "jsonrpc": JSONRPC_VERSION,
                "id": id,
                "error": {
                    "code": -32601,
                    "message": "CodeM ACP POC does not support this client request",
                },
            })
        };
        self.write_message(&response).await
    }

    async fn respond_result(&mut self, id: Value, result: Value) -> Result<(), AcpError> {
        self.write_message(&json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": id,
            "result": result,
        }))
        .await
    }

    async fn write_message(&mut self, message: &Value) -> Result<(), AcpError> {
        let payload = serde_json::to_vec(message)?;
        self.writer.write_all(&payload).await?;
        self.writer.write_all(b"\n").await?;
        self.writer.flush().await?;
        Ok(())
    }

    async fn read_message(&mut self) -> Result<AcpMessage, AcpError> {
        loop {
            let line = self
                .lines
                .next_line()
                .await?
                .ok_or_else(|| AcpError::Protocol("ACP stdout 已关闭".to_string()))?;
            if line.trim().is_empty() {
                continue;
            }
            return parse_message(&line);
        }
    }
}

pub struct AcpStdioClient {
    child: Child,
    connection: AcpConnection<ChildStdout, ChildStdin>,
    stderr_task: JoinHandle<()>,
}

impl AcpStdioClient {
    pub async fn spawn(program: &str, arguments: &[&str], cwd: &Path) -> Result<Self, AcpError> {
        Self::spawn_with_env(program, arguments, cwd, &BTreeMap::new()).await
    }

    pub async fn spawn_with_env(
        program: &str,
        arguments: &[&str],
        cwd: &Path,
        environment: &BTreeMap<String, String>,
    ) -> Result<Self, AcpError> {
        let mut command = Command::new(program);
        command
            .args(arguments)
            .envs(environment)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        configure_background_command(&mut command);
        let mut child = command.spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AcpError::Protocol("ACP stdin 不可用".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AcpError::Protocol("ACP stdout 不可用".to_string()))?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or_else(|| AcpError::Protocol("ACP stderr 不可用".to_string()))?;
        let stderr_task = tokio::spawn(async move {
            let mut buffer = [0_u8; 4096];
            while stderr.read(&mut buffer).await.is_ok_and(|read| read > 0) {}
        });

        Ok(Self {
            child,
            connection: AcpConnection::new(stdout, stdin),
            stderr_task,
        })
    }

    pub async fn initialize(
        &mut self,
        client_version: &str,
    ) -> Result<AcpInitializeSummary, AcpError> {
        self.connection
            .initialize("codem", "CodeM", client_version)
            .await
    }

    pub async fn authenticate(&mut self, method_id: &str) -> Result<(), AcpError> {
        self.connection.authenticate(method_id).await
    }

    pub async fn new_session(&mut self, cwd: &Path) -> Result<AcpSessionSummary, AcpError> {
        self.connection.new_session(cwd).await
    }

    pub async fn load_session(
        &mut self,
        session_id: &str,
        cwd: &Path,
    ) -> Result<AcpSessionSummary, AcpError> {
        self.connection.load_session(session_id, cwd).await
    }

    pub async fn set_model(&mut self, session_id: &str, model_id: &str) -> Result<(), AcpError> {
        self.connection.set_model(session_id, model_id).await
    }

    pub async fn set_config_option(
        &mut self,
        session_id: &str,
        config_id: &str,
        value: &str,
    ) -> Result<(), AcpError> {
        self.connection
            .set_config_option(session_id, config_id, value)
            .await
    }

    pub async fn prompt_text(
        &mut self,
        session_id: &str,
        text: &str,
        cancel: watch::Receiver<bool>,
    ) -> Result<AcpPromptOutcome, AcpError> {
        self.connection.prompt_text(session_id, text, cancel).await
    }

    pub async fn prompt_text_stream<F>(
        &mut self,
        session_id: &str,
        text: &str,
        cancel: watch::Receiver<bool>,
        control: &mut mpsc::UnboundedReceiver<AgentControlCommand>,
        on_event: F,
    ) -> Result<AcpPromptOutcome, AcpError>
    where
        F: FnMut(AcpRuntimeEvent),
    {
        self.connection
            .prompt_text_stream(session_id, text, cancel, control, on_event)
            .await
    }

    pub async fn prompt_stream<F>(
        &mut self,
        session_id: &str,
        prompt: &[AcpPromptInput],
        cancel: watch::Receiver<bool>,
        control: &mut mpsc::UnboundedReceiver<AgentControlCommand>,
        on_event: F,
    ) -> Result<AcpPromptOutcome, AcpError>
    where
        F: FnMut(AcpRuntimeEvent),
    {
        self.connection
            .prompt_stream(session_id, prompt, cancel, control, on_event)
            .await
    }

    pub async fn prompt_stream_with_permission_policy<F>(
        &mut self,
        session_id: &str,
        prompt: &[AcpPromptInput],
        cancel: watch::Receiver<bool>,
        control: &mut mpsc::UnboundedReceiver<AgentControlCommand>,
        permission_policy: AcpPermissionPolicy,
        on_event: F,
    ) -> Result<AcpPromptOutcome, AcpError>
    where
        F: FnMut(AcpRuntimeEvent),
    {
        self.connection
            .prompt_stream_with_permission_policy(
                session_id,
                prompt,
                cancel,
                control,
                permission_policy,
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

pub async fn probe_acp_agent(
    program: &str,
    cwd: &Path,
    client_version: &str,
) -> Result<AcpProbeSummary, AcpError> {
    let mut client = AcpStdioClient::spawn(program, &["agent", "stdio"], cwd).await?;
    let result = async {
        let initialize = client.initialize(client_version).await?;
        let auth_method_id = initialize
            .auth_methods
            .iter()
            .find(|method| method.id == "cached_token")
            .map(|method| method.id.clone());
        let (authenticated, auth_error) = if let Some(method_id) = auth_method_id.as_deref() {
            match client.authenticate(method_id).await {
                Ok(()) => (true, None),
                Err(_) => (false, Some("缓存认证不可用，请运行 grok login".to_string())),
            }
        } else {
            (false, Some("Provider 未提供非交互式缓存认证".to_string()))
        };

        Ok(AcpProbeSummary {
            initialize,
            authenticated,
            auth_method_id,
            auth_error,
        })
    }
    .await;
    client.shutdown().await;
    result
}

pub async fn probe_acp_initialize(
    program: &str,
    arguments: &[&str],
    cwd: &Path,
    client_version: &str,
) -> Result<AcpInitializeSummary, AcpError> {
    let mut client = AcpStdioClient::spawn(program, arguments, cwd).await?;
    let result = client.initialize(client_version).await;
    client.shutdown().await;
    result
}

fn parse_message(line: &str) -> Result<AcpMessage, AcpError> {
    let payload = serde_json::from_str::<Value>(line)?;
    let object = payload
        .as_object()
        .ok_or_else(|| AcpError::Protocol("JSON-RPC message 不是对象".to_string()))?;
    if object.get("jsonrpc").and_then(Value::as_str) != Some(JSONRPC_VERSION) {
        return Err(AcpError::Protocol("JSON-RPC version 不受支持".to_string()));
    }
    if let Some(method) = object.get("method").and_then(Value::as_str) {
        let params = object.get("params").cloned().unwrap_or(Value::Null);
        return Ok(if let Some(id) = object.get("id") {
            AcpMessage::Request {
                id: id.clone(),
                method: method.to_string(),
                params,
            }
        } else {
            AcpMessage::Notification {
                method: method.to_string(),
                params,
            }
        });
    }
    let id = object
        .get("id")
        .cloned()
        .ok_or_else(|| AcpError::Protocol("JSON-RPC response 缺少 id".to_string()))?;
    let result = object.get("result").cloned();
    let error = object.get("error").map(parse_rpc_error).transpose()?;
    if result.is_none() && error.is_none() {
        return Err(AcpError::Protocol(
            "JSON-RPC response 缺少 result/error".to_string(),
        ));
    }
    Ok(AcpMessage::Response { id, result, error })
}

fn parse_rpc_error(value: &Value) -> Result<AcpRpcError, AcpError> {
    Ok(AcpRpcError {
        code: value
            .get("code")
            .and_then(Value::as_i64)
            .ok_or_else(|| AcpError::Protocol("JSON-RPC error 缺少 code".to_string()))?,
        message: value
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Unknown ACP error")
            .to_string(),
    })
}

fn finish_response(result: Option<Value>, error: Option<AcpRpcError>) -> Result<Value, AcpError> {
    if let Some(error) = error {
        return Err(AcpError::Rpc {
            code: error.code,
            message: error.message,
        });
    }
    Ok(result.unwrap_or(Value::Null))
}

fn parse_acp_usage(value: Option<&Value>) -> AgentUsageSnapshot {
    let Some(value) = value else {
        return AgentUsageSnapshot::default();
    };
    let full_input = value.get("inputTokens").and_then(Value::as_u64);
    let cache_read = value
        .get("cacheReadInputTokens")
        .or_else(|| value.get("cachedReadTokens"))
        .and_then(Value::as_u64);
    AgentUsageSnapshot {
        input_tokens: full_input.map(|tokens| tokens.saturating_sub(cache_read.unwrap_or(0))),
        output_tokens: value.get("outputTokens").and_then(Value::as_u64),
        cache_creation_input_tokens: value
            .get("cacheCreationInputTokens")
            .or_else(|| value.get("cachedWriteTokens"))
            .and_then(Value::as_u64),
        cache_read_input_tokens: cache_read,
        model_context_window: value.get("modelContextWindow").and_then(Value::as_u64),
        total_cost_usd: value
            .get("totalCostUsd")
            .or_else(|| value.get("total_cost_usd"))
            .and_then(Value::as_f64),
    }
}

fn parse_session_usage_update(value: &Value) -> Option<AgentUsageSnapshot> {
    let used = value.get("used").and_then(Value::as_u64)?;
    let size = value.get("size").and_then(Value::as_u64)?;
    let total_cost_usd = value
        .get("cost")
        .and_then(Value::as_object)
        .filter(|cost| {
            cost.get("currency")
                .and_then(Value::as_str)
                .is_some_and(|currency| currency.eq_ignore_ascii_case("USD"))
        })
        .and_then(|cost| cost.get("amount"))
        .and_then(Value::as_f64)
        .filter(|amount| amount.is_finite() && *amount >= 0.0);
    Some(AgentUsageSnapshot {
        input_tokens: Some(used),
        output_tokens: None,
        cache_creation_input_tokens: None,
        cache_read_input_tokens: None,
        model_context_window: Some(size),
        total_cost_usd,
    })
}

fn summarize_initialize_result(result: &Value) -> Result<AcpInitializeSummary, AcpError> {
    let protocol_version = result
        .get("protocolVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| AcpError::Protocol("initialize 缺少 protocolVersion".to_string()))?;
    let auth_methods = result
        .get("authMethods")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|method| {
            let id = method.get("id")?.as_str()?.trim();
            if id.is_empty() {
                return None;
            }
            let name = method
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .unwrap_or(id);
            Some(AcpAuthMethodSummary {
                id: id.to_string(),
                name: name.to_string(),
            })
        })
        .collect();
    let models = result
        .pointer("/_meta/modelState/availableModels")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let model_id = model.get("modelId")?.as_str()?.trim();
            if model_id.is_empty() {
                return None;
            }
            Some(AcpModelSummary {
                model_id: model_id.to_string(),
                name: model
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .unwrap_or(model_id)
                    .to_string(),
                context_tokens: model
                    .pointer("/_meta/totalContextTokens")
                    .and_then(Value::as_u64),
            })
        })
        .collect();

    Ok(AcpInitializeSummary {
        protocol_version,
        load_session: result
            .pointer("/agentCapabilities/loadSession")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        prompt_capabilities: AcpPromptCapabilities {
            image: result
                .pointer("/agentCapabilities/promptCapabilities/image")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            audio: result
                .pointer("/agentCapabilities/promptCapabilities/audio")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            embedded_context: result
                .pointer("/agentCapabilities/promptCapabilities/embeddedContext")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        },
        mcp_capabilities: AcpMcpCapabilities {
            http: result
                .pointer("/agentCapabilities/mcpCapabilities/http")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            sse: result
                .pointer("/agentCapabilities/mcpCapabilities/sse")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        },
        auth_methods,
        default_auth_method_id: optional_string(result.pointer("/_meta/defaultAuthMethodId")),
        agent_version: optional_string(result.pointer("/_meta/agentVersion")),
        current_model_id: optional_string(result.pointer("/_meta/modelState/currentModelId")),
        models,
    })
}

fn summarize_session_result(
    result: &Value,
    expected_session_id: Option<&str>,
) -> Result<AcpSessionSummary, AcpError> {
    let response_session_id = result.get("sessionId").and_then(Value::as_str);
    if let (Some(expected), Some(actual)) = (expected_session_id, response_session_id) {
        if expected != actual {
            return Err(AcpError::Protocol(
                "session/load 返回了不同 sessionId".to_string(),
            ));
        }
    }
    let session_id = response_session_id
        .or(expected_session_id)
        .map(str::trim)
        .filter(|session_id| !session_id.is_empty())
        .ok_or_else(|| AcpError::Protocol("session 响应缺少 sessionId".to_string()))?;
    Ok(AcpSessionSummary {
        session_id: session_id.to_string(),
        current_model_id: optional_string(result.pointer("/models/currentModelId")).or_else(|| {
            result
                .get("configOptions")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .find(|option| {
                    option.get("id").and_then(Value::as_str) == Some("model")
                        || option.get("category").and_then(Value::as_str) == Some("model")
                })
                .and_then(|option| optional_string(option.get("currentValue")))
        }),
    })
}

fn parse_permission_request(
    session_id: &str,
    rpc_id: &Value,
    params: &Value,
) -> Result<AcpPermissionRequest, AcpError> {
    let request_session_id = params
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AcpError::Protocol("权限请求缺少 sessionId".to_string()))?;
    if request_session_id != session_id {
        return Err(AcpError::Protocol(
            "权限请求属于其他 ACP session".to_string(),
        ));
    }
    let tool_call = params
        .get("toolCall")
        .and_then(Value::as_object)
        .ok_or_else(|| AcpError::Protocol("权限请求缺少 toolCall".to_string()))?;
    let tool_call_id = tool_call
        .get("toolCallId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AcpError::Protocol("权限请求缺少 toolCallId".to_string()))?;
    let options = params
        .get("options")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(parse_permission_option)
        .collect::<Vec<_>>();
    if options.is_empty() {
        return Err(AcpError::Protocol("权限请求没有可用选项".to_string()));
    }

    Ok(AcpPermissionRequest {
        session_id: session_id.to_string(),
        request_id: request_id_from_rpc(rpc_id)?,
        tool_call_id: tool_call_id.to_string(),
        title: optional_string(tool_call.get("title"))
            .unwrap_or_else(|| "工具权限请求".to_string()),
        options,
    })
}

fn parse_permission_option(value: &Value) -> Option<AcpPermissionOption> {
    let option_id = value.get("optionId")?.as_str()?.trim();
    let name = value.get("name")?.as_str()?.trim();
    let kind = value.get("kind")?.as_str()?.trim();
    if option_id.is_empty() || name.is_empty() || kind.is_empty() {
        return None;
    }
    Some(AcpPermissionOption {
        option_id: option_id.to_string(),
        name: bounded_string(name, MAX_JSON_STRING_BYTES),
        kind: kind.to_string(),
    })
}

fn parse_user_input_request(
    session_id: &str,
    rpc_id: &Value,
    params: &Value,
) -> Result<AcpUserInputRequest, AcpError> {
    if params
        .get("sessionId")
        .and_then(Value::as_str)
        .is_some_and(|value| value != session_id)
    {
        return Err(AcpError::Protocol(
            "结构化提问属于其他 ACP session".to_string(),
        ));
    }
    if params.get("mode").and_then(Value::as_str) != Some("form") {
        return Err(AcpError::Protocol(
            "CodeM 仅支持 ACP form elicitation".to_string(),
        ));
    }
    let requested_schema = params
        .get("requestedSchema")
        .and_then(Value::as_object)
        .ok_or_else(|| AcpError::Protocol("结构化提问缺少 requestedSchema".to_string()))?;
    let required = requested_schema
        .get("required")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToString::to_string)
        .collect::<BTreeSet<_>>();
    let properties = requested_schema
        .get("properties")
        .and_then(Value::as_object)
        .ok_or_else(|| AcpError::Protocol("结构化提问缺少 properties".to_string()))?;
    let questions = properties
        .iter()
        .filter_map(|(id, schema)| parse_user_input_question(id, schema, required.contains(id)))
        .collect::<Vec<_>>();
    if questions.is_empty() {
        return Err(AcpError::Protocol("结构化提问没有可呈现字段".to_string()));
    }
    let description = params
        .get("message")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| bounded_string(value, MAX_JSON_STRING_BYTES))
        .unwrap_or_else(|| "Agent 需要补充信息".to_string());

    Ok(AcpUserInputRequest {
        session_id: session_id.to_string(),
        request_id: request_id_from_rpc(rpc_id)?,
        title: optional_string(requested_schema.get("title"))
            .map(|value| bounded_string(&value, MAX_JSON_STRING_BYTES)),
        description,
        questions,
    })
}

fn parse_user_input_question(
    id: &str,
    schema: &Value,
    required: bool,
) -> Option<AcpUserInputQuestion> {
    let object = schema.as_object()?;
    let value_type = object
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("string");
    let title = optional_string(object.get("title"));
    let description = optional_string(object.get("description"));
    let option_schema = if value_type == "array" {
        object
            .get("items")
            .and_then(Value::as_object)
            .unwrap_or(object)
    } else {
        object
    };
    let mut options = option_schema
        .get("enum")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|label| AcpUserInputOption {
            label: bounded_string(label, MAX_JSON_STRING_BYTES),
            value: bounded_string(label, MAX_JSON_STRING_BYTES),
            description: None,
        })
        .collect::<Vec<_>>();
    if options.is_empty() {
        options = option_schema
            .get("oneOf")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|option| {
                let value = option.get("const").and_then(Value::as_str)?;
                let label = option.get("title").and_then(Value::as_str).unwrap_or(value);
                Some(AcpUserInputOption {
                    label: bounded_string(label, MAX_JSON_STRING_BYTES),
                    value: bounded_string(value, MAX_JSON_STRING_BYTES),
                    description: optional_string(option.get("description"))
                        .map(|value| bounded_string(&value, MAX_JSON_STRING_BYTES)),
                })
            })
            .collect();
    }
    let normalized_id = id.to_ascii_lowercase();
    let secret = object.get("format").and_then(Value::as_str) == Some("password")
        || normalized_id.contains("password")
        || normalized_id.contains("secret")
        || normalized_id.contains("token");
    let question = description
        .clone()
        .or_else(|| title.clone())
        .unwrap_or_else(|| id.to_string());

    Some(AcpUserInputQuestion {
        id: id.to_string(),
        header: title.map(|value| bounded_string(&value, MAX_JSON_STRING_BYTES)),
        question: bounded_string(&question, MAX_JSON_STRING_BYTES),
        input_type: match value_type {
            "number" | "integer" | "boolean" => value_type.to_string(),
            _ => "text".to_string(),
        },
        options,
        multi_select: value_type == "array",
        required,
        secret,
    })
}

fn request_id_from_rpc(value: &Value) -> Result<String, AcpError> {
    match value {
        Value::String(value) if !value.trim().is_empty() => Ok(value.trim().to_string()),
        Value::Number(value) => Ok(value.to_string()),
        _ => Err(AcpError::Protocol(
            "ACP client request id 不受支持".to_string(),
        )),
    }
}

fn select_permission_option(
    options: &[AcpPermissionOption],
    decision: AgentPermissionDecision,
    requested_option_id: Option<&str>,
) -> Result<String, String> {
    let matches_decision = |option: &AcpPermissionOption| match decision {
        AgentPermissionDecision::Approve => option.kind.starts_with("allow_"),
        AgentPermissionDecision::Reject => option.kind.starts_with("reject_"),
    };
    if let Some(option_id) = requested_option_id {
        return options
            .iter()
            .find(|option| option.option_id == option_id && matches_decision(option))
            .map(|option| option.option_id.clone())
            .ok_or_else(|| "指定权限选项不存在或与决定不匹配".to_string());
    }
    let preferred_kind = match decision {
        AgentPermissionDecision::Approve => "allow_once",
        AgentPermissionDecision::Reject => "reject_once",
    };
    options
        .iter()
        .find(|option| option.kind == preferred_kind)
        .or_else(|| options.iter().find(|option| matches_decision(option)))
        .map(|option| option.option_id.clone())
        .ok_or_else(|| "Provider 没有提供与当前决定匹配的权限选项".to_string())
}

fn automatic_permission_option<'a>(
    options: &'a [AcpPermissionOption],
    policy: AcpPermissionPolicy,
) -> Option<&'a str> {
    let priorities: &[&str] = match policy {
        AcpPermissionPolicy::Interactive => return None,
        AcpPermissionPolicy::AutoApproveOnce => &["allow_once", "allow_always"],
        AcpPermissionPolicy::AutoApproveAlways => &["allow_always", "allow_once"],
    };
    priorities
        .iter()
        .find_map(|kind| {
            options
                .iter()
                .find(|option| option.kind == *kind)
                .map(|option| option.option_id.as_str())
        })
        .or_else(|| {
            options
                .iter()
                .find(|option| option.kind.starts_with("allow_"))
                .map(|option| option.option_id.as_str())
        })
}

fn validate_user_input_answers(
    request: &AcpUserInputRequest,
    answers: Map<String, Value>,
) -> Result<Map<String, Value>, String> {
    let question_ids = request
        .questions
        .iter()
        .map(|question| question.id.as_str())
        .collect::<BTreeSet<_>>();
    if let Some(key) = answers
        .keys()
        .find(|key| !question_ids.contains(key.as_str()))
    {
        return Err(format!("回答包含未知字段: {key}"));
    }
    for question in request
        .questions
        .iter()
        .filter(|question| question.required)
    {
        if answers.get(&question.id).is_none_or(answer_is_empty) {
            return Err(format!("缺少必填回答: {}", question.id));
        }
    }
    for question in request
        .questions
        .iter()
        .filter(|question| !question.options.is_empty())
    {
        let Some(answer) = answers.get(&question.id) else {
            continue;
        };
        let allowed = question
            .options
            .iter()
            .map(|option| option.value.as_str())
            .collect::<BTreeSet<_>>();
        let valid = if question.multi_select {
            answer.as_array().is_some_and(|values| {
                values
                    .iter()
                    .all(|value| value.as_str().is_some_and(|value| allowed.contains(value)))
            })
        } else {
            answer.as_str().is_some_and(|value| allowed.contains(value))
        };
        if !valid {
            return Err(format!("回答不在可选范围内: {}", question.id));
        }
    }
    answers
        .into_iter()
        .map(|(key, value)| {
            let question = request
                .questions
                .iter()
                .find(|question| question.id == key)
                .ok_or_else(|| format!("回答包含未知字段: {key}"))?;
            sanitize_user_answer(question, value).map(|value| (key, value))
        })
        .collect()
}

fn answer_is_empty(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(value) => value.trim().is_empty(),
        Value::Array(values) => values.is_empty(),
        _ => false,
    }
}

fn sanitize_user_answer(question: &AcpUserInputQuestion, value: Value) -> Result<Value, String> {
    if question.multi_select {
        return match value {
            Value::Array(values)
                if values.len() <= MAX_JSON_ARRAY_ITEMS
                    && values.iter().all(|value| value.is_string()) =>
            {
                Ok(Value::Array(
                    values
                        .into_iter()
                        .map(|value| {
                            Value::String(bounded_string(
                                value.as_str().unwrap_or_default(),
                                MAX_JSON_STRING_BYTES,
                            ))
                        })
                        .collect(),
                ))
            }
            _ => Err(format!("多选回答必须是字符串数组: {}", question.id)),
        };
    }
    match question.input_type.as_str() {
        "number" => match value {
            Value::Number(_) => Ok(value),
            Value::String(value) => value
                .trim()
                .parse::<f64>()
                .ok()
                .and_then(serde_json::Number::from_f64)
                .map(Value::Number)
                .ok_or_else(|| format!("回答必须是数字: {}", question.id)),
            _ => Err(format!("回答必须是数字: {}", question.id)),
        },
        "integer" => match value {
            Value::Number(value) if value.is_i64() || value.is_u64() => Ok(Value::Number(value)),
            Value::String(value) => value
                .trim()
                .parse::<i64>()
                .map(|value| Value::Number(value.into()))
                .map_err(|_| format!("回答必须是整数: {}", question.id)),
            _ => Err(format!("回答必须是整数: {}", question.id)),
        },
        "boolean" => match value {
            Value::Bool(_) => Ok(value),
            Value::String(value) if value.trim().eq_ignore_ascii_case("true") => {
                Ok(Value::Bool(true))
            }
            Value::String(value) if value.trim().eq_ignore_ascii_case("false") => {
                Ok(Value::Bool(false))
            }
            _ => Err(format!("回答必须是布尔值: {}", question.id)),
        },
        _ => match value {
            Value::String(value) => Ok(Value::String(bounded_string(
                value.trim(),
                MAX_JSON_STRING_BYTES,
            ))),
            _ => Err(format!("回答必须是字符串: {}", question.id)),
        },
    }
}

fn collect_session_update(
    session_id: &str,
    params: &Value,
    outcome: &mut AcpPromptOutcome,
) -> Vec<AcpRuntimeEvent> {
    if params
        .get("sessionId")
        .and_then(Value::as_str)
        .is_some_and(|value| value != session_id)
    {
        return Vec::new();
    }
    let Some(update) = params.get("update") else {
        return Vec::new();
    };
    let Some(update_type) = update.get("sessionUpdate").and_then(Value::as_str) else {
        return Vec::new();
    };
    *outcome
        .update_counts
        .entry(update_type.to_string())
        .or_insert(0) += 1;
    match update_type {
        "agent_message_chunk" => {
            if let Some(text) = update.pointer("/content/text").and_then(Value::as_str) {
                outcome.text_truncated |=
                    append_bounded(&mut outcome.text, text, MAX_AGENT_MESSAGE_BYTES);
                return vec![AcpRuntimeEvent::TextDelta {
                    text: bounded_string(text, MAX_EVENT_TEXT_BYTES),
                }];
            }
        }
        "agent_thought_chunk" => {
            outcome.thought_chunk_count += 1;
            return vec![AcpRuntimeEvent::ThoughtChunk];
        }
        "usage_update" => {
            if let Some(usage) = parse_session_usage_update(update) {
                return vec![AcpRuntimeEvent::Usage { usage }];
            }
        }
        "tool_call" => {
            if let Some(call) = parse_tool_call(update) {
                return vec![AcpRuntimeEvent::ToolCall { call }];
            }
        }
        "tool_call_update" => {
            if let Some(update) = parse_tool_call_update(update) {
                return vec![AcpRuntimeEvent::ToolCallUpdate { update }];
            }
        }
        _ => {}
    }
    Vec::new()
}

fn parse_tool_call(value: &Value) -> Option<AcpToolCall> {
    let tool_call_id = optional_string(value.get("toolCallId"))?;
    let title = optional_string(value.get("title")).unwrap_or_else(|| "Agent 工具".to_string());
    Some(AcpToolCall {
        tool_call_id,
        title: bounded_string(&title, MAX_JSON_STRING_BYTES),
        kind: optional_string(value.get("kind")),
        status: normalize_tool_status(value.get("status")),
        input: value
            .get("rawInput")
            .map(|value| sanitize_json_value(value, 0)),
        content: summarize_tool_content(value),
    })
}

fn parse_tool_call_update(value: &Value) -> Option<AcpToolCallUpdate> {
    Some(AcpToolCallUpdate {
        tool_call_id: optional_string(value.get("toolCallId"))?,
        title: optional_string(value.get("title"))
            .map(|value| bounded_string(&value, MAX_JSON_STRING_BYTES)),
        kind: optional_string(value.get("kind")),
        status: normalize_tool_status(value.get("status")),
        input: value
            .get("rawInput")
            .filter(|value| !value.is_null())
            .map(|value| sanitize_json_value(value, 0)),
        content: summarize_tool_content(value),
    })
}

fn normalize_tool_status(value: Option<&Value>) -> Option<String> {
    match value.and_then(Value::as_str) {
        Some(status @ ("pending" | "in_progress" | "completed" | "failed")) => {
            Some(status.to_string())
        }
        _ => None,
    }
}

fn summarize_tool_content(value: &Value) -> Option<String> {
    let mut summary = String::new();
    if let Some(items) = value.get("content").and_then(Value::as_array) {
        for item in items.iter().take(MAX_JSON_ARRAY_ITEMS) {
            let text = match item.get("type").and_then(Value::as_str) {
                Some("content") => item
                    .pointer("/content/text")
                    .and_then(Value::as_str)
                    .or_else(|| item.get("text").and_then(Value::as_str))
                    .map(sanitize_tool_text),
                Some("diff") => item
                    .get("path")
                    .and_then(Value::as_str)
                    .map(|path| format!("文件变更: {path}")),
                Some("terminal") => Some("终端输出可用".to_string()),
                _ => None,
            };
            if let Some(text) = text {
                if !summary.is_empty() {
                    append_bounded(&mut summary, "\n", MAX_EVENT_TEXT_BYTES);
                }
                append_bounded(&mut summary, &text, MAX_EVENT_TEXT_BYTES);
            }
        }
    }
    if summary.is_empty() {
        if let Some(raw_output) = value.get("rawOutput").filter(|value| !value.is_null()) {
            summary = safe_json_to_string(raw_output);
        }
    }
    (!summary.is_empty()).then_some(summary)
}

fn safe_json_to_string(value: &Value) -> String {
    let sanitized = sanitize_json_value(value, 0);
    bounded_string(
        &serde_json::to_string(&sanitized).unwrap_or_default(),
        MAX_EVENT_TEXT_BYTES,
    )
}

fn sanitize_tool_text(value: &str) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(value) {
        return safe_json_to_string(&value);
    }
    let mut sanitized = String::new();
    for line in value.lines() {
        let replacement = line
            .split_once('=')
            .or_else(|| line.split_once(':'))
            .filter(|(key, _)| is_sensitive_key(key))
            .map(|(key, _)| format!("{}: [已脱敏]", key.trim()))
            .unwrap_or_else(|| line.to_string());
        if !sanitized.is_empty() {
            append_bounded(&mut sanitized, "\n", MAX_EVENT_TEXT_BYTES);
        }
        if append_bounded(&mut sanitized, &replacement, MAX_EVENT_TEXT_BYTES) {
            break;
        }
    }
    sanitized
}

fn sanitize_json_value(value: &Value, depth: usize) -> Value {
    if depth >= MAX_JSON_DEPTH {
        return json!("[已截断]");
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
        Value::Object(values) => Value::Object(
            values
                .iter()
                .filter(|(key, _)| key.as_str() != "_meta")
                .take(MAX_JSON_OBJECT_FIELDS)
                .map(|(key, value)| {
                    let value = if is_sensitive_key(key) {
                        json!("[已脱敏]")
                    } else {
                        sanitize_json_value(value, depth + 1)
                    };
                    (key.clone(), value)
                })
                .collect(),
        ),
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    [
        "token",
        "password",
        "secret",
        "authorization",
        "cookie",
        "credential",
        "apikey",
        "proxy",
        "account",
        "email",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

fn bounded_string(value: &str, max_bytes: usize) -> String {
    let mut bounded = String::new();
    let truncated = append_bounded(&mut bounded, value, max_bytes);
    if truncated {
        let marker = "\n[已截断]";
        if bounded.len() + marker.len() <= max_bytes {
            bounded.push_str(marker);
        }
    }
    bounded
}

fn append_bounded(target: &mut String, value: &str, max_bytes: usize) -> bool {
    let remaining = max_bytes.saturating_sub(target.len());
    if value.len() <= remaining {
        target.push_str(value);
        return false;
    }
    if remaining > 0 {
        let mut boundary = remaining.min(value.len());
        while boundary > 0 && !value.is_char_boundary(boundary) {
            boundary -= 1;
        }
        target.push_str(&value[..boundary]);
    }
    true
}

fn optional_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
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
    use super::{
        collect_session_update, parse_acp_usage, parse_session_usage_update,
        summarize_initialize_result, AcpConnection, AcpEmbeddedResource, AcpPermissionPolicy,
        AcpPromptCapabilities, AcpPromptInput, AcpPromptOutcome, AcpRuntimeEvent, AcpStdioClient,
    };

    #[test]
    fn acp_usage_separates_cached_input_and_keeps_cost() {
        let usage = parse_acp_usage(Some(&json!({
            "inputTokens": 120,
            "cacheReadInputTokens": 20,
            "outputTokens": 7,
            "totalCostUsd": 0.25
        })));
        assert_eq!(usage.input_tokens, Some(100));
        assert_eq!(usage.cache_read_input_tokens, Some(20));
        assert_eq!(usage.output_tokens, Some(7));
        assert_eq!(usage.total_cost_usd, Some(0.25));
    }

    #[test]
    fn acp_session_usage_update_maps_context_without_polluting_final_usage() {
        let mut outcome = AcpPromptOutcome {
            stop_reason: String::new(),
            text: String::new(),
            text_truncated: false,
            thought_chunk_count: 0,
            update_counts: BTreeMap::new(),
            client_request_methods: Vec::new(),
            cancel_sent: false,
            usage: crate::agent_runtime::AgentUsageSnapshot::default(),
        };
        let events = collect_session_update(
            "session-1",
            &json!({
                "sessionId": "session-1",
                "update": {
                    "sessionUpdate": "usage_update",
                    "used": 53000,
                    "size": 200000,
                    "cost": { "amount": 0.045, "currency": "USD" }
                }
            }),
            &mut outcome,
        );

        assert!(matches!(
            events.as_slice(),
            [AcpRuntimeEvent::Usage { usage }]
                if usage.input_tokens == Some(53000)
                    && usage.model_context_window == Some(200000)
                    && usage.total_cost_usd == Some(0.045)
        ));
        assert_eq!(outcome.update_counts.get("usage_update"), Some(&1));
        assert_eq!(
            outcome.usage,
            crate::agent_runtime::AgentUsageSnapshot::default()
        );

        let eur = parse_session_usage_update(&json!({
            "used": 10,
            "size": 100,
            "cost": { "amount": 1.2, "currency": "EUR" }
        }))
        .unwrap();
        assert_eq!(eur.total_cost_usd, None);
    }
    use crate::agent_runtime::{AgentControlCommand, AgentPermissionDecision};
    use serde_json::{json, Value};
    use std::{collections::BTreeMap, path::Path, time::Duration};
    use tokio::{
        io::{duplex, split, AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader},
        sync::{mpsc, oneshot, watch},
        time::timeout,
    };

    async fn read_json_line<R: tokio::io::AsyncRead + Unpin>(
        lines: &mut tokio::io::Lines<BufReader<R>>,
    ) -> Value {
        let line = timeout(Duration::from_secs(1), lines.next_line())
            .await
            .expect("read timeout")
            .expect("read line")
            .expect("line closed");
        serde_json::from_str(&line).expect("valid JSON")
    }

    async fn write_json_line<W: AsyncWrite + Unpin>(writer: &mut W, value: Value) {
        writer
            .write_all(serde_json::to_string(&value).unwrap().as_bytes())
            .await
            .unwrap();
        writer.write_all(b"\n").await.unwrap();
        writer.flush().await.unwrap();
    }

    #[test]
    fn acp_prompt_input_serializes_multimodal_blocks_with_protocol_field_names() {
        let prompt = vec![
            AcpPromptInput::Image {
                mime_type: "image/png".to_string(),
                data: "aGVsbG8=".to_string(),
            },
            AcpPromptInput::Resource {
                resource: AcpEmbeddedResource {
                    uri: "codem://attachment/README.md".to_string(),
                    mime_type: Some("text/markdown".to_string()),
                    text: "# README".to_string(),
                },
            },
            AcpPromptInput::ResourceLink {
                uri: "file:///D:/workspace/design.png".to_string(),
                name: "design.png".to_string(),
                mime_type: Some("image/png".to_string()),
                size: Some(128),
            },
        ];

        assert_eq!(
            serde_json::to_value(prompt).expect("serialize ACP prompt"),
            json!([
                { "type": "image", "mimeType": "image/png", "data": "aGVsbG8=" },
                {
                    "type": "resource",
                    "resource": {
                        "uri": "codem://attachment/README.md",
                        "mimeType": "text/markdown",
                        "text": "# README"
                    }
                },
                {
                    "type": "resource_link",
                    "uri": "file:///D:/workspace/design.png",
                    "name": "design.png",
                    "mimeType": "image/png",
                    "size": 128
                }
            ])
        );
    }

    #[test]
    fn acp_initialize_summary_keeps_only_safe_capability_and_model_fields() {
        let summary = summarize_initialize_result(&json!({
            "protocolVersion": 1,
            "agentCapabilities": {
                "loadSession": true,
                "promptCapabilities": {
                    "image": false,
                    "audio": false,
                    "embeddedContext": true
                },
                "mcpCapabilities": { "http": true, "sse": true }
            },
            "authMethods": [{
                "id": "cached_token",
                "name": "Cached token",
                "description": "secret-adjacent description"
            }],
            "_meta": {
                "agentVersion": "0.2.93",
                "defaultAuthMethodId": "cached_token",
                "hostname": "private-host",
                "modelState": {
                    "currentModelId": "grok-4.5",
                    "availableModels": [{
                        "modelId": "grok-4.5",
                        "name": "Grok 4.5",
                        "_meta": { "totalContextTokens": 500000, "internal": "drop" }
                    }]
                }
            }
        }))
        .unwrap();

        assert_eq!(summary.protocol_version, 1);
        assert!(summary.load_session);
        assert_eq!(
            summary.prompt_capabilities,
            AcpPromptCapabilities {
                image: false,
                audio: false,
                embedded_context: true,
            }
        );
        let serialized = serde_json::to_string(&summary).unwrap();
        assert!(!serialized.contains("private-host"));
        assert!(!serialized.contains("secret-adjacent"));
        assert!(!serialized.contains("internal"));
        assert!(serialized.contains("500000"));
    }

    #[tokio::test]
    async fn acp_connection_supports_initialize_authenticate_new_and_load() {
        let (client_io, server_io) = duplex(16 * 1024);
        let (client_reader, client_writer) = split(client_io);
        let (server_reader, mut server_writer) = split(server_io);
        let server = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let initialize = read_json_line(&mut lines).await;
            assert_eq!(initialize["method"], "initialize");
            assert_eq!(initialize["params"]["protocolVersion"], 1);
            assert_eq!(
                initialize["params"]["clientCapabilities"]["fs"]["readTextFile"],
                false
            );
            assert_eq!(
                initialize["params"]["clientCapabilities"]["terminal"],
                false
            );
            assert_eq!(
                initialize["params"]["clientCapabilities"]["elicitation"]["form"],
                json!({})
            );
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "method": "_provider/notice",
                    "params": {}
                }),
            )
            .await;
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "id": initialize["id"],
                    "result": {
                        "protocolVersion": 1,
                        "agentCapabilities": {
                            "loadSession": true,
                            "promptCapabilities": { "embeddedContext": true }
                        },
                        "authMethods": [{ "id": "cached_token", "name": "cached_token" }],
                        "_meta": { "agentVersion": "test" }
                    }
                }),
            )
            .await;

            let authenticate = read_json_line(&mut lines).await;
            assert_eq!(authenticate["method"], "authenticate");
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "id": authenticate["id"],
                    "result": {
                        "_meta": {
                            "email": "must-not-escape@example.com",
                            "token": "must-not-escape"
                        }
                    }
                }),
            )
            .await;

            let new_session = read_json_line(&mut lines).await;
            assert_eq!(new_session["method"], "session/new");
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "id": new_session["id"],
                    "result": {
                        "sessionId": "session-1",
                        "configOptions": [{
                            "id": "model",
                            "category": "model",
                            "currentValue": "provider/model-1"
                        }]
                    }
                }),
            )
            .await;

            let load_session = read_json_line(&mut lines).await;
            assert_eq!(load_session["method"], "session/load");
            assert_eq!(load_session["params"]["sessionId"], "session-1");
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "id": load_session["id"],
                    "result": { "sessionId": "session-1" }
                }),
            )
            .await;

            let set_config = read_json_line(&mut lines).await;
            assert_eq!(set_config["method"], "session/set_config_option");
            assert_eq!(set_config["params"]["sessionId"], "session-1");
            assert_eq!(set_config["params"]["configId"], "model");
            assert_eq!(set_config["params"]["value"], "provider/model-2");
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "id": set_config["id"],
                    "result": { "configOptions": [] }
                }),
            )
            .await;

            let set_model = read_json_line(&mut lines).await;
            assert_eq!(set_model["method"], "session/set_model");
            assert_eq!(set_model["params"]["sessionId"], "session-1");
            assert_eq!(set_model["params"]["modelId"], "model-2");
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "id": set_model["id"],
                    "result": { "currentModelId": "model-2" }
                }),
            )
            .await;
        });

        let mut client = AcpConnection::new(client_reader, client_writer);
        let initialize = client.initialize("codem", "CodeM", "test").await.unwrap();
        assert_eq!(initialize.agent_version.as_deref(), Some("test"));
        client.authenticate("cached_token").await.unwrap();
        let session = client.new_session(Path::new("D:/workspace")).await.unwrap();
        assert_eq!(session.session_id, "session-1");
        assert_eq!(
            session.current_model_id.as_deref(),
            Some("provider/model-1")
        );
        let loaded = client
            .load_session("session-1", Path::new("D:/workspace"))
            .await
            .unwrap();
        assert_eq!(loaded.session_id, "session-1");
        client
            .set_config_option("session-1", "model", "provider/model-2")
            .await
            .unwrap();
        client.set_model("session-1", "model-2").await.unwrap();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn acp_auto_permission_policy_selects_allow_always_without_exposing_a_card() {
        let (client_io, server_io) = duplex(16 * 1024);
        let (client_reader, client_writer) = split(client_io);
        let (server_reader, mut server_writer) = split(server_io);
        let server = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let prompt = read_json_line(&mut lines).await;
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "id": 77,
                    "method": "session/request_permission",
                    "params": {
                        "sessionId": "session-1",
                        "toolCall": {
                            "toolCallId": "tool-1",
                            "title": "Edit file",
                            "status": "pending"
                        },
                        "options": [
                            { "optionId": "once", "name": "Allow once", "kind": "allow_once" },
                            { "optionId": "always", "name": "Always allow", "kind": "allow_always" },
                            { "optionId": "reject", "name": "Reject", "kind": "reject_once" }
                        ]
                    }
                }),
            )
            .await;
            let permission = read_json_line(&mut lines).await;
            assert_eq!(permission["id"], 77);
            assert_eq!(
                permission["result"]["outcome"],
                json!({ "outcome": "selected", "optionId": "always" })
            );
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "id": prompt["id"],
                    "result": { "stopReason": "end_turn" }
                }),
            )
            .await;
        });

        let (_cancel_sender, cancel_receiver) = watch::channel(false);
        let (_control_sender, mut control_receiver) = mpsc::unbounded_channel();
        let mut events = Vec::new();
        let mut client = AcpConnection::new(client_reader, client_writer);
        let outcome = client
            .prompt_stream_with_permission_policy(
                "session-1",
                &[AcpPromptInput::Text {
                    text: "edit".to_string(),
                }],
                cancel_receiver,
                &mut control_receiver,
                AcpPermissionPolicy::AutoApproveAlways,
                |event| events.push(event),
            )
            .await
            .unwrap();

        assert_eq!(outcome.stop_reason, "end_turn");
        assert!(matches!(
            events.as_slice(),
            [AcpRuntimeEvent::InteractionResolved { request_id }] if request_id == "77"
        ));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn acp_prompt_collects_public_text_and_sends_cancel_without_thought_text() {
        let (client_io, server_io) = duplex(16 * 1024);
        let (client_reader, client_writer) = split(client_io);
        let (server_reader, mut server_writer) = split(server_io);
        let (updates_sent, updates_ready) = oneshot::channel();
        let server = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let prompt = read_json_line(&mut lines).await;
            assert_eq!(prompt["method"], "session/prompt");
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "method": "session/update",
                    "params": {
                        "sessionId": "session-1",
                        "update": {
                            "sessionUpdate": "agent_thought_chunk",
                            "content": { "type": "text", "text": "private reasoning" }
                        }
                    }
                }),
            )
            .await;
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "method": "session/update",
                    "params": {
                        "sessionId": "session-1",
                        "update": {
                            "sessionUpdate": "agent_message_chunk",
                            "content": { "type": "text", "text": "hello" }
                        }
                    }
                }),
            )
            .await;
            updates_sent.send(()).unwrap();

            let cancel = read_json_line(&mut lines).await;
            assert_eq!(cancel["method"], "session/cancel");
            assert!(cancel.get("id").is_none());
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "id": prompt["id"],
                    "result": { "stopReason": "end_turn" }
                }),
            )
            .await;
        });

        let (cancel_sender, cancel_receiver) = watch::channel(false);
        tokio::spawn(async move {
            updates_ready.await.unwrap();
            cancel_sender.send(true).unwrap();
        });
        let mut client = AcpConnection::new(client_reader, client_writer);
        let outcome = client
            .prompt_text("session-1", "long response", cancel_receiver)
            .await
            .unwrap();

        assert_eq!(
            outcome,
            AcpPromptOutcome {
                stop_reason: "cancelled".to_string(),
                text: "hello".to_string(),
                text_truncated: false,
                thought_chunk_count: 1,
                update_counts: BTreeMap::from([
                    ("agent_message_chunk".to_string(), 1),
                    ("agent_thought_chunk".to_string(), 1),
                ]),
                client_request_methods: Vec::new(),
                cancel_sent: true,
                usage: crate::agent_runtime::AgentUsageSnapshot::default(),
            }
        );
        let serialized = serde_json::to_string(&outcome).unwrap();
        assert!(!serialized.contains("private reasoning"));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn acp_prompt_stream_maps_tools_permission_and_elicitation_without_secrets() {
        let (client_io, server_io) = duplex(64 * 1024);
        let (client_reader, client_writer) = split(client_io);
        let (server_reader, mut server_writer) = split(server_io);
        let server = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let prompt = read_json_line(&mut lines).await;
            assert_eq!(prompt["method"], "session/prompt");

            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "method": "session/update",
                    "params": {
                        "sessionId": "session-1",
                        "update": {
                            "sessionUpdate": "agent_thought_chunk",
                            "content": { "type": "text", "text": "private reasoning" }
                        }
                    }
                }),
            )
            .await;
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "method": "session/update",
                    "params": {
                        "sessionId": "session-1",
                        "update": {
                            "sessionUpdate": "tool_call",
                            "toolCallId": "tool-1",
                            "title": "Read README",
                            "kind": "read",
                            "status": "pending",
                            "rawInput": {
                                "path": "README.md",
                                "apiToken": "do-not-leak",
                                "HTTPS_PROXY": "http://private-proxy:7890",
                                "_meta": { "account": "private-account" }
                            }
                        }
                    }
                }),
            )
            .await;
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "id": 99,
                    "method": "session/request_permission",
                    "params": {
                        "sessionId": "session-1",
                        "toolCall": {
                            "toolCallId": "tool-1",
                            "title": "Read README",
                            "status": "pending"
                        },
                        "options": [
                            { "optionId": "allow-once", "name": "Allow once", "kind": "allow_once" },
                            { "optionId": "reject-once", "name": "Reject", "kind": "reject_once" }
                        ]
                    }
                }),
            )
            .await;
            let permission_response = read_json_line(&mut lines).await;
            assert_eq!(permission_response["id"], 99);
            assert_eq!(
                permission_response["result"]["outcome"],
                json!({ "outcome": "selected", "optionId": "allow-once" })
            );

            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "id": 100,
                    "method": "elicitation/create",
                    "params": {
                        "sessionId": "session-1",
                        "mode": "form",
                        "message": "Need profile details",
                        "requestedSchema": {
                            "type": "object",
                            "title": "Profile",
                            "properties": {
                                "displayName": {
                                    "type": "string",
                                    "title": "Display name",
                                    "description": "Name to display"
                                },
                                "secretToken": {
                                    "type": "string",
                                    "title": "Secret token",
                                    "format": "password"
                                },
                                "role": {
                                    "type": "string",
                                    "title": "Role",
                                    "oneOf": [{
                                        "const": "maintainer",
                                        "title": "Maintainer"
                                    }]
                                },
                                "attempts": {
                                    "type": "integer",
                                    "title": "Attempts"
                                }
                            },
                            "required": ["displayName", "secretToken", "attempts"]
                        }
                    }
                }),
            )
            .await;
            let input_response = read_json_line(&mut lines).await;
            assert_eq!(input_response["id"], 100);
            assert_eq!(input_response["result"]["action"], "accept");
            assert_eq!(
                input_response["result"]["content"],
                json!({
                    "displayName": "Alice",
                    "secretToken": "answer-secret",
                    "attempts": 3
                })
            );

            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "method": "session/update",
                    "params": {
                        "sessionId": "session-1",
                        "update": {
                            "sessionUpdate": "tool_call_update",
                            "toolCallId": "tool-1",
                            "status": "completed",
                            "content": [{
                                "type": "content",
                                "content": { "type": "text", "text": "README loaded" }
                            }],
                            "rawOutput": { "accountEmail": "private@example.com" }
                        }
                    }
                }),
            )
            .await;
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "method": "session/update",
                    "params": {
                        "sessionId": "session-1",
                        "update": {
                            "sessionUpdate": "agent_message_chunk",
                            "content": { "type": "text", "text": "hello" }
                        }
                    }
                }),
            )
            .await;
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "id": prompt["id"],
                    "result": { "stopReason": "end_turn" }
                }),
            )
            .await;
        });

        let (control_sender, mut control_receiver) = mpsc::unbounded_channel();
        let (permission_acknowledgement, permission_ack) = oneshot::channel();
        control_sender
            .send(AgentControlCommand::Permission {
                request_id: "99".to_string(),
                decision: AgentPermissionDecision::Approve,
                option_id: None,
                acknowledgement: permission_acknowledgement,
            })
            .unwrap();
        let (input_acknowledgement, input_ack) = oneshot::channel();
        control_sender
            .send(AgentControlCommand::UserInput {
                request_id: "100".to_string(),
                answers: json!({
                    "displayName": "Alice",
                    "secretToken": "answer-secret",
                    "attempts": "3"
                })
                .as_object()
                .unwrap()
                .clone(),
                acknowledgement: input_acknowledgement,
            })
            .unwrap();
        let (_cancel_sender, cancel_receiver) = watch::channel(false);
        let mut events = Vec::new();
        let mut client = AcpConnection::new(client_reader, client_writer);
        let outcome = client
            .prompt_text_stream(
                "session-1",
                "test interactions",
                cancel_receiver,
                &mut control_receiver,
                |event| events.push(event),
            )
            .await
            .unwrap();

        assert_eq!(permission_ack.await.unwrap(), Ok(()));
        assert_eq!(input_ack.await.unwrap(), Ok(()));
        assert_eq!(outcome.text, "hello");
        assert_eq!(outcome.thought_chunk_count, 1);
        assert!(matches!(events[0], AcpRuntimeEvent::ThoughtChunk));
        assert!(matches!(events[1], AcpRuntimeEvent::ToolCall { .. }));
        assert!(matches!(
            events[2],
            AcpRuntimeEvent::PermissionRequest { .. }
        ));
        assert!(matches!(
            events[4],
            AcpRuntimeEvent::UserInputRequest { .. }
        ));
        let AcpRuntimeEvent::UserInputRequest { request } = &events[4] else {
            unreachable!();
        };
        let role = request
            .questions
            .iter()
            .find(|question| question.id == "role")
            .unwrap();
        assert_eq!(role.options[0].label, "Maintainer");
        assert_eq!(role.options[0].value, "maintainer");
        let attempts = request
            .questions
            .iter()
            .find(|question| question.id == "attempts")
            .unwrap();
        assert_eq!(attempts.input_type, "integer");
        assert!(matches!(events[6], AcpRuntimeEvent::ToolCallUpdate { .. }));
        assert!(matches!(events[7], AcpRuntimeEvent::TextDelta { .. }));
        let serialized_events = serde_json::to_string(&events).unwrap();
        assert!(!serialized_events.contains("private reasoning"));
        assert!(!serialized_events.contains("do-not-leak"));
        assert!(!serialized_events.contains("private-proxy"));
        assert!(!serialized_events.contains("private-account"));
        assert!(!serialized_events.contains("private@example.com"));
        assert!(!serialized_events.contains("answer-secret"));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn acp_cancel_resolves_pending_permission_and_finishes_cancelled() {
        let (client_io, server_io) = duplex(16 * 1024);
        let (client_reader, client_writer) = split(client_io);
        let (server_reader, mut server_writer) = split(server_io);
        let server = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let prompt = read_json_line(&mut lines).await;
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "id": 77,
                    "method": "session/request_permission",
                    "params": {
                        "sessionId": "session-1",
                        "toolCall": {
                            "toolCallId": "tool-1",
                            "title": "Delete file",
                            "status": "pending"
                        },
                        "options": [
                            { "optionId": "allow", "name": "Allow", "kind": "allow_once" },
                            { "optionId": "reject", "name": "Reject", "kind": "reject_once" }
                        ]
                    }
                }),
            )
            .await;

            let cancel = read_json_line(&mut lines).await;
            assert_eq!(cancel["method"], "session/cancel");
            assert_eq!(cancel["params"]["sessionId"], "session-1");
            let permission_response = read_json_line(&mut lines).await;
            assert_eq!(permission_response["id"], 77);
            assert_eq!(
                permission_response["result"]["outcome"]["outcome"],
                "cancelled"
            );
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "id": prompt["id"],
                    "result": { "stopReason": "cancelled" }
                }),
            )
            .await;
        });

        let (cancel_sender, cancel_receiver) = watch::channel(false);
        cancel_sender.send(true).unwrap();
        let (_control_sender, mut control_receiver) = mpsc::unbounded_channel();
        let mut events = Vec::new();
        let mut client = AcpConnection::new(client_reader, client_writer);
        let outcome = client
            .prompt_text_stream(
                "session-1",
                "delete a file",
                cancel_receiver,
                &mut control_receiver,
                |event| events.push(event),
            )
            .await
            .unwrap();

        assert!(outcome.cancel_sent);
        assert_eq!(outcome.stop_reason, "cancelled");
        assert!(matches!(
            events.as_slice(),
            [
                AcpRuntimeEvent::PermissionRequest { .. },
                AcpRuntimeEvent::InteractionResolved { .. }
            ]
        ));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn acp_prompt_cancels_permission_requests_during_poc() {
        let (client_io, server_io) = duplex(16 * 1024);
        let (client_reader, client_writer) = split(client_io);
        let (server_reader, mut server_writer) = split(server_io);
        let server = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let prompt = read_json_line(&mut lines).await;
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "id": 99,
                    "method": "session/request_permission",
                    "params": {
                        "sessionId": "session-1",
                        "toolCall": {
                            "toolCallId": "tool-1",
                            "title": "Run command",
                            "status": "pending"
                        },
                        "options": [{
                            "optionId": "allow",
                            "name": "Allow",
                            "kind": "allow_once"
                        }]
                    }
                }),
            )
            .await;
            let response = read_json_line(&mut lines).await;
            assert_eq!(response["id"], 99);
            assert_eq!(response["result"]["outcome"]["outcome"], "cancelled");
            write_json_line(
                &mut server_writer,
                json!({
                    "jsonrpc": "2.0",
                    "id": prompt["id"],
                    "result": { "stopReason": "end_turn" }
                }),
            )
            .await;
        });

        let (_cancel_sender, cancel_receiver) = watch::channel(false);
        let mut client = AcpConnection::new(client_reader, client_writer);
        let outcome = client
            .prompt_text("session-1", "request a tool", cancel_receiver)
            .await
            .unwrap();
        assert_eq!(outcome.stop_reason, "end_turn");
        assert_eq!(
            outcome.client_request_methods,
            vec!["session/request_permission"]
        );
        server.await.unwrap();
    }

    #[tokio::test]
    #[ignore = "requires an authenticated Grok CLI and explicit GROK_CLI_PATH"]
    async fn grok_acp_real_smoke_covers_prompt_load_and_cancel() {
        let program = std::env::var("GROK_CLI_PATH").expect("GROK_CLI_PATH");
        let cwd = std::env::current_dir().expect("current directory");

        let mut client = AcpStdioClient::spawn(&program, &["agent", "stdio"], &cwd)
            .await
            .expect("spawn Grok ACP");
        let initialize = client.initialize("test").await.expect("initialize");
        assert!(initialize.load_session);
        assert!(initialize
            .auth_methods
            .iter()
            .any(|method| method.id == "cached_token"));
        client
            .authenticate("cached_token")
            .await
            .expect("authenticate");
        let session = client.new_session(&cwd).await.expect("new session");
        let (_cancel_sender, cancel_receiver) = watch::channel(false);
        let outcome = client
            .prompt_text(
                &session.session_id,
                "Reply with exactly PONG. Do not use tools.",
                cancel_receiver,
            )
            .await
            .expect("prompt");
        assert_eq!(outcome.stop_reason, "end_turn");
        assert_eq!(outcome.text.trim(), "PONG");
        client.shutdown().await;

        let mut resumed = AcpStdioClient::spawn(&program, &["agent", "stdio"], &cwd)
            .await
            .expect("spawn resumed Grok ACP");
        resumed.initialize("test").await.expect("reinitialize");
        resumed
            .authenticate("cached_token")
            .await
            .expect("reauthenticate");
        let loaded = resumed
            .load_session(&session.session_id, &cwd)
            .await
            .expect("load session");
        assert_eq!(loaded.session_id, session.session_id);

        let cancel_session = resumed.new_session(&cwd).await.expect("cancel session");
        let (cancel_sender, cancel_receiver) = watch::channel(false);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(1)).await;
            cancel_sender.send(true).expect("send cancellation");
        });
        let cancelled = resumed
            .prompt_text(
                &cancel_session.session_id,
                "Write a detailed essay about software architecture. Do not use tools.",
                cancel_receiver,
            )
            .await
            .expect("cancel prompt");
        assert!(cancelled.cancel_sent);
        assert_eq!(cancelled.stop_reason, "cancelled");
        resumed.shutdown().await;
    }
}
