use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub const DISCOVERY_FILE_NAME: &str = "agent-mux-runtime.json";
pub const LOCK_FILE_NAME: &str = "agent-mux-runtime.lock";
pub const RUNTIME_TOKEN_ENV: &str = "CODEM_AGENT_MUX_RUNTIME_TOKEN";
pub const RUNTIME_PROTOCOL_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiscovery {
    pub endpoint: String,
    pub port: u16,
    pub pid: u32,
    pub version: String,
    #[serde(default)]
    pub protocol_version: u32,
    pub token: String,
    pub started_at: u64,
}

impl RuntimeDiscovery {
    pub fn new(port: u16, pid: u32, token: String) -> Self {
        Self {
            endpoint: format!("http://127.0.0.1:{port}"),
            port,
            pid,
            version: env!("CARGO_PKG_VERSION").to_string(),
            protocol_version: RUNTIME_PROTOCOL_VERSION,
            token,
            started_at: unix_timestamp_ms(),
        }
    }

    pub fn is_protocol_compatible(&self) -> bool {
        self.protocol_version == RUNTIME_PROTOCOL_VERSION
    }

    pub fn public_json(&self) -> serde_json::Value {
        serde_json::json!({
            "endpoint": self.endpoint,
            "port": self.port,
            "pid": self.pid,
            "version": self.version,
            "protocolVersion": self.protocol_version,
            "startedAt": self.started_at,
        })
    }
}

pub fn resolve_app_data_dir() -> Result<PathBuf, String> {
    if let Some(path) =
        env::var_os("CODEM_APP_DATA_DIR").filter(|value| !value.to_string_lossy().trim().is_empty())
    {
        return Ok(PathBuf::from(path));
    }

    #[cfg(target_os = "windows")]
    {
        let base = env::var_os("LOCALAPPDATA")
            .or_else(|| env::var_os("APPDATA"))
            .or_else(|| {
                env::var_os("USERPROFILE")
                    .map(PathBuf::from)
                    .map(|home| home.join("AppData").join("Local").into_os_string())
            })
            .ok_or_else(|| "无法定位 CodeM 用户数据目录".to_string())?;
        return Ok(PathBuf::from(base).join("CodeM"));
    }

    #[cfg(target_os = "macos")]
    {
        let home = env::var_os("HOME").ok_or_else(|| "无法定位用户目录".to_string())?;
        return Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("com.mnl.codem")
            .join("data"));
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let base = env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                env::var_os("HOME")
                    .map(PathBuf::from)
                    .map(|home| home.join(".local").join("share"))
            })
            .ok_or_else(|| "无法定位用户数据目录".to_string())?;
        Ok(base.join("codem"))
    }
}

pub fn discovery_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(DISCOVERY_FILE_NAME)
}

pub fn lock_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(LOCK_FILE_NAME)
}

pub fn read_discovery(app_data_dir: &Path) -> Option<RuntimeDiscovery> {
    let value = fs::read_to_string(discovery_path(app_data_dir)).ok()?;
    serde_json::from_str(&value).ok()
}

pub fn write_discovery(app_data_dir: &Path, discovery: &RuntimeDiscovery) -> Result<(), String> {
    fs::create_dir_all(app_data_dir)
        .map_err(|error| format!("创建 Runtime 数据目录失败: {error}"))?;
    let target = discovery_path(app_data_dir);
    let temporary = target.with_extension("json.tmp");
    let value = serde_json::to_vec_pretty(discovery).map_err(|error| error.to_string())?;
    fs::write(&temporary, value)
        .map_err(|error| format!("写入 Runtime discovery 失败: {error}"))?;
    if target.exists() {
        fs::remove_file(&target)
            .map_err(|error| format!("替换 Runtime discovery 失败: {error}"))?;
    }
    fs::rename(&temporary, &target).map_err(|error| format!("提交 Runtime discovery 失败: {error}"))
}

