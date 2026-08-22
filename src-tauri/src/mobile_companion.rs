use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Redirect, Response},
    routing::{delete, get, patch, post},
    Json, Router,
};
use base64::{engine::general_purpose, Engine as _};
use if_addrs::get_if_addrs;
use password_hash::SaltString;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    collections::HashMap,
    fs,
    io::Write,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::{sync::watch, task::JoinHandle};
use tower_http::services::{ServeDir, ServeFile};
use uuid::Uuid;

const MOBILE_USERNAME: &str = "codem";
// The mobile shell owns an intentional embedded browser tab. Keep the shell's
// resources same-origin, but allow the iframe to navigate to user-supplied
// HTTP(S) pages; without `frame-src`, `default-src 'self'` silently blanks it.
const MOBILE_CONTENT_SECURITY_POLICY: &str = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self' http: https:; frame-ancestors 'none'; base-uri 'none'";
const MOBILE_MAX_REQUEST_BYTES: usize = 16 * 1024 * 1024;
const MOBILE_MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;
const DEVICE_COOKIE: &str = "codem_mobile_device";
const FIREWALL_RULE_NAME: &str = "CodeM Mobile Companion";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MOBILE_STOP_HEADERS: [(&str, &str); 1] = [("x-codem-mobile-stop", "1")];

#[derive(Clone)]
pub struct MobileCompanionService {
    inner: Arc<Inner>,
}

struct Inner {
    app_data_dir: PathBuf,
    desktop_origin: String,
    desktop_token: Option<String>,
    state: Mutex<PersistedState>,
    listener: Mutex<Option<JoinHandle<()>>>,
    runtime_watcher: Mutex<Option<JoinHandle<()>>>,
    live_runs: Mutex<HashMap<String, MobileLiveRun>>,
    live_run_revision: watch::Sender<u64>,
    runtime_signature: watch::Sender<Option<String>>,
}

