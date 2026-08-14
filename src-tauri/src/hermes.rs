use axum::{
    extract::{Path as AxumPath, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use futures_util::{stream::SplitSink, stream::SplitStream, SinkExt, StreamExt};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    env, fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    net::TcpStream,
    process::{Child, Command},
    sync::Mutex as AsyncMutex,
};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

const DEFAULT_PROFILE: &str = "default";
const READY_TIMEOUT: Duration = Duration::from_secs(45);
const DASHBOARD_URL: &str = "http://127.0.0.1:9119";
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_HTTP_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_LOG_LINES: usize = 500;
const MAX_LOG_LINE_BYTES: usize = 4 * 1024;
const SETTINGS_FILE: &str = "hermes-agent.json";

type HermesCommandResolver = fn() -> Option<String>;
type HermesSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Clone)]
pub(crate) struct HermesService {
    inner: Arc<HermesServiceInner>,
}

struct HermesServiceInner {
    app_data_dir: PathBuf,
    command_resolver: HermesCommandResolver,
    command_cache: Mutex<Option<String>>,
    backends: AsyncMutex<HashMap<String, Arc<HermesBackend>>>,
}

struct HermesBackend {
    base_url: String,
    ws_url: String,
    token: String,
    child: AsyncMutex<Child>,
    logs: Arc<Mutex<VecDeque<String>>>,
    http: reqwest::Client,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HermesCodeMSettings {
    #[serde(default = "default_profile")]
    selected_profile: String,
}

#[derive(Debug)]
struct HermesApiError {
    status: StatusCode,
    message: String,
}

type HermesApiResult<T> = Result<T, HermesApiError>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectProfileRequest {
    profile: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HermesProxyBody {
    #[serde(flatten)]
    value: serde_json::Map<String, Value>,
}

#[derive(Debug, Default, Deserialize)]
struct SkillContentQuery {
    name: String,
}

#[derive(Debug, Default, Deserialize)]
struct LearningNodeQuery {
    id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HermesBackendSummary {
    pub profile: String,
    pub running: bool,
    pub base_url: String,
    pub log_lines: Vec<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct HermesSession {
    pub runtime_session_id: String,
    pub stored_session_id: String,
    pub resumed: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct HermesRuntimeEvent {
    pub event_type: String,
    pub session_id: Option<String>,
    pub payload: Value,
}

pub(crate) struct HermesClient {
    write: SplitSink<HermesSocket, Message>,
    read: SplitStream<HermesSocket>,
    pending_events: VecDeque<HermesRuntimeEvent>,
    next_id: u64,
    profile: String,
}

impl HermesService {
    pub(crate) fn new(app_data_dir: PathBuf, command_resolver: HermesCommandResolver) -> Self {
        Self {
            inner: Arc::new(HermesServiceInner {
                app_data_dir,
                command_resolver,
                command_cache: Mutex::new(None),
                backends: AsyncMutex::new(HashMap::new()),
            }),
        }
    }

    pub(crate) fn resolve_command(&self, refresh: bool) -> Option<String> {
        if !refresh {
            if let Ok(cache) = self.inner.command_cache.lock() {
                if cache.is_some() {
                    return cache.clone();
                }
            }
        }
        let command = (self.inner.command_resolver)();
        if let Ok(mut cache) = self.inner.command_cache.lock() {
            *cache = command.clone();
        }
        command
    }

    pub(crate) fn selected_profile(&self) -> String {
        read_settings(&self.settings_path()).selected_profile
    }

    pub(crate) fn select_profile(&self, profile: &str) -> Result<String, String> {
        let profile = normalize_profile(profile)?;
        let settings = HermesCodeMSettings {
            selected_profile: profile.clone(),
        };
        let path = self.settings_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("创建 Hermes 设置目录失败: {error}"))?;
        }
        let temporary = path.with_extension("json.tmp");
        let contents = serde_json::to_vec_pretty(&settings)
            .map_err(|error| format!("序列化 Hermes 设置失败: {error}"))?;
        fs::write(&temporary, contents)
            .map_err(|error| format!("写入 Hermes 设置失败: {error}"))?;
        fs::copy(&temporary, &path).map_err(|error| format!("保存 Hermes 设置失败: {error}"))?;
        fs::remove_file(&temporary)
            .map_err(|error| format!("清理 Hermes 临时设置失败: {error}"))?;
        Ok(profile)
    }

    pub(crate) async fn connect(
        &self,
        environment: &BTreeMap<String, String>,
        fingerprint: Option<&str>,
    ) -> Result<HermesClient, String> {
        let profile = self.selected_profile();
        let fingerprint = fingerprint.unwrap_or("system");
        let backend = self
            .ensure_backend(&profile, environment, fingerprint)
            .await?;
        HermesClient::connect(&backend.ws_url, &profile).await
    }

    pub(crate) async fn request_selected(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, String> {
        let profile = self.selected_profile();
        let backend = self
            .ensure_backend(&profile, &BTreeMap::new(), "system")
            .await?;
        backend.request(method, path, body).await
    }

    pub(crate) async fn backend_summary(&self) -> HermesBackendSummary {
        let profile = self.selected_profile();
        let key = backend_key(&profile, "system");
        let backend = {
            let backends = self.inner.backends.lock().await;
            backends.get(&key).cloned()
        };
        let Some(backend) = backend else {
            return HermesBackendSummary {
                profile,
                running: false,
                base_url: String::new(),
                log_lines: Vec::new(),
            };
        };
        let running = backend
            .child
            .lock()
            .await
            .try_wait()
            .ok()
            .flatten()
            .is_none();
        HermesBackendSummary {
            profile,
            running,
            base_url: backend.base_url.clone(),
            log_lines: backend.log_snapshot(),
        }
    }

    pub(crate) async fn restart_selected(&self) -> Result<(), String> {
        let profile = self.selected_profile();
        let key = backend_key(&profile, "system");
        let backend = self.inner.backends.lock().await.remove(&key);
        if let Some(backend) = backend {
            backend.shutdown().await;
        }
        self.ensure_backend(&profile, &BTreeMap::new(), "system")
            .await?;
        Ok(())
    }

    pub(crate) async fn open_dashboard(&self) -> Result<String, String> {
        let command = self
            .resolve_command(false)
            .ok_or_else(|| "未找到 Hermes CLI，请先安装 hermes 命令".to_string())?;
        let profile = self.selected_profile();
        let mut process = Command::new(command);
        process
            .args(["--profile", profile.as_str(), "dashboard", "--no-open"])
            .env("NO_COLOR", "1")
            .kill_on_drop(false);
        #[cfg(target_os = "windows")]
        process.creation_flags(0x08000000);
        process
            .spawn()
            .map_err(|error| format!("启动 Hermes Web UI 失败: {error}"))?;

        for _ in 0..100 {
            if TcpStream::connect("127.0.0.1:9119").await.is_ok() {
                return Ok(DASHBOARD_URL.to_string());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        Err("Hermes Web UI 启动超时".to_string())
    }

    pub(crate) async fn stop_selected(&self) -> bool {
        let profile = self.selected_profile();
        let key = backend_key(&profile, "system");
        let backend = self.inner.backends.lock().await.remove(&key);
        if let Some(backend) = backend {
            backend.shutdown().await;
            true
        } else {
            false
        }
    }

    async fn ensure_backend(
        &self,
        profile: &str,
        environment: &BTreeMap<String, String>,
        fingerprint: &str,
    ) -> Result<Arc<HermesBackend>, String> {
        let key = backend_key(profile, fingerprint);
        let mut backends = self.inner.backends.lock().await;
        if let Some(existing) = backends.get(&key).cloned() {
            let running = existing
                .child
                .lock()
                .await
                .try_wait()
                .ok()
                .flatten()
                .is_none();
            if running {
                return Ok(existing);
            }
            existing.shutdown().await;
            backends.remove(&key);
        }
        let command = self
            .resolve_command(false)
            .ok_or_else(|| "未找到 Hermes CLI，请先安装 hermes 命令".to_string())?;
        let backend = Arc::new(spawn_backend(&command, profile, environment).await?);
        backends.insert(key, backend.clone());
        Ok(backend)
    }

    fn settings_path(&self) -> PathBuf {
        self.inner.app_data_dir.join(SETTINGS_FILE)
    }
}

fn backend_key(profile: &str, fingerprint: &str) -> String {
    format!("{profile}\0{fingerprint}")
}

impl HermesApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: message.into(),
        }
    }
}

impl IntoResponse for HermesApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

pub(crate) fn router(service: HermesService) -> Router {
    Router::new()
        .route("/api/agents/hermes/bootstrap", get(hermes_bootstrap))
        .route("/api/agents/hermes/status", get(hermes_status))
        .route("/api/agents/hermes/logs", get(hermes_logs))
        .route("/api/agents/hermes/diagnostics/doctor", post(hermes_doctor))
        .route(
            "/api/agents/hermes/diagnostics/security-audit",
            post(hermes_security_audit),
        )
        .route(
            "/api/agents/hermes/runtime/start",
            post(hermes_runtime_start),
        )
        .route("/api/agents/hermes/runtime/stop", post(hermes_runtime_stop))
        .route(
            "/api/agents/hermes/runtime/restart",
            post(hermes_runtime_restart),
        )
        .route(
            "/api/agents/hermes/runtime/dashboard",
            post(hermes_runtime_dashboard),
        )
        .route("/api/agents/hermes/profiles", get(hermes_profiles))
        .route(
            "/api/agents/hermes/profiles/select",
            post(hermes_select_profile),
        )
        .route(
            "/api/agents/hermes/profiles/{name}/soul",
            get(hermes_profile_soul).put(hermes_update_profile_soul),
        )
        .route("/api/agents/hermes/memory", get(hermes_memory))
        .route("/api/agents/hermes/memory/reset", post(hermes_memory_reset))
        .route("/api/agents/hermes/learning", get(hermes_learning_graph))
        .route(
            "/api/agents/hermes/learning/node",
            get(hermes_learning_node)
                .put(hermes_learning_update)
                .delete(hermes_learning_delete),
        )
        .route("/api/agents/hermes/skills", get(hermes_skills))
        .route(
            "/api/agents/hermes/skills/toggle",
            put(hermes_skills_toggle),
        )
        .route(
            "/api/agents/hermes/skills/content",
            get(hermes_skill_content),
        )
        .route(
            "/api/agents/hermes/mcp/servers",
            get(hermes_mcp_servers)
                .post(hermes_mcp_create)
                .put(hermes_mcp_update),
        )
        .route(
            "/api/agents/hermes/mcp/servers/{name}",
            delete(hermes_mcp_delete),
        )
        .route(
            "/api/agents/hermes/mcp/servers/{name}/test",
            post(hermes_mcp_test),
        )
        .route(
            "/api/agents/hermes/mcp/servers/{name}/enabled",
            put(hermes_mcp_enabled),
        )
        .route(
            "/api/agents/hermes/gateway/start",
            post(hermes_gateway_start),
        )
        .route("/api/agents/hermes/gateway/stop", post(hermes_gateway_stop))
        .route(
            "/api/agents/hermes/gateway/restart",
            post(hermes_gateway_restart),
        )
        .route("/api/agents/hermes/gateway/logs", get(hermes_gateway_logs))
        .with_state(service)
}

async fn hermes_bootstrap(State(service): State<HermesService>) -> Json<Value> {
    let selected_profile = service.selected_profile();
    let command_available = service.resolve_command(false).is_some();
    let backend = service.backend_summary().await;
    if !command_available {
        return Json(json!({
            "selectedProfile": selected_profile,
            "commandAvailable": false,
            "backend": backend,
            "status": null,
            "profiles": [],
            "error": "未找到 Hermes CLI",
        }));
    }
    let status = service
        .request_selected(Method::GET, "/api/status", None)
        .await;
    let profiles = service
        .request_selected(Method::GET, "/api/profiles", None)
        .await;
    Json(json!({
        "selectedProfile": selected_profile,
        "commandAvailable": true,
        "backend": service.backend_summary().await,
        "status": status.as_ref().ok(),
        "profiles": profiles.as_ref().ok(),
        "error": status.err().or_else(|| profiles.err()),
    }))
}

async fn hermes_status(State(service): State<HermesService>) -> HermesApiResult<Json<Value>> {
    proxy(&service, Method::GET, "/api/status", None).await
}

async fn hermes_logs(State(service): State<HermesService>) -> HermesApiResult<Json<Value>> {
    let remote = service
        .request_selected(Method::GET, "/api/logs", None)
        .await;
    Ok(Json(json!({
        "backend": service.backend_summary().await,
        "hermes": remote.ok(),
    })))
}

async fn hermes_doctor(State(service): State<HermesService>) -> HermesApiResult<Json<Value>> {
    proxy(&service, Method::POST, "/api/ops/doctor", Some(json!({}))).await
}

async fn hermes_security_audit(
    State(service): State<HermesService>,
) -> HermesApiResult<Json<Value>> {
    proxy(
        &service,
        Method::POST,
        "/api/ops/security-audit",
        Some(json!({})),
    )
    .await
}

async fn hermes_runtime_start(
    State(service): State<HermesService>,
) -> HermesApiResult<Json<Value>> {
    let status = service
        .request_selected(Method::GET, "/api/status", None)
        .await
        .map_err(HermesApiError::unavailable)?;
    Ok(Json(json!({ "started": true, "status": status })))
}

async fn hermes_runtime_stop(State(service): State<HermesService>) -> Json<Value> {
    Json(json!({ "stopped": service.stop_selected().await }))
}

async fn hermes_runtime_restart(
    State(service): State<HermesService>,
) -> HermesApiResult<Json<Value>> {
    service
        .restart_selected()
        .await
        .map_err(HermesApiError::unavailable)?;
    Ok(Json(json!({ "restarted": true })))
}

async fn hermes_runtime_dashboard(
    State(service): State<HermesService>,
) -> HermesApiResult<Json<Value>> {
    let url = service
        .open_dashboard()
        .await
        .map_err(HermesApiError::unavailable)?;
    Ok(Json(json!({ "started": true, "url": url })))
}

async fn hermes_profiles(State(service): State<HermesService>) -> HermesApiResult<Json<Value>> {
    proxy(&service, Method::GET, "/api/profiles", None).await
}

async fn hermes_select_profile(
    State(service): State<HermesService>,
    Json(payload): Json<SelectProfileRequest>,
) -> HermesApiResult<Json<Value>> {
    let profile = service
        .select_profile(&payload.profile)
        .map_err(HermesApiError::bad_request)?;
    Ok(Json(json!({ "selectedProfile": profile })))
}

async fn hermes_profile_soul(
    State(service): State<HermesService>,
    AxumPath(name): AxumPath<String>,
) -> HermesApiResult<Json<Value>> {
    let name = selected_profile_path(&service, &name)?;
    proxy(
        &service,
        Method::GET,
        &format!("/api/profiles/{name}/soul"),
        None,
    )
    .await
}

async fn hermes_update_profile_soul(
    State(service): State<HermesService>,
    AxumPath(name): AxumPath<String>,
    Json(payload): Json<HermesProxyBody>,
) -> HermesApiResult<Json<Value>> {
    let name = selected_profile_path(&service, &name)?;
    proxy(
        &service,
        Method::PUT,
        &format!("/api/profiles/{name}/soul"),
        Some(Value::Object(payload.value)),
    )
    .await
}

async fn hermes_memory(State(service): State<HermesService>) -> HermesApiResult<Json<Value>> {
    proxy(&service, Method::GET, "/api/memory", None).await
}

async fn hermes_memory_reset(
    State(service): State<HermesService>,
    Json(payload): Json<HermesProxyBody>,
) -> HermesApiResult<Json<Value>> {
    proxy(
        &service,
        Method::POST,
        "/api/memory/reset",
        Some(Value::Object(payload.value)),
    )
    .await
}

async fn hermes_learning_graph(
    State(service): State<HermesService>,
) -> HermesApiResult<Json<Value>> {
    proxy(&service, Method::GET, "/api/learning/graph", None).await
}

async fn hermes_learning_node(
    State(service): State<HermesService>,
    Query(query): Query<LearningNodeQuery>,
) -> HermesApiResult<Json<Value>> {
    let id = bounded_learning_id(&query.id)?;
    let backend = service
        .ensure_backend(&service.selected_profile(), &BTreeMap::new(), "system")
        .await
        .map_err(HermesApiError::unavailable)?;
    let value = backend
        .request_with_query(Method::GET, "/api/learning/node", &[("id", id)], None)
        .await
        .map_err(HermesApiError::unavailable)?;
    Ok(Json(value))
}

async fn hermes_learning_update(
    State(service): State<HermesService>,
    Json(payload): Json<HermesProxyBody>,
) -> HermesApiResult<Json<Value>> {
    proxy(
        &service,
        Method::PUT,
        "/api/learning/node",
        Some(Value::Object(payload.value)),
    )
    .await
}

async fn hermes_learning_delete(
    State(service): State<HermesService>,
    Json(payload): Json<HermesProxyBody>,
) -> HermesApiResult<Json<Value>> {
    proxy(
        &service,
        Method::DELETE,
        "/api/learning/node",
        Some(Value::Object(payload.value)),
    )
    .await
}

async fn hermes_skills(State(service): State<HermesService>) -> HermesApiResult<Json<Value>> {
    proxy(&service, Method::GET, "/api/skills", None).await
}

async fn hermes_skills_toggle(
    State(service): State<HermesService>,
    Json(payload): Json<HermesProxyBody>,
) -> HermesApiResult<Json<Value>> {
    proxy(
        &service,
        Method::PUT,
        "/api/skills/toggle",
        Some(Value::Object(payload.value)),
    )
    .await
}

async fn hermes_skill_content(
    State(service): State<HermesService>,
    Query(query): Query<SkillContentQuery>,
) -> HermesApiResult<Json<Value>> {
    let name = bounded_name(&query.name, "Skill")?;
    let backend = service
        .ensure_backend(&service.selected_profile(), &BTreeMap::new(), "system")
        .await
        .map_err(HermesApiError::unavailable)?;
    let value = backend
        .request_with_query(Method::GET, "/api/skills/content", &[("name", name)], None)
        .await
        .map_err(HermesApiError::unavailable)?;
    Ok(Json(value))
}

async fn hermes_mcp_servers(State(service): State<HermesService>) -> HermesApiResult<Json<Value>> {
    proxy(&service, Method::GET, "/api/mcp/servers", None).await
}

async fn hermes_mcp_create(
    State(service): State<HermesService>,
    Json(payload): Json<HermesProxyBody>,
) -> HermesApiResult<Json<Value>> {
    proxy(
        &service,
        Method::POST,
        "/api/mcp/servers",
        Some(Value::Object(payload.value)),
    )
    .await
}

async fn hermes_mcp_update(
    State(service): State<HermesService>,
    Json(payload): Json<HermesProxyBody>,
) -> HermesApiResult<Json<Value>> {
    proxy(
        &service,
        Method::PUT,
        "/api/mcp/servers",
        Some(Value::Object(payload.value)),
    )
    .await
}

async fn hermes_mcp_delete(
    State(service): State<HermesService>,
    AxumPath(name): AxumPath<String>,
) -> HermesApiResult<Json<Value>> {
    let name = bounded_name(&name, "MCP")?;
    proxy(
        &service,
        Method::DELETE,
        &format!("/api/mcp/servers/{name}"),
        None,
    )
    .await
}

async fn hermes_mcp_test(
    State(service): State<HermesService>,
    AxumPath(name): AxumPath<String>,
) -> HermesApiResult<Json<Value>> {
    let name = bounded_name(&name, "MCP")?;
    proxy(
        &service,
        Method::POST,
        &format!("/api/mcp/servers/{name}/test"),
        Some(json!({})),
    )
    .await
}

async fn hermes_mcp_enabled(
    State(service): State<HermesService>,
    AxumPath(name): AxumPath<String>,
    Json(payload): Json<HermesProxyBody>,
) -> HermesApiResult<Json<Value>> {
    let name = bounded_name(&name, "MCP")?;
    proxy(
        &service,
        Method::PUT,
        &format!("/api/mcp/servers/{name}/enabled"),
        Some(Value::Object(payload.value)),
    )
    .await
}

async fn hermes_gateway_start(
    State(service): State<HermesService>,
) -> HermesApiResult<Json<Value>> {
    proxy(
        &service,
        Method::POST,
        "/api/gateway/start",
        Some(json!({})),
    )
    .await
}

async fn hermes_gateway_stop(State(service): State<HermesService>) -> HermesApiResult<Json<Value>> {
    proxy(&service, Method::POST, "/api/gateway/stop", Some(json!({}))).await
}

async fn hermes_gateway_restart(
    State(service): State<HermesService>,
) -> HermesApiResult<Json<Value>> {
    proxy(
        &service,
        Method::POST,
        "/api/gateway/restart",
        Some(json!({})),
    )
    .await
}

async fn hermes_gateway_logs(State(service): State<HermesService>) -> HermesApiResult<Json<Value>> {
    let profile = service.selected_profile();
    let backend = service
        .ensure_backend(&profile, &BTreeMap::new(), "system")
        .await
        .map_err(HermesApiError::unavailable)?;
    let value = backend
        .request_with_query(Method::GET, "/api/logs", &[("file", "gateway")], None)
        .await
        .map_err(HermesApiError::unavailable)?;
    Ok(Json(value))
}

async fn proxy(
    service: &HermesService,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> HermesApiResult<Json<Value>> {
    service
        .request_selected(method, path, body)
        .await
        .map(Json)
        .map_err(HermesApiError::unavailable)
}

fn selected_profile_path(service: &HermesService, name: &str) -> HermesApiResult<String> {
    let name = normalize_profile(name).map_err(HermesApiError::bad_request)?;
    if name != service.selected_profile() {
        return Err(HermesApiError::bad_request(
            "Hermes 档案写入必须明确指向当前选中的档案",
        ));
    }
    Ok(name)
}

fn bounded_name<'a>(name: &'a str, label: &str) -> HermesApiResult<&'a str> {
    let name = name.trim();
    if name.is_empty()
        || name.len() > 128
        || !name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(HermesApiError::bad_request(format!("{label} 名称格式无效")));
    }
    Ok(name)
}

fn bounded_learning_id(id: &str) -> HermesApiResult<&str> {
    if id.is_empty()
        || id.len() > 512
        || id.contains("..")
        || id.chars().any(|character| character.is_control())
    {
        return Err(HermesApiError::bad_request("Learning node id 格式无效"));
    }
    Ok(id)
}

impl HermesBackend {
    async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, String> {
        let path = normalize_api_path(path)?;
        self.request_inner(method, path, &[], body).await
    }

