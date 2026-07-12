use crate::{
    acp::{
        AcpError, AcpPromptOutcome, AcpRuntimeEvent, AcpStdioClient, AcpToolCall, AcpToolCallUpdate,
    },
    agent_runtime::{
        normalize_agent_permission_mode, AgentApprovalOption, AgentApprovalRequest,
        AgentControlCommand, AgentPermissionDecision, AgentRunEvent, AgentUserInputOption,
        AgentUserInputQuestion, AgentUserInputRequest, GROK_BUILD_PROVIDER_ID,
        OPENAI_CODEX_PROVIDER_ID,
    },
    codex_app_server::{CodexAppServerError, CodexRuntimeEvent, CodexStdioClient},
};
use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use bytes::Bytes;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::{
    collections::{BTreeMap, HashMap},
    env, fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::{mpsc, oneshot, watch, Notify};

const EXPERIMENTAL_AGENT_RUN_ENV: &str = "CODEM_ENABLE_EXPERIMENTAL_AGENT_RUN";
const RUN_RETENTION: Duration = Duration::from_secs(10 * 60);
const CONTROL_ACK_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_PROMPT_BYTES: usize = 1024 * 1024;

type CommandResolver = fn() -> Option<String>;

#[derive(Clone, Copy)]
struct CommandResolvers {
    grok: CommandResolver,
    codex: CommandResolver,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AgentDriverKind {
    GrokAcp,
    CodexAppServer,
}

#[derive(Clone)]
struct AgentRunState {
    records: Arc<Mutex<HashMap<String, AgentRunRecord>>>,
    command_resolvers: CommandResolvers,
}

struct AgentRunRecord {
    events: Vec<AgentRunEvent>,
    finished: bool,
    terminal_emitted: bool,
    notify: Arc<Notify>,
    cancel: watch::Sender<bool>,
    control: mpsc::UnboundedSender<AgentControlCommand>,
}

struct AcpRunTask {
    state: AgentRunState,
    run_id: String,
    command: String,
    working_directory: PathBuf,
    prompt: String,
    requested_session_id: Option<String>,
    permission_mode: &'static str,
    cancel: watch::Receiver<bool>,
    control: mpsc::UnboundedReceiver<AgentControlCommand>,
}

struct CodexRunTask {
    state: AgentRunState,
    run_id: String,
    command: String,
    working_directory: PathBuf,
    prompt: String,
    requested_session_id: Option<String>,
    permission_mode: &'static str,
    cancel: watch::Receiver<bool>,
    control: mpsc::UnboundedReceiver<AgentControlCommand>,
}

#[derive(Debug)]
struct AgentApiError {
    status: StatusCode,
    message: String,
}

impl AgentApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }

    fn conflict(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl IntoResponse for AgentApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

type AgentApiResult<T> = Result<T, AgentApiError>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartAgentRunRequest {
    provider_id: String,
    prompt: String,
    working_directory: String,
    session_id: Option<String>,
    permission_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalDecisionRequest {
    request_id: String,
    decision: String,
    option_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserInputResponseRequest {
    request_id: String,
    answers: Map<String, Value>,
}

pub(crate) fn router(
    grok_command_resolver: CommandResolver,
    codex_command_resolver: CommandResolver,
) -> Router {
    let state = AgentRunState {
        records: Arc::new(Mutex::new(HashMap::new())),
        command_resolvers: CommandResolvers {
            grok: grok_command_resolver,
            codex: codex_command_resolver,
        },
    };
    Router::new()
        .route("/api/agents/run", post(start_agent_run))
        .route("/api/agents/run/{run_id}/events", get(agent_run_events))
        .route(
            "/api/agents/run/{run_id}/approval-decision",
            post(agent_run_approval_decision),
        )
        .route(
            "/api/agents/run/{run_id}/request-user-input",
            post(agent_run_user_input),
        )
        .route("/api/agents/run/{run_id}", delete(cancel_agent_run))
        .with_state(state)
}

async fn start_agent_run(
    State(state): State<AgentRunState>,
    Json(payload): Json<StartAgentRunRequest>,
) -> AgentApiResult<Response> {
    if !experimental_agent_run_enabled() {
        return Err(AgentApiError::forbidden(format!(
            "实验 Agent 运行未开启，请显式设置 {EXPERIMENTAL_AGENT_RUN_ENV}=1"
        )));
    }
    let provider_id = payload.provider_id.trim();
    let (driver, command, provider_name) = match provider_id {
        GROK_BUILD_PROVIDER_ID => (
            AgentDriverKind::GrokAcp,
            (state.command_resolvers.grok)()
                .ok_or_else(|| AgentApiError::bad_request("未找到 grok 命令"))?,
            "Grok Build",
        ),
        OPENAI_CODEX_PROVIDER_ID => (
            AgentDriverKind::CodexAppServer,
            (state.command_resolvers.codex)().ok_or_else(|| {
                AgentApiError::bad_request(
                    "未找到可由 CodeM 启动的 Codex CLI，请安装独立 CLI 或设置 CODEX_CLI_PATH",
                )
            })?,
            "OpenAI Codex",
        ),
        _ => {
            return Err(AgentApiError::bad_request(
                "当前 Provider 不支持通用 Agent 运行",
            ))
        }
    };
    let prompt = payload.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err(AgentApiError::bad_request("prompt 不能为空"));
    }
    if prompt.len() > MAX_PROMPT_BYTES {
        return Err(AgentApiError::bad_request("prompt 超过 1 MiB 限制"));
    }
    let working_directory = resolve_working_directory(&payload.working_directory)?;
    let session_id = normalize_optional_id(payload.session_id, "sessionId")?;
    let permission_mode = normalize_agent_permission_mode(payload.permission_mode.as_deref())
        .ok_or_else(|| {
            AgentApiError::bad_request("permissionMode 仅支持 default、auto 或 bypassPermissions")
        })?;
    let run_id = uuid::Uuid::new_v4().to_string();
    let (cancel_sender, cancel_receiver) = watch::channel(false);
    let (control_sender, control_receiver) = mpsc::unbounded_channel();
    state.insert(
        run_id.clone(),
        AgentRunRecord {
            events: Vec::new(),
            finished: false,
            terminal_emitted: false,
            notify: Arc::new(Notify::new()),
            cancel: cancel_sender,
            control: control_sender,
        },
    )?;
    state.push_event(
        &run_id,
        AgentRunEvent::Status {
            run_id: run_id.clone(),
            message: format!("正在启动 {provider_name}"),
        },
    );

    let task_state = state.clone();
    let task_run_id = run_id.clone();
    tokio::spawn(async move {
        match driver {
            AgentDriverKind::GrokAcp => {
                execute_acp_run(AcpRunTask {
                    state: task_state,
                    run_id: task_run_id,
                    command,
                    working_directory,
                    prompt,
                    requested_session_id: session_id,
                    permission_mode,
                    cancel: cancel_receiver,
                    control: control_receiver,
                })
                .await;
            }
            AgentDriverKind::CodexAppServer => {
                execute_codex_run(CodexRunTask {
                    state: task_state,
                    run_id: task_run_id,
                    command,
                    working_directory,
                    prompt,
                    requested_session_id: session_id,
                    permission_mode,
                    cancel: cancel_receiver,
                    control: control_receiver,
                })
                .await;
            }
        }
    });

    build_event_stream(state, run_id, 0)
}

async fn execute_acp_run(task: AcpRunTask) {
    let AcpRunTask {
        state,
        run_id,
        command,
        working_directory,
        prompt,
        requested_session_id,
        permission_mode,
        cancel,
        mut control,
    } = task;
    let arguments = grok_acp_arguments(permission_mode);
    let mut client = match AcpStdioClient::spawn(&command, &arguments, &working_directory).await {
        Ok(client) => client,
        Err(error) => {
            state.push_terminal(
                &run_id,
                AgentRunEvent::Error {
                    run_id: run_id.clone(),
                    message: error.public_message().to_string(),
                },
            );
            return;
        }
    };

    let mut mapper = AcpEventMapper::new(run_id.clone());
    let execution = async {
        let initialize = client
            .initialize(env!("CARGO_PKG_VERSION"))
            .await
            .map_err(public_acp_error)?;
        let auth_method_id = initialize
            .auth_methods
            .iter()
            .find(|method| method.id == "cached_token")
            .map(|method| method.id.as_str())
            .ok_or_else(|| "Grok Build 没有可用缓存认证，请先运行 grok login".to_string())?;
        client
            .authenticate(auth_method_id)
            .await
            .map_err(public_acp_error)?;
        let session = if let Some(session_id) = requested_session_id.as_deref() {
            if !initialize.load_session {
                return Err("当前 Grok Build ACP 不支持恢复会话".to_string());
            }
            client
                .load_session(session_id, &working_directory)
                .await
                .map_err(public_acp_error)?
        } else {
            client
                .new_session(&working_directory)
                .await
                .map_err(public_acp_error)?
        };
        state.push_event(
            &run_id,
            AgentRunEvent::Session {
                run_id: run_id.clone(),
                session_id: session.session_id.clone(),
            },
        );
        state.push_event(
            &run_id,
            AgentRunEvent::Status {
                run_id: run_id.clone(),
                message: if requested_session_id.is_some() {
                    "已恢复 Grok Build ACP 会话".to_string()
                } else {
                    "已创建 Grok Build ACP 会话".to_string()
                },
            },
        );

        let outcome = if *cancel.borrow() {
            cancelled_before_prompt_outcome()
        } else {
            let event_state = state.clone();
            client
                .prompt_text_stream(
                    &session.session_id,
                    &prompt,
                    cancel,
                    &mut control,
                    |event| {
                        for event in mapper.map_event(event) {
                            event_state.push_event(&run_id, event);
                        }
                    },
                )
                .await
                .map_err(public_acp_error)?
        };
        Ok::<_, String>((session.session_id, outcome))
    }
    .await;

    client.shutdown().await;
    for event in mapper.finish_open_tools() {
        state.push_event(&run_id, event);
    }
    match execution {
        Ok((session_id, outcome)) => state.push_terminal(
            &run_id,
            AgentRunEvent::Done {
                run_id: run_id.clone(),
                session_id,
                result: outcome.text,
                stop_reason: outcome.stop_reason,
            },
        ),
        Err(message) => state.push_terminal(
            &run_id,
            AgentRunEvent::Error {
                run_id: run_id.clone(),
                message,
            },
        ),
    };
}

async fn execute_codex_run(task: CodexRunTask) {
    let CodexRunTask {
        state,
        run_id,
        command,
        working_directory,
        prompt,
        requested_session_id,
        permission_mode,
        cancel,
        mut control,
    } = task;
    let mut client = match CodexStdioClient::spawn(&command, &working_directory).await {
        Ok(client) => client,
        Err(error) => {
            state.push_terminal(
                &run_id,
                AgentRunEvent::Error {
                    run_id: run_id.clone(),
                    message: error.public_message(),
                },
            );
            return;
        }
    };

    let mut mapper = CodexEventMapper::new(run_id.clone());
    let execution = async {
        client
            .initialize(env!("CARGO_PKG_VERSION"))
            .await
            .map_err(public_codex_error)?;
        let session_id = client
            .start_or_resume_thread(requested_session_id.as_deref(), &working_directory)
            .await
            .map_err(public_codex_error)?;
        state.push_event(
            &run_id,
            AgentRunEvent::Session {
                run_id: run_id.clone(),
                session_id: session_id.clone(),
            },
        );
        state.push_event(
            &run_id,
            AgentRunEvent::Status {
                run_id: run_id.clone(),
                message: if requested_session_id.is_some() {
                    "已恢复 OpenAI Codex 会话".to_string()
                } else {
                    "已创建 OpenAI Codex 会话".to_string()
                },
            },
        );

        let event_state = state.clone();
        let outcome = client
            .run_text_turn(
                &session_id,
                &working_directory,
                &prompt,
                permission_mode,
                cancel,
                &mut control,
                |event| {
                    for event in mapper.map_event(event) {
                        event_state.push_event(&run_id, event);
                    }
                },
            )
            .await
            .map_err(public_codex_error)?;
        Ok::<_, String>((session_id, outcome))
    }
    .await;

    client.shutdown().await;
    for event in mapper.finish_open_tools() {
        state.push_event(&run_id, event);
    }
    match execution {
        Ok((session_id, outcome)) => state.push_terminal(
            &run_id,
            AgentRunEvent::Done {
                run_id: run_id.clone(),
                session_id,
                result: outcome.text,
                stop_reason: outcome.stop_reason,
            },
        ),
        Err(message) => state.push_terminal(
            &run_id,
            AgentRunEvent::Error {
                run_id: run_id.clone(),
                message,
            },
        ),
    };
}

fn cancelled_before_prompt_outcome() -> AcpPromptOutcome {
    AcpPromptOutcome {
        stop_reason: "cancelled".to_string(),
        text: String::new(),
        text_truncated: false,
        thought_chunk_count: 0,
        update_counts: BTreeMap::new(),
        client_request_methods: Vec::new(),
        cancel_sent: true,
    }
}

async fn agent_run_events(
    State(state): State<AgentRunState>,
    AxumPath(run_id): AxumPath<String>,
    Query(query): Query<HashMap<String, String>>,
) -> AgentApiResult<Response> {
    if !state.contains(&run_id)? {
        return Err(AgentApiError::not_found("Agent 运行不存在或已过期"));
    }
    let after = query
        .get("after")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    build_event_stream(state, run_id, after)
}

async fn agent_run_approval_decision(
    State(state): State<AgentRunState>,
    AxumPath(run_id): AxumPath<String>,
    Json(payload): Json<ApprovalDecisionRequest>,
) -> AgentApiResult<Json<Value>> {
    let request_id = required_id(&payload.request_id, "requestId")?;
    let decision = match payload.decision.trim() {
        "approve" => AgentPermissionDecision::Approve,
        "reject" => AgentPermissionDecision::Reject,
        _ => {
            return Err(AgentApiError::bad_request(
                "decision 必须是 approve 或 reject",
            ))
        }
    };
    let option_id = normalize_optional_id(payload.option_id, "optionId")?;
    let control = state.control_sender(&run_id)?;
    let (acknowledgement, receiver) = oneshot::channel();
    control
        .send(AgentControlCommand::Permission {
            request_id,
            decision,
            option_id,
            acknowledgement,
        })
        .map_err(|_| AgentApiError::conflict("Agent 运行已结束，无法提交权限决定"))?;
    await_control_ack(receiver).await?;
    Ok(Json(json!({ "submitted": true })))
}

async fn agent_run_user_input(
    State(state): State<AgentRunState>,
    AxumPath(run_id): AxumPath<String>,
    Json(payload): Json<UserInputResponseRequest>,
) -> AgentApiResult<Json<Value>> {
    let request_id = required_id(&payload.request_id, "requestId")?;
    if payload.answers.is_empty() {
        return Err(AgentApiError::bad_request("answers 不能为空"));
    }
    let control = state.control_sender(&run_id)?;
    let (acknowledgement, receiver) = oneshot::channel();
    control
        .send(AgentControlCommand::UserInput {
            request_id,
            answers: payload.answers,
            acknowledgement,
        })
        .map_err(|_| AgentApiError::conflict("Agent 运行已结束，无法提交回答"))?;
    await_control_ack(receiver).await?;
    Ok(Json(json!({ "submitted": true })))
}

async fn cancel_agent_run(
    State(state): State<AgentRunState>,
    AxumPath(run_id): AxumPath<String>,
) -> AgentApiResult<Json<Value>> {
    let cancelled = state.cancel(&run_id)?;
    Ok(Json(json!({ "cancelled": cancelled })))
}

async fn await_control_ack(receiver: oneshot::Receiver<Result<(), String>>) -> AgentApiResult<()> {
    match tokio::time::timeout(CONTROL_ACK_TIMEOUT, receiver).await {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(message))) => Err(AgentApiError::conflict(message)),
        Ok(Err(_)) => Err(AgentApiError::conflict(
            "Agent 运行已结束，控制请求未被处理",
        )),
        Err(_) => Err(AgentApiError::conflict("Agent 控制请求响应超时")),
    }
}

fn build_event_stream(
    state: AgentRunState,
    run_id: String,
    after: usize,
) -> AgentApiResult<Response> {
    let response_run_id = run_id.clone();
    let stream = async_stream::stream! {
        let mut index = after;
        while let Some(notify) = state.notify(&run_id) {
            let notified = notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let Some((events, finished)) = state.snapshot_after(&run_id, index) else {
                break;
            };
            index += events.len();
            let had_events = !events.is_empty();
            for event in events {
                if let Ok(payload) = serde_json::to_string(&event) {
                    yield Ok::<Bytes, std::convert::Infallible>(Bytes::from(format!("{payload}\n")));
                }
            }
            if finished {
                break;
            }
            if !had_events {
                notified.as_mut().await;
            }
        }
    };
    Response::builder()
        .header("Content-Type", "application/x-ndjson; charset=utf-8")
        .header("Cache-Control", "no-cache, no-transform")
        .header("X-CodeM-Agent-Run-Id", response_run_id)
        .body(Body::from_stream(stream))
        .map_err(|_| AgentApiError::internal("构建 Agent 事件流失败"))
}

impl AgentRunState {
    fn insert(&self, run_id: String, record: AgentRunRecord) -> AgentApiResult<()> {
        self.records
            .lock()
            .map_err(|_| AgentApiError::internal("锁定 Agent 运行状态失败"))?
            .insert(run_id, record);
        Ok(())
    }

    fn push_event(&self, run_id: &str, event: AgentRunEvent) -> bool {
        let terminal = is_terminal_event(&event);
        let mut notify = None;
        let mut accepted = false;
        if let Ok(mut records) = self.records.lock() {
            if let Some(record) = records.get_mut(run_id) {
                if record.finished || (terminal && record.terminal_emitted) {
                    return false;
                }
                record.terminal_emitted |= terminal;
                record.finished |= terminal;
                record.events.push(event);
                notify = Some(record.notify.clone());
                accepted = true;
            }
        }
        if let Some(notify) = notify {
            notify.notify_waiters();
        }
        if accepted && terminal {
            self.schedule_cleanup(run_id.to_string());
        }
        accepted
    }

    fn push_terminal(&self, run_id: &str, event: AgentRunEvent) -> bool {
        debug_assert!(is_terminal_event(&event));
        self.push_event(run_id, event)
    }

    fn schedule_cleanup(&self, run_id: String) {
        let state = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(RUN_RETENTION).await;
            if let Ok(mut records) = state.records.lock() {
                records.remove(&run_id);
            }
        });
    }

    fn contains(&self, run_id: &str) -> AgentApiResult<bool> {
        Ok(self
            .records
            .lock()
            .map_err(|_| AgentApiError::internal("读取 Agent 运行状态失败"))?
            .contains_key(run_id))
    }

    fn notify(&self, run_id: &str) -> Option<Arc<Notify>> {
        self.records
            .lock()
            .ok()?
            .get(run_id)
            .map(|record| record.notify.clone())
    }

    fn snapshot_after(&self, run_id: &str, after: usize) -> Option<(Vec<AgentRunEvent>, bool)> {
        let records = self.records.lock().ok()?;
        let record = records.get(run_id)?;
        Some((
            record.events.iter().skip(after).cloned().collect(),
            record.finished,
        ))
    }

    fn control_sender(
        &self,
        run_id: &str,
    ) -> AgentApiResult<mpsc::UnboundedSender<AgentControlCommand>> {
        let records = self
            .records
            .lock()
            .map_err(|_| AgentApiError::internal("读取 Agent 运行状态失败"))?;
        let record = records
            .get(run_id)
            .ok_or_else(|| AgentApiError::not_found("Agent 运行不存在或已过期"))?;
        if record.finished {
            return Err(AgentApiError::conflict("Agent 运行已经结束"));
        }
        Ok(record.control.clone())
    }

    fn cancel(&self, run_id: &str) -> AgentApiResult<bool> {
        let records = self
            .records
            .lock()
            .map_err(|_| AgentApiError::internal("读取 Agent 运行状态失败"))?;
        let record = records
            .get(run_id)
            .ok_or_else(|| AgentApiError::not_found("Agent 运行不存在或已过期"))?;
        if record.finished {
            return Ok(false);
        }
        record
            .cancel
            .send(true)
            .map_err(|_| AgentApiError::conflict("Agent 运行已结束，无法取消"))?;
        Ok(true)
    }
}

