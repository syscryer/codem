use crate::{
    agent_runtime::{CLAUDE_CODE_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID, OPENCODE_PROVIDER_ID},
    ordinary_chat::{
        provider::PROVIDER_TEMPLATES, secrets::SecretStore, storage as chat_storage,
        types::AiProtocol,
    },
};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

const SOURCE_CCSWITCH: &str = "ccswitch";
const SOURCE_CHERRY_STUDIO: &str = "cherry_studio";
const TARGET_AGENT: &str = "agent";
const TARGET_ORDINARY_CHAT: &str = "ordinary_chat";

#[derive(Clone)]
pub(crate) struct ProviderImportService {
    database_path: Arc<PathBuf>,
    secrets: SecretStore,
}

#[derive(Clone, Debug)]
struct ExternalProviderConfig {
    source: &'static str,
    source_id: String,
    target_scope: String,
    name: String,
    protocol: AiProtocol,
    base_url: String,
    api_key: String,
    models: Vec<ExternalModel>,
    preset_id: Option<String>,
    enabled: bool,
    warning: String,
    unavailable_reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalModel {
    model_id: String,
    display_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalProviderItem {
    source_id: String,
    target_scope: String,
    name: String,
    protocol: AiProtocol,
    base_url: String,
    api_key_available: bool,
    models: Vec<ExternalModel>,
    preset_id: Option<String>,
    enabled: bool,
    warning: String,
    imported: bool,
    update_available: bool,
    importable: bool,
    reason: String,
    target_id: Option<String>,
    target_name: Option<String>,
    target_exists: bool,
    conflict_target_id: Option<String>,
    conflict_target_name: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalProviderScanResponse {
    source: &'static str,
    detected: bool,
    data_path: Option<String>,
    message: String,
    items: Vec<ExternalProviderItem>,
}

#[derive(Clone, Debug)]
struct ImportRecord {
    target_id: String,
    source_fingerprint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentScanQuery {
    provider_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportSelection {
    source_id: String,
    overwrite_target_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportProvidersRequest {
    items: Vec<ImportSelection>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncProviderRequest {
    target_kind: String,
    source: String,
    source_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopyAgentChannelRequest {
    channel_id: String,
    overwrite_provider_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportResult {
    source_id: String,
    target_id: String,
    target_name: String,
    overwritten: bool,
}

#[derive(Debug)]
struct ProviderImportError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

type ProviderImportResult<T> = Result<T, ProviderImportError>;

impl ProviderImportError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "invalid_request",
            message: message.into(),
        }
    }

    fn conflict(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            code: "name_conflict",
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code: "not_found",
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "internal_error",
            message: message.into(),
        }
    }
}

impl IntoResponse for ProviderImportError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({ "code": self.code, "error": self.message })),
        )
            .into_response()
    }
}

impl ProviderImportService {
    pub(crate) fn new(app_data_dir: PathBuf, secrets: SecretStore) -> Self {
        Self {
            database_path: Arc::new(app_data_dir.join("codem.sqlite")),
            secrets,
        }
    }

    fn open_database(&self) -> Result<Connection, String> {
        let connection = Connection::open(self.database_path.as_ref())
            .map_err(|error| format!("打开渠道导入数据库失败: {error}"))?;
        crate::agent_channels::initialize_database(&connection)?;
        chat_storage::initialize_database(&connection)?;
        initialize_import_database(&connection)?;
        Ok(connection)
    }
}

pub(crate) fn router(service: ProviderImportService) -> Router {
    Router::new()
        .route("/api/provider-import/agent/scan", get(scan_agent_providers))
        .route("/api/provider-import/chat/scan", get(scan_chat_providers))
        .route(
            "/api/provider-import/agent/import",
            post(import_agent_providers),
        )
        .route(
            "/api/provider-import/chat/import",
            post(import_chat_providers),
        )
        .route("/api/provider-import/sync", post(sync_provider))
        .route(
            "/api/provider-import/agent/copy-to-chat",
            post(copy_agent_channel_to_chat),
        )
        .with_state(service)
}

async fn scan_agent_providers(
    State(service): State<ProviderImportService>,
    Query(query): Query<AgentScanQuery>,
) -> ProviderImportResult<Json<ExternalProviderScanResponse>> {
    let provider_id = query.provider_id.and_then(normalize_agent_scope);
    run_blocking(move || scan_agent_provider_configs(&service, provider_id.as_deref()))
        .await
        .map(Json)
}

async fn scan_chat_providers(
    State(service): State<ProviderImportService>,
) -> ProviderImportResult<Json<ExternalProviderScanResponse>> {
    run_blocking(move || scan_chat_provider_configs(&service))
        .await
        .map(Json)
}

async fn import_agent_providers(
    State(service): State<ProviderImportService>,
    Json(payload): Json<ImportProvidersRequest>,
) -> ProviderImportResult<Json<Value>> {
    let results = run_blocking(move || {
        import_selected_providers(&service, TARGET_AGENT, SOURCE_CCSWITCH, payload.items)
    })
    .await?;
    Ok(Json(json!({ "results": results })))
}

async fn import_chat_providers(
    State(service): State<ProviderImportService>,
    Json(payload): Json<ImportProvidersRequest>,
) -> ProviderImportResult<Json<Value>> {
    let results = run_blocking(move || {
        import_selected_providers(
            &service,
            TARGET_ORDINARY_CHAT,
            SOURCE_CHERRY_STUDIO,
            payload.items,
        )
    })
    .await?;
    Ok(Json(json!({ "results": results })))
}

async fn sync_provider(
    State(service): State<ProviderImportService>,
    Json(payload): Json<SyncProviderRequest>,
) -> ProviderImportResult<Json<Value>> {
    let result = run_blocking(move || sync_imported_provider(&service, payload)).await?;
    Ok(Json(json!({ "result": result })))
}

async fn copy_agent_channel_to_chat(
    State(service): State<ProviderImportService>,
    Json(payload): Json<CopyAgentChannelRequest>,
) -> ProviderImportResult<Json<Value>> {
    let result = run_blocking(move || copy_agent_channel(&service, payload)).await?;
    Ok(Json(json!({ "result": result })))
}

async fn run_blocking<T, F>(operation: F) -> ProviderImportResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> ProviderImportResult<T> + Send + 'static,
{
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|error| ProviderImportError::internal(format!("渠道导入任务异常结束: {error}")))?
}

fn initialize_import_database(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS external_provider_imports (
              source TEXT NOT NULL,
              source_id TEXT NOT NULL,
              target_kind TEXT NOT NULL,
              target_scope TEXT NOT NULL,
              target_id TEXT NOT NULL,
              source_fingerprint TEXT NOT NULL,
              imported_at TEXT NOT NULL,
              synced_at TEXT NOT NULL,
              PRIMARY KEY(source, source_id, target_kind, target_scope)
            );
            CREATE INDEX IF NOT EXISTS idx_external_provider_import_target
              ON external_provider_imports(target_kind, target_id);
            "#,
        )
        .map_err(|error| format!("初始化外部渠道导入记录失败: {error}"))
}

fn scan_agent_provider_configs(
    service: &ProviderImportService,
    provider_id: Option<&str>,
) -> ProviderImportResult<ExternalProviderScanResponse> {
    let (data_path, mut configs) =
        read_ccswitch_configs().map_err(ProviderImportError::internal)?;
    if let Some(provider_id) = provider_id {
        configs.retain(|config| config.target_scope == provider_id);
    }
    scan_response(service, SOURCE_CCSWITCH, TARGET_AGENT, data_path, configs)
}

fn scan_chat_provider_configs(
    service: &ProviderImportService,
) -> ProviderImportResult<ExternalProviderScanResponse> {
    let (data_path, configs) =
        read_cherry_studio_configs().map_err(ProviderImportError::internal)?;
    scan_response(
        service,
        SOURCE_CHERRY_STUDIO,
        TARGET_ORDINARY_CHAT,
        data_path,
        configs,
    )
}

fn scan_response(
    service: &ProviderImportService,
    source: &'static str,
    target_kind: &str,
    data_path: Option<PathBuf>,
    configs: Vec<ExternalProviderConfig>,
) -> ProviderImportResult<ExternalProviderScanResponse> {
    let connection = service
        .open_database()
        .map_err(ProviderImportError::internal)?;
    let records = list_import_records(&connection, source, target_kind)
        .map_err(ProviderImportError::internal)?;
    let configs = configs
        .into_iter()
        .filter(|config| !config.api_key.trim().is_empty())
        .collect::<Vec<_>>();
    let mut items = Vec::with_capacity(configs.len());
    for config in configs {
        let record = records.get(&(config.source_id.clone(), config.target_scope.clone()));
        let fingerprint = source_fingerprint(&config);
        let target = match record {
            Some(record) => target_summary(&connection, target_kind, &record.target_id)
                .map_err(ProviderImportError::internal)?,
            None => None,
        };
        let target_exists = target.is_some();
        let conflict = if record.is_none() {
            find_name_conflict(
                &connection,
                target_kind,
                &config.target_scope,
                &config.name,
                None,
            )
            .map_err(ProviderImportError::internal)?
        } else {
            None
        };
        let imported = record.is_some();
        let reason = if imported {
            if target_exists {
                "已导入".to_string()
            } else {
                "已导入，但 CodeM 目标已删除".to_string()
            }
        } else {
            config.unavailable_reason.clone()
        };
        items.push(ExternalProviderItem {
            source_id: config.source_id,
            target_scope: config.target_scope,
            name: config.name,
            protocol: config.protocol,
            base_url: config.base_url,
            api_key_available: !config.api_key.trim().is_empty(),
            models: config.models,
            preset_id: config.preset_id,
            enabled: config.enabled,
            warning: config.warning,
            imported,
            update_available: record
                .is_some_and(|record| target_exists && record.source_fingerprint != fingerprint),
            importable: !imported && config.unavailable_reason.is_empty(),
            reason,
            target_id: record.map(|record| record.target_id.clone()),
            target_name: target.as_ref().map(|item| item.1.clone()),
            target_exists,
            conflict_target_id: conflict.as_ref().map(|item| item.0.clone()),
            conflict_target_name: conflict.map(|item| item.1),
        });
    }
    let detected = data_path.is_some();
    let message = if !detected {
        match source {
            SOURCE_CCSWITCH => "未检测到 CCSwitch 数据库".to_string(),
            SOURCE_CHERRY_STUDIO => "未检测到 Cherry Studio 数据".to_string(),
            _ => "未检测到外部渠道数据".to_string(),
        }
    } else if items.is_empty() {
        "已检测到外部应用，但没有可显示的渠道".to_string()
    } else {
        format!("发现 {} 个外部渠道", items.len())
    };
    Ok(ExternalProviderScanResponse {
        source,
        detected,
        data_path: data_path.map(|path| path.to_string_lossy().to_string()),
        message,
        items,
    })
}

