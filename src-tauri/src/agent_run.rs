use crate::{
    acp::{
        AcpEmbeddedResource, AcpError, AcpPromptInput, AcpPromptOutcome, AcpRuntimeEvent,
        AcpStdioClient, AcpToolCall, AcpToolCallUpdate,
    },
    agent_runtime::{
        normalize_agent_permission_mode, AgentApprovalOption, AgentApprovalRequest,
        AgentControlCommand, AgentPermissionDecision, AgentRunEvent, AgentUsageSnapshot,
        AgentUserInputOption, AgentUserInputQuestion, AgentUserInputRequest,
        GROK_BUILD_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID,
    },
    codex_app_server::{CodexAppServerError, CodexRuntimeEvent, CodexStdioClient, CodexUserInput},
};
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path as AxumPath, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use base64::{engine::general_purpose, Engine as _};
use bytes::Bytes;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::{BTreeMap, HashMap},
    env, fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::sync::{mpsc, oneshot, watch, Notify};

const RUN_RETENTION: Duration = Duration::from_secs(10 * 60);
const CONTROL_ACK_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_PROMPT_BYTES: usize = 1024 * 1024;
const MAX_INPUT_BLOCKS: usize = 32;
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES: usize = 30 * 1024 * 1024;
const MAX_AGENT_REQUEST_BYTES: usize = 42 * 1024 * 1024;
const MAX_PATH_BYTES: usize = 4096;
const MAX_NAME_BYTES: usize = 512;
const MAX_MIME_TYPE_BYTES: usize = 255;
const MAX_REASON_BYTES: usize = 4096;

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

enum AgentDriverInput {
    Grok(Vec<AcpPromptInput>),
    Codex(Vec<CodexUserInput>),
}

#[derive(Clone)]
struct AgentRunState {
    records: Arc<Mutex<HashMap<String, AgentRunRecord>>>,
    runtimes: Arc<Mutex<HashMap<String, AgentRuntimeRecord>>>,
    command_resolvers: CommandResolvers,
    experimental_agent_run_enabled: Arc<AtomicBool>,
}

struct AgentRunRecord {
    thread_id: Option<String>,
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
    input: Vec<AcpPromptInput>,
    requested_session_id: Option<String>,
    permission_mode: &'static str,
    model: Option<String>,
    cancel: watch::Receiver<bool>,
    control: mpsc::UnboundedReceiver<AgentControlCommand>,
}

struct CodexRunTask {
    state: AgentRunState,
    run_id: String,
    command: String,
    working_directory: PathBuf,
    input: Vec<CodexUserInput>,
    requested_session_id: Option<String>,
    permission_mode: &'static str,
    model: Option<String>,
    reasoning_effort: Option<String>,
    cancel: watch::Receiver<bool>,
    control: mpsc::UnboundedReceiver<AgentControlCommand>,
}