#[derive(Debug)]
struct ToolMappingState {
    block_index: u64,
    stopped: bool,
}

struct AcpEventMapper {
    run_id: String,
    next_block_index: u64,
    tools: HashMap<String, ToolMappingState>,
}

struct CodexEventMapper {
    run_id: String,
    next_block_index: u64,
    tools: HashMap<String, ToolMappingState>,
}

impl CodexEventMapper {
    fn new(run_id: String) -> Self {
        Self {
            run_id,
            next_block_index: 0,
            tools: HashMap::new(),
        }
    }

    fn map_event(&mut self, event: CodexRuntimeEvent) -> Vec<AgentRunEvent> {
        match event {
            CodexRuntimeEvent::Status { message } => vec![AgentRunEvent::Status {
                run_id: self.run_id.clone(),
                message,
            }],
            CodexRuntimeEvent::TextDelta { text } => vec![AgentRunEvent::Delta {
                run_id: self.run_id.clone(),
                text,
            }],
            CodexRuntimeEvent::ToolStarted {
                tool_id,
                name,
                input,
            } => {
                let mut events = Vec::new();
                self.ensure_tool_started(&tool_id, &name, input, &mut events);
                events
            }
            CodexRuntimeEvent::ToolCompleted {
                tool_id,
                content,
                is_error,
            } => {
                let mut events = Vec::new();
                let block_index =
                    self.ensure_tool_started(&tool_id, "Codex 工具", None, &mut events);
                self.finish_tool(&tool_id, block_index, is_error, Some(content), &mut events);
                events
            }
            CodexRuntimeEvent::ApprovalRequest { request } => {
                vec![AgentRunEvent::ApprovalRequest {
                    run_id: self.run_id.clone(),
                    request,
                }]
            }
            CodexRuntimeEvent::UserInputRequest { request } => {
                vec![AgentRunEvent::RequestUserInput {
                    run_id: self.run_id.clone(),
                    request,
                }]
            }
            CodexRuntimeEvent::InteractionResolved { .. } => Vec::new(),
        }
    }