fn list_import_records(
    connection: &Connection,
    source: &str,
    target_kind: &str,
) -> Result<HashMap<(String, String), ImportRecord>, String> {
    let mut statement = connection
        .prepare(
            r#"SELECT source_id, target_scope, target_id, source_fingerprint
               FROM external_provider_imports
               WHERE source = ? AND target_kind = ?"#,
        )
        .map_err(|error| format!("读取外部渠道导入记录失败: {error}"))?;
    let rows = statement
        .query_map(params![source, target_kind], |row| {
            Ok((
                (row.get::<_, String>(0)?, row.get::<_, String>(1)?),
                ImportRecord {
                    target_id: row.get(2)?,
                    source_fingerprint: row.get(3)?,
                },
            ))
        })
        .map_err(|error| format!("查询外部渠道导入记录失败: {error}"))?;
    rows.collect::<rusqlite::Result<HashMap<_, _>>>()
        .map_err(|error| format!("解析外部渠道导入记录失败: {error}"))
}

fn source_fingerprint(config: &ExternalProviderConfig) -> String {
    let mut hasher = Sha256::new();
    hasher.update(config.source.as_bytes());
    hasher.update([0]);
    hasher.update(config.source_id.as_bytes());
    hasher.update([0]);
    hasher.update(config.target_scope.as_bytes());
    hasher.update([0]);
    hasher.update(config.name.as_bytes());
    hasher.update([0]);
    hasher.update(config.protocol.as_str().as_bytes());
    hasher.update([0]);
    hasher.update(config.base_url.as_bytes());
    hasher.update([0]);
    hasher.update(config.api_key.as_bytes());
    for model in &config.models {
        hasher.update([0]);
        hasher.update(model.model_id.as_bytes());
        hasher.update([0]);
        hasher.update(model.display_name.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn normalize_agent_scope(value: String) -> Option<String> {
    match value.trim() {
        CLAUDE_CODE_PROVIDER_ID | OPENAI_CODEX_PROVIDER_ID | OPENCODE_PROVIDER_ID => {
            Some(value.trim().to_string())
        }
        _ => None,
    }
}

fn target_summary(
    connection: &Connection,
    target_kind: &str,
    target_id: &str,
) -> Result<Option<(String, String)>, String> {
    let sql = match target_kind {
        TARGET_AGENT => "SELECT id, name FROM agent_channels WHERE id = ?",
        TARGET_ORDINARY_CHAT => "SELECT id, name FROM ai_providers WHERE id = ?",
        _ => return Ok(None),
    };
    connection
        .query_row(sql, params![target_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()
        .map_err(|error| format!("读取导入目标失败: {error}"))
}

fn find_name_conflict(
    connection: &Connection,
    target_kind: &str,
    target_scope: &str,
    name: &str,
    exclude_id: Option<&str>,
) -> Result<Option<(String, String)>, String> {
    match target_kind {
        TARGET_AGENT => connection
            .query_row(
                r#"SELECT id, name FROM agent_channels
                   WHERE provider_id = ? AND lower(name) = lower(?) AND (? IS NULL OR id <> ?)
                   ORDER BY created_at ASC LIMIT 1"#,
                params![target_scope, name.trim(), exclude_id, exclude_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| format!("检查 Agent 渠道重名失败: {error}")),
        TARGET_ORDINARY_CHAT => connection
            .query_row(
                r#"SELECT id, name FROM ai_providers
                   WHERE lower(name) = lower(?) AND (? IS NULL OR id <> ?)
                   ORDER BY created_at ASC LIMIT 1"#,
                params![name.trim(), exclude_id, exclude_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| format!("检查普通聊天供应商重名失败: {error}")),
        _ => Ok(None),
    }
}

fn current_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn normalize_url(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn find_template_id(protocol: AiProtocol, base_url: &str) -> Option<String> {
    let normalized = normalize_url(base_url).to_ascii_lowercase();
    let source_host = url::Url::parse(base_url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_ascii_lowercase));
    PROVIDER_TEMPLATES
        .iter()
        .find(|template| {
            if template.protocol != protocol {
                return false;
            }
            let template_url = normalize_url(template.base_url).to_ascii_lowercase();
            template_url == normalized
                || source_host.as_ref().is_some_and(|source_host| {
                    url::Url::parse(template.base_url)
                        .ok()
                        .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
                        .as_ref()
                        == Some(source_host)
                })
        })
        .map(|template| template.id.to_string())
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .filter(|value| !value.to_string_lossy().trim().is_empty())
        .map(PathBuf::from)
}

fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|existing| existing == &path) {
        paths.push(path);
    }
}

fn expand_home_prefix(value: &str) -> PathBuf {
    let trimmed = value.trim();
    if trimmed == "~" {
        return home_dir().unwrap_or_else(|| PathBuf::from(trimmed));
    }
    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn ccswitch_database_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    #[cfg(target_os = "windows")]
    if let Some(app_data) = env::var_os("APPDATA").map(PathBuf::from) {
        let paths_file = app_data.join("com.ccswitch.desktop").join("app_paths.json");
        if let Ok(text) = fs::read_to_string(paths_file) {
            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                if let Some(path) = value
                    .get("app_config_dir_override")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    push_unique_path(
                        &mut candidates,
                        expand_home_prefix(path).join("cc-switch.db"),
                    );
                }
            }
        }
    }
    if let Some(home) = home_dir() {
        push_unique_path(
            &mut candidates,
            home.join(".cc-switch").join("cc-switch.db"),
        );
    }
    #[cfg(target_os = "windows")]
    if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
        push_unique_path(
            &mut candidates,
            home.join(".cc-switch").join("cc-switch.db"),
        );
    }
    candidates
}

fn read_ccswitch_configs() -> Result<(Option<PathBuf>, Vec<ExternalProviderConfig>), String> {
    let path = ccswitch_database_candidates()
        .into_iter()
        .find(|path| path.is_file());
    let Some(path) = path else {
        return Ok((None, Vec::new()));
    };
    let connection = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("打开 CCSwitch 数据库失败: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(2))
        .map_err(|error| format!("设置 CCSwitch 读取超时失败: {error}"))?;
    let mut statement = connection
        .prepare(
            r#"SELECT id, app_type, name, settings_config
               FROM providers
               WHERE app_type IN ('claude', 'claude-code', 'claude_code', 'codex', 'opencode')
               ORDER BY app_type, COALESCE(sort_index, 999999), created_at, id"#,
        )
        .map_err(|error| format!("读取 CCSwitch providers 表失败: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|error| format!("查询 CCSwitch providers 失败: {error}"))?;
    let mut configs = Vec::new();
    for row in rows {
        let (source_id, app_type, name, settings) =
            row.map_err(|error| format!("读取 CCSwitch 渠道失败: {error}"))?;
        let Ok(value) = serde_json::from_str::<Value>(&settings) else {
            continue;
        };
        match app_type.trim().to_ascii_lowercase().as_str() {
            "claude" | "claude-code" | "claude_code" => {
                if let Some(config) = parse_ccswitch_claude(&source_id, &name, &value) {
                    configs.push(config);
                }
            }
            "codex" => {
                if let Some(config) = parse_ccswitch_codex(&source_id, &name, &value) {
                    configs.push(config);
                }
            }
            "opencode" => configs.extend(parse_ccswitch_opencode(&source_id, &name, &value)),
            _ => {}
        }
    }
    Ok((Some(path), configs))
}

fn parse_ccswitch_claude(
    source_id: &str,
    name: &str,
    value: &Value,
) -> Option<ExternalProviderConfig> {
    let base_url = json_string_path(value, &["env", "ANTHROPIC_BASE_URL"])
        .or_else(|| json_string_path(value, &["config", "ANTHROPIC_BASE_URL"]))
        .unwrap_or_default();
    let api_key = json_string_path(value, &["env", "ANTHROPIC_AUTH_TOKEN"])
        .or_else(|| json_string_path(value, &["env", "ANTHROPIC_API_KEY"]))
        .unwrap_or_default();
    let mut models = Vec::new();
    for key in [
        "ANTHROPIC_MODEL",
        "ANTHROPIC_REASONING_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "ANTHROPIC_DEFAULT_FABLE_MODEL",
    ] {
        if let Some(model_id) = json_string_path(value, &["env", key]) {
            push_external_model(&mut models, model_id.clone(), model_id);
        }
    }
    if let Some(model_id) = json_string(value, &["model", "default_model", "defaultModel"]) {
        push_external_model(&mut models, model_id.clone(), model_id);
    }
    Some(external_config(
        SOURCE_CCSWITCH,
        source_id,
        CLAUDE_CODE_PROVIDER_ID,
        name,
        AiProtocol::AnthropicMessages,
        base_url,
        api_key,
        models,
        true,
        String::new(),
    ))
}

fn parse_ccswitch_codex(
    source_id: &str,
    name: &str,
    value: &Value,
) -> Option<ExternalProviderConfig> {
    let config_text = value
        .get("config")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let config = toml::from_str::<toml::Value>(config_text).ok()?;
    let provider_key = config
        .get("model_provider")
        .and_then(toml::Value::as_str)
        .unwrap_or("openai");
    let provider = config
        .get("model_providers")
        .and_then(|providers| providers.get(provider_key));
    let base_url = provider
        .and_then(|provider| provider.get("base_url"))
        .and_then(toml::Value::as_str)
        .unwrap_or_default()
        .to_string();
    let protocol = match provider
        .and_then(|provider| provider.get("wire_api"))
        .and_then(toml::Value::as_str)
        .unwrap_or("responses")
    {
        "chat" | "chat_completions" => AiProtocol::OpenaiChat,
        _ => AiProtocol::OpenaiResponses,
    };
    let api_key = json_string_path(value, &["auth", "OPENAI_API_KEY"]).unwrap_or_default();
    let mut models = Vec::new();
    if let Some(model_id) = config.get("model").and_then(toml::Value::as_str) {
        push_external_model(&mut models, model_id.to_string(), model_id.to_string());
    }
    let mut external = external_config(
        SOURCE_CCSWITCH,
        source_id,
        OPENAI_CODEX_PROVIDER_ID,
        name,
        protocol,
        base_url,
        api_key,
        models,
        true,
        String::new(),
    );
    if external.api_key.is_empty()
        && value
            .pointer("/auth/tokens")
            .and_then(Value::as_object)
            .is_some()
    {
        external.unavailable_reason = "OAuth 登录凭据不支持导入".to_string();
    }
    Some(external)
}

fn parse_ccswitch_opencode(
    source_id: &str,
    row_name: &str,
    value: &Value,
) -> Vec<ExternalProviderConfig> {
    if value.get("options").and_then(Value::as_object).is_some() {
        return parse_opencode_entry(source_id, row_name, value)
            .into_iter()
            .collect();
    }
    let Some(providers) = value.get("provider").and_then(Value::as_object) else {
        return Vec::new();
    };
    providers
        .iter()
        .filter_map(|(provider_key, provider)| {
            let display_name = provider
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(provider_key);
            let name = if row_name.eq_ignore_ascii_case("default") {
                display_name.to_string()
            } else {
                format!("{} · {}", strip_ccswitch_suffix(row_name), display_name)
            };
            parse_opencode_entry(&format!("{source_id}::{provider_key}"), &name, provider)
        })
        .collect()
}

fn parse_opencode_entry(
    source_id: &str,
    name: &str,
    value: &Value,
) -> Option<ExternalProviderConfig> {
    let npm = value
        .get("npm")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    let protocol = if npm.contains("anthropic") {
        AiProtocol::AnthropicMessages
    } else if npm.contains("google") || npm.contains("gemini") {
        return None;
    } else {
        AiProtocol::OpenaiChat
    };
    let options = value.get("options").and_then(Value::as_object);
    let base_url = options
        .and_then(|options| options.get("baseURL").or_else(|| options.get("base_url")))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let api_key = options
        .and_then(|options| options.get("apiKey").or_else(|| options.get("api_key")))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mut models = Vec::new();
    if let Some(items) = value.get("models").and_then(Value::as_object) {
        for (model_id, model) in items {
            let display_name = model
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(model_id);
            push_external_model(&mut models, model_id.clone(), display_name.to_string());
        }
    }
    Some(external_config(
        SOURCE_CCSWITCH,
        source_id,
        OPENCODE_PROVIDER_ID,
        name,
        protocol,
        base_url,
        api_key,
        models,
        true,
        String::new(),
    ))
}

fn external_config(
    source: &'static str,
    source_id: &str,
    target_scope: &str,
    name: &str,
    protocol: AiProtocol,
    base_url: String,
    api_key: String,
    models: Vec<ExternalModel>,
    enabled: bool,
    warning: String,
) -> ExternalProviderConfig {
    let base_url = normalize_url(&base_url);
    let name = strip_ccswitch_suffix(name).to_string();
    let valid_url = url::Url::parse(&base_url)
        .ok()
        .is_some_and(|url| matches!(url.scheme(), "http" | "https"));
    let unavailable_reason = if name.trim().is_empty() {
        "渠道名称为空".to_string()
    } else if base_url.is_empty() {
        "未配置可迁移的 API 地址".to_string()
    } else if !valid_url {
        "API 地址不是有效的 HTTP/HTTPS URL".to_string()
    } else if api_key.trim().is_empty() {
        "未配置可迁移的 API Key".to_string()
    } else {
        String::new()
    };
    ExternalProviderConfig {
        source,
        source_id: source_id.to_string(),
        target_scope: target_scope.to_string(),
        name,
        protocol,
        preset_id: find_template_id(protocol, &base_url),
        base_url,
        api_key,
        models,
        enabled,
        warning,
        unavailable_reason,
    }
}

fn push_external_model(models: &mut Vec<ExternalModel>, model_id: String, display_name: String) {
    let model_id = model_id.trim();
    if model_id.is_empty()
        || models
            .iter()
            .any(|model| model.model_id.eq_ignore_ascii_case(model_id))
    {
        return;
    }
    models.push(ExternalModel {
        model_id: model_id.to_string(),
        display_name: display_name
            .trim()
            .is_empty()
            .then_some(model_id)
            .unwrap_or(display_name.trim())
            .to_string(),
    });
}

fn json_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn json_string_path(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn strip_ccswitch_suffix(value: &str) -> &str {
    value
        .trim()
        .strip_suffix("（ccswitch）")
        .or_else(|| value.trim().strip_suffix("(ccswitch)"))
        .unwrap_or_else(|| value.trim())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CherryProtocol {
    Anthropic,
    OpenaiChat,
    OpenaiResponses,
    Gemini,
}

impl CherryProtocol {
    fn ai_protocol(self) -> AiProtocol {
        match self {
            Self::Anthropic => AiProtocol::AnthropicMessages,
            Self::OpenaiChat => AiProtocol::OpenaiChat,
            Self::OpenaiResponses => AiProtocol::OpenaiResponses,
            Self::Gemini => AiProtocol::GeminiGenerateContent,
        }
    }

    fn variant(self) -> &'static str {
        match self {
            Self::Anthropic => "anthropic",
            Self::OpenaiChat => "openai-chat",
            Self::OpenaiResponses => "openai-responses",
            Self::Gemini => "gemini",
        }
    }
}

#[derive(Debug)]
struct CherryGroup {
    protocol: CherryProtocol,
    base_url: String,
    models: Vec<ExternalModel>,
}

fn read_cherry_studio_configs() -> Result<(Option<PathBuf>, Vec<ExternalProviderConfig>), String> {
    let candidates = cherry_data_candidates();
    let mut errors = Vec::new();
    for data_path in &candidates {
        let sqlite_path = data_path.join("cherrystudio.sqlite");
        if !sqlite_path.is_file() {
            continue;
        }
        match read_cherry_v2(&sqlite_path, data_path) {
            Ok(configs) => return Ok((Some(data_path.clone()), configs)),
            Err(error) => errors.push(format!("{}: {error}", data_path.display())),
        }
    }
    for data_path in &candidates {
        let leveldb_path = data_path.join("Local Storage").join("leveldb");
        if !leveldb_path.is_dir() {
            continue;
        }
        match read_cherry_v1(&leveldb_path, data_path) {
            Ok(configs) => return Ok((Some(data_path.clone()), configs)),
            Err(error) => errors.push(format!("{}: {error}", data_path.display())),
        }
    }
    if errors.is_empty() {
        Ok((None, Vec::new()))
    } else {
        Err(errors.join("；"))
    }
}

fn cherry_data_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let Some(home) = home_dir() else {
        return candidates;
    };
    let cherry_home = home.join(".cherrystudio");
    collect_cherry_boot_paths(&cherry_home.join("boot-config.json"), &mut candidates);
    collect_cherry_legacy_paths(
        &cherry_home.join("config").join("config.json"),
        &mut candidates,
    );
    #[cfg(target_os = "windows")]
    if let Some(app_data) = env::var_os("APPDATA").map(PathBuf::from) {
        push_unique_path(&mut candidates, app_data.join("CherryStudio"));
        push_unique_path(&mut candidates, app_data.join("Cherry Studio"));
    }
    #[cfg(target_os = "macos")]
    push_unique_path(
        &mut candidates,
        home.join("Library")
            .join("Application Support")
            .join("CherryStudio"),
    );
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let config = env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".config"));
        push_unique_path(&mut candidates, config.join("CherryStudio"));
    }
    candidates
}

fn collect_cherry_boot_paths(path: &Path, paths: &mut Vec<PathBuf>) {
    let Ok(text) = fs::read_to_string(path) else {
        return;
    };
    let Ok(value) = serde_json::from_str::<Value>(&text) else {
        return;
    };
    if let Some(items) = value.get("app.user_data_path").and_then(Value::as_object) {
        for path in items.values().filter_map(Value::as_str) {
            push_unique_path(paths, PathBuf::from(path));
        }
    }
}

fn collect_cherry_legacy_paths(path: &Path, paths: &mut Vec<PathBuf>) {
    let Ok(text) = fs::read_to_string(path) else {
        return;
    };
    let Ok(value) = serde_json::from_str::<Value>(&text) else {
        return;
    };
    let Some(app_data_path) = value.get("appDataPath") else {
        return;
    };
    if let Some(path) = app_data_path.as_str() {
        push_unique_path(paths, PathBuf::from(path));
    } else if let Some(items) = app_data_path.as_array() {
        for path in items
            .iter()
            .filter_map(|item| item.get("dataPath"))
            .filter_map(Value::as_str)
        {
            push_unique_path(paths, PathBuf::from(path));
        }
    }
}

fn read_cherry_v1(
    leveldb_path: &Path,
    data_path: &Path,
) -> Result<Vec<ExternalProviderConfig>, String> {
    let key = b"persist:cherry-studio";
    let records = leveldb_core::read_dir(leveldb_path)
        .map_err(|error| format!("读取 Cherry Studio LevelDB 失败: {error}"))?;
    let latest = records
        .iter()
        .filter(|record| record.key.windows(key.len()).any(|window| window == key))
        .max_by_key(|record| record.seq)
        .ok_or_else(|| "Cherry Studio LevelDB 中没有供应商数据".to_string())?;
    if latest.deleted {
        return Err("Cherry Studio 供应商数据已删除".to_string());
    }
    let persisted_text = decode_chromium_string(&latest.value)?;
    let persisted = serde_json::from_str::<Value>(&persisted_text)
        .map_err(|error| format!("解析 Cherry Studio Redux 数据失败: {error}"))?;
    let llm = match persisted.get("llm") {
        Some(Value::String(text)) => serde_json::from_str::<Value>(text)
            .map_err(|error| format!("解析 Cherry Studio LLM 数据失败: {error}"))?,
        Some(value) => value.clone(),
        None => return Err("Cherry Studio 数据缺少 llm 配置".to_string()),
    };
    let providers = llm
        .get("providers")
        .and_then(Value::as_array)
        .ok_or_else(|| "Cherry Studio llm.providers 格式无效".to_string())?;
    let version = read_cherry_version(data_path).unwrap_or_else(|| "1.x".to_string());
    let mut configs = Vec::new();
    for provider in providers {
        append_cherry_v1_provider(provider, &version, &mut configs);
    }
    Ok(configs)
}

fn decode_chromium_string(bytes: &[u8]) -> Result<String, String> {
    match bytes.first().copied() {
        Some(0) => {
            let payload = &bytes[1..];
            if payload.len() % 2 != 0 {
                return Err("Cherry Studio Local Storage UTF-16 数据长度无效".to_string());
            }
            let values = payload
                .chunks_exact(2)
                .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                .collect::<Vec<_>>();
            String::from_utf16(&values)
                .map_err(|error| format!("解码 Cherry Studio Local Storage 失败: {error}"))
        }
        Some(1) => Ok(bytes[1..].iter().map(|byte| char::from(*byte)).collect()),
        _ => Err("未知的 Cherry Studio Local Storage 字符串编码".to_string()),
    }
}

fn append_cherry_v1_provider(
    provider: &Value,
    _version: &str,
    configs: &mut Vec<ExternalProviderConfig>,
) {
    let source_id = cherry_value_string(provider, "id");
    let name = cherry_value_string(provider, "name");
    let provider_type = cherry_value_string(provider, "type");
    if source_id.is_empty() || name.is_empty() {
        return;
    }
    let enabled = provider
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let api_keys = split_cherry_api_keys(&cherry_value_string(provider, "apiKey"));
    let api_key = api_keys.first().cloned().unwrap_or_default();
    let auth_type = cherry_value_string(provider, "authType");
    let source_models = provider
        .get("models")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut groups = Vec::<CherryGroup>::new();
    let mut excluded_model_count = 0usize;
    for model in &source_models {
        let model_id = cherry_value_string(model, "id");
        let display_name = cherry_value_string(model, "name");
        let endpoint = cherry_value_string(model, "endpoint_type");
        let protocol = if endpoint.is_empty() {
            cherry_default_protocol(&provider_type)
        } else {
            cherry_protocol_from_endpoint(&endpoint)
        };
        let Some(protocol) = protocol else {
            excluded_model_count += 1;
            continue;
        };
        if model_id.is_empty() || !cherry_v1_model_is_chat_compatible(model, &model_id) {
            excluded_model_count += 1;
            continue;
        }
        let base_url = cherry_v1_base_url(provider, &provider_type, protocol);
        add_cherry_model(
            &mut groups,
            protocol,
            base_url,
            ExternalModel {
                display_name: if display_name.is_empty() {
                    model_id.clone()
                } else {
                    display_name
                },
                model_id,
            },
        );
    }
    if groups.is_empty() {
        let Some(protocol) = cherry_default_protocol(&provider_type) else {
            return;
        };
        groups.push(CherryGroup {
            protocol,
            base_url: cherry_v1_base_url(provider, &provider_type, protocol),
            models: Vec::new(),
        });
    }
    let warning = if provider
        .get("extra_headers")
        .and_then(Value::as_object)
        .is_some_and(|headers| !headers.is_empty())
    {
        "Cherry Studio 的自定义请求头不会导入".to_string()
    } else if api_keys.len() > 1 {
        format!("检测到 {} 个 API Key，将导入第一个", api_keys.len())
    } else if excluded_model_count > 0 {
        format!("已忽略 {excluded_model_count} 个非聊天模型")
    } else {
        String::new()
    };
    for group in groups {
        let mut config = external_config(
            SOURCE_CHERRY_STUDIO,
            &format!("{}::{}", source_id, group.protocol.variant()),
            TARGET_ORDINARY_CHAT,
            &name,
            group.protocol.ai_protocol(),
            group.base_url,
            api_key.clone(),
            group.models,
            enabled,
            warning.clone(),
        );
        if auth_type.eq_ignore_ascii_case("oauth") {
            config.unavailable_reason = "OAuth 登录凭据不支持导入".to_string();
        }
        configs.push(config);
    }
}

fn read_cherry_v2(
    sqlite_path: &Path,
    data_path: &Path,
) -> Result<Vec<ExternalProviderConfig>, String> {
    let connection =
        Connection::open_with_flags(sqlite_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| format!("打开 Cherry Studio SQLite 失败: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(3))
        .map_err(|error| format!("设置 Cherry Studio SQLite 超时失败: {error}"))?;
    let mut statement = connection
        .prepare(
            r#"SELECT provider_id, name, endpoint_configs, default_chat_endpoint,
                      api_keys, auth_config, provider_settings, is_enabled
               FROM user_provider
               ORDER BY order_key, provider_id"#,
        )
        .map_err(|error| format!("读取 Cherry Studio user_provider 失败: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, bool>(7)?,
            ))
        })
        .map_err(|error| format!("查询 Cherry Studio user_provider 失败: {error}"))?;
    let _version = read_cherry_version(data_path).unwrap_or_else(|| "2.x".to_string());
    let mut configs = Vec::new();
    for row in rows {
        let (
            source_id,
            name,
            endpoint_configs_text,
            default_endpoint,
            api_keys_text,
            auth_config_text,
            provider_settings_text,
            enabled,
        ) = row.map_err(|error| format!("读取 Cherry Studio provider 行失败: {error}"))?;
        let endpoint_configs = parse_optional_json(endpoint_configs_text.as_deref());
        let api_keys = cherry_v2_api_keys(api_keys_text.as_deref());
        let api_key = api_keys.first().cloned().unwrap_or_default();
        let auth_config = parse_optional_json(auth_config_text.as_deref());
        let auth_type = auth_config
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("api-key");
        let mut model_statement = connection
            .prepare(
                r#"SELECT model_id, endpoint_types, capabilities, output_modalities,
                          is_enabled, is_hidden
                   FROM user_model
                   WHERE provider_id = ?
                   ORDER BY order_key, model_id"#,
            )
            .map_err(|error| format!("读取 Cherry Studio user_model 失败: {error}"))?;
        let model_rows = model_statement
            .query_map(params![source_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, bool>(4)?,
                    row.get::<_, bool>(5)?,
                ))
            })
            .map_err(|error| format!("查询 Cherry Studio user_model 失败: {error}"))?;
        let mut groups = Vec::<CherryGroup>::new();
        let mut excluded_model_count = 0usize;
        for model_row in model_rows {
            let (model_id, endpoint_text, capabilities_text, output_text, enabled, hidden) =
                model_row.map_err(|error| format!("读取 Cherry Studio model 行失败: {error}"))?;
            if !enabled || hidden {
                continue;
            }
            let endpoints = parse_optional_json(endpoint_text.as_deref());
            let endpoint = endpoints
                .as_array()
                .and_then(|items| items.first())
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| default_endpoint.clone())
                .unwrap_or_default();
            let Some(protocol) = cherry_protocol_from_endpoint(&endpoint) else {
                excluded_model_count += 1;
                continue;
            };
            if !cherry_v2_model_is_chat_compatible(
                &model_id,
                &parse_optional_json(capabilities_text.as_deref()),
                &parse_optional_json(output_text.as_deref()),
            ) {
                excluded_model_count += 1;
                continue;
            }
            add_cherry_model(
                &mut groups,
                protocol,
                cherry_v2_base_url(&endpoint_configs, &endpoint),
                ExternalModel {
                    display_name: model_id.clone(),
                    model_id,
                },
            );
        }
        if groups.is_empty() {
            let Some(protocol) = default_endpoint
                .as_deref()
                .and_then(cherry_protocol_from_endpoint)
            else {
                continue;
            };
            groups.push(CherryGroup {
                protocol,
                base_url: cherry_v2_base_url(
                    &endpoint_configs,
                    default_endpoint.as_deref().unwrap_or_default(),
                ),
                models: Vec::new(),
            });
        }
        let settings = parse_optional_json(provider_settings_text.as_deref());
        let warning = if settings
            .get("extraHeaders")
            .and_then(Value::as_object)
            .is_some_and(|headers| !headers.is_empty())
        {
            "Cherry Studio 的自定义请求头不会导入".to_string()
        } else if api_keys.len() > 1 {
            format!("检测到 {} 个启用 API Key，将导入第一个", api_keys.len())
        } else if excluded_model_count > 0 {
            format!("已忽略 {excluded_model_count} 个非聊天模型")
        } else {
            String::new()
        };
        for group in groups {
            let mut config = external_config(
                SOURCE_CHERRY_STUDIO,
                &format!("{}::{}", source_id, group.protocol.variant()),
                TARGET_ORDINARY_CHAT,
                &name,
                group.protocol.ai_protocol(),
                group.base_url,
                api_key.clone(),
                group.models,
                enabled,
                warning.clone(),
            );
            if auth_type != "api-key" {
                config.unavailable_reason = format!("{auth_type} 登录凭据不支持导入");
            }
            configs.push(config);
        }
    }
    Ok(configs)
}

