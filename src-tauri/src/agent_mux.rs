use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch, put},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Path as FsPath, PathBuf},
    sync::Arc,
};

const AGENT_MUX_SKILL_NAME: &str = "codem-agent-mux";
const MAX_AGENT_MUX_SKILL_BYTES: usize = 256 * 1024;
const MAX_AGENT_MUX_NICKNAME_CHARS: usize = 32;
const AGENT_MUX_CAPABILITY_LEVELS: [&str; 5] = ["基础", "轻量", "标准", "高级", "顶级"];
const AGENT_MUX_CAPABILITY_TENDENCIES: [&str; 5] =
    ["通用", "代码", "前端 / UI", "写作", "数学推理"];
const AGENT_MUX_PURPOSES: [&str; 9] = [
    "通用任务",
    "代码生成",
    "代码审查",
    "Bug 排查",
    "前端实现",
    "测试验证",
    "文档写作",
    "信息分析",
    "数学推理",
];
const AGENT_MUX_AVATARS: [&str; 36] = [
    "rabbit",
    "fox",
    "penguin",
    "turtle",
    "cat",
    "owl",
    "shiba",
    "koala",
    "panda",
    "otter",
    "frog",
    "lion",
    "hedgehog",
    "bird",
    "raccoon",
    "chick",
    "pig",
    "whale",
    "crocodile",
    "chipmunk",
    "polar-bear",
    "deer",
    "dolphin",
    "hamster",
    "alpaca",
    "crow",
    "duck",
    "red-panda",
    "elephant",
    "bat",
    "sheep",
    "unicorn",
    "leopard",
    "snowy-owl",
    "bee",
    "husky",
];

