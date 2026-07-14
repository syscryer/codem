use super::types::{ProviderToolCall, ProviderToolDefinition};
use reqwest::{header::HeaderMap, Client};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, env, path::PathBuf, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    time::timeout,
};
use url::Url;

const MCP_PROTOCOL_VERSION: &str = "2025-03-26";
const MCP_REQUEST_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_TOOL_RESULT_CHARS: usize = 200_000;

pub(crate) struct McpToolRegistry {
    clients: Vec<McpClient>,
    routes: HashMap<String, ToolRoute>,
    definitions: Vec<ProviderToolDefinition>,
}

#[derive(Clone)]
struct ToolRoute {
    client_index: usize,
    server_id: String,
    raw_name: String,
}

pub(crate) struct McpToolResult {
    pub content: String,
    pub value: Value,
    pub is_error: bool,
}

enum McpClient {
    Stdio(Box<StdioMcpClient>),
    Http(Box<HttpMcpClient>),
}

struct StdioMcpClient {
    child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
    next_id: u64,
}

struct HttpMcpClient {
    client: Client,
    url: Url,
    headers: HeaderMap,
    session_id: Option<String>,
    next_id: u64,
}

enum ResolvedMcpConfig {
    Stdio {
        command: String,
        args: Vec<String>,
        env: HashMap<String, String>,
        cwd: Option<PathBuf>,
    },
    Http {
        url: Url,
        headers: HeaderMap,
    },
}