#[derive(Clone, Debug)]
struct MobileLiveRun {
    run_id: String,
    upstream_run_id: String,
    provider: String,
    prompt: String,
    user_content_blocks: Vec<Value>,
    started_at_ms: i64,
    events: Vec<Value>,
    finished: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedState {
    enabled: bool,
    port: u16,
    password_hash: Option<String>,
    devices: Vec<PairedDevice>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairedDevice {
    id: String,
    name: String,
    token_hash: String,
    permissions: Vec<String>,
    created_at_ms: i64,
    last_seen_at_ms: i64,
    revoked_at_ms: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileAccessAddress {
    address: String,
    kind: &'static str,
}

#[derive(Clone)]
struct GatewayState {
    service: MobileCompanionService,
    client: reqwest::Client,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginRequest {
    username: String,
    password: String,
    device_name: Option<String>,
}

#[derive(Deserialize)]
struct PasswordRequest {
    password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnableRequest {
    enabled: bool,
    port: Option<u16>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermissionRequest {
    permissions: Vec<String>,
}

#[derive(Deserialize)]
struct HistoryQuery {
    before: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveEventQuery {
    after: Option<usize>,
    run_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelQuery {
    channel_id: Option<String>,
}

impl MobileCompanionService {
    pub fn new(app_data_dir: PathBuf, desktop_port: u16, desktop_token: Option<String>) -> Self {
        let path = app_data_dir.join("mobile-companion.json");
        let mut state: PersistedState = fs::read_to_string(path)
            .ok()
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_default();
        if state.port == 0 {
            state.port = 3210;
        }
        if std::env::var("CODEM_MOBILE_ENABLED").ok().as_deref() == Some("1") {
            state.enabled = true;
        }
        if let Ok(port) = std::env::var("CODEM_MOBILE_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .ok_or(())
        {
            state.port = port;
        }
        let (live_run_revision, _) = watch::channel(0);
        let (runtime_signature, _) = watch::channel(None);
        Self {
            inner: Arc::new(Inner {
                app_data_dir,
                desktop_origin: format!("http://127.0.0.1:{desktop_port}"),
                desktop_token,
                state: Mutex::new(state),
                listener: Mutex::new(None),
                runtime_watcher: Mutex::new(None),
                live_runs: Mutex::new(HashMap::new()),
                live_run_revision,
                runtime_signature,
            }),
        }
    }

    pub fn admin_router(&self) -> Router {
        Router::new()
            .route("/api/mobile-companion/status", get(admin_status))
            .route("/api/mobile-companion/enable", post(admin_enable))
            .route("/api/mobile-companion/password", post(admin_password))
            .route(
                "/api/mobile-companion/devices/{device_id}",
                delete(admin_revoke).patch(admin_permissions),
            )
            .with_state(self.clone())
    }

    pub async fn start_if_enabled(&self) {
        if self.inner.state.lock().map(|s| s.enabled).unwrap_or(false) {
            let port = self.inner.state.lock().map(|s| s.port).unwrap_or(3210);
            let _ = configure_firewall(port, true);
            self.start_listener();
        }
    }

    fn start_listener(&self) {
        let mut handle = match self.inner.listener.lock() {
            Ok(v) => v,
            Err(_) => return,
        };
        if handle.as_ref().is_some_and(|h| !h.is_finished()) {
            return;
        }
        let service = self.clone();
        *handle = Some(tokio::spawn(async move {
            let port = service.inner.state.lock().map(|s| s.port).unwrap_or(3210);
            let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port);
            let static_dir = resolve_static_dir();
            let fallback = ServeFile::new(static_dir.join("index.html"));
            let app = gateway_router(service.clone())
                .nest_service("/assets", ServeDir::new(static_dir.join("assets")))
                .fallback_service(ServeDir::new(static_dir).fallback(fallback))
                .layer(middleware::from_fn(mobile_security_boundary));
            let listener = match tokio::net::TcpListener::bind(address).await {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("CodeM mobile listener failed: {error}");
                    return;
                }
            };
            println!("CodeM mobile companion listening on http://{address}");
            if let Err(error) = axum::serve(listener, app.into_make_service()).await {
                eprintln!("CodeM mobile listener stopped: {error}");
            }
        }));
    }

    fn stop_listener(&self) {
        if let Ok(mut handle) = self.inner.listener.lock() {
            if let Some(task) = handle.take() {
                task.abort();
            }
        }
        if let Ok(mut handle) = self.inner.runtime_watcher.lock() {
            if let Some(task) = handle.take() {
                task.abort();
            }
        }
    }

    fn signal_live_run_change(&self) {
        self.inner
            .live_run_revision
            .send_modify(|revision| *revision = revision.wrapping_add(1));
    }

    fn ensure_runtime_watcher(&self) {
        let mut handle = match self.inner.runtime_watcher.lock() {
            Ok(value) => value,
            Err(_) => return,
        };
        if handle.as_ref().is_some_and(|task| !task.is_finished()) {
            return;
        }
        let service = self.clone();
        *handle = Some(tokio::spawn(async move {
            let state = GatewayState {
                service: service.clone(),
                client: reqwest::Client::new(),
            };
            loop {
                if service.inner.runtime_signature.receiver_count() == 0 {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    if service.inner.runtime_signature.receiver_count() == 0 {
                        break;
                    }
                    continue;
                }
                if let Some(signature) = mobile_runtime_signature(&state).await {
                    if service.inner.runtime_signature.borrow().as_ref() != Some(&signature) {
                        service
                            .inner
                            .runtime_signature
                            .send_replace(Some(signature));
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        }));
    }

    fn save(&self) -> Result<(), String> {
        let path = self.inner.app_data_dir.join("mobile-companion.json");
        let body = self
            .inner
            .state
            .lock()
            .map_err(|_| "移动伴侣配置状态不可用".to_string())
            .and_then(|state| {
                serde_json::to_vec_pretty(&*state)
                    .map_err(|error| format!("序列化移动伴侣配置失败: {error}"))
            })?;
        write_mobile_companion_state(&path, &body)
    }
}

fn gateway_router(service: MobileCompanionService) -> Router {
    let state = GatewayState {
        service,
        client: reqwest::Client::new(),
    };
    Router::new()
        .route(
            "/",
            get(|| async { Redirect::temporary("/mobile/connect") }),
        )
        .route("/api/mobile/auth/status", get(auth_status))
        .route("/api/mobile/auth/login", post(auth_login))
        .route(
            "/api/mobile/attachments/{preview_id}",
            get(mobile_attachment_preview),
        )
        .route(
            "/api/mobile/attachments",
            get(|| async { error(StatusCode::NOT_FOUND, "图片预览不存在") }),
        )
        .route(
            "/api/mobile/attachments/",
            get(|| async { error(StatusCode::NOT_FOUND, "图片预览不存在") }),
        )
        .route("/api/mobile/bootstrap", get(mobile_bootstrap))
        .route(
            "/api/mobile/providers/{provider_id}/models",
            get(mobile_provider_models),
        )
        .route("/api/mobile/tasks/{thread_id}", get(mobile_thread))
        .route(
            "/api/mobile/tasks/{thread_id}/settings",
            patch(mobile_update_settings),
        )
        .route(
            "/api/mobile/tasks/{thread_id}/events",
            get(mobile_thread_events),
        )
        .route("/api/mobile/tasks", post(mobile_create_task))
        .route("/api/mobile/tasks/{thread_id}/send", post(mobile_send))
        .route("/api/mobile/tasks/{thread_id}/stop", post(mobile_stop))
        .route(
            "/api/mobile/tasks/{thread_id}/approval",
            post(mobile_approval),
        )
        .route(
            "/api/mobile/tasks/{thread_id}/user-input",
            post(mobile_user_input),
        )
        .route("/api/mobile/events", get(mobile_events))
        .layer(DefaultBodyLimit::max(MOBILE_MAX_REQUEST_BYTES))
        .with_state(state)
}

async fn mobile_security_boundary(request: Request<Body>, next: Next) -> Response {
    let request_path = request.uri().path().to_string();
    let headers = request.headers();
    let request_host = mobile_request_host(&request).unwrap_or_default();
    let response_origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| HeaderValue::from_str(value).ok());
    if let Some(origin) = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
    {
        if !is_allowed_mobile_origin(origin, request_host) {
            return error(StatusCode::FORBIDDEN, "请求来源不受信任");
        }
    }
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(MOBILE_CONTENT_SECURITY_POLICY),
    );
    if !request_path.starts_with("/api/") {
        if let Some(origin) = response_origin {
            headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
            headers.insert(
                header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
                HeaderValue::from_static("true"),
            );
            headers.insert(header::VARY, HeaderValue::from_static("Origin"));
        }
    }
    if request_path == "/"
        || request_path == "/mobile"
        || request_path.starts_with("/mobile/")
        || request_path == "/mobile-sw.js"
    {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    } else if request_path.starts_with("/assets/") {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    }
    response
}

fn mobile_request_host(request: &Request<Body>) -> Option<&str> {
    request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .or_else(|| {
            request
                .uri()
                .authority()
                .map(|authority| authority.as_str())
        })
}

fn is_allowed_mobile_origin(origin: &str, host: &str) -> bool {
    url::Url::parse(origin).ok().is_some_and(|url| {
        url.scheme() == "http"
            && format!(
                "{}:{}",
                url.host_str().unwrap_or_default(),
                url.port_or_known_default().unwrap_or_default()
            ) == host
    })
}

async fn admin_status(State(service): State<MobileCompanionService>) -> Json<Value> {
    let state = service.inner.state.lock().unwrap().clone();
    let addresses = mobile_addresses(state.port);
    let address = addresses.first().map(|entry| entry.address.clone());
    Json(
        json!({ "enabled": state.enabled, "port": state.port, "address": address, "addresses": addresses, "transport": "local-http", "tailnetAvailable": tailscale_ip().is_some(), "passwordConfigured": state.password_hash.is_some(), "username": MOBILE_USERNAME, "firewall": firewall_state(state.port), "devices": state.devices.into_iter().map(public_device).collect::<Vec<_>>() }),
    )
}

async fn admin_enable(
    State(service): State<MobileCompanionService>,
    Json(request): Json<EnableRequest>,
) -> Json<Value> {
    let previous_port = service.inner.state.lock().map(|s| s.port).unwrap_or(3210);
    {
        let mut state = service.inner.state.lock().unwrap();
        state.enabled = request.enabled;
        if let Some(port) = request.port {
            state.port = port.max(1024);
        }
    }
    let _ = service.save();
    if request.enabled {
        if previous_port != request.port.unwrap_or(previous_port) {
            let _ = configure_firewall(previous_port, false);
            service.stop_listener();
        }
        let port = service.inner.state.lock().map(|s| s.port).unwrap_or(3210);
        let _ = configure_firewall(port, true);
        service.start_listener();
    } else {
        let _ = configure_firewall(previous_port, false);
        service.stop_listener();
    }
    admin_status(State(service)).await
}

async fn admin_password(
    State(service): State<MobileCompanionService>,
    Json(request): Json<PasswordRequest>,
) -> Response {
    let password = request.password.trim();
    if password.chars().count() < 8 {
        return error(StatusCode::BAD_REQUEST, "密码至少需要 8 个字符");
    }
    let password_hash = match hash_password(password) {
        Ok(value) => value,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "密码保存失败"),
    };
    let previous = if let Ok(mut state) = service.inner.state.lock() {
        let previous = state.clone();
        state.password_hash = Some(password_hash);
        state.devices.clear();
        previous
    } else {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "密码保存失败");
    };
    if let Err(save_error) = service.save() {
        if let Ok(mut state) = service.inner.state.lock() {
            *state = previous;
        }
        eprintln!("CodeM mobile companion password persistence failed: {save_error}");
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "密码保存失败，请检查应用数据目录权限",
        );
    }
    admin_status(State(service)).await.into_response()
}

async fn admin_revoke(
    State(service): State<MobileCompanionService>,
    Path(device_id): Path<String>,
) -> Json<Value> {
    if let Ok(mut state) = service.inner.state.lock() {
        if let Some(device) = state.devices.iter_mut().find(|d| d.id == device_id) {
            device.revoked_at_ms = Some(now_ms());
        }
    }
    let _ = service.save();
    Json(json!({ "ok": true }))
}

async fn admin_permissions(
    State(service): State<MobileCompanionService>,
    Path(device_id): Path<String>,
    Json(request): Json<PermissionRequest>,
) -> Json<Value> {
    let allowed = ["view", "send", "stop", "approve"];
    if let Ok(mut state) = service.inner.state.lock() {
        if let Some(device) = state.devices.iter_mut().find(|d| d.id == device_id) {
            device.permissions = request
                .permissions
                .into_iter()
                .filter(|p| allowed.contains(&p.as_str()))
                .collect();
        }
    }
    let _ = service.save();
    Json(json!({ "ok": true }))
}

async fn auth_status(State(state): State<GatewayState>, headers: HeaderMap) -> Json<Value> {
    let device = authenticate(&state.service, &headers, "view").ok();
    let config = state.service.inner.state.lock().unwrap();
    let addresses = mobile_addresses(config.port);
    let address = addresses.first().map(|entry| entry.address.clone());
    Json(
        json!({ "enabled": config.enabled, "authenticated": device.is_some(), "computerName": computer_name(), "address": address, "addresses": addresses, "transport": "local-http", "passwordConfigured": config.password_hash.is_some(), "username": MOBILE_USERNAME }),
    )
}

async fn auth_login(
    State(state): State<GatewayState>,
    Json(request): Json<LoginRequest>,
) -> Response {
    if request.username.trim() != MOBILE_USERNAME {
        return error(StatusCode::UNAUTHORIZED, "账号或密码错误");
    }
    let mut config = state.service.inner.state.lock().unwrap();
    let password_valid = config
        .password_hash
        .as_deref()
        .is_some_and(|stored| verify_password(stored, request.password.trim()));
    if !password_valid {
        return error(StatusCode::UNAUTHORIZED, "账号或密码错误");
    }
    let previous = config.clone();
    let now = now_ms();
    let token = Uuid::new_v4().to_string() + &Uuid::new_v4().simple().to_string();
    config.devices.push(PairedDevice {
        id: Uuid::new_v4().to_string(),
        name: request.device_name.unwrap_or_else(|| "移动设备".into()),
        token_hash: hash(&token),
        permissions: vec![
            "view".into(),
            "send".into(),
            "stop".into(),
            "approve".into(),
        ],
        created_at_ms: now,
        last_seen_at_ms: now,
        revoked_at_ms: None,
    });
    drop(config);
    if let Err(save_error) = state.service.save() {
        if let Ok(mut config) = state.service.inner.state.lock() {
            *config = previous;
        }
        eprintln!("CodeM mobile companion login persistence failed: {save_error}");
        return error(StatusCode::INTERNAL_SERVER_ERROR, "设备登录状态保存失败");
    }
    let mut response =
    Json(json!({ "enabled": true, "authenticated": true, "computerName": computer_name(), "username": MOBILE_USERNAME }))
            .into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&format!(
            "{DEVICE_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000"
        ))
        .unwrap(),
    );
    response
}

async fn mobile_bootstrap(State(state): State<GatewayState>, headers: HeaderMap) -> Response {
    let device = match authenticate(&state.service, &headers, "view") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let workspace = match proxy_json(&state, Method::GET, "/api/workspace/bootstrap", None).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let claude = proxy_json(&state, Method::GET, "/api/claude/runtimes", None)
        .await
        .unwrap_or(json!([]));
    let agents = proxy_json(&state, Method::GET, "/api/agents/runtimes", None)
        .await
        .unwrap_or(json!([]));
    let providers = proxy_json(&state, Method::GET, "/api/agents/providers", None)
        .await
        .unwrap_or(json!({ "providers": [] }));
    let channels = proxy_json(&state, Method::GET, "/api/agents/channels/bootstrap", None)
        .await
        .unwrap_or(json!({ "channels": [], "systemChannels": [], "defaultChannelIds": {} }));
    let mut bootstrap = build_bootstrap(
        workspace,
        claude,
        agents,
        device.permissions,
        providers,
        channels,
    );
    enrich_live_tasks(&state.service, &mut bootstrap);
    Json(bootstrap).into_response()
}

async fn mobile_provider_models(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(provider_id): Path<String>,
    Query(query): Query<ModelQuery>,
) -> Response {
    if let Err(response) = authenticate(&state.service, &headers, "view") {
        return response;
    }
    let provider_id = provider_id.trim();
    if provider_id == "claude-code" {
        return match proxy_json(&state, Method::GET, "/api/claude/models", None).await {
            Ok(value) => Json(sanitize_claude_model_catalog(value)).into_response(),
            Err(response) => response,
        };
    }
    let mut path = format!("/api/agents/{}/models", urlencoding(provider_id));
    if let Some(channel_id) = query.channel_id.filter(|value| !value.trim().is_empty()) {
        path.push_str("?channelId=");
        path.push_str(&urlencoding(channel_id.trim()));
    }
    match proxy_json(&state, Method::GET, &path, None).await {
        Ok(value) => Json(sanitize_model_catalog(value)).into_response(),
        Err(response) => response,
    }
}

async fn mobile_thread(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(thread_id): Path<String>,
    Query(query): Query<HistoryQuery>,
) -> Response {
    if let Err(r) = authenticate(&state.service, &headers, "view") {
        return r;
    }
    ensure_live_run(&state, &thread_id).await;
    let include_live = query.before.is_none();
    let path = format!("/api/threads/{}/history", urlencoding(&thread_id));
    match proxy_json(&state, Method::GET, &path, None).await {
        Ok(value) => {
            let mut page = sanitize_history(&thread_id, value, query.before);
            if include_live {
                if let Ok(runs) = state.service.inner.live_runs.lock() {
                    if let Some(run) = runs.get(&thread_id) {
                        if !run.finished {
                            merge_live_turn(&mut page, &thread_id, run);
                        }
                        if let Some(task) = page.get_mut("task").and_then(Value::as_object_mut) {
                            task.insert("activeRunId".into(), json!(run.run_id));
                            task.insert(
                                "phase".into(),
                                json!(if run.finished { "done" } else { "running" }),
                            );
                        }
                        page["liveRunId"] = json!(run.run_id);
                        page["liveEventCursor"] = json!(run.events.len());
                    }
                }
            }
            Json(page).into_response()
        }
        Err(r) => r,
    }
}

async fn mobile_attachment_preview(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(preview_id): Path<String>,
) -> Response {
    if let Err(response) = authenticate(&state.service, &headers, "view") {
        return response;
    }
    let Some(mime_type) = mobile_preview_mime_type(&preview_id) else {
        return error(StatusCode::NOT_FOUND, "图片预览不存在");
    };
    let workspace = match proxy_json(&state, Method::GET, "/api/workspace/bootstrap", None).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Some(file_path) = find_mobile_attachment(&workspace, &preview_id) else {
        return error(StatusCode::NOT_FOUND, "图片预览不存在");
    };
    let Ok(metadata) = fs::metadata(&file_path) else {
        return error(StatusCode::NOT_FOUND, "图片预览不存在");
    };
    if !metadata.is_file() || metadata.len() > MOBILE_MAX_IMAGE_BYTES as u64 {
        return error(StatusCode::BAD_REQUEST, "图片预览不可用");
    }
    let Ok(bytes) = fs::read(&file_path) else {
        return error(StatusCode::NOT_FOUND, "图片预览不存在");
    };
    if !is_valid_mobile_image_bytes(mime_type, &bytes) {
        return error(StatusCode::BAD_REQUEST, "图片预览格式无效");
    }
    Response::builder()
        .header(header::CONTENT_TYPE, mime_type)
        .header(header::CACHE_CONTROL, "private, no-store")
        .body(Body::from(bytes))
        .unwrap_or_else(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "图片预览失败"))
}

fn find_mobile_attachment(workspace: &Value, preview_id: &str) -> Option<PathBuf> {
    mobile_preview_mime_type(preview_id)?;
    for project in workspace.get("projects")?.as_array()? {
        let Some(project_path) = project.get("path").and_then(Value::as_str) else {
            continue;
        };
        let attachment_root = PathBuf::from(project_path).join(".codem-attachments");
        let Ok(canonical_root) = fs::canonicalize(&attachment_root) else {
            continue;
        };
        let candidate = fs::canonicalize(attachment_root.join(preview_id)).ok();
        if let Some(candidate) = candidate.filter(|path| path.starts_with(&canonical_root)) {
            return Some(candidate);
        }
    }
    None
}

fn mobile_preview_mime_type(preview_id: &str) -> Option<&'static str> {
    let (stem, extension) = preview_id.rsplit_once('.')?;
    Uuid::parse_str(stem).ok()?;
    match extension.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn is_valid_mobile_image_bytes(mime_type: &str, bytes: &[u8]) -> bool {
    match mime_type {
        "image/png" => bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        _ => false,
    }
}

async fn mobile_thread_events(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(thread_id): Path<String>,
    Query(query): Query<LiveEventQuery>,
) -> Response {
    if let Err(response) = authenticate(&state.service, &headers, "view") {
        return response;
    }
    let header_cursor = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .and_then(parse_live_event_id);
    let LiveEventQuery { after, run_id } = query;
    let mut live_run_changes = state.service.inner.live_run_revision.subscribe();
    let mut runtime_changes = state.service.inner.runtime_signature.subscribe();
    state.service.ensure_runtime_watcher();
    ensure_live_run(&state, &thread_id).await;
    let stream = async_stream::stream! {
        let mut observed_run_id = header_cursor
            .as_ref()
            .map(|(run_id, _)| run_id.clone())
            .or(run_id);
        let mut offset = header_cursor
            .map(|(_, offset)| offset)
            .unwrap_or_else(|| after.unwrap_or(0));
        let mut idle_sent = false;
        loop {
            let snapshot = state.service.inner.live_runs.lock().ok().and_then(|runs| {
                runs.get(&thread_id).map(|run| {
                    let run_id = run.run_id.clone();
                    if observed_run_id.as_deref() != Some(run_id.as_str()) {
                        observed_run_id = Some(run_id.clone());
                        offset = 0;
                    }
                    if offset > run.events.len() {
                        offset = 0;
                    }
                    (run_id, run.events[offset..].to_vec())
                })
            });
            let Some((run_id, events)) = snapshot else {
                if !idle_sent {
                    yield Ok::<_, std::convert::Infallible>("event: idle\ndata: {}\n\n".into());
                    idle_sent = true;
                }
                let runtime_changed = tokio::select! {
                    result = live_run_changes.changed() => {
                        if result.is_err() { break; }
                        false
                    }
                    result = runtime_changes.changed() => {
                        if result.is_err() { break; }
                        true
                    }
                    _ = tokio::time::sleep(std::time::Duration::from_secs(15)) => {
                        yield Ok::<_, std::convert::Infallible>(": ping\n\n".into());
                        false
                    }
                };
                if runtime_changed {
                    ensure_live_run(&state, &thread_id).await;
                }
                continue;
            };
            idle_sent = false;
            if !events.is_empty() {
                for event in &events {
                    offset += 1;
                    if let Some(safe_event) = sanitize_live_event(event, &run_id) {
                        let payload = serde_json::to_string(&safe_event).unwrap_or_else(|_| "{}".into());
                        yield Ok::<_, std::convert::Infallible>(format!("id: {}\nevent: agent\ndata: {payload}\n\n", live_event_id(&run_id, offset)));
                    }
                }
                continue;
            }
            tokio::select! {
                result = live_run_changes.changed() => {
                    if result.is_err() { break; }
                }
                result = runtime_changes.changed() => {
                    if result.is_err() { break; }
                }
                _ = tokio::time::sleep(std::time::Duration::from_secs(15)) => {
                    yield Ok::<_, std::convert::Infallible>(": ping\n\n".into());
                }
            }
        }
    };
    Response::builder()
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::CONNECTION, "keep-alive")
        .body(Body::from_stream(stream))
        .unwrap()
}

async fn ensure_live_run(state: &GatewayState, thread_id: &str) {
    if state
        .service
        .inner
        .live_runs
        .lock()
        .ok()
        .is_some_and(|runs| runs.contains_key(thread_id))
    {
        return;
    }
    let Ok(workspace) = proxy_json(state, Method::GET, "/api/workspace/bootstrap", None).await
    else {
        return;
    };
    let Some((provider, _, _)) = find_thread(&workspace, thread_id) else {
        return;
    };
    let fallback_prompt = find_thread(&workspace, thread_id)
        .and_then(|(_, _, thread)| {
            thread
                .get("lastPrompt")
                .or_else(|| thread.get("title"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default();
    let Some(run_id) = active_run_id(state, thread_id, &provider).await else {
        return;
    };
    let prompt = if provider == "claude-code" {
        proxy_json(
            state,
            Method::GET,
            &format!("/api/claude/runs/active/{}", urlencoding(thread_id)),
            None,
        )
        .await
        .ok()
        .and_then(|run| active_run_prompt(&run))
        .unwrap_or(fallback_prompt)
    } else {
        fallback_prompt
    };
    {
        let Ok(mut runs) = state.service.inner.live_runs.lock() else {
            return;
        };
        if runs.contains_key(thread_id) {
            return;
        }
        runs.insert(
            thread_id.to_string(),
            MobileLiveRun {
                run_id: run_id.clone(),
                upstream_run_id: run_id.clone(),
                provider: provider.clone(),
                prompt,
                user_content_blocks: Vec::new(),
                started_at_ms: now_ms(),
                events: Vec::new(),
                finished: false,
            },
        );
    }
    state.service.signal_live_run_change();
    let service = state.service.clone();
    let client = state.client.clone();
    let thread = thread_id.to_string();
    tokio::spawn(async move {
        relay_desktop_run(&service, &client, &thread, &provider, &run_id).await;
    });
}

async fn relay_desktop_run(
    service: &MobileCompanionService,
    client: &reqwest::Client,
    thread_id: &str,
    provider: &str,
    run_id: &str,
) {
    let prefix = if provider == "claude-code" {
        "claude"
    } else {
        "agents"
    };
    let request = client.get(format!(
        "{}/api/{prefix}/run/{run_id}/events",
        service.inner.desktop_origin
    ));
    let Ok(mut response) = authorize_desktop_request(service, request).send().await else {
        if let Ok(mut runs) = service.inner.live_runs.lock() {
            runs.remove(thread_id);
        }
        service.signal_live_run_change();
        return;
    };
    if !response.status().is_success() {
        if let Ok(mut runs) = service.inner.live_runs.lock() {
            runs.remove(thread_id);
        }
        service.signal_live_run_change();
        return;
    }
    let mut buffered = String::new();
    let mut persisted_session_id = None::<String>;
    while let Ok(Some(chunk)) = response.chunk().await {
        buffered.push_str(&String::from_utf8_lossy(&chunk).replace("\r\n", "\n"));
        while let Some(index) = buffered.find('\n') {
            let line = buffered[..index]
                .trim()
                .strip_prefix("data:")
                .unwrap_or(buffered[..index].trim())
                .trim()
                .to_string();
            buffered.drain(..index + 1);
            if line.is_empty() {
                continue;
            }
            let Ok(event) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let session_id = mobile_event_session_id(&event).map(str::to_string);
            let terminal = matches!(
                event.get("type").and_then(Value::as_str),
                Some("done" | "error" | "stopped")
            );
            if let Ok(mut runs) = service.inner.live_runs.lock() {
                if let Some(run) = runs.get_mut(thread_id) {
                    run.events.push(event);
                    if terminal {
                        run.finished = true;
                    }
                }
            }
            service.signal_live_run_change();
            if session_id.as_deref() != persisted_session_id.as_deref() {
                if let Some(session_id) = session_id {
                    persist_mobile_thread_session(service, thread_id, &session_id).await;
                    persisted_session_id = Some(session_id);
                }
            }
        }
    }
    let completed_run = service.inner.live_runs.lock().ok().and_then(|runs| {
        runs.get(thread_id)
            .filter(|run| run.run_id == run_id)
            .map(|run| (run.prompt.clone(), run.events.clone()))
    });
    if let Some((prompt, events)) = completed_run {
        persist_mobile_turn(service, thread_id, &prompt, &[], &events).await;
    }
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    if let Ok(mut runs) = service.inner.live_runs.lock() {
        if runs.get(thread_id).is_some_and(|run| run.run_id == run_id) {
            runs.remove(thread_id);
        }
    }
    service.signal_live_run_change();
}

async fn mobile_create_task(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    if let Err(r) = authenticate(&state.service, &headers, "send") {
        return r;
    }
    let Some(project_id) = body.get("projectId").and_then(Value::as_str) else {
        return error(StatusCode::BAD_REQUEST, "缺少项目");
    };
    let provider = body
        .get("providerId")
        .and_then(Value::as_str)
        .unwrap_or("claude-code");
    let thread_body = json!({ "title": prompt_title(body.get("prompt").and_then(Value::as_str).unwrap_or("新任务")), "providerId": provider, "permissionMode": body.get("permissionMode"), "model": body.get("model"), "reasoningEffort": body.get("reasoningEffort"), "agentChannelId": body.get("channelId"), "activate": false });
    let path = format!("/api/projects/{}/threads", urlencoding(project_id));
    let thread = match proxy_json(&state, Method::POST, &path, Some(thread_body)).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let thread_id = thread
        .get("id")
        .or_else(|| thread.get("threadId"))
        .or_else(|| thread.get("thread").and_then(|v| v.get("id")))
        .and_then(Value::as_str)
        .unwrap_or("");
    if thread_id.is_empty() {
        return error(StatusCode::BAD_GATEWAY, "创建会话失败");
    }
    match start_run(&state, thread_id, provider, &body).await {
        Ok(run) => {
            Json(json!({ "threadId": thread_id, "runId": run.get("runId") })).into_response()
        }
        Err(response) => response,
    }
}

async fn mobile_send(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(thread_id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    if let Err(r) = authenticate(&state.service, &headers, "send") {
        return r;
    }
    let workspace = match proxy_json(&state, Method::GET, "/api/workspace/bootstrap", None).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Some((provider, project_path, thread)) = find_thread(&workspace, &thread_id) else {
        return error(StatusCode::NOT_FOUND, "任务不存在");
    };
    let payload = build_mobile_send_payload(&provider, &project_path, &thread, &body);
    if provider == "claude-code" && body.get("mode").and_then(Value::as_str) == Some("guide") {
        if let Some(run_id) = active_run_id(&state, &thread_id, &provider).await {
            return match proxy_json(
                &state,
                Method::POST,
                &format!("/api/claude/run/{run_id}/guide"),
                Some(json!({ "prompt": body.get("prompt") })),
            )
            .await
            {
                Ok(v) => Json(v).into_response(),
                Err(r) => r,
            };
        }
    }
    if let Err(response) = persist_mobile_thread_settings(&state, &thread_id, &body).await {
        return response;
    }
    match start_run(&state, &thread_id, &provider, &payload).await {
        Ok(v) => Json(v).into_response(),
        Err(r) => r,
    }
}

async fn mobile_update_settings(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(thread_id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    if let Err(response) = authenticate(&state.service, &headers, "send") {
        return response;
    }
    let settings = mobile_thread_settings_payload(&body);
    if settings.as_object().is_none_or(serde_json::Map::is_empty) {
        return error(StatusCode::BAD_REQUEST, "没有可保存的会话设置");
    }
    match proxy_json(
        &state,
        Method::PATCH,
        &format!("/api/threads/{}", urlencoding(&thread_id)),
        Some(settings),
    )
    .await
    {
        Ok(value) => Json(value).into_response(),
        Err(response) => response,
    }
}

async fn persist_mobile_thread_settings(
    state: &GatewayState,
    thread_id: &str,
    body: &Value,
) -> Result<(), Response> {
    let settings = mobile_thread_settings_payload(body);
    if settings.as_object().is_none_or(serde_json::Map::is_empty) {
        return Ok(());
    }
    proxy_json(
        state,
        Method::PATCH,
        &format!("/api/threads/{}", urlencoding(thread_id)),
        Some(settings),
    )
    .await
    .map(|_| ())
}

fn mobile_thread_settings_payload(body: &Value) -> Value {
    let mut settings = serde_json::Map::new();
    for field in ["model", "reasoningEffort", "permissionMode", "channelId"] {
        if let Some(value) = body.get(field) {
            settings.insert(field.to_string(), value.clone());
        }
    }
    Value::Object(settings)
}

fn build_mobile_send_payload(
    provider: &str,
    project_path: &str,
    thread: &Value,
    body: &Value,
) -> Value {
    let reuse_session = should_reuse_mobile_thread_session(provider, thread, body);
    json!({
        "prompt": body.get("prompt"),
        "projectId": thread.get("projectId"),
        "providerId": provider,
        "workingDirectory": project_path,
        "permissionMode": body.get("permissionMode").or_else(|| thread.get("permissionMode")),
        "model": body.get("model").or_else(|| thread.get("model")),
        "reasoningEffort": body.get("reasoningEffort").or_else(|| thread.get("reasoningEffort")),
        "channelId": body.get("channelId").or_else(|| thread.get("agentChannelId")),
        "sessionId": if reuse_session { mobile_non_empty_session_id(thread.get("sessionId")) } else { None },
        "recoveryAction": body.get("recoveryAction"),
        "contentBlocks": body.get("contentBlocks").cloned().unwrap_or_else(|| json!([])),
    })
}

fn mobile_non_empty_session_id(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|session_id| !session_id.is_empty())
}

fn should_reuse_mobile_session(body: &Value) -> bool {
    !matches!(
        body.get("recoveryAction").and_then(Value::as_str),
        Some("resend" | "recover")
    )
}

fn should_reuse_mobile_thread_session(provider: &str, thread: &Value, body: &Value) -> bool {
    if !should_reuse_mobile_session(body) {
        return false;
    }
    if provider != "openai-codex" {
        return true;
    }
    let requested_channel = body
        .get("channelId")
        .and_then(Value::as_str)
        .unwrap_or("system");
    let current_channel = thread
        .get("agentChannelId")
        .and_then(Value::as_str)
        .unwrap_or("system");
    requested_channel == current_channel
}

async fn mobile_stop(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(thread_id): Path<String>,
) -> Response {
    if let Err(r) = authenticate(&state.service, &headers, "stop") {
        return r;
    }
    let workspace = proxy_json(&state, Method::GET, "/api/workspace/bootstrap", None)
        .await
        .unwrap_or(json!({}));
    let provider = find_thread(&workspace, &thread_id)
        .map(|v| v.0)
        .unwrap_or_else(|| "claude-code".into());
    let run_id = active_run_id(&state, &thread_id, &provider).await;
    let Some(run_id) = run_id else {
        return Json(json!({ "ok": true })).into_response();
    };
    let path = if provider == "claude-code" {
        format!("/api/claude/run/{run_id}")
    } else {
        format!("/api/agents/run/{run_id}")
    };
    let internal_headers = mobile_stop_internal_headers(&provider);
    match proxy_json_with_headers(&state, Method::DELETE, &path, None, internal_headers).await {
        Ok(v) => Json(v).into_response(),
        Err(r) => r,
    }
}

async fn mobile_approval(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(thread_id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    control_action(
        state,
        headers,
        thread_id,
        body,
        "approval-decision",
        "approve",
    )
    .await
}
async fn mobile_user_input(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(thread_id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    control_action(
        state,
        headers,
        thread_id,
        body,
        "request-user-input",
        "approve",
    )
    .await
}

async fn control_action(
    state: GatewayState,
    headers: HeaderMap,
    thread_id: String,
    body: Value,
    suffix: &str,
    permission: &str,
) -> Response {
    if let Err(r) = authenticate(&state.service, &headers, permission) {
        return r;
    }
    let workspace = proxy_json(&state, Method::GET, "/api/workspace/bootstrap", None)
        .await
        .unwrap_or(json!({}));
    let provider = find_thread(&workspace, &thread_id)
        .map(|v| v.0)
        .unwrap_or_else(|| "claude-code".into());
    let Some(run_id) = active_run_id(&state, &thread_id, &provider).await else {
        return error(StatusCode::CONFLICT, "任务当前不可写");
    };
    let payload = if suffix == "approval-decision" {
        json!({ "requestId": body.get("requestId"), "decision": if body.get("approved").and_then(Value::as_bool).unwrap_or(false) { "approve" } else { "reject" } })
    } else if provider == "claude-code" {
        json!({ "requestId": body.get("requestId"), "answers": body.get("answers").cloned().unwrap_or_else(|| json!({ "answer": body.get("answer") })), "questions": body.get("questions").cloned().unwrap_or_else(|| json!([{ "question": "回答", "header": "回答", "options": [] }])) })
    } else {
        json!({ "requestId": body.get("requestId"), "answers": body.get("answers").cloned().unwrap_or_else(|| json!({ "answer": body.get("answer") })) })
    };
    let prefix = if provider == "claude-code" {
        "claude"
    } else {
        "agents"
    };
    match proxy_json(
        &state,
        Method::POST,
        &format!("/api/{prefix}/run/{run_id}/{suffix}"),
        Some(payload),
    )
    .await
    {
        Ok(v) => Json(v).into_response(),
        Err(r) => r,
    }
}

async fn mobile_events(State(state): State<GatewayState>, headers: HeaderMap) -> Response {
    if let Err(r) = authenticate(&state.service, &headers, "view") {
        return r;
    }
    let mut runtime_changes = state.service.inner.runtime_signature.subscribe();
    state.service.ensure_runtime_watcher();
    let stream = async_stream::stream! {
        let mut signature = runtime_changes.borrow().clone();
        let mut cursor = now_ms();
        loop {
            tokio::select! {
                result = runtime_changes.changed() => {
                    if result.is_err() { break; }
                    let next_signature = runtime_changes.borrow().clone();
                    if next_signature.is_some() && signature.is_some() && next_signature != signature {
                        signature = next_signature;
                        cursor += 1;
                        yield Ok::<_, std::convert::Infallible>(format!("id: {cursor}\nevent: sync\ndata: {{\"cursor\":{cursor}}}\n\n"));
                    } else if next_signature.is_some() {
                        signature = next_signature;
                    }
                }
                _ = tokio::time::sleep(std::time::Duration::from_secs(15)) => {
                    yield Ok::<_, std::convert::Infallible>(": ping\n\n".into());
                }
            }
        }
    };
    Response::builder()
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::CONNECTION, "keep-alive")
        .body(Body::from_stream(stream))
        .unwrap()
}

async fn mobile_runtime_signature(state: &GatewayState) -> Option<String> {
    let claude = proxy_json(state, Method::GET, "/api/claude/runtimes", None)
        .await
        .ok()?;
    let agents = proxy_json(state, Method::GET, "/api/agents/runtimes", None)
        .await
        .ok()?;
    Some(runtime_status_signature(&claude, &agents))
}

fn runtime_status_signature(claude: &Value, agents: &Value) -> String {
    let mut entries = Vec::new();
    collect_runtime_signature_entries("claude", claude, &mut entries);
    collect_runtime_signature_entries("agent", agents, &mut entries);
    entries.sort();
    entries.join("\n")
}

fn collect_runtime_signature_entries(source: &str, value: &Value, entries: &mut Vec<String>) {
    let mut append = |thread_id: &str, runtime: &Value| {
        let active = runtime
            .get("activeRun")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let phase = runtime
            .get("phase")
            .or_else(|| runtime.get("status"))
            .and_then(Value::as_str)
            .unwrap_or(if active { "running" } else { "idle" });
        let run_id = runtime
            .get("runId")
            .or_else(|| runtime.get("activeRunId"))
            .or_else(|| runtime.get("currentRunId"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if active || phase != "idle" || !run_id.is_empty() {
            entries.push(format!("{source}|{thread_id}|{phase}|{run_id}"));
        }
    };
    if let Some(values) = value.as_object() {
        for (thread_id, runtime) in values {
            let thread_id = runtime
                .get("threadId")
                .and_then(Value::as_str)
                .unwrap_or(thread_id);
            append(thread_id, runtime);
        }
    } else if let Some(values) = value.as_array() {
        for runtime in values {
            if let Some(thread_id) = runtime.get("threadId").and_then(Value::as_str) {
                append(thread_id, runtime);
            }
        }
    }
}

fn live_event_id(run_id: &str, offset: usize) -> String {
    format!("{run_id}|{offset}")
}

fn parse_live_event_id(value: &str) -> Option<(String, usize)> {
    let (run_id, offset) = value.rsplit_once('|')?;
    if run_id.is_empty() {
        return None;
    }
    Some((run_id.to_string(), offset.parse().ok()?))
}

async fn proxy_json(
    state: &GatewayState,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, Response> {
    proxy_json_with_headers(state, method, path, body, &[]).await
}

fn authorize_desktop_request(
    service: &MobileCompanionService,
    request: reqwest::RequestBuilder,
) -> reqwest::RequestBuilder {
    match service.inner.desktop_token.as_deref() {
        Some(token) if !token.is_empty() => {
            request.header(header::AUTHORIZATION, format!("Bearer {token}"))
        }
        _ => request,
    }
}

fn mobile_stop_internal_headers(provider: &str) -> &'static [(&'static str, &'static str)] {
    if provider == "claude-code" {
        &MOBILE_STOP_HEADERS
    } else {
        &[]
    }
}

async fn proxy_json_with_headers(
    state: &GatewayState,
    method: Method,
    path: &str,
    body: Option<Value>,
    headers: &[(&str, &str)],
) -> Result<Value, Response> {
    let mut request = state.client.request(
        method,
        format!("{}{}", state.service.inner.desktop_origin, path),
    );
    request = authorize_desktop_request(&state.service, request);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|_| error(StatusCode::BAD_GATEWAY, "电脑端服务不可用"))?;
    let status = response.status();
    let bytes = response.bytes().await.unwrap_or_default();
    if !status.is_success() {
        return Err(error(
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            &upstream_error_message(&bytes),
        ));
    }
    serde_json::from_slice(&bytes).map_err(|_| error(StatusCode::BAD_GATEWAY, "电脑端响应无效"))
}

fn upstream_error_message(bytes: &[u8]) -> String {
    let fallback = String::from_utf8_lossy(bytes).trim().to_string();
    serde_json::from_slice::<Value>(bytes)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(Value::as_str)
                .or_else(|| value.get("message").and_then(Value::as_str))
                .map(str::trim)
                .filter(|message| !message.is_empty())
                .map(str::to_string)
        })
        .unwrap_or(fallback)
}

async fn start_run(
    state: &GatewayState,
    thread_id: &str,
    provider: &str,
    body: &Value,
) -> Result<Value, Response> {
    let workspace = proxy_json(state, Method::GET, "/api/workspace/bootstrap", None).await?;
    let (_, project_path, thread) = find_thread(&workspace, thread_id)
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "任务不存在"))?;
    let prompt = body.get("prompt").and_then(Value::as_str).unwrap_or("");
    let session_id = if should_reuse_mobile_session(body) {
        if body.get("sessionId").is_some() {
            mobile_non_empty_session_id(body.get("sessionId"))
        } else {
            mobile_non_empty_session_id(thread.get("sessionId"))
        }
    } else {
        None
    };
    let (path, payload) = if provider == "claude-code" {
        (
            "/api/claude/run",
            json!({ "threadId": thread_id, "prompt": prompt, "workingDirectory": project_path, "sessionId": session_id, "permissionMode": body.get("permissionMode").or_else(|| thread.get("permissionMode")), "model": body.get("model").or_else(|| thread.get("model")), "effort": body.get("reasoningEffort").or_else(|| thread.get("reasoningEffort")), "channelId": body.get("channelId").or_else(|| thread.get("agentChannelId")), "contentBlocks": body.get("contentBlocks").cloned().unwrap_or(json!([])) }),
        )
    } else {
        (
            "/api/agents/run",
            json!({ "providerId": provider, "threadId": thread_id, "prompt": prompt, "workingDirectory": project_path, "sessionId": session_id, "permissionMode": body.get("permissionMode").or_else(|| thread.get("permissionMode")), "model": body.get("model").or_else(|| thread.get("model")), "reasoningEffort": body.get("reasoningEffort").or_else(|| thread.get("reasoningEffort")), "channelId": body.get("channelId").or_else(|| thread.get("agentChannelId")), "contentBlocks": body.get("contentBlocks").cloned().unwrap_or(json!([])) }),
        )
    };
    start_stream(state, thread_id, provider, path, payload).await
}

async fn start_stream(
    state: &GatewayState,
    thread_id: &str,
    provider: &str,
    path: &str,
    mut payload: Value,
) -> Result<Value, Response> {
    prepare_mobile_image_attachments(&mut payload).await?;
    let submitted_prompt = payload
        .get("prompt")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let submitted_content_blocks = sanitize_user_content_blocks(payload.get("contentBlocks"), None);
    let response = authorize_desktop_request(
        &state.service,
        state
            .client
            .post(format!("{}{}", state.service.inner.desktop_origin, path)),
    )
    .json(&payload)
    .send()
    .await
    .map_err(|_| error(StatusCode::BAD_GATEWAY, "无法启动 Agent"))?;
    if !response.status().is_success() {
        let status = response.status();
        let message = response.text().await.unwrap_or_else(|_| "启动失败".into());
        return Err(error(
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            &message,
        ));
    }
    let run_id = response
        .headers()
        .get("x-codem-agent-run-id")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    state
        .service
        .inner
        .live_runs
        .lock()
        .map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "运行状态不可用"))?
        .insert(
            thread_id.to_string(),
            MobileLiveRun {
                run_id: run_id.clone(),
                upstream_run_id: run_id.clone(),
                provider: provider.to_string(),
                prompt: submitted_prompt.clone(),
                user_content_blocks: submitted_content_blocks,
                started_at_ms: now_ms(),
                events: Vec::new(),
                finished: false,
            },
        );
    state.service.signal_live_run_change();
    let service = state.service.clone();
    let client = state.client.clone();
    let thread = thread_id.to_string();
    let provider = provider.to_string();
    let path = path.to_string();
    let logical_run_id = run_id.clone();
    let can_recover_session = provider == "claude-code"
        && payload
            .get("sessionId")
            .and_then(Value::as_str)
            .is_some_and(|session_id| !session_id.trim().is_empty());
    tokio::spawn(async move {
        stream_mobile_run(
            &service,
            &client,
            &thread,
            &path,
            payload,
            response,
            &logical_run_id,
            &submitted_prompt,
            can_recover_session,
        )
        .await;
    });
    Ok(json!({ "runId": run_id, "started": true }))
}

async fn prepare_mobile_image_attachments(payload: &mut Value) -> Result<(), Response> {
    let working_directory = payload
        .get("workingDirectory")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| error(StatusCode::BAD_REQUEST, "任务工作目录不可用"))?
        .to_string();
    let requests = payload
        .get("contentBlocks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(index, block)| {
            if block.get("type").and_then(Value::as_str) != Some("image") {
                return None;
            }
            let data = block.get("data").and_then(Value::as_str)?.trim();
            if data.is_empty() {
                return None;
            }
            Some((
                index,
                block
                    .get("mimeType")
                    .and_then(Value::as_str)
                    .unwrap_or("image/png")
                    .to_string(),
                data.to_string(),
            ))
        })
        .collect::<Vec<_>>();