#[derive(Clone)]
pub struct AgentMuxService {
    app_data_dir: Arc<PathBuf>,
    database_path: Arc<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeProfile {
    pub id: String,
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub nickname: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(rename = "reasoningEffort", default)]
    pub reasoning_effort: Option<String>,
    pub level: String,
    pub tags: Vec<String>,
    pub role: String,
    pub status: String,
    #[serde(rename = "channelId", default)]
    pub channel_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub profiles: Vec<RuntimeProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunRecord {
    pub id: String,
    pub caller: String,
    pub target: String,
    pub profile: String,
    pub nickname: Option<String>,
    pub avatar: Option<String>,
    pub skill: String,
    pub status: String,
    pub duration: String,
    pub started: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub prompt: String,
    pub summary: String,
    #[serde(rename = "profileId")]
    pub profile_id: Option<String>,
    #[serde(rename = "providerRunId")]
    pub provider_run_id: Option<String>,
    #[serde(rename = "workingDirectory")]
    pub working_directory: Option<String>,
    #[serde(rename = "threadId")]
    pub thread_id: Option<String>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunEventRecord {
    pub id: i64,
    #[serde(rename = "runId")]
    pub run_id: String,
    #[serde(rename = "eventType")]
    pub event_type: String,
    pub message: String,
    pub payload: Option<Value>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentMuxMetrics {
    pub running: i64,
    #[serde(rename = "availableAgents")]
    pub available_agents: i64,
    #[serde(rename = "todayCalls")]
    pub today_calls: i64,
    #[serde(rename = "successRate")]
    pub success_rate: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentMuxOverview {
    pub agents: Vec<AgentRecord>,
    pub runs: Vec<RunRecord>,
    pub metrics: AgentMuxMetrics,
}

#[derive(Debug, Deserialize)]
pub struct CreateProfileRequest {
    #[serde(rename = "agentId")]
    pub agent_id: String,
    pub profile: RuntimeProfile,
}

#[derive(Debug, Deserialize)]
pub struct ProfileStatusRequest {
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateRunRequest {
    pub caller: String,
    pub target: String,
    pub profile: String,
    #[serde(default)]
    pub nickname: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(default = "default_skill")]
    pub skill: String,
    pub status: String,
    #[serde(default = "default_duration")]
    pub duration: String,
    #[serde(default = "default_started")]
    pub started: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub summary: String,
    #[serde(rename = "profileId", default)]
    pub profile_id: Option<String>,
    #[serde(rename = "workingDirectory", default)]
    pub working_directory: Option<String>,
    #[serde(rename = "threadId", default)]
    pub thread_id: Option<String>,
    #[serde(rename = "sessionId", default)]
    pub session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRunRequest {
    pub status: Option<String>,
    pub duration: Option<String>,
    pub summary: Option<String>,
    #[serde(rename = "providerRunId")]
    pub provider_run_id: Option<String>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateRunEventRequest {
    #[serde(rename = "eventType")]
    pub event_type: String,
    pub message: String,
    #[serde(default)]
    pub payload: Option<Value>,
}

type ApiResult<T> = Result<Json<T>, (StatusCode, Json<Value>)>;

impl AgentMuxService {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            app_data_dir: Arc::new(app_data_dir.clone()),
            database_path: Arc::new(app_data_dir.join("codem.sqlite")),
        }
    }

    fn connection(&self) -> Result<Connection, (StatusCode, Json<Value>)> {
        Connection::open(&*self.database_path).map_err(internal_error)
    }
}

pub fn reconcile_interrupted_runs(app_data_dir: &FsPath) -> Result<usize, String> {
    fs::create_dir_all(app_data_dir).map_err(|error| error.to_string())?;
    let connection =
        Connection::open(app_data_dir.join("codem.sqlite")).map_err(|error| error.to_string())?;
    ensure_schema(&connection).map_err(|(_, Json(payload))| {
        payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Agent Mux schema initialization failed")
            .to_string()
    })?;
    reconcile_interrupted_runs_in_connection(&connection).map_err(|error| error.to_string())
}

fn reconcile_interrupted_runs_in_connection(connection: &Connection) -> rusqlite::Result<usize> {
    connection.execute(
        "UPDATE agent_mux_runs SET status = 'failed', summary = CASE WHEN trim(summary) = '' THEN 'Agent Mux Runtime 重启，运行已中断' ELSE summary END, updated_at = datetime('now') WHERE status IN ('running', 'queued')",
        [],
    )
}

pub fn router(service: AgentMuxService) -> Router {
    Router::new()
        .route("/api/agent-mux/overview", get(get_overview))
        .route("/api/agent-mux/runtime-info", get(runtime_info))
        .route(
            "/api/agent-mux/skill-source",
            get(get_skill_source).put(sync_skill_source),
        )
        .route(
            "/api/agent-mux/profiles",
            get(list_profiles).post(create_profile),
        )
        .route(
            "/api/agent-mux/profiles/{profile_id}",
            put(update_profile).delete(delete_profile),
        )
        .route(
            "/api/agent-mux/profiles/{profile_id}/status",
            patch(update_profile_status),
        )
        .route("/api/agent-mux/runs", get(list_runs).post(create_run))
        .route("/api/agent-mux/runs/{run_id}", patch(update_run))
        .route(
            "/api/agent-mux/workflows",
            get(list_workflows).post(create_workflow),
        )
        .route(
            "/api/agent-mux/workflows/{workflow_id}",
            put(update_workflow).delete(delete_workflow),
        )
        .route(
            "/api/agent-mux/workflow-runs",
            get(list_workflow_runs).post(create_workflow_run),
        )
        .route(
            "/api/agent-mux/workflow-runs/{run_id}",
            put(update_workflow_run),
        )
        .route(
            "/api/agent-mux/runs/{run_id}/events",
            get(list_run_events).post(create_run_event),
        )
        .with_state(service)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentMuxRuntimeInfo {
    cli_path: String,
    app_data_dir: String,
    runtime_managed: bool,
}

#[derive(Debug, Deserialize)]
struct SyncSkillSourceRequest {
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentMuxSkillSource {
    source_directory: String,
    source_file: String,
    targets: Vec<AgentMuxSkillTarget>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentMuxSkillTarget {
    provider_id: &'static str,
    path: String,
    state: &'static str,
}

async fn runtime_info() -> Json<AgentMuxRuntimeInfo> {
    let executable = std::env::current_exe().ok();
    let cli = executable.as_ref().and_then(|path| {
        let file_name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
        if file_name.starts_with("codem-agent-mux") {
            return Some(path.clone());
        }
        #[cfg(target_os = "windows")]
        let candidate = path.parent()?.join("codem-agent-mux.exe");
        #[cfg(not(target_os = "windows"))]
        let candidate = path.parent()?.join("codem-agent-mux");
        candidate.is_file().then_some(candidate)
    });
    Json(AgentMuxRuntimeInfo {
        cli_path: cli
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "codem-agent-mux".to_string()),
        app_data_dir: std::env::var_os("CODEM_APP_DATA_DIR")
            .map(|path| PathBuf::from(path).display().to_string())
            .unwrap_or_default(),
        runtime_managed: std::env::var(crate::agent_mux_runtime::RUNTIME_TOKEN_ENV).is_ok(),
    })
}

async fn get_skill_source(
    State(service): State<AgentMuxService>,
) -> ApiResult<AgentMuxSkillSource> {
    read_skill_source_state(&service).map(Json)
}

async fn sync_skill_source(
    State(service): State<AgentMuxService>,
    Json(payload): Json<SyncSkillSourceRequest>,
) -> ApiResult<AgentMuxSkillSource> {
    validate_skill_source_content(&payload.content)?;
    let source_file = agent_mux_skill_source_directory(&service).join("SKILL.md");
    let normalized = format!("{}\n", payload.content.trim_end());
    write_skill_source_if_changed(&source_file, normalized.as_bytes()).map_err(internal_error)?;
    read_skill_source_state(&service).map(Json)
}

fn read_skill_source_state(
    service: &AgentMuxService,
) -> Result<AgentMuxSkillSource, (StatusCode, Json<Value>)> {
    let home = user_home_directory().ok_or_else(|| client_error("无法定位用户目录"))?;
    read_skill_source_state_for_home(service, &home)
}

fn read_skill_source_state_for_home(
    service: &AgentMuxService,
    home: &FsPath,
) -> Result<AgentMuxSkillSource, (StatusCode, Json<Value>)> {
    let source_directory = agent_mux_skill_source_directory(service);
    let source_file = source_directory.join("SKILL.md");
    let source_content = fs::read(&source_file).ok();
    let targets = skill_install_targets(&home)
        .into_iter()
        .map(|(provider_id, root)| {
            let target_file = root.join(AGENT_MUX_SKILL_NAME).join("SKILL.md");
            let target_content = fs::read(&target_file).ok();
            let state = match (&source_content, target_content) {
                (_, None) => "not-installed",
                (Some(source), Some(target)) if source == &target => "installed",
                _ => "update-available",
            };
            AgentMuxSkillTarget {
                provider_id,
                path: target_file.display().to_string(),
                state,
            }
        })
        .collect();
    Ok(AgentMuxSkillSource {
        source_directory: source_directory.display().to_string(),
        source_file: source_file.display().to_string(),
        targets,
    })
}

fn agent_mux_skill_source_directory(service: &AgentMuxService) -> PathBuf {
    service
        .app_data_dir
        .join("skills")
        .join(AGENT_MUX_SKILL_NAME)
}

fn skill_install_targets(home: &FsPath) -> [(&'static str, PathBuf); 7] {
    [
        ("claude-code", home.join(".claude").join("skills")),
        ("openai-codex", home.join(".codex").join("skills")),
        ("grok-build", home.join(".grok").join("skills")),
        ("pi-agent", home.join(".pi").join("agent").join("skills")),
        (
            "opencode",
            home.join(".config").join("opencode").join("skills"),
        ),
        ("gemini-cli", home.join(".gemini").join("skills")),
        ("hermes-agent", home.join(".hermes").join("skills")),
    ]
}

fn user_home_directory() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn validate_skill_source_content(content: &str) -> Result<(), (StatusCode, Json<Value>)> {
    if content.len() > MAX_AGENT_MUX_SKILL_BYTES {
        return Err(client_error("Agent Mux Skill 内容过大"));
    }
    let normalized = content.replace("\r\n", "\n");
    let mut parts = normalized.splitn(3, "---");
    if parts.next().is_some_and(|prefix| !prefix.trim().is_empty()) {
        return Err(client_error("Agent Mux Skill 缺少有效 frontmatter"));
    }
    let Some(frontmatter) = parts.next() else {
        return Err(client_error("Agent Mux Skill 缺少有效 frontmatter"));
    };
    if parts.next().is_none() {
        return Err(client_error("Agent Mux Skill 缺少正文"));
    }
    let mut name = None;
    let mut description = None;
    for line in frontmatter
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Some((key, value)) = line.split_once(':') else {
            return Err(client_error("Agent Mux Skill frontmatter 格式无效"));
        };
        match key.trim() {
            "name" => name = Some(value.trim()),
            "description" => description = Some(value.trim()),
            _ => {
                return Err(client_error(
                    "Agent Mux Skill frontmatter 仅支持 name 和 description",
                ))
            }
        }
    }
    if name != Some(AGENT_MUX_SKILL_NAME) || description.is_none_or(str::is_empty) {
        return Err(client_error("Agent Mux Skill 的 name 或 description 无效"));
    }
    Ok(())
}

fn write_skill_source_if_changed(path: &FsPath, content: &[u8]) -> std::io::Result<()> {
    if fs::read(path).ok().as_deref() == Some(content) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension(format!(
        "md.{}.{}.tmp",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    fs::write(&temporary, content)?;
    replace_skill_source_file(&temporary, path).inspect_err(|_| {
        let _ = fs::remove_file(&temporary);
    })
}

#[cfg(windows)]
fn replace_skill_source_file(source: &FsPath, target: &FsPath) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        },
    };
    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        MoveFileExW(
            PCWSTR(source_wide.as_ptr()),
            PCWSTR(target_wide.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
        .map_err(|error| std::io::Error::other(error.to_string()))
    }
}

#[cfg(not(windows))]
fn replace_skill_source_file(source: &FsPath, target: &FsPath) -> std::io::Result<()> {
    fs::rename(source, target)
}

async fn get_overview(State(service): State<AgentMuxService>) -> ApiResult<AgentMuxOverview> {
    let connection = service.connection()?;
    ensure_schema(&connection)?;
    ensure_agent_catalog(&connection)?;
    Ok(Json(read_overview(&connection)?))
}

async fn list_profiles(State(service): State<AgentMuxService>) -> ApiResult<Vec<AgentRecord>> {
    let connection = service.connection()?;
    ensure_schema(&connection)?;
    ensure_agent_catalog(&connection)?;
    read_agents(&connection).map(Json)
}

async fn create_profile(
    State(service): State<AgentMuxService>,
    Json(mut payload): Json<CreateProfileRequest>,
) -> ApiResult<RuntimeProfile> {
    let connection = service.connection()?;
    ensure_schema(&connection)?;
    let agent_exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM agent_mux_agents WHERE id = ?1)",
            [&payload.agent_id],
            |row| row.get(0),
        )
        .map_err(internal_error)?;
    if !agent_exists {
        return Err(client_error("Agent 类型不存在"));
    }
    normalize_profile_identity(&mut payload.profile)?;
    write_profile(&connection, &payload.agent_id, &payload.profile)?;
    Ok(Json(payload.profile))
}

async fn update_profile(
    Path(profile_id): Path<String>,
    State(service): State<AgentMuxService>,
    Json(mut profile): Json<RuntimeProfile>,
) -> ApiResult<RuntimeProfile> {
    let connection = service.connection()?;
    ensure_schema(&connection)?;
    profile.id = profile_id.clone();
    normalize_profile_identity(&mut profile)?;
    let changed = connection
        .execute(
            "UPDATE agent_mux_profiles SET provider = ?2, model = ?3, level = ?4, tags_json = ?5, role = ?6, status = ?7, channel_id = ?8, reasoning_effort = ?9, nickname = ?10, avatar = ?11, updated_at = datetime('now') WHERE id = ?1",
            params![profile_id, profile.provider, profile.model, profile.level, serde_json::to_string(&profile.tags).map_err(internal_error)?, profile.role, profile.status, profile.channel_id, profile.reasoning_effort, profile.nickname, profile.avatar],
        )
        .map_err(internal_error)?;
    if changed == 0 {
        return Err(client_error("运行配置不存在"));
    }
    Ok(Json(profile))
}

async fn delete_profile(
    Path(profile_id): Path<String>,
    State(service): State<AgentMuxService>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    let connection = service.connection()?;
    ensure_schema(&connection)?;
    connection
        .execute(
            "DELETE FROM agent_mux_profiles WHERE id = ?1",
            [&profile_id],
        )
        .map_err(internal_error)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn update_profile_status(
    Path(profile_id): Path<String>,
    State(service): State<AgentMuxService>,
    Json(payload): Json<ProfileStatusRequest>,
) -> ApiResult<RuntimeProfile> {
    let connection = service.connection()?;
    ensure_schema(&connection)?;
    connection
        .execute(
            "UPDATE agent_mux_profiles SET status = ?2, updated_at = datetime('now') WHERE id = ?1",
            params![profile_id, payload.status],
        )
        .map_err(internal_error)?;
    let profile =
        read_profile(&connection, &profile_id)?.ok_or_else(|| client_error("运行配置不存在"))?;
    Ok(Json(profile))
}

async fn list_workflows(State(service): State<AgentMuxService>) -> ApiResult<Vec<Value>> {
    let connection = service.connection()?;
    ensure_schema(&connection)?;
    read_json_documents(&connection, "agent_mux_workflows").map(Json)
}

async fn create_workflow(
    State(service): State<AgentMuxService>,
    Json(document): Json<Value>,
) -> ApiResult<Value> {
    let connection = service.connection()?;
    ensure_schema(&connection)?;
    write_json_document(&connection, "agent_mux_workflows", &document, false)?;
    Ok(Json(document))
}

async fn update_workflow(
    Path(workflow_id): Path<String>,
    State(service): State<AgentMuxService>,
    Json(mut document): Json<Value>,
) -> ApiResult<Value> {
    let connection = service.connection()?;
    ensure_schema(&connection)?;
    set_document_id(&mut document, &workflow_id)?;
    write_json_document(&connection, "agent_mux_workflows", &document, true)?;
    Ok(Json(document))
}

async fn delete_workflow(
    Path(workflow_id): Path<String>,
    State(service): State<AgentMuxService>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    let connection = service.connection()?;
    ensure_schema(&connection)?;
    connection
        .execute(
            "DELETE FROM agent_mux_workflows WHERE id = ?1",
            [&workflow_id],
        )
        .map_err(internal_error)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_workflow_runs(State(service): State<AgentMuxService>) -> ApiResult<Vec<Value>> {
    let connection = service.connection()?;
    ensure_schema(&connection)?;
    read_json_documents(&connection, "agent_mux_workflow_runs").map(Json)
}

async fn create_workflow_run(
    State(service): State<AgentMuxService>,
    Json(document): Json<Value>,
) -> ApiResult<Value> {
    let connection = service.connection()?;
    ensure_schema(&connection)?;
    write_json_document(&connection, "agent_mux_workflow_runs", &document, false)?;
    Ok(Json(document))
}

async fn update_workflow_run(
    Path(run_id): Path<String>,
    State(service): State<AgentMuxService>,
    Json(mut document): Json<Value>,
) -> ApiResult<Value> {
    let connection = service.connection()?;
    ensure_schema(&connection)?;
    set_document_id(&mut document, &run_id)?;
    write_json_document(&connection, "agent_mux_workflow_runs", &document, true)?;
    Ok(Json(document))
}

fn read_json_documents(
    connection: &Connection,
    table: &str,
) -> Result<Vec<Value>, (StatusCode, Json<Value>)> {
    let query =
        format!("SELECT document_json FROM {table} ORDER BY updated_at DESC, created_at DESC");
    let mut statement = connection.prepare(&query).map_err(internal_error)?;
    let documents = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(internal_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(internal_error)?;
    documents
        .into_iter()
        .map(|document| serde_json::from_str(&document).map_err(internal_error))
        .collect()
}

fn set_document_id(document: &mut Value, id: &str) -> Result<(), (StatusCode, Json<Value>)> {
    let object = document
        .as_object_mut()
        .ok_or_else(|| client_error("工作流文档必须是对象"))?;
    object.insert("id".to_string(), Value::String(id.to_string()));
    Ok(())
}

fn write_json_document(
    connection: &Connection,
    table: &str,
    document: &Value,
    update_only: bool,
) -> Result<(), (StatusCode, Json<Value>)> {
    let id = document
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| client_error("工作流文档缺少 id"))?;
    let document_json = serde_json::to_string(document).map_err(internal_error)?;
    let changed = if update_only {
        connection.execute(
            &format!(
                "UPDATE {table} SET document_json = ?2, updated_at = datetime('now') WHERE id = ?1"
            ),
            params![id, document_json],
        )
    } else {
        connection.execute(
            &format!("INSERT INTO {table} (id, document_json) VALUES (?1, ?2)"),
            params![id, document_json],
        )
    }
    .map_err(internal_error)?;
    if update_only && changed == 0 {
        return Err(client_error("工作流记录不存在"));
    }
    Ok(())
}

async fn list_runs(State(service): State<AgentMuxService>) -> ApiResult<Vec<RunRecord>> {
    let connection = service.connection()?;
    ensure_schema(&connection)?;
    read_runs(&connection).map(Json)
}

async fn create_run(
    State(service): State<AgentMuxService>,
    Json(mut payload): Json<CreateRunRequest>,
) -> ApiResult<RunRecord> {
    validate_run_request(&payload)?;
    normalize_run_identity(&mut payload)?;
    let connection = service.connection()?;
    ensure_schema(&connection)?;
    let id = format!("mux-{}", uuid::Uuid::new_v4());
    connection
        .execute(
            "INSERT INTO agent_mux_runs (id, caller, target, profile, nickname, avatar, skill, status, duration, started, prompt, summary, profile_id, working_directory, thread_id, session_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![id, payload.caller.trim(), payload.target.trim(), payload.profile.trim(), payload.nickname, payload.avatar, payload.skill.trim(), payload.status, payload.duration, payload.started, payload.prompt, payload.summary.trim(), payload.profile_id, payload.working_directory, payload.thread_id, payload.session_id],
        )
        .map_err(internal_error)?;
    let run =
        read_run(&connection, &id)?.ok_or_else(|| internal_error("创建运行记录后读取失败"))?;
    Ok(Json(run))
}

async fn update_run(
    Path(run_id): Path<String>,
    State(service): State<AgentMuxService>,
    Json(mut payload): Json<UpdateRunRequest>,
) -> ApiResult<RunRecord> {
    if let Some(status) = payload.status.as_deref() {
        validate_run_status(status)?;
    }
    normalize_session_id(&mut payload.session_id)?;
    let connection = service.connection()?;
    ensure_schema(&connection)?;
    let existing = read_run(&connection, &run_id)?.ok_or_else(|| client_error("运行记录不存在"))?;
    let conflicting_terminal_update =
        terminal_update_conflicts(&existing.status, payload.status.as_deref());
    let status = (!conflicting_terminal_update)
        .then_some(payload.status)
        .flatten();
    let duration = (!conflicting_terminal_update)
        .then_some(payload.duration)
        .flatten();
    let summary = (!conflicting_terminal_update)
        .then_some(payload.summary)
        .flatten();
    let changed = connection
        .execute(
            "UPDATE agent_mux_runs SET status = COALESCE(?2, status), duration = COALESCE(?3, duration), summary = COALESCE(?4, summary), provider_run_id = COALESCE(?5, provider_run_id), session_id = COALESCE(?6, session_id), updated_at = datetime('now') WHERE id = ?1",
            params![run_id, status, duration, summary, payload.provider_run_id, payload.session_id],
        )
        .map_err(internal_error)?;
    if changed == 0 {
        return Err(client_error("运行记录不存在"));
    }
    let run = read_run(&connection, &run_id)?.ok_or_else(|| client_error("运行记录不存在"))?;
    Ok(Json(run))
}

fn terminal_update_conflicts(existing_status: &str, requested_status: Option<&str>) -> bool {
    let Some(requested_status) = requested_status else {
        return false;
    };
    if !matches!(
        existing_status,
        "completed" | "failed" | "waiting" | "cancelled"
    ) {
        return false;
    }
    if requested_status == existing_status {
        return false;
    }

    // A cancellation can race with the provider stream reporting a failed or
    // waiting run. Preserve the explicit user action, but never reopen a
    // completed run or replace an already persisted cancellation.
    !(requested_status == "cancelled" && matches!(existing_status, "failed" | "waiting"))
}

async fn list_run_events(
    Path(run_id): Path<String>,
    State(service): State<AgentMuxService>,
) -> ApiResult<Vec<RunEventRecord>> {
    let connection = service.connection()?;
    ensure_schema(&connection)?;
    read_run_events(&connection, &run_id).map(Json)
}

async fn create_run_event(
    Path(run_id): Path<String>,
    State(service): State<AgentMuxService>,
    Json(payload): Json<CreateRunEventRequest>,
) -> ApiResult<RunEventRecord> {
    let event_type = payload.event_type.trim();
    let message = payload.message.trim();
    if event_type.is_empty() || message.is_empty() {
        return Err(client_error("运行事件缺少类型或内容"));
    }
    let connection = service.connection()?;
    ensure_schema(&connection)?;
    connection
        .execute(
            "INSERT INTO agent_mux_run_events (run_id, event_type, message, payload_json) VALUES (?1, ?2, ?3, ?4)",
            params![run_id, event_type, truncate_text(message, 32_000), payload.payload.as_ref().map(Value::to_string)],
        )
        .map_err(internal_error)?;
    let id = connection.last_insert_rowid();
    let event = connection.query_row(
        "SELECT id, run_id, event_type, message, payload_json, created_at FROM agent_mux_run_events WHERE id = ?1",
        [id],
        |row| Ok(RunEventRecord { id: row.get(0)?, run_id: row.get(1)?, event_type: row.get(2)?, message: row.get(3)?, payload: parse_event_payload(row.get(4)?), created_at: row.get(5)? }),
    ).map_err(internal_error)?;
    Ok(Json(event))
}

fn ensure_schema(connection: &Connection) -> Result<(), (StatusCode, Json<Value>)> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS agent_mux_agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, tags_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE TABLE IF NOT EXISTS agent_mux_profiles (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agent_mux_agents(id) ON DELETE CASCADE, provider TEXT NOT NULL, model TEXT NOT NULL, reasoning_effort TEXT, level TEXT NOT NULL, tags_json TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE INDEX IF NOT EXISTS idx_agent_mux_profiles_agent ON agent_mux_profiles(agent_id); CREATE TABLE IF NOT EXISTS agent_mux_runs (id TEXT PRIMARY KEY, caller TEXT NOT NULL, target TEXT NOT NULL, profile TEXT NOT NULL, skill TEXT NOT NULL, status TEXT NOT NULL, duration TEXT NOT NULL DEFAULT '--', started TEXT NOT NULL DEFAULT '刚刚', prompt TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE INDEX IF NOT EXISTS idx_agent_mux_runs_created ON agent_mux_runs(created_at DESC); CREATE INDEX IF NOT EXISTS idx_agent_mux_runs_status ON agent_mux_runs(status); CREATE TABLE IF NOT EXISTS agent_mux_run_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES agent_mux_runs(id) ON DELETE CASCADE, event_type TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE INDEX IF NOT EXISTS idx_agent_mux_run_events_run ON agent_mux_run_events(run_id, id); CREATE TABLE IF NOT EXISTS agent_mux_workflows (id TEXT PRIMARY KEY, document_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE INDEX IF NOT EXISTS idx_agent_mux_workflows_updated ON agent_mux_workflows(updated_at DESC); CREATE TABLE IF NOT EXISTS agent_mux_workflow_runs (id TEXT PRIMARY KEY, document_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE INDEX IF NOT EXISTS idx_agent_mux_workflow_runs_updated ON agent_mux_workflow_runs(updated_at DESC);",
        )
        .map_err(internal_error)?;
    let has_channel_id: bool = connection
        .prepare("PRAGMA table_info(agent_mux_profiles)")
        .map_err(internal_error)?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(internal_error)?
        .filter_map(Result::ok)
        .any(|name| name == "channel_id");
    if !has_channel_id {
        connection
            .execute(
                "ALTER TABLE agent_mux_profiles ADD COLUMN channel_id TEXT",
                [],
            )
            .map_err(internal_error)?;
    }
    ensure_column(connection, "agent_mux_profiles", "reasoning_effort", "TEXT")?;
    ensure_column(connection, "agent_mux_profiles", "nickname", "TEXT")?;
    ensure_column(connection, "agent_mux_profiles", "avatar", "TEXT")?;
    ensure_column(connection, "agent_mux_runs", "profile_id", "TEXT")?;
    ensure_column(connection, "agent_mux_runs", "provider_run_id", "TEXT")?;
    ensure_column(connection, "agent_mux_runs", "working_directory", "TEXT")?;
    ensure_column(connection, "agent_mux_runs", "thread_id", "TEXT")?;
    ensure_column(connection, "agent_mux_runs", "session_id", "TEXT")?;
    ensure_column(connection, "agent_mux_runs", "nickname", "TEXT")?;
    ensure_column(connection, "agent_mux_runs", "avatar", "TEXT")?;
    ensure_column(
        connection,
        "agent_mux_runs",
        "prompt",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(connection, "agent_mux_run_events", "payload_json", "TEXT")?;
    // Older prototypes inserted fixed demo profiles. Remove only those known ids;
    // user-created records are left untouched during migration.
    connection.execute("DELETE FROM agent_mux_profiles WHERE id IN ('codex-sol','codex-terra','codex-luna','codex-deepseek','claude-opus','claude-sonnet','grok-deepseek','pi-gemini')", []).map_err(internal_error)?;
    migrate_profile_metadata(connection)?;
    Ok(())
}

fn migrate_profile_metadata(connection: &Connection) -> Result<(), (StatusCode, Json<Value>)> {
    let profiles = {
        let mut statement = connection
            .prepare("SELECT id, level, tags_json, role FROM agent_mux_profiles")
            .map_err(internal_error)?;
        let profiles = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(internal_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(internal_error)?;
        profiles
    };

    for (id, level, tags_json, role) in profiles {
        let tags = parse_tags(tags_json.clone());
        let migrated_level = if level == "未评级" {
            "基础"
        } else {
            &level
        };
        let migrated_tendency =
            if tags.len() == 1 && AGENT_MUX_CAPABILITY_TENDENCIES.contains(&tags[0].as_str()) {
                tags[0].clone()
            } else {
                infer_capability_tendency(&tags).to_string()
            };
        let migrated_role = if AGENT_MUX_PURPOSES.contains(&role.as_str()) {
            role.clone()
        } else {
            infer_profile_purpose(&tags).to_string()
        };
        let migrated_tags_json =
            serde_json::to_string(&vec![migrated_tendency]).map_err(internal_error)?;

        if migrated_level != level || migrated_tags_json != tags_json || migrated_role != role {
            connection
                .execute(
                    "UPDATE agent_mux_profiles SET level = ?2, tags_json = ?3, role = ?4, updated_at = datetime('now') WHERE id = ?1",
                    params![id, migrated_level, migrated_tags_json, migrated_role],
                )
                .map_err(internal_error)?;
        }
    }
    Ok(())
}

fn ensure_agent_catalog(connection: &Connection) -> Result<(), (StatusCode, Json<Value>)> {
    let tx = connection.unchecked_transaction().map_err(internal_error)?;
    let agents = [
        (
            "codex",
            "OpenAI Codex",
            "代码生成、审查与项目级修改 Agent。",
            &["代码生成", "代码审查", "终端操作"] as &[&str],
        ),
        (
            "claude",
            "Claude Code",
            "面向项目目录的终端 Agent，适合持续执行。",
            &["代码编辑", "终端操作", "项目级任务"],
        ),
        (
            "grok",
            "Grok Build",
            "适合快速探索和小范围变更的外部 Agent。",
            &["快速处理", "小任务"],
        ),
        (
            "pi",
            "Pi Agent",
            "轻量、低延迟的自动化执行 Agent。",
            &["自动化", "低延迟"],
        ),
        (
            "opencode",
            "OpenCode",
            "通过 ACP 接入的开放式编码 Agent。",
            &["代码编辑", "ACP", "多模型"],
        ),
        (
            "gemini",
            "Gemini CLI",
            "通过 ACP 接入的 Gemini 编码 Agent。",
            &["代码编辑", "ACP", "Gemini"],
        ),
        (
            "hermes",
            "Hermes Agent",
            "Hermes native JSON-RPC agent with memory, Skills, and MCP support.",
            &["coding", "memory", "Skills", "MCP"],
        ),
    ];
    for (id, name, description, tags) in agents {
        tx.execute("INSERT OR IGNORE INTO agent_mux_agents (id, name, description, tags_json) VALUES (?1, ?2, ?3, ?4)", params![id, name, description, serde_json::to_string(tags).map_err(internal_error)?]).map_err(internal_error)?;
    }
    tx.commit().map_err(internal_error)
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), (StatusCode, Json<Value>)> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(internal_error)?;
    let exists = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(internal_error)?
        .filter_map(Result::ok)
        .any(|name| name == column);
    if !exists {
        connection
            .execute(
                &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
                [],
            )
            .map_err(internal_error)?;
    }
    Ok(())
}

fn write_profile(
    connection: &Connection,
    agent_id: &str,
    profile: &RuntimeProfile,
) -> Result<(), (StatusCode, Json<Value>)> {
    connection.execute("INSERT OR REPLACE INTO agent_mux_profiles (id, agent_id, provider, model, level, tags_json, role, status, channel_id, reasoning_effort, nickname, avatar, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, datetime('now'))", params![profile.id, agent_id, profile.provider, profile.model, profile.level, serde_json::to_string(&profile.tags).map_err(internal_error)?, profile.role, profile.status, profile.channel_id, profile.reasoning_effort, profile.nickname, profile.avatar]).map_err(internal_error)?;
    Ok(())
}

fn read_agents(connection: &Connection) -> Result<Vec<AgentRecord>, (StatusCode, Json<Value>)> {
    let mut statement = connection
        .prepare("SELECT id, name, description, tags_json FROM agent_mux_agents ORDER BY rowid")
        .map_err(internal_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok(AgentRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                tags: parse_tags(row.get::<_, String>(3)?),
                profiles: Vec::new(),
            })
        })
        .map_err(internal_error)?;
    let mut agents: Vec<AgentRecord> = rows.collect::<Result<_, _>>().map_err(internal_error)?;
    for agent in &mut agents {
        let mut profiles = connection.prepare("SELECT id, provider, model, level, tags_json, role, status, channel_id, reasoning_effort, nickname, avatar FROM agent_mux_profiles WHERE agent_id = ?1 ORDER BY rowid").map_err(internal_error)?;
        agent.profiles = profiles
            .query_map([&agent.id], |row| {
                Ok(RuntimeProfile {
                    id: row.get(0)?,
                    provider: row.get(1)?,
                    model: row.get(2)?,
                    level: row.get(3)?,
                    tags: parse_tags(row.get::<_, String>(4)?),
                    role: row.get(5)?,
                    status: row.get(6)?,
                    channel_id: row.get(7)?,
                    reasoning_effort: row.get(8)?,
                    nickname: row.get(9)?,
                    avatar: row.get(10)?,
                })
            })
            .map_err(internal_error)?
            .collect::<Result<_, _>>()
            .map_err(internal_error)?;
    }
    Ok(agents)
}

fn read_profile(
    connection: &Connection,
    id: &str,
) -> Result<Option<RuntimeProfile>, (StatusCode, Json<Value>)> {
    connection.query_row("SELECT id, provider, model, level, tags_json, role, status, channel_id, reasoning_effort, nickname, avatar FROM agent_mux_profiles WHERE id = ?1", [id], |row| Ok(RuntimeProfile { id: row.get(0)?, provider: row.get(1)?, model: row.get(2)?, level: row.get(3)?, tags: parse_tags(row.get::<_, String>(4)?), role: row.get(5)?, status: row.get(6)?, channel_id: row.get(7)?, reasoning_effort: row.get(8)?, nickname: row.get(9)?, avatar: row.get(10)? })).optional().map_err(internal_error)
}

fn read_overview(connection: &Connection) -> Result<AgentMuxOverview, (StatusCode, Json<Value>)> {
    Ok(AgentMuxOverview {
        agents: read_agents(connection)?,
        runs: read_runs(connection)?,
        metrics: read_metrics(connection)?,
    })
}

fn read_runs(connection: &Connection) -> Result<Vec<RunRecord>, (StatusCode, Json<Value>)> {
    let mut statement = connection
        .prepare("SELECT id, caller, target, profile, skill, status, duration, started, prompt, summary, profile_id, provider_run_id, working_directory, thread_id, nickname, avatar, session_id, created_at FROM agent_mux_runs ORDER BY created_at DESC, rowid DESC LIMIT 100")
        .map_err(internal_error)?;
    let runs = statement
        .query_map([], |row| {
            Ok(RunRecord {
                id: row.get(0)?,
                caller: row.get(1)?,
                target: row.get(2)?,
                profile: row.get(3)?,
                skill: row.get(4)?,
                status: row.get(5)?,
                duration: row.get(6)?,
                started: row.get(7)?,
                prompt: row.get(8)?,
                summary: row.get(9)?,
                profile_id: row.get(10)?,
                provider_run_id: row.get(11)?,
                working_directory: row.get(12)?,
                thread_id: row.get(13)?,
                nickname: row.get(14)?,
                avatar: row.get(15)?,
                session_id: row.get(16)?,
                created_at: row.get(17)?,
            })
        })
        .map_err(internal_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(internal_error)?;
    Ok(runs)
}

fn read_run(
    connection: &Connection,
    id: &str,
) -> Result<Option<RunRecord>, (StatusCode, Json<Value>)> {
    connection
        .query_row(
            "SELECT id, caller, target, profile, skill, status, duration, started, prompt, summary, profile_id, provider_run_id, working_directory, thread_id, nickname, avatar, session_id, created_at FROM agent_mux_runs WHERE id = ?1",
            [id],
            |row| {
                Ok(RunRecord {
                    id: row.get(0)?,
                    caller: row.get(1)?,
                    target: row.get(2)?,
                    profile: row.get(3)?,
                    skill: row.get(4)?,
                    status: row.get(5)?,
                    duration: row.get(6)?,
                    started: row.get(7)?,
                    prompt: row.get(8)?,
                    summary: row.get(9)?,
                    profile_id: row.get(10)?,
                    provider_run_id: row.get(11)?,
                    working_directory: row.get(12)?,
                    thread_id: row.get(13)?,
                    nickname: row.get(14)?,
                    avatar: row.get(15)?,
                    session_id: row.get(16)?,
                    created_at: row.get(17)?,
                })
            },
        )
        .optional()
        .map_err(internal_error)
}

fn read_run_events(
    connection: &Connection,
    run_id: &str,
) -> Result<Vec<RunEventRecord>, (StatusCode, Json<Value>)> {
    let mut statement = connection.prepare("SELECT id, run_id, event_type, message, payload_json, created_at FROM agent_mux_run_events WHERE run_id = ?1 ORDER BY id LIMIT 1000").map_err(internal_error)?;
    let events = statement
        .query_map([run_id], |row| {
            Ok(RunEventRecord {
                id: row.get(0)?,
                run_id: row.get(1)?,
                event_type: row.get(2)?,
                message: row.get(3)?,
                payload: parse_event_payload(row.get(4)?),
                created_at: row.get(5)?,
            })
        })
        .map_err(internal_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(internal_error)?;
    Ok(events)
}

fn read_metrics(connection: &Connection) -> Result<AgentMuxMetrics, (StatusCode, Json<Value>)> {
    let running = connection
        .query_row(
            "SELECT COUNT(*) FROM agent_mux_runs WHERE status = 'running'",
            [],
            |row| row.get(0),
        )
        .map_err(internal_error)?;
    let available_agents = connection
        .query_row(
            "SELECT COUNT(DISTINCT agent_id) FROM agent_mux_profiles WHERE status = 'available'",
            [],
            |row| row.get(0),
        )
        .map_err(internal_error)?;
    let today_calls = connection
        .query_row("SELECT COUNT(*) FROM agent_mux_runs WHERE date(created_at, 'localtime') = date('now', 'localtime')", [], |row| row.get(0))
        .map_err(internal_error)?;
    let (completed, failed): (i64, i64) = connection
        .query_row("SELECT COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0), COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) FROM agent_mux_runs", [], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(internal_error)?;
    let total = completed + failed;
    Ok(AgentMuxMetrics {
        running,
        available_agents,
        today_calls,
        success_rate: (total > 0).then_some((completed as f64 / total as f64) * 100.0),
    })
}

fn normalize_profile_identity(
    profile: &mut RuntimeProfile,
) -> Result<(), (StatusCode, Json<Value>)> {
    normalize_profile_metadata(profile)?;
    normalize_nickname(&mut profile.nickname)?;
    normalize_avatar(&mut profile.avatar)
}

fn normalize_profile_metadata(
    profile: &mut RuntimeProfile,
) -> Result<(), (StatusCode, Json<Value>)> {
    profile.level = profile.level.trim().to_string();
    if profile.level == "未评级" {
        profile.level = "基础".to_string();
    }
    if !AGENT_MUX_CAPABILITY_LEVELS.contains(&profile.level.as_str()) {
        return Err(client_error("能力等级无效"));
    }

    let tags: Vec<String> = profile
        .tags
        .iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .collect();
    let tendency = if tags.len() == 1 && AGENT_MUX_CAPABILITY_TENDENCIES.contains(&tags[0].as_str())
    {
        tags[0].clone()
    } else if tags.is_empty() || tags.iter().all(|tag| is_legacy_capability_tag(tag)) {
        infer_capability_tendency(&tags).to_string()
    } else {
        return Err(client_error("能力偏向无效"));
    };
    profile.tags = vec![tendency];

    profile.role = profile.role.trim().to_string();
    if !AGENT_MUX_PURPOSES.contains(&profile.role.as_str()) {
        if matches!(
            profile.role.as_str(),
            "主执行" | "故障切换" | "备用" | "小任务"
        ) {
            profile.role = infer_profile_purpose(&tags).to_string();
        } else {
            return Err(client_error("用途无效"));
        }
    }
    Ok(())
}

fn is_legacy_capability_tag(tag: &str) -> bool {
    matches!(
        tag,
        "代码生成"
            | "代码审查"
            | "复杂实现"
            | "测试验证"
            | "快速修改"
            | "代码编辑"
            | "项目审查"
            | "终端操作"
            | "长任务"
            | "文档处理"
            | "快速探索"
            | "小范围修改"
            | "信息检索"
            | "代码验证"
            | "ACP"
            | "多模型"
            | "项目任务"
            | "工具调用"
            | "代码执行"
            | "记忆"
            | "Skills"
            | "MCP"
            | "多轮会话"
            | "自动化"
            | "低延迟"
            | "脚本任务"
            | "验证"
    )
}

fn infer_capability_tendency(tags: &[String]) -> &'static str {
    if tags
        .iter()
        .any(|tag| tag.contains("前端") || tag.contains("UI"))
    {
        "前端 / UI"
    } else if tags
        .iter()
        .any(|tag| tag.contains("文档") || tag.contains("写作"))
    {
        "写作"
    } else if tags
        .iter()
        .any(|tag| tag.contains("数学") || tag.contains("推理"))
    {
        "数学推理"
    } else if tags.iter().any(|tag| {
        [
            "代码", "编程", "项目", "终端", "脚本", "ACP", "MCP", "工具", "Skills",
        ]
        .iter()
        .any(|marker| tag.contains(marker))
    }) {
        "代码"
    } else {
        "通用"
    }
}

fn infer_profile_purpose(tags: &[String]) -> &'static str {
    if tags.iter().any(|tag| tag.contains("审查")) {
        "代码审查"
    } else if tags
        .iter()
        .any(|tag| tag.contains("Bug") || tag.contains("排查"))
    {
        "Bug 排查"
    } else if tags
        .iter()
        .any(|tag| tag.contains("测试") || tag.contains("验证"))
    {
        "测试验证"
    } else if tags
        .iter()
        .any(|tag| tag.contains("前端") || tag.contains("UI"))
    {
        "前端实现"
    } else if tags
        .iter()
        .any(|tag| tag.contains("文档") || tag.contains("写作"))
    {
        "文档写作"
    } else if tags
        .iter()
        .any(|tag| tag.contains("信息") || tag.contains("探索"))
    {
        "信息分析"
    } else if tags
        .iter()
        .any(|tag| tag.contains("数学") || tag.contains("推理"))
    {
        "数学推理"
    } else if infer_capability_tendency(tags) == "代码" {
        "代码生成"
    } else {
        "通用任务"
    }
}

fn normalize_run_identity(payload: &mut CreateRunRequest) -> Result<(), (StatusCode, Json<Value>)> {
    normalize_nickname(&mut payload.nickname)?;
    normalize_avatar(&mut payload.avatar)?;
    normalize_session_id(&mut payload.session_id)
}

fn normalize_session_id(value: &mut Option<String>) -> Result<(), (StatusCode, Json<Value>)> {
    let normalized = value
        .take()
        .map(|session_id| session_id.trim().to_string())
        .filter(|session_id| !session_id.is_empty());
    if normalized
        .as_deref()
        .is_some_and(|session_id| session_id.len() > 512)
    {
        return Err(client_error("sessionId 无效"));
    }
    *value = normalized;
    Ok(())
}

fn normalize_nickname(value: &mut Option<String>) -> Result<(), (StatusCode, Json<Value>)> {
    let normalized = value
        .take()
        .map(|nickname| nickname.trim().to_string())
        .filter(|nickname| !nickname.is_empty());
    if normalized
        .as_deref()
        .is_some_and(|nickname| nickname.chars().count() > MAX_AGENT_MUX_NICKNAME_CHARS)
    {
        return Err(client_error("Agent 昵称不能超过 32 个字符"));
    }
    *value = normalized;
    Ok(())
}

fn normalize_avatar(value: &mut Option<String>) -> Result<(), (StatusCode, Json<Value>)> {
    let normalized = value
        .take()
        .map(|avatar| avatar.trim().to_string())
        .filter(|avatar| !avatar.is_empty());
    if normalized
        .as_deref()
        .is_some_and(|avatar| !AGENT_MUX_AVATARS.contains(&avatar))
    {
        return Err(client_error("Agent 图标不是有效的内置图标"));
    }
    *value = normalized;
    Ok(())
}

fn validate_run_request(payload: &CreateRunRequest) -> Result<(), (StatusCode, Json<Value>)> {
    if payload.caller.trim().is_empty()
        || payload.target.trim().is_empty()
        || payload.profile.trim().is_empty()
    {
        return Err(client_error("运行记录缺少调用方、目标 Agent 或运行配置"));
    }
    if payload
        .thread_id
        .as_deref()
        .is_some_and(|thread_id| thread_id.trim().is_empty() || thread_id.len() > 128)
    {
        return Err(client_error("threadId 无效"));
    }
    validate_run_status(&payload.status)
}

fn validate_run_status(status: &str) -> Result<(), (StatusCode, Json<Value>)> {
    if matches!(
        status,
        "running" | "completed" | "failed" | "queued" | "waiting" | "cancelled"
    ) {
        Ok(())
    } else {
        Err(client_error("不支持的运行状态"))
    }
}

fn default_skill() -> String {
    "codem-agent-mux".to_string()
}
fn default_duration() -> String {
    "--".to_string()
}
fn default_started() -> String {
    "刚刚".to_string()
}

fn parse_tags(value: String) -> Vec<String> {
    serde_json::from_str(&value).unwrap_or_default()
}
fn truncate_text(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}
fn parse_event_payload(value: Option<String>) -> Option<Value> {
    value.and_then(|payload| serde_json::from_str(&payload).ok())
}
fn client_error(message: &str) -> (StatusCode, Json<Value>) {
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({"message": message})),
    )
}
fn internal_error<E: std::fmt::Display>(error: E) -> (StatusCode, Json<Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({"message": error.to_string()})),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "codem-agent-mux-{label}-{}-{}",
                std::process::id(),
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(&path).expect("create Agent Mux test directory");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn test_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("open in-memory Agent Mux database");
        ensure_schema(&connection).expect("create Agent Mux schema");
        ensure_agent_catalog(&connection).expect("create Agent Mux agent catalog");
        connection
    }

    #[test]
    fn empty_overview_has_no_synthetic_runs() {
        let connection = test_connection();
        let overview = read_overview(&connection).expect("read Agent Mux overview");

        assert_eq!(overview.agents.len(), 7);
        assert!(overview.agents.iter().any(|agent| agent.id == "opencode"));
        assert!(overview.agents.iter().any(|agent| agent.id == "gemini"));
        assert!(overview.agents.iter().any(|agent| agent.id == "hermes"));
        assert!(overview
            .agents
            .iter()
            .all(|agent| agent.profiles.is_empty()));
        assert!(overview.runs.is_empty());
        assert_eq!(overview.metrics.running, 0);
        assert_eq!(overview.metrics.today_calls, 0);
        assert_eq!(overview.metrics.success_rate, None);
    }

    #[test]
    fn workflow_documents_round_trip_and_updates_preserve_identity() {
        let connection = test_connection();
        let original = serde_json::json!({
            "id": "workflow-1",
            "name": "方案评审",
            "nodes": [],
            "edges": []
        });
        write_json_document(&connection, "agent_mux_workflows", &original, false)
            .expect("create workflow document");

        let mut updated = serde_json::json!({ "name": "方案评审 V2", "nodes": [], "edges": [] });
        set_document_id(&mut updated, "workflow-1").expect("set workflow id");
        write_json_document(&connection, "agent_mux_workflows", &updated, true)
            .expect("update workflow document");

        let workflows = read_json_documents(&connection, "agent_mux_workflows")
            .expect("read workflow documents");
        assert_eq!(workflows, vec![updated]);
        assert!(write_json_document(&connection, "agent_mux_workflows", &original, false).is_err());
        assert!(write_json_document(&connection, "agent_mux_workflows", &original, true).is_ok());
    }

    #[test]
    fn schema_removes_only_known_demo_profiles() {
        let connection = test_connection();
        connection.execute("INSERT INTO agent_mux_profiles (id, agent_id, provider, model, level, tags_json, role, status, channel_id) VALUES ('codex-sol', 'codex', 'OpenAI', 'sol', '高级', '[]', '主执行', 'available', NULL)", []).expect("insert old demo profile");
        connection.execute("INSERT INTO agent_mux_profiles (id, agent_id, provider, model, level, tags_json, role, status, channel_id) VALUES ('user-profile', 'codex', 'OpenAI Codex', 'custom', '未评级', '[]', '备用', 'disabled', 'channel-1')", []).expect("insert user profile");

        ensure_schema(&connection).expect("migrate Agent Mux schema");

        let demo_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM agent_mux_profiles WHERE id = 'codex-sol'",
                [],
                |row| row.get(0),
            )
            .expect("count demo profiles");
        let user_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM agent_mux_profiles WHERE id = 'user-profile'",
                [],
                |row| row.get(0),
            )
            .expect("count user profiles");
        assert_eq!(demo_count, 0);
        assert_eq!(user_count, 1);
        let migrated: (String, String, String) = connection
            .query_row(
                "SELECT level, tags_json, role FROM agent_mux_profiles WHERE id = 'user-profile'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read migrated profile metadata");
        assert_eq!(migrated.0, "基础");
        assert_eq!(migrated.1, "[\"通用\"]");
        assert_eq!(migrated.2, "通用任务");
    }

    #[test]
    fn catalog_adds_acp_agents_to_existing_databases() {
        let connection = Connection::open_in_memory().expect("open Agent Mux database");
        ensure_schema(&connection).expect("create Agent Mux schema");
        connection.execute("INSERT INTO agent_mux_agents (id, name, description, tags_json) VALUES ('codex', 'OpenAI Codex', 'existing', '[]')", []).expect("insert existing catalog row");

        ensure_agent_catalog(&connection).expect("upgrade Agent Mux catalog");

        let opencode_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM agent_mux_agents WHERE id = 'opencode'",
                [],
                |row| row.get(0),
            )
            .expect("count OpenCode catalog rows");
        assert_eq!(opencode_count, 1);
        let gemini_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM agent_mux_agents WHERE id = 'gemini'",
                [],
                |row| row.get(0),
            )
            .expect("count Gemini catalog rows");
        assert_eq!(gemini_count, 1);
        let hermes_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM agent_mux_agents WHERE id = 'hermes'",
                [],
                |row| row.get(0),
            )
            .expect("count Hermes catalog rows");
        assert_eq!(hermes_count, 1);
    }

    #[test]
    fn profile_identity_and_reasoning_are_persisted() {
        let connection = test_connection();
        let mut profile = RuntimeProfile {
            id: "codex-reasoning".to_string(),
            provider: "OpenAI Codex".to_string(),
            model: "gpt-5.6-sol".to_string(),
            nickname: Some("  审查员  ".to_string()),
            avatar: Some("fox".to_string()),
            reasoning_effort: Some("high".to_string()),
            level: "高级".to_string(),
            tags: vec!["代码生成".to_string()],
            role: "主执行".to_string(),
            status: "available".to_string(),
            channel_id: None,
        };

        normalize_profile_identity(&mut profile).expect("normalize profile identity");
        assert_eq!(profile.tags, vec!["代码"]);
        assert_eq!(profile.role, "代码生成");
        write_profile(&connection, "codex", &profile).expect("persist reasoning effort");
        let stored = read_profile(&connection, &profile.id)
            .expect("read profile")
            .expect("profile exists");

        assert_eq!(stored.nickname.as_deref(), Some("审查员"));
        assert_eq!(stored.avatar.as_deref(), Some("fox"));
        assert_eq!(stored.reasoning_effort.as_deref(), Some("high"));
        let mut invalid_avatar = Some("https://example.com/avatar.png".to_string());
        assert!(normalize_avatar(&mut invalid_avatar).is_err());
    }

    #[test]
    fn profile_metadata_rejects_unknown_values() {
        let mut profile = RuntimeProfile {
            id: "invalid-profile".to_string(),
            provider: "OpenAI Codex".to_string(),
            model: "gpt-5.6-sol".to_string(),
            nickname: None,
            avatar: None,
            reasoning_effort: None,
            level: "至尊".to_string(),
            tags: vec!["随便".to_string()],
            role: "主力".to_string(),
            status: "available".to_string(),
            channel_id: None,
        };

        assert!(normalize_profile_identity(&mut profile).is_err());
    }

    #[test]
    fn overview_metrics_are_derived_from_persisted_runs() {
        let connection = test_connection();
        connection
            .execute(
                "INSERT INTO agent_mux_runs (id, caller, target, profile, skill, status, duration, started, summary) VALUES ('run-1', 'CodeM', 'Codex', 'OpenAI / sol', 'codem-agent-mux', 'completed', '00:10', '刚刚', '完成')",
                [],
            )
            .expect("insert completed Agent Mux run");
        connection
            .execute(
                "INSERT INTO agent_mux_runs (id, caller, target, profile, skill, status, duration, started, summary) VALUES ('run-2', 'CodeM', 'Claude Code', 'Anthropic / Sonnet', 'codem-agent-mux', 'running', '--', '刚刚', '执行中')",
                [],
            )
            .expect("insert running Agent Mux run");

        let overview = read_overview(&connection).expect("read Agent Mux overview");
        assert_eq!(overview.runs.len(), 2);
        assert_eq!(overview.metrics.running, 1);
        assert_eq!(overview.metrics.today_calls, 2);
        assert_eq!(overview.metrics.success_rate, Some(100.0));
    }

    #[test]
    fn run_records_expose_the_persisted_utc_creation_time() {
        let connection = test_connection();
        connection.execute(
            "INSERT INTO agent_mux_runs (id, caller, target, profile, skill, status, created_at) VALUES ('timed-run', 'CodeM', 'Codex', 'OpenAI / sol', 'codem-agent-mux', 'completed', '2026-08-05 12:12:19')",
            [],
        ).expect("insert timed Agent Mux run");

        let run = read_run(&connection, "timed-run")
            .expect("read timed run")
            .expect("timed run exists");
        assert_eq!(run.created_at, "2026-08-05 12:12:19");
        assert_eq!(
            serde_json::to_value(run).expect("serialize timed run")["createdAt"],
            "2026-08-05 12:12:19"
        );
    }

    #[test]
    fn runtime_start_reconciles_only_interrupted_active_runs() {
        let connection = test_connection();
        for (id, status, summary) in [
            ("running-run", "running", ""),
            ("queued-run", "queued", "已有摘要"),
            ("waiting-run", "waiting", "等待用户处理"),
            ("completed-run", "completed", "已完成"),
        ] {
            connection.execute(
                "INSERT INTO agent_mux_runs (id, caller, target, profile, skill, status, summary) VALUES (?1, 'CodeM', 'Codex', 'OpenAI / sol', 'codem-agent-mux', ?2, ?3)",
                params![id, status, summary],
            ).expect("insert Agent Mux run");
        }

        assert_eq!(
            reconcile_interrupted_runs_in_connection(&connection)
                .expect("reconcile interrupted runs"),
            2
        );
        assert_eq!(
            read_run(&connection, "running-run")
                .expect("read running run")
                .expect("running run exists")
                .status,
            "failed"
        );
        assert_eq!(
            read_run(&connection, "running-run")
                .expect("read running run")
                .expect("running run exists")
                .summary,
            "Agent Mux Runtime 重启，运行已中断"
        );
        assert_eq!(
            read_run(&connection, "queued-run")
                .expect("read queued run")
                .expect("queued run exists")
                .summary,
            "已有摘要"
        );
        assert_eq!(
            read_run(&connection, "waiting-run")
                .expect("read waiting run")
                .expect("waiting run exists")
                .status,
            "waiting"
        );
        assert_eq!(
            read_run(&connection, "completed-run")
                .expect("read completed run")
                .expect("completed run exists")
                .status,
            "completed"
        );
    }

    #[test]
    fn run_prompt_survives_summary_updates() {
        let connection = test_connection();
        connection.execute(
            "INSERT INTO agent_mux_runs (id, caller, target, profile, skill, status, duration, started, prompt, summary) VALUES ('run-prompt', 'External Skill', 'Codex', 'OpenAI / sol', 'codem-agent-mux', 'running', '--', '刚刚', '检查完整改动并输出审查报告', '')",
            [],
        ).expect("insert Agent Mux run with prompt");

        connection.execute(
            "UPDATE agent_mux_runs SET status = 'completed', summary = '发现两个问题' WHERE id = 'run-prompt'",
            [],
        ).expect("update result summary");

        let run = read_run(&connection, "run-prompt")
            .expect("read Agent Mux run")
            .expect("run exists");
        assert_eq!(run.prompt, "检查完整改动并输出审查报告");
        assert_eq!(run.summary, "发现两个问题");
    }

    #[test]
    fn run_thread_id_is_optional_and_persisted() {
        let connection = test_connection();
        connection.execute(
            "INSERT INTO agent_mux_runs (id, caller, target, profile, skill, status, thread_id, session_id) VALUES ('thread-run', 'OpenAI Codex', 'Codex', 'OpenAI / sol', 'codem-agent-mux', 'running', 'thread-42', 'session-42')",
            [],
        ).expect("insert thread-associated Agent Mux run");
        connection.execute(
            "INSERT INTO agent_mux_runs (id, caller, target, profile, skill, status) VALUES ('external-run', '外部调用', 'Codex', 'OpenAI / sol', 'codem-agent-mux', 'completed')",
            [],
        ).expect("insert external Agent Mux run");

        assert_eq!(
            read_run(&connection, "thread-run")
                .expect("read associated run")
                .expect("associated run exists")
                .thread_id
                .as_deref(),
            Some("thread-42")
        );
        assert_eq!(
            read_run(&connection, "thread-run")
                .expect("read associated run")
                .expect("associated run exists")
                .session_id
                .as_deref(),
            Some("session-42")
        );
        assert_eq!(
            read_run(&connection, "external-run")
                .expect("read external run")
                .expect("external run exists")
                .thread_id,
            None
        );
    }

    #[test]
    fn cancellation_wins_over_provider_failure_race() {
        assert!(!terminal_update_conflicts("failed", Some("cancelled")));
        assert!(!terminal_update_conflicts("waiting", Some("cancelled")));
        assert!(!terminal_update_conflicts("running", Some("cancelled")));
        assert!(!terminal_update_conflicts("cancelled", Some("cancelled")));
        assert!(terminal_update_conflicts("completed", Some("cancelled")));
        assert!(terminal_update_conflicts("cancelled", Some("failed")));
        assert!(!terminal_update_conflicts("failed", None));
    }

    #[test]
    fn run_events_round_trip_structured_agent_payloads() {
        let connection = test_connection();
        connection.execute(
            "INSERT INTO agent_mux_runs (id, caller, target, profile, skill, status, duration, started, summary) VALUES ('run-1', 'CodeM', 'Codex', 'OpenAI / sol', 'codem-agent-mux', 'running', '--', '刚刚', '')",
            [],
        ).expect("insert Agent Mux run");
        let payload = serde_json::json!({
            "type": "tool-start",
            "runId": "provider-run-1",
            "blockIndex": 0,
            "toolUseId": "tool-1",
            "name": "Read",
            "input": { "file_path": "README.md" }
        });
        connection.execute(
            "INSERT INTO agent_mux_run_events (run_id, event_type, message, payload_json) VALUES ('run-1', 'tool-start', '调用工具：Read', ?1)",
            [payload.to_string()],
        ).expect("insert structured Agent event");

        let events = read_run_events(&connection, "run-1").expect("read Agent Mux events");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].payload, Some(payload));
    }

    #[test]
    fn agent_mux_skill_source_accepts_skill_creator_frontmatter_only() {
        let content = "---\nname: codem-agent-mux\ndescription: 调用本机 Agent Mux\n---\n\n# CodeM Agent Mux\n";
        validate_skill_source_content(content).expect("accept valid Agent Mux Skill");

        let invalid = "---\nname: codem-agent-mux\ndescription: 调用本机 Agent Mux\nversion: 1\n---\n\n# CodeM Agent Mux\n";
        assert!(validate_skill_source_content(invalid).is_err());
    }

    #[test]
    fn agent_mux_skill_source_path_stays_inside_app_data() {
        let root = TestDirectory::new("source-path");
        let app_data = root.0.join("app-data");
        let service = AgentMuxService::new(app_data.clone());

        assert_eq!(
            agent_mux_skill_source_directory(&service),
            app_data.join("skills").join(AGENT_MUX_SKILL_NAME)
        );
    }

    #[test]
    fn agent_mux_skill_state_detects_installed_and_outdated_targets() {
        let root = TestDirectory::new("target-state");
        let service = AgentMuxService::new(root.0.join("app-data"));
        let source_file = agent_mux_skill_source_directory(&service).join("SKILL.md");
        let content = b"---\nname: codem-agent-mux\ndescription: test\n---\n";
        write_skill_source_if_changed(&source_file, content).expect("write source Skill");

        let home = root.0.join("home");
        let codex_file = home
            .join(".codex")
            .join("skills")
            .join(AGENT_MUX_SKILL_NAME)
            .join("SKILL.md");
        fs::create_dir_all(codex_file.parent().unwrap()).expect("create Codex Skill directory");
        fs::write(&codex_file, content).expect("write installed Codex Skill");
        let claude_file = home
            .join(".claude")
            .join("skills")
            .join(AGENT_MUX_SKILL_NAME)
            .join("SKILL.md");
        fs::create_dir_all(claude_file.parent().unwrap()).expect("create Claude Skill directory");
        fs::write(&claude_file, b"different").expect("write outdated Claude Skill");

        let state = read_skill_source_state_for_home(&service, &home).expect("read Skill state");
        let codex = state
            .targets
            .iter()
            .find(|target| target.provider_id == "openai-codex")
            .unwrap();
        let claude = state
            .targets
            .iter()
            .find(|target| target.provider_id == "claude-code")
            .unwrap();
        let grok = state
            .targets
            .iter()
            .find(|target| target.provider_id == "grok-build")
            .unwrap();
        assert_eq!(codex.state, "installed");
        assert_eq!(claude.state, "update-available");
        assert_eq!(grok.state, "not-installed");
    }
}