impl McpToolRegistry {
    pub(crate) async fn connect(server_ids: &[String]) -> Result<Self, String> {
        let mut clients = Vec::new();
        let mut routes = HashMap::new();
        let mut definitions = Vec::new();
        for server_id in server_ids {
            let resolved = crate::backend::resolve_mcp_server_config_value(server_id, None)?;
            let server_name = resolved
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(server_id)
                .to_string();
            let config = parse_config(
                resolved
                    .get("config")
                    .ok_or_else(|| format!("MCP 服务 {server_name} 配置为空"))?,
            )?;
            let mut client = McpClient::connect(config)
                .await
                .map_err(|error| format!("连接 MCP 服务 {server_name} 失败：{error}"))?;
            let tools = client
                .list_tools()
                .await
                .map_err(|error| format!("读取 MCP 服务 {server_name} 工具失败：{error}"))?;
            let client_index = clients.len();
            for tool in tools {
                let raw_name = tool
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| format!("MCP 服务 {server_name} 返回了无效工具名称"))?
                    .to_string();
                let alias = tool_alias(&server_name, &raw_name, &routes);
                let description = tool
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let input_schema = tool
                    .get("inputSchema")
                    .or_else(|| tool.get("input_schema"))
                    .cloned()
                    .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
                routes.insert(
                    alias.clone(),
                    ToolRoute {
                        client_index,
                        server_id: server_id.clone(),
                        raw_name,
                    },
                );
                definitions.push(ProviderToolDefinition {
                    name: alias,
                    description: if description.trim().is_empty() {
                        format!("来自 MCP 服务 {server_name}")
                    } else {
                        format!("来自 MCP 服务 {server_name}：{description}")
                    },
                    input_schema,
                });
            }
            clients.push(client);
        }
        Ok(Self {
            clients,
            routes,
            definitions,
        })
    }

    pub(crate) fn definitions(&self) -> &[ProviderToolDefinition] {
        &self.definitions
    }

    pub(crate) fn server_id_for(&self, tool_name: &str) -> Option<&str> {
        self.routes
            .get(tool_name)
            .map(|route| route.server_id.as_str())
    }

    pub(crate) async fn call(&mut self, call: &ProviderToolCall) -> Result<McpToolResult, String> {
        let route = self
            .routes
            .get(&call.name)
            .cloned()
            .ok_or_else(|| format!("模型请求了未启用的 MCP 工具：{}", call.name))?;
        let client = self
            .clients
            .get_mut(route.client_index)
            .ok_or_else(|| "MCP 工具路由已失效".to_string())?;
        let result = client
            .call_tool(&route.raw_name, call.arguments.clone())
            .await?;
        let value = sanitize_mcp_value(&result);
        let is_error = value
            .get("isError")
            .or_else(|| value.get("is_error"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        Ok(McpToolResult {
            content: tool_result_content(&value),
            value,
            is_error,
        })
    }

    pub(crate) async fn shutdown(&mut self) {
        for client in &mut self.clients {
            client.shutdown().await;
        }
    }
}

impl McpClient {
    async fn connect(config: ResolvedMcpConfig) -> Result<Self, String> {
        let mut client = match config {
            ResolvedMcpConfig::Stdio {
                command,
                args,
                env,
                cwd,
            } => Self::Stdio(Box::new(
                StdioMcpClient::spawn(&command, &args, &env, cwd).await?,
            )),
            ResolvedMcpConfig::Http { url, headers } => {
                Self::Http(Box::new(HttpMcpClient::new(url, headers)?))
            }
        };
        client.initialize().await?;
        Ok(client)
    }

    async fn initialize(&mut self) -> Result<(), String> {
        let result = self
            .request(
                "initialize",
                json!({
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": { "name": "CodeM ordinary chat", "version": env!("CARGO_PKG_VERSION") }
                }),
            )
            .await?;
        if result
            .get("protocolVersion")
            .and_then(Value::as_str)
            .is_none()
        {
            return Err("MCP initialize 响应缺少 protocolVersion".to_string());
        }
        self.notify("notifications/initialized", json!({})).await
    }

    async fn list_tools(&mut self) -> Result<Vec<Value>, String> {
        let result = self.request("tools/list", json!({})).await?;
        result
            .get("tools")
            .and_then(Value::as_array)
            .cloned()
            .ok_or_else(|| "MCP tools/list 响应缺少 tools".to_string())
    }

    async fn call_tool(&mut self, name: &str, arguments: Value) -> Result<Value, String> {
        self.request(
            "tools/call",
            json!({
                "name": name,
                "arguments": if arguments.is_object() { arguments } else { json!({}) }
            }),
        )
        .await
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        match self {
            Self::Stdio(client) => client.request(method, params).await,
            Self::Http(client) => client.request(method, params).await,
        }
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        match self {
            Self::Stdio(client) => client.notify(method, params).await,
            Self::Http(client) => client.notify(method, params).await,
        }
    }

    async fn shutdown(&mut self) {
        match self {
            Self::Stdio(client) => client.shutdown().await,
            Self::Http(_) => {}
        }
    }
}

impl StdioMcpClient {
    async fn spawn(
        command: &str,
        args: &[String],
        configured_env: &HashMap<String, String>,
        cwd: Option<PathBuf>,
    ) -> Result<Self, String> {
        let mut process = Command::new(command);
        process
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(cwd) = cwd {
            process.current_dir(cwd);
        }
        for (key, value) in configured_env {
            process.env(key, value);
        }
        let mut child = process
            .spawn()
            .map_err(|error| format!("无法启动 MCP 进程：{error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "MCP stdin 不可用".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "MCP stdout 不可用".to_string())?;
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(_)) = lines.next_line().await {}
            });
        }
        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout).lines(),
            next_id: 1,
        })
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        self.write(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await?;
        timeout(MCP_REQUEST_TIMEOUT, async {
            loop {
                let line = self
                    .stdout
                    .next_line()
                    .await
                    .map_err(|error| format!("读取 MCP 响应失败：{error}"))?
                    .ok_or_else(|| "MCP 进程提前退出".to_string())?;
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let value: Value = serde_json::from_str(line)
                    .map_err(|_| "MCP stdio 返回了非 JSON 内容".to_string())?;
                if value.get("id").and_then(Value::as_u64) != Some(id) {
                    continue;
                }
                return json_rpc_result(value);
            }
        })
        .await
        .map_err(|_| "MCP 请求超时".to_string())?
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.write(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
            .await
    }

    async fn write(&mut self, value: &Value) -> Result<(), String> {
        let mut payload =
            serde_json::to_vec(value).map_err(|error| format!("序列化 MCP 请求失败：{error}"))?;
        payload.push(b'\n');
        self.stdin
            .write_all(&payload)
            .await
            .map_err(|error| format!("写入 MCP 请求失败：{error}"))?;
        self.stdin
            .flush()
            .await
            .map_err(|error| format!("刷新 MCP 请求失败：{error}"))
    }

    async fn shutdown(&mut self) {
        let _ = self.child.start_kill();
        let _ = timeout(Duration::from_secs(2), self.child.wait()).await;
    }
}