    for (index, mime_type, data) in requests {
        let directory = working_directory.clone();
        let stored = tokio::task::spawn_blocking(move || {
            save_mobile_image_attachment(&directory, &mime_type, &data)
        })
        .await
        .map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "保存移动图片失败"))?
        .map_err(|message| error(StatusCode::BAD_REQUEST, &message))?;
        let Some(block) = payload
            .get_mut("contentBlocks")
            .and_then(Value::as_array_mut)
            .and_then(|blocks| blocks.get_mut(index))
        else {
            return Err(error(StatusCode::BAD_REQUEST, "图片附件状态无效"));
        };
        block["path"] = json!(stored.path.display().to_string());
        block["mimeType"] = json!(stored.mime_type);
        block["size"] = json!(stored.size);
    }
    Ok(())
}

struct StoredMobileImage {
    path: PathBuf,
    mime_type: &'static str,
    size: usize,
}

fn save_mobile_image_attachment(
    working_directory: &str,
    requested_mime_type: &str,
    encoded_data: &str,
) -> Result<StoredMobileImage, String> {
    let (mime_type, extension) = match requested_mime_type.trim().to_ascii_lowercase().as_str() {
        "image/png" => ("image/png", "png"),
        "image/jpeg" | "image/jpg" => ("image/jpeg", "jpg"),
        "image/gif" => ("image/gif", "gif"),
        "image/webp" => ("image/webp", "webp"),
        _ => return Err("移动端暂不支持这种图片格式".into()),
    };
    let bytes = general_purpose::STANDARD
        .decode(encoded_data)
        .map_err(|_| "图片内容无效，请重新选择图片".to_string())?;
    if bytes.is_empty() {
        return Err("图片内容为空".into());
    }
    if bytes.len() > MOBILE_MAX_IMAGE_BYTES {
        return Err("图片过大，请控制在 12MB 以内".into());
    }
    if !is_valid_mobile_image_bytes(mime_type, &bytes) {
        return Err("图片内容与文件格式不匹配".into());
    }
    let working_directory = PathBuf::from(working_directory);
    if !working_directory.is_dir() {
        return Err("任务工作目录不可用".into());
    }
    let attachment_directory = working_directory.join(".codem-attachments");
    fs::create_dir_all(&attachment_directory).map_err(|_| "无法创建图片附件目录".to_string())?;
    let preview_id = format!("{}.{}", Uuid::new_v4(), extension);
    let path = attachment_directory.join(preview_id);
    fs::write(&path, &bytes).map_err(|_| "保存移动图片失败".to_string())?;
    Ok(StoredMobileImage {
        path,
        mime_type,
        size: bytes.len(),
    })
}