fn cherry_default_protocol(provider_type: &str) -> Option<CherryProtocol> {
    match provider_type.trim().to_ascii_lowercase().as_str() {
        "anthropic" | "vertex-anthropic" => Some(CherryProtocol::Anthropic),
        "gemini" | "vertexai" => Some(CherryProtocol::Gemini),
        "openai-response" => Some(CherryProtocol::OpenaiResponses),
        "openai" | "new-api" | "gateway" | "ollama" => Some(CherryProtocol::OpenaiChat),
        _ => None,
    }
}

fn cherry_protocol_from_endpoint(endpoint: &str) -> Option<CherryProtocol> {
    match endpoint.trim().to_ascii_lowercase().as_str() {
        "anthropic" | "anthropic-messages" | "messages" => Some(CherryProtocol::Anthropic),
        "gemini" | "google-generate-content" | "generatecontent" | "streamgeneratecontent" => {
            Some(CherryProtocol::Gemini)
        }
        "openai-response" | "openai-responses" | "responses" | "response" => {
            Some(CherryProtocol::OpenaiResponses)
        }
        "openai" | "openai-chat-completions" | "chat/completions" | "ollama-chat" => {
            Some(CherryProtocol::OpenaiChat)
        }
        _ => None,
    }
}

fn cherry_v1_base_url(provider: &Value, provider_type: &str, protocol: CherryProtocol) -> String {
    let raw = if protocol == CherryProtocol::Anthropic && provider_type != "new-api" {
        let anthropic = cherry_value_string(provider, "anthropicApiHost");
        if anthropic.is_empty() {
            cherry_value_string(provider, "apiHost")
        } else {
            anthropic
        }
    } else {
        cherry_value_string(provider, "apiHost")
    };
    normalize_cherry_base_url(&raw)
}