    async fn request_with_query(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, &str)],
        body: Option<Value>,
    ) -> Result<Value, String> {
        let path = normalize_api_path(path)?;
        self.request_inner(method, path, query, body).await
    }

    async fn request_inner(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, &str)],
        body: Option<Value>,
    ) -> Result<Value, String> {
        let mut target = url::Url::parse(&format!("{}{}", self.base_url, path))
            .map_err(|error| format!("构建 Hermes API URL 失败: {error}"))?;
        if !query.is_empty() {
            let mut pairs = target.query_pairs_mut();
            for (key, value) in query {
                pairs.append_pair(key, value);
            }
        }
        let mut request = self
            .http
            .request(method, target)
            .header("X-Hermes-Session-Token", &self.token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request
            .send()
            .await
            .map_err(|error| format!("Hermes API 请求失败: {error}"))?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("读取 Hermes API 响应失败: {error}"))?;
        if bytes.len() > MAX_HTTP_BODY_BYTES {
            return Err("Hermes API 响应超过 2 MiB 限制".to_string());
        }
        let value = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes)
                .map_err(|error| format!("Hermes API 返回了无效 JSON: {error}"))?
        };
        if !status.is_success() {
            return Err(format!(
                "Hermes API 返回 {}: {}",
                status.as_u16(),
                public_json(&value)
            ));
        }
        Ok(value)
    }

    async fn shutdown(&self) {
        let mut child = self.child.lock().await;
        let _ = child.kill().await;
        let _ = child.wait().await;
    }

    fn log_snapshot(&self) -> Vec<String> {
        self.logs
            .lock()
            .map(|logs| logs.iter().cloned().collect())
            .unwrap_or_default()
    }
}

