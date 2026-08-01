use crate::{
    acp::{
        AcpEmbeddedResource, AcpError, AcpPermissionPolicy, AcpPromptInput, AcpPromptOutcome,
        AcpRuntimeEvent, AcpSessionSummary, AcpStdioClient, AcpToolCall, AcpToolCallUpdate,
    },
    agent_channels::AgentChannelService,
    agent_runtime::{
        normalize_agent_permission_mode, AgentApprovalOption, AgentApprovalRequest,
        AgentCompactCapabilityState, AgentCompactCapabilitySummary, AgentCompactionSource,
        AgentCompactionStatus, AgentControlCommand, AgentPermissionDecision, AgentRunEvent,
        AgentUsageSnapshot, AgentUserInputOption, AgentUserInputQuestion, AgentUserInputRequest,
        GROK_BUILD_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID, OPENCODE_PROVIDER_ID,
        PI_AGENT_PROVIDER_ID,
    },
    codex_app_server::{
        CodexAppServerError, CodexCompactCapability, CodexCompactionEvent, CodexRuntimeEvent,
        CodexStdioClient, CodexUserInput,
    },
    pi_rpc::{PiImage, PiModel, PiPromptInput, PiRpcError, PiRuntimeEvent, PiState, PiStdioClient},
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
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::{BTreeMap, HashMap},
    env, fs,
    future::Future,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, oneshot, watch, Mutex as AsyncMutex, Notify};

const RUN_RETENTION: Duration = Duration::from_secs(10 * 60);
const CONTROL_ACK_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_PROMPT_BYTES: usize = 1024 * 1024;
const MAX_CONVERSATION_CONTEXT_BYTES: usize = 128 * 1024;
const MAX_INPUT_BLOCKS: usize = 32;
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES: usize = 30 * 1024 * 1024;
const MAX_AGENT_REQUEST_BYTES: usize = 42 * 1024 * 1024;
const MAX_PATH_BYTES: usize = 4096;
const MAX_NAME_BYTES: usize = 512;
const MAX_MIME_TYPE_BYTES: usize = 255;
const MAX_REASON_BYTES: usize = 4096;
const MAX_GROK_LOG_TAIL_BYTES: u64 = 512 * 1024;
const MODEL_CATALOG_CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const AGENT_COMMAND_CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const AUTOMATION_EXECUTION_CONTEXT: &str = "[CodeM 自动化执行上下文]\n当前运行是 CodeM 已调度任务的一次执行。只完成本次任务，不要创建、修改、删除或查询任何定时任务、Cron、计划或唤醒任务。";

type CommandResolver = fn() -> Option<String>;