fn normalize_cherry_base_url(value: &str) -> String {
    let trimmed = value.trim();
    if !trimmed.ends_with('#') {
        return normalize_url(trimmed);
    }
    let mut base = trimmed
        .trim_end_matches('#')
        .trim_end_matches('/')
        .to_string();
    let lower = base.to_ascii_lowercase();
    for suffix in [
        "/chat/completions",
        "/responses",
        "/response",
        "/messages",
        ":streamgeneratecontent",
        ":generatecontent",
        "/streamgeneratecontent",
        "/generatecontent",
    ] {
        if lower.ends_with(suffix) {
            base.truncate(base.len() - suffix.len());
            break;
        }
    }
    base.trim_end_matches(['/', ':']).to_string()
}

fn add_cherry_model(
    groups: &mut Vec<CherryGroup>,
    protocol: CherryProtocol,
    base_url: String,
    model: ExternalModel,
) {
    if let Some(group) = groups.iter_mut().find(|group| group.protocol == protocol) {
        if group.base_url.is_empty() && !base_url.is_empty() {
            group.base_url = base_url;
        }
        push_external_model(&mut group.models, model.model_id, model.display_name);
        return;
    }
    groups.push(CherryGroup {
        protocol,
        base_url,
        models: vec![model],
    });
}