    fn ensure_tool_started(
        &mut self,
        tool_id: &str,
        name: &str,
        input: Option<Value>,
        events: &mut Vec<AgentRunEvent>,
    ) -> u64 {
        if let Some(tool) = self.tools.get(tool_id) {
            return tool.block_index;
        }
        let block_index = self.next_block_index;
        self.next_block_index += 1;
        self.tools.insert(
            tool_id.to_string(),
            ToolMappingState {
                block_index,
                stopped: false,
            },
        );
        events.push(AgentRunEvent::ToolStart {
            run_id: self.run_id.clone(),
            block_index,
            tool_use_id: tool_id.to_string(),
            name: name.to_string(),
            input,
        });
        block_index
    }

    fn finish_tool(
        &mut self,
        tool_id: &str,
        block_index: u64,
        is_error: bool,
        content: Option<String>,
        events: &mut Vec<AgentRunEvent>,
    ) {
        let Some(tool) = self.tools.get_mut(tool_id) else {
            return;
        };
        if tool.stopped {
            return;
        }
        tool.stopped = true;
        events.push(AgentRunEvent::ToolResult {
            run_id: self.run_id.clone(),
            tool_use_id: tool_id.to_string(),
            content: content.unwrap_or_else(|| {
                if is_error {
                    "工具执行失败".to_string()
                } else {
                    "工具执行完成".to_string()
                }
            }),
            is_error,
        });
        events.push(AgentRunEvent::ToolStop {
            run_id: self.run_id.clone(),
            block_index,
            tool_use_id: tool_id.to_string(),
        });
    }

