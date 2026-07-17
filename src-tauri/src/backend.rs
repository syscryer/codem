use crate::acp::{probe_acp_agent, probe_acp_initialize};
use crate::agent_runtime::{
    agent_provider_registry, normalize_agent_permission_mode, AgentProviderRegistry,
    CLAUDE_CODE_PROVIDER_ID, GROK_BUILD_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID,
    OPENCODE_PROVIDER_ID,
};
use crate::codex_app_server::probe_codex_app_server;
use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{header::HeaderName, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use base64::{engine::general_purpose, Engine as _};
use bytes::Bytes;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    cmp::Ordering,
    env, fs,
    io::{BufRead, BufReader as StdBufReader},
    net::SocketAddr,
    path::{Component, Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

const CLAUDE_CLI_RECOMMENDED_VERSION: &str = "2.1.123";
const CLAUDE_CLI_UPDATE_COMMAND: &str = "claude update";
const CLAUDE_CLI_INSTALL_COMMAND: &str = "npm install -g @anthropic-ai/claude-code";
const CLAUDE_CLI_MACOS_INSTALL_COMMAND: &str =
    "/usr/bin/curl -fsSL https://claude.ai/install.sh | /bin/bash";
const CODEX_CLI_INSTALL_COMMAND: &str = "npm install -g @openai/codex@latest";
const GROK_CLI_INSTALL_COMMAND: &str = "irm https://x.ai/cli/install.ps1 | iex";
const OPENCODE_CLI_INSTALL_COMMAND: &str = "npm install -g opencode-ai@latest";
const NPM_REGISTRY_URL: &str = "https://registry.npmjs.org";
const NPM_MIRROR_REGISTRY_URL: &str = "https://registry.npmmirror.com";
const NPM_CONFIG_USER_AGENT_ENV: &str = "npm_config_user_agent";
#[cfg(any(target_os = "macos", test))]
const AGENT_LIFECYCLE_PROXY_ENV_NAMES: &[&str] = &[
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
];
const CLAUDE_CLI_SETUP_URL: &str = "https://docs.anthropic.com/en/docs/claude-code/setup";
const RUN_RECONNECT_RETENTION_MS: u64 = 10 * 60 * 1000;

#[derive(Clone)]
struct AppState {
    app_data_dir: Arc<PathBuf>,
    settings_write_lock: Arc<Mutex<()>>,
    agent_channels: crate::agent_channels::AgentChannelService,
    agent_lifecycle_running: Arc<tokio::sync::Mutex<std::collections::HashSet<String>>>,
    agent_runs: crate::agent_run::AgentRunService,
    workspace_write_lock: Arc<Mutex<()>>,
    workspace_database_init_lock: Arc<Mutex<()>>,
    runs: Arc<Mutex<std::collections::HashMap<String, ActiveRunRecord>>>,
    runtimes: Arc<Mutex<std::collections::HashMap<String, ClaudeRuntimeRecord>>>,
    context_requests: Arc<Mutex<std::collections::HashMap<String, ClaudeContextRequestRecord>>>,
}

#[derive(Clone)]
struct ActiveRunRecord {
    run_id: String,
    thread_id: String,
    turn_id: Option<String>,
    prompt: String,
    user_content_blocks: Option<Value>,
    working_directory: String,
    session_id: Option<String>,
    permission_mode: String,
    model: Option<String>,
    effort: Option<String>,
    channel_id: Option<String>,
    started_at_ms: i64,
    events: Vec<Value>,
    finished: bool,
    child_id: Option<u32>,
    stdin: Option<Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>>,
    notify: Arc<tokio::sync::Notify>,
    collected_result: String,
    saw_done: bool,
    control_request_tool_use_ids: std::collections::HashMap<String, Option<String>>,
    emitted_request_user_input_keys: std::collections::HashSet<String>,
    emitted_approval_request_keys: std::collections::HashSet<String>,
    emitted_recovery_hint_keys: std::collections::HashSet<String>,
    paused_for_user_input: bool,
    block_type_by_index: std::collections::HashMap<i64, String>,
    tool_input_accumulators: std::collections::HashMap<i64, ToolInputAccumulator>,
    last_phase_event: Option<Value>,
}

#[derive(Clone, Debug)]
struct ToolInputAccumulator {
    name: String,
    tool_use_id: Option<String>,
    parent_tool_use_id: Option<String>,
    is_sidechain: bool,
    input_text: String,
    emitted_request_user_input: bool,
    emitted_approval_request: bool,
}

#[derive(Clone)]
struct ClaudeRuntimeRecord {
    thread_id: String,
    working_directory: String,
    permission_mode: String,
    model: Option<String>,
    effort: Option<String>,
    channel_id: Option<String>,
    channel_fingerprint: Option<String>,
    session_id: Option<String>,
    child_id: u32,
    stdin: Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>,
    current_run_id: Option<String>,
    closed: bool,
}

struct ClaudeContextRequestRecord {
    requested_at_ms: i64,
    event_count: i64,
    assistant_texts: Vec<String>,
    stderr_lines: Vec<String>,
    responder: Option<tokio::sync::oneshot::Sender<Result<Value, ClaudeContextRequestError>>>,
}

#[derive(Debug)]
struct ClaudeContextRequestError {
    code: &'static str,
    message: String,
    status: StatusCode,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
    json_body: bool,
}

#[derive(Debug)]
struct ProjectRow {
    id: String,
    path: String,
    name: String,
    created_at: String,
    updated_at: String,
    pinned_at: Option<String>,
}

#[derive(Debug)]
struct ThreadRow {
    id: String,
    project_id: String,
    provider: String,
    title: String,
    session_id: Option<String>,
    transcript_path: Option<String>,
    working_directory: String,
    model: Option<String>,
    reasoning_effort: Option<String>,
    permission_mode: Option<String>,
    agent_channel_id: Option<String>,
    agent_channel_fingerprint: Option<String>,
    imported: bool,
    updated_at: String,
    pinned_at: Option<String>,
}

#[derive(Debug)]
struct ThreadDetailRow {
    project_id: String,
    provider: String,
    session_id: Option<String>,
    transcript_path: Option<String>,
    working_directory: String,
    model: Option<String>,
    reasoning_effort: Option<String>,
    permission_mode: Option<String>,
    agent_channel_id: Option<String>,
    agent_channel_fingerprint: Option<String>,
}

#[derive(Debug)]
struct ClaudeSessionMetadata {
    session_id: String,
    cwd: String,
    transcript_path: String,
    updated_at: String,
    session_label: Option<String>,
    last_prompt: Option<String>,
    first_user_text: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
}

#[derive(Debug)]
struct MessageRow {
    turn_id: String,
    turn_sort: i64,
    item_sort: i64,
    role: String,
    item_type: Option<String>,
    content: String,
    status: Option<String>,
    activity: Option<String>,
    metrics: Option<String>,
    session_id: Option<String>,
    phase: Option<String>,
    started_at_ms: Option<i64>,
    duration_ms: Option<i64>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    cache_creation_input_tokens: Option<i64>,
    cache_read_input_tokens: Option<i64>,
    context_usage_json: Option<String>,
    total_cost_usd: Option<f64>,
    pending_approval_requests_json: Option<String>,
    user_attachments_json: Option<String>,
    user_content_blocks_json: Option<String>,
}

#[derive(Debug)]
struct ToolCallRow {
    turn_id: String,
    turn_sort: i64,
    item_sort: i64,
    tool_id: String,
    name: String,
    title: String,
    status: String,
    tool_use_id: Option<String>,
    parent_tool_use_id: Option<String>,
    is_sidechain: bool,
    input_text: Option<String>,
    result_text: Option<String>,
    is_error: bool,
    subtools_json: Option<String>,
    sub_messages_json: Option<String>,
}

#[derive(Deserialize)]
struct ProjectCreateRequest {
    path: Option<String>,
}

#[derive(Deserialize)]
struct RenameRequest {
    name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadCreateRequest {
    title: Option<String>,
    provider_id: Option<String>,
    permission_mode: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    channel_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectionRequest {
    project_id: Option<String>,
    thread_id: Option<String>,
}

#[derive(Deserialize)]
struct PanelPatchRequest {
    #[serde(rename = "organizeBy")]
    organize_by: Option<String>,
    #[serde(rename = "sortBy")]
    sort_by: Option<String>,
    visibility: Option<String>,
}

#[derive(Deserialize)]
struct PinRequest {
    pinned: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectDirectoryRequest {
    initial_path: Option<String>,
}

#[derive(Deserialize)]
struct OpenPathRequest {
    path: Option<String>,
    mode: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCloneRequest {
    repo_url: Option<String>,
    base_directory: Option<String>,
    folder_name: Option<String>,
}

#[derive(Deserialize)]
struct ProjectFilesQuery {
    path: Option<String>,
}

#[derive(Deserialize)]
struct ProjectFileDeleteRequest {
    path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeRunRequest {
    thread_id: Option<String>,
    turn_id: Option<String>,
    prompt: Option<String>,
    working_directory: Option<String>,
    session_id: Option<String>,
    permission_mode: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    channel_id: Option<String>,
    tool_result: Option<Value>,
    content_blocks: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentLifecycleRequest {
    provider_id: Option<String>,
    action: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct AgentLifecyclePlan {
    display_command: String,
    program: String,
    args: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
struct AgentLatestVersionCheck {
    latest_version: Option<String>,
    error: Option<String>,
}

enum AgentLifecycleProcessError {
    Timeout,
    Start(String),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileSearchQuery {
    working_directory: Option<String>,
    query: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileResolveQuery {
    working_directory: Option<String>,
    path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImageAttachmentRequest {
    working_directory: Option<String>,
    file_name: Option<String>,
    mime_type: Option<String>,
    data_url: Option<String>,
}

#[derive(Deserialize)]
struct ImageFromPathRequest {
    path: Option<String>,
}

#[derive(Deserialize)]
struct PreviewQuery {
    path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitDiffSummary {
    additions: u32,
    deletions: u32,
    files_changed: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitInfo {
    is_git_repo: bool,
    branch: Option<String>,
    diff: GitDiffSummary,
}

struct ParsedImageData {
    mime_type: String,
    extension: String,
    bytes: Vec<u8>,
}

impl ApiError {
    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
            json_body: false,
        }
    }

    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
            json_body: false,
        }
    }

    fn bad_request_json(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
            json_body: true,
        }
    }

    fn internal_json(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
            json_body: true,
        }
    }

    fn conflict(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message: message.into(),
            json_body: false,
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
            json_body: false,
        }
    }

    fn into_json_body(mut self) -> Self {
        self.json_body = true;
        self
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        if self.json_body {
            (self.status, Json(json!({ "error": self.message }))).into_response()
        } else {
            (self.status, self.message).into_response()
        }
    }
}

type ApiResult<T> = Result<T, ApiError>;

pub fn run_from_env_blocking() -> Result<(), String> {
    let port = env::var("CODEM_BACKEND_PORT")
        .ok()
        .or_else(|| env::var("PORT").ok())
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(3001);
    let app_data_dir = resolve_app_data_dir()?;
    run_blocking_with_config(port, app_data_dir)
}

pub fn run_blocking_with_config(port: u16, app_data_dir: PathBuf) -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("启动 Rust 后端运行时失败: {error}"))?;

    runtime.block_on(run_with_config(port, app_data_dir))
}

async fn run_with_config(port: u16, app_data_dir: PathBuf) -> Result<(), String> {
    fs::create_dir_all(&app_data_dir).map_err(|error| format!("创建应用数据目录失败: {error}"))?;

    let secrets = crate::ordinary_chat::secrets::SecretStore::new(app_data_dir.clone());
    let ordinary_chat = crate::ordinary_chat::OrdinaryChatService::with_secrets(
        app_data_dir.clone(),
        secrets.clone(),
    );
    let agent_channels =
        crate::agent_channels::AgentChannelService::new(app_data_dir.clone(), secrets);
    let agent_runs = crate::agent_run::AgentRunService::new(
        resolve_grok_command,
        resolve_codex_command,
        resolve_opencode_command,
        agent_channels.clone(),
    );
    let state = AppState {
        app_data_dir: Arc::new(app_data_dir),
        settings_write_lock: Arc::new(Mutex::new(())),
        agent_channels: agent_channels.clone(),
        agent_lifecycle_running: Arc::new(
            tokio::sync::Mutex::new(std::collections::HashSet::new()),
        ),
        agent_runs,
        workspace_write_lock: Arc::new(Mutex::new(())),
        workspace_database_init_lock: Arc::new(Mutex::new(())),
        runs: Arc::new(Mutex::new(std::collections::HashMap::new())),
        runtimes: Arc::new(Mutex::new(std::collections::HashMap::new())),
        context_requests: Arc::new(Mutex::new(std::collections::HashMap::new())),
    };
    let app = create_router(state)
        .merge(crate::ordinary_chat::router(ordinary_chat))
        .merge(crate::agent_channels::router(agent_channels))
        .layer(desktop_cors_layer());
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|error| format!("监听 Rust 后端端口失败: {error}"))?;

    println!("CodeM Rust backend listening on http://{address}");
    axum::serve(listener, app)
        .await
        .map_err(|error| format!("Rust 后端服务异常退出: {error}"))
}

fn create_router(state: AppState) -> Router {
    let agent_run_router = crate::agent_run::router(state.agent_runs.clone());
    Router::new()
        .route("/api/runtime/identity", get(runtime_identity))
        .route("/api/health", get(health))
        .route("/api/agents/providers", get(agent_providers))
        .route(
            "/api/agents/settings-diagnostics",
            get(agent_settings_diagnostics),
        )
        .route("/api/agents/latest-version", get(agent_latest_version))
        .route("/api/agents/lifecycle", post(agent_lifecycle_action))
        .route("/api/agents/grok/probe", post(grok_acp_probe))
        .route("/api/agents/codex/probe", post(codex_app_server_probe))
        .route("/api/agents/opencode/probe", post(opencode_acp_probe))
        .route("/api/claude/models", get(claude_models))
        .route("/api/settings", get(get_settings))
        .route("/api/settings/appearance", put(update_appearance_settings))
        .route("/api/settings/general", put(update_general_settings))
        .route("/api/settings/models", put(update_model_settings))
        .route("/api/settings/shortcuts", put(update_shortcut_settings))
        .route("/api/settings/open-with", put(update_open_with_settings))
        .route(
            "/api/agents/runtime-settings",
            get(get_agent_runtime_settings).put(update_agent_runtime_settings),
        )
        .route("/api/claude/version-info", get(claude_version_info))
        .route(
            "/api/claude/system-prompt",
            get(get_claude_system_prompt).put(update_claude_system_prompt),
        )
        .route("/api/mcp/servers", get(mcp_servers))
        .route("/api/mcp/configs", get(mcp_configs))
        .route("/api/mcp/configs/{scope}", put(update_mcp_config))
        .route("/api/mcp/open", post(open_mcp_config))
        .route("/api/skills", get(skills_overview))
        .route("/api/plugins/installed", get(installed_plugins))
        .route("/api/plugins/marketplaces", get(plugin_marketplaces))
        .route("/api/plugins/skills", get(plugin_skills))
        .route(
            "/api/plugins/skills/install-from-path",
            post(plugin_install_skill_from_path),
        )
        .route(
            "/api/plugins/skills/install-builtin",
            post(plugin_install_builtin_skill),
        )
        .route("/api/plugins/skills/delete", post(plugin_delete_skill))
        .route("/api/plugins/skills/open", post(plugin_open_skill))
        .route("/api/plugins/command", post(plugin_command))
        .route("/api/slash-commands", get(slash_commands))
        .route("/api/claude/run", post(claude_run))
        .route(
            "/api/claude/runs/active/{thread_id}",
            get(claude_active_run),
        )
        .route("/api/claude/run/{run_id}/events", get(claude_run_events))
        .route("/api/claude/run/{run_id}/ack", post(claude_run_ack))
        .route("/api/claude/run/{run_id}/guide", post(claude_run_guide))
        .route(
            "/api/claude/run/{run_id}/request-user-input",
            post(claude_run_request_user_input),
        )
        .route(
            "/api/claude/run/{run_id}/approval-decision",
            post(claude_run_approval_decision),
        )
        .route(
            "/api/claude/run/{run_id}/interrupt",
            post(claude_run_interrupt),
        )
        .route("/api/claude/run/{run_id}", delete(claude_run_cancel))
        .route(
            "/api/claude/runtime/{thread_id}/close",
            post(claude_runtime_close),
        )
        .route(
            "/api/claude/runtime/{thread_id}/context",
            post(claude_runtime_context),
        )
        .route("/api/claude/runtimes", get(claude_runtimes))
        .route("/api/open-with/targets", get(open_with_targets))
        .route("/api/usage", get(usage_stats))
        .route("/api/workspace/bootstrap", get(workspace_bootstrap))
        .route("/api/workspace/selection", post(update_workspace_selection))
        .route("/api/workspace/panel", patch(update_workspace_panel))
        .route("/api/system/select-directory", post(select_directory))
        .route("/api/system/open-path", post(open_system_path))
        .route("/api/system/files/search", get(search_system_files))
        .route("/api/system/files/resolve", get(resolve_system_file))
        .route("/api/system/attachments/image", post(save_image_attachment))
        .route(
            "/api/system/attachments/image-from-path",
            post(read_image_attachment_from_path),
        )
        .route("/api/system/image-preview", get(image_preview))
        .route("/api/system/file-preview", get(file_preview))
        .route("/api/git/clone", post(git_clone))
        .route("/api/projects/{project_id}/git", get(project_git_summary))
        .route(
            "/api/projects/{project_id}/git/status",
            get(project_git_status),
        )
        .route(
            "/api/projects/{project_id}/git/branches",
            get(project_git_branches),
        )
        .route(
            "/api/projects/{project_id}/git/history",
            get(project_git_history),
        )
        .route(
            "/api/projects/{project_id}/git/history/log",
            get(project_git_history_log),
        )
        .route(
            "/api/projects/{project_id}/git/history/compare",
            get(project_git_history_compare),
        )
        .route(
            "/api/projects/{project_id}/git/history/commit",
            get(project_git_commit_details),
        )
        .route(
            "/api/projects/{project_id}/git/history/file",
            get(project_git_commit_file),
        )
        .route("/api/projects/{project_id}/git/diff", get(project_git_diff))
        .route(
            "/api/projects/{project_id}/git/operation-state",
            get(project_git_operation_state),
        )
        .route(
            "/api/projects/{project_id}/git/conflicts/file",
            get(project_git_conflict_file),
        )
        .route(
            "/api/projects/{project_id}/git/conflicts/save-result",
            post(project_git_conflict_save_result),
        )
        .route(
            "/api/projects/{project_id}/git/conflicts/mark-resolved",
            post(project_git_conflict_mark_resolved),
        )
        .route(
            "/api/projects/{project_id}/git/operation/continue",
            post(project_git_operation_continue),
        )
        .route(
            "/api/projects/{project_id}/git/operation/abort",
            post(project_git_operation_abort),
        )
        .route(
            "/api/projects/{project_id}/git/add-files",
            post(project_git_add_files),
        )
        .route(
            "/api/projects/{project_id}/git/revert-file",
            post(project_git_revert_file),
        )
        .route(
            "/api/projects/{project_id}/git/commit",
            post(project_git_commit),
        )
        .route(
            "/api/projects/{project_id}/git/push-preview",
            get(project_git_push_preview),
        )
        .route(
            "/api/projects/{project_id}/git/push",
            post(project_git_push),
        )
        .route(
            "/api/projects/{project_id}/git/fetch",
            post(project_git_fetch),
        )
        .route(
            "/api/projects/{project_id}/git/pull",
            post(project_git_pull),
        )
        .route(
            "/api/projects/{project_id}/git/switch",
            post(project_git_switch),
        )
        .route(
            "/api/projects/{project_id}/git/branch",
            post(project_git_branch),
        )
        .route("/api/projects/{project_id}/git/tag", post(project_git_tag))
        .route(
            "/api/projects/{project_id}/git/branch/delete",
            post(project_git_delete_branch),
        )
        .route(
            "/api/projects/{project_id}/git/cherry-pick",
            post(project_git_cherry_pick),
        )
        .route(
            "/api/projects/{project_id}/git/checkout-detached",
            post(project_git_checkout_detached),
        )
        .route(
            "/api/projects/{project_id}/git/undo-turn-changes",
            post(project_git_undo_turn_changes),
        )
        .route(
            "/api/projects/{project_id}/git/worktrees",
            get(project_git_worktrees)
                .post(project_git_create_worktree)
                .delete(project_git_delete_worktree),
        )
        .route(
            "/api/projects/{project_id}/git/worktrees/suggest-path",
            get(project_git_suggest_worktree_path),
        )
        .route("/api/projects", post(create_project))
        .route(
            "/api/projects/{project_id}",
            patch(rename_project).delete(delete_project),
        )
        .route("/api/projects/{project_id}/open", post(open_project))
        .route(
            "/api/projects/{project_id}/open-editor",
            post(open_project_editor),
        )
        .route(
            "/api/projects/{project_id}/files",
            get(list_project_files).delete(delete_project_file),
        )
        .route("/api/projects/{project_id}/threads", post(create_thread))
        .route("/api/projects/{project_id}/pin", post(pin_project))
        .route(
            "/api/threads/{thread_id}",
            patch(update_thread).delete(delete_thread),
        )
        .route("/api/threads/{thread_id}/pin", post(pin_thread))
        .route(
            "/api/threads/{thread_id}/history",
            get(get_thread_history).put(save_thread_history),
        )
        .with_state(state)
        .merge(agent_run_router)
}

fn desktop_cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _| {
            is_allowed_local_origin(origin)
        }))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
        ])
        .expose_headers([HeaderName::from_static("x-codem-agent-run-id")])
        .allow_headers(Any)
}

fn is_allowed_local_origin(origin: &HeaderValue) -> bool {
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    if matches!(
        origin,
        "http://tauri.localhost" | "https://tauri.localhost" | "tauri://localhost"
    ) {
        return true;
    }
    let Some((scheme, rest)) = origin.split_once("://") else {
        return false;
    };
    if !matches!(scheme, "http" | "https" | "tauri") {
        return false;
    }
    let host_port = rest
        .split_once('/')
        .map(|(host, _)| host)
        .unwrap_or(rest)
        .split_once('@')
        .map(|(_, host)| host)
        .unwrap_or(rest);
    let host = host_port
        .rsplit_once(':')
        .map(|(host, _)| host)
        .unwrap_or(host_port);
    matches!(host, "127.0.0.1" | "localhost")
}

async fn runtime_identity() -> Json<Value> {
    Json(json!({
        "app": "codem",
        "backend": "rust",
    }))
}

async fn health() -> Json<Value> {
    Json(match resolve_claude_command() {
        Some(command) => json!({
            "available": true,
            "command": command,
        }),
        None => json!({
            "available": false,
            "error": "未找到 claude 命令",
        }),
    })
}

async fn agent_providers(State(state): State<AppState>) -> Json<AgentProviderRegistry> {
    Json(agent_provider_registry(
        resolve_claude_command().is_some(),
        state
            .agent_runs
            .resolve_command(GROK_BUILD_PROVIDER_ID, false)
            .is_some(),
        state
            .agent_runs
            .resolve_command(OPENAI_CODEX_PROVIDER_ID, false)
            .is_some(),
        state
            .agent_runs
            .resolve_command(OPENCODE_PROVIDER_ID, false)
            .is_some(),
    ))
}

async fn agent_settings_diagnostics(
    State(state): State<AppState>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let provider_id = settings_provider_id(query.get("providerId").map(String::as_str))?;
    let run_diagnostic = query.get("run").is_some_and(|value| value == "true");
    let command = if provider_id == CLAUDE_CODE_PROVIDER_ID {
        resolve_claude_command()
    } else {
        state.agent_runs.resolve_command(provider_id, true)
    };
    let version_output = command.as_deref().and_then(|command| {
        if provider_id == GROK_BUILD_PROVIDER_ID {
            read_grok_cli_version(command)
        } else {
            read_cli_version(command)
        }
    });
    let version = version_output
        .as_deref()
        .and_then(extract_agent_semantic_version)
        .or(version_output);
    let home = home_dir().ok_or_else(|| ApiError::internal("无法定位用户目录"))?;
    let config_directory = agent_global_config_directory(provider_id, &home);
    let install_command = build_agent_lifecycle_plan(provider_id, "install", None)?.display_command;
    let update_command =
        build_agent_lifecycle_plan(provider_id, "update", command.as_deref())?.display_command;
    let (diagnostic_command, diagnostic_args) = match provider_id {
        OPENAI_CODEX_PROVIDER_ID => ("codex doctor --json", Some(["doctor", "--json"])),
        GROK_BUILD_PROVIDER_ID => ("grok inspect --json", Some(["inspect", "--json"])),
        OPENCODE_PROVIDER_ID => ("opencode debug info", Some(["debug", "info"])),
        _ => ("claude doctor", None),
    };
    let diagnostic = if run_diagnostic {
        if let (Some(command), Some(arguments)) = (command.as_deref(), diagnostic_args) {
            let output = background_command(command).args(arguments).output();
            match output {
                Ok(output) => json!({
                    "available": true,
                    "success": output.status.success(),
                    "exitCode": output.status.code(),
                }),
                Err(_) => json!({
                    "available": false,
                    "success": false,
                }),
            }
        } else {
            json!({
                "available": command.is_some(),
                "success": Value::Null,
            })
        }
    } else {
        json!({
            "available": command.is_some(),
            "success": Value::Null,
        })
    };
    Ok(Json(json!({
        "providerId": provider_id,
        "installed": command.is_some(),
        "command": command,
        "version": version,
        "latestVersion": Value::Null,
        "updateAvailable": false,
        "versionCheckError": Value::Null,
        "configDirectory": config_directory,
        "skillsDirectory": config_directory.join("skills"),
        "updateCommand": update_command,
        "installCommand": install_command,
        "diagnosticCommand": diagnostic_command,
        "diagnostic": diagnostic,
        "capabilities": {
            "plugins": command.is_some() && provider_id != OPENCODE_PROVIDER_ID,
            "mcp": command.is_some(),
            "skills": true,
        }
    })))
}

async fn agent_latest_version(
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let provider_id = settings_provider_id(query.get("providerId").map(String::as_str))?;
    let current_version = query
        .get("currentVersion")
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let command = (provider_id == GROK_BUILD_PROVIDER_ID)
        .then(|| resolve_agent_settings_command(provider_id))
        .flatten();
    let latest_version_check = read_agent_latest_version(provider_id, command.as_deref()).await;
    let update_available = current_version
        .zip(latest_version_check.latest_version.as_deref())
        .is_some_and(|(current, latest)| compare_semantic_versions(current, latest) < 0);
    Ok(Json(json!({
        "providerId": provider_id,
        "latestVersion": latest_version_check.latest_version,
        "updateAvailable": update_available,
        "error": latest_version_check.error,
    })))
}

async fn read_agent_latest_version(
    provider_id: &str,
    installed_command: Option<&str>,
) -> AgentLatestVersionCheck {
    if provider_id == GROK_BUILD_PROVIDER_ID {
        let Some(command) = installed_command else {
            return AgentLatestVersionCheck {
                latest_version: None,
                error: Some("安装后可通过 Grok Build 官方更新器查询最新版本".to_string()),
            };
        };
        return read_grok_latest_version(command).await;
    }

    let package = match provider_id {
        CLAUDE_CODE_PROVIDER_ID => "@anthropic-ai/claude-code",
        OPENAI_CODEX_PROVIDER_ID => "@openai/codex",
        OPENCODE_PROVIDER_ID => "opencode-ai",
        _ => {
            return AgentLatestVersionCheck {
                latest_version: None,
                error: Some("当前 Agent 暂不支持版本查询".to_string()),
            };
        }
    };
    let client = match reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(4))
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            return AgentLatestVersionCheck {
                latest_version: None,
                error: Some("无法初始化版本查询".to_string()),
            };
        }
    };

    for registry in [NPM_REGISTRY_URL, NPM_MIRROR_REGISTRY_URL] {
        if let Ok(version) = fetch_npm_latest_version(&client, registry, package).await {
            return AgentLatestVersionCheck {
                latest_version: Some(version),
                error: None,
            };
        }
    }

    if provider_id == OPENCODE_PROVIDER_ID {
        if let Ok(version) = fetch_github_latest_version(&client, "anomalyco/opencode").await {
            return AgentLatestVersionCheck {
                latest_version: Some(version),
                error: None,
            };
        }
    }

    AgentLatestVersionCheck {
        latest_version: None,
        error: Some("官方源和国内镜像均无法查询最新版本".to_string()),
    }
}

async fn fetch_npm_latest_version(
    client: &reqwest::Client,
    registry: &str,
    package: &str,
) -> Result<String, ()> {
    let mut url = url::Url::parse(registry).map_err(|_| ())?;
    url.path_segments_mut()
        .map_err(|_| ())?
        .extend(["-", "package", package, "dist-tags"]);
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| ())?
        .error_for_status()
        .map_err(|_| ())?;
    let payload = response.json::<Value>().await.map_err(|_| ())?;
    parse_npm_latest_version(&payload).ok_or(())
}

fn parse_npm_latest_version(payload: &Value) -> Option<String> {
    payload
        .get("latest")
        .or_else(|| {
            payload
                .get("dist-tags")
                .and_then(|value| value.get("latest"))
        })
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

async fn fetch_github_latest_version(
    client: &reqwest::Client,
    repository: &str,
) -> Result<String, ()> {
    let response = client
        .get(format!(
            "https://api.github.com/repos/{repository}/releases/latest"
        ))
        .header("User-Agent", "CodeM")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| ())?
        .error_for_status()
        .map_err(|_| ())?;
    let payload = response.json::<Value>().await.map_err(|_| ())?;
    payload
        .get("tag_name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.strip_prefix('v').unwrap_or(value).to_string())
        .ok_or(())
}

async fn read_grok_latest_version(command: &str) -> AgentLatestVersionCheck {
    let mut process = background_tokio_command(command);
    process.args(["update", "--check", "--json"]);
    configure_agent_lifecycle_environment(GROK_BUILD_PROVIDER_ID, &mut process);
    process.kill_on_drop(true);
    let output =
        match tokio::time::timeout(std::time::Duration::from_secs(20), process.output()).await {
            Ok(Ok(output)) => output,
            Ok(Err(_)) => {
                return AgentLatestVersionCheck {
                    latest_version: None,
                    error: Some("无法启动 Grok Build 版本查询".to_string()),
                };
            }
            Err(_) => {
                return AgentLatestVersionCheck {
                    latest_version: None,
                    error: Some("Grok Build 版本查询超时".to_string()),
                };
            }
        };
    let output_text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        return AgentLatestVersionCheck {
            latest_version: None,
            error: Some("Grok Build 官方更新器查询失败".to_string()),
        };
    }
    parse_grok_latest_version(&output_text).unwrap_or(AgentLatestVersionCheck {
        latest_version: None,
        error: Some("Grok Build 返回了无法识别的版本信息".to_string()),
    })
}

fn parse_grok_latest_version(value: &str) -> Option<AgentLatestVersionCheck> {
    let payload = value
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with('{') && line.ends_with('}'))?;
    let payload = serde_json::from_str::<Value>(payload).ok()?;
    let latest_version = payload
        .get("latestVersion")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let error = payload
        .get("error")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("Grok Build 官方更新器查询失败：{value}"));
    Some(AgentLatestVersionCheck {
        latest_version,
        error,
    })
}

async fn agent_lifecycle_action(
    State(state): State<AppState>,
    Json(payload): Json<AgentLifecycleRequest>,
) -> ApiResult<Json<Value>> {
    let provider_id =
        settings_provider_id(payload.provider_id.as_deref()).map_err(ApiError::into_json_body)?;
    let action = match payload.action.as_deref().map(str::trim) {
        Some("install") => "install",
        Some("update") => "update",
        _ => return Err(ApiError::bad_request_json("不支持的 Agent 操作")),
    };
    let key = provider_id.to_string();
    {
        let mut running = state.agent_lifecycle_running.lock().await;
        if !running.insert(key.clone()) {
            return Err(ApiError::conflict("该 Agent 正在执行安装或更新").into_json_body());
        }
    }

    let result = execute_agent_lifecycle_action(provider_id, action)
        .await
        .map_err(ApiError::into_json_body);
    if result.is_ok() {
        state.agent_runs.resolve_command(provider_id, true);
    }
    state.agent_lifecycle_running.lock().await.remove(&key);
    result.map(Json)
}

async fn execute_agent_lifecycle_action(provider_id: &str, action: &str) -> ApiResult<Value> {
    let command = resolve_agent_settings_command(provider_id);
    if action == "update" && command.is_none() {
        return Err(ApiError::bad_request("Agent 尚未安装，请先执行安装"));
    }

    let plan = build_agent_lifecycle_plan(provider_id, action, command.as_deref())?;
    let mirror_eligible = lifecycle_plan_supports_npm_mirror(&plan);
    let primary = run_agent_lifecycle_plan(provider_id, &plan, None).await;
    let retry_with_mirror = match &primary {
        Ok(output) => {
            !output.status.success()
                && mirror_eligible
                && is_agent_lifecycle_network_failure(&agent_lifecycle_output_text(output))
        }
        Err(AgentLifecycleProcessError::Timeout) => mirror_eligible,
        Err(AgentLifecycleProcessError::Start(_)) => false,
    };
    let (output, used_mirror) = if retry_with_mirror {
        let output = run_agent_lifecycle_plan(provider_id, &plan, Some(NPM_MIRROR_REGISTRY_URL))
            .await
            .map_err(|error| match error {
                AgentLifecycleProcessError::Timeout => {
                    ApiError::internal("国内镜像重试超时，请检查网络后重试")
                }
                AgentLifecycleProcessError::Start(error) => {
                    ApiError::internal(format!("启动国内镜像重试失败: {error}"))
                }
            })?;
        (output, true)
    } else {
        let output = primary.map_err(|error| match error {
            AgentLifecycleProcessError::Timeout => {
                ApiError::internal("Agent 安装或更新超时，请查看安装命令输出")
            }
            AgentLifecycleProcessError::Start(error) => {
                ApiError::internal(format!("启动 Agent 安装或更新失败: {error}"))
            }
        })?;
        (output, false)
    };
    let output_text = agent_lifecycle_output_text(&output);
    let summary = sanitize_agent_lifecycle_output(&output_text);
    if !output.status.success() {
        return Err(ApiError::internal(format!(
            "Agent {}失败{}（退出码 {:?}）：{}",
            if action == "install" {
                "安装"
            } else {
                "更新"
            },
            if used_mirror {
                "，国内镜像重试仍未成功"
            } else {
                ""
            },
            output.status.code(),
            summary
        )));
    }
    let command = resolve_agent_settings_command(provider_id);
    let version = command.as_deref().and_then(|command| {
        if provider_id == GROK_BUILD_PROVIDER_ID {
            read_grok_cli_version(command)
        } else {
            read_cli_version(command)
        }
    });
    Ok(json!({
        "providerId": provider_id,
        "action": action,
        "installed": command.is_some(),
        "command": command,
        "version": version,
        "output": summary,
        "usedMirror": used_mirror,
        "mirrorRegistry": if used_mirror { Some(NPM_MIRROR_REGISTRY_URL) } else { None },
    }))
}

async fn run_agent_lifecycle_plan(
    provider_id: &str,
    plan: &AgentLifecyclePlan,
    registry: Option<&str>,
) -> Result<std::process::Output, AgentLifecycleProcessError> {
    let mut process = background_tokio_command(&plan.program);
    process.args(&plan.args);
    configure_agent_lifecycle_environment(provider_id, &mut process);
    if let Some(registry) = registry {
        process.env("NPM_CONFIG_REGISTRY", registry);
    }
    process.kill_on_drop(true);
    process.stdout(std::process::Stdio::piped());
    process.stderr(std::process::Stdio::piped());
    tokio::time::timeout(std::time::Duration::from_secs(15 * 60), process.output())
        .await
        .map_err(|_| AgentLifecycleProcessError::Timeout)?
        .map_err(|error| AgentLifecycleProcessError::Start(error.to_string()))
}

fn configure_agent_lifecycle_environment(provider_id: &str, process: &mut tokio::process::Command) {
    if provider_id == GROK_BUILD_PROVIDER_ID {
        process.env_remove(NPM_CONFIG_USER_AGENT_ENV);
    }
    #[cfg(target_os = "macos")]
    if provider_id == CLAUDE_CODE_PROVIDER_ID
        && !current_process_has_proxy_environment()
        && !command_has_proxy_environment(process)
    {
        let proxy_environment = resolve_macos_system_proxy_environment();
        apply_agent_lifecycle_proxy_environment(process, &proxy_environment, false);
    }
}

#[cfg(any(target_os = "macos", test))]
fn proxy_environment_name(name: &std::ffi::OsStr) -> bool {
    AGENT_LIFECYCLE_PROXY_ENV_NAMES
        .iter()
        .any(|candidate| name.eq_ignore_ascii_case(std::ffi::OsStr::new(candidate)))
}

#[cfg(any(target_os = "macos", test))]
fn proxy_environment_value_present(value: &std::ffi::OsStr) -> bool {
    !value.to_string_lossy().trim().is_empty()
}

#[cfg(any(target_os = "macos", test))]
fn current_process_has_proxy_environment() -> bool {
    env::vars_os().any(|(name, value)| {
        proxy_environment_name(&name) && proxy_environment_value_present(&value)
    })
}

#[cfg(any(target_os = "macos", test))]
fn command_has_proxy_environment(process: &tokio::process::Command) -> bool {
    process.as_std().get_envs().any(|(name, value)| {
        proxy_environment_name(name) && value.is_some_and(proxy_environment_value_present)
    })
}

#[cfg(any(target_os = "macos", test))]
fn apply_agent_lifecycle_proxy_environment(
    process: &mut tokio::process::Command,
    proxy_environment: &[(String, String)],
    inherited_proxy_present: bool,
) -> bool {
    if inherited_proxy_present
        || command_has_proxy_environment(process)
        || proxy_environment.is_empty()
    {
        return false;
    }
    for (name, value) in proxy_environment {
        process.env(name, value);
    }
    true
}

#[cfg(target_os = "macos")]
fn resolve_macos_system_proxy_environment() -> Vec<(String, String)> {
    let mut command = background_command("/usr/sbin/scutil");
    command.arg("--proxy");
    let Some(output) = command_output_with_timeout(&mut command, std::time::Duration::from_secs(2))
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    parse_macos_system_proxy_environment(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(any(target_os = "macos", test))]
fn parse_macos_system_proxy_environment(value: &str) -> Vec<(String, String)> {
    let mut settings = std::collections::HashMap::new();
    for line in value.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim();
        if !matches!(
            name,
            "HTTPEnable"
                | "HTTPProxy"
                | "HTTPPort"
                | "HTTPSEnable"
                | "HTTPSProxy"
                | "HTTPSPort"
                | "SOCKSEnable"
                | "SOCKSProxy"
                | "SOCKSPort"
        ) {
            continue;
        }
        settings.insert(name, value.trim());
    }

    let mut result = Vec::new();
    if settings.get("HTTPEnable") == Some(&"1") {
        if let Some(url) = macos_system_proxy_url(
            "http",
            settings.get("HTTPProxy").copied(),
            settings.get("HTTPPort").copied(),
        ) {
            result.push(("http_proxy".to_string(), url.clone()));
            result.push(("HTTP_PROXY".to_string(), url));
        }
    }
    if settings.get("HTTPSEnable") == Some(&"1") {
        if let Some(url) = macos_system_proxy_url(
            "http",
            settings.get("HTTPSProxy").copied(),
            settings.get("HTTPSPort").copied(),
        ) {
            result.push(("https_proxy".to_string(), url.clone()));
            result.push(("HTTPS_PROXY".to_string(), url));
        }
    }
    if settings.get("SOCKSEnable") == Some(&"1") {
        if let Some(url) = macos_system_proxy_url(
            "socks5h",
            settings.get("SOCKSProxy").copied(),
            settings.get("SOCKSPort").copied(),
        ) {
            result.push(("all_proxy".to_string(), url.clone()));
            result.push(("ALL_PROXY".to_string(), url));
        }
    }
    result
}

#[cfg(any(target_os = "macos", test))]
fn macos_system_proxy_url(scheme: &str, host: Option<&str>, port: Option<&str>) -> Option<String> {
    let host = host?.trim();
    if host.is_empty()
        || host.len() > 255
        || host
            .chars()
            .any(|value| value.is_control() || value.is_whitespace())
    {
        return None;
    }
    let port = port?.trim().parse::<u16>().ok()?;
    let host = if host.contains(':') && !(host.starts_with('[') && host.ends_with(']')) {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    Some(format!("{scheme}://{host}:{port}"))
}

fn lifecycle_plan_supports_npm_mirror(plan: &AgentLifecyclePlan) -> bool {
    Path::new(&plan.program)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "npm" | "pnpm" | "bun"))
        .unwrap_or(false)
}

fn agent_lifecycle_output_text(output: &std::process::Output) -> String {
    format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    )
}

fn is_agent_lifecycle_network_failure(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    [
        "eai_again",
        "econnreset",
        "econnrefused",
        "etimedout",
        "enotfound",
        "socket hang up",
        "network timeout",
        "network request to",
        "fetch failed",
        "could not resolve host",
        "unable to get local issuer certificate",
        "self signed certificate",
        "tls handshake",
        "ssl error",
        "proxy error",
        "connect timeout",
        "connection reset",
        "connection timed out",
        "failed to download",
    ]
    .iter()
    .any(|marker| value.contains(marker))
}

fn build_agent_lifecycle_plan(
    provider_id: &str,
    action: &str,
    installed_command: Option<&str>,
) -> ApiResult<AgentLifecyclePlan> {
    if action == "install" && provider_id == CLAUDE_CODE_PROVIDER_ID {
        return Ok(claude_install_lifecycle_plan(
            cfg!(target_os = "macos"),
            cfg!(target_os = "windows"),
        ));
    }
    if action == "update" && provider_id == CLAUDE_CODE_PROVIDER_ID && installed_command.is_none() {
        return Ok(claude_uninstalled_update_lifecycle_plan(
            cfg!(target_os = "macos"),
            cfg!(target_os = "windows"),
        ));
    }
    if action == "install" && provider_id == GROK_BUILD_PROVIDER_ID {
        #[cfg(target_os = "windows")]
        return Ok(lifecycle_plan(
            "powershell.exe",
            [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                GROK_CLI_INSTALL_COMMAND,
            ],
            GROK_CLI_INSTALL_COMMAND,
        ));
        #[cfg(not(target_os = "windows"))]
        return Ok(lifecycle_plan(
            "sh",
            ["-c", "curl -fsSL https://x.ai/cli/install.sh | bash"],
            "curl -fsSL https://x.ai/cli/install.sh | bash",
        ));
    }
    if action == "update" {
        if let Some(command) = installed_command {
            if provider_id == GROK_BUILD_PROVIDER_ID {
                return Ok(lifecycle_plan(
                    command,
                    ["update"],
                    &format!("{} update", quote_display_command(command)),
                ));
            }
            if provider_id == CLAUDE_CODE_PROVIDER_ID && is_native_claude_command(command) {
                return Ok(lifecycle_plan(
                    command,
                    ["update"],
                    &format!("{} update", quote_display_command(command)),
                ));
            }
            if provider_id == OPENCODE_PROVIDER_ID && is_native_opencode_command(command) {
                return Ok(lifecycle_plan(
                    command,
                    ["upgrade"],
                    &format!("{} upgrade", quote_display_command(command)),
                ));
            }
            if let Some(plan) = package_manager_lifecycle_plan(provider_id, command) {
                return Ok(plan);
            }
        }
    }
    let (package, display) = match provider_id {
        CLAUDE_CODE_PROVIDER_ID => (
            "@anthropic-ai/claude-code@latest",
            CLAUDE_CLI_INSTALL_COMMAND,
        ),
        OPENAI_CODEX_PROVIDER_ID => ("@openai/codex@latest", CODEX_CLI_INSTALL_COMMAND),
        OPENCODE_PROVIDER_ID => ("opencode-ai@latest", OPENCODE_CLI_INSTALL_COMMAND),
        GROK_BUILD_PROVIDER_ID if action == "update" => {
            return Ok(lifecycle_plan("grok", ["update"], "grok update"));
        }
        GROK_BUILD_PROVIDER_ID => return Err(ApiError::bad_request("不支持的 Grok Build 操作")),
        _ => return Err(ApiError::bad_request("不支持的 Agent Provider")),
    };
    Ok(lifecycle_plan(
        if cfg!(target_os = "windows") {
            "npm.cmd"
        } else {
            "npm"
        },
        ["install", "-g", package],
        display,
    ))
}

fn claude_install_lifecycle_plan(macos: bool, windows: bool) -> AgentLifecyclePlan {
    if macos {
        return lifecycle_plan(
            "/bin/sh",
            ["-c", CLAUDE_CLI_MACOS_INSTALL_COMMAND],
            CLAUDE_CLI_MACOS_INSTALL_COMMAND,
        );
    }
    lifecycle_plan(
        if windows { "npm.cmd" } else { "npm" },
        ["install", "-g", "@anthropic-ai/claude-code@latest"],
        CLAUDE_CLI_INSTALL_COMMAND,
    )
}

fn claude_uninstalled_update_lifecycle_plan(macos: bool, windows: bool) -> AgentLifecyclePlan {
    if macos {
        return lifecycle_plan("claude", ["update"], CLAUDE_CLI_UPDATE_COMMAND);
    }
    claude_install_lifecycle_plan(false, windows)
}

fn claude_install_display_command() -> &'static str {
    if cfg!(target_os = "macos") {
        CLAUDE_CLI_MACOS_INSTALL_COMMAND
    } else {
        CLAUDE_CLI_INSTALL_COMMAND
    }
}

fn package_manager_lifecycle_plan(provider_id: &str, command: &str) -> Option<AgentLifecyclePlan> {
    let package = match provider_id {
        CLAUDE_CODE_PROVIDER_ID => "@anthropic-ai/claude-code",
        OPENAI_CODEX_PROVIDER_ID => "@openai/codex",
        OPENCODE_PROVIDER_ID => "opencode-ai",
        _ => return None,
    };
    let normalized = command.replace('\\', "/").to_ascii_lowercase();
    if normalized.contains("/volta/") {
        let manager = find_nearby_executable(command, &["volta.exe", "volta.cmd", "volta"])?;
        return Some(lifecycle_plan(
            manager.to_string_lossy().as_ref(),
            ["install", package],
            &format!(
                "{} install {package}",
                quote_display_command(manager.to_string_lossy().as_ref())
            ),
        ));
    }
    if normalized.contains("/.bun/") {
        let manager = find_nearby_executable(command, &["bun.exe", "bun"])?;
        return Some(lifecycle_plan(
            manager.to_string_lossy().as_ref(),
            ["add", "-g", &format!("{package}@latest")],
            &format!(
                "{} add -g {package}@latest",
                quote_display_command(manager.to_string_lossy().as_ref())
            ),
        ));
    }
    if normalized.contains("/pnpm/") {
        let manager = find_nearby_executable(command, &["pnpm.exe", "pnpm.cmd", "pnpm"])?;
        return Some(lifecycle_plan(
            manager.to_string_lossy().as_ref(),
            ["add", "-g", &format!("{package}@latest")],
            &format!(
                "{} add -g {package}@latest",
                quote_display_command(manager.to_string_lossy().as_ref())
            ),
        ));
    }
    if normalized.contains("/homebrew/") || normalized.contains("/cellar/") {
        let manager = find_nearby_executable(command, &["brew"])?;
        let formula = match provider_id {
            OPENAI_CODEX_PROVIDER_ID => "codex",
            OPENCODE_PROVIDER_ID => "opencode",
            _ => "claude-code",
        };
        return Some(lifecycle_plan(
            manager.to_string_lossy().as_ref(),
            ["upgrade", formula],
            &format!(
                "{} upgrade {formula}",
                quote_display_command(manager.to_string_lossy().as_ref())
            ),
        ));
    }
    let manager = find_nearby_executable(command, &["npm.cmd", "npm.exe", "npm"])?;
    Some(lifecycle_plan(
        manager.to_string_lossy().as_ref(),
        ["install", "-g", &format!("{package}@latest")],
        &format!(
            "{} install -g {package}@latest",
            quote_display_command(manager.to_string_lossy().as_ref())
        ),
    ))
}

fn lifecycle_plan<I, S>(program: &str, args: I, display_command: &str) -> AgentLifecyclePlan
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    AgentLifecyclePlan {
        display_command: display_command.to_string(),
        program: program.to_string(),
        args: args
            .into_iter()
            .map(|value| value.as_ref().to_string())
            .collect(),
    }
}

fn find_nearby_executable(command: &str, names: &[&str]) -> Option<PathBuf> {
    let path = Path::new(command);
    for directory in path.ancestors().skip(1).take(8) {
        for name in names {
            let candidate = directory.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn is_native_claude_command(command: &str) -> bool {
    let normalized = command.replace('\\', "/").to_ascii_lowercase();
    normalized.contains("/.local/bin/claude") || normalized.contains("/claude/versions/")
}

fn is_native_opencode_command(command: &str) -> bool {
    let normalized = command.replace('\\', "/").to_ascii_lowercase();
    normalized.contains("/.opencode/bin/") || normalized.contains("/.local/bin/opencode")
}

fn quote_display_command(value: &str) -> String {
    if value.contains(' ') {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

fn sanitize_agent_lifecycle_output(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    if [
        "authorization",
        "api_key",
        "apikey",
        "bearer ",
        "sk-",
        "secret",
        "password",
        "token",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
    {
        return "命令输出包含敏感字段，已隐藏".to_string();
    }
    let result: String = value
        .chars()
        .filter(|character| !character.is_control() || *character == '\n')
        .collect();
    result.trim().chars().take(4000).collect()
}

async fn grok_acp_probe() -> Json<Value> {
    let Some(command) = resolve_grok_command() else {
        return Json(json!({
            "installed": false,
            "initialized": false,
            "error": "未找到 grok 命令",
        }));
    };
    let version = read_grok_cli_version(&command);
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    match probe_acp_agent(&command, &cwd, env!("CARGO_PKG_VERSION")).await {
        Ok(probe) => Json(json!({
            "installed": true,
            "initialized": true,
            "command": command,
            "version": version,
            "probe": probe,
        })),
        Err(error) => Json(json!({
            "installed": true,
            "initialized": false,
            "command": command,
            "version": version,
            "error": error.public_message(),
        })),
    }
}

async fn codex_app_server_probe() -> Json<Value> {
    let Some(command) = resolve_codex_command() else {
        return Json(json!({
            "installed": false,
            "initialized": false,
            "error": "未找到可由 CodeM 启动的 Codex CLI",
        }));
    };
    let version = read_cli_version(&command);
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    match probe_codex_app_server(&command, &cwd, env!("CARGO_PKG_VERSION")).await {
        Ok(probe) => Json(json!({
            "installed": true,
            "initialized": true,
            "command": command,
            "version": version,
            "probe": probe,
        })),
        Err(error) => Json(json!({
            "installed": true,
            "initialized": false,
            "command": command,
            "version": version,
            "error": error.public_message(),
        })),
    }
}

async fn claude_models() -> Json<Value> {
    let Some(_) = resolve_claude_command() else {
        return Json(json!({
            "available": false,
            "models": [],
            "error": "未找到 claude 命令",
        }));
    };

    Json(json!({
        "available": true,
        "models": configured_model_options(),
    }))
}

async fn claude_version_info() -> Json<Value> {
    let install_command = claude_install_display_command();
    let Some(command) = resolve_claude_command() else {
        return Json(json!({
            "installed": false,
            "supported": false,
            "version": Value::Null,
            "recommendedVersion": CLAUDE_CLI_RECOMMENDED_VERSION,
            "command": Value::Null,
            "updateCommand": CLAUDE_CLI_UPDATE_COMMAND,
            "installCommand": install_command,
            "setupUrl": CLAUDE_CLI_SETUP_URL,
            "versionError": "未找到 claude 命令",
        }));
    };
    let output = background_command(&command).arg("--version").output();
    match output {
        Ok(output) => {
            let output_text = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            )
            .trim()
            .to_string();
            let version = parse_claude_cli_version(&output_text);
            if !output.status.success() || version.is_none() {
                return Json(json!({
                    "installed": true,
                    "supported": false,
                    "version": Value::Null,
                    "recommendedVersion": CLAUDE_CLI_RECOMMENDED_VERSION,
                    "command": command,
                    "updateCommand": CLAUDE_CLI_UPDATE_COMMAND,
                    "installCommand": install_command,
                    "setupUrl": CLAUDE_CLI_SETUP_URL,
                    "versionError": if output_text.is_empty() { "读取 Claude CLI 版本失败".to_string() } else { output_text },
                }));
            }
            let version = version.unwrap_or_default();
            Json(json!({
                "installed": true,
                "supported": compare_semantic_versions(&version, CLAUDE_CLI_RECOMMENDED_VERSION) >= 0,
                "version": version,
                "recommendedVersion": CLAUDE_CLI_RECOMMENDED_VERSION,
                "command": command,
                "updateCommand": CLAUDE_CLI_UPDATE_COMMAND,
                "installCommand": install_command,
                "setupUrl": CLAUDE_CLI_SETUP_URL,
            }))
        }
        Err(error) => Json(json!({
            "installed": true,
            "supported": false,
            "version": Value::Null,
            "recommendedVersion": CLAUDE_CLI_RECOMMENDED_VERSION,
            "command": command,
            "updateCommand": CLAUDE_CLI_UPDATE_COMMAND,
            "installCommand": install_command,
            "setupUrl": CLAUDE_CLI_SETUP_URL,
            "versionError": error.to_string(),
        })),
    }
}

async fn get_claude_system_prompt(
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let provider_id = settings_provider_id(query.get("providerId").map(String::as_str))?;
    let scope = query.get("scope").map(String::as_str).unwrap_or("global");
    let path = resolve_agent_rules_path(
        provider_id,
        scope,
        query.get("projectPath").map(String::as_str),
    )?;
    Ok(Json(read_agent_global_prompt(provider_id, scope, &path)))
}

async fn update_claude_system_prompt(
    Query(query): Query<std::collections::HashMap<String, String>>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let provider_id = settings_provider_id(query.get("providerId").map(String::as_str))?;
    let scope = query.get("scope").map(String::as_str).unwrap_or("global");
    let path = resolve_agent_rules_path(
        provider_id,
        scope,
        query.get("projectPath").map(String::as_str),
    )?;
    let content = payload
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    write_agent_rules(&path, content)?;
    Ok(Json(read_agent_global_prompt(provider_id, scope, &path)))
}

async fn claude_run(
    State(state): State<AppState>,
    Json(payload): Json<ClaudeRunRequest>,
) -> ApiResult<Response> {
    let thread_id = payload
        .thread_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("threadId 不能为空"))?
        .to_string();
    let working_directory = payload
        .working_directory
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("workingDirectory 不能为空"))?;
    let working_directory = resolve_accessible_directory(working_directory)?;
    let prompt = build_claude_prompt(&payload);
    let input_message = build_claude_input_message(
        &prompt,
        payload.content_blocks.as_ref(),
        payload.tool_result.as_ref(),
    );
    if !claude_input_message_has_content(&input_message) {
        return Err(ApiError::bad_request("发送内容不能为空"));
    }
    let command =
        resolve_claude_command().ok_or_else(|| ApiError::bad_request("未找到 claude 命令"))?;
    let run_id = uuid::Uuid::new_v4().to_string();
    let started_at_ms = current_timestamp_ms_i64();
    let permission_mode = normalize_claude_permission_mode(payload.permission_mode.as_deref());
    let channel_runtime = state
        .agent_channels
        .resolve_runtime(
            CLAUDE_CODE_PROVIDER_ID,
            payload.channel_id.as_deref(),
            payload.model.as_deref(),
        )
        .map_err(ApiError::bad_request)?;
    let channel_id = channel_runtime
        .as_ref()
        .map(|runtime| runtime.channel_id.clone());
    let channel_fingerprint = channel_runtime
        .as_ref()
        .map(|runtime| runtime.fingerprint.clone());
    state
        .agent_channels
        .persist_thread_runtime(
            &thread_id,
            channel_id.as_deref(),
            channel_fingerprint.as_deref(),
        )
        .map_err(ApiError::internal)?;
    let notify = Arc::new(tokio::sync::Notify::new());
    let record = ActiveRunRecord {
        run_id: run_id.clone(),
        thread_id: thread_id.clone(),
        turn_id: payload.turn_id.clone(),
        prompt: prompt.clone(),
        user_content_blocks: summarize_content_blocks(payload.content_blocks.as_ref()),
        working_directory: working_directory.clone(),
        session_id: payload.session_id.clone(),
        permission_mode: permission_mode.clone(),
        model: payload.model.clone(),
        effort: payload.effort.clone(),
        channel_id: channel_id.clone(),
        started_at_ms,
        events: Vec::new(),
        finished: false,
        child_id: None,
        stdin: None,
        notify: notify.clone(),
        collected_result: String::new(),
        saw_done: false,
        control_request_tool_use_ids: std::collections::HashMap::new(),
        emitted_request_user_input_keys: std::collections::HashSet::new(),
        emitted_approval_request_keys: std::collections::HashSet::new(),
        emitted_recovery_hint_keys: std::collections::HashSet::new(),
        paused_for_user_input: false,
        block_type_by_index: std::collections::HashMap::new(),
        tool_input_accumulators: std::collections::HashMap::new(),
        last_phase_event: None,
    };
    state
        .runs
        .lock()
        .map_err(|error| ApiError::internal(format!("锁定运行状态失败: {error}")))?
        .insert(run_id.clone(), record);

    push_trace_event(
        &state,
        &run_id,
        "server_request_received",
        started_at_ms,
        None,
    );
    let stream_started_at_ms = current_timestamp_ms_i64();
    push_trace_event(
        &state,
        &run_id,
        "create_stream_started",
        stream_started_at_ms,
        None,
    );
    push_trace_event(
        &state,
        &run_id,
        "claude_command_resolved",
        stream_started_at_ms,
        Some(&command),
    );

    let (runtime, runtime_reused) = match get_or_create_claude_runtime(
        &state,
        &command,
        &thread_id,
        &working_directory,
        &permission_mode,
        &payload,
        channel_runtime.as_ref(),
    )
    .await
    {
        Ok(result) => result,
        Err(error) => {
            push_run_event(
                &state,
                &run_id,
                json!({ "type": "error", "runId": run_id, "message": error.message }),
            );
            mark_run_finished(&state, &run_id);
            return build_run_stream_response(state, run_id);
        }
    };

    if runtime.closed || runtime.current_run_id.is_some() {
        push_run_event(
            &state,
            &run_id,
            json!({
                "type": "error",
                "runId": run_id,
                "message": "当前会话仍有运行中的 Claude 请求，请等待结束或停止后再发送。",
            }),
        );
        mark_run_finished(&state, &run_id);
        return build_run_stream_response(state, run_id);
    }
    if state
        .context_requests
        .lock()
        .ok()
        .is_some_and(|requests| requests.contains_key(&thread_id))
    {
        push_run_event(
            &state,
            &run_id,
            json!({
                "type": "error",
                "runId": run_id,
                "message": "当前 Claude 会话正在获取上下文信息，请稍后再发送。",
            }),
        );
        mark_run_finished(&state, &run_id);
        return build_run_stream_response(state, run_id);
    }

    if let Err(error) = claim_runtime_current_run(&state, &thread_id, &run_id) {
        push_run_event(
            &state,
            &run_id,
            json!({
                "type": "error",
                "runId": run_id,
                "message": error.message,
            }),
        );
        mark_run_finished(&state, &run_id);
        return build_run_stream_response(state, run_id);
    }
    set_run_runtime_handles(&state, &run_id, runtime.child_id, runtime.stdin.clone());
    if runtime_reused {
        push_trace_event(
            &state,
            &run_id,
            "claude_runtime_reused",
            current_timestamp_ms_i64(),
            Some(&thread_id),
        );
    } else {
        push_trace_event(
            &state,
            &run_id,
            "claude_spawn_started",
            current_timestamp_ms_i64(),
            None,
        );
    }
    push_run_event(
        &state,
        &run_id,
        json!({
            "type": "status",
            "runId": run_id,
            "message": if runtime_reused { "已复用 Claude Code 会话" } else { "已启动 Claude Code 会话" },
        }),
    );

    if let Err(error) = write_claude_stdin_message(&runtime.stdin, &input_message).await {
        push_run_event(
            &state,
            &run_id,
            json!({ "type": "error", "runId": run_id, "message": format!("写入 Claude 初始消息失败: {error}") }),
        );
        close_thread_runtime(&state, &thread_id)?;
        mark_run_finished(&state, &run_id);
    }

    build_run_stream_response(state, run_id)
}

async fn claude_active_run(
    State(state): State<AppState>,
    AxumPath(thread_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let runs = state
        .runs
        .lock()
        .map_err(|error| ApiError::internal(format!("读取运行状态失败: {error}")))?;
    let Some(run) = runs
        .values()
        .find(|run| run.thread_id == thread_id && !run.finished)
    else {
        return Ok(Json(json!({ "active": false })));
    };
    Ok(Json(active_run_json(run)))
}

async fn claude_run_events(
    State(state): State<AppState>,
    AxumPath(run_id): AxumPath<String>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Response> {
    let replay_after = query
        .get("after")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let stream = async_stream::stream! {
        let mut index = replay_after;
        loop {
            let Some(notify) = run_notify(&state, &run_id) else {
                break;
            };
            let notified = notify.notified();
            let Some((events, finished)) = snapshot_replay_run_events_after(&state, &run_id, index) else {
                break;
            };
            index += events.len();
            let had_events = !events.is_empty();
            for event in events {
                let line = format!("{}\n", serde_json::to_string(&event).unwrap_or_default());
                yield Ok::<Bytes, std::convert::Infallible>(Bytes::from(line));
            }
            if finished {
                break;
            }
            if !had_events {
                notified.await;
            }
        }
    };
    Response::builder()
        .header("Content-Type", "application/x-ndjson; charset=utf-8")
        .header("Cache-Control", "no-cache, no-transform")
        .body(Body::from_stream(stream))
        .map_err(|error| ApiError::internal(format!("构建运行事件响应失败: {error}")))
}

fn should_replay_run_event(event: &Value) -> bool {
    !matches!(
        event.get("type").and_then(Value::as_str),
        Some("raw") | Some("trace") | Some("assistant-snapshot") | Some("claude-event")
    )
}

async fn claude_run_ack(
    State(state): State<AppState>,
    AxumPath(run_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let acknowledged = remove_finished_run_record(&state, &run_id);
    Ok(Json(json!({ "acknowledged": acknowledged })))
}

async fn claude_run_guide(
    State(state): State<AppState>,
    AxumPath(run_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let prompt = payload
        .get("prompt")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let content_blocks = payload.get("contentBlocks");
    let input_message = build_claude_input_message(&prompt, content_blocks, None);
    if !claude_input_message_has_content(&input_message) {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({ "submitted": false, "error": "缺少有效引导内容。" })),
        ));
    }
    if let Err(error) = ensure_run_supports_runtime_input(
        &state,
        &run_id,
        "当前 Claude 运行不支持运行中引导，请等待结束后再继续。",
    ) {
        return Ok((
            if error.status == StatusCode::BAD_REQUEST {
                StatusCode::CONFLICT
            } else {
                error.status
            },
            Json(json!({ "submitted": false, "error": error.message })),
        ));
    }
    if let Err(error) = ensure_run_not_paused_for_guide(&state, &run_id) {
        return Ok((
            error.status,
            Json(json!({ "submitted": false, "error": error.message })),
        ));
    }
    if let Err(error) = write_run_stdin_message_raw_error(&state, &run_id, &input_message).await {
        let message = format!("写入 Claude Code 引导消息失败：{}", error.message);
        enqueue_retryable_runtime_error(&state, &run_id, &message, "process");
        push_run_event(
            &state,
            &run_id,
            json!({ "type": "error", "runId": run_id, "message": message }),
        );
        finish_run_and_close_runtime(&state, &run_id)?;
        return Ok((StatusCode::OK, Json(json!({ "submitted": true }))));
    }
    push_run_event(
        &state,
        &run_id,
        json!({ "type": "trace", "runId": run_id, "name": "stdin_guide_prompt_written", "atMs": current_timestamp_ms_i64() }),
    );
    Ok((StatusCode::OK, Json(json!({ "submitted": true }))))
}

async fn claude_run_request_user_input(
    State(state): State<AppState>,
    AxumPath(run_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let Some(request_id) = payload
        .get("requestId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({ "submitted": false, "error": "缺少提问请求 ID。" })),
        ));
    };
    let answers = payload
        .get("answers")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let submitted_answers = answers
        .iter()
        .filter_map(|(key, value)| {
            value
                .as_str()
                .map(str::trim)
                .filter(|answer| !answer.is_empty())
                .map(|answer| (key.clone(), json!(answer)))
        })
        .collect::<Map<String, Value>>();
    if submitted_answers.is_empty() {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({ "submitted": false, "error": "缺少有效回答。" })),
        ));
    }
    let questions = payload
        .get("questions")
        .cloned()
        .unwrap_or_else(|| json!([]));
    if questions.as_array().is_none_or(|items| items.is_empty()) {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({ "submitted": false, "error": "缺少提问问题定义。" })),
        ));
    }
    if let Err(error) = ensure_run_paused_for_user_input(
        &state,
        &run_id,
        "Claude 还没有完成提问，请稍后再提交答案。",
    ) {
        return Ok((
            if error.status == StatusCode::BAD_REQUEST {
                StatusCode::CONFLICT
            } else {
                error.status
            },
            Json(json!({ "submitted": false, "error": error.message })),
        ));
    }
    let normalized_answers =
        build_request_user_input_response_answers(&questions, &submitted_answers);
    let content = json!({
        "questions": questions,
        "answers": normalized_answers,
    })
    .to_string();
    let message = if let Some((control_request_id, tool_use_id)) =
        control_response_ids_for_request(&state, &run_id, request_id)?
    {
        build_ask_user_question_control_response_message(
            &control_request_id,
            tool_use_id.as_deref(),
            questions,
            Value::Object(normalized_answers),
        )
    } else {
        build_claude_tool_result_message(request_id, &content, false)
    };
    write_run_stdin_message(&state, &run_id, &message).await?;
    mark_run_human_input_resumed(&state, &run_id, request_id);
    push_run_event(
        &state,
        &run_id,
        json!({ "type": "trace", "runId": run_id, "name": "stdin_tool_result_written", "atMs": current_timestamp_ms_i64(), "detail": request_id }),
    );
    Ok((StatusCode::OK, Json(json!({ "submitted": true }))))
}

async fn claude_run_approval_decision(
    State(state): State<AppState>,
    AxumPath(run_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let Some(request_id) = payload
        .get("requestId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({ "submitted": false, "error": "缺少批准请求 ID。" })),
        ));
    };
    if let Err(error) = ensure_run_supports_runtime_input(
        &state,
        &run_id,
        "当前 Claude 运行不支持运行中批准，请等待结束后再继续。",
    ) {
        return Ok((
            if error.status == StatusCode::BAD_REQUEST {
                StatusCode::CONFLICT
            } else {
                error.status
            },
            Json(json!({ "submitted": false, "error": error.message })),
        ));
    }
    let decision = payload
        .get("decision")
        .and_then(Value::as_str)
        .unwrap_or("approve");
    let default_content = if decision == "reject" {
        "The user rejected this request. Do not perform the requested action."
    } else {
        "The user approved this request. Continue the original task."
    };
    let content = payload
        .get("content")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_content);
    let message = if let Some((control_request_id, tool_use_id)) =
        control_response_ids_for_request(&state, &run_id, request_id)?
    {
        build_claude_control_response_message(&control_request_id, decision, tool_use_id.as_deref())
    } else {
        build_claude_tool_result_message(request_id, content, decision == "reject")
    };
    write_run_stdin_message(&state, &run_id, &message).await?;
    mark_run_human_input_resumed(&state, &run_id, request_id);
    push_run_event(
        &state,
        &run_id,
        json!({ "type": "trace", "runId": run_id, "name": "stdin_approval_result_written", "atMs": current_timestamp_ms_i64(), "detail": request_id }),
    );
    Ok((StatusCode::OK, Json(json!({ "submitted": true }))))
}

async fn claude_run_interrupt(
    State(state): State<AppState>,
    AxumPath(run_id): AxumPath<String>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    if let Err(error) = ensure_run_supports_runtime_input(
        &state,
        &run_id,
        "当前 Claude 运行不支持软中断，请使用停止重试。",
    ) {
        return Ok((
            if error.status == StatusCode::BAD_REQUEST {
                StatusCode::CONFLICT
            } else {
                error.status
            },
            Json(json!({ "submitted": false, "error": error.message })),
        ));
    }
    let message = json!({
        "type": "control_request",
        "request_id": uuid::Uuid::new_v4().to_string(),
        "request": { "subtype": "interrupt" },
    });
    let submitted = match write_run_stdin_message_raw_error(&state, &run_id, &message).await {
        Ok(()) => {
            push_run_event(
                &state,
                &run_id,
                json!({ "type": "trace", "runId": run_id, "name": "stdin_interrupt_written", "atMs": current_timestamp_ms_i64() }),
            );
            true
        }
        Err(error) => {
            let message = format!("写入 Claude Code 中断请求失败：{}", error.message);
            enqueue_retryable_runtime_error(&state, &run_id, &message, "process");
            push_run_event(
                &state,
                &run_id,
                json!({ "type": "error", "runId": run_id, "message": message }),
            );
            true
        }
    };
    Ok((StatusCode::OK, Json(json!({ "submitted": submitted }))))
}

async fn claude_run_cancel(
    State(state): State<AppState>,
    AxumPath(run_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let thread_id = state
        .runs
        .lock()
        .map_err(|error| ApiError::internal(format!("读取运行状态失败: {error}")))?
        .get(&run_id)
        .map(|run| run.thread_id.clone());
    let cancelled = if let Some(thread_id) = thread_id {
        close_thread_runtime(&state, &thread_id)?
    } else {
        kill_run_child(&state, &run_id)?
    };
    mark_run_finished(&state, &run_id);
    Ok(Json(json!({ "cancelled": cancelled })))
}

async fn claude_runtime_close(
    State(state): State<AppState>,
    AxumPath(thread_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let closed = close_thread_runtime(&state, &thread_id)?;
    Ok(Json(json!({ "closed": closed })))
}

async fn claude_runtime_context(
    State(state): State<AppState>,
    AxumPath(thread_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let normalized_thread_id = thread_id.trim().to_string();
    if normalized_thread_id.is_empty() {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "ok": false,
                "code": "invalid-thread",
                "error": "threadId 不能为空。",
                "httpStatus": 400,
            })),
        ));
    }
    let runtime = state
        .runtimes
        .lock()
        .map_err(|error| ApiError::internal(format!("读取 Claude 会话失败: {error}")))?
        .get(&normalized_thread_id)
        .cloned();
    let Some(runtime) = runtime.filter(|runtime| !runtime.closed) else {
        return Ok((
            StatusCode::NOT_FOUND,
            Json(json!({
                "ok": false,
                "code": "runtime-unavailable",
                "error": "当前线程没有可复用的 Claude stream-json 会话，请先发送一轮消息后再获取上下文。",
                "httpStatus": 404,
            })),
        ));
    };
    if runtime.current_run_id.is_some() {
        return Ok((
            StatusCode::CONFLICT,
            Json(json!({
                "ok": false,
                "code": "runtime-busy",
                "error": "当前 Claude 会话正在运行中，请等待本轮结束后再获取上下文信息。",
                "httpStatus": 409,
            })),
        ));
    }
    let timeout_ms = payload
        .get("timeoutMs")
        .and_then(Value::as_u64)
        .unwrap_or(12_000)
        .clamp(1_000, 60_000);
    let requested_at_ms = current_timestamp_ms_i64();
    let (sender, receiver) =
        tokio::sync::oneshot::channel::<Result<Value, ClaudeContextRequestError>>();
    {
        let mut requests = state
            .context_requests
            .lock()
            .map_err(|error| ApiError::internal(format!("创建上下文请求失败: {error}")))?;
        if requests.contains_key(&normalized_thread_id) {
            return Ok((
                StatusCode::CONFLICT,
                Json(json!({
                    "ok": false,
                    "code": "runtime-busy",
                    "error": "已有上下文信息请求正在进行，请稍后再试。",
                    "httpStatus": 409,
                })),
            ));
        }
        requests.insert(
            normalized_thread_id.clone(),
            ClaudeContextRequestRecord {
                requested_at_ms,
                event_count: 0,
                assistant_texts: Vec::new(),
                stderr_lines: Vec::new(),
                responder: Some(sender),
            },
        );
    }
    let message = build_claude_context_request_message();
    if let Err(error) = write_claude_stdin_message(&runtime.stdin, &message).await {
        settle_runtime_context_request(
            &state,
            &normalized_thread_id,
            Err(ClaudeContextRequestError {
                code: "context-write-failed",
                message: format!("写入 Claude Code /context 请求失败：{error}"),
                status: StatusCode::INTERNAL_SERVER_ERROR,
            }),
        );
    }
    let result = tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), receiver).await;
    match result {
        Ok(Ok(Ok(context))) => Ok((
            StatusCode::OK,
            Json(json!({ "ok": true, "context": context })),
        )),
        Ok(Ok(Err(error))) => Ok((
            error.status,
            Json(json!({
                "ok": false,
                "code": error.code,
                "error": error.message,
                "httpStatus": error.status.as_u16(),
            })),
        )),
        Ok(Err(_)) => Ok((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "ok": false,
                "code": "context-runtime-ended",
                "error": "Claude 运行时已结束，/context 请求未完成。",
                "httpStatus": 500,
            })),
        )),
        Err(_) => {
            settle_runtime_context_request(
                &state,
                &normalized_thread_id,
                Err(ClaudeContextRequestError {
                    code: "context-timeout",
                    message: "Claude 未在限定时间内返回 /context 结果。".to_string(),
                    status: StatusCode::GATEWAY_TIMEOUT,
                }),
            );
            Ok((
                StatusCode::GATEWAY_TIMEOUT,
                Json(json!({
                    "ok": false,
                    "code": "context-timeout",
                    "error": "Claude 未在限定时间内返回 /context 结果。",
                    "httpStatus": 504,
                })),
            ))
        }
    }
}

async fn claude_runtimes(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let runtimes = state
        .runtimes
        .lock()
        .map_err(|error| ApiError::internal(format!("读取 runtime 状态失败: {error}")))?;
    let mut statuses = Map::new();
    for runtime in runtimes.values().filter(|runtime| !runtime.closed) {
        statuses.insert(
            runtime.thread_id.clone(),
            json!({
                "threadId": runtime.thread_id,
                "pid": runtime.child_id,
                "alive": true,
                "activeRun": runtime.current_run_id.is_some(),
            }),
        );
    }
    Ok(Json(Value::Object(statuses)))
}

async fn open_with_targets(State(state): State<AppState>) -> Json<Value> {
    let settings = read_app_settings(&state).unwrap_or_else(|_| default_app_settings());
    let selected_target_id = settings
        .get("openWith")
        .and_then(|value| value.get("selectedTargetId"))
        .and_then(Value::as_str)
        .unwrap_or("vscode");
    Json(json!({
        "targets": discover_open_targets(),
        "selectedTargetId": selected_target_id,
    }))
}

async fn usage_stats(
    State(state): State<AppState>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let range_days =
        resolve_usage_range_days(query.get("range").or_else(|| query.get("rangeDays")))?;
    let project_id = query.get("projectId").map(String::as_str);
    let provider_id = query
        .get("providerId")
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty() && *value != "all");
    if let Some(provider_id) = provider_id {
        settings_provider_id(Some(provider_id))?;
    }
    let connection = open_initialized_workspace_database(&state)?;
    Ok(Json(read_usage_stats(
        &connection,
        range_days,
        project_id,
        provider_id,
    )?))
}

async fn get_settings(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    read_app_settings(&state).map(Json)
}

async fn update_appearance_settings(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    update_settings_section(&state, "appearance", payload, UpdateMode::Replace).map(Json)
}

async fn update_general_settings(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    update_settings_section(&state, "general", payload, UpdateMode::Merge).map(Json)
}

async fn update_model_settings(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    update_settings_section(&state, "models", payload, UpdateMode::Replace).map(Json)
}

async fn update_shortcut_settings(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    update_settings_section(&state, "shortcuts", payload, UpdateMode::Merge).map(Json)
}

async fn update_open_with_settings(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    update_settings_section(&state, "openWith", payload, UpdateMode::Merge).map(Json)
}

async fn get_agent_runtime_settings(State(state): State<AppState>) -> Json<Value> {
    let settings = read_app_settings(&state).unwrap_or_else(|_| default_app_settings());
    Json(agent_runtime_settings_from_settings(&settings))
}

async fn update_agent_runtime_settings(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let settings = update_settings_section(&state, "agentRuntime", payload, UpdateMode::Merge)?;
    Ok(Json(agent_runtime_settings_from_settings(&settings)))
}

async fn workspace_bootstrap(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let _guard = lock_workspace_write(&state)?;
    read_workspace_bootstrap(&state).map(Json)
}

async fn update_workspace_selection(
    State(state): State<AppState>,
    Json(payload): Json<SelectionRequest>,
) -> ApiResult<Json<Value>> {
    let _guard = lock_workspace_write(&state)?;
    let connection = open_initialized_workspace_database(&state)?;
    if let Some(project_id) = normalize_optional_string(payload.project_id) {
        write_state_value(&connection, "activeProjectId", &project_id)?;
    }
    if let Some(thread_id) = normalize_optional_string(payload.thread_id) {
        write_state_value(&connection, "activeThreadId", &thread_id)?;
    }
    Ok(Json(json!({ "ok": true })))
}

async fn update_workspace_panel(
    State(state): State<AppState>,
    Json(payload): Json<PanelPatchRequest>,
) -> ApiResult<Json<Value>> {
    let _guard = lock_workspace_write(&state)?;
    let connection = open_initialized_workspace_database(&state)?;
    let current = read_panel_state(&connection)?;
    write_state_value(
        &connection,
        "panel.organizeBy",
        normalize_panel_value(payload.organize_by, current["organizeBy"].as_str()),
    )?;
    write_state_value(
        &connection,
        "panel.sortBy",
        normalize_panel_value(payload.sort_by, current["sortBy"].as_str()),
    )?;
    write_state_value(
        &connection,
        "panel.visibility",
        normalize_panel_value(payload.visibility, current["visibility"].as_str()),
    )?;
    Ok(Json(json!({ "ok": true })))
}

async fn select_directory(Json(payload): Json<SelectDirectoryRequest>) -> ApiResult<Json<Value>> {
    let selected_path = run_directory_picker(payload.initial_path.as_deref())?;
    Ok(Json(json!({
        "ok": true,
        "path": selected_path,
    })))
}

async fn open_system_path(Json(payload): Json<OpenPathRequest>) -> ApiResult<Json<Value>> {
    let path = payload
        .path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("path 不能为空"))?;
    let target_path = resolve_absolute_path(path)?;
    if payload.mode.as_deref() == Some("reveal") {
        reveal_path_in_explorer(&target_path)?;
    } else {
        open_path_with_system(&target_path)?;
    }
    Ok(Json(json!({ "ok": true })))
}

async fn search_system_files(Query(query): Query<FileSearchQuery>) -> ApiResult<Json<Value>> {
    let working_directory = query
        .working_directory
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("workingDirectory 不能为空"))?;
    let root = resolve_accessible_directory(working_directory)?;
    let files = search_workspace_files(&root, query.query.as_deref().unwrap_or_default())?;
    Ok(Json(json!({ "files": files })))
}

async fn resolve_system_file(Query(query): Query<FileResolveQuery>) -> ApiResult<Json<Value>> {
    let working_directory = query
        .working_directory
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("workingDirectory 不能为空"))?;
    let raw_path = query
        .path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("path 不能为空"))?;
    let root = resolve_accessible_directory(working_directory)?;
    let resolved = resolve_workspace_relative_path(&root, raw_path)
        .ok_or_else(|| ApiError::bad_request("path 必须是 workspace 内的相对路径"))?;
    let metadata =
        fs::metadata(&resolved.0).map_err(|_| ApiError::not_found("path 在 workspace 中不存在"))?;
    Ok(Json(json!({
        "path": resolved.0,
        "rel": resolved.1,
        "isDirectory": metadata.is_dir(),
    })))
}

async fn save_image_attachment(
    Json(payload): Json<ImageAttachmentRequest>,
) -> ApiResult<Json<Value>> {
    let working_directory = payload
        .working_directory
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("workingDirectory 不能为空"))?;
    let data_url = payload
        .data_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("dataUrl 不能为空"))?;
    let root = resolve_accessible_directory(working_directory)?;
    let parsed = parse_image_data_url(data_url, payload.mime_type.as_deref().unwrap_or_default())?;
    let attachments_dir = PathBuf::from(root).join(".codem-attachments");
    fs::create_dir_all(&attachments_dir)
        .map_err(|error| ApiError::internal(format!("创建附件目录失败: {error}")))?;
    let file_path = attachments_dir.join(build_attachment_file_name(&parsed.extension));
    fs::write(&file_path, &parsed.bytes)
        .map_err(|error| ApiError::internal(format!("保存图片失败: {error}")))?;
    Ok(Json(json!({
        "path": file_path.display().to_string(),
        "mimeType": parsed.mime_type,
        "size": parsed.bytes.len(),
        "name": payload.file_name.as_deref().map(str::trim).filter(|value| !value.is_empty()).unwrap_or_else(|| file_path.file_name().and_then(|value| value.to_str()).unwrap_or("image")),
    })))
}

async fn read_image_attachment_from_path(
    Json(payload): Json<ImageFromPathRequest>,
) -> ApiResult<Json<Value>> {
    let raw_path = payload
        .path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("path 不能为空"))?;
    validate_desktop_file_path(raw_path)?;
    let file_path = resolve_absolute_path(raw_path)?;
    if !is_supported_image_file_path(&file_path) {
        return Err(ApiError::bad_request("仅支持常见图片格式。"));
    }
    let metadata = fs::metadata(&file_path)
        .map_err(|error| ApiError::bad_request(format!("图片读取失败: {error}")))?;
    if !metadata.is_file() {
        return Err(ApiError::bad_request("目标不是文件"));
    }
    if metadata.len() > 10 * 1024 * 1024 {
        return Err(ApiError::bad_request("图片过大，请控制在 10MB 以内。"));
    }
    let bytes = fs::read(&file_path)
        .map_err(|error| ApiError::bad_request(format!("图片读取失败: {error}")))?;
    if bytes.is_empty() {
        return Err(ApiError::bad_request("图片内容为空。"));
    }
    Ok(Json(json!({
        "path": file_path,
        "name": Path::new(&file_path).file_name().and_then(|value| value.to_str()).unwrap_or("image"),
        "mimeType": image_mime_type_from_file_path(&file_path),
        "size": bytes.len(),
        "data": general_purpose::STANDARD.encode(bytes),
    })))
}

async fn image_preview(
    State(state): State<AppState>,
    Query(query): Query<PreviewQuery>,
) -> ApiResult<Response> {
    let file_path = query
        .path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("path 不能为空"))?;
    let file_path = resolve_absolute_path(file_path)?;
    ensure_can_preview_workspace_file(&state, &file_path)?;
    if !is_supported_image_file_path(&file_path) {
        return Err(ApiError::bad_request("仅支持图片预览"));
    }
    let metadata = fs::metadata(&file_path)
        .map_err(|error| ApiError::bad_request(format!("图片预览失败: {error}")))?;
    if !metadata.is_file() {
        return Err(ApiError::bad_request("目标不是文件"));
    }
    if metadata.len() > 15 * 1024 * 1024 {
        return Err(ApiError::bad_request("图片过大，暂不预览"));
    }
    let bytes = fs::read(&file_path)
        .map_err(|error| ApiError::bad_request(format!("图片预览失败: {error}")))?;
    Response::builder()
        .header("Cache-Control", "no-store")
        .header("Content-Type", image_mime_type_from_file_path(&file_path))
        .body(Body::from(bytes))
        .map_err(|error| ApiError::internal(format!("构建图片响应失败: {error}")))
}

async fn file_preview(
    State(state): State<AppState>,
    Query(query): Query<PreviewQuery>,
) -> ApiResult<Json<Value>> {
    let file_path = query
        .path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("path 不能为空"))?;
    let file_path = resolve_absolute_path(file_path)?;
    ensure_can_preview_workspace_file(&state, &file_path)?;
    let metadata = fs::metadata(&file_path)
        .map_err(|error| ApiError::bad_request(format!("文件预览失败: {error}")))?;
    if !metadata.is_file() {
        return Err(ApiError::bad_request("目标不是文件"));
    }
    if is_supported_image_file_path(&file_path) {
        return Ok(Json(json!({
            "path": file_path,
            "content": "",
            "mode": "image",
            "previewUrl": format!("/api/system/image-preview?path={}", percent_encode(&file_path)),
        })));
    }
    if metadata.len() > 200 * 1024 {
        return Err(ApiError::bad_request("文件过大，暂不预览"));
    }
    let bytes = fs::read(&file_path)
        .map_err(|error| ApiError::bad_request(format!("文件预览失败: {error}")))?;
    if bytes.contains(&0) {
        return Err(ApiError::bad_request("二进制文件暂不预览"));
    }
    let content = String::from_utf8(bytes)
        .map_err(|_| ApiError::bad_request("文件不是 UTF-8 文本，暂不预览"))?;
    Ok(Json(json!({
        "path": file_path,
        "content": content,
    })))
}

async fn git_clone(Json(payload): Json<GitCloneRequest>) -> ApiResult<(StatusCode, Json<Value>)> {
    let repo_url = payload
        .repo_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request_json("仓库地址不能为空"))?;
    let base_directory = payload
        .base_directory
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request_json("保存位置不能为空"))?;
    let base_directory = resolve_absolute_path(base_directory)?;
    fs::create_dir_all(&base_directory).map_err(|_| {
        ApiError::bad_request_json(format!("保存位置不存在且无法创建：{base_directory}"))
    })?;
    let metadata = fs::metadata(&base_directory).map_err(|_| {
        ApiError::bad_request_json(format!("保存位置不存在且无法创建：{base_directory}"))
    })?;
    if !metadata.is_dir() {
        return Err(ApiError::bad_request_json("保存位置不可用"));
    }
    let folder_name = payload
        .folder_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request_json("项目目录名不能为空"))?;
    if folder_name == "."
        || folder_name == ".."
        || folder_name.contains(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])
        || folder_name.chars().any(|character| character.is_control())
        || Path::new(folder_name)
            .file_name()
            .and_then(|value| value.to_str())
            != Some(folder_name)
    {
        return Err(ApiError::bad_request_json("项目目录名包含无效字符"));
    }
    let project_path = PathBuf::from(&base_directory)
        .join(folder_name)
        .display()
        .to_string();
    if Path::new(&project_path).exists() {
        return Err(ApiError::bad_request_json(format!(
            "目标目录已存在：{project_path}"
        )));
    }
    let (clone_status, clone_stdout, clone_stderr) = run_git_command(
        &base_directory,
        &[
            "clone".to_string(),
            repo_url.to_string(),
            project_path.clone(),
        ],
    )?;
    if clone_status != 0 {
        let _ = fs::remove_dir_all(&project_path);
        let raw_log = build_git_clone_raw_log(&clone_stderr, &clone_stdout);
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format_git_clone_error(&clone_stderr, &clone_stdout),
                "rawLog": raw_log,
            })),
        ));
    }
    Ok((
        StatusCode::OK,
        Json(json!({
            "ok": true,
            "projectPath": project_path,
        })),
    ))
}

async fn open_project(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    open_path_with_system(&project_path)?;
    Ok(Json(json!({ "ok": true })))
}

async fn open_project_editor(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let target_id = payload
        .get("targetId")
        .and_then(Value::as_str)
        .unwrap_or("vscode");
    open_project_with_target(&project_path, target_id)?;
    Ok(Json(json!({ "ok": true })))
}

async fn list_project_files(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Query(query): Query<ProjectFilesQuery>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let relative = query.path.as_deref().unwrap_or_default();
    let directory = resolve_project_relative_directory(&project_path, relative)?;
    let entries = fs::read_dir(&directory)
        .map_err(|error| ApiError::bad_request(format!("读取项目文件失败: {error}")))?;
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".git" {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let relative_path = path
            .strip_prefix(&project_path)
            .ok()
            .map(|value| value.display().to_string().replace('\\', "/"))
            .unwrap_or_else(|| name.clone());
        files.push(json!({
            "name": name,
            "path": relative_path,
            "type": if file_type.is_dir() { "directory" } else { "file" },
        }));
    }
    files.sort_by(compare_project_file_entries);
    Ok(Json(Value::Array(files)))
}

fn compare_project_file_entries(left: &Value, right: &Value) -> Ordering {
    let left_is_directory = left.get("type").and_then(Value::as_str) == Some("directory");
    let right_is_directory = right.get("type").and_then(Value::as_str) == Some("directory");
    right_is_directory.cmp(&left_is_directory).then_with(|| {
        let left_name = left.get("name").and_then(Value::as_str).unwrap_or("");
        let right_name = right.get("name").and_then(Value::as_str).unwrap_or("");
        left_name
            .to_lowercase()
            .cmp(&right_name.to_lowercase())
            .then_with(|| left_name.cmp(right_name))
    })
}

async fn delete_project_file(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<ProjectFileDeleteRequest>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let relative = payload
        .path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("path 不能为空"))?;
    let target = resolve_project_relative_path(&project_path, relative)?;
    let metadata = fs::metadata(&target)
        .map_err(|error| ApiError::bad_request(format!("删除项目文件失败: {error}")))?;
    if metadata.is_dir() {
        fs::remove_dir_all(&target)
    } else {
        fs::remove_file(&target)
    }
    .map_err(|error| ApiError::bad_request(format!("删除项目文件失败: {error}")))?;
    Ok(Json(json!({ "ok": true, "path": relative })))
}

async fn project_git_summary(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    Ok(Json(project_git_summary_json(&project_path)))
}

async fn project_git_status(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    Ok(Json(read_git_status_snapshot(&project_path)?))
}

async fn project_git_branches(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    Ok(Json(Value::Array(read_git_branches(&project_path)?)))
}

async fn project_git_history(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(40);
    let reference = query.get("ref").map(String::as_str);
    let commits = read_git_history(&project_path, reference, limit)?
        .into_iter()
        .map(compact_git_history_commit)
        .collect();
    Ok(Json(Value::Array(commits)))
}

async fn project_git_history_log(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(80);
    let commits = read_git_history(&project_path, None, limit)?;
    let available_authors = unique_json_strings(&commits, "author");
    Ok(Json(json!({
        "commits": commits,
        "limit": limit,
        "hasMore": false,
        "nextCursor": null,
        "availableAuthors": available_authors,
        "activeRefs": [],
    })))
}

async fn project_git_history_compare(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let target = query
        .get("targetBranch")
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("targetBranch 和 compareBranch 不能为空"))?;
    let compare = query
        .get("compareBranch")
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("targetBranch 和 compareBranch 不能为空"))?;
    Ok(Json(json!({
        "branch": target,
        "compareBranch": compare,
        "targetOnlyCommits": read_git_history_range(&project_path, &format!("{compare}..{target}"), 40)?,
        "currentOnlyCommits": read_git_history_range(&project_path, &format!("{target}..{compare}"), 40)?,
    })))
}

async fn project_git_commit_details(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let sha = query
        .get("sha")
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("sha 不能为空"))?;
    Ok(Json(read_git_commit_details(&project_path, sha)?))
}

async fn project_git_commit_file(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let sha = query
        .get("sha")
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("sha 和 path 不能为空"))?;
    let file_path = query
        .get("path")
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("sha 和 path 不能为空"))?;
    Ok(Json(read_git_commit_file(&project_path, sha, file_path)?))
}

async fn project_git_diff(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let file_path = query
        .get("path")
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("path 不能为空"))?;
    Ok(Json(read_git_file_diff(&project_path, file_path)?))
}

async fn project_git_operation_state(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    Ok(Json(read_git_operation_state_value(&project_path)?))
}

async fn project_git_add_files(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let paths = read_string_array(payload.get("paths"));
    if paths.is_empty() {
        return Err(ApiError::bad_request("paths 不能为空"));
    }
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(paths.iter().cloned());
    run_git_command_checked(&project_path, &args)?;
    Ok(Json(json!({
        "added": paths,
        "summary": project_git_summary_json(&project_path),
    })))
}

async fn project_git_revert_file(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let mut paths = read_string_array(payload.get("paths"));
    if paths.is_empty() {
        if let Some(path) = payload.get("path").and_then(Value::as_str) {
            paths.push(path.to_string());
        }
    }
    if paths.is_empty() {
        return Err(ApiError::bad_request("paths 不能为空"));
    }
    let mut args = vec!["checkout".to_string(), "--".to_string()];
    args.extend(paths.iter().cloned());
    run_git_command_checked(&project_path, &args)?;
    Ok(Json(json!({
        "paths": paths,
        "reverted": paths,
        "deleted": [],
        "summary": project_git_summary_json(&project_path),
    })))
}

async fn project_git_commit(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let message = payload
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if message.trim().is_empty() {
        return Err(ApiError::bad_request("message 不能为空"));
    }
    let files = read_string_array(payload.get("files"));
    if files.is_empty() {
        return Err(ApiError::bad_request("请选择要提交的文件"));
    }
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(files);
    run_git_command_checked(&project_path, &args)?;
    let output = run_git_command_checked(&project_path, &["commit", "-m", message])?;
    Ok(Json(json!({
        "output": output,
        "summary": project_git_summary_json(&project_path),
    })))
}

async fn project_git_push_preview(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    ensure_git_repo(&project_path)?;
    let status = read_git_status_snapshot(&project_path)?;
    let remotes = read_git_remotes(&project_path)?;
    if remotes.is_empty() {
        return Err(ApiError::bad_request("当前仓库没有可用远端"));
    }
    let branch = status.get("branch").and_then(Value::as_str).unwrap_or("");
    if branch.is_empty() || branch == "HEAD" {
        return Err(ApiError::bad_request("当前不是可推送的本地分支"));
    }
    let upstream = status.get("upstream").and_then(Value::as_str);
    let upstream_remote = upstream.and_then(|value| value.split('/').next());
    let upstream_branch =
        upstream.and_then(|value| value.split_once('/').map(|(_, branch)| branch));
    let remote = if remotes.iter().any(|item| item == "gitee") {
        "gitee".to_string()
    } else if let Some(upstream_remote) =
        upstream_remote.filter(|value| remotes.iter().any(|item| item == value))
    {
        upstream_remote.to_string()
    } else {
        remotes.first().cloned().unwrap_or_default()
    };
    let target_branch = if Some(remote.as_str()) == upstream_remote {
        upstream_branch.unwrap_or(branch).to_string()
    } else {
        branch.to_string()
    };
    Ok(Json(json!({
        "branch": branch,
        "remote": remote,
        "targetBranch": target_branch,
        "upstream": status.get("upstream"),
        "ahead": status.get("ahead").cloned().unwrap_or_else(|| json!(0)),
        "behind": status.get("behind").cloned().unwrap_or_else(|| json!(0)),
        "commits": [],
    })))
}

async fn project_git_push(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let mut args = vec!["push".to_string()];
    if let Some(remote) = payload
        .get("remote")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        args.push(remote.to_string());
    }
    if let Some(branch) = payload
        .get("branch")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        args.push(branch.to_string());
    }
    let output = run_git_command_checked(&project_path, &args)?;
    Ok(Json(
        json!({ "output": output, "summary": project_git_summary_json(&project_path) }),
    ))
}

async fn project_git_fetch(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let mut args = vec!["fetch".to_string()];
    if let Some(remote) = payload
        .get("remote")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        args.push(remote.to_string());
    }
    let output = run_git_command_checked(&project_path, &args)?;
    Ok(Json(
        json!({ "output": output, "summary": project_git_summary_json(&project_path) }),
    ))
}

async fn project_git_pull(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let before_head = read_git_head(&project_path).unwrap_or_default();
    let mut args = vec!["pull".to_string()];
    if payload.get("mode").and_then(Value::as_str) == Some("ff-only") {
        args.push("--ff-only".to_string());
    } else if payload.get("mode").and_then(Value::as_str) == Some("rebase") {
        args.push("--rebase".to_string());
    }
    if let Some(remote) = payload
        .get("remote")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        args.push(remote.to_string());
    }
    if let Some(branch) = payload
        .get("branch")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        args.push(branch.to_string());
    }
    let output = run_git_command_checked(&project_path, &args)?;
    let after_head = read_git_head(&project_path).unwrap_or_default();
    Ok(Json(json!({
        "output": output,
        "summary": project_git_summary_json(&project_path),
        "commitsPulled": count_git_commits_between(&project_path, &before_head, &after_head).unwrap_or(0),
        "filesChanged": count_git_files_between(&project_path, &before_head, &after_head).unwrap_or(0),
    })))
}

async fn project_git_switch(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let branch = required_json_string(&payload, "branch", "branch 不能为空")?;
    let current = read_git_info(&project_path, false);
    if current.branch.as_deref() != Some(branch) {
        run_git_command_checked(&project_path, &["switch", branch])?;
    }
    Ok(Json(project_git_summary_json(&project_path)))
}

async fn project_git_branch(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let branch = required_json_string(&payload, "branch", "branch 不能为空")?;
    let mut args = vec!["branch".to_string(), branch.to_string()];
    if let Some(source) = payload
        .get("source")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        args.push(source.to_string());
    }
    let output = run_git_command_checked(&project_path, &args)?;
    Ok(Json(
        json!({ "output": output, "summary": project_git_summary_json(&project_path), "branch": branch }),
    ))
}

async fn project_git_tag(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let tag = required_json_string(&payload, "tag", "tag 不能为空")?;
    let mut args = vec!["tag".to_string(), tag.to_string()];
    if let Some(source) = payload
        .get("source")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        args.push(source.to_string());
    }
    let output = run_git_command_checked(&project_path, &args)?;
    Ok(Json(
        json!({ "output": output, "summary": project_git_summary_json(&project_path), "tag": tag }),
    ))
}

async fn project_git_delete_branch(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let branch = required_json_string(&payload, "branch", "branch 不能为空")?;
    let output = if let Some(remote) = payload
        .get("remote")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        let trimmed_branch = trim_remote_branch_prefix(branch, remote);
        run_git_command_checked(
            &project_path,
            &["push", remote, "--delete", &trimmed_branch],
        )?
    } else {
        let current = read_git_info(&project_path, false);
        if current.branch.as_deref() == Some(branch) {
            return Err(ApiError::bad_request("不能删除当前分支"));
        }
        run_git_command_checked(&project_path, &["branch", "-d", branch])?
    };
    Ok(Json(
        json!({ "output": output, "summary": project_git_summary_json(&project_path), "branch": branch }),
    ))
}

async fn project_git_cherry_pick(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let sha = required_json_string(&payload, "sha", "sha 不能为空")?;
    let output = run_git_command_checked(&project_path, &["cherry-pick", sha])?;
    Ok(Json(
        json!({ "output": output, "summary": project_git_summary_json(&project_path) }),
    ))
}

async fn project_git_checkout_detached(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let reference = required_json_string(&payload, "ref", "ref 不能为空")?;
    let output = run_git_command_checked(&project_path, &["checkout", "--detach", reference])?;
    Ok(Json(
        json!({ "output": output, "summary": project_git_summary_json(&project_path) }),
    ))
}

async fn project_git_conflict_file(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let file_path = query
        .get("path")
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("path 不能为空"))?;
    Ok(Json(read_git_conflict_file_detail(
        &project_path,
        file_path,
    )?))
}

async fn project_git_conflict_save_result(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let file_path = required_json_string(&payload, "path", "path 不能为空")?;
    let content = payload
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::bad_request("content 不能为空"))?;
    let absolute = resolve_project_relative_file_path(&project_path, file_path)?;
    if let Some(parent) = absolute.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| ApiError::internal(format!("创建目录失败: {error}")))?;
    }
    fs::write(&absolute, content)
        .map_err(|error| ApiError::internal(format!("保存冲突结果失败: {error}")))?;
    Ok(Json(read_git_conflict_file_detail(
        &project_path,
        file_path,
    )?))
}

async fn project_git_conflict_mark_resolved(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let file_path = required_json_string(&payload, "path", "path 不能为空")?;
    run_git_command_checked(&project_path, &["add", "--", file_path])?;
    Ok(Json(read_git_operation_state_value(&project_path)?))
}

async fn project_git_operation_continue(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let operation = detect_git_operation(&project_path)?;
    let args: Vec<&str> = match operation.as_str() {
        "rebase" => vec!["rebase", "--continue"],
        "cherry-pick" => vec!["cherry-pick", "--continue"],
        "revert" => vec!["revert", "--continue"],
        "merge" => vec!["commit", "--no-edit"],
        _ => return Err(ApiError::bad_request("当前没有可继续的 Git 操作")),
    };
    run_git_command_checked(&project_path, &args)?;
    Ok(Json(read_git_operation_state_value(&project_path)?))
}

async fn project_git_operation_abort(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let operation = detect_git_operation(&project_path)?;
    let args: Vec<&str> = match operation.as_str() {
        "rebase" => vec!["rebase", "--abort"],
        "cherry-pick" => vec!["cherry-pick", "--abort"],
        "revert" => vec!["revert", "--abort"],
        "merge" => vec!["merge", "--abort"],
        _ => return Err(ApiError::bad_request("当前没有可中止的 Git 操作")),
    };
    run_git_command_checked(&project_path, &args)?;
    Ok(Json(read_git_operation_state_value(&project_path)?))
}

async fn project_git_undo_turn_changes(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let changes = payload
        .get("changes")
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::bad_request("changes 必须是数组"))?;
    if changes.is_empty() {
        return Err(ApiError::bad_request("没有可撤销的文件改动"));
    }
    let mut restored = Vec::new();
    let mut deleted = Vec::new();
    for change in changes {
        let Some(path) = change.get("path").and_then(Value::as_str) else {
            continue;
        };
        let absolute = resolve_project_relative_file_path(&project_path, path)?;
        let operations = change
            .get("operations")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for operation in operations {
            let kind = operation.get("kind").and_then(Value::as_str).unwrap_or("");
            match kind {
                "delete-file" => {
                    if absolute.exists() {
                        fs::remove_file(&absolute).map_err(|error| {
                            ApiError::internal(format!("删除文件失败: {error}"))
                        })?;
                    }
                    deleted.push(path.to_string());
                }
                "restore-file" => {
                    let before = operation
                        .get("beforeText")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if let Some(parent) = absolute.parent() {
                        fs::create_dir_all(parent).map_err(|error| {
                            ApiError::internal(format!("创建目录失败: {error}"))
                        })?;
                    }
                    fs::write(&absolute, before)
                        .map_err(|error| ApiError::internal(format!("恢复文件失败: {error}")))?;
                    restored.push(path.to_string());
                }
                "replace-snippet" => {
                    let before = operation
                        .get("beforeText")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let after = operation
                        .get("afterText")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let current = fs::read_to_string(&absolute).unwrap_or_default();
                    let next = if !after.is_empty() && current.contains(after) {
                        current.replacen(after, before, 1)
                    } else {
                        before.to_string()
                    };
                    fs::write(&absolute, next)
                        .map_err(|error| ApiError::internal(format!("恢复片段失败: {error}")))?;
                    restored.push(path.to_string());
                }
                _ => {}
            }
        }
    }
    Ok(Json(json!({
        "restored": restored,
        "deleted": deleted,
        "summary": project_git_summary_json(&project_path),
    })))
}

async fn project_git_worktrees(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    Ok(Json(read_git_worktrees_value(&project_path)?))
}

async fn project_git_suggest_worktree_path(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let branch = query
        .get("branch")
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("worktree");
    let base = PathBuf::from(&project_path);
    let parent = base.parent().unwrap_or_else(|| Path::new("."));
    let stem = base
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("repo");
    let sanitized_branch = branch
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let candidate = parent.join(format!(
        "{stem}-{}",
        if sanitized_branch.is_empty() {
            "worktree"
        } else {
            &sanitized_branch
        }
    ));
    Ok(Json(json!({ "path": candidate })))
}

async fn project_git_create_worktree(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let branch = required_json_string(&payload, "branch", "branch 不能为空")?;
    let path = required_json_string(&payload, "path", "path 不能为空")?;
    let base = payload
        .get("base")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("HEAD");
    let add_project = payload
        .get("addProject")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    run_git_command_checked(
        &project_path,
        &["worktree", "add", "-b", branch, path, base],
    )?;
    let mut new_project_id = Value::Null;
    let mut workspace = Value::Null;
    if add_project {
        let _guard = lock_workspace_write(&state)?;
        let connection = open_initialized_workspace_database(&state)?;
        match create_project_row(&connection, path) {
            Ok(id) => new_project_id = json!(id),
            Err(_) => {
                if let Ok(existing) = find_project_id_by_path(&connection, path) {
                    new_project_id = existing.map(Value::String).unwrap_or(Value::Null);
                }
            }
        }
        workspace = read_workspace_bootstrap_with_connection(&state, &connection)?;
    }
    let mut response = json!({
        "ok": true,
        "path": path,
        "branch": branch,
        "projectId": new_project_id,
    });
    if add_project {
        if let Some(object) = response.as_object_mut() {
            object.insert("workspace".to_string(), workspace);
        }
    }
    Ok(Json(response))
}

async fn project_git_delete_worktree(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let project_path = read_project_path(&state, &project_id)?;
    let path = required_json_string(&payload, "path", "path 不能为空")?;
    run_git_command_checked(&project_path, &["worktree", "remove", path])?;
    let workspace = read_workspace_bootstrap(&state)?;
    Ok(Json(json!({ "ok": true, "workspace": workspace })))
}

async fn create_project(
    State(state): State<AppState>,
    Json(payload): Json<ProjectCreateRequest>,
) -> ApiResult<Json<Value>> {
    let project_path = payload
        .path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("path 不能为空"))?;
    let resolved_path = resolve_accessible_directory(project_path)?;

    let _guard = lock_workspace_write(&state)?;
    let connection = open_initialized_workspace_database(&state)?;
    let project_id = create_project_row(&connection, &resolved_path)?;
    let workspace = read_workspace_bootstrap_with_connection(&state, &connection)?;
    Ok(Json(json!({
        "ok": true,
        "projectId": project_id,
        "workspace": workspace,
    })))
}

async fn rename_project(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<RenameRequest>,
) -> ApiResult<Json<Value>> {
    let name = payload
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("name 不能为空"))?;

    let _guard = lock_workspace_write(&state)?;
    let connection = open_initialized_workspace_database(&state)?;
    ensure_project_exists(&connection, &project_id)?;
    connection
        .execute(
            "UPDATE projects SET name = ?, custom_name = 1, updated_at = ? WHERE id = ?",
            params![name, current_timestamp(), project_id],
        )
        .map_err(|error| ApiError::internal(format!("修改项目失败: {error}")))?;
    let workspace = read_workspace_bootstrap_with_connection(&state, &connection)?;
    Ok(Json(json!({ "ok": true, "workspace": workspace })))
}

async fn delete_project(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let _guard = lock_workspace_write(&state)?;
    let mut connection = open_initialized_workspace_database(&state)?;
    let thread_ids = read_project_thread_ids(&connection, &project_id)?;
    remove_project_row(&mut connection, &project_id)?;
    for thread_id in thread_ids {
        let _ = close_thread_runtime(&state, &thread_id);
        remove_run_records_for_thread(&state, &thread_id);
        state.agent_runs.forget_thread(&thread_id);
    }
    let workspace = read_workspace_bootstrap_with_connection(&state, &connection)?;
    Ok(Json(json!({ "ok": true, "workspace": workspace })))
}

async fn create_thread(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<ThreadCreateRequest>,
) -> ApiResult<Json<Value>> {
    let _guard = lock_workspace_write(&state)?;
    let mut connection = open_initialized_workspace_database(&state)?;
    let provider =
        resolve_requested_thread_provider(payload.provider_id.as_deref(), |provider_id| {
            state
                .agent_runs
                .resolve_command(provider_id, false)
                .is_some()
        })?;
    let permission_mode =
        resolve_thread_create_permission_mode(provider, payload.permission_mode.as_deref())?;
    let model = normalize_thread_metadata_value(payload.model.as_deref(), "model")?;
    let reasoning_effort =
        normalize_thread_metadata_value(payload.reasoning_effort.as_deref(), "reasoningEffort")?;
    if !provider_supports_reasoning_effort(provider) && reasoning_effort.is_some() {
        return Err(ApiError::bad_request(
            "reasoningEffort 目前仅支持 Claude Code 或 OpenAI Codex 聊天",
        ));
    }
    let channel_id = state
        .agent_channels
        .validate_selection(provider, payload.channel_id.as_deref())
        .map_err(ApiError::bad_request)?;
    let thread_id = create_thread_row(
        &mut connection,
        &project_id,
        payload.title.as_deref(),
        provider,
        permission_mode.as_deref(),
        model.as_deref(),
        reasoning_effort.as_deref(),
        channel_id.as_deref(),
    )?;
    let thread = read_thread_summary(&connection, &thread_id)?;
    Ok(Json(json!({
        "ok": true,
        "threadId": thread_id,
        "thread": thread,
    })))
}

async fn update_thread(
    State(state): State<AppState>,
    AxumPath(thread_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let _guard = lock_workspace_write(&state)?;
    let mut connection = open_initialized_workspace_database(&state)?;
    let mut refresh_workspace = false;
    let channel_changed = payload.get("channelId").is_some();

    if let Some(title) = payload
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        ensure_thread_exists(&connection, &thread_id)?;
        connection
            .execute(
                "UPDATE threads SET title = ?, custom_title = 1, updated_at = ? WHERE id = ?",
                params![title, current_timestamp(), thread_id],
            )
            .map_err(|error| ApiError::internal(format!("修改聊天名称失败: {error}")))?;
        refresh_workspace = true;
    }

    update_thread_metadata_from_payload(
        &mut connection,
        &thread_id,
        &payload,
        &state.agent_channels,
    )?;
    if channel_changed {
        let _ = close_thread_runtime(&state, &thread_id);
        state.agent_runs.forget_thread(&thread_id);
    }

    if refresh_workspace {
        let workspace = read_workspace_bootstrap_with_connection(&state, &connection)?;
        return Ok(Json(json!({ "ok": true, "workspace": workspace })));
    }

    Ok(Json(json!({ "ok": true })))
}

async fn delete_thread(
    State(state): State<AppState>,
    AxumPath(thread_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let _guard = lock_workspace_write(&state)?;
    let mut connection = open_initialized_workspace_database(&state)?;
    remove_thread_row(&mut connection, &thread_id)?;
    let _ = close_thread_runtime(&state, &thread_id);
    remove_run_records_for_thread(&state, &thread_id);
    state.agent_runs.forget_thread(&thread_id);
    Ok(Json(json!({ "ok": true })))
}

async fn pin_thread(
    State(state): State<AppState>,
    AxumPath(thread_id): AxumPath<String>,
    Json(payload): Json<PinRequest>,
) -> ApiResult<Json<Value>> {
    let _guard = lock_workspace_write(&state)?;
    let connection = open_initialized_workspace_database(&state)?;
    ensure_thread_exists(&connection, &thread_id)?;
    let pinned_at: Option<String> = payload.pinned.unwrap_or(false).then(current_timestamp);
    connection
        .execute(
            "UPDATE threads SET pinned_at = ? WHERE id = ?",
            params![pinned_at, thread_id],
        )
        .map_err(|error| ApiError::internal(format!("置顶聊天失败: {error}")))?;
    let workspace = read_workspace_bootstrap_with_connection(&state, &connection)?;
    Ok(Json(json!({ "ok": true, "workspace": workspace })))
}

async fn pin_project(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(payload): Json<PinRequest>,
) -> ApiResult<Json<Value>> {
    let _guard = lock_workspace_write(&state)?;
    let connection = open_initialized_workspace_database(&state)?;
    ensure_project_exists(&connection, &project_id)?;
    let pinned_at: Option<String> = payload.pinned.unwrap_or(false).then(current_timestamp);
    connection
        .execute(
            "UPDATE projects SET pinned_at = ? WHERE id = ?",
            params![pinned_at, project_id],
        )
        .map_err(|error| ApiError::internal(format!("置顶项目失败: {error}")))?;
    let workspace = read_workspace_bootstrap_with_connection(&state, &connection)?;
    Ok(Json(json!({ "ok": true, "workspace": workspace })))
}

async fn get_thread_history(
    State(state): State<AppState>,
    AxumPath(thread_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let _guard = lock_workspace_write(&state)?;
    let mut connection = open_initialized_workspace_database(&state)?;
    read_thread_history_payload(&mut connection, &thread_id).map(Json)
}

async fn save_thread_history(
    State(state): State<AppState>,
    AxumPath(thread_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let turns = payload
        .get("turns")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| ApiError::bad_request("turns 必须是数组"))?;
    let _guard = lock_workspace_write(&state)?;
    let mut connection = open_initialized_workspace_database(&state)?;
    write_thread_history(&mut connection, &thread_id, &turns)?;
    Ok(Json(json!({ "ok": true })))
}

fn read_workspace_bootstrap(state: &AppState) -> ApiResult<Value> {
    let settings = read_app_settings(&state)?;
    let connection = open_initialized_workspace_database(state)?;
    read_workspace_bootstrap_with_settings(state, &connection, &settings)
}

fn read_workspace_bootstrap_with_connection(
    state: &AppState,
    connection: &Connection,
) -> ApiResult<Value> {
    let settings = read_app_settings(state)?;
    read_workspace_bootstrap_with_settings(state, connection, &settings)
}

fn read_workspace_bootstrap_with_settings(
    _state: &AppState,
    connection: &Connection,
    settings: &Value,
) -> ApiResult<Value> {
    import_claude_sessions(connection)?;

    let restore_selection = settings
        .get("general")
        .and_then(|general| general.get("restoreLastSelectionOnLaunch"))
        .and_then(Value::as_bool)
        .unwrap_or(true);

    let panel_state = read_panel_state(connection)?;
    let project_rows = read_project_rows(connection)?;
    let thread_rows = read_thread_rows(connection)?;
    let thread_rows = filter_visible_thread_rows(connection, thread_rows)?;
    let model_preferences_by_thread = read_all_thread_model_preferences(connection)?;
    let mut active_project_id = if restore_selection {
        read_state_value(&connection, "activeProjectId")?
    } else {
        None
    };
    let mut active_thread_id = if restore_selection {
        read_state_value(&connection, "activeThreadId")?
    } else {
        None
    };

    let has_active_project = active_project_id
        .as_ref()
        .map(|id| project_rows.iter().any(|project| &project.id == id))
        .unwrap_or(false);
    if !has_active_project {
        active_project_id = project_rows.first().map(|project| project.id.clone());
    }

    let active_project_id_ref = active_project_id.as_deref();
    let projects: Vec<Value> = project_rows
        .iter()
        .map(|project| -> ApiResult<Value> {
            let git_info = if Some(project.id.as_str()) == active_project_id_ref {
                read_git_info(&project.path, true)
            } else {
                GitInfo {
                    is_git_repo: false,
                    branch: None,
                    diff: empty_git_diff(),
                }
            };
            let project_threads: Vec<Value> = thread_rows
                .iter()
                .filter(|thread| thread.project_id == project.id)
                .map(|thread| {
                    thread_summary_json(thread, model_preferences_by_thread.get(&thread.id))
                })
                .collect();
            let mut project_json = json!({
                "id": project.id,
                "name": project.name,
                "path": project.path,
                "createdAt": project.created_at,
                "updatedAt": project.updated_at,
                "gitBranch": git_info.branch,
                "gitDiff": git_info.diff,
                "isGitRepo": git_info.is_git_repo,
                "isGitWorktree": is_git_worktree(&project.path),
                "threads": project_threads,
            });
            if let Some(pinned_at) = project.pinned_at.as_ref() {
                if let Some(object) = project_json.as_object_mut() {
                    object.insert("pinnedAt".to_string(), json!(pinned_at));
                }
            }
            remove_null_fields(&mut project_json);
            Ok(project_json)
        })
        .collect::<ApiResult<Vec<_>>>()?;

    let active_project_threads = active_project_id
        .as_ref()
        .and_then(|id| {
            projects
                .iter()
                .find(|project| project.get("id").and_then(Value::as_str) == Some(id.as_str()))
        })
        .and_then(|project| project.get("threads"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let has_active_thread = active_thread_id
        .as_ref()
        .map(|id| {
            active_project_threads
                .iter()
                .any(|thread| thread.get("id").and_then(Value::as_str) == Some(id.as_str()))
        })
        .unwrap_or(false);
    if !has_active_thread {
        active_thread_id = active_project_threads
            .first()
            .and_then(|thread| thread.get("id"))
            .and_then(Value::as_str)
            .map(ToString::to_string);
    }

    if let Some(id) = active_project_id.as_deref() {
        write_state_value(&connection, "activeProjectId", id)?;
    }
    if let Some(id) = active_thread_id.as_deref() {
        write_state_value(&connection, "activeThreadId", id)?;
    }

    Ok(json!({
        "projects": projects,
        "activeProjectId": active_project_id,
        "activeThreadId": active_thread_id,
        "panelState": panel_state,
    }))
}

#[derive(Clone, Copy)]
enum UpdateMode {
    Replace,
    Merge,
}

fn read_app_settings(state: &AppState) -> ApiResult<Value> {
    let settings_path = settings_path(state);
    let Ok(content) = fs::read_to_string(settings_path) else {
        return Ok(default_app_settings());
    };
    let value = serde_json::from_str::<Value>(&content).unwrap_or_else(|_| default_app_settings());
    Ok(normalize_app_settings(&value))
}

fn update_settings_section(
    state: &AppState,
    section: &str,
    payload: Value,
    mode: UpdateMode,
) -> ApiResult<Value> {
    let _guard = state
        .settings_write_lock
        .lock()
        .map_err(|error| ApiError::internal(format!("锁定设置写入失败: {error}")))?;
    let mut settings = read_app_settings(state)?;
    match mode {
        UpdateMode::Replace => {
            settings[section] = payload;
        }
        UpdateMode::Merge => {
            if !settings.get(section).is_some_and(Value::is_object) {
                settings[section] = json!({});
            }
            if let (Some(current), Some(next)) = (settings.get_mut(section), payload.as_object()) {
                if let Some(current_object) = current.as_object_mut() {
                    for (key, value) in next {
                        current_object.insert(key.clone(), value.clone());
                    }
                }
            }
        }
    }
    settings = normalize_app_settings(&settings);
    write_app_settings(state, &settings)?;
    Ok(settings)
}

fn write_app_settings(state: &AppState, settings: &Value) -> ApiResult<()> {
    let path = settings_path(state);
    let parent = path
        .parent()
        .ok_or_else(|| ApiError::internal("设置文件路径无效"))?;
    fs::create_dir_all(parent)
        .map_err(|error| ApiError::internal(format!("创建设置目录失败: {error}")))?;
    let temporary_path = path.with_extension(format!(
        "json.{}.{}.tmp",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    let content = serde_json::to_string_pretty(settings)
        .map_err(|error| ApiError::internal(format!("序列化设置失败: {error}")))?;
    fs::write(&temporary_path, format!("{content}\n"))
        .map_err(|error| ApiError::internal(format!("写入设置失败: {error}")))?;
    fs::rename(&temporary_path, &path)
        .map_err(|error| ApiError::internal(format!("保存设置失败: {error}")))?;
    Ok(())
}

fn normalize_app_settings(value: &Value) -> Value {
    let record = value.as_object();
    json!({
        "general": normalize_general_settings(record.and_then(|item| item.get("general"))),
        "agentRuntime": normalize_agent_runtime_settings(record.and_then(|item| item.get("agentRuntime"))),
        "appearance": normalize_appearance_settings(record.and_then(|item| item.get("appearance"))),
        "models": normalize_model_settings(record.and_then(|item| item.get("models"))),
        "shortcuts": normalize_shortcut_settings(record.and_then(|item| item.get("shortcuts"))),
        "openWith": normalize_open_with_settings(record.and_then(|item| item.get("openWith"))),
    })
}

fn normalize_general_settings(value: Option<&Value>) -> Value {
    let record = value.and_then(Value::as_object);
    let default_patterns = default_workbench_ignore_patterns();
    let has_customized_flag = record
        .and_then(|item| item.get("reviewIgnorePatternsCustomized"))
        .is_some_and(Value::is_boolean);
    let review_ignore_patterns_customized =
        bool_setting(record, "reviewIgnorePatternsCustomized", false);
    let review_noise_patterns = if has_customized_flag {
        if review_ignore_patterns_customized {
            string_array_setting(record.and_then(|item| item.get("reviewNoisePatterns")), 160)
        } else {
            default_patterns
        }
    } else {
        merge_string_patterns(
            default_patterns
                .into_iter()
                .chain(string_array_setting(
                    record.and_then(|item| item.get("reviewNoisePatterns")),
                    160,
                ))
                .collect(),
        )
    };

    json!({
        "restoreLastSelectionOnLaunch": bool_setting(record, "restoreLastSelectionOnLaunch", true),
        "autoRefreshGitStatus": bool_setting(record, "autoRefreshGitStatus", true),
        "enableThreadSystemNotifications": bool_setting(record, "enableThreadSystemNotifications", true),
        "autoGuideQueuedPrompts": bool_setting(record, "autoGuideQueuedPrompts", false),
        "autoCheckAppUpdate": bool_setting(record, "autoCheckAppUpdate", true),
        "showDebugButton": bool_setting(record, "showDebugButton", true),
        "collapseIntermediateProcess": bool_setting(record, "collapseIntermediateProcess", false),
        "defaultPermissionMode": enum_setting(record, "defaultPermissionMode", &["default", "auto", "bypassPermissions"], "default"),
        "reviewHideNoiseFilesByDefault": bool_setting(record, "reviewHideNoiseFilesByDefault", true),
        "reviewDefaultDisplayMode": enum_setting(record, "reviewDefaultDisplayMode", &["tree", "flat"], "tree"),
        "reviewNoisePatterns": review_noise_patterns,
        "reviewIgnorePatternsCustomized": review_ignore_patterns_customized,
    })
}

fn normalize_agent_runtime_settings(value: Option<&Value>) -> Value {
    let record = value.and_then(Value::as_object);
    json!({
        "defaultProviderId": enum_setting(
            record,
            "defaultProviderId",
            &[
                CLAUDE_CODE_PROVIDER_ID,
                GROK_BUILD_PROVIDER_ID,
                OPENAI_CODEX_PROVIDER_ID,
                OPENCODE_PROVIDER_ID,
            ],
            CLAUDE_CODE_PROVIDER_ID,
        ),
    })
}

fn agent_runtime_settings_from_settings(settings: &Value) -> Value {
    normalize_agent_runtime_settings(settings.get("agentRuntime"))
}

fn normalize_appearance_settings(value: Option<&Value>) -> Value {
    let record = value.and_then(Value::as_object);
    let legacy_ui_font_preset = enum_value(
        record.and_then(|item| item.get("uiFontFamily")),
        &["system", "yahei", "dengxian", "song"],
        "codex",
    );
    let legacy_code_font_preset = enum_value(
        record.and_then(|item| item.get("codeFontFamily")),
        &["cascadia", "jetbrains", "consolas"],
        "cascadia",
    );
    let mut appearance = Map::new();
    appearance.insert(
        "themeMode".to_string(),
        json!(enum_setting(
            record,
            "themeMode",
            &["system", "light", "dark"],
            "system"
        )),
    );
    appearance.insert(
        "density".to_string(),
        json!(enum_setting(
            record,
            "density",
            &["comfortable", "compact"],
            "comfortable"
        )),
    );
    appearance.insert(
        "accentColor".to_string(),
        json!(enum_setting(
            record,
            "accentColor",
            &["blue", "emerald", "amber", "rose", "violet", "custom"],
            "blue"
        )),
    );
    appearance.insert(
        "accentColorCustom".to_string(),
        json!(hex_color_setting(record, "accentColorCustom", "#2374C6")),
    );
    appearance.insert(
        "uiFontMode".to_string(),
        json!(enum_setting(
            record,
            "uiFontMode",
            &["preset", "custom"],
            if record.is_some_and(|item| item.contains_key("uiFontFamily")) {
                "preset"
            } else {
                "preset"
            }
        )),
    );
    appearance.insert(
        "uiFontPreset".to_string(),
        json!(enum_setting_with_fallback(
            record,
            "uiFontPreset",
            &[
                "codex",
                "system",
                "segoe",
                "yahei",
                "dengxian",
                "song",
                "sourceHanSans",
                "misans",
                "harmony"
            ],
            &legacy_ui_font_preset
        )),
    );
    appearance.insert(
        "uiFontCustom".to_string(),
        json!(string_setting(record, "uiFontCustom", "-apple-system, BlinkMacSystemFont, \"Segoe UI Variable Text\", \"Segoe UI Variable Display\", \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif", 500)),
    );
    appearance.insert(
        "chatFontMode".to_string(),
        json!(enum_setting(
            record,
            "chatFontMode",
            &["followUi", "preset", "custom"],
            "followUi"
        )),
    );
    appearance.insert(
        "chatFontPreset".to_string(),
        json!(enum_setting(
            record,
            "chatFontPreset",
            &[
                "codex",
                "system",
                "segoe",
                "yahei",
                "dengxian",
                "song",
                "sourceHanSans",
                "misans",
                "harmony"
            ],
            "codex"
        )),
    );
    appearance.insert(
        "chatFontCustom".to_string(),
        json!(string_setting(record, "chatFontCustom", "-apple-system, BlinkMacSystemFont, \"Segoe UI Variable Text\", \"Segoe UI Variable Display\", \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif", 500)),
    );
    appearance.insert(
        "codeFontMode".to_string(),
        json!(enum_setting(
            record,
            "codeFontMode",
            &["preset", "custom"],
            if record.is_some_and(|item| item.contains_key("codeFontFamily")) {
                "preset"
            } else {
                "preset"
            }
        )),
    );
    appearance.insert(
        "codeFontPreset".to_string(),
        json!(enum_setting_with_fallback(
            record,
            "codeFontPreset",
            &[
                "cascadia",
                "jetbrains",
                "consolas",
                "firaCode",
                "sourceCodePro"
            ],
            &legacy_code_font_preset
        )),
    );
    appearance.insert(
        "codeFontCustom".to_string(),
        json!(string_setting(
            record,
            "codeFontCustom",
            "\"Cascadia Code\", \"Cascadia Mono\", Consolas, monospace",
            500
        )),
    );
    appearance.insert(
        "uiFontSize".to_string(),
        json!(number_choice_setting(
            record,
            "uiFontSize",
            &[12, 13, 14, 15],
            14
        )),
    );
    appearance.insert(
        "chatFontSize".to_string(),
        json!(number_choice_setting(
            record,
            "chatFontSize",
            &[13, 14, 15, 16],
            14
        )),
    );
    appearance.insert(
        "codeFontSize".to_string(),
        json!(number_choice_setting(
            record,
            "codeFontSize",
            &[12, 13, 14],
            12
        )),
    );
    appearance.insert(
        "sidebarWidth".to_string(),
        json!(enum_setting(
            record,
            "sidebarWidth",
            &["narrow", "default", "wide"],
            "default"
        )),
    );
    if let Some(width) = ranged_i64_setting(record, "sidebarCustomWidth", 220, 520) {
        appearance.insert("sidebarCustomWidth".to_string(), json!(width));
    }
    appearance.insert(
        "windowMaterial".to_string(),
        json!(enum_setting(
            record,
            "windowMaterial",
            &["auto", "none", "mica", "acrylic", "micaAlt"],
            "mica"
        )),
    );
    Value::Object(appearance)
}

fn normalize_model_settings(value: Option<&Value>) -> Value {
    let record = value.and_then(Value::as_object);
    let custom_models = normalize_custom_models(record.and_then(|item| item.get("customModels")));
    let default_model_id = normalize_default_model_id(
        record.and_then(|item| item.get("defaultModelId")),
        &custom_models,
    );
    json!({
        "customModels": custom_models,
        "defaultModelId": default_model_id,
        "modelCapabilities": normalize_model_capabilities(record.and_then(|item| item.get("modelCapabilities"))),
    })
}

fn normalize_shortcut_settings(value: Option<&Value>) -> Value {
    let record = value.and_then(Value::as_object);
    json!({
        "newChat": nullable_shortcut_setting(record, "newChat", Some("ctrl+n")),
        "toggleSearch": nullable_shortcut_setting(record, "toggleSearch", Some("ctrl+g")),
        "toggleDebug": nullable_shortcut_setting(record, "toggleDebug", Some("ctrl+shift+d")),
        "composerSend": enum_setting(record, "composerSend", &["enter", "modEnter"], "enter"),
    })
}

fn normalize_open_with_settings(value: Option<&Value>) -> Value {
    let record = value.and_then(Value::as_object);
    if let Some(record) = record {
        if record.contains_key("target") {
            return normalize_legacy_open_with_settings(record);
        }
    }
    json!({
        "selectedTargetId": normalize_open_target_id(record.and_then(|item| item.get("selectedTargetId"))).unwrap_or_else(|| "vscode".to_string()),
        "customTargets": normalize_open_app_targets(record.and_then(|item| item.get("customTargets"))),
    })
}

fn normalize_legacy_open_with_settings(record: &Map<String, Value>) -> Value {
    let target = enum_value(
        record.get("target"),
        &["auto", "cursor", "vscode", "custom"],
        "auto",
    );
    if target == "cursor" || target == "vscode" {
        return json!({
            "selectedTargetId": target,
            "customTargets": [],
        });
    }
    if target == "custom" {
        if let Some(command) = limited_string(record.get("customCommand"), 300) {
            return json!({
                "selectedTargetId": "custom",
                "customTargets": [{
                    "id": "custom",
                    "label": "Custom",
                    "kind": "command",
                    "command": command,
                    "args": parse_open_with_args(limited_string(record.get("customArgs"), 600).as_deref().unwrap_or("")),
                }],
            });
        }
    }
    json!({
        "selectedTargetId": "vscode",
        "customTargets": [],
    })
}

fn default_workbench_ignore_patterns() -> Vec<String> {
    [
        ".idea",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        ".cache",
        "logs",
        ".ds_store",
        "thumbs.db",
        "*.log",
        "*.pyc",
        "*.pyo",
        "*.tmp",
        "*.temp",
        "*.swp",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

fn bool_setting(record: Option<&Map<String, Value>>, key: &str, default_value: bool) -> bool {
    record
        .and_then(|item| item.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(default_value)
}

fn enum_setting(
    record: Option<&Map<String, Value>>,
    key: &str,
    allowed: &[&str],
    default_value: &str,
) -> String {
    enum_value(
        record.and_then(|item| item.get(key)),
        allowed,
        default_value,
    )
}

fn enum_setting_with_fallback(
    record: Option<&Map<String, Value>>,
    key: &str,
    allowed: &[&str],
    fallback: &str,
) -> String {
    enum_value(record.and_then(|item| item.get(key)), allowed, fallback)
}

fn enum_value(value: Option<&Value>, allowed: &[&str], default_value: &str) -> String {
    value
        .and_then(Value::as_str)
        .filter(|candidate| allowed.iter().any(|allowed| allowed == candidate))
        .unwrap_or(default_value)
        .to_string()
}

fn string_setting(
    record: Option<&Map<String, Value>>,
    key: &str,
    default_value: &str,
    max_len: usize,
) -> String {
    limited_string(record.and_then(|item| item.get(key)), max_len)
        .unwrap_or_else(|| default_value.to_string())
}

fn limited_string(value: Option<&Value>, max_len: usize) -> Option<String> {
    let text = value?.as_str()?.trim();
    if text.is_empty() {
        return None;
    }
    Some(text.chars().take(max_len).collect())
}

fn hex_color_setting(
    record: Option<&Map<String, Value>>,
    key: &str,
    default_value: &str,
) -> String {
    let Some(value) = record
        .and_then(|item| item.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
    else {
        return default_value.to_string();
    };
    let bytes = value.as_bytes();
    let valid = bytes.len() == 7
        && bytes[0] == b'#'
        && bytes[1..].iter().all(|byte| byte.is_ascii_hexdigit());
    if valid {
        value.to_string()
    } else {
        default_value.to_string()
    }
}

fn number_choice_setting(
    record: Option<&Map<String, Value>>,
    key: &str,
    allowed: &[i64],
    default_value: i64,
) -> i64 {
    let value = record
        .and_then(|item| item.get(key))
        .and_then(Value::as_i64)
        .unwrap_or(default_value);
    if allowed.contains(&value) {
        value
    } else {
        default_value
    }
}

fn ranged_i64_setting(
    record: Option<&Map<String, Value>>,
    key: &str,
    min_value: i64,
    max_value: i64,
) -> Option<i64> {
    let value = record.and_then(|item| item.get(key))?.as_i64()?;
    (min_value..=max_value).contains(&value).then_some(value)
}

fn string_array_setting(value: Option<&Value>, limit: usize) -> Vec<String> {
    let Some(items) = value.and_then(Value::as_array) else {
        return vec![];
    };
    items
        .iter()
        .filter_map(|item| limited_string(Some(item), 300))
        .take(limit)
        .collect()
}

fn merge_string_patterns(patterns: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut merged = vec![];
    for pattern in patterns {
        let normalized = pattern.trim();
        if normalized.is_empty() || !seen.insert(normalized.to_string()) {
            continue;
        }
        merged.push(normalized.to_string());
    }
    merged
}

fn nullable_shortcut_setting(
    record: Option<&Map<String, Value>>,
    key: &str,
    default_value: Option<&str>,
) -> Value {
    match record.and_then(|item| item.get(key)) {
        Some(Value::Null) => Value::Null,
        Some(value) => limited_string(Some(value), 80)
            .map(Value::String)
            .unwrap_or_else(|| default_value.map_or(Value::Null, |value| json!(value))),
        None => default_value.map_or(Value::Null, |value| json!(value)),
    }
}

fn normalize_custom_models(value: Option<&Value>) -> Value {
    let Some(items) = value.and_then(Value::as_array) else {
        return json!([]);
    };
    let mut seen = std::collections::HashSet::new();
    let mut models = Vec::new();
    for item in items {
        let Some(record) = item.as_object() else {
            continue;
        };
        let Some(id) = normalize_model_id(record.get("id")) else {
            continue;
        };
        if !seen.insert(id.clone()) {
            continue;
        }
        let mut model = Map::new();
        model.insert("id".to_string(), json!(id));
        if let Some(label) = limited_string(record.get("label"), 120) {
            model.insert("label".to_string(), json!(label));
        }
        if let Some(description) = limited_string(record.get("description"), 300) {
            model.insert("description".to_string(), json!(description));
        }
        models.push(Value::Object(model));
    }
    Value::Array(models)
}

fn normalize_model_capabilities(value: Option<&Value>) -> Value {
    let Some(items) = value.and_then(Value::as_array) else {
        return json!([]);
    };
    let mut seen = std::collections::HashSet::new();
    let mut capabilities = Vec::new();
    for item in items {
        let Some(record) = item.as_object() else {
            continue;
        };
        let Some(model_id) = normalize_model_id(record.get("modelId")) else {
            continue;
        };
        if !seen.insert(model_id.clone()) {
            continue;
        }
        let mut capability = Map::new();
        capability.insert("modelId".to_string(), json!(model_id));
        if let Some(tokens) = record
            .get("contextWindowTokens")
            .and_then(Value::as_i64)
            .filter(|tokens| (1..=10_000_000).contains(tokens))
        {
            capability.insert("contextWindowTokens".to_string(), json!(tokens));
        }
        if let Some(supports) = record.get("supportsContext1m").and_then(Value::as_bool) {
            capability.insert("supportsContext1m".to_string(), json!(supports));
        }
        if let Some(context_model) = normalize_model_id(record.get("context1mModel")) {
            capability.insert("context1mModel".to_string(), json!(context_model));
        }
        capabilities.push(Value::Object(capability));
    }
    Value::Array(capabilities)
}

fn normalize_default_model_id(value: Option<&Value>, custom_models: &Value) -> String {
    let candidate = normalize_model_id(value).unwrap_or_else(|| "__default".to_string());
    let slots = [
        "__default",
        "sonnet",
        "sonnet[1m]",
        "opus",
        "opus[1m]",
        "haiku",
    ];
    if slots.contains(&candidate.as_str()) {
        return candidate;
    }
    let custom_match = custom_models
        .as_array()
        .into_iter()
        .flatten()
        .any(|item| item.get("id").and_then(Value::as_str) == Some(candidate.as_str()));
    if custom_match {
        candidate
    } else {
        "__default".to_string()
    }
}

fn normalize_model_id(value: Option<&Value>) -> Option<String> {
    let id = limited_string(value, 120)?;
    let valid = id.chars().all(|ch| {
        ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | ':' | '/' | '[' | ']')
    });
    valid.then_some(id)
}

fn normalize_open_app_targets(value: Option<&Value>) -> Value {
    let Some(items) = value.and_then(Value::as_array) else {
        return json!([]);
    };
    let mut seen = std::collections::HashSet::new();
    let mut targets = Vec::new();
    for item in items {
        let Some(record) = item.as_object() else {
            continue;
        };
        let Some(id) = normalize_open_target_id(record.get("id")) else {
            continue;
        };
        let Some(label) = limited_string(record.get("label"), 80) else {
            continue;
        };
        let kind = enum_value(
            record.get("kind"),
            &["app", "command", "explorer", "terminal", "git-bash", "wsl"],
            "",
        );
        if kind.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        let mut target = Map::new();
        target.insert("id".to_string(), json!(id));
        target.insert("label".to_string(), json!(label));
        target.insert("kind".to_string(), json!(kind));
        if let Some(command) = limited_string(record.get("command"), 300) {
            target.insert("command".to_string(), json!(command));
        }
        target.insert(
            "args".to_string(),
            json!(string_array_setting(record.get("args"), 80)),
        );
        targets.push(Value::Object(target));
    }
    Value::Array(targets)
}

fn normalize_open_target_id(value: Option<&Value>) -> Option<String> {
    let id = limited_string(value, 80)?;
    let valid = id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'));
    valid.then_some(id)
}

fn parse_open_with_args(value: &str) -> Vec<String> {
    value
        .split_whitespace()
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}

fn default_app_settings() -> Value {
    json!({
        "general": {
            "restoreLastSelectionOnLaunch": true,
            "autoRefreshGitStatus": true,
            "enableThreadSystemNotifications": true,
            "autoGuideQueuedPrompts": false,
            "autoCheckAppUpdate": true,
            "showDebugButton": true,
            "collapseIntermediateProcess": false,
            "defaultPermissionMode": "default",
            "reviewHideNoiseFilesByDefault": true,
            "reviewDefaultDisplayMode": "tree",
            "reviewNoisePatterns": [
                ".idea",
                "__pycache__",
                ".pytest_cache",
                ".mypy_cache",
                ".ruff_cache",
                ".cache",
                "logs",
                ".ds_store",
                "thumbs.db",
                "*.log",
                "*.pyc",
                "*.pyo",
                "*.tmp",
                "*.temp",
                "*.swp"
            ],
            "reviewIgnorePatternsCustomized": false
        },
        "agentRuntime": {
            "defaultProviderId": CLAUDE_CODE_PROVIDER_ID
        },
        "appearance": {
            "themeMode": "system",
            "density": "comfortable",
            "accentColor": "blue",
            "accentColorCustom": "#2374C6",
            "uiFontMode": "preset",
            "uiFontPreset": "codex",
            "uiFontCustom": "-apple-system, BlinkMacSystemFont, \"Segoe UI Variable Text\", \"Segoe UI Variable Display\", \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
            "chatFontMode": "followUi",
            "chatFontPreset": "codex",
            "chatFontCustom": "-apple-system, BlinkMacSystemFont, \"Segoe UI Variable Text\", \"Segoe UI Variable Display\", \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
            "codeFontMode": "preset",
            "codeFontPreset": "cascadia",
            "codeFontCustom": "\"Cascadia Code\", \"Cascadia Mono\", Consolas, monospace",
            "uiFontSize": 14,
            "chatFontSize": 14,
            "codeFontSize": 12,
            "sidebarWidth": "default",
            "windowMaterial": "mica"
        },
        "models": {
            "customModels": [],
            "defaultModelId": "__default",
            "modelCapabilities": []
        },
        "shortcuts": {
            "newChat": "ctrl+n",
            "toggleSearch": "ctrl+g",
            "toggleDebug": "ctrl+shift+d",
            "composerSend": "enter"
        },
        "openWith": {
            "selectedTargetId": "vscode",
            "customTargets": []
        }
    })
}

fn configured_model_options() -> Value {
    let main_model = configured_env_string("ANTHROPIC_MODEL");
    let sonnet_model = configured_env_string("ANTHROPIC_DEFAULT_SONNET_MODEL");
    let opus_model = configured_env_string("ANTHROPIC_DEFAULT_OPUS_MODEL");
    let haiku_model = configured_env_string("ANTHROPIC_DEFAULT_HAIKU_MODEL");
    let context_1m_disabled =
        configured_env_string("CLAUDE_CODE_DISABLE_1M_CONTEXT").is_some_and(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        });
    let can_use_context_1m = !context_1m_disabled;
    let sonnet_value = sonnet_model.as_deref().unwrap_or("sonnet");
    let opus_value = opus_model.as_deref().unwrap_or("opus");
    let haiku_value = haiku_model.as_deref().unwrap_or("haiku");
    let mut models = vec![
        json!({
            "id": "__default",
            "label": main_model.as_deref().unwrap_or("默认"),
            "description": main_model
                .as_ref()
                .map(|model| format!("使用当前 Claude Code 默认模型：{model}"))
                .unwrap_or_else(|| "使用当前 Claude Code 默认模型，不传 --model".to_string()),
            "model": main_model,
            "kind": "default",
        }),
        json!({
            "id": "sonnet",
            "label": "Sonnet",
            "description": slot_description("默认推荐模型", sonnet_model.as_deref()),
            "model": sonnet_value,
            "kind": "slot",
            "supportsContext1m": can_use_context_1m && can_use_context_1m_alias(sonnet_value),
            "context1mModel": with_context_1m_suffix(sonnet_value),
        }),
        json!({
            "id": "opus",
            "label": "Opus",
            "description": slot_description("更强，适合复杂任务", opus_model.as_deref()),
            "model": opus_value,
            "kind": "slot",
            "supportsContext1m": can_use_context_1m && can_use_context_1m_alias(opus_value),
            "context1mModel": with_context_1m_suffix(opus_value),
        }),
        json!({
            "id": "haiku",
            "label": "Haiku",
            "description": slot_description("更快，适合简单回复", haiku_model.as_deref()),
            "model": haiku_value,
            "kind": "slot",
        }),
    ];

    for model in &mut models {
        remove_null_fields(model);
        if model.get("supportsContext1m") == Some(&Value::Bool(false)) {
            if let Some(object) = model.as_object_mut() {
                object.remove("supportsContext1m");
                object.remove("context1mModel");
            }
        }
    }

    Value::Array(models)
}

fn remove_null_fields(value: &mut Value) {
    if let Value::Object(object) = value {
        object.retain(|_, item| !item.is_null());
    }
}

fn slot_description(summary: &str, configured_model: Option<&str>) -> String {
    configured_model
        .map(|model| format!("当前映射：{model} · {summary}"))
        .unwrap_or_else(|| summary.to_string())
}

fn with_context_1m_suffix(model: &str) -> String {
    if model.to_ascii_lowercase().ends_with("[1m]") {
        model.to_string()
    } else {
        format!("{model}[1m]")
    }
}

fn can_use_context_1m_alias(model: &str) -> bool {
    let normalized = model.to_ascii_lowercase();
    normalized.contains("claude")
        || normalized.contains("sonnet")
        || normalized.contains("opus")
        || normalized.contains("haiku")
}

fn configured_env_string(key: &str) -> Option<String> {
    read_claude_settings_env()
        .and_then(|env| env.get(key).and_then(Value::as_str).map(str::to_string))
        .or_else(|| env::var(key).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn read_claude_settings_env() -> Option<Map<String, Value>> {
    let path = home_dir()?.join(".claude").join("settings.json");
    let content = fs::read_to_string(path).ok()?;
    let value = serde_json::from_str::<Value>(&content).ok()?;
    value.get("env")?.as_object().cloned()
}

fn parse_claude_cli_version(output: &str) -> Option<String> {
    output.split_whitespace().find_map(|part| {
        let candidate = part
            .trim_matches(|ch: char| !ch.is_ascii_digit() && ch != '.')
            .trim();
        let pieces: Vec<&str> = candidate.split('.').collect();
        if pieces.len() >= 3
            && pieces
                .iter()
                .all(|piece| !piece.is_empty() && piece.chars().all(|ch| ch.is_ascii_digit()))
        {
            Some(pieces[..3].join("."))
        } else {
            None
        }
    })
}

fn compare_semantic_versions(left: &str, right: &str) -> i8 {
    let parse = |value: &str| -> Vec<i64> {
        value
            .split(['-', '+'])
            .next()
            .unwrap_or(value)
            .split('.')
            .map(|piece| piece.parse::<i64>().unwrap_or(0))
            .collect()
    };
    let left_parts = parse(left);
    let right_parts = parse(right);
    for index in 0..3 {
        let left_value = *left_parts.get(index).unwrap_or(&0);
        let right_value = *right_parts.get(index).unwrap_or(&0);
        if left_value > right_value {
            return 1;
        }
        if left_value < right_value {
            return -1;
        }
    }
    0
}

fn extract_agent_semantic_version(value: &str) -> Option<String> {
    value.split_whitespace().find_map(|token| {
        let candidate = token
            .trim_matches(|character: char| {
                !character.is_ascii_alphanumeric() && !matches!(character, '.' | '-' | '+')
            })
            .strip_prefix('v')
            .unwrap_or(token.trim_matches(|character: char| {
                !character.is_ascii_alphanumeric() && !matches!(character, '.' | '-' | '+')
            }));
        let core = candidate.split(['-', '+']).next().unwrap_or(candidate);
        let pieces = core.split('.').collect::<Vec<_>>();
        (pieces.len() == 3
            && pieces.iter().all(|piece| {
                !piece.is_empty() && piece.chars().all(|value| value.is_ascii_digit())
            }))
        .then(|| candidate.to_string())
    })
}

fn background_command(program: &str) -> Command {
    let mut command = Command::new(program);
    configure_background_command(&mut command);
    command
}

fn command_output_with_timeout(
    command: &mut Command,
    timeout: std::time::Duration,
) -> Option<std::process::Output> {
    command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = command.spawn().ok()?;
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            Ok(None) | Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

fn background_tokio_command(program: &str) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(program);
    configure_tokio_background_command(&mut command);
    command
}

#[cfg(target_os = "windows")]
fn configure_background_command(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn configure_background_command(_command: &mut Command) {}

#[cfg(target_os = "windows")]
fn configure_tokio_background_command(command: &mut tokio::process::Command) {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn configure_tokio_background_command(_command: &mut tokio::process::Command) {}

fn resolve_claude_command() -> Option<String> {
    #[cfg(target_os = "windows")]
    let lookup = {
        let mut command = background_command("powershell.exe");
        command.args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Command claude -CommandType Application,ExternalScript -All -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Source) { $_.Source } elseif ($_.Path) { $_.Path } }",
        ]);
        command_output_with_timeout(&mut command, std::time::Duration::from_secs(3))
    };

    #[cfg(not(target_os = "windows"))]
    let lookup = background_command("which").arg("claude").output().ok();

    let path_command = lookup
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|stdout| {
            stdout
                .lines()
                .map(str::trim)
                .filter(|candidate| !candidate.is_empty())
                .filter(|candidate| {
                    !cfg!(target_os = "windows") || is_windows_spawnable_command(candidate)
                })
                .find(|candidate| command_reports_version(candidate))
                .map(ToString::to_string)
        });

    path_command.or_else(resolve_default_claude_command)
}

fn resolve_default_claude_command() -> Option<String> {
    let home = home_dir()?;
    let app_data = if cfg!(target_os = "windows") {
        env::var_os("APPDATA")
            .map(PathBuf::from)
            .or_else(|| Some(home.join("AppData").join("Roaming")))
    } else {
        None
    };

    resolve_first_runnable_command(default_claude_command_paths(
        &home,
        app_data.as_deref(),
        cfg!(target_os = "windows"),
    ))
}

fn resolve_first_runnable_command(candidates: impl IntoIterator<Item = PathBuf>) -> Option<String> {
    candidates
        .into_iter()
        .filter(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().to_string())
        .find(|candidate| command_reports_version(candidate))
}

fn default_claude_command_paths(
    home: &Path,
    app_data: Option<&Path>,
    windows: bool,
) -> Vec<PathBuf> {
    let mut candidates =
        vec![home
            .join(".local")
            .join("bin")
            .join(if windows { "claude.exe" } else { "claude" })];
    if windows {
        if let Some(app_data) = app_data {
            candidates.push(app_data.join("npm").join("claude.cmd"));
        }
    }
    candidates
}

fn resolve_grok_command() -> Option<String> {
    if let Some(command) = env::var("GROK_CLI_PATH")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .filter(|value| command_reports_version(value))
    {
        return Some(command);
    }

    #[cfg(target_os = "windows")]
    let lookup = {
        let mut command = background_command("powershell.exe");
        command.args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Command grok -CommandType Application,ExternalScript -All -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Source) { $_.Source } elseif ($_.Path) { $_.Path } }",
        ]);
        command_output_with_timeout(&mut command, std::time::Duration::from_secs(3))
    };

    #[cfg(not(target_os = "windows"))]
    let lookup = background_command("which").arg("grok").output().ok();

    let path_command = lookup
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|stdout| {
            select_runnable_command_candidate(
                &stdout,
                cfg!(target_os = "windows"),
                command_reports_version,
            )
        });

    path_command.or_else(resolve_default_grok_command)
}

fn resolve_default_grok_command() -> Option<String> {
    let command = default_grok_command_path(&home_dir()?, cfg!(target_os = "windows"));
    command
        .is_file()
        .then(|| command.to_string_lossy().to_string())
        .filter(|command| command_reports_version(command))
}

fn default_grok_command_path(home: &Path, windows: bool) -> PathBuf {
    let command = if windows { "grok.exe" } else { "grok" };
    home.join(".grok").join("bin").join(command)
}

fn resolve_codex_command() -> Option<String> {
    if let Some(command) = env::var("CODEX_CLI_PATH")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .filter(|value| command_reports_version(value))
    {
        return Some(command);
    }

    #[cfg(target_os = "windows")]
    let lookup = {
        let mut command = background_command("powershell.exe");
        command.args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Command codex -CommandType Application,ExternalScript -All -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Source) { $_.Source } elseif ($_.Path) { $_.Path } }",
        ]);
        command_output_with_timeout(&mut command, std::time::Duration::from_secs(3))
    };

    #[cfg(not(target_os = "windows"))]
    let lookup = background_command("which").arg("codex").output().ok();

    lookup
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|stdout| {
            stdout
                .lines()
                .map(str::trim)
                .filter(|candidate| !candidate.is_empty())
                .filter(|candidate| {
                    !cfg!(target_os = "windows") || is_windows_spawnable_command(candidate)
                })
                .find(|candidate| command_reports_version(candidate))
                .map(ToString::to_string)
        })
}

async fn opencode_acp_probe() -> Json<Value> {
    let Some(command) = resolve_opencode_command() else {
        return Json(json!({
            "installed": false,
            "initialized": false,
            "error": "未找到可由 CodeM 启动的 OpenCode CLI",
        }));
    };
    let version = read_cli_version(&command);
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    match probe_acp_initialize(&command, &["acp"], &cwd, env!("CARGO_PKG_VERSION")).await {
        Ok(initialize) => {
            let model_count = read_opencode_model_ids(&command, &cwd).len();
            Json(json!({
                "installed": true,
                "initialized": true,
                "command": command,
                "version": version,
                "probe": {
                    "configured": model_count > 0,
                    "modelCount": model_count,
                    "initialize": initialize,
                },
            }))
        }
        Err(error) => Json(json!({
            "installed": true,
            "initialized": false,
            "command": command,
            "version": version,
            "error": error.public_message(),
        })),
    }
}

fn resolve_opencode_command() -> Option<String> {
    if let Some(command) = env::var("OPENCODE_CLI_PATH")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .filter(|value| command_reports_version(value))
    {
        return Some(command);
    }

    #[cfg(target_os = "windows")]
    let lookup = {
        let mut command = background_command("powershell.exe");
        command.args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Command opencode -CommandType Application,ExternalScript -All -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Source) { $_.Source } elseif ($_.Path) { $_.Path } }",
        ]);
        command_output_with_timeout(&mut command, std::time::Duration::from_secs(3))
    };

    #[cfg(not(target_os = "windows"))]
    let lookup = background_command("which").arg("opencode").output().ok();

    let path_command = lookup
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|stdout| {
            stdout
                .lines()
                .map(str::trim)
                .filter(|candidate| !candidate.is_empty())
                .filter_map(resolve_opencode_command_candidate)
                .find(|candidate| command_reports_version(candidate))
        });

    path_command.or_else(resolve_default_opencode_command)
}

fn resolve_opencode_command_candidate(candidate: &str) -> Option<String> {
    let path = Path::new(candidate);
    if !cfg!(target_os = "windows")
        || path.extension().is_some_and(|extension| {
            extension
                .to_str()
                .is_some_and(|value| value.eq_ignore_ascii_case("exe"))
        })
    {
        return Some(candidate.to_string());
    }

    let npm_binary = path
        .parent()?
        .join("node_modules")
        .join("opencode-ai")
        .join("bin")
        .join("opencode.exe");
    npm_binary
        .is_file()
        .then(|| npm_binary.to_string_lossy().to_string())
}

fn resolve_default_opencode_command() -> Option<String> {
    let mut candidates = Vec::new();
    if let Ok(app_data) = env::var("APPDATA") {
        candidates.push(
            PathBuf::from(app_data)
                .join("npm")
                .join("node_modules")
                .join("opencode-ai")
                .join("bin")
                .join(if cfg!(target_os = "windows") {
                    "opencode.exe"
                } else {
                    "opencode"
                }),
        );
    }
    if let Some(home) = home_dir() {
        candidates.push(
            home.join(".opencode")
                .join("bin")
                .join(if cfg!(target_os = "windows") {
                    "opencode.exe"
                } else {
                    "opencode"
                }),
        );
        candidates.push(
            home.join(".local")
                .join("bin")
                .join(if cfg!(target_os = "windows") {
                    "opencode.exe"
                } else {
                    "opencode"
                }),
        );
    }
    candidates
        .into_iter()
        .filter(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().to_string())
        .find(|candidate| command_reports_version(candidate))
}

fn command_reports_version(command: &str) -> bool {
    let mut child = match background_command(command)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return false,
    };
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            Ok(None) | Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

fn read_cli_version(command: &str) -> Option<String> {
    let mut process = background_command(command);
    process.arg("--version");
    let output = command_output_with_timeout(&mut process, std::time::Duration::from_secs(3))?;
    if !output.status.success() {
        return None;
    }
    let value = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    value
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToString::to_string)
}

fn read_grok_cli_version(command: &str) -> Option<String> {
    let mut process = background_command(command);
    process.arg("--version");
    let output = command_output_with_timeout(&mut process, std::time::Duration::from_secs(3))?;
    if !output.status.success() {
        return None;
    }
    let output_text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    parse_grok_cli_version(&output_text)
}

fn parse_grok_cli_version(value: &str) -> Option<String> {
    value
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("grok "))
        .and_then(|line| line.split_whitespace().nth(1))
        .map(ToString::to_string)
}

fn select_runnable_command_candidate(
    stdout: &str,
    windows: bool,
    is_runnable: impl Fn(&str) -> bool,
) -> Option<String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|candidate| !windows || is_windows_spawnable_command(candidate))
        .find(|candidate| is_runnable(candidate))
        .map(ToString::to_string)
}

fn is_windows_spawnable_command(candidate: &str) -> bool {
    Path::new(candidate)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "exe" | "cmd" | "bat" | "com"
            )
        })
}

fn open_workspace_database(state: &AppState) -> ApiResult<Connection> {
    Connection::open(state.app_data_dir.join("codem.sqlite"))
        .map_err(|error| ApiError::internal(format!("打开工作区数据库失败: {error}")))
}

fn open_initialized_workspace_database(state: &AppState) -> ApiResult<Connection> {
    let _guard = state
        .workspace_database_init_lock
        .lock()
        .map_err(|error| ApiError::internal(format!("初始化工作区数据库失败: {error}")))?;
    let connection = open_workspace_database(state)?;
    initialize_workspace_database(&connection)?;
    Ok(connection)
}

fn initialize_workspace_database(connection: &Connection) -> ApiResult<()> {
    connection
        .execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS projects (
              id TEXT PRIMARY KEY,
              path TEXT NOT NULL UNIQUE,
              name TEXT NOT NULL,
              custom_name INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              pinned_at TEXT
            );
            CREATE TABLE IF NOT EXISTS threads (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL,
              provider TEXT NOT NULL,
              title TEXT NOT NULL,
              custom_title INTEGER NOT NULL DEFAULT 0,
              session_id TEXT,
              transcript_path TEXT,
              working_directory TEXT NOT NULL,
              model TEXT,
              reasoning_effort TEXT,
              permission_mode TEXT,
              agent_channel_id TEXT,
              agent_channel_fingerprint TEXT,
              imported INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              pinned_at TEXT
            );
            CREATE TABLE IF NOT EXISTS thread_model_preferences (
              thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
              model_id TEXT NOT NULL,
              reasoning_effort TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (thread_id, model_id)
            );
            CREATE TABLE IF NOT EXISTS app_state (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ignored_imported_sessions (
              session_id TEXT PRIMARY KEY,
              transcript_path TEXT,
              deleted_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
              id TEXT PRIMARY KEY,
              thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
              turn_id TEXT NOT NULL,
              turn_sort INTEGER NOT NULL,
              item_sort INTEGER NOT NULL,
              role TEXT NOT NULL,
              item_type TEXT,
              content TEXT NOT NULL,
              status TEXT,
              activity TEXT,
              metrics TEXT,
              session_id TEXT,
              phase TEXT,
              started_at_ms INTEGER,
              duration_ms INTEGER,
              input_tokens INTEGER,
              output_tokens INTEGER,
              cache_creation_input_tokens INTEGER,
              cache_read_input_tokens INTEGER,
              context_usage_json TEXT,
              total_cost_usd REAL,
              pending_approval_requests_json TEXT,
              user_attachments_json TEXT,
              user_content_blocks_json TEXT,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tool_calls (
              id TEXT PRIMARY KEY,
              thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
              turn_id TEXT NOT NULL,
              turn_sort INTEGER NOT NULL,
              item_sort INTEGER NOT NULL,
              tool_sort INTEGER NOT NULL,
              tool_id TEXT NOT NULL,
              name TEXT NOT NULL,
              title TEXT NOT NULL,
              status TEXT NOT NULL,
              tool_use_id TEXT,
              parent_tool_use_id TEXT,
              is_sidechain INTEGER NOT NULL DEFAULT 0,
              input_text TEXT,
              result_text TEXT,
              is_error INTEGER NOT NULL DEFAULT 0,
              subtools_json TEXT,
              sub_messages_json TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_messages_thread_turn
            ON messages (thread_id, turn_sort, item_sort, role);
            CREATE INDEX IF NOT EXISTS idx_tool_calls_thread_turn
            ON tool_calls (thread_id, turn_sort, item_sort, tool_sort);
            "#,
        )
        .map_err(|error| ApiError::internal(format!("初始化工作区数据库失败: {error}")))
        .and_then(|_| {
            ensure_column(
                connection,
                "tool_calls",
                "turn_sort",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            ensure_column(connection, "tool_calls", "parent_tool_use_id", "TEXT")?;
            ensure_column(
                connection,
                "tool_calls",
                "is_sidechain",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            ensure_column(connection, "tool_calls", "subtools_json", "TEXT")?;
            ensure_column(connection, "tool_calls", "sub_messages_json", "TEXT")?;
            ensure_column(connection, "messages", "item_type", "TEXT")?;
            ensure_column(connection, "messages", "phase", "TEXT")?;
            ensure_column(connection, "messages", "started_at_ms", "INTEGER")?;
            ensure_column(connection, "messages", "duration_ms", "INTEGER")?;
            ensure_column(connection, "messages", "input_tokens", "INTEGER")?;
            ensure_column(connection, "messages", "output_tokens", "INTEGER")?;
            ensure_column(
                connection,
                "messages",
                "cache_creation_input_tokens",
                "INTEGER",
            )?;
            ensure_column(connection, "messages", "cache_read_input_tokens", "INTEGER")?;
            ensure_column(connection, "messages", "context_usage_json", "TEXT")?;
            ensure_column(connection, "messages", "total_cost_usd", "REAL")?;
            ensure_column(
                connection,
                "messages",
                "pending_approval_requests_json",
                "TEXT",
            )?;
            ensure_column(connection, "messages", "user_attachments_json", "TEXT")?;
            ensure_column(connection, "messages", "user_content_blocks_json", "TEXT")?;
            ensure_column(connection, "threads", "reasoning_effort", "TEXT")?;
            ensure_column(connection, "threads", "agent_channel_id", "TEXT")?;
            ensure_column(connection, "threads", "agent_channel_fingerprint", "TEXT")?;
            ensure_column(connection, "threads", "pinned_at", "TEXT")?;
            ensure_column(connection, "projects", "pinned_at", "TEXT")?;
            connection
                .execute(
                    r#"
                    INSERT OR IGNORE INTO thread_model_preferences (
                      thread_id, model_id, reasoning_effort, updated_at
                    )
                    SELECT
                      id,
                      COALESCE(NULLIF(TRIM(model), ''), '__default'),
                      TRIM(reasoning_effort),
                      CURRENT_TIMESTAMP
                    FROM threads
                    WHERE reasoning_effort IS NOT NULL
                      AND TRIM(reasoning_effort) <> ''
                    "#,
                    [],
                )
                .map_err(|error| ApiError::internal(format!("迁移线程模型偏好失败: {error}")))?;
            Ok(())
        })
}

fn import_claude_sessions(connection: &Connection) -> ApiResult<()> {
    let Some(home) = home_dir() else {
        return Ok(());
    };
    import_claude_sessions_from_root(connection, &home.join(".claude").join("projects"))
}

fn import_claude_sessions_from_root(connection: &Connection, root: &Path) -> ApiResult<()> {
    let project_directories = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(ApiError::internal(format!(
                "读取 Claude 会话目录失败: {error}"
            )))
        }
    };

    for project_entry in project_directories.filter_map(Result::ok) {
        if !project_entry
            .file_type()
            .ok()
            .is_some_and(|file_type| file_type.is_dir())
        {
            continue;
        }
        let transcript_entries = match fs::read_dir(project_entry.path()) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for transcript_entry in transcript_entries.filter_map(Result::ok) {
            if !transcript_entry
                .file_type()
                .ok()
                .is_some_and(|file_type| file_type.is_file())
            {
                continue;
            }
            let path = transcript_entry.path();
            let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if file_name.starts_with("agent-")
                || !path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("jsonl"))
            {
                continue;
            }

            let Some(mut metadata) = read_claude_session_metadata(&path) else {
                continue;
            };
            if is_ignored_imported_session(connection, &metadata.session_id)? {
                continue;
            }
            let Ok(cwd) = resolve_absolute_path(&metadata.cwd) else {
                continue;
            };
            if !Path::new(&cwd).exists() {
                continue;
            }
            metadata.cwd = cwd;

            let project_id = upsert_imported_project(connection, &metadata)?;
            upsert_imported_thread(connection, &project_id, &metadata)?;
        }
    }

    Ok(())
}

fn read_claude_session_metadata(transcript_path: &Path) -> Option<ClaudeSessionMetadata> {
    let file = fs::File::open(transcript_path).ok()?;
    let mut session_id = String::new();
    let mut cwd = String::new();
    let mut updated_at = String::new();
    let mut session_label = String::new();
    let mut last_prompt = String::new();
    let mut first_user_text = String::new();
    let mut model = String::new();
    let mut permission_mode = String::new();

    for line in StdBufReader::new(file).lines().map_while(Result::ok) {
        let Ok(payload) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if payload
            .get("isSidechain")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || payload
                .get("isMeta")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            || is_claude_task_notification_payload(&payload)
        {
            continue;
        }

        if session_id.is_empty() {
            session_id = first_json_string(&payload, &["sessionId", "session_id"])
                .unwrap_or_default()
                .to_string();
        }
        if cwd.is_empty() {
            cwd = first_json_string(&payload, &["cwd"])
                .unwrap_or_default()
                .to_string();
        }
        if let Some(timestamp) = first_json_string(&payload, &["timestamp"]) {
            if timestamp > updated_at.as_str() {
                updated_at = timestamp.to_string();
            }
        }
        if session_label.is_empty() {
            session_label = first_json_string(&payload, &["sessionName", "displayName", "title"])
                .map(ToString::to_string)
                .or_else(|| {
                    first_json_string(&payload, &["slug"]).map(|value| value.replace('-', " "))
                })
                .unwrap_or_default();
        }
        if last_prompt.is_empty()
            && payload.get("type").and_then(Value::as_str) == Some("last-prompt")
        {
            last_prompt = normalize_imported_title_text(
                first_json_string(&payload, &["lastPrompt"]).unwrap_or_default(),
            );
        }
        if permission_mode.is_empty() {
            permission_mode = first_json_string(&payload, &["permissionMode"])
                .unwrap_or_default()
                .to_string();
        }

        let Some(message) = payload.get("message") else {
            continue;
        };
        if first_user_text.is_empty() && message.get("role").and_then(Value::as_str) == Some("user")
        {
            first_user_text = normalize_imported_title_text(&extract_user_text(
                message.get("content").unwrap_or(&Value::Null),
            ));
        }
        if let Some(message_model) = first_json_string(message, &["model"]) {
            model = message_model.to_string();
        }
    }

    if session_id.is_empty() || cwd.is_empty() {
        return None;
    }

    Some(ClaudeSessionMetadata {
        session_id,
        cwd,
        transcript_path: transcript_path.display().to_string(),
        updated_at: if updated_at.is_empty() {
            current_timestamp()
        } else {
            updated_at
        },
        session_label: normalize_optional_string(Some(session_label)),
        last_prompt: normalize_optional_string(Some(last_prompt)),
        first_user_text: normalize_optional_string(Some(first_user_text)),
        model: normalize_optional_string(Some(model)),
        permission_mode: normalize_optional_string(Some(permission_mode)),
    })
}

fn normalize_imported_title_text(value: &str) -> String {
    value
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !line.starts_with("<local-command-")
                && !line.starts_with("<command-name>")
                && !line.starts_with("<command-message>")
                && !line.starts_with("<command-args>")
                && !line.starts_with("<system-reminder>")
                && !line.starts_with("</system-reminder>")
        })
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn derive_imported_thread_title(metadata: &ClaudeSessionMetadata) -> String {
    let title = metadata
        .session_label
        .as_deref()
        .or(metadata.last_prompt.as_deref())
        .or(metadata.first_user_text.as_deref())
        .unwrap_or(&metadata.session_id)
        .trim();
    let prefix = title.chars().take(28).collect::<String>();
    if title.chars().count() > 28 {
        format!("{prefix}...")
    } else {
        prefix
    }
}

fn is_ignored_imported_session(connection: &Connection, session_id: &str) -> ApiResult<bool> {
    connection
        .query_row(
            "SELECT 1 FROM ignored_imported_sessions WHERE session_id = ?",
            params![session_id],
            |_| Ok(()),
        )
        .optional()
        .map(|value| value.is_some())
        .map_err(|error| ApiError::internal(format!("读取忽略会话失败: {error}")))
}

fn upsert_imported_project(
    connection: &Connection,
    metadata: &ClaudeSessionMetadata,
) -> ApiResult<String> {
    let existing = connection
        .query_row(
            "SELECT id, updated_at FROM projects WHERE path = ?",
            params![metadata.cwd],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| ApiError::internal(format!("读取导入项目失败: {error}")))?;
    if let Some((project_id, updated_at)) = existing {
        if metadata.updated_at > updated_at {
            connection
                .execute(
                    "UPDATE projects SET updated_at = ? WHERE id = ?",
                    params![metadata.updated_at, project_id],
                )
                .map_err(|error| ApiError::internal(format!("更新导入项目失败: {error}")))?;
        }
        return Ok(project_id);
    }

    let project_id = uuid::Uuid::new_v4().to_string();
    let project_name = Path::new(&metadata.cwd)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(&metadata.cwd);
    connection
        .execute(
            r#"
            INSERT INTO projects (id, path, name, custom_name, created_at, updated_at)
            VALUES (?, ?, ?, 0, ?, ?)
            "#,
            params![
                project_id,
                metadata.cwd,
                project_name,
                metadata.updated_at,
                metadata.updated_at
            ],
        )
        .map_err(|error| ApiError::internal(format!("导入 Claude 项目失败: {error}")))?;
    Ok(project_id)
}

fn upsert_imported_thread(
    connection: &Connection,
    project_id: &str,
    metadata: &ClaudeSessionMetadata,
) -> ApiResult<String> {
    let existing_thread_id = connection
        .query_row(
            "SELECT id FROM threads WHERE provider = ? AND session_id = ? ORDER BY imported ASC LIMIT 1",
            params![CLAUDE_CODE_PROVIDER_ID, metadata.session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| ApiError::internal(format!("读取导入会话失败: {error}")))?;
    let title = derive_imported_thread_title(metadata);
    if let Some(thread_id) = existing_thread_id {
        connection
            .execute(
                r#"
                UPDATE threads
                SET transcript_path = ?,
                    working_directory = ?,
                    model = COALESCE(NULLIF(?, ''), NULLIF(model, ''), model),
                    permission_mode = COALESCE(permission_mode, ?),
                    updated_at = ?,
                    title = CASE WHEN custom_title = 0 THEN ? ELSE title END
                WHERE id = ?
                "#,
                params![
                    metadata.transcript_path,
                    metadata.cwd,
                    metadata.model,
                    metadata.permission_mode,
                    metadata.updated_at,
                    title,
                    thread_id
                ],
            )
            .map_err(|error| ApiError::internal(format!("更新导入会话失败: {error}")))?;
        return Ok(thread_id);
    }

    let thread_id = uuid::Uuid::new_v4().to_string();
    connection
        .execute(
            r#"
            INSERT INTO threads (
              id, project_id, provider, title, custom_title, session_id, transcript_path,
              working_directory, model, permission_mode, imported, created_at, updated_at
            )
            VALUES (?, ?, 'claude-code', ?, 0, ?, ?, ?, ?, ?, 1, ?, ?)
            "#,
            params![
                thread_id,
                project_id,
                title,
                metadata.session_id,
                metadata.transcript_path,
                metadata.cwd,
                metadata.model,
                metadata.permission_mode,
                metadata.updated_at,
                metadata.updated_at
            ],
        )
        .map_err(|error| ApiError::internal(format!("导入 Claude 会话失败: {error}")))?;
    Ok(thread_id)
}

fn read_project_rows(connection: &Connection) -> ApiResult<Vec<ProjectRow>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, path, name, created_at, updated_at, pinned_at
            FROM projects
            ORDER BY updated_at DESC, created_at DESC
            "#,
        )
        .map_err(|error| ApiError::internal(format!("读取项目列表失败: {error}")))?;
    let rows = statement
        .query_map([], |row| {
            Ok(ProjectRow {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                pinned_at: row.get(5)?,
            })
        })
        .map_err(|error| ApiError::internal(format!("读取项目列表失败: {error}")))?;

    collect_rows(rows, "读取项目列表失败")
}

fn read_thread_rows(connection: &Connection) -> ApiResult<Vec<ThreadRow>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, project_id, provider, title, session_id, transcript_path, working_directory,
                   model, reasoning_effort, permission_mode, agent_channel_id,
                   agent_channel_fingerprint, imported, updated_at, pinned_at
            FROM threads
            ORDER BY updated_at DESC, created_at DESC
            "#,
        )
        .map_err(|error| ApiError::internal(format!("读取线程列表失败: {error}")))?;
    let rows = statement
        .query_map([], |row| {
            Ok(ThreadRow {
                id: row.get(0)?,
                project_id: row.get(1)?,
                provider: row.get(2)?,
                title: row.get(3)?,
                session_id: row.get(4)?,
                transcript_path: row.get(5)?,
                working_directory: row.get(6)?,
                model: row.get(7)?,
                reasoning_effort: row.get(8)?,
                permission_mode: row.get(9)?,
                agent_channel_id: row.get(10)?,
                agent_channel_fingerprint: row.get(11)?,
                imported: row.get::<_, i64>(12)? != 0,
                updated_at: row.get(13)?,
                pinned_at: row.get(14)?,
            })
        })
        .map_err(|error| ApiError::internal(format!("读取线程列表失败: {error}")))?;

    collect_rows(rows, "读取线程列表失败")
}

fn filter_visible_thread_rows(
    connection: &Connection,
    thread_rows: Vec<ThreadRow>,
) -> ApiResult<Vec<ThreadRow>> {
    let mut visible = Vec::new();
    for row in thread_rows {
        if row.provider != CLAUDE_CODE_PROVIDER_ID {
            visible.push(row);
            continue;
        }
        if row.session_id.is_none() {
            if !row.imported {
                visible.push(row);
            }
            continue;
        }
        if has_usable_transcript(&row) || thread_has_stored_history(connection, &row.id)? {
            visible.push(row);
        }
    }
    Ok(visible)
}

fn has_usable_transcript(row: &ThreadRow) -> bool {
    row.transcript_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some_and(|path| Path::new(path).exists())
}

fn thread_has_stored_history(connection: &Connection, thread_id: &str) -> ApiResult<bool> {
    let message_count = connection
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE thread_id = ?",
            params![thread_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| ApiError::internal(format!("读取聊天历史失败: {error}")))?;
    if message_count > 0 {
        return Ok(true);
    }
    let tool_count = connection
        .query_row(
            "SELECT COUNT(*) FROM tool_calls WHERE thread_id = ?",
            params![thread_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| ApiError::internal(format!("读取工具记录失败: {error}")))?;
    Ok(tool_count > 0)
}

fn collect_rows<T>(
    rows: impl Iterator<Item = rusqlite::Result<T>>,
    message: &str,
) -> ApiResult<Vec<T>> {
    rows.collect::<rusqlite::Result<Vec<T>>>()
        .map_err(|error| ApiError::internal(format!("{message}: {error}")))
}

fn ensure_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
    definition: &str,
) -> ApiResult<()> {
    let table_identifier = quote_sql_identifier(table_name)?;
    let column_identifier = quote_sql_identifier(column_name)?;
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table_identifier})"))
        .map_err(|error| ApiError::internal(format!("读取数据库表结构失败: {error}")))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| ApiError::internal(format!("读取数据库表结构失败: {error}")))?;
    let columns = collect_rows(rows, "读取数据库表结构失败")?;
    if columns.iter().any(|column| column == column_name) {
        return Ok(());
    }

    connection
        .execute_batch(&format!(
            "ALTER TABLE {table_identifier} ADD COLUMN {column_identifier} {definition}"
        ))
        .map_err(|error| ApiError::internal(format!("迁移数据库表结构失败: {error}")))
}

fn quote_sql_identifier(identifier: &str) -> ApiResult<String> {
    if identifier.chars().enumerate().all(|(index, ch)| {
        ch == '_' || ch.is_ascii_alphanumeric() && (index > 0 || !ch.is_ascii_digit())
    }) {
        return Ok(format!("\"{}\"", identifier.replace('"', "\"\"")));
    }

    Err(ApiError::internal(format!(
        "非法数据库标识符: {identifier}"
    )))
}

fn lock_workspace_write(state: &AppState) -> ApiResult<std::sync::MutexGuard<'_, ()>> {
    state
        .workspace_write_lock
        .lock()
        .map_err(|error| ApiError::internal(format!("锁定工作区写入失败: {error}")))
}

fn current_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn normalize_panel_value(value: Option<String>, fallback: Option<&str>) -> String {
    value
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .or(fallback)
        .unwrap_or("project")
        .to_string()
}

fn read_panel_state(connection: &Connection) -> ApiResult<Value> {
    Ok(json!({
        "organizeBy": read_state_value(connection, "panel.organizeBy")?.unwrap_or_else(|| "project".to_string()),
        "sortBy": read_state_value(connection, "panel.sortBy")?.unwrap_or_else(|| "updated".to_string()),
        "visibility": read_state_value(connection, "panel.visibility")?.unwrap_or_else(|| "all".to_string()),
    }))
}

fn resolve_accessible_directory(value: &str) -> ApiResult<String> {
    let absolute_path = PathBuf::from(resolve_absolute_path(value)?);
    let metadata = fs::metadata(&absolute_path).map_err(|_| {
        ApiError::bad_request(format!("目录不存在或不可访问：{}", absolute_path.display()))
    })?;
    if !metadata.is_dir() {
        return Err(ApiError::bad_request(format!(
            "目录不存在或不可访问：{}",
            absolute_path.display()
        )));
    }
    Ok(absolute_path.display().to_string())
}

fn create_project_row(connection: &Connection, project_path: &str) -> ApiResult<String> {
    let now = current_timestamp();
    let existing: Option<String> = connection
        .query_row(
            "SELECT id FROM projects WHERE path = ?",
            params![project_path],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| ApiError::internal(format!("读取项目失败: {error}")))?;
    if let Some(id) = existing {
        connection
            .execute(
                "UPDATE projects SET updated_at = ? WHERE id = ?",
                params![now, id],
            )
            .map_err(|error| ApiError::internal(format!("更新项目失败: {error}")))?;
        write_state_value(connection, "activeProjectId", &id)?;
        return Ok(id);
    }

    let id = uuid::Uuid::new_v4().to_string();
    let name = Path::new(project_path)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(project_path);
    connection
        .execute(
            r#"
            INSERT INTO projects (id, path, name, custom_name, created_at, updated_at)
            VALUES (?, ?, ?, 0, ?, ?)
            "#,
            params![id, project_path, name, now, now],
        )
        .map_err(|error| ApiError::internal(format!("创建项目失败: {error}")))?;
    write_state_value(connection, "activeProjectId", &id)?;
    Ok(id)
}

fn ensure_project_exists(connection: &Connection, project_id: &str) -> ApiResult<()> {
    let exists = connection
        .query_row(
            "SELECT 1 FROM projects WHERE id = ?",
            params![project_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| ApiError::internal(format!("读取项目失败: {error}")))?
        .is_some();
    exists
        .then_some(())
        .ok_or_else(|| ApiError::bad_request("项目不存在"))
}

fn ensure_thread_exists(connection: &Connection, thread_id: &str) -> ApiResult<()> {
    let exists = connection
        .query_row(
            "SELECT 1 FROM threads WHERE id = ?",
            params![thread_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| ApiError::internal(format!("读取聊天失败: {error}")))?
        .is_some();
    exists
        .then_some(())
        .ok_or_else(|| ApiError::not_found("聊天不存在"))
}

fn resolve_requested_thread_provider<F>(
    provider_id: Option<&str>,
    provider_available: F,
) -> ApiResult<&'static str>
where
    F: FnOnce(&str) -> bool,
{
    let provider_id = provider_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(CLAUDE_CODE_PROVIDER_ID);
    match provider_id {
        CLAUDE_CODE_PROVIDER_ID => Ok(CLAUDE_CODE_PROVIDER_ID),
        GROK_BUILD_PROVIDER_ID | OPENAI_CODEX_PROVIDER_ID | OPENCODE_PROVIDER_ID => {
            if provider_available(provider_id) {
                return Ok(match provider_id {
                    GROK_BUILD_PROVIDER_ID => GROK_BUILD_PROVIDER_ID,
                    OPENAI_CODEX_PROVIDER_ID => OPENAI_CODEX_PROVIDER_ID,
                    OPENCODE_PROVIDER_ID => OPENCODE_PROVIDER_ID,
                    _ => unreachable!(),
                });
            }
            Err(ApiError::bad_request(match provider_id {
                GROK_BUILD_PROVIDER_ID => "未找到 grok 命令",
                OPENAI_CODEX_PROVIDER_ID => "未找到可由 CodeM 启动的 Codex CLI",
                OPENCODE_PROVIDER_ID => "未找到可由 CodeM 启动的 OpenCode CLI",
                _ => unreachable!(),
            }))
        }
        _ => Err(ApiError::bad_request("当前 Provider 不可用于新建聊天")),
    }
}

fn resolve_thread_create_permission_mode(
    provider: &str,
    permission_mode: Option<&str>,
) -> ApiResult<Option<String>> {
    if matches!(
        provider,
        GROK_BUILD_PROVIDER_ID | OPENAI_CODEX_PROVIDER_ID | OPENCODE_PROVIDER_ID
    ) {
        return normalize_agent_permission_mode(permission_mode)
            .map(|mode| Some(mode.to_string()))
            .ok_or_else(|| {
                ApiError::bad_request(
                    "Agent permissionMode 仅支持 default、auto 或 bypassPermissions",
                )
            });
    }
    Ok(permission_mode
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string))
}

fn normalize_thread_metadata_value(value: Option<&str>, field: &str) -> ApiResult<Option<String>> {
    let value = value.map(str::trim).filter(|value| !value.is_empty());
    if value.is_some_and(|value| value.len() > 512) {
        return Err(ApiError::bad_request(format!("{field} 过长")));
    }
    Ok(value.map(ToString::to_string))
}

fn read_thread_metadata_payload(value: Option<&Value>, field: &str) -> ApiResult<Option<String>> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => normalize_thread_metadata_value(Some(value), field),
        Some(_) => Err(ApiError::bad_request(format!(
            "{field} 必须是字符串或 null"
        ))),
    }
}

fn provider_supports_reasoning_effort(provider: &str) -> bool {
    matches!(provider, CLAUDE_CODE_PROVIDER_ID | OPENAI_CODEX_PROVIDER_ID)
}

fn thread_model_preference_key(model: Option<&str>) -> String {
    model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("__default")
        .to_string()
}

fn read_thread_model_reasoning_effort(
    connection: &Connection,
    thread_id: &str,
    model: Option<&str>,
) -> ApiResult<Option<String>> {
    let model_id = thread_model_preference_key(model);
    connection
        .query_row(
            "SELECT reasoning_effort FROM thread_model_preferences WHERE thread_id = ? AND model_id = ?",
            params![thread_id, model_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| ApiError::internal(format!("读取线程模型偏好失败: {error}")))
}

fn read_thread_model_preferences_for_thread(
    connection: &Connection,
    thread_id: &str,
) -> ApiResult<Map<String, Value>> {
    let mut statement = connection
        .prepare(
            "SELECT model_id, reasoning_effort FROM thread_model_preferences WHERE thread_id = ? ORDER BY model_id",
        )
        .map_err(|error| ApiError::internal(format!("读取线程模型偏好失败: {error}")))?;
    let rows = statement
        .query_map(params![thread_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| ApiError::internal(format!("读取线程模型偏好失败: {error}")))?;
    let mut preferences = Map::new();
    for row in rows {
        let (model_id, reasoning_effort) =
            row.map_err(|error| ApiError::internal(format!("读取线程模型偏好失败: {error}")))?;
        preferences.insert(model_id, json!(reasoning_effort));
    }
    Ok(preferences)
}

fn read_all_thread_model_preferences(
    connection: &Connection,
) -> ApiResult<std::collections::HashMap<String, Map<String, Value>>> {
    let mut statement = connection
        .prepare(
            "SELECT thread_id, model_id, reasoning_effort FROM thread_model_preferences ORDER BY thread_id, model_id",
        )
        .map_err(|error| ApiError::internal(format!("读取线程模型偏好失败: {error}")))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| ApiError::internal(format!("读取线程模型偏好失败: {error}")))?;
    let mut preferences_by_thread = std::collections::HashMap::new();
    for row in rows {
        let (thread_id, model_id, reasoning_effort) =
            row.map_err(|error| ApiError::internal(format!("读取线程模型偏好失败: {error}")))?;
        preferences_by_thread
            .entry(thread_id)
            .or_insert_with(Map::new)
            .insert(model_id, json!(reasoning_effort));
    }
    Ok(preferences_by_thread)
}

fn sync_thread_model_preference(
    connection: &Connection,
    thread_id: &str,
    model: Option<&str>,
    reasoning_effort: Option<&str>,
    updated_at: &str,
) -> ApiResult<()> {
    let model_id = thread_model_preference_key(model);
    if let Some(reasoning_effort) = reasoning_effort
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        connection
            .execute(
                r#"
                INSERT INTO thread_model_preferences (
                  thread_id, model_id, reasoning_effort, updated_at
                )
                VALUES (?, ?, ?, ?)
                ON CONFLICT(thread_id, model_id) DO UPDATE SET
                  reasoning_effort = excluded.reasoning_effort,
                  updated_at = excluded.updated_at
                "#,
                params![thread_id, model_id, reasoning_effort, updated_at],
            )
            .map_err(|error| ApiError::internal(format!("保存线程模型偏好失败: {error}")))?;
    } else {
        connection
            .execute(
                "DELETE FROM thread_model_preferences WHERE thread_id = ? AND model_id = ?",
                params![thread_id, model_id],
            )
            .map_err(|error| ApiError::internal(format!("清理线程模型偏好失败: {error}")))?;
    }
    Ok(())
}

fn create_thread_row(
    connection: &mut Connection,
    project_id: &str,
    title: Option<&str>,
    provider: &str,
    permission_mode: Option<&str>,
    model: Option<&str>,
    reasoning_effort: Option<&str>,
    agent_channel_id: Option<&str>,
) -> ApiResult<String> {
    let project_path: String = connection
        .query_row(
            "SELECT path FROM projects WHERE id = ?",
            params![project_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| ApiError::internal(format!("读取项目失败: {error}")))?
        .ok_or_else(|| ApiError::bad_request("项目不存在"))?;
    let now = current_timestamp();
    let id = uuid::Uuid::new_v4().to_string();
    let thread_title = title
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("新建聊天");
    let transaction = connection
        .transaction()
        .map_err(|error| ApiError::internal(format!("创建聊天事务失败: {error}")))?;
    transaction
        .execute(
            r#"
            INSERT INTO threads (
              id, project_id, provider, title, custom_title, session_id, transcript_path,
              working_directory, model, reasoning_effort, permission_mode, agent_channel_id,
              agent_channel_fingerprint, imported, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
            "#,
            params![
                id,
                project_id,
                provider,
                thread_title,
                project_path,
                model,
                reasoning_effort,
                permission_mode,
                agent_channel_id,
                now,
                now
            ],
        )
        .map_err(|error| ApiError::internal(format!("创建聊天失败: {error}")))?;
    sync_thread_model_preference(&transaction, &id, model, reasoning_effort, &now)?;
    transaction
        .execute(
            "UPDATE projects SET updated_at = ? WHERE id = ?",
            params![now, project_id],
        )
        .map_err(|error| ApiError::internal(format!("更新项目失败: {error}")))?;
    write_state_value(&transaction, "activeProjectId", project_id)?;
    write_state_value(&transaction, "activeThreadId", &id)?;
    transaction
        .commit()
        .map_err(|error| ApiError::internal(format!("提交聊天创建失败: {error}")))?;
    Ok(id)
}

fn read_thread_summary(connection: &Connection, thread_id: &str) -> ApiResult<Value> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, project_id, provider, title, session_id, transcript_path, working_directory,
                   model, reasoning_effort, permission_mode, agent_channel_id,
                   agent_channel_fingerprint, imported, updated_at, pinned_at
            FROM threads
            WHERE id = ?
            "#,
        )
        .map_err(|error| ApiError::internal(format!("读取聊天失败: {error}")))?;
    let thread = statement
        .query_row(params![thread_id], |row| {
            Ok(ThreadRow {
                id: row.get(0)?,
                project_id: row.get(1)?,
                provider: row.get(2)?,
                title: row.get(3)?,
                session_id: row.get(4)?,
                transcript_path: row.get(5)?,
                working_directory: row.get(6)?,
                model: row.get(7)?,
                reasoning_effort: row.get(8)?,
                permission_mode: row.get(9)?,
                agent_channel_id: row.get(10)?,
                agent_channel_fingerprint: row.get(11)?,
                imported: row.get::<_, i64>(12)? != 0,
                updated_at: row.get(13)?,
                pinned_at: row.get(14)?,
            })
        })
        .optional()
        .map_err(|error| ApiError::internal(format!("读取聊天失败: {error}")))?
        .ok_or_else(|| ApiError::not_found("聊天不存在"))?;
    let preferences = read_thread_model_preferences_for_thread(connection, thread_id)?;
    Ok(thread_summary_json(&thread, Some(&preferences)))
}

fn remove_project_row(connection: &mut Connection, project_id: &str) -> ApiResult<()> {
    ensure_project_exists(connection, project_id)?;
    let imported_sessions = {
        let mut statement = connection
            .prepare(
                "SELECT session_id, transcript_path FROM threads WHERE project_id = ? AND provider = ? AND session_id IS NOT NULL",
            )
            .map_err(|error| ApiError::internal(format!("读取项目会话失败: {error}")))?;
        let rows = statement
            .query_map(params![project_id, CLAUDE_CODE_PROVIDER_ID], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(|error| ApiError::internal(format!("读取项目会话失败: {error}")))?;
        collect_rows(rows, "读取项目会话失败")?
    };
    let now = current_timestamp();
    let transaction = connection
        .transaction()
        .map_err(|error| ApiError::internal(format!("删除项目失败: {error}")))?;
    for (session_id, transcript_path) in imported_sessions {
        ignore_imported_session(&transaction, &session_id, transcript_path.as_deref(), &now)?;
    }
    transaction
        .execute(
            "DELETE FROM tool_calls WHERE thread_id IN (SELECT id FROM threads WHERE project_id = ?)",
            params![project_id],
        )
        .map_err(|error| ApiError::internal(format!("删除项目工具记录失败: {error}")))?;
    transaction
        .execute(
            "DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE project_id = ?)",
            params![project_id],
        )
        .map_err(|error| ApiError::internal(format!("删除项目历史失败: {error}")))?;
    transaction
        .execute(
            "DELETE FROM threads WHERE project_id = ?",
            params![project_id],
        )
        .map_err(|error| ApiError::internal(format!("删除项目聊天失败: {error}")))?;
    transaction
        .execute("DELETE FROM projects WHERE id = ?", params![project_id])
        .map_err(|error| ApiError::internal(format!("删除项目失败: {error}")))?;
    transaction
        .execute(
            "DELETE FROM app_state WHERE key = 'activeProjectId' AND value = ?",
            params![project_id],
        )
        .map_err(|error| ApiError::internal(format!("清理项目选择失败: {error}")))?;
    transaction
        .commit()
        .map_err(|error| ApiError::internal(format!("提交项目删除失败: {error}")))
}

fn read_project_thread_ids(connection: &Connection, project_id: &str) -> ApiResult<Vec<String>> {
    ensure_project_exists(connection, project_id)?;
    let mut statement = connection
        .prepare("SELECT id FROM threads WHERE project_id = ?")
        .map_err(|error| ApiError::internal(format!("读取项目聊天失败: {error}")))?;
    let rows = statement
        .query_map(params![project_id], |row| row.get::<_, String>(0))
        .map_err(|error| ApiError::internal(format!("读取项目聊天失败: {error}")))?;
    collect_rows(rows, "读取项目聊天失败")
}

fn remove_thread_row(connection: &mut Connection, thread_id: &str) -> ApiResult<()> {
    let (project_id, provider, session_id, transcript_path) = connection
        .query_row(
            "SELECT project_id, provider, session_id, transcript_path FROM threads WHERE id = ?",
            params![thread_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| ApiError::internal(format!("读取聊天失败: {error}")))?
        .ok_or_else(|| ApiError::bad_request("聊天不存在"))?;
    let now = current_timestamp();
    let transaction = connection
        .transaction()
        .map_err(|error| ApiError::internal(format!("删除聊天失败: {error}")))?;
    if provider == CLAUDE_CODE_PROVIDER_ID {
        if let Some(session_id) = session_id.as_deref() {
            ignore_imported_session(&transaction, session_id, transcript_path.as_deref(), &now)?;
        }
    }
    transaction
        .execute(
            "DELETE FROM tool_calls WHERE thread_id = ?",
            params![thread_id],
        )
        .map_err(|error| ApiError::internal(format!("删除工具记录失败: {error}")))?;
    transaction
        .execute(
            "DELETE FROM messages WHERE thread_id = ?",
            params![thread_id],
        )
        .map_err(|error| ApiError::internal(format!("删除聊天历史失败: {error}")))?;
    transaction
        .execute("DELETE FROM threads WHERE id = ?", params![thread_id])
        .map_err(|error| ApiError::internal(format!("删除聊天失败: {error}")))?;
    transaction
        .execute(
            "UPDATE projects SET updated_at = ? WHERE id = ?",
            params![now, project_id],
        )
        .map_err(|error| ApiError::internal(format!("更新项目失败: {error}")))?;
    transaction
        .execute(
            "DELETE FROM app_state WHERE key = 'activeThreadId' AND value = ?",
            params![thread_id],
        )
        .map_err(|error| ApiError::internal(format!("清理聊天选择失败: {error}")))?;
    transaction
        .commit()
        .map_err(|error| ApiError::internal(format!("提交聊天删除失败: {error}")))
}

fn read_thread_detail(connection: &Connection, thread_id: &str) -> ApiResult<ThreadDetailRow> {
    connection
        .query_row(
            r#"
            SELECT project_id, provider, session_id, transcript_path, working_directory, model,
                   reasoning_effort, permission_mode, agent_channel_id, agent_channel_fingerprint
            FROM threads
            WHERE id = ?
            "#,
            params![thread_id],
            |row| {
                Ok(ThreadDetailRow {
                    project_id: row.get(0)?,
                    provider: row.get(1)?,
                    session_id: row.get(2)?,
                    transcript_path: row.get(3)?,
                    working_directory: row.get(4)?,
                    model: row.get(5)?,
                    reasoning_effort: row.get(6)?,
                    permission_mode: row.get(7)?,
                    agent_channel_id: row.get(8)?,
                    agent_channel_fingerprint: row.get(9)?,
                })
            },
        )
        .optional()
        .map_err(|error| ApiError::internal(format!("读取聊天失败: {error}")))?
        .ok_or_else(|| ApiError::not_found("聊天不存在"))
}

fn update_thread_metadata_from_payload(
    connection: &mut Connection,
    thread_id: &str,
    payload: &Value,
    agent_channels: &crate::agent_channels::AgentChannelService,
) -> ApiResult<()> {
    let thread = read_thread_detail(connection, thread_id)?;
    let previous_session_id = thread.session_id.clone();
    let previous_transcript_path = thread.transcript_path.clone();
    let has_session_id = payload.get("sessionId").is_some();
    let has_model = payload.get("model").is_some();
    let has_reasoning_effort = payload.get("reasoningEffort").is_some();
    let has_working_directory = payload.get("workingDirectory").is_some();
    let has_permission_mode = payload.get("permissionMode").is_some();
    let has_channel_id = payload.get("channelId").is_some();
    if !(has_session_id
        || has_model
        || has_reasoning_effort
        || has_working_directory
        || has_permission_mode
        || has_channel_id)
    {
        return Ok(());
    }

    let session_id = if has_session_id {
        payload
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    } else {
        thread.session_id.clone()
    };
    let working_directory = if has_working_directory {
        payload
            .get("workingDirectory")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .unwrap_or(thread.working_directory)
    } else {
        thread.working_directory
    };
    let transcript_path = if thread.provider != CLAUDE_CODE_PROVIDER_ID {
        None
    } else if let Some(session_id) = session_id.as_deref() {
        Some(resolve_claude_transcript_path(
            &working_directory,
            session_id,
        ))
    } else if has_session_id {
        None
    } else {
        thread.transcript_path.clone()
    };
    let model = if has_model {
        read_thread_metadata_payload(payload.get("model"), "model")?
    } else {
        thread.model.clone()
    };
    let reasoning_effort = if has_reasoning_effort {
        read_thread_metadata_payload(payload.get("reasoningEffort"), "reasoningEffort")?
    } else if has_model {
        read_thread_model_reasoning_effort(connection, thread_id, model.as_deref())?
    } else {
        thread.reasoning_effort.clone()
    };
    if !provider_supports_reasoning_effort(&thread.provider) && reasoning_effort.is_some() {
        return Err(ApiError::bad_request(
            "reasoningEffort 目前仅支持 Claude Code 或 OpenAI Codex 聊天",
        ));
    }
    let permission_mode = if has_permission_mode {
        let requested_permission_mode = payload
            .get("permissionMode")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        if matches!(
            thread.provider.as_str(),
            GROK_BUILD_PROVIDER_ID | OPENAI_CODEX_PROVIDER_ID | OPENCODE_PROVIDER_ID
        ) {
            Some(
                normalize_agent_permission_mode(requested_permission_mode.as_deref())
                    .ok_or_else(|| {
                        ApiError::bad_request(
                            "Agent permissionMode 仅支持 default、auto 或 bypassPermissions",
                        )
                    })?
                    .to_string(),
            )
        } else {
            requested_permission_mode.or(thread.permission_mode.clone())
        }
    } else {
        thread.permission_mode.clone()
    };
    let agent_channel_id = if has_channel_id {
        let requested = match payload.get("channelId") {
            Some(Value::Null) => None,
            Some(Value::String(value)) => Some(value.as_str()),
            _ => return Err(ApiError::bad_request("channelId 必须是字符串或 null")),
        };
        agent_channels
            .validate_selection(&thread.provider, requested)
            .map_err(ApiError::bad_request)?
    } else {
        thread.agent_channel_id.clone()
    };
    let agent_channel_fingerprint = if has_channel_id && agent_channel_id != thread.agent_channel_id
    {
        None
    } else {
        thread.agent_channel_fingerprint.clone()
    };
    let now = current_timestamp();
    let transaction = connection
        .transaction()
        .map_err(|error| ApiError::internal(format!("更新聊天元数据失败: {error}")))?;
    if has_channel_id && agent_channel_id != thread.agent_channel_id {
        transaction
            .execute(
                "DELETE FROM thread_model_preferences WHERE thread_id = ?",
                params![thread_id],
            )
            .map_err(|error| ApiError::internal(format!("清理旧渠道模型偏好失败: {error}")))?;
    }
    if thread.provider == CLAUDE_CODE_PROVIDER_ID
        && previous_session_id.is_some()
        && previous_session_id != session_id
    {
        let previous_session_id = previous_session_id.as_deref().unwrap_or_default();
        ignore_imported_session(
            &transaction,
            previous_session_id,
            previous_transcript_path.as_deref(),
            &now,
        )?;
        if session_id.is_some() {
            delete_duplicate_threads_by_session_id(&transaction, previous_session_id, thread_id)?;
        }
    }
    transaction
        .execute(
            r#"
            UPDATE threads
            SET session_id = ?,
                transcript_path = ?,
                working_directory = ?,
                model = ?,
                reasoning_effort = ?,
                permission_mode = ?,
                agent_channel_id = ?,
                agent_channel_fingerprint = ?,
                updated_at = ?
            WHERE id = ?
            "#,
            params![
                session_id,
                transcript_path,
                working_directory,
                model,
                reasoning_effort,
                permission_mode,
                agent_channel_id,
                agent_channel_fingerprint,
                now,
                thread_id
            ],
        )
        .map_err(|error| ApiError::internal(format!("更新聊天元数据失败: {error}")))?;
    if has_model || has_reasoning_effort {
        sync_thread_model_preference(
            &transaction,
            thread_id,
            model.as_deref(),
            reasoning_effort.as_deref(),
            &now,
        )?;
    }
    transaction
        .execute(
            "UPDATE projects SET updated_at = ? WHERE id = ?",
            params![now, thread.project_id],
        )
        .map_err(|error| ApiError::internal(format!("更新项目失败: {error}")))?;
    transaction
        .commit()
        .map_err(|error| ApiError::internal(format!("提交聊天元数据失败: {error}")))
}

fn ignore_imported_session(
    transaction: &rusqlite::Transaction<'_>,
    session_id: &str,
    transcript_path: Option<&str>,
    deleted_at: &str,
) -> ApiResult<()> {
    transaction
        .execute(
            r#"
            INSERT INTO ignored_imported_sessions (session_id, transcript_path, deleted_at)
            VALUES (?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              transcript_path = excluded.transcript_path,
              deleted_at = excluded.deleted_at
            "#,
            params![session_id, transcript_path, deleted_at],
        )
        .map(|_| ())
        .map_err(|error| ApiError::internal(format!("记录忽略会话失败: {error}")))
}

fn delete_duplicate_threads_by_session_id(
    transaction: &rusqlite::Transaction<'_>,
    session_id: &str,
    exclude_thread_id: &str,
) -> ApiResult<()> {
    let duplicate_ids = {
        let mut statement = transaction
            .prepare("SELECT id FROM threads WHERE provider = ? AND session_id = ? AND id <> ?")
            .map_err(|error| ApiError::internal(format!("读取重复会话失败: {error}")))?;
        let rows = statement
            .query_map(
                params![CLAUDE_CODE_PROVIDER_ID, session_id, exclude_thread_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|error| ApiError::internal(format!("读取重复会话失败: {error}")))?;
        collect_rows(rows, "读取重复会话失败")?
    };
    for duplicate_id in duplicate_ids {
        transaction
            .execute(
                "DELETE FROM tool_calls WHERE thread_id = ?",
                params![duplicate_id],
            )
            .map_err(|error| ApiError::internal(format!("删除重复工具记录失败: {error}")))?;
        transaction
            .execute(
                "DELETE FROM messages WHERE thread_id = ?",
                params![duplicate_id],
            )
            .map_err(|error| ApiError::internal(format!("删除重复历史失败: {error}")))?;
        transaction
            .execute("DELETE FROM threads WHERE id = ?", params![duplicate_id])
            .map_err(|error| ApiError::internal(format!("删除重复会话失败: {error}")))?;
    }
    Ok(())
}

fn resolve_claude_transcript_path(working_directory: &str, session_id: &str) -> String {
    let root = home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude")
        .join("projects")
        .join(sanitize_project_path(working_directory));
    root.join(format!("{session_id}.jsonl"))
        .display()
        .to_string()
}

fn sanitize_project_path(project_path: &str) -> String {
    let absolute_path = if Path::new(project_path).is_absolute() {
        PathBuf::from(project_path)
    } else {
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(project_path)
    };
    absolute_path
        .display()
        .to_string()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect()
}

fn read_thread_history_payload(connection: &mut Connection, thread_id: &str) -> ApiResult<Value> {
    let thread = read_thread_detail(connection, thread_id)?;
    let stored_turns = read_stored_thread_history(connection, thread_id)?;
    let claude_context = (thread.provider == CLAUDE_CODE_PROVIDER_ID)
        .then(|| {
            thread
                .transcript_path
                .as_deref()
                .and_then(read_latest_claude_context_snapshot)
        })
        .flatten();
    let mut turns = stored_turns.clone();
    if let Some(transcript_path) = (thread.provider == CLAUDE_CODE_PROVIDER_ID)
        .then_some(thread.transcript_path.as_deref())
        .flatten()
        .filter(|path| Path::new(path).exists())
    {
        let should_parse = if turns.is_empty() {
            true
        } else {
            should_refresh_stored_history(connection, thread_id, transcript_path, &turns)?
        };
        if should_parse {
            let reparsed_turns =
                parse_claude_transcript(transcript_path, thread.session_id.as_deref());
            if !reparsed_turns.is_empty() {
                turns = if stored_turns.is_empty() {
                    reparsed_turns
                } else {
                    merge_stored_turn_metrics(&stored_turns, reparsed_turns)
                };
                write_thread_history(connection, thread_id, &turns)?;
            }
        }
    }
    let visible_turns = if thread.provider == CLAUDE_CODE_PROVIDER_ID {
        remove_claude_local_command_pollution(turns)
    } else {
        turns
    };
    let mut payload = json!({
        "threadId": thread_id,
        "turns": visible_turns,
    });
    if let Some(context) = claude_context {
        if let Some(object) = payload.as_object_mut() {
            object.insert("claudeContext".to_string(), context);
        }
    }
    Ok(payload)
}

fn should_refresh_stored_history(
    connection: &Connection,
    thread_id: &str,
    transcript_path: &str,
    turns: &[Value],
) -> ApiResult<bool> {
    if turns.iter().any(has_pending_human_request) || turns.iter().any(has_local_user_input_summary)
    {
        return Ok(false);
    }
    if should_reparse_stored_history(turns) {
        return Ok(true);
    }
    is_stored_history_outdated(connection, thread_id, transcript_path)
}

fn is_stored_history_outdated(
    connection: &Connection,
    thread_id: &str,
    transcript_path: &str,
) -> ApiResult<bool> {
    let latest_created_at: Option<String> = connection
        .query_row(
            "SELECT MAX(created_at) FROM messages WHERE thread_id = ?",
            params![thread_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| ApiError::internal(format!("读取聊天更新时间失败: {error}")))?
        .flatten();
    let Some(latest_created_at) = latest_created_at else {
        return Ok(true);
    };
    let transcript_updated_at = fs::metadata(transcript_path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(chrono::DateTime::<chrono::Utc>::from)
        .map(|timestamp| timestamp.to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
    Ok(transcript_updated_at.is_some_and(|value| value > latest_created_at))
}

fn should_reparse_stored_history(turns: &[Value]) -> bool {
    turns.iter().any(|turn| {
        has_claude_local_command_text(turn.get("userText").and_then(Value::as_str))
            || has_claude_local_command_text(turn.get("assistantText").and_then(Value::as_str))
            || turn
                .get("tools")
                .and_then(Value::as_array)
                .is_some_and(|tools| {
                    tools
                        .iter()
                        .any(|tool| tool.get("name").and_then(Value::as_str) == Some("tool_result"))
                })
    })
}

fn has_pending_human_request(turn: &Value) -> bool {
    json_array_has_items(turn.get("pendingUserInputRequests"))
        || json_array_has_items(turn.get("pendingApprovalRequests"))
}

fn has_local_user_input_summary(turn: &Value) -> bool {
    json_array_has_items(turn.get("userAttachments"))
        || turn
            .get("userContentBlocks")
            .and_then(Value::as_array)
            .is_some_and(|blocks| {
                blocks
                    .iter()
                    .any(|block| block.get("type").and_then(Value::as_str) != Some("text"))
            })
}

fn json_array_has_items(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_array)
        .is_some_and(|items| !items.is_empty())
}

fn merge_stored_turn_metrics(stored_turns: &[Value], reparsed_turns: Vec<Value>) -> Vec<Value> {
    let mut stored_by_key = std::collections::HashMap::new();
    for (index, turn) in stored_turns.iter().enumerate() {
        stored_by_key.insert(turn_merge_key(turn, index), turn);
    }
    reparsed_turns
        .into_iter()
        .enumerate()
        .map(|(index, mut turn)| {
            if let Some(stored) = stored_by_key.get(&turn_merge_key(&turn, index)) {
                for key in [
                    "inputTokens",
                    "outputTokens",
                    "cacheCreationInputTokens",
                    "cacheReadInputTokens",
                    "contextUsage",
                    "totalCostUsd",
                    "durationMs",
                ] {
                    if turn.get(key).is_none_or(Value::is_null) {
                        if let Some(value) = stored.get(key).filter(|value| !value.is_null()) {
                            if let Some(object) = turn.as_object_mut() {
                                object.insert(key.to_string(), value.clone());
                            }
                        }
                    }
                }
            }
            turn
        })
        .collect()
}

fn turn_merge_key(turn: &Value, index: usize) -> String {
    let user_text = turn
        .get("userText")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if user_text.is_empty() {
        format!("index:{index}")
    } else {
        format!("user:{user_text}")
    }
}

fn read_stored_thread_history(connection: &Connection, thread_id: &str) -> ApiResult<Vec<Value>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT turn_id, turn_sort, item_sort, role, content, status, activity, metrics, session_id,
                   phase, started_at_ms, duration_ms, input_tokens, output_tokens,
                   cache_creation_input_tokens, cache_read_input_tokens, context_usage_json,
                   total_cost_usd, pending_approval_requests_json, user_attachments_json,
                   user_content_blocks_json, item_type
            FROM messages
            WHERE thread_id = ?
            ORDER BY turn_sort ASC, item_sort ASC, CASE role WHEN 'user' THEN 0 ELSE 1 END ASC
            "#,
        )
        .map_err(|error| ApiError::internal(format!("读取聊天历史失败: {error}")))?;
    let message_rows = collect_rows(
        statement
            .query_map(params![thread_id], |row| {
                Ok(MessageRow {
                    turn_id: row.get(0)?,
                    turn_sort: row.get(1)?,
                    item_sort: row.get(2)?,
                    role: row.get(3)?,
                    item_type: row.get(21)?,
                    content: row.get(4)?,
                    status: row.get(5)?,
                    activity: row.get(6)?,
                    metrics: row.get(7)?,
                    session_id: row.get(8)?,
                    phase: row.get(9)?,
                    started_at_ms: row.get(10)?,
                    duration_ms: row.get(11)?,
                    input_tokens: row.get(12)?,
                    output_tokens: row.get(13)?,
                    cache_creation_input_tokens: row.get(14)?,
                    cache_read_input_tokens: row.get(15)?,
                    context_usage_json: row.get(16)?,
                    total_cost_usd: row.get(17)?,
                    pending_approval_requests_json: row.get(18)?,
                    user_attachments_json: row.get(19)?,
                    user_content_blocks_json: row.get(20)?,
                })
            })
            .map_err(|error| ApiError::internal(format!("读取聊天历史失败: {error}")))?,
        "读取聊天历史失败",
    )?;

    let mut statement = connection
        .prepare(
            r#"
            SELECT turn_id, turn_sort, item_sort, tool_id, name, title, status, tool_use_id,
                   parent_tool_use_id, is_sidechain, input_text, result_text, is_error,
                   subtools_json, sub_messages_json
            FROM tool_calls
            WHERE thread_id = ?
            ORDER BY turn_sort ASC, item_sort ASC, tool_sort ASC
            "#,
        )
        .map_err(|error| ApiError::internal(format!("读取工具调用失败: {error}")))?;
    let tool_rows = collect_rows(
        statement
            .query_map(params![thread_id], |row| {
                Ok(ToolCallRow {
                    turn_id: row.get(0)?,
                    turn_sort: row.get(1)?,
                    item_sort: row.get(2)?,
                    tool_id: row.get(3)?,
                    name: row.get(4)?,
                    title: row.get(5)?,
                    status: row.get(6)?,
                    tool_use_id: row.get(7)?,
                    parent_tool_use_id: row.get(8)?,
                    is_sidechain: row.get::<_, i64>(9)? != 0,
                    input_text: row.get(10)?,
                    result_text: row.get(11)?,
                    is_error: row.get::<_, i64>(12)? != 0,
                    subtools_json: row.get(13)?,
                    sub_messages_json: row.get(14)?,
                })
            })
            .map_err(|error| ApiError::internal(format!("读取工具调用失败: {error}")))?,
        "读取工具调用失败",
    )?;

    use std::collections::BTreeMap;
    let mut turns: BTreeMap<String, Value> = BTreeMap::new();
    let mut sort_keys: BTreeMap<String, i64> = BTreeMap::new();
    let mut item_buckets: BTreeMap<String, Vec<(i64, Value)>> = BTreeMap::new();

    for row in message_rows {
        let turn = turns
            .entry(row.turn_id.clone())
            .or_insert_with(|| default_turn_json(&row.turn_id));
        sort_keys
            .entry(row.turn_id.clone())
            .and_modify(|value| *value = (*value).min(row.turn_sort))
            .or_insert(row.turn_sort);
        apply_message_row_to_turn(turn, &row);
        if row.role == "system-command" {
            if let Some(item) = parse_json_value(row.content.as_str()) {
                item_buckets
                    .entry(row.turn_id)
                    .or_default()
                    .push((row.item_sort, item));
            }
        } else if row.role == "assistant" && !row.content.trim().is_empty() {
            let item_type = match row.item_type.as_deref() {
                Some("thinking") => "thinking",
                _ => "text",
            };
            item_buckets.entry(row.turn_id).or_default().push((
                row.item_sort,
                json!({
                    "id": uuid::Uuid::new_v4().to_string(),
                    "type": item_type,
                    "text": row.content,
                }),
            ));
        }
    }

    for row in tool_rows {
        let turn = turns
            .entry(row.turn_id.clone())
            .or_insert_with(|| default_turn_json(&row.turn_id));
        sort_keys
            .entry(row.turn_id.clone())
            .and_modify(|value| *value = (*value).min(row.turn_sort))
            .or_insert(row.turn_sort);
        let tool = tool_row_json(&row);
        if let Some(tools) = turn.get_mut("tools").and_then(Value::as_array_mut) {
            tools.push(tool.clone());
        }
        item_buckets.entry(row.turn_id).or_default().push((
            row.item_sort,
            json!({
                "id": row.tool_id,
                "type": "tool",
                "tool": tool,
            }),
        ));
    }

    let mut ordered: Vec<(i64, Value)> = turns
        .into_iter()
        .map(|(turn_id, mut turn)| {
            let mut items = item_buckets.remove(&turn_id).unwrap_or_default();
            items.sort_by_key(|(sort, _)| *sort);
            turn["items"] = Value::Array(items.into_iter().map(|(_, item)| item).collect());
            (*sort_keys.get(&turn_id).unwrap_or(&0), turn)
        })
        .collect();
    ordered.sort_by_key(|(sort, _)| *sort);
    Ok(ordered.into_iter().map(|(_, turn)| turn).collect())
}

fn default_turn_json(turn_id: &str) -> Value {
    json!({
        "id": turn_id,
        "userText": "",
        "assistantText": "",
        "status": "done",
        "items": [],
        "tools": [],
    })
}

fn apply_message_row_to_turn(turn: &mut Value, row: &MessageRow) {
    set_json_string(turn, "status", normalize_status(row.status.as_deref()));
    set_json_optional_string(turn, "activity", row.activity.as_deref());
    set_json_optional_string(turn, "metrics", row.metrics.as_deref());
    set_json_optional_string(turn, "sessionId", row.session_id.as_deref());
    set_json_optional_string(turn, "phase", row.phase.as_deref());
    set_json_optional_number(turn, "startedAtMs", row.started_at_ms);
    set_json_optional_number(turn, "durationMs", row.duration_ms);
    set_json_optional_number(turn, "inputTokens", row.input_tokens);
    set_json_optional_number(turn, "outputTokens", row.output_tokens);
    set_json_optional_number(
        turn,
        "cacheCreationInputTokens",
        row.cache_creation_input_tokens,
    );
    set_json_optional_number(turn, "cacheReadInputTokens", row.cache_read_input_tokens);
    set_json_optional_float(turn, "totalCostUsd", row.total_cost_usd);
    set_json_optional_value(turn, "contextUsage", row.context_usage_json.as_deref());
    set_json_optional_value(
        turn,
        "pendingApprovalRequests",
        row.pending_approval_requests_json.as_deref(),
    );
    if row.role == "user" {
        turn["userText"] = Value::String(row.content.clone());
        set_json_optional_value(
            turn,
            "userAttachments",
            row.user_attachments_json.as_deref(),
        );
        set_json_optional_value(
            turn,
            "userContentBlocks",
            row.user_content_blocks_json.as_deref(),
        );
    } else if row.role == "assistant" && row.item_type.as_deref() != Some("thinking") {
        let assistant_text = turn
            .get("assistantText")
            .and_then(Value::as_str)
            .unwrap_or_default();
        turn["assistantText"] = Value::String(format!("{assistant_text}{}", row.content));
    }
}

fn write_thread_history(
    connection: &mut Connection,
    thread_id: &str,
    turns: &[Value],
) -> ApiResult<()> {
    let thread = read_thread_detail(connection, thread_id)?;
    let now = current_timestamp();
    let transaction = connection
        .transaction()
        .map_err(|error| ApiError::internal(format!("保存聊天历史失败: {error}")))?;
    transaction
        .execute(
            "DELETE FROM tool_calls WHERE thread_id = ?",
            params![thread_id],
        )
        .map_err(|error| ApiError::internal(format!("清理工具记录失败: {error}")))?;
    transaction
        .execute(
            "DELETE FROM messages WHERE thread_id = ?",
            params![thread_id],
        )
        .map_err(|error| ApiError::internal(format!("清理聊天历史失败: {error}")))?;

    for (turn_index, turn) in turns.iter().enumerate() {
        let turn_id = turn
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let created_at = turn
            .get("startedAtMs")
            .and_then(Value::as_i64)
            .and_then(timestamp_ms_to_iso)
            .unwrap_or_else(current_timestamp);
        insert_message_row(
            &transaction,
            thread_id,
            &turn_id,
            turn_index as i64,
            0,
            "user",
            Some("user"),
            turn.get("userText")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            turn,
            &created_at,
            true,
        )?;

        let mut next_tool_sort = 0_i64;
        let items = turn.get("items").and_then(Value::as_array).cloned();
        let assistant_text = turn
            .get("assistantText")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let fallback_items = if items.as_ref().is_some_and(|items| !items.is_empty()) {
            Vec::new()
        } else if assistant_text.trim().is_empty() {
            Vec::new()
        } else {
            vec![json!({
                "id": uuid::Uuid::new_v4().to_string(),
                "type": "text",
                "text": assistant_text,
            })]
        };
        for (item_index, item) in items.unwrap_or(fallback_items).iter().enumerate() {
            match item.get("type").and_then(Value::as_str) {
                Some(item_type @ ("text" | "thinking")) => {
                    insert_message_row(
                        &transaction,
                        thread_id,
                        &turn_id,
                        turn_index as i64,
                        item_index as i64,
                        "assistant",
                        Some(item_type),
                        item.get("text").and_then(Value::as_str).unwrap_or_default(),
                        turn,
                        &created_at,
                        false,
                    )?;
                }
                Some("system-command") => {
                    insert_message_row(
                        &transaction,
                        thread_id,
                        &turn_id,
                        turn_index as i64,
                        item_index as i64,
                        "system-command",
                        Some("system-command"),
                        &serde_json::to_string(item).unwrap_or_default(),
                        turn,
                        &created_at,
                        false,
                    )?;
                }
                Some("tool") => {
                    if let Some(tool) = item.get("tool") {
                        insert_tool_row(
                            &transaction,
                            thread_id,
                            &turn_id,
                            turn_index as i64,
                            item_index as i64,
                            next_tool_sort,
                            tool,
                        )?;
                        next_tool_sort += 1;
                    }
                }
                _ => {}
            }
        }
    }

    transaction
        .execute(
            "UPDATE threads SET updated_at = ? WHERE id = ?",
            params![now, thread_id],
        )
        .map_err(|error| ApiError::internal(format!("更新聊天时间失败: {error}")))?;
    transaction
        .execute(
            "UPDATE projects SET updated_at = ? WHERE id = ?",
            params![now, thread.project_id],
        )
        .map_err(|error| ApiError::internal(format!("更新项目时间失败: {error}")))?;
    transaction
        .commit()
        .map_err(|error| ApiError::internal(format!("提交聊天历史失败: {error}")))
}

fn insert_message_row(
    transaction: &rusqlite::Transaction<'_>,
    thread_id: &str,
    turn_id: &str,
    turn_sort: i64,
    item_sort: i64,
    role: &str,
    item_type: Option<&str>,
    content: &str,
    turn: &Value,
    created_at: &str,
    include_user_payload: bool,
) -> ApiResult<()> {
    transaction
        .execute(
            r#"
            INSERT INTO messages (
              id, thread_id, turn_id, turn_sort, item_sort, role, item_type, content, status, activity, metrics,
              session_id, phase, started_at_ms, duration_ms, input_tokens, output_tokens,
              cache_creation_input_tokens, cache_read_input_tokens, context_usage_json, total_cost_usd,
              pending_approval_requests_json, user_attachments_json, user_content_blocks_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
            params![
                uuid::Uuid::new_v4().to_string(),
                thread_id,
                turn_id,
                turn_sort,
                item_sort,
                role,
                item_type,
                content,
                turn.get("status")
                    .and_then(Value::as_str)
                    .map(|status| normalize_status(Some(status)))
                    .unwrap_or("done"),
                turn.get("activity").and_then(Value::as_str),
                turn.get("metrics").and_then(Value::as_str),
                turn.get("sessionId").and_then(Value::as_str),
                turn.get("phase").and_then(Value::as_str),
                turn.get("startedAtMs").and_then(Value::as_i64),
                turn.get("durationMs").and_then(Value::as_i64),
                turn.get("inputTokens").and_then(Value::as_i64),
                turn.get("outputTokens").and_then(Value::as_i64),
                turn.get("cacheCreationInputTokens").and_then(Value::as_i64),
                turn.get("cacheReadInputTokens").and_then(Value::as_i64),
                serialize_optional_json(turn.get("contextUsage")),
                turn.get("totalCostUsd").and_then(Value::as_f64),
                serialize_optional_json(turn.get("pendingApprovalRequests")),
                if include_user_payload {
                    serialize_optional_json(turn.get("userAttachments"))
                } else {
                    None
                },
                if include_user_payload {
                    serialize_optional_json(turn.get("userContentBlocks"))
                } else {
                    None
                },
                created_at,
            ],
        )
        .map(|_| ())
        .map_err(|error| ApiError::internal(format!("写入聊天历史失败: {error}")))
}

fn insert_tool_row(
    transaction: &rusqlite::Transaction<'_>,
    thread_id: &str,
    turn_id: &str,
    turn_sort: i64,
    item_sort: i64,
    tool_sort: i64,
    tool: &Value,
) -> ApiResult<()> {
    let tool_id = tool
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "tool");
    transaction
        .execute(
            r#"
            INSERT INTO tool_calls (
              id, thread_id, turn_id, turn_sort, item_sort, tool_sort, tool_id, name, title, status,
              tool_use_id, parent_tool_use_id, is_sidechain, input_text, result_text, is_error,
              subtools_json, sub_messages_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
            params![
                uuid::Uuid::new_v4().to_string(),
                thread_id,
                turn_id,
                turn_sort,
                item_sort,
                tool_sort,
                tool_id,
                tool.get("name").and_then(Value::as_str).unwrap_or("tool"),
                tool.get("title").and_then(Value::as_str).unwrap_or("tool"),
                normalize_status(tool.get("status").and_then(Value::as_str)),
                tool.get("toolUseId").and_then(Value::as_str),
                tool.get("parentToolUseId").and_then(Value::as_str),
                if tool
                    .get("isSidechain")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    1
                } else {
                    0
                },
                tool.get("inputText").and_then(Value::as_str),
                tool.get("resultText").and_then(Value::as_str),
                if tool
                    .get("isError")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    1
                } else {
                    0
                },
                serialize_optional_json(tool.get("subtools")),
                serialize_optional_json(tool.get("subMessages")),
            ],
        )
        .map(|_| ())
        .map_err(|error| ApiError::internal(format!("写入工具调用失败: {error}")))
}

fn tool_row_json(row: &ToolCallRow) -> Value {
    let mut tool = json!({
        "id": row.tool_id,
        "name": row.name,
        "title": row.title,
        "status": normalize_status(Some(row.status.as_str())),
        "isSidechain": row.is_sidechain,
        "isError": row.is_error,
    });
    set_json_optional_string(&mut tool, "toolUseId", row.tool_use_id.as_deref());
    set_json_optional_string(
        &mut tool,
        "parentToolUseId",
        row.parent_tool_use_id.as_deref(),
    );
    set_json_optional_string(&mut tool, "inputText", row.input_text.as_deref());
    set_json_optional_string(&mut tool, "resultText", row.result_text.as_deref());
    set_json_optional_value(&mut tool, "subtools", row.subtools_json.as_deref());
    set_json_optional_value(&mut tool, "subMessages", row.sub_messages_json.as_deref());
    tool
}

fn parse_claude_transcript(transcript_path: &str, session_id: Option<&str>) -> Vec<Value> {
    let Ok(content) = fs::read_to_string(transcript_path) else {
        return Vec::new();
    };
    let mut turns: Vec<Value> = Vec::new();
    for line in content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Ok(payload) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if payload
            .get("isMeta")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || is_claude_local_command_payload(&payload)
            || is_claude_task_notification_payload(&payload)
        {
            continue;
        }
        let timestamp_ms = payload
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_iso_timestamp_ms);
        if payload.get("type").and_then(Value::as_str) == Some("attachment") {
            if let Some(summary) = extract_guide_attachment_text(&payload) {
                if let Some(turn) = turns.last_mut() {
                    push_turn_item(turn, create_guide_system_command_item(&summary));
                }
            }
            continue;
        }
        if payload
            .get("isSidechain")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let parent_tool_use_id = payload
                .get("parent_tool_use_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            if let Some(parent_tool_use_id) = parent_tool_use_id {
                if payload.pointer("/message/role").and_then(Value::as_str) == Some("assistant") {
                    attach_sidechain_assistant_message(&mut turns, parent_tool_use_id, &payload);
                    continue;
                }
                if payload.pointer("/message/role").and_then(Value::as_str) == Some("user") {
                    if let Some(index) = turns
                        .iter()
                        .position(|turn| turn_has_tool_use_id(turn, parent_tool_use_id))
                    {
                        attach_tool_results(&mut turns[index], payload.pointer("/message/content"));
                    } else if let Some(turn) = turns.last_mut() {
                        attach_tool_results(turn, payload.pointer("/message/content"));
                    }
                    continue;
                }
            }
        }
        match payload.get("type").and_then(Value::as_str) {
            Some("user") => {
                if payload.pointer("/message/role").and_then(Value::as_str) != Some("user") {
                    continue;
                }
                let content = payload.pointer("/message/content");
                if !content.is_some_and(contains_tool_result) {
                    let user_text = content.map(extract_user_text).unwrap_or_default();
                    turns.push(create_transcript_turn(
                        &user_text,
                        session_id,
                        timestamp_ms,
                        "stopped",
                        Some("运行结束但没有返回正文"),
                    ));
                } else if let Some(turn) = turns.last_mut() {
                    attach_tool_results(turn, content);
                }
            }
            Some("assistant") => {
                if payload.pointer("/message/role").and_then(Value::as_str) != Some("assistant") {
                    continue;
                }
                if turns.is_empty() {
                    turns.push(create_transcript_turn(
                        "",
                        session_id,
                        timestamp_ms,
                        "done",
                        None,
                    ));
                }
                let turn = turns.last_mut().expect("turn exists");
                set_turn_started_at(turn, timestamp_ms);
                apply_transcript_metrics(turn, &payload, payload.get("message"));
                for block in extract_content_blocks(payload.pointer("/message/content")) {
                    match block.get("type").and_then(Value::as_str) {
                        Some("thinking") => {
                            if let Some(text) = block.get("text").and_then(Value::as_str) {
                                push_thinking_item(turn, text);
                            }
                        }
                        Some("text") => {
                            if let Some(text) = block.get("text").and_then(Value::as_str) {
                                set_json_string(turn, "status", "done");
                                remove_json_key(turn, "activity");
                                append_assistant_text(turn, text);
                                push_text_item(turn, text);
                            }
                        }
                        Some("tool_use") => {
                            let Some(name) = block.get("name").and_then(Value::as_str) else {
                                continue;
                            };
                            set_json_string(turn, "status", "done");
                            remove_json_key(turn, "activity");
                            let input = block.get("input").cloned().unwrap_or(Value::Null);
                            let input_text = format_json_value(&input);
                            let tool_use_id = block
                                .get("id")
                                .and_then(Value::as_str)
                                .map(ToString::to_string);
                            let tool_id = tool_use_id
                                .clone()
                                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                            let tool = json!({
                                "id": tool_id,
                                "name": name,
                                "title": describe_tool_call(name, &input_text),
                                "status": "done",
                                "toolUseId": tool_use_id,
                                "inputText": input_text,
                            });
                            push_tool_to_turn(turn, tool.clone());
                            if let Some(request) = parse_request_user_input_event(
                                name,
                                &input,
                                tool.get("toolUseId").and_then(Value::as_str),
                            ) {
                                upsert_pending_request(turn, "pendingUserInputRequests", request);
                            }
                            if let Some(request) = parse_approval_request_event(
                                name,
                                &input,
                                tool.get("toolUseId").and_then(Value::as_str),
                            ) {
                                upsert_pending_request(
                                    turn,
                                    "pendingApprovalRequests",
                                    mark_approval_request_historical(request),
                                );
                            }
                        }
                        _ => {}
                    }
                }
            }
            Some("result") => {
                if let Some(turn) = turns.last_mut() {
                    set_turn_started_at(turn, timestamp_ms);
                    apply_transcript_metrics(turn, &payload, None);
                    if let Some(message) = context_result_error_message(&payload) {
                        set_json_string(turn, "status", "error");
                        set_json_string(turn, "activity", &message);
                    }
                }
            }
            _ => {}
        }
    }
    turns
        .into_iter()
        .filter(|turn| {
            turn.get("userText")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty())
                || turn
                    .get("assistantText")
                    .and_then(Value::as_str)
                    .is_some_and(|value| !value.trim().is_empty())
                || json_array_has_items(turn.get("tools"))
        })
        .collect()
}

fn read_latest_claude_context_snapshot(transcript_path: &str) -> Option<Value> {
    let metadata = fs::metadata(transcript_path).ok()?;
    let transcript_mtime_ms = metadata
        .modified()
        .ok()
        .map(chrono::DateTime::<chrono::Utc>::from)
        .map(|timestamp| timestamp.timestamp_millis())
        .unwrap_or_else(current_timestamp_ms_i64);
    let content = fs::read_to_string(transcript_path).ok()?;
    let mut latest: Option<(String, i64, i64)> = None;
    let mut event_count = 0_i64;
    for line in content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Ok(payload) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        event_count += 1;
        let markdown = extract_context_markdown_from_payload(&payload)
            .trim()
            .to_string();
        if markdown.is_empty() {
            continue;
        }
        let snapshot = create_context_snapshot_value(
            &markdown,
            payload
                .get("timestamp")
                .and_then(Value::as_str)
                .and_then(parse_iso_timestamp_ms)
                .unwrap_or(transcript_mtime_ms),
            0,
            1,
        );
        if snapshot
            .pointer("/summary/hasContextUsage")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            latest = Some((
                markdown,
                snapshot["requestedAtMs"]
                    .as_i64()
                    .unwrap_or(transcript_mtime_ms),
                event_count,
            ));
        }
    }
    latest.map(|(markdown, requested_at_ms, count)| {
        create_context_snapshot_value(&markdown, requested_at_ms, 0, count)
    })
}

fn create_transcript_turn(
    user_text: &str,
    session_id: Option<&str>,
    started_at_ms: Option<i64>,
    status: &str,
    activity: Option<&str>,
) -> Value {
    let mut turn = json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "userText": user_text,
        "assistantText": "",
        "status": status,
        "items": [],
        "tools": [],
    });
    set_json_optional_string(&mut turn, "sessionId", session_id);
    set_json_optional_number(&mut turn, "startedAtMs", started_at_ms);
    set_json_optional_string(&mut turn, "activity", activity);
    turn
}

fn parse_iso_timestamp_ms(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.timestamp_millis())
}

fn contains_tool_result(content: &Value) -> bool {
    content.as_array().is_some_and(|items| {
        items
            .iter()
            .any(|item| item.get("type").and_then(Value::as_str) == Some("tool_result"))
    })
}

fn extract_user_text(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        return text.trim().to_string();
    }
    content
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    (item.get("type").and_then(Value::as_str) == Some("text"))
                        .then(|| item.get("text").and_then(Value::as_str))
                        .flatten()
                })
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string()
        })
        .unwrap_or_default()
}

fn extract_content_blocks(content: Option<&Value>) -> Vec<Value> {
    content
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let block_type = item.get("type").and_then(Value::as_str)?;
                    let text = item
                        .get("text")
                        .or_else(|| item.get("thinking"))
                        .and_then(Value::as_str);
                    if block_type == "text" && text == Some("No response requested.") {
                        return None;
                    }
                    Some(json!({
                        "type": block_type,
                        "text": text,
                        "id": item.get("id").and_then(Value::as_str),
                        "name": item.get("name").and_then(Value::as_str),
                        "input": item.get("input").cloned().unwrap_or(Value::Null),
                    }))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn append_assistant_text(turn: &mut Value, text: &str) {
    let current = turn
        .get("assistantText")
        .and_then(Value::as_str)
        .unwrap_or_default();
    turn["assistantText"] = Value::String(format!("{current}{text}"));
}

fn push_text_item(turn: &mut Value, text: &str) {
    if text.is_empty() {
        return;
    }
    if let Some(items) = turn.get_mut("items").and_then(Value::as_array_mut) {
        if let Some(last) = items.last_mut() {
            if last.get("type").and_then(Value::as_str) == Some("text") {
                let current = last.get("text").and_then(Value::as_str).unwrap_or_default();
                last["text"] = Value::String(format!("{current}{text}"));
                return;
            }
        }
        items.push(json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "type": "text",
            "text": text,
        }));
    }
}

fn push_thinking_item(turn: &mut Value, text: &str) {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return;
    }
    push_turn_item(
        turn,
        json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "type": "thinking",
            "text": trimmed,
        }),
    );
}

fn push_turn_item(turn: &mut Value, item: Value) {
    if let Some(items) = turn.get_mut("items").and_then(Value::as_array_mut) {
        items.push(item);
    }
}

fn push_tool_to_turn(turn: &mut Value, tool: Value) {
    if let Some(tools) = turn.get_mut("tools").and_then(Value::as_array_mut) {
        tools.push(tool.clone());
    }
    push_turn_item(
        turn,
        json!({
            "id": tool.get("id").cloned().unwrap_or_else(|| json!(uuid::Uuid::new_v4().to_string())),
            "type": "tool",
            "tool": tool,
        }),
    );
}

fn attach_tool_results(turn: &mut Value, content: Option<&Value>) {
    let Some(items) = content.and_then(Value::as_array) else {
        return;
    };
    for item in items {
        if item.get("type").and_then(Value::as_str) != Some("tool_result") {
            continue;
        }
        let Some(tool_use_id) = item.get("tool_use_id").and_then(Value::as_str) else {
            continue;
        };
        let result_text = stringify_claude_content(item.get("content").unwrap_or(&Value::Null));
        let is_error = item
            .get("is_error")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if update_tool_result(turn, tool_use_id, &result_text, is_error) {
            mark_request_user_input_submitted(turn, tool_use_id, &result_text);
            if is_error && is_human_approval_tool_result_content(&result_text) {
                let request = json!({
                    "requestId": tool_use_id,
                    "kind": "permission",
                    "title": "工具调用需要你确认",
                    "description": "Claude 返回该操作需要批准后才能继续。批准后会以完全访问模式继续执行。",
                    "danger": "medium",
                    "historical": true,
                });
                upsert_pending_request(turn, "pendingApprovalRequests", request);
            } else {
                remove_pending_approval_request(turn, tool_use_id);
            }
        }
    }
}

fn update_tool_result(
    turn: &mut Value,
    tool_use_id: &str,
    result_text: &str,
    is_error: bool,
) -> bool {
    let mut updated = false;
    if let Some(tools) = turn.get_mut("tools").and_then(Value::as_array_mut) {
        updated |= update_tool_result_in_array(tools, tool_use_id, result_text, is_error);
    }
    if let Some(items) = turn.get_mut("items").and_then(Value::as_array_mut) {
        for item in items {
            if item.get("type").and_then(Value::as_str) == Some("tool") {
                if let Some(tool) = item.get_mut("tool") {
                    updated |= update_tool_value_result(tool, tool_use_id, result_text, is_error);
                }
            }
        }
    }
    updated
}

fn update_tool_result_in_array(
    tools: &mut [Value],
    tool_use_id: &str,
    result_text: &str,
    is_error: bool,
) -> bool {
    let mut updated = false;
    for tool in tools {
        updated |= update_tool_value_result(tool, tool_use_id, result_text, is_error);
        if let Some(subtools) = tool.get_mut("subtools").and_then(Value::as_array_mut) {
            updated |= update_tool_result_in_array(subtools, tool_use_id, result_text, is_error);
        }
    }
    updated
}

fn update_tool_value_result(
    tool: &mut Value,
    tool_use_id: &str,
    result_text: &str,
    is_error: bool,
) -> bool {
    let matches = tool.get("toolUseId").and_then(Value::as_str) == Some(tool_use_id)
        || tool.get("id").and_then(Value::as_str) == Some(tool_use_id);
    if matches {
        tool["resultText"] = json!(result_text);
        tool["isError"] = json!(is_error);
        tool["status"] = json!(if is_error { "error" } else { "done" });
    }
    matches
}

fn turn_has_tool_use_id(turn: &Value, tool_use_id: &str) -> bool {
    turn.get("tools")
        .and_then(Value::as_array)
        .is_some_and(|tools| {
            tools
                .iter()
                .any(|tool| tool_matches_use_id(tool, tool_use_id))
        })
}

fn tool_matches_use_id(tool: &Value, tool_use_id: &str) -> bool {
    tool.get("toolUseId").and_then(Value::as_str) == Some(tool_use_id)
        || tool.get("id").and_then(Value::as_str) == Some(tool_use_id)
        || tool
            .get("subtools")
            .and_then(Value::as_array)
            .is_some_and(|tools| {
                tools
                    .iter()
                    .any(|tool| tool_matches_use_id(tool, tool_use_id))
            })
}

fn attach_sidechain_assistant_message(
    turns: &mut [Value],
    parent_tool_use_id: &str,
    payload: &Value,
) {
    let content = payload.pointer("/message/content");
    for block in extract_content_blocks(content) {
        if block.get("type").and_then(Value::as_str) == Some("text") {
            if let Some(text) = block
                .get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                append_tool_submessage(turns, parent_tool_use_id, text);
            }
            continue;
        }
        if block.get("type").and_then(Value::as_str) != Some("tool_use") {
            continue;
        }
        let Some(name) = block.get("name").and_then(Value::as_str) else {
            continue;
        };
        let input = block.get("input").cloned().unwrap_or(Value::Null);
        let input_text = format_json_value(&input);
        let tool_use_id = block
            .get("id")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let tool = json!({
            "id": tool_use_id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            "name": name,
            "title": describe_tool_call(name, &input_text),
            "status": "done",
            "toolUseId": tool_use_id,
            "parentToolUseId": parent_tool_use_id,
            "isSidechain": true,
            "inputText": input_text,
        });
        append_tool_subtool(turns, parent_tool_use_id, tool);
    }
}

fn append_tool_submessage(turns: &mut [Value], tool_use_id: &str, text: &str) {
    for turn in turns {
        if append_tool_submessage_in_turn(turn, tool_use_id, text) {
            return;
        }
    }
}

fn append_tool_submessage_in_turn(turn: &mut Value, tool_use_id: &str, text: &str) -> bool {
    let mut updated = false;
    if let Some(tools) = turn.get_mut("tools").and_then(Value::as_array_mut) {
        updated |= append_tool_submessage_in_array(tools, tool_use_id, text);
    }
    if let Some(items) = turn.get_mut("items").and_then(Value::as_array_mut) {
        for item in items {
            if let Some(tool) = item.get_mut("tool") {
                updated |= append_tool_submessage_value(tool, tool_use_id, text);
            }
        }
    }
    updated
}

fn append_tool_submessage_in_array(tools: &mut [Value], tool_use_id: &str, text: &str) -> bool {
    for tool in tools {
        if append_tool_submessage_value(tool, tool_use_id, text) {
            return true;
        }
        if let Some(subtools) = tool.get_mut("subtools").and_then(Value::as_array_mut) {
            if append_tool_submessage_in_array(subtools, tool_use_id, text) {
                return true;
            }
        }
    }
    false
}

fn append_tool_submessage_value(tool: &mut Value, tool_use_id: &str, text: &str) -> bool {
    if tool.get("toolUseId").and_then(Value::as_str) != Some(tool_use_id)
        && tool.get("id").and_then(Value::as_str) != Some(tool_use_id)
    {
        return false;
    }
    if !tool.get("subMessages").is_some_and(Value::is_array) {
        tool["subMessages"] = json!([]);
    }
    if let Some(items) = tool.get_mut("subMessages").and_then(Value::as_array_mut) {
        items.push(json!(text));
    }
    true
}

fn append_tool_subtool(turns: &mut [Value], tool_use_id: &str, subtool: Value) {
    for turn in turns {
        if append_tool_subtool_in_turn(turn, tool_use_id, subtool.clone()) {
            return;
        }
    }
}

fn append_tool_subtool_in_turn(turn: &mut Value, tool_use_id: &str, subtool: Value) -> bool {
    let mut updated = false;
    if let Some(tools) = turn.get_mut("tools").and_then(Value::as_array_mut) {
        updated |= append_tool_subtool_in_array(tools, tool_use_id, subtool.clone());
    }
    if let Some(items) = turn.get_mut("items").and_then(Value::as_array_mut) {
        for item in items {
            if let Some(tool) = item.get_mut("tool") {
                updated |= append_tool_subtool_value(tool, tool_use_id, subtool.clone());
            }
        }
    }
    updated
}

fn append_tool_subtool_in_array(tools: &mut [Value], tool_use_id: &str, subtool: Value) -> bool {
    for tool in tools {
        if append_tool_subtool_value(tool, tool_use_id, subtool.clone()) {
            return true;
        }
        if let Some(subtools) = tool.get_mut("subtools").and_then(Value::as_array_mut) {
            if append_tool_subtool_in_array(subtools, tool_use_id, subtool.clone()) {
                return true;
            }
        }
    }
    false
}

fn append_tool_subtool_value(tool: &mut Value, tool_use_id: &str, subtool: Value) -> bool {
    if tool.get("toolUseId").and_then(Value::as_str) != Some(tool_use_id)
        && tool.get("id").and_then(Value::as_str) != Some(tool_use_id)
    {
        return false;
    }
    if !tool.get("subtools").is_some_and(Value::is_array) {
        tool["subtools"] = json!([]);
    }
    if let Some(items) = tool.get_mut("subtools").and_then(Value::as_array_mut) {
        items.push(subtool);
    }
    true
}

fn mark_request_user_input_submitted(turn: &mut Value, request_id: &str, result_text: &str) {
    let Some(requests) = turn
        .get_mut("pendingUserInputRequests")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    for request in requests {
        if request.get("requestId").and_then(Value::as_str) == Some(request_id) {
            let submitted_answers =
                parse_request_user_input_submitted_answers(request, result_text);
            request["submittedAtMs"] = json!(current_timestamp_ms_i64());
            request["submittedAnswers"] = Value::Object(submitted_answers);
        }
    }
}

fn parse_request_user_input_submitted_answers(
    request: &Value,
    result_text: &str,
) -> Map<String, Value> {
    let structured_answers = serde_json::from_str::<Value>(result_text)
        .ok()
        .and_then(|value| {
            value
                .get("answers")
                .and_then(Value::as_object)
                .cloned()
                .or_else(|| value.as_object().cloned())
        });
    let Some(questions) = request.get("questions").and_then(Value::as_array) else {
        return Map::new();
    };

    questions
        .iter()
        .enumerate()
        .filter_map(|(index, question)| {
            let key = first_json_string(question, &["id", "name", "key"])
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("question-{index}"));
            let question_text =
                first_json_string(question, &["question", "text", "prompt", "message"]);
            let answer = structured_answers
                .as_ref()
                .and_then(|answers| {
                    answers
                        .get(&key)
                        .or_else(|| question_text.and_then(|text| answers.get(text)))
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                })
                .or_else(|| {
                    question_text
                        .and_then(|text| parse_native_request_user_input_answer(result_text, text))
                })?;
            let answer = normalize_request_user_input_history_answer(question, &answer);
            (!answer.is_empty()).then(|| (key, json!(answer)))
        })
        .collect()
}

fn parse_native_request_user_input_answer(result_text: &str, question: &str) -> Option<String> {
    let question_marker = format!("{}=", serde_json::to_string(question).ok()?);
    let answer_source = result_text.split_once(&question_marker)?.1;
    let mut deserializer = serde_json::Deserializer::from_str(answer_source);
    String::deserialize(&mut deserializer)
        .ok()
        .map(|answer| answer.trim().to_string())
        .filter(|answer| !answer.is_empty())
}

fn normalize_request_user_input_history_answer(question: &Value, answer: &str) -> String {
    let answer = answer.trim();
    if !question
        .get("multiSelect")
        .or_else(|| question.get("multi_select"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return answer.to_string();
    }

    let option_labels = question
        .get("options")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|option| first_json_string(option, &["label", "title", "value"]))
        .collect::<std::collections::HashSet<_>>();
    let mut selected_options = Vec::new();
    let mut custom_parts = Vec::new();
    for part in answer
        .split(", ")
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        if option_labels.contains(part) {
            selected_options.push(part.to_string());
        } else {
            custom_parts.push(part);
        }
    }
    if !custom_parts.is_empty() {
        selected_options.push(custom_parts.join(", "));
    }
    selected_options.join("\n")
}

fn upsert_pending_request(turn: &mut Value, key: &str, request: Value) {
    if !turn.get(key).is_some_and(Value::is_array) {
        turn[key] = json!([]);
    }
    let request_id = request.get("requestId").and_then(Value::as_str);
    if let Some(items) = turn.get_mut(key).and_then(Value::as_array_mut) {
        if let Some(request_id) = request_id {
            if let Some(existing) = items
                .iter_mut()
                .find(|item| item.get("requestId").and_then(Value::as_str) == Some(request_id))
            {
                *existing = request;
                return;
            }
        }
        items.push(request);
    }
}

fn remove_pending_approval_request(turn: &mut Value, request_id: &str) {
    let Some(items) = turn
        .get_mut("pendingApprovalRequests")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    items.retain(|item| {
        item.get("kind").and_then(Value::as_str) == Some("plan-exit")
            || item.get("requestId").and_then(Value::as_str) != Some(request_id)
    });
    if items.is_empty() {
        remove_json_key(turn, "pendingApprovalRequests");
    }
}

fn mark_approval_request_historical(mut request: Value) -> Value {
    request["historical"] = json!(true);
    request
}

fn set_turn_started_at(turn: &mut Value, timestamp_ms: Option<i64>) {
    if turn.get("startedAtMs").and_then(Value::as_i64).is_none() {
        set_json_optional_number(turn, "startedAtMs", timestamp_ms);
    }
}

fn apply_transcript_metrics(turn: &mut Value, payload: &Value, message: Option<&Value>) {
    if let Some(usage) = payload
        .pointer("/context_window/current_usage")
        .or_else(|| payload.get("usage"))
        .or_else(|| message.and_then(|message| message.get("usage")))
    {
        set_json_optional_number(
            turn,
            "inputTokens",
            usage.get("input_tokens").and_then(Value::as_i64),
        );
        set_json_optional_number(
            turn,
            "outputTokens",
            usage.get("output_tokens").and_then(Value::as_i64),
        );
        set_json_optional_number(
            turn,
            "cacheCreationInputTokens",
            usage
                .get("cache_creation_input_tokens")
                .and_then(Value::as_i64),
        );
        set_json_optional_number(
            turn,
            "cacheReadInputTokens",
            usage.get("cache_read_input_tokens").and_then(Value::as_i64),
        );
    }
    set_json_optional_number(
        turn,
        "durationMs",
        payload.get("duration_ms").and_then(Value::as_i64),
    );
    set_json_optional_float(
        turn,
        "totalCostUsd",
        payload.get("total_cost_usd").and_then(Value::as_f64),
    );
}

fn format_json_value(value: &Value) -> String {
    if value.is_null() {
        String::new()
    } else if let Some(text) = value.as_str() {
        text.to_string()
    } else {
        serde_json::to_string_pretty(value).unwrap_or_default()
    }
}

fn describe_tool_call(name: &str, input_text: &str) -> String {
    let parsed = serde_json::from_str::<Value>(input_text).ok();
    let file_path = parsed
        .as_ref()
        .and_then(|value| first_json_string(value, &["file_path", "path", "notebook_path"]));
    let pattern = parsed
        .as_ref()
        .and_then(|value| first_json_string(value, &["pattern", "query"]));
    let command = parsed
        .as_ref()
        .and_then(|value| first_json_string(value, &["command", "cmd", "cmdString"]));
    if name == "Read" {
        if let Some(value) = file_path {
            return format!("Read({})", compact_tool_argument(value));
        }
    }
    if name == "Grep" || name == "Glob" {
        if let Some(value) = pattern {
            return format!("{name}({})", compact_tool_argument(value));
        }
    }
    if name == "Bash" {
        if let Some(value) = command {
            return format!("Bash({})", compact_tool_argument(value));
        }
    }
    name.to_string()
}

fn compact_tool_argument(value: &str) -> String {
    let trimmed = value.trim();
    let max_chars = 80;
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    format!("{}...", trimmed.chars().take(max_chars).collect::<String>())
}

fn extract_guide_attachment_text(payload: &Value) -> Option<String> {
    let attachment = payload.get("attachment")?;
    if attachment.get("type").and_then(Value::as_str) != Some("queued_command")
        || attachment.get("commandMode").and_then(Value::as_str) != Some("prompt")
    {
        return None;
    }
    let text = extract_user_text(attachment.get("prompt")?);
    (!text.is_empty()).then_some(text)
}

fn create_guide_system_command_item(summary: &str) -> Value {
    json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "type": "system-command",
        "command": "guide",
        "title": "已引导当前运行",
        "cardType": "compact",
        "state": "done",
        "summary": summary,
    })
}

fn is_claude_local_command_payload(payload: &Value) -> bool {
    let content = payload.pointer("/message/content");
    content.is_some_and(|content| {
        has_claude_local_command_text(content.as_str())
            || content.as_array().is_some_and(|items| {
                items.iter().any(|item| {
                    has_claude_local_command_text(item.get("text").and_then(Value::as_str))
                })
            })
    })
}

fn has_claude_local_command_text(text: Option<&str>) -> bool {
    let trimmed = text.unwrap_or_default().trim();
    trimmed.starts_with("<local-command-")
        || trimmed.starts_with("<command-name>")
        || trimmed.starts_with("<command-message>")
        || trimmed.starts_with("<command-args>")
}

fn is_claude_task_notification_payload(payload: &Value) -> bool {
    payload
        .pointer("/origin/kind")
        .and_then(Value::as_str)
        .is_some_and(|value| value == "task-notification")
        || payload
            .pointer("/attachment/commandMode")
            .and_then(Value::as_str)
            .is_some_and(|value| value == "task-notification")
        || payload
            .pointer("/message/content")
            .is_some_and(is_task_notification_content)
}

fn is_task_notification_content(content: &Value) -> bool {
    content.as_str().is_some_and(is_task_notification_text)
        || content.as_array().is_some_and(|items| {
            items.iter().any(|item| {
                item.get("type").and_then(Value::as_str) == Some("text")
                    && item
                        .get("text")
                        .and_then(Value::as_str)
                        .is_some_and(is_task_notification_text)
            })
        })
}

fn is_task_notification_text(text: &str) -> bool {
    let trimmed = text.trim();
    trimmed.starts_with("<task-notification>") && trimmed.contains("</task-notification>")
}

fn remove_claude_local_command_pollution(turns: Vec<Value>) -> Vec<Value> {
    turns
        .into_iter()
        .map(|mut turn| {
            if let Some(items) = turn.get_mut("items").and_then(Value::as_array_mut) {
                items.retain(|item| match item.get("type").and_then(Value::as_str) {
                    Some("text") | Some("thinking") => {
                        !has_claude_local_command_text(item.get("text").and_then(Value::as_str))
                    }
                    Some("system-command") => {
                        !has_claude_local_command_text(item.get("summary").and_then(Value::as_str))
                            && !has_claude_local_command_text(
                                item.get("errorMessage").and_then(Value::as_str),
                            )
                    }
                    _ => true,
                });
            }
            turn
        })
        .collect()
}

fn remove_json_key(target: &mut Value, key: &str) {
    if let Some(object) = target.as_object_mut() {
        object.remove(key);
    }
}

fn normalize_status(value: Option<&str>) -> &'static str {
    match value {
        Some("pending") => "pending",
        Some("running") => "running",
        Some("error") => "error",
        Some("stopped") => "stopped",
        _ => "done",
    }
}

fn serialize_optional_json(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if value.is_null() {
        return None;
    }
    if value.as_array().is_some_and(|items| items.is_empty()) {
        return None;
    }
    if value.as_object().is_some_and(|items| items.is_empty()) {
        return None;
    }
    serde_json::to_string(value).ok()
}

fn parse_json_value(value: &str) -> Option<Value> {
    serde_json::from_str(value).ok()
}

fn set_json_string(target: &mut Value, key: &str, value: &str) {
    target[key] = Value::String(value.to_string());
}

fn set_json_optional_string(target: &mut Value, key: &str, value: Option<&str>) {
    if let Some(value) = value.filter(|item| !item.is_empty()) {
        target[key] = Value::String(value.to_string());
    }
}

fn set_json_optional_number(target: &mut Value, key: &str, value: Option<i64>) {
    if let Some(value) = value {
        target[key] = json!(value);
    }
}

fn set_json_optional_float(target: &mut Value, key: &str, value: Option<f64>) {
    if let Some(value) = value {
        target[key] = json!(value);
    }
}

fn set_json_optional_value(target: &mut Value, key: &str, value: Option<&str>) {
    if let Some(value) = value.and_then(parse_json_value) {
        target[key] = value;
    }
}

fn timestamp_ms_to_iso(value: i64) -> Option<String> {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(value)
        .map(|timestamp| timestamp.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

fn search_workspace_files(root: &str, query: &str) -> ApiResult<Vec<Value>> {
    let normalized_query = query.replace('\\', "/").to_ascii_lowercase();
    if normalized_query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let skip_directories = [
        ".git",
        "node_modules",
        "target",
        "dist",
        ".next",
        ".venv",
        "venv",
        ".codem-attachments",
    ];
    let mut results: Vec<(String, String, bool, usize)> = Vec::new();
    let mut stack = vec![(PathBuf::from(root), 0_usize)];
    let mut index = 0_usize;

    while let Some((directory, depth)) = stack.pop() {
        if depth >= 4 || results.len() >= 500 {
            continue;
        }
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            if results.len() >= 500 {
                break;
            }
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let is_directory = file_type.is_dir();
            let name = entry.file_name().to_string_lossy().to_string();
            if is_directory && skip_directories.contains(&name.as_str()) {
                continue;
            }
            let rel = path
                .strip_prefix(root)
                .ok()
                .map(|value| value.display().to_string().replace('\\', "/"))
                .unwrap_or_else(|| name.clone());
            if rel.to_ascii_lowercase().contains(&normalized_query) {
                results.push((path.display().to_string(), rel, is_directory, index));
                index += 1;
            }
            if is_directory {
                stack.push((path, depth + 1));
            }
        }
    }

    results.sort_by(|left, right| {
        file_search_score(&left.1, &normalized_query)
            .cmp(&file_search_score(&right.1, &normalized_query))
            .then_with(|| right.2.cmp(&left.2))
            .then_with(|| left.1.len().cmp(&right.1.len()))
            .then_with(|| left.1.cmp(&right.1))
            .then_with(|| left.3.cmp(&right.3))
    });
    Ok(results
        .into_iter()
        .take(80)
        .map(|(path, rel, is_directory, _)| {
            json!({
                "path": path,
                "rel": rel,
                "isDirectory": is_directory,
            })
        })
        .collect())
}

fn file_search_score(rel: &str, normalized_query: &str) -> u8 {
    let normalized_rel = rel.replace('\\', "/").to_ascii_lowercase();
    let segments: Vec<&str> = normalized_rel
        .split('/')
        .filter(|value| !value.is_empty())
        .collect();
    let basename = segments.last().copied().unwrap_or(normalized_rel.as_str());
    if normalized_rel == normalized_query || basename == normalized_query {
        return 0;
    }
    if basename.starts_with(normalized_query) {
        return 1;
    }
    if normalized_rel.starts_with(normalized_query)
        || segments.iter().any(|segment| *segment == normalized_query)
    {
        return 2;
    }
    if segments
        .iter()
        .any(|segment| segment.starts_with(normalized_query))
    {
        return 3;
    }
    if normalized_rel.contains(normalized_query) {
        return 4;
    }
    5
}

fn resolve_workspace_relative_path(root: &str, raw_path: &str) -> Option<(String, String)> {
    let stripped = raw_path.trim().trim_matches([' ', '\'', '"', '`']);
    if stripped.is_empty() || Path::new(stripped).is_absolute() {
        return None;
    }
    let slashed = stripped
        .replace('\\', "/")
        .trim_start_matches("./")
        .to_string();
    if slashed == ".."
        || slashed.starts_with("../")
        || slashed.contains("/../")
        || slashed.ends_with("/..")
    {
        return None;
    }
    let absolute = PathBuf::from(root).join(slashed.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !is_path_inside_root(&absolute.display().to_string(), root) {
        return None;
    }
    let rel = absolute
        .strip_prefix(root)
        .ok()?
        .display()
        .to_string()
        .replace('\\', "/");
    Some((absolute.display().to_string(), rel))
}

fn parse_image_data_url(data_url: &str, requested_mime_type: &str) -> ApiResult<ParsedImageData> {
    let Some((metadata, encoded)) = data_url.split_once(',') else {
        return Err(ApiError::bad_request("仅支持粘贴常见图片格式。"));
    };
    if !metadata.starts_with("data:image/") || !metadata.ends_with(";base64") {
        return Err(ApiError::bad_request("仅支持粘贴常见图片格式。"));
    }
    let detected_mime_type = metadata
        .trim_start_matches("data:")
        .trim_end_matches(";base64");
    let mime_type = if requested_mime_type.trim().is_empty() {
        detected_mime_type
    } else {
        requested_mime_type.trim()
    };
    let extension = extension_from_image_mime_type(mime_type)?;
    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| ApiError::bad_request("仅支持粘贴常见图片格式。"))?;
    if bytes.is_empty() {
        return Err(ApiError::bad_request("图片内容为空。"));
    }
    if bytes.len() > 10 * 1024 * 1024 {
        return Err(ApiError::bad_request("图片过大，请控制在 10MB 以内。"));
    }
    Ok(ParsedImageData {
        mime_type: mime_type.to_string(),
        extension: extension.to_string(),
        bytes,
    })
}

fn extension_from_image_mime_type(mime_type: &str) -> ApiResult<&'static str> {
    match mime_type {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        "image/webp" => Ok("webp"),
        "image/gif" => Ok("gif"),
        _ => Err(ApiError::bad_request(format!(
            "暂不支持的图片格式：{mime_type}"
        ))),
    }
}

fn build_attachment_file_name(extension: &str) -> String {
    let timestamp = chrono::Utc::now().format("%Y%m%d%H%M%S");
    let suffix = uuid::Uuid::new_v4().to_string();
    format!("pasted-{timestamp}-{}.{}", &suffix[..8], extension)
}

fn validate_desktop_file_path(file_path: &str) -> ApiResult<()> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() || trimmed.len() > 4096 {
        return Err(ApiError::bad_request("path 不能为空"));
    }
    let normalized = trimmed.replace('\\', "/");
    if normalized.contains("/../") || normalized.starts_with("../") || normalized.ends_with("/..") {
        return Err(ApiError::bad_request("该路径不被允许。"));
    }
    let lower = normalized.to_ascii_lowercase();
    for pattern in [
        "/etc/passwd",
        "/etc/shadow",
        "/proc/",
        "/sys/",
        "/.ssh/",
        "/.aws/",
        "/.gnupg/",
        "/.kube/",
    ] {
        if lower.contains(pattern) {
            return Err(ApiError::bad_request("该路径不被允许。"));
        }
    }
    if lower == ".env"
        || lower.starts_with(".env.")
        || lower.contains("/.env.")
        || lower.ends_with("/.env")
    {
        return Err(ApiError::bad_request("该路径不被允许。"));
    }
    Ok(())
}

fn is_supported_image_file_path(file_path: &str) -> bool {
    matches!(
        Path::new(file_path)
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("png" | "jpg" | "jpeg" | "webp" | "gif" | "svg" | "ico" | "bmp" | "avif")
    )
}

fn image_mime_type_from_file_path(file_path: &str) -> &'static str {
    match Path::new(file_path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        Some("avif") => "image/avif",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        _ => "application/octet-stream",
    }
}

fn ensure_can_preview_workspace_file(state: &AppState, file_path: &str) -> ApiResult<()> {
    let connection = open_initialized_workspace_database(state)?;
    let mut statement = connection
        .prepare("SELECT path FROM projects")
        .map_err(|error| ApiError::internal(format!("读取项目列表失败: {error}")))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| ApiError::internal(format!("读取项目列表失败: {error}")))?;
    let project_paths = collect_rows(rows, "读取项目列表失败")?;
    if project_paths
        .iter()
        .any(|project_path| is_path_inside_root(file_path, project_path))
    {
        return Ok(());
    }
    Err(ApiError {
        status: StatusCode::FORBIDDEN,
        message: "无权访问该路径".to_string(),
        json_body: false,
    })
}

fn is_path_inside_root(target_path: &str, root_path: &str) -> bool {
    let target = normalize_path_for_compare(target_path);
    let root = normalize_path_for_compare(root_path);
    target == root || target.starts_with(&format!("{root}/"))
}

fn normalize_path_for_compare(path: &str) -> String {
    normalize_path_lexically(Path::new(path))
        .display()
        .to_string()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn resolve_absolute_path(path: &str) -> ApiResult<String> {
    let raw_path = PathBuf::from(path);
    let absolute_path = if raw_path.is_absolute() {
        raw_path
    } else {
        env::current_dir()
            .map_err(|error| ApiError::internal(format!("读取当前目录失败: {error}")))?
            .join(raw_path)
    };
    Ok(normalize_path_lexically(&absolute_path)
        .display()
        .to_string())
}

fn normalize_path_lexically(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                normalized.push(component.as_os_str());
            }
        }
    }
    normalized
}

fn percent_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn run_directory_picker(initial_path: Option<&str>) -> ApiResult<Option<String>> {
    #[cfg(target_os = "windows")]
    {
        let initial_path = initial_path
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(resolve_absolute_path)
            .transpose()?
            .unwrap_or_default();
        let script = build_folder_picker_script(&initial_path);
        let output = background_command("powershell.exe")
            .args([
                "-NoProfile",
                "-Sta",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
            ])
            .arg(script)
            .output()
            .map_err(|error| ApiError::internal(format!("目录选择器启动失败: {error}")))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(ApiError::internal(if stderr.is_empty() {
                "目录选择器执行失败".to_string()
            } else {
                stderr
            }));
        }
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok((!stdout.is_empty()).then_some(stdout))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = initial_path;
        Err(ApiError::bad_request("当前平台暂不支持目录选择器"))
    }
}

#[cfg(target_os = "windows")]
fn build_folder_picker_script(initial_path: &str) -> String {
    let escaped_path = powershell_escape(initial_path);
    format!(
        r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '选择要添加的项目目录'
$dialog.Filter = '文件夹|*.folder'
$dialog.CheckFileExists = $false
$dialog.CheckPathExists = $true
$dialog.ValidateNames = $false
$dialog.DereferenceLinks = $true
$dialog.Multiselect = $false
$dialog.FileName = '选择当前文件夹'
if ('{escaped_path}') {{
  $initialPath = '{escaped_path}'
  if ([System.IO.File]::Exists($initialPath)) {{
    $initialPath = [System.IO.Path]::GetDirectoryName($initialPath)
  }}
  if ([System.IO.Directory]::Exists($initialPath)) {{
    $dialog.InitialDirectory = $initialPath
  }}
}}
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = 'Manual'
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Location = New-Object System.Drawing.Point(-32000, -32000)
$owner.ShowInTaskbar = $false
$owner.Show()
$owner.Activate()
$result = $dialog.ShowDialog($owner)
$owner.Close()
if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.FileName) {{
  $selectedPath = $dialog.FileName
  if (-not [System.IO.Directory]::Exists($selectedPath)) {{
    $selectedPath = [System.IO.Path]::GetDirectoryName($selectedPath)
  }}
  if ($selectedPath) {{
    Write-Output $selectedPath
  }}
}}
"#
    )
}

fn open_path_with_system(path: &str) -> ApiResult<()> {
    #[cfg(target_os = "windows")]
    {
        let output = background_command("powershell.exe")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"])
            .arg(format!(
                "$ErrorActionPreference = 'Stop'; Start-Process -FilePath '{}'",
                powershell_escape(path)
            ))
            .output()
            .map_err(|error| ApiError::internal(format!("打开路径失败: {error}")))?;

        return output.status.success().then_some(()).ok_or_else(|| {
            let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
            ApiError::bad_request(if message.is_empty() {
                "打开路径失败".to_string()
            } else {
                message
            })
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        #[cfg(target_os = "macos")]
        let status = Command::new("open").arg(path).status();

        #[cfg(not(target_os = "macos"))]
        let status = Command::new("xdg-open").arg(path).status();

        status
            .map_err(|error| ApiError::internal(format!("打开路径失败: {error}")))?
            .success()
            .then_some(())
            .ok_or_else(|| ApiError::bad_request("打开路径失败"))
    }
}

fn reveal_path_in_explorer(path: &str) -> ApiResult<()> {
    #[cfg(target_os = "windows")]
    {
        let status = background_command("powershell.exe")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"])
            .arg(format!(
                "$ErrorActionPreference = 'Stop'; Start-Process -FilePath 'explorer.exe' -ArgumentList @('/select,', '{}')",
                powershell_escape(path)
            ))
            .status()
            .map_err(|error| ApiError::internal(format!("在资源管理器中打开失败: {error}")))?;
        return status
            .success()
            .then_some(())
            .ok_or_else(|| ApiError::bad_request("在资源管理器中打开失败"));
    }

    #[cfg(not(target_os = "windows"))]
    {
        open_path_with_system(path)
    }
}

fn powershell_escape(value: &str) -> String {
    value.replace('\'', "''")
}

fn read_project_path(state: &AppState, project_id: &str) -> ApiResult<String> {
    let connection = open_initialized_workspace_database(state)?;
    connection
        .query_row(
            "SELECT path FROM projects WHERE id = ?",
            params![project_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| ApiError::internal(format!("读取项目失败: {error}")))?
        .ok_or_else(|| ApiError::bad_request("项目不存在"))
}

fn project_git_summary_json(project_path: &str) -> Value {
    let git_info = read_git_info(project_path, true);
    json!({
        "isGitRepo": git_info.is_git_repo,
        "gitBranch": git_info.branch,
        "gitDiff": git_info.diff,
        "isGitWorktree": is_git_worktree(project_path),
    })
}

fn run_git_command(
    project_path: &str,
    args: &[impl AsRef<str>],
) -> ApiResult<(i32, String, String)> {
    let output = background_command("git")
        .args(args.iter().map(AsRef::as_ref))
        .current_dir(project_path)
        .output()
        .map_err(|error| ApiError::internal(format!("执行 Git 失败: {error}")))?;
    let status = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok((status, stdout, stderr))
}

fn run_git_command_checked(project_path: &str, args: &[impl AsRef<str>]) -> ApiResult<String> {
    let (status, stdout, stderr) = run_git_command(project_path, args)?;
    if status == 0 {
        return Ok(if stdout.trim().is_empty() {
            stderr
        } else {
            stdout
        });
    }
    Err(ApiError::bad_request(if stderr.trim().is_empty() {
        stdout
    } else {
        stderr
    }))
}

fn read_git_status_snapshot(project_path: &str) -> ApiResult<Value> {
    ensure_git_repo(project_path)?;
    let output = run_git_command_checked(project_path, &["status", "--porcelain=v1", "-b"])?;
    let mut branch = None;
    let mut upstream = None;
    let mut remote = None;
    let mut ahead = 0_i64;
    let mut behind = 0_i64;
    let mut files = Vec::new();
    for line in output.lines() {
        if let Some(header) = line.strip_prefix("## ") {
            let parsed = parse_git_status_header(header);
            branch = parsed.0;
            upstream = parsed.1;
            remote = parsed.2;
            ahead = parsed.3;
            behind = parsed.4;
            continue;
        }
        if line.len() >= 3 {
            files.push(parse_git_status_file(line));
        }
    }
    let mut status = json!({
        "branch": branch,
        "ahead": ahead,
        "behind": behind,
        "files": files,
    });
    if let Some(object) = status.as_object_mut() {
        if let Some(upstream) = upstream {
            object.insert("upstream".to_string(), json!(upstream));
        }
        if let Some(remote) = remote {
            object.insert("remote".to_string(), json!(remote));
        }
    }
    Ok(status)
}

fn ensure_git_repo(project_path: &str) -> ApiResult<()> {
    let (status, stdout, stderr) =
        run_git_command(project_path, &["rev-parse", "--is-inside-work-tree"])?;
    if status == 0 && stdout.trim() == "true" {
        Ok(())
    } else {
        Err(ApiError::bad_request(if stderr.trim().is_empty() {
            "不是 Git 仓库".to_string()
        } else {
            stderr
        }))
    }
}

fn parse_git_status_header(
    header: &str,
) -> (Option<String>, Option<String>, Option<String>, i64, i64) {
    let mut parts = header.split("...");
    let branch = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "HEAD")
        .map(ToString::to_string);
    let mut upstream = None;
    let mut remote = None;
    let mut ahead = 0_i64;
    let mut behind = 0_i64;
    if let Some(rest) = parts.next() {
        let (name, meta) = rest.split_once(' ').unwrap_or((rest, ""));
        let name = name.trim();
        if !name.is_empty() {
            upstream = Some(name.to_string());
            remote = name.split('/').next().map(ToString::to_string);
        }
        if let Some(meta) = meta
            .strip_prefix('[')
            .and_then(|value| value.strip_suffix(']'))
        {
            for part in meta.split(',') {
                let trimmed = part.trim();
                if let Some(value) = trimmed.strip_prefix("ahead ") {
                    ahead = value.parse().unwrap_or(0);
                }
                if let Some(value) = trimmed.strip_prefix("behind ") {
                    behind = value.parse().unwrap_or(0);
                }
            }
        }
    }
    (branch, upstream, remote, ahead, behind)
}

fn parse_git_status_file(line: &str) -> Value {
    let index_status = line.chars().next().unwrap_or(' ');
    let worktree_status = line.chars().nth(1).unwrap_or(' ');
    let raw_path = line.get(3..).unwrap_or_default();
    let (path, original_path) = raw_path
        .split_once(" -> ")
        .map(|(from, to)| (to.to_string(), Some(from.to_string())))
        .unwrap_or_else(|| (raw_path.to_string(), None));
    let conflicted = matches!(
        (index_status, worktree_status),
        ('A', 'A') | ('D', 'D') | ('U', _) | (_, 'U')
    );
    let untracked = index_status == '?' && worktree_status == '?';
    let mut file = json!({
        "path": path,
        "status": if conflicted { format!("{}{}", index_status, worktree_status) } else { git_status_label(index_status, worktree_status).to_string() },
        "indexStatus": index_status.to_string(),
        "worktreeStatus": worktree_status.to_string(),
        "conflicted": conflicted,
        "staged": !untracked && index_status != ' ',
        "unstaged": !untracked && worktree_status != ' ',
        "untracked": untracked,
        "deleted": index_status == 'D' || worktree_status == 'D',
    });
    if let Some(object) = file.as_object_mut() {
        if let Some(original_path) = original_path {
            object.insert("originalPath".to_string(), json!(original_path));
        }
        if conflicted {
            object.insert("conflictKind".to_string(), json!("unknown"));
        }
    }
    file
}

fn git_status_label(index_status: char, worktree_status: char) -> &'static str {
    if index_status == '?' && worktree_status == '?' {
        return "未跟踪";
    }
    if index_status == 'A' || worktree_status == 'A' {
        return "新增";
    }
    if index_status == 'D' || worktree_status == 'D' {
        return "删除";
    }
    if index_status == 'R' || worktree_status == 'R' {
        return "重命名";
    }
    if index_status == 'M' || worktree_status == 'M' {
        return "修改";
    }
    "变更"
}

fn read_git_branches(project_path: &str) -> ApiResult<Vec<Value>> {
    ensure_git_repo(project_path)?;
    let output = run_git_command_checked(
        project_path,
        &[
            "for-each-ref",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
            "--format=%(refname)\t%(refname:short)\t%(upstream:short)\t%(HEAD)",
        ],
    )?;
    Ok(output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let full = parts.next()?;
            let name = parts.next()?.to_string();
            let upstream = parts
                .next()
                .filter(|value| !value.is_empty())
                .map(ToString::to_string);
            let current = parts.next().unwrap_or_default().trim() == "*";
            let kind = if full.starts_with("refs/remotes/") {
                "remote"
            } else if full.starts_with("refs/tags/") {
                "tag"
            } else {
                "local"
            };
            let remote_name = (kind == "remote")
                .then(|| name.split('/').next().unwrap_or_default().to_string())
                .filter(|value| !value.is_empty());
            let local_name = if kind == "remote" && name.contains('/') {
                Some(name.split('/').skip(1).collect::<Vec<_>>().join("/"))
            } else {
                Some(name.clone())
            };
            Some(json!({
                "name": name,
                "current": current,
                "kind": kind,
                "isRemote": kind == "remote",
                "remoteName": remote_name,
                "localName": local_name,
                "upstream": upstream,
            }))
        })
        .collect())
}

fn read_git_remotes(project_path: &str) -> ApiResult<Vec<String>> {
    ensure_git_repo(project_path)?;
    let output = run_git_command_checked(project_path, &["remote"])?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect())
}

fn read_git_head(project_path: &str) -> ApiResult<String> {
    run_git_command_checked(project_path, &["rev-parse", "HEAD"])
        .map(|value| value.trim().to_string())
}

fn count_git_commits_between(
    project_path: &str,
    before_head: &str,
    after_head: &str,
) -> ApiResult<i64> {
    if before_head.trim().is_empty() || after_head.trim().is_empty() || before_head == after_head {
        return Ok(0);
    }
    let output = run_git_command_checked(
        project_path,
        &[
            "rev-list",
            "--count",
            &format!("{before_head}..{after_head}"),
        ],
    )?;
    Ok(output.trim().parse::<i64>().unwrap_or(0))
}

fn count_git_files_between(
    project_path: &str,
    before_head: &str,
    after_head: &str,
) -> ApiResult<i64> {
    if before_head.trim().is_empty() || after_head.trim().is_empty() || before_head == after_head {
        return Ok(0);
    }
    let output = run_git_command_checked(
        project_path,
        &["diff", "--name-only", before_head, after_head],
    )?;
    Ok(output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count() as i64)
}

fn build_git_clone_raw_log(stderr: &str, stdout: &str) -> String {
    [stderr.trim(), stdout.trim()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn format_git_clone_error(stderr: &str, stdout: &str) -> String {
    let lines = format!("{stderr}\n{stdout}")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !line.to_ascii_lowercase().starts_with("cloning into"))
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if let Some(fatal_line) = lines
        .iter()
        .rev()
        .find(|line| line.to_ascii_lowercase().starts_with("fatal:"))
    {
        return fatal_line
            .get("fatal:".len()..)
            .unwrap_or(fatal_line)
            .trim()
            .to_string();
    }
    if let Some(remote_line) = lines
        .iter()
        .rev()
        .find(|line| line.to_ascii_lowercase().starts_with("remote:"))
    {
        return remote_line
            .get("remote:".len()..)
            .unwrap_or(remote_line)
            .trim()
            .to_string();
    }
    lines
        .last()
        .cloned()
        .unwrap_or_else(|| "git clone 执行失败".to_string())
}

fn read_git_history(
    project_path: &str,
    reference: Option<&str>,
    limit: usize,
) -> ApiResult<Vec<Value>> {
    let reference = reference
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("HEAD");
    read_git_history_range(project_path, reference, limit)
}

fn read_git_history_range(project_path: &str, range: &str, limit: usize) -> ApiResult<Vec<Value>> {
    ensure_git_repo(project_path)?;
    let format = "%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%ct%x1f%P%x1f%D";
    let output = run_git_command_checked(
        project_path,
        &[
            "log",
            range,
            &format!("--max-count={}", limit.clamp(1, 200)),
            &format!("--format={format}"),
        ],
    )?;
    Ok(output.lines().filter_map(parse_git_history_line).collect())
}

fn parse_git_history_line(line: &str) -> Option<Value> {
    let parts: Vec<&str> = line.split('\x1f').collect();
    if parts.len() < 8 {
        return None;
    }
    let commit_time = parts[5].parse::<i64>().unwrap_or(0);
    let parents: Vec<&str> = parts[6].split_whitespace().collect();
    let refs: Vec<&str> = parts[7]
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect();
    Some(json!({
        "sha": parts[0],
        "shortSha": parts[1],
        "summary": parts[2],
        "message": parts[2],
        "author": parts[3],
        "authorEmail": parts[4],
        "commitTime": commit_time,
        "parents": parents,
        "refs": refs,
        "graphText": "",
        "graph": {
            "lane": 0,
            "colorIndex": 0,
            "segmentsBefore": [
                {
                    "lane": 0,
                    "colorIndex": 0,
                    "kind": "vertical",
                },
            ],
            "segmentsAfter": if parents.is_empty() {
                json!([
                    {
                        "lane": 0,
                        "fromLane": 0,
                        "colorIndex": 0,
                        "kind": "end",
                    },
                ])
            } else {
                json!([
                    {
                        "lane": 0,
                        "fromLane": 0,
                        "colorIndex": 0,
                        "kind": "vertical",
                    },
                ])
            },
        },
    }))
}

fn compact_git_history_commit(commit: Value) -> Value {
    json!({
        "sha": commit.get("sha").cloned().unwrap_or(Value::Null),
        "shortSha": commit.get("shortSha").cloned().unwrap_or(Value::Null),
        "author": commit.get("author").cloned().unwrap_or(Value::Null),
        "commitTime": commit.get("commitTime").cloned().unwrap_or(Value::Null),
        "summary": commit.get("summary").cloned().unwrap_or(Value::Null),
    })
}

fn read_git_commit_details(project_path: &str, sha: &str) -> ApiResult<Value> {
    let base = read_git_history_range(project_path, sha, 1)?
        .into_iter()
        .next()
        .ok_or_else(|| ApiError::bad_request("提交不存在"))?;
    let message = run_git_command_checked(project_path, &["show", "-s", "--format=%B", sha])?;
    let stat = run_git_command_checked(project_path, &["show", "--numstat", "--format=", sha])?;
    let mut files = Vec::new();
    let mut total_additions = 0_i64;
    let mut total_deletions = 0_i64;
    for line in stat.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let additions = parts[0].parse::<i64>().unwrap_or(0);
        let deletions = parts[1].parse::<i64>().unwrap_or(0);
        total_additions += additions;
        total_deletions += deletions;
        files.push(json!({
            "path": parts[2],
            "status": "M",
            "additions": additions,
            "deletions": deletions,
            "binary": parts[0] == "-" || parts[1] == "-",
        }));
    }
    let mut result = base;
    result["message"] = json!(message.trim());
    Ok(json!({
        "sha": result.get("sha").cloned().unwrap_or(Value::Null),
        "shortSha": result.get("shortSha").cloned().unwrap_or(Value::Null),
        "author": result.get("author").cloned().unwrap_or(Value::Null),
        "commitTime": result.get("commitTime").cloned().unwrap_or(Value::Null),
        "summary": result.get("summary").cloned().unwrap_or(Value::Null),
        "message": result.get("message").cloned().unwrap_or(Value::Null),
        "refs": result.get("refs").cloned().unwrap_or_else(|| json!([])),
        "files": Value::Array(files),
        "totalAdditions": total_additions,
        "totalDeletions": total_deletions,
    }))
}

fn read_git_commit_file(project_path: &str, sha: &str, file_path: &str) -> ApiResult<Value> {
    let after = run_git_command(project_path, &["show", &format!("{sha}:{file_path}")])?.1;
    let before = run_git_command(project_path, &["show", &format!("{sha}^:{file_path}")])
        .map(|(_, stdout, _)| stdout)
        .unwrap_or_default();
    Ok(json!({
        "sha": sha,
        "path": file_path,
        "status": "M",
        "additions": 0,
        "deletions": 0,
        "binary": false,
        "content": after,
        "beforeContent": before,
        "afterContent": after,
    }))
}

fn read_git_file_diff(project_path: &str, file_path: &str) -> ApiResult<Value> {
    ensure_git_repo(project_path)?;
    let safe_path = normalize_project_relative_git_path(file_path)?;
    let status = read_git_status_snapshot(project_path)?;
    let file_status = status
        .get("files")
        .and_then(Value::as_array)
        .and_then(|files| {
            files
                .iter()
                .find(|file| file.get("path").and_then(Value::as_str) == Some(safe_path.as_str()))
        });
    if file_status
        .and_then(|file| file.get("untracked"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        let content = fs::read_to_string(resolve_project_relative_file_path(
            project_path,
            &safe_path,
        )?)
        .unwrap_or_default();
        return Ok(json!({
            "path": safe_path,
            "content": format!("未跟踪文件：{safe_path}\n\n{content}"),
            "beforeContent": "",
            "afterContent": content,
        }));
    }
    let staged_diff =
        run_git_command_checked(project_path, &["diff", "--cached", "--", &safe_path])?;
    let worktree_diff = run_git_command_checked(project_path, &["diff", "--", &safe_path])?;
    let diff = [staged_diff.trim_end(), worktree_diff.trim_end()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    let before = run_git_command(project_path, &["show", &format!("HEAD:{safe_path}")])
        .map(|(_, stdout, _)| stdout)
        .unwrap_or_default();
    let deleted = file_status
        .and_then(|file| file.get("deleted"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let after = if deleted {
        String::new()
    } else {
        fs::read_to_string(resolve_project_relative_file_path(
            project_path,
            &safe_path,
        )?)
        .unwrap_or_default()
    };
    Ok(json!({
        "path": safe_path,
        "content": if diff.is_empty() { "当前文件没有可显示的差异。".to_string() } else { diff },
        "beforeContent": before,
        "afterContent": after,
    }))
}

fn normalize_project_relative_git_path(file_path: &str) -> ApiResult<String> {
    let normalized = file_path.trim().replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized == ".."
        || normalized.starts_with("../")
        || normalized.contains("/../")
        || normalized.ends_with("/..")
    {
        return Err(ApiError::bad_request("文件路径不能越过项目目录"));
    }
    Ok(normalized)
}

fn read_git_operation_state_value(project_path: &str) -> ApiResult<Value> {
    let status = read_git_status_snapshot(project_path)?;
    let files = status.get("files").cloned().unwrap_or_else(|| json!([]));
    let conflicts = files
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|item| {
            item.get("conflicted")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .map(|item| {
            let path = item.get("path").and_then(Value::as_str).unwrap_or("");
            let status = item.get("status").and_then(Value::as_str).unwrap_or("");
            json!({
                "path": path,
                "originalPath": item.get("originalPath").cloned().unwrap_or(Value::Null),
                "status": status,
                "conflictKind": classify_git_conflict_kind(status),
                "label": git_conflict_label(status),
            })
        })
        .collect::<Vec<_>>();
    let operation = detect_git_operation(project_path)?;
    let has_conflicts = !conflicts.is_empty();
    let dirty = files.as_array().is_some_and(|items| !items.is_empty());
    let status_text = if has_conflicts {
        "conflicted"
    } else if operation != "none" {
        "in_progress"
    } else if dirty {
        "dirty"
    } else {
        "clean"
    };
    let mut state = json!({
        "status": status_text,
        "operation": operation,
        "branch": status.get("branch"),
        "ahead": status.get("ahead").cloned().unwrap_or_else(|| json!(0)),
        "behind": status.get("behind").cloned().unwrap_or_else(|| json!(0)),
        "hasConflicts": has_conflicts,
        "canContinue": operation != "none" && !has_conflicts,
        "canAbort": operation != "none",
        "conflicts": conflicts,
        "files": files,
        "message": if has_conflicts {
            "存在冲突文件"
        } else if operation != "none" {
            "Git 操作进行中"
        } else if dirty {
            "工作区有未提交改动"
        } else {
            "工作区干净"
        },
    });
    if let Some(object) = state.as_object_mut() {
        if let Some(upstream) = status.get("upstream") {
            object.insert("upstream".to_string(), upstream.clone());
        }
        if let Some(remote) = status.get("remote") {
            object.insert("remote".to_string(), remote.clone());
        }
    }
    Ok(state)
}

fn read_git_conflict_file_detail(project_path: &str, file_path: &str) -> ApiResult<Value> {
    ensure_git_repo(project_path)?;
    let status = read_git_status_snapshot(project_path)?;
    let file = status
        .get("files")
        .and_then(Value::as_array)
        .and_then(|items| {
            items.iter().find(|item| {
                item.get("path").and_then(Value::as_str) == Some(file_path)
                    && item
                        .get("conflicted")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
            })
        })
        .cloned()
        .unwrap_or_else(|| {
            json!({
                "path": file_path,
                "status": "UU",
                "originalPath": null,
            })
        });
    let status_text = file.get("status").and_then(Value::as_str).unwrap_or("UU");
    let base_content = git_show_stage(project_path, "1", file_path).unwrap_or_default();
    let current_content = git_show_stage(project_path, "2", file_path).unwrap_or_default();
    let incoming_content = git_show_stage(project_path, "3", file_path).unwrap_or_default();
    let result_content =
        fs::read_to_string(resolve_project_relative_file_path(project_path, file_path)?)
            .unwrap_or_default();
    Ok(json!({
        "path": file_path,
        "status": status_text,
        "conflictKind": classify_git_conflict_kind(status_text),
        "label": git_conflict_label(status_text),
        "baseContent": base_content,
        "currentContent": current_content,
        "incomingContent": incoming_content,
        "resultContent": result_content,
        "isText": true,
        "binary": false,
    }))
}

fn git_show_stage(project_path: &str, stage: &str, file_path: &str) -> ApiResult<String> {
    let spec = format!(":{stage}:{file_path}");
    let (status, stdout, stderr) = run_git_command(project_path, &["show", &spec])?;
    if status == 0 {
        Ok(stdout)
    } else {
        Err(ApiError::bad_request(stderr))
    }
}

fn detect_git_operation(project_path: &str) -> ApiResult<String> {
    let git_path = |name: &str| -> ApiResult<PathBuf> {
        let output = run_git_command_checked(project_path, &["rev-parse", "--git-path", name])?;
        Ok(PathBuf::from(project_path).join(output.trim()))
    };
    if git_path("rebase-merge")?.exists() || git_path("rebase-apply")?.exists() {
        return Ok("rebase".to_string());
    }
    if git_path("CHERRY_PICK_HEAD")?.exists() {
        return Ok("cherry-pick".to_string());
    }
    if git_path("REVERT_HEAD")?.exists() {
        return Ok("revert".to_string());
    }
    if git_path("MERGE_HEAD")?.exists() {
        return Ok("merge".to_string());
    }
    Ok("none".to_string())
}

fn classify_git_conflict_kind(status: &str) -> &'static str {
    match status {
        "UU" => "both_modified",
        "AA" => "both_added",
        "DD" => "both_deleted",
        "DU" => "deleted_by_us",
        "UD" => "deleted_by_them",
        "AU" => "added_by_us",
        "UA" => "added_by_them",
        _ => "unknown",
    }
}

fn git_conflict_label(status: &str) -> &'static str {
    match classify_git_conflict_kind(status) {
        "both_modified" => "双方都修改",
        "both_added" => "双方都新增",
        "both_deleted" => "双方都删除",
        "deleted_by_us" => "本地删除，对方修改",
        "deleted_by_them" => "本地修改，对方删除",
        "added_by_us" => "本地新增，对方修改",
        "added_by_them" => "本地修改，对方新增",
        _ => "未知冲突",
    }
}

fn resolve_project_relative_file_path(project_path: &str, relative: &str) -> ApiResult<PathBuf> {
    let root = fs::canonicalize(project_path)
        .map_err(|error| ApiError::bad_request(format!("项目路径无效: {error}")))?;
    let relative = relative.replace('\\', "/");
    if relative.starts_with('/')
        || relative == ".."
        || relative.starts_with("../")
        || relative.contains("/../")
        || relative.ends_with("/..")
    {
        return Err(ApiError::bad_request("文件路径不能越过项目目录"));
    }
    Ok(root.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR)))
}

fn read_git_worktrees_value(project_path: &str) -> ApiResult<Value> {
    ensure_git_repo(project_path)?;
    let current_root = run_git_command_checked(project_path, &["rev-parse", "--show-toplevel"])
        .ok()
        .map(|value| value.trim().to_string());
    let output = run_git_command_checked(project_path, &["worktree", "list", "--porcelain"])?;
    let mut worktrees = Vec::new();
    let mut current = Map::new();
    for line in output.lines() {
        if line.trim().is_empty() {
            if !current.is_empty() {
                worktrees.push(git_worktree_record_to_value(project_path, &current));
                current = Map::new();
            }
            continue;
        }
        if let Some((key, value)) = line.split_once(' ') {
            current.insert(key.to_string(), json!(value));
        } else {
            current.insert(line.to_string(), json!(true));
        }
    }
    if !current.is_empty() {
        worktrees.push(git_worktree_record_to_value(project_path, &current));
    }
    Ok(json!({
        "isRepo": true,
        "currentRoot": current_root,
        "worktrees": worktrees,
    }))
}

fn git_worktree_record_to_value(current_project_path: &str, record: &Map<String, Value>) -> Value {
    let path = record
        .get("worktree")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let branch_ref = record.get("branch").and_then(Value::as_str);
    let branch = branch_ref
        .and_then(|value| value.strip_prefix("refs/heads/").or(Some(value)))
        .map(ToString::to_string);
    let exists = Path::new(path).exists();
    let (changed_files, status_error) = if exists {
        match run_git_command(path, &["status", "--porcelain=v1"]) {
            Ok((0, stdout, _)) => (
                Some(
                    stdout
                        .lines()
                        .filter(|line| !line.trim().is_empty())
                        .count(),
                ),
                None,
            ),
            Ok((_, stdout, stderr)) => (
                None,
                Some(if stderr.trim().is_empty() {
                    stdout
                } else {
                    stderr
                }),
            ),
            Err(error) => (None, Some(error.message)),
        }
    } else {
        (None, None)
    };
    let current = fs::canonicalize(path).ok() == fs::canonicalize(current_project_path).ok();
    json!({
        "path": path,
        "head": record.get("HEAD").and_then(Value::as_str),
        "branch": branch,
        "detached": branch_ref.is_none(),
        "bare": record.get("bare").and_then(Value::as_bool).unwrap_or(false),
        "locked": record.get("locked").and_then(Value::as_str),
        "prunable": record.get("prunable").and_then(Value::as_str),
        "main": worktree_is_main(record),
        "current": current,
        "exists": exists,
        "changedFiles": changed_files,
        "statusError": status_error,
    })
}

fn worktree_is_main(record: &Map<String, Value>) -> bool {
    record
        .get("branch")
        .and_then(Value::as_str)
        .is_some_and(|branch| branch.ends_with("/main") || branch.ends_with("/master"))
}

fn find_project_id_by_path(
    connection: &Connection,
    project_path: &str,
) -> ApiResult<Option<String>> {
    connection
        .query_row(
            "SELECT id FROM projects WHERE path = ?",
            params![project_path],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| ApiError::internal(format!("读取项目失败: {error}")))
}

fn unique_json_strings(items: &[Value], key: &str) -> Vec<String> {
    let mut values = Vec::new();
    for item in items {
        if let Some(value) = item.get(key).and_then(Value::as_str) {
            if !values.iter().any(|existing| existing == value) {
                values.push(value.to_string());
            }
        }
    }
    values
}

fn read_string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn required_json_string<'a>(payload: &'a Value, key: &str, message: &str) -> ApiResult<&'a str> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request(message))
}

fn settings_provider_id(value: Option<&str>) -> ApiResult<&str> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        None | Some(CLAUDE_CODE_PROVIDER_ID) => Ok(CLAUDE_CODE_PROVIDER_ID),
        Some(GROK_BUILD_PROVIDER_ID) => Ok(GROK_BUILD_PROVIDER_ID),
        Some(OPENAI_CODEX_PROVIDER_ID) => Ok(OPENAI_CODEX_PROVIDER_ID),
        Some(OPENCODE_PROVIDER_ID) => Ok(OPENCODE_PROVIDER_ID),
        Some(_) => Err(ApiError::bad_request("不支持的 Agent Provider")),
    }
}

fn agent_config_directory_name(provider_id: &str) -> &'static str {
    match provider_id {
        GROK_BUILD_PROVIDER_ID => ".grok",
        OPENAI_CODEX_PROVIDER_ID => ".codex",
        OPENCODE_PROVIDER_ID => ".opencode",
        _ => ".claude",
    }
}

fn agent_global_config_directory(provider_id: &str, home: &Path) -> PathBuf {
    if provider_id == OPENCODE_PROVIDER_ID {
        home.join(".config").join("opencode")
    } else {
        home.join(agent_config_directory_name(provider_id))
    }
}

fn resolve_agent_rules_path(
    provider_id: &str,
    scope: &str,
    project_path: Option<&str>,
) -> ApiResult<PathBuf> {
    if scope == "project" {
        let project_path = project_path
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| ApiError::bad_request("项目级规则需要 projectPath"))?;
        return Ok(
            PathBuf::from(project_path).join(if provider_id == CLAUDE_CODE_PROVIDER_ID {
                "CLAUDE.md"
            } else {
                "AGENTS.md"
            }),
        );
    }
    if scope != "global" {
        return Err(ApiError::bad_request("规则 scope 仅支持 global 或 project"));
    }
    let home = home_dir().ok_or_else(|| ApiError::internal("无法定位用户目录"))?;
    Ok(match provider_id {
        GROK_BUILD_PROVIDER_ID => home.join(".grok").join("AGENTS.md"),
        OPENAI_CODEX_PROVIDER_ID => home.join(".codex").join("AGENTS.md"),
        OPENCODE_PROVIDER_ID => home.join(".config").join("opencode").join("AGENTS.md"),
        _ => home.join(".claude").join("CLAUDE.md"),
    })
}

fn read_agent_global_prompt(provider_id: &str, scope: &str, path: &Path) -> Value {
    match fs::metadata(&path).and_then(|metadata| {
        let content = fs::read_to_string(&path)?;
        Ok((metadata, content))
    }) {
        Ok((metadata, content)) => {
            let mut result = Map::new();
            result.insert("providerId".to_string(), json!(provider_id));
            result.insert("scope".to_string(), json!(scope));
            result.insert("path".to_string(), json!(path.display().to_string()));
            result.insert("content".to_string(), json!(content));
            result.insert("exists".to_string(), json!(true));
            if let Ok(modified) = metadata.modified() {
                let updated_at: chrono::DateTime<chrono::Utc> = modified.into();
                result.insert(
                    "updatedAt".to_string(),
                    json!(updated_at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
                );
            }
            let length = result
                .get("content")
                .and_then(Value::as_str)
                .map(|value| value.chars().count())
                .unwrap_or(0);
            result.insert("length".to_string(), json!(length));
            Value::Object(result)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({
            "providerId": provider_id,
            "scope": scope,
            "path": path.display().to_string(),
            "content": "",
            "exists": false,
            "length": 0,
        }),
        Err(_) => json!({
            "providerId": provider_id,
            "scope": scope,
            "path": path.display().to_string(),
            "content": "",
            "exists": false,
            "length": 0,
        }),
    }
}

fn write_agent_rules(path: &Path, content: &str) -> ApiResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| ApiError::internal(format!("创建 Agent 配置目录失败: {error}")))?;
    }
    write_text_file_atomically(path, content)
        .map_err(|error| ApiError::internal(format!("保存 Agent 规则失败: {error}")))
}

fn discover_open_targets() -> Vec<Value> {
    let mut targets = Vec::new();
    for (id, label, kind, command) in [
        ("vscode", "VS Code", "app", "code"),
        ("visualstudio", "Visual Studio", "app", "devenv"),
        ("cursor", "Cursor", "app", "cursor"),
        ("antigravity", "Antigravity", "app", "antigravity"),
        ("git-bash", "Git Bash", "git-bash", "git-bash.exe"),
        ("wsl", "WSL", "wsl", "wsl.exe"),
        ("idea", "IntelliJ IDEA", "app", "idea64.exe"),
        ("rider", "Rider", "app", "rider64.exe"),
        ("pycharm", "PyCharm", "app", "pycharm64.exe"),
        ("webstorm", "WebStorm", "app", "webstorm64.exe"),
    ] {
        if command_exists(command) {
            targets.push(json!({
                "id": id,
                "label": label,
                "kind": kind,
                "command": command,
                "args": [],
            }));
        }
    }
    targets.push(json!({
        "id": "explorer",
        "label": "File Explorer",
        "kind": "explorer",
        "command": "explorer.exe",
        "args": [],
    }));
    targets.push(json!({
        "id": "terminal",
        "label": "Terminal",
        "kind": "terminal",
        "command": "cmd.exe",
        "args": [],
    }));
    targets
}

fn command_exists(command: &str) -> bool {
    #[cfg(target_os = "windows")]
    let output = background_command("where.exe").arg(command).output();

    #[cfg(not(target_os = "windows"))]
    let output = background_command("which").arg(command).output();

    output.is_ok_and(|output| output.status.success())
}

fn open_project_with_target(project_path: &str, target_id: &str) -> ApiResult<()> {
    match target_id {
        "explorer" => open_path_with_system(project_path),
        "terminal" => open_terminal_at_path(project_path),
        "cursor" if command_exists("cursor") => spawn_detached("cursor", &[project_path]),
        "vscode" if command_exists("code") => spawn_detached("code", &[project_path]),
        _ if command_exists("code") => spawn_detached("code", &[project_path]),
        _ => open_path_with_system(project_path),
    }
}

fn open_terminal_at_path(project_path: &str) -> ApiResult<()> {
    #[cfg(target_os = "windows")]
    {
        spawn_detached(
            "powershell.exe",
            &[
                "-NoExit",
                "-Command",
                &format!(
                    "Set-Location -LiteralPath '{}'",
                    powershell_escape(project_path)
                ),
            ],
        )
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = project_path;
        open_path_with_system(project_path)
    }
}

fn spawn_detached(command: &str, args: &[&str]) -> ApiResult<()> {
    Command::new(command)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|error| ApiError::bad_request(format!("打开工具启动失败: {error}")))
}

async fn mcp_servers(
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let provider_id = settings_provider_id(query.get("providerId").map(String::as_str))?;
    Ok(Json(list_agent_mcp_servers_value(
        provider_id,
        query.get("projectPath").map(String::as_str),
    )?))
}

async fn mcp_configs(
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let provider_id = settings_provider_id(query.get("providerId").map(String::as_str))?;
    let project_path = query.get("projectPath").map(String::as_str);
    let snapshot = read_agent_mcp_config_snapshot(provider_id, project_path)?;
    Ok(Json(json!({
        "providerId": provider_id,
        "paths": snapshot.get("paths").cloned().unwrap_or_else(|| json!({})),
        "configs": snapshot.get("configs").cloned().unwrap_or_else(|| json!({})),
        "hasProject": project_path.is_some_and(|value| !value.trim().is_empty()),
        "supportsClaudeJson": provider_id == CLAUDE_CODE_PROVIDER_ID,
        "overview": list_agent_mcp_servers_value(provider_id, project_path)?,
    })))
}

async fn update_mcp_config(
    AxumPath(scope): AxumPath<String>,
    Query(query): Query<std::collections::HashMap<String, String>>,
    Json(payload): Json<Value>,
) -> ApiResult<Json<Value>> {
    let provider_id = settings_provider_id(query.get("providerId").map(String::as_str))?;
    let project_path = query.get("projectPath").map(String::as_str);
    let config = normalize_mcp_config(&payload);
    if provider_id != CLAUDE_CODE_PROVIDER_ID {
        if !matches!(scope.as_str(), "global" | "project") {
            return Err(ApiError::bad_request("当前 Agent 不支持该 MCP 配置作用域"));
        }
        let path = resolve_agent_mcp_config_path(provider_id, &scope, project_path)?;
        if provider_id == OPENCODE_PROVIDER_ID {
            write_opencode_mcp_config(&path, &config)?;
        } else {
            write_toml_mcp_config(&path, &config)?;
        }
        return Ok(Json(config));
    }
    match scope.as_str() {
        "global" | "project" => {
            let path = resolve_mcp_config_path(&scope, project_path)?;
            write_json_file_pretty(&path, &config)?;
            Ok(Json(config))
        }
        "claude-json-global" => {
            write_claude_json_mcp_config("global", project_path, &config)?;
            Ok(Json(config))
        }
        "claude-json-project" => {
            write_claude_json_mcp_config("project", project_path, &config)?;
            Ok(Json(config))
        }
        _ => Err(ApiError::bad_request("不支持的 MCP 配置作用域")),
    }
}

async fn open_mcp_config(Json(payload): Json<Value>) -> ApiResult<Json<Value>> {
    let provider_id = settings_provider_id(payload.get("providerId").and_then(Value::as_str))?;
    let scope = required_json_string(&payload, "scope", "scope 不能为空")?;
    if !matches!(
        scope,
        "global" | "project" | "claude-json-global" | "claude-json-project"
    ) {
        return Err(ApiError::bad_request_json("不支持的 MCP 配置作用域"));
    }
    let project_path = payload.get("projectPath").and_then(Value::as_str);
    let target = if provider_id == CLAUDE_CODE_PROVIDER_ID {
        ensure_mcp_config_file(scope, project_path)?
    } else {
        if !matches!(scope, "global" | "project") {
            return Err(ApiError::bad_request_json(
                "当前 Agent 不支持该 MCP 配置作用域",
            ));
        }
        let path = resolve_agent_mcp_config_path(provider_id, scope, project_path)?;
        if provider_id == OPENCODE_PROVIDER_ID {
            ensure_opencode_config_file(&path)?;
        } else {
            ensure_toml_config_file(&path)?;
        }
        path
    };
    open_path_with_system(
        target
            .to_str()
            .ok_or_else(|| ApiError::bad_request("MCP 配置路径无效"))?,
    )?;
    Ok(Json(json!({ "ok": true, "path": target })))
}

async fn skills_overview(
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let provider_id = settings_provider_id(query.get("providerId").map(String::as_str))?;
    Ok(Json(json!({
        "skills": list_agent_skills_value(
            provider_id,
            query.get("projectPath").map(String::as_str),
        ),
        "errors": [],
    })))
}

async fn installed_plugins(
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let provider_id = settings_provider_id(query.get("providerId").map(String::as_str))?;
    Ok(Json(list_agent_installed_plugins_value(provider_id)?))
}

async fn plugin_marketplaces(
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let provider_id = settings_provider_id(query.get("providerId").map(String::as_str))?;
    Ok(Json(list_agent_plugin_marketplaces_value(provider_id)?))
}

async fn plugin_skills(
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let provider_id = settings_provider_id(query.get("providerId").map(String::as_str))?;
    Ok(Json(list_agent_skills_value(
        provider_id,
        query.get("projectPath").map(String::as_str),
    )))
}

async fn plugin_install_skill_from_path(Json(payload): Json<Value>) -> ApiResult<Json<Value>> {
    let provider_id = settings_provider_id(payload.get("providerId").and_then(Value::as_str))?;
    let source = required_json_string(&payload, "path", "Skill 来源目录不能为空")?;
    let source_path =
        fs::canonicalize(source).map_err(|_| ApiError::bad_request("Skill 来源目录不存在"))?;
    if !source_path.is_dir() {
        return Err(ApiError::bad_request("Skill 来源目录不存在"));
    }

    let scope = payload
        .get("scope")
        .and_then(Value::as_str)
        .unwrap_or("user");
    let target_root = if scope == "project" {
        let cwd = payload
            .get("cwd")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| ApiError::bad_request("project scope 需要 cwd"))?;
        if provider_id == OPENCODE_PROVIDER_ID {
            PathBuf::from(cwd).join(".opencode").join("skills")
        } else {
            PathBuf::from(cwd)
                .join(agent_config_directory_name(provider_id))
                .join("skills")
        }
    } else {
        let home = home_dir().ok_or_else(|| ApiError::internal("无法定位用户目录"))?;
        if provider_id == OPENCODE_PROVIDER_ID {
            home.join(".config").join("opencode").join("skills")
        } else {
            home.join(agent_config_directory_name(provider_id))
                .join("skills")
        }
    };
    let overwrite = payload
        .get("overwrite")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut installed = Vec::new();
    fs::create_dir_all(&target_root)
        .map_err(|error| ApiError::internal(format!("创建 Skill 目录失败: {error}")))?;

    for directory in collect_skill_source_directories(&source_path) {
        let skill_file = directory.join("SKILL.md");
        let parsed = parse_skill_markdown(&skill_file)?;
        let name = sanitize_skill_directory_name(
            parsed
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_else(|| {
                    directory
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("skill")
                }),
        )?;
        let target = target_root.join(&name);
        if target.exists() {
            if !overwrite {
                return Err(ApiError::bad_request(format!("Skill 已存在：{name}")));
            }
        }
        install_skill_directory_safely(&directory, &target)?;
        installed.push(json!({ "name": name, "path": target }));
    }
    Ok(Json(json!({ "installed": installed })))
}

fn install_skill_directory_safely(source: &Path, target: &Path) -> ApiResult<()> {
    let parent = target
        .parent()
        .ok_or_else(|| ApiError::internal("Skill 目标目录无效"))?;
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("skill");
    let nonce = uuid::Uuid::new_v4();
    let staging = parent.join(format!(".{name}.{nonce}.staging"));
    let backup = parent.join(format!(".{name}.{nonce}.backup"));
    copy_directory_recursive(source, &staging).inspect_err(|_| {
        let _ = fs::remove_dir_all(&staging);
    })?;

    let had_target = target.exists();
    if had_target {
        fs::rename(target, &backup).map_err(|error| {
            let _ = fs::remove_dir_all(&staging);
            ApiError::internal(format!("备份旧 Skill 失败: {error}"))
        })?;
    }
    if let Err(error) = fs::rename(&staging, target) {
        let _ = fs::remove_dir_all(&staging);
        if had_target {
            let _ = fs::rename(&backup, target);
        }
        return Err(ApiError::internal(format!("安装 Skill 失败: {error}")));
    }
    if had_target {
        fs::remove_dir_all(&backup)
            .map_err(|error| ApiError::internal(format!("清理旧 Skill 备份失败: {error}")))?;
    }
    Ok(())
}

async fn plugin_install_builtin_skill(Json(payload): Json<Value>) -> ApiResult<Json<Value>> {
    let provider_id = settings_provider_id(payload.get("providerId").and_then(Value::as_str))?;
    if provider_id != CLAUDE_CODE_PROVIDER_ID {
        return Err(ApiError::bad_request(
            "该内置 Skill 安装器目前只支持 Claude Code",
        ));
    }
    let builtin_id = required_json_string(&payload, "id", "内置 Skill id 不能为空")?;
    if builtin_id != "playwright-cli" {
        return Err(ApiError::internal_json("安装内置 Skill 失败"));
    }
    let cwd = payload
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(home_dir)
        .ok_or_else(|| ApiError::internal("无法定位安装目录"))?;
    let command = if cfg!(target_os = "windows") {
        "npx.cmd"
    } else {
        "npx"
    };
    let args = [
        "--yes",
        "--package",
        "@playwright/cli@latest",
        "playwright-cli",
        "install",
        "--skills",
    ];
    Ok(Json(run_external_command_value(
        command,
        &args,
        Some(&cwd),
    )?))
}

async fn plugin_delete_skill(Json(payload): Json<Value>) -> ApiResult<Json<Value>> {
    let provider_id = settings_provider_id(payload.get("providerId").and_then(Value::as_str))?;
    let path = required_json_string(&payload, "path", "Skill 路径不能为空")?;
    let target = validate_managed_agent_skill_path(
        provider_id,
        path,
        payload.get("projectPath").and_then(Value::as_str),
    )?;
    fs::remove_dir_all(&target)
        .map_err(|error| ApiError::internal(format!("删除 Skill 失败: {error}")))?;
    Ok(Json(json!({ "deleted": true, "path": target })))
}

async fn plugin_open_skill(Json(payload): Json<Value>) -> ApiResult<Json<Value>> {
    let provider_id = settings_provider_id(payload.get("providerId").and_then(Value::as_str))?;
    let path = required_json_string(&payload, "path", "Skill 路径不能为空")?;
    let target = validate_agent_skill_path_for_open(
        provider_id,
        path,
        payload.get("projectPath").and_then(Value::as_str),
    )?;
    open_path_with_system(&target.to_string_lossy())?;
    Ok(Json(json!({ "opened": true, "path": target })))
}

fn validate_managed_agent_skill_path(
    provider_id: &str,
    path: &str,
    project_path: Option<&str>,
) -> ApiResult<PathBuf> {
    validate_agent_skill_path(provider_id, path, project_path, false)
}

fn validate_agent_skill_path_for_open(
    provider_id: &str,
    path: &str,
    project_path: Option<&str>,
) -> ApiResult<PathBuf> {
    validate_agent_skill_path(provider_id, path, project_path, true)
}

fn validate_agent_skill_path(
    provider_id: &str,
    path: &str,
    project_path: Option<&str>,
    include_read_only_roots: bool,
) -> ApiResult<PathBuf> {
    let target = fs::canonicalize(path).map_err(|_| ApiError::bad_request("Skill 目录不存在"))?;
    if !target.is_dir() {
        return Err(ApiError::bad_request("Skill 目录不存在"));
    }
    let mut roots = Vec::new();
    if let Some(home) = home_dir() {
        if provider_id == OPENCODE_PROVIDER_ID {
            let opencode_root = home.join(".config").join("opencode");
            roots.push(opencode_root.join("skills"));
            roots.push(opencode_root.join("skill"));
        } else {
            roots.push(
                home.join(agent_config_directory_name(provider_id))
                    .join("skills"),
            );
        }
        if include_read_only_roots && provider_id == GROK_BUILD_PROVIDER_ID {
            roots.push(home.join(".grok").join("bundled").join("skills"));
        }
    }
    if let Some(project_path) = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let project_root = PathBuf::from(project_path);
        if provider_id == OPENCODE_PROVIDER_ID {
            let opencode_root = project_root.join(".opencode");
            roots.push(opencode_root.join("skills"));
            roots.push(opencode_root.join("skill"));
        } else {
            roots.push(
                project_root
                    .join(agent_config_directory_name(provider_id))
                    .join("skills"),
            );
        }
    }
    let allowed = roots
        .into_iter()
        .filter_map(|root| fs::canonicalize(root).ok())
        .any(|root| target.starts_with(&root) && target != root);
    allowed
        .then_some(target)
        .ok_or_else(|| ApiError::bad_request("Skill 路径不属于当前 Agent 的可管理目录"))
}

async fn plugin_command(Json(payload): Json<Value>) -> ApiResult<Json<Value>> {
    let provider_id = settings_provider_id(payload.get("providerId").and_then(Value::as_str))?;
    ensure_agent_plugin_management_supported(provider_id)?;
    let kind = required_json_string(&payload, "kind", "kind 不能为空")?;
    let action = required_json_string(&payload, "action", "action 不能为空")?;
    let mut args = vec!["plugin".to_string()];
    if kind == "marketplace" {
        args.push("marketplace".to_string());
        args.push(normalize_agent_plugin_action(provider_id, kind, action)?.to_string());
    } else if kind == "plugin" {
        args.push(normalize_agent_plugin_action(provider_id, kind, action)?.to_string());
    } else {
        return Err(ApiError::bad_request("不支持的插件命令类型"));
    }
    if let Some(target) = payload
        .get("target")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        args.push(target.to_string());
    }
    if kind == "plugin" && provider_id == CLAUDE_CODE_PROVIDER_ID {
        if let Some(scope) = payload
            .get("scope")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            args.push("--scope".to_string());
            args.push(scope.to_string());
        }
    }
    let cwd = payload
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let command = resolve_agent_settings_command(provider_id)
        .ok_or_else(|| ApiError::bad_request("未找到 Agent CLI 命令"))?;
    let mut result = run_external_command_value(&command, &arg_refs, cwd.as_ref())?;
    result["command"] = json!(command);
    result["providerId"] = json!(provider_id);
    Ok(Json(result))
}

fn ensure_agent_plugin_management_supported(provider_id: &str) -> ApiResult<()> {
    if provider_id == OPENCODE_PROVIDER_ID {
        return Err(ApiError::bad_request(
            "OpenCode 当前不提供稳定的插件市场管理接口",
        ));
    }
    Ok(())
}

async fn slash_commands(
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!({
        "commands": list_slash_commands_value(query.get("projectPath").map(String::as_str)),
    })))
}

fn read_agent_mcp_config_snapshot(
    provider_id: &str,
    project_path: Option<&str>,
) -> ApiResult<Value> {
    if provider_id == CLAUDE_CODE_PROVIDER_ID {
        return read_mcp_config_snapshot(project_path);
    }
    let global = resolve_agent_mcp_config_path(provider_id, "global", project_path)?;
    let project =
        resolve_agent_mcp_config_path(provider_id, "project", project_path).unwrap_or_default();
    let read_config = |path: &Path| {
        if provider_id == OPENCODE_PROVIDER_ID {
            read_opencode_mcp_config(path)
        } else {
            read_toml_mcp_config(path)
        }
    };
    Ok(json!({
        "paths": {
            "global": global,
            "project": project,
            "claudeJson": "",
        },
        "configs": {
            "global": read_config(&global)?,
            "project": read_config(&project)?,
            "claudeJsonGlobal": { "mcpServers": {} },
            "claudeJsonProject": { "mcpServers": {} },
        },
    }))
}

fn resolve_agent_mcp_config_path(
    provider_id: &str,
    scope: &str,
    project_path: Option<&str>,
) -> ApiResult<PathBuf> {
    let directory = agent_config_directory_name(provider_id);
    if scope == "global" {
        if provider_id == OPENCODE_PROVIDER_ID {
            return home_dir()
                .map(|home| home.join(".config").join("opencode").join("opencode.json"))
                .ok_or_else(|| ApiError::internal("无法定位用户目录"));
        }
        return home_dir()
            .map(|home| home.join(directory).join("config.toml"))
            .ok_or_else(|| ApiError::internal("无法定位用户目录"));
    }
    let project = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("当前没有活动项目"))?;
    if provider_id == OPENCODE_PROVIDER_ID {
        return Ok(PathBuf::from(project).join(directory).join("opencode.json"));
    }
    Ok(PathBuf::from(project).join(directory).join("config.toml"))
}

fn read_mcp_config_snapshot(project_path: Option<&str>) -> ApiResult<Value> {
    let global = resolve_mcp_config_path("global", project_path)?;
    let project = resolve_mcp_config_path("project", project_path).unwrap_or_default();
    let claude_json = home_dir()
        .ok_or_else(|| ApiError::internal("无法定位用户目录"))?
        .join(".claude.json");
    let claude_json_value = read_json_file_if_exists(&claude_json)?;
    Ok(json!({
        "paths": {
            "global": global,
            "project": project,
            "claudeJson": claude_json,
        },
        "configs": {
            "global": normalize_mcp_config(&read_json_file_if_exists(&global)?.unwrap_or(Value::Null)),
            "project": normalize_mcp_config(&read_json_file_if_exists(&project)?.unwrap_or(Value::Null)),
            "claudeJsonGlobal": normalize_mcp_config(&extract_claude_json_global_mcp(&claude_json_value)),
            "claudeJsonProject": normalize_mcp_config(&extract_claude_json_project_mcp(&claude_json_value, project_path)),
        },
    }))
}

fn resolve_mcp_config_path(scope: &str, project_path: Option<&str>) -> ApiResult<PathBuf> {
    if scope == "global" {
        return home_dir()
            .map(|home| home.join(".claude").join("mcp.json"))
            .ok_or_else(|| ApiError::internal("无法定位用户目录"));
    }
    let project = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("项目级 MCP 配置需要项目目录"))?;
    Ok(PathBuf::from(project).join(".mcp.json"))
}

fn ensure_mcp_config_file(scope: &str, project_path: Option<&str>) -> ApiResult<PathBuf> {
    let snapshot = read_mcp_config_snapshot(project_path)?;
    let paths = snapshot.get("paths").cloned().unwrap_or_else(|| json!({}));
    let configs = snapshot
        .get("configs")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let (path, config) = match scope {
        "global" => (
            json_path(&paths, "global")?,
            configs
                .get("global")
                .cloned()
                .unwrap_or_else(|| json!({"mcpServers": {}})),
        ),
        "project" => (
            json_path(&paths, "project")?,
            configs
                .get("project")
                .cloned()
                .unwrap_or_else(|| json!({"mcpServers": {}})),
        ),
        "claude-json-global" => {
            let path = json_path(&paths, "claudeJson")?;
            if !path.exists() {
                write_claude_json_mcp_config(
                    "global",
                    project_path,
                    configs
                        .get("claudeJsonGlobal")
                        .unwrap_or(&json!({"mcpServers": {}})),
                )?;
            }
            return Ok(path);
        }
        "claude-json-project" => {
            let path = json_path(&paths, "claudeJson")?;
            if !path.exists() {
                write_claude_json_mcp_config(
                    "project",
                    project_path,
                    configs
                        .get("claudeJsonProject")
                        .unwrap_or(&json!({"mcpServers": {}})),
                )?;
            }
            return Ok(path);
        }
        _ => return Err(ApiError::bad_request("不支持的 MCP 配置作用域")),
    };
    if !path.exists() {
        write_json_file_pretty(&path, &config)?;
    }
    Ok(path)
}

fn json_path(value: &Value, key: &str) -> ApiResult<PathBuf> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| ApiError::bad_request("MCP 配置路径无效"))
}

fn normalize_mcp_config(value: &Value) -> Value {
    let mut root = value.as_object().cloned().unwrap_or_default();
    let servers = value
        .get("mcpServers")
        .and_then(Value::as_object)
        .map(|items| {
            items
                .iter()
                .filter_map(|(name, config)| {
                    if name.trim().is_empty() || !config.is_object() {
                        None
                    } else {
                        Some((name.clone(), config.clone()))
                    }
                })
                .collect::<Map<String, Value>>()
        })
        .unwrap_or_default();
    root.insert("mcpServers".to_string(), Value::Object(servers));
    Value::Object(root)
}

fn write_claude_json_mcp_config(
    scope: &str,
    project_path: Option<&str>,
    config: &Value,
) -> ApiResult<()> {
    let path = home_dir()
        .ok_or_else(|| ApiError::internal("无法定位用户目录"))?
        .join(".claude.json");
    let mut root = read_json_file_if_exists(&path)?
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    let servers = config
        .get("mcpServers")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    if scope == "global" {
        root.insert("mcpServers".to_string(), Value::Object(servers));
    } else {
        let project = project_path
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| ApiError::bad_request("项目级 MCP 配置需要项目目录"))?;
        let project_key = find_claude_project_write_key(root.get("projects"), project);
        let mut projects = root
            .get("projects")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let mut project_value = projects
            .get(&project_key)
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        project_value.insert("mcpServers".to_string(), Value::Object(servers));
        projects.insert(project_key, Value::Object(project_value));
        root.insert("projects".to_string(), Value::Object(projects));
    }
    write_json_file_pretty(&path, &Value::Object(root))
}

fn extract_claude_json_global_mcp(value: &Option<Value>) -> Value {
    value
        .as_ref()
        .and_then(|root| root.get("mcpServers"))
        .map(|servers| json!({ "mcpServers": servers }))
        .unwrap_or(Value::Null)
}

fn extract_claude_json_project_mcp(value: &Option<Value>, project_path: Option<&str>) -> Value {
    let Some(project_path) = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Value::Null;
    };
    let Some(projects) = value
        .as_ref()
        .and_then(|root| root.get("projects"))
        .and_then(Value::as_object)
    else {
        return Value::Null;
    };
    let target = normalize_claude_project_key(project_path);
    for candidate in [project_path.to_string(), target.clone()] {
        if let Some(servers) = projects
            .get(&normalize_claude_project_key(&candidate))
            .and_then(|project| project.get("mcpServers"))
        {
            return json!({ "mcpServers": servers });
        }
    }
    for (key, project) in projects {
        if normalize_claude_project_key(key).eq_ignore_ascii_case(&target) {
            if let Some(servers) = project.get("mcpServers") {
                return json!({ "mcpServers": servers });
            }
        }
    }
    Value::Null
}

fn find_claude_project_write_key(projects: Option<&Value>, project_path: &str) -> String {
    let target = normalize_claude_project_key(project_path);
    if let Some(projects) = projects.and_then(Value::as_object) {
        if projects.contains_key(&target) {
            return target;
        }
        for key in projects.keys() {
            if normalize_claude_project_key(key).eq_ignore_ascii_case(&target) {
                return key.clone();
            }
        }
    }
    target
}

fn normalize_claude_project_key(value: &str) -> String {
    value
        .replace('\\', "/")
        .trim()
        .trim_end_matches('/')
        .to_string()
}

pub(crate) fn list_mcp_servers_value(project_path: Option<&str>) -> Value {
    let mut servers = Vec::new();
    let mut errors = Vec::new();
    let home = home_dir().unwrap_or_else(|| PathBuf::from("."));
    let project = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."));
    read_json_mcp_servers(
        "Claude Code settings",
        &home.join(".claude").join("settings.json"),
        &mut servers,
        &mut errors,
    );
    read_json_mcp_servers(
        "Claude MCP global",
        &home.join(".claude").join("mcp.json"),
        &mut servers,
        &mut errors,
    );
    read_json_mcp_servers(
        "Claude Code global",
        &home.join(".claude.json"),
        &mut servers,
        &mut errors,
    );
    read_claude_json_project_mcp_servers(
        "Claude CLI project",
        &home.join(".claude.json"),
        &project,
        &mut servers,
        &mut errors,
    );
    if let Some(appdata) = env::var("APPDATA").ok().map(PathBuf::from) {
        read_json_mcp_servers(
            "Claude Desktop",
            &appdata.join("Claude").join("claude_desktop_config.json"),
            &mut servers,
            &mut errors,
        );
    }
    read_codex_toml_mcp_servers(
        &home.join(".codex").join("config.toml"),
        &mut servers,
        &mut errors,
    );
    read_json_mcp_servers(
        "Project MCP",
        &project.join(".mcp.json"),
        &mut servers,
        &mut errors,
    );
    read_json_mcp_servers(
        "Claude Code project settings",
        &project.join(".claude").join("settings.json"),
        &mut servers,
        &mut errors,
    );
    read_json_mcp_servers(
        "Cursor MCP",
        &project.join(".cursor").join("mcp.json"),
        &mut servers,
        &mut errors,
    );
    json!({ "servers": servers, "errors": errors })
}

fn list_agent_mcp_servers_value(provider_id: &str, project_path: Option<&str>) -> ApiResult<Value> {
    if provider_id == CLAUDE_CODE_PROVIDER_ID {
        return Ok(list_mcp_servers_value(project_path));
    }
    let snapshot = read_agent_mcp_config_snapshot(provider_id, project_path)?;
    let mut servers = Vec::new();
    for (scope, path_key) in [("global", "global"), ("project", "project")] {
        let source = snapshot
            .pointer(&format!("/paths/{path_key}"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some(items) = snapshot
            .pointer(&format!("/configs/{scope}/mcpServers"))
            .and_then(Value::as_object)
        else {
            continue;
        };
        for (name, raw) in items {
            let mut server = json!({
                "id": format!("{provider_id}:{scope}:{name}"),
                "name": name,
                "source": source,
                "status": "unknown",
                "tools": [],
                "command": raw.get("command").and_then(Value::as_str),
                "url": raw.get("url").and_then(Value::as_str),
            });
            if raw.get("args").and_then(Value::as_array).is_some() {
                if let Some(object) = server.as_object_mut() {
                    object.insert(
                        "args".to_string(),
                        redact_sensitive_args(raw.get("args").and_then(Value::as_array)),
                    );
                }
            }
            remove_null_fields(&mut server);
            servers.push(server);
        }
    }
    Ok(json!({ "servers": servers, "errors": [] }))
}

fn read_opencode_mcp_config(path: &Path) -> ApiResult<Value> {
    if path.as_os_str().is_empty() || !path.exists() {
        return Ok(json!({ "mcpServers": {} }));
    }
    let root = read_json_file_if_exists(path)?
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    let mut servers = Map::new();
    for (name, value) in root
        .get("mcp")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let Some(raw) = value.as_object() else {
            continue;
        };
        let mut normalized = raw.clone();
        let enabled = normalized
            .remove("enabled")
            .and_then(|value| value.as_bool())
            .unwrap_or(true);
        let native_type = normalized
            .remove("type")
            .and_then(|value| value.as_str().map(ToString::to_string));
        let command = normalized.remove("command");
        if native_type.as_deref() == Some("remote") || normalized.contains_key("url") {
            normalized.insert("type".to_string(), json!("http"));
        } else {
            normalized.insert("type".to_string(), json!("stdio"));
            if let Some(command) = command.and_then(|value| value.as_array().cloned()) {
                if let Some(program) = command.first().and_then(Value::as_str) {
                    normalized.insert("command".to_string(), json!(program));
                    if command.len() > 1 {
                        normalized.insert(
                            "args".to_string(),
                            Value::Array(command.into_iter().skip(1).collect()),
                        );
                    }
                }
            }
        }
        if !enabled {
            normalized.insert("disabled".to_string(), json!(true));
        }
        servers.insert(name.clone(), Value::Object(normalized));
    }
    Ok(json!({ "mcpServers": servers }))
}

fn write_opencode_mcp_config(path: &Path, config: &Value) -> ApiResult<()> {
    let mut root = read_json_file_if_exists(path)?
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    root.entry("$schema".to_string())
        .or_insert_with(|| json!("https://opencode.ai/config.json"));
    let existing_servers = root
        .get("mcp")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut next_servers = Map::new();
    for (name, value) in config
        .get("mcpServers")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let Some(internal) = value.as_object() else {
            continue;
        };
        let mut native = existing_servers
            .get(name)
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        for key in [
            "type", "command", "args", "disabled", "enabled", "url", "env", "headers",
        ] {
            native.remove(key);
        }
        let disabled = internal
            .get("disabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if internal.get("type").and_then(Value::as_str) == Some("http")
            || internal.get("url").and_then(Value::as_str).is_some()
        {
            native.insert("type".to_string(), json!("remote"));
            if let Some(url) = internal.get("url").and_then(Value::as_str) {
                native.insert("url".to_string(), json!(url));
            }
            if let Some(headers) = internal.get("headers").and_then(Value::as_object) {
                native.insert("headers".to_string(), Value::Object(headers.clone()));
            }
        } else {
            native.insert("type".to_string(), json!("local"));
            let mut command = Vec::new();
            if let Some(program) = internal.get("command").and_then(Value::as_str) {
                command.push(json!(program));
            }
            command.extend(
                internal
                    .get("args")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(|value| json!(value)),
            );
            native.insert("command".to_string(), Value::Array(command));
            if let Some(environment) = internal.get("env").and_then(Value::as_object) {
                native.insert("env".to_string(), Value::Object(environment.clone()));
            }
        }
        native.insert("enabled".to_string(), json!(!disabled));
        for (key, value) in internal {
            if !matches!(
                key.as_str(),
                "type"
                    | "command"
                    | "args"
                    | "disabled"
                    | "enabled"
                    | "url"
                    | "env"
                    | "headers"
                    | "auth"
                    | "envPassthrough"
                    | "cwd"
            ) {
                native.insert(key.clone(), value.clone());
            }
        }
        next_servers.insert(name.clone(), Value::Object(native));
    }
    root.insert("mcp".to_string(), Value::Object(next_servers));
    write_json_file_pretty(path, &Value::Object(root))
}

fn ensure_opencode_config_file(path: &Path) -> ApiResult<()> {
    if path.exists() {
        return Ok(());
    }
    write_json_file_pretty(
        path,
        &json!({
            "$schema": "https://opencode.ai/config.json",
            "mcp": {},
        }),
    )
}

fn read_toml_mcp_config(path: &Path) -> ApiResult<Value> {
    if path.as_os_str().is_empty() || !path.exists() {
        return Ok(json!({ "mcpServers": {} }));
    }
    let content = fs::read_to_string(path)
        .map_err(|error| ApiError::internal(format!("读取 TOML 配置失败: {error}")))?;
    let document = content
        .parse::<toml_edit::DocumentMut>()
        .map_err(|error| ApiError::bad_request(format!("解析 TOML 配置失败: {error}")))?;
    let mut servers = Map::new();
    if let Some(table) = document
        .get("mcp_servers")
        .and_then(toml_edit::Item::as_table_like)
    {
        for (name, item) in table.iter() {
            servers.insert(name.to_string(), toml_item_to_json(item));
        }
    }
    Ok(json!({ "mcpServers": servers }))
}

fn write_toml_mcp_config(path: &Path, config: &Value) -> ApiResult<()> {
    let content = fs::read_to_string(path).unwrap_or_default();
    let mut document = if content.trim().is_empty() {
        toml_edit::DocumentMut::new()
    } else {
        content
            .parse::<toml_edit::DocumentMut>()
            .map_err(|error| ApiError::bad_request(format!("解析 TOML 配置失败: {error}")))?
    };
    let mut servers = toml_edit::Table::new();
    if let Some(items) = config.get("mcpServers").and_then(Value::as_object) {
        for (name, value) in items {
            servers.insert(name, json_to_toml_item(value));
        }
    }
    document["mcp_servers"] = toml_edit::Item::Table(servers);
    write_text_file_atomically(path, &document.to_string())
        .map_err(|error| ApiError::internal(format!("写入 TOML 配置失败: {error}")))
}

fn ensure_toml_config_file(path: &Path) -> ApiResult<()> {
    if path.exists() {
        return Ok(());
    }
    write_text_file_atomically(path, "")
        .map_err(|error| ApiError::internal(format!("创建 TOML 配置失败: {error}")))
}

fn toml_item_to_json(item: &toml_edit::Item) -> Value {
    if let Some(value) = item.as_value() {
        return toml_value_to_json(value);
    }
    if let Some(table) = item.as_table_like() {
        let mut object = Map::new();
        for (key, value) in table.iter() {
            object.insert(key.to_string(), toml_item_to_json(value));
        }
        return Value::Object(object);
    }
    Value::Null
}

fn toml_value_to_json(value: &toml_edit::Value) -> Value {
    if let Some(value) = value.as_str() {
        return json!(value);
    }
    if let Some(value) = value.as_integer() {
        return json!(value);
    }
    if let Some(value) = value.as_float() {
        return json!(value);
    }
    if let Some(value) = value.as_bool() {
        return json!(value);
    }
    if let Some(array) = value.as_array() {
        return Value::Array(array.iter().map(toml_value_to_json).collect());
    }
    if let Some(table) = value.as_inline_table() {
        let mut object = Map::new();
        for (key, value) in table.iter() {
            object.insert(key.to_string(), toml_value_to_json(value));
        }
        return Value::Object(object);
    }
    json!(value.to_string())
}

fn json_to_toml_item(value: &Value) -> toml_edit::Item {
    if let Some(object) = value.as_object() {
        let mut table = toml_edit::Table::new();
        for (key, value) in object {
            if !value.is_null() {
                table.insert(key, json_to_toml_item(value));
            }
        }
        return toml_edit::Item::Table(table);
    }
    toml_edit::Item::Value(json_to_toml_value(value))
}

fn json_to_toml_value(value: &Value) -> toml_edit::Value {
    match value {
        Value::String(value) => toml_edit::Value::from(value.as_str()),
        Value::Bool(value) => toml_edit::Value::from(*value),
        Value::Number(value) if value.is_i64() => {
            toml_edit::Value::from(value.as_i64().unwrap_or_default())
        }
        Value::Number(value) if value.is_u64() => toml_edit::Value::from(
            i64::try_from(value.as_u64().unwrap_or_default()).unwrap_or(i64::MAX),
        ),
        Value::Number(value) => toml_edit::Value::from(value.as_f64().unwrap_or_default()),
        Value::Array(values) => {
            let mut array = toml_edit::Array::new();
            for value in values {
                if !value.is_object() && !value.is_null() {
                    array.push(json_to_toml_value(value));
                }
            }
            toml_edit::Value::Array(array)
        }
        _ => toml_edit::Value::from(value.to_string()),
    }
}

pub(crate) fn resolve_mcp_server_config_value(
    server_id: &str,
    project_path: Option<&str>,
) -> Result<Value, String> {
    let overview = list_mcp_servers_value(project_path);
    let server = overview
        .get("servers")
        .and_then(Value::as_array)
        .and_then(|servers| {
            servers
                .iter()
                .find(|server| server.get("id").and_then(Value::as_str) == Some(server_id))
        })
        .ok_or_else(|| "所选 MCP 服务不存在或配置来源已不可用".to_string())?;
    let name = server
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "MCP 服务名称无效".to_string())?;
    let source = server
        .get("source")
        .and_then(Value::as_str)
        .ok_or_else(|| "MCP 服务配置来源无效".to_string())?;
    let path = PathBuf::from(source);

    let config = if server_id.starts_with("Codex:") {
        let content =
            fs::read_to_string(&path).map_err(|error| format!("读取 MCP 配置失败: {error}"))?;
        let value = content
            .parse::<toml::Value>()
            .map_err(|error| format!("解析 MCP 配置失败: {error}"))?;
        let raw = value
            .get("mcp_servers")
            .and_then(toml::Value::as_table)
            .and_then(|servers| servers.get(name))
            .ok_or_else(|| "所选 MCP 服务配置已不存在".to_string())?;
        serde_json::to_value(raw).map_err(|error| format!("转换 MCP 配置失败: {error}"))?
    } else if server_id.starts_with("Claude CLI project:") {
        let home = home_dir().unwrap_or_else(|| PathBuf::from("."));
        let project = project_path
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| {
                env::current_dir()
                    .ok()
                    .map(|path| path.to_string_lossy().to_string())
            });
        let value =
            read_json_file_if_exists(&home.join(".claude.json")).map_err(|error| error.message)?;
        extract_claude_json_project_mcp(&value, project.as_deref())
            .get("mcpServers")
            .and_then(Value::as_object)
            .and_then(|servers| servers.get(name))
            .cloned()
            .ok_or_else(|| "所选 MCP 服务配置已不存在".to_string())?
    } else {
        read_json_file_if_exists(&path)
            .map_err(|error| error.message)?
            .unwrap_or(Value::Null)
            .get("mcpServers")
            .and_then(Value::as_object)
            .and_then(|servers| servers.get(name))
            .cloned()
            .ok_or_else(|| "所选 MCP 服务配置已不存在".to_string())?
    };

    Ok(json!({
        "id": server_id,
        "name": name,
        "source": source,
        "config": config,
    }))
}

fn read_json_mcp_servers(
    source: &str,
    path: &Path,
    servers: &mut Vec<Value>,
    errors: &mut Vec<Value>,
) {
    if !path.exists() {
        return;
    }
    match read_json_file_if_exists(path) {
        Ok(Some(value)) => {
            let Some(items) = value.get("mcpServers").and_then(Value::as_object) else {
                return;
            };
            for (name, raw) in items {
                if !raw.is_object() {
                    continue;
                }
                let mut server = json!({
                    "id": format!("{source}:{name}"),
                    "name": name,
                    "source": path,
                    "status": "unknown",
                    "tools": [],
                    "command": raw.get("command").and_then(Value::as_str),
                });
                if raw.get("args").and_then(Value::as_array).is_some() {
                    if let Some(object) = server.as_object_mut() {
                        object.insert(
                            "args".to_string(),
                            redact_sensitive_args(raw.get("args").and_then(Value::as_array)),
                        );
                    }
                }
                remove_null_fields(&mut server);
                servers.push(server);
            }
        }
        Ok(None) => {}
        Err(error) => errors.push(json!({
            "source": source,
            "path": path,
            "message": format!("解析 MCP 配置失败：{}", error.message),
        })),
    }
}

fn read_claude_json_project_mcp_servers(
    source: &str,
    path: &Path,
    project: &Path,
    servers: &mut Vec<Value>,
    errors: &mut Vec<Value>,
) {
    let project_string = project.to_string_lossy().to_string();
    let Ok(value) = read_json_file_if_exists(path) else {
        errors.push(json!({ "source": source, "path": path, "message": "解析 MCP 配置失败" }));
        return;
    };
    let Some(config) = extract_claude_json_project_mcp(&value, Some(&project_string))
        .get("mcpServers")
        .and_then(Value::as_object)
        .cloned()
    else {
        return;
    };
    for (name, raw) in config {
        if !raw.is_object() {
            continue;
        }
        let mut server = json!({
            "id": format!("{source}:{name}"),
            "name": name,
            "source": path,
            "status": "unknown",
            "tools": [],
            "command": raw.get("command").and_then(Value::as_str),
        });
        if raw.get("args").and_then(Value::as_array).is_some() {
            if let Some(object) = server.as_object_mut() {
                object.insert(
                    "args".to_string(),
                    redact_sensitive_args(raw.get("args").and_then(Value::as_array)),
                );
            }
        }
        remove_null_fields(&mut server);
        servers.push(server);
    }
}

fn read_codex_toml_mcp_servers(path: &Path, servers: &mut Vec<Value>, errors: &mut Vec<Value>) {
    if !path.exists() {
        return;
    }
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) => {
            errors.push(json!({ "source": "Codex", "path": path, "message": format!("解析 MCP 配置失败：{error}") }));
            return;
        }
    };
    let mut active = String::new();
    let mut parsed: std::collections::BTreeMap<String, (Option<String>, Vec<String>)> =
        std::collections::BTreeMap::new();
    for raw_line in content.lines() {
        let line = strip_toml_comment(raw_line).trim().to_string();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            let table = &line[1..line.len() - 1];
            active = table
                .strip_prefix("mcp_servers.")
                .filter(|rest| !rest.trim().is_empty() && !rest.contains('.'))
                .map(unquote_toml_string)
                .unwrap_or_default();
            if !active.is_empty() {
                parsed.entry(active.clone()).or_default();
            }
            continue;
        }
        if active.is_empty() {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let entry = parsed.entry(active.clone()).or_default();
        if key.trim() == "command" {
            entry.0 = Some(unquote_toml_string(value.trim()));
        } else if key.trim() == "args" {
            entry.1 = parse_toml_string_array(value.trim());
        }
    }
    for (name, (command, args)) in parsed {
        let mut server = json!({
            "id": format!("Codex:{name}"),
            "name": name,
            "source": path,
            "status": "unknown",
            "tools": [],
            "command": command,
        });
        if !args.is_empty() {
            if let Some(object) = server.as_object_mut() {
                object.insert("args".to_string(), redact_sensitive_strings(&args));
            }
        }
        remove_null_fields(&mut server);
        servers.push(server);
    }
}

pub(crate) fn list_codex_skills_value(project_path: Option<&str>) -> Value {
    let home = home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut skills = Vec::new();
    let mut errors = Vec::new();
    let roots = [
        (home.join(".codex").join("skills"), "user"),
        (home.join(".codex").join("plugins").join("cache"), "plugin"),
    ];
    for (root, source) in roots {
        scan_codex_skill_root(&root, source, &mut skills, &mut errors);
    }
    if let Some(project) = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        scan_codex_skill_root(
            &PathBuf::from(project).join(".codex").join("skills"),
            "project",
            &mut skills,
            &mut errors,
        );
    }
    skills.sort_by(|left, right| {
        left.get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .cmp(right.get("name").and_then(Value::as_str).unwrap_or(""))
    });
    json!({ "skills": skills, "errors": errors })
}

fn list_agent_skills_value(provider_id: &str, project_path: Option<&str>) -> Value {
    if provider_id == OPENAI_CODEX_PROVIDER_ID {
        return list_codex_skills_value(project_path)
            .get("skills")
            .cloned()
            .unwrap_or_else(|| json!([]));
    }
    if provider_id == CLAUDE_CODE_PROVIDER_ID {
        return list_claude_plugin_skills_value(project_path);
    }

    let home = home_dir().unwrap_or_else(|| PathBuf::from("."));
    if provider_id == OPENCODE_PROVIDER_ID {
        let mut skills = Vec::new();
        let global_root = home.join(".config").join("opencode");
        for directory in [global_root.join("skills"), global_root.join("skill")] {
            scan_claude_skill_directory(&directory, "user", &mut skills);
        }
        if let Some(project) = project_path
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let project_root = PathBuf::from(project).join(".opencode");
            for directory in [project_root.join("skills"), project_root.join("skill")] {
                scan_claude_skill_directory(&directory, "project", &mut skills);
            }
        }
        skills.sort_by(|left, right| {
            left.get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .cmp(right.get("name").and_then(Value::as_str).unwrap_or(""))
        });
        return Value::Array(skills);
    }
    let config_directory = agent_config_directory_name(provider_id);
    let mut skills = Vec::new();
    scan_claude_skill_directory(
        &home.join(config_directory).join("skills"),
        "user",
        &mut skills,
    );
    if let Some(project) = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        scan_claude_skill_directory(
            &PathBuf::from(project).join(config_directory).join("skills"),
            "project",
            &mut skills,
        );
    }
    if provider_id == GROK_BUILD_PROVIDER_ID {
        scan_claude_skill_directory(
            &home.join(".grok").join("bundled").join("skills"),
            "bundled",
            &mut skills,
        );
    }
    skills.sort_by(|left, right| {
        left.get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .cmp(right.get("name").and_then(Value::as_str).unwrap_or(""))
    });
    Value::Array(skills)
}

fn resolve_agent_settings_command(provider_id: &str) -> Option<String> {
    match provider_id {
        GROK_BUILD_PROVIDER_ID => resolve_grok_command(),
        OPENAI_CODEX_PROVIDER_ID => resolve_codex_command(),
        OPENCODE_PROVIDER_ID => resolve_opencode_command(),
        _ => resolve_claude_command(),
    }
}

fn read_opencode_model_ids(command: &str, cwd: &Path) -> Vec<String> {
    let Ok(output) = background_command(command)
        .arg("models")
        .current_dir(cwd)
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let mut seen = std::collections::HashSet::new();
    String::from_utf8_lossy(&output.stdout)
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
        .map(ToString::to_string)
        .collect()
}

fn normalize_agent_plugin_action<'a>(
    provider_id: &str,
    kind: &str,
    action: &'a str,
) -> ApiResult<&'a str> {
    let normalized = match (provider_id, kind, action) {
        (OPENAI_CODEX_PROVIDER_ID, "plugin", "install") => "add",
        (OPENAI_CODEX_PROVIDER_ID, "plugin", "uninstall") => "remove",
        (OPENAI_CODEX_PROVIDER_ID, "marketplace", "update") => "upgrade",
        (_, _, value) => value,
    };
    let supported = if kind == "marketplace" {
        matches!(normalized, "add" | "remove" | "update" | "upgrade")
    } else if provider_id == GROK_BUILD_PROVIDER_ID {
        matches!(
            normalized,
            "install" | "uninstall" | "enable" | "disable" | "update"
        )
    } else if provider_id == OPENAI_CODEX_PROVIDER_ID {
        matches!(normalized, "add" | "remove")
    } else {
        matches!(
            normalized,
            "install" | "uninstall" | "enable" | "disable" | "update"
        )
    };
    supported
        .then_some(normalized)
        .ok_or_else(|| ApiError::bad_request("当前 Agent 不支持该插件操作"))
}

fn run_agent_json_command(provider_id: &str, arguments: &[&str]) -> ApiResult<Value> {
    let command = resolve_agent_settings_command(provider_id)
        .ok_or_else(|| ApiError::bad_request("未找到 Agent CLI 命令"))?;
    let output = background_command(&command)
        .args(arguments)
        .output()
        .map_err(|error| ApiError::internal(format!("执行 Agent CLI 失败: {error}")))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(ApiError::bad_request(if stderr.is_empty() {
            "Agent CLI 命令执行失败".to_string()
        } else {
            stderr
        }));
    }
    serde_json::from_str(&stdout)
        .map_err(|error| ApiError::internal(format!("解析 Agent CLI JSON 失败: {error}")))
}

fn list_agent_installed_plugins_value(provider_id: &str) -> ApiResult<Value> {
    if provider_id == CLAUDE_CODE_PROVIDER_ID {
        return Ok(list_installed_plugins_value());
    }
    if provider_id == OPENCODE_PROVIDER_ID {
        return Ok(json!([]));
    }
    let payload = run_agent_json_command(provider_id, &["plugin", "list", "--json"])?;
    let items = payload
        .get("installed")
        .and_then(Value::as_array)
        .or_else(|| payload.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(Value::Array(
        items
            .into_iter()
            .filter_map(|item| normalize_agent_plugin_item(provider_id, &item, true))
            .collect(),
    ))
}

fn list_agent_plugin_marketplaces_value(provider_id: &str) -> ApiResult<Value> {
    if provider_id == CLAUDE_CODE_PROVIDER_ID {
        return Ok(list_plugin_marketplaces_value());
    }
    if provider_id == OPENCODE_PROVIDER_ID {
        return Ok(json!([]));
    }
    let available_payload =
        run_agent_json_command(provider_id, &["plugin", "list", "--available", "--json"])?;
    let items = available_payload
        .get("available")
        .and_then(Value::as_array)
        .or_else(|| available_payload.as_array())
        .cloned()
        .unwrap_or_default();
    let mut grouped: std::collections::BTreeMap<String, Vec<Value>> =
        std::collections::BTreeMap::new();
    for item in items {
        let marketplace = item
            .get("marketplaceName")
            .or_else(|| item.get("marketplace"))
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        if let Some(plugin) = normalize_agent_plugin_item(provider_id, &item, false) {
            grouped.entry(marketplace).or_default().push(plugin);
        }
    }
    let marketplace_payload =
        run_agent_json_command(provider_id, &["plugin", "marketplace", "list", "--json"])?;
    let marketplaces = marketplace_payload
        .get("marketplaces")
        .and_then(Value::as_array)
        .or_else(|| marketplace_payload.as_array())
        .cloned()
        .unwrap_or_default();
    for marketplace in &marketplaces {
        let Some(name) = marketplace.get("name").and_then(Value::as_str) else {
            continue;
        };
        grouped.entry(name.to_string()).or_default();
    }
    Ok(Value::Array(
        grouped.into_iter().map(|(name, plugins)| {
            let metadata = marketplaces.iter().find(|item| {
                item.get("name").and_then(Value::as_str) == Some(name.as_str())
            });
            let source = metadata.and_then(|item| {
                item.get("source")
                    .and_then(|source| source.get("url").or_else(|| source.as_str().map(|_| source)))
                    .and_then(Value::as_str)
                    .or_else(|| item.get("root").and_then(Value::as_str))
            });
            json!({
                "name": name,
                "source": source,
                "mutationTarget": if provider_id == GROK_BUILD_PROVIDER_ID { source.unwrap_or(name.as_str()) } else { name.as_str() },
                "plugins": plugins,
            })
        })
            .collect(),
    ))
}

fn normalize_agent_plugin_item(provider_id: &str, item: &Value, installed: bool) -> Option<Value> {
    let name = item.get("name").and_then(Value::as_str)?.trim();
    if name.is_empty() {
        return None;
    }
    let marketplace = item
        .get("marketplaceName")
        .or_else(|| item.get("marketplace"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let id = item
        .get("pluginId")
        .or_else(|| item.get("id"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("{name}@{marketplace}"));
    let mut normalized = json!({
        "id": id,
        "name": name,
        "marketplace": marketplace,
        "scope": item.get("scope").and_then(Value::as_str).unwrap_or("user"),
        "version": item.get("version").and_then(Value::as_str),
        "description": item.get("description").and_then(Value::as_str),
        "enabled": item.get("enabled").and_then(Value::as_bool).unwrap_or(installed),
        "installed": installed || item.get("installed").and_then(Value::as_bool).unwrap_or(false),
        "providerId": provider_id,
        "installPath": item.get("installPath").and_then(Value::as_str),
    });
    remove_null_fields(&mut normalized);
    Some(normalized)
}

fn scan_codex_skill_root(
    root: &Path,
    source: &str,
    skills: &mut Vec<Value>,
    errors: &mut Vec<Value>,
) {
    for skill_file in find_named_files(root, "SKILL.md", 8) {
        match parse_skill_markdown(&skill_file) {
            Ok(frontmatter) => {
                if let Some(name) = frontmatter.get("name").and_then(Value::as_str) {
                    skills.push(json!({
                        "id": format!("{source}:{}", skill_file.display()),
                        "name": name,
                        "description": frontmatter.get("description").and_then(Value::as_str),
                        "path": skill_file,
                        "source": source,
                    }));
                } else {
                    errors.push(
                        json!({ "path": skill_file, "message": "Skill frontmatter 缺少 name" }),
                    );
                }
            }
            Err(error) => errors.push(json!({ "path": skill_file, "message": error.message })),
        }
    }
}

fn list_installed_plugins_value() -> Value {
    let home = home_dir().unwrap_or_else(|| PathBuf::from("."));
    let plugins_root = home.join(".claude").join("plugins");
    let installed = read_json_file_if_exists(&plugins_root.join("installed_plugins.json"))
        .ok()
        .flatten()
        .unwrap_or_else(|| json!({}));
    let entries = installed
        .get("plugins")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let marketplace_index = build_marketplace_index(&plugins_root);
    let mut items = Vec::new();
    for (plugin_id, raw_installations) in entries {
        let (name, marketplace) = split_plugin_id(&plugin_id);
        let metadata = marketplace_index
            .get(&marketplace)
            .and_then(|plugins| {
                plugins
                    .iter()
                    .find(|item| item.get("name").and_then(Value::as_str) == Some(name.as_str()))
            })
            .cloned()
            .unwrap_or_else(|| json!({}));
        for installation in raw_installations.as_array().cloned().unwrap_or_default() {
            let mut item = json!({
                "id": plugin_id,
                "name": name,
                "marketplace": marketplace,
                "version": installation.get("version").and_then(Value::as_str),
                "scope": installation.get("scope").and_then(Value::as_str).unwrap_or("user"),
                "installPath": installation.get("installPath").and_then(Value::as_str),
                "projectPath": installation.get("projectPath").and_then(Value::as_str),
                "installedAt": installation.get("installedAt").and_then(Value::as_str),
                "lastUpdated": installation.get("lastUpdated").and_then(Value::as_str),
                "description": metadata.get("description").and_then(Value::as_str),
                "author": metadata.get("author").and_then(Value::as_str),
                "homepage": metadata.get("homepage").and_then(Value::as_str),
                "category": metadata.get("category").and_then(Value::as_str),
            });
            remove_null_fields(&mut item);
            items.push(item);
        }
    }
    items.sort_by(|left, right| {
        let left_key = format!(
            "{}:{}",
            left.get("name").and_then(Value::as_str).unwrap_or(""),
            left.get("scope").and_then(Value::as_str).unwrap_or("")
        );
        let right_key = format!(
            "{}:{}",
            right.get("name").and_then(Value::as_str).unwrap_or(""),
            right.get("scope").and_then(Value::as_str).unwrap_or("")
        );
        left_key.cmp(&right_key)
    });
    Value::Array(items)
}

fn list_plugin_marketplaces_value() -> Value {
    let home = home_dir().unwrap_or_else(|| PathBuf::from("."));
    let plugins_root = home.join(".claude").join("plugins");
    let known = read_json_file_if_exists(&plugins_root.join("known_marketplaces.json"))
        .ok()
        .flatten()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    let mut marketplaces = Vec::new();
    for (name, meta) in known {
        marketplaces.push(json!({
            "name": name,
            "source": meta.get("source").and_then(|source| source.get("repo").or_else(|| source.get("url"))).and_then(Value::as_str),
            "installLocation": meta.get("installLocation").and_then(Value::as_str),
            "lastUpdated": meta.get("lastUpdated").and_then(Value::as_str),
            "plugins": read_marketplace_plugins(&plugins_root, &name),
        }));
    }
    marketplaces.sort_by(|left, right| {
        left.get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .cmp(right.get("name").and_then(Value::as_str).unwrap_or(""))
    });
    Value::Array(marketplaces)
}

fn list_claude_plugin_skills_value(project_path: Option<&str>) -> Value {
    let home = home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut skills = Vec::new();
    scan_claude_skill_directory(&home.join(".claude").join("skills"), "user", &mut skills);
    if let Some(project) = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        scan_claude_skill_directory(
            &PathBuf::from(project).join(".claude").join("skills"),
            "project",
            &mut skills,
        );
    }
    let cache_root = home.join(".claude").join("plugins").join("cache");
    scan_claude_plugin_skill_cache(&cache_root, &mut skills);
    skills.sort_by(|left, right| {
        left.get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .cmp(right.get("name").and_then(Value::as_str).unwrap_or(""))
    });
    Value::Array(skills)
}

fn scan_claude_plugin_skill_cache(cache_root: &Path, skills: &mut Vec<Value>) {
    let Ok(marketplaces) = fs::read_dir(cache_root) else {
        return;
    };
    for marketplace in marketplaces.flatten() {
        if !marketplace.path().is_dir() {
            continue;
        }
        let marketplace_name = marketplace.file_name().to_string_lossy().to_string();
        let Ok(plugins) = fs::read_dir(marketplace.path()) else {
            continue;
        };
        for plugin in plugins.flatten() {
            if !plugin.path().is_dir() {
                continue;
            }
            let plugin_name = plugin.file_name().to_string_lossy().to_string();
            let Ok(versions) = fs::read_dir(plugin.path()) else {
                continue;
            };
            for version in versions.flatten() {
                if !version.path().is_dir() {
                    continue;
                }
                scan_claude_skill_directory(
                    &version.path().join("skills"),
                    &format!("plugin:{plugin_name}@{marketplace_name}"),
                    skills,
                );
            }
        }
    }
}

fn scan_claude_skill_directory(root: &Path, source: &str, skills: &mut Vec<Value>) {
    if !root.exists() {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path().join("SKILL.md");
        if path.exists() {
            push_claude_skill_from_file(&path, source, skills);
        }
    }
}

fn push_claude_skill_from_file(skill_file: &Path, source: &str, skills: &mut Vec<Value>) {
    if let Ok(frontmatter) = parse_skill_markdown(skill_file) {
        let directory_name = skill_file
            .parent()
            .and_then(Path::file_name)
            .and_then(|value| value.to_str())
            .unwrap_or("skill");
        let name = frontmatter
            .get("name")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(directory_name);
        skills.push(json!({
            "name": name,
            "description": frontmatter.get("description").and_then(Value::as_str),
            "source": source,
            "path": skill_file,
            "disableModelInvocation": frontmatter.get("disable-model-invocation").and_then(Value::as_bool).unwrap_or(false),
            "userInvocable": frontmatter.get("user-invocable").and_then(Value::as_bool).unwrap_or(true),
        }));
    }
}

fn list_slash_commands_value(project_path: Option<&str>) -> Vec<Value> {
    let mut commands = vec![
        slash_command(
            "app:/clear",
            "clear",
            "/clear",
            "New Chat",
            "新建一个空聊天，不把当前输入发给 Claude。",
            "app",
            "local-action",
            "CodeM",
            Some("clear-thread"),
        ),
        slash_command(
            "builtin:/status",
            "status",
            "/status",
            "Status",
            "显示当前项目、模型、权限模式和会话信息。",
            "builtin",
            "local-action",
            "CodeM",
            Some("show-status"),
        ),
        slash_command(
            "builtin:/compact",
            "compact",
            "/compact",
            "Compact Context",
            "把当前 Claude 会话压缩成更短的上下文。",
            "builtin",
            "local-action",
            "CodeM",
            Some("compact-thread"),
        ),
        slash_command(
            "builtin:/context",
            "context",
            "/context",
            "Context Usage",
            "查看当前会话的上下文使用情况。",
            "builtin",
            "local-action",
            "CodeM",
            Some("show-context"),
        ),
        slash_command(
            "builtin:/cost",
            "cost",
            "/cost",
            "Token Cost",
            "查看 Token 使用统计。",
            "builtin",
            "local-action",
            "CodeM",
            Some("show-cost"),
        ),
    ];
    commands.extend(list_markdown_slash_commands(project_path));
    commands.extend(list_skill_slash_commands(project_path));
    if let Some(servers) = list_mcp_servers_value(project_path)
        .get("servers")
        .and_then(Value::as_array)
    {
        for server in servers {
            let name = server
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("server");
            let segment = sanitize_mcp_segment(name);
            commands.push(json!({
                "id": format!("mcp:{}", server.get("id").and_then(Value::as_str).unwrap_or(name)),
                "name": format!("mcp__{segment}__"),
                "slash": format!("/mcp__{segment}__"),
                "title": format!("MCP {name}"),
                "description": format!("插入 {name} 的 MCP 命令前缀，后续继续补完整命令名。"),
                "source": "mcp",
                "action": "passthrough",
                "sourceLabel": name,
                "agentScope": ["claude"],
            }));
        }
    }
    normalize_sort_slash_commands(commands)
}

fn read_json_file_if_exists(path: &Path) -> ApiResult<Option<Value>> {
    if path.as_os_str().is_empty() || !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path)
        .map_err(|error| ApiError::internal(format!("读取 JSON 文件失败: {error}")))?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|error| ApiError::internal(format!("解析 JSON 文件失败: {error}")))
}

fn write_json_file_pretty(path: &Path, value: &Value) -> ApiResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| ApiError::internal(format!("创建目录失败: {error}")))?;
    }
    let content = serde_json::to_string_pretty(value)
        .map_err(|error| ApiError::internal(format!("序列化 JSON 失败: {error}")))?;
    write_text_file_atomically(path, &format!("{content}\n"))
        .map_err(|error| ApiError::internal(format!("写入 JSON 文件失败: {error}")))
}

fn write_text_file_atomically(path: &Path, content: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let temporary_path = path.with_extension(format!(
        "{extension}.{}.{}.tmp",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    fs::write(&temporary_path, content)?;
    replace_file_atomically(&temporary_path, path).inspect_err(|_| {
        let _ = fs::remove_file(&temporary_path);
    })
}

#[cfg(windows)]
fn replace_file_atomically(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        },
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let target = target
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    unsafe {
        MoveFileExW(
            PCWSTR(source.as_ptr()),
            PCWSTR(target.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
        .map_err(std::io::Error::other)
    }
}

#[cfg(not(windows))]
fn replace_file_atomically(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(source, target)
}

fn redact_sensitive_args(args: Option<&Vec<Value>>) -> Value {
    let strings = args
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    redact_sensitive_strings(&strings)
}

fn redact_sensitive_strings(args: &[String]) -> Value {
    Value::Array(
        args.iter()
            .enumerate()
            .map(|(index, arg)| {
                if index > 0 && is_sensitive_arg_name(&args[index - 1]) {
                    return json!("<redacted>");
                }
                if let Some((name, _)) = arg.split_once('=') {
                    if is_sensitive_arg_name(name) {
                        return json!(format!("{name}=<redacted>"));
                    }
                }
                json!(arg)
            })
            .collect(),
    )
}

fn is_sensitive_arg_name(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    [
        "api-key",
        "apikey",
        "api_key",
        "token",
        "secret",
        "password",
        "passwd",
        "credential",
        "access-key",
        "access_key",
        "auth",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

fn strip_toml_comment(line: &str) -> String {
    let mut quote: Option<char> = None;
    let mut previous = '\0';
    let mut result = String::new();
    for character in line.chars() {
        if (character == '"' || character == '\'') && previous != '\\' {
            quote = if quote == Some(character) {
                None
            } else {
                quote.or(Some(character))
            };
        }
        if character == '#' && quote.is_none() {
            break;
        }
        result.push(character);
        previous = character;
    }
    result
}

fn unquote_toml_string(value: &str) -> String {
    let trimmed = value.trim();
    if (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
    {
        return trimmed[1..trimmed.len().saturating_sub(1)]
            .replace("\\\"", "\"")
            .replace("\\\\", "\\");
    }
    trimmed.to_string()
}

fn parse_toml_string_array(value: &str) -> Vec<String> {
    let trimmed = value.trim();
    if !trimmed.starts_with('[') || !trimmed.ends_with(']') {
        return Vec::new();
    }
    let mut items = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut previous = '\0';
    for character in trimmed[1..trimmed.len().saturating_sub(1)].chars() {
        if (character == '"' || character == '\'') && previous != '\\' {
            quote = if quote == Some(character) {
                None
            } else {
                quote.or(Some(character))
            };
        }
        if character == ',' && quote.is_none() {
            let parsed = unquote_toml_string(&current);
            if !parsed.is_empty() {
                items.push(parsed);
            }
            current.clear();
            previous = character;
            continue;
        }
        current.push(character);
        previous = character;
    }
    let parsed = unquote_toml_string(&current);
    if !parsed.is_empty() {
        items.push(parsed);
    }
    items
}

fn find_named_files(root: &Path, file_name: &str, max_depth: usize) -> Vec<PathBuf> {
    let mut result = Vec::new();
    walk_find_named_files(root, file_name, max_depth, 0, &mut result);
    result
}

fn walk_find_named_files(
    directory: &Path,
    file_name: &str,
    max_depth: usize,
    depth: usize,
    result: &mut Vec<PathBuf>,
) {
    if depth > max_depth || !directory.exists() {
        return;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && entry.file_name().to_string_lossy() == file_name {
            result.push(path);
        } else if path.is_dir() {
            walk_find_named_files(&path, file_name, max_depth, depth + 1, result);
        }
    }
}

fn parse_skill_markdown(skill_file: &Path) -> ApiResult<Value> {
    let content = fs::read_to_string(skill_file)
        .map_err(|error| ApiError::internal(format!("读取 Skill 失败: {error}")))?;
    Ok(Value::Object(parse_frontmatter_map(&content)))
}

fn parse_frontmatter_map(content: &str) -> Map<String, Value> {
    let mut result = Map::new();
    if !content.trim_start().starts_with("---") {
        return result;
    }
    let trimmed = content.trim_start();
    let body = &trimmed[3..];
    let Some(end_index) = body.find("\n---") else {
        return result;
    };
    let frontmatter = body[..end_index].trim();
    for raw_line in frontmatter.lines() {
        let Some((key, value)) = raw_line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim().trim_matches('"').trim_matches('\'');
        if key.is_empty() {
            continue;
        }
        let normalized = key.to_ascii_lowercase();
        if normalized == "disable-model-invocation" || normalized == "user-invocable" {
            result.insert(
                normalized,
                json!(
                    value.to_ascii_lowercase() != "false" && value.to_ascii_lowercase() == "true"
                ),
            );
        } else {
            result.insert(key.to_string(), json!(value));
        }
    }
    result
}

fn collect_skill_source_directories(source_path: &Path) -> Vec<PathBuf> {
    if source_path.join("SKILL.md").exists() {
        return vec![source_path.to_path_buf()];
    }
    let Ok(entries) = fs::read_dir(source_path) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && path.join("SKILL.md").exists())
        .collect()
}

fn sanitize_skill_directory_name(value: &str) -> ApiResult<String> {
    let sanitized = value.trim();
    if sanitized.is_empty()
        || sanitized == "."
        || sanitized == ".."
        || sanitized.contains("..")
        || sanitized
            .chars()
            .any(|ch| ch.is_control() || "\\/:*?\"<>|".contains(ch))
    {
        return Err(ApiError::bad_request(format!("非法 Skill 名称：{value}")));
    }
    Ok(sanitized.to_string())
}

fn copy_directory_recursive(source: &Path, target: &Path) -> ApiResult<()> {
    fs::create_dir_all(target)
        .map_err(|error| ApiError::internal(format!("创建目录失败: {error}")))?;
    let entries = fs::read_dir(source)
        .map_err(|error| ApiError::internal(format!("读取目录失败: {error}")))?;
    for entry in entries.flatten() {
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if source_path.is_dir() {
            copy_directory_recursive(&source_path, &target_path)?;
        } else {
            fs::copy(&source_path, &target_path)
                .map_err(|error| ApiError::internal(format!("复制文件失败: {error}")))?;
        }
    }
    Ok(())
}

fn run_external_command_value(
    command: &str,
    args: &[&str],
    cwd: Option<&PathBuf>,
) -> ApiResult<Value> {
    let mut child = background_command(command);
    child.args(args);
    if let Some(cwd) = cwd {
        child.current_dir(cwd);
    }
    let output = child
        .output()
        .map_err(|error| ApiError::bad_request(format!("执行命令失败: {error}")))?;
    Ok(json!({
        "stdout": String::from_utf8_lossy(&output.stdout).to_string(),
        "stderr": String::from_utf8_lossy(&output.stderr).to_string(),
        "exit_code": output.status.code().unwrap_or(-1),
        "command": command.trim_end_matches(".exe"),
        "args": args,
        "cwd": cwd,
    }))
}

fn build_marketplace_index(plugins_root: &Path) -> std::collections::HashMap<String, Vec<Value>> {
    let mut index = std::collections::HashMap::new();
    let marketplace_root = plugins_root.join("marketplaces");
    let Ok(entries) = fs::read_dir(&marketplace_root) else {
        return index;
    };
    for entry in entries.flatten() {
        if entry.path().is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            index.insert(name.clone(), read_marketplace_plugins(plugins_root, &name));
        }
    }
    index
}

fn read_marketplace_plugins(plugins_root: &Path, name: &str) -> Vec<Value> {
    let path = plugins_root
        .join("marketplaces")
        .join(name)
        .join(".claude-plugin")
        .join("marketplace.json");
    let raw = read_json_file_if_exists(&path)
        .ok()
        .flatten()
        .unwrap_or_else(|| json!({}));
    let mut plugins = raw
        .get("plugins")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|entry| {
            let name = entry.get("name").and_then(Value::as_str)?;
            Some(json!({
                "name": name,
                "description": entry.get("description").and_then(Value::as_str),
                "author": entry.get("author").and_then(|author| author.get("name")).and_then(Value::as_str),
                "homepage": entry.get("homepage").and_then(Value::as_str),
                "category": entry.get("category").and_then(Value::as_str),
            }))
        })
        .collect::<Vec<_>>();
    plugins.sort_by(|left, right| {
        left.get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .cmp(right.get("name").and_then(Value::as_str).unwrap_or(""))
    });
    plugins
}

fn split_plugin_id(plugin_id: &str) -> (String, String) {
    let mut parts = plugin_id.splitn(2, '@');
    (
        parts.next().unwrap_or_default().to_string(),
        parts.next().unwrap_or_default().to_string(),
    )
}

fn trim_remote_branch_prefix(branch: &str, remote: &str) -> String {
    branch
        .strip_prefix(&format!("{remote}/"))
        .unwrap_or(branch)
        .to_string()
}

fn slash_command(
    id: &str,
    name: &str,
    slash: &str,
    title: &str,
    description: &str,
    source: &str,
    action: &str,
    source_label: &str,
    local_action_id: Option<&str>,
) -> Value {
    let category = match name {
        "context" | "cost" => "context",
        _ => "session",
    };
    json!({
        "id": id,
        "name": name,
        "slash": slash,
        "title": title,
        "description": description,
        "source": source,
        "action": action,
        "sourceLabel": source_label,
        "localActionId": local_action_id,
        "category": category,
        "agentScope": ["claude"],
    })
}

fn list_markdown_slash_commands(project_path: Option<&str>) -> Vec<Value> {
    let home = home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut sources = vec![(
        home.join(".claude").join("commands"),
        "user",
        "User command",
        None,
    )];
    let plugin_roots = collect_plugin_command_roots(&home);
    if let Some(project) = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sources.push((
            PathBuf::from(project).join(".claude").join("commands"),
            "project",
            "Project command",
            None,
        ));
    }
    sources.extend(plugin_roots);
    let mut commands = Vec::new();
    for (root, source, source_label, namespace) in sources {
        for file in find_markdown_files(&root, 10) {
            if let Some(command) = build_markdown_slash_command(
                &root,
                &file,
                source,
                source_label,
                namespace.as_deref(),
            ) {
                commands.push(command);
            }
        }
    }
    commands
}

fn collect_plugin_command_roots(
    home: &Path,
) -> Vec<(PathBuf, &'static str, &'static str, Option<String>)> {
    let root = home.join(".claude").join("plugins");
    let mut roots = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for file in find_named_files(&root, "COMMANDS_MARKER_DO_NOT_MATCH", 0) {
        let _ = file;
    }
    collect_command_directories(&root, 0, &mut seen, &mut roots);
    roots
}

fn collect_command_directories(
    directory: &Path,
    depth: usize,
    seen: &mut std::collections::HashSet<PathBuf>,
    roots: &mut Vec<(PathBuf, &'static str, &'static str, Option<String>)>,
) {
    if depth > 10 || !directory.exists() {
        return;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if entry
            .file_name()
            .to_string_lossy()
            .eq_ignore_ascii_case("commands")
        {
            let normalized = fs::canonicalize(&path).unwrap_or(path.clone());
            if seen.insert(normalized.clone()) {
                let namespace = resolve_plugin_command_namespace(&normalized);
                roots.push((normalized, "plugin", "plugin", Some(namespace)));
            }
        }
        collect_command_directories(&path, depth + 1, seen, roots);
    }
}

fn find_markdown_files(root: &Path, max_depth: usize) -> Vec<PathBuf> {
    let mut result = Vec::new();
    walk_find_markdown_files(root, max_depth, 0, &mut result);
    result
}

fn walk_find_markdown_files(
    directory: &Path,
    max_depth: usize,
    depth: usize,
    result: &mut Vec<PathBuf>,
) {
    if depth > max_depth || !directory.exists() {
        return;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file()
            && path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        {
            result.push(path);
        } else if path.is_dir() {
            walk_find_markdown_files(&path, max_depth, depth + 1, result);
        }
    }
}

fn build_markdown_slash_command(
    root: &Path,
    file: &Path,
    source: &str,
    source_label: &str,
    namespace: Option<&str>,
) -> Option<Value> {
    let relative = file.strip_prefix(root).ok()?;
    let mut segments: Vec<String> = relative
        .components()
        .filter_map(|component| component.as_os_str().to_str().map(ToString::to_string))
        .collect();
    let file_name = segments.pop()?;
    let stem = Path::new(&file_name).file_stem()?.to_str()?;
    let command_name = if stem == "index" || stem == "$ARGUMENTS" {
        if segments.is_empty() {
            return None;
        }
        segments.join(":")
    } else if segments.is_empty() {
        stem.to_string()
    } else {
        format!("{}:{stem}", segments.join(":"))
    };
    let mut normalized = normalize_slash_command_name(&command_name);
    if source == "plugin" {
        normalized = format!("{}:{normalized}", namespace.unwrap_or("plugin"));
    }
    let content = fs::read_to_string(file).ok()?;
    let frontmatter = parse_frontmatter_map(&content);
    if source == "plugin"
        && frontmatter
            .get("disable-model-invocation")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return None;
    }
    Some(json!({
        "id": format!("{source}:{}", file.display()),
        "name": normalized,
        "slash": format!("/{normalized}"),
        "title": humanize_slash_command_name(&command_name),
        "description": frontmatter.get("description").and_then(Value::as_str),
        "argumentHint": frontmatter.get("argument-hint").or_else(|| frontmatter.get("argument_hint")).and_then(Value::as_str),
        "source": source,
        "action": "passthrough",
        "sourceLabel": source_label,
        "agentScope": ["claude"],
    }))
}

fn list_skill_slash_commands(project_path: Option<&str>) -> Vec<Value> {
    let skills = list_codex_skills_value(project_path);
    let mut commands = Vec::new();
    for skill in skills
        .get("skills")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let Some(name) = skill.get("name").and_then(Value::as_str) else {
            continue;
        };
        let normalized = normalize_slash_command_name(name);
        if normalized.is_empty() {
            continue;
        }
        let description = skill
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("");
        commands.push(json!({
            "id": format!("skill:{}", skill.get("path").and_then(Value::as_str).unwrap_or(name)),
            "name": normalized,
            "slash": format!("/{normalized}"),
            "title": humanize_slash_command_name(&normalized),
            "description": if description.is_empty() { format!("插入 {normalized} 工作流模板。") } else { description.to_string() },
            "source": "skill",
            "action": "insert-template",
            "template": build_skill_template(name, description),
            "sourceLabel": format!("{} skill", skill.get("source").and_then(Value::as_str).unwrap_or("user")),
            "agentScope": ["claude"],
        }));
    }
    commands
}

fn build_skill_template(name: &str, description: &str) -> String {
    if normalize_slash_command_name(name) == "brainstorming" {
        return [
            "我们先做一轮结构化 brainstorming，再进入实现。",
            "",
            "目标 / 想法：",
            "- ",
            "",
            "当前上下文：",
            "- ",
            "",
            "约束：",
            "- ",
            "",
            "我希望你先做的事：",
            "- 给出 2-3 种方案",
            "- 推荐一个方向并解释取舍",
            "- 先把设计讲清楚，不急着写代码",
        ]
        .join("\n");
    }
    [
        format!("请按 “{name}” 的思路来帮我推进这件事。"),
        if description.is_empty() {
            String::new()
        } else {
            format!("参考意图：{description}")
        },
        String::new(),
        "任务：".to_string(),
        "- ".to_string(),
        String::new(),
        "上下文：".to_string(),
        "- ".to_string(),
        String::new(),
        "约束：".to_string(),
        "- ".to_string(),
        String::new(),
        "期望输出：".to_string(),
        "- ".to_string(),
    ]
    .into_iter()
    .filter(|line| !line.is_empty())
    .collect::<Vec<_>>()
    .join("\n")
}

fn normalize_slash_command_name(value: &str) -> String {
    let mut result = String::new();
    let mut last_separator = false;
    for character in value.trim().trim_start_matches('/').chars() {
        let next = if character == '\\' || character == '/' {
            Some(':')
        } else if character.is_whitespace() {
            Some('-')
        } else if character == ':' {
            Some(':')
        } else {
            Some(character.to_ascii_lowercase())
        };
        if let Some(character) = next {
            if (character == ':' || character == '-') && last_separator {
                continue;
            }
            last_separator = character == ':' || character == '-';
            result.push(character);
        }
    }
    result.trim_matches('-').trim_matches(':').to_string()
}

fn humanize_slash_command_name(value: &str) -> String {
    normalize_slash_command_name(value)
        .split(':')
        .map(|segment| {
            segment
                .split('-')
                .filter(|word| !word.is_empty())
                .map(|word| {
                    let mut chars = word.chars();
                    match chars.next() {
                        Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                        None => String::new(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join(" / ")
}

fn resolve_plugin_command_namespace(directory: &Path) -> String {
    let parts: Vec<String> = directory
        .components()
        .filter_map(|component| component.as_os_str().to_str().map(ToString::to_string))
        .collect();
    let Some(index) = parts
        .iter()
        .position(|part| part.eq_ignore_ascii_case("commands"))
    else {
        return "plugin".to_string();
    };
    let plugin_segment =
        if index >= 2 && is_version_like(parts.get(index.saturating_sub(1)).map(String::as_str)) {
            parts.get(index - 2)
        } else {
            parts.get(index.saturating_sub(1))
        };
    normalize_slash_namespace(plugin_segment.map(String::as_str).unwrap_or("plugin"))
}

fn normalize_slash_namespace(value: &str) -> String {
    let mut result = String::new();
    let mut last_dash = false;
    for character in value.trim().chars() {
        let next = if character.is_ascii_alphanumeric() {
            character.to_ascii_lowercase()
        } else {
            '-'
        };
        if next == '-' && last_dash {
            continue;
        }
        last_dash = next == '-';
        result.push(next);
    }
    let trimmed = result.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "plugin".to_string()
    } else {
        trimmed
    }
}

fn is_version_like(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };
    !value.is_empty()
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '.' || character == '-'
        })
        && value
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_digit())
}

fn sanitize_mcp_segment(value: &str) -> String {
    let mut result = String::new();
    let mut last_underscore = false;
    for character in value.trim().chars() {
        let next = if character.is_ascii_alphanumeric() {
            character.to_ascii_lowercase()
        } else {
            '_'
        };
        if next == '_' && last_underscore {
            continue;
        }
        last_underscore = next == '_';
        result.push(next);
    }
    let trimmed = result.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "server".to_string()
    } else {
        trimmed
    }
}

fn normalize_sort_slash_commands(commands: Vec<Value>) -> Vec<Value> {
    let mut deduped: std::collections::HashMap<String, Value> = std::collections::HashMap::new();
    for command in commands {
        let slash = command
            .get("slash")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if slash.is_empty() {
            continue;
        }
        let replace = deduped
            .get(&slash)
            .map(|current| {
                slash_source_priority(command.get("source").and_then(Value::as_str).unwrap_or(""))
                    > slash_source_priority(
                        current.get("source").and_then(Value::as_str).unwrap_or(""),
                    )
            })
            .unwrap_or(true);
        if replace {
            deduped.insert(slash, command);
        }
    }
    let mut values: Vec<Value> = deduped.into_values().collect();
    values.sort_by(|left, right| {
        let left_source = left.get("source").and_then(Value::as_str).unwrap_or("");
        let right_source = right.get("source").and_then(Value::as_str).unwrap_or("");
        let source_delta = slash_source_order(left_source).cmp(&slash_source_order(right_source));
        if source_delta != std::cmp::Ordering::Equal {
            return source_delta;
        }
        left.get("slash")
            .and_then(Value::as_str)
            .unwrap_or("")
            .cmp(right.get("slash").and_then(Value::as_str).unwrap_or(""))
    });
    values
}

fn slash_source_priority(source: &str) -> i32 {
    match source {
        "app" => 700,
        "builtin" => 600,
        "project" => 500,
        "user" => 400,
        "plugin" => 300,
        "skill" => 200,
        "mcp" => 100,
        _ => 0,
    }
}

fn slash_source_order(source: &str) -> i32 {
    match source {
        "builtin" => 1,
        "project" | "user" => 2,
        "plugin" | "skill" => 3,
        "mcp" => 4,
        "app" => 5,
        _ => 99,
    }
}

fn resolve_usage_range_days(value: Option<&String>) -> ApiResult<Option<i64>> {
    let Some(value) = value
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
    else {
        return Ok(None);
    };
    if value == "all" {
        return Ok(None);
    }
    match value {
        "1" | "7" | "30" | "90" => value.parse::<i64>().map(Some).map_err(|error| {
            ApiError::bad_request_json(format!("不支持的使用情况统计范围: {error}"))
        }),
        _ => Err(ApiError::bad_request_json("不支持的使用情况统计范围")),
    }
}

fn read_usage_stats(
    connection: &Connection,
    range_days: Option<i64>,
    project_id: Option<&str>,
    provider_id: Option<&str>,
) -> ApiResult<Value> {
    let project_filter = project_id.filter(|value| !value.trim().is_empty());
    let start_date = range_days.map(build_usage_range_start_date);
    let project_option_rows = read_usage_project_rows(connection, None, None)?;
    let thread_rows = read_usage_thread_rows(connection, start_date.as_deref(), project_filter)?;
    let (totals, project_rows, provider_rows, thread_rows) = if let Some(provider_id) = provider_id
    {
        aggregate_usage_rows_for_provider(thread_rows, provider_id)?
    } else {
        (
            read_usage_totals(connection, start_date.as_deref(), project_filter)?,
            read_usage_project_rows(connection, start_date.as_deref(), project_filter)?,
            read_usage_provider_rows(connection, start_date.as_deref(), project_filter)?,
            thread_rows,
        )
    };
    let day_rows = read_usage_day_rows(connection, project_filter, provider_id)?;
    Ok(json!({
        "generatedAt": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "totals": totals,
        "projectOptions": project_option_rows,
        "byProvider": provider_rows,
        "byProject": project_rows,
        "byThread": thread_rows,
        "byDay": day_rows,
    }))
}

fn aggregate_usage_rows_for_provider(
    thread_rows: Value,
    provider_id: &str,
) -> ApiResult<(Value, Value, Value, Value)> {
    let filtered = thread_rows
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|row| row.get("provider").and_then(Value::as_str) == Some(provider_id))
        .collect::<Vec<_>>();
    let mut totals = usage_totals_json(0, 0, 0, 0, 0, 0, 0, 0, 0, 0.0);
    let mut project_rows = Vec::<Value>::new();
    for row in &filtered {
        merge_usage_totals_into(&mut totals, row);
        let project_id = row
            .get("projectId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if let Some(project) = project_rows
            .iter_mut()
            .find(|item| item.get("projectId").and_then(Value::as_str) == Some(project_id))
        {
            merge_usage_totals_into(project, row);
            set_latest_usage_date(project, row.get("lastUsedAt"));
        } else {
            project_rows.push(merge_json_objects(
                json!({
                    "projectId": project_id,
                    "projectName": row.get("projectName").cloned().unwrap_or(Value::Null),
                    "projectPath": row.get("workingDirectory").cloned().unwrap_or(Value::Null),
                    "lastUsedAt": row.get("lastUsedAt").cloned().unwrap_or(Value::Null),
                }),
                usage_totals_from_value(row),
            ));
        }
    }
    if let Some(object) = totals.as_object_mut() {
        object.insert("projects".to_string(), json!(project_rows.len()));
    }
    project_rows.sort_by(sort_usage_values_desc);
    let provider_rows = build_usage_provider_rows(filtered.clone())?;
    Ok((
        totals,
        Value::Array(project_rows),
        provider_rows,
        Value::Array(filtered),
    ))
}

fn build_usage_range_start_date(range_days: i64) -> String {
    let today = chrono::Local::now().date_naive();
    let start = today - chrono::Duration::days(range_days.saturating_sub(1));
    start.format("%Y-%m-%d").to_string()
}

fn usage_aggregate_ctes(start_date: Option<&str>) -> String {
    if let Some(start_date) = start_date {
        return format!(
            r#"
    WITH turn_usage AS (
      SELECT
        thread_id,
        turn_id,
        MAX(COALESCE(input_tokens, 0)) AS inputTokens,
        MAX(COALESCE(output_tokens, 0)) AS outputTokens,
        MAX(COALESCE(cache_creation_input_tokens, 0)) AS cacheCreationInputTokens,
        MAX(COALESCE(cache_read_input_tokens, 0)) AS cacheReadInputTokens,
        MAX(COALESCE(total_cost_usd, 0)) AS totalCostUsd,
        MAX(COALESCE(duration_ms, 0)) AS durationMs
      FROM messages
      GROUP BY thread_id, turn_id
    ),
    turn_dates AS (
      SELECT
        thread_id,
        turn_id,
        strftime('%Y-%m-%dT%H:%M:%fZ', usageStartedAtMs / 1000.0, 'unixepoch') AS createdAt,
        date(usageStartedAtMs / 1000.0, 'unixepoch', 'localtime') AS usageDate
      FROM (
        SELECT
          thread_id,
          turn_id,
          MIN(
            CASE
              WHEN started_at_ms IS NOT NULL THEN started_at_ms
              ELSE CAST(strftime('%s', created_at) AS INTEGER) * 1000
            END
          ) AS usageStartedAtMs
        FROM messages
        GROUP BY thread_id, turn_id
      )
    ),
    turn_message_counts AS (
      SELECT thread_id, turn_id, COUNT(*) AS messages
      FROM messages
      GROUP BY thread_id, turn_id
    ),
    turn_tool_counts AS (
      SELECT thread_id, turn_id, COUNT(*) AS toolCalls
      FROM tool_calls
      GROUP BY thread_id, turn_id
    ),
    filtered_turn_dates AS (
      SELECT thread_id, turn_id, createdAt, usageDate
      FROM turn_dates
      WHERE usageDate IS NOT NULL AND usageDate >= '{}'
    ),
    thread_usage AS (
      SELECT
        tu.thread_id,
        SUM(tu.inputTokens) AS inputTokens,
        SUM(tu.outputTokens) AS outputTokens,
        SUM(tu.cacheCreationInputTokens) AS cacheCreationInputTokens,
        SUM(tu.cacheReadInputTokens) AS cacheReadInputTokens,
        SUM(tu.totalCostUsd) AS totalCostUsd,
        SUM(tu.durationMs) AS durationMs
      FROM turn_usage tu
      INNER JOIN filtered_turn_dates ftd
        ON ftd.thread_id = tu.thread_id AND ftd.turn_id = tu.turn_id
      GROUP BY tu.thread_id
    ),
    message_counts AS (
      SELECT tmc.thread_id, SUM(tmc.messages) AS messages
      FROM turn_message_counts tmc
      INNER JOIN filtered_turn_dates ftd
        ON ftd.thread_id = tmc.thread_id AND ftd.turn_id = tmc.turn_id
      GROUP BY tmc.thread_id
    ),
    tool_counts AS (
      SELECT ttc.thread_id, SUM(ttc.toolCalls) AS toolCalls
      FROM turn_tool_counts ttc
      INNER JOIN filtered_turn_dates ftd
        ON ftd.thread_id = ttc.thread_id AND ftd.turn_id = ttc.turn_id
      GROUP BY ttc.thread_id
    ),
    thread_last_used AS (
      SELECT thread_id, MAX(createdAt) AS lastUsedAt
      FROM filtered_turn_dates
      GROUP BY thread_id
    ),
    active_threads AS (
      SELECT DISTINCT thread_id
      FROM filtered_turn_dates
    )
    "#,
            start_date
        );
    }
    r#"
    WITH turn_usage AS (
      SELECT
        thread_id,
        turn_id,
        MAX(COALESCE(input_tokens, 0)) AS inputTokens,
        MAX(COALESCE(output_tokens, 0)) AS outputTokens,
        MAX(COALESCE(cache_creation_input_tokens, 0)) AS cacheCreationInputTokens,
        MAX(COALESCE(cache_read_input_tokens, 0)) AS cacheReadInputTokens,
        MAX(COALESCE(total_cost_usd, 0)) AS totalCostUsd,
        MAX(COALESCE(duration_ms, 0)) AS durationMs
      FROM messages
      GROUP BY thread_id, turn_id
    ),
    turn_dates AS (
      SELECT
        thread_id,
        turn_id,
        strftime('%Y-%m-%dT%H:%M:%fZ', usageStartedAtMs / 1000.0, 'unixepoch') AS createdAt,
        date(usageStartedAtMs / 1000.0, 'unixepoch', 'localtime') AS usageDate
      FROM (
        SELECT
          thread_id,
          turn_id,
          MIN(
            CASE
              WHEN started_at_ms IS NOT NULL THEN started_at_ms
              ELSE CAST(strftime('%s', created_at) AS INTEGER) * 1000
            END
          ) AS usageStartedAtMs
        FROM messages
        GROUP BY thread_id, turn_id
      )
    ),
    turn_message_counts AS (
      SELECT thread_id, turn_id, COUNT(*) AS messages
      FROM messages
      GROUP BY thread_id, turn_id
    ),
    turn_tool_counts AS (
      SELECT thread_id, turn_id, COUNT(*) AS toolCalls
      FROM tool_calls
      GROUP BY thread_id, turn_id
    ),
    thread_usage AS (
      SELECT
        thread_id,
        SUM(inputTokens) AS inputTokens,
        SUM(outputTokens) AS outputTokens,
        SUM(cacheCreationInputTokens) AS cacheCreationInputTokens,
        SUM(cacheReadInputTokens) AS cacheReadInputTokens,
        SUM(totalCostUsd) AS totalCostUsd,
        SUM(durationMs) AS durationMs
      FROM turn_usage
      GROUP BY thread_id
    ),
    message_counts AS (
      SELECT thread_id, COUNT(*) AS messages
      FROM messages
      GROUP BY thread_id
    ),
    tool_counts AS (
      SELECT thread_id, COUNT(*) AS toolCalls
      FROM tool_calls
      GROUP BY thread_id
    )
    "#
    .to_string()
}

fn read_usage_totals(
    connection: &Connection,
    start_date: Option<&str>,
    project_id: Option<&str>,
) -> ApiResult<Value> {
    let totals_projects_sql = if start_date.is_some() || project_id.is_some() {
        "COUNT(DISTINCT t.project_id) AS projects"
    } else {
        "(SELECT COUNT(*) FROM projects) AS projects"
    };
    let from_clause = if start_date.is_some() {
        format!(
            r#"
          FROM active_threads at
          INNER JOIN threads t ON t.id = at.thread_id
          LEFT JOIN thread_usage tu ON tu.thread_id = t.id
          LEFT JOIN message_counts mc ON mc.thread_id = t.id
          LEFT JOIN tool_counts tc ON tc.thread_id = t.id
          {}
        "#,
            if project_id.is_some() {
                "WHERE t.project_id = ?"
            } else {
                ""
            }
        )
    } else {
        format!(
            r#"
          FROM threads t
          LEFT JOIN thread_usage tu ON tu.thread_id = t.id
          LEFT JOIN message_counts mc ON mc.thread_id = t.id
          LEFT JOIN tool_counts tc ON tc.thread_id = t.id
          {}
        "#,
            if project_id.is_some() {
                "WHERE t.project_id = ?"
            } else {
                ""
            }
        )
    };
    let sql = format!(
        r#"
        {}
        SELECT
          {},
          COUNT(t.id) AS threads,
          COALESCE(SUM(mc.messages), 0) AS messages,
          COALESCE(SUM(tc.toolCalls), 0) AS toolCalls,
          COALESCE(SUM(tu.inputTokens), 0) AS inputTokens,
          COALESCE(SUM(tu.outputTokens), 0) AS outputTokens,
          COALESCE(SUM(tu.cacheCreationInputTokens), 0) AS cacheCreationInputTokens,
          COALESCE(SUM(tu.cacheReadInputTokens), 0) AS cacheReadInputTokens,
          COALESCE(SUM(tu.durationMs), 0) AS durationMs,
          COALESCE(SUM(tu.totalCostUsd), 0) AS totalCostUsd
        {}
        "#,
        usage_aggregate_ctes(start_date),
        totals_projects_sql,
        from_clause
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| ApiError::internal(format!("读取使用情况失败: {error}")))?;
    let mapper = |row: &rusqlite::Row<'_>| {
        Ok(usage_totals_json(
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
            row.get(6)?,
            row.get(7)?,
            row.get(8)?,
            row.get(9)?,
        ))
    };
    if let Some(project_id) = project_id {
        statement
            .query_row(params![project_id], mapper)
            .map_err(|error| ApiError::internal(format!("读取使用情况失败: {error}")))
    } else {
        statement
            .query_row([], mapper)
            .map_err(|error| ApiError::internal(format!("读取使用情况失败: {error}")))
    }
}

fn read_usage_project_rows(
    connection: &Connection,
    start_date: Option<&str>,
    project_id: Option<&str>,
) -> ApiResult<Value> {
    let from_clause = if start_date.is_some() {
        "FROM active_threads at INNER JOIN threads t ON t.id = at.thread_id INNER JOIN projects p ON p.id = t.project_id"
    } else {
        "FROM projects p LEFT JOIN threads t ON t.project_id = p.id"
    };
    let last_used = if start_date.is_some() {
        "tlu.lastUsedAt"
    } else {
        "COALESCE(t.updated_at, p.updated_at)"
    };
    let sql = format!(
        r#"
        {}
        SELECT
          p.id,
          p.name,
          p.path,
          1 AS projects,
          COUNT(DISTINCT t.id) AS threads,
          COALESCE(SUM(mc.messages), 0) AS messages,
          COALESCE(SUM(tc.toolCalls), 0) AS toolCalls,
          COALESCE(SUM(tu.inputTokens), 0) AS inputTokens,
          COALESCE(SUM(tu.outputTokens), 0) AS outputTokens,
          COALESCE(SUM(tu.cacheCreationInputTokens), 0) AS cacheCreationInputTokens,
          COALESCE(SUM(tu.cacheReadInputTokens), 0) AS cacheReadInputTokens,
          COALESCE(SUM(tu.durationMs), 0) AS durationMs,
          COALESCE(SUM(tu.totalCostUsd), 0) AS totalCostUsd,
          MAX({}) AS lastUsedAt
        {}
        LEFT JOIN thread_usage tu ON tu.thread_id = t.id
        LEFT JOIN message_counts mc ON mc.thread_id = t.id
        LEFT JOIN tool_counts tc ON tc.thread_id = t.id
        {}
        {}
        GROUP BY p.id, p.name, p.path
        ORDER BY inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens DESC,
          threads DESC,
          p.updated_at DESC
        "#,
        usage_aggregate_ctes(start_date),
        last_used,
        from_clause,
        if start_date.is_some() {
            "LEFT JOIN thread_last_used tlu ON tlu.thread_id = t.id"
        } else {
            ""
        },
        if project_id.is_some() {
            "WHERE p.id = ?"
        } else {
            ""
        }
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| ApiError::internal(format!("读取使用情况失败: {error}")))?;
    let mapper = |row: &rusqlite::Row<'_>| {
        let totals = usage_totals_json(
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
            row.get(6)?,
            row.get(7)?,
            row.get(8)?,
            row.get(9)?,
            row.get(10)?,
            row.get(11)?,
            row.get(12)?,
        );
        Ok(merge_json_objects(
            json!({
                "projectId": row.get::<_, String>(0)?,
                "projectName": row.get::<_, String>(1)?,
                "projectPath": row.get::<_, String>(2)?,
                "lastUsedAt": row.get::<_, Option<String>>(13)?,
            }),
            totals,
        ))
    };
    let rows = if let Some(project_id) = project_id {
        statement.query_map(params![project_id], mapper)
    } else {
        statement.query_map([], mapper)
    }
    .map_err(|error| ApiError::internal(format!("读取使用情况失败: {error}")))?;
    Ok(Value::Array(collect_rows(rows, "读取使用情况失败")?))
}

fn read_usage_thread_rows(
    connection: &Connection,
    start_date: Option<&str>,
    project_id: Option<&str>,
) -> ApiResult<Value> {
    let from_clause = if start_date.is_some() {
        "FROM active_threads at INNER JOIN threads t ON t.id = at.thread_id"
    } else {
        "FROM threads t"
    };
    let last_used = if start_date.is_some() {
        "tlu.lastUsedAt"
    } else {
        "t.updated_at"
    };
    let sql = format!(
        r#"
        {}
        SELECT
          t.id,
          t.project_id,
          p.name,
          COALESCE(NULLIF(t.title, ''), NULLIF(t.session_id, ''), t.id) AS title,
          COALESCE(t.session_id, ''),
          COALESCE(t.provider, 'unknown'),
          COALESCE(t.model, '未配置'),
          COALESCE(t.working_directory, ''),
          t.updated_at,
          {} AS lastUsedAt,
          0 AS projects,
          1 AS threads,
          COALESCE(mc.messages, 0) AS messages,
          COALESCE(tc.toolCalls, 0) AS toolCalls,
          COALESCE(tu.inputTokens, 0) AS inputTokens,
          COALESCE(tu.outputTokens, 0) AS outputTokens,
          COALESCE(tu.cacheCreationInputTokens, 0) AS cacheCreationInputTokens,
          COALESCE(tu.cacheReadInputTokens, 0) AS cacheReadInputTokens,
          COALESCE(tu.durationMs, 0) AS durationMs,
          COALESCE(tu.totalCostUsd, 0) AS totalCostUsd
        {}
        INNER JOIN projects p ON p.id = t.project_id
        LEFT JOIN thread_usage tu ON tu.thread_id = t.id
        LEFT JOIN message_counts mc ON mc.thread_id = t.id
        LEFT JOIN tool_counts tc ON tc.thread_id = t.id
        {}
        {}
        ORDER BY totalCostUsd DESC,
          inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens DESC,
          t.updated_at DESC
        "#,
        usage_aggregate_ctes(start_date),
        last_used,
        from_clause,
        if start_date.is_some() {
            "LEFT JOIN thread_last_used tlu ON tlu.thread_id = t.id"
        } else {
            ""
        },
        if project_id.is_some() {
            "WHERE t.project_id = ?"
        } else {
            ""
        }
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| ApiError::internal(format!("读取使用情况失败: {error}")))?;
    let mapper = |row: &rusqlite::Row<'_>| {
        let totals = usage_totals_json(
            row.get(10)?,
            row.get(11)?,
            row.get(12)?,
            row.get(13)?,
            row.get(14)?,
            row.get(15)?,
            row.get(16)?,
            row.get(17)?,
            row.get(18)?,
            row.get(19)?,
        );
        Ok(merge_json_objects(
            json!({
                "threadId": row.get::<_, String>(0)?,
                "projectId": row.get::<_, String>(1)?,
                "projectName": row.get::<_, String>(2)?,
                "title": row.get::<_, String>(3)?,
                "sessionId": row.get::<_, String>(4)?,
                "provider": row.get::<_, String>(5)?,
                "model": row.get::<_, String>(6)?,
                "workingDirectory": row.get::<_, String>(7)?,
                "updatedAt": row.get::<_, Option<String>>(8)?,
                "lastUsedAt": row.get::<_, Option<String>>(9)?,
            }),
            totals,
        ))
    };
    let rows = if let Some(project_id) = project_id {
        statement.query_map(params![project_id], mapper)
    } else {
        statement.query_map([], mapper)
    }
    .map_err(|error| ApiError::internal(format!("读取使用情况失败: {error}")))?;
    Ok(Value::Array(collect_rows(rows, "读取使用情况失败")?))
}

fn read_usage_day_rows(
    connection: &Connection,
    project_id: Option<&str>,
    provider_id: Option<&str>,
) -> ApiResult<Value> {
    let sql = format!(
        r#"
        {}
        SELECT
          td.usageDate AS usageDate,
          0 AS projects,
          COUNT(DISTINCT td.thread_id) AS threads,
          COALESCE(SUM(tmc.messages), 0) AS messages,
          COALESCE(SUM(ttc.toolCalls), 0) AS toolCalls,
          COALESCE(SUM(tu.inputTokens), 0) AS inputTokens,
          COALESCE(SUM(tu.outputTokens), 0) AS outputTokens,
          COALESCE(SUM(tu.cacheCreationInputTokens), 0) AS cacheCreationInputTokens,
          COALESCE(SUM(tu.cacheReadInputTokens), 0) AS cacheReadInputTokens,
          COALESCE(SUM(tu.durationMs), 0) AS durationMs,
          COALESCE(SUM(tu.totalCostUsd), 0) AS totalCostUsd
        FROM turn_dates td
        INNER JOIN threads t ON t.id = td.thread_id
        LEFT JOIN turn_usage tu ON tu.thread_id = td.thread_id AND tu.turn_id = td.turn_id
        LEFT JOIN turn_message_counts tmc ON tmc.thread_id = td.thread_id AND tmc.turn_id = td.turn_id
        LEFT JOIN turn_tool_counts ttc ON ttc.thread_id = td.thread_id AND ttc.turn_id = td.turn_id
        WHERE td.usageDate IS NOT NULL {} {}
        GROUP BY td.usageDate
        ORDER BY td.usageDate ASC
        "#,
        usage_aggregate_ctes(None),
        if project_id.is_some() {
            "AND t.project_id = ?"
        } else {
            ""
        },
        if provider_id.is_some() {
            "AND t.provider = ?"
        } else {
            ""
        }
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| ApiError::internal(format!("读取使用情况失败: {error}")))?;
    let mapper = |row: &rusqlite::Row<'_>| {
        let totals = usage_totals_json(
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
            row.get(6)?,
            row.get(7)?,
            row.get(8)?,
            row.get(9)?,
            row.get(10)?,
        );
        Ok(merge_json_objects(
            json!({ "date": row.get::<_, String>(0)? }),
            totals,
        ))
    };
    let rows = match (project_id, provider_id) {
        (Some(project_id), Some(provider_id)) => {
            statement.query_map(params![project_id, provider_id], mapper)
        }
        (Some(project_id), None) => statement.query_map(params![project_id], mapper),
        (None, Some(provider_id)) => statement.query_map(params![provider_id], mapper),
        (None, None) => statement.query_map([], mapper),
    }
    .map_err(|error| ApiError::internal(format!("读取使用情况失败: {error}")))?;
    Ok(Value::Array(collect_rows(rows, "读取使用情况失败")?))
}

fn read_usage_provider_rows(
    connection: &Connection,
    start_date: Option<&str>,
    project_id: Option<&str>,
) -> ApiResult<Value> {
    let from_clause = if start_date.is_some() {
        "FROM active_threads at INNER JOIN threads t ON t.id = at.thread_id"
    } else {
        "FROM threads t"
    };
    let last_used = if start_date.is_some() {
        "tlu.lastUsedAt"
    } else {
        "t.updated_at"
    };
    let sql = format!(
        r#"
        {}
        SELECT
          t.provider AS provider,
          COALESCE(t.model, '未配置') AS model,
          0 AS projects,
          COUNT(t.id) AS threads,
          COALESCE(SUM(mc.messages), 0) AS messages,
          COALESCE(SUM(tc.toolCalls), 0) AS toolCalls,
          COALESCE(SUM(tu.inputTokens), 0) AS inputTokens,
          COALESCE(SUM(tu.outputTokens), 0) AS outputTokens,
          COALESCE(SUM(tu.cacheCreationInputTokens), 0) AS cacheCreationInputTokens,
          COALESCE(SUM(tu.cacheReadInputTokens), 0) AS cacheReadInputTokens,
          COALESCE(SUM(tu.durationMs), 0) AS durationMs,
          COALESCE(SUM(tu.totalCostUsd), 0) AS totalCostUsd,
          MAX({}) AS lastUsedAt
        {}
        LEFT JOIN thread_usage tu ON tu.thread_id = t.id
        LEFT JOIN message_counts mc ON mc.thread_id = t.id
        LEFT JOIN tool_counts tc ON tc.thread_id = t.id
        {}
        {}
        GROUP BY t.provider, COALESCE(t.model, '未配置')
        ORDER BY inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens DESC,
          threads DESC,
          provider ASC
        "#,
        usage_aggregate_ctes(start_date),
        last_used,
        from_clause,
        if start_date.is_some() {
            "LEFT JOIN thread_last_used tlu ON tlu.thread_id = t.id"
        } else {
            ""
        },
        if project_id.is_some() {
            "WHERE t.project_id = ?"
        } else {
            ""
        }
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| ApiError::internal(format!("读取使用情况失败: {error}")))?;
    let mapper = |row: &rusqlite::Row<'_>| {
        let totals = usage_totals_json(
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
            row.get(6)?,
            row.get(7)?,
            row.get(8)?,
            row.get(9)?,
            row.get(10)?,
            row.get(11)?,
        );
        Ok(merge_json_objects(
            json!({
                "provider": row.get::<_, Option<String>>(0)?.unwrap_or_else(|| "unknown".to_string()),
                "model": row.get::<_, String>(1)?,
                "lastUsedAt": row.get::<_, Option<String>>(12)?,
            }),
            totals,
        ))
    };
    let rows = if let Some(project_id) = project_id {
        statement.query_map(params![project_id], mapper)
    } else {
        statement.query_map([], mapper)
    }
    .map_err(|error| ApiError::internal(format!("读取使用情况失败: {error}")))?;
    build_usage_provider_rows(collect_rows(rows, "读取使用情况失败")?)
}

fn build_usage_provider_rows(rows: Vec<Value>) -> ApiResult<Value> {
    let mut groups: Vec<Value> = Vec::new();
    for row in rows {
        let model = row
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or("未配置")
            .to_string();
        let provider_info = infer_usage_provider(
            row.get("provider")
                .and_then(Value::as_str)
                .unwrap_or("unknown"),
            &model,
        );
        let group_key = format!(
            "{}:{}:{}",
            provider_info.provider_key,
            provider_info.host.clone().unwrap_or_default(),
            provider_info.provider
        );
        let model_row = merge_json_objects(
            json!({
                "model": model,
                "lastUsedAt": row.get("lastUsedAt").cloned().unwrap_or(Value::Null),
            }),
            usage_totals_from_value(&row),
        );
        if let Some(group) = groups
            .iter_mut()
            .find(|group| group.get("_key").and_then(Value::as_str) == Some(group_key.as_str()))
        {
            merge_usage_totals_into(group, &row);
            set_latest_usage_date(group, row.get("lastUsedAt"));
            if let Some(models) = group.get_mut("models").and_then(Value::as_array_mut) {
                models.push(model_row);
            }
        } else {
            groups.push(merge_json_objects(
                json!({
                    "_key": group_key,
                    "provider": provider_info.provider,
                    "providerKey": provider_info.provider_key,
                    "host": provider_info.host,
                    "inferred": provider_info.inferred,
                    "lastUsedAt": row.get("lastUsedAt").cloned().unwrap_or(Value::Null),
                    "models": [model_row],
                }),
                usage_totals_from_value(&row),
            ));
        }
    }
    for group in &mut groups {
        if let Some(object) = group.as_object_mut() {
            object.remove("_key");
        }
        if let Some(models) = group.get_mut("models").and_then(Value::as_array_mut) {
            models.sort_by(sort_usage_values_desc);
        }
    }
    groups.sort_by(sort_usage_values_desc);
    Ok(Value::Array(groups))
}

struct UsageProviderInfo {
    provider: String,
    provider_key: String,
    host: Option<String>,
    inferred: bool,
}

fn infer_usage_provider(raw_provider: &str, model: &str) -> UsageProviderInfo {
    let normalized_model = model.trim().to_ascii_lowercase();
    let normalized_provider = raw_provider.trim().to_ascii_lowercase();
    if contains_usage_keyword(&normalized_model, &["glm", "zhipu", "bigmodel"]) {
        return UsageProviderInfo {
            provider: "智谱 GLM".to_string(),
            provider_key: "zhipu".to_string(),
            host: Some("open.bigmodel.cn".to_string()),
            inferred: true,
        };
    }
    if contains_usage_keyword(&normalized_model, &["mimo"]) {
        return UsageProviderInfo {
            provider: "Mimo".to_string(),
            provider_key: "mimo".to_string(),
            host: None,
            inferred: true,
        };
    }
    if contains_usage_keyword(&normalized_model, &["minimax"]) {
        return UsageProviderInfo {
            provider: "MiniMax".to_string(),
            provider_key: "minimax".to_string(),
            host: Some("api.minimaxi.com".to_string()),
            inferred: true,
        };
    }
    if contains_usage_keyword(&normalized_model, &["claude", "sonnet", "opus", "haiku"]) {
        return UsageProviderInfo {
            provider: "Anthropic / Claude".to_string(),
            provider_key: "anthropic".to_string(),
            host: Some("api.anthropic.com".to_string()),
            inferred: true,
        };
    }
    if contains_usage_keyword(&normalized_model, &["deepseek"]) {
        return UsageProviderInfo {
            provider: "DeepSeek".to_string(),
            provider_key: "deepseek".to_string(),
            host: Some("api.deepseek.com".to_string()),
            inferred: true,
        };
    }
    if contains_usage_keyword(&normalized_model, &["qwen", "dashscope", "tongyi"]) {
        return UsageProviderInfo {
            provider: "阿里 DashScope".to_string(),
            provider_key: "dashscope".to_string(),
            host: Some("dashscope.aliyuncs.com".to_string()),
            inferred: true,
        };
    }
    if contains_usage_keyword(&normalized_model, &["openrouter"]) {
        return UsageProviderInfo {
            provider: "OpenRouter".to_string(),
            provider_key: "openrouter".to_string(),
            host: Some("openrouter.ai".to_string()),
            inferred: true,
        };
    }
    if !normalized_provider.is_empty() && normalized_provider != "claude-code" {
        return UsageProviderInfo {
            provider: raw_provider.trim().to_string(),
            provider_key: normalized_provider,
            host: None,
            inferred: false,
        };
    }
    UsageProviderInfo {
        provider: "Claude Code".to_string(),
        provider_key: "claude-code".to_string(),
        host: None,
        inferred: false,
    }
}

fn contains_usage_keyword(value: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|keyword| value.contains(keyword))
}

fn merge_usage_totals_into(target: &mut Value, source: &Value) {
    for key in [
        "projects",
        "threads",
        "messages",
        "toolCalls",
        "inputTokens",
        "outputTokens",
        "cacheCreationInputTokens",
        "cacheReadInputTokens",
        "totalTokens",
        "durationMs",
    ] {
        let next = target.get(key).and_then(Value::as_i64).unwrap_or(0)
            + source.get(key).and_then(Value::as_i64).unwrap_or(0);
        if let Some(object) = target.as_object_mut() {
            object.insert(key.to_string(), json!(next));
        }
    }
    let next_cost = target
        .get("totalCostUsd")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        + source
            .get("totalCostUsd")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
    if let Some(object) = target.as_object_mut() {
        object.insert("totalCostUsd".to_string(), json!(next_cost));
    }
}

fn set_latest_usage_date(target: &mut Value, candidate: Option<&Value>) {
    let candidate = candidate.and_then(Value::as_str).unwrap_or("");
    let current = target
        .get("lastUsedAt")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !candidate.is_empty() && (current.is_empty() || candidate > current) {
        if let Some(object) = target.as_object_mut() {
            object.insert("lastUsedAt".to_string(), json!(candidate));
        }
    }
}

fn sort_usage_values_desc(left: &Value, right: &Value) -> std::cmp::Ordering {
    let left_tokens = left.get("totalTokens").and_then(Value::as_i64).unwrap_or(0);
    let right_tokens = right
        .get("totalTokens")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    right_tokens.cmp(&left_tokens).then_with(|| {
        right
            .get("threads")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .cmp(&left.get("threads").and_then(Value::as_i64).unwrap_or(0))
    })
}

fn usage_totals_json(
    projects: i64,
    threads: i64,
    messages: i64,
    tool_calls: i64,
    input_tokens: i64,
    output_tokens: i64,
    cache_creation_input_tokens: i64,
    cache_read_input_tokens: i64,
    duration_ms: i64,
    total_cost_usd: f64,
) -> Value {
    json!({
        "projects": projects,
        "threads": threads,
        "messages": messages,
        "toolCalls": tool_calls,
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "cacheCreationInputTokens": cache_creation_input_tokens,
        "cacheReadInputTokens": cache_read_input_tokens,
        "totalTokens": input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens,
        "durationMs": duration_ms,
        "totalCostUsd": total_cost_usd,
    })
}

fn usage_totals_from_value(value: &Value) -> Value {
    json!({
        "projects": value.get("projects").and_then(Value::as_i64).unwrap_or(0),
        "threads": value.get("threads").and_then(Value::as_i64).unwrap_or(0),
        "messages": value.get("messages").and_then(Value::as_i64).unwrap_or(0),
        "toolCalls": value.get("toolCalls").and_then(Value::as_i64).unwrap_or(0),
        "inputTokens": value.get("inputTokens").and_then(Value::as_i64).unwrap_or(0),
        "outputTokens": value.get("outputTokens").and_then(Value::as_i64).unwrap_or(0),
        "cacheCreationInputTokens": value.get("cacheCreationInputTokens").and_then(Value::as_i64).unwrap_or(0),
        "cacheReadInputTokens": value.get("cacheReadInputTokens").and_then(Value::as_i64).unwrap_or(0),
        "totalTokens": value.get("totalTokens").and_then(Value::as_i64).unwrap_or(0),
        "durationMs": value.get("durationMs").and_then(Value::as_i64).unwrap_or(0),
        "totalCostUsd": value.get("totalCostUsd").and_then(Value::as_f64).unwrap_or(0.0),
    })
}

fn merge_json_objects(mut left: Value, right: Value) -> Value {
    if let (Some(left), Some(right)) = (left.as_object_mut(), right.as_object()) {
        for (key, value) in right {
            left.insert(key.clone(), value.clone());
        }
    }
    left
}

fn resolve_project_relative_directory(project_path: &str, relative: &str) -> ApiResult<String> {
    let path = if relative.trim().is_empty() {
        project_path.to_string()
    } else {
        resolve_project_relative_path(project_path, relative)?
    };
    let metadata = fs::metadata(&path)
        .map_err(|error| ApiError::bad_request(format!("读取项目文件失败: {error}")))?;
    if metadata.is_dir() {
        Ok(path)
    } else {
        Err(ApiError::bad_request("目标不是目录"))
    }
}

fn resolve_project_relative_path(project_path: &str, relative: &str) -> ApiResult<String> {
    let resolved = resolve_workspace_relative_path(project_path, relative)
        .ok_or_else(|| ApiError::bad_request("文件路径必须是项目内的相对路径"))?;
    Ok(resolved.0)
}

fn build_claude_prompt(payload: &ClaudeRunRequest) -> String {
    if let Some(tool_result) = payload.tool_result.as_ref() {
        let content = tool_result
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !content.trim().is_empty() {
            return content.to_string();
        }
    }
    let mut parts = Vec::new();
    if let Some(prompt) = payload
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(prompt.to_string());
    }
    if let Some(blocks) = payload.content_blocks.as_ref().and_then(Value::as_array) {
        for block in blocks {
            if block.get("type").and_then(Value::as_str) == Some("text") {
                if let Some(text) = block
                    .get("text")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                {
                    if !parts.iter().any(|part| part == text) {
                        parts.push(text.to_string());
                    }
                }
            } else if let Some(path) = block.get("path").and_then(Value::as_str) {
                parts.push(format!("附件路径：{path}"));
            }
        }
    }
    parts.join("\n\n")
}

fn summarize_content_blocks(value: Option<&Value>) -> Option<Value> {
    let blocks = value?.as_array()?;
    Some(Value::Array(
        blocks
            .iter()
            .map(|block| {
                let mut summary = block.clone();
                if let Some(object) = summary.as_object_mut() {
                    let block_type = object
                        .get("type")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    match block_type.as_deref() {
                        Some("image") => {
                            let image_bytes = object
                                .get("data")
                                .and_then(Value::as_str)
                                .or_else(|| {
                                    object
                                        .get("source")
                                        .and_then(|source| source.get("data"))
                                        .and_then(Value::as_str)
                                })
                                .map(estimate_base64_bytes)
                                .or_else(|| object.get("size").and_then(Value::as_u64))
                                .unwrap_or_default();
                            object.remove("data");
                            object.remove("source");
                            if image_bytes > 0 {
                                object.insert("imageBytes".to_string(), json!(image_bytes));
                            }
                        }
                        Some("file_text") => {
                            let text_bytes = object
                                .get("text")
                                .and_then(Value::as_str)
                                .map(str::len)
                                .unwrap_or_default();
                            object.remove("text");
                            object.insert("textBytes".to_string(), json!(text_bytes));
                        }
                        _ => {
                            object.remove("data");
                        }
                    }
                }
                summary
            })
            .collect(),
    ))
}

fn estimate_base64_bytes(value: &str) -> u64 {
    let normalized = value
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .collect::<Vec<_>>();
    let padding = normalized
        .iter()
        .rev()
        .take_while(|byte| **byte == b'=')
        .count()
        .min(2);
    ((normalized.len() * 3) / 4).saturating_sub(padding) as u64
}

fn normalize_claude_permission_mode(value: Option<&str>) -> String {
    match value {
        Some("plan") => "plan".to_string(),
        Some("acceptEdits") => "acceptEdits".to_string(),
        Some("auto") => "acceptEdits".to_string(),
        Some("dontAsk") | Some("bypassPermissions") => "bypassPermissions".to_string(),
        _ => "default".to_string(),
    }
}

fn build_claude_run_args(payload: &ClaudeRunRequest, permission_mode: &str) -> Vec<String> {
    let mut args = vec![
        "-p".to_string(),
        "".to_string(),
        "--input-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--include-partial-messages".to_string(),
        "--include-hook-events".to_string(),
        "--permission-prompt-tool".to_string(),
        "stdio".to_string(),
    ];
    if permission_mode == "bypassPermissions" {
        args.push("--dangerously-skip-permissions".to_string());
    } else {
        args.push("--permission-mode".to_string());
        args.push(permission_mode.to_string());
    }
    if let Some(model) = payload
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    if let Some(effort) = payload
        .effort
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if effort == "ultracode" {
            args.push("--settings".to_string());
            args.push(json!({ "ultracode": true }).to_string());
        } else {
            args.push("--effort".to_string());
            args.push(effort.to_string());
        }
    }
    if let Some(session_id) = payload
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        args.push("--resume".to_string());
        args.push(session_id.to_string());
    }
    args
}

fn build_claude_input_message(
    prompt: &str,
    content_blocks: Option<&Value>,
    tool_result: Option<&Value>,
) -> Value {
    if let Some(tool_result) = tool_result {
        if let Some(request_id) = tool_result
            .get("requestId")
            .or_else(|| tool_result.get("request_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let content = tool_result
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let is_error = tool_result
                .get("isError")
                .or_else(|| tool_result.get("is_error"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            return build_claude_tool_result_message(request_id, content, is_error);
        }
    }

    let content = build_claude_content_blocks(prompt, content_blocks);
    json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": content,
        },
    })
}

fn build_claude_content_blocks(prompt: &str, content_blocks: Option<&Value>) -> Vec<Value> {
    let mut content = Vec::new();
    if let Some(blocks) = content_blocks.and_then(Value::as_array) {
        for block in blocks {
            match block.get("type").and_then(Value::as_str) {
                Some("text") => {
                    if let Some(text) = block
                        .get("text")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                    {
                        content.push(json!({ "type": "text", "text": text }));
                    }
                }
                Some("image") => {
                    let mut image_added = false;
                    if let Some(source) = block.get("source") {
                        content.push(json!({ "type": "image", "source": source }));
                        image_added = true;
                    } else if let (Some(data), Some(media_type)) = (
                        block
                            .get("data")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty()),
                        block
                            .get("mimeType")
                            .or_else(|| block.get("mime_type"))
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty()),
                    ) {
                        content.push(json!({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": data,
                            },
                        }));
                        image_added = true;
                    }
                    if let Some(fallback) = build_claude_image_fallback_text(block, image_added) {
                        content.push(json!({ "type": "text", "text": fallback }));
                    }
                }
                Some("file_text") => {
                    if let (Some(path), Some(text)) = (
                        block
                            .get("path")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty()),
                        block
                            .get("text")
                            .and_then(Value::as_str)
                            .filter(|value| !value.is_empty()),
                    ) {
                        content.push(json!({
                            "type": "text",
                            "text": format!(
                                "文件 {} 内容：\n\n{text}",
                                to_model_readable_path(path)
                            ),
                        }));
                    }
                }
                Some("file_reference") => {
                    if let Some(path) = block
                        .get("path")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                    {
                        let mut lines = vec![format!(
                            "文件已作为路径引用提供：{}",
                            to_model_readable_path(path)
                        )];
                        if let Some(reason) = block
                            .get("reason")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                        {
                            lines.push(format!("原因：{reason}"));
                        }
                        lines.push("可使用 Read 等工具按需读取该文件内容。".to_string());
                        content.push(json!({ "type": "text", "text": lines.join("\n") }));
                    }
                }
                Some("attachment_metadata") => {
                    if let (Some(name), Some(reason)) = (
                        block
                            .get("name")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty()),
                        block
                            .get("reason")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty()),
                    ) {
                        content.push(json!({
                            "type": "text",
                            "text": format!("附件未直接发送：{name}\n原因：{reason}"),
                        }));
                    }
                }
                Some("file") | Some("file-reference") | Some("project-file") => {
                    if let Some(path) = block
                        .get("path")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                    {
                        content.push(json!({
                            "type": "text",
                            "text": format!("附件路径：{}", to_model_readable_path(path)),
                        }));
                    }
                }
                _ => {}
            }
        }
    }
    if content.is_empty() {
        let prompt = prompt.trim();
        if !prompt.is_empty() {
            content.push(json!({ "type": "text", "text": prompt }));
        }
    }
    content
}

fn claude_input_message_has_content(message: &Value) -> bool {
    message
        .pointer("/message/content")
        .and_then(Value::as_array)
        .is_some_and(|content| !content.is_empty())
}

fn build_claude_image_fallback_text(block: &Value, image_added: bool) -> Option<String> {
    let path = block
        .get("path")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let mut lines = if image_added {
        vec!["（以下为图片附件信息，多模态模型可直接查看上面的图片，无需读取文件）".to_string()]
    } else {
        vec!["[图片引用]".to_string()]
    };
    if let Some(name) = block
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("名称：{name}"));
    }
    lines.push(format!("路径：{}", to_model_readable_path(path)));
    if !image_added {
        if let Some(media_type) = block
            .get("mimeType")
            .or_else(|| block.get("mime_type"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            lines.push(format!("类型：{media_type}"));
        }
        if let Some(size) = block.get("size").and_then(Value::as_u64) {
            lines.push(format!("大小：{size} bytes"));
        }
        lines.push("请使用 ViewImage 查看这张图片，不要用 Read 或 Grep 读取图片内容。".to_string());
    } else {
        lines.push(
            "如果你无法直接识别上面的图片，请使用 ViewImage 查看该路径，不要用 Read 或 Grep 读取图片内容。"
                .to_string(),
        );
    }
    Some(lines.join("\n"))
}

fn to_model_readable_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn build_claude_tool_result_message(request_id: &str, content: &str, is_error: bool) -> Value {
    json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": request_id,
                "content": content,
                "is_error": is_error,
            }],
        },
    })
}

fn extract_context_markdown_from_payload(payload: &Value) -> String {
    if payload.get("type").and_then(Value::as_str) == Some("result") {
        return payload
            .get("result")
            .and_then(Value::as_str)
            .map(strip_ansi_control_codes)
            .unwrap_or_default();
    }
    if payload.get("type").and_then(Value::as_str) == Some("assistant") {
        return payload
            .pointer("/message/content")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        (item.get("type").and_then(Value::as_str) == Some("text"))
                            .then(|| item.get("text").and_then(Value::as_str))
                            .flatten()
                    })
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default();
    }
    String::new()
}

fn create_context_snapshot_value(
    markdown: &str,
    requested_at_ms: i64,
    duration_ms: i64,
    event_count: i64,
) -> Value {
    let max_chars = 50_000;
    let markdown_truncated = markdown.chars().count() > max_chars;
    let safe_markdown = if markdown_truncated {
        format!(
            "{}\n\n...[已截断]...",
            markdown.chars().take(max_chars).collect::<String>()
        )
    } else {
        markdown.to_string()
    };
    json!({
        "source": "stream-json",
        "requestedAtMs": requested_at_ms,
        "durationMs": duration_ms,
        "eventCount": event_count,
        "markdown": safe_markdown,
        "markdownTruncated": markdown_truncated,
        "summary": summarize_context_markdown(markdown),
    })
}

fn summarize_context_markdown(markdown: &str) -> Value {
    let normalized = strip_ansi_control_codes(markdown);
    let (used_tokens, total_tokens, percent) = parse_context_token_line(&normalized);
    let free_tokens = match (used_tokens, total_tokens) {
        (Some(used), Some(total)) => Some((total - used).max(0)),
        _ => None,
    };
    json!({
        "hasContextUsage": normalized.to_ascii_lowercase().contains("context usage"),
        "hasMcpTools": normalized.to_ascii_lowercase().contains("mcp tools"),
        "hasFreeSpace": normalized.to_ascii_lowercase().contains("free space") || free_tokens.is_some(),
        "hasSystemPrompt": normalized.to_ascii_lowercase().contains("system prompt"),
        "hasMemory": normalized.to_ascii_lowercase().contains("memory files"),
        "hasSkills": normalized.to_ascii_lowercase().contains("skills"),
        "model": parse_context_model(&normalized),
        "usedTokens": used_tokens,
        "totalTokens": total_tokens,
        "freeTokens": free_tokens,
        "percent": percent,
        "categories": {},
        "mcpToolCount": count_context_section_rows(&normalized, "MCP Tools"),
        "memoryFileCount": count_context_section_rows(&normalized, "Memory Files"),
        "skillCount": count_context_section_rows(&normalized, "Skills"),
        "markdownChars": markdown.len(),
    })
}

fn strip_ansi_control_codes(value: &str) -> String {
    let mut result = String::new();
    let mut chars = value.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '\u{1b}' && chars.peek() == Some(&'[') {
            let _ = chars.next();
            for next in chars.by_ref() {
                if ('@'..='~').contains(&next) {
                    break;
                }
            }
            continue;
        }
        result.push(character);
    }
    result
}

fn parse_context_model(markdown: &str) -> Option<String> {
    markdown.lines().find_map(|line| {
        let normalized = line.trim();
        normalized
            .strip_prefix("Model:")
            .or_else(|| normalized.strip_prefix("**Model:**"))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    })
}

fn parse_context_token_line(markdown: &str) -> (Option<i64>, Option<i64>, Option<f64>) {
    for line in markdown.lines() {
        let lower = line.to_ascii_lowercase();
        if !lower.contains('/') || !(lower.contains("token") || lower.contains("tokens")) {
            continue;
        }
        let compact = line.replace(',', "");
        let Some((left, right)) = compact.split_once('/') else {
            continue;
        };
        let used = parse_context_token_count(left);
        let total = parse_context_token_count(right);
        let percent = line
            .split('(')
            .nth(1)
            .and_then(|value| value.split('%').next())
            .and_then(|value| value.trim().parse::<f64>().ok());
        if used.is_some() || total.is_some() {
            return (used, total, percent);
        }
    }
    (None, None, None)
}

fn parse_context_token_count(value: &str) -> Option<i64> {
    let token = value
        .split_whitespace()
        .find(|part| part.chars().any(|ch| ch.is_ascii_digit()))?
        .trim_matches(|ch: char| !ch.is_ascii_alphanumeric() && ch != '.')
        .to_ascii_lowercase();
    let (number, multiplier) = if let Some(raw) = token.strip_suffix('k') {
        (raw, 1_000.0)
    } else if let Some(raw) = token.strip_suffix('m') {
        (raw, 1_000_000.0)
    } else {
        (token.as_str(), 1.0)
    };
    number
        .parse::<f64>()
        .ok()
        .map(|value| (value * multiplier).round() as i64)
}

fn count_context_section_rows(markdown: &str, heading: &str) -> i64 {
    let mut in_section = false;
    let mut count = 0_i64;
    for line in markdown.lines() {
        let trimmed = line.trim();
        if trimmed.eq_ignore_ascii_case(heading)
            || trimmed.eq_ignore_ascii_case(&format!("## {heading}"))
        {
            in_section = true;
            continue;
        }
        if in_section && trimmed.starts_with('#') {
            break;
        }
        if in_section
            && !trimmed.is_empty()
            && !trimmed.starts_with('|')
            && !trimmed.chars().all(|ch| ch == '-')
        {
            count += 1;
        }
    }
    count
}

async fn write_claude_stdin_message(
    stdin: &Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>,
    message: &Value,
) -> Result<(), String> {
    let mut stdin = stdin.lock().await;
    let line = serde_json::to_string(message).map_err(|error| error.to_string())?;
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|error| error.to_string())?;
    stdin.flush().await.map_err(|error| error.to_string())
}

async fn write_run_stdin_message(state: &AppState, run_id: &str, message: &Value) -> ApiResult<()> {
    let stdin = {
        let runs = state
            .runs
            .lock()
            .map_err(|error| ApiError::internal(format!("读取运行状态失败: {error}")))?;
        let run = runs
            .get(run_id)
            .ok_or_else(|| ApiError::bad_request("当前运行不存在或已经结束。"))?;
        if run.finished {
            return Err(ApiError::bad_request("当前运行不存在或已经结束。"));
        }
        run.stdin
            .clone()
            .ok_or_else(|| ApiError::bad_request("当前 Claude 运行不支持 stdin 写回。"))?
    };
    write_claude_stdin_message(&stdin, message)
        .await
        .map_err(|error| ApiError::internal(format!("写入 Claude stdin 失败: {error}")))
}

async fn write_run_stdin_message_raw_error(
    state: &AppState,
    run_id: &str,
    message: &Value,
) -> ApiResult<()> {
    let stdin = {
        let runs = state
            .runs
            .lock()
            .map_err(|error| ApiError::internal(format!("读取运行状态失败: {error}")))?;
        let run = runs
            .get(run_id)
            .ok_or_else(|| ApiError::bad_request("当前运行不存在或已经结束。"))?;
        if run.finished {
            return Err(ApiError::bad_request("当前运行不存在或已经结束。"));
        }
        run.stdin
            .clone()
            .ok_or_else(|| ApiError::bad_request("当前 Claude 运行不支持 stdin 写回。"))?
    };
    write_claude_stdin_message(&stdin, message)
        .await
        .map_err(ApiError::internal)
}

async fn get_or_create_claude_runtime(
    state: &AppState,
    command: &str,
    thread_id: &str,
    working_directory: &str,
    permission_mode: &str,
    payload: &ClaudeRunRequest,
    channel_runtime: Option<&crate::agent_channels::AgentChannelRuntime>,
) -> ApiResult<(ClaudeRuntimeRecord, bool)> {
    let existing = state
        .runtimes
        .lock()
        .map_err(|error| ApiError::internal(format!("读取 Claude 会话失败: {error}")))?
        .get(thread_id)
        .cloned();

    if let Some(runtime) = existing {
        let has_context_request = state
            .context_requests
            .lock()
            .ok()
            .is_some_and(|requests| requests.contains_key(thread_id));
        if runtime.current_run_id.is_some() || has_context_request {
            return Ok((runtime, false));
        }
        if is_claude_runtime_compatible(
            &runtime,
            working_directory,
            permission_mode,
            payload,
            channel_runtime,
        ) {
            return Ok((runtime, true));
        }
        close_thread_runtime(state, thread_id)?;
    }

    let mut args = build_claude_run_args(payload, permission_mode);
    let mut process = background_tokio_command(command);
    process.args(args.drain(..)).current_dir(working_directory);
    if let Some(channel_runtime) = channel_runtime {
        process.envs(&channel_runtime.env);
    }
    let mut child = process
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| ApiError::internal(format!("启动 Claude 失败: {error}")))?;
    let child_id = child
        .id()
        .ok_or_else(|| ApiError::internal("Claude 进程 ID 不可用"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| ApiError::internal("Claude stdin 不可写"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ApiError::internal("Claude stdout 不可读"))?;
    let stderr = child.stderr.take();
    let stdin = Arc::new(tokio::sync::Mutex::new(stdin));
    let runtime = ClaudeRuntimeRecord {
        thread_id: thread_id.to_string(),
        working_directory: working_directory.to_string(),
        permission_mode: permission_mode.to_string(),
        model: payload.model.clone(),
        effort: payload.effort.clone(),
        channel_id: channel_runtime.map(|runtime| runtime.channel_id.clone()),
        channel_fingerprint: channel_runtime.map(|runtime| runtime.fingerprint.clone()),
        session_id: payload.session_id.clone(),
        child_id,
        stdin,
        current_run_id: None,
        closed: false,
    };

    state
        .runtimes
        .lock()
        .map_err(|error| ApiError::internal(format!("保存 Claude 会话失败: {error}")))?
        .insert(thread_id.to_string(), runtime.clone());

    let stdout_state = state.clone();
    let stdout_thread_id = thread_id.to_string();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            handle_runtime_stdout_line(&stdout_state, &stdout_thread_id, &line);
        }
    });

    if let Some(stderr) = stderr {
        let stderr_state = state.clone();
        let stderr_thread_id = thread_id.to_string();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                handle_runtime_stderr_line(&stderr_state, &stderr_thread_id, &line);
            }
        });
    }

    let exit_state = state.clone();
    let exit_thread_id = thread_id.to_string();
    tokio::spawn(async move {
        let status = child.wait().await;
        handle_runtime_exit(&exit_state, &exit_thread_id, status);
    });

    Ok((runtime, false))
}

fn is_claude_runtime_compatible(
    runtime: &ClaudeRuntimeRecord,
    working_directory: &str,
    permission_mode: &str,
    payload: &ClaudeRunRequest,
    channel_runtime: Option<&crate::agent_channels::AgentChannelRuntime>,
) -> bool {
    if runtime.closed
        || runtime.working_directory != working_directory
        || runtime.permission_mode != permission_mode
        || runtime.model != payload.model
        || runtime.effort != payload.effort
        || runtime.channel_id != channel_runtime.map(|runtime| runtime.channel_id.clone())
        || runtime.channel_fingerprint != channel_runtime.map(|runtime| runtime.fingerprint.clone())
    {
        return false;
    }
    let requested_session_id = payload
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match (runtime.session_id.as_deref(), requested_session_id) {
        (Some(current), Some(requested)) => current == requested,
        _ => true,
    }
}

fn build_run_stream_response(state: AppState, run_id: String) -> ApiResult<Response> {
    let stream = async_stream::stream! {
        let mut index = 0_usize;
        loop {
            let Some(notify) = run_notify(&state, &run_id) else {
                break;
            };
            let notified = notify.notified();
            let Some((events, finished)) = snapshot_run_events_after(&state, &run_id, index) else {
                break;
            };
            index += events.len();
            let had_events = !events.is_empty();
            for event in events {
                let line = format!("{}\n", serde_json::to_string(&event).unwrap_or_default());
                yield Ok::<Bytes, std::convert::Infallible>(Bytes::from(line));
            }
            if finished {
                break;
            }
            if !had_events {
                notified.await;
            }
        }
    };
    Response::builder()
        .header("Content-Type", "application/x-ndjson; charset=utf-8")
        .header("Cache-Control", "no-cache, no-transform")
        .body(Body::from_stream(stream))
        .map_err(|error| ApiError::internal(format!("构建 Claude 响应失败: {error}")))
}

fn snapshot_run_events_after(
    state: &AppState,
    run_id: &str,
    after: usize,
) -> Option<(Vec<Value>, bool)> {
    let runs = state.runs.lock().ok()?;
    let run = runs.get(run_id)?;
    Some((
        run.events.iter().skip(after).cloned().collect(),
        run.finished,
    ))
}

fn snapshot_replay_run_events_after(
    state: &AppState,
    run_id: &str,
    after: usize,
) -> Option<(Vec<Value>, bool)> {
    let runs = state.runs.lock().ok()?;
    let run = runs.get(run_id)?;
    Some((
        run.events
            .iter()
            .filter(|event| should_replay_run_event(event))
            .skip(after)
            .cloned()
            .collect(),
        run.finished,
    ))
}

fn run_notify(state: &AppState, run_id: &str) -> Option<Arc<tokio::sync::Notify>> {
    let runs = state.runs.lock().ok()?;
    runs.get(run_id).map(|run| run.notify.clone())
}

fn claim_runtime_current_run(state: &AppState, thread_id: &str, run_id: &str) -> ApiResult<()> {
    let mut runtimes = state
        .runtimes
        .lock()
        .map_err(|error| ApiError::internal(format!("更新 Claude 会话失败: {error}")))?;
    let runtime = runtimes
        .get_mut(thread_id)
        .ok_or_else(|| ApiError::bad_request("当前线程没有可用 Claude 会话"))?;
    if runtime.closed || runtime.current_run_id.is_some() {
        return Err(ApiError::bad_request(
            "当前会话仍有运行中的 Claude 请求，请等待结束或停止后再发送。",
        ));
    }
    runtime.current_run_id = Some(run_id.to_string());
    Ok(())
}

fn set_run_runtime_handles(
    state: &AppState,
    run_id: &str,
    child_id: u32,
    stdin: Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>,
) {
    if let Ok(mut runs) = state.runs.lock() {
        if let Some(run) = runs.get_mut(run_id) {
            run.child_id = Some(child_id);
            run.stdin = Some(stdin);
        }
    }
}

fn handle_runtime_stdout_line(state: &AppState, thread_id: &str, line: &str) {
    if handle_runtime_context_stdout_line(state, thread_id, line) {
        return;
    }
    let run_id = state.runtimes.lock().ok().and_then(|runtimes| {
        runtimes
            .get(thread_id)
            .and_then(|runtime| runtime.current_run_id.clone())
    });
    let Some(run_id) = run_id else {
        return;
    };
    remember_control_request_mapping(state, &run_id, line);

    let (events, saw_done) = {
        let Ok(mut runs) = state.runs.lock() else {
            return;
        };
        let Some(run) = runs.get_mut(&run_id) else {
            return;
        };
        let events = map_claude_json_line(&run_id, line, run);
        (events, run.saw_done)
    };

    for event in events {
        emit_run_event(state, &run_id, event);
    }
    if saw_done {
        finish_runtime_run(state, thread_id, &run_id);
    }
}

fn handle_runtime_stderr_line(state: &AppState, thread_id: &str, line: &str) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }
    if append_runtime_context_stderr_line(state, thread_id, trimmed) {
        return;
    }
    let run_id = state.runtimes.lock().ok().and_then(|runtimes| {
        runtimes
            .get(thread_id)
            .and_then(|runtime| runtime.current_run_id.clone())
    });
    if let Some(run_id) = run_id {
        if let Some(label) = parse_claude_retry_status_message(trimmed) {
            push_run_event(
                state,
                &run_id,
                json!({ "type": "phase", "runId": run_id, "phase": "requesting", "label": label }),
            );
        }
        push_run_event(
            state,
            &run_id,
            json!({ "type": "stderr", "runId": run_id, "text": trimmed }),
        );
        enqueue_runtime_reconnect_hint(state, &run_id, trimmed, "stderr");
    }
}

fn parse_claude_retry_status_message(text: &str) -> Option<String> {
    let normalized = strip_ansi_control_sequences(text).trim().to_string();
    let lower = normalized.to_ascii_lowercase();
    let retry_marker = "retrying in ";
    let retry_start = lower.find(retry_marker)? + retry_marker.len();
    let after_retry = normalized.get(retry_start..)?.trim_start();
    let retry_delay = after_retry.split_whitespace().next()?.trim();
    if retry_delay.is_empty() {
        return None;
    }

    let attempt_marker = "attempt";
    let attempt_start = lower.find(attempt_marker)? + attempt_marker.len();
    let after_attempt = normalized.get(attempt_start..)?.trim_start();
    let attempt_token = after_attempt.split_whitespace().next()?.replace(' ', "");
    let (attempt, max_attempts) = attempt_token.split_once('/')?;
    let attempt = attempt.trim().parse::<i64>().ok()?;
    let max_attempts = max_attempts.trim().parse::<i64>().ok()?;
    Some(format_retry_status_message(
        attempt,
        max_attempts,
        retry_delay,
    ))
}

fn format_retry_status_message(attempt: i64, max_attempts: i64, retry_delay: &str) -> String {
    if retry_delay == "0s" {
        format!("连接重试中 {attempt}/{max_attempts}")
    } else {
        format!("连接重试中 {attempt}/{max_attempts}，{retry_delay} 后重试")
    }
}

fn strip_ansi_control_sequences(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(character) = chars.next() {
        if character == char::from(27) && chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if ('@'..='~').contains(&next) {
                    break;
                }
            }
            continue;
        }
        output.push(character);
    }
    output
}

fn enqueue_retryable_runtime_error(state: &AppState, run_id: &str, message: &str, source: &str) {
    if let Some(hint) = enqueue_runtime_reconnect_hint(state, run_id, message, source) {
        push_run_event(
            state,
            run_id,
            json!({ "type": "retryable-error", "runId": run_id, "message": message, "hint": hint }),
        );
    }
}

fn enqueue_runtime_reconnect_hint(
    state: &AppState,
    run_id: &str,
    message: &str,
    source: &str,
) -> Option<Value> {
    let hint = create_runtime_recovery_hint(message, source)?;
    let reason = hint
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let hint_message = hint
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let key = format!("{reason}:{hint_message}");
    let should_emit = {
        let Ok(mut runs) = state.runs.lock() else {
            return Some(hint);
        };
        let Some(run) = runs.get_mut(run_id) else {
            return Some(hint);
        };
        run.emitted_recovery_hint_keys.insert(key)
    };
    if should_emit {
        push_run_event(
            state,
            run_id,
            json!({ "type": "runtime-reconnect-hint", "runId": run_id, "hint": hint.clone() }),
        );
    }
    Some(hint)
}

fn create_runtime_recovery_hint(message: &str, source: &str) -> Option<Value> {
    let normalized = message.trim();
    if normalized.is_empty() {
        return None;
    }
    let lower = normalized.to_ascii_lowercase();
    let reason = if lower.contains("broken pipe") || lower.contains("epipe") {
        "broken-pipe"
    } else if lower.contains("socket hang up")
        || lower.contains("connection reset")
        || lower.contains("stream closed")
        || lower.contains("network error")
    {
        "transport-error"
    } else if lower.contains("runtime ended")
        || lower.contains("unexpected eof")
        || lower.contains(" has ended")
        || lower == "eof"
    {
        "runtime-ended"
    } else if lower.contains("stale")
        || lower.contains("session expired")
        || lower.contains("thread expired")
    {
        "stale-session"
    } else if lower.contains("resume") && lower.contains("not exist") {
        "resume-session-missing"
    } else {
        return None;
    };
    let suggested_action = match reason {
        "resume-session-missing" => "recover",
        "stale-session" => "resend",
        _ => "retry",
    };
    Some(json!({
        "reason": reason,
        "message": normalized,
        "retryable": true,
        "suggestedAction": suggested_action,
        "source": source,
    }))
}

fn handle_runtime_exit(
    state: &AppState,
    thread_id: &str,
    status: Result<std::process::ExitStatus, std::io::Error>,
) {
    fail_runtime_context_request(
        state,
        thread_id,
        "context-runtime-ended",
        "Claude 运行时已结束，/context 请求未完成。",
        StatusCode::INTERNAL_SERVER_ERROR,
    );
    let run_id = {
        let Ok(mut runtimes) = state.runtimes.lock() else {
            return;
        };
        let run_id = runtimes
            .get(thread_id)
            .and_then(|runtime| runtime.current_run_id.clone());
        runtimes.remove(thread_id);
        run_id
    };
    if let Some(run_id) = run_id {
        let already_done = state
            .runs
            .lock()
            .ok()
            .and_then(|runs| runs.get(&run_id).map(|run| run.saw_done || run.finished))
            .unwrap_or(false);
        if !already_done {
            match status {
                Ok(status) if status.success() => {
                    push_run_event(state, &run_id, runtime_exit_done_event(state, &run_id));
                }
                Ok(status) => {
                    push_run_event(
                        state,
                        &run_id,
                        json!({ "type": "error", "runId": run_id, "message": format!("Claude 退出码: {status}") }),
                    );
                }
                Err(error) => {
                    push_run_event(
                        state,
                        &run_id,
                        json!({ "type": "error", "runId": run_id, "message": format!("等待 Claude 退出失败: {error}") }),
                    );
                }
            }
        }
        mark_run_finished(state, &run_id);
    }
}

fn runtime_exit_done_event(state: &AppState, run_id: &str) -> Value {
    let (session_id, result) = state
        .runs
        .lock()
        .ok()
        .and_then(|runs| {
            runs.get(run_id)
                .map(|run| (run.session_id.clone(), run.collected_result.clone()))
        })
        .unwrap_or((None, String::new()));
    let mut event = json!({
        "type": "done",
        "runId": run_id,
        "result": result,
    });
    if let Some(session_id) = session_id {
        event["sessionId"] = json!(session_id);
    }
    event
}

fn finish_runtime_run(state: &AppState, thread_id: &str, run_id: &str) {
    if let Ok(mut runtimes) = state.runtimes.lock() {
        if let Some(runtime) = runtimes.get_mut(thread_id) {
            if runtime.current_run_id.as_deref() == Some(run_id) {
                runtime.current_run_id = None;
            }
        }
    }
    mark_run_finished(state, run_id);
}

fn finish_run_and_close_runtime(state: &AppState, run_id: &str) -> ApiResult<()> {
    let thread_id = state
        .runs
        .lock()
        .map_err(|error| ApiError::internal(format!("读取运行状态失败: {error}")))?
        .get(run_id)
        .map(|run| run.thread_id.clone());
    if let Some(thread_id) = thread_id {
        finish_runtime_run(state, &thread_id, run_id);
        close_thread_runtime(state, &thread_id)?;
    } else {
        mark_run_finished(state, run_id);
    }
    Ok(())
}

fn close_thread_runtime(state: &AppState, thread_id: &str) -> ApiResult<bool> {
    let runtime = state
        .runtimes
        .lock()
        .map_err(|error| ApiError::internal(format!("关闭 Claude 会话失败: {error}")))?
        .remove(thread_id);
    let Some(runtime) = runtime else {
        return Ok(false);
    };
    fail_runtime_context_request(
        state,
        thread_id,
        "context-runtime-ended",
        "Claude 会话已关闭，/context 请求未完成。",
        StatusCode::INTERNAL_SERVER_ERROR,
    );
    if let Some(run_id) = runtime.current_run_id.as_deref() {
        push_run_event(
            state,
            run_id,
            json!({ "type": "error", "runId": run_id, "message": "Claude 会话已关闭。" }),
        );
        mark_run_finished(state, run_id);
    }
    kill_process_tree(runtime.child_id)
}

fn kill_process_tree(child_id: u32) -> ApiResult<bool> {
    #[cfg(target_os = "windows")]
    let status = background_command("taskkill")
        .args(["/PID", &child_id.to_string(), "/T", "/F"])
        .status();
    #[cfg(not(target_os = "windows"))]
    let status = Command::new("kill")
        .arg("-TERM")
        .arg(child_id.to_string())
        .status();
    Ok(status.is_ok_and(|status| status.success()))
}

fn build_claude_context_request_message() -> Value {
    json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{
                "type": "text",
                "text": "/context",
            }],
        },
    })
}

fn settle_runtime_context_request(
    state: &AppState,
    thread_id: &str,
    result: Result<Value, ClaudeContextRequestError>,
) {
    let responder = state
        .context_requests
        .lock()
        .ok()
        .and_then(|mut requests| requests.remove(thread_id))
        .and_then(|mut request| request.responder.take());
    if let Some(responder) = responder {
        let _ = responder.send(result);
    }
}

fn fail_runtime_context_request(
    state: &AppState,
    thread_id: &str,
    code: &'static str,
    message: &str,
    status: StatusCode,
) {
    settle_runtime_context_request(
        state,
        thread_id,
        Err(ClaudeContextRequestError {
            code,
            message: message.to_string(),
            status,
        }),
    );
}

fn append_runtime_context_stderr_line(state: &AppState, thread_id: &str, line: &str) -> bool {
    let Ok(mut requests) = state.context_requests.lock() else {
        return false;
    };
    let Some(request) = requests.get_mut(thread_id) else {
        return false;
    };
    request
        .stderr_lines
        .push(line.chars().take(1_000).collect::<String>());
    if request.stderr_lines.len() > 20 {
        let overflow = request.stderr_lines.len() - 20;
        request.stderr_lines.drain(0..overflow);
    }
    true
}

fn handle_runtime_context_stdout_line(state: &AppState, thread_id: &str, line: &str) -> bool {
    if !state
        .context_requests
        .lock()
        .ok()
        .is_some_and(|requests| requests.contains_key(thread_id))
    {
        return false;
    }
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return true;
    }
    let payload = match serde_json::from_str::<Value>(trimmed) {
        Ok(payload) => payload,
        Err(error) => {
            settle_runtime_context_request(
                state,
                thread_id,
                Err(ClaudeContextRequestError {
                    code: "context-json-parse-failed",
                    message: format!("Claude /context 返回了无法解析的 stream-json 行：{error}"),
                    status: StatusCode::BAD_GATEWAY,
                }),
            );
            return true;
        }
    };
    let mut terminal: Option<Result<Value, ClaudeContextRequestError>> = None;
    let mut runtime_session_update: Option<String> = None;
    if let Ok(mut requests) = state.context_requests.lock() {
        let Some(request) = requests.get_mut(thread_id) else {
            return true;
        };
        request.event_count += 1;
        let result_error = context_result_error_message(&payload);
        if result_error.is_none() {
            if let Some(session_id) = payload.get("session_id").and_then(Value::as_str) {
                runtime_session_update = Some(session_id.to_string());
            }
        }
        let markdown = extract_context_markdown_from_payload(&payload);
        if payload.get("type").and_then(Value::as_str) == Some("assistant")
            && !markdown.trim().is_empty()
        {
            request.assistant_texts.push(markdown.clone());
        }
        if payload.get("type").and_then(Value::as_str) == Some("result") {
            if let Some(message) = result_error {
                terminal = Some(Err(ClaudeContextRequestError {
                    code: "context-result-error",
                    message,
                    status: StatusCode::BAD_GATEWAY,
                }));
            } else {
                let result_markdown = if !markdown.trim().is_empty() {
                    markdown
                } else {
                    request.assistant_texts.last().cloned().unwrap_or_default()
                };
                if result_markdown.trim().is_empty() {
                    terminal = Some(Err(ClaudeContextRequestError {
                        code: "context-empty-response",
                        message: "Claude 已返回 /context 结果事件，但没有可展示的 Markdown 内容。"
                            .to_string(),
                        status: StatusCode::BAD_GATEWAY,
                    }));
                } else {
                    terminal = Some(Ok(create_context_snapshot_value(
                        &strip_ansi_control_codes(&result_markdown),
                        request.requested_at_ms,
                        (current_timestamp_ms_i64() - request.requested_at_ms).max(0),
                        request.event_count,
                    )));
                }
            }
        }
    }
    if let Some(session_id) = runtime_session_update {
        if let Ok(mut runtimes) = state.runtimes.lock() {
            if let Some(runtime) = runtimes.get_mut(thread_id) {
                runtime.session_id = Some(session_id);
            }
        }
    }
    if let Some(result) = terminal {
        settle_runtime_context_request(state, thread_id, result);
    }
    true
}

fn context_result_error_message(payload: &Value) -> Option<String> {
    let errors = payload
        .get("errors")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::trim))
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let has_error = payload
        .get("is_error")
        .or_else(|| payload.get("isError"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || payload.get("subtype").and_then(Value::as_str) == Some("error_during_execution")
        || !errors.is_empty();
    if !has_error {
        return None;
    }
    let details = errors.join("\n");
    if !details.trim().is_empty() {
        return Some(details);
    }
    payload
        .get("result")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| Some("Claude 运行失败，但未返回具体错误。".to_string()))
}

fn remember_control_request_mapping(state: &AppState, run_id: &str, line: &str) {
    let Ok(payload) = serde_json::from_str::<Value>(line.trim()) else {
        return;
    };
    if payload.get("type").and_then(Value::as_str) != Some("control_request") {
        return;
    }
    let Some(request_id) = payload
        .get("request_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
    else {
        return;
    };
    let tool_use_id = payload
        .pointer("/request/tool_use_id")
        .or_else(|| payload.pointer("/request/toolUseId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    if let Ok(mut runs) = state.runs.lock() {
        if let Some(run) = runs.get_mut(run_id) {
            run.control_request_tool_use_ids
                .insert(request_id, tool_use_id);
        }
    }
}

fn control_response_ids_for_request(
    state: &AppState,
    run_id: &str,
    request_id: &str,
) -> ApiResult<Option<(String, Option<String>)>> {
    let runs = state
        .runs
        .lock()
        .map_err(|error| ApiError::internal(format!("读取控制请求失败: {error}")))?;
    let Some(run) = runs.get(run_id) else {
        return Ok(None);
    };
    if let Some(tool_use_id) = run.control_request_tool_use_ids.get(request_id) {
        return Ok(Some((request_id.to_string(), tool_use_id.clone())));
    }
    Ok(run
        .control_request_tool_use_ids
        .iter()
        .find_map(|(control_request_id, tool_use_id)| {
            (tool_use_id.as_deref() == Some(request_id))
                .then(|| (control_request_id.clone(), tool_use_id.clone()))
        }))
}

fn ensure_run_paused_for_user_input(
    state: &AppState,
    run_id: &str,
    message: &str,
) -> ApiResult<()> {
    let runs = state
        .runs
        .lock()
        .map_err(|error| ApiError::internal(format!("读取运行状态失败: {error}")))?;
    let run = runs
        .get(run_id)
        .ok_or_else(|| ApiError::bad_request("当前运行不存在或已经结束。"))?;
    if run.finished {
        return Err(ApiError::bad_request("当前运行不存在或已经结束。"));
    }
    if !run.paused_for_user_input {
        return Err(ApiError::bad_request(message));
    }
    Ok(())
}

fn ensure_run_supports_runtime_input(
    state: &AppState,
    run_id: &str,
    unsupported_message: &str,
) -> ApiResult<()> {
    let runs = state
        .runs
        .lock()
        .map_err(|error| ApiError::internal(format!("读取运行状态失败: {error}")))?;
    let run = runs
        .get(run_id)
        .ok_or_else(|| ApiError::conflict("当前运行不存在或已经结束。"))?;
    if run.finished {
        return Err(ApiError::conflict("当前运行不存在或已经结束。"));
    }
    if run.stdin.is_none() {
        return Err(ApiError::conflict(unsupported_message));
    }
    Ok(())
}

fn ensure_run_not_paused_for_guide(state: &AppState, run_id: &str) -> ApiResult<()> {
    let runs = state
        .runs
        .lock()
        .map_err(|error| ApiError::internal(format!("读取运行状态失败: {error}")))?;
    let run = runs
        .get(run_id)
        .ok_or_else(|| ApiError::conflict("当前运行不存在或已经结束。"))?;
    if run.finished {
        return Err(ApiError::conflict("当前运行不存在或已经结束。"));
    }
    if run.paused_for_user_input {
        return Err(ApiError::bad_request(
            "当前运行正在等待问答或审批，请先处理卡片后再引导。",
        ));
    }
    Ok(())
}

fn mark_run_human_input_resumed(state: &AppState, run_id: &str, request_id: &str) {
    if let Ok(mut runs) = state.runs.lock() {
        if let Some(run) = runs.get_mut(run_id) {
            run.paused_for_user_input = false;
            if run
                .control_request_tool_use_ids
                .remove(request_id)
                .is_none()
            {
                let matched_control_request_id = run.control_request_tool_use_ids.iter().find_map(
                    |(control_request_id, tool_use_id)| {
                        (tool_use_id.as_deref() == Some(request_id))
                            .then(|| control_request_id.clone())
                    },
                );
                if let Some(control_request_id) = matched_control_request_id {
                    run.control_request_tool_use_ids.remove(&control_request_id);
                }
            }
        }
    }
}

fn build_request_user_input_response_answers(
    questions: &Value,
    submitted_answers: &Map<String, Value>,
) -> Map<String, Value> {
    let mut response_answers = Map::new();
    let Some(questions) = questions.as_array() else {
        return submitted_answers.clone();
    };
    for (index, question) in questions.iter().enumerate() {
        let key = first_json_string(question, &["id"])
            .map(ToString::to_string)
            .unwrap_or_else(|| format!("question-{index}"));
        let Some(answer) = submitted_answers
            .get(&key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let normalized_answer = normalize_request_user_input_answer_value(question, answer);
        response_answers.insert(key, json!(normalized_answer));
        if let Some(question_text) = first_json_string(question, &["question", "prompt", "label"]) {
            response_answers.insert(question_text.to_string(), json!(normalized_answer));
        }
    }
    if response_answers.is_empty() {
        submitted_answers.clone()
    } else {
        response_answers
    }
}

fn normalize_request_user_input_answer_value(question: &Value, answer: &str) -> String {
    let Some(options) = question.get("options").and_then(Value::as_array) else {
        return answer.to_string();
    };
    if options.is_empty() {
        return answer.to_string();
    }
    let option_labels = options
        .iter()
        .filter_map(|option| first_json_string(option, &["label", "title", "value"]))
        .collect::<std::collections::HashSet<_>>();
    let parts = answer
        .lines()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let selected_labels = parts
        .iter()
        .copied()
        .filter(|part| option_labels.contains(part))
        .collect::<Vec<_>>();
    let free_text = parts
        .iter()
        .copied()
        .filter(|part| !option_labels.contains(part))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    if question
        .get("multiSelect")
        .or_else(|| question.get("multi_select"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return parts.join(", ");
    }
    if question
        .get("isOther")
        .or_else(|| question.get("is_other"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
        && !free_text.is_empty()
    {
        return free_text;
    }
    selected_labels
        .first()
        .map(|value| (*value).to_string())
        .unwrap_or_else(|| {
            if free_text.is_empty() {
                answer.to_string()
            } else {
                free_text
            }
        })
}

fn build_claude_control_response_message(
    request_id: &str,
    decision: &str,
    tool_use_id: Option<&str>,
) -> Value {
    let response = if decision == "reject" {
        json!({
            "behavior": "deny",
            "message": "Permission denied by user.",
            "toolUseID": tool_use_id,
            "decisionClassification": "user_reject",
        })
    } else {
        json!({
            "behavior": "allow",
            "updatedInput": {},
            "toolUseID": tool_use_id,
            "decisionClassification": "user_temporary",
        })
    };
    json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": response,
        },
    })
}

fn build_ask_user_question_control_response_message(
    request_id: &str,
    tool_use_id: Option<&str>,
    questions: Value,
    answers: Value,
) -> Value {
    json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": {
                "behavior": "allow",
                "updatedInput": {
                    "questions": questions,
                    "answers": answers,
                },
                "toolUseID": tool_use_id,
                "decisionClassification": "user_temporary",
            },
        },
    })
}

fn map_claude_json_line(run_id: &str, line: &str, run: &mut ActiveRunRecord) -> Vec<Value> {
    let payload = match serde_json::from_str::<Value>(line.trim()) {
        Ok(payload) => payload,
        Err(_) => {
            return vec![json!({ "type": "stderr", "runId": run_id, "text": line })];
        }
    };
    let mut events = Vec::new();
    if should_emit_claude_raw_event(&payload) {
        events.push(json!({ "type": "raw", "runId": run_id, "raw": payload }));
    }
    let is_sidechain = payload
        .get("isSidechain")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let parent_tool_use_id = payload.get("parent_tool_use_id").and_then(Value::as_str);
    if let Some(session_id) = payload.get("session_id").and_then(Value::as_str) {
        if context_result_error_message(&payload).is_none()
            && run.session_id.as_deref() != Some(session_id)
        {
            run.session_id = Some(session_id.to_string());
            events.push(json!({ "type": "session", "runId": run_id, "sessionId": session_id }));
        }
    }
    if payload.get("type").and_then(Value::as_str) == Some("stream_event") {
        if let Some(event) = payload.get("event") {
            map_claude_stream_event(
                run_id,
                event,
                run,
                is_sidechain,
                parent_tool_use_id,
                &mut events,
            );
        }
    }
    if let Some(request) = parse_control_request_user_input(&payload) {
        events.push(json!({ "type": "request-user-input", "runId": run_id, "request": request }));
        return events;
    }
    if let Some(request) = parse_control_approval_request(&payload) {
        events.push(json!({ "type": "approval-request", "runId": run_id, "request": request }));
        return events;
    }
    if payload.get("type").and_then(Value::as_str) == Some("system") {
        let mut event = json!({
            "type": "claude-event",
            "runId": run_id,
            "label": describe_claude_system_event(&payload),
            "eventType": "system",
            "raw": payload,
        });
        if let Some(object) = event.as_object_mut() {
            if let Some(subtype) = payload.get("subtype").and_then(Value::as_str) {
                object.insert("subtype".to_string(), json!(subtype));
            }
            if let Some(status) = payload.get("status").and_then(Value::as_str) {
                object.insert("status".to_string(), json!(status));
            }
        }
        events.push(event);
    }
    if payload.get("type").and_then(Value::as_str) == Some("system") && !is_sidechain {
        match payload.get("subtype").and_then(Value::as_str) {
            Some("api_retry") => {
                if let Some(label) = parse_claude_api_retry_status_message(&payload) {
                    events.push(json!({
                        "type": "phase",
                        "runId": run_id,
                        "phase": "requesting",
                        "label": label,
                    }));
                }
            }
            Some("status")
                if payload.get("status").and_then(Value::as_str) == Some("requesting") =>
            {
                events.push(json!({
                    "type": "phase",
                    "runId": run_id,
                    "phase": "requesting",
                    "label": "等待 Claude 响应",
                }));
            }
            _ => {}
        }
    }
    if payload.get("type").and_then(Value::as_str) == Some("assistant") {
        if let Some(content) = payload
            .pointer("/message/content")
            .and_then(Value::as_array)
        {
            if !is_sidechain {
                events.push(
                    json!({ "type": "assistant-snapshot", "runId": run_id, "blocks": content }),
                );
            }
            for block in content {
                if block.get("type").and_then(Value::as_str) != Some("tool_use") {
                    continue;
                }
                let tool_name = block.get("name").and_then(Value::as_str).unwrap_or("tool");
                let tool_use_id = block.get("id").and_then(Value::as_str);
                let input = block.get("input").unwrap_or(&Value::Null);
                if let Some(request) = parse_request_user_input_event(tool_name, input, tool_use_id)
                {
                    events.push(json!({ "type": "request-user-input", "runId": run_id, "request": request }));
                    return events;
                }
                if let Some(request) =
                    parse_runtime_approval_request_event(tool_name, input, tool_use_id)
                {
                    events.push(
                        json!({ "type": "approval-request", "runId": run_id, "request": request }),
                    );
                    return events;
                }
            }
        }
    }
    if payload.get("type").and_then(Value::as_str) == Some("user") {
        if let Some(content) = payload
            .pointer("/message/content")
            .and_then(Value::as_array)
        {
            for block in content {
                if block.get("type").and_then(Value::as_str) != Some("tool_result") {
                    continue;
                }
                let content_text =
                    stringify_claude_content(block.get("content").unwrap_or(&Value::Null));
                let tool_use_id = block.get("tool_use_id").and_then(Value::as_str);
                let is_error = block
                    .get("is_error")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if is_internal_human_input_tool_result(run, tool_use_id, &content_text, is_error) {
                    events.push(json!({
                        "type": "trace",
                        "runId": run_id,
                        "name": "internal_human_input_tool_result_skipped",
                        "atMs": current_timestamp_ms_i64(),
                        "detail": tool_use_id,
                    }));
                    continue;
                }
                events.push(json!({
                    "type": "tool-result",
                    "runId": run_id,
                    "toolUseId": tool_use_id,
                    "parentToolUseId": parent_tool_use_id,
                    "isSidechain": is_sidechain,
                    "content": content_text,
                    "isError": is_error,
                }));
                if is_error && is_human_approval_tool_result_content(&content_text) {
                    run.paused_for_user_input = true;
                    events.push(json!({
                        "type": "trace",
                        "runId": run_id,
                        "name": "paused_for_approval_result",
                        "atMs": current_timestamp_ms_i64(),
                    }));
                    return events;
                }
            }
        }
    }
    if payload.get("type").and_then(Value::as_str) == Some("result") && !is_sidechain {
        if let Some(usage) = claude_usage_event(run_id, &payload, "result") {
            events.push(usage);
        }
        if let Some(error_message) = context_result_error_message(&payload) {
            append_retryable_runtime_error_event(
                run,
                &mut events,
                run_id,
                &error_message,
                "result",
            );
            run.saw_done = true;
            events.push(json!({
                "type": "error",
                "runId": run_id,
                "message": error_message,
            }));
            return events;
        }
        run.saw_done = true;
        let result = payload
            .get("result")
            .and_then(Value::as_str)
            .unwrap_or(run.collected_result.as_str());
        events.push(json!({
            "type": "done",
            "runId": run_id,
            "sessionId": payload.get("session_id").and_then(Value::as_str),
            "result": result,
            "totalCostUsd": payload.get("total_cost_usd").and_then(Value::as_f64),
            "durationMs": payload.get("duration_ms").and_then(Value::as_i64),
            "inputTokens": payload.pointer("/usage/input_tokens").and_then(Value::as_i64),
            "outputTokens": payload.pointer("/usage/output_tokens").and_then(Value::as_i64),
            "cacheCreationInputTokens": payload.pointer("/usage/cache_creation_input_tokens").and_then(Value::as_i64),
            "cacheReadInputTokens": payload.pointer("/usage/cache_read_input_tokens").and_then(Value::as_i64),
        }));
    }
    events
}

fn should_emit_claude_raw_event(payload: &Value) -> bool {
    payload.get("type").and_then(Value::as_str) != Some("stream_event")
}

fn claude_usage_event(run_id: &str, payload: &Value, usage_source: &str) -> Option<Value> {
    let usage = payload.get("usage")?;
    let mut event = json!({
        "type": "usage",
        "runId": run_id,
        "usageSource": usage_source,
        "inputTokens": usage.get("input_tokens").and_then(Value::as_i64),
        "outputTokens": usage.get("output_tokens").and_then(Value::as_i64),
        "cacheCreationInputTokens": usage.get("cache_creation_input_tokens").and_then(Value::as_i64),
        "cacheReadInputTokens": usage.get("cache_read_input_tokens").and_then(Value::as_i64),
    });
    remove_null_fields(&mut event);
    if event.as_object().is_some_and(|object| object.len() > 3) {
        Some(event)
    } else {
        None
    }
}

fn parse_claude_api_retry_status_message(payload: &Value) -> Option<String> {
    if payload.get("type").and_then(Value::as_str) != Some("system")
        || payload.get("subtype").and_then(Value::as_str) != Some("api_retry")
    {
        return None;
    }
    let attempt = payload.get("attempt").and_then(Value::as_i64)?;
    let max_attempts = payload.get("max_retries").and_then(Value::as_i64)?;
    let retry_delay_ms = payload
        .get("retry_delay_ms")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .max(0);
    let retry_delay = format!("{}s", (retry_delay_ms + 999) / 1000);
    Some(format_retry_status_message(
        attempt,
        max_attempts,
        &retry_delay,
    ))
}

fn append_retryable_runtime_error_event(
    run: &mut ActiveRunRecord,
    events: &mut Vec<Value>,
    run_id: &str,
    message: &str,
    source: &str,
) {
    if let Some(hint) = append_runtime_reconnect_hint_event(run, events, run_id, message, source) {
        events.push(json!({
            "type": "retryable-error",
            "runId": run_id,
            "message": message,
            "hint": hint,
        }));
    }
}

fn append_runtime_reconnect_hint_event(
    run: &mut ActiveRunRecord,
    events: &mut Vec<Value>,
    run_id: &str,
    message: &str,
    source: &str,
) -> Option<Value> {
    let hint = create_runtime_recovery_hint(message, source)?;
    let reason = hint
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let hint_message = hint
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let key = format!("{reason}:{hint_message}");
    if run.emitted_recovery_hint_keys.insert(key) {
        events.push(json!({
            "type": "runtime-reconnect-hint",
            "runId": run_id,
            "hint": hint.clone(),
        }));
    }
    Some(hint)
}

fn describe_claude_system_event(payload: &Value) -> String {
    match payload.get("subtype").and_then(Value::as_str) {
        Some("init") => "Claude 会话初始化".to_string(),
        Some("status") => format!(
            "状态：{}",
            payload
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
        ),
        Some(subtype) => format!("Claude system: {subtype}"),
        None => "Claude system".to_string(),
    }
}

fn map_claude_stream_event(
    run_id: &str,
    event: &Value,
    run: &mut ActiveRunRecord,
    is_sidechain: bool,
    parent_tool_use_id: Option<&str>,
    events: &mut Vec<Value>,
) {
    match event.get("type").and_then(Value::as_str) {
        Some("content_block_start") => {
            let index = event.get("index").and_then(Value::as_i64).unwrap_or(-1);
            if let Some(block) = event.get("content_block") {
                if let Some(block_type) = block.get("type").and_then(Value::as_str) {
                    run.block_type_by_index
                        .insert(index, block_type.to_string());
                }
                if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                    let tool_name = block.get("name").and_then(Value::as_str).unwrap_or("tool");
                    let tool_use_id = block.get("id").and_then(Value::as_str);
                    let input = block.get("input").unwrap_or(&Value::Null);
                    run.tool_input_accumulators.insert(
                        index,
                        ToolInputAccumulator {
                            name: tool_name.to_string(),
                            tool_use_id: tool_use_id.map(ToString::to_string),
                            parent_tool_use_id: parent_tool_use_id.map(ToString::to_string),
                            is_sidechain,
                            input_text: get_tool_input_seed(input),
                            emitted_request_user_input: false,
                            emitted_approval_request: false,
                        },
                    );
                    if let Some(request) =
                        parse_request_user_input_event(tool_name, input, tool_use_id)
                    {
                        if let Some(accumulator) = run.tool_input_accumulators.get_mut(&index) {
                            accumulator.emitted_request_user_input = true;
                        }
                        events.push(json!({ "type": "request-user-input", "runId": run_id, "request": request }));
                        return;
                    }
                    if let Some(request) =
                        parse_runtime_approval_request_event(tool_name, input, tool_use_id)
                    {
                        if let Some(accumulator) = run.tool_input_accumulators.get_mut(&index) {
                            accumulator.emitted_approval_request = true;
                        }
                        events.push(json!({ "type": "approval-request", "runId": run_id, "request": request }));
                        return;
                    }
                    if !is_sidechain {
                        events.push(json!({ "type": "phase", "runId": run_id, "phase": "tool", "label": "执行工具中" }));
                    }
                    events.push(json!({
                        "type": "tool-start",
                        "runId": run_id,
                        "blockIndex": index,
                        "toolUseId": tool_use_id,
                        "parentToolUseId": parent_tool_use_id,
                        "isSidechain": is_sidechain,
                        "name": tool_name,
                        "input": input,
                    }));
                }
                if block.get("type").and_then(Value::as_str) == Some("thinking") && !is_sidechain {
                    events.push(json!({ "type": "phase", "runId": run_id, "phase": "thinking", "label": "思考中" }));
                }
            }
        }
        Some("content_block_delta") => {
            let index = event.get("index").and_then(Value::as_i64).unwrap_or(-1);
            if let Some(delta) = event.get("delta") {
                match delta.get("type").and_then(Value::as_str) {
                    Some("text_delta") => {
                        if let Some(text) = delta.get("text").and_then(Value::as_str) {
                            run.collected_result.push_str(text);
                            events.push(json!({ "type": "delta", "runId": run_id, "text": text }));
                            events.push(json!({ "type": "phase", "runId": run_id, "phase": "computing", "label": "生成回复中" }));
                        }
                    }
                    Some("thinking_delta") => {
                        let text = delta
                            .get("thinking")
                            .or_else(|| delta.get("text"))
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        if !text.is_empty() && !is_sidechain {
                            events.push(
                                json!({ "type": "thinking-delta", "runId": run_id, "text": text }),
                            );
                        }
                        if !is_sidechain {
                            events.push(json!({ "type": "phase", "runId": run_id, "phase": "thinking", "label": "思考中" }));
                        }
                    }
                    Some("input_json_delta") => {
                        if let Some(text) = delta.get("partial_json").and_then(Value::as_str) {
                            let mut tool_use_id = None;
                            let mut event_parent_tool_use_id =
                                parent_tool_use_id.map(ToString::to_string);
                            let mut event_is_sidechain = is_sidechain;
                            if let Some(accumulator) = run.tool_input_accumulators.get_mut(&index) {
                                tool_use_id = accumulator.tool_use_id.clone();
                                event_parent_tool_use_id = accumulator.parent_tool_use_id.clone();
                                event_is_sidechain = accumulator.is_sidechain;
                                if accumulator.emitted_request_user_input
                                    || accumulator.emitted_approval_request
                                {
                                    return;
                                }
                                accumulator.input_text.push_str(text);
                                let before = events.len();
                                emit_structured_tool_events_from_accumulator(
                                    run_id,
                                    accumulator,
                                    events,
                                );
                                if events.len() > before {
                                    return;
                                }
                            }
                            events.push(json!({
                                "type": "tool-input-delta",
                                "runId": run_id,
                                "blockIndex": index,
                                "toolUseId": tool_use_id,
                                "parentToolUseId": event_parent_tool_use_id,
                                "isSidechain": event_is_sidechain,
                                "text": text,
                            }));
                            if !event_is_sidechain {
                                events.push(json!({ "type": "phase", "runId": run_id, "phase": "tool", "label": "执行工具中" }));
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        Some("content_block_stop") => {
            let index = event.get("index").and_then(Value::as_i64).unwrap_or(-1);
            let current_block_type = run.block_type_by_index.remove(&index);
            let mut event_parent_tool_use_id = parent_tool_use_id.map(ToString::to_string);
            let mut event_is_sidechain = is_sidechain;
            if let Some(mut accumulator) = run.tool_input_accumulators.remove(&index) {
                event_parent_tool_use_id = accumulator.parent_tool_use_id.clone();
                event_is_sidechain = accumulator.is_sidechain;
                let already_emitted =
                    accumulator.emitted_request_user_input || accumulator.emitted_approval_request;
                if !already_emitted {
                    let before = events.len();
                    emit_structured_tool_events_from_accumulator(run_id, &mut accumulator, events);
                    if events.len() > before {
                        return;
                    }
                } else {
                    return;
                }
            }
            if current_block_type.as_deref() == Some("tool_use") {
                events.push(json!({
                    "type": "tool-stop",
                    "runId": run_id,
                    "blockIndex": index,
                    "parentToolUseId": event_parent_tool_use_id,
                    "isSidechain": event_is_sidechain,
                }));
            }
        }
        _ => {}
    }
}

fn emit_structured_tool_events_from_accumulator(
    run_id: &str,
    accumulator: &mut ToolInputAccumulator,
    events: &mut Vec<Value>,
) {
    let Some(input) = parse_json_object(&accumulator.input_text) else {
        return;
    };
    if !accumulator.emitted_request_user_input {
        if let Some(request) = parse_request_user_input_event(
            &accumulator.name,
            &input,
            accumulator.tool_use_id.as_deref(),
        ) {
            accumulator.emitted_request_user_input = true;
            events
                .push(json!({ "type": "request-user-input", "runId": run_id, "request": request }));
            return;
        }
    }
    if !accumulator.emitted_approval_request {
        if let Some(request) = parse_runtime_approval_request_event(
            &accumulator.name,
            &input,
            accumulator.tool_use_id.as_deref(),
        ) {
            accumulator.emitted_approval_request = true;
            events.push(json!({ "type": "approval-request", "runId": run_id, "request": request }));
        }
    }
}

fn parse_json_object(value: &str) -> Option<Value> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let parsed = serde_json::from_str::<Value>(trimmed).ok()?;
    parsed.as_object()?;
    Some(parsed)
}

fn get_tool_input_seed(input: &Value) -> String {
    if !input.is_object() {
        return String::new();
    }
    input
        .as_object()
        .filter(|object| !object.is_empty())
        .and_then(|_| serde_json::to_string(input).ok())
        .unwrap_or_default()
}

fn stringify_claude_content(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    if let Some(items) = content.as_array() {
        return items
            .iter()
            .map(|item| {
                if let Some(text) = item.as_str() {
                    return text.to_string();
                }
                if let Some(text) = item.get("text").and_then(Value::as_str) {
                    return text.to_string();
                }
                serde_json::to_string_pretty(item).unwrap_or_default()
            })
            .collect::<Vec<_>>()
            .join("\n");
    }
    if content.is_null() {
        String::new()
    } else {
        serde_json::to_string_pretty(content).unwrap_or_default()
    }
}

fn is_internal_human_input_tool_result(
    run: &ActiveRunRecord,
    tool_use_id: Option<&str>,
    content: &str,
    is_error: bool,
) -> bool {
    let Some(tool_use_id) = tool_use_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return false;
    };
    let key = format!("id:{tool_use_id}");
    if run.emitted_request_user_input_keys.contains(&key) {
        return true;
    }
    if !run.emitted_approval_request_keys.contains(&key) {
        return false;
    }
    !is_error || is_expected_approval_interruption_content(content)
}

fn is_expected_approval_interruption_content(content: &str) -> bool {
    let normalized = content.trim().to_ascii_lowercase();
    normalized == "exit plan mode?"
        || normalized.contains("exit plan mode?")
        || is_human_approval_tool_result_content(content)
}

fn is_human_approval_tool_result_content(content: &str) -> bool {
    let normalized = content.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }
    normalized.contains("this command requires approval")
        || normalized.contains("requires approval")
        || normalized.contains("requires your approval")
        || normalized.contains("approval required")
        || (normalized.contains("was blocked")
            && normalized.contains("for security")
            && normalized.contains("claude code"))
}

fn emit_run_event(state: &AppState, run_id: &str, event: Value) {
    match event.get("type").and_then(Value::as_str) {
        Some("request-user-input") => {
            let Some(request) = event.get("request") else {
                push_run_event(state, run_id, event);
                return;
            };
            let key = request_user_input_key(request);
            let should_emit = {
                let Ok(mut runs) = state.runs.lock() else {
                    return;
                };
                let Some(run) = runs.get_mut(run_id) else {
                    return;
                };
                if run.emitted_request_user_input_keys.contains(&key) {
                    false
                } else {
                    run.emitted_request_user_input_keys.insert(key);
                    run.paused_for_user_input = true;
                    true
                }
            };
            if should_emit {
                push_run_event(state, run_id, event);
                push_trace_event(
                    state,
                    run_id,
                    "paused_for_user_input",
                    current_timestamp_ms_i64(),
                    None,
                );
            }
        }
        Some("approval-request") => {
            let Some(request) = event.get("request") else {
                push_run_event(state, run_id, event);
                return;
            };
            let key = approval_request_key(request);
            let auto_approve = {
                let Ok(mut runs) = state.runs.lock() else {
                    return;
                };
                let Some(run) = runs.get_mut(run_id) else {
                    return;
                };
                if run.emitted_approval_request_keys.contains(&key) {
                    return;
                }
                run.emitted_approval_request_keys.insert(key);
                should_auto_approve_bypass_permission_request(run, request)
            };
            if auto_approve {
                auto_approve_permission_request(state.clone(), run_id.to_string(), event);
            } else {
                if let Ok(mut runs) = state.runs.lock() {
                    if let Some(run) = runs.get_mut(run_id) {
                        run.paused_for_user_input = true;
                    }
                }
                push_run_event(state, run_id, event);
                push_trace_event(
                    state,
                    run_id,
                    "paused_for_approval_request",
                    current_timestamp_ms_i64(),
                    None,
                );
            }
        }
        _ => push_run_event(state, run_id, event),
    }
}

fn auto_approve_permission_request(state: AppState, run_id: String, event: Value) {
    let request_id = event
        .get("request")
        .and_then(|request| request.get("requestId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let Some(request_id) = request_id else {
        push_run_event(&state, &run_id, event);
        return;
    };
    tokio::spawn(async move {
        let message = approval_response_message_for_request(
            &state,
            &run_id,
            &request_id,
            "approve",
            "The user approved this request. Continue the original task.",
        );
        let result = match message {
            Ok(message) => write_run_stdin_message(&state, &run_id, &message).await,
            Err(error) => Err(error),
        };
        match result {
            Ok(()) => {
                mark_run_human_input_resumed(&state, &run_id, &request_id);
                push_run_event(
                    &state,
                    &run_id,
                    json!({ "type": "trace", "runId": run_id, "name": "auto_approved_bypass_permission", "atMs": current_timestamp_ms_i64(), "detail": request_id }),
                );
            }
            Err(_) => {
                if let Ok(mut runs) = state.runs.lock() {
                    if let Some(run) = runs.get_mut(&run_id) {
                        run.paused_for_user_input = true;
                    }
                }
                push_run_event(&state, &run_id, event);
                push_trace_event(
                    &state,
                    &run_id,
                    "paused_for_approval_request",
                    current_timestamp_ms_i64(),
                    None,
                );
            }
        }
    });
}

fn approval_response_message_for_request(
    state: &AppState,
    run_id: &str,
    request_id: &str,
    decision: &str,
    content: &str,
) -> ApiResult<Value> {
    Ok(
        if let Some((control_request_id, tool_use_id)) =
            control_response_ids_for_request(state, run_id, request_id)?
        {
            build_claude_control_response_message(
                &control_request_id,
                decision,
                tool_use_id.as_deref(),
            )
        } else {
            build_claude_tool_result_message(request_id, content, decision == "reject")
        },
    )
}

fn should_auto_approve_bypass_permission_request(run: &ActiveRunRecord, request: &Value) -> bool {
    run.permission_mode == "bypassPermissions"
        && !run.finished
        && run.stdin.is_some()
        && request.get("kind").and_then(Value::as_str) == Some("permission")
        && request
            .get("requestId")
            .and_then(Value::as_str)
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
}

fn request_user_input_key(request: &Value) -> String {
    if let Some(request_id) = request
        .get("requestId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return format!("id:{request_id}");
    }
    format!(
        "shape:{}",
        json!({
            "title": request.get("title").cloned().unwrap_or(Value::Null),
            "description": request.get("description").cloned().unwrap_or(Value::Null),
            "questions": request.get("questions").cloned().unwrap_or(Value::Null),
        })
    )
}

fn approval_request_key(request: &Value) -> String {
    if let Some(request_id) = request
        .get("requestId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return format!("id:{request_id}");
    }
    format!(
        "shape:{}",
        json!({
            "title": request.get("title").cloned().unwrap_or(Value::Null),
            "description": request.get("description").cloned().unwrap_or(Value::Null),
            "command": request.get("command").cloned().unwrap_or(Value::Null),
            "danger": request.get("danger").cloned().unwrap_or(Value::Null),
        })
    )
}

fn parse_control_request_user_input(payload: &Value) -> Option<Value> {
    let request = payload.get("request")?;
    if request.get("subtype").and_then(Value::as_str) != Some("can_use_tool") {
        return None;
    }
    let tool_name = first_json_string(request, &["tool_name", "toolName", "name"])?;
    let tool_use_id = request
        .get("tool_use_id")
        .or_else(|| request.get("toolUseId"))
        .and_then(Value::as_str);
    parse_request_user_input_event(
        tool_name,
        request.get("input").unwrap_or(&Value::Null),
        tool_use_id,
    )
}

fn parse_control_approval_request(payload: &Value) -> Option<Value> {
    let request = payload.get("request")?;
    if request.get("subtype").and_then(Value::as_str) != Some("can_use_tool") {
        return None;
    }
    let request_id = payload.get("request_id").and_then(Value::as_str)?;
    let tool_name =
        first_json_string(request, &["tool_name", "toolName", "name"]).unwrap_or("tool");
    let input = request.get("input").unwrap_or(&Value::Null);
    if normalize_tool_name(tool_name) == "exitplanmode" {
        return Some(json!({
            "requestId": request_id,
            "kind": "plan-exit",
            "title": "计划待确认",
            "description": first_json_string(input, &["plan", "description", "reason", "message"]),
            "danger": "low",
        }));
    }
    Some(json!({
        "requestId": request_id,
        "kind": "permission",
        "title": first_json_string(request, &["title", "display_name", "displayName", "message", "question"]).map(ToString::to_string).unwrap_or_else(|| format!("等待批准：{tool_name}")),
        "description": first_json_string(request, &["description", "decision_reason", "decisionReason"]),
        "command": normalize_approval_command(input.get("command").or_else(|| input.get("argv")).or_else(|| input.get("args"))),
        "danger": normalize_danger_level(first_json_string(request, &["danger", "risk"])),
    }))
}

fn parse_request_user_input_event(
    tool_name: &str,
    input: &Value,
    tool_use_id: Option<&str>,
) -> Option<Value> {
    let normalized = normalize_tool_name(tool_name);
    let raw_questions = input.get("questions").and_then(Value::as_array)?;
    let has_shape = raw_questions.iter().any(has_request_user_input_shape);
    if normalized != "requestuserinput" && normalized != "askuserquestion" && !has_shape {
        return None;
    }
    let questions = raw_questions
        .iter()
        .enumerate()
        .filter_map(|(index, question)| parse_request_user_input_question(question, index))
        .collect::<Vec<_>>();
    if questions.is_empty() {
        return None;
    }
    Some(json!({
        "requestId": first_json_string(input, &["requestId", "request_id", "toolUseId", "tool_use_id"]).or(tool_use_id),
        "title": first_json_string(input, &["title", "message", "prompt"]).unwrap_or("需要你的选择"),
        "description": first_json_string(input, &["description", "instructions"]),
        "questions": questions,
    }))
}

fn parse_request_user_input_question(question: &Value, index: usize) -> Option<Value> {
    let text = first_json_string(question, &["question", "text", "prompt", "message"])
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let options = question
        .get("options")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|option| {
                    let label = first_json_string(option, &["label", "title", "value"])?;
                    Some(json!({
                        "label": label,
                        "description": first_json_string(option, &["description", "detail", "details"]),
                    }))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Some(json!({
        "id": first_json_string(question, &["id", "name", "key"]).map(ToString::to_string).unwrap_or_else(|| format!("question-{index}")),
        "header": first_json_string(question, &["header", "title"]),
        "question": text,
        "options": options,
        "multiSelect": question.get("multiSelect").or_else(|| question.get("multi_select")).and_then(Value::as_bool).unwrap_or(false),
        "required": question.get("required").and_then(Value::as_bool).unwrap_or(false),
        "secret": question.get("secret").and_then(Value::as_bool).unwrap_or(false),
        "isOther": !options.is_empty() || question.get("isOther").or_else(|| question.get("is_other")).and_then(Value::as_bool).unwrap_or(false),
        "placeholder": first_json_string(question, &["placeholder"]),
    }))
}

fn parse_approval_request_event(
    tool_name: &str,
    input: &Value,
    tool_use_id: Option<&str>,
) -> Option<Value> {
    let normalized = normalize_tool_name(tool_name);
    if normalized == "exitplanmode" {
        return Some(json!({
            "requestId": first_json_string(input, &["requestId", "request_id", "toolUseId", "tool_use_id"]).or(tool_use_id),
            "kind": "plan-exit",
            "title": "计划待确认",
            "description": first_json_string(input, &["plan", "description", "reason", "message"]),
            "danger": "low",
        }));
    }
    if normalized != "approvalrequest" {
        return None;
    }
    Some(json!({
        "requestId": first_json_string(input, &["requestId", "request_id", "toolUseId", "tool_use_id"]).or(tool_use_id),
        "kind": "permission",
        "title": first_json_string(input, &["title", "message", "question"]).unwrap_or("等待批准"),
        "description": first_json_string(input, &["description", "reason"]),
        "command": normalize_approval_command(input.get("command").or_else(|| input.get("argv")).or_else(|| input.get("args"))),
        "danger": normalize_danger_level(first_json_string(input, &["danger", "risk"])),
    }))
}

fn parse_runtime_approval_request_event(
    tool_name: &str,
    input: &Value,
    tool_use_id: Option<&str>,
) -> Option<Value> {
    if normalize_tool_name(tool_name) == "exitplanmode" {
        return None;
    }
    parse_approval_request_event(tool_name, input, tool_use_id)
}

fn first_json_string<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn normalize_tool_name(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn has_request_user_input_shape(value: &Value) -> bool {
    first_json_string(value, &["question", "text", "prompt", "message"]).is_some()
}

fn normalize_approval_command(value: Option<&Value>) -> Value {
    let Some(items) = value.and_then(Value::as_array) else {
        return Value::Null;
    };
    Value::Array(
        items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| json!(value))
            .collect(),
    )
}

fn normalize_danger_level(value: Option<&str>) -> Value {
    match value {
        Some("low") | Some("medium") | Some("high") => json!(value),
        _ => Value::Null,
    }
}

fn push_run_event(state: &AppState, run_id: &str, event: Value) {
    let mut runtime_session_update: Option<(String, String)> = None;
    let mut notify: Option<Arc<tokio::sync::Notify>> = None;
    if let Ok(mut runs) = state.runs.lock() {
        if let Some(run) = runs.get_mut(run_id) {
            if !should_store_run_event(&mut run.last_phase_event, &event) {
                return;
            }
            if event.get("type").and_then(Value::as_str) == Some("session") {
                if let Some(session_id) = event.get("sessionId").and_then(Value::as_str) {
                    run.session_id = Some(session_id.to_string());
                    runtime_session_update = Some((run.thread_id.clone(), session_id.to_string()));
                }
            }
            run.events.push(event);
            notify = Some(run.notify.clone());
        }
    }
    if let Some((thread_id, session_id)) = runtime_session_update {
        if let Ok(mut runtimes) = state.runtimes.lock() {
            if let Some(runtime) = runtimes.get_mut(&thread_id) {
                runtime.session_id = Some(session_id);
            }
        }
    }
    if let Some(notify) = notify {
        notify.notify_waiters();
    }
}

fn should_store_run_event(last_phase_event: &mut Option<Value>, event: &Value) -> bool {
    if event.get("type").and_then(Value::as_str) != Some("phase") {
        return true;
    }

    let phase_event = json!({
        "phase": event.get("phase"),
        "label": event.get("label"),
        "thoughtCount": event.get("thoughtCount"),
    });
    if last_phase_event.as_ref() == Some(&phase_event) {
        return false;
    }
    *last_phase_event = Some(phase_event);
    true
}

fn push_trace_event(state: &AppState, run_id: &str, name: &str, at_ms: i64, detail: Option<&str>) {
    let started_at_ms = state
        .runs
        .lock()
        .ok()
        .and_then(|runs| runs.get(run_id).map(|run| run.started_at_ms))
        .unwrap_or(at_ms);
    let mut event = json!({
        "type": "trace",
        "runId": run_id,
        "name": name,
        "atMs": at_ms,
        "elapsedMs": (at_ms - started_at_ms).max(0),
    });
    if let Some(detail) = detail {
        if let Some(object) = event.as_object_mut() {
            object.insert("detail".to_string(), json!(detail));
        }
    }
    push_run_event(state, run_id, event);
}

fn mark_run_finished(state: &AppState, run_id: &str) {
    let mut notify = None;
    let mut should_schedule_cleanup = false;
    if let Ok(mut runs) = state.runs.lock() {
        if let Some(run) = runs.get_mut(run_id) {
            if !run.finished {
                should_schedule_cleanup = true;
            }
            run.finished = true;
            run.child_id = None;
            run.stdin = None;
            notify = Some(run.notify.clone());
        }
    }
    if let Some(notify) = notify {
        notify.notify_waiters();
    }
    if should_schedule_cleanup {
        schedule_run_record_cleanup(state.clone(), run_id.to_string());
    }
}

fn schedule_run_record_cleanup(state: AppState, run_id: String) {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(RUN_RECONNECT_RETENTION_MS)).await;
        remove_finished_run_record(&state, &run_id);
    });
}

fn remove_finished_run_record(state: &AppState, run_id: &str) -> bool {
    let Ok(mut runs) = state.runs.lock() else {
        return false;
    };
    if runs.get(run_id).is_some_and(|run| run.finished) {
        runs.remove(run_id);
        return true;
    }
    false
}

fn remove_run_records_for_thread(state: &AppState, thread_id: &str) {
    if let Ok(mut runs) = state.runs.lock() {
        runs.retain(|_, run| run.thread_id != thread_id);
    }
}

fn kill_run_child(state: &AppState, run_id: &str) -> ApiResult<bool> {
    let child_id = state
        .runs
        .lock()
        .map_err(|error| ApiError::internal(format!("读取运行状态失败: {error}")))?
        .get(run_id)
        .and_then(|run| run.child_id);
    let Some(child_id) = child_id else {
        return Ok(false);
    };
    kill_process_tree(child_id)
}

fn active_run_json(run: &ActiveRunRecord) -> Value {
    json!({
        "active": true,
        "runId": run.run_id,
        "threadId": run.thread_id,
        "turnId": run.turn_id,
        "prompt": run.prompt,
        "userContentBlocks": run.user_content_blocks,
        "workingDirectory": run.working_directory,
        "sessionId": run.session_id,
        "permissionMode": run.permission_mode,
        "model": run.model,
        "effort": run.effort,
        "channelId": run.channel_id,
        "startedAtMs": run.started_at_ms,
        "eventCount": run.events.len(),
        "finished": run.finished,
    })
}

fn current_timestamp_ms_i64() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn read_state_value(connection: &Connection, key: &str) -> ApiResult<Option<String>> {
    connection
        .query_row(
            "SELECT value FROM app_state WHERE key = ?",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| ApiError::internal(format!("读取工作区状态失败: {error}")))
}

fn write_state_value(connection: &Connection, key: &str, value: impl AsRef<str>) -> ApiResult<()> {
    let value = value.as_ref();
    connection
        .execute(
            r#"
            INSERT INTO app_state (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            "#,
            params![key, value],
        )
        .map(|_| ())
        .map_err(|error| ApiError::internal(format!("保存工作区状态失败: {error}")))
}

fn thread_summary_json(
    thread: &ThreadRow,
    model_preferences: Option<&Map<String, Value>>,
) -> Value {
    let mut value = json!({
        "id": thread.id,
        "projectId": thread.project_id,
        "title": thread.title,
        "sessionId": thread.session_id.clone().unwrap_or_default(),
        "workingDirectory": thread.working_directory,
        "updatedAt": thread.updated_at,
        "updatedLabel": format_updated_label(&thread.updated_at),
        "provider": thread.provider,
        "imported": thread.imported,
    });
    if let Some(object) = value.as_object_mut() {
        if let Some(model) = thread.model.as_ref() {
            object.insert("model".to_string(), json!(model));
        }
        if let Some(reasoning_effort) = thread.reasoning_effort.as_ref() {
            object.insert("reasoningEffort".to_string(), json!(reasoning_effort));
        }
        if let Some(model_preferences) = model_preferences.filter(|value| !value.is_empty()) {
            object.insert(
                "modelPreferences".to_string(),
                Value::Object(model_preferences.clone()),
            );
        }
        if let Some(permission_mode) = thread.permission_mode.as_ref() {
            object.insert("permissionMode".to_string(), json!(permission_mode));
        }
        if let Some(agent_channel_id) = thread.agent_channel_id.as_ref() {
            object.insert("agentChannelId".to_string(), json!(agent_channel_id));
        }
        if let Some(agent_channel_fingerprint) = thread.agent_channel_fingerprint.as_ref() {
            object.insert(
                "agentChannelFingerprint".to_string(),
                json!(agent_channel_fingerprint),
            );
        }
        if let Some(pinned_at) = thread.pinned_at.as_ref() {
            object.insert("pinnedAt".to_string(), json!(pinned_at));
        }
    }
    value
}

fn format_updated_label(updated_at: &str) -> String {
    let Ok(timestamp) = chrono::DateTime::parse_from_rfc3339(updated_at) else {
        return "现在".to_string();
    };
    let diff_minutes = chrono::Utc::now()
        .signed_duration_since(timestamp.with_timezone(&chrono::Utc))
        .num_minutes()
        .max(0);
    if diff_minutes < 1 {
        "现在".to_string()
    } else if diff_minutes < 60 {
        format!("{diff_minutes} 分钟前")
    } else {
        let hours = diff_minutes / 60;
        if hours < 24 {
            format!("{hours} 小时前")
        } else {
            let days = hours / 24;
            if days < 30 {
                format!("{days} 天前")
            } else {
                timestamp.format("%-m/%-d").to_string()
            }
        }
    }
}

fn empty_git_diff() -> GitDiffSummary {
    GitDiffSummary {
        additions: 0,
        deletions: 0,
        files_changed: 0,
    }
}

fn read_git_info(project_path: &str, include_diff: bool) -> GitInfo {
    if !Path::new(project_path).exists() {
        return GitInfo {
            is_git_repo: false,
            branch: None,
            diff: empty_git_diff(),
        };
    }

    let repo_check = background_command("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(project_path)
        .output();
    let is_git_repo = repo_check
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .is_some_and(|stdout| stdout.trim() == "true");

    if !is_git_repo {
        return GitInfo {
            is_git_repo: false,
            branch: None,
            diff: empty_git_diff(),
        };
    }

    GitInfo {
        is_git_repo: true,
        branch: read_git_branch(project_path),
        diff: if include_diff {
            read_git_diff_summary(project_path)
        } else {
            empty_git_diff()
        },
    }
}

fn read_git_branch(project_path: &str) -> Option<String> {
    background_command("git")
        .args(["branch", "--show-current"])
        .current_dir(project_path)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|stdout| stdout.trim().to_string())
        .filter(|branch| !branch.is_empty())
}

fn read_git_diff_summary(project_path: &str) -> GitDiffSummary {
    let Some(output) = background_command("git")
        .args(["diff", "--shortstat"])
        .current_dir(project_path)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
    else {
        return empty_git_diff();
    };

    parse_git_diff_shortstat(&output)
}

fn parse_git_diff_shortstat(value: &str) -> GitDiffSummary {
    let mut summary = empty_git_diff();
    let parts: Vec<&str> = value.split(',').collect();
    for part in parts {
        let trimmed = part.trim();
        if trimmed.contains("file") {
            summary.files_changed = leading_number(trimmed);
        } else if trimmed.contains("insertion") {
            summary.additions = leading_number(trimmed);
        } else if trimmed.contains("deletion") {
            summary.deletions = leading_number(trimmed);
        }
    }
    summary
}

fn leading_number(value: &str) -> u32 {
    value
        .split_whitespace()
        .next()
        .and_then(|number| number.parse::<u32>().ok())
        .unwrap_or(0)
}

fn is_git_worktree(project_path: &str) -> bool {
    Path::new(project_path).join(".git").is_file()
}

fn settings_path(state: &AppState) -> PathBuf {
    state.app_data_dir.join("settings.json")
}

fn resolve_app_data_dir() -> Result<PathBuf, String> {
    if let Some(path) = env::var("CODEM_APP_DATA_DIR")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return Ok(PathBuf::from(path));
    }

    if let Some(base) = env::var("LOCALAPPDATA")
        .ok()
        .or_else(|| env::var("APPDATA").ok())
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(PathBuf::from(base).join("CodeM"));
    }

    home_dir()
        .map(|home| home.join("AppData").join("Local").join("CodeM"))
        .ok_or_else(|| "无法定位应用数据目录".to_string())
}

fn home_dir() -> Option<PathBuf> {
    env::var("USERPROFILE")
        .ok()
        .or_else(|| env::var("HOME").ok())
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::{
        apply_agent_lifecycle_proxy_environment, build_agent_lifecycle_plan,
        build_claude_input_message, build_request_user_input_response_answers,
        claude_input_message_has_content, claude_install_display_command,
        claude_install_lifecycle_plan, claude_uninstalled_update_lifecycle_plan,
        compare_project_file_entries, configure_agent_lifecycle_environment, create_router,
        create_thread_row, default_claude_command_paths, default_grok_command_path,
        desktop_cors_layer, ensure_agent_plugin_management_supported,
        extract_agent_semantic_version, import_claude_sessions_from_root,
        initialize_workspace_database, install_skill_directory_safely,
        is_agent_lifecycle_network_failure, lifecycle_plan, lifecycle_plan_supports_npm_mirror,
        list_agent_installed_plugins_value, list_agent_plugin_marketplaces_value,
        list_agent_skills_value, list_slash_commands_value, mark_request_user_input_submitted,
        normalize_agent_plugin_action, normalize_agent_runtime_settings,
        normalize_request_user_input_answer_value, parse_grok_cli_version,
        parse_grok_latest_version, parse_macos_system_proxy_environment, parse_npm_latest_version,
        parse_request_user_input_event, read_opencode_mcp_config, read_stored_thread_history,
        read_thread_detail, read_thread_summary, remove_thread_row, resolve_codex_command,
        resolve_first_runnable_command, resolve_grok_command, resolve_opencode_command,
        resolve_requested_thread_provider, resolve_thread_create_permission_mode,
        resolve_workspace_relative_path, sanitize_agent_lifecycle_output, search_workspace_files,
        select_runnable_command_candidate, should_emit_claude_raw_event, should_store_run_event,
        summarize_content_blocks, update_thread_metadata_from_payload, validate_desktop_file_path,
        validate_managed_agent_skill_path, write_opencode_mcp_config, write_thread_history,
        ApiError, AppState,
    };
    use crate::agent_runtime::{
        CLAUDE_CODE_PROVIDER_ID, GROK_BUILD_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID,
        OPENCODE_PROVIDER_ID,
    };
    use axum::{
        body::Body,
        http::{header, Method, Request, StatusCode},
    };
    use rusqlite::{params, Connection};
    use serde_json::{json, Value};
    use std::{
        collections::HashMap,
        fs,
        path::PathBuf,
        sync::{Arc, Mutex},
    };
    use tower::ServiceExt;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("codem-{label}-{}", uuid::Uuid::new_v4().simple()));
            fs::create_dir_all(&path).expect("create test directory");
            Self(path)
        }
    }

    #[test]
    fn agent_lifecycle_plans_only_cover_supported_providers() {
        let claude_plan = build_agent_lifecycle_plan(CLAUDE_CODE_PROVIDER_ID, "install", None)
            .expect("build Claude install plan");
        let expected_claude_plan =
            claude_install_lifecycle_plan(cfg!(target_os = "macos"), cfg!(target_os = "windows"));
        assert_eq!(claude_plan.program, expected_claude_plan.program);
        assert_eq!(claude_plan.args, expected_claude_plan.args);
        assert_eq!(
            claude_plan.display_command,
            expected_claude_plan.display_command
        );

        let cases = [
            (OPENAI_CODEX_PROVIDER_ID, "@openai/codex"),
            (OPENCODE_PROVIDER_ID, "opencode-ai"),
        ];
        for (provider_id, expected_package) in cases {
            let plan = build_agent_lifecycle_plan(provider_id, "install", None)
                .expect("build install plan");
            assert!(plan.display_command.contains(expected_package));
            assert!(!plan.program.trim().is_empty());
            assert!(!plan.args.is_empty());
        }
        assert!(build_agent_lifecycle_plan("unknown-agent", "install", None).is_err());
    }

    #[test]
    fn macos_claude_install_uses_official_native_installer_without_path_lookup() {
        let plan = claude_install_lifecycle_plan(true, false);

        assert_eq!(plan.program, "/bin/sh");
        assert_eq!(
            plan.args,
            vec![
                "-c".to_string(),
                "/usr/bin/curl -fsSL https://claude.ai/install.sh | /bin/bash".to_string(),
            ]
        );
        assert_eq!(
            plan.display_command,
            "/usr/bin/curl -fsSL https://claude.ai/install.sh | /bin/bash"
        );
        assert!(!lifecycle_plan_supports_npm_mirror(&plan));
    }

    #[test]
    fn windows_claude_install_keeps_existing_npm_plan() {
        let plan = claude_install_lifecycle_plan(false, true);

        assert_eq!(plan.program, "npm.cmd");
        assert_eq!(
            plan.args,
            vec![
                "install".to_string(),
                "-g".to_string(),
                "@anthropic-ai/claude-code@latest".to_string(),
            ]
        );
        assert_eq!(
            plan.display_command,
            "npm install -g @anthropic-ai/claude-code"
        );
        assert!(lifecycle_plan_supports_npm_mirror(&plan));

        let update_plan = claude_uninstalled_update_lifecycle_plan(false, true);
        assert_eq!(update_plan.program, "npm.cmd");
        assert_eq!(update_plan.args, plan.args);
        assert_eq!(update_plan.display_command, plan.display_command);
    }

    #[test]
    fn macos_uninstalled_claude_update_displays_native_update_command() {
        let plan = claude_uninstalled_update_lifecycle_plan(true, false);

        assert_eq!(plan.program, "claude");
        assert_eq!(plan.args, vec!["update".to_string()]);
        assert_eq!(plan.display_command, "claude update");
        assert_eq!(
            claude_install_display_command(),
            if cfg!(target_os = "macos") {
                "/usr/bin/curl -fsSL https://claude.ai/install.sh | /bin/bash"
            } else {
                "npm install -g @anthropic-ai/claude-code"
            }
        );
    }

    #[test]
    fn agent_lifecycle_output_is_bounded_and_hides_credentials() {
        assert_eq!(
            sanitize_agent_lifecycle_output("request failed: Authorization Bearer sk-secret"),
            "命令输出包含敏感字段，已隐藏"
        );
        assert_eq!(
            sanitize_agent_lifecycle_output(&"a".repeat(5000)).len(),
            4000
        );
    }

    #[test]
    fn agent_lifecycle_npm_latest_version_parser_reads_dist_tag() {
        assert_eq!(
            parse_npm_latest_version(&json!({ "latest": " 2.1.211 " })).as_deref(),
            Some("2.1.211")
        );
        assert_eq!(
            parse_npm_latest_version(&json!({
                "dist-tags": { "latest": "2.1.210" }
            }))
            .as_deref(),
            Some("2.1.210")
        );
        assert_eq!(
            parse_npm_latest_version(&json!({ "dist-tags": { "next": "2.2.0" } })),
            None
        );
        assert_eq!(
            parse_npm_latest_version(&json!({ "dist-tags": { "latest": "  " } })),
            None
        );
    }

    #[test]
    fn agent_lifecycle_grok_latest_version_parser_reads_official_update_payload() {
        let result = parse_grok_latest_version(
            "Checking for updates...\n{\"currentVersion\":\"0.2.99\",\"latestVersion\":\"0.2.101\",\"updateAvailable\":true,\"installer\":\"internal\",\"channel\":\"stable\",\"autoUpdate\":true,\"error\":null}\n",
        )
        .expect("parse Grok update payload");

        assert_eq!(result.latest_version.as_deref(), Some("0.2.101"));
        assert_eq!(result.error, None);

        let failed = parse_grok_latest_version(
            "{\"currentVersion\":\"0.2.99\",\"latestVersion\":null,\"updateAvailable\":false,\"error\":\"program not found\"}",
        )
        .expect("parse Grok update error");
        assert_eq!(
            failed.error.as_deref(),
            Some("Grok Build 官方更新器查询失败：program not found")
        );
    }

    #[test]
    fn agent_lifecycle_removes_parent_npm_user_agent_only_for_grok() {
        let mut grok = tokio::process::Command::new("grok");
        grok.env(super::NPM_CONFIG_USER_AGENT_ENV, "npm/11.4.2");
        configure_agent_lifecycle_environment(GROK_BUILD_PROVIDER_ID, &mut grok);
        let grok_user_agent = grok
            .as_std()
            .get_envs()
            .find(|(name, _)| *name == super::NPM_CONFIG_USER_AGENT_ENV)
            .expect("Grok npm user-agent override");
        assert_eq!(grok_user_agent.1, None);

        let mut codex = tokio::process::Command::new("codex");
        codex.env(super::NPM_CONFIG_USER_AGENT_ENV, "npm/11.4.2");
        configure_agent_lifecycle_environment(OPENAI_CODEX_PROVIDER_ID, &mut codex);
        let codex_user_agent = codex
            .as_std()
            .get_envs()
            .find(|(name, _)| *name == super::NPM_CONFIG_USER_AGENT_ENV)
            .and_then(|(_, value)| value)
            .and_then(|value| value.to_str());
        assert_eq!(codex_user_agent, Some("npm/11.4.2"));
    }

    #[test]
    fn macos_system_proxy_parser_supports_http_https_and_socks() {
        let proxy_environment = parse_macos_system_proxy_environment(
            r#"<dictionary> {
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7890
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 1
  SOCKSPort : 7891
  SOCKSProxy : ::1
}"#,
        );

        assert_eq!(
            proxy_environment,
            vec![
                (
                    "http_proxy".to_string(),
                    "http://127.0.0.1:7890".to_string()
                ),
                (
                    "HTTP_PROXY".to_string(),
                    "http://127.0.0.1:7890".to_string()
                ),
                (
                    "https_proxy".to_string(),
                    "http://127.0.0.1:7890".to_string()
                ),
                (
                    "HTTPS_PROXY".to_string(),
                    "http://127.0.0.1:7890".to_string()
                ),
                ("all_proxy".to_string(), "socks5h://[::1]:7891".to_string()),
                ("ALL_PROXY".to_string(), "socks5h://[::1]:7891".to_string()),
            ]
        );
    }

    #[test]
    fn macos_system_proxy_parser_ignores_disabled_or_invalid_entries() {
        assert!(parse_macos_system_proxy_environment(
            r#"<dictionary> {
  HTTPEnable : 0
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : invalid
  HTTPSProxy : proxy.local
  SOCKSEnable : 1
  SOCKSPort : 7890
  SOCKSProxy : invalid host
}"#,
        )
        .is_empty());
    }

    #[test]
    fn agent_lifecycle_proxy_keeps_explicit_environment_and_applies_system_fallback() {
        let proxy_environment = vec![
            (
                "https_proxy".to_string(),
                "http://127.0.0.1:7890".to_string(),
            ),
            (
                "HTTPS_PROXY".to_string(),
                "http://127.0.0.1:7890".to_string(),
            ),
        ];

        let mut inherited = tokio::process::Command::new("claude");
        assert!(!apply_agent_lifecycle_proxy_environment(
            &mut inherited,
            &proxy_environment,
            true,
        ));
        assert!(!inherited.as_std().get_envs().any(|_| true));

        let mut explicit = tokio::process::Command::new("claude");
        explicit.env("HTTPS_PROXY", "http://explicit-proxy:8080");
        assert!(!apply_agent_lifecycle_proxy_environment(
            &mut explicit,
            &proxy_environment,
            false,
        ));
        let explicit_proxy = explicit
            .as_std()
            .get_envs()
            .find(|(name, _)| *name == "HTTPS_PROXY")
            .and_then(|(_, value)| value)
            .and_then(|value| value.to_str());
        assert_eq!(explicit_proxy, Some("http://explicit-proxy:8080"));

        let mut fallback = tokio::process::Command::new("claude");
        assert!(apply_agent_lifecycle_proxy_environment(
            &mut fallback,
            &proxy_environment,
            false,
        ));
        let fallback_proxy = fallback
            .as_std()
            .get_envs()
            .find(|(name, _)| name.eq_ignore_ascii_case(std::ffi::OsStr::new("HTTPS_PROXY")))
            .and_then(|(_, value)| value)
            .and_then(|value| value.to_str());
        assert_eq!(fallback_proxy, Some("http://127.0.0.1:7890"));
    }

    #[test]
    fn agent_lifecycle_version_parser_extracts_cli_semantic_versions() {
        assert_eq!(
            extract_agent_semantic_version("claude 2.1.211 (Claude Code)").as_deref(),
            Some("2.1.211")
        );
        assert_eq!(
            extract_agent_semantic_version("codex-cli v0.144.5").as_deref(),
            Some("0.144.5")
        );
        assert_eq!(
            extract_agent_semantic_version("opencode version 1.18.2-beta.1").as_deref(),
            Some("1.18.2-beta.1")
        );
        assert_eq!(extract_agent_semantic_version("version unknown"), None);
    }

    #[test]
    fn agent_lifecycle_npm_mirror_retry_only_accepts_supported_package_managers() {
        for program in ["npm.cmd", "pnpm.exe", "bun"] {
            let plan = lifecycle_plan(program, ["install"], "install Agent");
            assert!(lifecycle_plan_supports_npm_mirror(&plan), "{program}");
        }
        for program in ["volta.exe", "powershell.exe", "grok.exe", "brew"] {
            let plan = lifecycle_plan(program, ["install"], "install Agent");
            assert!(!lifecycle_plan_supports_npm_mirror(&plan), "{program}");
        }
    }

    #[test]
    fn agent_lifecycle_mirror_retry_requires_a_network_failure() {
        for message in [
            "npm ERR! code ECONNRESET",
            "request failed: connect timeout",
            "fetch failed: could not resolve host",
            "failed to download package",
        ] {
            assert!(is_agent_lifecycle_network_failure(message), "{message}");
        }
        for message in [
            "npm ERR! code E404 package not found",
            "npm ERR! code E401 unauthorized",
            "npm ERR! code EACCES permission denied",
            "preinstall script failed",
        ] {
            assert!(!is_agent_lifecycle_network_failure(message), "{message}");
        }
    }

    #[test]
    fn api_errors_can_be_forced_to_json_for_lifecycle_requests() {
        let error = ApiError::internal("failed").into_json_body();
        assert!(error.json_body);
        assert_eq!(error.status, StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn claude_input_message_maps_all_supported_content_blocks() {
        let blocks = json!([
            {
                "type": "text",
                "text": "  请结合这些输入继续  "
            },
            {
                "type": "image",
                "path": "D:\\workspace\\image.png",
                "name": "image.png",
                "mimeType": "image/png",
                "data": "SGVsbG8="
            },
            {
                "type": "file_reference",
                "path": "D:\\workspace\\src\\App.tsx",
                "name": "App.tsx",
                "reason": "too_large"
            },
            {
                "type": "file_text",
                "path": "D:\\workspace\\notes\\todo.md",
                "name": "todo.md",
                "text": "console.log(\"hi\")"
            },
            {
                "type": "attachment_metadata",
                "name": "archive.zip",
                "reason": "binary"
            }
        ]);

        let message =
            build_claude_input_message("legacy prompt should be ignored", Some(&blocks), None);

        assert_eq!(
            message.pointer("/message/content").unwrap(),
            &json!([
                {
                    "type": "text",
                    "text": "请结合这些输入继续"
                },
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": "SGVsbG8="
                    }
                },
                {
                    "type": "text",
                    "text": "（以下为图片附件信息，多模态模型可直接查看上面的图片，无需读取文件）\n名称：image.png\n路径：D:/workspace/image.png\n如果你无法直接识别上面的图片，请使用 ViewImage 查看该路径，不要用 Read 或 Grep 读取图片内容。"
                },
                {
                    "type": "text",
                    "text": "文件已作为路径引用提供：D:/workspace/src/App.tsx\n原因：too_large\n可使用 Read 等工具按需读取该文件内容。"
                },
                {
                    "type": "text",
                    "text": "文件 D:/workspace/notes/todo.md 内容：\n\nconsole.log(\"hi\")"
                },
                {
                    "type": "text",
                    "text": "附件未直接发送：archive.zip\n原因：binary"
                }
            ])
        );
        assert!(claude_input_message_has_content(&message));
    }

    #[test]
    fn claude_input_message_accepts_base64_image_without_text_or_path() {
        let blocks = json!([{
            "type": "image",
            "mimeType": "image/png",
            "data": "SGVsbG8="
        }]);

        let message = build_claude_input_message("", Some(&blocks), None);

        assert!(claude_input_message_has_content(&message));
        assert_eq!(
            message.pointer("/message/content").unwrap(),
            &json!([{
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": "SGVsbG8="
                }
            }])
        );
    }

    #[test]
    fn claude_input_message_rejects_blocks_without_sendable_content() {
        let blocks = json!([{
            "type": "attachment_metadata",
            "name": "archive.zip"
        }]);

        let message = build_claude_input_message("", Some(&blocks), None);

        assert!(!claude_input_message_has_content(&message));
    }

    #[test]
    fn claude_input_message_keeps_tool_result_precedence() {
        let blocks = json!([{
            "type": "text",
            "text": "普通文本不应混入工具结果"
        }]);
        let tool_result = json!({
            "requestId": "tool-use-1",
            "content": "approved",
            "isError": false
        });

        let message = build_claude_input_message("普通文本", Some(&blocks), Some(&tool_result));

        assert_eq!(
            message.pointer("/message/content").unwrap(),
            &json!([{
                "type": "tool_result",
                "tool_use_id": "tool-use-1",
                "content": "approved",
                "is_error": false
            }])
        );
    }

    #[test]
    fn request_user_input_option_questions_enable_custom_answers() {
        let request = parse_request_user_input_event(
            "AskUserQuestion",
            &json!({
                "questions": [{
                    "id": "framework",
                    "question": "选择框架",
                    "options": [{ "label": "React" }, { "label": "Vue" }],
                    "multiSelect": false
                }]
            }),
            Some("tool-use-1"),
        )
        .expect("parse request user input");

        assert_eq!(
            request.pointer("/questions/0/isOther"),
            Some(&Value::Bool(true))
        );
    }

    #[test]
    fn request_user_input_single_select_keeps_custom_answer() {
        let question = json!({
            "id": "framework",
            "question": "选择框架",
            "options": [{ "label": "React" }, { "label": "Vue" }],
            "multiSelect": false,
            "isOther": true
        });

        assert_eq!(
            normalize_request_user_input_answer_value(&question, "Svelte"),
            "Svelte"
        );
    }

    #[test]
    fn request_user_input_multi_select_keeps_options_and_custom_answer() {
        let questions = json!([{
            "id": "framework",
            "question": "选择框架",
            "options": [{ "label": "React" }, { "label": "Vue" }],
            "multiSelect": true,
            "isOther": true
        }]);
        let submitted_answers =
            serde_json::Map::from_iter([("framework".to_string(), json!("React\nVue\nSvelte"))]);

        let answers = build_request_user_input_response_answers(&questions, &submitted_answers);

        assert_eq!(answers.get("framework"), Some(&json!("React, Vue, Svelte")));
        assert_eq!(answers.get("选择框架"), Some(&json!("React, Vue, Svelte")));
    }

    #[test]
    fn request_user_input_history_restores_native_custom_answer() {
        let mut turn = json!({
            "pendingUserInputRequests": [{
                "requestId": "tool-use-1",
                "questions": [{
                    "id": "question-0",
                    "question": "收到了 Other 文本「我填写了其他内容」+ 「继续」，下一步做什么？",
                    "options": [{ "label": "A · 回到 m-xterm" }, { "label": "B · 贴进 memory" }],
                    "multiSelect": false
                }]
            }]
        });

        mark_request_user_input_submitted(
            &mut turn,
            "tool-use-1",
            "Your questions have been answered: \"收到了 Other 文本「我填写了其他内容」+ 「继续」，下一步做什么？\"=\"现在只是为了测试 除了选项之外其他 回答\". You can now continue with these answers in mind.",
        );

        assert_eq!(
            turn.pointer("/pendingUserInputRequests/0/submittedAnswers/question-0"),
            Some(&json!("现在只是为了测试 除了选项之外其他 回答"))
        );
    }

    #[test]
    fn request_user_input_history_restores_structured_multi_select_answer() {
        let mut turn = json!({
            "pendingUserInputRequests": [{
                "requestId": "tool-use-1",
                "questions": [{
                    "id": "framework",
                    "question": "选择框架",
                    "options": [{ "label": "React" }, { "label": "Vue" }],
                    "multiSelect": true
                }]
            }]
        });

        mark_request_user_input_submitted(
            &mut turn,
            "tool-use-1",
            r#"{"questions":[],"answers":{"framework":"React, Vue, Svelte","选择框架":"React, Vue, Svelte"}}"#,
        );

        assert_eq!(
            turn.pointer("/pendingUserInputRequests/0/submittedAnswers/framework"),
            Some(&json!("React\nVue\nSvelte"))
        );
    }

    #[test]
    fn summarize_content_blocks_removes_transient_attachment_payloads() {
        let blocks = json!([
            {
                "type": "text",
                "text": "用户可见文本"
            },
            {
                "type": "image",
                "name": "inline.png",
                "mimeType": "image/png",
                "data": "SGVsbG8="
            },
            {
                "type": "image",
                "name": "legacy.png",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": "aGk="
                }
            },
            {
                "type": "file_text",
                "path": "D:\\workspace\\note.md",
                "name": "note.md",
                "text": "中文abc"
            }
        ]);

        let summary = summarize_content_blocks(Some(&blocks)).unwrap();

        assert_eq!(
            summary,
            json!([
                {
                    "type": "text",
                    "text": "用户可见文本"
                },
                {
                    "type": "image",
                    "name": "inline.png",
                    "mimeType": "image/png",
                    "imageBytes": 5
                },
                {
                    "type": "image",
                    "name": "legacy.png",
                    "imageBytes": 2
                },
                {
                    "type": "file_text",
                    "path": "D:\\workspace\\note.md",
                    "name": "note.md",
                    "textBytes": 9
                }
            ])
        );
    }

    #[test]
    fn claude_stream_events_skip_duplicate_raw_payloads() {
        assert!(!should_emit_claude_raw_event(&json!({
            "type": "stream_event",
            "event": { "type": "content_block_delta" }
        })));
        assert!(should_emit_claude_raw_event(&json!({
            "type": "system",
            "subtype": "init"
        })));
    }

    #[test]
    fn repeated_phase_events_are_not_retained_until_phase_changes() {
        let mut last_phase_event = None;
        let thinking = json!({
            "type": "phase",
            "runId": "run-1",
            "phase": "thinking",
            "label": "思考中"
        });

        assert!(should_store_run_event(&mut last_phase_event, &thinking));
        assert!(!should_store_run_event(&mut last_phase_event, &thinking));
        assert!(should_store_run_event(
            &mut last_phase_event,
            &json!({ "type": "thinking-delta", "text": "继续" }),
        ));
        assert!(!should_store_run_event(&mut last_phase_event, &thinking));
        assert!(should_store_run_event(
            &mut last_phase_event,
            &json!({
                "type": "phase",
                "runId": "run-1",
                "phase": "computing",
                "label": "生成回复中"
            }),
        ));
    }

    #[test]
    fn skill_overwrite_switches_staged_directory_without_leaving_backup_files() {
        let root = TestDirectory::new("skill-atomic-overwrite");
        let source = root.0.join("source");
        let target = root.0.join("target");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(source.join("SKILL.md"), "new").unwrap();
        fs::write(target.join("SKILL.md"), "old").unwrap();

        install_skill_directory_safely(&source, &target).unwrap();

        assert_eq!(fs::read_to_string(target.join("SKILL.md")).unwrap(), "new");
        let leftovers = fs::read_dir(&root.0)
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().contains(".target."))
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn plugin_actions_follow_each_native_cli_contract() {
        assert_eq!(
            normalize_agent_plugin_action(OPENAI_CODEX_PROVIDER_ID, "plugin", "install").unwrap(),
            "add"
        );
        assert_eq!(
            normalize_agent_plugin_action(OPENAI_CODEX_PROVIDER_ID, "marketplace", "update")
                .unwrap(),
            "upgrade"
        );
        assert_eq!(
            normalize_agent_plugin_action(GROK_BUILD_PROVIDER_ID, "plugin", "disable").unwrap(),
            "disable"
        );
        assert!(
            normalize_agent_plugin_action(OPENAI_CODEX_PROVIDER_ID, "plugin", "disable").is_err()
        );
        assert!(ensure_agent_plugin_management_supported(OPENCODE_PROVIDER_ID).is_err());
        assert_eq!(
            list_agent_installed_plugins_value(OPENCODE_PROVIDER_ID).unwrap(),
            json!([])
        );
        assert_eq!(
            list_agent_plugin_marketplaces_value(OPENCODE_PROVIDER_ID).unwrap(),
            json!([])
        );
    }

    #[test]
    fn opencode_skills_use_only_managed_project_roots() {
        let root = TestDirectory::new("opencode-skill-roots");
        let plural = root.0.join(".opencode").join("skills").join("plural");
        let singular = root.0.join(".opencode").join("skill").join("singular");
        let outside = root.0.join("external");
        for (path, name) in [
            (&plural, "plural-skill"),
            (&singular, "singular-skill"),
            (&outside, "external-skill"),
        ] {
            fs::create_dir_all(path).unwrap();
            fs::write(
                path.join("SKILL.md"),
                format!("---\nname: {name}\ndescription: test\n---\n"),
            )
            .unwrap();
        }

        let project_path = root.0.to_string_lossy();
        let listed = list_agent_skills_value(OPENCODE_PROVIDER_ID, Some(&project_path));
        let names = listed
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|item| item.get("name").and_then(Value::as_str))
            .collect::<Vec<_>>();
        assert!(names.contains(&"plural-skill"));
        assert!(names.contains(&"singular-skill"));
        assert!(!names.contains(&"external-skill"));
        assert!(validate_managed_agent_skill_path(
            OPENCODE_PROVIDER_ID,
            plural.to_string_lossy().as_ref(),
            Some(&project_path),
        )
        .is_ok());
        assert!(validate_managed_agent_skill_path(
            OPENCODE_PROVIDER_ID,
            singular.to_string_lossy().as_ref(),
            Some(&project_path),
        )
        .is_ok());
        assert!(validate_managed_agent_skill_path(
            OPENCODE_PROVIDER_ID,
            outside.to_string_lossy().as_ref(),
            Some(&project_path),
        )
        .is_err());
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn desktop_cors_covers_agent_and_ordinary_chat_routes() {
        let test_directory = TestDirectory::new("agent-run-cors");
        let secrets = crate::ordinary_chat::secrets::SecretStore::new(test_directory.0.clone());
        let agent_channels =
            crate::agent_channels::AgentChannelService::new(test_directory.0.clone(), secrets);
        let ordinary_chat =
            crate::ordinary_chat::OrdinaryChatService::new(test_directory.0.clone());
        let app = create_router(AppState {
            app_data_dir: Arc::new(test_directory.0.clone()),
            settings_write_lock: Arc::new(Mutex::new(())),
            agent_channels: agent_channels.clone(),
            agent_lifecycle_running: Arc::new(tokio::sync::Mutex::new(
                std::collections::HashSet::new(),
            )),
            agent_runs: crate::agent_run::AgentRunService::new(
                resolve_grok_command,
                resolve_codex_command,
                resolve_opencode_command,
                agent_channels,
            ),
            workspace_write_lock: Arc::new(Mutex::new(())),
            workspace_database_init_lock: Arc::new(Mutex::new(())),
            runs: Arc::new(Mutex::new(HashMap::new())),
            runtimes: Arc::new(Mutex::new(HashMap::new())),
            context_requests: Arc::new(Mutex::new(HashMap::new())),
        })
        .merge(crate::ordinary_chat::router(ordinary_chat))
        .layer(desktop_cors_layer());
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/api/agents/run")
                    .header(header::ORIGIN, "http://127.0.0.1:5173")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                    .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "content-type")
                    .body(Body::empty())
                    .expect("build preflight request"),
            )
            .await
            .expect("run preflight request");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .and_then(|value| value.to_str().ok()),
            Some("http://127.0.0.1:5173")
        );
        assert!(response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_METHODS)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.split(',').any(|method| method.trim() == "POST")));

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/ai/providers/templates")
                    .header(header::ORIGIN, "http://127.0.0.1:5173")
                    .body(Body::empty())
                    .expect("build ordinary chat template request"),
            )
            .await
            .expect("run ordinary chat template request");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .and_then(|value| value.to_str().ok()),
            Some("http://127.0.0.1:5173")
        );
    }

    #[test]
    fn opencode_mcp_round_trip_preserves_unrelated_config_fields() {
        let root = TestDirectory::new("opencode-mcp-round-trip");
        let path = root.0.join("opencode.json");
        fs::write(
            &path,
            serde_json::to_vec_pretty(&json!({
                "$schema": "https://opencode.ai/config.json",
                "model": "minimax-cn-coding-plan/MiniMax-M2.7",
                "plugin": ["oh-my-openagent"],
                "mcp": {
                    "local": {
                        "type": "local",
                        "command": ["npx", "-y", "@playwright/mcp"],
                        "enabled": true,
                        "timeout": 120000
                    },
                    "remote": {
                        "type": "remote",
                        "url": "https://example.com/mcp",
                        "enabled": false,
                        "headers": { "Authorization": "Bearer {env:MCP_TOKEN}" }
                    }
                }
            }))
            .unwrap(),
        )
        .unwrap();

        let normalized = read_opencode_mcp_config(&path).unwrap();
        assert_eq!(normalized["mcpServers"]["local"]["command"], "npx");
        assert_eq!(
            normalized["mcpServers"]["local"]["args"],
            json!(["-y", "@playwright/mcp"])
        );
        assert_eq!(normalized["mcpServers"]["local"]["timeout"], 120000);
        assert_eq!(normalized["mcpServers"]["remote"]["disabled"], true);

        write_opencode_mcp_config(&path, &normalized).unwrap();
        let persisted: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(persisted["model"], "minimax-cn-coding-plan/MiniMax-M2.7");
        assert_eq!(persisted["plugin"], json!(["oh-my-openagent"]));
        assert_eq!(
            persisted["mcp"]["local"]["command"],
            json!(["npx", "-y", "@playwright/mcp"])
        );
        assert_eq!(persisted["mcp"]["local"]["timeout"], 120000);
        assert_eq!(persisted["mcp"]["remote"]["enabled"], false);
    }

    #[test]
    fn thread_provider_defaults_to_claude_and_requires_installed_agents() {
        assert_eq!(
            resolve_requested_thread_provider(None, |_| {
                panic!("Claude Code 不应触发通用 Agent 命令探测")
            })
            .expect("default provider"),
            CLAUDE_CODE_PROVIDER_ID
        );
        assert!(
            resolve_requested_thread_provider(Some(GROK_BUILD_PROVIDER_ID), |_| false,).is_err()
        );
        assert_eq!(
            resolve_requested_thread_provider(Some(GROK_BUILD_PROVIDER_ID), |provider_id| {
                provider_id == GROK_BUILD_PROVIDER_ID
            },)
            .expect("enabled Grok provider"),
            GROK_BUILD_PROVIDER_ID
        );
        assert!(
            resolve_requested_thread_provider(Some(OPENAI_CODEX_PROVIDER_ID), |_| false,).is_err()
        );
        assert_eq!(
            resolve_requested_thread_provider(Some(OPENAI_CODEX_PROVIDER_ID), |provider_id| {
                provider_id == OPENAI_CODEX_PROVIDER_ID
            },)
            .expect("enabled Codex provider"),
            OPENAI_CODEX_PROVIDER_ID
        );
        assert!(resolve_requested_thread_provider(Some(OPENCODE_PROVIDER_ID), |_| false,).is_err());
        assert_eq!(
            resolve_requested_thread_provider(Some(OPENCODE_PROVIDER_ID), |provider_id| {
                provider_id == OPENCODE_PROVIDER_ID
            },)
            .expect("enabled OpenCode provider"),
            OPENCODE_PROVIDER_ID
        );
        assert_eq!(
            resolve_thread_create_permission_mode(GROK_BUILD_PROVIDER_ID, None)
                .expect("default Grok permission")
                .as_deref(),
            Some("default")
        );
        assert!(
            resolve_thread_create_permission_mode(GROK_BUILD_PROVIDER_ID, Some("dontAsk")).is_err()
        );
        assert_eq!(
            resolve_thread_create_permission_mode(OPENAI_CODEX_PROVIDER_ID, Some("auto"))
                .expect("Codex permission")
                .as_deref(),
            Some("auto")
        );
        assert_eq!(
            resolve_thread_create_permission_mode(OPENCODE_PROVIDER_ID, Some("auto"))
                .expect("OpenCode permission")
                .as_deref(),
            Some("auto")
        );
    }

    #[test]
    fn agent_runtime_settings_default_to_claude_and_preserve_supported_values() {
        assert_eq!(
            normalize_agent_runtime_settings(None),
            json!({
                "defaultProviderId": CLAUDE_CODE_PROVIDER_ID,
            })
        );
        assert_eq!(
            normalize_agent_runtime_settings(Some(&json!({
                "experimentalAgentRunEnabled": true,
                "defaultProviderId": OPENAI_CODEX_PROVIDER_ID,
            }))),
            json!({
                "defaultProviderId": OPENAI_CODEX_PROVIDER_ID,
            })
        );
        assert_eq!(
            normalize_agent_runtime_settings(Some(&json!({
                "defaultProviderId": "unknown-provider",
            }))),
            json!({
                "defaultProviderId": CLAUDE_CODE_PROVIDER_ID,
            })
        );
    }

    #[test]
    fn workspace_database_adds_reasoning_effort_to_existing_threads_table() {
        let connection = Connection::open_in_memory().expect("open database");
        connection
            .execute("CREATE TABLE threads (id TEXT PRIMARY KEY, model TEXT)", [])
            .expect("create legacy threads table");

        initialize_workspace_database(&connection).expect("upgrade database");

        let mut statement = connection
            .prepare("PRAGMA table_info(threads)")
            .expect("read thread columns");
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .expect("query thread columns")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect thread columns");
        assert!(columns.iter().any(|column| column == "reasoning_effort"));
    }

    #[test]
    fn workspace_database_adds_item_type_to_existing_messages_table() {
        let connection = Connection::open_in_memory().expect("open database");
        connection
            .execute(
                "CREATE TABLE messages (id TEXT PRIMARY KEY, thread_id TEXT, turn_sort INTEGER, item_sort INTEGER, role TEXT)",
                [],
            )
            .expect("create legacy messages table");

        initialize_workspace_database(&connection).expect("upgrade database");

        let mut statement = connection
            .prepare("PRAGMA table_info(messages)")
            .expect("read message columns");
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .expect("query message columns")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect message columns");
        assert!(columns.iter().any(|column| column == "item_type"));
    }

    #[test]
    fn thread_history_round_trip_preserves_thinking_items() {
        let mut connection = Connection::open_in_memory().expect("open database");
        initialize_workspace_database(&connection).expect("initialize database");
        connection
            .execute(
                "INSERT INTO projects (id, path, name, custom_name, created_at, updated_at) VALUES ('project', 'D:/workspace', 'workspace', 0, '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z')",
                [],
            )
            .expect("insert project");
        let thread_id = create_thread_row(
            &mut connection,
            "project",
            Some("OpenCode thinking"),
            OPENCODE_PROVIDER_ID,
            Some("bypassPermissions"),
            Some("MiniMax-M3"),
            None,
            None,
        )
        .expect("create thread");
        let turns = vec![json!({
            "id": "turn-1",
            "userText": "你是哪个模型",
            "assistantText": "我是 MiniMax-M3。",
            "status": "done",
            "tools": [],
            "items": [
                {
                    "id": "thinking-1",
                    "type": "thinking",
                    "text": "先确认当前模型。"
                },
                {
                    "id": "text-1",
                    "type": "text",
                    "text": "我是 MiniMax-M3。"
                }
            ]
        })];

        write_thread_history(&mut connection, &thread_id, &turns).expect("write history");

        let stored_types = connection
            .prepare(
                "SELECT role, item_type FROM messages WHERE thread_id = ? ORDER BY item_sort, CASE role WHEN 'user' THEN 0 ELSE 1 END",
            )
            .expect("read stored item types")
            .query_map(params![thread_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .expect("query stored item types")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect stored item types");
        assert_eq!(
            stored_types,
            vec![
                ("user".to_string(), Some("user".to_string())),
                ("assistant".to_string(), Some("thinking".to_string())),
                ("assistant".to_string(), Some("text".to_string())),
            ]
        );

        let restored = read_stored_thread_history(&connection, &thread_id).expect("read history");
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0]["assistantText"], "我是 MiniMax-M3。");
        assert_eq!(restored[0]["items"][0]["type"], "thinking");
        assert_eq!(restored[0]["items"][0]["text"], "先确认当前模型。");
        assert_eq!(restored[0]["items"][1]["type"], "text");
        assert_eq!(restored[0]["items"][1]["text"], "我是 MiniMax-M3。");
    }

    #[test]
    fn workspace_database_adds_thread_model_preferences_and_migrates_current_effort() {
        let connection = Connection::open_in_memory().expect("open database");
        connection
            .execute(
                "CREATE TABLE threads (id TEXT PRIMARY KEY, model TEXT, reasoning_effort TEXT)",
                [],
            )
            .expect("create legacy threads table");
        connection
            .execute(
                "INSERT INTO threads (id, model, reasoning_effort) VALUES ('thread-a', 'model-a', 'high'), ('thread-default', NULL, 'medium')",
                [],
            )
            .expect("insert legacy thread preferences");

        initialize_workspace_database(&connection).expect("upgrade database");

        let migrated = connection
            .prepare(
                "SELECT thread_id, model_id, reasoning_effort FROM thread_model_preferences ORDER BY thread_id",
            )
            .expect("read preference table")
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .expect("query preferences")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect preferences");
        assert_eq!(
            migrated,
            vec![
                (
                    "thread-a".to_string(),
                    "model-a".to_string(),
                    "high".to_string(),
                ),
                (
                    "thread-default".to_string(),
                    "__default".to_string(),
                    "medium".to_string(),
                ),
            ]
        );
    }

    #[test]
    fn thread_model_preferences_follow_model_switches() {
        let mut connection = Connection::open_in_memory().expect("open database");
        initialize_workspace_database(&connection).expect("initialize database");
        let channel_root = TestDirectory::new("thread-model-channel-service");
        let channel_service = crate::agent_channels::AgentChannelService::new(
            channel_root.0.clone(),
            crate::ordinary_chat::secrets::SecretStore::new(channel_root.0.clone()),
        );
        connection
            .execute(
                "INSERT INTO projects (id, path, name, custom_name, created_at, updated_at) VALUES ('project', 'D:/workspace', 'workspace', 0, '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z')",
                [],
            )
            .expect("insert project");

        let thread_id = create_thread_row(
            &mut connection,
            "project",
            Some("Codex preferences"),
            OPENAI_CODEX_PROVIDER_ID,
            Some("bypassPermissions"),
            Some("model-a"),
            Some("high"),
            None,
        )
        .expect("create thread");
        update_thread_metadata_from_payload(
            &mut connection,
            &thread_id,
            &json!({ "model": "model-b", "reasoningEffort": "low" }),
            &channel_service,
        )
        .expect("select model b");
        update_thread_metadata_from_payload(
            &mut connection,
            &thread_id,
            &json!({ "model": "model-a" }),
            &channel_service,
        )
        .expect("restore model a");

        let detail = read_thread_detail(&connection, &thread_id).expect("read thread detail");
        assert_eq!(detail.model.as_deref(), Some("model-a"));
        assert_eq!(detail.reasoning_effort.as_deref(), Some("high"));
        let summary = read_thread_summary(&connection, &thread_id).expect("read summary");
        assert_eq!(summary["modelPreferences"]["model-a"], "high");
        assert_eq!(summary["modelPreferences"]["model-b"], "low");
    }

    #[test]
    fn grok_thread_persists_provider_without_creating_claude_transcript_path() {
        let mut connection = Connection::open_in_memory().expect("open database");
        initialize_workspace_database(&connection).expect("initialize database");
        let channel_root = TestDirectory::new("grok-thread-channel-service");
        let channel_service = crate::agent_channels::AgentChannelService::new(
            channel_root.0.clone(),
            crate::ordinary_chat::secrets::SecretStore::new(channel_root.0.clone()),
        );
        connection
            .execute(
                "INSERT INTO projects (id, path, name, custom_name, created_at, updated_at) VALUES ('project', 'D:/workspace', 'workspace', 0, '2026-07-12T00:00:00.000Z', '2026-07-12T00:00:00.000Z')",
                [],
            )
            .expect("insert project");

        let thread_id = create_thread_row(
            &mut connection,
            "project",
            Some("Grok chat"),
            GROK_BUILD_PROVIDER_ID,
            Some("bypassPermissions"),
            Some("grok-model-test"),
            None,
            None,
        )
        .expect("create Grok thread");
        update_thread_metadata_from_payload(
            &mut connection,
            &thread_id,
            &json!({ "sessionId": "grok-session-1", "permissionMode": "auto" }),
            &channel_service,
        )
        .expect("store Grok session");

        let (provider, session_id, transcript_path, permission_mode): (
            String,
            Option<String>,
            Option<String>,
            Option<String>,
        ) = connection
            .query_row(
                "SELECT provider, session_id, transcript_path, permission_mode FROM threads WHERE id = ?",
                params![thread_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("read Grok thread");
        assert_eq!(provider, GROK_BUILD_PROVIDER_ID);
        assert_eq!(session_id.as_deref(), Some("grok-session-1"));
        assert_eq!(transcript_path, None);
        assert_eq!(permission_mode.as_deref(), Some("auto"));
        assert!(update_thread_metadata_from_payload(
            &mut connection,
            &thread_id,
            &json!({ "permissionMode": "dontAsk" }),
            &channel_service,
        )
        .is_err());
    }

    #[test]
    fn codex_thread_persists_official_thread_id_without_claude_transcript_path() {
        let mut connection = Connection::open_in_memory().expect("open database");
        initialize_workspace_database(&connection).expect("initialize database");
        let channel_root = TestDirectory::new("codex-thread-channel-service");
        let channel_service = crate::agent_channels::AgentChannelService::new(
            channel_root.0.clone(),
            crate::ordinary_chat::secrets::SecretStore::new(channel_root.0.clone()),
        );
        connection
            .execute(
                "INSERT INTO projects (id, path, name, custom_name, created_at, updated_at) VALUES ('project', 'D:/workspace', 'workspace', 0, '2026-07-12T00:00:00.000Z', '2026-07-12T00:00:00.000Z')",
                [],
            )
            .expect("insert project");

        let thread_id = create_thread_row(
            &mut connection,
            "project",
            Some("Codex chat"),
            OPENAI_CODEX_PROVIDER_ID,
            Some("default"),
            Some("gpt-codex-test"),
            Some("medium"),
            None,
        )
        .expect("create Codex thread");
        update_thread_metadata_from_payload(
            &mut connection,
            &thread_id,
            &json!({
                "sessionId": "codex-thread-1",
                "permissionMode": "auto",
                "model": "gpt-codex-fast",
                "reasoningEffort": "high"
            }),
            &channel_service,
        )
        .expect("store Codex thread");

        let (provider, session_id, transcript_path, model, reasoning_effort, permission_mode): (
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        ) = connection
            .query_row(
                "SELECT provider, session_id, transcript_path, model, reasoning_effort, permission_mode FROM threads WHERE id = ?",
                params![thread_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .expect("read Codex thread");
        assert_eq!(provider, OPENAI_CODEX_PROVIDER_ID);
        assert_eq!(session_id.as_deref(), Some("codex-thread-1"));
        assert_eq!(transcript_path, None);
        assert_eq!(model.as_deref(), Some("gpt-codex-fast"));
        assert_eq!(reasoning_effort.as_deref(), Some("high"));
        assert_eq!(permission_mode.as_deref(), Some("auto"));
        assert!(update_thread_metadata_from_payload(
            &mut connection,
            &thread_id,
            &json!({ "permissionMode": "dontAsk" }),
            &channel_service,
        )
        .is_err());
    }

    #[test]
    fn project_file_entries_sort_directories_before_files() {
        let mut entries = vec![
            json!({ "name": "README.md", "type": "file" }),
            json!({ "name": "src", "type": "directory" }),
            json!({ "name": "Cargo.toml", "type": "file" }),
            json!({ "name": "Assets", "type": "directory" }),
            json!({ "name": "build.rs", "type": "file" }),
        ];

        entries.sort_by(compare_project_file_entries);

        assert_eq!(
            entries
                .iter()
                .filter_map(|entry| entry.get("name").and_then(Value::as_str))
                .collect::<Vec<_>>(),
            vec!["Assets", "src", "build.rs", "Cargo.toml", "README.md"]
        );
    }

    #[test]
    fn workspace_file_search_normalizes_windows_separators_and_ranks_directories_first() {
        let root = TestDirectory::new("workspace-file-search");
        let source = root.0.join("src");
        fs::create_dir_all(source.join("spec")).unwrap();
        fs::write(source.join("spec.ts"), "export const spec = true;\n").unwrap();

        let root_path = root.0.to_string_lossy();
        let results = search_workspace_files(&root_path, "src\\spec").unwrap();
        let relative_paths = results
            .iter()
            .filter_map(|item| item.get("rel").and_then(Value::as_str))
            .collect::<Vec<_>>();

        assert_eq!(relative_paths, vec!["src/spec", "src/spec.ts"]);
        assert_eq!(results[0].get("isDirectory"), Some(&Value::Bool(true)));
    }

    #[test]
    fn workspace_relative_path_resolution_rejects_escape_paths() {
        let root = TestDirectory::new("workspace-relative-path");
        let source = root.0.join("src");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("App.tsx"), "export default function App() {}\n").unwrap();

        let root_path = root.0.to_string_lossy();
        let resolved = resolve_workspace_relative_path(&root_path, "src\\App.tsx").unwrap();
        assert_eq!(resolved.1, "src/App.tsx");
        assert!(resolve_workspace_relative_path(&root_path, "../secret.txt").is_none());
        assert!(resolve_workspace_relative_path(&root_path, "src/../secret.txt").is_none());
        assert!(resolve_workspace_relative_path(&root_path, &resolved.0).is_none());
    }

    #[test]
    fn slash_command_catalog_keeps_required_local_commands_unique() {
        let commands = list_slash_commands_value(None);
        let slash_values = commands
            .iter()
            .filter_map(|command| command.get("slash").and_then(Value::as_str))
            .collect::<Vec<_>>();
        let unique_values = slash_values
            .iter()
            .copied()
            .collect::<std::collections::HashSet<_>>();

        for required in ["/clear", "/status", "/compact", "/context", "/cost"] {
            assert!(slash_values.contains(&required), "missing {required}");
        }
        assert_eq!(slash_values.len(), unique_values.len());
    }

    fn write_claude_transcript(
        projects_root: &std::path::Path,
        workspace: &std::path::Path,
        session_id: &str,
    ) -> PathBuf {
        let project_directory = projects_root.join("project-fixture");
        fs::create_dir_all(&project_directory).expect("create transcript project directory");
        let transcript_path = project_directory.join(format!("{session_id}.jsonl"));
        let cwd = workspace.display().to_string();
        let payloads = [
            json!({
                "type": "user",
                "sessionId": session_id,
                "cwd": cwd,
                "timestamp": "2026-07-01T01:00:00.000Z",
                "permissionMode": "bypassPermissions",
                "message": { "role": "user", "content": "inspect the current project" }
            }),
            json!({
                "type": "assistant",
                "sessionId": session_id,
                "cwd": cwd,
                "timestamp": "2026-07-01T01:00:01.000Z",
                "message": { "role": "assistant", "model": "claude-test", "content": [] }
            }),
        ];
        let content = payloads
            .iter()
            .map(serde_json::Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&transcript_path, content).expect("write transcript");
        transcript_path
    }

    #[test]
    fn claude_history_import_is_idempotent_and_respects_ignored_sessions() {
        let fixture = TestDirectory::new("history-import");
        let projects_root = fixture.0.join("claude-projects");
        let workspace = fixture.0.join("workspace");
        fs::create_dir_all(&projects_root).expect("create projects root");
        fs::create_dir_all(&workspace).expect("create workspace");
        let transcript_path =
            write_claude_transcript(&projects_root, &workspace, "session-imported");
        fs::write(
            projects_root
                .join("project-fixture")
                .join("agent-ignored.jsonl"),
            fs::read_to_string(&transcript_path).expect("read transcript fixture"),
        )
        .expect("write ignored agent transcript");
        fs::write(
            projects_root
                .join("project-fixture")
                .join("malformed.jsonl"),
            "{not-json}\n",
        )
        .expect("write malformed transcript");

        let mut connection = Connection::open_in_memory().expect("open database");
        initialize_workspace_database(&connection).expect("initialize database");
        import_claude_sessions_from_root(&connection, &projects_root).expect("import history");
        import_claude_sessions_from_root(&connection, &projects_root)
            .expect("repeat history import");

        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM projects", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM threads", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        let (thread_id, title, model, imported): (String, String, String, i64) = connection
            .query_row(
                "SELECT id, title, model, imported FROM threads WHERE session_id = ?",
                params!["session-imported"],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(title, "inspect the current project");
        assert_eq!(model, "claude-test");
        assert_eq!(imported, 1);

        connection
            .execute(
                "UPDATE projects SET name = 'Custom project', custom_name = 1",
                [],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE threads SET title = 'Custom thread', custom_title = 1 WHERE id = ?",
                params![thread_id],
            )
            .unwrap();
        import_claude_sessions_from_root(&connection, &projects_root)
            .expect("import with custom titles");
        assert_eq!(
            connection
                .query_row("SELECT name FROM projects", [], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            "Custom project"
        );
        assert_eq!(
            connection
                .query_row("SELECT title FROM threads", [], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            "Custom thread"
        );

        remove_thread_row(&mut connection, &thread_id).expect("remove imported thread");
        assert!(transcript_path.exists());
        import_claude_sessions_from_root(&connection, &projects_root)
            .expect("import after deletion");
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM threads", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM ignored_imported_sessions",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
    }

    #[test]
    fn claude_history_import_updates_existing_codem_thread_without_duplication() {
        let fixture = TestDirectory::new("history-existing-thread");
        let projects_root = fixture.0.join("claude-projects");
        let workspace = fixture.0.join("workspace");
        fs::create_dir_all(&projects_root).expect("create projects root");
        fs::create_dir_all(&workspace).expect("create workspace");
        let transcript_path =
            write_claude_transcript(&projects_root, &workspace, "session-existing");
        let cwd = workspace.display().to_string();

        let connection = Connection::open_in_memory().expect("open database");
        initialize_workspace_database(&connection).expect("initialize database");
        connection
            .execute(
                "INSERT INTO projects (id, path, name, custom_name, created_at, updated_at) VALUES ('project', ?, 'workspace', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
                params![cwd],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO threads (id, project_id, provider, title, custom_title, session_id, transcript_path, working_directory, model, permission_mode, imported, created_at, updated_at) VALUES ('thread', 'project', 'claude-code', 'Existing', 0, 'session-existing', NULL, ?, NULL, NULL, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
                params![cwd],
            )
            .unwrap();

        import_claude_sessions_from_root(&connection, &projects_root).expect("import history");
        let (count, imported, stored_path): (i64, i64, String) = connection
            .query_row(
                "SELECT (SELECT COUNT(*) FROM threads), imported, transcript_path FROM threads WHERE id = 'thread'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(imported, 0);
        assert_eq!(stored_path, transcript_path.display().to_string());
    }

    #[test]
    fn windows_command_candidates_prefer_spawnable_npm_shim() {
        let lookup = concat!(
            "C:\\Users\\dev\\AppData\\Roaming\\npm\\claude\r\n",
            "C:\\Users\\dev\\AppData\\Roaming\\npm\\claude.cmd\r\n",
            "C:\\Users\\dev\\AppData\\Roaming\\npm\\claude.ps1\r\n",
        );

        assert_eq!(
            select_runnable_command_candidate(lookup, true, |_| true).as_deref(),
            Some("C:\\Users\\dev\\AppData\\Roaming\\npm\\claude.cmd")
        );
    }

    #[test]
    fn windows_command_candidates_accept_native_extensions_case_insensitively() {
        let lookup = "C:\\Tools\\claude\nC:\\Tools\\claude.EXE\n";

        assert_eq!(
            select_runnable_command_candidate(lookup, true, |_| true).as_deref(),
            Some("C:\\Tools\\claude.EXE")
        );
    }

    #[test]
    fn non_windows_command_candidates_keep_first_runnable_candidate() {
        let lookup = "/usr/local/bin/claude\n/opt/homebrew/bin/claude\n";

        assert_eq!(
            select_runnable_command_candidate(lookup, false, |_| true).as_deref(),
            Some("/usr/local/bin/claude")
        );
    }

    #[test]
    fn grok_path_command_candidates_require_version_check() {
        let lookup = "C:\\Tools\\broken-grok.exe\nC:\\Tools\\grok.exe\n";

        assert_eq!(
            select_runnable_command_candidate(lookup, true, |candidate| {
                candidate.ends_with("\\grok.exe")
            })
            .as_deref(),
            Some("C:\\Tools\\grok.exe")
        );
        assert_eq!(
            select_runnable_command_candidate(lookup, true, |_| false),
            None
        );
    }

    #[test]
    fn default_claude_command_paths_cover_native_and_windows_npm_installers() {
        let home = PathBuf::from("C:\\Users\\dev");
        let app_data = home.join("AppData").join("Roaming");

        assert_eq!(
            default_claude_command_paths(&home, Some(&app_data), true),
            vec![
                home.join(".local").join("bin").join("claude.exe"),
                app_data.join("npm").join("claude.cmd"),
            ]
        );
        assert_eq!(
            default_claude_command_paths(&home, None, false),
            vec![home.join(".local").join("bin").join("claude")]
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn native_claude_command_is_runnable_without_being_on_path() {
        use std::os::unix::fs::PermissionsExt;

        let test_directory = TestDirectory::new("claude-native-fallback");
        let native_command = test_directory.0.join(".local").join("bin").join("claude");
        fs::create_dir_all(native_command.parent().unwrap()).expect("create native directory");
        fs::write(&native_command, "#!/bin/sh\necho '9.9.9 (Claude Code)'\n")
            .expect("write native command");
        fs::set_permissions(&native_command, fs::Permissions::from_mode(0o755))
            .expect("make native command executable");

        assert_eq!(
            resolve_first_runnable_command(default_claude_command_paths(
                &test_directory.0,
                None,
                false,
            )),
            Some(native_command.to_string_lossy().to_string())
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_npm_claude_command_is_runnable_without_being_on_path() {
        let test_directory = TestDirectory::new("claude-npm-fallback");
        let home = test_directory.0.join("home");
        let app_data = test_directory.0.join("app-data");
        let invalid_native = home.join(".local").join("bin").join("claude.exe");
        let npm_command = app_data.join("npm").join("claude.cmd");
        fs::create_dir_all(invalid_native.parent().unwrap()).expect("create native directory");
        fs::create_dir_all(npm_command.parent().unwrap()).expect("create npm directory");
        fs::write(&invalid_native, "not an executable").expect("write invalid native candidate");
        fs::write(&npm_command, "@echo off\r\necho 9.9.9 (Claude Code)\r\n")
            .expect("write npm command");

        assert_eq!(
            resolve_first_runnable_command(default_claude_command_paths(
                &home,
                Some(&app_data),
                true,
            )),
            Some(npm_command.to_string_lossy().to_string())
        );
    }

    #[test]
    fn grok_version_parser_extracts_semantic_version_without_build_hash() {
        assert_eq!(
            parse_grok_cli_version("grok 0.2.93 (f00f96316d)\n").as_deref(),
            Some("0.2.93")
        );
        assert_eq!(parse_grok_cli_version("unexpected output"), None);
    }

    #[test]
    fn default_grok_command_path_matches_official_installer_layout() {
        let home = PathBuf::from("C:\\Users\\dev");
        assert_eq!(
            default_grok_command_path(&home, true),
            home.join(".grok").join("bin").join("grok.exe")
        );
        assert_eq!(
            default_grok_command_path(&home, false),
            home.join(".grok").join("bin").join("grok")
        );
    }

    #[test]
    fn validate_desktop_file_path_rejects_sensitive_dotenv_at_start() {
        assert!(validate_desktop_file_path(".env").is_err());
        assert!(validate_desktop_file_path(".env.local").is_err());
    }

    #[test]
    fn validate_desktop_file_path_keeps_normal_environment_names() {
        assert!(validate_desktop_file_path("C:\\work\\environment.ts").is_ok());
    }
}