async fn stream_mobile_run(
    service: &MobileCompanionService,
    client: &reqwest::Client,
    thread_id: &str,
    path: &str,
    payload: Value,
    initial_response: reqwest::Response,
    logical_run_id: &str,
    submitted_prompt: &str,
    can_recover_session: bool,
) {
    let mut response = initial_response;
    let mut recovery_attempted = false;
    let mut saw_meaningful_output = false;
    let mut persisted_session_id = None::<String>;
    let mut retry_payload = payload;

    loop {
        let mut buffered = String::new();
        let mut retry = false;
        while let Ok(Some(chunk)) = response.chunk().await {
            buffered.push_str(&String::from_utf8_lossy(&chunk).replace("\r\n", "\n"));
            while let Some(index) = buffered.find('\n') {
                let line = buffered[..index]
                    .trim()
                    .strip_prefix("data:")
                    .unwrap_or(buffered[..index].trim())
                    .trim()
                    .to_string();
                buffered.drain(..index + 1);
                if line.is_empty() {
                    continue;
                }
                let Ok(mut event) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                let event_type = event
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                if is_meaningful_mobile_output(&event_type) {
                    saw_meaningful_output = true;
                }
                if should_auto_recover_mobile_session(
                    can_recover_session,
                    recovery_attempted,
                    saw_meaningful_output,
                    &event,
                ) {
                    recovery_attempted = true;
                    retry = true;
                    break;
                }
                let session_id = mobile_event_session_id(&event).map(str::to_string);
                if let Some(object) = event.as_object_mut() {
                    object.insert("runId".into(), json!(logical_run_id));
                }
                let terminal = matches!(event_type.as_str(), "done" | "error" | "stopped");
                if let Ok(mut runs) = service.inner.live_runs.lock() {
                    if let Some(run) = runs.get_mut(thread_id) {
                        run.events.push(event);
                        if terminal {
                            run.finished = true;
                        }
                    }
                }
                service.signal_live_run_change();
                if session_id.as_deref() != persisted_session_id.as_deref() {
                    if let Some(session_id) = session_id {
                        persist_mobile_thread_session(service, thread_id, &session_id).await;
                        persisted_session_id = Some(session_id);
                    }
                }
            }
            if retry {
                break;
            }
        }

        if !retry {
            break;
        }

        let _ = clear_mobile_thread_session(service, thread_id).await;
        persisted_session_id = None;
        retry_payload = mobile_recovery_payload(&retry_payload);
        let retry_response = authorize_desktop_request(
            service,
            client.post(format!("{}{}", service.inner.desktop_origin, path)),
        )
        .json(&retry_payload)
        .send()
        .await;
        let Ok(next_response) = retry_response else {
            push_mobile_event(
                service,
                thread_id,
                logical_run_id,
                json!({ "type": "error", "message": "恢复 Claude 会话失败：电脑端服务不可用" }),
            );
            break;
        };
        if !next_response.status().is_success() {
            let message = next_response
                .text()
                .await
                .unwrap_or_else(|_| "恢复 Claude 会话失败".into());
            push_mobile_event(
                service,
                thread_id,
                logical_run_id,
                json!({ "type": "error", "message": sanitize_visible_text(&message, 1_000) }),
            );
            break;
        }
        let next_upstream_run_id = next_response
            .headers()
            .get("x-codem-agent-run-id")
            .and_then(|value| value.to_str().ok())
            .unwrap_or(logical_run_id)
            .to_string();
        if let Ok(mut runs) = service.inner.live_runs.lock() {
            if let Some(run) = runs.get_mut(thread_id) {
                run.upstream_run_id = next_upstream_run_id;
                run.finished = false;
                run.events.push(json!({
                    "type": "status",
                    "runId": logical_run_id,
                    "message": "旧 Claude 会话已失效，正在新建会话…"
                }));
            }
        }
        service.signal_live_run_change();
        response = next_response;
        saw_meaningful_output = false;
    }

    let (events, user_content_blocks) = service
        .inner
        .live_runs
        .lock()
        .ok()
        .and_then(|runs| {
            runs.get(thread_id)
                .map(|run| (run.events.clone(), run.user_content_blocks.clone()))
        })
        .unwrap_or_default();
    persist_mobile_turn(
        service,
        thread_id,
        submitted_prompt,
        &user_content_blocks,
        &events,
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    if let Ok(mut runs) = service.inner.live_runs.lock() {
        remove_live_run_if_matches(&mut runs, thread_id, logical_run_id);
    }
    service.signal_live_run_change();
}

fn is_meaningful_mobile_output(event_type: &str) -> bool {
    matches!(
        event_type,
        "delta"
            | "thinking-delta"
            | "tool-start"
            | "tool-input-delta"
            | "tool-stop"
            | "tool-result"
            | "approval-request"
            | "request-user-input"
    )
}

fn should_auto_recover_mobile_session(
    can_recover_session: bool,
    recovery_attempted: bool,
    saw_meaningful_output: bool,
    event: &Value,
) -> bool {
    can_recover_session
        && !recovery_attempted
        && !saw_meaningful_output
        && is_missing_resume_event(event)
}

fn mobile_recovery_payload(payload: &Value) -> Value {
    let mut payload = payload.clone();
    if let Some(object) = payload.as_object_mut() {
        object.remove("sessionId");
    }
    payload
}

fn mobile_event_session_id(event: &Value) -> Option<&str> {
    matches!(
        event.get("type").and_then(Value::as_str),
        Some("session" | "done")
    )
    .then(|| event.get("sessionId").and_then(Value::as_str))
    .flatten()
    .map(str::trim)
    .filter(|session_id| !session_id.is_empty())
}

fn is_missing_resume_event(event: &Value) -> bool {
    let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
    if event_type == "runtime-reconnect-hint" || event_type == "retryable-error" {
        return event.pointer("/hint/reason").and_then(Value::as_str)
            == Some("resume-session-missing");
    }
    event_type == "error"
        && event
            .get("message")
            .and_then(Value::as_str)
            .map(|message| {
                let lower = message.to_ascii_lowercase();
                lower.contains("no conversation found") && lower.contains("session id")
            })
            .unwrap_or(false)
}

fn push_mobile_event(
    service: &MobileCompanionService,
    thread_id: &str,
    logical_run_id: &str,
    mut event: Value,
) {
    if let Some(object) = event.as_object_mut() {
        object.insert("runId".into(), json!(logical_run_id));
    }
    if let Ok(mut runs) = service.inner.live_runs.lock() {
        if let Some(run) = runs.get_mut(thread_id) {
            run.events.push(event);
            run.finished = true;
        }
    }
    service.signal_live_run_change();
}

async fn clear_mobile_thread_session(service: &MobileCompanionService, thread_id: &str) {
    let client = reqwest::Client::new();
    let _ = authorize_desktop_request(
        service,
        client.patch(format!(
            "{}/api/threads/{}",
            service.inner.desktop_origin,
            urlencoding(thread_id)
        )),
    )
    .json(&json!({ "sessionId": null }))
    .send()
    .await;
}

async fn persist_mobile_thread_session(
    service: &MobileCompanionService,
    thread_id: &str,
    session_id: &str,
) {
    let client = reqwest::Client::new();
    let _ = authorize_desktop_request(
        service,
        client.patch(format!(
            "{}/api/threads/{}",
            service.inner.desktop_origin,
            urlencoding(thread_id)
        )),
    )
    .json(&json!({ "sessionId": session_id }))
    .send()
    .await;
}

async fn persist_mobile_turn(
    service: &MobileCompanionService,
    thread_id: &str,
    prompt: &str,
    user_content_blocks: &[Value],
    events: &[Value],
) {
    if (prompt.is_empty() && user_content_blocks.is_empty())
        || !events.iter().any(|event| {
            matches!(
                event.get("type").and_then(Value::as_str),
                Some("done" | "error" | "stopped")
            )
        })
    {
        return;
    }
    let run_id = events
        .iter()
        .find_map(|event| event.get("runId").and_then(Value::as_str))
        .unwrap_or("mobile-run")
        .to_string();
    let run = MobileLiveRun {
        run_id,
        upstream_run_id: String::new(),
        provider: events
            .iter()
            .find_map(|event| event.get("providerId").and_then(Value::as_str))
            .unwrap_or("claude-code")
            .to_string(),
        prompt: prompt.to_string(),
        user_content_blocks: user_content_blocks.to_vec(),
        started_at_ms: now_ms(),
        events: events.to_vec(),
        finished: true,
    };
    let turn = events_to_turn(thread_id, &run);
    let client = reqwest::Client::new();
    let url = format!(
        "{}/api/threads/{}/history/turn",
        service.inner.desktop_origin,
        urlencoding(thread_id)
    );
    let _ = authorize_desktop_request(service, client.post(url))
        .json(&json!({ "turn": turn }))
        .send()
        .await;
}

pub(crate) fn merge_or_append_mobile_turn(history: &mut Value, mut candidate: Value) -> bool {
    if let Some(index) = equivalent_turn_index(history, &candidate) {
        let candidate_blocks = candidate
            .get("userContentBlocks")
            .and_then(Value::as_array)
            .filter(|blocks| !blocks.is_empty())
            .cloned();
        let Some(candidate_blocks) = candidate_blocks else {
            return false;
        };
        let Some(turn) = history
            .get_mut("turns")
            .and_then(Value::as_array_mut)
            .and_then(|turns| turns.get_mut(index))
        else {
            return false;
        };
        if turn
            .get("userAttachments")
            .and_then(Value::as_array)
            .is_some_and(|attachments| !attachments.is_empty())
        {
            return false;
        }
        if let Some(existing_blocks) = turn
            .get_mut("userContentBlocks")
            .and_then(Value::as_array_mut)
            .filter(|blocks| !blocks.is_empty())
        {
            return merge_mobile_preview_ids(existing_blocks, &candidate_blocks);
        }
        turn["userContentBlocks"] = json!(candidate_blocks);
        return true;
    }

    candidate["id"] = json!(Uuid::new_v4().to_string());
    let Some(turns) = history.get_mut("turns").and_then(Value::as_array_mut) else {
        return false;
    };
    turns.push(candidate);
    true
}

fn merge_mobile_preview_ids(existing_blocks: &mut [Value], candidate_blocks: &[Value]) -> bool {
    let mut changed = false;
    for candidate in candidate_blocks {
        if candidate.get("type").and_then(Value::as_str) != Some("image") {
            continue;
        }
        let Some(preview_id) = candidate.get("previewId").and_then(Value::as_str) else {
            continue;
        };
        let candidate_id = candidate.get("id").and_then(Value::as_str);
        let candidate_name = candidate.get("name").and_then(Value::as_str);
        let Some(existing) = existing_blocks.iter_mut().find(|block| {
            if block.get("type").and_then(Value::as_str) != Some("image") {
                return false;
            }
            candidate_id.is_some() && block.get("id").and_then(Value::as_str) == candidate_id
                || candidate_id.is_none()
                    && candidate_name.is_some()
                    && block.get("name").and_then(Value::as_str) == candidate_name
        }) else {
            continue;
        };
        if existing.get("previewId").and_then(Value::as_str).is_none() {
            existing["previewId"] = json!(preview_id);
            changed = true;
        }
    }
    changed
}

fn equivalent_turn_index(history: &Value, candidate: &Value) -> Option<usize> {
    let Some(turns) = history.get("turns").and_then(Value::as_array) else {
        return None;
    };
    let candidate_run_id = candidate.get("backendRunId").and_then(Value::as_str);
    turns
        .iter()
        .enumerate()
        .rev()
        .take(5)
        .find_map(|(index, turn)| {
            if candidate_run_id.is_some()
                && turn.get("backendRunId").and_then(Value::as_str) == candidate_run_id
            {
                return Some(index);
            }
            let same_content = ["userText", "assistantText", "status", "errorMessage"]
                .into_iter()
                .all(|key| turn.get(key) == candidate.get(key));
            let started_near = match (
                turn.get("startedAtMs").and_then(Value::as_i64),
                candidate.get("startedAtMs").and_then(Value::as_i64),
            ) {
                (Some(left), Some(right)) => left.abs_diff(right) <= 120_000,
                _ => true,
            };
            (same_content && started_near).then_some(index)
        })
}

async fn active_run_id(state: &GatewayState, thread_id: &str, provider: &str) -> Option<String> {
    if let Ok(runs) = state.service.inner.live_runs.lock() {
        if let Some(run) = runs
            .get(thread_id)
            .filter(|run| !run.finished && run.provider == provider)
        {
            return Some(run.upstream_run_id.clone());
        }
    }
    if provider == "claude-code" {
        proxy_json(
            state,
            Method::GET,
            &format!("/api/claude/runs/active/{}", urlencoding(thread_id)),
            None,
        )
        .await
        .ok()?
        .get("runId")
        .and_then(Value::as_str)
        .map(str::to_string)
    } else {
        let values = proxy_json(state, Method::GET, "/api/agents/runtimes", None)
            .await
            .ok()?;
        values
            .get(thread_id)
            .or_else(|| {
                values
                    .as_array()?
                    .iter()
                    .find(|v| v.get("threadId").and_then(Value::as_str) == Some(thread_id))
            })
            .and_then(|v| {
                v.get("runId")
                    .or_else(|| v.get("activeRunId"))
                    .or_else(|| v.get("currentRunId"))
            })
            .and_then(Value::as_str)
            .map(str::to_string)
    }
}

fn active_run_prompt(run: &Value) -> Option<String> {
    run.get("prompt")
        .and_then(Value::as_str)
        .map(|prompt| sanitize_visible_text(prompt, 50_000))
        .filter(|prompt| !prompt.trim().is_empty())
}

fn build_bootstrap(
    workspace: Value,
    claude: Value,
    agents: Value,
    permissions: Vec<String>,
    providers: Value,
    channels: Value,
) -> Value {
    let mut runtime_by_thread = HashMap::<String, Value>::new();
    if let Some(values) = claude.as_object() {
        for (thread_id, value) in values {
            runtime_by_thread.insert(thread_id.clone(), value.clone());
        }
    } else {
        for value in claude.as_array().into_iter().flatten() {
            if let Some(id) = value.get("threadId").and_then(Value::as_str) {
                runtime_by_thread.insert(id.into(), value.clone());
            }
        }
    }
    if let Some(values) = agents.as_object() {
        for (thread_id, value) in values {
            runtime_by_thread.insert(thread_id.clone(), value.clone());
        }
    } else {
        for value in agents.as_array().into_iter().flatten() {
            if let Some(id) = value.get("threadId").and_then(Value::as_str) {
                runtime_by_thread.insert(id.into(), value.clone());
            }
        }
    }
    let mut tasks = Vec::new();
    let mut projects = Vec::new();
    for project in workspace
        .get("projects")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let project_id = string(project, "id");
        let project_name = string(project, "name");
        let mut recent = Vec::new();
        for thread in project
            .get("threads")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let id = string(thread, "id");
            let runtime = runtime_by_thread.get(&id);
            let active = runtime
                .and_then(|value| value.get("activeRun"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let phase = runtime
                .and_then(|v| v.get("phase").or_else(|| v.get("status")))
                .and_then(Value::as_str)
                .unwrap_or(if active { "running" } else { "idle" });
            let task = json!({ "threadId": id, "projectId": project_id, "projectName": project_name, "title": string(thread,"title"), "providerId": string(thread,"provider"), "providerLabel": provider_label(&string(thread,"provider")), "phase": normalize_phase(phase), "activeRunId": runtime.and_then(|v| v.get("runId").or_else(|| v.get("activeRunId")).or_else(|| v.get("currentRunId"))), "latestActivity": thread.get("lastPrompt").or_else(|| thread.get("activity")).and_then(Value::as_str).map(|value|sanitize_visible_text(value,500)), "updatedAt": thread.get("updatedAt").cloned().unwrap_or(json!("")), "model": thread.get("model"), "reasoningEffort": thread.get("reasoningEffort"), "permissionMode": thread.get("permissionMode"), "channelId": thread.get("agentChannelId"), "pendingActions": [] });
            recent.push(task.clone());
            tasks.push(task);
        }
        projects.push(json!({ "id": project_id, "name": project_name, "pathLabel": path_label(&string(project,"path")), "branch": project.get("gitBranch"), "dirty": project.get("gitDiff").and_then(|value|value.get("filesChanged")).and_then(Value::as_u64).unwrap_or(0) > 0, "runningTaskCount": recent.iter().filter(|v| matches!(v.get("phase").and_then(Value::as_str), Some("running" | "starting" | "waiting"))).count(), "recentTasks": recent }));
    }
    tasks.sort_by(|a, b| string(b, "updatedAt").cmp(&string(a, "updatedAt")));
    json!({ "computerName": computer_name(), "connected": true, "permissions": permissions, "tasks": tasks, "projects": projects, "providers": sanitize_providers(providers), "channels": sanitize_channels(channels), "unreadNotifications": 0, "eventCursor": now_ms().to_string() })
}

fn sanitize_providers(value: Value) -> Value {
    Value::Array(
        value
            .get("providers")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|provider| {
                let id = provider.get("id").and_then(Value::as_str)?;
                Some(json!({
                    "id": sanitize_visible_text(id, 120),
                    "displayName": provider.get("displayName").and_then(Value::as_str).map(|value|sanitize_visible_text(value,200)).unwrap_or_else(||provider_label(id).into()),
                    "available": provider.get("available").and_then(Value::as_bool),
                    "selectable": provider.get("selectable").and_then(Value::as_bool).unwrap_or(true),
                    "capabilities": provider.get("capabilities").cloned().unwrap_or_else(||json!({})),
                }))
            })
            .collect(),
    )
}

fn sanitize_channels(value: Value) -> Value {
    let channels = value
        .get("channels")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|channel| {
            Some(json!({
                "id": sanitize_visible_text(channel.get("id")?.as_str()?, 120),
                "providerId": sanitize_visible_text(channel.get("providerId")?.as_str()?, 120),
                "name": channel.get("name").and_then(Value::as_str).map(|value|sanitize_visible_text(value,200)).unwrap_or_else(||"CodeM 渠道".into()),
                "enabled": channel.get("enabled").and_then(Value::as_bool).unwrap_or(false),
                "isDefault": channel.get("isDefault").and_then(Value::as_bool).unwrap_or(false),
                "apiKeySaved": channel.get("apiKeySaved").and_then(Value::as_bool).unwrap_or(false),
                "models": channel.get("models").and_then(Value::as_array).map(|models| models.iter().filter(|model|model.get("enabled").and_then(Value::as_bool).unwrap_or(true)).map(|model|json!({"id":model.get("id"),"modelId":model.get("modelId"),"displayName":model.get("displayName"),"isDefault":model.get("isDefault"),"capabilities":model.get("capabilities")})).collect::<Vec<_>>()).unwrap_or_default(),
            }))
        })
        .collect::<Vec<_>>();
    let system_channels = value
        .get("systemChannels")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|channel| {
            Some(json!({
                "id": channel.get("id")?.as_str(),
                "providerId": channel.get("providerId")?.as_str(),
                "name": channel.get("name").and_then(Value::as_str).map(|value|sanitize_visible_text(value,200)).unwrap_or_else(||"系统渠道".into()),
                "configured": channel.get("configured").and_then(Value::as_bool).unwrap_or(false),
                "model": channel.get("model").and_then(Value::as_str).map(|value|sanitize_visible_text(value,200)),
                "detail": channel.get("detail").and_then(Value::as_str).map(|value|sanitize_visible_text(value,300)),
            }))
        })
        .collect::<Vec<_>>();
    json!({ "channels": channels, "systemChannels": system_channels, "defaultChannelIds": value.get("defaultChannelIds").cloned().unwrap_or_else(||json!({})) })
}

fn sanitize_model_catalog(value: Value) -> Value {
    json!({
        "providerId": value.get("providerId").and_then(Value::as_str).map(|value|sanitize_visible_text(value,120)).unwrap_or_default(),
        "defaultModelId": value.get("defaultModelId").and_then(Value::as_str).map(|value|sanitize_visible_text(value,200)),
        "models": value.get("models").and_then(Value::as_array).map(|models| models.iter().take(200).filter_map(|model| Some(json!({
            "id": sanitize_visible_text(model.get("id")?.as_str()?, 200),
            "label": model.get("label").and_then(Value::as_str).map(|value|sanitize_visible_text(value,300)).unwrap_or_default(),
            "description": model.get("description").and_then(Value::as_str).map(|value|sanitize_visible_text(value,500)),
            "contextWindowTokens": model.get("contextWindowTokens"),
            "isDefault": model.get("isDefault").and_then(Value::as_bool).unwrap_or(false),
            "defaultReasoningEffort": model.get("defaultReasoningEffort").and_then(Value::as_str),
            "supportedReasoningEfforts": model.get("supportedReasoningEfforts").cloned().unwrap_or_else(||json!([])),
        }))).collect::<Vec<_>>()).unwrap_or_default(),
    })
}

fn sanitize_claude_model_catalog(value: Value) -> Value {
    let mut models = Vec::new();
    for model in value
        .get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(50)
    {
        let Some(id) = model.get("id").and_then(Value::as_str) else {
            continue;
        };
        if id == "__default" || model.get("kind").and_then(Value::as_str) == Some("default") {
            continue;
        }
        let label = model.get("label").and_then(Value::as_str).unwrap_or(id);
        models.push(json!({
            "id": sanitize_visible_text(id, 200),
            "label": sanitize_visible_text(label, 300),
            "description": model.get("description").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 500)),
            "isDefault": false,
            "supportedReasoningEfforts": [],
        }));
        if model.get("supportsContext1m").and_then(Value::as_bool) == Some(true) {
            if let Some(context_model) = model.get("context1mModel").and_then(Value::as_str) {
                models.push(json!({
                    "id": sanitize_visible_text(context_model, 200),
                    "label": format!("{} · 1M", sanitize_visible_text(label, 260)),
                    "description": "使用 Claude Code 1M 上下文",
                    "isDefault": false,
                    "supportedReasoningEfforts": [],
                }));
            }
        }
    }
    json!({
        "providerId": "claude-code",
        "defaultModelId": Value::Null,
        "models": models,
    })
}

fn enrich_live_tasks(service: &MobileCompanionService, bootstrap: &mut Value) {
    let Ok(runs) = service.inner.live_runs.lock() else {
        return;
    };
    let Some(tasks) = bootstrap.get_mut("tasks").and_then(Value::as_array_mut) else {
        return;
    };
    for task in tasks {
        let Some(thread_id) = task.get("threadId").and_then(Value::as_str) else {
            continue;
        };
        let Some(run) = runs.get(thread_id) else {
            continue;
        };
        let mut phase = if run.finished { "done" } else { "running" };
        let mut pending = Vec::new();
        for event in &run.events {
            match event.get("type").and_then(Value::as_str) {
                Some("approval-request") => {
                    phase = "waiting";
                    if let Some(request) = event.get("request") {
                        pending.push(json!({ "id": request.get("requestId").or_else(|| request.get("id")), "type": "approval", "title": request.get("title").cloned().unwrap_or(json!("等待审批")), "description": request.get("description") }));
                    }
                }
                Some("request-user-input") => {
                    phase = "waiting";
                    if let Some(request) = event.get("request") {
                        pending.push(json!({ "id": request.get("requestId").or_else(|| request.get("id")), "type": "user-input", "title": request.get("title").or_else(|| request.get("question")).cloned().unwrap_or(json!("等待回答")), "description": request.get("description"), "options": request.get("options"), "questions": request.get("questions") }));
                    }
                }
                Some("error") => phase = "error",
                Some("stopped") => phase = "stopped",
                Some("done") => phase = "done",
                _ => {}
            }
        }
        if let Some(object) = task.as_object_mut() {
            object.insert("phase".into(), json!(phase));
            object.insert("activeRunId".into(), json!(run.run_id));
            object.insert("pendingActions".into(), Value::Array(pending));
        }
    }
}

fn sanitize_history(thread_id: &str, history: Value, before: Option<String>) -> Value {
    let turns = history
        .get("turns")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let end = before
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(turns.len())
        .min(turns.len());
    let start = end.saturating_sub(20);
    let safe_turns = turns[start..end]
        .iter()
        .enumerate()
        .map(|(index, turn)| sanitize_turn(turn, start + index))
        .collect::<Vec<_>>();
    json!({ "task": { "threadId": thread_id, "projectId":"", "projectName":"", "title":"会话", "providerId":"", "providerLabel":"Agent", "phase":"idle", "updatedAt":"", "pendingActions": [] }, "turns": safe_turns, "hasMore": start > 0, "nextCursor": if start > 0 { Some(start.to_string()) } else { None }, "liveEventCursor": 0 })
}