impl HermesClient {
    async fn connect(ws_url: &str, profile: &str) -> Result<Self, String> {
        let (socket, _) = connect_async(ws_url)
            .await
            .map_err(|error| format!("连接 Hermes WebSocket 失败: {error}"))?;
        let (write, read) = socket.split();
        Ok(Self {
            write,
            read,
            pending_events: VecDeque::new(),
            next_id: 0,
            profile: profile.to_string(),
        })
    }

    pub(crate) async fn create_or_resume_session(
        &mut self,
        requested_session_id: Option<&str>,
        cwd: &Path,
        model: Option<&str>,
        reasoning_effort: Option<&str>,
        provider: Option<&str>,
    ) -> Result<HermesSession, String> {
        let (method, mut params) = if let Some(session_id) = requested_session_id {
            (
                "session.resume",
                json!({
                    "session_id": session_id,
                    "omit_messages": true,
                    "profile": self.profile,
                }),
            )
        } else {
            (
                "session.create",
                json!({
                    "cwd": cwd.to_string_lossy(),
                    "profile": self.profile,
                    "source": "codem",
                    "close_on_disconnect": false,
                }),
            )
        };
        if let Some(model) = model.filter(|value| !value.trim().is_empty()) {
            params["model"] = json!(model);
        }
        if requested_session_id.is_none() {
            if let Some(provider) = provider.filter(|value| !value.trim().is_empty()) {
                params["provider"] = json!(provider);
            }
        }
        if let Some(effort) = reasoning_effort.filter(|value| !value.trim().is_empty()) {
            params["reasoning_effort"] = json!(effort);
        }
        let result = self.rpc(method, params).await?;
        let runtime_session_id = required_string(&result, "session_id")?;
        let stored_session_id = result
            .get("stored_session_id")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .or(requested_session_id)
            .unwrap_or(&runtime_session_id)
            .to_string();
        Ok(HermesSession {
            runtime_session_id,
            stored_session_id,
            resumed: requested_session_id.is_some(),
        })
    }