    fn finish_open_tools(&mut self) -> Vec<AgentRunEvent> {
        let mut tools = self
            .tools
            .iter_mut()
            .filter(|(_, tool)| !tool.stopped)
            .map(|(tool_id, tool)| {
                tool.stopped = true;
                (tool.block_index, tool_id.clone())
            })
            .collect::<Vec<_>>();
        tools.sort_by_key(|(block_index, _)| *block_index);
        tools
            .into_iter()
            .map(|(block_index, tool_use_id)| AgentRunEvent::ToolStop {
                run_id: self.run_id.clone(),
                block_index,
                tool_use_id,
            })
            .collect()
    }
}

impl AcpEventMapper {
    fn new(run_id: String) -> Self {
        Self {
            run_id,
            next_block_index: 0,
            tools: HashMap::new(),
        }
    }

    fn map_event(&mut self, event: AcpRuntimeEvent) -> Vec<AgentRunEvent> {
        match event {
            AcpRuntimeEvent::TextDelta { text } => vec![AgentRunEvent::Delta {
                run_id: self.run_id.clone(),
                text,
            }],
            AcpRuntimeEvent::ThoughtChunk | AcpRuntimeEvent::InteractionResolved { .. } => {
                Vec::new()
            }
            AcpRuntimeEvent::ToolCall { call } => self.map_tool_call(call),
            AcpRuntimeEvent::ToolCallUpdate { update } => self.map_tool_update(update),
            AcpRuntimeEvent::PermissionRequest { request } => {
                let description = request
                    .options
                    .iter()
                    .map(|option| option.name.as_str())
                    .collect::<Vec<_>>()
                    .join(" / ");
                vec![AgentRunEvent::ApprovalRequest {
                    run_id: self.run_id.clone(),
                    request: AgentApprovalRequest {
                        request_id: request.request_id,
                        kind: "permission".to_string(),
                        title: request.title,
                        description: (!description.is_empty()).then_some(description),
                        danger: "medium".to_string(),
                        options: request
                            .options
                            .into_iter()
                            .map(|option| AgentApprovalOption {
                                id: option.option_id,
                                label: option.name,
                                kind: option.kind,
                            })
                            .collect(),
                    },
                }]
            }
            AcpRuntimeEvent::UserInputRequest { request } => {
                vec![AgentRunEvent::RequestUserInput {
                    run_id: self.run_id.clone(),
                    request: AgentUserInputRequest {
                        request_id: request.request_id,
                        title: request.title,
                        description: request.description,
                        questions: request
                            .questions
                            .into_iter()
                            .map(|question| AgentUserInputQuestion {
                                id: question.id,
                                header: question.header,
                                question: question.question,
                                input_type: question.input_type,
                                options: question
                                    .options
                                    .into_iter()
                                    .map(|option| AgentUserInputOption {
                                        label: option.label,
                                        value: option.value,
                                        description: option.description,
                                    })
                                    .collect(),
                                multi_select: question.multi_select,
                                required: question.required,
                                secret: question.secret,
                            })
                            .collect(),
                    },
                }]
            }
        }
    }