fn cherry_v1_model_is_chat_compatible(model: &Value, model_id: &str) -> bool {
    if model_id_looks_non_chat(model_id) {
        return false;
    }
    let types = model
        .get("type")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    types.is_empty()
        || types.iter().any(|kind| {
            matches!(
                kind.to_ascii_lowercase().as_str(),
                "text" | "vision" | "reasoning" | "function_calling" | "web_search"
            )
        })
}

fn cherry_v2_model_is_chat_compatible(
    model_id: &str,
    capabilities: &Value,
    output_modalities: &Value,
) -> bool {
    if model_id_looks_non_chat(model_id) {
        return false;
    }
    if let Some(outputs) = output_modalities.as_array() {
        let values = outputs
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_ascii_lowercase)
            .collect::<Vec<_>>();
        if !values.is_empty() && !values.iter().any(|value| value == "text") {
            return false;
        }
    }
    if let Some(values) = capabilities.as_array() {
        let only_non_chat = !values.is_empty()
            && values.iter().filter_map(Value::as_str).all(|value| {
                matches!(
                    value.to_ascii_lowercase().as_str(),
                    "embedding"
                        | "rerank"
                        | "image-generation"
                        | "audio-generation"
                        | "audio-transcript"
                        | "video-generation"
                )
            });
        if only_non_chat {
            return false;
        }
    }
    true
}