impl HttpMcpClient {
    fn new(url: Url, headers: HeaderMap) -> Result<Self, String> {
        let client = Client::builder()
            .timeout(MCP_REQUEST_TIMEOUT)
            .build()
            .map_err(|error| format!("创建 MCP HTTP client 失败：{error}"))?;
        Ok(Self {
            client,
            url,
            headers,
            session_id: None,
            next_id: 1,
        })
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let value = self
            .post(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await?;
        let response = select_json_rpc_response(value, id)
            .ok_or_else(|| "MCP HTTP 响应没有匹配的 request id".to_string())?;
        json_rpc_result(response)
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        let _ = self
            .post(json!({ "jsonrpc": "2.0", "method": method, "params": params }))
            .await?;
        Ok(())
    }

    async fn post(&mut self, payload: Value) -> Result<Value, String> {
        let mut request = self
            .client
            .post(self.url.clone())
            .headers(self.headers.clone())
            .header("accept", "application/json, text/event-stream")
            .header("content-type", "application/json");
        if let Some(session_id) = &self.session_id {
            request = request.header("mcp-session-id", session_id);
        }
        let response = request
            .json(&payload)
            .send()
            .await
            .map_err(|error| format!("MCP HTTP 请求失败：{error}"))?;
        if let Some(session_id) = response
            .headers()
            .get("mcp-session-id")
            .and_then(|value| value.to_str().ok())
        {
            self.session_id = Some(session_id.to_string());
        }
        if response.status().as_u16() == 202 {
            return Ok(Value::Null);
        }
        if !response.status().is_success() {
            return Err(format!(
                "MCP HTTP 返回错误：HTTP {}",
                response.status().as_u16()
            ));
        }
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let body = response
            .text()
            .await
            .map_err(|error| format!("读取 MCP HTTP 响应失败：{error}"))?;
        if body.trim().is_empty() {
            return Ok(Value::Null);
        }
        if content_type.contains("text/event-stream") {
            let events = body
                .split("\n\n")
                .flat_map(|event| {
                    event
                        .lines()
                        .filter_map(|line| line.strip_prefix("data:"))
                        .map(str::trim)
                        .filter(|line| !line.is_empty())
                        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
                })
                .collect::<Vec<_>>();
            return Ok(Value::Array(events));
        }
        serde_json::from_str(&body).map_err(|_| "MCP HTTP 返回了非 JSON 内容".to_string())
    }
}

fn parse_config(value: &Value) -> Result<ResolvedMcpConfig, String> {
    if value
        .get("disabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err("所选 MCP 服务已禁用".to_string());
    }
    let transport = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if value.get("url").and_then(Value::as_str).is_some()
        || matches!(
            transport.as_str(),
            "http" | "sse" | "streamable-http" | "streamable_http"
        )
    {
        let url = value
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| "MCP HTTP 配置缺少 url".to_string())?;
        let url = Url::parse(url.trim()).map_err(|_| "MCP HTTP url 无效".to_string())?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err("MCP HTTP url 必须使用 http 或 https".to_string());
        }
        let mut headers = HeaderMap::new();
        let raw_headers = value
            .get("headers")
            .or_else(|| value.get("http_headers"))
            .and_then(Value::as_object);
        if let Some(raw_headers) = raw_headers {
            for (name, value) in raw_headers {
                let Some(value) = value.as_str() else {
                    continue;
                };
                let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
                    .map_err(|_| "MCP HTTP header 名称无效".to_string())?;
                let value = reqwest::header::HeaderValue::from_str(&expand_env(value))
                    .map_err(|_| "MCP HTTP header 值无效".to_string())?;
                headers.insert(name, value);
            }
        }
        if let Some(variable) = value.get("bearer_token_env_var").and_then(Value::as_str) {
            if let Ok(token) = env::var(variable) {
                let header = reqwest::header::HeaderValue::from_str(&format!("Bearer {token}"))
                    .map_err(|_| "MCP bearer token 无效".to_string())?;
                headers.insert(reqwest::header::AUTHORIZATION, header);
            }
        }
        return Ok(ResolvedMcpConfig::Http { url, headers });
    }

    let command = value
        .get("command")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "MCP stdio 配置缺少 command".to_string())?
        .to_string();
    let args = value
        .get("args")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(expand_env)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let mut configured_env = HashMap::new();
    if let Some(values) = value.get("env").and_then(Value::as_object) {
        for (key, value) in values {
            if let Some(value) = value.as_str() {
                configured_env.insert(key.clone(), expand_env(value));
            }
        }
    }
    for key in ["envPassthrough", "env_passthrough", "env_vars"] {
        if let Some(names) = value.get(key).and_then(Value::as_array) {
            for name in names.iter().filter_map(Value::as_str) {
                if let Ok(value) = env::var(name) {
                    configured_env.insert(name.to_string(), value);
                }
            }
        }
    }
    let cwd = value
        .get("cwd")
        .and_then(Value::as_str)
        .map(expand_env)
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from);
    Ok(ResolvedMcpConfig::Stdio {
        command: expand_env(&command),
        args,
        env: configured_env,
        cwd,
    })
}