pub fn remove_discovery(app_data_dir: &Path) {
    let _ = fs::remove_file(discovery_path(app_data_dir));
}

pub fn allocate_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("分配 Agent Mux Runtime 端口失败: {error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("读取 Agent Mux Runtime 端口失败: {error}"))
}

pub fn generate_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

pub fn probe_runtime(discovery: &RuntimeDiscovery) -> bool {
    if !discovery.is_protocol_compatible() {
        return false;
    }
    let Some(response) = send_runtime_request(
        discovery,
        &format!(
            "GET /api/runtime/identity HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nConnection: close\r\n\r\n",
            discovery.port, discovery.token
        ),
    ) else {
        return false;
    };
    runtime_identity_matches(&response)
}

pub fn shutdown_runtime(discovery: &RuntimeDiscovery) -> bool {
    let request = format!(
        "POST /api/runtime/shutdown HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}",
        discovery.port, discovery.token
    );
    let Some(response) = send_runtime_request(discovery, &request) else {
        return false;
    };
    if !has_success_status(&response) {
        return false;
    }
    let address = SocketAddr::from(([127, 0, 0, 1], discovery.port));
    for _ in 0..40 {
        if TcpStream::connect_timeout(&address, Duration::from_millis(50)).is_err() {
            return true;
        }
        thread::sleep(Duration::from_millis(50));
    }
    false
}

fn send_runtime_request(discovery: &RuntimeDiscovery, request: &str) -> Option<String> {
    let address = SocketAddr::from(([127, 0, 0, 1], discovery.port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(500)).ok()?;
    let timeout = Some(Duration::from_millis(900));
    let _ = stream.set_read_timeout(timeout);
    let _ = stream.set_write_timeout(timeout);
    stream.write_all(request.as_bytes()).ok()?;
    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    Some(response)
}

fn has_success_status(response: &str) -> bool {
    response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
}

fn runtime_identity_matches(response: &str) -> bool {
    if !has_success_status(response) {
        return false;
    }
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or_default();
    serde_json::from_str::<serde_json::Value>(body).is_ok_and(|identity| {
        identity.get("app").and_then(serde_json::Value::as_str) == Some("codem")
            && identity.get("backend").and_then(serde_json::Value::as_str) == Some("rust")
            && identity
                .get("protocolVersion")
                .and_then(serde_json::Value::as_u64)
                == Some(u64::from(RUNTIME_PROTOCOL_VERSION))
    })
}

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_public_json_redacts_token() {
        let discovery = RuntimeDiscovery::new(3210, 42, "private-token".to_string());
        let value = discovery.public_json().to_string();
        assert!(value.contains("3210"));
        assert!(value.contains(&format!("\"protocolVersion\":{RUNTIME_PROTOCOL_VERSION}")));
        assert!(!value.contains("private-token"));
    }

    #[test]
    fn legacy_discovery_is_readable_but_requires_runtime_refresh() {
        let discovery: RuntimeDiscovery = serde_json::from_str(
            r#"{"endpoint":"http://127.0.0.1:3210","port":3210,"pid":42,"version":"0.1.20","token":"legacy-token","startedAt":1}"#,
        )
        .expect("read legacy discovery");
        assert_eq!(discovery.protocol_version, 0);
        assert!(!discovery.is_protocol_compatible());
    }

    #[test]
    fn runtime_identity_requires_current_protocol() {
        let compatible = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{{\"app\":\"codem\",\"backend\":\"rust\",\"protocolVersion\":{RUNTIME_PROTOCOL_VERSION}}}"
        );
        let stale =
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"app\":\"codem\",\"backend\":\"rust\"}";
        assert!(runtime_identity_matches(&compatible));
        assert!(!runtime_identity_matches(stale));
    }

    #[test]
    fn generated_token_is_not_empty_or_reused() {
        let first = generate_token();
        let second = generate_token();
        assert!(first.len() >= 64);
        assert_ne!(first, second);
    }
}