    pub(crate) async fn submit_prompt(
        &mut self,
        session_id: &str,
        text: &str,
    ) -> Result<(), String> {
        self.rpc(
            "prompt.submit",
            json!({ "session_id": session_id, "text": text }),
        )
        .await
        .map(|_| ())
    }

    pub(crate) async fn set_model(
        &mut self,
        session_id: &str,
        model: &str,
        provider: Option<&str>,
    ) -> Result<(), String> {
        let model = model.trim();
        if model.is_empty() {
            return Ok(());
        }
        let value = hermes_model_config_value(model, provider);
        self.rpc(
            "config.set",
            json!({ "session_id": session_id, "key": "model", "value": value }),
        )
        .await
        .map(|_| ())
    }

    pub(crate) async fn next_event(&mut self) -> Result<HermesRuntimeEvent, String> {
        if let Some(event) = self.pending_events.pop_front() {
            return Ok(event);
        }
        loop {
            let frame = self
                .read
                .next()
                .await
                .ok_or_else(|| "Hermes WebSocket 已关闭".to_string())?
                .map_err(|error| format!("读取 Hermes WebSocket 失败: {error}"))?;
            if let Some(event) = parse_event_frame(frame)? {
                return Ok(event);
            }
        }
    }

    pub(crate) async fn interrupt(&mut self, session_id: &str) -> Result<(), String> {
        self.send_request("session.interrupt", json!({ "session_id": session_id }))
            .await
            .map(|_| ())
    }