fn json_rpc_result(value: Value) -> Result<Value, String> {
    if let Some(error) = value.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("MCP 工具调用失败");
        return Err(message.chars().take(500).collect());
    }
    value
        .get("result")
        .cloned()
        .ok_or_else(|| "MCP 响应缺少 result".to_string())
}

fn select_json_rpc_response(value: Value, id: u64) -> Option<Value> {
    match value {
        Value::Array(items) => items
            .into_iter()
            .find(|item| item.get("id").and_then(Value::as_u64) == Some(id)),
        value if value.get("id").and_then(Value::as_u64) == Some(id) => Some(value),
        _ => None,
    }
}

fn tool_alias(server_name: &str, tool_name: &str, routes: &HashMap<String, ToolRoute>) -> String {
    let server = sanitize_identifier(server_name, 16);
    let tool = sanitize_identifier(tool_name, 32);
    let mut alias = format!("mcp__{server}__{tool}");
    if routes.contains_key(&alias) || alias.len() > 64 {
        let digest = Sha256::digest(format!("{server_name}\0{tool_name}").as_bytes());
        let suffix = hex_prefix(&digest, 8);
        alias = format!(
            "mcp__{}__{}_{}",
            sanitize_identifier(server_name, 12),
            sanitize_identifier(tool_name, 26),
            suffix
        );
    }
    alias.chars().take(64).collect()
}

fn sanitize_identifier(value: &str, max: usize) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    let sanitized = sanitized.trim_matches('_');
    let value = if sanitized.is_empty() {
        "tool"
    } else {
        sanitized
    };
    value.chars().take(max).collect()
}

fn hex_prefix(bytes: &[u8], length: usize) -> String {
    bytes
        .iter()
        .flat_map(|byte| format!("{byte:02x}").chars().collect::<Vec<_>>())
        .take(length)
        .collect()
}

fn expand_env(value: &str) -> String {
    let mut output = String::new();
    let chars = value.chars().collect::<Vec<_>>();
    let mut index = 0usize;
    while index < chars.len() {
        if chars[index] == '$' && chars.get(index + 1) == Some(&'{') {
            if let Some(end) = chars[index + 2..]
                .iter()
                .position(|character| *character == '}')
            {
                let end = index + 2 + end;
                let name = chars[index + 2..end].iter().collect::<String>();
                output.push_str(&env::var(name).unwrap_or_default());
                index = end + 1;
                continue;
            }
        }
        output.push(chars[index]);
        index += 1;
    }
    output
}