fn model_id_looks_non_chat(model_id: &str) -> bool {
    let lower = model_id.to_ascii_lowercase();
    [
        "embedding",
        "rerank",
        "whisper",
        "realtime",
        "audio-preview",
        "audio-realtime",
        "image",
        "video",
        "banana",
        "dall-e",
        "imagen",
        "sora-",
        "veo-",
        "tts-",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn split_cherry_api_keys(value: &str) -> Vec<String> {
    let mut keys = Vec::new();
    let mut current = String::new();
    let mut escaped = false;
    for character in value.chars() {
        if escaped {
            if character == ',' {
                current.push(',');
            } else {
                current.push('\\');
                current.push(character);
            }
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == ',' {
            if !current.trim().is_empty() {
                keys.push(current.trim().to_string());
            }
            current.clear();
        } else {
            current.push(character);
        }
    }
    if escaped {
        current.push('\\');
    }
    if !current.trim().is_empty() {
        keys.push(current.trim().to_string());
    }
    keys
}

fn cherry_v2_api_keys(value: Option<&str>) -> Vec<String> {
    parse_optional_json(value)
        .as_array()
        .into_iter()
        .flatten()
        .filter(|entry| {
            entry
                .get("isEnabled")
                .and_then(Value::as_bool)
                .unwrap_or(true)
        })
        .filter_map(|entry| entry.get("key").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

fn cherry_v2_base_url(endpoint_configs: &Value, endpoint: &str) -> String {
    endpoint_configs
        .get(endpoint)
        .and_then(|config| config.get("baseUrl"))
        .and_then(Value::as_str)
        .map(normalize_cherry_base_url)
        .unwrap_or_default()
}

fn parse_optional_json(value: Option<&str>) -> Value {
    value
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .unwrap_or(Value::Null)
}

fn cherry_value_string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string()
}

fn read_cherry_version(data_path: &Path) -> Option<String> {
    let version_log = data_path.join("version.log");
    fs::read_to_string(version_log)
        .ok()
        .and_then(|text| text.lines().last().map(str::trim).map(str::to_string))
        .filter(|value| !value.is_empty())
}

fn import_selected_providers(
    service: &ProviderImportService,
    target_kind: &str,
    source: &str,
    selections: Vec<ImportSelection>,
) -> ProviderImportResult<Vec<ImportResult>> {
    if selections.is_empty() {
        return Err(ProviderImportError::bad_request("请至少选择一个外部渠道"));
    }
    let mut seen = HashSet::new();
    if selections
        .iter()
        .any(|selection| !seen.insert(selection.source_id.trim().to_string()))
    {
        return Err(ProviderImportError::bad_request("导入列表包含重复渠道"));
    }
    let configs = load_source_configs(source)?;
    let config_by_id = configs
        .into_iter()
        .map(|config| (config.source_id.clone(), config))
        .collect::<HashMap<_, _>>();
    let mut connection = service
        .open_database()
        .map_err(ProviderImportError::internal)?;
    let records = list_import_records(&connection, source, target_kind)
        .map_err(ProviderImportError::internal)?;
    let mut results = Vec::with_capacity(selections.len());
    for selection in selections {
        let source_id = selection.source_id.trim();
        let config = config_by_id
            .get(source_id)
            .ok_or_else(|| ProviderImportError::not_found("外部渠道不存在或已发生变化"))?;
        if !config.unavailable_reason.is_empty() {
            return Err(ProviderImportError::bad_request(format!(
                "{} 无法导入：{}",
                config.name, config.unavailable_reason
            )));
        }
        if records.contains_key(&(config.source_id.clone(), config.target_scope.clone())) {
            return Err(ProviderImportError::conflict(format!(
                "{} 已经导入，请使用同步功能",
                config.name
            )));
        }
        results.push(apply_external_config(
            service,
            &mut connection,
            target_kind,
            config,
            selection.overwrite_target_id.as_deref(),
            true,
        )?);
    }
    Ok(results)
}

fn sync_imported_provider(
    service: &ProviderImportService,
    payload: SyncProviderRequest,
) -> ProviderImportResult<ImportResult> {
    let target_kind = match payload.target_kind.as_str() {
        TARGET_AGENT => TARGET_AGENT,
        TARGET_ORDINARY_CHAT => TARGET_ORDINARY_CHAT,
        _ => return Err(ProviderImportError::bad_request("不支持的同步目标")),
    };
    let source = match payload.source.as_str() {
        SOURCE_CCSWITCH => SOURCE_CCSWITCH,
        SOURCE_CHERRY_STUDIO => SOURCE_CHERRY_STUDIO,
        _ => return Err(ProviderImportError::bad_request("不支持的外部来源")),
    };
    let configs = load_source_configs(source)?;
    let config = configs
        .into_iter()
        .find(|config| config.source_id == payload.source_id)
        .ok_or_else(|| ProviderImportError::not_found("外部渠道不存在或已被删除"))?;
    if !config.unavailable_reason.is_empty() {
        return Err(ProviderImportError::bad_request(format!(
            "{} 当前无法同步：{}",
            config.name, config.unavailable_reason
        )));
    }
    let mut connection = service
        .open_database()
        .map_err(ProviderImportError::internal)?;
    let record = connection
        .query_row(
            r#"SELECT target_id FROM external_provider_imports
               WHERE source = ? AND source_id = ? AND target_kind = ? AND target_scope = ?"#,
            params![source, config.source_id, target_kind, config.target_scope],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| ProviderImportError::internal(format!("读取同步记录失败: {error}")))?
        .ok_or_else(|| ProviderImportError::not_found("该外部渠道尚未导入"))?;
    if target_summary(&connection, target_kind, &record)
        .map_err(ProviderImportError::internal)?
        .is_none()
    {
        return Err(ProviderImportError::not_found(
            "原 CodeM 目标已删除，无法同步；导入记录仍会保留",
        ));
    }
    apply_external_config(
        service,
        &mut connection,
        target_kind,
        &config,
        Some(&record),
        true,
    )
}

fn load_source_configs(source: &str) -> ProviderImportResult<Vec<ExternalProviderConfig>> {
    match source {
        SOURCE_CCSWITCH => read_ccswitch_configs()
            .map(|(_, configs)| configs)
            .map_err(ProviderImportError::internal),
        SOURCE_CHERRY_STUDIO => read_cherry_studio_configs()
            .map(|(_, configs)| configs)
            .map_err(ProviderImportError::internal),
        _ => Err(ProviderImportError::bad_request("不支持的外部来源")),
    }
}

fn apply_external_config(
    service: &ProviderImportService,
    connection: &mut Connection,
    target_kind: &str,
    config: &ExternalProviderConfig,
    overwrite_target_id: Option<&str>,
    persist_import_record: bool,
) -> ProviderImportResult<ImportResult> {
    let requested_target_id = overwrite_target_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let conflict = find_name_conflict(
        connection,
        target_kind,
        &config.target_scope,
        &config.name,
        requested_target_id,
    )
    .map_err(ProviderImportError::internal)?;
    if let Some((conflict_id, conflict_name)) = conflict {
        return Err(ProviderImportError::conflict(format!(
            "目标已存在：{conflict_name}（{conflict_id}），请确认后覆盖",
        )));
    }
    if let Some(target_id) = requested_target_id {
        validate_overwrite_target(connection, target_kind, &config.target_scope, target_id)?;
    }
    let target_id = requested_target_id
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let overwritten = requested_target_id.is_some();
    let secret_slot = if overwritten {
        target_secret_slot(connection, target_kind, &target_id)?
    } else if target_kind == TARGET_AGENT {
        format!("agent-channel:{target_id}")
    } else {
        format!("ai-provider:{target_id}:api-key")
    };
    let previous_secret = service.secrets.get(&secret_slot).ok();
    service
        .secrets
        .set(&secret_slot, &config.api_key)
        .map_err(ProviderImportError::internal)?;
    let result = apply_external_config_transaction(
        connection,
        target_kind,
        config,
        &target_id,
        &secret_slot,
        overwritten,
        persist_import_record,
    );
    if let Err(error) = result {
        match previous_secret {
            Some(secret) => {
                let _ = service.secrets.set(&secret_slot, &secret);
            }
            None => {
                let _ = service.secrets.delete(&secret_slot);
            }
        }
        return Err(ProviderImportError::internal(error));
    }
    Ok(ImportResult {
        source_id: config.source_id.clone(),
        target_id,
        target_name: config.name.clone(),
        overwritten,
    })
}

fn apply_external_config_transaction(
    connection: &mut Connection,
    target_kind: &str,
    config: &ExternalProviderConfig,
    target_id: &str,
    secret_slot: &str,
    overwritten: bool,
    persist_import_record: bool,
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("开始渠道导入事务失败: {error}"))?;
    match target_kind {
        TARGET_AGENT => {
            write_agent_channel(&transaction, config, target_id, secret_slot, overwritten)?
        }
        TARGET_ORDINARY_CHAT => {
            write_chat_provider(&transaction, config, target_id, secret_slot, overwritten)?
        }
        _ => return Err("不支持的导入目标".to_string()),
    }
    if persist_import_record {
        let now = current_timestamp();
        transaction
            .execute(
                r#"INSERT INTO external_provider_imports (
                     source, source_id, target_kind, target_scope, target_id,
                     source_fingerprint, imported_at, synced_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(source, source_id, target_kind, target_scope) DO UPDATE SET
                     target_id = excluded.target_id,
                     source_fingerprint = excluded.source_fingerprint,
                     synced_at = excluded.synced_at"#,
                params![
                    config.source,
                    config.source_id,
                    target_kind,
                    config.target_scope,
                    target_id,
                    source_fingerprint(config),
                    now,
                    now,
                ],
            )
            .map_err(|error| format!("保存外部渠道导入记录失败: {error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("提交渠道导入事务失败: {error}"))
}

fn validate_overwrite_target(
    connection: &Connection,
    target_kind: &str,
    target_scope: &str,
    target_id: &str,
) -> ProviderImportResult<()> {
    let valid = match target_kind {
        TARGET_AGENT => connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM agent_channels WHERE id = ? AND provider_id = ?)",
            params![target_id, target_scope],
            |row| row.get::<_, bool>(0),
        ),
        TARGET_ORDINARY_CHAT => connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM ai_providers WHERE id = ?)",
            params![target_id],
            |row| row.get::<_, bool>(0),
        ),
        _ => return Err(ProviderImportError::bad_request("不支持的覆盖目标")),
    }
    .map_err(|error| ProviderImportError::internal(format!("检查覆盖目标失败: {error}")))?;
    if valid {
        Ok(())
    } else {
        Err(ProviderImportError::not_found("要覆盖的 CodeM 目标不存在"))
    }
}

fn target_secret_slot(
    connection: &Connection,
    target_kind: &str,
    target_id: &str,
) -> ProviderImportResult<String> {
    let sql = match target_kind {
        TARGET_AGENT => "SELECT secret_slot FROM agent_channels WHERE id = ?",
        TARGET_ORDINARY_CHAT => "SELECT secret_slot FROM ai_providers WHERE id = ?",
        _ => return Err(ProviderImportError::bad_request("不支持的目标类型")),
    };
    connection
        .query_row(sql, params![target_id], |row| row.get(0))
        .optional()
        .map_err(|error| ProviderImportError::internal(format!("读取目标密钥槽失败: {error}")))?
        .ok_or_else(|| ProviderImportError::not_found("要覆盖的 CodeM 目标不存在"))
}

fn write_agent_channel(
    connection: &Connection,
    config: &ExternalProviderConfig,
    target_id: &str,
    secret_slot: &str,
    overwritten: bool,
) -> Result<(), String> {
    let now = current_timestamp();
    if overwritten {
        connection
            .execute(
                r#"UPDATE agent_channels SET
                     name = ?, protocol = ?, base_url = ?, models_url = NULL,
                     template_id = ?, updated_at = ?
                   WHERE id = ? AND provider_id = ?"#,
                params![
                    config.name,
                    config.protocol.as_str(),
                    config.base_url,
                    config.preset_id,
                    now,
                    target_id,
                    config.target_scope,
                ],
            )
            .map_err(|error| format!("覆盖 Agent 渠道失败: {error}"))?;
    } else {
        connection
            .execute(
                r#"INSERT INTO agent_channels (
                     id, provider_id, name, protocol, base_url, models_url, template_id,
                     enabled, is_default, secret_slot, created_at, updated_at
                   ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, ?, ?)"#,
                params![
                    target_id,
                    config.target_scope,
                    config.name,
                    config.protocol.as_str(),
                    config.base_url,
                    config.preset_id,
                    config.enabled,
                    secret_slot,
                    now,
                    now,
                ],
            )
            .map_err(|error| format!("创建 Agent 渠道失败: {error}"))?;
    }
    sync_agent_models(connection, target_id, &config.models)
}

fn sync_agent_models(
    connection: &Connection,
    channel_id: &str,
    models: &[ExternalModel],
) -> Result<(), String> {
    if models.is_empty() {
        return Ok(());
    }
    let incoming = models
        .iter()
        .map(|model| model.model_id.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let mut statement = connection
        .prepare("SELECT id, model_id FROM agent_channel_models WHERE channel_id = ?")
        .map_err(|error| format!("读取 Agent 渠道旧模型失败: {error}"))?;
    let existing = statement
        .query_map(params![channel_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("查询 Agent 渠道旧模型失败: {error}"))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| format!("解析 Agent 渠道旧模型失败: {error}"))?;
    for (id, model_id) in existing {
        if !incoming.contains(&model_id.to_ascii_lowercase()) {
            connection
                .execute(
                    "UPDATE agent_channel_models SET enabled = 0, is_default = 0, updated_at = ? WHERE id = ?",
                    params![current_timestamp(), id],
                )
                .map_err(|error| format!("停用 Agent 渠道旧模型失败: {error}"))?;
        }
    }
    let has_enabled_default = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM agent_channel_models WHERE channel_id = ? AND enabled = 1 AND is_default = 1)",
            params![channel_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("读取 Agent 渠道默认模型失败: {error}"))?;
    for (index, model) in models.iter().enumerate() {
        let now = current_timestamp();
        connection
            .execute(
                r#"INSERT INTO agent_channel_models (
                     id, channel_id, model_id, display_name, enabled, is_default,
                     capabilities_json, created_at, updated_at
                   ) VALUES (?, ?, ?, ?, 1, ?, '{}', ?, ?)
                   ON CONFLICT(channel_id, model_id) DO UPDATE SET
                     display_name = excluded.display_name,
                     enabled = 1,
                     updated_at = excluded.updated_at"#,
                params![
                    uuid::Uuid::new_v4().to_string(),
                    channel_id,
                    model.model_id,
                    model.display_name,
                    !has_enabled_default && index == 0,
                    now,
                    now,
                ],
            )
            .map_err(|error| format!("保存 Agent 渠道模型失败: {error}"))?;
    }
    normalize_agent_default_model(connection, channel_id)
}