    fn map_tool_call(&mut self, call: AcpToolCall) -> Vec<AgentRunEvent> {
        let mut events = Vec::new();
        let block_index = self.ensure_tool_started(
            &call.tool_call_id,
            &call.title,
            call.input.clone(),
            &mut events,
        );
        if matches!(call.status.as_deref(), Some("completed" | "failed")) {
            self.finish_tool(
                &call.tool_call_id,
                block_index,
                call.status.as_deref() == Some("failed"),
                call.content,
                &mut events,
            );
        }
        events
    }

    fn map_tool_update(&mut self, update: AcpToolCallUpdate) -> Vec<AgentRunEvent> {
        let mut events = Vec::new();
        let title = update
            .title
            .as_deref()
            .or(update.kind.as_deref())
            .unwrap_or("Agent 工具");
        let block_index = self.ensure_tool_started(
            &update.tool_call_id,
            title,
            update.input.clone(),
            &mut events,
        );
        if matches!(update.status.as_deref(), Some("completed" | "failed")) {
            self.finish_tool(
                &update.tool_call_id,
                block_index,
                update.status.as_deref() == Some("failed"),
                update.content,
                &mut events,
            );
        }
        events
    }

    fn ensure_tool_started(
        &mut self,
        tool_call_id: &str,
        title: &str,
        input: Option<Value>,
        events: &mut Vec<AgentRunEvent>,
    ) -> u64 {
        if let Some(tool) = self.tools.get(tool_call_id) {
            return tool.block_index;
        }
        let block_index = self.next_block_index;
        self.next_block_index += 1;
        self.tools.insert(
            tool_call_id.to_string(),
            ToolMappingState {
                block_index,
                stopped: false,
            },
        );
        events.push(AgentRunEvent::ToolStart {
            run_id: self.run_id.clone(),
            block_index,
            tool_use_id: tool_call_id.to_string(),
            name: title.to_string(),
            input,
        });
        block_index
    }