fn sanitize_mcp_value(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut next = Map::new();
            for (key, value) in object {
                let lower = key.to_ascii_lowercase();
                if matches!(lower.as_str(), "data" | "blob" | "bytes" | "base64")
                    && value.as_str().map(str::len).unwrap_or_default() > 1024
                {
                    next.insert(key.clone(), Value::String("[二进制内容已省略]".to_string()));
                } else {
                    next.insert(key.clone(), sanitize_mcp_value(value));
                }
            }
            Value::Object(next)
        }
        Value::Array(items) => Value::Array(items.iter().map(sanitize_mcp_value).collect()),
        Value::String(text) if text.chars().count() > MAX_TOOL_RESULT_CHARS => Value::String(
            text.chars()
                .take(MAX_TOOL_RESULT_CHARS)
                .chain("\n[结果已截断]".chars())
                .collect(),
        ),
        value => value.clone(),
    }
}

fn tool_result_content(value: &Value) -> String {
    let mut parts = Vec::new();
    if let Some(content) = value.get("content").and_then(Value::as_array) {
        for item in content {
            match item.get("type").and_then(Value::as_str).unwrap_or_default() {
                "text" => {
                    if let Some(text) = item.get("text").and_then(Value::as_str) {
                        parts.push(text.to_string());
                    }
                }
                "image" => {
                    let mime = item
                        .get("mimeType")
                        .or_else(|| item.get("mime_type"))
                        .and_then(Value::as_str)
                        .unwrap_or("image");
                    parts.push(format!("[MCP 返回图片：{mime}，二进制内容未写入聊天历史]"));
                }
                "resource" => {
                    if let Some(text) = item.pointer("/resource/text").and_then(Value::as_str) {
                        parts.push(text.to_string());
                    } else {
                        parts.push(item.to_string());
                    }
                }
                _ => parts.push(item.to_string()),
            }
        }
    }
    let content = if parts.is_empty() {
        value.to_string()
    } else {
        parts.join("\n")
    };
    content.chars().take(MAX_TOOL_RESULT_CHARS).collect()
}

pub(crate) fn classify_tool_risk(name: &str, description: &str) -> &'static str {
    let value = format!("{} {}", name, description).to_ascii_lowercase();
    let dangerous = [
        "delete",
        "remove",
        "write",
        "create",
        "update",
        "modify",
        "execute",
        "command",
        "shell",
        "terminal",
        "send",
        "publish",
        "post",
        "commit",
        "push",
        "apply",
        "install",
        "upload",
        "move",
        "rename",
        "删除",
        "写入",
        "修改",
        "执行",
        "命令",
        "发送",
        "发布",
        "提交",
        "推送",
        "安装",
        "上传",
        "移动",
        "重命名",
    ];
    if dangerous.iter().any(|marker| value.contains(marker)) {
        "dangerous"
    } else {
        "safe"
    }
}

pub(crate) fn approval_input_preview(value: &Value) -> String {
    redact_sensitive_json(value)
        .to_string()
        .chars()
        .take(2000)
        .collect()
}

