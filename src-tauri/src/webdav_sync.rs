//! WebDAV 渠道同步：把 Agent 渠道（含模型目录）与渠道 API Key
//! 以三文件快照（manifest.json / data.json / secrets.enc）手动上传/下载到
//! 用户自建 WebDAV 服务。设计参考 mxterm 的 WebDAV 同步：
//! manifest 最后上传保证远端原子性；secrets 用同步主密码派生密钥加密，
//! 主密码只在单次请求内存中存活；下载导入前先整库备份，再事务内全量替换。

use crate::{
    agent_channels::{
        initialize_database as initialize_channel_database, repair_default_channel,
        validate_protocol,
    },
    agent_runtime::{
        CLAUDE_CODE_PROVIDER_ID, DEEPSEEK_DSH_PROVIDER_ID, GEMINI_CLI_PROVIDER_ID,
        GROK_BUILD_PROVIDER_ID, HERMES_AGENT_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID,
        OPENCODE_PROVIDER_ID, PI_AGENT_PROVIDER_ID,
    },
    ordinary_chat::{secrets::SecretStore, types::AiProtocol},
};
use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
    Aes256Gcm, Key,
};
use argon2::{Algorithm, Argon2, Params, Version};
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use url::Url;

const SYNC_FORMAT: &str = "codem-channel-sync";
const SYNC_PROTOCOL_VERSION: u16 = 1;
const SETTINGS_FILE_NAME: &str = "webdav-sync.json";
const WEBDAV_PASSWORD_SLOT: &str = "webdav-sync:password";
const CHANNEL_SECRET_PREFIX: &str = "agent-channel:";
const DEFAULT_REMOTE_ROOT: &str = "codem-sync";
const DEFAULT_PROFILE: &str = "default";
const MANIFEST_FILE: &str = "manifest.json";
const DATA_FILE: &str = "data.json";
const SECRETS_FILE: &str = "secrets.enc";
const MANIFEST_MAX_BYTES: usize = 512 * 1024;
const DATA_MAX_BYTES: usize = 16 * 1024 * 1024;
const SECRETS_MAX_BYTES: usize = 4 * 1024 * 1024;
const SYNC_LOCK_MESSAGE: &str = "已有 WebDAV 同步任务正在进行，请稍后再试";

// ===================== 传输层 =====================

pub(crate) trait WebDavTransport {
    /// 返回集合是否存在；404 视为不存在。
    async fn propfind(&self, path: &[String]) -> Result<bool, String>;
    /// 创建集合；已存在视为成功。
    async fn mkcol(&self, path: &[String]) -> Result<(), String>;
    async fn put(&self, path: &[String], bytes: &[u8], content_type: &str) -> Result<(), String>;
    /// 返回 None 表示远端没有该文件。
    async fn get(&self, path: &[String], max_bytes: usize) -> Result<Option<Vec<u8>>, String>;
}

pub(crate) struct ReqwestWebDavTransport {
    client: reqwest::Client,
    base_url: String,
    username: String,
    password: String,
}

fn describe_status(status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        401 => "认证失败，请检查 WebDAV 用户名或密码".to_string(),
        403 => "服务器拒绝访问，请检查 WebDAV 账号权限".to_string(),
        code => format!("HTTP {code}"),
    }
}

fn redact_url(url: &str) -> String {
    url.split('?').next().unwrap_or(url).to_string()
}

impl ReqwestWebDavTransport {
    pub(crate) fn new(connection: &WebDavConnection) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|error| format!("创建 WebDAV 客户端失败: {error}"))?;
        Ok(Self {
            client,
            base_url: connection.base_url.trim_end_matches('/').to_string(),
            username: connection.username.trim().to_string(),
            password: connection.password.clone(),
        })
    }

    fn request_url(&self, path: &[String]) -> String {
        let mut url = self.base_url.clone();
        for segment in path {
            url.push('/');
            url.push_str(segment);
        }
        url
    }

    fn authorized(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if self.username.is_empty() {
            builder
        } else {
            builder.basic_auth(&self.username, Some(&self.password))
        }
    }
}

impl WebDavTransport for ReqwestWebDavTransport {
    async fn propfind(&self, path: &[String]) -> Result<bool, String> {
        let url = self.request_url(path);
        let method =
            reqwest::Method::from_bytes(b"PROPFIND").expect("PROPFIND must be a valid method");
        let response = self
            .authorized(
                self.client
                    .request(method, &url)
                    .header("Depth", "0")
                    .header("Content-Type", "application/xml")
                    .body(
                        r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>"#,
                    ),
            )
            .send()
            .await
            .map_err(|error| format!("WebDAV 请求失败（{}）: {error}", redact_url(&url)))?;
        match response.status().as_u16() {
            207 => Ok(true),
            404 => Ok(false),
            code => Err(format!(
                "WebDAV 读取目录失败（{}）: {}",
                redact_url(&url),
                describe_status(
                    reqwest::StatusCode::from_u16(code)
                        .unwrap_or(reqwest::StatusCode::INTERNAL_SERVER_ERROR)
                )
            )),
        }
    }

    async fn mkcol(&self, path: &[String]) -> Result<(), String> {
        let url = self.request_url(path);
        let method = reqwest::Method::from_bytes(b"MKCOL").expect("MKCOL must be a valid method");
        let response = self
            .authorized(
                self.client
                    .request(method, &url)
                    .header("Content-Length", "0"),
            )
            .send()
            .await
            .map_err(|error| format!("WebDAV 请求失败（{}）: {error}", redact_url(&url)))?;
        match response.status().as_u16() {
            201 | 200 | 405 => Ok(()),
            code => Err(format!(
                "WebDAV 创建目录失败（{}）: {}",
                redact_url(&url),
                describe_status(
                    reqwest::StatusCode::from_u16(code)
                        .unwrap_or(reqwest::StatusCode::INTERNAL_SERVER_ERROR)
                )
            )),
        }
    }

    async fn put(&self, path: &[String], bytes: &[u8], content_type: &str) -> Result<(), String> {
        let url = self.request_url(path);
        let response = self
            .authorized(
                self.client
                    .put(&url)
                    .header("Content-Type", content_type)
                    .body(bytes.to_vec()),
            )
            .send()
            .await
            .map_err(|error| format!("WebDAV 上传失败（{}）: {error}", redact_url(&url)))?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!(
                "WebDAV 上传失败（{}）: {}",
                redact_url(&url),
                describe_status(response.status())
            ))
        }
    }

    async fn get(&self, path: &[String], max_bytes: usize) -> Result<Option<Vec<u8>>, String> {
        let url = self.request_url(path);
        let response = self
            .authorized(self.client.get(&url))
            .send()
            .await
            .map_err(|error| format!("WebDAV 下载失败（{}）: {error}", redact_url(&url)))?;
        match response.status().as_u16() {
            200 => {}
            404 => return Ok(None),
            code => {
                return Err(format!(
                    "WebDAV 下载失败（{}）: {}",
                    redact_url(&url),
                    describe_status(
                        reqwest::StatusCode::from_u16(code)
                            .unwrap_or(reqwest::StatusCode::INTERNAL_SERVER_ERROR)
                    )
                ))
            }
        }
        if let Some(length) = response.content_length() {
            if length as usize > max_bytes {
                return Err("远端文件超出大小限制".to_string());
            }
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("WebDAV 下载失败（{}）: {error}", redact_url(&url)))?;
        if bytes.len() > max_bytes {
            return Err("远端文件超出大小限制".to_string());
        }
        Ok(Some(bytes.to_vec()))
    }
}

async fn ensure_collection<T: WebDavTransport>(
    transport: &T,
    path: &[String],
) -> Result<(), String> {
    let mut prefix: Vec<String> = Vec::with_capacity(path.len());
    for segment in path {
        prefix.push(segment.clone());
        transport.mkcol(&prefix).await?;
    }
    Ok(())
}

// ===================== 连接与设置 =====================

#[derive(Clone)]
pub(crate) struct WebDavConnection {
    pub(crate) base_url: String,
    pub(crate) username: String,
    pub(crate) password: String,
    pub(crate) remote_root: String,
    pub(crate) profile: String,
}

impl WebDavConnection {
    fn validate(&self) -> Result<(), String> {
        if self.base_url.trim().is_empty() {
            return Err("WebDAV 服务地址不能为空".to_string());
        }
        if self.base_url.contains('?') || self.base_url.contains('#') {
            return Err("WebDAV 服务地址不应包含查询参数".to_string());
        }
        let parsed =
            Url::parse(self.base_url.trim()).map_err(|_| "WebDAV 服务地址格式无效".to_string())?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("WebDAV 服务地址必须以 http:// 或 https:// 开头".to_string());
        }
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err("WebDAV 服务地址不应内嵌账号密码，请分别填写".to_string());
        }
        validate_remote_root(&self.remote_root)?;
        validate_profile(&self.profile)?;
        Ok(())
    }

    fn profile_directory(&self) -> Vec<String> {
        let mut segments: Vec<String> = self
            .remote_root
            .split('/')
            .filter(|segment| !segment.is_empty())
            .map(str::to_string)
            .collect();
        segments.push("v1".to_string());
        segments.push(self.profile.clone());
        segments
    }

    fn file_path(&self, name: &str) -> Vec<String> {
        let mut path = self.profile_directory();
        path.push(name.to_string());
        path
    }
}