fn normalize_agent_default_model(connection: &Connection, channel_id: &str) -> Result<(), String> {
    let default_id = connection
        .query_row(
            r#"SELECT id FROM agent_channel_models
               WHERE channel_id = ? AND enabled = 1
               ORDER BY is_default DESC, display_name COLLATE NOCASE, id
               LIMIT 1"#,
            params![channel_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("读取 Agent 渠道默认模型失败: {error}"))?;
    connection
        .execute(
            r#"UPDATE agent_channel_models
               SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END, updated_at = ?
               WHERE channel_id = ? AND is_default != CASE WHEN id = ? THEN 1 ELSE 0 END"#,
            params![default_id, current_timestamp(), channel_id, default_id],
        )
        .map_err(|error| format!("修复 Agent 渠道默认模型失败: {error}"))?;
    Ok(())
}

fn write_chat_provider(
    connection: &Connection,
    config: &ExternalProviderConfig,
    target_id: &str,
    secret_slot: &str,
    overwritten: bool,
) -> Result<(), String> {
    let now = current_timestamp();
    if overwritten {
        connection
            .execute(
                r#"UPDATE ai_providers SET
                     preset_id = ?, name = ?, protocol = ?, base_url = ?, updated_at = ?
                   WHERE id = ?"#,
                params![
                    config.preset_id,
                    config.name,
                    config.protocol.as_str(),
                    config.base_url,
                    now,
                    target_id,
                ],
            )
            .map_err(|error| format!("覆盖普通聊天供应商失败: {error}"))?;
    } else {
        connection
            .execute(
                r#"INSERT INTO ai_providers (
                     id, preset_id, name, protocol, base_url, enabled, is_default,
                     secret_slot, created_at, updated_at
                   ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)"#,
                params![
                    target_id,
                    config.preset_id,
                    config.name,
                    config.protocol.as_str(),
                    config.base_url,
                    config.enabled,
                    secret_slot,
                    now,
                    now,
                ],
            )
            .map_err(|error| format!("创建普通聊天供应商失败: {error}"))?;
    }
    sync_chat_models(connection, target_id, &config.models)?;
    normalize_chat_default_provider(connection)
}