fn sanitize_user_content_blocks(
    content_blocks: Option<&Value>,
    legacy_attachments: Option<&Value>,
) -> Vec<Value> {
    let mut summaries = content_blocks
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(20)
        .filter_map(|block| {
            let block_type = block.get("type").and_then(Value::as_str)?;
            let id = block
                .get("id")
                .and_then(Value::as_str)
                .map(|value| sanitize_visible_text(value, 200));
            let name = block
                .get("name")
                .and_then(Value::as_str)
                .map(|value| sanitize_visible_text(value, 300));
            let mime_type = block
                .get("mimeType")
                .or_else(|| block.get("mime_type"))
                .and_then(Value::as_str)
                .map(|value| sanitize_visible_text(value, 120));
            let size = block.get("size").and_then(Value::as_u64);
            let preview_id = block
                .get("previewId")
                .and_then(Value::as_str)
                .filter(|value| mobile_preview_mime_type(value).is_some())
                .map(str::to_string)
                .or_else(|| {
                    block
                        .get("path")
                        .and_then(Value::as_str)
                        .and_then(mobile_preview_id_from_path)
                });
            match block_type {
                "text" => block.get("text").and_then(Value::as_str).map(|text| {
                    json!({ "type": "text", "text": sanitize_visible_text(text, 50_000) })
                }),
                "image" => Some(json!({
                    "type": "image",
                    "id": id,
                    "name": name.unwrap_or_else(|| "图片附件".into()),
                    "mimeType": mime_type,
                    "size": size,
                    "imageBytes": block.get("imageBytes").and_then(Value::as_u64).or(size),
                    "previewId": preview_id,
                })),
                "file_text" => Some(json!({
                    "type": "file_text",
                    "id": id,
                    "path": name.clone().unwrap_or_else(|| "文本附件".into()),
                    "name": name.unwrap_or_else(|| "文本附件".into()),
                    "mimeType": mime_type,
                    "size": size,
                    "textBytes": block.get("textBytes").and_then(Value::as_u64).or(size).unwrap_or(0),
                })),
                "file_reference" => Some(json!({
                    "type": "file_reference",
                    "id": id,
                    "path": name.clone().unwrap_or_else(|| "文件附件".into()),
                    "name": name.unwrap_or_else(|| "文件附件".into()),
                    "mimeType": mime_type,
                    "size": size,
                    "reason": block.get("reason").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 120)),
                    "source": match block.get("source").and_then(Value::as_str) {
                        Some("attachment") => Some("attachment"),
                        Some("mention") => Some("mention"),
                        _ => None,
                    },
                })),
                "attachment_metadata" => Some(json!({
                    "type": "attachment_metadata",
                    "id": id,
                    "name": name.unwrap_or_else(|| "附件".into()),
                    "mimeType": mime_type,
                    "size": size,
                    "reason": block.get("reason").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 200)).unwrap_or_else(|| "metadata_only".into()),
                })),
                _ => None,
            }
        })
        .collect::<Vec<_>>();
    if summaries.is_empty() {
        summaries.extend(
            legacy_attachments
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .take(20)
                .map(|attachment| {
                    json!({
                        "type": "image",
                        "id": attachment.get("id").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 200)),
                        "name": attachment.get("name").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 300)).unwrap_or_else(|| "图片附件".into()),
                        "mimeType": attachment.get("mimeType").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 120)),
                        "size": attachment.get("size").and_then(Value::as_u64),
                    })
                }),
        );
    }
    summaries
}

fn mobile_preview_id_from_path(value: &str) -> Option<String> {
    let preview_id = PathBuf::from(value).file_name()?.to_str()?.to_string();
    mobile_preview_mime_type(&preview_id)?;
    Some(preview_id)
}

fn sanitize_turn(turn: &Value, index: usize) -> Value {
    let mut tools = turn
        .get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .map(|(tool_index, tool)| sanitize_tool_step(tool, &format!("tool-{index}-{tool_index}")))
        .collect::<Vec<_>>();
    let mut items = Vec::new();
    let mut approvals = turn
        .get("pendingApprovalRequests")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|request| sanitize_approval_request(request, true))
        .collect::<Vec<_>>();
    let mut user_inputs = turn
        .get("pendingUserInputRequests")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(sanitize_user_input_request)
        .collect::<Vec<_>>();
    if let Some(values) = turn.get("items").and_then(Value::as_array) {
        for (item_index, item) in values.iter().enumerate() {
            let item_id = item
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("item-{index}-{item_index}"));
            match item.get("type").and_then(Value::as_str).unwrap_or("text") {
                "text" => {
                    if let Some(text) = item
                        .get("text")
                        .or_else(|| item.get("content"))
                        .and_then(Value::as_str)
                    {
                        items.push(json!({ "id": item_id, "type": "text", "text": sanitize_visible_text(text, 50_000) }));
                    }
                }
                "thinking" => {
                    if let Some(text) = item.get("text").and_then(Value::as_str) {
                        items.push(json!({ "id": item_id, "type": "thinking", "text": sanitize_visible_text(text, 50_000) }));
                    }
                }
                "tool" => {
                    let tool = item
                        .get("tool")
                        .map(|value| sanitize_tool_step(value, &item_id))
                        .unwrap_or_else(|| sanitize_tool_step(item, &item_id));
                    if !tools.iter().any(|value| value.get("id") == tool.get("id")) {
                        tools.push(tool.clone());
                    }
                    items.push(json!({ "id": item_id, "type": "tool", "tool": tool }));
                }
                "approval-request" | "approval" => {
                    if let Some(request) = item.get("request") {
                        approvals.push(sanitize_approval_request(request, true));
                    }
                }
                "request-user-input" | "user-input" => {
                    if let Some(request) = item.get("request") {
                        user_inputs.push(sanitize_user_input_request(request));
                    }
                }
                _ => {}
            }
        }
    }
    let assistant_text = turn
        .get("assistantText")
        .and_then(Value::as_str)
        .map(|value| sanitize_visible_text(value, 50_000))
        .unwrap_or_default();
    if items.is_empty() && !assistant_text.is_empty() {
        items.push(
            json!({ "id": format!("assistant-{index}"), "type": "text", "text": assistant_text }),
        );
    }
    let turn_id = turn
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("turn-{index}"));
    let user_content_blocks =
        sanitize_user_content_blocks(turn.get("userContentBlocks"), turn.get("userAttachments"));
    json!({
        "id": turn_id,
        "backendRunId": turn.get("backendRunId"),
        "userText": turn.get("userText").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 50_000)).unwrap_or_default(),
        "userContentBlocks": user_content_blocks,
        "workspace": "",
        "assistantText": assistant_text,
        "tools": tools,
        "items": items,
        "status": normalize_turn_status(turn.get("status").and_then(Value::as_str).unwrap_or("done")),
        "activity": turn.get("activity").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 500)),
        "errorMessage": turn.get("errorMessage").and_then(Value::as_str).map(|value| sanitize_runtime_message(value, 1_000)),
        "recoveryHint": turn.get("recoveryHint").map(sanitize_runtime_hint).filter(|value| !value.is_null()),
        "metrics": turn.get("metrics").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 300)),
        "phase": turn.get("phase"),
        "startedAtMs": turn.get("startedAtMs"),
        "durationMs": turn.get("durationMs"),
        "inputTokens": turn.get("inputTokens"),
        "outputTokens": turn.get("outputTokens"),
        "cacheCreationInputTokens": turn.get("cacheCreationInputTokens"),
        "cacheReadInputTokens": turn.get("cacheReadInputTokens"),
        "totalCostUsd": turn.get("totalCostUsd"),
        "thoughtCount": turn.get("thoughtCount"),
        "pendingUserInputRequests": user_inputs,
        "pendingApprovalRequests": approvals,
        "providerId": turn.get("providerId"),
        "providerName": turn.get("providerName"),
        "modelId": turn.get("modelId"),
        "modelName": turn.get("modelName"),
    })
}

fn sanitize_runtime_hint(hint: &Value) -> Value {
    let reason = match hint.get("reason").and_then(Value::as_str) {
        Some(
            value @ ("resume-session-missing"
            | "broken-pipe"
            | "runtime-ended"
            | "stale-session"
            | "transport-error"),
        ) => value,
        Some(_) => "unknown",
        None => return Value::Null,
    };
    let suggested_action = match hint.get("suggestedAction").and_then(Value::as_str) {
        Some(value @ ("retry" | "resend" | "recover")) => value,
        _ => "retry",
    };
    let source = match hint.get("source").and_then(Value::as_str) {
        Some(value @ ("status" | "stderr" | "result" | "process")) => value,
        _ => "process",
    };
    json!({
        "reason": reason,
        "message": hint
            .get("message")
            .and_then(Value::as_str)
            .map(|value| sanitize_runtime_message(value, 1_000))
            .unwrap_or_default(),
        "retryable": hint.get("retryable").and_then(Value::as_bool).unwrap_or(true),
        "suggestedAction": suggested_action,
        "source": source,
    })
}

fn sanitize_runtime_message(message: &str, max_chars: usize) -> String {
    let lower = message.to_ascii_lowercase();
    if lower.contains("no conversation found") && lower.contains("session id") {
        return "保存的 Claude 会话已失效，无法继续恢复。".into();
    }
    if lower.contains("no api key for provider route") {
        return "DeepSeek 渠道没有可用的 API Key，请在桌面端检查该渠道凭据后重试。".into();
    }
    sanitize_visible_text(message, max_chars)
}

fn events_to_turn(thread_id: &str, run: &MobileLiveRun) -> Value {
    let mut items = Vec::new();
    let mut tools = Vec::new();
    let mut approvals = Vec::new();
    let mut user_inputs = Vec::new();
    let mut assistant_text = String::new();
    let mut status = "running";
    let mut phase = Value::Null;
    let mut activity = "正在运行".to_string();
    let mut error_message = Value::Null;
    let mut recovery_hint = Value::Null;
    let mut duration_ms = Value::Null;
    let mut session_id = Value::Null;
    for (index, event) in run.events.iter().enumerate() {
        let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
        let event_text = event
            .get("text")
            .or_else(|| event.get("delta"))
            .and_then(Value::as_str)
            .unwrap_or("");
        match event_type {
            "session" => {
                session_id = event.get("sessionId").cloned().unwrap_or(Value::Null);
            }
            "status" => {
                activity = event
                    .get("message")
                    .and_then(Value::as_str)
                    .map(|value| sanitize_visible_text(value, 500))
                    .unwrap_or(activity);
            }
            "phase" => {
                phase = event.get("phase").cloned().unwrap_or(Value::Null);
                if let Some(label) = event.get("label").and_then(Value::as_str) {
                    activity = sanitize_visible_text(label, 300);
                }
            }
            "delta" => {
                let text = sanitize_visible_text(event_text, 8_000);
                assistant_text.push_str(&text);
                append_live_text(&mut items, "text", &format!("live-text-{index}"), &text);
                activity = "生成回复中".into();
            }
            "thinking-delta" => {
                append_live_text(
                    &mut items,
                    "thinking",
                    &format!("live-thinking-{index}"),
                    event_text,
                );
                activity = "思考中".into();
            }
            "tool-start" => {
                let tool = live_tool_from_event(event, index);
                activity = string(&tool, "title");
                items.push(json!({ "id": format!("live-tool-item-{index}"), "type": "tool", "tool": tool.clone() }));
                tools.push(tool);
            }
            "tool-input-delta" => update_live_tool(&mut tools, &mut items, event, |tool| {
                let current = tool.get("inputText").and_then(Value::as_str).unwrap_or("");
                let delta = event.get("text").and_then(Value::as_str).unwrap_or("");
                tool["inputText"] =
                    json!(sanitize_visible_text(&format!("{current}{delta}"), 8_000));
            }),
            "tool-stop" => update_live_tool(&mut tools, &mut items, event, |tool| {
                tool["status"] = json!("done");
            }),
            "tool-result" => update_live_tool(&mut tools, &mut items, event, |tool| {
                tool["resultText"] = json!(event
                    .get("content")
                    .and_then(Value::as_str)
                    .map(|value| sanitize_visible_text(value, 8_000))
                    .unwrap_or_default());
                let is_error = event
                    .get("isError")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                tool["isError"] = json!(is_error);
                tool["status"] = json!(if is_error { "error" } else { "done" });
            }),
            "approval-request" => {
                approvals.push(sanitize_approval_request(
                    event.get("request").unwrap_or(&Value::Null),
                    false,
                ));
                activity = "等待批准".into();
                phase = json!("requesting");
            }
            "request-user-input" => {
                user_inputs.push(sanitize_user_input_request(
                    event.get("request").unwrap_or(&Value::Null),
                ));
                activity = "等待补充信息".into();
                phase = json!("requesting");
            }
            "done" => {
                status = "done";
                activity = "运行完成".into();
                if let Some(value) = event.get("sessionId") {
                    session_id = value.clone();
                }
                duration_ms = event.get("durationMs").cloned().unwrap_or(Value::Null);
                if assistant_text.trim().is_empty() {
                    if let Some(result) = event.get("result").and_then(Value::as_str) {
                        let text = sanitize_visible_text(result, 50_000);
                        assistant_text.push_str(&text);
                        append_live_text(&mut items, "text", &format!("live-done-{index}"), &text);
                    }
                }
            }
            "stopped" => {
                status = "stopped";
                activity = "已停止".into();
            }
            "error" => {
                status = "error";
                activity = "运行失败".into();
                error_message = event
                    .get("message")
                    .and_then(Value::as_str)
                    .map(|value| json!(sanitize_runtime_message(value, 1_000)))
                    .unwrap_or(Value::Null);
            }
            "runtime-reconnect-hint" => {
                recovery_hint = event
                    .get("hint")
                    .map(sanitize_runtime_hint)
                    .unwrap_or(Value::Null);
                activity = recovery_hint
                    .get("message")
                    .and_then(Value::as_str)
                    .map(|value| sanitize_visible_text(value, 500))
                    .unwrap_or_else(|| "连接需要恢复".into());
            }
            "retryable-error" => {
                recovery_hint = event
                    .get("hint")
                    .map(sanitize_runtime_hint)
                    .unwrap_or(Value::Null);
                error_message = event
                    .get("message")
                    .and_then(Value::as_str)
                    .map(|value| json!(sanitize_runtime_message(value, 1_000)))
                    .unwrap_or_else(|| {
                        recovery_hint.get("message").cloned().unwrap_or(Value::Null)
                    });
                activity = "运行需要恢复".into();
            }
            _ => {}
        }
    }
    json!({
        "id": format!("mobile-live-{thread_id}-{}", run.run_id),
        "backendRunId": run.run_id,
        "userText": sanitize_visible_text(&run.prompt, 50_000),
        "userContentBlocks": run.user_content_blocks,
        "workspace": "",
        "assistantText": assistant_text,
        "tools": tools,
        "items": items,
        "status": status,
        "activity": activity,
        "errorMessage": error_message,
        "recoveryHint": recovery_hint,
        "phase": phase,
        "sessionId": session_id,
        "startedAtMs": run.started_at_ms,
        "durationMs": duration_ms,
        "pendingUserInputRequests": user_inputs,
        "pendingApprovalRequests": approvals,
        "providerId": run.provider,
        "providerName": provider_label(&run.provider),
    })
}

fn merge_live_turn(page: &mut Value, thread_id: &str, run: &MobileLiveRun) {
    let live_turn = events_to_turn(thread_id, run);
    let Some(turns) = page.get_mut("turns").and_then(Value::as_array_mut) else {
        return;
    };
    let matching_index = turns
        .iter()
        .rposition(|turn| is_live_turn_snapshot(turn, &live_turn, run));
    if let Some(index) = matching_index {
        turns[index] = live_turn;
    } else {
        turns.push(live_turn);
    }
}

fn is_live_turn_snapshot(turn: &Value, live_turn: &Value, run: &MobileLiveRun) -> bool {
    if turn.get("backendRunId").and_then(Value::as_str) == Some(run.run_id.as_str()) {
        return true;
    }
    let transient = matches!(
        turn.get("status").and_then(Value::as_str),
        Some("pending" | "running" | "stopped" | "error")
    );
    let same_prompt = turn.get("userText").and_then(Value::as_str)
        == live_turn.get("userText").and_then(Value::as_str);
    let started_near_run = turn
        .get("startedAtMs")
        .and_then(Value::as_i64)
        .is_some_and(|started_at_ms| started_at_ms.abs_diff(run.started_at_ms) <= 5_000);
    transient && same_prompt && started_near_run
}

fn sanitize_live_event(event: &Value, fallback_run_id: &str) -> Option<Value> {
    let event_type = event.get("type").and_then(Value::as_str)?;
    let run_id = event
        .get("runId")
        .and_then(Value::as_str)
        .unwrap_or(fallback_run_id);
    let text = event
        .get("text")
        .or_else(|| event.get("delta"))
        .and_then(Value::as_str)
        .map(|value| sanitize_visible_text(value, 8_000));
    match event_type {
        "session" => Some(json!({
            "type": "session",
            "runId": run_id,
            "sessionId": event.get("sessionId").and_then(Value::as_str).unwrap_or_default(),
        })),
        "status" => Some(
            json!({ "type": "status", "runId": run_id, "message": event.get("message").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 500)).unwrap_or_default() }),
        ),
        "phase" => Some(
            json!({ "type": "phase", "runId": run_id, "phase": event.get("phase"), "label": event.get("label").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 300)).unwrap_or_default(), "thoughtCount": event.get("thoughtCount") }),
        ),
        "delta" | "thinking-delta" => {
            Some(json!({"type":event_type,"runId":run_id,"text":text.unwrap_or_default()}))
        }
        "tool-start" => Some(json!({
            "type": "tool-start", "runId": run_id,
            "blockIndex": event.get("blockIndex").and_then(Value::as_i64).unwrap_or(0),
            "toolUseId": event.get("toolUseId"), "parentToolUseId": event.get("parentToolUseId"), "isSidechain": event.get("isSidechain"),
            "name": event.get("name").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 120)).unwrap_or_else(|| "Tool".into()),
            "input": sanitize_json_value(event.get("input").unwrap_or(&Value::Null), 0),
        })),
        "tool-input-delta" => Some(json!({
            "type": "tool-input-delta", "runId": run_id,
            "blockIndex": event.get("blockIndex").and_then(Value::as_i64).unwrap_or(0),
            "toolUseId": event.get("toolUseId"), "parentToolUseId": event.get("parentToolUseId"), "isSidechain": event.get("isSidechain"),
            "text": text.unwrap_or_default(),
        })),
        "tool-stop" => Some(json!({
            "type": "tool-stop", "runId": run_id,
            "blockIndex": event.get("blockIndex").and_then(Value::as_i64).unwrap_or(0),
            "toolUseId": event.get("toolUseId"), "parentToolUseId": event.get("parentToolUseId"), "isSidechain": event.get("isSidechain"),
        })),
        "tool-result" => Some(json!({
            "type": "tool-result", "runId": run_id,
            "toolUseId": event.get("toolUseId"), "parentToolUseId": event.get("parentToolUseId"), "isSidechain": event.get("isSidechain"),
            "content": event.get("content").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 8_000)).unwrap_or_default(),
            "isError": event.get("isError").and_then(Value::as_bool).unwrap_or(false),
        })),
        "approval-request" | "request-user-input" => {
            let request = event.get("request").unwrap_or(&Value::Null);
            Some(
                json!({"type":event_type,"runId":run_id,"request": if event_type == "approval-request" { sanitize_approval_request(request, false) } else { sanitize_user_input_request(request) }}),
            )
        }
        "runtime-reconnect-hint" => Some(json!({
            "type": "runtime-reconnect-hint",
            "runId": run_id,
            "hint": sanitize_runtime_hint(event.get("hint").unwrap_or(&Value::Null)),
        })),
        "retryable-error" => Some(json!({
            "type": "retryable-error",
            "runId": run_id,
            "message": event.get("message").and_then(Value::as_str).map(|value| sanitize_runtime_message(value, 1_000)).unwrap_or_default(),
            "hint": sanitize_runtime_hint(event.get("hint").unwrap_or(&Value::Null)),
        })),
        "done" => Some(
            json!({"type":"done","runId":run_id,"result":event.get("result").and_then(Value::as_str).map(|value|sanitize_visible_text(value,50_000)).unwrap_or_default(),"stopReason":event.get("stopReason"),"durationMs":event.get("durationMs"),"inputTokens":event.get("inputTokens"),"outputTokens":event.get("outputTokens"),"cacheCreationInputTokens":event.get("cacheCreationInputTokens"),"cacheReadInputTokens":event.get("cacheReadInputTokens"),"totalCostUsd":event.get("totalCostUsd")}),
        ),
        "stopped" => {
            Some(json!({"type":"done","runId":run_id,"result":"","stopReason":"cancelled"}))
        }
        "error" => Some(
            json!({"type":"error","runId":run_id,"message":event.get("message").and_then(Value::as_str).map(|value| sanitize_runtime_message(value, 1_000)).unwrap_or_else(||"运行失败".into())}),
        ),
        _ => None,
    }
}