fn is_safe_path_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment.len() <= 64
        && segment
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-')
        && segment != "."
        && segment != ".."
}

fn validate_remote_root(value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    if trimmed.len() > 128 {
        return Err("远端目录长度不能超过 128 个字符".to_string());
    }
    for segment in trimmed.split('/') {
        if !is_safe_path_segment(segment) {
            return Err("远端目录只能包含字母、数字、点、下划线、连字符和目录分隔符".to_string());
        }
    }
    Ok(())
}

fn validate_profile(value: &str) -> Result<(), String> {
    if !is_safe_path_segment(value.trim()) {
        return Err("Profile 只能包含字母、数字、点、下划线和连字符".to_string());
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct StoredWebDavSyncSettings {
    enabled: bool,
    base_url: String,
    username: String,
    remote_root: String,
    profile: String,
    last_sync_at: Option<String>,
    last_snapshot_id: Option<String>,
    last_remote_device: Option<String>,
    last_error: Option<String>,
    updated_at: String,
}

impl Default for StoredWebDavSyncSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: String::new(),
            username: String::new(),
            remote_root: DEFAULT_REMOTE_ROOT.to_string(),
            profile: DEFAULT_PROFILE.to_string(),
            last_sync_at: None,
            last_snapshot_id: None,
            last_remote_device: None,
            last_error: None,
            updated_at: String::new(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WebDavSyncSettingsResponse {
    enabled: bool,
    base_url: String,
    username: String,
    password_saved: bool,
    remote_root: String,
    profile: String,
    last_sync_at: Option<String>,
    last_snapshot_id: Option<String>,
    last_remote_device: Option<String>,
    last_error: Option<String>,
    updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebDavSettingsInput {
    enabled: bool,
    base_url: String,
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    password_touched: bool,
    #[serde(default)]
    remote_root: String,
    #[serde(default)]
    profile: String,
}

// ===================== 快照协议 =====================

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncManifest {
    format: String,
    protocol_version: u16,
    snapshot_id: String,
    device_name: String,
    created_at: String,
    channel_count: usize,
    model_count: usize,
    has_secrets: bool,
    artifacts: BTreeMap<String, SyncArtifactMeta>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncArtifactMeta {
    sha256: String,
    size: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncDataDocument {
    version: u16,
    exported_at: String,
    channels: Vec<SyncChannelRecord>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncChannelRecord {
    id: String,
    provider_id: String,
    name: String,
    protocol: String,
    base_url: String,
    models_url: Option<String>,
    template_id: Option<String>,
    enabled: bool,
    is_default: bool,
    secret_slot: String,
    created_at: String,
    updated_at: String,
    models: Vec<SyncChannelModelRecord>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncChannelModelRecord {
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

#[derive(Debug, Serialize, Deserialize)]
struct SyncSecretsPlaintext {
    version: u16,
    secrets: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncSecretsEnvelope {
    format: String,
    protocol_version: u16,
    kdf: String,
    salt: String,
    nonce: String,
    ciphertext: String,
}

fn sync_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "CodeM 设备".to_string())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

const ARGON2_KDF: &str = "argon2id";

fn derive_sync_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let params = Params::new(19_456, 2, 1, Some(32))
        .map_err(|error| format!("初始化加密参数失败: {error}"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|error| format!("派生同步密钥失败: {error}"))?;
    Ok(key)
}

fn validate_sync_password(password: &str) -> Result<(), String> {
    if password.chars().count() < 8 {
        return Err("同步主密码至少需要 8 个字符".to_string());
    }
    Ok(())
}

fn secrets_aad(snapshot_id: &str, data_sha256: String) -> String {
    format!("{SYNC_FORMAT}|{SYNC_PROTOCOL_VERSION}|{snapshot_id}|{data_sha256}")
}

fn seal_sync_secrets(
    password: &str,
    snapshot_id: &str,
    data_sha256: &str,
    secrets: &BTreeMap<String, String>,
) -> Result<Vec<u8>, String> {
    validate_sync_password(password)?;
    let plaintext = SyncSecretsPlaintext {
        version: SYNC_PROTOCOL_VERSION,
        secrets: secrets.clone(),
    };
    let plaintext_bytes =
        serde_json::to_vec(&plaintext).map_err(|error| format!("序列化渠道密钥失败: {error}"))?;
    let key_material = Aes256Gcm::generate_key(&mut OsRng);
    let salt = key_material[..16].to_vec();
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let key = derive_sync_key(password, &salt)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let aad = secrets_aad(snapshot_id, data_sha256.to_string());
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: &plaintext_bytes,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| "加密渠道密钥失败".to_string())?;
    let envelope = SyncSecretsEnvelope {
        format: SYNC_FORMAT.to_string(),
        protocol_version: SYNC_PROTOCOL_VERSION,
        kdf: ARGON2_KDF.to_string(),
        salt: STANDARD.encode(&salt),
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(&ciphertext),
    };
    serde_json::to_vec(&envelope).map_err(|error| format!("序列化加密信封失败: {error}"))
}

fn open_sync_secrets(
    password: &str,
    snapshot_id: &str,
    data_sha256: &str,
    envelope_bytes: &[u8],
) -> Result<SyncSecretsPlaintext, String> {
    let envelope: SyncSecretsEnvelope =
        serde_json::from_slice(envelope_bytes).map_err(|_| "远端密钥信封格式无效".to_string())?;
    if envelope.format != SYNC_FORMAT || envelope.protocol_version != SYNC_PROTOCOL_VERSION {
        return Err("远端密钥信封不兼容".to_string());
    }
    if envelope.kdf != ARGON2_KDF {
        return Err(format!("不支持的密钥派生算法: {}", envelope.kdf));
    }
    let salt = STANDARD
        .decode(&envelope.salt)
        .map_err(|_| "远端密钥信封 salt 无效".to_string())?;
    if salt.len() != 16 {
        return Err("远端密钥信封 salt 长度无效".to_string());
    }
    let nonce = STANDARD
        .decode(&envelope.nonce)
        .map_err(|_| "远端密钥信封 nonce 无效".to_string())?;
    if nonce.len() != 12 {
        return Err("远端密钥信封 nonce 长度无效".to_string());
    }
    let ciphertext = STANDARD
        .decode(&envelope.ciphertext)
        .map_err(|_| "远端密钥信封密文无效".to_string())?;
    let key = derive_sync_key(password, &salt)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let aad = secrets_aad(snapshot_id, data_sha256.to_string());
    let plaintext_bytes = cipher
        .decrypt(
            aes_gcm::Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| "同步主密码不正确或密文已损坏".to_string())?;
    let plaintext: SyncSecretsPlaintext =
        serde_json::from_slice(&plaintext_bytes).map_err(|_| "远端密钥数据格式无效".to_string())?;
    if plaintext.version != SYNC_PROTOCOL_VERSION {
        return Err("远端密钥数据版本不兼容".to_string());
    }
    Ok(plaintext)
}

// ===================== 导出 / 导入 =====================

fn load_sync_channels(connection: &Connection) -> Result<SyncDataDocument, String> {
    let mut statement = connection
        .prepare(
            r#"SELECT id, provider_id, name, protocol, base_url, models_url, template_id,
                      enabled, is_default, secret_slot, created_at, updated_at
               FROM agent_channels
               ORDER BY provider_id, is_default DESC, updated_at DESC"#,
        )
        .map_err(|error| format!("读取 Agent 渠道失败: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(SyncChannelRecord {
                id: row.get(0)?,
                provider_id: row.get(1)?,
                name: row.get(2)?,
                protocol: row.get(3)?,
                base_url: row.get(4)?,
                models_url: row.get(5)?,
                template_id: row.get(6)?,
                enabled: row.get::<_, i64>(7)? != 0,
                is_default: row.get::<_, i64>(8)? != 0,
                secret_slot: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
                models: Vec::new(),
            })
        })
        .map_err(|error| format!("读取 Agent 渠道失败: {error}"))?;
    let mut channels: Vec<SyncChannelRecord> = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| format!("读取 Agent 渠道失败: {error}"))?;
    for channel in &mut channels {
        let mut model_statement = connection
            .prepare(
                r#"SELECT id, channel_id, model_id, display_name, enabled, is_default,
                          capabilities_json, created_at, updated_at
                   FROM agent_channel_models
                   WHERE channel_id = ?
                   ORDER BY is_default DESC, display_name COLLATE NOCASE, model_id COLLATE NOCASE"#,
            )
            .map_err(|error| format!("读取 Agent 渠道模型失败: {error}"))?;
        let model_rows = model_statement
            .query_map(params![channel.id], |row| {
                let capabilities_json: String = row.get(6)?;
                Ok(SyncChannelModelRecord {
                    id: row.get(0)?,
                    channel_id: row.get(1)?,
                    model_id: row.get(2)?,
                    display_name: row.get(3)?,
                    enabled: row.get::<_, i64>(4)? != 0,
                    is_default: row.get::<_, i64>(5)? != 0,
                    capabilities: serde_json::from_str(&capabilities_json)
                        .unwrap_or_else(|_| json!({})),
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .map_err(|error| format!("读取 Agent 渠道模型失败: {error}"))?;
        channel.models = model_rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| format!("读取 Agent 渠道模型失败: {error}"))?;
    }
    Ok(SyncDataDocument {
        version: SYNC_PROTOCOL_VERSION,
        exported_at: sync_timestamp(),
        channels,
    })
}

fn known_provider_ids() -> HashSet<&'static str> {
    HashSet::from([
        CLAUDE_CODE_PROVIDER_ID,
        OPENAI_CODEX_PROVIDER_ID,
        GROK_BUILD_PROVIDER_ID,
        OPENCODE_PROVIDER_ID,
        PI_AGENT_PROVIDER_ID,
        GEMINI_CLI_PROVIDER_ID,
        HERMES_AGENT_PROVIDER_ID,
        DEEPSEEK_DSH_PROVIDER_ID,
    ])
}

fn validate_data_document(document: &SyncDataDocument) -> Result<(), String> {
    if document.version != SYNC_PROTOCOL_VERSION {
        return Err(format!(
            "快照数据版本不兼容（{}），当前支持 {SYNC_PROTOCOL_VERSION}",
            document.version
        ));
    }
    let known_providers = known_provider_ids();
    let mut channel_ids = HashSet::new();
    let mut secret_slots = HashSet::new();
    let mut model_ids = HashSet::new();
    let mut names_by_provider: BTreeMap<String, HashSet<String>> = BTreeMap::new();
    for channel in &document.channels {
        if !known_providers.contains(channel.provider_id.as_str()) {
            return Err(format!(
                "快照包含不支持的 Agent（{}），请升级 CodeM 后重试",
                channel.provider_id
            ));
        }
        let protocol = AiProtocol::parse(&channel.protocol)
            .ok_or_else(|| format!("渠道“{}”的接口类型无效", channel.name))?;
        validate_protocol(&channel.provider_id, protocol)
            .map_err(|error| error.message().to_string())?;
        if channel.name.trim().is_empty() {
            return Err("快照包含名称为空的渠道".to_string());
        }
        let base_url = Url::parse(channel.base_url.trim())
            .map_err(|_| format!("渠道“{}”的 API 地址无效", channel.name))?;
        if !matches!(base_url.scheme(), "http" | "https") {
            return Err(format!(
                "渠道“{}”的 API 地址必须以 http(s) 开头",
                channel.name
            ));
        }
        if let Some(models_url) = channel.models_url.as_deref().map(str::trim) {
            if !models_url.is_empty() {
                let parsed = Url::parse(models_url)
                    .map_err(|_| format!("渠道“{}”的模型列表地址无效", channel.name))?;
                if !matches!(parsed.scheme(), "http" | "https") {
                    return Err(format!(
                        "渠道“{}”的模型列表地址必须以 http(s) 开头",
                        channel.name
                    ));
                }
            }
        }
        if channel.secret_slot != format!("{CHANNEL_SECRET_PREFIX}{}", channel.id) {
            return Err(format!("渠道“{}”的密钥槽位不合法", channel.name));
        }
        if !channel_ids.insert(channel.id.clone()) {
            return Err(format!("快照包含重复的渠道 ID: {}", channel.id));
        }
        if !secret_slots.insert(channel.secret_slot.clone()) {
            return Err(format!("快照包含重复的密钥槽位: {}", channel.secret_slot));
        }
        let provider_names = names_by_provider
            .entry(channel.provider_id.clone())
            .or_default();
        if !provider_names.insert(channel.name.trim().to_lowercase()) {
            return Err(format!(
                "快照在同一 Agent 下包含同名渠道“{}”",
                channel.name.trim()
            ));
        }
        if channel.created_at.trim().is_empty() || channel.updated_at.trim().is_empty() {
            return Err(format!("渠道“{}”缺少时间戳", channel.name));
        }
        let mut model_keys = HashSet::new();
        for model in &channel.models {
            if model.channel_id != channel.id {
                return Err(format!(
                    "渠道“{}”的模型 {} 引用了错误的渠道",
                    channel.name, model.model_id
                ));
            }
            if model.model_id.trim().is_empty() || model.display_name.trim().is_empty() {
                return Err(format!("渠道“{}”包含空模型条目", channel.name));
            }
            if !model_ids.insert(model.id.clone()) {
                return Err(format!("快照包含重复的模型 ID: {}", model.id));
            }
            if !model_keys.insert(model.model_id.clone()) {
                return Err(format!(
                    "渠道“{}”包含重复的模型 {}",
                    channel.name, model.model_id
                ));
            }
        }
    }
    Ok(())
}

fn insert_sync_channels(
    connection: &mut Connection,
    document: &SyncDataDocument,
) -> Result<(), String> {
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| format!("开始导入事务失败: {error}"))?;
    transaction
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|error| format!("启用外键约束失败: {error}"))?;
    transaction
        .execute("DELETE FROM agent_channel_models", [])
        .map_err(|error| format!("清空渠道模型失败: {error}"))?;
    transaction
        .execute("DELETE FROM agent_channels", [])
        .map_err(|error| format!("清空渠道失败: {error}"))?;
    for channel in &document.channels {
        transaction
            .execute(
                r#"INSERT INTO agent_channels (
                    id, provider_id, name, protocol, base_url, models_url, template_id, enabled,
                    is_default, secret_slot, created_at, updated_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
                params![
                    channel.id,
                    channel.provider_id,
                    channel.name,
                    channel.protocol,
                    channel.base_url,
                    channel.models_url,
                    channel.template_id,
                    channel.enabled,
                    channel.is_default,
                    channel.secret_slot,
                    channel.created_at,
                    channel.updated_at,
                ],
            )
            .map_err(|error| format!("导入渠道“{}”失败: {error}", channel.name))?;
        for model in &channel.models {
            let capabilities = serde_json::to_string(&model.capabilities)
                .map_err(|error| format!("序列化模型能力失败: {error}"))?;
            transaction
                .execute(
                    r#"INSERT INTO agent_channel_models (
                        id, channel_id, model_id, display_name, enabled, is_default,
                        capabilities_json, created_at, updated_at
                      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
                    params![
                        model.id,
                        model.channel_id,
                        model.model_id,
                        model.display_name,
                        model.enabled,
                        model.is_default,
                        capabilities,
                        model.created_at,
                        model.updated_at,
                    ],
                )
                .map_err(|error| {
                    format!(
                        "导入渠道“{}”的模型 {} 失败: {error}",
                        channel.name, model.model_id
                    )
                })?;
        }
    }
    let mut providers: Vec<&str> = document
        .channels
        .iter()
        .map(|channel| channel.provider_id.as_str())
        .collect();
    providers.sort_unstable();
    providers.dedup();
    for provider_id in providers {
        repair_default_channel(&transaction, provider_id)?;
    }
    if table_exists(&transaction, "threads")? {
        if table_exists(&transaction, "thread_model_preferences")? {
            transaction
                .execute(
                    r#"DELETE FROM thread_model_preferences
                       WHERE thread_id IN (
                         SELECT id FROM threads
                         WHERE agent_channel_id IS NOT NULL
                           AND agent_channel_id NOT IN (SELECT id FROM agent_channels)
                       )"#,
                    [],
                )
                .map_err(|error| format!("清理线程渠道模型偏好失败: {error}"))?;
        }
        transaction
            .execute(
                r#"UPDATE threads
                   SET session_id = NULL, transcript_path = NULL, model = NULL,
                       reasoning_effort = NULL, agent_channel_id = NULL,
                       agent_channel_fingerprint = NULL, updated_at = ?
                   WHERE agent_channel_id IS NOT NULL
                      AND agent_channel_id NOT IN (SELECT id FROM agent_channels)"#,
                params![sync_timestamp()],
            )
            .map_err(|error| format!("清理线程渠道引用失败: {error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("提交导入事务失败: {error}"))?;
    Ok(())
}

fn table_exists(connection: &Connection, table: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            params![table],
            |_| Ok(()),
        )
        .optional()
        .map(|value| value.is_some())
        .map_err(|error| format!("读取数据库结构失败: {error}"))
}

fn create_channel_sync_backup(app_data_dir: &Path) -> Result<PathBuf, String> {
    let backup_dir = app_data_dir
        .join("backups")
        .join("channel-sync")
        .join("latest");
    fs::create_dir_all(&backup_dir).map_err(|error| format!("创建同步备份目录失败: {error}"))?;
    let database_path = app_data_dir.join("codem.sqlite");
    if database_path.exists() {
        let source =
            Connection::open(&database_path).map_err(|error| format!("打开数据库失败: {error}"))?;
        let mut target = Connection::open(backup_dir.join("codem.sqlite"))
            .map_err(|error| format!("创建数据库备份失败: {error}"))?;
        let backup = rusqlite::backup::Backup::new(&source, &mut target)
            .map_err(|error| format!("初始化数据库备份失败: {error}"))?;
        backup
            .run_to_completion(64, Duration::from_millis(5), None)
            .map_err(|error| format!("备份数据库失败: {error}"))?;
    }
    let vault_path = app_data_dir.join("ai-secrets.enc");
    if vault_path.exists() {
        fs::copy(&vault_path, backup_dir.join("ai-secrets.enc"))
            .map_err(|error| format!("备份密钥库失败: {error}"))?;
    }
    Ok(backup_dir)
}

fn replace_settings_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    match fs::rename(temporary, destination) {
        Ok(()) => return Ok(()),
        Err(error) if !destination.exists() => {
            return Err(format!("保存 WebDAV 设置失败: {error}"));
        }
        Err(_) => {}
    }

    let backup = destination.with_extension("json.bak");
    if backup.exists() {
        fs::remove_file(&backup).map_err(|error| format!("清理 WebDAV 设置备份失败: {error}"))?;
    }
    fs::rename(destination, &backup).map_err(|error| format!("备份旧 WebDAV 设置失败: {error}"))?;
    match fs::rename(temporary, destination) {
        Ok(()) => {
            let _ = fs::remove_file(backup);
            Ok(())
        }
        Err(error) => {
            let rollback = fs::rename(&backup, destination);
            match rollback {
                Ok(()) => Err(format!("保存 WebDAV 设置失败: {error}")),
                Err(rollback_error) => Err(format!(
                    "保存 WebDAV 设置失败: {error}；恢复旧设置失败: {rollback_error}"
                )),
            }
        }
    }
}

// ===================== 服务编排 =====================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WebDavSyncResult {
    direction: &'static str,
    snapshot_id: String,
    synced_at: String,
    channel_count: usize,
    model_count: usize,
    secret_count: usize,
    data_size: u64,
    backup_dir: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WebDavRemoteInfo {
    exists: bool,
    compatible: bool,
    reason: Option<String>,
    snapshot_id: Option<String>,
    device_name: Option<String>,
    created_at: Option<String>,
    channel_count: Option<usize>,
    model_count: Option<usize>,
    has_secrets: Option<bool>,
    data_size: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WebDavTestResult {
    ok: bool,
    message: String,
    latency_ms: u64,
}

#[derive(Clone)]
pub(crate) struct WebDavSyncService {
    database_path: Arc<PathBuf>,
    app_data_dir: Arc<PathBuf>,
    secrets: SecretStore,
    lock: Arc<tokio::sync::Mutex<()>>,
}

impl WebDavSyncService {
    pub(crate) fn new(app_data_dir: PathBuf, secrets: SecretStore) -> Self {
        Self {
            database_path: Arc::new(app_data_dir.join("codem.sqlite")),
            app_data_dir: Arc::new(app_data_dir),
            secrets,
            lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    fn settings_path(&self) -> PathBuf {
        self.app_data_dir.join(SETTINGS_FILE_NAME)
    }

    fn read_settings(&self) -> StoredWebDavSyncSettings {
        let Ok(content) = fs::read_to_string(self.settings_path()) else {
            return StoredWebDavSyncSettings::default();
        };
        serde_json::from_str(&content).unwrap_or_default()
    }

    fn write_settings(&self, settings: &StoredWebDavSyncSettings) -> Result<(), String> {
        let path = self.settings_path();
        let temporary = path.with_extension("json.tmp");
        let content = serde_json::to_string_pretty(settings)
            .map_err(|error| format!("序列化 WebDAV 设置失败: {error}"))?;
        fs::write(&temporary, format!("{content}\n"))
            .map_err(|error| format!("写入 WebDAV 设置失败: {error}"))?;
        replace_settings_file(&temporary, &path)?;
        Ok(())
    }

    fn settings_response(&self, settings: &StoredWebDavSyncSettings) -> WebDavSyncSettingsResponse {
        let password_saved = self.secrets.has(WEBDAV_PASSWORD_SLOT).unwrap_or(false);
        WebDavSyncSettingsResponse {
            enabled: settings.enabled,
            base_url: settings.base_url.clone(),
            username: settings.username.clone(),
            password_saved,
            remote_root: settings.remote_root.clone(),
            profile: settings.profile.clone(),
            last_sync_at: settings.last_sync_at.clone(),
            last_snapshot_id: settings.last_snapshot_id.clone(),
            last_remote_device: settings.last_remote_device.clone(),
            last_error: settings.last_error.clone(),
            updated_at: settings.updated_at.clone(),
        }
    }

    fn connection_from_settings(
        &self,
        settings: &StoredWebDavSyncSettings,
    ) -> Result<WebDavConnection, String> {
        if !settings.enabled {
            return Err("请先启用并保存 WebDAV 同步设置".to_string());
        }
        let password = if self.secrets.has(WEBDAV_PASSWORD_SLOT)? {
            self.secrets.get(WEBDAV_PASSWORD_SLOT)?
        } else {
            String::new()
        };
        let connection = WebDavConnection {
            base_url: settings.base_url.clone(),
            username: settings.username.clone(),
            password,
            remote_root: normalize_remote_root(&settings.remote_root),
            profile: normalize_profile(&settings.profile),
        };
        connection.validate()?;
        Ok(connection)
    }

    fn open_database(&self) -> Result<Connection, String> {
        let connection = Connection::open(self.database_path.as_ref())
            .map_err(|error| format!("打开 Agent 渠道数据库失败: {error}"))?;
        initialize_channel_database(&connection)?;
        Ok(connection)
    }

    fn record_sync_outcome(
        &self,
        mutate: impl FnOnce(&mut StoredWebDavSyncSettings),
    ) -> Result<(), String> {
        let mut settings = self.read_settings();
        mutate(&mut settings);
        settings.updated_at = sync_timestamp();
        self.write_settings(&settings)
    }

    pub(crate) async fn test_connection<T: WebDavTransport>(
        &self,
        connection: &WebDavConnection,
        transport: &T,
    ) -> WebDavTestResult {
        let started = Instant::now();
        let result = async {
            connection.validate()?;
            ensure_collection(transport, &connection.profile_directory()).await?;
            if !transport.propfind(&connection.profile_directory()).await? {
                return Err("远端目录创建后仍不可见，请检查服务地址".to_string());
            }
            Ok(())
        }
        .await;
        match result {
            Ok(()) => WebDavTestResult {
                ok: true,
                message: "WebDAV 连接成功".to_string(),
                latency_ms: started.elapsed().as_millis() as u64,
            },
            Err(message) => WebDavTestResult {
                ok: false,
                message,
                latency_ms: started.elapsed().as_millis() as u64,
            },
        }
    }

    pub(crate) async fn remote_info<T: WebDavTransport>(
        &self,
        connection: &WebDavConnection,
        transport: &T,
    ) -> Result<WebDavRemoteInfo, String> {
        connection.validate()?;
        let empty_info = |reason: Option<String>| WebDavRemoteInfo {
            exists: true,
            compatible: false,
            reason,
            snapshot_id: None,
            device_name: None,
            created_at: None,
            channel_count: None,
            model_count: None,
            has_secrets: None,
            data_size: None,
        };
        let Some(manifest_bytes) = transport
            .get(&connection.file_path(MANIFEST_FILE), MANIFEST_MAX_BYTES)
            .await?
        else {
            return Ok(WebDavRemoteInfo {
                exists: false,
                compatible: false,
                reason: None,
                snapshot_id: None,
                device_name: None,
                created_at: None,
                channel_count: None,
                model_count: None,
                has_secrets: None,
                data_size: None,
            });
        };
        let manifest: SyncManifest = serde_json::from_slice(&manifest_bytes)
            .map_err(|_| "远端 manifest.json 格式无效".to_string())?;
        if manifest.format != SYNC_FORMAT {
            return Ok(empty_info(Some(format!(
                "远端快照格式为 {}，不是 CodeM 渠道同步快照",
                manifest.format
            ))));
        }
        if manifest.protocol_version != SYNC_PROTOCOL_VERSION {
            return Ok(empty_info(Some(format!(
                "远端快照协议版本 {} 与当前支持版本 {SYNC_PROTOCOL_VERSION} 不一致",
                manifest.protocol_version
            ))));
        }
        let data_size = manifest.artifacts.get(DATA_FILE).map(|meta| meta.size);
        Ok(WebDavRemoteInfo {
            exists: true,
            compatible: true,
            reason: None,
            snapshot_id: Some(manifest.snapshot_id),
            device_name: Some(manifest.device_name),
            created_at: Some(manifest.created_at),
            channel_count: Some(manifest.channel_count),
            model_count: Some(manifest.model_count),
            has_secrets: Some(manifest.has_secrets),
            data_size,
        })
    }

    pub(crate) async fn upload<T: WebDavTransport>(
        &self,
        connection: &WebDavConnection,
        transport: &T,
        sync_password: &str,
    ) -> Result<WebDavSyncResult, String> {
        let _guard = self
            .lock
            .try_lock()
            .map_err(|_| SYNC_LOCK_MESSAGE.to_string())?;
        let result = self
            .upload_locked(connection, transport, sync_password)
            .await;
        match &result {
            Ok(summary) => {
                let snapshot_id = summary.snapshot_id.clone();
                let synced_at = summary.synced_at.clone();
                let _ = self.record_sync_outcome(|settings| {
                    settings.last_sync_at = Some(synced_at);
                    settings.last_snapshot_id = Some(snapshot_id);
                    settings.last_remote_device = Some(device_name());
                    settings.last_error = None;
                });
            }
            Err(message) => {
                let _ = self
                    .record_sync_outcome(|settings| settings.last_error = Some(message.clone()));
            }
        }
        result
    }

    async fn upload_locked<T: WebDavTransport>(
        &self,
        connection: &WebDavConnection,
        transport: &T,
        sync_password: &str,
    ) -> Result<WebDavSyncResult, String> {
        connection.validate()?;
        let database = self.open_database()?;
        let document = load_sync_channels(&database)?;
        let mut secrets = self.secrets.entries_with_prefix(CHANNEL_SECRET_PREFIX)?;
        let channel_slots: HashSet<String> = document
            .channels
            .iter()
            .map(|channel| channel.secret_slot.clone())
            .collect();
        secrets.retain(|slot, _| channel_slots.contains(slot));
        let data_bytes = serde_json::to_vec(&document)
            .map_err(|error| format!("序列化渠道数据失败: {error}"))?;
        let data_sha256 = sha256_hex(&data_bytes);
        let model_count: usize = document.channels.iter().map(|c| c.models.len()).sum();
        let has_secrets = !secrets.is_empty();
        if has_secrets && sync_password.trim().is_empty() {
            return Err("本机渠道已保存 API Key，上传前必须输入同步主密码用于加密".to_string());
        }
        let snapshot_id = uuid::Uuid::new_v4().to_string();
        let secrets_bytes = if has_secrets {
            Some(seal_sync_secrets(
                sync_password,
                &snapshot_id,
                &data_sha256,
                &secrets,
            )?)
        } else {
            None
        };
        let mut artifacts = BTreeMap::new();
        artifacts.insert(
            DATA_FILE.to_string(),
            SyncArtifactMeta {
                sha256: data_sha256.clone(),
                size: data_bytes.len() as u64,
            },
        );
        if let Some(bytes) = secrets_bytes.as_ref() {
            artifacts.insert(
                SECRETS_FILE.to_string(),
                SyncArtifactMeta {
                    sha256: sha256_hex(bytes),
                    size: bytes.len() as u64,
                },
            );
        }
        let manifest = SyncManifest {
            format: SYNC_FORMAT.to_string(),
            protocol_version: SYNC_PROTOCOL_VERSION,
            snapshot_id: snapshot_id.clone(),
            device_name: device_name(),
            created_at: sync_timestamp(),
            channel_count: document.channels.len(),
            model_count,
            has_secrets,
            artifacts,
        };
        let manifest_bytes = serde_json::to_vec(&manifest)
            .map_err(|error| format!("序列化 manifest 失败: {error}"))?;
        ensure_collection(transport, &connection.profile_directory()).await?;
        transport
            .put(
                &connection.file_path(DATA_FILE),
                &data_bytes,
                "application/json",
            )
            .await?;
        if let Some(bytes) = secrets_bytes.as_ref() {
            transport
                .put(
                    &connection.file_path(SECRETS_FILE),
                    bytes,
                    "application/octet-stream",
                )
                .await?;
        }
        // manifest 必须最后上传，远端只会在快照完整后指向新版本
        transport
            .put(
                &connection.file_path(MANIFEST_FILE),
                &manifest_bytes,
                "application/json",
            )
            .await?;
        Ok(WebDavSyncResult {
            direction: "upload",
            snapshot_id,
            synced_at: sync_timestamp(),
            channel_count: document.channels.len(),
            model_count,
            secret_count: secrets.len(),
            data_size: data_bytes.len() as u64,
            backup_dir: None,
        })
    }

    pub(crate) async fn download<T: WebDavTransport>(
        &self,
        connection: &WebDavConnection,
        transport: &T,
        sync_password: &str,
    ) -> Result<WebDavSyncResult, String> {
        let _guard = self
            .lock
            .try_lock()
            .map_err(|_| SYNC_LOCK_MESSAGE.to_string())?;
        let result = self
            .download_locked(connection, transport, sync_password)
            .await;
        match &result {
            Ok(summary) => {
                let snapshot_id = summary.snapshot_id.clone();
                let synced_at = summary.synced_at.clone();
                let _ = self.record_sync_outcome(|settings| {
                    settings.last_sync_at = Some(synced_at);
                    settings.last_snapshot_id = Some(snapshot_id);
                    settings.last_remote_device = None;
                    settings.last_error = None;
                });
            }
            Err(message) => {
                let _ = self
                    .record_sync_outcome(|settings| settings.last_error = Some(message.clone()));
            }
        }
        result
    }

    async fn download_locked<T: WebDavTransport>(
        &self,
        connection: &WebDavConnection,
        transport: &T,
        sync_password: &str,
    ) -> Result<WebDavSyncResult, String> {
        connection.validate()?;
        let manifest_bytes = transport
            .get(&connection.file_path(MANIFEST_FILE), MANIFEST_MAX_BYTES)
            .await?
            .ok_or_else(|| "远端没有可下载的渠道快照".to_string())?;
        let manifest: SyncManifest = serde_json::from_slice(&manifest_bytes)
            .map_err(|_| "远端 manifest.json 格式无效".to_string())?;
        if manifest.format != SYNC_FORMAT {
            return Err(format!(
                "远端快照格式 {} 不兼容，只有 CodeM 渠道同步快照可以导入",
                manifest.format
            ));
        }
        if manifest.protocol_version != SYNC_PROTOCOL_VERSION {
            return Err(format!(
                "远端快照协议版本 {} 与当前支持版本 {SYNC_PROTOCOL_VERSION} 不一致",
                manifest.protocol_version
            ));
        }
        let data_meta = manifest
            .artifacts
            .get(DATA_FILE)
            .ok_or_else(|| "远端 manifest 缺少 data.json 记录".to_string())?;
        let max_data_bytes = DATA_MAX_BYTES.min(data_meta.size as usize + 1);
        let data_bytes = transport
            .get(&connection.file_path(DATA_FILE), max_data_bytes)
            .await?
            .ok_or_else(|| "远端 data.json 不存在".to_string())?;
        if data_bytes.len() as u64 != data_meta.size || sha256_hex(&data_bytes) != data_meta.sha256
        {
            return Err("远端 data.json 校验失败（大小或哈希不匹配）".to_string());
        }
        let document: SyncDataDocument = serde_json::from_slice(&data_bytes)
            .map_err(|_| "远端 data.json 格式无效".to_string())?;
        validate_data_document(&document)?;
        let data_sha256 = sha256_hex(&data_bytes);
        let mut secrets = BTreeMap::new();
        if manifest.has_secrets {
            if sync_password.trim().is_empty() {
                return Err("远端快照包含加密密钥，下载前必须输入同步主密码".to_string());
            }
            let secrets_meta = manifest
                .artifacts
                .get(SECRETS_FILE)
                .ok_or_else(|| "远端 manifest 声明包含密钥但缺少 secrets.enc 记录".to_string())?;
            let max_secrets_bytes = SECRETS_MAX_BYTES.min(secrets_meta.size as usize + 1);
            let secrets_bytes = transport
                .get(&connection.file_path(SECRETS_FILE), max_secrets_bytes)
                .await?
                .ok_or_else(|| "远端 secrets.enc 不存在".to_string())?;
            if secrets_bytes.len() as u64 != secrets_meta.size
                || sha256_hex(&secrets_bytes) != secrets_meta.sha256
            {
                return Err("远端 secrets.enc 校验失败（大小或哈希不匹配）".to_string());
            }
            let plaintext = open_sync_secrets(
                sync_password,
                &manifest.snapshot_id,
                &data_sha256,
                &secrets_bytes,
            )?;
            let channel_slots: HashSet<&str> = document
                .channels
                .iter()
                .map(|channel| channel.secret_slot.as_str())
                .collect();
            secrets = plaintext
                .secrets
                .into_iter()
                .filter(|(slot, _)| channel_slots.contains(slot.as_str()))
                .collect();
        }
        let backup_dir = create_channel_sync_backup(&self.app_data_dir)?;
        let mut database = self.open_database()?;
        self.secrets
            .replace_prefix_with_rollback(CHANNEL_SECRET_PREFIX, &secrets, || {
                insert_sync_channels(&mut database, &document)
            })
            .map_err(|error| {
                if error.contains("恢复原 API Key 数据失败") {
                    format!("{error}。可从 {} 手动恢复", backup_dir.to_string_lossy())
                } else {
                    error
                }
            })?;
        let model_count: usize = document.channels.iter().map(|c| c.models.len()).sum();
        Ok(WebDavSyncResult {
            direction: "download",
            snapshot_id: manifest.snapshot_id,
            synced_at: sync_timestamp(),
            channel_count: document.channels.len(),
            model_count,
            secret_count: secrets.len(),
            data_size: data_bytes.len() as u64,
            backup_dir: Some(backup_dir.to_string_lossy().into_owned()),
        })
    }
}

// ===================== HTTP 路由 =====================

struct SyncApiError {
    status: StatusCode,
    message: String,
}

impl SyncApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
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

impl IntoResponse for SyncApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncPasswordRequest {
    #[serde(default)]
    sync_password: Option<String>,
}

pub(crate) fn router(service: WebDavSyncService) -> Router {
    Router::new()
        .route(
            "/api/sync/webdav/settings",
            get(get_sync_settings).put(save_sync_settings),
        )
        .route("/api/sync/webdav/test", post(test_sync_connection))
        .route("/api/sync/webdav/remote-info", get(sync_remote_info))
        .route("/api/sync/webdav/upload", post(upload_sync_snapshot))
        .route("/api/sync/webdav/download", post(download_sync_snapshot))
        .with_state(service)
}

fn normalize_remote_root(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        DEFAULT_REMOTE_ROOT.to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_profile(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        DEFAULT_PROFILE.to_string()
    } else {
        trimmed.to_string()
    }
}

fn connection_for_input(
    service: &WebDavSyncService,
    input: Option<&WebDavSettingsInput>,
) -> Result<WebDavConnection, String> {
    let Some(payload) = input else {
        return service.connection_from_settings(&service.read_settings());
    };
    // 未在表单里修改密码时回退到已保存密码；修改过则以表单为准
    let mut password = payload
        .password
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .to_string();
    if payload.password.is_none() && service.secrets.has(WEBDAV_PASSWORD_SLOT)? {
        password = service.secrets.get(WEBDAV_PASSWORD_SLOT)?;
    }
    let connection = WebDavConnection {
        base_url: payload.base_url.trim().to_string(),
        username: payload
            .username
            .clone()
            .unwrap_or_default()
            .trim()
            .to_string(),
        password,
        remote_root: normalize_remote_root(&payload.remote_root),
        profile: normalize_profile(&payload.profile),
    };
    connection.validate()?;
    Ok(connection)
}

async fn get_sync_settings(
    State(service): State<WebDavSyncService>,
) -> Json<WebDavSyncSettingsResponse> {
    let settings = service.read_settings();
    Json(service.settings_response(&settings))
}

async fn save_sync_settings(
    State(service): State<WebDavSyncService>,
    Json(payload): Json<WebDavSettingsInput>,
) -> Result<Json<WebDavSyncSettingsResponse>, SyncApiError> {
    let mut settings = service.read_settings();
    settings.enabled = payload.enabled;
    settings.base_url = payload.base_url.trim().to_string();
    settings.username = payload
        .username
        .clone()
        .unwrap_or_default()
        .trim()
        .to_string();
    settings.remote_root = normalize_remote_root(&payload.remote_root);
    settings.profile = normalize_profile(&payload.profile);
    if payload.enabled {
        WebDavConnection {
            base_url: settings.base_url.clone(),
            username: settings.username.clone(),
            password: String::new(),
            remote_root: settings.remote_root.clone(),
            profile: settings.profile.clone(),
        }
        .validate()
        .map_err(SyncApiError::bad_request)?;
    }
    if payload.password_touched {
        let password = payload
            .password
            .as_deref()
            .map(str::trim)
            .unwrap_or_default();
        if password.is_empty() {
            service
                .secrets
                .delete(WEBDAV_PASSWORD_SLOT)
                .map_err(SyncApiError::internal)?;
        } else {
            service
                .secrets
                .set(WEBDAV_PASSWORD_SLOT, password)
                .map_err(SyncApiError::internal)?;
        }
    }
    settings.updated_at = sync_timestamp();
    service
        .write_settings(&settings)
        .map_err(SyncApiError::internal)?;
    Ok(Json(service.settings_response(&settings)))
}

async fn test_sync_connection(
    State(service): State<WebDavSyncService>,
    Json(payload): Json<Option<WebDavSettingsInput>>,
) -> Result<Json<WebDavTestResult>, SyncApiError> {
    let connection =
        connection_for_input(&service, payload.as_ref()).map_err(SyncApiError::bad_request)?;
    let transport = ReqwestWebDavTransport::new(&connection).map_err(SyncApiError::bad_request)?;
    Ok(Json(service.test_connection(&connection, &transport).await))
}

async fn sync_remote_info(
    State(service): State<WebDavSyncService>,
) -> Result<Json<WebDavRemoteInfo>, SyncApiError> {
    let settings = service.read_settings();
    let connection = service
        .connection_from_settings(&settings)
        .map_err(SyncApiError::bad_request)?;
    let transport = ReqwestWebDavTransport::new(&connection).map_err(SyncApiError::bad_request)?;
    let info = service
        .remote_info(&connection, &transport)
        .await
        .map_err(SyncApiError::internal)?;
    Ok(Json(info))
}

async fn upload_sync_snapshot(
    State(service): State<WebDavSyncService>,
    Json(payload): Json<SyncPasswordRequest>,
) -> Result<Json<WebDavSyncResult>, SyncApiError> {
    let settings = service.read_settings();
    let connection = service
        .connection_from_settings(&settings)
        .map_err(SyncApiError::bad_request)?;
    let transport = ReqwestWebDavTransport::new(&connection).map_err(SyncApiError::bad_request)?;
    let sync_password = payload.sync_password.as_deref().unwrap_or_default();
    Ok(Json(
        service
            .upload(&connection, &transport, sync_password)
            .await
            .map_err(SyncApiError::internal)?,
    ))
}

async fn download_sync_snapshot(
    State(service): State<WebDavSyncService>,
    Json(payload): Json<SyncPasswordRequest>,
) -> Result<Json<WebDavSyncResult>, SyncApiError> {
    let settings = service.read_settings();
    let connection = service
        .connection_from_settings(&settings)
        .map_err(SyncApiError::bad_request)?;
    let transport = ReqwestWebDavTransport::new(&connection).map_err(SyncApiError::bad_request)?;
    let sync_password = payload.sync_password.as_deref().unwrap_or_default();
    Ok(Json(
        service
            .download(&connection, &transport, sync_password)
            .await
            .map_err(SyncApiError::internal)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ordinary_chat::types::AiProtocol;
    use std::collections::HashMap;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("codem-{label}-{}", uuid::Uuid::new_v4().simple()));
            fs::create_dir_all(&path).expect("create test directory");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[derive(Default)]
    struct RecordingTransport {
        files: std::sync::Mutex<HashMap<String, Vec<u8>>>,
        collections: std::sync::Mutex<HashSet<String>>,
        operations: std::sync::Mutex<Vec<String>>,
    }

    impl RecordingTransport {
        fn put_raw(&self, key: &str, bytes: Vec<u8>) {
            self.files.lock().unwrap().insert(key.to_string(), bytes);
        }

        fn operations_snapshot(&self) -> Vec<String> {
            self.operations.lock().unwrap().clone()
        }
    }

    impl WebDavTransport for RecordingTransport {
        async fn propfind(&self, path: &[String]) -> Result<bool, String> {
            let key = path.join("/");
            self.operations
                .lock()
                .unwrap()
                .push(format!("PROPFIND {key}"));
            Ok(self.collections.lock().unwrap().contains(&key))
        }

        async fn mkcol(&self, path: &[String]) -> Result<(), String> {
            let key = path.join("/");
            self.operations.lock().unwrap().push(format!("MKCOL {key}"));
            self.collections.lock().unwrap().insert(key);
            Ok(())
        }

        async fn put(
            &self,
            path: &[String],
            bytes: &[u8],
            _content_type: &str,
        ) -> Result<(), String> {
            let name = path.last().cloned().unwrap_or_default();
            self.operations.lock().unwrap().push(format!("PUT {name}"));
            self.files
                .lock()
                .unwrap()
                .insert(path.join("/"), bytes.to_vec());
            Ok(())
        }

        async fn get(&self, path: &[String], _max_bytes: usize) -> Result<Option<Vec<u8>>, String> {
            let name = path.last().cloned().unwrap_or_default();
            self.operations.lock().unwrap().push(format!("GET {name}"));
            Ok(self.files.lock().unwrap().get(&path.join("/")).cloned())
        }
    }

    fn test_connection() -> WebDavConnection {
        WebDavConnection {
            base_url: "https://dav.example.test/remote.php/dav/files/user".to_string(),
            username: "codem".to_string(),
            password: "dav-password".to_string(),
            remote_root: DEFAULT_REMOTE_ROOT.to_string(),
            profile: DEFAULT_PROFILE.to_string(),
        }
    }

    fn seed_channel(
        connection: &Connection,
        id: &str,
        provider_id: &str,
        protocol: &str,
        name: &str,
        is_default: bool,
        models: &[(&str, &str)],
    ) -> String {
        let slot = format!("{CHANNEL_SECRET_PREFIX}{id}");
        connection
            .execute(
                r#"INSERT INTO agent_channels (
                    id, provider_id, name, protocol, base_url, models_url, template_id, enabled,
                    is_default, secret_slot, created_at, updated_at
                  ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 1, ?, ?, '2026-08-15T00:00:00Z', '2026-08-15T00:00:00Z')"#,
                params![id, provider_id, name, protocol, "https://api.example.test/v1", is_default, slot],
            )
            .expect("seed channel");
        for (index, (model_id, display_name)) in models.iter().enumerate() {
            connection
                .execute(
                    r#"INSERT INTO agent_channel_models (
                        id, channel_id, model_id, display_name, enabled, is_default,
                        capabilities_json, created_at, updated_at
                      ) VALUES (?, ?, ?, ?, 1, ?, '{}', '2026-08-15T00:00:00Z', '2026-08-15T00:00:00Z')"#,
                    params![
                        format!("{id}-model-{index}"),
                        id,
                        model_id,
                        display_name,
                        index == 0,
                    ],
                )
                .expect("seed model");
        }
        slot
    }

    fn channel_rows(connection: &Connection) -> Vec<(String, String, i64)> {
        let mut statement = connection
            .prepare("SELECT name, id, is_default FROM agent_channels ORDER BY name")
            .unwrap();
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        rows
    }

    fn model_count(connection: &Connection, channel_id: &str) -> usize {
        connection
            .query_row(
                "SELECT COUNT(*) FROM agent_channel_models WHERE channel_id = ?",
                params![channel_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap() as usize
    }

    #[tokio::test]
    async fn channel_snapshot_roundtrip_with_secrets() {
        let source = TestDirectory::new("webdav-source");
        let source_secrets = SecretStore::new(source.0.clone());
        let source_service = WebDavSyncService::new(source.0.clone(), source_secrets.clone());
        {
            let connection = source_service.open_database().unwrap();
            let slot = seed_channel(
                &connection,
                "channel-a",
                CLAUDE_CODE_PROVIDER_ID,
                AiProtocol::AnthropicMessages.as_str(),
                "主力渠道",
                true,
                &[("model-x", "模型 X"), ("model-y", "模型 Y")],
            );
            seed_channel(
                &connection,
                "channel-b",
                OPENAI_CODEX_PROVIDER_ID,
                AiProtocol::OpenaiResponses.as_str(),
                "Codex 渠道",
                false,
                &[("codex-model", "Codex 模型")],
            );
            source_secrets.set(&slot, "sk-channel-a-key").unwrap();
        }

        let transport = RecordingTransport::default();
        let connection = test_connection();
        source_service
            .upload(&connection, &transport, "master-pass-1234")
            .await
            .expect("upload should succeed");

        let profile_key = connection.file_path(DATA_FILE).join("/");
        assert!(transport.files.lock().unwrap().contains_key(&profile_key));
        let operations = transport.operations_snapshot();
        let manifest_index = operations
            .iter()
            .position(|op| op == "PUT manifest.json")
            .expect("manifest should be uploaded");
        let data_index = operations
            .iter()
            .position(|op| op == "PUT data.json")
            .expect("data should be uploaded");
        let secrets_index = operations
            .iter()
            .position(|op| op == "PUT secrets.enc")
            .expect("secrets should be uploaded");
        assert!(manifest_index > data_index);
        assert!(manifest_index > secrets_index);
        // 远端密文不包含明文密钥
        let secrets_bytes = transport
            .files
            .lock()
            .unwrap()
            .get(&connection.file_path(SECRETS_FILE).join("/"))
            .cloned()
            .unwrap();
        assert!(!String::from_utf8_lossy(&secrets_bytes).contains("sk-channel-a-key"));

        let target = TestDirectory::new("webdav-target");
        let target_secrets = SecretStore::new(target.0.clone());
        let target_service = WebDavSyncService::new(target.0.clone(), target_secrets.clone());
        {
            let target_database = target_service.open_database().unwrap();
            let stale_slot = seed_channel(
                &target_database,
                "channel-old",
                CLAUDE_CODE_PROVIDER_ID,
                AiProtocol::AnthropicMessages.as_str(),
                "旧渠道",
                true,
                &[("old-model", "旧模型")],
            );
            target_secrets.set(&stale_slot, "sk-stale").unwrap();
        }

        let result = target_service
            .download(&connection, &transport, "master-pass-1234")
            .await
            .expect("download should succeed");
        assert_eq!(result.channel_count, 2);
        assert_eq!(result.model_count, 3);
        assert_eq!(result.secret_count, 1);

        {
            let target_database = target_service.open_database().unwrap();
            let rows = channel_rows(&target_database);
            assert_eq!(
                rows,
                vec![
                    ("Codex 渠道".to_string(), "channel-b".to_string(), 0),
                    ("主力渠道".to_string(), "channel-a".to_string(), 1),
                ]
            );
            assert_eq!(model_count(&target_database, "channel-a"), 2);
            assert_eq!(
                target_secrets
                    .get(&format!("{CHANNEL_SECRET_PREFIX}channel-a"))
                    .unwrap(),
                "sk-channel-a-key"
            );
            assert!(!target_secrets
                .has(&format!("{CHANNEL_SECRET_PREFIX}channel-old"))
                .unwrap());
            let backup_dir = target.0.join("backups").join("channel-sync").join("latest");
            assert!(backup_dir.join("codem.sqlite").exists());
            assert!(backup_dir.join("ai-secrets.enc").exists());
        }
    }

    #[test]
    fn settings_write_replaces_existing_file() {
        let directory = TestDirectory::new("webdav-settings-replace");
        let service =
            WebDavSyncService::new(directory.0.clone(), SecretStore::new(directory.0.clone()));
        let mut settings = StoredWebDavSyncSettings {
            enabled: true,
            base_url: "https://dav.example.test/first".to_string(),
            ..StoredWebDavSyncSettings::default()
        };
        service.write_settings(&settings).unwrap();
        settings.base_url = "https://dav.example.test/second".to_string();
        service.write_settings(&settings).unwrap();

        assert_eq!(service.read_settings().base_url, settings.base_url);
        assert!(!service.settings_path().with_extension("json.bak").exists());
    }

    #[test]
    fn import_fully_clears_threads_for_removed_channels() {
        let directory = TestDirectory::new("webdav-orphaned-thread");
        let service =
            WebDavSyncService::new(directory.0.clone(), SecretStore::new(directory.0.clone()));
        let mut connection = service.open_database().unwrap();
        seed_channel(
            &connection,
            "channel-old",
            CLAUDE_CODE_PROVIDER_ID,
            AiProtocol::AnthropicMessages.as_str(),
            "旧渠道",
            true,
            &[("old-model", "旧模型")],
        );
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
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE thread_model_preferences (
                  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
                  model_id TEXT NOT NULL,
                  reasoning_effort TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (thread_id, model_id)
                );
                INSERT INTO threads VALUES (
                  'thread-old', 'session-old', 'transcript-old', 'old-model', 'high',
                  'channel-old', 'fingerprint-old', '2026-08-15T00:00:00Z'
                );
                INSERT INTO thread_model_preferences VALUES (
                  'thread-old', 'old-model', 'high', '2026-08-15T00:00:00Z'
                );
                "#,
            )
            .unwrap();
        let document = SyncDataDocument {
            version: SYNC_PROTOCOL_VERSION,
            exported_at: sync_timestamp(),
            channels: Vec::new(),
        };

        insert_sync_channels(&mut connection, &document).unwrap();

        let cleared = connection
            .query_row(
                r#"SELECT session_id, transcript_path, model, reasoning_effort,
                          agent_channel_id, agent_channel_fingerprint
                   FROM threads WHERE id = 'thread-old'"#,
                [],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(cleared, (None, None, None, None, None, None));
        let preference_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM thread_model_preferences", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(preference_count, 0);
    }

    #[tokio::test]
    async fn failed_database_import_restores_previous_channel_secrets() {
        let source = TestDirectory::new("webdav-rollback-source");
        let source_secrets = SecretStore::new(source.0.clone());
        let source_service = WebDavSyncService::new(source.0.clone(), source_secrets.clone());
        {
            let connection = source_service.open_database().unwrap();
            let slot = seed_channel(
                &connection,
                "channel-new",
                CLAUDE_CODE_PROVIDER_ID,
                AiProtocol::AnthropicMessages.as_str(),
                "新渠道",
                true,
                &[("new-model", "新模型")],
            );
            source_secrets.set(&slot, "sk-new").unwrap();
        }
        let transport = RecordingTransport::default();
        source_service
            .upload(&test_connection(), &transport, "master-pass-1234")
            .await
            .unwrap();

        let target = TestDirectory::new("webdav-rollback-target");
        let target_secrets = SecretStore::new(target.0.clone());
        let target_service = WebDavSyncService::new(target.0.clone(), target_secrets.clone());
        let old_slot;
        {
            let connection = target_service.open_database().unwrap();
            old_slot = seed_channel(
                &connection,
                "channel-old",
                CLAUDE_CODE_PROVIDER_ID,
                AiProtocol::AnthropicMessages.as_str(),
                "旧渠道",
                true,
                &[("old-model", "旧模型")],
            );
            connection
                .execute_batch(
                    r#"CREATE TRIGGER reject_channel_import
                       BEFORE INSERT ON agent_channels
                       BEGIN
                         SELECT RAISE(ABORT, 'forced import failure');
                       END;"#,
                )
                .unwrap();
            target_secrets.set(&old_slot, "sk-old").unwrap();
        }

        let error = target_service
            .download(&test_connection(), &transport, "master-pass-1234")
            .await
            .expect_err("database import should fail");
        assert!(error.contains("forced import failure"));
        assert_eq!(target_secrets.get(&old_slot).unwrap(), "sk-old");
        assert!(!target_secrets
            .has(&format!("{CHANNEL_SECRET_PREFIX}channel-new"))
            .unwrap());
        let connection = target_service.open_database().unwrap();
        assert_eq!(
            channel_rows(&connection),
            vec![("旧渠道".to_string(), "channel-old".to_string(), 1)]
        );
    }

    #[tokio::test]
    async fn upload_without_secrets_skips_encrypted_file() {
        let directory = TestDirectory::new("webdav-no-secrets");
        let secrets = SecretStore::new(directory.0.clone());
        let service = WebDavSyncService::new(directory.0.clone(), secrets);
        {
            let connection = service.open_database().unwrap();
            seed_channel(
                &connection,
                "channel-clean",
                CLAUDE_CODE_PROVIDER_ID,
                AiProtocol::AnthropicMessages.as_str(),
                "无密钥渠道",
                true,
                &[("model-a", "模型 A")],
            );
        }
        let transport = RecordingTransport::default();
        service
            .upload(&test_connection(), &transport, "")
            .await
            .expect("upload without secrets should not require master password");
        assert!(!transport
            .files
            .lock()
            .unwrap()
            .contains_key(&test_connection().file_path(SECRETS_FILE).join("/")));

        let target = TestDirectory::new("webdav-no-secrets-target");
        let target_service =
            WebDavSyncService::new(target.0.clone(), SecretStore::new(target.0.clone()));
        target_service
            .download(&test_connection(), &transport, "")
            .await
            .expect("download without secrets should not require master password");
        let connection = target_service.open_database().unwrap();
        assert_eq!(channel_rows(&connection).len(), 1);
    }

    #[tokio::test]
    async fn upload_requires_master_password_when_secrets_exist() {
        let directory = TestDirectory::new("webdav-need-password");
        let secrets = SecretStore::new(directory.0.clone());
        let service = WebDavSyncService::new(directory.0.clone(), secrets.clone());
        {
            let connection = service.open_database().unwrap();
            let slot = seed_channel(
                &connection,
                "channel-keyed",
                CLAUDE_CODE_PROVIDER_ID,
                AiProtocol::AnthropicMessages.as_str(),
                "带密钥渠道",
                true,
                &[("model-a", "模型 A")],
            );
            secrets.set(&slot, "sk-keyed").unwrap();
        }
        let transport = RecordingTransport::default();
        let error = service
            .upload(&test_connection(), &transport, "")
            .await
            .expect_err("upload should require master password");
        assert!(error.contains("同步主密码"));
    }

    #[tokio::test]
    async fn download_rejects_wrong_master_password() {
        let directory = TestDirectory::new("webdav-wrong-password");
        let secrets = SecretStore::new(directory.0.clone());
        let service = WebDavSyncService::new(directory.0.clone(), secrets.clone());
        {
            let connection = service.open_database().unwrap();
            let slot = seed_channel(
                &connection,
                "channel-a",
                CLAUDE_CODE_PROVIDER_ID,
                AiProtocol::AnthropicMessages.as_str(),
                "渠道",
                true,
                &[("model-a", "模型 A")],
            );
            secrets.set(&slot, "sk-key").unwrap();
        }
        let transport = RecordingTransport::default();
        service
            .upload(&test_connection(), &transport, "master-pass-1234")
            .await
            .unwrap();
        let error = service
            .download(&test_connection(), &transport, "wrong-password")
            .await
            .expect_err("wrong password should fail");
        assert!(error.contains("同步主密码不正确"));
    }

    #[tokio::test]
    async fn download_rejects_tampered_remote_data() {
        let directory = TestDirectory::new("webdav-tampered");
        let secrets = SecretStore::new(directory.0.clone());
        let service = WebDavSyncService::new(directory.0.clone(), secrets);
        {
            let connection = service.open_database().unwrap();
            seed_channel(
                &connection,
                "channel-a",
                CLAUDE_CODE_PROVIDER_ID,
                AiProtocol::AnthropicMessages.as_str(),
                "渠道",
                true,
                &[("model-a", "模型 A")],
            );
        }
        let transport = RecordingTransport::default();
        service
            .upload(&test_connection(), &transport, "")
            .await
            .unwrap();
        let key = test_connection().file_path(DATA_FILE).join("/");
        let mut bytes = transport.files.lock().unwrap().get(&key).cloned().unwrap();
        bytes.push(b' ');
        transport.put_raw(&key, bytes);

        let error = service
            .download(&test_connection(), &transport, "")
            .await
            .expect_err("tampered data should fail");
        assert!(error.contains("校验失败"));
    }

    #[tokio::test]
    async fn download_rejects_incompatible_manifest() {
        let directory = TestDirectory::new("webdav-incompatible");
        let service =
            WebDavSyncService::new(directory.0.clone(), SecretStore::new(directory.0.clone()));
        let transport = RecordingTransport::default();
        let manifest = SyncManifest {
            format: "other-sync-format".to_string(),
            protocol_version: SYNC_PROTOCOL_VERSION,
            snapshot_id: uuid::Uuid::new_v4().to_string(),
            device_name: "别家应用".to_string(),
            created_at: sync_timestamp(),
            channel_count: 0,
            model_count: 0,
            has_secrets: false,
            artifacts: BTreeMap::new(),
        };
        transport.put_raw(
            &test_connection().file_path(MANIFEST_FILE).join("/"),
            serde_json::to_vec(&manifest).unwrap(),
        );
        let error = service
            .download(&test_connection(), &transport, "")
            .await
            .expect_err("incompatible manifest should fail");
        assert!(error.contains("不兼容"));
    }

    #[tokio::test]
    async fn concurrent_sync_is_rejected() {
        let directory = TestDirectory::new("webdav-locked");
        let service =
            WebDavSyncService::new(directory.0.clone(), SecretStore::new(directory.0.clone()));
        let _guard = service.lock.lock().await;
        let transport = RecordingTransport::default();
        let error = service
            .upload(&test_connection(), &transport, "")
            .await
            .expect_err("locked sync should fail");
        assert_eq!(error, SYNC_LOCK_MESSAGE);
    }

    #[tokio::test]
    async fn seal_and_open_secrets_envelope_roundtrip() {
        let mut secrets = BTreeMap::new();
        secrets.insert("agent-channel:x".to_string(), "sk-value".to_string());
        let sealed = seal_sync_secrets("master-pass-1234", "snapshot-1", "data-hash", &secrets)
            .expect("seal should succeed");
        let opened =
            open_sync_secrets("master-pass-1234", "snapshot-1", "data-hash", &sealed).unwrap();
        assert_eq!(opened.secrets, secrets);
        let error = open_sync_secrets("wrong-pass-1234", "snapshot-1", "data-hash", &sealed)
            .expect_err("wrong password should fail");
        assert!(error.contains("同步主密码不正确"));
        let error = open_sync_secrets("master-pass-1234", "snapshot-2", "data-hash", &sealed)
            .expect_err("mismatched aad should fail");
        assert!(error.contains("同步主密码不正确"));
    }

    #[test]
    fn open_secrets_rejects_invalid_nonce_length_without_panicking() {
        let mut secrets = BTreeMap::new();
        secrets.insert("agent-channel:x".to_string(), "sk-value".to_string());
        let sealed = seal_sync_secrets("master-pass-1234", "snapshot-1", "data-hash", &secrets)
            .expect("seal should succeed");
        let mut envelope: SyncSecretsEnvelope = serde_json::from_slice(&sealed).unwrap();
        envelope.nonce = STANDARD.encode([0u8; 8]);
        let malformed = serde_json::to_vec(&envelope).unwrap();

        let error = open_sync_secrets("master-pass-1234", "snapshot-1", "data-hash", &malformed)
            .expect_err("invalid nonce length should fail cleanly");
        assert!(error.contains("nonce 长度无效"));
    }

    #[tokio::test]
    async fn seal_rejects_short_master_password() {
        let error = seal_sync_secrets("short", "snapshot-1", "data-hash", &BTreeMap::new())
            .expect_err("short password should fail");
        assert!(error.contains("至少需要 8 个字符"));
    }
}