    pub(crate) async fn guide(&mut self, session_id: &str, text: &str) -> Result<(), String> {
        self.send_request(
            "prompt.submit",
            json!({ "session_id": session_id, "text": text, "queued": false }),
        )
        .await
        .map(|_| ())
    }

    pub(crate) async fn approval(&mut self, session_id: &str, choice: &str) -> Result<(), String> {
        self.send_request(
            "approval.respond",
            json!({ "session_id": session_id, "choice": choice }),
        )
        .await
        .map(|_| ())
    }

    pub(crate) async fn clarify(
        &mut self,
        session_id: &str,
        request_id: &str,
        answer: Value,
    ) -> Result<(), String> {
        self.send_request(
            "clarify.respond",
            json!({ "session_id": session_id, "request_id": request_id, "answer": answer }),
        )
        .await
        .map(|_| ())
    }

    pub(crate) async fn close(mut self) {
        let _ = self.write.send(Message::Close(None)).await;
    }

    async fn rpc(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.send_request(method, params).await?;
        loop {
            let frame = self
                .read
                .next()
                .await
                .ok_or_else(|| "Hermes WebSocket 已关闭".to_string())?
                .map_err(|error| format!("读取 Hermes WebSocket 失败: {error}"))?;
            let Some(value) = parse_json_frame(frame)? else {
                continue;
            };
            if value.get("id").and_then(Value::as_u64) == Some(id) {
                if let Some(error) = value.get("error") {
                    return Err(format!("Hermes RPC {method} 失败: {}", public_json(error)));
                }
                return Ok(value.get("result").cloned().unwrap_or(Value::Null));
            }
            if let Some(event) = event_from_value(&value) {
                self.pending_events.push_back(event);
            }
        }
    }

