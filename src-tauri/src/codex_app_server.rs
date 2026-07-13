use crate::agent_runtime::{
    AgentApprovalOption, AgentApprovalRequest, AgentControlCommand, AgentPermissionDecision,
    AgentUserInputOption, AgentUserInputQuestion, AgentUserInputRequest,
};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{
    collections::{HashMap, HashSet},
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

const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const TURN_TIMEOUT: Duration = Duration::from_secs(30 * 60);
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
    Rpc { code: i64, message: String },
    Execution(String),
    Protocol(String),
    Timeout(&'static str),
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
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CodexTurnOutcome {
    pub stop_reason: String,
    pub text: String,
    pub text_truncated: bool,
    pub cancel_sent: bool,
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
        let mut pending_interactions = HashMap::<String, PendingInteraction>::new();
        let mut cancel_sent = false;
        let mut cancel_channel_open = true;
        let mut control_channel_open = true;
        let mut interrupt_request_ids = HashSet::<u64>::new();
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
                            if id.as_u64().is_some_and(|value| interrupt_request_ids.remove(&value)) {
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
                                &mut pending_interactions,
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
                                    }),
                                    CodexTurnTerminal::Interrupted => Ok(CodexTurnOutcome {
                                        stop_reason: "cancelled".to_string(),
                                        text: collected_text,
                                        text_truncated,
                                        cancel_sent,
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
        let mut command = Command::new(program);
        command
            .arg("app-server")
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
    pending_interactions: &mut HashMap<String, PendingInteraction>,
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
        "item/completed" => {
            if let Some(item) = params.get("item") {
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
                if let Some((tool_id, content, is_error)) = tool_completed_event(item) {
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

fn tool_completed_event(item: &Value) -> Option<(String, String, bool)> {
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
        }),
        "fileChange" => json!({
            "status": status,
            "changes": item.get("changes").cloned().unwrap_or(Value::Null),
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
            json!({ "method": "item/completed", "params": { "threadId": "thread-1", "turnId": "turn-1", "item": { "id": "tool-2", "type": "fileChange", "status": "completed", "changes": [{ "path": "src/main.rs", "kind": "update" }] } } }),
        )
        .await;
        assert!(matches!(
            next_event(&mut event_receiver).await,
            CodexRuntimeEvent::ToolCompleted { tool_id, is_error: false, .. }
                if tool_id == "tool-2"
        ));

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
        let (_control_sender, mut control_receiver) = mpsc::unbounded_channel();
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