#[derive(Clone)]
pub(crate) struct AgentRunService {
    state: AgentRunState,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct AgentRuntimeConfig {
    provider_id: String,
    driver: AgentDriverKind,
    command: String,
    working_directory: PathBuf,
    permission_mode: &'static str,
    model: Option<String>,
    reasoning_effort: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum AgentRuntimePhase {
    Starting,
    Ready,
    Running,
    Closed,
    Failed,
}

struct AgentRuntimeRecord {
    runtime_id: String,
    config: AgentRuntimeConfig,
    session_id: Option<String>,
    phase: AgentRuntimePhase,
    current_run_id: Option<String>,
    command: Option<mpsc::UnboundedSender<AgentRuntimeCommand>>,
    shutdown: watch::Sender<bool>,
    last_error: Option<String>,
}

struct AgentRuntimeRun {
    run_id: String,
    input: AgentDriverInput,
    cancel: watch::Receiver<bool>,
    control: mpsc::UnboundedReceiver<AgentControlCommand>,
}

enum AgentRuntimeCommand {
    Run(AgentRuntimeRun),
}

enum RuntimeDispatchAction {
    Reuse(mpsc::UnboundedSender<AgentRuntimeCommand>),
    Start {
        runtime_id: String,
        commands: mpsc::UnboundedReceiver<AgentRuntimeCommand>,
        shutdown: watch::Receiver<bool>,
    },
}

enum LiveAgentRuntime {
    Grok {
        client: AcpStdioClient,
        session_id: String,
    },
    Codex {
        client: CodexStdioClient,
        session_id: String,
    },
}

struct RuntimeTurnOutcome {
    session_id: String,
    text: String,
    stop_reason: String,
    usage: AgentUsageSnapshot,
}

struct RuntimeTurnError {
    message: String,
    fatal: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRuntimeStatus {
    thread_id: String,
    exists: bool,
    phase: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    current_run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_error: Option<String>,
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
    #[serde(default)]
    thread_id: Option<String>,
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    content_blocks: Option<Vec<AgentInputContentBlock>>,
    working_directory: String,
    session_id: Option<String>,
    permission_mode: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum AgentInputContentBlock {
    Text {
        text: String,
    },
    Image {
        id: Option<String>,
        path: Option<String>,
        name: Option<String>,
        mime_type: Option<String>,
        size: Option<u64>,
        data: Option<String>,
    },
    FileText {
        id: Option<String>,
        path: String,
        name: String,
        mime_type: Option<String>,
        size: Option<u64>,
        text: String,
        text_bytes: Option<u64>,
    },
    FileReference {
        id: Option<String>,
        path: String,
        name: String,
        mime_type: Option<String>,
        size: Option<u64>,
        reason: Option<String>,
        source: Option<String>,
    },
    AttachmentMetadata {
        id: Option<String>,
        name: String,
        mime_type: Option<String>,
        size: Option<u64>,
        reason: String,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentReasoningEffortSummary {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentModelSummary {
    id: String,
    label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    context_window_tokens: Option<u64>,
    is_default: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_reasoning_effort: Option<String>,
    supported_reasoning_efforts: Vec<AgentReasoningEffortSummary>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentModelCatalog {
    provider_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_model_id: Option<String>,
    models: Vec<AgentModelSummary>,
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

impl AgentRunService {
    pub(crate) fn new(
        grok_command_resolver: fn() -> Option<String>,
        codex_command_resolver: fn() -> Option<String>,
        experimental_agent_run_enabled: Arc<AtomicBool>,
    ) -> Self {
        Self {
            state: AgentRunState {
                records: Arc::new(Mutex::new(HashMap::new())),
                runtimes: Arc::new(Mutex::new(HashMap::new())),
                command_resolvers: CommandResolvers {
                    grok: grok_command_resolver,
                    codex: codex_command_resolver,
                },
                experimental_agent_run_enabled,
            },
        }
    }

    pub(crate) fn close_thread_runtime(&self, thread_id: &str) -> Result<bool, String> {
        self.state.close_runtime(thread_id)
    }

    pub(crate) fn forget_thread(&self, thread_id: &str) {
        let _ = self.close_thread_runtime(thread_id);
        self.state.remove_run_records_for_thread(thread_id);
        if let Ok(mut runtimes) = self.state.runtimes.lock() {
            runtimes.remove(thread_id);
        }
    }
}

pub(crate) fn router(service: AgentRunService) -> Router {
    let state = service.state;
    Router::new()
        .route("/api/agents/{provider_id}/models", get(agent_models))
        .route("/api/agents/runtimes", get(agent_runtime_statuses))
        .route(
            "/api/agents/runtime/{thread_id}",
            get(agent_runtime_status).delete(close_agent_runtime),
        )
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
        .layer(DefaultBodyLimit::max(MAX_AGENT_REQUEST_BYTES))
        .with_state(state)
}

async fn agent_models(
    State(state): State<AgentRunState>,
    AxumPath(provider_id): AxumPath<String>,
) -> AgentApiResult<Json<AgentModelCatalog>> {
    if !experimental_agent_run_enabled(&state.experimental_agent_run_enabled) {
        return Err(AgentApiError::forbidden(
            "实验 Agent 运行未开启，请在设置中启用",
        ));
    }
    let cwd =
        env::current_dir().map_err(|_| AgentApiError::internal("无法读取模型目录工作目录"))?;
    match provider_id.trim() {
        GROK_BUILD_PROVIDER_ID => {
            let command = (state.command_resolvers.grok)()
                .ok_or_else(|| AgentApiError::bad_request("未找到 grok 命令"))?;
            let arguments = grok_acp_arguments("default");
            let mut client = AcpStdioClient::spawn(&command, &arguments, &cwd)
                .await
                .map_err(|error| AgentApiError::internal(error.public_message()))?;
            let result = async {
                let initialize = client.initialize(env!("CARGO_PKG_VERSION")).await?;
                let auth_method_id = initialize
                    .auth_methods
                    .iter()
                    .find(|method| method.id == "cached_token")
                    .map(|method| method.id.as_str())
                    .ok_or_else(|| {
                        AcpError::Protocol(
                            "Grok Build 没有可用缓存认证，请先运行 grok login".to_string(),
                        )
                    })?;
                client.authenticate(auth_method_id).await?;
                Ok::<_, AcpError>(initialize)
            }
            .await;
            client.shutdown().await;
            let initialize =
                result.map_err(|error| AgentApiError::internal(error.public_message()))?;
            let default_model_id = initialize.current_model_id.clone();
            let models = initialize
                .models
                .into_iter()
                .map(|model| AgentModelSummary {
                    is_default: default_model_id.as_deref() == Some(model.model_id.as_str()),
                    id: model.model_id,
                    label: model.name,
                    description: None,
                    context_window_tokens: model.context_tokens,
                    default_reasoning_effort: None,
                    supported_reasoning_efforts: Vec::new(),
                })
                .collect();
            Ok(Json(AgentModelCatalog {
                provider_id: GROK_BUILD_PROVIDER_ID.to_string(),
                default_model_id,
                models,
            }))
        }
        OPENAI_CODEX_PROVIDER_ID => {
            let command = (state.command_resolvers.codex)().ok_or_else(|| {
                AgentApiError::bad_request(
                    "未找到可由 CodeM 启动的 Codex CLI，请安装独立 CLI 或设置 CODEX_CLI_PATH",
                )
            })?;
            let mut client = CodexStdioClient::spawn(&command, &cwd)
                .await
                .map_err(|error| AgentApiError::internal(error.public_message()))?;
            let result = async {
                client.initialize(env!("CARGO_PKG_VERSION")).await?;
                client.list_models().await
            }
            .await;
            client.shutdown().await;
            let codex_models =
                result.map_err(|error| AgentApiError::internal(error.public_message()))?;
            let default_model_id = codex_models
                .iter()
                .find(|model| model.is_default)
                .map(|model| model.id.clone());
            let models = codex_models
                .into_iter()
                .map(|model| AgentModelSummary {
                    id: model.id,
                    label: model.label,
                    description: model.description,
                    context_window_tokens: None,
                    is_default: model.is_default,
                    default_reasoning_effort: model.default_reasoning_effort,
                    supported_reasoning_efforts: model
                        .supported_reasoning_efforts
                        .into_iter()
                        .map(|effort| AgentReasoningEffortSummary {
                            id: effort.id,
                            description: effort.description,
                        })
                        .collect(),
                })
                .collect();
            Ok(Json(AgentModelCatalog {
                provider_id: OPENAI_CODEX_PROVIDER_ID.to_string(),
                default_model_id,
                models,
            }))
        }
        _ => Err(AgentApiError::bad_request(
            "当前 Provider 不提供动态模型目录",
        )),
    }
}

async fn start_agent_run(
    State(state): State<AgentRunState>,
    Json(payload): Json<StartAgentRunRequest>,
) -> AgentApiResult<Response> {
    if !experimental_agent_run_enabled(&state.experimental_agent_run_enabled) {
        return Err(AgentApiError::forbidden(
            "实验 Agent 运行未开启，请在设置中启用",
        ));
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
    let input_blocks = normalize_agent_input(payload.prompt.as_deref(), payload.content_blocks)?;
    let working_directory = resolve_working_directory(&payload.working_directory)?;
    let driver_input = match driver {
        AgentDriverKind::GrokAcp => {
            AgentDriverInput::Grok(build_acp_prompt(&input_blocks, &working_directory)?)
        }
        AgentDriverKind::CodexAppServer => {
            AgentDriverInput::Codex(build_codex_input(&input_blocks, &working_directory)?)
        }
    };
    let thread_id = normalize_optional_id(payload.thread_id, "threadId")?;
    let session_id = normalize_optional_id(payload.session_id, "sessionId")?;
    let model = normalize_optional_id(payload.model, "model")?;
    let reasoning_effort = normalize_optional_id(payload.reasoning_effort, "reasoningEffort")?;
    if driver == AgentDriverKind::GrokAcp && reasoning_effort.is_some() {
        return Err(AgentApiError::bad_request(
            "当前 Grok Build 模型目录未提供 reasoning effort 能力",
        ));
    }
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
            thread_id: thread_id.clone(),
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
            message: if thread_id.is_some() {
                format!("正在连接 {provider_name} 热会话")
            } else {
                format!("正在启动 {provider_name}")
            },
        },
    );

    if let Some(thread_id) = thread_id {
        let config = AgentRuntimeConfig {
            provider_id: provider_id.to_string(),
            driver,
            command,
            working_directory,
            permission_mode,
            model,
            reasoning_effort,
        };
        if let Err(error) = state.dispatch_runtime(
            thread_id,
            config,
            session_id,
            AgentRuntimeRun {
                run_id: run_id.clone(),
                input: driver_input,
                cancel: cancel_receiver,
                control: control_receiver,
            },
        ) {
            state.remove_run_record(&run_id);
            return Err(error);
        }
    } else {
        let task_state = state.clone();
        let task_run_id = run_id.clone();
        tokio::spawn(async move {
            match driver_input {
                AgentDriverInput::Grok(input) => {
                    execute_acp_run(AcpRunTask {
                        state: task_state,
                        run_id: task_run_id,
                        command,
                        working_directory,
                        input,
                        requested_session_id: session_id,
                        permission_mode,
                        model,
                        cancel: cancel_receiver,
                        control: control_receiver,
                    })
                    .await;
                }
                AgentDriverInput::Codex(input) => {
                    execute_codex_run(CodexRunTask {
                        state: task_state,
                        run_id: task_run_id,
                        command,
                        working_directory,
                        input,
                        requested_session_id: session_id,
                        permission_mode,
                        model,
                        reasoning_effort,
                        cancel: cancel_receiver,
                        control: control_receiver,
                    })
                    .await;
                }
            }
        });
    }

    build_event_stream(state, run_id, 0)
}

async fn run_agent_runtime_actor(
    state: AgentRunState,
    thread_id: String,
    runtime_id: String,
    config: AgentRuntimeConfig,
    requested_session_id: Option<String>,
    first_run: AgentRuntimeRun,
    mut commands: mpsc::UnboundedReceiver<AgentRuntimeCommand>,
    mut shutdown: watch::Receiver<bool>,
) {
    let first_run_id = first_run.run_id.clone();
    let started = tokio::select! {
        result = start_live_agent_runtime(&config, requested_session_id.as_deref()) => Some(result),
        _ = wait_for_shutdown(&mut shutdown) => None,
    };
    let Some(started) = started else {
        state.push_terminal(
            &first_run_id,
            AgentRunEvent::Error {
                run_id: first_run_id.clone(),
                message: "Agent 热会话已关闭".to_string(),
            },
        );
        state.mark_runtime_closed(&thread_id, &runtime_id, Some(&first_run_id));
        return;
    };
    let (mut runtime, resumed) = match started {
        Ok(runtime) => runtime,
        Err(message) => {
            state.push_terminal(
                &first_run_id,
                AgentRunEvent::Error {
                    run_id: first_run_id.clone(),
                    message: message.clone(),
                },
            );
            state.mark_runtime_failed(&thread_id, &runtime_id, Some(&first_run_id), message);
            return;
        }
    };
    let session_id = runtime.session_id().to_string();
    state.activate_runtime_session(&thread_id, &runtime_id, &first_run_id, &session_id);

    let mut current_run = Some(first_run);
    let mut reused = false;
    loop {
        if let Some(run) = current_run.take() {
            let run_id = run.run_id.clone();
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
                    message: runtime_status_message(config.driver, reused, resumed),
                },
            );
            state.push_event(&run_id, agent_phase_event(&run_id, "thinking", "思考中"));

            match runtime.run_turn(&state, &config, run, &mut shutdown).await {
                RuntimeExecution::Completed(Ok(outcome)) => {
                    state.finish_runtime_run(&thread_id, &runtime_id, &run_id);
                    state.push_terminal(
                        &run_id,
                        AgentRunEvent::Done {
                            run_id: run_id.clone(),
                            session_id: outcome.session_id,
                            result: outcome.text,
                            stop_reason: outcome.stop_reason,
                            usage: outcome.usage,
                            usage_source: "result",
                        },
                    );
                }
                RuntimeExecution::Completed(Err(error)) => {
                    if error.fatal {
                        state.mark_runtime_failed(
                            &thread_id,
                            &runtime_id,
                            Some(&run_id),
                            error.message.clone(),
                        );
                        state.push_terminal(
                            &run_id,
                            AgentRunEvent::Error {
                                run_id: run_id.clone(),
                                message: error.message.clone(),
                            },
                        );
                        runtime.shutdown().await;
                        return;
                    }
                    state.finish_runtime_run(&thread_id, &runtime_id, &run_id);
                    state.push_terminal(
                        &run_id,
                        AgentRunEvent::Error {
                            run_id: run_id.clone(),
                            message: error.message,
                        },
                    );
                }
                RuntimeExecution::Closed => {
                    state.mark_runtime_closed(&thread_id, &runtime_id, Some(&run_id));
                    state.push_terminal(
                        &run_id,
                        AgentRunEvent::Error {
                            run_id: run_id.clone(),
                            message: "Agent 热会话已关闭".to_string(),
                        },
                    );
                    runtime.shutdown().await;
                    return;
                }
            }
            reused = true;
        }

        tokio::select! {
            _ = wait_for_shutdown(&mut shutdown) => {
                state.mark_runtime_closed(&thread_id, &runtime_id, None);
                runtime.shutdown().await;
                return;
            }
            command = commands.recv() => {
                match command {
                    Some(AgentRuntimeCommand::Run(run)) => current_run = Some(run),
                    None => {
                        state.mark_runtime_closed(&thread_id, &runtime_id, None);
                        runtime.shutdown().await;
                        return;
                    }
                }
            }
            _ = tokio::time::sleep(Duration::from_secs(1)) => {
                if !runtime.is_running() {
                    state.mark_runtime_failed(
                        &thread_id,
                        &runtime_id,
                        None,
                        "Agent Provider 子进程已退出".to_string(),
                    );
                    runtime.shutdown().await;
                    return;
                }
            }
        }
    }
}

enum RuntimeExecution {
    Completed(Result<RuntimeTurnOutcome, RuntimeTurnError>),
    Closed,
}

impl LiveAgentRuntime {
    fn session_id(&self) -> &str {
        match self {
            Self::Grok { session_id, .. } | Self::Codex { session_id, .. } => session_id,
        }
    }

    fn is_running(&mut self) -> bool {
        match self {
            Self::Grok { client, .. } => client.is_running(),
            Self::Codex { client, .. } => client.is_running(),
        }
    }

    async fn shutdown(self) {
        match self {
            Self::Grok { client, .. } => client.shutdown().await,
            Self::Codex { client, .. } => client.shutdown().await,
        }
    }

    async fn run_turn(
        &mut self,
        state: &AgentRunState,
        config: &AgentRuntimeConfig,
        run: AgentRuntimeRun,
        shutdown: &mut watch::Receiver<bool>,
    ) -> RuntimeExecution {
        let AgentRuntimeRun {
            run_id,
            input,
            cancel,
            mut control,
        } = run;
        match (self, input) {
            (Self::Grok { client, session_id }, AgentDriverInput::Grok(input)) => {
                let mut mapper = AcpEventMapper::new(run_id.clone());
                let event_state = state.clone();
                let result = tokio::select! {
                    result = client.prompt_stream(session_id, &input, cancel, &mut control, |event| {
                        for event in mapper.map_event(event) {
                            event_state.push_event(&run_id, event);
                        }
                    }) => Some(result),
                    _ = wait_for_shutdown(shutdown) => None,
                };
                for event in mapper.finish_open_tools() {
                    state.push_event(&run_id, event);
                }
                match result {
                    Some(Ok(outcome)) => RuntimeExecution::Completed(Ok(RuntimeTurnOutcome {
                        session_id: session_id.clone(),
                        text: outcome.text,
                        stop_reason: outcome.stop_reason,
                        usage: outcome.usage,
                    })),
                    Some(Err(error)) => RuntimeExecution::Completed(Err(RuntimeTurnError {
                        fatal: acp_error_is_fatal(&error) || !client.is_running(),
                        message: public_acp_error(error),
                    })),
                    None => RuntimeExecution::Closed,
                }
            }
            (Self::Codex { client, session_id }, AgentDriverInput::Codex(input)) => {
                let mut mapper = CodexEventMapper::new(run_id.clone());
                let event_state = state.clone();
                let result = tokio::select! {
                    result = client.run_turn(
                        session_id,
                        &config.working_directory,
                        &input,
                        config.permission_mode,
                        config.model.as_deref(),
                        config.reasoning_effort.as_deref(),
                        cancel,
                        &mut control,
                        |event| {
                            for event in mapper.map_event(event) {
                                event_state.push_event(&run_id, event);
                            }
                        },
                    ) => Some(result),
                    _ = wait_for_shutdown(shutdown) => None,
                };
                for event in mapper.finish_open_tools() {
                    state.push_event(&run_id, event);
                }
                match result {
                    Some(Ok(outcome)) => RuntimeExecution::Completed(Ok(RuntimeTurnOutcome {
                        session_id: session_id.clone(),
                        text: outcome.text,
                        stop_reason: outcome.stop_reason,
                        usage: outcome.usage,
                    })),
                    Some(Err(error)) => RuntimeExecution::Completed(Err(RuntimeTurnError {
                        fatal: codex_error_is_fatal(&error) || !client.is_running(),
                        message: public_codex_error(error),
                    })),
                    None => RuntimeExecution::Closed,
                }
            }
            _ => RuntimeExecution::Completed(Err(RuntimeTurnError {
                message: "Agent runtime 与输入协议不匹配".to_string(),
                fatal: true,
            })),
        }
    }
}

async fn start_live_agent_runtime(
    config: &AgentRuntimeConfig,
    requested_session_id: Option<&str>,
) -> Result<(LiveAgentRuntime, bool), String> {
    match config.driver {
        AgentDriverKind::GrokAcp => {
            let arguments = grok_acp_arguments(config.permission_mode);
            let mut client =
                AcpStdioClient::spawn(&config.command, &arguments, &config.working_directory)
                    .await
                    .map_err(public_acp_error)?;
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
            let session = if let Some(session_id) = requested_session_id {
                if !initialize.load_session {
                    return Err("当前 Grok Build ACP 不支持恢复会话".to_string());
                }
                client
                    .load_session(session_id, &config.working_directory)
                    .await
                    .map_err(public_acp_error)?
            } else {
                client
                    .new_session(&config.working_directory)
                    .await
                    .map_err(public_acp_error)?
            };
            if let Some(model) = config.model.as_deref() {
                if should_set_acp_model(
                    Some(model),
                    session.current_model_id.as_deref(),
                    initialize.current_model_id.as_deref(),
                ) {
                    client
                        .set_model(&session.session_id, model)
                        .await
                        .map_err(public_acp_error)?;
                }
            }
            Ok((
                LiveAgentRuntime::Grok {
                    client,
                    session_id: session.session_id,
                },
                requested_session_id.is_some(),
            ))
        }
        AgentDriverKind::CodexAppServer => {
            let mut client = CodexStdioClient::spawn(&config.command, &config.working_directory)
                .await
                .map_err(public_codex_error)?;
            client
                .initialize(env!("CARGO_PKG_VERSION"))
                .await
                .map_err(public_codex_error)?;
            let session_id = client
                .start_or_resume_thread(requested_session_id, &config.working_directory)
                .await
                .map_err(public_codex_error)?;
            Ok((
                LiveAgentRuntime::Codex { client, session_id },
                requested_session_id.is_some(),
            ))
        }
    }
}

async fn wait_for_shutdown(shutdown: &mut watch::Receiver<bool>) {
    if *shutdown.borrow() {
        return;
    }
    while shutdown.changed().await.is_ok() {
        if *shutdown.borrow() {
            return;
        }
    }
    std::future::pending::<()>().await;
}

fn runtime_status_message(driver: AgentDriverKind, reused: bool, resumed: bool) -> String {
    match (driver, reused, resumed) {
        (AgentDriverKind::GrokAcp, true, _) => "已复用 Grok Build 热会话".to_string(),
        (AgentDriverKind::GrokAcp, false, true) => "已恢复 Grok Build ACP 会话".to_string(),
        (AgentDriverKind::GrokAcp, false, false) => "已创建 Grok Build ACP 会话".to_string(),
        (AgentDriverKind::CodexAppServer, true, _) => "已复用 OpenAI Codex 热会话".to_string(),
        (AgentDriverKind::CodexAppServer, false, true) => "已恢复 OpenAI Codex 会话".to_string(),
        (AgentDriverKind::CodexAppServer, false, false) => "已创建 OpenAI Codex 会话".to_string(),
    }
}

fn acp_error_is_fatal(error: &AcpError) -> bool {
    !matches!(error, AcpError::Rpc { .. })
}

fn codex_error_is_fatal(error: &CodexAppServerError) -> bool {
    !matches!(
        error,
        CodexAppServerError::Rpc { .. } | CodexAppServerError::Execution(_)
    )
}

async fn execute_acp_run(task: AcpRunTask) {
    let AcpRunTask {
        state,
        run_id,
        command,
        working_directory,
        input,
        requested_session_id,
        permission_mode,
        model,
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
        if let Some(model) = model.as_deref() {
            if should_set_acp_model(
                Some(model),
                session.current_model_id.as_deref(),
                initialize.current_model_id.as_deref(),
            ) {
                client
                    .set_model(&session.session_id, model)
                    .await
                    .map_err(public_acp_error)?;
            }
        }
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
        state.push_event(&run_id, agent_phase_event(&run_id, "thinking", "思考中"));

        let outcome = if *cancel.borrow() {
            cancelled_before_prompt_outcome()
        } else {
            let event_state = state.clone();
            client
                .prompt_stream(&session.session_id, &input, cancel, &mut control, |event| {
                    for event in mapper.map_event(event) {
                        event_state.push_event(&run_id, event);
                    }
                })
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
                usage: outcome.usage,
                usage_source: "result",
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
        input,
        requested_session_id,
        permission_mode,
        model,
        reasoning_effort,
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
        state.push_event(&run_id, agent_phase_event(&run_id, "thinking", "思考中"));

        let event_state = state.clone();
        let outcome = client
            .run_turn(
                &session_id,
                &working_directory,
                &input,
                permission_mode,
                model.as_deref(),
                reasoning_effort.as_deref(),
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
                usage: outcome.usage,
                usage_source: "result",
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
        usage: AgentUsageSnapshot::default(),
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

async fn agent_runtime_status(
    State(state): State<AgentRunState>,
    AxumPath(thread_id): AxumPath<String>,
) -> AgentApiResult<Json<AgentRuntimeStatus>> {
    let thread_id = required_id(&thread_id, "threadId")?;
    Ok(Json(state.runtime_status(&thread_id)?))
}

async fn agent_runtime_statuses(
    State(state): State<AgentRunState>,
) -> AgentApiResult<Json<HashMap<String, AgentRuntimeStatus>>> {
    Ok(Json(state.runtime_statuses()?))
}

async fn close_agent_runtime(
    State(state): State<AgentRunState>,
    AxumPath(thread_id): AxumPath<String>,
) -> AgentApiResult<Json<Value>> {
    let thread_id = required_id(&thread_id, "threadId")?;
    let closed = state
        .close_runtime(&thread_id)
        .map_err(AgentApiError::internal)?;
    Ok(Json(json!({ "closed": closed })))
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

    fn remove_run_record(&self, run_id: &str) {
        if let Ok(mut records) = self.records.lock() {
            records.remove(run_id);
        }
    }

    fn dispatch_runtime(
        &self,
        thread_id: String,
        config: AgentRuntimeConfig,
        requested_session_id: Option<String>,
        run: AgentRuntimeRun,
    ) -> AgentApiResult<()> {
        let run_id = run.run_id.clone();
        let mut pending_run = Some(run);
        loop {
            let action = {
                let mut runtimes = self
                    .runtimes
                    .lock()
                    .map_err(|_| AgentApiError::internal("锁定 Agent 热会话失败"))?;
                if let Some(runtime) = runtimes.get_mut(&thread_id) {
                    if runtime.current_run_id.is_some() {
                        return Err(AgentApiError::conflict("当前聊天已有 Agent 正在运行"));
                    }
                    if runtime_can_reuse(runtime, &config, requested_session_id.as_deref()) {
                        if let Some(command) = runtime.command.clone() {
                            runtime.phase = AgentRuntimePhase::Running;
                            runtime.current_run_id = Some(run_id.clone());
                            RuntimeDispatchAction::Reuse(command)
                        } else {
                            runtime.phase = AgentRuntimePhase::Failed;
                            runtime.last_error = Some("Agent 热会话命令通道已关闭".to_string());
                            create_runtime_record(
                                &mut runtimes,
                                &thread_id,
                                &config,
                                requested_session_id.clone(),
                                &run_id,
                            )
                        }
                    } else {
                        let _ = runtime.shutdown.send(true);
                        runtime.phase = AgentRuntimePhase::Closed;
                        runtime.current_run_id = None;
                        runtime.command = None;
                        runtime.last_error = None;
                        create_runtime_record(
                            &mut runtimes,
                            &thread_id,
                            &config,
                            requested_session_id.clone(),
                            &run_id,
                        )
                    }
                } else {
                    create_runtime_record(
                        &mut runtimes,
                        &thread_id,
                        &config,
                        requested_session_id.clone(),
                        &run_id,
                    )
                }
            };

            match action {
                RuntimeDispatchAction::Reuse(command) => {
                    let run = pending_run
                        .take()
                        .ok_or_else(|| AgentApiError::internal("Agent 运行调度状态异常"))?;
                    match command.send(AgentRuntimeCommand::Run(run)) {
                        Ok(()) => return Ok(()),
                        Err(error) => {
                            let AgentRuntimeCommand::Run(run) = error.0;
                            pending_run = Some(run);
                            self.mark_runtime_failed(
                                &thread_id,
                                &self.runtime_id(&thread_id).unwrap_or_default(),
                                Some(&run_id),
                                "Agent 热会话命令通道已关闭".to_string(),
                            );
                        }
                    }
                }
                RuntimeDispatchAction::Start {
                    runtime_id,
                    commands,
                    shutdown,
                } => {
                    let first_run = pending_run
                        .take()
                        .ok_or_else(|| AgentApiError::internal("Agent 运行调度状态异常"))?;
                    let actor_state = self.clone();
                    tokio::spawn(run_agent_runtime_actor(
                        actor_state,
                        thread_id,
                        runtime_id,
                        config,
                        requested_session_id,
                        first_run,
                        commands,
                        shutdown,
                    ));
                    return Ok(());
                }
            }
        }
    }

    fn runtime_id(&self, thread_id: &str) -> Option<String> {
        self.runtimes
            .lock()
            .ok()?
            .get(thread_id)
            .map(|runtime| runtime.runtime_id.clone())
    }

    fn activate_runtime_session(
        &self,
        thread_id: &str,
        runtime_id: &str,
        run_id: &str,
        session_id: &str,
    ) {
        if let Ok(mut runtimes) = self.runtimes.lock() {
            if let Some(runtime) = runtimes.get_mut(thread_id) {
                if runtime.runtime_id == runtime_id
                    && runtime.current_run_id.as_deref() == Some(run_id)
                {
                    runtime.session_id = Some(session_id.to_string());
                    runtime.phase = AgentRuntimePhase::Running;
                    runtime.last_error = None;
                }
            }
        }
    }

    fn finish_runtime_run(&self, thread_id: &str, runtime_id: &str, run_id: &str) {
        if let Ok(mut runtimes) = self.runtimes.lock() {
            if let Some(runtime) = runtimes.get_mut(thread_id) {
                if runtime.runtime_id == runtime_id
                    && runtime.current_run_id.as_deref() == Some(run_id)
                {
                    runtime.current_run_id = None;
                    if runtime.phase == AgentRuntimePhase::Running {
                        runtime.phase = AgentRuntimePhase::Ready;
                    }
                }
            }
        }
    }

    fn mark_runtime_closed(&self, thread_id: &str, runtime_id: &str, run_id: Option<&str>) {
        if let Ok(mut runtimes) = self.runtimes.lock() {
            if let Some(runtime) = runtimes.get_mut(thread_id) {
                if runtime.runtime_id == runtime_id
                    && run_id.is_none_or(|run_id| runtime.current_run_id.as_deref() == Some(run_id))
                {
                    runtime.phase = AgentRuntimePhase::Closed;
                    runtime.current_run_id = None;
                    runtime.command = None;
                    runtime.last_error = None;
                }
            }
        }
    }

    fn mark_runtime_failed(
        &self,
        thread_id: &str,
        runtime_id: &str,
        run_id: Option<&str>,
        message: String,
    ) {
        if let Ok(mut runtimes) = self.runtimes.lock() {
            if let Some(runtime) = runtimes.get_mut(thread_id) {
                if runtime.runtime_id == runtime_id
                    && run_id.is_none_or(|run_id| runtime.current_run_id.as_deref() == Some(run_id))
                {
                    runtime.phase = AgentRuntimePhase::Failed;
                    runtime.current_run_id = None;
                    runtime.command = None;
                    runtime.last_error = Some(message);
                }
            }
        }
    }

    fn close_runtime(&self, thread_id: &str) -> Result<bool, String> {
        let (shutdown, current_run_id) = {
            let mut runtimes = self
                .runtimes
                .lock()
                .map_err(|_| "锁定 Agent 热会话失败".to_string())?;
            let Some(runtime) = runtimes.get_mut(thread_id) else {
                return Ok(false);
            };
            if matches!(
                runtime.phase,
                AgentRuntimePhase::Closed | AgentRuntimePhase::Failed
            ) {
                return Ok(false);
            }
            runtime.phase = AgentRuntimePhase::Closed;
            runtime.command = None;
            runtime.last_error = None;
            (runtime.shutdown.clone(), runtime.current_run_id.take())
        };
        if let Some(run_id) = current_run_id {
            let _ = self.cancel(&run_id);
        }
        let _ = shutdown.send(true);
        Ok(true)
    }

    fn runtime_status(&self, thread_id: &str) -> AgentApiResult<AgentRuntimeStatus> {
        let runtimes = self
            .runtimes
            .lock()
            .map_err(|_| AgentApiError::internal("读取 Agent 热会话失败"))?;
        let Some(runtime) = runtimes.get(thread_id) else {
            return Ok(AgentRuntimeStatus {
                thread_id: thread_id.to_string(),
                exists: false,
                phase: "absent",
                provider_id: None,
                session_id: None,
                current_run_id: None,
                last_error: None,
            });
        };
        Ok(agent_runtime_status_from_record(thread_id, runtime))
    }

    fn runtime_statuses(&self) -> AgentApiResult<HashMap<String, AgentRuntimeStatus>> {
        let runtimes = self
            .runtimes
            .lock()
            .map_err(|_| AgentApiError::internal("读取 Agent 热会话失败"))?;
        Ok(runtimes
            .iter()
            .map(|(thread_id, runtime)| {
                (
                    thread_id.clone(),
                    agent_runtime_status_from_record(thread_id, runtime),
                )
            })
            .collect())
    }

    fn remove_run_records_for_thread(&self, thread_id: &str) {
        if let Ok(mut records) = self.records.lock() {
            records.retain(|_, record| record.thread_id.as_deref() != Some(thread_id));
        }
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

fn create_runtime_record(
    runtimes: &mut HashMap<String, AgentRuntimeRecord>,
    thread_id: &str,
    config: &AgentRuntimeConfig,
    requested_session_id: Option<String>,
    run_id: &str,
) -> RuntimeDispatchAction {
    let runtime_id = uuid::Uuid::new_v4().to_string();
    let (command, commands) = mpsc::unbounded_channel();
    let (shutdown_sender, shutdown) = watch::channel(false);
    runtimes.insert(
        thread_id.to_string(),
        AgentRuntimeRecord {
            runtime_id: runtime_id.clone(),
            config: config.clone(),
            session_id: requested_session_id,
            phase: AgentRuntimePhase::Starting,
            current_run_id: Some(run_id.to_string()),
            command: Some(command),
            shutdown: shutdown_sender,
            last_error: None,
        },
    );
    RuntimeDispatchAction::Start {
        runtime_id,
        commands,
        shutdown,
    }
}

fn runtime_can_reuse(
    runtime: &AgentRuntimeRecord,
    config: &AgentRuntimeConfig,
    requested_session_id: Option<&str>,
) -> bool {
    runtime.phase == AgentRuntimePhase::Ready
        && runtime.command.is_some()
        && runtime.config == *config
        && requested_session_id
            .is_none_or(|session_id| runtime.session_id.as_deref() == Some(session_id))
}

fn runtime_phase_name(phase: AgentRuntimePhase) -> &'static str {
    match phase {
        AgentRuntimePhase::Starting => "starting",
        AgentRuntimePhase::Ready => "ready",
        AgentRuntimePhase::Running => "running",
        AgentRuntimePhase::Closed => "closed",
        AgentRuntimePhase::Failed => "failed",
    }
}

fn agent_runtime_status_from_record(
    thread_id: &str,
    runtime: &AgentRuntimeRecord,
) -> AgentRuntimeStatus {
    AgentRuntimeStatus {
        thread_id: thread_id.to_string(),
        exists: true,
        phase: runtime_phase_name(runtime.phase),
        provider_id: Some(runtime.config.provider_id.clone()),
        session_id: runtime.session_id.clone(),
        current_run_id: runtime.current_run_id.clone(),
        last_error: runtime.last_error.clone(),
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
    current_phase: Option<&'static str>,
}

struct CodexEventMapper {
    run_id: String,
    next_block_index: u64,
    tools: HashMap<String, ToolMappingState>,
    current_phase: Option<&'static str>,
}

impl CodexEventMapper {
    fn new(run_id: String) -> Self {
        Self {
            run_id,
            next_block_index: 0,
            tools: HashMap::new(),
            current_phase: None,
        }
    }

    fn map_event(&mut self, event: CodexRuntimeEvent) -> Vec<AgentRunEvent> {
        match event {
            CodexRuntimeEvent::Status { message } => vec![AgentRunEvent::Status {
                run_id: self.run_id.clone(),
                message,
            }],
            CodexRuntimeEvent::Thinking => self.set_phase("thinking", "思考中"),
            CodexRuntimeEvent::TextDelta { text } => {
                self.current_phase = Some("computing");
                vec![AgentRunEvent::Delta {
                    run_id: self.run_id.clone(),
                    text,
                }]
            }
            CodexRuntimeEvent::Usage { usage } => vec![AgentRunEvent::Usage {
                run_id: self.run_id.clone(),
                usage,
                usage_source: "result",
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
                if !self.has_open_tools() {
                    events.extend(self.set_phase("thinking", "思考中"));
                }
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
            CodexRuntimeEvent::InteractionResolved { .. } => self.set_phase("thinking", "思考中"),
        }
    }

    fn set_phase(&mut self, phase: &'static str, label: &'static str) -> Vec<AgentRunEvent> {
        if self.current_phase == Some(phase) {
            return Vec::new();
        }
        self.current_phase = Some(phase);
        vec![agent_phase_event(&self.run_id, phase, label)]
    }

    fn has_open_tools(&self) -> bool {
        self.tools.values().any(|tool| !tool.stopped)
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
        self.current_phase = Some("tool");
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
            current_phase: None,
        }
    }

    fn map_event(&mut self, event: AcpRuntimeEvent) -> Vec<AgentRunEvent> {
        match event {
            AcpRuntimeEvent::TextDelta { text } => {
                self.current_phase = Some("computing");
                vec![AgentRunEvent::Delta {
                    run_id: self.run_id.clone(),
                    text,
                }]
            }
            AcpRuntimeEvent::ThoughtChunk | AcpRuntimeEvent::InteractionResolved { .. } => {
                self.set_phase("thinking", "思考中")
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

    fn set_phase(&mut self, phase: &'static str, label: &'static str) -> Vec<AgentRunEvent> {
        if self.current_phase == Some(phase) {
            return Vec::new();
        }
        self.current_phase = Some(phase);
        vec![agent_phase_event(&self.run_id, phase, label)]
    }

    fn has_open_tools(&self) -> bool {
        self.tools.values().any(|tool| !tool.stopped)
    }

    fn map_tool_call(&mut self, call: AcpToolCall) -> Vec<AgentRunEvent> {
        if self
            .tools
            .get(&call.tool_call_id)
            .is_some_and(|tool| tool.stopped)
        {
            return Vec::new();
        }
        let mut events = Vec::new();
        self.current_phase = Some("tool");
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
            if !self.has_open_tools() {
                events.extend(self.set_phase("thinking", "思考中"));
            }
        }
        events
    }

    fn map_tool_update(&mut self, update: AcpToolCallUpdate) -> Vec<AgentRunEvent> {
        if self
            .tools
            .get(&update.tool_call_id)
            .is_some_and(|tool| tool.stopped)
        {
            return Vec::new();
        }
        let mut events = Vec::new();
        self.current_phase = Some("tool");
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
            if !self.has_open_tools() {
                events.extend(self.set_phase("thinking", "思考中"));
            }
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
        self.current_phase = Some("tool");
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

fn agent_phase_event(run_id: &str, phase: &str, label: &str) -> AgentRunEvent {
    AgentRunEvent::Phase {
        run_id: run_id.to_string(),
        phase: phase.to_string(),
        label: label.to_string(),
        thought_count: None,
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

#[derive(Clone, Debug, PartialEq, Eq)]
enum NormalizedAgentInputBlock {
    Text {
        text: String,
    },
    Image {
        path: Option<String>,
        name: Option<String>,
        mime_type: Option<String>,
        size: Option<u64>,
        data: Option<String>,
    },
    FileText {
        path: String,
        name: String,
        mime_type: Option<String>,
        size: Option<u64>,
        text: String,
    },
    FileReference {
        path: String,
        name: String,
        mime_type: Option<String>,
        size: Option<u64>,
    },
    AttachmentMetadata {
        name: String,
        mime_type: Option<String>,
        size: Option<u64>,
        reason: String,
    },
}

fn normalize_agent_input(
    prompt: Option<&str>,
    content_blocks: Option<Vec<AgentInputContentBlock>>,
) -> AgentApiResult<Vec<NormalizedAgentInputBlock>> {
    let prompt = prompt.unwrap_or_default().trim();
    if prompt.len() > MAX_PROMPT_BYTES {
        return Err(AgentApiError::bad_request("prompt 超过 1 MiB 限制"));
    }
    let blocks = content_blocks.unwrap_or_default();
    if blocks.len() > MAX_INPUT_BLOCKS {
        return Err(AgentApiError::bad_request(format!(
            "contentBlocks 不能超过 {MAX_INPUT_BLOCKS} 项"
        )));
    }
    if blocks.is_empty() {
        if prompt.is_empty() {
            return Err(AgentApiError::bad_request(
                "prompt 和 contentBlocks 不能同时为空",
            ));
        }
        return Ok(vec![NormalizedAgentInputBlock::Text {
            text: prompt.to_string(),
        }]);
    }

    let mut total_text_bytes = 0usize;
    let mut total_image_bytes = 0usize;
    let mut normalized = Vec::with_capacity(blocks.len());
    for block in blocks {
        let block = match block {
            AgentInputContentBlock::Text { text } => {
                let text = text.trim().to_string();
                if text.is_empty() {
                    return Err(AgentApiError::bad_request("text 输入块不能为空"));
                }
                add_input_text_bytes(&mut total_text_bytes, text.len())?;
                NormalizedAgentInputBlock::Text { text }
            }
            AgentInputContentBlock::Image {
                id,
                path,
                name,
                mime_type,
                size,
                data,
            } => {
                validate_optional_id(id.as_deref(), "image.id")?;
                let path = normalize_optional_input_field(path, "image.path", MAX_PATH_BYTES)?;
                let name = normalize_optional_input_field(name, "image.name", MAX_NAME_BYTES)?;
                let mime_type = normalize_optional_mime_type(mime_type, "image.mimeType")?;
                let data = data
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty());
                if path.is_none() && data.is_none() {
                    return Err(AgentApiError::bad_request(
                        "image 输入块必须包含 path 或 data",
                    ));
                }
                if size.is_some_and(|value| value > MAX_IMAGE_BYTES as u64) {
                    return Err(AgentApiError::bad_request("图片超过 10 MiB 限制"));
                }
                if let Some(mime_type) = mime_type.as_deref() {
                    validate_image_mime_type(mime_type)?;
                }
                if let Some(data) = data.as_deref() {
                    let mime_type = mime_type.as_deref().ok_or_else(|| {
                        AgentApiError::bad_request("base64 图片必须提供 mimeType")
                    })?;
                    validate_image_mime_type(mime_type)?;
                    add_input_image_bytes(&mut total_image_bytes, validate_image_base64(data)?)?;
                } else if let Some(size) = size {
                    add_input_image_bytes(&mut total_image_bytes, size as usize)?;
                }
                NormalizedAgentInputBlock::Image {
                    path,
                    name,
                    mime_type,
                    size,
                    data,
                }
            }
            AgentInputContentBlock::FileText {
                id,
                path,
                name,
                mime_type,
                size,
                text,
                text_bytes: _,
            } => {
                validate_optional_id(id.as_deref(), "file_text.id")?;
                let path = normalize_required_input_field(path, "file_text.path", MAX_PATH_BYTES)?;
                let name = normalize_required_input_field(name, "file_text.name", MAX_NAME_BYTES)?;
                let mime_type = normalize_optional_mime_type(mime_type, "file_text.mimeType")?;
                if text.is_empty() {
                    return Err(AgentApiError::bad_request("file_text.text 不能为空"));
                }
                add_input_text_bytes(&mut total_text_bytes, text.len())?;
                NormalizedAgentInputBlock::FileText {
                    path,
                    name,
                    mime_type,
                    size,
                    text,
                }
            }
            AgentInputContentBlock::FileReference {
                id,
                path,
                name,
                mime_type,
                size,
                reason,
                source,
            } => {
                validate_optional_id(id.as_deref(), "file_reference.id")?;
                validate_reference_reason(reason.as_deref())?;
                validate_reference_source(source.as_deref())?;
                NormalizedAgentInputBlock::FileReference {
                    path: normalize_required_input_field(
                        path,
                        "file_reference.path",
                        MAX_PATH_BYTES,
                    )?,
                    name: normalize_required_input_field(
                        name,
                        "file_reference.name",
                        MAX_NAME_BYTES,
                    )?,
                    mime_type: normalize_optional_mime_type(mime_type, "file_reference.mimeType")?,
                    size,
                }
            }
            AgentInputContentBlock::AttachmentMetadata {
                id,
                name,
                mime_type,
                size,
                reason,
            } => {
                validate_optional_id(id.as_deref(), "attachment_metadata.id")?;
                let reason = normalize_required_input_field(
                    reason,
                    "attachment_metadata.reason",
                    MAX_REASON_BYTES,
                )?;
                add_input_text_bytes(&mut total_text_bytes, reason.len())?;
                NormalizedAgentInputBlock::AttachmentMetadata {
                    name: normalize_required_input_field(
                        name,
                        "attachment_metadata.name",
                        MAX_NAME_BYTES,
                    )?,
                    mime_type: normalize_optional_mime_type(
                        mime_type,
                        "attachment_metadata.mimeType",
                    )?,
                    size,
                    reason,
                }
            }
        };
        normalized.push(block);
    }
    Ok(normalized)
}

fn build_acp_prompt(
    blocks: &[NormalizedAgentInputBlock],
    working_directory: &Path,
) -> AgentApiResult<Vec<AcpPromptInput>> {
    blocks
        .iter()
        .map(|block| match block {
            NormalizedAgentInputBlock::Text { text } => {
                Ok(AcpPromptInput::Text { text: text.clone() })
            }
            NormalizedAgentInputBlock::Image {
                path,
                mime_type,
                data,
                ..
            } => {
                let (mime_type, data) = if let Some(data) = data {
                    (
                        mime_type.clone().ok_or_else(|| {
                            AgentApiError::bad_request("base64 图片缺少 mimeType")
                        })?,
                        data.clone(),
                    )
                } else {
                    read_local_image_for_acp(
                        path.as_deref()
                            .ok_or_else(|| AgentApiError::bad_request("图片路径不能为空"))?,
                        mime_type.as_deref(),
                        working_directory,
                    )?
                };
                Ok(AcpPromptInput::Image { mime_type, data })
            }
            NormalizedAgentInputBlock::FileText {
                path,
                name,
                mime_type,
                text,
                ..
            } => Ok(AcpPromptInput::Resource {
                resource: AcpEmbeddedResource {
                    uri: input_path_to_uri(path, name),
                    mime_type: mime_type.clone(),
                    text: text.clone(),
                },
            }),
            NormalizedAgentInputBlock::FileReference {
                path,
                name,
                mime_type,
                size,
            } => Ok(AcpPromptInput::ResourceLink {
                uri: input_path_to_uri(path, name),
                name: name.clone(),
                mime_type: mime_type.clone(),
                size: *size,
            }),
            NormalizedAgentInputBlock::AttachmentMetadata {
                name,
                mime_type,
                size,
                reason,
            } => Ok(AcpPromptInput::Text {
                text: format_attachment_metadata(name, mime_type.as_deref(), *size, reason),
            }),
        })
        .collect()
}

fn build_codex_input(
    blocks: &[NormalizedAgentInputBlock],
    working_directory: &Path,
) -> AgentApiResult<Vec<CodexUserInput>> {
    blocks
        .iter()
        .map(|block| match block {
            NormalizedAgentInputBlock::Text { text } => {
                Ok(CodexUserInput::Text { text: text.clone() })
            }
            NormalizedAgentInputBlock::Image {
                path,
                mime_type,
                data,
                ..
            } => {
                if let Some(path) = path {
                    let path = resolve_local_input_file(path, working_directory, "图片")?;
                    let metadata = fs::metadata(&path)
                        .map_err(|_| AgentApiError::bad_request("图片文件不可访问"))?;
                    if metadata.len() > MAX_IMAGE_BYTES as u64 {
                        return Err(AgentApiError::bad_request("图片超过 10 MiB 限制"));
                    }
                    let resolved_mime_type = mime_type
                        .clone()
                        .or_else(|| image_mime_type_from_path(&path))
                        .ok_or_else(|| AgentApiError::bad_request("无法识别图片 mimeType"))?;
                    validate_image_mime_type(&resolved_mime_type)?;
                    return Ok(CodexUserInput::LocalImage {
                        path: path.to_string_lossy().to_string(),
                    });
                }
                let mime_type = mime_type
                    .as_deref()
                    .ok_or_else(|| AgentApiError::bad_request("base64 图片缺少 mimeType"))?;
                let data = data
                    .as_deref()
                    .ok_or_else(|| AgentApiError::bad_request("base64 图片缺少 data"))?;
                Ok(CodexUserInput::Image {
                    url: format!("data:{mime_type};base64,{data}"),
                })
            }
            NormalizedAgentInputBlock::FileText {
                path, name, text, ..
            } => Ok(CodexUserInput::Text {
                text: format!("本地文件：{name}\n路径：{path}\n\n{text}"),
            }),
            NormalizedAgentInputBlock::FileReference { path, name, .. } => {
                Ok(CodexUserInput::Text {
                    text: format!(
                        "本地文件引用：{name}\n路径：{path}\n请按需使用本地文件工具读取。"
                    ),
                })
            }
            NormalizedAgentInputBlock::AttachmentMetadata {
                name,
                mime_type,
                size,
                reason,
            } => Ok(CodexUserInput::Text {
                text: format_attachment_metadata(name, mime_type.as_deref(), *size, reason),
            }),
        })
        .collect()
}

fn add_input_text_bytes(total: &mut usize, bytes: usize) -> AgentApiResult<()> {
    *total = total
        .checked_add(bytes)
        .ok_or_else(|| AgentApiError::bad_request("输入文本体积无效"))?;
    if *total > MAX_PROMPT_BYTES {
        return Err(AgentApiError::bad_request(
            "文本和内联文件总计超过 1 MiB 限制",
        ));
    }
    Ok(())
}

fn add_input_image_bytes(total: &mut usize, bytes: usize) -> AgentApiResult<()> {
    *total = total
        .checked_add(bytes)
        .ok_or_else(|| AgentApiError::bad_request("图片总体积无效"))?;
    if *total > MAX_TOTAL_IMAGE_BYTES {
        return Err(AgentApiError::bad_request("图片总计超过 30 MiB 限制"));
    }
    Ok(())
}

fn validate_optional_id(value: Option<&str>, field: &str) -> AgentApiResult<()> {
    if let Some(value) = value {
        normalize_required_input_field(value.to_string(), field, MAX_NAME_BYTES)?;
    }
    Ok(())
}

fn normalize_optional_input_field(
    value: Option<String>,
    field: &str,
    max_bytes: usize,
) -> AgentApiResult<Option<String>> {
    value
        .map(|value| normalize_required_input_field(value, field, max_bytes))
        .transpose()
}

fn normalize_required_input_field(
    value: String,
    field: &str,
    max_bytes: usize,
) -> AgentApiResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AgentApiError::bad_request(format!("{field} 不能为空")));
    }
    if value.len() > max_bytes {
        return Err(AgentApiError::bad_request(format!("{field} 过长")));
    }
    if value.chars().any(char::is_control) {
        return Err(AgentApiError::bad_request(format!("{field} 包含控制字符")));
    }
    Ok(value.to_string())
}

fn normalize_optional_mime_type(
    value: Option<String>,
    field: &str,
) -> AgentApiResult<Option<String>> {
    normalize_optional_input_field(value, field, MAX_MIME_TYPE_BYTES)
        .map(|value| value.map(|value| value.to_ascii_lowercase()))
}

fn validate_image_mime_type(mime_type: &str) -> AgentApiResult<()> {
    if matches!(
        mime_type,
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    ) {
        return Ok(());
    }
    Err(AgentApiError::bad_request(
        "图片 mimeType 仅支持 image/png、image/jpeg、image/gif、image/webp",
    ))
}

fn validate_reference_reason(value: Option<&str>) -> AgentApiResult<()> {
    if value.is_none_or(|value| {
        matches!(
            value,
            "too_large" | "binary" | "unsupported" | "provider_unsupported"
        )
    }) {
        return Ok(());
    }
    Err(AgentApiError::bad_request("file_reference.reason 不受支持"))
}

fn validate_reference_source(value: Option<&str>) -> AgentApiResult<()> {
    if value.is_none_or(|value| matches!(value, "mention" | "attachment")) {
        return Ok(());
    }
    Err(AgentApiError::bad_request("file_reference.source 不受支持"))
}

fn validate_image_base64(data: &str) -> AgentApiResult<usize> {
    let max_encoded_bytes = MAX_IMAGE_BYTES.div_ceil(3) * 4;
    if data.len() > max_encoded_bytes {
        return Err(AgentApiError::bad_request("图片超过 10 MiB 限制"));
    }
    let decoded = general_purpose::STANDARD
        .decode(data)
        .map_err(|_| AgentApiError::bad_request("图片 data 不是有效 base64"))?;
    if decoded.is_empty() {
        return Err(AgentApiError::bad_request("图片 data 不能为空"));
    }
    if decoded.len() > MAX_IMAGE_BYTES {
        return Err(AgentApiError::bad_request("图片超过 10 MiB 限制"));
    }
    Ok(decoded.len())
}

fn read_local_image_for_acp(
    path: &str,
    requested_mime_type: Option<&str>,
    working_directory: &Path,
) -> AgentApiResult<(String, String)> {
    let path = resolve_local_input_file(path, working_directory, "图片")?;
    let metadata =
        fs::metadata(&path).map_err(|_| AgentApiError::bad_request("图片文件不可访问"))?;
    if metadata.len() > MAX_IMAGE_BYTES as u64 {
        return Err(AgentApiError::bad_request("图片超过 10 MiB 限制"));
    }
    let mime_type = requested_mime_type
        .map(ToString::to_string)
        .or_else(|| image_mime_type_from_path(&path))
        .ok_or_else(|| AgentApiError::bad_request("无法识别图片 mimeType"))?;
    validate_image_mime_type(&mime_type)?;
    let bytes = fs::read(path).map_err(|_| AgentApiError::bad_request("读取图片文件失败"))?;
    if bytes.is_empty() {
        return Err(AgentApiError::bad_request("图片文件为空"));
    }
    Ok((mime_type, general_purpose::STANDARD.encode(bytes)))
}

fn resolve_local_input_file(
    path: &str,
    working_directory: &Path,
    label: &str,
) -> AgentApiResult<PathBuf> {
    let path = Path::new(path);
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        working_directory.join(path)
    };
    let canonical = fs::canonicalize(path)
        .map_err(|_| AgentApiError::bad_request(format!("{label}文件不存在或不可访问")))?;
    if !canonical.is_file() {
        return Err(AgentApiError::bad_request(format!("{label}路径不是文件")));
    }
    Ok(canonical)
}

fn image_mime_type_from_path(path: &Path) -> Option<String> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => Some("image/png".to_string()),
        Some("jpg" | "jpeg") => Some("image/jpeg".to_string()),
        Some("gif") => Some("image/gif".to_string()),
        Some("webp") => Some("image/webp".to_string()),
        _ => None,
    }
}

fn input_path_to_uri(path: &str, name: &str) -> String {
    let normalized = path.replace('\\', "/");
    if normalized.starts_with("//") {
        return format!(
            "file://{}",
            percent_encode_uri_path(normalized.trim_start_matches('/'))
        );
    }
    if Path::new(path).is_absolute() {
        let path = normalized.trim_start_matches('/');
        return format!("file:///{}", percent_encode_uri_path(path));
    }
    format!(
        "codem://attachment/{}",
        percent_encode_uri_path(name.trim_start_matches('/'))
    )
}

fn percent_encode_uri_path(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(*byte, b'-' | b'_' | b'.' | b'~' | b'/' | b':')
        {
            encoded.push(*byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn format_attachment_metadata(
    name: &str,
    mime_type: Option<&str>,
    size: Option<u64>,
    reason: &str,
) -> String {
    let mut metadata = vec![format!("附件：{name}"), format!("状态：{reason}")];
    if let Some(mime_type) = mime_type {
        metadata.push(format!("类型：{mime_type}"));
    }
    if let Some(size) = size {
        metadata.push(format!("大小：{size} bytes"));
    }
    metadata.join("\n")
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

fn should_set_acp_model(
    requested_model: Option<&str>,
    session_model: Option<&str>,
    initialize_model: Option<&str>,
) -> bool {
    requested_model.is_some_and(|requested| session_model.or(initialize_model) != Some(requested))
}

fn experimental_agent_run_enabled(value: &AtomicBool) -> bool {
    value.load(Ordering::Acquire)
}

#[cfg(test)]
mod tests {
    use super::{
        build_acp_prompt, build_codex_input, cancelled_before_prompt_outcome,
        experimental_agent_run_enabled, grok_acp_arguments, normalize_agent_input,
        runtime_can_reuse, should_set_acp_model, AcpEventMapper, AgentDriverInput, AgentDriverKind,
        AgentInputContentBlock, AgentRunRecord, AgentRunService, AgentRunState,
        AgentRuntimeCommand, AgentRuntimeConfig, AgentRuntimePhase, AgentRuntimeRecord,
        AgentRuntimeRun, CodexEventMapper, CommandResolvers, StartAgentRunRequest,
    };
    use crate::{
        acp::{AcpRuntimeEvent, AcpToolCall, AcpToolCallUpdate},
        agent_runtime::AgentRunEvent,
        codex_app_server::CodexRuntimeEvent,
    };
    use serde_json::json;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::{
        collections::HashMap,
        path::{Path, PathBuf},
        sync::{Arc, Mutex},
    };
    use tokio::sync::{mpsc, watch, Notify};

    fn test_runtime_config() -> AgentRuntimeConfig {
        AgentRuntimeConfig {
            provider_id: "grok-build".to_string(),
            driver: AgentDriverKind::GrokAcp,
            command: "grok".to_string(),
            working_directory: PathBuf::from("D:/workspace"),
            permission_mode: "default",
            model: Some("grok-default".to_string()),
            reasoning_effort: None,
        }
    }

    fn test_run_state() -> AgentRunState {
        AgentRunState {
            records: Arc::new(Mutex::new(HashMap::new())),
            runtimes: Arc::new(Mutex::new(HashMap::new())),
            command_resolvers: CommandResolvers {
                grok: || None,
                codex: || None,
            },
            experimental_agent_run_enabled: Arc::new(AtomicBool::new(false)),
        }
    }

    #[test]
    fn experimental_agent_run_follows_shared_setting_state() {
        let enabled = AtomicBool::new(false);
        assert!(!experimental_agent_run_enabled(&enabled));
        enabled.store(true, Ordering::Release);
        assert!(experimental_agent_run_enabled(&enabled));
    }

    #[test]
    fn grok_acp_arguments_keep_permission_mode_as_a_separate_value() {
        assert_eq!(
            grok_acp_arguments("bypassPermissions"),
            ["--permission-mode", "bypassPermissions", "agent", "stdio"]
        );
    }

    #[test]
    fn grok_sets_only_a_model_that_differs_from_the_active_session_model() {
        assert!(!should_set_acp_model(None, Some("grok-default"), None));
        assert!(!should_set_acp_model(
            Some("grok-default"),
            Some("grok-default"),
            Some("other-default"),
        ));
        assert!(!should_set_acp_model(
            Some("grok-default"),
            None,
            Some("grok-default"),
        ));
        assert!(should_set_acp_model(
            Some("grok-fast"),
            Some("grok-default"),
            Some("grok-default"),
        ));
    }

    #[test]
    fn unified_agent_input_maps_images_and_files_without_requiring_prompt_text() {
        let blocks = normalize_agent_input(
            None,
            Some(vec![
                AgentInputContentBlock::Image {
                    id: Some("image-1".to_string()),
                    path: None,
                    name: Some("shot.png".to_string()),
                    mime_type: Some("image/png".to_string()),
                    size: Some(5),
                    data: Some("aGVsbG8=".to_string()),
                },
                AgentInputContentBlock::FileText {
                    id: None,
                    path: "notes.md".to_string(),
                    name: "notes.md".to_string(),
                    mime_type: Some("text/markdown".to_string()),
                    size: Some(7),
                    text: "# Notes".to_string(),
                    text_bytes: None,
                },
                AgentInputContentBlock::FileReference {
                    id: None,
                    path: "D:\\workspace\\README.md".to_string(),
                    name: "README.md".to_string(),
                    mime_type: Some("text/markdown".to_string()),
                    size: None,
                    reason: None,
                    source: Some("mention".to_string()),
                },
            ]),
        )
        .expect("normalize blocks-only input");

        let acp = serde_json::to_value(
            build_acp_prompt(&blocks, Path::new("D:/workspace")).expect("ACP mapping"),
        )
        .expect("serialize ACP input");
        assert_eq!(acp[0]["type"], "image");
        assert_eq!(acp[1]["type"], "resource");
        assert_eq!(acp[2]["type"], "resource_link");

        let codex = serde_json::to_value(
            build_codex_input(&blocks, Path::new("D:/workspace")).expect("Codex mapping"),
        )
        .expect("serialize Codex input");
        assert_eq!(codex[0]["type"], "image");
        assert!(codex[0]["url"]
            .as_str()
            .is_some_and(|value| value.starts_with("data:image/png;base64,")));
        assert_eq!(codex[1]["type"], "text");
        assert!(codex[2]["text"]
            .as_str()
            .is_some_and(|value| value.contains("D:\\workspace\\README.md")));
    }

    #[test]
    fn start_agent_run_request_accepts_camel_case_content_blocks() {
        let request = serde_json::from_value::<StartAgentRunRequest>(json!({
            "providerId": "grok-build",
            "threadId": "thread-1",
            "workingDirectory": "D:/workspace",
            "contentBlocks": [{
                "type": "file_text",
                "path": "notes.md",
                "name": "notes.md",
                "mimeType": "text/markdown",
                "size": 7,
                "text": "# Notes",
                "textBytes": 7
            }]
        }))
        .expect("deserialize request");

        assert!(request.prompt.is_none());
        assert_eq!(request.thread_id.as_deref(), Some("thread-1"));
        assert!(matches!(
            request.content_blocks.as_deref(),
            Some([AgentInputContentBlock::FileText {
                mime_type: Some(mime_type),
                text_bytes: Some(7),
                ..
            }]) if mime_type == "text/markdown"
        ));
    }

    #[test]
    fn hot_runtime_reuse_requires_matching_config_and_session() {
        let config = test_runtime_config();
        let (command, _commands) = mpsc::unbounded_channel();
        let (shutdown, _shutdown) = watch::channel(false);
        let runtime = AgentRuntimeRecord {
            runtime_id: "runtime-1".to_string(),
            config: config.clone(),
            session_id: Some("session-1".to_string()),
            phase: AgentRuntimePhase::Ready,
            current_run_id: None,
            command: Some(command),
            shutdown,
            last_error: None,
        };

        assert!(runtime_can_reuse(&runtime, &config, None));
        assert!(runtime_can_reuse(&runtime, &config, Some("session-1")));
        assert!(!runtime_can_reuse(&runtime, &config, Some("session-2")));

        let mut changed = config.clone();
        changed.permission_mode = "auto";
        assert!(!runtime_can_reuse(&runtime, &changed, Some("session-1")));
    }

    #[test]
    fn hot_runtime_rejects_a_second_run_for_the_same_thread() {
        let state = test_run_state();
        let config = test_runtime_config();
        let (command, _commands) = mpsc::unbounded_channel();
        let (shutdown, _shutdown) = watch::channel(false);
        state.runtimes.lock().unwrap().insert(
            "thread-1".to_string(),
            AgentRuntimeRecord {
                runtime_id: "runtime-1".to_string(),
                config: config.clone(),
                session_id: Some("session-1".to_string()),
                phase: AgentRuntimePhase::Running,
                current_run_id: Some("run-1".to_string()),
                command: Some(command),
                shutdown,
                last_error: None,
            },
        );
        let (_cancel_sender, cancel) = watch::channel(false);
        let (_control_sender, control) = mpsc::unbounded_channel();

        let error = state
            .dispatch_runtime(
                "thread-1".to_string(),
                config,
                Some("session-1".to_string()),
                AgentRuntimeRun {
                    run_id: "run-2".to_string(),
                    input: AgentDriverInput::Grok(Vec::new()),
                    cancel,
                    control,
                },
            )
            .expect_err("concurrent run must fail");

        assert_eq!(error.status, axum::http::StatusCode::CONFLICT);
    }

    #[test]
    fn hot_runtime_reuses_the_existing_actor_channel() {
        let state = test_run_state();
        let config = test_runtime_config();
        let (command, mut commands) = mpsc::unbounded_channel();
        let (shutdown, _shutdown) = watch::channel(false);
        state.runtimes.lock().unwrap().insert(
            "thread-1".to_string(),
            AgentRuntimeRecord {
                runtime_id: "runtime-1".to_string(),
                config: config.clone(),
                session_id: Some("session-1".to_string()),
                phase: AgentRuntimePhase::Ready,
                current_run_id: None,
                command: Some(command),
                shutdown,
                last_error: None,
            },
        );
        let (_cancel_sender, cancel) = watch::channel(false);
        let (_control_sender, control) = mpsc::unbounded_channel();

        state
            .dispatch_runtime(
                "thread-1".to_string(),
                config,
                Some("session-1".to_string()),
                AgentRuntimeRun {
                    run_id: "run-2".to_string(),
                    input: AgentDriverInput::Grok(Vec::new()),
                    cancel,
                    control,
                },
            )
            .expect("reuse runtime");

        assert!(matches!(
            commands.try_recv(),
            Ok(AgentRuntimeCommand::Run(AgentRuntimeRun { run_id, .. })) if run_id == "run-2"
        ));
        let runtimes = state.runtimes.lock().unwrap();
        let runtime = runtimes.get("thread-1").unwrap();
        assert_eq!(runtime.runtime_id, "runtime-1");
        assert_eq!(runtime.phase, AgentRuntimePhase::Running);
        assert_eq!(runtime.current_run_id.as_deref(), Some("run-2"));
    }

    #[test]
    fn cancelling_a_run_keeps_the_hot_runtime_available() {
        let state = test_run_state();
        let config = test_runtime_config();
        let (command, _commands) = mpsc::unbounded_channel();
        let (shutdown, shutdown_receiver) = watch::channel(false);
        state.runtimes.lock().unwrap().insert(
            "thread-1".to_string(),
            AgentRuntimeRecord {
                runtime_id: "runtime-1".to_string(),
                config,
                session_id: Some("session-1".to_string()),
                phase: AgentRuntimePhase::Running,
                current_run_id: Some("run-1".to_string()),
                command: Some(command),
                shutdown,
                last_error: None,
            },
        );
        let (cancel, cancel_receiver) = watch::channel(false);
        let (control, _control_receiver) = mpsc::unbounded_channel();
        state
            .insert(
                "run-1".to_string(),
                AgentRunRecord {
                    thread_id: Some("thread-1".to_string()),
                    events: Vec::new(),
                    finished: false,
                    terminal_emitted: false,
                    notify: Arc::new(Notify::new()),
                    cancel,
                    control,
                },
            )
            .unwrap();

        assert!(state.cancel("run-1").unwrap());
        assert!(*cancel_receiver.borrow());
        assert!(!*shutdown_receiver.borrow());
        state.finish_runtime_run("thread-1", "runtime-1", "run-1");
        assert_eq!(state.runtime_status("thread-1").unwrap().phase, "ready");
    }

    #[test]
    fn closing_a_hot_runtime_updates_status_and_signals_shutdown() {
        let state = test_run_state();
        let config = test_runtime_config();
        let (command, _commands) = mpsc::unbounded_channel();
        let (shutdown, shutdown_receiver) = watch::channel(false);
        state.runtimes.lock().unwrap().insert(
            "thread-1".to_string(),
            AgentRuntimeRecord {
                runtime_id: "runtime-1".to_string(),
                config,
                session_id: Some("session-1".to_string()),
                phase: AgentRuntimePhase::Ready,
                current_run_id: None,
                command: Some(command),
                shutdown,
                last_error: None,
            },
        );

        assert!(state.close_runtime("thread-1").unwrap());
        assert!(*shutdown_receiver.borrow());
        let status = state.runtime_status("thread-1").unwrap();
        assert_eq!(status.phase, "closed");
        assert_eq!(status.session_id.as_deref(), Some("session-1"));
    }

    #[test]
    fn runtime_status_list_exposes_ready_agent_sessions_by_thread() {
        let state = test_run_state();
        let config = test_runtime_config();
        let (command, _commands) = mpsc::unbounded_channel();
        let (shutdown, _shutdown_receiver) = watch::channel(false);
        state.runtimes.lock().unwrap().insert(
            "thread-1".to_string(),
            AgentRuntimeRecord {
                runtime_id: "runtime-1".to_string(),
                config,
                session_id: Some("session-1".to_string()),
                phase: AgentRuntimePhase::Ready,
                current_run_id: None,
                command: Some(command),
                shutdown,
                last_error: None,
            },
        );

        let statuses = state.runtime_statuses().unwrap();
        let status = statuses.get("thread-1").unwrap();
        assert_eq!(status.phase, "ready");
        assert_eq!(status.provider_id.as_deref(), Some("grok-build"));
        assert_eq!(status.session_id.as_deref(), Some("session-1"));
        assert!(status.current_run_id.is_none());
    }

    #[test]
    fn forgetting_a_thread_closes_runtime_and_removes_run_records() {
        let state = test_run_state();
        let service = AgentRunService {
            state: state.clone(),
        };
        let config = test_runtime_config();
        let (command, _commands) = mpsc::unbounded_channel();
        let (shutdown, shutdown_receiver) = watch::channel(false);
        state.runtimes.lock().unwrap().insert(
            "thread-1".to_string(),
            AgentRuntimeRecord {
                runtime_id: "runtime-1".to_string(),
                config,
                session_id: Some("session-1".to_string()),
                phase: AgentRuntimePhase::Ready,
                current_run_id: None,
                command: Some(command),
                shutdown,
                last_error: None,
            },
        );
        let (cancel, _cancel_receiver) = watch::channel(false);
        let (control, _control_receiver) = mpsc::unbounded_channel();
        state
            .insert(
                "run-1".to_string(),
                AgentRunRecord {
                    thread_id: Some("thread-1".to_string()),
                    events: Vec::new(),
                    finished: false,
                    terminal_emitted: false,
                    notify: Arc::new(Notify::new()),
                    cancel,
                    control,
                },
            )
            .unwrap();

        service.forget_thread("thread-1");

        assert!(*shutdown_receiver.borrow());
        assert!(!state.contains("run-1").unwrap());
        assert!(!state.runtime_status("thread-1").unwrap().exists);
    }

    #[test]
    fn unified_agent_input_rejects_invalid_image_base64() {
        let error = normalize_agent_input(
            None,
            Some(vec![AgentInputContentBlock::Image {
                id: None,
                path: None,
                name: Some("shot.png".to_string()),
                mime_type: Some("image/png".to_string()),
                size: None,
                data: Some("not-base64".to_string()),
            }]),
        )
        .expect_err("invalid base64 must fail");

        assert_eq!(error.status, axum::http::StatusCode::BAD_REQUEST);
        assert!(error.message.contains("base64"));
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
                AgentRunEvent::ToolStop { block_index: 0, .. },
                AgentRunEvent::Phase { phase, .. }
            ] if phase == "thinking"
        ));
        assert!(matches!(
            mapper.map_event(AcpRuntimeEvent::ThoughtChunk).as_slice(),
            []
        ));
        assert!(matches!(
            mapper
                .map_event(AcpRuntimeEvent::TextDelta {
                    text: "ok".to_string()
                })
                .as_slice(),
            [AgentRunEvent::Delta { .. }]
        ));
        assert!(matches!(
            mapper.map_event(AcpRuntimeEvent::ThoughtChunk).as_slice(),
            [AgentRunEvent::Phase { phase, .. }] if phase == "thinking"
        ));
        assert!(duplicate.is_empty());
    }

    #[test]
    fn codex_mapper_preserves_text_tools_and_interactions() {
        let mut mapper = CodexEventMapper::new("run-1".to_string());
        let initial_thinking = mapper.map_event(CodexRuntimeEvent::Thinking);
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
            initial_thinking.as_slice(),
            [AgentRunEvent::Phase { phase, .. }] if phase == "thinking"
        ));
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
                AgentRunEvent::ToolStop { block_index: 0, .. },
                AgentRunEvent::Phase { phase, .. }
            ] if phase == "thinking"
        ));
        assert!(duplicate.is_empty());
    }

    #[tokio::test]
    async fn run_state_accepts_only_one_terminal_event() {
        let state = test_run_state();
        let (cancel, _) = watch::channel(false);
        let (control, _) = mpsc::unbounded_channel();
        state
            .insert(
                "run-1".to_string(),
                AgentRunRecord {
                    thread_id: None,
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
                usage: crate::agent_runtime::AgentUsageSnapshot::default(),
                usage_source: "result",
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