    async fn send_request(&mut self, method: &str, params: Value) -> Result<u64, String> {
        self.next_id = self.next_id.saturating_add(1);
        let id = self.next_id;
        let payload = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        self.write
            .send(Message::Text(payload.to_string().into()))
            .await
            .map_err(|error| format!("发送 Hermes RPC 失败: {error}"))?;
        Ok(id)
    }
}

fn hermes_model_config_value(model: &str, provider: Option<&str>) -> String {
    provider
        .map(str::trim)
        .filter(|provider| !provider.is_empty())
        .map_or_else(
            || model.trim().to_string(),
            |provider| format!("{} --provider {provider}", model.trim()),
        )
}

async fn spawn_backend(
    command: &str,
    profile: &str,
    environment: &BTreeMap<String, String>,
) -> Result<HermesBackend, String> {
    let token = uuid::Uuid::new_v4().to_string();
    let ready_file = env::temp_dir().join(format!(
        "codem-hermes-ready-{}-{}.json",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    let _ = fs::remove_file(&ready_file);
    let logs = Arc::new(Mutex::new(VecDeque::new()));
    let mut process = Command::new(command);
    process
        .args(backend_arguments(profile))
        .envs(environment)
        .env("HERMES_DASHBOARD_SESSION_TOKEN", &token)
        .env("HERMES_DESKTOP_READY_FILE", &ready_file)
        .env("NO_COLOR", "1")
        .kill_on_drop(true)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(target_os = "windows")]
    process.creation_flags(0x08000000);
    let mut child = process
        .spawn()
        .map_err(|error| format!("启动 Hermes serve 失败: {error}"))?;
    if let Some(stdout) = child.stdout.take() {
        spawn_log_reader(stdout, logs.clone(), "stdout");
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_log_reader(stderr, logs.clone(), "stderr");
    }
    let port = wait_for_ready_file(&ready_file, &mut child).await;
    let _ = fs::remove_file(&ready_file);
    let port = match port {
        Ok(port) => port,
        Err(error) => {
            let _ = child.kill().await;
            let detail = log_tail(&logs, 20);
            return Err(if detail.is_empty() {
                error
            } else {
                format!("{error}\n{detail}")
            });
        }
    };
    let base_url = format!("http://127.0.0.1:{port}");
    let ws_url = format!("ws://127.0.0.1:{port}/api/ws?token={token}");
    let http = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .no_proxy()
        .build()
        .map_err(|error| format!("创建 Hermes HTTP 客户端失败: {error}"))?;
    let backend = HermesBackend {
        base_url,
        ws_url,
        token,
        child: AsyncMutex::new(child),
        logs,
        http,
    };
    backend.request(Method::GET, "/api/status", None).await?;
    Ok(backend)
}

fn backend_arguments(profile: &str) -> [&str; 8] {
    [
        "--profile",
        profile,
        "serve",
        "--isolated",
        "--host",
        "127.0.0.1",
        "--port",
        "0",
    ]
}

async fn wait_for_ready_file(path: &Path, child: &mut Child) -> Result<u16, String> {
    let deadline = tokio::time::Instant::now() + READY_TIMEOUT;
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("检查 Hermes serve 状态失败: {error}"))?
        {
            return Err(format!("Hermes serve 在就绪前退出: {status}"));
        }
        if let Ok(bytes) = fs::read(path) {
            if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                if let Some(port) = value
                    .get("port")
                    .and_then(Value::as_u64)
                    .and_then(|port| u16::try_from(port).ok())
                    .filter(|port| *port > 0)
                {
                    return Ok(port);
                }
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("等待 Hermes serve 就绪超时".to_string());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

fn spawn_log_reader<R>(reader: R, logs: Arc<Mutex<VecDeque<String>>>, source: &'static str)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            push_log(&logs, source, &line);
        }
    });
}