fn append_live_text(items: &mut Vec<Value>, kind: &str, id: &str, text: &str) {
    if text.is_empty() {
        return;
    }
    if items
        .last()
        .and_then(|item| item.get("type"))
        .and_then(Value::as_str)
        == Some(kind)
    {
        if let Some(value) = items
            .last()
            .and_then(|item| item.get("text"))
            .and_then(Value::as_str)
        {
            let next = format!("{value}{text}");
            if let Some(item) = items.last_mut() {
                item["text"] = json!(sanitize_visible_text(&next, 50_000));
            }
        }
        return;
    }
    items.push(json!({"id":id,"type":kind,"text":sanitize_visible_text(text, 50_000)}));
}

fn sanitize_tool_step(tool: &Value, fallback_id: &str) -> Value {
    let id = tool
        .get("id")
        .or_else(|| tool.get("toolUseId"))
        .and_then(Value::as_str)
        .unwrap_or(fallback_id);
    let name = tool.get("name").and_then(Value::as_str).unwrap_or("Tool");
    let title = tool.get("title").and_then(Value::as_str).unwrap_or(name);
    let status = match tool.get("status").and_then(Value::as_str) {
        Some("running") => "running",
        Some("error") => "error",
        _ => "done",
    };
    let subtools = tool
        .get("subtools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .take(20)
        .map(|(index, value)| sanitize_tool_step(value, &format!("{id}-sub-{index}")))
        .collect::<Vec<_>>();
    json!({
        "id": sanitize_visible_text(id, 200),
        "name": sanitize_visible_text(name, 120),
        "title": sanitize_visible_text(title, 200),
        "status": status,
        "blockIndex": tool.get("blockIndex"),
        "toolUseId": tool.get("toolUseId").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 200)),
        "parentToolUseId": tool.get("parentToolUseId").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 200)),
        "isSidechain": tool.get("isSidechain").and_then(Value::as_bool).unwrap_or(false),
        "inputText": tool.get("inputText").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 8_000)),
        "resultText": tool.get("resultText").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 8_000)),
        "isError": tool.get("isError").and_then(Value::as_bool).unwrap_or(status == "error"),
        "subtools": subtools,
        "subMessages": tool.get("subMessages").and_then(Value::as_array).map(|values| values.iter().filter_map(Value::as_str).take(20).map(|value| sanitize_visible_text(value, 1_000)).collect::<Vec<_>>()).unwrap_or_default(),
    })
}

fn sanitize_approval_request(request: &Value, historical: bool) -> Value {
    let commands = request
        .get("command")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .take(20)
                .map(|value| sanitize_visible_text(value, 1_000))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "requestId": request.get("requestId").or_else(|| request.get("id")).and_then(Value::as_str).map(|value| sanitize_visible_text(value, 200)),
        "kind": request.get("kind").and_then(Value::as_str),
        "title": request.get("title").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 300)).unwrap_or_else(|| "等待审批".into()),
        "description": request.get("description").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 1_000)),
        "command": commands,
        "danger": request.get("danger").and_then(Value::as_str),
        "options": request.get("options").and_then(Value::as_array).map(|values| values.iter().take(10).map(|option| json!({ "id": option.get("id").and_then(Value::as_str).map(|value|sanitize_visible_text(value,120)), "label": option.get("label").and_then(Value::as_str).map(|value|sanitize_visible_text(value,200)), "kind": option.get("kind").and_then(Value::as_str).map(|value|sanitize_visible_text(value,120)) })).collect::<Vec<_>>()).unwrap_or_default(),
        "historical": historical,
    })
}

fn sanitize_user_input_request(request: &Value) -> Value {
    let questions = request
        .get("questions")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .take(20)
                .map(|question| {
                    let options = question
                        .get("options")
                        .and_then(Value::as_array)
                        .map(|values| {
                            values
                                .iter()
                                .take(20)
                                .map(|option| {
                                    if let Some(label) = option.as_str() {
                                        json!({ "label": sanitize_visible_text(label, 300), "value": sanitize_visible_text(label, 300) })
                                    } else {
                                        json!({
                                            "label": option.get("label").and_then(Value::as_str).map(|value|sanitize_visible_text(value,300)).unwrap_or_default(),
                                            "value": option.get("value").and_then(Value::as_str).map(|value|sanitize_visible_text(value,300)),
                                            "description": option.get("description").and_then(Value::as_str).map(|value|sanitize_visible_text(value,500)),
                                        })
                                    }
                                })
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    json!({
                        "id": question.get("id").and_then(Value::as_str).map(|value|sanitize_visible_text(value,120)),
                        "header": question.get("header").and_then(Value::as_str).map(|value|sanitize_visible_text(value,200)),
                        "question": question.get("question").and_then(Value::as_str).map(|value|sanitize_visible_text(value,500)).unwrap_or_else(||"请补充信息".into()),
                        "inputType": question.get("inputType").and_then(Value::as_str),
                        "options": options,
                        "multiSelect": question.get("multiSelect").and_then(Value::as_bool).unwrap_or(false),
                        "required": question.get("required").and_then(Value::as_bool).unwrap_or(false),
                        "secret": question.get("secret").and_then(Value::as_bool).unwrap_or(false),
                        "isOther": question.get("isOther").and_then(Value::as_bool).unwrap_or(false),
                        "placeholder": question.get("placeholder").and_then(Value::as_str).map(|value|sanitize_visible_text(value,300)),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| {
            vec![json!({
                "id": "answer",
                "header": request.get("title").and_then(Value::as_str).map(|value|sanitize_visible_text(value,200)),
                "question": request.get("description").or_else(||request.get("title")).and_then(Value::as_str).map(|value|sanitize_visible_text(value,500)).unwrap_or_else(||"请补充信息".into()),
                "options": request.get("options").and_then(Value::as_array).map(|values|values.iter().filter_map(Value::as_str).take(20).map(|value|json!({"label":sanitize_visible_text(value,300),"value":sanitize_visible_text(value,300)})).collect::<Vec<_>>()).unwrap_or_default(),
            })]
        });
    json!({
        "requestId": request.get("requestId").or_else(|| request.get("id")).and_then(Value::as_str).map(|value| sanitize_visible_text(value, 200)),
        "title": request.get("title").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 300)),
        "description": request.get("description").and_then(Value::as_str).map(|value| sanitize_visible_text(value, 1_000)),
        "questions": questions,
        "readyAtMs": request.get("readyAtMs"),
    })
}

fn normalize_turn_status(value: &str) -> &'static str {
    match value {
        "pending" => "pending",
        "running" => "running",
        "error" => "error",
        "stopped" => "stopped",
        _ => "done",
    }
}

fn live_tool_from_event(event: &Value, index: usize) -> Value {
    let tool_use_id = event
        .get("toolUseId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let id = tool_use_id
        .clone()
        .unwrap_or_else(|| format!("live-tool-{index}"));
    let name = event.get("name").and_then(Value::as_str).unwrap_or("Tool");
    let input_text = event
        .get("input")
        .map(|value| sanitize_json_value(value, 0))
        .and_then(|value| serde_json::to_string(&value).ok())
        .map(|value| sanitize_visible_text(&value, 8_000));
    json!({
        "id": id,
        "name": sanitize_visible_text(name, 120),
        "title": event.get("title").and_then(Value::as_str).map(|value|sanitize_visible_text(value,200)).unwrap_or_else(||sanitize_visible_text(name,200)),
        "status": "running",
        "blockIndex": event.get("blockIndex"),
        "toolUseId": tool_use_id,
        "parentToolUseId": event.get("parentToolUseId").and_then(Value::as_str).map(|value|sanitize_visible_text(value,200)),
        "isSidechain": event.get("isSidechain").and_then(Value::as_bool).unwrap_or(false),
        "inputText": input_text,
    })
}

fn update_live_tool(
    tools: &mut [Value],
    items: &mut [Value],
    event: &Value,
    update: impl FnOnce(&mut Value),
) {
    let tool_use_id = event.get("toolUseId").and_then(Value::as_str);
    let block_index = event.get("blockIndex").and_then(Value::as_i64);
    let Some(index) = tools.iter().rposition(|tool| {
        tool_use_id.is_some_and(|id| tool.get("toolUseId").and_then(Value::as_str) == Some(id))
            || block_index
                .is_some_and(|value| tool.get("blockIndex").and_then(Value::as_i64) == Some(value))
    }) else {
        return;
    };
    update(&mut tools[index]);
    let tool_id = tools[index].get("id").and_then(Value::as_str);
    if let Some(item) = items.iter_mut().find(|item| {
        item.get("tool")
            .and_then(|tool| tool.get("id"))
            .and_then(Value::as_str)
            == tool_id
    }) {
        item["tool"] = tools[index].clone();
    }
}

fn sanitize_json_value(value: &Value, depth: usize) -> Value {
    if depth > 5 {
        return json!("[内容已截断]");
    }
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => value.clone(),
        Value::String(text) => json!(sanitize_visible_text(text, 2_000)),
        Value::Array(values) => Value::Array(
            values
                .iter()
                .take(50)
                .map(|value| sanitize_json_value(value, depth + 1))
                .collect(),
        ),
        Value::Object(values) => {
            let mut safe = serde_json::Map::new();
            for (key, value) in values.iter().take(50) {
                let lower = key.to_ascii_lowercase();
                if lower.contains("key")
                    || lower.contains("token")
                    || lower.contains("secret")
                    || lower.contains("authorization")
                    || lower.contains("environment")
                    || lower == "env"
                {
                    safe.insert(key.clone(), json!("[敏感内容已隐藏]"));
                } else {
                    safe.insert(key.clone(), sanitize_json_value(value, depth + 1));
                }
            }
            Value::Object(safe)
        }
    }
}

fn sanitize_visible_text(value: &str, max_chars: usize) -> String {
    let mut safe = value
        .lines()
        .map(|line| {
            let lower = line.to_ascii_lowercase();
            if lower.contains("api_key")
                || lower.contains("apikey")
                || lower.contains("authorization: bearer")
                || lower.contains("anthropic_api_key")
                || lower.contains("openai_api_key")
            {
                "[敏感内容已隐藏]".to_string()
            } else {
                redact_absolute_paths(line)
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    if safe.chars().count() > max_chars {
        safe = safe.chars().take(max_chars).collect::<String>();
        safe.push_str("\n[内容已截断]");
    }
    safe
}

fn redact_absolute_paths(line: &str) -> String {
    line.split_whitespace()
        .map(|token| {
            let candidate = token.trim_matches(|value: char| {
                matches!(
                    value,
                    '"' | '\'' | '`' | '(' | ')' | '[' | ']' | '{' | '}' | ',' | ';'
                )
            });
            let bytes = candidate.as_bytes();
            let windows_absolute = bytes.len() > 2
                && bytes[0].is_ascii_alphabetic()
                && bytes[1] == b':'
                && matches!(bytes[2], b'\\' | b'/');
            let unix_absolute = candidate.starts_with("/Users/")
                || candidate.starts_with("/home/")
                || candidate.starts_with("/var/")
                || candidate.starts_with("/tmp/");
            if windows_absolute || unix_absolute || candidate.starts_with("file://") {
                let normalized = candidate.replace('\\', "/");
                let name = normalized
                    .trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .unwrap_or("路径");
                format!("[项目路径]/{name}")
            } else {
                token.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn authenticate(
    service: &MobileCompanionService,
    headers: &HeaderMap,
    permission: &str,
) -> Result<PairedDevice, Response> {
    let token = bearer(headers)
        .or_else(|| cookie(headers, DEVICE_COOKIE))
        .ok_or_else(|| error(StatusCode::UNAUTHORIZED, "设备未登录"))?;
    let token_hash = hash(&token);
    let mut state = service
        .inner
        .state
        .lock()
        .map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "认证状态不可用"))?;
    let device = state
        .devices
        .iter_mut()
        .find(|d| d.revoked_at_ms.is_none() && constant_time_eq(&d.token_hash, &token_hash))
        .ok_or_else(|| error(StatusCode::UNAUTHORIZED, "设备凭据无效"))?;
    if !device.permissions.iter().any(|v| v == permission) {
        return Err(error(StatusCode::FORBIDDEN, "设备没有此操作权限"));
    }
    device.last_seen_at_ms = now_ms();
    Ok(device.clone())
}

fn public_device(device: PairedDevice) -> Value {
    json!({ "id": device.id, "name": device.name, "permissions": device.permissions, "createdAt": device.created_at_ms, "lastSeenAt": device.last_seen_at_ms, "revoked": device.revoked_at_ms.is_some() })
}
fn bearer(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::to_string)
}
fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|v| {
            let (k, v) = v.trim().split_once('=')?;
            (k == name).then(|| v.to_string())
        })
}
fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error":message}))).into_response()
}
fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::encode_b64(&Uuid::new_v4().into_bytes())
        .map_err(|error| format!("生成密码盐失败: {error}"))?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|value| value.to_string())
        .map_err(|error| format!("生成密码哈希失败: {error}"))
}

fn verify_password(encoded_hash: &str, password: &str) -> bool {
    PasswordHash::new(encoded_hash).ok().is_some_and(|parsed| {
        Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok()
    })
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes()
        .zip(b.bytes())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn computer_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "CodeM 电脑".into())
}
fn tailscale_ip() -> Option<Ipv4Addr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    // 100.100.100.100 is Tailscale's tailnet DNS address. A UDP connect is
    // enough to ask Windows which interface would route traffic there.
    socket.connect("100.100.100.100:53").ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if is_tailscale_ip(ip) => Some(ip),
        _ => None,
    }
}

fn is_tailscale_ip(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    octets[0] == 100 && (64..=127).contains(&octets[1])
}

fn is_private_lan_ip(ip: Ipv4Addr) -> bool {
    ip.is_private()
}

fn mobile_addresses(port: u16) -> Vec<MobileAccessAddress> {
    let mut addresses = get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|interface| {
            if is_virtual_network_interface(&interface.name) {
                return None;
            }
            match interface.ip() {
                IpAddr::V4(ip) if is_private_lan_ip(ip) || is_tailscale_ip(ip) => Some(ip),
                _ => None,
            }
        })
        .collect::<Vec<_>>();
    if let Some(ip) = tailscale_ip() {
        addresses.push(ip);
    }
    format_mobile_addresses(addresses, port)
}

fn format_mobile_addresses(mut addresses: Vec<Ipv4Addr>, port: u16) -> Vec<MobileAccessAddress> {
    addresses.sort_by_key(|ip| (is_tailscale_ip(*ip), *ip));
    addresses.dedup();
    addresses
        .into_iter()
        .map(|ip| MobileAccessAddress {
            address: format!("http://{ip}:{port}"),
            kind: if is_tailscale_ip(ip) {
                "tailscale"
            } else {
                "lan"
            },
        })
        .collect()
}

fn is_virtual_network_interface(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    [
        "vethernet",
        "vmware",
        "vmnet",
        "virtualbox",
        "hyper-v",
        "wsl",
        "docker",
    ]
    .iter()
    .any(|marker| name.contains(marker))
}

