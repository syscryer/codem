use crate::{
    agent_runtime::{
        CLAUDE_CODE_PROVIDER_ID, GROK_BUILD_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID,
        OPENCODE_PROVIDER_ID,
    },
    ordinary_chat::{
        provider::{discover_models, test_provider, PROVIDER_TEMPLATES},
        secrets::SecretStore,
        types::{AiProtocol, DiscoveredModel, StoredProvider},
    },
};
use axum::{
    extract::{Path as AxumPath, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, patch, post, put},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
    sync::Arc,
};
use url::Url;

#[derive(Clone)]
pub(crate) struct AgentChannelService {
    database_path: Arc<PathBuf>,
    app_data_dir: Arc<PathBuf>,
    secrets: SecretStore,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AgentChannelRuntime {
    pub channel_id: String,
    pub fingerprint: String,
    pub env: BTreeMap<String, String>,
    pub codex_config_args: Vec<String>,
    pub effective_model: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentChannelSummary {
    id: String,
    provider_id: String,
    name: String,
    protocol: AiProtocol,
    base_url: String,
    models_url: Option<String>,
    template_id: Option<String>,
    enabled: bool,
    is_default: bool,
    api_key_saved: bool,
    models: Vec<AgentChannelModelSummary>,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentChannelModelSummary {
    id: String,
    channel_id: String,
    model_id: String,
    display_name: String,
    enabled: bool,
    is_default: bool,
    capabilities: Value,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemChannelSummary {
    id: &'static str,
    provider_id: &'static str,
    name: &'static str,
    source: &'static str,
    configured: bool,
    config_path: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    protocol: Option<AiProtocol>,
    cc_switch_provider_name: Option<String>,
    detail: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CcSwitchStatus {
    detected: bool,
    database_path: Option<String>,
    current_providers: BTreeMap<String, String>,
}

#[derive(Clone, Debug)]
struct StoredAgentChannel {
    id: String,
    provider_id: String,
    name: String,
    protocol: AiProtocol,
    base_url: String,
    models_url: Option<String>,
    template_id: Option<String>,
    enabled: bool,
    is_default: bool,
    secret_slot: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveAgentChannelRequest {
    provider_id: String,
    name: String,
    protocol: AiProtocol,
    base_url: String,
    models_url: Option<String>,
    template_id: Option<String>,
    enabled: Option<bool>,
    is_default: Option<bool>,
    api_key: Option<String>,
    models: Option<Vec<SaveAgentChannelModelRequest>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAgentChannelRequest {
    name: Option<String>,
    protocol: Option<AiProtocol>,
    base_url: Option<String>,
    models_url: Option<String>,
    template_id: Option<String>,
    enabled: Option<bool>,
    is_default: Option<bool>,
    api_key: Option<String>,
    #[serde(default)]
    api_key_touched: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetDefaultAgentChannelRequest {
    provider_id: String,
    channel_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveAgentChannelModelRequest {
    model_id: String,
    display_name: Option<String>,
    enabled: Option<bool>,
    is_default: Option<bool>,
    capabilities: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchSaveAgentChannelModelsRequest {
    models: Vec<SaveAgentChannelModelRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAgentChannelModelRequest {
    display_name: Option<String>,
    enabled: Option<bool>,
    is_default: Option<bool>,
    capabilities: Option<Value>,
}

#[derive(Debug)]
struct AgentChannelApiError {
    status: StatusCode,
    message: String,
}

type AgentChannelApiResult<T> = Result<T, AgentChannelApiError>;

impl AgentChannelApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
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

impl IntoResponse for AgentChannelApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

impl AgentChannelService {
    pub(crate) fn new(app_data_dir: PathBuf, secrets: SecretStore) -> Self {
        Self {
            database_path: Arc::new(app_data_dir.join("codem.sqlite")),
            app_data_dir: Arc::new(app_data_dir),
            secrets,
        }
    }

    pub(crate) fn resolve_runtime(
        &self,
        provider_id: &str,
        channel_id: Option<&str>,
        selected_model: Option<&str>,
        session_scope: Option<&str>,
        requested_session_id: Option<&str>,
    ) -> Result<Option<AgentChannelRuntime>, String> {
        let Some(channel_id) = normalize_channel_id(channel_id) else {
            return Ok(None);
        };
        let connection = self.open_database()?;
        let channel = get_stored_channel(&connection, channel_id)?
            .ok_or_else(|| "Agent 渠道不存在".to_string())?;
        if channel.provider_id != provider_id {
            return Err("Agent 渠道与当前 Agent 不匹配".to_string());
        }
        if !channel.enabled {
            return Err("Agent 渠道已停用".to_string());
        }
        let api_key = self.secrets.get(&channel.secret_slot)?;
        let models = list_models(&connection, &channel.id)?;
        build_runtime(
            self.app_data_dir.as_ref(),
            &channel,
            &models,
            selected_model,
            &api_key,
            session_scope,
            requested_session_id,
        )
        .map(Some)
    }

    pub(crate) fn validate_selection(
        &self,
        provider_id: &str,
        channel_id: Option<&str>,
    ) -> Result<Option<String>, String> {
        let Some(channel_id) = normalize_channel_id(channel_id) else {
            return Ok(None);
        };
        let connection = self.open_database()?;
        let channel = get_stored_channel(&connection, channel_id)?
            .ok_or_else(|| "Agent 渠道不存在".to_string())?;
        if channel.provider_id != provider_id {
            return Err("Agent 渠道与当前 Agent 不匹配".to_string());
        }
        if !channel.enabled {
            return Err("Agent 渠道已停用".to_string());
        }
        Ok(Some(channel.id))
    }

    pub(crate) fn persist_thread_runtime(
        &self,
        thread_id: &str,
        channel_id: Option<&str>,
        channel_fingerprint: Option<&str>,
    ) -> Result<(), String> {
        let connection = self.open_database()?;
        connection
            .execute(
                r#"UPDATE threads
                   SET agent_channel_id = ?, agent_channel_fingerprint = ?, updated_at = ?
                   WHERE id = ?"#,
                params![
                    channel_id,
                    channel_fingerprint,
                    current_timestamp(),
                    thread_id
                ],
            )
            .map_err(|error| format!("保存线程 Agent 渠道失败: {error}"))?;
        Ok(())
    }

    fn open_database(&self) -> Result<Connection, String> {
        let connection = Connection::open(self.database_path.as_ref())
            .map_err(|error| format!("打开 Agent 渠道数据库失败: {error}"))?;
        initialize_database(&connection)?;
        Ok(connection)
    }
}

pub(crate) fn router(service: AgentChannelService) -> Router {
    Router::new()
        .route("/api/agents/channels/bootstrap", get(channels_bootstrap))
        .route("/api/agents/channels", post(create_channel))
        .route("/api/agents/channels/default", put(set_default_channel))
        .route(
            "/api/agents/channels/{channel_id}",
            patch(update_channel).delete(delete_channel),
        )
        .route(
            "/api/agents/channels/{channel_id}/api-key",
            get(get_channel_api_key),
        )
        .route("/api/agents/channels/{channel_id}/test", post(test_channel))
        .route(
            "/api/agents/channels/{channel_id}/models/discover",
            post(discover_channel_models),
        )
        .route(
            "/api/agents/channels/{channel_id}/models/batch",
            post(create_models_batch),
        )
        .route(
            "/api/agents/channels/{channel_id}/models",
            post(create_model),
        )
        .route(
            "/api/agents/channel-models/{model_id}",
            patch(update_model).delete(delete_model),
        )
        .with_state(service)
}

pub(crate) fn initialize_database(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS agent_channels (
              id TEXT PRIMARY KEY,
              provider_id TEXT NOT NULL,
              name TEXT NOT NULL,
              protocol TEXT NOT NULL,
              base_url TEXT NOT NULL,
              models_url TEXT,
              template_id TEXT,
              enabled INTEGER NOT NULL DEFAULT 1,
              is_default INTEGER NOT NULL DEFAULT 0,
              secret_slot TEXT NOT NULL UNIQUE,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_agent_channels_provider
              ON agent_channels(provider_id, enabled, is_default, updated_at);
            CREATE TABLE IF NOT EXISTS agent_channel_models (
              id TEXT PRIMARY KEY,
              channel_id TEXT NOT NULL REFERENCES agent_channels(id) ON DELETE CASCADE,
              model_id TEXT NOT NULL,
              display_name TEXT NOT NULL,
              enabled INTEGER NOT NULL DEFAULT 1,
              is_default INTEGER NOT NULL DEFAULT 0,
              capabilities_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(channel_id, model_id)
            );
            CREATE INDEX IF NOT EXISTS idx_agent_channel_models_channel
              ON agent_channel_models(channel_id, enabled, is_default, updated_at);
            UPDATE agent_channels
              SET protocol = 'openai_chat'
              WHERE provider_id = 'opencode' AND protocol = 'openai_responses';
            "#,
        )
        .map_err(|error| format!("初始化 Agent 渠道数据库失败: {error}"))?;
    ensure_agent_channel_column(connection, "template_id", "TEXT")
}

fn ensure_agent_channel_column(
    connection: &Connection,
    column_name: &str,
    column_type: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(agent_channels)")
        .map_err(|error| format!("读取 Agent 渠道表结构失败: {error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("读取 Agent 渠道字段失败: {error}"))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| format!("解析 Agent 渠道字段失败: {error}"))?;
    if columns.iter().any(|column| column == column_name) {
        return Ok(());
    }
    connection
        .execute(
            &format!("ALTER TABLE agent_channels ADD COLUMN {column_name} {column_type}"),
            [],
        )
        .map_err(|error| format!("升级 Agent 渠道表结构失败: {error}"))?;
    Ok(())
}

fn normalize_channel_id(value: Option<&str>) -> Option<&str> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "system")
}

fn current_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn require_text<'a>(value: &'a str, message: &str) -> AgentChannelApiResult<&'a str> {
    let value = value.trim();
    if value.is_empty() {
        Err(AgentChannelApiError::bad_request(message))
    } else {
        Ok(value)
    }
}

fn validate_provider_id(value: &str) -> AgentChannelApiResult<&str> {
    match value {
        CLAUDE_CODE_PROVIDER_ID
        | OPENAI_CODEX_PROVIDER_ID
        | GROK_BUILD_PROVIDER_ID
        | OPENCODE_PROVIDER_ID => Ok(value),
        _ => Err(AgentChannelApiError::bad_request("不支持的 Agent")),
    }
}

fn validate_protocol(provider_id: &str, protocol: AiProtocol) -> AgentChannelApiResult<()> {
    let supported = match provider_id {
        CLAUDE_CODE_PROVIDER_ID => protocol == AiProtocol::AnthropicMessages,
        OPENAI_CODEX_PROVIDER_ID => matches!(
            protocol,
            AiProtocol::OpenaiResponses | AiProtocol::OpenaiChat
        ),
        GROK_BUILD_PROVIDER_ID => matches!(
            protocol,
            AiProtocol::OpenaiResponses | AiProtocol::OpenaiChat | AiProtocol::AnthropicMessages
        ),
        OPENCODE_PROVIDER_ID => matches!(
            protocol,
            AiProtocol::OpenaiChat | AiProtocol::AnthropicMessages
        ),
        _ => false,
    };
    if supported {
        Ok(())
    } else {
        Err(AgentChannelApiError::bad_request(
            "当前 Agent 不支持所选接口类型",
        ))
    }
}

fn validate_url(value: &str, field: &str) -> AgentChannelApiResult<String> {
    let value = require_text(value, &format!("{field}不能为空"))?;
    let parsed = Url::parse(value)
        .map_err(|_| AgentChannelApiError::bad_request(format!("{field}格式无效")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AgentChannelApiError::bad_request(format!(
            "{field}仅支持 HTTP 或 HTTPS"
        )));
    }
    Ok(value.trim_end_matches('/').to_string())
}

fn normalize_optional_url(
    value: Option<&str>,
    field: &str,
) -> AgentChannelApiResult<Option<String>> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => validate_url(value, field).map(Some),
        None => Ok(None),
    }
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn system_channel_summaries() -> Vec<SystemChannelSummary> {
    let cc_switch = read_cc_switch_current_providers();
    vec![
        read_claude_system_channel(cc_switch.get("claude").cloned()),
        read_codex_system_channel(cc_switch.get("codex").cloned()),
        read_grok_system_channel(),
        read_opencode_system_channel(cc_switch.get("opencode").cloned()),
    ]
}

fn cc_switch_status() -> CcSwitchStatus {
    let database_path = cc_switch_database_path().filter(|path| path.is_file());
    let current_providers = database_path
        .as_deref()
        .map(read_cc_switch_current_providers_from)
        .unwrap_or_default();
    CcSwitchStatus {
        detected: database_path.is_some(),
        database_path: database_path.map(|path| path.to_string_lossy().to_string()),
        current_providers,
    }
}

fn read_claude_system_channel(cc_switch_provider_name: Option<String>) -> SystemChannelSummary {
    let path = home_dir().map(|home| home.join(".claude").join("settings.json"));
    let settings = path.as_deref().and_then(read_json_file);
    let env = settings.as_ref().and_then(|value| value.get("env"));
    let base_url = env
        .and_then(|value| value.get("ANTHROPIC_BASE_URL"))
        .and_then(Value::as_str)
        .and_then(non_empty_string);
    let model = env
        .and_then(|value| value.get("ANTHROPIC_MODEL"))
        .and_then(Value::as_str)
        .and_then(non_empty_string);
    system_channel_summary(
        CLAUDE_CODE_PROVIDER_ID,
        path,
        base_url,
        model,
        Some(AiProtocol::AnthropicMessages),
        cc_switch_provider_name,
    )
}

fn read_codex_system_channel(cc_switch_provider_name: Option<String>) -> SystemChannelSummary {
    let path = home_dir().map(|home| home.join(".codex").join("config.toml"));
    let config = path.as_deref().and_then(read_toml_file);
    let model = config
        .as_ref()
        .and_then(|value| value.get("model"))
        .and_then(toml::Value::as_str)
        .and_then(non_empty_string);
    let provider_key = config
        .as_ref()
        .and_then(|value| value.get("model_provider"))
        .and_then(toml::Value::as_str);
    let provider = provider_key.and_then(|key| {
        config
            .as_ref()
            .and_then(|value| value.get("model_providers"))
            .and_then(|value| value.get(key))
    });
    let base_url = provider
        .and_then(|value| value.get("base_url"))
        .and_then(toml::Value::as_str)
        .and_then(non_empty_string);
    let protocol = provider
        .and_then(|value| value.get("wire_api"))
        .and_then(toml::Value::as_str)
        .and_then(|value| match value {
            "responses" => Some(AiProtocol::OpenaiResponses),
            "chat" | "chat_completions" => Some(AiProtocol::OpenaiChat),
            _ => None,
        })
        .or(Some(AiProtocol::OpenaiResponses));
    system_channel_summary(
        OPENAI_CODEX_PROVIDER_ID,
        path,
        base_url,
        model,
        protocol,
        cc_switch_provider_name,
    )
}

fn read_grok_system_channel() -> SystemChannelSummary {
    let path = home_dir().map(|home| home.join(".grok").join("config.toml"));
    let config = path.as_deref().and_then(read_toml_file);
    let base_url = env::var("GROK_MODELS_BASE_URL")
        .ok()
        .and_then(|value| non_empty_string(&value))
        .or_else(|| {
            config
                .as_ref()
                .and_then(|value| value.get("base_url"))
                .and_then(toml::Value::as_str)
                .and_then(non_empty_string)
        });
    let model = config
        .as_ref()
        .and_then(|value| value.get("model"))
        .and_then(toml::Value::as_str)
        .and_then(non_empty_string);
    system_channel_summary(GROK_BUILD_PROVIDER_ID, path, base_url, model, None, None)
}

fn read_opencode_system_channel(cc_switch_provider_name: Option<String>) -> SystemChannelSummary {
    let path = home_dir().map(|home| home.join(".config").join("opencode").join("opencode.json"));
    let config = path.as_deref().and_then(read_json_file);
    let model = config
        .as_ref()
        .and_then(|value| value.get("model"))
        .and_then(Value::as_str)
        .and_then(non_empty_string);
    let provider_key = model
        .as_deref()
        .and_then(|value| value.split_once('/').map(|(provider, _)| provider));
    let provider = provider_key.and_then(|key| {
        config
            .as_ref()
            .and_then(|value| value.get("provider"))
            .and_then(|value| value.get(key))
    });
    let base_url = provider
        .and_then(|value| value.get("options"))
        .and_then(|value| value.get("baseURL"))
        .and_then(Value::as_str)
        .and_then(non_empty_string);
    system_channel_summary(
        OPENCODE_PROVIDER_ID,
        path,
        base_url,
        model,
        None,
        cc_switch_provider_name,
    )
}

fn system_channel_summary(
    provider_id: &'static str,
    path: Option<PathBuf>,
    base_url: Option<String>,
    model: Option<String>,
    protocol: Option<AiProtocol>,
    cc_switch_provider_name: Option<String>,
) -> SystemChannelSummary {
    let config_exists = path.as_deref().is_some_and(Path::is_file);
    let source = if cc_switch_provider_name.is_some() {
        "cc-switch"
    } else {
        "system"
    };
    let configured = config_exists || base_url.is_some() || model.is_some();
    let detail = match (&cc_switch_provider_name, configured) {
        (Some(name), _) => format!("当前由 CC Switch 管理：{name}"),
        (None, true) => "使用 Agent 的系统当前配置".to_string(),
        (None, false) => "尚未检测到系统配置".to_string(),
    };
    SystemChannelSummary {
        id: "system",
        provider_id,
        name: "系统渠道",
        source,
        configured,
        config_path: path.map(|path| path.to_string_lossy().to_string()),
        base_url,
        model,
        protocol,
        cc_switch_provider_name,
        detail,
    }
}

fn read_json_file(path: &Path) -> Option<Value> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn read_toml_file(path: &Path) -> Option<toml::Value> {
    toml::from_str(&fs::read_to_string(path).ok()?).ok()
}

fn non_empty_string(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn read_cc_switch_current_providers() -> BTreeMap<String, String> {
    cc_switch_database_path()
        .filter(|path| path.is_file())
        .as_deref()
        .map(read_cc_switch_current_providers_from)
        .unwrap_or_default()
}

fn read_cc_switch_current_providers_from(path: &Path) -> BTreeMap<String, String> {
    let Ok(connection) =
        Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return BTreeMap::new();
    };
    let Ok(mut statement) = connection.prepare(
        "SELECT app_type, name FROM providers WHERE is_current = 1 AND app_type IN ('claude', 'codex', 'opencode')",
    ) else {
        return BTreeMap::new();
    };
    let Ok(rows) = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }) else {
        return BTreeMap::new();
    };
    rows.filter_map(Result::ok).collect()
}

fn cc_switch_database_path() -> Option<PathBuf> {
    let home = home_dir()?;
    let default_path = home.join(".cc-switch").join("cc-switch.db");
    if default_path.is_file() {
        return Some(default_path);
    }
    #[cfg(windows)]
    if let Some(legacy) = env::var_os("HOME")
        .map(PathBuf::from)
        .map(|path| path.join(".cc-switch").join("cc-switch.db"))
        .filter(|path| path.is_file())
    {
        return Some(legacy);
    }
    Some(default_path)
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    if let Some(path) = env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        return Some(path);
    }
    env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

async fn channels_bootstrap(
    State(service): State<AgentChannelService>,
) -> AgentChannelApiResult<Json<Value>> {
    let connection = service
        .open_database()
        .map_err(AgentChannelApiError::internal)?;
    for provider_id in [
        CLAUDE_CODE_PROVIDER_ID,
        OPENAI_CODEX_PROVIDER_ID,
        GROK_BUILD_PROVIDER_ID,
        OPENCODE_PROVIDER_ID,
    ] {
        repair_default_channel(&connection, provider_id)
            .map_err(AgentChannelApiError::internal)?;
    }
    let channels =
        list_channels(&connection, &service.secrets).map_err(AgentChannelApiError::internal)?;
    let default_channel_ids = default_channel_ids(&connection)
        .map_err(AgentChannelApiError::internal)?;
    Ok(Json(json!({
        "channels": channels,
        "systemChannels": system_channel_summaries(),
        "ccSwitch": cc_switch_status(),
        "templates": PROVIDER_TEMPLATES,
        "defaultChannelIds": default_channel_ids,
    })))
}

async fn set_default_channel(
    State(service): State<AgentChannelService>,
    Json(payload): Json<SetDefaultAgentChannelRequest>,
) -> AgentChannelApiResult<Json<Value>> {
    let provider_id = validate_provider_id(payload.provider_id.trim())?.to_string();
    let channel_id = payload.channel_id.trim();
    if channel_id.is_empty() {
        return Err(AgentChannelApiError::bad_request("请选择默认渠道"));
    }
    let mut connection = service
        .open_database()
        .map_err(AgentChannelApiError::internal)?;
    let transaction = connection
        .transaction()
        .map_err(|error| AgentChannelApiError::internal(format!("设置默认渠道失败: {error}")))?;
    set_default_channel_selection(&transaction, &provider_id, channel_id)?;
    transaction
        .commit()
        .map_err(|error| AgentChannelApiError::internal(format!("保存默认渠道失败: {error}")))?;
    Ok(Json(json!({
        "providerId": provider_id,
        "channelId": channel_id,
    })))
}

async fn create_channel(
    State(service): State<AgentChannelService>,
    Json(payload): Json<SaveAgentChannelRequest>,
) -> AgentChannelApiResult<Json<Value>> {
    let provider_id = validate_provider_id(payload.provider_id.trim())?.to_string();
    validate_protocol(&provider_id, payload.protocol)?;
    let name = require_text(&payload.name, "渠道名称不能为空")?.to_string();
    let base_url = validate_url(&payload.base_url, "API 地址")?;
    let models_url = normalize_optional_url(payload.models_url.as_deref(), "模型列表地址")?;
    let template_id = normalize_optional_text(payload.template_id.as_deref());
    let enabled = payload.enabled.unwrap_or(true);
    let requested_default = payload.is_default.unwrap_or(false);
    let id = uuid::Uuid::new_v4().to_string();
    let secret_slot = format!("agent-channel:{id}");
    let now = current_timestamp();
    let mut connection = service
        .open_database()
        .map_err(AgentChannelApiError::internal)?;
    ensure_channel_name_available(&connection, &provider_id, &name, None)?;
    let transaction = connection
        .transaction()
        .map_err(|error| AgentChannelApiError::internal(format!("创建 Agent 渠道失败: {error}")))?;
    let is_default = enabled && requested_default;
    if is_default {
        transaction
            .execute(
                "UPDATE agent_channels SET is_default = 0, updated_at = ? WHERE provider_id = ?",
                params![now, provider_id],
            )
            .map_err(|error| {
                AgentChannelApiError::internal(format!("更新默认渠道失败: {error}"))
            })?;
    }
    transaction
        .execute(
            r#"INSERT INTO agent_channels (
                id, provider_id, name, protocol, base_url, models_url, template_id, enabled,
                is_default, secret_slot, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
            params![
                id,
                provider_id,
                name,
                payload.protocol.as_str(),
                base_url,
                models_url,
                template_id,
                enabled,
                is_default,
                secret_slot,
                now,
                now,
            ],
        )
        .map_err(|error| AgentChannelApiError::internal(format!("创建 Agent 渠道失败: {error}")))?;
    if let Some(models) = payload.models.as_deref() {
        for model in normalize_model_requests(models)? {
            upsert_model(&transaction, &id, &model).map_err(AgentChannelApiError::internal)?;
        }
    }
    repair_default_channel(&transaction, &provider_id).map_err(AgentChannelApiError::internal)?;
    transaction
        .commit()
        .map_err(|error| AgentChannelApiError::internal(format!("保存 Agent 渠道失败: {error}")))?;
    if let Some(api_key) = payload.api_key.as_deref().map(str::trim) {
        if !api_key.is_empty() {
            service
                .secrets
                .set(&secret_slot, api_key)
                .map_err(AgentChannelApiError::internal)?;
        }
    }
    let channels =
        list_channels(&connection, &service.secrets).map_err(AgentChannelApiError::internal)?;
    let channel = channels
        .into_iter()
        .find(|channel| channel.id == id)
        .ok_or_else(|| AgentChannelApiError::internal("Agent 渠道保存后无法读取"))?;
    Ok(Json(json!({ "channel": channel })))
}

async fn update_channel(
    State(service): State<AgentChannelService>,
    AxumPath(channel_id): AxumPath<String>,
    Json(payload): Json<UpdateAgentChannelRequest>,
) -> AgentChannelApiResult<Json<Value>> {
    let mut connection = service
        .open_database()
        .map_err(AgentChannelApiError::internal)?;
    let current = get_stored_channel(&connection, &channel_id)
        .map_err(AgentChannelApiError::internal)?
        .ok_or_else(|| AgentChannelApiError::not_found("Agent 渠道不存在"))?;
    let name = payload
        .name
        .as_deref()
        .map(|value| require_text(value, "渠道名称不能为空").map(str::to_string))
        .transpose()?
        .unwrap_or(current.name.clone());
    ensure_channel_name_available(
        &connection,
        &current.provider_id,
        &name,
        Some(&channel_id),
    )?;
    let protocol = payload.protocol.unwrap_or(current.protocol);
    validate_protocol(&current.provider_id, protocol)?;
    let base_url = payload
        .base_url
        .as_deref()
        .map(|value| validate_url(value, "API 地址"))
        .transpose()?
        .unwrap_or(current.base_url.clone());
    let models_url = match payload.models_url.as_deref() {
        Some(value) => normalize_optional_url(Some(value), "模型列表地址")?,
        None => current.models_url.clone(),
    };
    let template_id = match payload.template_id.as_deref() {
        Some(value) => normalize_optional_text(Some(value)),
        None => current.template_id.clone(),
    };
    let enabled = payload.enabled.unwrap_or(current.enabled);
    let is_default = enabled && payload.is_default.unwrap_or(current.is_default);
    let now = current_timestamp();
    let transaction = connection
        .transaction()
        .map_err(|error| AgentChannelApiError::internal(format!("更新 Agent 渠道失败: {error}")))?;
    if is_default {
        transaction
            .execute(
                "UPDATE agent_channels SET is_default = 0, updated_at = ? WHERE provider_id = ? AND id <> ?",
                params![now, current.provider_id, channel_id],
            )
            .map_err(|error| AgentChannelApiError::internal(format!("更新默认渠道失败: {error}")))?;
    }
    transaction
        .execute(
            r#"UPDATE agent_channels SET
                name = ?, protocol = ?, base_url = ?, models_url = ?, template_id = ?,
                enabled = ?, is_default = ?, updated_at = ?
              WHERE id = ?"#,
            params![
                name,
                protocol.as_str(),
                base_url,
                models_url,
                template_id,
                enabled,
                is_default,
                now,
                channel_id,
            ],
        )
        .map_err(|error| AgentChannelApiError::internal(format!("更新 Agent 渠道失败: {error}")))?;
    if current.enabled && !enabled {
        clear_channel_thread_references(&transaction, &channel_id)
            .map_err(AgentChannelApiError::internal)?;
    }
    repair_default_channel(&transaction, &current.provider_id)
        .map_err(AgentChannelApiError::internal)?;
    transaction
        .commit()
        .map_err(|error| AgentChannelApiError::internal(format!("保存 Agent 渠道失败: {error}")))?;
    if payload.api_key_touched {
        match payload.api_key.as_deref().map(str::trim) {
            Some(value) if !value.is_empty() => service
                .secrets
                .set(&current.secret_slot, value)
                .map_err(AgentChannelApiError::internal)?,
            _ => service
                .secrets
                .delete(&current.secret_slot)
                .map_err(AgentChannelApiError::internal)?,
        }
    }
    let channel = list_channels(&connection, &service.secrets)
        .map_err(AgentChannelApiError::internal)?
        .into_iter()
        .find(|channel| channel.id == channel_id)
        .ok_or_else(|| AgentChannelApiError::internal("Agent 渠道更新后无法读取"))?;
    Ok(Json(json!({ "channel": channel })))
}

async fn delete_channel(
    State(service): State<AgentChannelService>,
    AxumPath(channel_id): AxumPath<String>,
) -> AgentChannelApiResult<Json<Value>> {
    let mut connection = service
        .open_database()
        .map_err(AgentChannelApiError::internal)?;
    let channel = get_stored_channel(&connection, &channel_id)
        .map_err(AgentChannelApiError::internal)?
        .ok_or_else(|| AgentChannelApiError::not_found("Agent 渠道不存在"))?;
    remove_agent_channel_runtime(service.app_data_dir.as_ref(), &channel)
        .map_err(AgentChannelApiError::internal)?;
    let transaction = connection
        .transaction()
        .map_err(|error| AgentChannelApiError::internal(format!("删除 Agent 渠道失败: {error}")))?;
    clear_channel_thread_references(&transaction, &channel_id)
        .map_err(AgentChannelApiError::internal)?;
    transaction
        .execute(
            "DELETE FROM agent_channels WHERE id = ?",
            params![channel_id],
        )
        .map_err(|error| AgentChannelApiError::internal(format!("删除 Agent 渠道失败: {error}")))?;
    repair_default_channel(&transaction, &channel.provider_id)
        .map_err(AgentChannelApiError::internal)?;
    transaction.commit().map_err(|error| {
        AgentChannelApiError::internal(format!("提交 Agent 渠道删除失败: {error}"))
    })?;
    service
        .secrets
        .delete(&channel.secret_slot)
        .map_err(AgentChannelApiError::internal)?;
    Ok(Json(json!({ "ok": true })))
}

fn remove_agent_channel_runtime(
    app_data_dir: &Path,
    channel: &StoredAgentChannel,
) -> Result<(), String> {
    if channel.provider_id != GROK_BUILD_PROVIDER_ID {
        return Ok(());
    }
    let runtime_home = app_data_dir
        .join("agent-runtimes")
        .join("grok")
        .join(&channel.id);
    if runtime_home.is_dir() {
        fs::remove_dir_all(&runtime_home)
            .map_err(|error| format!("清理 Grok 渠道运行目录失败: {error}"))?;
    }
    Ok(())
}

fn clear_channel_thread_references(
    connection: &Connection,
    channel_id: &str,
) -> Result<(), String> {
    let threads_exist = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'threads')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("检查线程表失败: {error}"))?;
    if !threads_exist {
        return Ok(());
    }
    let preferences_exist = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'thread_model_preferences')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("检查模型偏好表失败: {error}"))?;
    if preferences_exist {
        connection
            .execute(
                r#"DELETE FROM thread_model_preferences
                   WHERE thread_id IN (SELECT id FROM threads WHERE agent_channel_id = ?)"#,
                params![channel_id],
            )
            .map_err(|error| format!("清理渠道模型偏好失败: {error}"))?;
    }
    connection
        .execute(
            r#"UPDATE threads
               SET session_id = NULL, transcript_path = NULL, model = NULL,
                   reasoning_effort = NULL, agent_channel_id = NULL,
                   agent_channel_fingerprint = NULL, updated_at = ?
               WHERE agent_channel_id = ?"#,
            params![current_timestamp(), channel_id],
        )
        .map_err(|error| format!("清理线程渠道引用失败: {error}"))?;
    Ok(())
}

async fn get_channel_api_key(
    State(service): State<AgentChannelService>,
    AxumPath(channel_id): AxumPath<String>,
) -> AgentChannelApiResult<Response> {
    let connection = service
        .open_database()
        .map_err(AgentChannelApiError::internal)?;
    let channel = get_stored_channel(&connection, &channel_id)
        .map_err(AgentChannelApiError::internal)?
        .ok_or_else(|| AgentChannelApiError::not_found("Agent 渠道不存在"))?;
    let api_key = service
        .secrets
        .get(&channel.secret_slot)
        .map_err(AgentChannelApiError::bad_request)?;
    Ok((
        [
            (header::CACHE_CONTROL, "no-store"),
            (header::PRAGMA, "no-cache"),
        ],
        Json(json!({ "apiKey": api_key })),
    )
        .into_response())
}

async fn test_channel(
    State(service): State<AgentChannelService>,
    AxumPath(channel_id): AxumPath<String>,
) -> AgentChannelApiResult<Json<Value>> {
    let connection = service
        .open_database()
        .map_err(AgentChannelApiError::internal)?;
    let channel = get_stored_channel(&connection, &channel_id)
        .map_err(AgentChannelApiError::internal)?
        .ok_or_else(|| AgentChannelApiError::not_found("Agent 渠道不存在"))?;
    let api_key = service
        .secrets
        .get(&channel.secret_slot)
        .map_err(AgentChannelApiError::bad_request)?;
    let message = test_provider(&as_provider(&channel), &api_key)
        .await
        .map_err(AgentChannelApiError::bad_request)?;
    Ok(Json(json!({ "ok": true, "message": message })))
}

async fn discover_channel_models(
    State(service): State<AgentChannelService>,
    AxumPath(channel_id): AxumPath<String>,
) -> AgentChannelApiResult<Json<Value>> {
    let connection = service
        .open_database()
        .map_err(AgentChannelApiError::internal)?;
    let channel = get_stored_channel(&connection, &channel_id)
        .map_err(AgentChannelApiError::internal)?
        .ok_or_else(|| AgentChannelApiError::not_found("Agent 渠道不存在"))?;
    let api_key = service
        .secrets
        .get(&channel.secret_slot)
        .map_err(AgentChannelApiError::bad_request)?;
    let models = discover_channel_model_list(&channel, &api_key)
        .await
        .map_err(AgentChannelApiError::bad_request)?;
    Ok(Json(json!({ "models": models })))
}

async fn create_models_batch(
    State(service): State<AgentChannelService>,
    AxumPath(channel_id): AxumPath<String>,
    Json(payload): Json<BatchSaveAgentChannelModelsRequest>,
) -> AgentChannelApiResult<Json<Value>> {
    let mut connection = service
        .open_database()
        .map_err(AgentChannelApiError::internal)?;
    get_stored_channel(&connection, &channel_id)
        .map_err(AgentChannelApiError::internal)?
        .ok_or_else(|| AgentChannelApiError::not_found("Agent 渠道不存在"))?;
    let models = normalize_model_requests(&payload.models)?;
    if models.is_empty() {
        return Err(AgentChannelApiError::bad_request("至少选择一个模型"));
    }
    let transaction = connection
        .transaction()
        .map_err(|error| AgentChannelApiError::internal(format!("保存模型失败: {error}")))?;
    for model in models {
        upsert_model(&transaction, &channel_id, &model).map_err(AgentChannelApiError::internal)?;
    }
    transaction
        .commit()
        .map_err(|error| AgentChannelApiError::internal(format!("保存模型失败: {error}")))?;
    Ok(Json(json!({
        "models": list_models(&connection, &channel_id).map_err(AgentChannelApiError::internal)?
    })))
}

async fn create_model(
    State(service): State<AgentChannelService>,
    AxumPath(channel_id): AxumPath<String>,
    Json(payload): Json<SaveAgentChannelModelRequest>,
) -> AgentChannelApiResult<Json<Value>> {
    let connection = service
        .open_database()
        .map_err(AgentChannelApiError::internal)?;
    get_stored_channel(&connection, &channel_id)
        .map_err(AgentChannelApiError::internal)?
        .ok_or_else(|| AgentChannelApiError::not_found("Agent 渠道不存在"))?;
    let model = normalize_model_request(&payload)?;
    upsert_model(&connection, &channel_id, &model).map_err(AgentChannelApiError::internal)?;
    Ok(Json(json!({
        "models": list_models(&connection, &channel_id).map_err(AgentChannelApiError::internal)?
    })))
}

async fn update_model(
    State(service): State<AgentChannelService>,
    AxumPath(model_id): AxumPath<String>,
    Json(payload): Json<UpdateAgentChannelModelRequest>,
) -> AgentChannelApiResult<Json<Value>> {
    let mut connection = service
        .open_database()
        .map_err(AgentChannelApiError::internal)?;
    let current = get_model(&connection, &model_id)
        .map_err(AgentChannelApiError::internal)?
        .ok_or_else(|| AgentChannelApiError::not_found("Agent 渠道模型不存在"))?;
    let display_name = payload
        .display_name
        .as_deref()
        .map(|value| require_text(value, "模型名称不能为空").map(str::to_string))
        .transpose()?
        .unwrap_or(current.display_name.clone());
    let enabled = payload.enabled.unwrap_or(current.enabled);
    let is_default = enabled && payload.is_default.unwrap_or(current.is_default);
    let capabilities = payload.capabilities.unwrap_or(current.capabilities.clone());
    let now = current_timestamp();
    let transaction = connection
        .transaction()
        .map_err(|error| AgentChannelApiError::internal(format!("更新模型失败: {error}")))?;
    if is_default {
        transaction
            .execute(
                "UPDATE agent_channel_models SET is_default = 0, updated_at = ? WHERE channel_id = ? AND id <> ?",
                params![now, current.channel_id, model_id],
            )
            .map_err(|error| AgentChannelApiError::internal(format!("更新默认模型失败: {error}")))?;
    }
    transaction
        .execute(
            "UPDATE agent_channel_models SET display_name = ?, enabled = ?, is_default = ?, capabilities_json = ?, updated_at = ? WHERE id = ?",
            params![display_name, enabled, is_default, capabilities.to_string(), now, model_id],
        )
        .map_err(|error| AgentChannelApiError::internal(format!("更新模型失败: {error}")))?;
    repair_default_model(&transaction, &current.channel_id)
        .map_err(AgentChannelApiError::internal)?;
    transaction
        .commit()
        .map_err(|error| AgentChannelApiError::internal(format!("更新模型失败: {error}")))?;
    Ok(Json(json!({
        "models": list_models(&connection, &current.channel_id).map_err(AgentChannelApiError::internal)?
    })))
}

async fn delete_model(
    State(service): State<AgentChannelService>,
    AxumPath(model_id): AxumPath<String>,
) -> AgentChannelApiResult<Json<Value>> {
    let mut connection = service
        .open_database()
        .map_err(AgentChannelApiError::internal)?;
    let current = get_model(&connection, &model_id)
        .map_err(AgentChannelApiError::internal)?
        .ok_or_else(|| AgentChannelApiError::not_found("Agent 渠道模型不存在"))?;
    let transaction = connection
        .transaction()
        .map_err(|error| AgentChannelApiError::internal(format!("删除模型失败: {error}")))?;
    transaction
        .execute(
            "DELETE FROM agent_channel_models WHERE id = ?",
            params![model_id],
        )
        .map_err(|error| AgentChannelApiError::internal(format!("删除模型失败: {error}")))?;
    repair_default_model(&transaction, &current.channel_id)
        .map_err(AgentChannelApiError::internal)?;
    transaction
        .commit()
        .map_err(|error| AgentChannelApiError::internal(format!("删除模型失败: {error}")))?;
    Ok(Json(json!({ "ok": true })))
}

fn get_stored_channel(
    connection: &Connection,
    channel_id: &str,
) -> Result<Option<StoredAgentChannel>, String> {
    connection
        .query_row(
            r#"SELECT id, provider_id, name, protocol, base_url, models_url, template_id,
                      enabled, is_default, secret_slot, created_at, updated_at
               FROM agent_channels WHERE id = ?"#,
            params![channel_id],
            map_stored_channel,
        )
        .optional()
        .map_err(|error| format!("读取 Agent 渠道失败: {error}"))
}

fn ensure_channel_name_available(
    connection: &Connection,
    provider_id: &str,
    name: &str,
    exclude_id: Option<&str>,
) -> AgentChannelApiResult<()> {
    let existing = connection
        .query_row(
            r#"SELECT name FROM agent_channels
               WHERE provider_id = ? AND lower(name) = lower(?)
                 AND (? IS NULL OR id <> ?)
               LIMIT 1"#,
            params![provider_id, name.trim(), exclude_id, exclude_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| AgentChannelApiError::internal(format!("检查渠道名称失败: {error}")))?;
    match existing {
        Some(existing) => Err(AgentChannelApiError::conflict(format!(
            "同一 Agent 下已存在同名渠道“{existing}”",
        ))),
        None => Ok(()),
    }
}

fn map_stored_channel(row: &Row<'_>) -> rusqlite::Result<StoredAgentChannel> {
    let protocol: String = row.get(3)?;
    let protocol = AiProtocol::parse(&protocol).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            "Agent 渠道协议无效".into(),
        )
    })?;
    Ok(StoredAgentChannel {
        id: row.get(0)?,
        provider_id: row.get(1)?,
        name: row.get(2)?,
        protocol,
        base_url: row.get(4)?,
        models_url: row.get(5)?,
        template_id: row.get(6)?,
        enabled: row.get(7)?,
        is_default: row.get(8)?,
        secret_slot: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn list_channels(
    connection: &Connection,
    secrets: &SecretStore,
) -> Result<Vec<AgentChannelSummary>, String> {
    let mut statement = connection
        .prepare(
            r#"SELECT id, provider_id, name, protocol, base_url, models_url, template_id,
                      enabled, is_default, secret_slot, created_at, updated_at
               FROM agent_channels
               ORDER BY provider_id, is_default DESC, updated_at DESC"#,
        )
        .map_err(|error| format!("读取 Agent 渠道失败: {error}"))?;
    let rows = statement
        .query_map([], map_stored_channel)
        .map_err(|error| format!("读取 Agent 渠道失败: {error}"))?;
    let mut channels = Vec::new();
    for row in rows {
        let channel = row.map_err(|error| format!("读取 Agent 渠道失败: {error}"))?;
        let api_key_saved = secrets.has(&channel.secret_slot)?;
        let models = list_models(connection, &channel.id)?;
        channels.push(AgentChannelSummary {
            id: channel.id,
            provider_id: channel.provider_id,
            name: channel.name,
            protocol: channel.protocol,
            base_url: channel.base_url,
            models_url: channel.models_url,
            template_id: channel.template_id,
            enabled: channel.enabled,
            is_default: channel.is_default,
            api_key_saved,
            models,
            created_at: channel.created_at,
            updated_at: channel.updated_at,
        });
    }
    Ok(channels)
}

fn list_models(
    connection: &Connection,
    channel_id: &str,
) -> Result<Vec<AgentChannelModelSummary>, String> {
    let mut statement = connection
        .prepare(
            r#"SELECT id, channel_id, model_id, display_name, enabled, is_default,
                      capabilities_json, created_at, updated_at
               FROM agent_channel_models
               WHERE channel_id = ?
               ORDER BY is_default DESC, display_name COLLATE NOCASE, model_id COLLATE NOCASE"#,
        )
        .map_err(|error| format!("读取 Agent 渠道模型失败: {error}"))?;
    let rows = statement
        .query_map(params![channel_id], map_model)
        .map_err(|error| format!("读取 Agent 渠道模型失败: {error}"))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| format!("读取 Agent 渠道模型失败: {error}"))
}

fn get_model(
    connection: &Connection,
    model_id: &str,
) -> Result<Option<AgentChannelModelSummary>, String> {
    connection
        .query_row(
            r#"SELECT id, channel_id, model_id, display_name, enabled, is_default,
                      capabilities_json, created_at, updated_at
               FROM agent_channel_models WHERE id = ?"#,
            params![model_id],
            map_model,
        )
        .optional()
        .map_err(|error| format!("读取 Agent 渠道模型失败: {error}"))
}

fn map_model(row: &Row<'_>) -> rusqlite::Result<AgentChannelModelSummary> {
    let capabilities_json: String = row.get(6)?;
    Ok(AgentChannelModelSummary {
        id: row.get(0)?,
        channel_id: row.get(1)?,
        model_id: row.get(2)?,
        display_name: row.get(3)?,
        enabled: row.get(4)?,
        is_default: row.get(5)?,
        capabilities: serde_json::from_str(&capabilities_json).unwrap_or_else(|_| json!({})),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn normalize_model_requests(
    models: &[SaveAgentChannelModelRequest],
) -> AgentChannelApiResult<Vec<SaveAgentChannelModelRequest>> {
    let mut normalized = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for model in models {
        let model = normalize_model_request(model)?;
        if seen.insert(model.model_id.clone()) {
            normalized.push(model);
        }
    }
    Ok(normalized)
}

fn normalize_model_request(
    model: &SaveAgentChannelModelRequest,
) -> AgentChannelApiResult<SaveAgentChannelModelRequest> {
    let model_id = require_text(&model.model_id, "模型 ID 不能为空")?.to_string();
    let display_name = model
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&model_id)
        .to_string();
    Ok(SaveAgentChannelModelRequest {
        model_id,
        display_name: Some(display_name),
        enabled: Some(model.enabled.unwrap_or(true)),
        is_default: Some(model.is_default.unwrap_or(false)),
        capabilities: Some(model.capabilities.clone().unwrap_or_else(|| json!({}))),
    })
}

fn upsert_model(
    connection: &Connection,
    channel_id: &str,
    model: &SaveAgentChannelModelRequest,
) -> Result<(), String> {
    let now = current_timestamp();
    let model_id = model.model_id.trim();
    let display_name = model.display_name.as_deref().unwrap_or(model_id);
    let enabled = model.enabled.unwrap_or(true);
    let is_default = enabled && model.is_default.unwrap_or(false);
    if is_default {
        connection
            .execute(
                "UPDATE agent_channel_models SET is_default = 0, updated_at = ? WHERE channel_id = ?",
                params![now, channel_id],
            )
            .map_err(|error| format!("更新默认模型失败: {error}"))?;
    }
    connection
        .execute(
            r#"INSERT INTO agent_channel_models (
                 id, channel_id, model_id, display_name, enabled, is_default,
                 capabilities_json, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(channel_id, model_id) DO UPDATE SET
                 display_name = excluded.display_name,
                 enabled = excluded.enabled,
                 is_default = excluded.is_default,
                 capabilities_json = excluded.capabilities_json,
                 updated_at = excluded.updated_at"#,
            params![
                uuid::Uuid::new_v4().to_string(),
                channel_id,
                model_id,
                display_name,
                enabled,
                is_default,
                model
                    .capabilities
                    .as_ref()
                    .cloned()
                    .unwrap_or_else(|| json!({}))
                    .to_string(),
                now,
                now,
            ],
        )
        .map_err(|error| format!("保存 Agent 渠道模型失败: {error}"))?;
    repair_default_model(connection, channel_id)
}

fn repair_default_channel(connection: &Connection, provider_id: &str) -> Result<(), String> {
    let default_channel_id: Option<String> = connection
        .query_row(
            r#"SELECT id FROM agent_channels
               WHERE provider_id = ? AND enabled = 1 AND is_default = 1
               ORDER BY updated_at DESC, id ASC
               LIMIT 1"#,
            params![provider_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("读取默认渠道失败: {error}"))?;
    connection
        .execute(
            r#"UPDATE agent_channels
               SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END,
                   updated_at = ?
               WHERE provider_id = ?
                 AND is_default != CASE WHEN id = ? THEN 1 ELSE 0 END"#,
            params![
                default_channel_id,
                current_timestamp(),
                provider_id,
                default_channel_id,
            ],
        )
        .map_err(|error| format!("修复默认渠道失败: {error}"))?;
    Ok(())
}

fn set_default_channel_selection(
    connection: &Connection,
    provider_id: &str,
    channel_id: &str,
) -> AgentChannelApiResult<()> {
    if channel_id != "system" {
        let is_valid = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM agent_channels WHERE id = ? AND provider_id = ? AND enabled = 1)",
                params![channel_id, provider_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| AgentChannelApiError::internal(format!("校验默认渠道失败: {error}")))?;
        if !is_valid {
            return Err(AgentChannelApiError::bad_request(
                "默认渠道不存在、已停用或不属于当前 Agent",
            ));
        }
    }
    let now = current_timestamp();
    connection
        .execute(
            "UPDATE agent_channels SET is_default = 0, updated_at = ? WHERE provider_id = ? AND is_default = 1",
            params![now, provider_id],
        )
        .map_err(|error| AgentChannelApiError::internal(format!("清理默认渠道失败: {error}")))?;
    if channel_id != "system" {
        let updated = connection
            .execute(
                "UPDATE agent_channels SET is_default = 1, updated_at = ? WHERE id = ? AND provider_id = ? AND enabled = 1",
                params![now, channel_id, provider_id],
            )
            .map_err(|error| AgentChannelApiError::internal(format!("设置默认渠道失败: {error}")))?;
        debug_assert_eq!(updated, 1);
    }
    repair_default_channel(connection, provider_id).map_err(AgentChannelApiError::internal)
}

fn default_channel_ids(connection: &Connection) -> Result<BTreeMap<String, String>, String> {
    let mut defaults = BTreeMap::from([
        (CLAUDE_CODE_PROVIDER_ID.to_string(), "system".to_string()),
        (OPENAI_CODEX_PROVIDER_ID.to_string(), "system".to_string()),
        (GROK_BUILD_PROVIDER_ID.to_string(), "system".to_string()),
        (OPENCODE_PROVIDER_ID.to_string(), "system".to_string()),
    ]);
    let mut statement = connection
        .prepare(
            r#"SELECT provider_id, id FROM agent_channels
               WHERE enabled = 1 AND is_default = 1"#,
        )
        .map_err(|error| format!("读取默认渠道失败: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("读取默认渠道失败: {error}"))?;
    for row in rows {
        let (provider_id, channel_id) =
            row.map_err(|error| format!("解析默认渠道失败: {error}"))?;
        if defaults.contains_key(&provider_id) {
            defaults.insert(provider_id, channel_id);
        }
    }
    Ok(defaults)
}

fn repair_default_model(connection: &Connection, channel_id: &str) -> Result<(), String> {
    let default_model_id: Option<String> = connection
        .query_row(
            r#"SELECT id FROM agent_channel_models
               WHERE channel_id = ? AND enabled = 1
               ORDER BY is_default DESC, display_name COLLATE NOCASE, id ASC
               LIMIT 1"#,
            params![channel_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("读取默认模型失败: {error}"))?;
    connection
        .execute(
            r#"UPDATE agent_channel_models
               SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END,
                   updated_at = ?
               WHERE channel_id = ?
                 AND is_default != CASE WHEN id = ? THEN 1 ELSE 0 END"#,
            params![
                default_model_id,
                current_timestamp(),
                channel_id,
                default_model_id,
            ],
        )
        .map_err(|error| format!("修复默认模型失败: {error}"))?;
    Ok(())
}

fn as_provider(channel: &StoredAgentChannel) -> StoredProvider {
    StoredProvider {
        name: channel.name.clone(),
        protocol: channel.protocol,
        base_url: channel.base_url.clone(),
        enabled: channel.enabled,
        secret_slot: channel.secret_slot.clone(),
    }
}

async fn discover_channel_model_list(
    channel: &StoredAgentChannel,
    api_key: &str,
) -> Result<Vec<DiscoveredModel>, String> {
    let Some(models_url) = channel.models_url.as_deref() else {
        return discover_models(&as_provider(channel), api_key).await;
    };
    let client = reqwest::Client::new();
    let mut request = client.get(models_url);
    request = match channel.protocol {
        AiProtocol::AnthropicMessages => request
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .bearer_auth(api_key),
        _ => request.bearer_auth(api_key),
    };
    let response = request
        .send()
        .await
        .map_err(|error| format!("模型列表请求失败: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("模型列表请求失败: HTTP {}", status.as_u16()));
    }
    let value = response
        .json::<Value>()
        .await
        .map_err(|error| format!("模型列表响应无法解析: {error}"))?;
    parse_discovered_models(&value)
}

fn parse_discovered_models(value: &Value) -> Result<Vec<DiscoveredModel>, String> {
    let items = value
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| value.get("models").and_then(Value::as_array))
        .or_else(|| value.as_array())
        .ok_or_else(|| "模型列表响应中没有 data 或 models 数组".to_string())?;
    let mut seen = std::collections::HashSet::new();
    let mut models = Vec::new();
    for item in items {
        let model_id = item
            .as_str()
            .or_else(|| item.get("id").and_then(Value::as_str))
            .or_else(|| item.get("name").and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let Some(model_id) = model_id else {
            continue;
        };
        if !seen.insert(model_id.to_string()) {
            continue;
        }
        let display_name = item
            .get("display_name")
            .and_then(Value::as_str)
            .or_else(|| item.get("displayName").and_then(Value::as_str))
            .or_else(|| item.get("name").and_then(Value::as_str))
            .unwrap_or(model_id);
        models.push(DiscoveredModel {
            model_id: model_id.to_string(),
            display_name: display_name.to_string(),
        });
    }
    if models.is_empty() {
        Err("模型列表没有返回可用模型".to_string())
    } else {
        models.sort_by(|left, right| left.model_id.cmp(&right.model_id));
        Ok(models)
    }
}

fn build_runtime(
    app_data_dir: &Path,
    channel: &StoredAgentChannel,
    models: &[AgentChannelModelSummary],
    selected_model: Option<&str>,
    api_key: &str,
    session_scope: Option<&str>,
    requested_session_id: Option<&str>,
) -> Result<AgentChannelRuntime, String> {
    let selected_model = selected_model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            models
                .iter()
                .find(|model| model.enabled && model.is_default)
                .or_else(|| models.iter().find(|model| model.enabled))
                .map(|model| model.model_id.clone())
        });
    let mut env = BTreeMap::new();
    let mut codex_config_args = Vec::new();
    let mut effective_model = selected_model.clone();
    env.insert(
        "CODEM_AGENT_CHANNEL_API_KEY".to_string(),
        api_key.to_string(),
    );
    match channel.provider_id.as_str() {
        CLAUDE_CODE_PROVIDER_ID => {
            env.insert("ANTHROPIC_BASE_URL".to_string(), channel.base_url.clone());
            env.insert("ANTHROPIC_AUTH_TOKEN".to_string(), api_key.to_string());
            env.insert("ANTHROPIC_API_KEY".to_string(), api_key.to_string());
            if let Some(model) = selected_model.as_deref() {
                env.insert("ANTHROPIC_MODEL".to_string(), model.to_string());
            }
        }
        OPENAI_CODEX_PROVIDER_ID => {
            let provider_key = format!("codem_{}", channel.id.replace('-', "_"));
            let wire_api = match channel.protocol {
                AiProtocol::OpenaiResponses => "responses",
                AiProtocol::OpenaiChat => "chat",
                _ => return Err("Codex 渠道仅支持 OpenAI Responses 或 Chat 接口".to_string()),
            };
            codex_config_args.extend([
                format!("model_provider={}", toml_string(&provider_key)),
                format!(
                    "model_providers.{provider_key}.name={}",
                    toml_string(&channel.name)
                ),
                format!(
                    "model_providers.{provider_key}.base_url={}",
                    toml_string(&channel.base_url)
                ),
                format!(
                    "model_providers.{provider_key}.env_key={}",
                    toml_string("CODEM_AGENT_CHANNEL_API_KEY")
                ),
                format!(
                    "model_providers.{provider_key}.wire_api={}",
                    toml_string(wire_api)
                ),
                format!("model_providers.{provider_key}.requires_openai_auth=false"),
            ]);
        }
        GROK_BUILD_PROVIDER_ID => {
            env.insert("GROK_MODELS_BASE_URL".to_string(), channel.base_url.clone());
            env.insert("XAI_API_KEY".to_string(), api_key.to_string());
            if let Some(auth_path) = grok_auth_path() {
                env.insert(
                    "GROK_AUTH_PATH".to_string(),
                    auth_path.to_string_lossy().to_string(),
                );
            }
            if let Some(models_url) = channel.models_url.as_deref() {
                env.insert("GROK_MODELS_LIST_URL".to_string(), models_url.to_string());
            }
            let (home, aliases) = prepare_grok_runtime_home(
                app_data_dir,
                channel,
                models,
                session_scope,
                requested_session_id,
            )?;
            env.insert("GROK_HOME".to_string(), home.to_string_lossy().to_string());
            if let Some(model) = selected_model.as_deref() {
                effective_model = aliases
                    .get(model)
                    .cloned()
                    .or_else(|| Some(model.to_string()));
            }
        }
        OPENCODE_PROVIDER_ID => {
            let provider_key = format!("codem_{}", channel.id.replace('-', "_"));
            let package = match channel.protocol {
                AiProtocol::AnthropicMessages => "@ai-sdk/anthropic",
                AiProtocol::OpenaiChat => "@ai-sdk/openai-compatible",
                _ => {
                    return Err(
                        "OpenCode 渠道仅支持 OpenAI Chat 或 Anthropic Messages 接口".to_string()
                    )
                }
            };
            let runtime_base_url = if channel.protocol == AiProtocol::AnthropicMessages {
                opencode_anthropic_base_url(&channel.base_url)?
            } else {
                channel.base_url.clone()
            };
            let model_values = models
                .iter()
                .filter(|model| model.enabled)
                .map(|model| {
                    (
                        model.model_id.clone(),
                        json!({ "name": model.display_name }),
                    )
                })
                .collect::<serde_json::Map<_, _>>();
            let config = json!({
                "provider": {
                    provider_key.clone(): {
                        "npm": package,
                        "name": channel.name,
                        "options": {
                            "baseURL": runtime_base_url,
                            "apiKey": "{env:CODEM_AGENT_CHANNEL_API_KEY}"
                        },
                        "models": model_values
                    }
                }
            });
            env.insert("OPENCODE_CONFIG_CONTENT".to_string(), config.to_string());
            if let Some(model) = selected_model.as_deref() {
                effective_model = Some(format!("{provider_key}/{model}"));
            }
        }
        _ => return Err("不支持的 Agent 渠道".to_string()),
    }
    let mut fingerprint_source = format!(
        "{}|{}|{}|{}|{}|{}",
        channel.id,
        channel.updated_at,
        channel.protocol.as_str(),
        channel.base_url,
        channel.models_url.as_deref().unwrap_or_default(),
        selected_model.as_deref().unwrap_or_default(),
    );
    fingerprint_source.push('|');
    fingerprint_source.push_str(&hex_digest(api_key.as_bytes()));
    Ok(AgentChannelRuntime {
        channel_id: channel.id.clone(),
        fingerprint: hex_digest(fingerprint_source.as_bytes()),
        env,
        codex_config_args,
        effective_model,
    })
}

fn opencode_anthropic_base_url(base_url: &str) -> Result<String, String> {
    let mut url = Url::parse(base_url).map_err(|error| format!("API 地址无效: {error}"))?;
    let path = url.path().trim_end_matches('/').to_string();
    let lower_path = path.to_ascii_lowercase();
    let runtime_path = if lower_path.ends_with("/messages") {
        path[..path.len() - "/messages".len()].to_string()
    } else if lower_path.ends_with("/v1") {
        path
    } else if path.is_empty() {
        "/v1".to_string()
    } else {
        format!("{path}/v1")
    };
    url.set_path(&runtime_path);
    Ok(url.to_string().trim_end_matches('/').to_string())
}

fn toml_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| format!("\"{}\"", value.replace('"', "\\\"")))
}

fn hex_digest(value: &[u8]) -> String {
    let digest = Sha256::digest(value);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn grok_auth_path() -> Option<PathBuf> {
    home_dir()
        .map(|path| path.join(".grok").join("auth.json"))
        .filter(|path| path.is_file())
}

fn prepare_grok_runtime_home(
    app_data_dir: &Path,
    channel: &StoredAgentChannel,
    models: &[AgentChannelModelSummary],
    session_scope: Option<&str>,
    requested_session_id: Option<&str>,
) -> Result<(PathBuf, BTreeMap<String, String>), String> {
    let source_home = home_dir().map(|path| path.join(".grok"));
    prepare_grok_runtime_home_from_source(
        app_data_dir,
        channel,
        models,
        source_home.as_deref(),
        session_scope,
        requested_session_id,
    )
}

fn prepare_grok_runtime_home_from_source(
    app_data_dir: &Path,
    channel: &StoredAgentChannel,
    models: &[AgentChannelModelSummary],
    source_home: Option<&Path>,
    session_scope: Option<&str>,
    requested_session_id: Option<&str>,
) -> Result<(PathBuf, BTreeMap<String, String>), String> {
    let grok_root = app_data_dir.join("agent-runtimes").join("grok");
    let runtime_home = session_scope
        .filter(|value| !value.trim().is_empty())
        .map(|value| grok_root.join("threads").join(sanitize_identifier(value)))
        .unwrap_or_else(|| grok_root.join(&channel.id));
    fs::create_dir_all(&runtime_home)
        .map_err(|error| format!("创建 Grok 渠道运行目录失败: {error}"))?;
    if let Some(session_id) = requested_session_id.filter(|value| !value.trim().is_empty()) {
        migrate_grok_session_from_legacy_channel(&grok_root, &runtime_home, session_id)?;
    }
    let mut config = source_home
        .map(|path| path.join("config.toml"))
        .filter(|path| path.is_file())
        .and_then(|path| fs::read_to_string(path).ok())
        .unwrap_or_default();
    config.push_str("\n\n# CodeM Agent channel runtime configuration\n");
    let mut aliases = BTreeMap::new();
    for model in models.iter().filter(|model| model.enabled) {
        let alias = format!(
            "codem-{}-{}",
            &channel.id[..channel.id.len().min(8)],
            sanitize_identifier(&model.model_id)
        );
        aliases.insert(model.model_id.clone(), alias.clone());
        config.push_str(&format!("[model.{}]\n", toml_key(&alias)));
        config.push_str(&format!("model = {}\n", toml_string(&model.model_id)));
        config.push_str(&format!("name = {}\n", toml_string(&model.display_name)));
        config.push_str(&format!("base_url = {}\n", toml_string(&channel.base_url)));
        config.push_str(&format!(
            "api_backend = {}\n",
            toml_string(match channel.protocol {
                AiProtocol::OpenaiResponses => "responses",
                AiProtocol::OpenaiChat => "chat_completions",
                AiProtocol::AnthropicMessages => "messages",
                AiProtocol::GeminiGenerateContent => "chat_completions",
            })
        ));
        config.push_str("env_key = \"CODEM_AGENT_CHANNEL_API_KEY\"\n");
        if channel.protocol == AiProtocol::AnthropicMessages {
            config.push_str(
                "extra_headers = { \"x-api-key\" = \"${CODEM_AGENT_CHANNEL_API_KEY}\", \"anthropic-version\" = \"2023-06-01\" }\n",
            );
        }
        config.push('\n');
    }
    fs::write(runtime_home.join("config.toml"), config)
        .map_err(|error| format!("写入 Grok 渠道运行配置失败: {error}"))?;
    if let Some(source_home) = source_home {
        sync_grok_runtime_assets(source_home, &runtime_home)?;
    }
    Ok((runtime_home, aliases))
}

fn migrate_grok_session_from_legacy_channel(
    grok_root: &Path,
    runtime_home: &Path,
    session_id: &str,
) -> Result<(), String> {
    let target_sessions = runtime_home.join("sessions");
    if find_grok_session_workspace(&target_sessions, session_id).is_some() {
        return Ok(());
    }
    let entries =
        fs::read_dir(grok_root).map_err(|error| format!("读取 Grok 运行目录失败: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 Grok 运行目录项失败: {error}"))?;
        let source_home = entry.path();
        if !source_home.is_dir() || source_home == runtime_home || entry.file_name() == "threads" {
            continue;
        }
        let source_sessions = source_home.join("sessions");
        let Some(workspace) = find_grok_session_workspace(&source_sessions, session_id) else {
            continue;
        };
        let target_workspace = target_sessions.join(
            workspace
                .file_name()
                .ok_or_else(|| "Grok 会话工作区目录名无效".to_string())?,
        );
        copy_directory(&workspace, &target_workspace, 0)?;
        let source_index = source_sessions.join("session_search.sqlite");
        if source_index.is_file() {
            fs::create_dir_all(&target_sessions)
                .map_err(|error| format!("创建 Grok 会话目录失败: {error}"))?;
            fs::copy(&source_index, target_sessions.join("session_search.sqlite"))
                .map_err(|error| format!("迁移 Grok 会话索引失败: {error}"))?;
        }
        return Ok(());
    }
    Ok(())
}

fn find_grok_session_workspace(sessions_root: &Path, session_id: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(sessions_root).ok()?;
    for entry in entries.flatten() {
        let workspace = entry.path();
        if !workspace.is_dir() {
            continue;
        }
        if workspace.join(session_id).is_dir() {
            return Some(workspace);
        }
    }
    None
}

fn sanitize_identifier(value: &str) -> String {
    let value = value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    value.trim_matches('-').chars().take(48).collect()
}

fn toml_key(value: &str) -> String {
    toml_string(value)
}

fn sync_grok_runtime_assets(source_home: &Path, runtime_home: &Path) -> Result<(), String> {
    for name in [
        "managed_config.toml",
        "requirements.toml",
        "mcp_credentials.json",
    ] {
        let source = source_home.join(name);
        if source.is_file() {
            fs::copy(&source, runtime_home.join(name))
                .map_err(|error| format!("同步 Grok 配置 {name} 失败: {error}"))?;
        }
    }
    for name in ["skills", "agents", "personas", "plugins"] {
        let source = source_home.join(name);
        if source.is_dir() {
            copy_directory(&source, &runtime_home.join(name), 0)?;
        }
    }
    Ok(())
}

fn copy_directory(source: &Path, target: &Path, depth: usize) -> Result<(), String> {
    if depth > 12 {
        return Err("Grok 配置目录层级过深".to_string());
    }
    fs::create_dir_all(target).map_err(|error| format!("创建 Grok 配置目录失败: {error}"))?;
    for entry in fs::read_dir(source).map_err(|error| format!("读取 Grok 配置目录失败: {error}"))?
    {
        let entry = entry.map_err(|error| format!("读取 Grok 配置项失败: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("读取 Grok 配置类型失败: {error}"))?;
        let target_path = target.join(entry.file_name());
        if file_type.is_dir() {
            copy_directory(&entry.path(), &target_path, depth + 1)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), target_path)
                .map_err(|error| format!("同步 Grok 配置文件失败: {error}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn insert_channel(
        connection: &Connection,
        id: &str,
        enabled: bool,
        is_default: bool,
        updated_at: &str,
    ) {
        connection
            .execute(
                r#"INSERT INTO agent_channels (
                     id, provider_id, name, protocol, base_url, models_url, enabled,
                     is_default, secret_slot, created_at, updated_at
                   ) VALUES (?, 'claude-code', ?, 'anthropic_messages',
                     'https://api.example.com', NULL, ?, ?, ?, ?, ?)"#,
                params![
                    id,
                    id,
                    enabled,
                    is_default,
                    format!("secret:{id}"),
                    updated_at,
                    updated_at,
                ],
            )
            .expect("insert channel");
    }

    fn insert_model(connection: &Connection, id: &str, enabled: bool, is_default: bool) {
        connection
            .execute(
                r#"INSERT INTO agent_channel_models (
                     id, channel_id, model_id, display_name, enabled, is_default,
                     capabilities_json, created_at, updated_at
                   ) VALUES (?, 'channel', ?, ?, ?, ?, '{}', '2026-07-16T00:00:00Z',
                     '2026-07-16T00:00:00Z')"#,
                params![id, id, id, enabled, is_default],
            )
            .expect("insert model");
    }

    #[test]
    fn channel_names_are_unique_within_the_same_agent() {
        let connection = Connection::open_in_memory().expect("open database");
        initialize_database(&connection).expect("initialize database");
        insert_channel(&connection, "Primary", true, false, "2026-07-19T00:00:00Z");

        let error = ensure_channel_name_available(
            &connection,
            CLAUDE_CODE_PROVIDER_ID,
            "primary",
            None,
        )
        .expect_err("case-insensitive duplicate should fail");
        assert_eq!(error.status, StatusCode::CONFLICT);
        ensure_channel_name_available(
            &connection,
            CLAUDE_CODE_PROVIDER_ID,
            "Primary",
            Some("Primary"),
        )
        .expect("editing the same channel should remain valid");
        ensure_channel_name_available(&connection, OPENAI_CODEX_PROVIDER_ID, "Primary", None)
            .expect("different Agent scopes may reuse a name");
    }

    #[test]
    fn agent_channel_protocol_matrix_matches_runtime_adapters() {
        assert!(validate_protocol(CLAUDE_CODE_PROVIDER_ID, AiProtocol::AnthropicMessages).is_ok());
        assert!(validate_protocol(OPENAI_CODEX_PROVIDER_ID, AiProtocol::OpenaiResponses).is_ok());
        assert!(validate_protocol(OPENAI_CODEX_PROVIDER_ID, AiProtocol::OpenaiChat).is_ok());
        assert!(validate_protocol(GROK_BUILD_PROVIDER_ID, AiProtocol::OpenaiResponses).is_ok());
        assert!(validate_protocol(GROK_BUILD_PROVIDER_ID, AiProtocol::OpenaiChat).is_ok());
        assert!(validate_protocol(GROK_BUILD_PROVIDER_ID, AiProtocol::AnthropicMessages).is_ok());
        assert!(validate_protocol(OPENCODE_PROVIDER_ID, AiProtocol::OpenaiChat).is_ok());
        assert!(validate_protocol(OPENCODE_PROVIDER_ID, AiProtocol::AnthropicMessages).is_ok());

        assert!(validate_protocol(CLAUDE_CODE_PROVIDER_ID, AiProtocol::OpenaiChat).is_err());
        assert!(validate_protocol(OPENCODE_PROVIDER_ID, AiProtocol::OpenaiResponses).is_err());
    }

    #[test]
    fn database_migrates_legacy_opencode_responses_channels_to_chat() {
        let connection = Connection::open_in_memory().expect("open database");
        initialize_database(&connection).expect("initialize database");
        connection
            .execute(
                r#"INSERT INTO agent_channels (
                     id, provider_id, name, protocol, base_url, models_url, enabled,
                     is_default, secret_slot, created_at, updated_at
                   ) VALUES ('legacy-opencode', 'opencode', 'Legacy OpenCode',
                     'openai_responses', 'https://api.example.com/v1', NULL, 1, 1,
                     'secret:legacy-opencode', '2026-07-16T00:00:00Z',
                     '2026-07-16T00:00:00Z')"#,
                [],
            )
            .expect("insert legacy OpenCode channel");

        initialize_database(&connection).expect("run channel migration");

        let protocol: String = connection
            .query_row(
                "SELECT protocol FROM agent_channels WHERE id = 'legacy-opencode'",
                [],
                |row| row.get(0),
            )
            .expect("read migrated protocol");
        assert_eq!(protocol, "openai_chat");
    }

    #[test]
    fn grok_openai_chat_channel_creates_an_isolated_custom_model() {
        let root =
            std::env::temp_dir().join(format!("codem-grok-agent-channel-{}", uuid::Uuid::new_v4()));
        let channel = StoredAgentChannel {
            id: "channel".to_string(),
            provider_id: GROK_BUILD_PROVIDER_ID.to_string(),
            name: "DeepSeek".to_string(),
            protocol: AiProtocol::OpenaiChat,
            base_url: "https://api.deepseek.com".to_string(),
            models_url: Some("https://api.deepseek.com/models".to_string()),
            template_id: Some("deepseek".to_string()),
            enabled: true,
            is_default: false,
            secret_slot: "secret:channel".to_string(),
            created_at: "2026-07-16T00:00:00Z".to_string(),
            updated_at: "2026-07-16T00:00:00Z".to_string(),
        };
        let models = vec![AgentChannelModelSummary {
            id: "model".to_string(),
            channel_id: channel.id.clone(),
            model_id: "deepseek-chat".to_string(),
            display_name: "DeepSeek Chat".to_string(),
            enabled: true,
            is_default: true,
            capabilities: json!({}),
            created_at: "2026-07-16T00:00:00Z".to_string(),
            updated_at: "2026-07-16T00:00:00Z".to_string(),
        }];

        let (runtime_home, aliases) =
            prepare_grok_runtime_home_from_source(&root, &channel, &models, None, None, None)
                .expect("prepare isolated Grok runtime");
        let config = fs::read_to_string(runtime_home.join("config.toml"))
            .expect("read isolated Grok config");

        assert_eq!(
            aliases.get("deepseek-chat").map(String::as_str),
            Some("codem-channel-deepseek-chat")
        );
        assert!(config.contains("api_backend = \"chat_completions\""));
        assert!(config.contains("env_key = \"CODEM_AGENT_CHANNEL_API_KEY\""));
        assert!(config.contains("base_url = \"https://api.deepseek.com\""));
        remove_agent_channel_runtime(&root, &channel).expect("remove isolated Grok runtime");
        assert!(!runtime_home.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn grok_legacy_session_migrates_into_thread_scoped_runtime_home() {
        let root = std::env::temp_dir()
            .join(format!("codem-grok-session-migration-{}", uuid::Uuid::new_v4()));
        let legacy_workspace = root
            .join("agent-runtimes")
            .join("grok")
            .join("legacy-channel")
            .join("sessions")
            .join("encoded-workspace")
            .join("session-1");
        fs::create_dir_all(&legacy_workspace).expect("create legacy session");
        fs::write(legacy_workspace.join("chat_history.jsonl"), "legacy")
            .expect("write legacy session");

        let target_home = root
            .join("agent-runtimes")
            .join("grok")
            .join("threads")
            .join("thread-1");
        migrate_grok_session_from_legacy_channel(
            &root.join("agent-runtimes").join("grok"),
            &target_home,
            "session-1",
        )
        .expect("migrate legacy session");

        assert_eq!(
            fs::read_to_string(
                target_home
                    .join("sessions")
                    .join("encoded-workspace")
                    .join("session-1")
                    .join("chat_history.jsonl")
            )
            .expect("read migrated session"),
            "legacy"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn opencode_anthropic_runtime_uses_ai_sdk_versioned_base_url() {
        for (input, expected) in [
            (
                "https://api.minimaxi.com/anthropic",
                "https://api.minimaxi.com/anthropic/v1",
            ),
            (
                "https://api.deepseek.com/anthropic/",
                "https://api.deepseek.com/anthropic/v1",
            ),
            (
                "https://proxy.example.com/api/v1",
                "https://proxy.example.com/api/v1",
            ),
            (
                "https://proxy.example.com/api/v1/messages",
                "https://proxy.example.com/api/v1",
            ),
        ] {
            assert_eq!(
                opencode_anthropic_base_url(input).expect("normalize Anthropic base URL"),
                expected
            );
        }

        let channel = StoredAgentChannel {
            id: "channel".to_string(),
            provider_id: OPENCODE_PROVIDER_ID.to_string(),
            name: "MiniMax".to_string(),
            protocol: AiProtocol::AnthropicMessages,
            base_url: "https://api.minimaxi.com/anthropic".to_string(),
            models_url: None,
            template_id: Some("minimax".to_string()),
            enabled: true,
            is_default: false,
            secret_slot: "secret:channel".to_string(),
            created_at: "2026-07-16T00:00:00Z".to_string(),
            updated_at: "2026-07-16T00:00:00Z".to_string(),
        };
        let models = vec![AgentChannelModelSummary {
            id: "model".to_string(),
            channel_id: channel.id.clone(),
            model_id: "MiniMax-M3".to_string(),
            display_name: "MiniMax M3".to_string(),
            enabled: true,
            is_default: true,
            capabilities: json!({}),
            created_at: "2026-07-16T00:00:00Z".to_string(),
            updated_at: "2026-07-16T00:00:00Z".to_string(),
        }];

        let runtime = build_runtime(
            std::env::temp_dir().as_path(),
            &channel,
            &models,
            Some("MiniMax-M3"),
            "test-key",
            None,
            None,
        )
        .expect("build OpenCode runtime");
        let config: Value = serde_json::from_str(
            runtime
                .env
                .get("OPENCODE_CONFIG_CONTENT")
                .expect("OpenCode config content"),
        )
        .expect("parse OpenCode config content");
        assert_eq!(
            config["provider"]["codem_channel"]["options"]["baseURL"],
            "https://api.minimaxi.com/anthropic/v1"
        );
        assert_eq!(
            runtime.effective_model.as_deref(),
            Some("codem_channel/MiniMax-M3")
        );
    }

    #[test]
    fn default_channel_is_unique_and_falls_back_to_system() {
        let connection = Connection::open_in_memory().expect("open database");
        initialize_database(&connection).expect("initialize database");
        insert_channel(
            &connection,
            "disabled-default",
            false,
            true,
            "2026-07-16T01:00:00Z",
        );
        insert_channel(
            &connection,
            "enabled-older",
            true,
            false,
            "2026-07-16T02:00:00Z",
        );
        insert_channel(
            &connection,
            "enabled-newer",
            true,
            false,
            "2026-07-16T03:00:00Z",
        );

        repair_default_channel(&connection, CLAUDE_CODE_PROVIDER_ID)
            .expect("repair default channel");
        let defaults = connection
            .prepare("SELECT id FROM agent_channels WHERE is_default = 1 ORDER BY id")
            .expect("prepare defaults")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query defaults")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect defaults");
        assert!(defaults.is_empty());

        set_default_channel_selection(
            &connection,
            CLAUDE_CODE_PROVIDER_ID,
            "enabled-newer",
        )
        .expect("set CodeM default channel");
        let selected = default_channel_ids(&connection).expect("read default channel ids");
        assert_eq!(
            selected.get(CLAUDE_CODE_PROVIDER_ID).map(String::as_str),
            Some("enabled-newer")
        );

        for invalid_id in ["missing", "disabled-default"] {
            let error = set_default_channel_selection(
                &connection,
                CLAUDE_CODE_PROVIDER_ID,
                invalid_id,
            )
            .expect_err("invalid default channel should be rejected");
            assert_eq!(error.status, StatusCode::BAD_REQUEST);
            let still_selected: String = connection
                .query_row(
                    "SELECT id FROM agent_channels WHERE provider_id = ? AND is_default = 1",
                    params![CLAUDE_CODE_PROVIDER_ID],
                    |row| row.get(0),
                )
                .expect("read unchanged default");
            assert_eq!(still_selected, "enabled-newer");
        }

        connection
            .execute(
                r#"INSERT INTO agent_channels (
                     id, provider_id, name, protocol, base_url, models_url, enabled,
                     is_default, secret_slot, created_at, updated_at
                   ) VALUES ('other-provider', 'opencode', 'Other Provider', 'openai_chat',
                     'https://api.example.com', NULL, 1, 0, 'secret:other-provider',
                     '2026-07-16T00:00:00Z', '2026-07-16T00:00:00Z')"#,
                [],
            )
            .expect("insert other provider channel");
        let error = set_default_channel_selection(
            &connection,
            CLAUDE_CODE_PROVIDER_ID,
            "other-provider",
        )
        .expect_err("cross-provider default channel should be rejected");
        assert_eq!(error.status, StatusCode::BAD_REQUEST);

        connection
            .execute(
                "UPDATE agent_channels SET enabled = 0 WHERE id = 'enabled-newer'",
                [],
            )
            .expect("disable default");
        repair_default_channel(&connection, CLAUDE_CODE_PROVIDER_ID)
            .expect("fall back to system");
        let replacement: Option<String> = connection
            .query_row(
                "SELECT id FROM agent_channels WHERE is_default = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .expect("read replacement");
        assert_eq!(replacement, None);

        set_default_channel_selection(
            &connection,
            CLAUDE_CODE_PROVIDER_ID,
            "enabled-older",
        )
        .expect("set replacement default");
        set_default_channel_selection(&connection, CLAUDE_CODE_PROVIDER_ID, "system")
            .expect("set system default");
        let selected = default_channel_ids(&connection).expect("read system default");
        assert_eq!(
            selected.get(CLAUDE_CODE_PROVIDER_ID).map(String::as_str),
            Some("system")
        );

        connection
            .execute("UPDATE agent_channels SET enabled = 0", [])
            .expect("disable all channels");
        repair_default_channel(&connection, CLAUDE_CODE_PROVIDER_ID)
            .expect("clear default without enabled channels");
        let default_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM agent_channels WHERE is_default = 1",
                [],
                |row| row.get(0),
            )
            .expect("count defaults");
        assert_eq!(default_count, 0);
    }

    #[test]
    fn default_model_is_unique_and_never_disabled() {
        let connection = Connection::open_in_memory().expect("open database");
        initialize_database(&connection).expect("initialize database");
        insert_channel(&connection, "channel", true, true, "2026-07-16T00:00:00Z");
        insert_model(&connection, "disabled", false, true);
        insert_model(&connection, "enabled", true, false);

        repair_default_model(&connection, "channel").expect("repair default model");
        let default_model: Option<String> = connection
            .query_row(
                "SELECT id FROM agent_channel_models WHERE is_default = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .expect("read default model");
        assert_eq!(default_model.as_deref(), Some("enabled"));
    }

    #[test]
    fn clearing_channel_references_resets_thread_runtime_and_preferences() {
        let connection = Connection::open_in_memory().expect("open database");
        connection
            .execute_batch(
                r#"
                CREATE TABLE threads (
                  id TEXT PRIMARY KEY,
                  session_id TEXT,
                  transcript_path TEXT,
                  model TEXT,
                  reasoning_effort TEXT,
                  agent_channel_id TEXT,
                  agent_channel_fingerprint TEXT,
                  updated_at TEXT
                );
                CREATE TABLE thread_model_preferences (
                  thread_id TEXT,
                  model_id TEXT,
                  reasoning_effort TEXT
                );
                INSERT INTO threads VALUES (
                  'thread', 'session', 'transcript', 'model', 'high', 'channel',
                  'fingerprint', '2026-07-16T00:00:00Z'
                );
                INSERT INTO thread_model_preferences VALUES ('thread', 'model', 'high');
                "#,
            )
            .expect("prepare thread state");

        clear_channel_thread_references(&connection, "channel").expect("clear channel references");
        let runtime: (
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        ) = connection
            .query_row(
                r#"SELECT session_id, transcript_path, model, reasoning_effort,
                          agent_channel_id, agent_channel_fingerprint
                   FROM threads WHERE id = 'thread'"#,
                [],
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
            .expect("read cleared thread");
        assert_eq!(runtime, (None, None, None, None, None, None));
        let preference_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM thread_model_preferences WHERE thread_id = 'thread'",
                [],
                |row| row.get(0),
            )
            .expect("count preferences");
        assert_eq!(preference_count, 0);
    }
}