fn push_log(logs: &Mutex<VecDeque<String>>, source: &str, line: &str) {
    let mut line = line.trim().to_string();
    if line.len() > MAX_LOG_LINE_BYTES {
        line.truncate(MAX_LOG_LINE_BYTES);
        line.push_str(" [truncated]");
    }
    line = redact_log_line(&line);
    if let Ok(mut logs) = logs.lock() {
        logs.push_back(format!("[{source}] {line}"));
        while logs.len() > MAX_LOG_LINES {
            logs.pop_front();
        }
    }
}

fn redact_log_line(line: &str) -> String {
    let mut result = line.to_string();
    for marker in ["sk-", "Bearer ", "api_key=", "apiKey=", "token="] {
        let mut offset = 0;
        while let Some(index) = result[offset..].find(marker) {
            let start = offset + index + marker.len();
            let end = result[start..]
                .find(|character: char| {
                    character.is_whitespace() || matches!(character, '&' | ',' | '"' | '\'')
                })
                .map(|length| start + length)
                .unwrap_or(result.len());
            if end > start {
                result.replace_range(start..end, "***");
            }
            offset = start.saturating_add(3);
            if offset >= result.len() {
                break;
            }
        }
    }
    result
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

fn parse_json_frame(frame: Message) -> Result<Option<Value>, String> {
    match frame {
        Message::Text(text) => serde_json::from_str(&text)
            .map(Some)
            .map_err(|error| format!("Hermes WebSocket 返回无效 JSON: {error}")),
        Message::Binary(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|error| format!("Hermes WebSocket 返回无效 JSON: {error}")),
        Message::Close(_) => Err("Hermes WebSocket 已关闭".to_string()),
        Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => Ok(None),
    }
}

fn parse_event_frame(frame: Message) -> Result<Option<HermesRuntimeEvent>, String> {
    Ok(parse_json_frame(frame)?.and_then(|value| event_from_value(&value)))
}

fn event_from_value(value: &Value) -> Option<HermesRuntimeEvent> {
    if value.get("method").and_then(Value::as_str) != Some("event") {
        return None;
    }
    let params = value.get("params")?;
    Some(HermesRuntimeEvent {
        event_type: params.get("type")?.as_str()?.to_string(),
        session_id: params
            .get("session_id")
            .and_then(Value::as_str)
            .map(str::to_string),
        payload: params.get("payload").cloned().unwrap_or(Value::Null),
    })
}

fn required_string(value: &Value, field: &str) -> Result<String, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("Hermes RPC 响应缺少 {field}"))
}