fn write_mobile_companion_state(
    destination: &std::path::Path,
    contents: &[u8],
) -> Result<(), String> {
    let parent = destination
        .parent()
        .ok_or_else(|| "移动伴侣配置路径无效".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("创建配置目录失败: {error}"))?;
    let temporary = parent.join(format!(".mobile-companion-{}.tmp", Uuid::new_v4()));
    let write_result = (|| -> Result<(), String> {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| format!("创建临时配置失败: {error}"))?;
        file.write_all(contents)
            .map_err(|error| format!("写入临时配置失败: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("同步临时配置失败: {error}"))
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    replace_mobile_companion_state(&temporary, destination)
}

fn replace_mobile_companion_state(
    temporary: &std::path::Path,
    destination: &std::path::Path,
) -> Result<(), String> {
    match fs::rename(temporary, destination) {
        Ok(()) => return Ok(()),
        Err(error) if !destination.exists() => {
            return Err(format!("保存移动伴侣配置失败: {error}"));
        }
        Err(_) => {}
    }

    let backup = destination.with_extension(format!("json.{}.bak", Uuid::new_v4()));
    fs::rename(destination, &backup).map_err(|error| format!("备份旧移动伴侣配置失败: {error}"))?;
    match fs::rename(temporary, destination) {
        Ok(()) => {
            let _ = fs::remove_file(backup);
            Ok(())
        }
        Err(error) => match fs::rename(&backup, destination) {
            Ok(()) => Err(format!("保存移动伴侣配置失败: {error}")),
            Err(rollback_error) => Err(format!(
                "保存移动伴侣配置失败: {error}；恢复旧配置失败: {rollback_error}"
            )),
        },
    }
}

fn firewall_state(port: u16) -> &'static str {
    #[cfg(windows)]
    {
        let mut command = Command::new("netsh");
        command.creation_flags(CREATE_NO_WINDOW);
        let output = command
            .args([
                "advfirewall",
                "firewall",
                "show",
                "rule",
                &format!("name={FIREWALL_RULE_NAME}"),
            ])
            .output();
        if output.is_ok_and(|value| {
            value.status.success() && firewall_rule_is_scoped(&value.stdout, port)
        }) {
            "configured"
        } else {
            "manual"
        }
    }
    #[cfg(not(windows))]
    {
        let _ = port;
        "not-required"
    }
}

fn firewall_rule_is_scoped(output: &[u8], port: u16) -> bool {
    let output = String::from_utf8_lossy(output).to_ascii_lowercase();
    output.contains(&port.to_string())
        && output.contains("localsubnet")
        && output.contains("100.64.0.0")
}

fn configure_firewall(port: u16, enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let port = port.to_string();
        let mut command = Command::new("netsh");
        command.creation_flags(CREATE_NO_WINDOW);
        command.args(["advfirewall", "firewall"]);
        if enabled {
            let mut delete_command = Command::new("netsh");
            delete_command.creation_flags(CREATE_NO_WINDOW);
            let _ = delete_command
                .args([
                    "advfirewall",
                    "firewall",
                    "delete",
                    "rule",
                    &format!("name={FIREWALL_RULE_NAME}"),
                ])
                .output();
            command.args([
                "add",
                "rule",
                &format!("name={FIREWALL_RULE_NAME}"),
                "dir=in",
                "action=allow",
                "protocol=TCP",
                &format!("localport={port}"),
                "remoteip=localsubnet,100.64.0.0/10",
                "profile=any",
            ]);
        } else {
            command.args([
                "delete",
                "rule",
                &format!("name={FIREWALL_RULE_NAME}"),
                &format!("localport={port}"),
            ]);
        }
        let output = command
            .output()
            .map_err(|error| format!("执行 Windows 防火墙配置失败: {error}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (port, enabled);
        Ok(())
    }
}

fn remove_live_run_if_matches(
    runs: &mut HashMap<String, MobileLiveRun>,
    thread_id: &str,
    run_id: &str,
) {
    if runs.get(thread_id).is_some_and(|run| run.run_id == run_id) {
        runs.remove(thread_id);
    }
}
fn resolve_static_dir() -> PathBuf {
    if let Ok(path) = std::env::var("CODEM_MOBILE_STATIC_DIR").map(PathBuf::from) {
        if path.join("index.html").is_file() {
            return path;
        }
    }
    let mut candidates = Vec::new();
    if let Ok(current) = std::env::current_dir() {
        candidates.push(current.join("dist"));
        candidates.push(current.join("..").join("dist"));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.join("dist"));
            candidates.push(parent.join("resources").join("dist"));
            candidates.push(parent.join("..").join("..").join("..").join("dist"));
        }
    }
    candidates
        .into_iter()
        .find(|path| path.join("index.html").is_file())
        .unwrap_or_else(|| PathBuf::from("dist"))
}
fn string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}
fn path_label(path: &str) -> String {
    path.replace('\\', "/")
        .split('/')
        .rev()
        .take(2)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("/")
}
fn provider_label(id: &str) -> &str {
    match id {
        "claude-code" => "Claude Code",
        "openai-codex" => "Codex",
        "opencode" => "OpenCode",
        "grok" => "Grok Build",
        _ => "Agent",
    }
}
fn normalize_phase(value: &str) -> &str {
    match value {
        "running" | "thinking" | "responding" => "running",
        "starting" => "starting",
        "waiting" | "paused" => "waiting",
        "error" | "failed" => "error",
        "done" | "completed" => "done",
        "stopped" | "cancelled" => "stopped",
        _ => "idle",
    }
}
fn prompt_title(value: &str) -> String {
    value.chars().take(36).collect()
}
fn urlencoding(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}
fn find_thread(workspace: &Value, thread_id: &str) -> Option<(String, String, Value)> {
    for project in workspace.get("projects")?.as_array()? {
        for thread in project.get("threads")?.as_array()? {
            if thread.get("id")?.as_str()? == thread_id {
                return Some((
                    string(thread, "provider"),
                    string(project, "path"),
                    thread.clone(),
                ));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;
    use tower::ServiceExt;
    #[test]
    fn token_hash_comparison_is_exact() {
        assert!(constant_time_eq(&hash("a"), &hash("a")));
        assert!(!constant_time_eq(&hash("a"), &hash("b")));
    }

    #[test]
    fn password_hash_verifies_only_the_original_password() {
        let encoded = hash_password("correct horse battery").unwrap();
        assert!(encoded.starts_with("$argon2id$"));
        assert!(verify_password(&encoded, "correct horse battery"));
        assert!(!verify_password(&encoded, "wrong password"));
    }

    #[tokio::test]
    async fn admin_password_persists_hash_and_rolls_back_when_storage_fails() {
        let directory =
            std::env::temp_dir().join(format!("codem-mobile-password-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let service = MobileCompanionService::new(directory.clone(), 3999, None);
        let response = service
            .admin_router()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/mobile-companion/password")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"password":"saved-password"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let persisted: PersistedState =
            serde_json::from_slice(&fs::read(directory.join("mobile-companion.json")).unwrap())
                .unwrap();
        assert!(verify_password(
            persisted.password_hash.as_deref().unwrap(),
            "saved-password"
        ));

        let invalid_directory = directory.join("not-a-directory");
        fs::write(&invalid_directory, b"file").unwrap();
        let failing_service = MobileCompanionService::new(invalid_directory, 3999, None);
        let response = failing_service
            .admin_router()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/mobile-companion/password")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"password":"unsaved-password"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert!(failing_service
            .inner
            .state
            .lock()
            .unwrap()
            .password_hash
            .is_none());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn desktop_proxy_includes_runtime_authorization() {
        let directory = std::env::temp_dir().join(format!("codem-mobile-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let service =
            MobileCompanionService::new(directory.clone(), 3999, Some("runtime-secret".into()));
        let request = authorize_desktop_request(
            &service,
            reqwest::Client::new().get("http://127.0.0.1:3999/api/health"),
        )
        .build()
        .unwrap();
        assert_eq!(
            request.headers().get(header::AUTHORIZATION).unwrap(),
            "Bearer runtime-secret"
        );
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn mobile_stop_marks_only_the_claude_proxy_request() {
        assert_eq!(
            mobile_stop_internal_headers("claude-code"),
            &[("x-codem-mobile-stop", "1")]
        );
        assert!(mobile_stop_internal_headers("openai-codex").is_empty());
    }

    #[test]
    fn mobile_content_security_policy_allows_local_attachment_previews_only() {
        assert!(MOBILE_CONTENT_SECURITY_POLICY.contains("img-src 'self' data: blob:"));
        assert!(!MOBILE_CONTENT_SECURITY_POLICY.contains("img-src *"));
        assert!(!MOBILE_CONTENT_SECURITY_POLICY.contains("img-src 'self' data: blob: https:"));
    }

    #[test]
    fn mobile_content_security_policy_allows_embedded_browser_pages() {
        assert!(MOBILE_CONTENT_SECURITY_POLICY.contains("frame-src 'self' http: https:"));
    }

    #[test]
    fn mobile_request_limit_allows_common_image_payloads_without_unbounded_uploads() {
        assert!(MOBILE_MAX_REQUEST_BYTES > 2 * 1024 * 1024);
        assert_eq!(MOBILE_MAX_REQUEST_BYTES, 16 * 1024 * 1024);
        assert_eq!(MOBILE_MAX_IMAGE_BYTES, 12 * 1024 * 1024);
    }

    #[test]
    fn mobile_image_attachment_is_saved_with_an_opaque_preview_id() {
        let root = std::env::temp_dir().join(format!("codem-mobile-image-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let bytes = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01];
        let stored = save_mobile_image_attachment(
            root.to_str().unwrap(),
            "image/png",
            &general_purpose::STANDARD.encode(bytes),
        )
        .unwrap();
        let preview_id = stored.path.file_name().unwrap().to_str().unwrap();
        assert_eq!(mobile_preview_mime_type(preview_id), Some("image/png"));
        assert_eq!(stored.size, bytes.len());
        assert!(stored.path.starts_with(root.join(".codem-attachments")));

        let summary = sanitize_user_content_blocks(
            Some(&json!([{
                "type": "image",
                "id": "image-1",
                "path": stored.path,
                "name": "photo.png",
                "mimeType": "image/png",
                "size": bytes.len(),
                "data": "private-base64"
            }])),
            None,
        );
        assert_eq!(summary[0]["previewId"], preview_id);
        assert!(!summary[0].to_string().contains(root.to_str().unwrap()));
        assert!(!summary[0].to_string().contains("private-base64"));
        let roundtrip = sanitize_user_content_blocks(Some(&json!(summary)), None);
        assert_eq!(roundtrip[0]["previewId"], preview_id);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn mobile_attachment_lookup_stays_inside_known_project_attachment_directories() {
        let root = std::env::temp_dir().join(format!("codem-mobile-preview-{}", Uuid::new_v4()));
        let project = root.join("project");
        let attachments = project.join(".codem-attachments");
        fs::create_dir_all(&attachments).unwrap();
        let preview_id = format!("{}.png", Uuid::new_v4());
        let expected = attachments.join(&preview_id);
        fs::write(&expected, [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]).unwrap();
        let workspace = json!({ "projects": [
            { "path": root.join("missing") },
            { "path": project }
        ] });
        assert_eq!(
            find_mobile_attachment(&workspace, &preview_id),
            fs::canonicalize(expected).ok()
        );
        assert!(find_mobile_attachment(&workspace, "../secret.png").is_none());
        assert!(find_mobile_attachment(&workspace, "not-a-uuid.png").is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn live_event_ids_keep_run_identity_and_offset() {
        assert_eq!(
            parse_live_event_id(&live_event_id("run-2", 17)),
            Some(("run-2".to_string(), 17))
        );
        assert_eq!(parse_live_event_id("17"), None);
        assert_eq!(parse_live_event_id("run-2|invalid"), None);
    }

    #[test]
    fn runtime_signature_is_stable_and_tracks_meaningful_state_changes() {
        let claude = json!({
            "thread-b": { "threadId": "thread-b", "activeRun": false, "pid": 9 },
            "thread-a": { "threadId": "thread-a", "activeRun": true, "currentRunId": "run-a", "phase": "running", "pid": 8 }
        });
        let agents = json!({
            "thread-c": { "threadId": "thread-c", "phase": "running", "currentRunId": "run-c", "lastError": null }
        });
        let baseline = runtime_status_signature(&claude, &agents);
        let reordered_with_unrelated_changes = runtime_status_signature(
            &json!({
                "thread-a": { "pid": 99, "phase": "running", "currentRunId": "run-a", "activeRun": true, "threadId": "thread-a" },
                "thread-b": { "pid": 10, "activeRun": false, "threadId": "thread-b" }
            }),
            &json!({
                "thread-c": { "lastError": "ignored", "currentRunId": "run-c", "phase": "running", "threadId": "thread-c" }
            }),
        );
        assert_eq!(baseline, reordered_with_unrelated_changes);

        let waiting = runtime_status_signature(
            &claude,
            &json!({ "thread-c": { "threadId": "thread-c", "phase": "waiting", "currentRunId": "run-c" } }),
        );
        assert_ne!(baseline, waiting);
        assert_ne!(baseline, runtime_status_signature(&json!({}), &json!({})));
    }

    #[test]
    fn bootstrap_reads_object_shaped_claude_runtime_statuses() {
        let bootstrap = build_bootstrap(
            json!({ "projects": [{
                "id": "project",
                "name": "Project",
                "path": "D:/Project",
                "threads": [{ "id": "thread", "title": "Task", "provider": "claude-code" }]
            }] }),
            json!({ "thread": {
                "threadId": "thread",
                "activeRun": true,
                "currentRunId": "run",
                "phase": "running"
            } }),
            json!({}),
            vec!["view".to_string()],
            json!({ "providers": [] }),
            json!({ "channels": [] }),
        );
        assert_eq!(bootstrap["tasks"][0]["phase"], "running");
        assert_eq!(bootstrap["tasks"][0]["activeRunId"], "run");
        assert_eq!(bootstrap["projects"][0]["runningTaskCount"], 1);
    }

    #[test]
    fn path_summary_drops_absolute_prefix() {
        assert_eq!(path_label("D:\\Projects\\codem"), "Projects/codem");
    }

    #[test]
    fn authentication_checks_permission_and_revocation() {
        let directory = std::env::temp_dir().join(format!("codem-mobile-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let service = MobileCompanionService::new(directory.clone(), 3999, None);
        let token = "device-secret";
        service
            .inner
            .state
            .lock()
            .unwrap()
            .devices
            .push(PairedDevice {
                id: "device".into(),
                name: "phone".into(),
                token_hash: hash(token),
                permissions: vec!["view".into()],
                created_at_ms: now_ms(),
                last_seen_at_ms: now_ms(),
                revoked_at_ms: None,
            });
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_str(&format!("{DEVICE_COOKIE}={token}")).unwrap(),
        );
        assert!(authenticate(&service, &headers, "view").is_ok());
        assert!(authenticate(&service, &headers, "stop").is_err());
        service.inner.state.lock().unwrap().devices[0].revoked_at_ms = Some(now_ms());
        assert!(authenticate(&service, &headers, "view").is_err());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn mobile_origin_requires_matching_http_host() {
        assert!(is_allowed_mobile_origin(
            "http://100.108.151.13:3210",
            "100.108.151.13:3210"
        ));
        assert!(!is_allowed_mobile_origin(
            "https://100.108.151.13:3210",
            "100.108.151.13:3210"
        ));
        assert!(!is_allowed_mobile_origin(
            "http://100.108.151.14:3210",
            "100.108.151.13:3210"
        ));
        assert!(!is_allowed_mobile_origin(
            "http://evil.example:3210",
            "192.168.1.5:3210"
        ));
    }

    #[test]
    fn mobile_request_host_accepts_absolute_http_authority_without_host_header() {
        let request = Request::builder()
            .uri("http://100.108.151.13:3210/assets/mobile.js")
            .body(Body::empty())
            .unwrap();
        assert_eq!(mobile_request_host(&request), Some("100.108.151.13:3210"));
    }

    #[test]
    fn mobile_access_classifies_private_lan_and_tailscale_addresses() {
        assert!(is_tailscale_ip("100.64.0.1".parse().unwrap()));
        assert!(is_tailscale_ip("100.127.255.254".parse().unwrap()));
        assert!(!is_tailscale_ip("100.63.255.254".parse().unwrap()));
        assert!(!is_tailscale_ip("192.168.31.160".parse().unwrap()));
        assert!(is_private_lan_ip("10.20.30.40".parse().unwrap()));
        assert!(is_private_lan_ip("172.16.0.1".parse().unwrap()));
        assert!(is_private_lan_ip("192.168.31.160".parse().unwrap()));
        assert!(!is_private_lan_ip("8.8.8.8".parse().unwrap()));
        assert!(is_virtual_network_interface("vEthernet (Default Switch)"));
        assert!(is_virtual_network_interface(
            "VMware Network Adapter VMnet8"
        ));
        assert!(!is_virtual_network_interface("WLAN"));
        assert!(!is_virtual_network_interface("Tailscale"));

        let addresses = format_mobile_addresses(
            vec![
                "100.108.151.13".parse().unwrap(),
                "192.168.31.160".parse().unwrap(),
                "192.168.31.160".parse().unwrap(),
            ],
            3210,
        );
        assert_eq!(addresses.len(), 2);
        assert_eq!(addresses[0].kind, "lan");
        assert_eq!(addresses[0].address, "http://192.168.31.160:3210");
        assert_eq!(addresses[1].kind, "tailscale");
    }

    #[test]
    fn mobile_companion_state_write_replaces_existing_file_and_reports_invalid_parent() {
        let root = std::env::temp_dir().join(format!("codem-mobile-state-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let destination = root.join("mobile-companion.json");
        write_mobile_companion_state(&destination, br#"{"enabled":false}"#).unwrap();
        write_mobile_companion_state(&destination, br#"{"enabled":true}"#).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), br#"{"enabled":true}"#);

        let invalid_parent = root.join("not-a-directory");
        fs::write(&invalid_parent, b"file").unwrap();
        assert!(write_mobile_companion_state(&invalid_parent.join("state.json"), b"{}").is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn firewall_rule_requires_local_subnet_and_tailscale_scope() {
        assert!(firewall_rule_is_scoped(
            b"LocalPort: 3210\nRemoteIP: LocalSubnet,100.64.0.0/10",
            3210,
        ));
        assert!(!firewall_rule_is_scoped(
            b"LocalPort: 3210\nRemoteIP: Any",
            3210,
        ));
        assert!(!firewall_rule_is_scoped(
            b"LocalPort: 3211\nRemoteIP: LocalSubnet,100.64.0.0/10",
            3210,
        ));
    }

    #[test]
    fn live_events_keep_text_and_thinking_in_event_order() {
        let run = MobileLiveRun {
            run_id: "run".into(),
            upstream_run_id: "run".into(),
            provider: "claude-code".into(),
            prompt: "问题".into(),
            user_content_blocks: Vec::new(),
            started_at_ms: now_ms(),
            events: vec![
                json!({"type":"thinking-delta","text":"先"}),
                json!({"type":"thinking-delta","text":"想"}),
                json!({"type":"delta","text":"答"}),
                json!({"type":"tool-start","name":"Read","blockIndex":0}),
                json!({"type":"delta","text":"案"}),
            ],
            finished: false,
        };
        let turn = events_to_turn("thread", &run);
        let items = turn["items"].as_array().unwrap();
        assert_eq!(items[0]["type"], "thinking");
        assert_eq!(items[0]["text"], "先想");
        assert_eq!(items[1]["type"], "text");
        assert_eq!(items[1]["text"], "答");
        assert_eq!(items[2]["type"], "tool");
        assert_eq!(items[3]["type"], "text");
        assert_eq!(items[3]["text"], "案");
    }

    #[test]
    fn live_image_only_turn_keeps_a_safe_user_attachment_summary() {
        let run = MobileLiveRun {
            run_id: "run".into(),
            upstream_run_id: "run".into(),
            provider: "claude-code".into(),
            prompt: String::new(),
            user_content_blocks: sanitize_user_content_blocks(
                Some(&json!([{
                    "type": "image",
                    "id": "image-1",
                    "name": "wallpaper.png",
                    "mimeType": "image/png",
                    "size": 2048,
                    "data": "private-base64"
                }])),
                None,
            ),
            started_at_ms: now_ms(),
            events: vec![json!({"type":"status","message":"正在运行"})],
            finished: false,
        };

        let turn = events_to_turn("thread", &run);
        assert_eq!(turn["userText"], "");
        assert_eq!(turn["userContentBlocks"][0]["type"], "image");
        assert_eq!(turn["userContentBlocks"][0]["name"], "wallpaper.png");
        assert!(!turn.to_string().contains("private-base64"));
    }

    #[test]
    fn live_turn_replaces_matching_transient_history_snapshot() {
        let run = MobileLiveRun {
            run_id: "new-run".into(),
            upstream_run_id: "new-run".into(),
            provider: "claude-code".into(),
            prompt: "继续".into(),
            user_content_blocks: Vec::new(),
            started_at_ms: 10_000,
            events: vec![json!({"type":"status","message":"正在运行"})],
            finished: false,
        };
        let mut page = json!({
            "turns": [
                {"id":"previous","userText":"继续","status":"done","startedAtMs":8_000},
                {"id":"transient","userText":"继续","status":"stopped","startedAtMs":10_001}
            ]
        });

        merge_live_turn(&mut page, "thread", &run);

        let turns = page["turns"].as_array().unwrap();
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0]["id"], "previous");
        assert_eq!(turns[1]["id"], "mobile-live-thread-new-run");
        assert_eq!(turns[1]["status"], "running");
    }

    #[test]
    fn live_turn_keeps_unrelated_or_completed_history() {
        let run = MobileLiveRun {
            run_id: "new-run".into(),
            upstream_run_id: "new-run".into(),
            provider: "claude-code".into(),
            prompt: "重复问题".into(),
            user_content_blocks: Vec::new(),
            started_at_ms: 10_000,
            events: Vec::new(),
            finished: false,
        };
        let mut page = json!({
            "turns": [
                {"id":"completed","userText":"重复问题","status":"done","startedAtMs":9_999},
                {"id":"older-stopped","userText":"重复问题","status":"stopped","startedAtMs":1_000}
            ]
        });

        merge_live_turn(&mut page, "thread", &run);

        let turns = page["turns"].as_array().unwrap();
        assert_eq!(turns.len(), 3);
        assert_eq!(turns[0]["id"], "completed");
        assert_eq!(turns[1]["id"], "older-stopped");
        assert_eq!(turns[2]["id"], "mobile-live-thread-new-run");
    }

    #[test]
    fn completed_desktop_turn_is_not_persisted_twice() {
        let history = json!({
            "turns": [{
                "id": "desktop-turn",
                "userText": "继续",
                "assistantText": "完成",
                "status": "done",
                "errorMessage": null,
                "startedAtMs": 10_050
            }]
        });
        let candidate = json!({
            "backendRunId": "desktop-run",
            "userText": "继续",
            "assistantText": "完成",
            "status": "done",
            "errorMessage": null,
            "startedAtMs": 10_000
        });

        assert!(equivalent_turn_index(&history, &candidate).is_some());
    }

    #[test]
    fn completed_desktop_turn_is_enriched_with_safe_mobile_attachment_summary() {
        let mut history = json!({
            "turns": [{
                "id": "desktop-turn",
                "userText": "",
                "assistantText": "图片内容",
                "status": "done",
                "errorMessage": null,
                "startedAtMs": 10_050
            }]
        });
        let candidate = json!({
            "backendRunId": "desktop-run",
            "userText": "",
            "userContentBlocks": [{
                "type": "image",
                "id": "image-1",
                "name": "mobile-image.png",
                "mimeType": "image/png",
                "size": 2048
            }],
            "assistantText": "图片内容",
            "status": "done",
            "errorMessage": null,
            "startedAtMs": 10_000
        });

        assert!(merge_or_append_mobile_turn(&mut history, candidate));
        assert_eq!(history["turns"].as_array().unwrap().len(), 1);
        assert_eq!(
            history["turns"][0]["userContentBlocks"][0]["name"],
            "mobile-image.png"
        );
    }

    #[test]
    fn completed_desktop_attachment_keeps_its_path_and_gains_mobile_preview_id() {
        let mut history = json!({ "turns": [{
            "id": "desktop-turn",
            "userText": "",
            "userContentBlocks": [{
                "type": "image",
                "id": "image-1",
                "path": "D:\\project\\.codem-attachments\\stored.png",
                "name": "photo.png"
            }],
            "assistantText": "完成",
            "status": "done",
            "errorMessage": null
        }] });
        let candidate = json!({
            "userText": "",
            "userContentBlocks": [{
                "type": "image",
                "id": "image-1",
                "name": "photo.png",
                "previewId": "7f62d872-09bb-47dc-bb8a-c6f917e8ff5d.png"
            }],
            "assistantText": "完成",
            "status": "done",
            "errorMessage": null
        });

        assert!(merge_or_append_mobile_turn(&mut history, candidate));
        assert_eq!(
            history["turns"][0]["userContentBlocks"][0]["path"],
            "D:\\project\\.codem-attachments\\stored.png"
        );
        assert_eq!(
            history["turns"][0]["userContentBlocks"][0]["previewId"],
            "7f62d872-09bb-47dc-bb8a-c6f917e8ff5d.png"
        );
    }

    #[test]
    fn repeated_prompt_with_different_output_remains_a_new_turn() {
        let history = json!({
            "turns": [{
                "userText": "继续",
                "assistantText": "第一次",
                "status": "done",
                "errorMessage": null,
                "startedAtMs": 10_000
            }]
        });
        let candidate = json!({
            "backendRunId": "second-run",
            "userText": "继续",
            "assistantText": "第二次",
            "status": "done",
            "errorMessage": null,
            "startedAtMs": 10_100
        });

        assert!(equivalent_turn_index(&history, &candidate).is_none());
    }

    #[test]
    fn active_run_prompt_prefers_the_current_desktop_request() {
        assert_eq!(
            active_run_prompt(&json!({ "prompt": "本轮真实请求" })),
            Some("本轮真实请求".to_string())
        );
        assert_eq!(active_run_prompt(&json!({ "prompt": "  " })), None);
    }

    #[test]
    fn live_event_stream_exposes_only_sanitized_fields() {
        let event = sanitize_live_event(
            &json!({
                "type": "tool-result",
                "runId": "run",
                "toolUseId": "tool",
                "content": "OPENAI_API_KEY=hidden",
                "isError": false
            }),
            "fallback",
        )
        .unwrap();
        assert_eq!(event["type"], "tool-result");
        assert!(event.get("input").is_none());
        assert_eq!(event["content"], "[敏感内容已隐藏]");
        assert_eq!(event["runId"], "run");
    }

    #[test]
    fn mobile_proxy_unwraps_upstream_json_errors() {
        assert_eq!(
            upstream_error_message(r#"{"error":"当前 Provider 不提供动态模型目录"}"#.as_bytes()),
            "当前 Provider 不提供动态模型目录"
        );
        assert_eq!(
            upstream_error_message(r#"{"message":"上游暂不可用"}"#.as_bytes()),
            "上游暂不可用"
        );
        assert_eq!(upstream_error_message(b"plain error"), "plain error");
    }

    #[test]
    fn mobile_claude_model_catalog_reuses_safe_desktop_options() {
        let catalog = sanitize_claude_model_catalog(json!({
            "available": true,
            "models": [
                { "id": "__default", "label": "secret-default", "kind": "default", "model": "private-model" },
                { "id": "sonnet", "label": "Sonnet", "description": "默认推荐模型", "kind": "slot", "supportsContext1m": true, "context1mModel": "sonnet[1m]" },
                { "id": "opus", "label": "Opus", "kind": "slot" }
            ]
        }));
        assert_eq!(catalog["providerId"], "claude-code");
        assert_eq!(catalog["models"].as_array().unwrap().len(), 3);
        assert_eq!(catalog["models"][0]["id"], "sonnet");
        assert_eq!(catalog["models"][1]["id"], "sonnet[1m]");
        assert_eq!(catalog["models"][2]["id"], "opus");
        assert!(!catalog.to_string().contains("private-model"));
        assert!(!catalog.to_string().contains("secret-default"));
    }

    #[test]
    fn mobile_send_payload_prefers_requested_model_and_permissions() {
        let thread = json!({
            "projectId": "project",
            "sessionId": "session",
            "permissionMode": "default",
            "model": "old-model",
            "reasoningEffort": "low",
            "agentChannelId": "old-channel"
        });
        let body = json!({
            "prompt": "继续",
            "permissionMode": "bypassPermissions",
            "model": "new-model",
            "reasoningEffort": "high",
            "channelId": "new-channel",
            "contentBlocks": []
        });
        let payload = build_mobile_send_payload("openai-codex", "D:/project", &thread, &body);
        assert_eq!(payload["permissionMode"], "bypassPermissions");
        assert_eq!(payload["model"], "new-model");
        assert_eq!(payload["reasoningEffort"], "high");
        assert_eq!(payload["channelId"], "new-channel");
        assert!(payload["sessionId"].is_null());
        assert!(!should_reuse_mobile_thread_session(
            "openai-codex",
            &thread,
            &body,
        ));

        let same_channel = build_mobile_send_payload(
            "openai-codex",
            "D:/project",
            &thread,
            &json!({ "prompt": "继续", "channelId": "old-channel" }),
        );
        assert_eq!(same_channel["sessionId"], "session");
    }

    #[test]
    fn mobile_thread_settings_only_forwards_shared_thread_metadata() {
        let settings = mobile_thread_settings_payload(&json!({
            "model": "deepseek-v4-flash",
            "reasoningEffort": "high",
            "permissionMode": "bypassPermissions",
            "channelId": null,
            "prompt": "不应转发",
            "sessionId": "不应转发"
        }));
        assert_eq!(settings["model"], "deepseek-v4-flash");
        assert_eq!(settings["reasoningEffort"], "high");
        assert_eq!(settings["permissionMode"], "bypassPermissions");
        assert!(settings["channelId"].is_null());
        assert!(settings.get("prompt").is_none());
        assert!(settings.get("sessionId").is_none());
    }

    #[test]
    fn mobile_send_payload_falls_back_to_thread_configuration() {
        let thread = json!({
            "projectId": "project",
            "permissionMode": "auto",
            "model": "saved-model",
            "reasoningEffort": "medium",
            "agentChannelId": "saved-channel"
        });
        let payload = build_mobile_send_payload(
            "claude-code",
            "D:/project",
            &thread,
            &json!({ "prompt": "继续" }),
        );
        assert_eq!(payload["permissionMode"], "auto");
        assert_eq!(payload["model"], "saved-model");
        assert_eq!(payload["reasoningEffort"], "medium");
        assert_eq!(payload["channelId"], "saved-channel");
        assert_eq!(payload["contentBlocks"], json!([]));
    }

    #[test]
    fn mobile_new_thread_drops_empty_session_id_before_starting_provider() {
        let thread = json!({
            "projectId": "project",
            "sessionId": "",
            "agentChannelId": "deepseek-channel"
        });
        let payload = build_mobile_send_payload(
            "deepseek-dsh",
            "D:/project",
            &thread,
            &json!({ "prompt": "你好" }),
        );
        assert!(payload["sessionId"].is_null());
        assert_eq!(payload["channelId"], "deepseek-channel");
        assert_eq!(mobile_non_empty_session_id(Some(&json!("  "))), None);
    }

    #[test]
    fn mobile_recovery_actions_drop_the_stale_session() {
        let thread = json!({ "sessionId": "stale-session" });
        let payload = build_mobile_send_payload(
            "claude-code",
            "D:/project",
            &thread,
            &json!({ "prompt": "继续", "recoveryAction": "recover" }),
        );
        assert!(payload["sessionId"].is_null());
        assert!(!should_reuse_mobile_session(
            &json!({ "recoveryAction": "resend" })
        ));
        assert!(should_reuse_mobile_session(
            &json!({ "recoveryAction": "retry" })
        ));

        let retry_payload = mobile_recovery_payload(&json!({
            "prompt": "继续",
            "sessionId": "stale-session",
            "model": "model"
        }));
        assert!(retry_payload.get("sessionId").is_none());
        assert_eq!(retry_payload["model"], "model");
    }

    #[test]
    fn mobile_session_events_expose_only_confirmed_session_ids() {
        assert_eq!(
            mobile_event_session_id(&json!({
                "type": "session",
                "sessionId": " new-session "
            })),
            Some("new-session")
        );
        assert_eq!(
            mobile_event_session_id(&json!({
                "type": "done",
                "sessionId": "done-session"
            })),
            Some("done-session")
        );
        assert_eq!(
            mobile_event_session_id(&json!({ "type": "session", "sessionId": "  " })),
            None
        );
        assert_eq!(
            mobile_event_session_id(&json!({ "type": "delta", "sessionId": "ignored-session" })),
            None
        );
    }

    #[test]
    fn mobile_stale_session_auto_recovery_is_claude_only_and_runs_once() {
        let event = json!({
            "type": "runtime-reconnect-hint",
            "hint": {
                "reason": "resume-session-missing",
                "message": "No conversation found with session ID: stale-session"
            }
        });
        assert!(should_auto_recover_mobile_session(
            true, false, false, &event
        ));
        assert!(!should_auto_recover_mobile_session(
            false, false, false, &event
        ));
        assert!(!should_auto_recover_mobile_session(
            true, true, false, &event
        ));
        assert!(!should_auto_recover_mobile_session(
            true, false, true, &event
        ));
        assert!(!should_auto_recover_mobile_session(
            true,
            false,
            false,
            &json!({ "type": "error", "message": "network error" })
        ));
    }

    #[test]
    fn completed_run_cleanup_does_not_remove_newer_hot_session() {
        let mut runs = HashMap::from([(
            "thread".to_string(),
            MobileLiveRun {
                run_id: "new-run".into(),
                upstream_run_id: "new-run".into(),
                provider: "claude-code".into(),
                prompt: "继续".into(),
                user_content_blocks: Vec::new(),
                started_at_ms: now_ms(),
                events: Vec::new(),
                finished: false,
            },
        )]);
        remove_live_run_if_matches(&mut runs, "thread", "old-run");
        assert_eq!(runs["thread"].run_id, "new-run");
        remove_live_run_if_matches(&mut runs, "thread", "new-run");
        assert!(runs.is_empty());
    }

    #[test]
    fn mobile_text_redacts_secret_lines_and_bounds_output() {
        let value = sanitize_visible_text("ok\nOPENAI_API_KEY=secret\n123456789", 12);
        assert!(value.contains("[敏感内容已隐藏]"));
        assert!(!value.contains("secret"));
        assert!(value.contains("[内容已截断]"));
    }

    #[test]
    fn mobile_runtime_error_keeps_safe_dsh_credential_guidance() {
        let message = sanitize_runtime_message(
            "llm-deepseek: no API key for provider route \"deepseek-official\"; export DEEPSEEK_API_KEY",
            1_000,
        );
        assert_eq!(
            message,
            "DeepSeek 渠道没有可用的 API Key，请在桌面端检查该渠道凭据后重试。"
        );
        assert!(!message.contains("DEEPSEEK_API_KEY"));
    }

    #[test]
    fn mobile_history_preserves_desktop_turn_shape() {
        let history = json!({ "turns": [{
            "id": "turn-1",
            "userText": "请检查",
            "userContentBlocks": [{
                "type": "image",
                "id": "image-1",
                "path": "D:\\secret\\wallpaper.png",
                "name": "wallpaper.png",
                "mimeType": "image/png",
                "size": 2048,
                "data": "private-base64"
            }],
            "assistantText": "完成",
            "status": "done",
            "recoveryHint": {
                "reason": "resume-session-missing",
                "message": "No conversation found with session ID: stale-session",
                "retryable": true,
                "suggestedAction": "recover",
                "source": "result"
            },
            "items": [
                { "id": "thinking", "type": "thinking", "text": "公开思考" },
                { "id": "tool-item", "type": "tool", "tool": { "id": "tool", "name": "Read", "title": "读取文件", "status": "done", "inputText": "D:\\secret\\file.rs" } },
                { "id": "text", "type": "text", "text": "完成" }
            ],
            "tools": []
        }] });
        let page = sanitize_history("thread", history, None);
        let turn = &page["turns"][0];
        assert_eq!(turn["userText"], "请检查");
        assert_eq!(turn["userContentBlocks"][0]["name"], "wallpaper.png");
        assert_eq!(turn["items"][0]["type"], "thinking");
        assert_eq!(turn["items"][1]["type"], "tool");
        assert!(turn["items"][1]["tool"]["inputText"]
            .as_str()
            .unwrap()
            .contains("[项目路径]/file.rs"));
        assert_eq!(turn["workspace"], "");
        assert_eq!(turn["recoveryHint"]["reason"], "resume-session-missing");
        assert!(!turn.to_string().contains("stale-session"));
        assert!(!turn.to_string().contains("private-base64"));
        assert!(!turn.to_string().contains("D:\\secret"));
    }

    #[test]
    fn mobile_history_pages_twenty_turns_and_clamps_invalid_cursor() {
        let turns = (0..45)
            .map(|index| {
                json!({
                    "id": format!("turn-{index}"),
                    "userText": format!("问题 {index}"),
                    "assistantText": format!("回答 {index}"),
                    "status": "done"
                })
            })
            .collect::<Vec<_>>();
        let latest = sanitize_history("thread", json!({ "turns": turns }), None);
        assert_eq!(latest["turns"].as_array().unwrap().len(), 20);
        assert_eq!(latest["nextCursor"], "25");
        assert_eq!(latest["turns"][0]["id"], "turn-25");

        let older = sanitize_history(
            "thread",
            json!({ "turns": (0..45).map(|index| json!({ "id": format!("turn-{index}") })).collect::<Vec<_>>() }),
            Some("25".into()),
        );
        assert_eq!(older["turns"].as_array().unwrap().len(), 20);
        assert_eq!(older["nextCursor"], "5");
        assert_eq!(older["turns"][0]["id"], "turn-5");

        let clamped = sanitize_history(
            "thread",
            json!({ "turns": (0..3).map(|index| json!({ "id": format!("turn-{index}") })).collect::<Vec<_>>() }),
            Some("999".into()),
        );
        assert_eq!(clamped["turns"].as_array().unwrap().len(), 3);
        assert_eq!(clamped["hasMore"], false);
    }

    #[test]
    fn mobile_channel_summary_omits_endpoints_and_keys() {
        let channels = sanitize_channels(json!({
            "channels": [{ "id": "channel", "providerId": "claude-code", "name": "私有渠道", "baseUrl": "https://secret.example", "apiKeySaved": true, "enabled": true, "isDefault": true, "models": [] }],
            "systemChannels": [{ "id": "system", "providerId": "claude-code", "name": "系统", "configured": true, "configPath": "D:\\secret\\config.json", "detail": "已配置" }],
            "defaultChannelIds": { "claude-code": "channel" }
        }));
        let serialized = serde_json::to_string(&channels).unwrap();
        assert!(!serialized.contains("secret.example"));
        assert!(!serialized.contains("config.json"));
        assert!(!serialized.contains("baseUrl"));
        assert!(serialized.contains("apiKeySaved"));
    }

    #[test]
    fn mobile_json_sanitizer_removes_secret_fields() {
        let value = sanitize_json_value(
            &json!({
                "path": "D:\\Projects\\codem\\src\\main.tsx",
                "apiKey": "top-secret",
                "nested": { "authorization": "Bearer secret" }
            }),
            0,
        );
        let serialized = serde_json::to_string(&value).unwrap();
        assert!(serialized.contains("[项目路径]/main.tsx"));
        assert!(!serialized.contains("top-secret"));
        assert!(!serialized.contains("Bearer secret"));
    }
}