fn redact_sensitive_json(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| {
                    let lower = key.to_ascii_lowercase();
                    let sensitive = [
                        "token",
                        "secret",
                        "password",
                        "authorization",
                        "api_key",
                        "apikey",
                    ]
                    .iter()
                    .any(|marker| lower.contains(marker));
                    (
                        key.clone(),
                        if sensitive {
                            Value::String("***".to_string())
                        } else {
                            redact_sensitive_json(value)
                        },
                    )
                })
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(redact_sensitive_json).collect()),
        value => value.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        classify_tool_risk, expand_env, sanitize_mcp_value, tool_alias, McpClient,
        ResolvedMcpConfig, ToolRoute,
    };
    use axum::{
        http::{HeaderValue, StatusCode},
        response::{IntoResponse, Response},
        routing::post,
        Json, Router,
    };
    use reqwest::header::HeaderMap;
    use serde_json::json;
    use std::{collections::HashMap, env, path::PathBuf};
    use url::Url;

    #[test]
    fn tool_alias_is_provider_safe_and_stable() {
        let routes = HashMap::<String, ToolRoute>::new();
        let alias = tool_alias("文件 服务", "read/file", &routes);
        assert!(alias.starts_with("mcp__"));
        assert!(alias.len() <= 64);
        assert!(alias
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '_' | '-')));
    }

    #[test]
    fn dangerous_tools_require_approval() {
        assert_eq!(classify_tool_risk("delete_file", ""), "dangerous");
        assert_eq!(classify_tool_risk("read_file", "读取文件"), "safe");
    }

    #[test]
    fn large_binary_results_are_removed() {
        let value = sanitize_mcp_value(
            &json!({ "content": [{ "type": "image", "data": "x".repeat(2048) }] }),
        );
        assert_eq!(
            value
                .pointer("/content/0/data")
                .and_then(|item| item.as_str()),
            Some("[二进制内容已省略]")
        );
    }

    #[test]
    fn environment_placeholders_expand_without_shell() {
        env::set_var("CODEM_MCP_TEST", "value");
        assert_eq!(expand_env("Bearer ${CODEM_MCP_TEST}"), "Bearer value");
        env::remove_var("CODEM_MCP_TEST");
    }

    #[tokio::test]
    async fn stdio_client_initializes_lists_and_calls_tools() {
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("mock-mcp-server.mjs");
        let mut client = McpClient::connect(ResolvedMcpConfig::Stdio {
            command: "node".to_string(),
            args: vec![script.to_string_lossy().to_string()],
            env: HashMap::new(),
            cwd: None,
        })
        .await
        .unwrap();
        let tools = client.list_tools().await.unwrap();
        assert_eq!(tools[0]["name"], "read_value");
        let result = client
            .call_tool("read_value", json!({ "value": "ok" }))
            .await
            .unwrap();
        assert_eq!(
            result
                .pointer("/content/0/text")
                .and_then(|value| value.as_str()),
            Some("value:ok")
        );
        client.shutdown().await;
    }

    #[tokio::test]
    async fn streamable_http_client_keeps_session_and_calls_tools() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, Router::new().route("/mcp", post(mock_http_mcp)))
                .await
                .unwrap();
        });
        let mut client = McpClient::connect(ResolvedMcpConfig::Http {
            url: Url::parse(&format!("http://{address}/mcp")).unwrap(),
            headers: HeaderMap::new(),
        })
        .await
        .unwrap();
        let tools = client.list_tools().await.unwrap();
        assert_eq!(tools[0]["name"], "read_value");
        let result = client
            .call_tool("read_value", json!({ "value": "http" }))
            .await
            .unwrap();
        assert_eq!(
            result
                .pointer("/content/0/text")
                .and_then(|value| value.as_str()),
            Some("value:http")
        );
    }

    async fn mock_http_mcp(Json(request): Json<serde_json::Value>) -> Response {
        let Some(id) = request.get("id").cloned() else {
            return StatusCode::ACCEPTED.into_response();
        };
        let result = match request.get("method").and_then(|value| value.as_str()) {
            Some("initialize") => json!({
                "protocolVersion": "2025-03-26",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "mock-http", "version": "1.0.0" }
            }),
            Some("tools/list") => json!({
                "tools": [{ "name": "read_value", "description": "读取", "inputSchema": { "type": "object" } }]
            }),
            Some("tools/call") => json!({
                "content": [{ "type": "text", "text": format!("value:{}", request.pointer("/params/arguments/value").and_then(|value| value.as_str()).unwrap_or_default()) }],
                "isError": false
            }),
            _ => json!({}),
        };
        let mut response =
            Json(json!({ "jsonrpc": "2.0", "id": id, "result": result })).into_response();
        response
            .headers_mut()
            .insert("mcp-session-id", HeaderValue::from_static("test-session"));
        response
    }
}