fn normalize_profile(profile: &str) -> Result<String, String> {
    let profile = profile.trim();
    if profile.is_empty() || profile.len() > 128 {
        return Err("Hermes 档案名称不能为空且不能超过 128 字节".to_string());
    }
    if !profile
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("Hermes 档案名称仅支持字母、数字、连字符和下划线".to_string());
    }
    Ok(profile.to_string())
}

fn normalize_api_path(path: &str) -> Result<&str, String> {
    if path.starts_with("/api/") && !path.contains("..") && !path.contains('?') && path.len() <= 512
    {
        Ok(path)
    } else {
        Err("无效的 Hermes API 路径".to_string())
    }
}

fn read_settings(path: &Path) -> HermesCodeMSettings {
    let settings = fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_else(|| HermesCodeMSettings {
            selected_profile: default_profile(),
        });
    normalize_settings(settings)
}

fn normalize_settings(mut settings: HermesCodeMSettings) -> HermesCodeMSettings {
    settings.selected_profile = normalize_profile(&settings.selected_profile)
        .unwrap_or_else(|_| DEFAULT_PROFILE.to_string());
    settings
}

fn default_profile() -> String {
    DEFAULT_PROFILE.to_string()
}

fn public_json(value: &Value) -> String {
    let mut text = value.to_string();
    if text.len() > 4096 {
        text.truncate(4096);
        text.push_str(" [truncated]");
    }
    redact_log_line(&text)
}

#[cfg(test)]
mod tests {
    use super::{
        backend_arguments, backend_key, bounded_learning_id, hermes_learning_node,
        hermes_model_config_value, normalize_api_path, normalize_profile, redact_log_line,
        HermesService, LearningNodeQuery,
    };
    use axum::extract::{Query, State};
    use axum::http::StatusCode;
    use std::fs;

    #[test]
    fn profile_names_are_bounded_and_path_safe() {
        assert_eq!(normalize_profile("work_1").unwrap(), "work_1");
        assert!(normalize_profile("../work").is_err());
        assert!(normalize_profile("").is_err());
    }

    #[test]
    fn api_proxy_only_accepts_bounded_api_paths() {
        assert_eq!(normalize_api_path("/api/status").unwrap(), "/api/status");
        assert!(normalize_api_path("/login").is_err());
        assert!(normalize_api_path("/api/../secret").is_err());
    }

    #[test]
    fn learning_node_ids_allow_memory_refs_without_path_traversal() {
        assert_eq!(
            bounded_learning_id("memory:profile:2").unwrap(),
            "memory:profile:2"
        );
        assert_eq!(bounded_learning_id("my-skill").unwrap(), "my-skill");
        assert!(bounded_learning_id("../secret").is_err());
    }

    #[tokio::test]
    async fn learning_node_get_rejects_traversal_before_starting_backend() {
        let root =
            std::env::temp_dir().join(format!("codem-hermes-learning-node-{}", std::process::id()));
        let service = HermesService::new(root, || None);
        let error = hermes_learning_node(
            State(service),
            Query(LearningNodeQuery {
                id: "../secret".to_string(),
            }),
        )
        .await
        .unwrap_err();

        assert_eq!(error.status, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn logs_redact_common_secret_shapes() {
        let redacted = redact_log_line("Authorization: Bearer abc123 token=xyz sk-secret");
        assert!(!redacted.contains("abc123"));
        assert!(!redacted.contains("xyz"));
        assert!(!redacted.contains("secret"));
    }

    #[test]
    fn backend_instances_are_isolated_by_profile_and_fingerprint() {
        assert_ne!(
            backend_key("default", "system"),
            backend_key("default", "channel-a")
        );
        assert_ne!(
            backend_key("default", "channel-a"),
            backend_key("default", "channel-b")
        );
        assert_ne!(
            backend_key("default", "channel-a"),
            backend_key("work", "channel-a")
        );
        assert_eq!(
            backend_key("default", "channel-a"),
            backend_key("default", "channel-a")
        );
    }

    #[test]
    fn backend_process_uses_the_official_isolated_profile_mode() {
        assert_eq!(
            backend_arguments("work"),
            [
                "--profile",
                "work",
                "serve",
                "--isolated",
                "--host",
                "127.0.0.1",
                "--port",
                "0",
            ]
        );
    }

    #[test]
    fn model_config_value_keeps_custom_provider_identity() {
        assert_eq!(
            hermes_model_config_value("deepseek-v4-flash", Some("custom:codem_123")),
            "deepseek-v4-flash --provider custom:codem_123"
        );
        assert_eq!(hermes_model_config_value("MiniMax-M3", None), "MiniMax-M3");
    }

    #[test]
    fn selecting_profiles_replaces_existing_settings() {
        let root =
            std::env::temp_dir().join(format!("codem-hermes-settings-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let service = HermesService::new(root.clone(), || None);
        assert_eq!(service.select_profile("work").unwrap(), "work");
        assert_eq!(service.selected_profile(), "work");
        assert_eq!(service.select_profile("default").unwrap(), "default");
        assert_eq!(service.selected_profile(), "default");
        let _ = fs::remove_dir_all(root);
    }
}