#[derive(Clone, Copy)]
struct CommandResolvers {
    grok: CommandResolver,
    codex: CommandResolver,
    opencode: CommandResolver,
    pi: CommandResolver,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AgentDriverKind {
    Acp,
    CodexAppServer,
    PiRpc,
}

enum AgentDriverInput {
    Acp(Vec<AcpPromptInput>),
    Codex(Vec<CodexUserInput>),
    Pi(PiPromptInput),
}

#[derive(Clone)]
struct AgentRunState {
    records: Arc<Mutex<HashMap<String, AgentRunRecord>>>,
    runtimes: Arc<Mutex<HashMap<String, AgentRuntimeRecord>>>,
    model_catalog_cache: Arc<Mutex<HashMap<String, CachedAgentModelCatalog>>>,
    command_cache: Arc<Mutex<HashMap<String, CachedAgentCommand>>>,
    compact_capability_cache: Arc<AsyncMutex<HashMap<String, AgentCompactCapabilitySummary>>>,
    command_resolvers: CommandResolvers,
    agent_channels: AgentChannelService,
}

#[derive(Clone)]
struct CachedAgentModelCatalog {
    catalog: AgentModelCatalog,
    loaded_at: Instant,
}

#[derive(Clone)]
struct CachedAgentCommand {
    command: String,
    resolved_at: Instant,
}

struct AgentRunRecord {
    provider_id: String,
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
    provider_id: String,
    working_directory: PathBuf,
    input: Vec<AcpPromptInput>,
    requested_session_id: Option<String>,
    permission_mode: &'static str,
    model: Option<String>,
    environment: BTreeMap<String, String>,
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
    environment: BTreeMap<String, String>,
    codex_config_args: Vec<String>,
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
    channel_id: Option<String>,
    channel_fingerprint: Option<String>,
    environment: BTreeMap<String, String>,
    codex_config_args: Vec<String>,
    bridge_version: Option<String>,
}

fn compact_capability_cache_key(config: &AgentRuntimeConfig) -> String {
    json!([
        config.command,
        config.channel_fingerprint,
        config.codex_config_args,
    ])
    .to_string()
}

async fn probe_compact_capability_cached<F, Fut>(
    cache: &AsyncMutex<HashMap<String, AgentCompactCapabilitySummary>>,
    config: &AgentRuntimeConfig,
    refresh: bool,
    probe: F,
) -> AgentCompactCapabilitySummary
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<AgentCompactCapabilitySummary, CodexAppServerError>>,
{
    let key = compact_capability_cache_key(config);
    let mut cache = cache.lock().await;
    if !refresh {
        if let Some(summary) = cache.get(&key) {
            return summary.clone();
        }
    }

    let summary = probe()
        .await
        .unwrap_or_else(|error| AgentCompactCapabilitySummary {
            state: AgentCompactCapabilityState::Error,
            message: Some(public_codex_error(error)),
        });
    if summary.state != AgentCompactCapabilityState::Error {
        cache.insert(key, summary.clone());
    }
    summary
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

struct AgentRuntimeCompact {
    run_id: String,
    operation_id: String,
}

enum AgentRuntimeCommand {
    Run(AgentRuntimeRun),
    Compact(AgentRuntimeCompact),
}

fn command_run_id(command: &AgentRuntimeCommand) -> &str {
    match command {
        AgentRuntimeCommand::Run(run) => &run.run_id,
        AgentRuntimeCommand::Compact(compact) => &compact.run_id,
    }
}

fn validate_compact_runtime_session(
    command: &AgentRuntimeCommand,
    requested_session_id: Option<&str>,
    actual_session_id: &str,
) -> Result<(), String> {
    if matches!(command, AgentRuntimeCommand::Compact(_))
        && requested_session_id != Some(actual_session_id)
    {
        return Err("Codex 恢复后的 sessionId 与压缩请求不一致".to_string());
    }
    Ok(())
}

fn push_compact_failure_event(
    state: &AgentRunState,
    command: &AgentRuntimeCommand,
    provider_thread_id: Option<&str>,
    message: &str,
) {
    let (AgentRuntimeCommand::Compact(compact), Some(provider_thread_id)) =
        (command, provider_thread_id)
    else {
        return;
    };
    state.push_event(
        &compact.run_id,
        AgentRunEvent::ContextCompaction {
            run_id: compact.run_id.clone(),
            operation_id: Some(compact.operation_id.clone()),
            source: AgentCompactionSource::Manual,
            status: AgentCompactionStatus::Failed,
            provider_thread_id: provider_thread_id.to_string(),
            provider_turn_id: None,
            provider_item_id: None,
            error: Some(message.to_string()),
            at_ms: Utc::now().timestamp_millis(),
        },
    );
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
    Acp {
        client: AcpStdioClient,
        session_id: String,
    },
    Codex {
        client: CodexStdioClient,
        session_id: String,
        compact_capability: AgentCompactCapabilitySummary,
    },
    Pi {
        client: PiStdioClient,
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
    channel_id: Option<String>,
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
    #[serde(default)]
    conversation_context: Option<String>,
    #[serde(default)]
    automation_execution: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StartAgentCompactRequest {
    operation_id: String,
    provider_id: String,
    session_id: String,
    working_directory: String,
    permission_mode: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    channel_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CodexCompactCapabilityRequest {
    thread_id: String,
    session_id: String,
    working_directory: String,
    permission_mode: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    channel_id: Option<String>,
    #[serde(default)]
    refresh: bool,
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

#[derive(Debug, Default, Deserialize)]
struct AgentModelsQuery {
    #[serde(default)]
    refresh: bool,
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

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GuideAgentRunRequest {
    prompt: String,
}

#[derive(Debug, PartialEq, Eq)]
enum GuideAckOutcome {
    Submitted,
    Rejected(String),
    Uncertain(String),
}

impl AgentRunService {
    pub(crate) fn new(
        grok_command_resolver: fn() -> Option<String>,
        codex_command_resolver: fn() -> Option<String>,
        opencode_command_resolver: fn() -> Option<String>,
        pi_command_resolver: fn() -> Option<String>,
        agent_channels: AgentChannelService,
    ) -> Self {
        Self {
            state: AgentRunState {
                records: Arc::new(Mutex::new(HashMap::new())),
                runtimes: Arc::new(Mutex::new(HashMap::new())),
                model_catalog_cache: Arc::new(Mutex::new(HashMap::new())),
                command_cache: Arc::new(Mutex::new(HashMap::new())),
                compact_capability_cache: Arc::new(AsyncMutex::new(HashMap::new())),
                command_resolvers: CommandResolvers {
                    grok: grok_command_resolver,
                    codex: codex_command_resolver,
                    opencode: opencode_command_resolver,
                    pi: pi_command_resolver,
                },
                agent_channels,
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

    pub(crate) fn resolve_command(&self, provider_id: &str, refresh: bool) -> Option<String> {
        resolve_agent_command(&self.state, provider_id, refresh)
    }
}

pub(crate) fn router(service: AgentRunService) -> Router {
    let state = service.state;
    Router::new()
        .route("/api/agents/{provider_id}/models", get(agent_models))
        .route(
            "/api/agents/codex/compact-capability",
            post(codex_compact_capability),
        )
        .route("/api/agents/runtimes", get(agent_runtime_statuses))
        .route(
            "/api/agents/runtime/{thread_id}",
            get(agent_runtime_status).delete(close_agent_runtime),
        )
        .route(
            "/api/agents/runtime/{thread_id}/compact",
            post(start_agent_compact),
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
        .route("/api/agents/run/{run_id}/guide", post(agent_run_guide))
        .route("/api/agents/run/{run_id}", delete(cancel_agent_run))
        .layer(DefaultBodyLimit::max(MAX_AGENT_REQUEST_BYTES))
        .with_state(state)
}

async fn codex_compact_capability(
    State(state): State<AgentRunState>,
    Json(payload): Json<CodexCompactCapabilityRequest>,
) -> AgentApiResult<Json<AgentCompactCapabilitySummary>> {
    let thread_id = required_id(&payload.thread_id, "threadId")?;
    let session_id = required_id(&payload.session_id, "sessionId")?;
    if payload.refresh {
        resolve_agent_command(&state, OPENAI_CODEX_PROVIDER_ID, true).ok_or_else(|| {
            AgentApiError::bad_request(
                "未找到可由 CodeM 启动的 Codex CLI，请安装独立 CLI 或设置 CODEX_CLI_PATH",
            )
        })?;
    }
    let request = StartAgentCompactRequest {
        operation_id: "capability-probe".to_string(),
        provider_id: OPENAI_CODEX_PROVIDER_ID.to_string(),
        session_id,
        working_directory: payload.working_directory,
        permission_mode: payload.permission_mode,
        model: payload.model,
        reasoning_effort: payload.reasoning_effort,
        channel_id: payload.channel_id,
    };
    let config = resolve_compact_runtime_config(&state, &thread_id, &request)?;
    let summary = probe_compact_capability_cached(
        &state.compact_capability_cache,
        &config,
        payload.refresh,
        || async {
            let mut client = CodexStdioClient::spawn_with_options(
                &config.command,
                &config.working_directory,
                &config.codex_config_args,
                &config.environment,
            )
            .await?;
            let result = async {
                client.initialize(env!("CARGO_PKG_VERSION")).await?;
                client.probe_compact_capability().await
            }
            .await;
            client.shutdown().await;
            Ok(summarize_codex_compact_capability(result))
        },
    )
    .await;
    Ok(Json(summary))
}

async fn agent_models(
    State(state): State<AgentRunState>,
    AxumPath(provider_id): AxumPath<String>,
    Query(query): Query<AgentModelsQuery>,
) -> AgentApiResult<Json<AgentModelCatalog>> {
    let provider_id = provider_id.trim();
    if !query.refresh {
        if let Some(catalog) =
            read_cached_agent_model_catalog(&state.model_catalog_cache, provider_id, Instant::now())
        {
            return Ok(Json(catalog));
        }
    }
    let cwd =
        env::current_dir().map_err(|_| AgentApiError::internal("无法读取模型目录工作目录"))?;
    let result = match provider_id {
        GROK_BUILD_PROVIDER_ID => {
            let command = resolve_agent_command(&state, provider_id, query.refresh)
                .ok_or_else(|| AgentApiError::bad_request("未找到 grok 命令"))?;
            let arguments = grok_acp_arguments("default");
            let mut client = AcpStdioClient::spawn(&command, &arguments, &cwd)
                .await
                .map_err(|error| AgentApiError::internal(public_acp_error(error)))?;
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
                result.map_err(|error| AgentApiError::internal(public_acp_error(error)))?;
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
            let command =
                resolve_agent_command(&state, provider_id, query.refresh).ok_or_else(|| {
                    AgentApiError::bad_request(
                        "未找到可由 CodeM 启动的 Codex CLI，请安装独立 CLI 或设置 CODEX_CLI_PATH",
                    )
                })?;
            let mut client = CodexStdioClient::spawn(&command, &cwd)
                .await
                .map_err(|error| AgentApiError::internal(public_codex_error(error)))?;
            let result = async {
                client.initialize(env!("CARGO_PKG_VERSION")).await?;
                client.list_models().await
            }
            .await;
            client.shutdown().await;
            let codex_models =
                result.map_err(|error| AgentApiError::internal(public_codex_error(error)))?;
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
        OPENCODE_PROVIDER_ID => {
            let command =
                resolve_agent_command(&state, provider_id, query.refresh).ok_or_else(|| {
                    AgentApiError::bad_request("未找到可由 CodeM 启动的 OpenCode CLI")
                })?;
            let output = background_agent_command(&command)
                .arg("models")
                .current_dir(&cwd)
                .kill_on_drop(true)
                .output()
                .await
                .map_err(|_| AgentApiError::internal("读取 OpenCode 模型目录失败"))?;
            if !output.status.success() {
                return Err(AgentApiError::bad_request(
                    "OpenCode 模型目录读取失败，请检查 provider 配置",
                ));
            }
            let models = parse_opencode_models(&String::from_utf8_lossy(&output.stdout));
            if models.is_empty() {
                return Err(AgentApiError::bad_request(
                    "OpenCode 当前没有可用模型，请先完成 provider 配置",
                ));
            }
            Ok(Json(AgentModelCatalog {
                provider_id: OPENCODE_PROVIDER_ID.to_string(),
                default_model_id: None,
                models,
            }))
        }
        PI_AGENT_PROVIDER_ID => {
            let command = resolve_agent_command(&state, provider_id, query.refresh)
                .ok_or_else(|| AgentApiError::bad_request("未找到 pi 命令"))?;
            let arguments = vec!["--mode".to_string(), "rpc".to_string()];
            let client =
                PiStdioClient::spawn_with_options(&command, &cwd, &BTreeMap::new(), &arguments)
                    .await
                    .map_err(|error| AgentApiError::internal(public_pi_error(error)))?;
            let result = async {
                let pi_state = client.get_state().await?;
                let models = client.get_available_models().await?;
                let levels = client.get_available_thinking_levels().await?;
                Ok::<_, PiRpcError>(pi_model_catalog(&pi_state, models, levels))
            }
            .await;
            client.shutdown().await;
            result
                .map(Json)
                .map_err(|error| AgentApiError::internal(public_pi_error(error)))
        }
        _ => Err(AgentApiError::bad_request(
            "当前 Provider 不提供动态模型目录",
        )),
    };
    if let Ok(Json(catalog)) = &result {
        store_cached_agent_model_catalog(
            &state.model_catalog_cache,
            provider_id,
            catalog.clone(),
            Instant::now(),
        );
    }
    result
}

fn read_cached_agent_model_catalog(
    cache: &Mutex<HashMap<String, CachedAgentModelCatalog>>,
    provider_id: &str,
    now: Instant,
) -> Option<AgentModelCatalog> {
    let mut cache = cache.lock().ok()?;
    let entry = cache.get(provider_id)?;
    if now.saturating_duration_since(entry.loaded_at) >= MODEL_CATALOG_CACHE_TTL {
        cache.remove(provider_id);
        return None;
    }
    Some(entry.catalog.clone())
}

fn store_cached_agent_model_catalog(
    cache: &Mutex<HashMap<String, CachedAgentModelCatalog>>,
    provider_id: &str,
    catalog: AgentModelCatalog,
    loaded_at: Instant,
) {
    if let Ok(mut cache) = cache.lock() {
        cache.insert(
            provider_id.to_string(),
            CachedAgentModelCatalog { catalog, loaded_at },
        );
    }
}

fn resolve_agent_command(
    state: &AgentRunState,
    provider_id: &str,
    refresh: bool,
) -> Option<String> {
    if refresh {
        if let Ok(mut cache) = state.command_cache.lock() {
            cache.remove(provider_id);
        }
    } else {
        if let Some(command) =
            read_cached_agent_command(&state.command_cache, provider_id, Instant::now())
        {
            return Some(command);
        }
    }

    let command = match provider_id {
        GROK_BUILD_PROVIDER_ID => (state.command_resolvers.grok)(),
        OPENAI_CODEX_PROVIDER_ID => (state.command_resolvers.codex)(),
        OPENCODE_PROVIDER_ID => (state.command_resolvers.opencode)(),
        PI_AGENT_PROVIDER_ID => (state.command_resolvers.pi)(),
        _ => None,
    }?;
    store_cached_agent_command(
        &state.command_cache,
        provider_id,
        command.clone(),
        Instant::now(),
    );
    Some(command)
}

fn read_cached_agent_command(
    cache: &Mutex<HashMap<String, CachedAgentCommand>>,
    provider_id: &str,
    now: Instant,
) -> Option<String> {
    let mut cache = cache.lock().ok()?;
    let entry = cache.get(provider_id)?;
    if now.saturating_duration_since(entry.resolved_at) >= AGENT_COMMAND_CACHE_TTL {
        cache.remove(provider_id);
        return None;
    }
    Some(entry.command.clone())
}

fn store_cached_agent_command(
    cache: &Mutex<HashMap<String, CachedAgentCommand>>,
    provider_id: &str,
    command: String,
    resolved_at: Instant,
) {
    if let Ok(mut cache) = cache.lock() {
        cache.insert(
            provider_id.to_string(),
            CachedAgentCommand {
                command,
                resolved_at,
            },
        );
    }
}

fn parse_opencode_models(value: &str) -> Vec<AgentModelSummary> {
    let mut seen = std::collections::HashSet::new();
    value
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && line.len() <= 512
                && line.contains('/')
                && !line.chars().any(char::is_control)
        })
        .filter(|line| seen.insert((*line).to_string()))
        .take(1000)
        .map(|id| {
            let (provider, label) = id
                .split_once('/')
                .map(|(provider, model)| (provider, model))
                .unwrap_or(("OpenCode", id));
            AgentModelSummary {
                id: id.to_string(),
                label: label.to_string(),
                description: Some(provider.to_string()),
                context_window_tokens: None,
                is_default: false,
                default_reasoning_effort: None,
                supported_reasoning_efforts: Vec::new(),
            }
        })
        .collect()
}

fn background_agent_command(program: &str) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(program);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    command
}

async fn start_agent_run(
    State(state): State<AgentRunState>,
    Json(payload): Json<StartAgentRunRequest>,
) -> AgentApiResult<Response> {
    let provider_id = payload.provider_id.trim();
    let (driver, command, provider_name) = match provider_id {
        GROK_BUILD_PROVIDER_ID => (
            AgentDriverKind::Acp,
            resolve_agent_command(&state, provider_id, false)
                .ok_or_else(|| AgentApiError::bad_request("未找到 grok 命令"))?,
            "Grok Build",
        ),
        OPENCODE_PROVIDER_ID => (
            AgentDriverKind::Acp,
            resolve_agent_command(&state, provider_id, false).ok_or_else(|| {
                AgentApiError::bad_request("未找到可由 CodeM 启动的 OpenCode CLI")
            })?,
            "OpenCode",
        ),
        OPENAI_CODEX_PROVIDER_ID => (
            AgentDriverKind::CodexAppServer,
            resolve_agent_command(&state, provider_id, false).ok_or_else(|| {
                AgentApiError::bad_request(
                    "未找到可由 CodeM 启动的 Codex CLI，请安装独立 CLI 或设置 CODEX_CLI_PATH",
                )
            })?,
            "OpenAI Codex",
        ),
        PI_AGENT_PROVIDER_ID => (
            AgentDriverKind::PiRpc,
            resolve_agent_command(&state, provider_id, false)
                .ok_or_else(|| AgentApiError::bad_request("未找到 pi 命令"))?,
            "Pi",
        ),
        _ => {
            return Err(AgentApiError::bad_request(
                "当前 Provider 不支持通用 Agent 运行",
            ))
        }
    };
    let input_blocks = normalize_agent_input(payload.prompt.as_deref(), payload.content_blocks)?;
    let working_directory = resolve_working_directory(&payload.working_directory)?;
    let thread_id = normalize_optional_id(payload.thread_id, "threadId")?;
    let session_id = normalize_optional_id(payload.session_id, "sessionId")?;
    let driver_input = match driver {
        AgentDriverKind::Acp => AgentDriverInput::Acp(build_acp_prompt(
            &input_blocks,
            &working_directory,
            payload.conversation_context.as_deref(),
            payload.automation_execution,
        )?),
        AgentDriverKind::CodexAppServer => AgentDriverInput::Codex(build_codex_input(
            &input_blocks,
            &working_directory,
            payload.automation_execution,
        )?),
        AgentDriverKind::PiRpc => {
            AgentDriverInput::Pi(build_pi_prompt(&input_blocks, &working_directory)?)
        }
    };
    let requested_model = normalize_optional_id(payload.model, "model")?;
    let channel_id = normalize_optional_id(payload.channel_id, "channelId")?;
    let channel_runtime = state
        .agent_channels
        .resolve_runtime(
            provider_id,
            channel_id.as_deref(),
            requested_model.as_deref(),
            thread_id.as_deref(),
            session_id.as_deref(),
        )
        .map_err(AgentApiError::bad_request)?;
    let model = channel_runtime
        .as_ref()
        .and_then(|runtime| runtime.effective_model.clone())
        .or(requested_model);
    let channel_id = channel_runtime
        .as_ref()
        .map(|runtime| runtime.channel_id.clone());
    let channel_fingerprint = channel_runtime
        .as_ref()
        .map(|runtime| runtime.fingerprint.clone());
    let environment = channel_runtime
        .as_ref()
        .map(|runtime| runtime.env.clone())
        .unwrap_or_default();
    let codex_config_args = channel_runtime
        .as_ref()
        .map(|runtime| runtime.codex_config_args.clone())
        .unwrap_or_default();
    if let Some(thread_id) = thread_id.as_deref() {
        state
            .agent_channels
            .persist_thread_runtime(
                thread_id,
                channel_id.as_deref(),
                channel_fingerprint.as_deref(),
            )
            .map_err(AgentApiError::internal)?;
    }
    let reasoning_effort = normalize_optional_id(payload.reasoning_effort, "reasoningEffort")?;
    if driver == AgentDriverKind::Acp && reasoning_effort.is_some() {
        return Err(AgentApiError::bad_request(
            "当前 ACP Agent 模型目录未提供 reasoning effort 能力",
        ));
    }
    let permission_mode = normalize_agent_permission_mode(payload.permission_mode.as_deref())
        .ok_or_else(|| {
            AgentApiError::bad_request("permissionMode 仅支持 default、auto 或 bypassPermissions")
        })?;
    if driver == AgentDriverKind::PiRpc && thread_id.is_none() {
        return Err(AgentApiError::bad_request(
            "Pi Agent 运行需要关联 CodeM threadId",
        ));
    }
    let run_id = uuid::Uuid::new_v4().to_string();
    let (cancel_sender, cancel_receiver) = watch::channel(false);
    let (control_sender, control_receiver) = mpsc::unbounded_channel();
    state.insert(
        run_id.clone(),
        AgentRunRecord {
            provider_id: provider_id.to_string(),
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
    let provider_id = provider_id.to_string();

    if let Some(thread_id) = thread_id {
        let config = AgentRuntimeConfig {
            provider_id: provider_id.clone(),
            driver,
            command,
            working_directory,
            permission_mode,
            model,
            reasoning_effort,
            channel_id,
            channel_fingerprint,
            environment,
            codex_config_args,
            bridge_version: (driver == AgentDriverKind::PiRpc).then(|| "1".to_string()),
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
                AgentDriverInput::Acp(input) => {
                    execute_acp_run(AcpRunTask {
                        state: task_state,
                        run_id: task_run_id,
                        command,
                        provider_id,
                        working_directory,
                        input,
                        requested_session_id: session_id,
                        permission_mode,
                        model,
                        environment,
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
                        environment,
                        codex_config_args,
                        cancel: cancel_receiver,
                        control: control_receiver,
                    })
                    .await;
                }
                AgentDriverInput::Pi(_) => unreachable!("Pi RPC runs require a thread runtime"),
            }
        });
    }

    build_event_stream(state, run_id, 0)
}

async fn start_agent_compact(
    State(state): State<AgentRunState>,
    AxumPath(thread_id): AxumPath<String>,
    Json(mut payload): Json<StartAgentCompactRequest>,
) -> AgentApiResult<Response> {
    let thread_id = required_id(&thread_id, "threadId")?;
    if payload.provider_id.trim() != OPENAI_CODEX_PROVIDER_ID {
        return Err(AgentApiError::bad_request(
            "只有 OpenAI Codex 支持原生上下文压缩",
        ));
    }
    payload.provider_id = OPENAI_CODEX_PROVIDER_ID.to_string();
    payload.operation_id = required_id(&payload.operation_id, "operationId")?;
    payload.session_id = required_id(&payload.session_id, "sessionId")?;
    let config = resolve_compact_runtime_config(&state, &thread_id, &payload)?;
    let run_id = uuid::Uuid::new_v4().to_string();
    let (cancel, _cancel_receiver) = watch::channel(false);
    let (control, _control_receiver) = mpsc::unbounded_channel();
    state.insert(
        run_id.clone(),
        AgentRunRecord {
            provider_id: OPENAI_CODEX_PROVIDER_ID.to_string(),
            thread_id: Some(thread_id.clone()),
            events: Vec::new(),
            finished: false,
            terminal_emitted: false,
            notify: Arc::new(Notify::new()),
            cancel,
            control,
        },
    )?;
    state.push_event(
        &run_id,
        AgentRunEvent::Status {
            run_id: run_id.clone(),
            message: "正在排队压缩 Codex 上下文".to_string(),
        },
    );
    if let Err(error) = state.dispatch_compact(
        thread_id,
        config,
        payload.session_id,
        AgentRuntimeCompact {
            run_id: run_id.clone(),
            operation_id: payload.operation_id,
        },
    ) {
        state.remove_run_record(&run_id);
        return Err(error);
    }
    build_event_stream(state, run_id, 0)
}

fn resolve_compact_runtime_config(
    state: &AgentRunState,
    thread_id: &str,
    request: &StartAgentCompactRequest,
) -> AgentApiResult<AgentRuntimeConfig> {
    let working_directory = resolve_working_directory(&request.working_directory)?;
    let permission_mode = normalize_agent_permission_mode(request.permission_mode.as_deref())
        .ok_or_else(|| {
            AgentApiError::bad_request("permissionMode 仅支持 default、auto 或 bypassPermissions")
        })?;
    let requested_model = normalize_optional_id(request.model.clone(), "model")?;
    let requested_channel_id = normalize_optional_id(request.channel_id.clone(), "channelId")?;
    let channel_runtime = state
        .agent_channels
        .resolve_runtime(
            OPENAI_CODEX_PROVIDER_ID,
            requested_channel_id.as_deref(),
            requested_model.as_deref(),
            Some(thread_id),
            Some(&request.session_id),
        )
        .map_err(AgentApiError::bad_request)?;
    Ok(AgentRuntimeConfig {
        provider_id: OPENAI_CODEX_PROVIDER_ID.to_string(),
        driver: AgentDriverKind::CodexAppServer,
        command: resolve_agent_command(state, OPENAI_CODEX_PROVIDER_ID, false).ok_or_else(
            || {
                AgentApiError::bad_request(
                    "未找到可由 CodeM 启动的 Codex CLI，请安装独立 CLI 或设置 CODEX_CLI_PATH",
                )
            },
        )?,
        working_directory,
        permission_mode,
        model: channel_runtime
            .as_ref()
            .and_then(|runtime| runtime.effective_model.clone())
            .or(requested_model),
        reasoning_effort: normalize_optional_id(
            request.reasoning_effort.clone(),
            "reasoningEffort",
        )?,
        channel_id: channel_runtime
            .as_ref()
            .map(|runtime| runtime.channel_id.clone()),
        channel_fingerprint: channel_runtime
            .as_ref()
            .map(|runtime| runtime.fingerprint.clone()),
        environment: channel_runtime
            .as_ref()
            .map(|runtime| runtime.env.clone())
            .unwrap_or_default(),
        codex_config_args: channel_runtime
            .as_ref()
            .map(|runtime| runtime.codex_config_args.clone())
            .unwrap_or_default(),
        bridge_version: None,
    })
}

async fn run_agent_runtime_actor(
    state: AgentRunState,
    thread_id: String,
    runtime_id: String,
    config: AgentRuntimeConfig,
    requested_session_id: Option<String>,
    first_command: AgentRuntimeCommand,
    mut commands: mpsc::UnboundedReceiver<AgentRuntimeCommand>,
    mut shutdown: watch::Receiver<bool>,
) {
    let first_run_id = command_run_id(&first_command).to_string();
    let started = tokio::select! {
        result = start_live_agent_runtime(&config, requested_session_id.as_deref()) => Some(result),
        _ = wait_for_shutdown(&mut shutdown) => None,
    };
    let Some(started) = started else {
        push_compact_failure_event(
            &state,
            &first_command,
            requested_session_id.as_deref(),
            "Agent 热会话已关闭",
        );
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
            push_compact_failure_event(
                &state,
                &first_command,
                requested_session_id.as_deref(),
                &message,
            );
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
    if let Err(message) = validate_compact_runtime_session(
        &first_command,
        requested_session_id.as_deref(),
        &session_id,
    ) {
        push_compact_failure_event(
            &state,
            &first_command,
            requested_session_id.as_deref(),
            &message,
        );
        state.push_terminal(
            &first_run_id,
            AgentRunEvent::Error {
                run_id: first_run_id.clone(),
                message: message.clone(),
            },
        );
        state.mark_runtime_failed(&thread_id, &runtime_id, Some(&first_run_id), message);
        runtime.shutdown().await;
        return;
    }
    state.activate_runtime_session(&thread_id, &runtime_id, &first_run_id, &session_id);

    let mut current_command = Some(first_command);
    let mut reused = false;
    loop {
        if let Some(command) = current_command.take() {
            let run_id = command_run_id(&command).to_string();
            state.push_event(
                &run_id,
                AgentRunEvent::Session {
                    run_id: run_id.clone(),
                    session_id: session_id.clone(),
                },
            );

            let execution = match command {
                AgentRuntimeCommand::Run(run) => {
                    state.push_event(
                        &run_id,
                        AgentRunEvent::Status {
                            run_id: run_id.clone(),
                            message: runtime_status_message(
                                &config.provider_id,
                                config.driver,
                                reused,
                                resumed,
                            ),
                        },
                    );
                    state.push_event(&run_id, agent_phase_event(&run_id, "thinking", "思考中"));
                    runtime.run_turn(&state, &config, run, &mut shutdown).await
                }
                AgentRuntimeCommand::Compact(compact) => {
                    state.push_event(
                        &run_id,
                        AgentRunEvent::Status {
                            run_id: run_id.clone(),
                            message: "正在准备压缩 Codex 上下文".to_string(),
                        },
                    );
                    runtime.compact(&state, compact, &mut shutdown).await
                }
            };

            match execution {
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
                    Some(command) => current_command = Some(command),
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
            Self::Acp { session_id, .. }
            | Self::Codex { session_id, .. }
            | Self::Pi { session_id, .. } => session_id,
        }
    }

    fn is_running(&mut self) -> bool {
        match self {
            Self::Acp { client, .. } => client.is_running(),
            Self::Codex { client, .. } => client.is_running(),
            Self::Pi { client, .. } => client.is_running(),
        }
    }

    async fn shutdown(self) {
        match self {
            Self::Acp { client, .. } => client.shutdown().await,
            Self::Codex { client, .. } => client.shutdown().await,
            Self::Pi { client, .. } => client.shutdown().await,
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
            mut cancel,
            mut control,
        } = run;
        match (self, input) {
            (Self::Acp { client, session_id }, AgentDriverInput::Acp(input)) => {
                let mut mapper = AcpEventMapper::new(run_id.clone());
                let event_state = state.clone();
                let turn_started_at = Utc::now();
                let mut result = tokio::select! {
                    result = client.prompt_stream_with_permission_policy(
                        session_id,
                        &input,
                        cancel.clone(),
                        &mut control,
                        acp_permission_policy(&config.provider_id, config.permission_mode),
                        |event| {
                            for event in mapper.map_event(event) {
                                event_state.push_event(&run_id, event);
                            }
                        },
                    ) => Some(result),
                    _ = wait_for_shutdown(shutdown) => None,
                };
                let retry = result.as_ref().is_some_and(|result| {
                    result.as_ref().is_err_and(|error| {
                        should_retry_grok_channel_prompt(
                            &config.provider_id,
                            &config.environment,
                            &mapper,
                            error,
                        )
                    })
                });
                if retry {
                    state.push_event(
                        &run_id,
                        AgentRunEvent::Status {
                            run_id: run_id.clone(),
                            message: "第三方接口返回了临时异常，正在重试".to_string(),
                        },
                    );
                    result = tokio::select! {
                        result = client.prompt_stream_with_permission_policy(
                            session_id,
                            &input,
                            cancel,
                            &mut control,
                            acp_permission_policy(&config.provider_id, config.permission_mode),
                            |event| {
                                for event in mapper.map_event(event) {
                                    event_state.push_event(&run_id, event);
                                }
                            },
                        ) => Some(result),
                        _ = wait_for_shutdown(shutdown) => None,
                    };
                }
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
                    Some(Err(error)) => {
                        let fatal = acp_error_is_fatal(&error) || !client.is_running();
                        let message = grok_acp_error_with_runtime_detail(
                            config,
                            session_id,
                            turn_started_at,
                            &error,
                        )
                        .unwrap_or_else(|| public_acp_error(error));
                        RuntimeExecution::Completed(Err(RuntimeTurnError { fatal, message }))
                    }
                    None => RuntimeExecution::Closed,
                }
            }
            (
                Self::Codex {
                    client, session_id, ..
                },
                AgentDriverInput::Codex(input),
            ) => {
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
            (Self::Pi { client, session_id }, AgentDriverInput::Pi(input)) => {
                let mut mapper = PiEventMapper::new(run_id.clone());
                if let Err(error) = client.prompt(input).await {
                    return RuntimeExecution::Completed(Err(RuntimeTurnError {
                        message: public_pi_error(error),
                        fatal: true,
                    }));
                }
                let mut text = String::new();
                let mut stop_reason = "end_turn".to_string();
                let mut pending_extension_ui = None;
                loop {
                    tokio::select! {
                        event = client.next_event() => {
                            let event = match event {
                                Ok(event) => event,
                                Err(error) => {
                                    return RuntimeExecution::Completed(Err(RuntimeTurnError {
                                        message: public_pi_error(error),
                                        fatal: true,
                                    }));
                                }
                            };
                            if let PiRuntimeEvent::TextDelta(delta) = &event {
                                text.push_str(delta);
                            }
                            if let PiRuntimeEvent::MessageEnd(message) = &event {
                                if let Some(reason) = message.get("stopReason").and_then(Value::as_str) {
                                    stop_reason = reason.to_string();
                                }
                                if stop_reason == "error" {
                                    let detail = message
                                        .get("errorMessage")
                                        .and_then(Value::as_str)
                                        .filter(|value| !value.trim().is_empty())
                                        .unwrap_or("Pi 返回了运行错误");
                                    return RuntimeExecution::Completed(Err(RuntimeTurnError {
                                        message: format!(
                                            "Pi 请求失败：{}",
                                            sanitize_public_error_detail(detail)
                                        ),
                                        fatal: false,
                                    }));
                                }
                            }
                            if let PiRuntimeEvent::TransportError(message) = &event {
                                return RuntimeExecution::Completed(Err(RuntimeTurnError {
                                    message: sanitize_public_error_detail(message),
                                    fatal: true,
                                }));
                            }
                            let mapped = mapper.map_event(event);
                            if let Some(interaction) = mapped.extension_ui {
                                if pending_extension_ui.replace(interaction).is_some() {
                                    return RuntimeExecution::Completed(Err(RuntimeTurnError {
                                        message: "Pi 同时发出了多个 Extension UI 请求".to_string(),
                                        fatal: true,
                                    }));
                                }
                            }
                            for event in mapped.events {
                                state.push_event(&run_id, event);
                            }
                            if mapped.settled {
                                let usage = client
                                    .get_session_stats()
                                    .await
                                    .map(|stats| pi_usage_snapshot(&stats))
                                    .unwrap_or_default();
                                return RuntimeExecution::Completed(Ok(RuntimeTurnOutcome {
                                    session_id: session_id.clone(),
                                    text,
                                    stop_reason,
                                    usage,
                                }));
                            }
                        }
                        command = control.recv(), if !control.is_closed() => {
                            let Some(command) = command else {
                                continue;
                            };
                            if let Err(error) = handle_pi_extension_ui_control(
                                client,
                                &mut pending_extension_ui,
                                command,
                            ).await {
                                return RuntimeExecution::Completed(Err(RuntimeTurnError {
                                    message: public_pi_error(error),
                                    fatal: true,
                                }));
                            }
                        }
                        _ = wait_for_cancel(&mut cancel) => {
                            if let Err(error) = cancel_pi_extension_ui_request(
                                client,
                                &mut pending_extension_ui,
                            ).await {
                                return RuntimeExecution::Completed(Err(RuntimeTurnError {
                                    message: public_pi_error(error),
                                    fatal: true,
                                }));
                            }
                            if let Err(error) = client.abort().await {
                                return RuntimeExecution::Completed(Err(RuntimeTurnError {
                                    message: public_pi_error(error),
                                    fatal: true,
                                }));
                            }
                            let settled = tokio::time::timeout(Duration::from_secs(5), async {
                                loop {
                                    match client.next_event().await.map_err(public_pi_error)? {
                                        PiRuntimeEvent::AgentSettled => return Ok::<(), String>(()),
                                        PiRuntimeEvent::TransportError(message) => {
                                            return Err(sanitize_public_error_detail(&message));
                                        }
                                        _ => {}
                                    }
                                }
                            }).await;
                            match settled {
                                Ok(Ok(())) => {
                                    return RuntimeExecution::Completed(Ok(RuntimeTurnOutcome {
                                        session_id: session_id.clone(),
                                        text,
                                        stop_reason: "cancelled".to_string(),
                                        usage: AgentUsageSnapshot::default(),
                                    }));
                                }
                                Ok(Err(error)) => {
                                    return RuntimeExecution::Completed(Err(RuntimeTurnError {
                                        message: error,
                                        fatal: true,
                                    }));
                                }
                                Err(_) => {
                                    return RuntimeExecution::Completed(Err(RuntimeTurnError {
                                        message: "Pi RPC abort 后未及时进入 settled 状态".to_string(),
                                        fatal: true,
                                    }));
                                }
                            }
                        }
                        _ = wait_for_shutdown(shutdown) => return RuntimeExecution::Closed,
                    }
                }
            }
            _ => RuntimeExecution::Completed(Err(RuntimeTurnError {
                message: "Agent runtime 与输入协议不匹配".to_string(),
                fatal: true,
            })),
        }
    }

    async fn compact(
        &mut self,
        state: &AgentRunState,
        compact: AgentRuntimeCompact,
        shutdown: &mut watch::Receiver<bool>,
    ) -> RuntimeExecution {
        let AgentRuntimeCompact {
            run_id,
            operation_id,
        } = compact;
        let Self::Codex {
            client,
            session_id,
            compact_capability,
        } = self
        else {
            return RuntimeExecution::Completed(Err(RuntimeTurnError {
                message: "当前 Agent runtime 不支持原生上下文压缩".to_string(),
                fatal: true,
            }));
        };
        let provider_thread_id = session_id.clone();
        if compact_capability.state != AgentCompactCapabilityState::Supported {
            let message = compact_capability
                .message
                .clone()
                .unwrap_or_else(|| "无法确认 Codex 上下文压缩能力".to_string());
            state.push_event(
                &run_id,
                AgentRunEvent::ContextCompaction {
                    run_id: run_id.clone(),
                    operation_id: Some(operation_id),
                    source: AgentCompactionSource::Manual,
                    status: AgentCompactionStatus::Failed,
                    provider_thread_id,
                    provider_turn_id: None,
                    provider_item_id: None,
                    error: Some(message.clone()),
                    at_ms: Utc::now().timestamp_millis(),
                },
            );
            return RuntimeExecution::Completed(Err(RuntimeTurnError {
                message,
                fatal: false,
            }));
        }
        let event_state = state.clone();
        let event_run_id = run_id.clone();
        let event_operation_id = operation_id.clone();
        let result = tokio::select! {
            result = client.start_compaction(session_id, |event| {
                let event = match event {
                    CodexCompactionEvent::Started {
                        provider_turn_id,
                        provider_item_id,
                    } => AgentRunEvent::ContextCompaction {
                        run_id: event_run_id.clone(),
                        operation_id: Some(event_operation_id.clone()),
                        source: AgentCompactionSource::Manual,
                        status: AgentCompactionStatus::Running,
                        provider_thread_id: provider_thread_id.clone(),
                        provider_turn_id,
                        provider_item_id,
                        error: None,
                        at_ms: Utc::now().timestamp_millis(),
                    },
                    CodexCompactionEvent::Completed {
                        provider_turn_id,
                        provider_item_id,
                    } => AgentRunEvent::ContextCompaction {
                        run_id: event_run_id.clone(),
                        operation_id: Some(event_operation_id.clone()),
                        source: AgentCompactionSource::Manual,
                        status: AgentCompactionStatus::Completed,
                        provider_thread_id: provider_thread_id.clone(),
                        provider_turn_id: Some(provider_turn_id),
                        provider_item_id,
                        error: None,
                        at_ms: Utc::now().timestamp_millis(),
                    },
                };
                event_state.push_event(&event_run_id, event);
            }) => Some(result),
            _ = wait_for_shutdown(shutdown) => None,
        };

        match result {
            Some(Ok(_)) => RuntimeExecution::Completed(Ok(RuntimeTurnOutcome {
                session_id: session_id.clone(),
                text: String::new(),
                stop_reason: "compact".to_string(),
                usage: AgentUsageSnapshot::default(),
            })),
            Some(Err(error)) => {
                let fatal = codex_error_is_fatal(&error) || !client.is_running();
                let message = public_codex_error(error);
                state.push_event(
                    &run_id,
                    AgentRunEvent::ContextCompaction {
                        run_id: run_id.clone(),
                        operation_id: Some(operation_id),
                        source: AgentCompactionSource::Manual,
                        status: AgentCompactionStatus::Failed,
                        provider_thread_id: session_id.clone(),
                        provider_turn_id: None,
                        provider_item_id: None,
                        error: Some(message.clone()),
                        at_ms: Utc::now().timestamp_millis(),
                    },
                );
                RuntimeExecution::Completed(Err(RuntimeTurnError { message, fatal }))
            }
            None => {
                state.push_event(
                    &run_id,
                    AgentRunEvent::ContextCompaction {
                        run_id: run_id.clone(),
                        operation_id: Some(operation_id),
                        source: AgentCompactionSource::Manual,
                        status: AgentCompactionStatus::Failed,
                        provider_thread_id: session_id.clone(),
                        provider_turn_id: None,
                        provider_item_id: None,
                        error: Some("Agent 热会话已关闭".to_string()),
                        at_ms: Utc::now().timestamp_millis(),
                    },
                );
                RuntimeExecution::Closed
            }
        }
    }
}

async fn start_live_agent_runtime(
    config: &AgentRuntimeConfig,
    requested_session_id: Option<&str>,
) -> Result<(LiveAgentRuntime, bool), String> {
    match config.driver {
        AgentDriverKind::Acp => {
            let mut client = spawn_acp_client(
                &config.command,
                &config.provider_id,
                config.permission_mode,
                &config.working_directory,
                &config.environment,
            )
            .await
            .map_err(public_acp_error)?;
            let (session, resumed) = prepare_acp_session(
                &mut client,
                &config.provider_id,
                &config.working_directory,
                requested_session_id,
                config.model.as_deref(),
                &config.environment,
            )
            .await?;
            Ok((
                LiveAgentRuntime::Acp {
                    client,
                    session_id: session.session_id,
                },
                resumed,
            ))
        }
        AgentDriverKind::CodexAppServer => {
            let mut client = CodexStdioClient::spawn_with_options(
                &config.command,
                &config.working_directory,
                &config.codex_config_args,
                &config.environment,
            )
            .await
            .map_err(public_codex_error)?;
            client
                .initialize(env!("CARGO_PKG_VERSION"))
                .await
                .map_err(public_codex_error)?;
            let compact_capability =
                summarize_codex_compact_capability(client.probe_compact_capability().await);
            let session_id = client
                .start_or_resume_thread(requested_session_id, &config.working_directory)
                .await
                .map_err(public_codex_error)?;
            Ok((
                LiveAgentRuntime::Codex {
                    client,
                    session_id,
                    compact_capability,
                },
                requested_session_id.is_some(),
            ))
        }
        AgentDriverKind::PiRpc => {
            let mut environment = config.environment.clone();
            environment.insert(
                "CODEM_PI_PERMISSION_MODE".to_string(),
                config.permission_mode.to_string(),
            );
            let bridge = write_pi_bridge_extension(&environment)?;
            let arguments = pi_rpc_arguments(requested_session_id, &bridge);
            let client = PiStdioClient::spawn_with_options(
                &config.command,
                &config.working_directory,
                &environment,
                &arguments,
            )
            .await
            .map_err(public_pi_error)?;
            let state = match client.get_state().await {
                Ok(state) if !state.session_id.trim().is_empty() => state,
                Ok(_) => {
                    client.shutdown().await;
                    return Err("Pi RPC 返回了空 sessionId".to_string());
                }
                Err(error) => {
                    client.shutdown().await;
                    return Err(public_pi_error(error));
                }
            };
            if let Some(model) = config.model.as_deref() {
                let Some((provider, model_id)) = pi_model_parts(model) else {
                    client.shutdown().await;
                    return Err("Pi 模型必须使用 provider/model 格式".to_string());
                };
                if let Err(error) = client.set_model(provider, model_id).await {
                    client.shutdown().await;
                    return Err(public_pi_error(error));
                }
            }
            if let Some(level) = config.reasoning_effort.as_deref() {
                if let Err(error) = client.set_thinking_level(level).await {
                    client.shutdown().await;
                    return Err(public_pi_error(error));
                }
            }
            Ok((
                LiveAgentRuntime::Pi {
                    client,
                    session_id: state.session_id,
                },
                requested_session_id.is_some(),
            ))
        }
    }
}

fn write_pi_bridge_extension(environment: &BTreeMap<String, String>) -> Result<PathBuf, String> {
    const CODEM_PI_BRIDGE: &str = include_str!("../resources/pi/codem-bridge.js");
    let runtime_dir = environment
        .get("PI_CODING_AGENT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            env::temp_dir()
                .join("codem")
                .join("pi-runtime")
                .join(std::process::id().to_string())
        });
    let extensions_dir = runtime_dir.join("extensions");
    fs::create_dir_all(&extensions_dir)
        .map_err(|error| format!("创建 Pi Extension 目录失败: {error}"))?;
    let bridge = extensions_dir.join("codem-bridge.js");
    fs::write(&bridge, CODEM_PI_BRIDGE)
        .map_err(|error| format!("写入 CodeM Pi bridge 失败: {error}"))?;
    Ok(bridge)
}

fn pi_rpc_arguments(requested_session_id: Option<&str>, bridge: &Path) -> Vec<String> {
    let mut arguments = vec![
        "--mode".to_string(),
        "rpc".to_string(),
        "-e".to_string(),
        bridge.to_string_lossy().to_string(),
    ];
    if let Some(session_id) = requested_session_id {
        arguments.push("--session".to_string());
        arguments.push(session_id.to_string());
    }
    arguments
}

fn pi_model_parts(model: &str) -> Option<(&str, &str)> {
    let (provider, model_id) = model.split_once('/')?;
    (!provider.is_empty() && !model_id.is_empty()).then_some((provider, model_id))
}

fn pi_usage_snapshot(stats: &Value) -> AgentUsageSnapshot {
    let tokens = stats.get("tokens").unwrap_or(&Value::Null);
    AgentUsageSnapshot {
        input_tokens: tokens.get("input").and_then(Value::as_u64),
        output_tokens: tokens.get("output").and_then(Value::as_u64),
        cache_creation_input_tokens: tokens.get("cacheWrite").and_then(Value::as_u64),
        cache_read_input_tokens: tokens.get("cacheRead").and_then(Value::as_u64),
        model_context_window: stats.get("contextTokens").and_then(Value::as_u64),
        total_cost_usd: stats.get("cost").and_then(Value::as_f64),
    }
}

fn pi_model_catalog(
    state: &PiState,
    models: Vec<PiModel>,
    thinking_levels: Vec<String>,
) -> AgentModelCatalog {
    let default_model_id = state
        .model
        .as_ref()
        .map(|model| format!("{}/{}", model.provider, model.id));
    let efforts = thinking_levels
        .iter()
        .map(|level| AgentReasoningEffortSummary {
            id: level.clone(),
            description: None,
        })
        .collect::<Vec<_>>();
    AgentModelCatalog {
        provider_id: PI_AGENT_PROVIDER_ID.to_string(),
        default_model_id: default_model_id.clone(),
        models: models
            .into_iter()
            .map(|model| {
                let id = format!("{}/{}", model.provider, model.id);
                AgentModelSummary {
                    is_default: default_model_id.as_deref() == Some(id.as_str()),
                    id,
                    label: model.name,
                    description: Some(model.provider),
                    context_window_tokens: model.context_window,
                    default_reasoning_effort: Some(state.thinking_level.clone()),
                    supported_reasoning_efforts: efforts.clone(),
                }
            })
            .collect(),
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

fn runtime_status_message(
    provider_id: &str,
    driver: AgentDriverKind,
    reused: bool,
    resumed: bool,
) -> String {
    match (provider_id, driver, reused, resumed) {
        (GROK_BUILD_PROVIDER_ID, AgentDriverKind::Acp, true, _) => {
            "已复用 Grok Build 热会话".to_string()
        }
        (GROK_BUILD_PROVIDER_ID, AgentDriverKind::Acp, false, true) => {
            "已恢复 Grok Build ACP 会话".to_string()
        }
        (GROK_BUILD_PROVIDER_ID, AgentDriverKind::Acp, false, false) => {
            "已创建 Grok Build ACP 会话".to_string()
        }
        (OPENCODE_PROVIDER_ID, AgentDriverKind::Acp, true, _) => {
            "已复用 OpenCode 热会话".to_string()
        }
        (OPENCODE_PROVIDER_ID, AgentDriverKind::Acp, false, true) => {
            "已恢复 OpenCode ACP 会话".to_string()
        }
        (OPENCODE_PROVIDER_ID, AgentDriverKind::Acp, false, false) => {
            "已创建 OpenCode ACP 会话".to_string()
        }
        (_, AgentDriverKind::CodexAppServer, true, _) => "已复用 OpenAI Codex 热会话".to_string(),
        (_, AgentDriverKind::CodexAppServer, false, true) => "已恢复 OpenAI Codex 会话".to_string(),
        (_, AgentDriverKind::CodexAppServer, false, false) => {
            "已创建 OpenAI Codex 会话".to_string()
        }
        (PI_AGENT_PROVIDER_ID, AgentDriverKind::PiRpc, true, _) => "已复用 Pi 热会话".to_string(),
        (PI_AGENT_PROVIDER_ID, AgentDriverKind::PiRpc, false, true) => "已恢复 Pi 会话".to_string(),
        (PI_AGENT_PROVIDER_ID, AgentDriverKind::PiRpc, false, false) => {
            "已创建 Pi 会话".to_string()
        }
        (_, AgentDriverKind::PiRpc, true, _) => "已复用 Pi RPC 热会话".to_string(),
        (_, AgentDriverKind::PiRpc, false, true) => "已恢复 Pi RPC 会话".to_string(),
        (_, AgentDriverKind::PiRpc, false, false) => "已创建 Pi RPC 会话".to_string(),
        (_, AgentDriverKind::Acp, true, _) => "已复用 ACP 热会话".to_string(),
        (_, AgentDriverKind::Acp, false, true) => "已恢复 ACP 会话".to_string(),
        (_, AgentDriverKind::Acp, false, false) => "已创建 ACP 会话".to_string(),
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

async fn spawn_acp_client(
    command: &str,
    provider_id: &str,
    permission_mode: &'static str,
    working_directory: &Path,
    environment: &BTreeMap<String, String>,
) -> Result<AcpStdioClient, AcpError> {
    let arguments = acp_arguments(provider_id, permission_mode)?;
    AcpStdioClient::spawn_with_env(command, &arguments, working_directory, environment).await
}

async fn prepare_acp_session(
    client: &mut AcpStdioClient,
    provider_id: &str,
    working_directory: &Path,
    requested_session_id: Option<&str>,
    model: Option<&str>,
    environment: &BTreeMap<String, String>,
) -> Result<(AcpSessionSummary, bool), String> {
    let initialize = client
        .initialize(env!("CARGO_PKG_VERSION"))
        .await
        .map_err(public_acp_error)?;
    if provider_id == GROK_BUILD_PROVIDER_ID && !grok_uses_channel_credentials(environment) {
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
    }
    let (session, resumed) = if let Some(session_id) = requested_session_id {
        if initialize.load_session {
            match client.load_session(session_id, working_directory).await {
                Ok(session) => (session, true),
                // A provider can advertise loadSession while keeping sessions
                // in channel-local storage. Start a fresh session if that old
                // session is unavailable, so a channel switch stays usable.
                Err(_) => (
                    client
                        .new_session(working_directory)
                        .await
                        .map_err(public_acp_error)?,
                    false,
                ),
            }
        } else {
            (
                client
                    .new_session(working_directory)
                    .await
                    .map_err(public_acp_error)?,
                false,
            )
        }
    } else {
        (
            client
                .new_session(working_directory)
                .await
                .map_err(public_acp_error)?,
            false,
        )
    };
    if let Some(model) = model {
        if should_set_acp_model(
            Some(model),
            session.current_model_id.as_deref(),
            initialize.current_model_id.as_deref(),
        ) {
            match provider_id {
                GROK_BUILD_PROVIDER_ID => client.set_model(&session.session_id, model).await,
                OPENCODE_PROVIDER_ID => {
                    client
                        .set_config_option(&session.session_id, "model", model)
                        .await
                }
                _ => unreachable!("ACP profile validated before session initialization"),
            }
            .map_err(public_acp_error)?;
        }
    }
    Ok((session, resumed))
}

fn grok_uses_channel_credentials(environment: &BTreeMap<String, String>) -> bool {
    environment
        .get("CODEM_AGENT_CHANNEL_API_KEY")
        .is_some_and(|value| !value.trim().is_empty())
}

fn should_retry_grok_channel_prompt(
    provider_id: &str,
    environment: &BTreeMap<String, String>,
    mapper: &AcpEventMapper,
    error: &AcpError,
) -> bool {
    provider_id == GROK_BUILD_PROVIDER_ID
        && grok_uses_channel_credentials(environment)
        && mapper.can_retry_failed_prompt()
        && matches!(error, AcpError::Rpc { code: -32603, .. })
}

fn agent_provider_display_name(provider_id: &str) -> &'static str {
    match provider_id {
        GROK_BUILD_PROVIDER_ID => "Grok Build",
        OPENCODE_PROVIDER_ID => "OpenCode",
        OPENAI_CODEX_PROVIDER_ID => "OpenAI Codex",
        _ => "Agent Provider",
    }
}

async fn execute_acp_run(task: AcpRunTask) {
    let AcpRunTask {
        state,
        run_id,
        command,
        provider_id,
        working_directory,
        input,
        requested_session_id,
        permission_mode,
        model,
        environment,
        cancel,
        mut control,
    } = task;
    let mut client = match spawn_acp_client(
        &command,
        &provider_id,
        permission_mode,
        &working_directory,
        &environment,
    )
    .await
    {
        Ok(client) => client,
        Err(error) => {
            state.push_terminal(
                &run_id,
                AgentRunEvent::Error {
                    run_id: run_id.clone(),
                    message: public_acp_error(error),
                },
            );
            return;
        }
    };

    let mut mapper = AcpEventMapper::new(run_id.clone());
    let execution = async {
        let (session, resumed) = prepare_acp_session(
            &mut client,
            &provider_id,
            &working_directory,
            requested_session_id.as_deref(),
            model.as_deref(),
            &environment,
        )
        .await?;
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
                message: runtime_status_message(&provider_id, AgentDriverKind::Acp, false, resumed),
            },
        );
        state.push_event(&run_id, agent_phase_event(&run_id, "thinking", "思考中"));

        let outcome = if *cancel.borrow() {
            cancelled_before_prompt_outcome()
        } else {
            let event_state = state.clone();
            let mut outcome = client
                .prompt_stream_with_permission_policy(
                    &session.session_id,
                    &input,
                    cancel.clone(),
                    &mut control,
                    acp_permission_policy(&provider_id, permission_mode),
                    |event| {
                        for event in mapper.map_event(event) {
                            event_state.push_event(&run_id, event);
                        }
                    },
                )
                .await;
            if outcome.as_ref().is_err_and(|error| {
                should_retry_grok_channel_prompt(&provider_id, &environment, &mapper, error)
            }) {
                state.push_event(
                    &run_id,
                    AgentRunEvent::Status {
                        run_id: run_id.clone(),
                        message: "第三方接口返回了临时异常，正在重试".to_string(),
                    },
                );
                outcome = client
                    .prompt_stream_with_permission_policy(
                        &session.session_id,
                        &input,
                        cancel,
                        &mut control,
                        acp_permission_policy(&provider_id, permission_mode),
                        |event| {
                            for event in mapper.map_event(event) {
                                event_state.push_event(&run_id, event);
                            }
                        },
                    )
                    .await;
            }
            outcome.map_err(public_acp_error)?
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
        environment,
        codex_config_args,
        cancel,
        mut control,
    } = task;
    let mut client = match CodexStdioClient::spawn_with_options(
        &command,
        &working_directory,
        &codex_config_args,
        &environment,
    )
    .await
    {
        Ok(client) => client,
        Err(error) => {
            state.push_terminal(
                &run_id,
                AgentRunEvent::Error {
                    run_id: run_id.clone(),
                    message: public_codex_error(error),
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

async fn agent_run_guide(
    State(state): State<AgentRunState>,
    AxumPath(run_id): AxumPath<String>,
    Json(payload): Json<GuideAgentRunRequest>,
) -> Response {
    let prompt = match normalize_guide_prompt(payload.prompt) {
        Ok(prompt) => prompt,
        Err(error) => return error.into_response(),
    };
    let (provider_id, control) = match state.guide_control_sender(&run_id) {
        Ok(target) => target,
        Err(error) => return error.into_response(),
    };
    if provider_id != OPENAI_CODEX_PROVIDER_ID {
        return guide_ack_response(GuideAckOutcome::Rejected(
            "当前 Agent 不支持运行中引导".to_string(),
        ));
    }
    let (acknowledgement, receiver) = oneshot::channel();
    if control
        .send(AgentControlCommand::Guide {
            text: prompt,
            acknowledgement,
        })
        .is_err()
    {
        return guide_ack_response(GuideAckOutcome::Uncertain(
            "Agent 运行在确认引导请求前结束".to_string(),
        ));
    }
    guide_ack_response(await_guide_ack(receiver, CONTROL_ACK_TIMEOUT).await)
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

fn normalize_guide_prompt(prompt: String) -> AgentApiResult<String> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err(AgentApiError::bad_request("prompt 不能为空"));
    }
    if prompt.len() > MAX_PROMPT_BYTES {
        return Err(AgentApiError::bad_request("prompt 过长"));
    }
    Ok(prompt.to_string())
}

async fn await_guide_ack(
    receiver: oneshot::Receiver<Result<(), String>>,
    timeout_duration: Duration,
) -> GuideAckOutcome {
    match tokio::time::timeout(timeout_duration, receiver).await {
        Ok(Ok(Ok(()))) => GuideAckOutcome::Submitted,
        Ok(Ok(Err(message))) => GuideAckOutcome::Rejected(message),
        Ok(Err(_)) => GuideAckOutcome::Uncertain("Agent 运行在确认引导请求前结束".to_string()),
        Err(_) => GuideAckOutcome::Uncertain("Agent 引导请求确认超时".to_string()),
    }
}

fn guide_ack_response(outcome: GuideAckOutcome) -> Response {
    match outcome {
        GuideAckOutcome::Submitted => {
            (StatusCode::OK, Json(json!({ "submitted": true }))).into_response()
        }
        GuideAckOutcome::Rejected(error) => (
            StatusCode::CONFLICT,
            Json(json!({
                "submitted": false,
                "uncertain": false,
                "error": error,
            })),
        )
            .into_response(),
        GuideAckOutcome::Uncertain(error) => (
            StatusCode::GATEWAY_TIMEOUT,
            Json(json!({
                "submitted": false,
                "uncertain": true,
                "error": error,
            })),
        )
            .into_response(),
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
                            let AgentRuntimeCommand::Run(run) = error.0 else {
                                return Err(AgentApiError::internal("Agent 运行调度命令类型异常"));
                            };
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
                        AgentRuntimeCommand::Run(first_run),
                        commands,
                        shutdown,
                    ));
                    return Ok(());
                }
            }
        }
    }

    fn dispatch_compact(
        &self,
        thread_id: String,
        config: AgentRuntimeConfig,
        requested_session_id: String,
        compact: AgentRuntimeCompact,
    ) -> AgentApiResult<()> {
        if config.provider_id != OPENAI_CODEX_PROVIDER_ID
            || config.driver != AgentDriverKind::CodexAppServer
        {
            return Err(AgentApiError::bad_request(
                "只有 OpenAI Codex runtime 支持原生上下文压缩",
            ));
        }
        let run_id = compact.run_id.clone();
        let mut pending_compact = Some(compact);
        loop {
            let action = {
                let mut runtimes = self
                    .runtimes
                    .lock()
                    .map_err(|_| AgentApiError::internal("锁定 Agent 热会话失败"))?;
                if let Some(runtime) = runtimes.get_mut(&thread_id) {
                    if runtime.current_run_id.is_some()
                        || matches!(
                            runtime.phase,
                            AgentRuntimePhase::Starting | AgentRuntimePhase::Running
                        )
                    {
                        return Err(AgentApiError::conflict("当前聊天已有 Agent 操作正在运行"));
                    }
                    if runtime.config != config {
                        return Err(AgentApiError::conflict(
                            "Codex 热会话配置已变化，请先恢复匹配的会话再压缩",
                        ));
                    }
                    if runtime.session_id.as_deref() != Some(requested_session_id.as_str()) {
                        return Err(AgentApiError::conflict(
                            "Codex 热会话 sessionId 与压缩请求不一致",
                        ));
                    }
                    if runtime_can_reuse(runtime, &config, Some(&requested_session_id)) {
                        let command = runtime
                            .command
                            .clone()
                            .ok_or_else(|| AgentApiError::internal("Agent 热会话命令通道已关闭"))?;
                        runtime.phase = AgentRuntimePhase::Running;
                        runtime.current_run_id = Some(run_id.clone());
                        RuntimeDispatchAction::Reuse(command)
                    } else if matches!(
                        runtime.phase,
                        AgentRuntimePhase::Closed | AgentRuntimePhase::Failed
                    ) {
                        create_runtime_record(
                            &mut runtimes,
                            &thread_id,
                            &config,
                            Some(requested_session_id.clone()),
                            &run_id,
                        )
                    } else {
                        return Err(AgentApiError::conflict(
                            "Codex 热会话当前不可执行上下文压缩",
                        ));
                    }
                } else {
                    create_runtime_record(
                        &mut runtimes,
                        &thread_id,
                        &config,
                        Some(requested_session_id.clone()),
                        &run_id,
                    )
                }
            };

            match action {
                RuntimeDispatchAction::Reuse(command) => {
                    let compact = pending_compact
                        .take()
                        .ok_or_else(|| AgentApiError::internal("Codex 压缩调度状态异常"))?;
                    match command.send(AgentRuntimeCommand::Compact(compact)) {
                        Ok(()) => return Ok(()),
                        Err(error) => {
                            let AgentRuntimeCommand::Compact(compact) = error.0 else {
                                return Err(AgentApiError::internal("Codex 压缩调度命令类型异常"));
                            };
                            pending_compact = Some(compact);
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
                    let compact = pending_compact
                        .take()
                        .ok_or_else(|| AgentApiError::internal("Codex 压缩调度状态异常"))?;
                    let actor_state = self.clone();
                    tokio::spawn(run_agent_runtime_actor(
                        actor_state,
                        thread_id,
                        runtime_id,
                        config,
                        Some(requested_session_id),
                        AgentRuntimeCommand::Compact(compact),
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

    fn guide_control_sender(
        &self,
        run_id: &str,
    ) -> AgentApiResult<(String, mpsc::UnboundedSender<AgentControlCommand>)> {
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
        Ok((record.provider_id.clone(), record.control.clone()))
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
    observed_activity: bool,
}

struct CodexEventMapper {
    run_id: String,
    next_block_index: u64,
    tools: HashMap<String, ToolMappingState>,
    current_phase: Option<&'static str>,
}

async fn wait_for_cancel(cancel: &mut watch::Receiver<bool>) {
    if *cancel.borrow() {
        return;
    }
    while cancel.changed().await.is_ok() {
        if *cancel.borrow() {
            return;
        }
    }
    std::future::pending::<()>().await;
}

struct PiMappedEvent {
    events: Vec<AgentRunEvent>,
    settled: bool,
    extension_ui: Option<PiExtensionUiInteraction>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PiExtensionUiMethod {
    Confirm,
    Input,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PiExtensionUiInteraction {
    request_id: String,
    method: PiExtensionUiMethod,
}

struct PiEventMapper {
    run_id: String,
    next_block_index: u64,
    tools: HashMap<String, ToolMappingState>,
}

impl PiEventMapper {
    fn new(run_id: String) -> Self {
        Self {
            run_id,
            next_block_index: 0,
            tools: HashMap::new(),
        }
    }

    fn map_event(&mut self, event: PiRuntimeEvent) -> PiMappedEvent {
        let mut events = Vec::new();
        let mut extension_ui = None;
        let settled = match event {
            PiRuntimeEvent::TextDelta(text) => {
                events.push(AgentRunEvent::Delta {
                    run_id: self.run_id.clone(),
                    text,
                });
                false
            }
            PiRuntimeEvent::ThinkingDelta(text) => {
                events.push(AgentRunEvent::ThinkingDelta {
                    run_id: self.run_id.clone(),
                    text,
                });
                false
            }
            PiRuntimeEvent::ToolStart {
                tool_call_id,
                tool_name,
                args,
            } => {
                if !self.tools.contains_key(&tool_call_id) {
                    let block_index = self.next_block_index;
                    self.next_block_index += 1;
                    self.tools.insert(
                        tool_call_id.clone(),
                        ToolMappingState {
                            block_index,
                            stopped: false,
                        },
                    );
                    events.push(AgentRunEvent::ToolStart {
                        run_id: self.run_id.clone(),
                        block_index,
                        tool_use_id: tool_call_id,
                        name: tool_name,
                        input: Some(args),
                    });
                }
                false
            }
            PiRuntimeEvent::ToolEnd {
                tool_call_id,
                result,
                is_error,
                ..
            } => {
                let block_index = if let Some(tool) = self.tools.get_mut(&tool_call_id) {
                    if tool.stopped {
                        return PiMappedEvent {
                            events,
                            settled: false,
                            extension_ui,
                        };
                    }
                    tool.stopped = true;
                    tool.block_index
                } else {
                    let block_index = self.next_block_index;
                    self.next_block_index += 1;
                    self.tools.insert(
                        tool_call_id.clone(),
                        ToolMappingState {
                            block_index,
                            stopped: true,
                        },
                    );
                    events.push(AgentRunEvent::ToolStart {
                        run_id: self.run_id.clone(),
                        block_index,
                        tool_use_id: tool_call_id.clone(),
                        name: "Pi 工具".to_string(),
                        input: None,
                    });
                    block_index
                };
                events.push(AgentRunEvent::ToolResult {
                    run_id: self.run_id.clone(),
                    tool_use_id: tool_call_id.clone(),
                    content: pi_tool_result_text(&result),
                    is_error,
                });
                events.push(AgentRunEvent::ToolStop {
                    run_id: self.run_id.clone(),
                    block_index,
                    tool_use_id: tool_call_id,
                });
                false
            }
            PiRuntimeEvent::AgentEnd { will_retry: true } => {
                events.push(AgentRunEvent::Status {
                    run_id: self.run_id.clone(),
                    message: "Pi 正在重试本轮请求".to_string(),
                });
                false
            }
            PiRuntimeEvent::ExtensionUiRequest(request) => {
                if let Some((event, interaction)) =
                    map_pi_extension_ui_request(&self.run_id, &request)
                {
                    events.push(event);
                    extension_ui = Some(interaction);
                }
                false
            }
            PiRuntimeEvent::AgentSettled => true,
            _ => false,
        };
        PiMappedEvent {
            events,
            settled,
            extension_ui,
        }
    }
}

fn map_pi_extension_ui_request(
    run_id: &str,
    request: &Value,
) -> Option<(AgentRunEvent, PiExtensionUiInteraction)> {
    let request_id = request.get("id")?.as_str()?.trim();
    if request_id.is_empty() {
        return None;
    }
    let title = request
        .get("title")
        .and_then(Value::as_str)
        .map(bounded_pi_ui_text);
    match request.get("method").and_then(Value::as_str)? {
        "confirm" => {
            let interaction = PiExtensionUiInteraction {
                request_id: request_id.to_string(),
                method: PiExtensionUiMethod::Confirm,
            };
            Some((
                AgentRunEvent::ApprovalRequest {
                    run_id: run_id.to_string(),
                    request: AgentApprovalRequest {
                        request_id: request_id.to_string(),
                        kind: "permission".to_string(),
                        title: title.unwrap_or_else(|| "Pi 权限确认".to_string()),
                        description: request
                            .get("message")
                            .and_then(Value::as_str)
                            .map(bounded_pi_ui_text),
                        danger: "medium".to_string(),
                        options: vec![
                            AgentApprovalOption {
                                id: "approve".to_string(),
                                label: "允许".to_string(),
                                kind: "allow_once".to_string(),
                            },
                            AgentApprovalOption {
                                id: "reject".to_string(),
                                label: "拒绝".to_string(),
                                kind: "reject_once".to_string(),
                            },
                        ],
                    },
                },
                interaction,
            ))
        }
        "input" => {
            let placeholder = request
                .get("placeholder")
                .and_then(Value::as_str)
                .map(bounded_pi_ui_text)
                .unwrap_or_else(|| "请输入内容".to_string());
            let interaction = PiExtensionUiInteraction {
                request_id: request_id.to_string(),
                method: PiExtensionUiMethod::Input,
            };
            Some((
                AgentRunEvent::RequestUserInput {
                    run_id: run_id.to_string(),
                    request: AgentUserInputRequest {
                        request_id: request_id.to_string(),
                        title,
                        description: placeholder.clone(),
                        questions: vec![AgentUserInputQuestion {
                            id: "value".to_string(),
                            header: None,
                            question: placeholder,
                            input_type: "text".to_string(),
                            options: Vec::<AgentUserInputOption>::new(),
                            multi_select: false,
                            required: true,
                            secret: false,
                        }],
                    },
                },
                interaction,
            ))
        }
        _ => None,
    }
}

fn bounded_pi_ui_text(value: &str) -> String {
    const MAX_PI_UI_TEXT_CHARS: usize = 2_048;
    value.chars().take(MAX_PI_UI_TEXT_CHARS).collect()
}

async fn handle_pi_extension_ui_control(
    client: &mut PiStdioClient,
    pending: &mut Option<PiExtensionUiInteraction>,
    command: AgentControlCommand,
) -> Result<(), PiRpcError> {
    let Some(interaction) = pending.as_ref() else {
        match command {
            AgentControlCommand::Guide {
                acknowledgement, ..
            } => {
                let _ = acknowledgement.send(Err("Pi Agent 不支持运行中引导".to_string()));
            }
            AgentControlCommand::Permission {
                acknowledgement, ..
            }
            | AgentControlCommand::UserInput {
                acknowledgement, ..
            } => {
                let _ = acknowledgement.send(Err("Pi Extension UI 请求不存在或已结束".to_string()));
            }
        }
        return Ok(());
    };
    match command {
        AgentControlCommand::Guide {
            acknowledgement, ..
        } => {
            let _ = acknowledgement.send(Err("Pi Agent 不支持运行中引导".to_string()));
            Ok(())
        }
        AgentControlCommand::Permission {
            request_id,
            decision,
            option_id,
            acknowledgement,
        } => {
            if request_id != interaction.request_id {
                let _ = acknowledgement.send(Err("权限请求 ID 与当前 Pi 请求不匹配".to_string()));
                return Ok(());
            }
            if interaction.method != PiExtensionUiMethod::Confirm {
                let _ = acknowledgement.send(Err("当前 Pi 请求正在等待用户输入".to_string()));
                return Ok(());
            }
            let expected_option = match decision {
                AgentPermissionDecision::Approve => "approve",
                AgentPermissionDecision::Reject => "reject",
            };
            if option_id
                .as_deref()
                .is_some_and(|option| option != expected_option)
            {
                let _ = acknowledgement.send(Err("Pi 权限选项与当前决定不匹配".to_string()));
                return Ok(());
            }
            let response = json!({
                "type": "extension_ui_response",
                "id": interaction.request_id,
                "confirmed": decision == AgentPermissionDecision::Approve,
            });
            match client.extension_ui_response(response).await {
                Ok(()) => {
                    *pending = None;
                    let _ = acknowledgement.send(Ok(()));
                    Ok(())
                }
                Err(error) => {
                    let _ = acknowledgement.send(Err(error.to_string()));
                    Err(error)
                }
            }
        }
        AgentControlCommand::UserInput {
            request_id,
            mut answers,
            acknowledgement,
        } => {
            if request_id != interaction.request_id {
                let _ = acknowledgement.send(Err("提问请求 ID 与当前 Pi 请求不匹配".to_string()));
                return Ok(());
            }
            if interaction.method != PiExtensionUiMethod::Input {
                let _ = acknowledgement.send(Err("当前 Pi 请求正在等待权限决定".to_string()));
                return Ok(());
            }
            let Some(value) = answers
                .remove("value")
                .and_then(|value| value.as_str().map(str::to_string))
            else {
                let _ = acknowledgement.send(Err("Pi 输入请求缺少字符串回答 value".to_string()));
                return Ok(());
            };
            if !answers.is_empty() {
                let _ = acknowledgement.send(Err("Pi 输入回答包含未知字段".to_string()));
                return Ok(());
            }
            let response = json!({
                "type": "extension_ui_response",
                "id": interaction.request_id,
                "value": value,
            });
            match client.extension_ui_response(response).await {
                Ok(()) => {
                    *pending = None;
                    let _ = acknowledgement.send(Ok(()));
                    Ok(())
                }
                Err(error) => {
                    let _ = acknowledgement.send(Err(error.to_string()));
                    Err(error)
                }
            }
        }
    }
}

async fn cancel_pi_extension_ui_request(
    client: &mut PiStdioClient,
    pending: &mut Option<PiExtensionUiInteraction>,
) -> Result<(), PiRpcError> {
    let Some(interaction) = pending.take() else {
        return Ok(());
    };
    client
        .extension_ui_response(json!({
            "type": "extension_ui_response",
            "id": interaction.request_id,
            "cancelled": true,
        }))
        .await
}

fn pi_tool_result_text(result: &Value) -> String {
    result
        .get("content")
        .and_then(Value::as_array)
        .and_then(|items| {
            items.iter().find_map(|item| {
                (item.get("type").and_then(Value::as_str) == Some("text"))
                    .then(|| item.get("text").and_then(Value::as_str))
                    .flatten()
            })
        })
        .map(str::to_string)
        .unwrap_or_else(|| result.to_string())
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
            CodexRuntimeEvent::CompactionStarted { .. }
            | CodexRuntimeEvent::CompactionCompleted { .. } => Vec::new(),
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
            observed_activity: false,
        }
    }

    fn map_event(&mut self, event: AcpRuntimeEvent) -> Vec<AgentRunEvent> {
        self.observed_activity = true;
        match event {
            AcpRuntimeEvent::TextDelta { text } => {
                self.current_phase = Some("computing");
                vec![AgentRunEvent::Delta {
                    run_id: self.run_id.clone(),
                    text,
                }]
            }
            AcpRuntimeEvent::ThoughtChunk { text } => {
                self.current_phase = Some("thinking");
                vec![AgentRunEvent::ThinkingDelta {
                    run_id: self.run_id.clone(),
                    text,
                }]
            }
            AcpRuntimeEvent::InteractionResolved { .. } => self.set_phase("thinking", "思考中"),
            AcpRuntimeEvent::Usage { usage } => vec![AgentRunEvent::Usage {
                run_id: self.run_id.clone(),
                usage,
                usage_source: "context",
            }],
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

    fn can_retry_failed_prompt(&self) -> bool {
        !self.observed_activity && self.tools.is_empty()
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

fn public_pi_error(error: PiRpcError) -> String {
    format!(
        "Pi RPC 请求失败：{}",
        sanitize_public_error_detail(&error.to_string())
    )
}

fn public_acp_error(error: AcpError) -> String {
    match error {
        AcpError::Rpc { code, message } => format!(
            "ACP Provider 请求失败（RPC {code}）：{}",
            sanitize_public_error_detail(&message),
        ),
        AcpError::Protocol(message) => format!(
            "ACP Provider 协议错误：{}",
            sanitize_public_error_detail(&message),
        ),
        AcpError::Timeout(operation) => {
            format!(
                "ACP Provider 响应超时：{}",
                sanitize_public_error_detail(operation)
            )
        }
        AcpError::Io(error) => format!(
            "ACP 子进程通信失败：{}",
            sanitize_public_error_detail(&error.to_string())
        ),
        AcpError::Json(error) => format!(
            "ACP Provider 返回了无效 JSON：{}",
            sanitize_public_error_detail(&error.to_string())
        ),
    }
}

fn sanitize_public_error_detail(message: &str) -> String {
    let sanitized = message
        .lines()
        .map(sanitize_public_error_line)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if sanitized.is_empty() {
        "未提供错误详情".to_string()
    } else {
        truncate_public_error_detail(&sanitized)
    }
}

fn sanitize_public_error_line(line: &str) -> String {
    let mut sanitized = Vec::new();
    let mut redact_next = false;
    for token in line.split_whitespace() {
        if redact_next {
            sanitized.push("<redacted>".to_string());
            redact_next = false;
            continue;
        }
        let normalized = token
            .trim_matches(|character: char| !character.is_ascii_alphanumeric() && character != '_')
            .to_ascii_lowercase();
        if matches!(
            normalized.as_str(),
            "authorization" | "bearer" | "token" | "access_token" | "api_key" | "apikey" | "secret"
        ) {
            sanitized.push(token.to_string());
            redact_next = true;
            continue;
        }
        let lower = token.to_ascii_lowercase();
        let sensitive_assignment = [
            "authorization=",
            "authorization:",
            "token=",
            "token:",
            "access_token=",
            "access_token:",
            "api_key=",
            "api_key:",
            "apikey=",
            "apikey:",
            "secret=",
            "secret:",
        ]
        .iter()
        .any(|prefix| lower.starts_with(prefix));
        let has_multiple_characters = token
            .chars()
            .next()
            .is_some_and(|first| token.chars().any(|character| character != first));
        let looks_like_secret = lower.starts_with("sk-")
            || (token.chars().count() >= 48
                && has_multiple_characters
                && token.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
                }));
        sanitized.push(if sensitive_assignment || looks_like_secret {
            "<redacted>".to_string()
        } else {
            token.to_string()
        });
    }
    sanitized.join(" ")
}

fn grok_acp_error_with_runtime_detail(
    config: &AgentRuntimeConfig,
    session_id: &str,
    turn_started_at: DateTime<Utc>,
    error: &AcpError,
) -> Option<String> {
    let AcpError::Rpc { code, message } = error else {
        return None;
    };
    if config.provider_id != GROK_BUILD_PROVIDER_ID
        || *code != -32603
        || !message.trim().eq_ignore_ascii_case("internal error")
    {
        return None;
    }
    let runtime_home = grok_runtime_home(config)?;
    let log_tail = read_bounded_file_tail(
        &runtime_home.join("logs").join("unified.jsonl"),
        MAX_GROK_LOG_TAIL_BYTES,
    )?;
    let detail = find_grok_runtime_error_detail(&log_tail, session_id, turn_started_at)?;
    Some(format!("ACP Provider 请求失败（RPC -32603）：{detail}"))
}

fn grok_runtime_home(config: &AgentRuntimeConfig) -> Option<PathBuf> {
    if let Some(runtime_home) = config
        .environment
        .get("GROK_HOME")
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(PathBuf::from(runtime_home));
    }
    if config.channel_id.is_some() {
        return None;
    }
    std::env::var_os("GROK_HOME")
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .map(|value| PathBuf::from(value).join(".grok").into_os_string())
        })
        .or_else(|| {
            std::env::var_os("HOME")
                .map(|value| PathBuf::from(value).join(".grok").into_os_string())
        })
        .map(PathBuf::from)
}

fn read_bounded_file_tail(path: &Path, max_bytes: u64) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    let start = length.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::with_capacity((length - start).min(max_bytes) as usize);
    file.read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    if start == 0 {
        return Some(text.into_owned());
    }
    let (_, complete_lines) = text.split_once('\n')?;
    Some(complete_lines.to_string())
}

fn find_grok_runtime_error_detail(
    log_tail: &str,
    session_id: &str,
    turn_started_at: DateTime<Utc>,
) -> Option<String> {
    let earliest = turn_started_at - chrono::Duration::seconds(3);
    let latest = Utc::now() + chrono::Duration::seconds(3);
    for line in log_tail.lines().rev() {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if entry.get("sid").and_then(Value::as_str) != Some(session_id) {
            continue;
        }
        let Some(message_type) = entry.get("msg").and_then(Value::as_str) else {
            continue;
        };
        if !matches!(
            message_type,
            "turn.terminal_failure" | "shell.turn.inference_failed"
        ) {
            continue;
        }
        let Some(timestamp) = entry
            .get("ts")
            .and_then(Value::as_str)
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.with_timezone(&Utc))
        else {
            continue;
        };
        if timestamp < earliest || timestamp > latest {
            continue;
        }
        let Some(message) = entry
            .get("ctx")
            .and_then(|value| value.get("message"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        if let Some(detail) = sanitize_grok_runtime_error_detail(message) {
            return Some(detail);
        }
    }
    None
}

fn sanitize_grok_runtime_error_detail(message: &str) -> Option<String> {
    let first_line = message
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    let detail = sanitize_public_error_line(first_line);
    (!detail.is_empty()).then(|| truncate_public_error_detail(&detail))
}

fn public_codex_error(error: CodexAppServerError) -> String {
    match error {
        CodexAppServerError::Io(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            format!(
                "Codex CLI 无法由 CodeM 启动：{}",
                sanitize_public_error_detail(&error.to_string())
            )
        }
        CodexAppServerError::Io(error) => format!(
            "Codex App Server 子进程通信失败：{}",
            sanitize_public_error_detail(&error.to_string())
        ),
        CodexAppServerError::Json(error) => format!(
            "Codex App Server 返回了无效 JSON：{}",
            sanitize_public_error_detail(&error.to_string())
        ),
        CodexAppServerError::Rpc { code, message } => format!(
            "Codex App Server 请求失败（RPC {code}）：{}",
            sanitize_public_error_detail(&message)
        ),
        CodexAppServerError::Execution(message) => {
            format!("Codex 执行失败：{}", sanitize_public_error_detail(&message))
        }
        CodexAppServerError::Protocol(message) => format!(
            "Codex App Server 协议错误：{}",
            sanitize_public_error_detail(&message)
        ),
        CodexAppServerError::Timeout(operation) => format!(
            "Codex App Server 响应超时：{}",
            sanitize_public_error_detail(operation)
        ),
    }
}

fn summarize_codex_compact_capability(
    result: Result<CodexCompactCapability, CodexAppServerError>,
) -> AgentCompactCapabilitySummary {
    match result {
        Ok(CodexCompactCapability::Supported) => AgentCompactCapabilitySummary {
            state: AgentCompactCapabilityState::Supported,
            message: None,
        },
        Ok(CodexCompactCapability::Unsupported) => AgentCompactCapabilitySummary {
            state: AgentCompactCapabilityState::Unsupported,
            message: Some("当前 Codex CLI 不支持原生会话压缩，请升级 Codex CLI。".to_string()),
        },
        Err(error) => AgentCompactCapabilitySummary {
            state: AgentCompactCapabilityState::Error,
            message: Some(public_codex_error(error)),
        },
    }
}

fn truncate_public_error_detail(message: &str) -> String {
    const MAX_DETAIL_CHARS: usize = 2_000;
    let detail = message.trim();
    if detail.chars().count() <= MAX_DETAIL_CHARS {
        return detail.to_string();
    }
    let mut truncated = detail.chars().take(MAX_DETAIL_CHARS).collect::<String>();
    truncated.push_str("…");
    truncated
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
    conversation_context: Option<&str>,
    automation_execution: bool,
) -> AgentApiResult<Vec<AcpPromptInput>> {
    if let Some(context) = conversation_context {
        if context.trim().is_empty() {
            return Ok(build_acp_prompt(
                blocks,
                working_directory,
                None,
                automation_execution,
            )?);
        }
        if context.len() > MAX_CONVERSATION_CONTEXT_BYTES {
            return Err(AgentApiError::bad_request(
                "conversationContext 超过 128 KiB 限制",
            ));
        }
    }

    let mut prompt = Vec::with_capacity(
        blocks.len()
            + usize::from(conversation_context.is_some())
            + usize::from(automation_execution),
    );
    if automation_execution {
        prompt.push(AcpPromptInput::Text {
            text: AUTOMATION_EXECUTION_CONTEXT.to_string(),
        });
    }
    if let Some(context) = conversation_context.filter(|value| !value.trim().is_empty()) {
        prompt.push(AcpPromptInput::Text {
            text: context.to_string(),
        });
    }
    prompt.extend(
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
            .collect::<AgentApiResult<Vec<_>>>()?,
    );
    Ok(prompt)
}

fn build_codex_input(
    blocks: &[NormalizedAgentInputBlock],
    working_directory: &Path,
    automation_execution: bool,
) -> AgentApiResult<Vec<CodexUserInput>> {
    let mut input = blocks
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
        .collect::<AgentApiResult<Vec<_>>>()?;
    if automation_execution {
        input.insert(
            0,
            CodexUserInput::Text {
                text: AUTOMATION_EXECUTION_CONTEXT.to_string(),
            },
        );
    }
    Ok(input)
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

fn build_pi_prompt(
    blocks: &[NormalizedAgentInputBlock],
    working_directory: &Path,
) -> AgentApiResult<PiPromptInput> {
    let mut message_parts = Vec::new();
    let mut images = Vec::new();
    for block in blocks {
        match block {
            NormalizedAgentInputBlock::Text { text } => message_parts.push(text.clone()),
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
                images.push(PiImage {
                    kind: "image".to_string(),
                    data,
                    mime_type,
                });
            }
            NormalizedAgentInputBlock::FileText {
                path, name, text, ..
            } => message_parts.push(format!("本地文件：{name}\n路径：{path}\n\n{text}")),
            NormalizedAgentInputBlock::FileReference { path, name, .. } => {
                message_parts.push(format!(
                    "本地文件引用：{name}\n路径：{path}\n请按需使用本地文件工具读取。"
                ));
            }
            NormalizedAgentInputBlock::AttachmentMetadata {
                name,
                mime_type,
                size,
                reason,
            } => message_parts.push(format_attachment_metadata(
                name,
                mime_type.as_deref(),
                *size,
                reason,
            )),
        }
    }
    Ok(PiPromptInput {
        message: message_parts.join("\n\n"),
        images,
        streaming_behavior: None,
    })
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

fn acp_arguments(
    provider_id: &str,
    permission_mode: &'static str,
) -> Result<Vec<&'static str>, AcpError> {
    match provider_id {
        GROK_BUILD_PROVIDER_ID => Ok(grok_acp_arguments(permission_mode).to_vec()),
        OPENCODE_PROVIDER_ID => Ok(vec!["acp"]),
        _ => Err(AcpError::Protocol(
            "当前 Provider 没有可用 ACP 启动配置".to_string(),
        )),
    }
}

fn acp_permission_policy(provider_id: &str, permission_mode: &'static str) -> AcpPermissionPolicy {
    if provider_id != OPENCODE_PROVIDER_ID {
        return AcpPermissionPolicy::Interactive;
    }
    match permission_mode {
        "auto" => AcpPermissionPolicy::AutoApproveOnce,
        "bypassPermissions" => AcpPermissionPolicy::AutoApproveAlways,
        _ => AcpPermissionPolicy::Interactive,
    }
}

fn should_set_acp_model(
    requested_model: Option<&str>,
    session_model: Option<&str>,
    initialize_model: Option<&str>,
) -> bool {
    requested_model.is_some_and(|requested| session_model.or(initialize_model) != Some(requested))
}

#[cfg(test)]
mod tests {
    use super::{
        acp_arguments, acp_permission_policy, await_guide_ack, build_acp_prompt, build_codex_input,
        build_pi_prompt, cancelled_before_prompt_outcome, compact_capability_cache_key,
        find_grok_runtime_error_detail, grok_acp_arguments, grok_acp_error_with_runtime_detail,
        grok_uses_channel_credentials, guide_ack_response, normalize_agent_input,
        normalize_guide_prompt, parse_opencode_models, pi_model_catalog, pi_model_parts,
        pi_rpc_arguments, pi_usage_snapshot, probe_compact_capability_cached, public_acp_error,
        public_codex_error, push_compact_failure_event, read_cached_agent_command,
        read_cached_agent_model_catalog, runtime_can_reuse, sanitize_grok_runtime_error_detail,
        should_retry_grok_channel_prompt, should_set_acp_model, store_cached_agent_command,
        store_cached_agent_model_catalog, summarize_codex_compact_capability,
        validate_compact_runtime_session, AcpEventMapper, AgentDriverInput, AgentDriverKind,
        AgentInputContentBlock, AgentModelCatalog, AgentModelSummary, AgentRunRecord,
        AgentRunService, AgentRunState, AgentRuntimeCommand, AgentRuntimeCompact,
        AgentRuntimeConfig, AgentRuntimePhase, AgentRuntimeRecord, AgentRuntimeRun,
        CodexCompactCapabilityRequest, CodexEventMapper, CommandResolvers, GuideAckOutcome,
        GuideAgentRunRequest, LiveAgentRuntime, PiEventMapper, RuntimeExecution,
        StartAgentCompactRequest, StartAgentRunRequest, AGENT_COMMAND_CACHE_TTL,
        AUTOMATION_EXECUTION_CONTEXT, MODEL_CATALOG_CACHE_TTL,
    };
    use crate::{
        acp::{
            AcpError, AcpPermissionPolicy, AcpPromptInput, AcpRuntimeEvent, AcpToolCall,
            AcpToolCallUpdate,
        },
        agent_channels::AgentChannelService,
        agent_runtime::{
            AgentCompactCapabilityState, AgentCompactCapabilitySummary, AgentCompactionStatus,
            AgentControlCommand, AgentPermissionDecision, AgentRunEvent, OPENAI_CODEX_PROVIDER_ID,
            PI_AGENT_PROVIDER_ID,
        },
        codex_app_server::{CodexAppServerError, CodexRuntimeEvent, CodexUserInput},
        pi_rpc::{PiModel, PiPromptInput, PiRuntimeEvent, PiState, PiStdioClient},
    };
    use axum::http::StatusCode;
    use chrono::Utc;
    use serde_json::{json, Value};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::{
        collections::{BTreeMap, HashMap},
        fs,
        path::{Path, PathBuf},
        sync::{Arc, Mutex},
        time::{Duration, Instant},
    };
    use tokio::sync::{mpsc, oneshot, watch, Mutex as AsyncMutex, Notify};

    static COMMAND_RESOLVER_CALLS: AtomicUsize = AtomicUsize::new(0);
    static COMMAND_RESOLVER_AVAILABLE: AtomicBool = AtomicBool::new(true);

    #[test]
    fn compact_capability_cache_key_changes_with_channel_runtime() {
        let mut first = test_codex_runtime_config();
        first.channel_fingerprint = Some("channel-a".to_string());
        let mut second = first.clone();
        second.channel_fingerprint = Some("channel-b".to_string());

        assert_ne!(
            compact_capability_cache_key(&first),
            compact_capability_cache_key(&second)
        );
        second.channel_fingerprint = first.channel_fingerprint.clone();
        second
            .codex_config_args
            .push("model_reasoning_effort=high".to_string());
        assert_ne!(
            compact_capability_cache_key(&first),
            compact_capability_cache_key(&second)
        );
    }

    #[tokio::test]
    async fn compact_capability_cache_reuses_success_and_refreshes_on_request() {
        let cache = AsyncMutex::new(HashMap::new());
        let calls = AtomicUsize::new(0);
        let config = test_codex_runtime_config();

        let first = probe_compact_capability_cached(&cache, &config, false, || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(AgentCompactCapabilitySummary {
                state: AgentCompactCapabilityState::Supported,
                message: None,
            })
        })
        .await;
        let second = probe_compact_capability_cached(&cache, &config, false, || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(AgentCompactCapabilitySummary {
                state: AgentCompactCapabilityState::Unsupported,
                message: None,
            })
        })
        .await;
        let refreshed = probe_compact_capability_cached(&cache, &config, true, || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(AgentCompactCapabilitySummary {
                state: AgentCompactCapabilityState::Unsupported,
                message: None,
            })
        })
        .await;

        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(first.state, AgentCompactCapabilityState::Supported);
        assert_eq!(second.state, AgentCompactCapabilityState::Supported);
        assert_eq!(refreshed.state, AgentCompactCapabilityState::Unsupported);
    }

    #[tokio::test]
    async fn compact_capability_errors_are_sanitized_and_not_cached() {
        let cache = AsyncMutex::new(HashMap::new());
        let calls = AtomicUsize::new(0);
        let config = test_codex_runtime_config();
        let long_secret = format!("api_key=secret {}", "x".repeat(5000));

        let failed = probe_compact_capability_cached(&cache, &config, false, || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(CodexAppServerError::Execution(long_secret.clone()))
        })
        .await;
        let recovered = probe_compact_capability_cached(&cache, &config, false, || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(AgentCompactCapabilitySummary {
                state: AgentCompactCapabilityState::Supported,
                message: None,
            })
        })
        .await;

        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(failed.state, AgentCompactCapabilityState::Error);
        assert!(!failed
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("secret"));
        assert!(failed.message.as_deref().unwrap_or_default().len() <= 2200);
        assert_eq!(recovered.state, AgentCompactCapabilityState::Supported);
    }

    #[test]
    fn compact_capability_runtime_summary_preserves_safe_disable_reason() {
        let unsupported = summarize_codex_compact_capability(Ok(
            crate::codex_app_server::CodexCompactCapability::Unsupported,
        ));
        let error = summarize_codex_compact_capability(Err(CodexAppServerError::Execution(
            "api_key=secret probe failed".to_string(),
        )));

        assert_eq!(unsupported.state, AgentCompactCapabilityState::Unsupported);
        assert!(unsupported
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("升级"));
        assert_eq!(error.state, AgentCompactCapabilityState::Error);
        assert!(!error
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("secret"));
    }

    fn counting_codex_command_resolver() -> Option<String> {
        COMMAND_RESOLVER_CALLS.fetch_add(1, Ordering::SeqCst);
        COMMAND_RESOLVER_AVAILABLE
            .load(Ordering::SeqCst)
            .then(|| "C:/tools/codex.exe".to_string())
    }

    fn test_runtime_config() -> AgentRuntimeConfig {
        AgentRuntimeConfig {
            provider_id: "grok-build".to_string(),
            driver: AgentDriverKind::Acp,
            command: "grok".to_string(),
            working_directory: PathBuf::from("D:/workspace"),
            permission_mode: "default",
            model: Some("grok-default".to_string()),
            reasoning_effort: None,
            channel_id: None,
            channel_fingerprint: None,
            environment: BTreeMap::new(),
            codex_config_args: Vec::new(),
            bridge_version: None,
        }
    }

    fn test_codex_runtime_config() -> AgentRuntimeConfig {
        let mut config = test_runtime_config();
        config.provider_id = OPENAI_CODEX_PROVIDER_ID.to_string();
        config.driver = AgentDriverKind::CodexAppServer;
        config.command = "codex".to_string();
        config.model = Some("gpt-codex-default".to_string());
        config
    }

    fn insert_test_codex_runtime(
        state: &AgentRunState,
        phase: AgentRuntimePhase,
        current_run_id: Option<&str>,
        command: mpsc::UnboundedSender<AgentRuntimeCommand>,
    ) {
        let (shutdown, _shutdown_receiver) = watch::channel(false);
        state.runtimes.lock().expect("runtime lock").insert(
            "thread-1".to_string(),
            AgentRuntimeRecord {
                runtime_id: "runtime-1".to_string(),
                config: test_codex_runtime_config(),
                session_id: Some("provider-thread-1".to_string()),
                phase,
                current_run_id: current_run_id.map(ToString::to_string),
                command: Some(command),
                shutdown,
                last_error: None,
            },
        );
    }

    fn test_agent_channel_service() -> AgentChannelService {
        let root =
            std::env::temp_dir().join(format!("codem-agent-run-test-{}", std::process::id()));
        AgentChannelService::new(
            root.clone(),
            crate::ordinary_chat::secrets::SecretStore::new(root),
        )
    }

    fn test_run_state() -> AgentRunState {
        AgentRunState {
            records: Arc::new(Mutex::new(HashMap::new())),
            runtimes: Arc::new(Mutex::new(HashMap::new())),
            model_catalog_cache: Arc::new(Mutex::new(HashMap::new())),
            command_cache: Arc::new(Mutex::new(HashMap::new())),
            compact_capability_cache: Arc::new(AsyncMutex::new(HashMap::new())),
            command_resolvers: CommandResolvers {
                grok: || None,
                codex: || None,
                opencode: || None,
                pi: || None,
            },
            agent_channels: test_agent_channel_service(),
        }
    }

    async fn wait_for_run_event<F>(
        state: &AgentRunState,
        run_id: &str,
        predicate: F,
    ) -> AgentRunEvent
    where
        F: Fn(&AgentRunEvent) -> bool,
    {
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if let Some((events, _)) = state.snapshot_after(run_id, 0) {
                    if let Some(event) = events.into_iter().find(&predicate) {
                        return event;
                    }
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("timed out waiting for Agent run event")
    }

    #[tokio::test]
    async fn guide_api_rejects_non_codex_runs_without_delivering_a_control_command() {
        let state = test_run_state();
        let (cancel, _cancel_receiver) = watch::channel(false);
        let (control, mut commands) = mpsc::unbounded_channel();
        state
            .insert(
                "run-grok".to_string(),
                AgentRunRecord {
                    provider_id: "grok-build".to_string(),
                    thread_id: Some("thread-1".to_string()),
                    events: Vec::new(),
                    finished: false,
                    terminal_emitted: false,
                    notify: Arc::new(Notify::new()),
                    cancel,
                    control,
                },
            )
            .expect("insert non-Codex run");

        let response = super::agent_run_guide(
            axum::extract::State(state.clone()),
            axum::extract::Path("run-grok".to_string()),
            axum::Json(GuideAgentRunRequest {
                prompt: "inspect".to_string(),
            }),
        )
        .await;

        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("non-Codex rejection body");
        assert_eq!(
            serde_json::from_slice::<Value>(&body).expect("non-Codex rejection JSON"),
            json!({
                "submitted": false,
                "uncertain": false,
                "error": "当前 Agent 不支持运行中引导"
            })
        );
        assert!(matches!(
            commands.try_recv(),
            Err(mpsc::error::TryRecvError::Empty)
        ));
    }

    #[test]
    fn guide_request_accepts_only_a_non_empty_text_prompt() {
        let payload = serde_json::from_value::<GuideAgentRunRequest>(json!({
            "prompt": "  inspect the current failure  "
        }))
        .expect("valid guide request");
        assert_eq!(
            normalize_guide_prompt(payload.prompt).expect("normalized prompt"),
            "inspect the current failure"
        );

        assert!(serde_json::from_value::<GuideAgentRunRequest>(json!({
            "prompt": "inspect",
            "attachments": []
        }))
        .is_err());
        let error = normalize_guide_prompt(" \r\n\t ".to_string())
            .expect_err("blank guide prompt must fail");
        assert_eq!(error.status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn guide_ack_classifies_success_rejection_closed_and_timeout() {
        let (success_sender, success_receiver) = oneshot::channel();
        success_sender.send(Ok(())).expect("send success ack");
        assert_eq!(
            await_guide_ack(success_receiver, Duration::from_secs(1)).await,
            GuideAckOutcome::Submitted
        );

        let (rejected_sender, rejected_receiver) = oneshot::channel();
        rejected_sender
            .send(Err("turn/steer rejected".to_string()))
            .expect("send rejection ack");
        assert_eq!(
            await_guide_ack(rejected_receiver, Duration::from_secs(1)).await,
            GuideAckOutcome::Rejected("turn/steer rejected".to_string())
        );

        let (closed_sender, closed_receiver) = oneshot::channel::<Result<(), String>>();
        drop(closed_sender);
        assert!(matches!(
            await_guide_ack(closed_receiver, Duration::from_secs(1)).await,
            GuideAckOutcome::Uncertain(message) if message.contains("确认引导请求前结束")
        ));

        let (_timeout_sender, timeout_receiver) = oneshot::channel::<Result<(), String>>();
        assert!(matches!(
            await_guide_ack(timeout_receiver, Duration::from_millis(1)).await,
            GuideAckOutcome::Uncertain(message) if message.contains("超时")
        ));
    }

    #[tokio::test]
    async fn guide_ack_response_distinguishes_known_and_uncertain_failure() {
        let submitted = guide_ack_response(GuideAckOutcome::Submitted);
        assert_eq!(submitted.status(), StatusCode::OK);
        let submitted_body = axum::body::to_bytes(submitted.into_body(), usize::MAX)
            .await
            .expect("submitted body");
        assert_eq!(
            serde_json::from_slice::<Value>(&submitted_body).expect("submitted JSON"),
            json!({ "submitted": true })
        );

        let known = guide_ack_response(GuideAckOutcome::Rejected("not supported".to_string()));
        assert_eq!(known.status(), StatusCode::CONFLICT);
        let known_body = axum::body::to_bytes(known.into_body(), usize::MAX)
            .await
            .expect("known failure body");
        assert_eq!(
            serde_json::from_slice::<Value>(&known_body).expect("known failure JSON"),
            json!({ "submitted": false, "uncertain": false, "error": "not supported" })
        );

        let uncertain =
            guide_ack_response(GuideAckOutcome::Uncertain("response timeout".to_string()));
        assert_eq!(uncertain.status(), StatusCode::GATEWAY_TIMEOUT);
        let uncertain_body = axum::body::to_bytes(uncertain.into_body(), usize::MAX)
            .await
            .expect("uncertain failure body");
        assert_eq!(
            serde_json::from_slice::<Value>(&uncertain_body).expect("uncertain failure JSON"),
            json!({ "submitted": false, "uncertain": true, "error": "response timeout" })
        );
    }

    #[test]
    fn agent_model_catalog_cache_reuses_fresh_entries_and_expires_old_ones() {
        let cache = Mutex::new(HashMap::new());
        let loaded_at = Instant::now();
        let catalog = AgentModelCatalog {
            provider_id: "openai-codex".to_string(),
            default_model_id: Some("gpt-default".to_string()),
            models: vec![AgentModelSummary {
                id: "gpt-default".to_string(),
                label: "GPT Default".to_string(),
                description: None,
                context_window_tokens: None,
                is_default: true,
                default_reasoning_effort: None,
                supported_reasoning_efforts: Vec::new(),
            }],
        };

        store_cached_agent_model_catalog(&cache, "openai-codex", catalog.clone(), loaded_at);
        assert_eq!(
            read_cached_agent_model_catalog(&cache, "openai-codex", loaded_at)
                .and_then(|cached| cached.default_model_id),
            Some("gpt-default".to_string())
        );
        assert!(read_cached_agent_model_catalog(
            &cache,
            "openai-codex",
            loaded_at + MODEL_CATALOG_CACHE_TTL,
        )
        .is_none());
    }

    #[test]
    fn agent_command_cache_reuses_fresh_entries_and_expires_old_ones() {
        let cache = Mutex::new(HashMap::new());
        let resolved_at = Instant::now();
        store_cached_agent_command(
            &cache,
            "openai-codex",
            "C:/tools/codex.exe".to_string(),
            resolved_at,
        );

        assert_eq!(
            read_cached_agent_command(&cache, "openai-codex", resolved_at),
            Some("C:/tools/codex.exe".to_string())
        );
        assert_eq!(
            read_cached_agent_command(
                &cache,
                "openai-codex",
                resolved_at + AGENT_COMMAND_CACHE_TTL,
            ),
            None
        );
    }

    #[test]
    fn agent_command_resolution_reuses_cache_until_forced_refresh() {
        COMMAND_RESOLVER_CALLS.store(0, Ordering::SeqCst);
        COMMAND_RESOLVER_AVAILABLE.store(true, Ordering::SeqCst);
        let service = AgentRunService::new(
            || None,
            counting_codex_command_resolver,
            || None,
            || None,
            test_agent_channel_service(),
        );

        assert_eq!(
            service.resolve_command("openai-codex", false).as_deref(),
            Some("C:/tools/codex.exe")
        );
        assert_eq!(
            service.resolve_command("openai-codex", false).as_deref(),
            Some("C:/tools/codex.exe")
        );
        assert_eq!(COMMAND_RESOLVER_CALLS.load(Ordering::SeqCst), 1);

        COMMAND_RESOLVER_AVAILABLE.store(false, Ordering::SeqCst);
        assert_eq!(
            service.resolve_command("openai-codex", false).as_deref(),
            Some("C:/tools/codex.exe")
        );
        assert_eq!(COMMAND_RESOLVER_CALLS.load(Ordering::SeqCst), 1);

        assert_eq!(service.resolve_command("openai-codex", true), None);
        assert_eq!(COMMAND_RESOLVER_CALLS.load(Ordering::SeqCst), 2);

        COMMAND_RESOLVER_AVAILABLE.store(true, Ordering::SeqCst);
        assert_eq!(
            service.resolve_command("openai-codex", false).as_deref(),
            Some("C:/tools/codex.exe")
        );
        assert_eq!(COMMAND_RESOLVER_CALLS.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn grok_acp_arguments_keep_permission_mode_as_a_separate_value() {
        assert_eq!(
            grok_acp_arguments("bypassPermissions"),
            ["--permission-mode", "bypassPermissions", "agent", "stdio"]
        );
    }

    #[test]
    fn grok_channel_credentials_skip_cached_login_requirement() {
        assert!(!grok_uses_channel_credentials(&BTreeMap::new()));
        let mut environment = BTreeMap::new();
        environment.insert(
            "CODEM_AGENT_CHANNEL_API_KEY".to_string(),
            "channel-secret".to_string(),
        );
        assert!(grok_uses_channel_credentials(&environment));
    }

    #[test]
    fn grok_channel_internal_error_retries_only_before_runtime_activity() {
        let mut environment = BTreeMap::new();
        environment.insert(
            "CODEM_AGENT_CHANNEL_API_KEY".to_string(),
            "channel-secret".to_string(),
        );
        let error = AcpError::Rpc {
            code: -32603,
            message: "Internal error".to_string(),
        };
        let mut mapper = AcpEventMapper::new("run-1".to_string());
        assert!(should_retry_grok_channel_prompt(
            "grok-build",
            &environment,
            &mapper,
            &error,
        ));

        mapper.map_event(AcpRuntimeEvent::TextDelta {
            text: "partial".to_string(),
        });
        assert!(!should_retry_grok_channel_prompt(
            "grok-build",
            &environment,
            &mapper,
            &error,
        ));
    }

    #[test]
    fn opencode_acp_uses_the_shared_environment_aware_spawn_path() {
        assert_eq!(
            acp_arguments("opencode", "bypassPermissions").expect("OpenCode ACP arguments"),
            vec!["acp"]
        );
        assert_eq!(
            acp_arguments("grok-build", "auto").expect("Grok ACP arguments"),
            vec!["--permission-mode", "auto", "agent", "stdio"]
        );
    }

    #[test]
    fn opencode_permission_modes_map_to_acp_approval_policies() {
        assert_eq!(
            acp_permission_policy("opencode", "default"),
            AcpPermissionPolicy::Interactive
        );
        assert_eq!(
            acp_permission_policy("opencode", "auto"),
            AcpPermissionPolicy::AutoApproveOnce
        );
        assert_eq!(
            acp_permission_policy("opencode", "bypassPermissions"),
            AcpPermissionPolicy::AutoApproveAlways
        );
        assert_eq!(
            acp_permission_policy("grok-build", "bypassPermissions"),
            AcpPermissionPolicy::Interactive
        );
    }

    #[test]
    fn opencode_model_catalog_parses_stable_provider_model_lines() {
        let models = parse_opencode_models(
            "minimax-cn-coding-plan/MiniMax-M2.7\ninvalid\nminimax-cn-coding-plan/MiniMax-M2.7\nopencode/gpt-5.4\n",
        );
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "minimax-cn-coding-plan/MiniMax-M2.7");
        assert_eq!(models[0].label, "MiniMax-M2.7");
        assert_eq!(
            models[0].description.as_deref(),
            Some("minimax-cn-coding-plan")
        );
        assert_eq!(models[1].id, "opencode/gpt-5.4");
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
            build_acp_prompt(&blocks, Path::new("D:/workspace"), None, false).expect("ACP mapping"),
        )
        .expect("serialize ACP input");
        assert_eq!(acp[0]["type"], "image");
        assert_eq!(acp[1]["type"], "resource");
        assert_eq!(acp[2]["type"], "resource_link");

        let codex = serde_json::to_value(
            build_codex_input(&blocks, Path::new("D:/workspace"), false).expect("Codex mapping"),
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
    fn acp_prompt_prepends_conversation_context_without_changing_user_blocks() {
        let blocks = normalize_agent_input(Some("继续处理"), None).expect("normalize prompt");
        let acp = build_acp_prompt(
            &blocks,
            Path::new("D:/workspace"),
            Some("[CodeM 会话续接上下文]\n之前的回答"),
            false,
        )
        .expect("build ACP continuity prompt");
        assert_eq!(acp.len(), 2);
        assert_eq!(
            acp[0],
            AcpPromptInput::Text {
                text: "[CodeM 会话续接上下文]\n之前的回答".to_string(),
            }
        );
        assert_eq!(
            acp[1],
            AcpPromptInput::Text {
                text: "继续处理".to_string(),
            }
        );
    }

    #[test]
    fn start_agent_run_request_accepts_camel_case_content_blocks() {
        let request = serde_json::from_value::<StartAgentRunRequest>(json!({
            "providerId": "grok-build",
            "threadId": "thread-1",
            "workingDirectory": "D:/workspace",
            "conversationContext": "[CodeM 会话续接上下文]",
            "automationExecution": true,
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
        assert_eq!(
            request.conversation_context.as_deref(),
            Some("[CodeM 会话续接上下文]")
        );
        assert!(request.automation_execution);
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
    fn compact_request_uses_strict_camel_case_contract() {
        let request = serde_json::from_value::<StartAgentCompactRequest>(json!({
            "operationId": "compact-1",
            "providerId": "openai-codex",
            "sessionId": "provider-thread-1",
            "workingDirectory": "D:/workspace",
            "permissionMode": "default",
            "model": "gpt-codex-default",
            "reasoningEffort": "high",
            "channelId": "channel-1"
        }))
        .expect("valid compact request");

        assert_eq!(request.operation_id, "compact-1");
        assert_eq!(request.session_id, "provider-thread-1");
        assert!(serde_json::from_value::<StartAgentCompactRequest>(json!({
            "operationId": "compact-1",
            "providerId": "openai-codex",
            "sessionId": "provider-thread-1",
            "workingDirectory": "D:/workspace",
            "unexpected": true
        }))
        .is_err());
    }

    #[test]
    fn compact_capability_request_uses_strict_runtime_identity_contract() {
        let request = serde_json::from_value::<CodexCompactCapabilityRequest>(json!({
            "threadId": "thread-1",
            "sessionId": "provider-thread-1",
            "workingDirectory": "D:/workspace",
            "permissionMode": "default",
            "model": "gpt-codex-default",
            "reasoningEffort": "high",
            "channelId": "channel-1",
            "refresh": true
        }))
        .expect("valid compact capability request");

        assert_eq!(request.thread_id, "thread-1");
        assert_eq!(request.session_id, "provider-thread-1");
        assert!(request.refresh);
        assert!(
            serde_json::from_value::<CodexCompactCapabilityRequest>(json!({
                "threadId": "thread-1",
                "sessionId": "provider-thread-1",
                "workingDirectory": "D:/workspace",
                "unexpected": true
            }))
            .is_err()
        );
    }

    #[test]
    fn automation_execution_context_is_prepended_without_changing_user_input() {
        let blocks = normalize_agent_input(Some("执行日报推送"), None).expect("normalize prompt");
        let acp = build_acp_prompt(&blocks, Path::new("D:/workspace"), None, true)
            .expect("build automation ACP prompt");
        assert_eq!(acp.len(), 2);
        assert_eq!(
            acp[0],
            AcpPromptInput::Text {
                text: AUTOMATION_EXECUTION_CONTEXT.to_string(),
            }
        );
        assert_eq!(
            acp[1],
            AcpPromptInput::Text {
                text: "执行日报推送".to_string(),
            }
        );

        let codex = build_codex_input(&blocks, Path::new("D:/workspace"), true)
            .expect("build automation Codex input");
        assert_eq!(codex.len(), 2);
        assert_eq!(
            codex[0],
            CodexUserInput::Text {
                text: AUTOMATION_EXECUTION_CONTEXT.to_string(),
            }
        );
        assert_eq!(
            codex[1],
            CodexUserInput::Text {
                text: "执行日报推送".to_string(),
            }
        );
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
    fn pi_hot_runtime_status_and_bridge_version_are_part_of_reuse_contract() {
        let mut config = test_runtime_config();
        config.provider_id = PI_AGENT_PROVIDER_ID.to_string();
        config.driver = AgentDriverKind::PiRpc;
        config.command = "pi".to_string();
        config.bridge_version = Some("1".to_string());
        let (command, _commands) = mpsc::unbounded_channel();
        let (shutdown, _shutdown) = watch::channel(false);
        let runtime = AgentRuntimeRecord {
            runtime_id: "runtime-pi-1".to_string(),
            config: config.clone(),
            session_id: Some("pi-session-1".to_string()),
            phase: AgentRuntimePhase::Ready,
            current_run_id: None,
            command: Some(command),
            shutdown,
            last_error: None,
        };

        assert_eq!(
            super::runtime_status_message(
                PI_AGENT_PROVIDER_ID,
                AgentDriverKind::PiRpc,
                true,
                false,
            ),
            "已复用 Pi 热会话"
        );
        assert!(runtime_can_reuse(&runtime, &config, Some("pi-session-1")));

        let mut changed = config;
        changed.bridge_version = Some("2".to_string());
        assert!(!runtime_can_reuse(&runtime, &changed, Some("pi-session-1")));
    }

    #[test]
    fn pi_mapper_only_settles_on_agent_settled() {
        let mut mapper = PiEventMapper::new("run-pi-1".to_string());

        let agent_end = mapper.map_event(PiRuntimeEvent::AgentEnd { will_retry: false });
        assert!(!agent_end.settled);
        assert!(agent_end.events.is_empty());

        let settled = mapper.map_event(PiRuntimeEvent::AgentSettled);
        assert!(settled.settled);
        assert!(settled.events.is_empty());
    }

    #[tokio::test]
    async fn pi_extension_confirm_input_and_cancel_round_trip_on_hot_runtime() {
        let root = std::env::temp_dir().join(format!(
            "codem-pi-run-extension-ui-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let script = root.join("fake-pi.mjs");
        let log = root.join("responses.jsonl");
        fs::write(
            &script,
            r#"
import fs from 'node:fs';
import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
for await (const line of lines) {
  const command = JSON.parse(line);
  const response = (data = undefined) => {
    const value = { id: command.id, type: 'response', command: command.type, success: true };
    if (data !== undefined) value.data = data;
    emit(value);
  };
  if (command.type === 'prompt') {
    response();
    emit({ type: 'extension_ui_request', id: 'confirm-approve', method: 'confirm', title: 'Run command', message: 'npm test' });
  } else if (command.type === 'extension_ui_response') {
    fs.appendFileSync(process.env.FAKE_PI_RESPONSE_LOG, JSON.stringify(command) + '\n');
    if (command.id === 'confirm-approve') {
      emit({ type: 'extension_ui_request', id: 'confirm-reject', method: 'confirm', title: 'Edit file', message: 'src/main.rs' });
    } else if (command.id === 'confirm-reject') {
      emit({ type: 'extension_ui_request', id: 'input-answer', method: 'input', title: 'Enter value', placeholder: 'value' });
    } else if (command.id === 'input-answer') {
      emit({ type: 'extension_ui_request', id: 'input-cancel', method: 'input', title: 'Optional value', placeholder: 'value' });
    }
  } else if (command.type === 'abort') {
    response();
    emit({ type: 'agent_settled' });
  } else if (command.type === 'get_session_stats') {
    response({});
  }
}
"#,
        )
        .unwrap();
        let environment = BTreeMap::from([(
            "FAKE_PI_RESPONSE_LOG".to_string(),
            log.to_string_lossy().to_string(),
        )]);
        let client = PiStdioClient::spawn_with_options(
            "node",
            &root,
            &environment,
            &[script.to_string_lossy().to_string()],
        )
        .await
        .unwrap();
        let mut runtime = LiveAgentRuntime::Pi {
            client,
            session_id: "pi-session-1".to_string(),
        };
        let state = test_run_state();
        let run_id = "run-pi-extension".to_string();
        let (cancel_sender, cancel) = watch::channel(false);
        let (control_sender, control) = mpsc::unbounded_channel();
        state
            .insert(
                run_id.clone(),
                AgentRunRecord {
                    provider_id: PI_AGENT_PROVIDER_ID.to_string(),
                    thread_id: Some("thread-pi-extension".to_string()),
                    events: Vec::new(),
                    finished: false,
                    terminal_emitted: false,
                    notify: Arc::new(Notify::new()),
                    cancel: cancel_sender.clone(),
                    control: control_sender.clone(),
                },
            )
            .unwrap();
        let mut config = test_runtime_config();
        config.provider_id = PI_AGENT_PROVIDER_ID.to_string();
        config.driver = AgentDriverKind::PiRpc;
        config.command = "node".to_string();
        let (_shutdown_sender, mut shutdown) = watch::channel(false);
        let turn_state = state.clone();
        let turn_run_id = run_id.clone();
        let turn = tokio::spawn(async move {
            let outcome = runtime
                .run_turn(
                    &turn_state,
                    &config,
                    AgentRuntimeRun {
                        run_id: turn_run_id,
                        input: AgentDriverInput::Pi(PiPromptInput {
                            message: "start".to_string(),
                            images: Vec::new(),
                            streaming_behavior: None,
                        }),
                        cancel,
                        control,
                    },
                    &mut shutdown,
                )
                .await;
            runtime.shutdown().await;
            outcome
        });

        let approval = wait_for_run_event(&state, &run_id, |event| {
            matches!(event, AgentRunEvent::ApprovalRequest { request, .. }
                if request.request_id == "confirm-approve")
        })
        .await;
        assert!(
            matches!(approval, AgentRunEvent::ApprovalRequest { request, .. }
            if request.title == "Run command" && request.description.as_deref() == Some("npm test"))
        );
        let (acknowledgement, ack) = oneshot::channel();
        control_sender
            .send(AgentControlCommand::Permission {
                request_id: "wrong-confirm-id".to_string(),
                decision: AgentPermissionDecision::Approve,
                option_id: None,
                acknowledgement,
            })
            .unwrap();
        assert!(ack.await.unwrap().unwrap_err().contains("ID"));
        let (acknowledgement, ack) = oneshot::channel();
        control_sender
            .send(AgentControlCommand::UserInput {
                request_id: "confirm-approve".to_string(),
                answers: serde_json::Map::from_iter([(
                    "value".to_string(),
                    Value::String("wrong-control-type".to_string()),
                )]),
                acknowledgement,
            })
            .unwrap();
        assert!(ack.await.unwrap().unwrap_err().contains("权限"));
        let (acknowledgement, ack) = oneshot::channel();
        control_sender
            .send(AgentControlCommand::Permission {
                request_id: "confirm-approve".to_string(),
                decision: AgentPermissionDecision::Approve,
                option_id: None,
                acknowledgement,
            })
            .unwrap();
        assert_eq!(ack.await.unwrap(), Ok(()));

        wait_for_run_event(&state, &run_id, |event| {
            matches!(event, AgentRunEvent::ApprovalRequest { request, .. }
                if request.request_id == "confirm-reject")
        })
        .await;
        let (acknowledgement, ack) = oneshot::channel();
        control_sender
            .send(AgentControlCommand::Permission {
                request_id: "confirm-reject".to_string(),
                decision: AgentPermissionDecision::Reject,
                option_id: None,
                acknowledgement,
            })
            .unwrap();
        assert_eq!(ack.await.unwrap(), Ok(()));

        let input = wait_for_run_event(&state, &run_id, |event| {
            matches!(event, AgentRunEvent::RequestUserInput { request, .. }
                if request.request_id == "input-answer")
        })
        .await;
        assert!(
            matches!(input, AgentRunEvent::RequestUserInput { request, .. }
            if request.questions.len() == 1 && request.questions[0].id == "value")
        );
        let (acknowledgement, ack) = oneshot::channel();
        control_sender
            .send(AgentControlCommand::UserInput {
                request_id: "input-answer".to_string(),
                answers: serde_json::Map::from_iter([(
                    "value".to_string(),
                    Value::String("Alice".to_string()),
                )]),
                acknowledgement,
            })
            .unwrap();
        assert_eq!(ack.await.unwrap(), Ok(()));

        wait_for_run_event(&state, &run_id, |event| {
            matches!(event, AgentRunEvent::RequestUserInput { request, .. }
                if request.request_id == "input-cancel")
        })
        .await;
        cancel_sender.send(true).unwrap();
        assert!(matches!(
            turn.await.unwrap(),
            RuntimeExecution::Completed(Ok(outcome)) if outcome.stop_reason == "cancelled"
        ));

        let responses = fs::read_to_string(&log)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            responses,
            vec![
                json!({"type": "extension_ui_response", "id": "confirm-approve", "confirmed": true}),
                json!({"type": "extension_ui_response", "id": "confirm-reject", "confirmed": false}),
                json!({"type": "extension_ui_response", "id": "input-answer", "value": "Alice"}),
                json!({"type": "extension_ui_response", "id": "input-cancel", "cancelled": true}),
            ]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn pi_message_end_error_becomes_nonfatal_runtime_error() {
        let root =
            std::env::temp_dir().join(format!("codem-pi-message-error-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let script = root.join("fake-pi.mjs");
        fs::write(
            &script,
            r#"
import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
for await (const line of lines) {
  const command = JSON.parse(line);
  const response = (data = undefined) => {
    const value = { id: command.id, type: 'response', command: command.type, success: true };
    if (data !== undefined) value.data = data;
    emit(value);
  };
  if (command.type === 'prompt') {
    response();
    emit({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: '401 authentication_error api_key sk-fake-sensitive-value'
      }
    });
    emit({ type: 'agent_end', messages: [], willRetry: false });
    emit({ type: 'agent_settled' });
  } else if (command.type === 'get_session_stats') {
    response({});
  }
}
"#,
        )
        .unwrap();
        let client = PiStdioClient::spawn_with_options(
            "node",
            &root,
            &BTreeMap::new(),
            &[script.to_string_lossy().to_string()],
        )
        .await
        .unwrap();
        let mut runtime = LiveAgentRuntime::Pi {
            client,
            session_id: "pi-session-error".to_string(),
        };
        let mut config = test_runtime_config();
        config.provider_id = PI_AGENT_PROVIDER_ID.to_string();
        config.driver = AgentDriverKind::PiRpc;
        config.command = "node".to_string();
        let (_cancel_sender, cancel) = watch::channel(false);
        let (_control_sender, control) = mpsc::unbounded_channel();
        let (_shutdown_sender, mut shutdown) = watch::channel(false);

        let outcome = runtime
            .run_turn(
                &test_run_state(),
                &config,
                AgentRuntimeRun {
                    run_id: "run-pi-message-error".to_string(),
                    input: AgentDriverInput::Pi(PiPromptInput {
                        message: "hello".to_string(),
                        images: Vec::new(),
                        streaming_behavior: None,
                    }),
                    cancel,
                    control,
                },
                &mut shutdown,
            )
            .await;
        runtime.shutdown().await;
        fs::remove_dir_all(root).unwrap();

        match outcome {
            RuntimeExecution::Completed(Err(error)) => {
                assert!(!error.fatal);
                assert!(error.message.contains("401 authentication_error"));
                assert!(!error.message.contains("sk-fake-sensitive-value"));
            }
            _ => panic!("Pi message_end error should fail the turn"),
        }
    }

    #[test]
    fn pi_extension_bridge_gates_side_effecting_tools_without_leaking_payloads() {
        let bridge = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("pi")
            .join("codem-bridge.js");
        let source = fs::read_to_string(&bridge).expect("read CodeM Pi bridge asset");
        assert!(source.contains("pi.on(\"tool_call\""));
        assert!(source.contains("ctx.ui.confirm"));

        let root =
            std::env::temp_dir().join(format!("codem-pi-bridge-js-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let harness = root.join("bridge-harness.mjs");
        fs::write(
            &harness,
            r#"
import { pathToFileURL } from 'node:url';
const bridge = (await import(pathToFileURL(process.argv[2]).href)).default;
let handler;
bridge({ on(event, callback) { if (event === 'tool_call') handler = callback; } });
if (!handler) throw new Error('tool_call handler was not registered');
const prompts = [];
const ctx = { ui: { confirm: async (title, message) => { prompts.push({ title, message }); return false; } } };
process.env.CODEM_PI_PERMISSION_MODE = 'default';
const longPath = `src/${'p'.repeat(300)}.txt`;
const writeResult = await handler({ toolName: 'write', input: { path: longPath, content: 'FILE-CONTENT-SECRET' } }, ctx);
const bashResult = await handler({ toolName: 'bash', input: { command: 'TOKEN=ENV-VALUE-SECRET\\ PART npm test -- --watch' } }, ctx);
process.env.CODEM_PI_PERMISSION_MODE = 'auto';
const autoResult = await handler({ toolName: 'edit', input: { path: 'src/main.rs', oldText: 'OLD-CONTENT-SECRET', newText: 'NEW-CONTENT-SECRET' } }, ctx);
process.env.CODEM_PI_PERMISSION_MODE = 'bypassPermissions';
const bypassResult = await handler({ toolName: 'bash', input: { command: 'echo BYPASS-SECRET' } }, ctx);
process.stdout.write(JSON.stringify({ prompts, writeResult, bashResult, autoResult, bypassResult, longPath }));
"#,
        )
        .unwrap();
        let output = std::process::Command::new("node")
            .arg(&harness)
            .arg(&bridge)
            .output()
            .expect("run Pi bridge harness");
        assert!(
            output.status.success(),
            "bridge harness failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let result: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(result["prompts"].as_array().unwrap().len(), 2);
        assert_eq!(result["writeResult"]["block"], true);
        assert_eq!(result["bashResult"]["block"], true);
        assert!(result.get("autoResult").is_none());
        assert!(result.get("bypassResult").is_none());
        let prompts = result["prompts"].as_array().unwrap();
        assert!(prompts[0]["message"].as_str().unwrap().chars().count() <= 246);
        assert!(prompts[1]["message"].as_str().unwrap().chars().count() <= 89);
        assert_ne!(prompts[0]["message"].as_str(), result["longPath"].as_str());
        let confirmation_copy = result["prompts"].to_string();
        for secret in [
            "FILE-CONTENT-SECRET",
            "ENV-VALUE-SECRET",
            "OLD-CONTENT-SECRET",
            "NEW-CONTENT-SECRET",
            "BYPASS-SECRET",
        ] {
            assert!(!confirmation_copy.contains(secret));
        }
        assert!(confirmation_copy.contains("npm"));
        assert!(!confirmation_copy.contains("PART"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pi_extension_bridge_is_written_to_isolated_runtime_and_loaded_with_e() {
        let root =
            std::env::temp_dir().join(format!("codem-pi-bridge-runtime-{}", uuid::Uuid::new_v4()));
        let environment = BTreeMap::from([(
            "PI_CODING_AGENT_DIR".to_string(),
            root.to_string_lossy().to_string(),
        )]);

        let bridge = super::write_pi_bridge_extension(&environment).unwrap();

        assert_eq!(bridge, root.join("extensions").join("codem-bridge.js"));
        assert_eq!(
            fs::read_to_string(&bridge).unwrap(),
            include_str!("../resources/pi/codem-bridge.js")
        );
        assert_eq!(
            pi_rpc_arguments(Some("session-pi-1"), &bridge),
            vec![
                "--mode",
                "rpc",
                "-e",
                bridge.to_string_lossy().as_ref(),
                "--session",
                "session-pi-1",
            ]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pi_input_and_runtime_events_preserve_multimodal_and_tool_semantics() {
        let blocks = normalize_agent_input(
            None,
            Some(vec![
                AgentInputContentBlock::Text {
                    text: "检查项目".to_string(),
                },
                AgentInputContentBlock::Image {
                    id: None,
                    path: None,
                    name: Some("shot.png".to_string()),
                    mime_type: Some("image/png".to_string()),
                    size: Some(5),
                    data: Some("aGVsbG8=".to_string()),
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
        .expect("normalize Pi input");
        let input = build_pi_prompt(&blocks, Path::new("D:/workspace")).expect("build Pi input");
        assert!(input.message.contains("检查项目"));
        assert!(input.message.contains("D:\\workspace\\README.md"));
        assert_eq!(input.images.len(), 1);
        assert_eq!(input.images[0].mime_type, "image/png");
        assert_eq!(input.images[0].data, "aGVsbG8=");

        let mut mapper = PiEventMapper::new("run-pi-1".to_string());
        let text = mapper.map_event(PiRuntimeEvent::TextDelta("hello".to_string()));
        assert!(matches!(
            text.events.as_slice(),
            [AgentRunEvent::Delta { text, .. }] if text == "hello"
        ));
        let thinking = mapper.map_event(PiRuntimeEvent::ThinkingDelta("reasoning".to_string()));
        assert!(matches!(
            thinking.events.as_slice(),
            [AgentRunEvent::ThinkingDelta { text, .. }] if text == "reasoning"
        ));
        let tool = mapper.map_event(PiRuntimeEvent::ToolStart {
            tool_call_id: "tool-1".to_string(),
            tool_name: "read".to_string(),
            args: json!({"path": "README.md"}),
        });
        assert!(matches!(
            tool.events.as_slice(),
            [AgentRunEvent::ToolStart { tool_use_id, .. }] if tool_use_id == "tool-1"
        ));
        let result = mapper.map_event(PiRuntimeEvent::ToolEnd {
            tool_call_id: "tool-1".to_string(),
            tool_name: "read".to_string(),
            result: json!({"content": [{"type": "text", "text": "ok"}]}),
            is_error: false,
        });
        assert!(matches!(
            result.events.as_slice(),
            [
                AgentRunEvent::ToolResult { tool_use_id, .. },
                AgentRunEvent::ToolStop { .. }
            ] if tool_use_id == "tool-1"
        ));
        let retry = mapper.map_event(PiRuntimeEvent::AgentEnd { will_retry: true });
        assert!(!retry.settled);
        assert!(matches!(
            retry.events.as_slice(),
            [AgentRunEvent::Status { message, .. }] if message.contains("重试")
        ));
    }

    #[test]
    fn pi_rpc_startup_restores_session_and_requires_provider_qualified_model() {
        assert_eq!(
            pi_rpc_arguments(Some("session-pi-1"), Path::new("bridge.js")),
            vec![
                "--mode",
                "rpc",
                "-e",
                "bridge.js",
                "--session",
                "session-pi-1"
            ]
        );
        assert_eq!(
            pi_model_parts("anthropic/claude-sonnet-4"),
            Some(("anthropic", "claude-sonnet-4"))
        );
        assert_eq!(pi_model_parts("claude-sonnet-4"), None);
    }

    #[test]
    fn pi_session_stats_map_to_unified_usage() {
        let usage = pi_usage_snapshot(&json!({
            "tokens": {
                "input": 120,
                "output": 45,
                "cacheRead": 30,
                "cacheWrite": 10
            },
            "contextTokens": 2048,
            "cost": 0.0125
        }));
        assert_eq!(usage.input_tokens, Some(120));
        assert_eq!(usage.output_tokens, Some(45));
        assert_eq!(usage.cache_read_input_tokens, Some(30));
        assert_eq!(usage.cache_creation_input_tokens, Some(10));
        assert_eq!(usage.model_context_window, Some(2048));
        assert_eq!(usage.total_cost_usd, Some(0.0125));
    }

    #[test]
    fn pi_models_map_to_dynamic_catalog_with_thinking_levels() {
        let model = PiModel {
            id: "claude-sonnet-4".to_string(),
            name: "Claude Sonnet 4".to_string(),
            provider: "anthropic".to_string(),
            reasoning: true,
            input: vec!["text".to_string()],
            context_window: Some(200_000),
        };
        let catalog = pi_model_catalog(
            &PiState {
                model: Some(model.clone()),
                thinking_level: "high".to_string(),
                is_streaming: false,
                session_file: None,
                session_id: "session-1".to_string(),
            },
            vec![model],
            vec!["off".to_string(), "high".to_string()],
        );
        assert_eq!(
            catalog.default_model_id.as_deref(),
            Some("anthropic/claude-sonnet-4")
        );
        assert_eq!(catalog.models[0].context_window_tokens, Some(200_000));
        assert_eq!(
            catalog.models[0].default_reasoning_effort.as_deref(),
            Some("high")
        );
        assert_eq!(
            catalog.models[0]
                .supported_reasoning_efforts
                .iter()
                .map(|effort| effort.id.as_str())
                .collect::<Vec<_>>(),
            vec!["off", "high"]
        );
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
                    input: AgentDriverInput::Acp(Vec::new()),
                    cancel,
                    control,
                },
            )
            .expect_err("concurrent run must fail");

        assert_eq!(error.status, axum::http::StatusCode::CONFLICT);
    }

    #[test]
    fn hot_codex_runtime_dispatches_compact_over_existing_actor() {
        let state = test_run_state();
        let config = test_codex_runtime_config();
        let (command, mut commands) = mpsc::unbounded_channel();
        insert_test_codex_runtime(&state, AgentRuntimePhase::Ready, None, command);

        state
            .dispatch_compact(
                "thread-1".to_string(),
                config,
                "provider-thread-1".to_string(),
                AgentRuntimeCompact {
                    run_id: "run-compact-1".to_string(),
                    operation_id: "compact-1".to_string(),
                },
            )
            .expect("dispatch compact");

        assert!(matches!(
            commands.try_recv(),
            Ok(AgentRuntimeCommand::Compact(AgentRuntimeCompact { operation_id, .. }))
                if operation_id == "compact-1"
        ));
    }

    #[test]
    fn backend_rejects_compact_while_thread_operation_is_active() {
        let state = test_run_state();
        let (command, _commands) = mpsc::unbounded_channel();
        insert_test_codex_runtime(&state, AgentRuntimePhase::Running, Some("run-1"), command);

        let error = state
            .dispatch_compact(
                "thread-1".to_string(),
                test_codex_runtime_config(),
                "provider-thread-1".to_string(),
                AgentRuntimeCompact {
                    run_id: "run-compact-2".to_string(),
                    operation_id: "compact-2".to_string(),
                },
            )
            .expect_err("duplicate operation must fail");

        assert_eq!(error.status, StatusCode::CONFLICT);
    }

    #[test]
    fn backend_rejects_compact_for_non_codex_runtime() {
        let state = test_run_state();
        let error = state
            .dispatch_compact(
                "thread-1".to_string(),
                test_runtime_config(),
                "provider-thread-1".to_string(),
                AgentRuntimeCompact {
                    run_id: "run-compact-1".to_string(),
                    operation_id: "compact-1".to_string(),
                },
            )
            .expect_err("non-Codex runtime must fail");

        assert_eq!(error.status, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn backend_rejects_compact_when_session_or_config_does_not_match() {
        let state = test_run_state();
        let (command, _commands) = mpsc::unbounded_channel();
        insert_test_codex_runtime(&state, AgentRuntimePhase::Ready, None, command);

        let session_error = state
            .dispatch_compact(
                "thread-1".to_string(),
                test_codex_runtime_config(),
                "provider-thread-other".to_string(),
                AgentRuntimeCompact {
                    run_id: "run-compact-session".to_string(),
                    operation_id: "compact-session".to_string(),
                },
            )
            .expect_err("mismatched session must fail");
        assert_eq!(session_error.status, StatusCode::CONFLICT);

        let mut changed_config = test_codex_runtime_config();
        changed_config.channel_fingerprint = Some("channel-other".to_string());
        changed_config.working_directory = PathBuf::from("D:/other-workspace");
        let config_error = state
            .dispatch_compact(
                "thread-1".to_string(),
                changed_config,
                "provider-thread-1".to_string(),
                AgentRuntimeCompact {
                    run_id: "run-compact-config".to_string(),
                    operation_id: "compact-config".to_string(),
                },
            )
            .expect_err("mismatched config must fail");
        assert_eq!(config_error.status, StatusCode::CONFLICT);
    }

    #[test]
    fn compact_actor_rejects_a_different_resumed_session() {
        let compact = AgentRuntimeCommand::Compact(AgentRuntimeCompact {
            run_id: "run-compact-1".to_string(),
            operation_id: "compact-1".to_string(),
        });
        assert!(validate_compact_runtime_session(
            &compact,
            Some("provider-thread-1"),
            "provider-thread-1"
        )
        .is_ok());
        assert!(validate_compact_runtime_session(
            &compact,
            Some("provider-thread-1"),
            "provider-thread-other"
        )
        .is_err());
    }

    #[tokio::test]
    async fn compact_failure_event_precedes_terminal_error() {
        let state = test_run_state();
        let (cancel, _cancel_receiver) = watch::channel(false);
        let (control, _control_receiver) = mpsc::unbounded_channel();
        state
            .insert(
                "run-compact-1".to_string(),
                AgentRunRecord {
                    provider_id: OPENAI_CODEX_PROVIDER_ID.to_string(),
                    thread_id: Some("thread-1".to_string()),
                    events: Vec::new(),
                    finished: false,
                    terminal_emitted: false,
                    notify: Arc::new(Notify::new()),
                    cancel,
                    control,
                },
            )
            .expect("insert compact run");
        let command = AgentRuntimeCommand::Compact(AgentRuntimeCompact {
            run_id: "run-compact-1".to_string(),
            operation_id: "compact-1".to_string(),
        });

        push_compact_failure_event(&state, &command, Some("provider-thread-1"), "resume failed");
        state.push_terminal(
            "run-compact-1",
            AgentRunEvent::Error {
                run_id: "run-compact-1".to_string(),
                message: "resume failed".to_string(),
            },
        );

        let (events, finished) = state.snapshot_after("run-compact-1", 0).expect("events");
        assert!(finished);
        assert!(matches!(
            events.as_slice(),
            [
                AgentRunEvent::ContextCompaction {
                    status: AgentCompactionStatus::Failed,
                    error: Some(message),
                    ..
                },
                AgentRunEvent::Error { .. }
            ] if message == "resume failed"
        ));
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
                    input: AgentDriverInput::Acp(Vec::new()),
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
                    provider_id: "grok-build".to_string(),
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
                    provider_id: "grok-build".to_string(),
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
    fn public_acp_error_keeps_bounded_rpc_detail_for_agent_runs() {
        let error = AcpError::Rpc {
            code: 429,
            message: "All credentials for model grok-4.5 are cooling down".to_string(),
        };
        let message = public_acp_error(error);
        assert!(message.contains("429"));
        assert!(message.contains("cooling down"));

        let long_detail = "x".repeat(2_500);
        let truncated = public_acp_error(AcpError::Protocol(long_detail));
        assert!(truncated.ends_with('…'));
        assert!(truncated.chars().count() <= "ACP Provider 协议错误：".chars().count() + 2_001);
    }

    #[test]
    fn public_agent_errors_keep_details_for_each_transport_error() {
        let io_message = public_acp_error(AcpError::Io(std::io::Error::new(
            std::io::ErrorKind::ConnectionReset,
            "connection reset by peer api_key=sk-sensitive-value",
        )));
        assert!(io_message.contains("connection reset by peer"));
        assert!(!io_message.contains("sk-sensitive-value"));

        let json_message = public_acp_error(AcpError::Json(
            serde_json::from_str::<Value>("{invalid").expect_err("invalid JSON"),
        ));
        assert!(json_message.contains("line"));

        let timeout_message = public_acp_error(AcpError::Timeout("session/prompt"));
        assert!(timeout_message.contains("session/prompt"));

        let codex_message = public_codex_error(CodexAppServerError::Execution(
            "upstream rejected request".to_string(),
        ));
        assert!(codex_message.contains("upstream rejected request"));
    }

    #[test]
    fn grok_internal_error_uses_system_channel_session_log_detail() {
        let root =
            std::env::temp_dir().join(format!("codem-grok-error-log-{}", uuid::Uuid::new_v4()));
        let logs = root.join("logs");
        std::fs::create_dir_all(&logs).unwrap();
        let started_at = Utc::now();
        let matching = json!({
            "ts": (started_at + chrono::Duration::milliseconds(1)).to_rfc3339(),
            "sid": "session-current",
            "lvl": "warn",
            "msg": "turn.terminal_failure",
            "ctx": {
                "message": "API error (status 429 Too Many Requests): All credentials for model grok-4.5 are cooling down\n\nRequest URL: https://api.example.com/v1/chat/completions"
            }
        });
        std::fs::write(logs.join("unified.jsonl"), format!("{matching}\n")).unwrap();
        let mut config = test_runtime_config();
        config
            .environment
            .insert("GROK_HOME".to_string(), root.to_string_lossy().to_string());

        let message = grok_acp_error_with_runtime_detail(
            &config,
            "session-current",
            started_at,
            &AcpError::Rpc {
                code: -32603,
                message: "Internal error".to_string(),
            },
        )
        .expect("matching Grok error detail");

        assert!(message.contains("429 Too Many Requests"));
        assert!(message.contains("cooling down"));
        assert!(!message.contains("Request URL"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn grok_log_detail_rejects_other_sessions_and_stale_turns() {
        let started_at = Utc::now();
        let log = [
            json!({
                "ts": (started_at - chrono::Duration::minutes(1)).to_rfc3339(),
                "sid": "session-current",
                "msg": "turn.terminal_failure",
                "ctx": { "message": "stale error" }
            }),
            json!({
                "ts": started_at.to_rfc3339(),
                "sid": "session-other",
                "msg": "turn.terminal_failure",
                "ctx": { "message": "other session error" }
            }),
        ]
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join("\n");

        assert!(find_grok_runtime_error_detail(&log, "session-current", started_at).is_none());
    }

    #[test]
    fn grok_log_detail_redacts_credentials_before_display() {
        let detail = sanitize_grok_runtime_error_detail(
            "upstream rejected Authorization: Bearer sk-secret-value api_key=another-secret abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        )
        .expect("sanitized detail");

        assert!(detail.contains("<redacted>"));
        assert!(!detail.contains("sk-secret-value"));
        assert!(!detail.contains("another-secret"));
        assert!(!detail.contains("abcdefghijklmnopqrstuvwxyz"));
    }

    #[test]
    fn grok_log_enrichment_only_handles_generic_internal_rpc_errors() {
        let mut config = test_runtime_config();
        config.channel_id = Some("channel-1".to_string());
        config
            .environment
            .insert("GROK_HOME".to_string(), "D:/missing".to_string());

        assert!(grok_acp_error_with_runtime_detail(
            &config,
            "session-1",
            Utc::now(),
            &AcpError::Rpc {
                code: 429,
                message: "Too Many Requests".to_string(),
            },
        )
        .is_none());
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
        let usage = mapper.map_event(AcpRuntimeEvent::Usage {
            usage: crate::agent_runtime::AgentUsageSnapshot {
                input_tokens: Some(53000),
                model_context_window: Some(200000),
                total_cost_usd: Some(0.045),
                ..Default::default()
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
            mapper
                .map_event(AcpRuntimeEvent::ThoughtChunk {
                    text: "checking".to_string()
                })
                .as_slice(),
            [AgentRunEvent::ThinkingDelta { text, .. }] if text == "checking"
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
            mapper
                .map_event(AcpRuntimeEvent::ThoughtChunk {
                    text: "more".to_string()
                })
                .as_slice(),
            [AgentRunEvent::ThinkingDelta { text, .. }] if text == "more"
        ));
        assert!(matches!(
            usage.as_slice(),
            [AgentRunEvent::Usage {
                usage,
                usage_source: "context",
                ..
            }] if usage.input_tokens == Some(53000)
                && usage.model_context_window == Some(200000)
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
                    provider_id: "grok-build".to_string(),
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