fn normalize_chat_default_provider(connection: &Connection) -> Result<(), String> {
    let current_default = connection
        .query_row(
            "SELECT id FROM ai_providers WHERE enabled = 1 AND is_default = 1 ORDER BY created_at, id LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("读取普通聊天默认供应商失败: {error}"))?;
    let selected = match current_default {
        Some(id) => Some(id),
        None => connection
            .query_row(
                "SELECT id FROM ai_providers WHERE enabled = 1 ORDER BY created_at, name COLLATE NOCASE, id LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("选择普通聊天默认供应商失败: {error}"))?,
    };
    connection
        .execute(
            r#"UPDATE ai_providers
               SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END, updated_at = ?
               WHERE is_default != CASE WHEN id = ? THEN 1 ELSE 0 END"#,
            params![selected, current_timestamp(), selected],
        )
        .map_err(|error| format!("修复普通聊天默认供应商失败: {error}"))?;
    Ok(())
}

fn sync_chat_models(
    connection: &Connection,
    provider_id: &str,
    models: &[ExternalModel],
) -> Result<(), String> {
    if models.is_empty() {
        return Ok(());
    }
    let incoming = models
        .iter()
        .map(|model| model.model_id.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let mut statement = connection
        .prepare("SELECT id, model_id FROM ai_models WHERE provider_id = ?")
        .map_err(|error| format!("读取普通聊天旧模型失败: {error}"))?;
    let existing = statement
        .query_map(params![provider_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("查询普通聊天旧模型失败: {error}"))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| format!("解析普通聊天旧模型失败: {error}"))?;
    for (id, model_id) in existing {
        if !incoming.contains(&model_id.to_ascii_lowercase()) {
            connection
                .execute(
                    "UPDATE ai_models SET enabled = 0, is_default = 0, updated_at = ? WHERE id = ?",
                    params![current_timestamp(), id],
                )
                .map_err(|error| format!("停用普通聊天旧模型失败: {error}"))?;
        }
    }
    let has_default = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM ai_models WHERE provider_id = ? AND enabled = 1 AND is_default = 1)",
            params![provider_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("读取普通聊天默认模型失败: {error}"))?;
    for (index, model) in models.iter().enumerate() {
        let now = current_timestamp();
        connection
            .execute(
                r#"INSERT INTO ai_models (
                     id, provider_id, model_id, display_name, enabled, is_default,
                     capabilities_json, created_at, updated_at
                   ) VALUES (?, ?, ?, ?, 1, ?, '{}', ?, ?)
                   ON CONFLICT(provider_id, model_id) DO UPDATE SET
                     display_name = excluded.display_name,
                     enabled = 1,
                     updated_at = excluded.updated_at"#,
                params![
                    uuid::Uuid::new_v4().to_string(),
                    provider_id,
                    model.model_id,
                    model.display_name,
                    !has_default && index == 0,
                    now,
                    now,
                ],
            )
            .map_err(|error| format!("保存普通聊天模型失败: {error}"))?;
    }
    normalize_chat_default_model(connection, provider_id)
}

fn normalize_chat_default_model(connection: &Connection, provider_id: &str) -> Result<(), String> {
    let default_id = connection
        .query_row(
            r#"SELECT id FROM ai_models
               WHERE provider_id = ? AND enabled = 1
               ORDER BY is_default DESC, display_name COLLATE NOCASE, id
               LIMIT 1"#,
            params![provider_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("读取普通聊天默认模型失败: {error}"))?;
    connection
        .execute(
            r#"UPDATE ai_models
               SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END, updated_at = ?
               WHERE provider_id = ? AND is_default != CASE WHEN id = ? THEN 1 ELSE 0 END"#,
            params![default_id, current_timestamp(), provider_id, default_id],
        )
        .map_err(|error| format!("修复普通聊天默认模型失败: {error}"))?;
    Ok(())
}

fn copy_agent_channel(
    service: &ProviderImportService,
    payload: CopyAgentChannelRequest,
) -> ProviderImportResult<ImportResult> {
    let channel_id = payload.channel_id.trim();
    if channel_id.is_empty() {
        return Err(ProviderImportError::bad_request(
            "请选择要复制的 Agent 渠道",
        ));
    }
    let mut connection = service
        .open_database()
        .map_err(ProviderImportError::internal)?;
    let channel = connection
        .query_row(
            r#"SELECT name, protocol, base_url, template_id, enabled, secret_slot
               FROM agent_channels WHERE id = ?"#,
            params![channel_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, bool>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|error| ProviderImportError::internal(format!("读取 Agent 渠道失败: {error}")))?
        .ok_or_else(|| ProviderImportError::not_found("Agent 渠道不存在"))?;
    let protocol = AiProtocol::parse(&channel.1)
        .ok_or_else(|| ProviderImportError::bad_request("Agent 渠道接口类型无效"))?;
    let api_key = service
        .secrets
        .get(&channel.5)
        .map_err(ProviderImportError::bad_request)?;
    let mut statement = connection
        .prepare(
            r#"SELECT model_id, display_name FROM agent_channel_models
               WHERE channel_id = ? AND enabled = 1
               ORDER BY is_default DESC, display_name COLLATE NOCASE"#,
        )
        .map_err(|error| {
            ProviderImportError::internal(format!("读取 Agent 渠道模型失败: {error}"))
        })?;
    let models = statement
        .query_map(params![channel_id], |row| {
            Ok(ExternalModel {
                model_id: row.get(0)?,
                display_name: row.get(1)?,
            })
        })
        .map_err(|error| {
            ProviderImportError::internal(format!("查询 Agent 渠道模型失败: {error}"))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| {
            ProviderImportError::internal(format!("解析 Agent 渠道模型失败: {error}"))
        })?;
    drop(statement);
    let config = ExternalProviderConfig {
        source: "agent_copy",
        source_id: channel_id.to_string(),
        target_scope: TARGET_ORDINARY_CHAT.to_string(),
        name: channel.0,
        protocol,
        base_url: channel.2,
        api_key,
        models,
        preset_id: channel.3,
        enabled: channel.4,
        warning: String::new(),
        unavailable_reason: String::new(),
    };
    apply_external_config(
        service,
        &mut connection,
        TARGET_ORDINARY_CHAT,
        &config,
        payload.overwrite_provider_id.as_deref(),
        false,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_service() -> (PathBuf, ProviderImportService) {
        let root =
            std::env::temp_dir().join(format!("codem-provider-import-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create provider import test directory");
        let secrets = SecretStore::new(root.clone());
        (root.clone(), ProviderImportService::new(root, secrets))
    }

    #[test]
    fn parses_ccswitch_provider_variants_without_guessing_models() {
        let claude = parse_ccswitch_claude(
            "claude-source",
            "MiniMax",
            &json!({
                "env": {
                    "ANTHROPIC_BASE_URL": "https://api.minimaxi.com/anthropic",
                    "ANTHROPIC_AUTH_TOKEN": "secret-claude",
                    "ANTHROPIC_MODEL": "MiniMax-M2.5"
                }
            }),
        )
        .expect("parse Claude channel");
        assert_eq!(claude.target_scope, CLAUDE_CODE_PROVIDER_ID);
        assert_eq!(claude.protocol, AiProtocol::AnthropicMessages);
        assert_eq!(claude.models[0].model_id, "MiniMax-M2.5");

        let codex = parse_ccswitch_codex(
            "codex-source",
            "Custom Codex",
            &json!({
                "auth": { "OPENAI_API_KEY": "secret-codex" },
                "config": "model = 'gpt-5.2'\nmodel_provider = 'custom'\n[model_providers.custom]\nbase_url = 'https://api.example.com/v1'\nwire_api = 'chat'\nrequires_openai_auth = false\n"
            }),
        )
        .expect("parse Codex channel");
        assert_eq!(codex.target_scope, OPENAI_CODEX_PROVIDER_ID);
        assert_eq!(codex.protocol, AiProtocol::OpenaiChat);
        assert_eq!(codex.models[0].model_id, "gpt-5.2");

        let opencode = parse_ccswitch_opencode(
            "opencode-source",
            "default",
            &json!({
                "provider": {
                    "custom": {
                        "name": "Custom OpenCode",
                        "npm": "@ai-sdk/openai-compatible",
                        "options": {
                            "baseURL": "https://api.example.com/v1",
                            "apiKey": "secret-opencode"
                        },
                        "models": {
                            "gpt-4o": { "name": "GPT-4o" }
                        }
                    }
                }
            }),
        );
        assert_eq!(opencode.len(), 1);
        assert_eq!(opencode[0].target_scope, OPENCODE_PROVIDER_ID);
        assert_eq!(opencode[0].models[0].display_name, "GPT-4o");
    }

    #[test]
    fn scan_response_never_serializes_api_key_plaintext() {
        let (root, service) = test_service();
        let response = scan_response(
            &service,
            SOURCE_CCSWITCH,
            TARGET_AGENT,
            Some(root.clone()),
            vec![
                external_config(
                    SOURCE_CCSWITCH,
                    "source",
                    CLAUDE_CODE_PROVIDER_ID,
                    "Provider",
                    AiProtocol::AnthropicMessages,
                    "https://api.example.com".to_string(),
                    "sk-must-not-leak".to_string(),
                    Vec::new(),
                    true,
                    String::new(),
                ),
                external_config(
                    SOURCE_CCSWITCH,
                    "missing-key",
                    CLAUDE_CODE_PROVIDER_ID,
                    "Missing Key",
                    AiProtocol::AnthropicMessages,
                    "https://missing.example.com".to_string(),
                    String::new(),
                    Vec::new(),
                    true,
                    String::new(),
                ),
            ],
        )
        .expect("scan providers");
        assert_eq!(response.items.len(), 1);
        assert_eq!(response.items[0].name, "Provider");
        let serialized = serde_json::to_string(&response).expect("serialize scan response");
        assert!(!serialized.contains("sk-must-not-leak"));
        assert!(serialized.contains("apiKeyAvailable"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn overwrite_preserves_agent_identity_and_state_while_reconciling_models() {
        let (root, service) = test_service();
        let mut connection = service.open_database().expect("open database");
        connection
            .execute(
                r#"INSERT INTO agent_channels (
                     id, provider_id, name, protocol, base_url, models_url, template_id,
                     enabled, is_default, secret_slot, created_at, updated_at
                   ) VALUES ('channel', 'claude-code', 'Provider', 'anthropic_messages',
                     'https://old.example.com', NULL, NULL, 1, 1, 'agent-channel:channel',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"#,
                [],
            )
            .expect("insert agent channel");
        connection
            .execute(
                r#"INSERT INTO agent_channel_models (
                     id, channel_id, model_id, display_name, enabled, is_default,
                     capabilities_json, created_at, updated_at
                   ) VALUES ('old-model', 'channel', 'old', 'Old', 1, 1, '{}',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"#,
                [],
            )
            .expect("insert old model");
        service
            .secrets
            .set("agent-channel:channel", "old-secret")
            .expect("store old secret");
        let config = external_config(
            SOURCE_CCSWITCH,
            "source",
            CLAUDE_CODE_PROVIDER_ID,
            "Provider",
            AiProtocol::AnthropicMessages,
            "https://new.example.com".to_string(),
            "new-secret".to_string(),
            vec![ExternalModel {
                model_id: "new".to_string(),
                display_name: "New".to_string(),
            }],
            true,
            String::new(),
        );
        let result = apply_external_config(
            &service,
            &mut connection,
            TARGET_AGENT,
            &config,
            Some("channel"),
            true,
        )
        .expect("overwrite channel");
        assert_eq!(result.target_id, "channel");
        let state = connection
            .query_row(
                "SELECT enabled, is_default, base_url FROM agent_channels WHERE id = 'channel'",
                [],
                |row| {
                    Ok((
                        row.get::<_, bool>(0)?,
                        row.get::<_, bool>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .expect("read overwritten channel");
        assert_eq!(state, (true, true, "https://new.example.com".to_string()));
        let old_enabled: bool = connection
            .query_row(
                "SELECT enabled FROM agent_channel_models WHERE id = 'old-model'",
                [],
                |row| row.get(0),
            )
            .expect("read old model");
        assert!(!old_enabled);
        let new_default: bool = connection
            .query_row(
                "SELECT is_default FROM agent_channel_models WHERE channel_id = 'channel' AND model_id = 'new'",
                [],
                |row| row.get(0),
            )
            .expect("read new model");
        assert!(new_default);
        assert_eq!(
            service
                .secrets
                .get("agent-channel:channel")
                .expect("read updated secret"),
            "new-secret"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn empty_external_model_list_does_not_disable_manual_models() {
        let (root, service) = test_service();
        let mut connection = service.open_database().expect("open database");
        connection
            .execute(
                r#"INSERT INTO ai_providers (
                     id, preset_id, name, protocol, base_url, enabled, is_default,
                     secret_slot, created_at, updated_at
                   ) VALUES ('provider', NULL, 'Provider', 'openai_chat',
                     'https://old.example.com', 1, 1, 'ai-provider:provider:api-key',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"#,
                [],
            )
            .expect("insert chat provider");
        connection
            .execute(
                r#"INSERT INTO ai_models (
                     id, provider_id, model_id, display_name, enabled, is_default,
                     capabilities_json, created_at, updated_at
                   ) VALUES ('manual-model', 'provider', 'manual', 'Manual', 1, 1, '{}',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"#,
                [],
            )
            .expect("insert manual model");
        let config = external_config(
            SOURCE_CHERRY_STUDIO,
            "source::openai-chat",
            TARGET_ORDINARY_CHAT,
            "Provider",
            AiProtocol::OpenaiChat,
            "https://new.example.com".to_string(),
            "new-secret".to_string(),
            Vec::new(),
            true,
            String::new(),
        );
        apply_external_config(
            &service,
            &mut connection,
            TARGET_ORDINARY_CHAT,
            &config,
            Some("provider"),
            true,
        )
        .expect("overwrite provider");
        let enabled: bool = connection
            .query_row(
                "SELECT enabled FROM ai_models WHERE id = 'manual-model'",
                [],
                |row| row.get(0),
            )
            .expect("read manual model");
        assert!(enabled);
        let _ = fs::remove_dir_all(root);
    }
}