    fn finish_tool(
        &mut self,
        tool_call_id: &str,
        block_index: u64,
        failed: bool,
        content: Option<String>,
        events: &mut Vec<AgentRunEvent>,
    ) {
        let Some(tool) = self.tools.get_mut(tool_call_id) else {
            return;
        };
        if tool.stopped {
            return;
        }
        tool.stopped = true;
        events.push(AgentRunEvent::ToolResult {
            run_id: self.run_id.clone(),
            tool_use_id: tool_call_id.to_string(),
            content: content.unwrap_or_else(|| {
                if failed {
                    "工具执行失败".to_string()
                } else {
                    "工具执行完成".to_string()
                }
            }),
            is_error: failed,
        });
        events.push(AgentRunEvent::ToolStop {
            run_id: self.run_id.clone(),
            block_index,
            tool_use_id: tool_call_id.to_string(),
        });
    }

    fn finish_open_tools(&mut self) -> Vec<AgentRunEvent> {
        let mut tools = self
            .tools
            .iter_mut()
            .filter(|(_, tool)| !tool.stopped)
            .map(|(tool_call_id, tool)| {
                tool.stopped = true;
                (tool.block_index, tool_call_id.clone())
            })
            .collect::<Vec<_>>();
        tools.sort_by_key(|(block_index, _)| *block_index);
        tools
            .into_iter()
            .map(|(block_index, tool_use_id)| AgentRunEvent::ToolStop {
                run_id: self.run_id.clone(),
                block_index,
                tool_use_id,
            })
            .collect()
    }
}

fn is_terminal_event(event: &AgentRunEvent) -> bool {
    matches!(
        event,
        AgentRunEvent::Done { .. } | AgentRunEvent::Error { .. }
    )
}

fn public_acp_error(error: AcpError) -> String {
    error.public_message().to_string()
}

fn public_codex_error(error: CodexAppServerError) -> String {
    error.public_message()
}

fn resolve_working_directory(value: &str) -> AgentApiResult<PathBuf> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AgentApiError::bad_request("workingDirectory 不能为空"));
    }
    let path = Path::new(value);
    let canonical = fs::canonicalize(path)
        .map_err(|_| AgentApiError::bad_request("workingDirectory 不存在或不可访问"))?;
    if !canonical.is_dir() {
        return Err(AgentApiError::bad_request("workingDirectory 必须是目录"));
    }
    Ok(canonical)
}

fn required_id(value: &str, field: &str) -> AgentApiResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AgentApiError::bad_request(format!("{field} 不能为空")));
    }
    if value.len() > 512 {
        return Err(AgentApiError::bad_request(format!("{field} 过长")));
    }
    Ok(value.to_string())
}

fn normalize_optional_id(value: Option<String>, field: &str) -> AgentApiResult<Option<String>> {
    value.map(|value| required_id(&value, field)).transpose()
}

fn grok_acp_arguments(permission_mode: &'static str) -> [&'static str; 4] {
    ["--permission-mode", permission_mode, "agent", "stdio"]
}

pub(crate) fn experimental_agent_run_enabled() -> bool {
    experimental_agent_run_enabled_value(env::var(EXPERIMENTAL_AGENT_RUN_ENV).ok().as_deref())
}

fn experimental_agent_run_enabled_value(value: Option<&str>) -> bool {
    value.is_some_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes"
        )
    })
}

#[cfg(test)]
mod tests {
    use super::{
        cancelled_before_prompt_outcome, experimental_agent_run_enabled_value, grok_acp_arguments,
        AcpEventMapper, AgentRunRecord, AgentRunState, CodexEventMapper, CommandResolvers,
    };
    use crate::{
        acp::{AcpRuntimeEvent, AcpToolCall, AcpToolCallUpdate},
        agent_runtime::AgentRunEvent,
        codex_app_server::CodexRuntimeEvent,
    };
    use serde_json::json;
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
    };
    use tokio::sync::{mpsc, watch, Notify};

    #[test]
    fn experimental_agent_run_is_disabled_by_default() {
        assert!(!experimental_agent_run_enabled_value(None));
        assert!(!experimental_agent_run_enabled_value(Some("0")));
        assert!(experimental_agent_run_enabled_value(Some("TRUE")));
    }

    #[test]
    fn grok_acp_arguments_keep_permission_mode_as_a_separate_value() {
        assert_eq!(
            grok_acp_arguments("bypassPermissions"),
            ["--permission-mode", "bypassPermissions", "agent", "stdio"]
        );
    }

    #[test]
    fn cancel_before_prompt_settles_without_sending_agent_work() {
        let outcome = cancelled_before_prompt_outcome();
        assert_eq!(outcome.stop_reason, "cancelled");
        assert!(outcome.text.is_empty());
        assert!(outcome.cancel_sent);
    }

    #[test]
    fn acp_mapper_keeps_tool_order_and_emits_one_completion() {
        let mut mapper = AcpEventMapper::new("run-1".to_string());
        let start = mapper.map_event(AcpRuntimeEvent::ToolCall {
            call: AcpToolCall {
                tool_call_id: "tool-1".to_string(),
                title: "读取文件".to_string(),
                kind: Some("read".to_string()),
                status: Some("in_progress".to_string()),
                input: Some(json!({ "path": "README.md" })),
                content: None,
            },
        });
        let completed = mapper.map_event(AcpRuntimeEvent::ToolCallUpdate {
            update: AcpToolCallUpdate {
                tool_call_id: "tool-1".to_string(),
                title: None,
                kind: None,
                status: Some("completed".to_string()),
                input: None,
                content: Some("ok".to_string()),
            },
        });
        let duplicate = mapper.map_event(AcpRuntimeEvent::ToolCallUpdate {
            update: AcpToolCallUpdate {
                tool_call_id: "tool-1".to_string(),
                title: None,
                kind: None,
                status: Some("completed".to_string()),
                input: None,
                content: Some("duplicate".to_string()),
            },
        });

        assert!(matches!(
            start.as_slice(),
            [AgentRunEvent::ToolStart { block_index: 0, .. }]
        ));
        assert!(matches!(
            completed.as_slice(),
            [
                AgentRunEvent::ToolResult { .. },
                AgentRunEvent::ToolStop { block_index: 0, .. }
            ]
        ));
        assert!(duplicate.is_empty());
    }

    #[test]
    fn codex_mapper_preserves_text_tools_and_interactions() {
        let mut mapper = CodexEventMapper::new("run-1".to_string());
        let delta = mapper.map_event(CodexRuntimeEvent::TextDelta {
            text: "hello".to_string(),
        });
        let start = mapper.map_event(CodexRuntimeEvent::ToolStarted {
            tool_id: "tool-1".to_string(),
            name: "Bash".to_string(),
            input: Some(json!({ "command": "pwd" })),
        });
        let completed = mapper.map_event(CodexRuntimeEvent::ToolCompleted {
            tool_id: "tool-1".to_string(),
            content: "ok".to_string(),
            is_error: false,
        });
        let duplicate = mapper.map_event(CodexRuntimeEvent::ToolCompleted {
            tool_id: "tool-1".to_string(),
            content: "duplicate".to_string(),
            is_error: false,
        });

        assert!(matches!(
            delta.as_slice(),
            [AgentRunEvent::Delta { text, .. }] if text == "hello"
        ));
        assert!(matches!(
            start.as_slice(),
            [AgentRunEvent::ToolStart { block_index: 0, .. }]
        ));
        assert!(matches!(
            completed.as_slice(),
            [
                AgentRunEvent::ToolResult { .. },
                AgentRunEvent::ToolStop { block_index: 0, .. }
            ]
        ));
        assert!(duplicate.is_empty());
    }

    #[tokio::test]
    async fn run_state_accepts_only_one_terminal_event() {
        let state = AgentRunState {
            records: Arc::new(Mutex::new(HashMap::new())),
            command_resolvers: CommandResolvers {
                grok: || None,
                codex: || None,
            },
        };
        let (cancel, _) = watch::channel(false);
        let (control, _) = mpsc::unbounded_channel();
        state
            .insert(
                "run-1".to_string(),
                AgentRunRecord {
                    events: Vec::new(),
                    finished: false,
                    terminal_emitted: false,
                    notify: Arc::new(Notify::new()),
                    cancel,
                    control,
                },
            )
            .unwrap();

        assert!(state.push_terminal(
            "run-1",
            AgentRunEvent::Done {
                run_id: "run-1".to_string(),
                session_id: "session-1".to_string(),
                result: "done".to_string(),
                stop_reason: "end_turn".to_string(),
            }
        ));
        assert!(!state.push_terminal(
            "run-1",
            AgentRunEvent::Error {
                run_id: "run-1".to_string(),
                message: "late error".to_string(),
            }
        ));
        let (events, finished) = state.snapshot_after("run-1", 0).unwrap();
        assert!(finished);
        assert_eq!(events.len(), 1);
    }
}
