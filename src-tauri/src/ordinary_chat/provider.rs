use super::types::{
    AiProtocol, DiscoveredModel, ModelMessage, ProviderStreamEvent, ProviderStreamOutcome,
    ProviderTemplate, ProviderToolCall, ProviderToolCallDelta, ProviderToolDefinition, StoredModel,
    StoredProvider,
};
use reqwest::Client;
use serde_json::Value;
use std::collections::BTreeMap;
use tokio::sync::watch;
use url::Url;

const ANTHROPIC_VERSION: &str = "2023-06-01";

pub(crate) const PROVIDER_TEMPLATES: &[ProviderTemplate] = &[
    ProviderTemplate {
        id: "openai",
        name: "OpenAI",
        protocol: AiProtocol::OpenaiResponses,
        base_url: "https://api.openai.com/v1",
        api_key_url: "https://platform.openai.com/api-keys",
        docs_url: "https://platform.openai.com/docs",
        icon: "openai",
        category: "international",
    },
    ProviderTemplate {
        id: "anthropic",
        name: "Anthropic",
        protocol: AiProtocol::AnthropicMessages,
        base_url: "https://api.anthropic.com",
        api_key_url: "https://console.anthropic.com/settings/keys",
        docs_url: "https://docs.anthropic.com",
        icon: "anthropic",
        category: "international",
    },
    ProviderTemplate {
        id: "gemini",
        name: "Google Gemini",
        protocol: AiProtocol::GeminiGenerateContent,
        base_url: "https://generativelanguage.googleapis.com/v1beta",
        api_key_url: "https://aistudio.google.com/app/apikey",
        docs_url: "https://ai.google.dev/gemini-api/docs",
        icon: "gemini",
        category: "international",
    },
    ProviderTemplate {
        id: "deepseek",
        name: "DeepSeek",
        protocol: AiProtocol::OpenaiChat,
        base_url: "https://api.deepseek.com",
        api_key_url: "https://platform.deepseek.com/api_keys",
        docs_url: "https://api-docs.deepseek.com",
        icon: "deepseek",
        category: "china",
    },
    ProviderTemplate {
        id: "minimax",
        name: "MiniMax",
        protocol: AiProtocol::OpenaiChat,
        base_url: "https://api.minimaxi.com/v1",
        api_key_url: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
        docs_url: "https://platform.minimaxi.com/docs",
        icon: "minimax",
        category: "china",
    },
    ProviderTemplate {
        id: "kimi",
        name: "Kimi",
        protocol: AiProtocol::OpenaiChat,
        base_url: "https://api.moonshot.cn/v1",
        api_key_url: "https://platform.moonshot.cn/console/api-keys",
        docs_url: "https://platform.moonshot.cn/docs",
        icon: "kimi",
        category: "china",
    },
    ProviderTemplate {
        id: "zhipu",
        name: "智谱 GLM",
        protocol: AiProtocol::OpenaiChat,
        base_url: "https://open.bigmodel.cn/api/paas/v4",
        api_key_url: "https://open.bigmodel.cn/usercenter/apikeys",
        docs_url: "https://open.bigmodel.cn/dev/api",
        icon: "zhipu",
        category: "china",
    },
    ProviderTemplate {
        id: "qwen",
        name: "阿里云百炼 / Qwen",
        protocol: AiProtocol::OpenaiChat,
        base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        api_key_url: "https://bailian.console.aliyun.com/?apiKey=1",
        docs_url: "https://help.aliyun.com/zh/model-studio",
        icon: "qwen",
        category: "china",
    },
    ProviderTemplate {
        id: "openrouter",
        name: "OpenRouter",
        protocol: AiProtocol::OpenaiChat,
        base_url: "https://openrouter.ai/api/v1",
        api_key_url: "https://openrouter.ai/keys",
        docs_url: "https://openrouter.ai/docs",
        icon: "openrouter",
        category: "aggregator",
    },
];

pub(crate) async fn discover_models(
    provider: &StoredProvider,
    api_key: &str,
) -> Result<Vec<DiscoveredModel>, String> {
    let client = Client::new();
    let value = match provider.protocol {
        AiProtocol::OpenaiResponses | AiProtocol::OpenaiChat => {
            let response = client
                .get(openai_models_endpoint(&provider.base_url)?)
                .bearer_auth(api_key)
                .send()
                .await
                .map_err(public_request_error)?;
            ensure_success(response)
                .await?
                .json::<Value>()
                .await
                .map_err(public_request_error)?
        }
        AiProtocol::AnthropicMessages => {
            let response = client
                .get(anthropic_models_endpoint(&provider.base_url)?)
                .header("x-api-key", api_key)
                .header("anthropic-version", ANTHROPIC_VERSION)
                .send()
                .await
                .map_err(public_request_error)?;
            ensure_success(response)
                .await?
                .json::<Value>()
                .await
                .map_err(public_request_error)?
        }
        AiProtocol::GeminiGenerateContent => {
            let response = client
                .get(gemini_models_endpoint(&provider.base_url)?)
                .header("x-goog-api-key", api_key)
                .send()
                .await
                .map_err(public_request_error)?;
            ensure_success(response)
                .await?
                .json::<Value>()
                .await
                .map_err(public_request_error)?
        }
    };
    parse_models(provider.protocol, &value)
}

pub(crate) async fn test_provider(
    provider: &StoredProvider,
    api_key: &str,
) -> Result<String, String> {
    let models = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        discover_models(provider, api_key),
    )
    .await
    .map_err(|_| "AI 配置测试超时".to_string())??;
    Ok(format!("连接成功，发现 {} 个模型", models.len()))
}

pub(crate) async fn stream_chat<F>(
    provider: &StoredProvider,
    model: &StoredModel,
    api_key: &str,
    messages: &[ModelMessage],
    tools: &[ProviderToolDefinition],
    cancel: watch::Receiver<bool>,
    mut on_event: F,
) -> Result<ProviderStreamOutcome, String>
where
    F: FnMut(ProviderStreamEvent) + Send,
{
    if !provider.enabled {
        return Err("当前普通聊天供应商已禁用".to_string());
    }
    let client = Client::new();
    match provider.protocol {
        AiProtocol::OpenaiChat => {
            stream_openai_chat(
                &client,
                provider,
                model,
                api_key,
                messages,
                tools,
                cancel,
                &mut on_event,
            )
            .await
        }
        AiProtocol::OpenaiResponses => {
            stream_openai_responses(
                &client,
                provider,
                model,
                api_key,
                messages,
                tools,
                cancel,
                &mut on_event,
            )
            .await
        }
        AiProtocol::AnthropicMessages => {
            stream_anthropic(
                &client,
                provider,
                model,
                api_key,
                messages,
                tools,
                cancel,
                &mut on_event,
            )
            .await
        }
        AiProtocol::GeminiGenerateContent => {
            stream_gemini(
                &client,
                provider,
                model,
                api_key,
                messages,
                tools,
                cancel,
                &mut on_event,
            )
            .await
        }
    }
}

async fn stream_openai_chat<F>(
    client: &Client,
    provider: &StoredProvider,
    model: &StoredModel,
    api_key: &str,
    messages: &[ModelMessage],
    tools: &[ProviderToolDefinition],
    cancel: watch::Receiver<bool>,
    on_event: &mut F,
) -> Result<ProviderStreamOutcome, String>
where
    F: FnMut(ProviderStreamEvent) + Send,
{
    let endpoint = normalize_action_endpoint(&provider.base_url, "/chat/completions")?;
    let mut payload = serde_json::json!({
        "model": model.model_id,
        "stream": true,
        "stream_options": { "include_usage": true },
        "messages": openai_chat_messages(messages),
    });
    if !tools.is_empty() {
        payload["tools"] = Value::Array(openai_chat_tools(tools));
        payload["tool_choice"] = Value::String("auto".to_string());
    }
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
        .map_err(public_request_error)?;
    let response = ensure_success(response).await?;
    read_sse_stream(response, cancel, on_event, |data| {
        if data == "[DONE]" {
            return Ok(StreamParseResult::Done(None));
        }
        let value: Value =
            serde_json::from_str(data).map_err(|_| "OpenAI 流式响应格式无法识别".to_string())?;
        if let Some(error) = value.get("error") {
            return Err(format!(
                "AI 服务返回流式错误：{}",
                sanitize_error(&error.to_string())
            ));
        }
        let delta = value
            .pointer("/choices/0/delta/content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let usage = value.get("usage").cloned();
        let tool_call_deltas = value
            .pointer("/choices/0/delta/tool_calls")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .enumerate()
                    .map(|(fallback_index, item)| ProviderToolCallDelta {
                        index: item
                            .get("index")
                            .and_then(Value::as_u64)
                            .map(|value| value as usize)
                            .unwrap_or(fallback_index),
                        id: item.get("id").and_then(Value::as_str).map(str::to_string),
                        name: item
                            .pointer("/function/name")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        arguments_delta: item
                            .pointer("/function/arguments")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(StreamParseResult::Continue {
            delta,
            usage,
            tool_call_deltas,
        })
    })
    .await
}

async fn stream_openai_responses<F>(
    client: &Client,
    provider: &StoredProvider,
    model: &StoredModel,
    api_key: &str,
    messages: &[ModelMessage],
    tools: &[ProviderToolDefinition],
    cancel: watch::Receiver<bool>,
    on_event: &mut F,
) -> Result<ProviderStreamOutcome, String>
where
    F: FnMut(ProviderStreamEvent) + Send,
{
    let endpoint = normalize_action_endpoint(&provider.base_url, "/responses")?;
    let mut payload = serde_json::json!({
        "model": model.model_id,
        "stream": true,
        "input": openai_responses_input(messages),
    });
    if !tools.is_empty() {
        payload["tools"] = Value::Array(openai_responses_tools(tools));
        payload["tool_choice"] = Value::String("auto".to_string());
    }
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
        .map_err(public_request_error)?;
    let response = ensure_success(response).await?;
    read_sse_stream(response, cancel, on_event, |data| {
        if data == "[DONE]" {
            return Ok(StreamParseResult::Done(None));
        }
        let value: Value = serde_json::from_str(data)
            .map_err(|_| "OpenAI Responses 流式响应格式无法识别".to_string())?;
        match value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "response.output_text.delta" => Ok(StreamParseResult::Continue {
                delta: value
                    .get("delta")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                usage: None,
                tool_call_deltas: Vec::new(),
            }),
            "response.output_item.added"
                if value.pointer("/item/type").and_then(Value::as_str) == Some("function_call") =>
            {
                Ok(StreamParseResult::Continue {
                    delta: String::new(),
                    usage: None,
                    tool_call_deltas: vec![ProviderToolCallDelta {
                        index: value
                            .get("output_index")
                            .and_then(Value::as_u64)
                            .unwrap_or(0) as usize,
                        id: value
                            .pointer("/item/call_id")
                            .or_else(|| value.pointer("/item/id"))
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        name: value
                            .pointer("/item/name")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        arguments_delta: value
                            .pointer("/item/arguments")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                    }],
                })
            }
            "response.function_call_arguments.delta" => Ok(StreamParseResult::Continue {
                delta: String::new(),
                usage: None,
                tool_call_deltas: vec![ProviderToolCallDelta {
                    index: value
                        .get("output_index")
                        .and_then(Value::as_u64)
                        .unwrap_or(0) as usize,
                    id: value
                        .get("call_id")
                        .or_else(|| value.get("item_id"))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    name: None,
                    arguments_delta: value
                        .get("delta")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                }],
            }),
            "response.output_item.done"
                if value.pointer("/item/type").and_then(Value::as_str) == Some("function_call") =>
            {
                Ok(StreamParseResult::Continue {
                    delta: String::new(),
                    usage: None,
                    tool_call_deltas: vec![ProviderToolCallDelta {
                        index: value
                            .get("output_index")
                            .and_then(Value::as_u64)
                            .unwrap_or(0) as usize,
                        id: value
                            .pointer("/item/call_id")
                            .or_else(|| value.pointer("/item/id"))
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        name: value
                            .pointer("/item/name")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        arguments_delta: value
                            .pointer("/item/arguments")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                    }],
                })
            }
            "response.completed" => Ok(StreamParseResult::Done(
                value.pointer("/response/usage").cloned(),
            )),
            "error" | "response.failed" => Err(format!(
                "AI 服务返回流式错误：{}",
                sanitize_error(&value.to_string())
            )),
            _ => Ok(StreamParseResult::Continue {
                delta: String::new(),
                usage: None,
                tool_call_deltas: Vec::new(),
            }),
        }
    })
    .await
}

async fn stream_anthropic<F>(
    client: &Client,
    provider: &StoredProvider,
    model: &StoredModel,
    api_key: &str,
    messages: &[ModelMessage],
    tools: &[ProviderToolDefinition],
    cancel: watch::Receiver<bool>,
    on_event: &mut F,
) -> Result<ProviderStreamOutcome, String>
where
    F: FnMut(ProviderStreamEvent) + Send,
{
    let endpoint = normalize_action_endpoint(&provider.base_url, "/v1/messages")?;
    let (system, messages) = split_system_messages(messages);
    let mut payload = serde_json::json!({
        "model": model.model_id,
        "stream": true,
        "max_tokens": 8192,
        "system": system,
        "messages": messages,
    });
    if !tools.is_empty() {
        payload["tools"] = Value::Array(anthropic_tools(tools));
    }
    let response = client
        .post(endpoint)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&payload)
        .send()
        .await
        .map_err(public_request_error)?;
    let response = ensure_success(response).await?;
    read_sse_stream(response, cancel, on_event, |data| {
        let value: Value =
            serde_json::from_str(data).map_err(|_| "Anthropic 流式响应格式无法识别".to_string())?;
        match value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "content_block_start"
                if value.pointer("/content_block/type").and_then(Value::as_str)
                    == Some("tool_use") =>
            {
                Ok(StreamParseResult::Continue {
                    delta: String::new(),
                    usage: None,
                    tool_call_deltas: vec![ProviderToolCallDelta {
                        index: value.get("index").and_then(Value::as_u64).unwrap_or(0) as usize,
                        id: value
                            .pointer("/content_block/id")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        name: value
                            .pointer("/content_block/name")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        arguments_delta: value
                            .pointer("/content_block/input")
                            .filter(|item| {
                                !item.is_null()
                                    && item
                                        .as_object()
                                        .map(|object| !object.is_empty())
                                        .unwrap_or(true)
                            })
                            .map(Value::to_string)
                            .unwrap_or_default(),
                    }],
                })
            }
            "content_block_delta" => {
                let arguments_delta = value
                    .pointer("/delta/partial_json")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                Ok(StreamParseResult::Continue {
                    delta: value
                        .pointer("/delta/text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    usage: None,
                    tool_call_deltas: if arguments_delta.is_empty() {
                        Vec::new()
                    } else {
                        vec![ProviderToolCallDelta {
                            index: value.get("index").and_then(Value::as_u64).unwrap_or(0) as usize,
                            id: None,
                            name: None,
                            arguments_delta: arguments_delta.to_string(),
                        }]
                    },
                })
            }
            "message_delta" => Ok(StreamParseResult::Continue {
                delta: String::new(),
                usage: value.get("usage").cloned(),
                tool_call_deltas: Vec::new(),
            }),
            "message_stop" => Ok(StreamParseResult::Done(None)),
            "error" => Err(format!(
                "AI 服务返回流式错误：{}",
                sanitize_error(&value.to_string())
            )),
            _ => Ok(StreamParseResult::Continue {
                delta: String::new(),
                usage: None,
                tool_call_deltas: Vec::new(),
            }),
        }
    })
    .await
}

async fn stream_gemini<F>(
    client: &Client,
    provider: &StoredProvider,
    model: &StoredModel,
    api_key: &str,
    messages: &[ModelMessage],
    tools: &[ProviderToolDefinition],
    cancel: watch::Receiver<bool>,
    on_event: &mut F,
) -> Result<ProviderStreamOutcome, String>
where
    F: FnMut(ProviderStreamEvent) + Send,
{
    let mut endpoint =
        Url::parse(provider.base_url.trim()).map_err(|_| "AI 请求地址不是合法 URL".to_string())?;
    let base = endpoint.path().trim_end_matches('/');
    endpoint.set_path(&format!(
        "{base}/models/{}:streamGenerateContent",
        model.model_id
    ));
    endpoint.set_query(Some("alt=sse"));
    let (system, contents) = gemini_contents(messages);
    let mut payload = serde_json::json!({
        "systemInstruction": { "parts": [{ "text": system }] },
        "contents": contents,
    });
    if !tools.is_empty() {
        payload["tools"] = serde_json::json!([{ "functionDeclarations": gemini_tools(tools) }]);
        payload["toolConfig"] = serde_json::json!({ "functionCallingConfig": { "mode": "AUTO" } });
    }
    let response = client
        .post(endpoint)
        .header("x-goog-api-key", api_key)
        .json(&payload)
        .send()
        .await
        .map_err(public_request_error)?;
    let response = ensure_success(response).await?;
    read_sse_stream(response, cancel, on_event, |data| {
        let value: Value =
            serde_json::from_str(data).map_err(|_| "Gemini 流式响应格式无法识别".to_string())?;
        if let Some(error) = value.get("error") {
            return Err(format!(
                "AI 服务返回流式错误：{}",
                sanitize_error(&error.to_string())
            ));
        }
        let delta = value
            .pointer("/candidates/0/content/parts")
            .and_then(Value::as_array)
            .map(|parts| {
                parts
                    .iter()
                    .filter_map(|part| part.get("text").and_then(Value::as_str))
                    .collect::<String>()
            })
            .unwrap_or_default();
        let tool_call_deltas = value
            .pointer("/candidates/0/content/parts")
            .and_then(Value::as_array)
            .map(|parts| {
                parts
                    .iter()
                    .enumerate()
                    .filter_map(|(index, part)| {
                        let call = part.get("functionCall")?;
                        Some(ProviderToolCallDelta {
                            index,
                            id: call.get("id").and_then(Value::as_str).map(str::to_string),
                            name: call.get("name").and_then(Value::as_str).map(str::to_string),
                            arguments_delta: call
                                .get("args")
                                .cloned()
                                .unwrap_or_else(|| serde_json::json!({}))
                                .to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(StreamParseResult::Continue {
            delta,
            usage: value.get("usageMetadata").cloned(),
            tool_call_deltas,
        })
    })
    .await
}

enum StreamParseResult {
    Continue {
        delta: String,
        usage: Option<Value>,
        tool_call_deltas: Vec<ProviderToolCallDelta>,
    },
    Done(Option<Value>),
}

async fn read_sse_stream<F, P>(
    mut response: reqwest::Response,
    mut cancel: watch::Receiver<bool>,
    on_event: &mut F,
    mut parse: P,
) -> Result<ProviderStreamOutcome, String>
where
    F: FnMut(ProviderStreamEvent) + Send,
    P: FnMut(&str) -> Result<StreamParseResult, String>,
{
    let mut buffer = Vec::<u8>::new();
    let mut text = String::new();
    let mut usage = None;
    let mut stop_reason = "end_turn".to_string();
    let mut tool_calls = BTreeMap::<usize, ToolCallAccumulator>::new();
    loop {
        let chunk = tokio::select! {
            changed = cancel.changed() => {
                if changed.is_ok() && *cancel.borrow() {
                    stop_reason = "cancelled".to_string();
                    break;
                }
                continue;
            }
            result = response.chunk() => result.map_err(public_request_error)?,
        };
        let Some(chunk) = chunk else {
            break;
        };
        buffer.extend_from_slice(&chunk);
        while let Some((event, drain_to)) = next_sse_event(&buffer) {
            let event =
                String::from_utf8(event).map_err(|_| "AI 流式响应不是有效 UTF-8".to_string())?;
            let mut done = false;
            for data in sse_data_lines(&event) {
                match parse(&data)? {
                    StreamParseResult::Continue {
                        delta,
                        usage: next_usage,
                        tool_call_deltas,
                    } => {
                        if !delta.is_empty() {
                            text.push_str(&delta);
                            on_event(ProviderStreamEvent::TextDelta(delta));
                        }
                        if let Some(next_usage) = next_usage {
                            usage = Some(next_usage.clone());
                            on_event(ProviderStreamEvent::Usage(next_usage));
                        }
                        for tool_delta in tool_call_deltas {
                            merge_tool_call_delta(&mut tool_calls, &tool_delta);
                            on_event(ProviderStreamEvent::ToolCallDelta(tool_delta));
                        }
                    }
                    StreamParseResult::Done(next_usage) => {
                        if let Some(next_usage) = next_usage {
                            usage = Some(next_usage.clone());
                            on_event(ProviderStreamEvent::Usage(next_usage));
                        }
                        done = true;
                    }
                }
            }
            buffer.drain(..drain_to);
            if done {
                return Ok(ProviderStreamOutcome {
                    text,
                    usage,
                    stop_reason: if tool_calls.is_empty() {
                        stop_reason
                    } else {
                        "tool_calls".to_string()
                    },
                    tool_calls: finalize_tool_calls(tool_calls)?,
                });
            }
        }
    }
    Ok(ProviderStreamOutcome {
        text,
        usage,
        stop_reason: if tool_calls.is_empty() {
            stop_reason
        } else {
            "tool_calls".to_string()
        },
        tool_calls: finalize_tool_calls(tool_calls)?,
    })
}

#[derive(Default)]
struct ToolCallAccumulator {
    id: Option<String>,
    name: Option<String>,
    arguments: String,
}

fn merge_tool_call_delta(
    tool_calls: &mut BTreeMap<usize, ToolCallAccumulator>,
    delta: &ProviderToolCallDelta,
) {
    let current = tool_calls.entry(delta.index).or_default();
    if let Some(id) = delta.id.as_ref().filter(|value| !value.trim().is_empty()) {
        current.id = Some(id.clone());
    }
    if let Some(name) = delta.name.as_ref().filter(|value| !value.trim().is_empty()) {
        current.name = Some(name.clone());
    }
    if !delta.arguments_delta.is_empty() {
        if !current.arguments.is_empty()
            && serde_json::from_str::<Value>(&delta.arguments_delta).is_ok()
        {
            current.arguments = delta.arguments_delta.clone();
        } else {
            current.arguments.push_str(&delta.arguments_delta);
        }
    }
}

fn finalize_tool_calls(
    tool_calls: BTreeMap<usize, ToolCallAccumulator>,
) -> Result<Vec<ProviderToolCall>, String> {
    tool_calls
        .into_iter()
        .map(|(index, call)| {
            let name = call
                .name
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "模型返回的工具调用缺少名称".to_string())?;
            let arguments = if call.arguments.trim().is_empty() {
                serde_json::json!({})
            } else {
                serde_json::from_str(&call.arguments)
                    .map_err(|_| format!("模型返回的工具 {name} 参数不是有效 JSON"))?
            };
            Ok(ProviderToolCall {
                id: call
                    .id
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| format!("tool-call-{index}-{}", uuid::Uuid::new_v4())),
                name,
                arguments,
            })
        })
        .collect()
}

fn next_sse_event(buffer: &[u8]) -> Option<(Vec<u8>, usize)> {
    let lf = find_bytes(buffer, b"\n\n").map(|index| (index, 2));
    let crlf = find_bytes(buffer, b"\r\n\r\n").map(|index| (index, 4));
    let (index, width) = match (lf, crlf) {
        (Some(left), Some(right)) => {
            if left.0 <= right.0 {
                left
            } else {
                right
            }
        }
        (Some(value), None) | (None, Some(value)) => value,
        (None, None) => return None,
    };
    Some((buffer[..index].to_vec(), index + width))
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn sse_data_lines(event: &str) -> Vec<String> {
    event
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

fn openai_chat_messages(messages: &[ModelMessage]) -> Vec<Value> {
    let mut output =
        vec![serde_json::json!({ "role": "system", "content": default_system_prompt() })];
    for message in messages {
        if message.role == "tool" {
            output.push(serde_json::json!({
                "role": "tool",
                "tool_call_id": message.tool_call_id,
                "content": message.content,
            }));
            continue;
        }
        let images = message_images(message);
        let content = if images.is_empty() || message.role == "assistant" {
            Value::String(message_text(message))
        } else {
            let mut content = Vec::new();
            let text = message_text(message);
            if !text.trim().is_empty() {
                content.push(serde_json::json!({ "type": "text", "text": text }));
            }
            content.extend(images.into_iter().map(|(mime_type, data)| {
                serde_json::json!({
                    "type": "image_url",
                    "image_url": { "url": format!("data:{mime_type};base64,{data}") }
                })
            }));
            Value::Array(content)
        };
        let mut item = serde_json::json!({
            "role": message.role,
            "content": content,
        });
        if !message.tool_calls.is_empty() {
            item["tool_calls"] = Value::Array(
                message
                    .tool_calls
                    .iter()
                    .map(|call| {
                        serde_json::json!({
                            "id": call.id,
                            "type": "function",
                            "function": {
                                "name": call.name,
                                "arguments": call.arguments.to_string(),
                            }
                        })
                    })
                    .collect(),
            );
        }
        output.push(item);
    }
    output
}

fn openai_responses_input(messages: &[ModelMessage]) -> Vec<Value> {
    let mut output = vec![serde_json::json!({
        "role": "system",
        "content": [{ "type": "input_text", "text": default_system_prompt() }]
    })];
    for message in messages {
        if message.role == "tool" {
            output.push(serde_json::json!({
                "type": "function_call_output",
                "call_id": message.tool_call_id,
                "output": message.content,
            }));
            continue;
        }
        let content_type = if message.role == "assistant" {
            "output_text"
        } else {
            "input_text"
        };
        let mut content = vec![serde_json::json!({
            "type": content_type,
            "text": message_text(message)
        })];
        if message.role != "assistant" {
            content.extend(
                message_images(message)
                    .into_iter()
                    .map(|(mime_type, data)| {
                        serde_json::json!({
                            "type": "input_image",
                            "image_url": format!("data:{mime_type};base64,{data}")
                        })
                    }),
            );
        }
        if !content.is_empty()
            && (!message_text(message).trim().is_empty() || message.role != "assistant")
        {
            output.push(serde_json::json!({
                "role": message.role,
                "content": content
            }));
        }
        for call in &message.tool_calls {
            output.push(serde_json::json!({
                "type": "function_call",
                "call_id": call.id,
                "name": call.name,
                "arguments": call.arguments.to_string(),
            }));
        }
    }
    output
}

fn openai_chat_tools(tools: &[ProviderToolDefinition]) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                }
            })
        })
        .collect()
}

fn openai_responses_tools(tools: &[ProviderToolDefinition]) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            serde_json::json!({
                "type": "function",
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.input_schema,
                "strict": false,
            })
        })
        .collect()
}

fn anthropic_tools(tools: &[ProviderToolDefinition]) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            serde_json::json!({
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.input_schema,
            })
        })
        .collect()
}

fn gemini_tools(tools: &[ProviderToolDefinition]) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            serde_json::json!({
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.input_schema,
            })
        })
        .collect()
}

fn split_system_messages(messages: &[ModelMessage]) -> (String, Vec<Value>) {
    let mut system = vec![default_system_prompt().to_string()];
    let mut output = Vec::new();
    for message in messages {
        if message.role == "system" {
            system.push(message_text(message));
        } else if message.role == "tool" {
            output.push(serde_json::json!({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": message.tool_call_id,
                    "content": message.content,
                    "is_error": message.tool_result_is_error,
                }],
            }));
        } else {
            output.push(serde_json::json!({
                "role": message.role,
                "content": anthropic_content(message),
            }));
        }
    }
    (system.join("\n\n"), output)
}

fn gemini_contents(messages: &[ModelMessage]) -> (String, Vec<Value>) {
    let mut system = vec![default_system_prompt().to_string()];
    let mut output = Vec::new();
    for message in messages {
        if message.role == "system" {
            system.push(message_text(message));
            continue;
        }
        if message.role == "tool" {
            output.push(serde_json::json!({
                "role": "function",
                "parts": [{
                    "functionResponse": {
                        "name": message.tool_name,
                        "response": {
                            "content": message.content,
                            "isError": message.tool_result_is_error,
                        }
                    }
                }],
            }));
            continue;
        }
        let mut parts = Vec::new();
        let text = message_text(message);
        if !text.trim().is_empty() {
            parts.push(serde_json::json!({ "text": text }));
        }
        if message.role != "assistant" {
            parts.extend(
                message_images(message)
                    .into_iter()
                    .map(|(mime_type, data)| {
                        serde_json::json!({
                            "inlineData": { "mimeType": mime_type, "data": data }
                        })
                    }),
            );
        }
        if message.role == "assistant" {
            parts.extend(message.tool_calls.iter().map(|call| {
                serde_json::json!({
                    "functionCall": {
                        "id": call.id,
                        "name": call.name,
                        "args": call.arguments,
                    }
                })
            }));
        }
        output.push(serde_json::json!({
            "role": if message.role == "assistant" { "model" } else { "user" },
            "parts": parts,
        }));
    }
    (system.join("\n\n"), output)
}

fn message_text(message: &ModelMessage) -> String {
    let mut text = message.content.clone();
    let blocks = message
        .content_blocks
        .as_array()
        .cloned()
        .unwrap_or_default();
    for block in blocks {
        match block
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "file_text" => {
                let name = block.get("name").and_then(Value::as_str).unwrap_or("文件");
                let content = block
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                text.push_str(&format!("\n\n[附件：{name}]\n{content}"));
            }
            "file_reference" => {
                let path = block
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !path.is_empty() {
                    text.push_str(&format!("\n\n[文件引用：{path}]"));
                }
            }
            _ => {}
        }
    }
    text
}

fn anthropic_content(message: &ModelMessage) -> Vec<Value> {
    let mut content = Vec::new();
    let text = message_text(message);
    if !text.trim().is_empty() {
        content.push(serde_json::json!({ "type": "text", "text": text }));
    }
    if message.role != "assistant" {
        content.extend(
            message_images(message)
                .into_iter()
                .map(|(media_type, data)| {
                    serde_json::json!({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": data
                        }
                    })
                }),
        );
    }
    if message.role == "assistant" {
        content.extend(message.tool_calls.iter().map(|call| {
            serde_json::json!({
                "type": "tool_use",
                "id": call.id,
                "name": call.name,
                "input": call.arguments,
            })
        }));
    }
    content
}

fn message_images(message: &ModelMessage) -> Vec<(String, String)> {
    message
        .content_blocks
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(normalize_image_block)
        .collect()
}

fn normalize_image_block(block: &Value) -> Option<(String, String)> {
    if block.get("type").and_then(Value::as_str) != Some("image") {
        return None;
    }
    let raw_data = block.get("data").and_then(Value::as_str)?.trim();
    if raw_data.is_empty() {
        return None;
    }
    if let Some(data_url) = raw_data.strip_prefix("data:") {
        let (metadata, data) = data_url.split_once(",")?;
        let mime_type = metadata.strip_suffix(";base64")?.trim();
        let data = data
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect::<String>();
        return valid_image_payload(mime_type, data);
    }
    let mime_type = block
        .get("mimeType")
        .or_else(|| block.get("mime_type"))
        .and_then(Value::as_str)?;
    let data = raw_data
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>();
    valid_image_payload(mime_type, data)
}

fn valid_image_payload(mime_type: &str, data: String) -> Option<(String, String)> {
    let mime_type = mime_type.trim().to_ascii_lowercase();
    if !mime_type.starts_with("image/") || data.is_empty() {
        return None;
    }
    Some((mime_type, data))
}

fn default_system_prompt() -> &'static str {
    "你是 CodeM 的普通聊天助手。你不属于任何 Agent，不应声称已经执行命令、修改文件或完成外部操作。回答应准确、清晰，并明确区分已知信息、推断和需要用户确认的内容。"
}

fn normalize_action_endpoint(base_url: &str, action: &str) -> Result<Url, String> {
    let mut url = Url::parse(base_url.trim()).map_err(|_| "AI 请求地址不是合法 URL".to_string())?;
    let path = url.path().trim_end_matches('/');
    if path.ends_with(action) {
        return Ok(url);
    }
    let known_actions = ["/responses", "/chat/completions", "/v1/messages"];
    let base = known_actions
        .iter()
        .find_map(|suffix| path.strip_suffix(suffix))
        .unwrap_or(path);
    let next = if action == "/v1/messages" && base.ends_with("/v1") {
        format!("{base}/messages")
    } else {
        format!("{base}{action}")
    };
    url.set_path(&next);
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn parse_models(protocol: AiProtocol, value: &Value) -> Result<Vec<DiscoveredModel>, String> {
    let items = match protocol {
        AiProtocol::OpenaiResponses | AiProtocol::OpenaiChat | AiProtocol::AnthropicMessages => {
            value
                .get("data")
                .and_then(Value::as_array)
                .ok_or_else(|| "模型列表响应格式无法识别".to_string())?
        }
        AiProtocol::GeminiGenerateContent => value
            .get("models")
            .and_then(Value::as_array)
            .ok_or_else(|| "Gemini 模型列表响应格式无法识别".to_string())?,
    };
    let mut models = items
        .iter()
        .filter_map(|item| {
            let raw_id = item
                .get("id")
                .or_else(|| item.get("name"))?
                .as_str()?
                .trim();
            let model_id = raw_id.strip_prefix("models/").unwrap_or(raw_id).to_string();
            if model_id.is_empty() {
                return None;
            }
            let display_name = item
                .get("display_name")
                .or_else(|| item.get("displayName"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(&model_id)
                .to_string();
            Some(DiscoveredModel {
                model_id,
                display_name,
            })
        })
        .collect::<Vec<_>>();
    models.sort_by(|left, right| {
        left.display_name
            .to_ascii_lowercase()
            .cmp(&right.display_name.to_ascii_lowercase())
    });
    models.dedup_by(|left, right| left.model_id == right.model_id);
    if models.is_empty() {
        return Err("接口没有返回可用模型".to_string());
    }
    Ok(models)
}

fn openai_models_endpoint(base_url: &str) -> Result<Url, String> {
    replace_api_path(base_url, &["/responses", "/chat/completions"], "/models")
}

fn anthropic_models_endpoint(base_url: &str) -> Result<Url, String> {
    replace_api_path(base_url, &["/messages"], "/models")
}

fn gemini_models_endpoint(base_url: &str) -> Result<Url, String> {
    replace_api_path(base_url, &[], "/models")
}

fn replace_api_path(base_url: &str, suffixes: &[&str], target: &str) -> Result<Url, String> {
    let mut url = Url::parse(base_url.trim()).map_err(|_| "AI 请求地址不是合法 URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("AI 请求地址必须使用 http 或 https".to_string());
    }
    let mut path = url.path().trim_end_matches('/').to_string();
    for suffix in suffixes {
        if let Some(prefix) = path.strip_suffix(suffix) {
            path = prefix.to_string();
            break;
        }
    }
    if path.ends_with(target) {
        return Ok(url);
    }
    url.set_path(&format!("{}{}", path, target));
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

async fn ensure_success(response: reqwest::Response) -> Result<reqwest::Response, String> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();
    Err(format!(
        "AI 服务返回错误：HTTP {status}，{}",
        sanitize_error(&body)
    ))
}

fn public_request_error(error: reqwest::Error) -> String {
    format!("AI 服务请求失败：{}", sanitize_error(&error.to_string()))
}

fn sanitize_error(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    if [
        "authorization",
        "x-api-key",
        "api_key",
        "apikey",
        "bearer ",
        "sk-",
        "secret",
        "password",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
    {
        return "错误内容包含敏感字段，已隐藏".to_string();
    }
    value.chars().take(500).collect()
}

#[cfg(test)]
mod tests {
    use super::{
        finalize_tool_calls, gemini_contents, merge_tool_call_delta, normalize_action_endpoint,
        openai_chat_messages, openai_chat_tools, openai_responses_input, parse_models,
        split_system_messages, stream_chat, ToolCallAccumulator, PROVIDER_TEMPLATES,
    };
    use crate::ordinary_chat::types::{
        AiProtocol, ModelMessage, ProviderToolCall, ProviderToolCallDelta, ProviderToolDefinition,
        StoredModel, StoredProvider,
    };
    use axum::{http::Uri, response::IntoResponse, Router};
    use serde_json::json;
    use std::collections::BTreeMap;

    #[test]
    fn curated_templates_exclude_partner_marketplace_entries() {
        assert_eq!(PROVIDER_TEMPLATES.len(), 9);
        assert!(PROVIDER_TEMPLATES.iter().any(|item| item.id == "deepseek"));
        assert!(PROVIDER_TEMPLATES.iter().any(|item| item.id == "minimax"));
        assert!(PROVIDER_TEMPLATES
            .iter()
            .all(|item| item.api_key_url.starts_with("https://")));
    }

    #[test]
    fn normalizes_anthropic_action_without_duplicating_v1() {
        assert_eq!(
            normalize_action_endpoint("https://api.anthropic.com", "/v1/messages")
                .unwrap()
                .as_str(),
            "https://api.anthropic.com/v1/messages"
        );
        assert_eq!(
            normalize_action_endpoint("https://api.anthropic.com/v1", "/v1/messages")
                .unwrap()
                .as_str(),
            "https://api.anthropic.com/v1/messages"
        );
        assert_eq!(
            normalize_action_endpoint("https://api.anthropic.com/v1/messages", "/v1/messages")
                .unwrap()
                .as_str(),
            "https://api.anthropic.com/v1/messages"
        );
    }

    #[test]
    fn parses_openai_and_gemini_model_lists() {
        let openai = parse_models(
            AiProtocol::OpenaiChat,
            &json!({ "data": [{ "id": "model-b" }, { "id": "model-a" }] }),
        )
        .unwrap();
        assert_eq!(openai[0].model_id, "model-a");
        let gemini = parse_models(
            AiProtocol::GeminiGenerateContent,
            &json!({ "models": [{ "name": "models/gemini-test", "displayName": "Gemini Test" }] }),
        )
        .unwrap();
        assert_eq!(gemini[0].model_id, "gemini-test");
    }

    #[test]
    fn maps_image_blocks_to_each_provider_protocol() {
        let messages = vec![ModelMessage {
            role: "user".to_string(),
            content: "描述图片".to_string(),
            content_blocks: json!([
                { "type": "text", "text": "描述图片" },
                { "type": "image", "mimeType": "image/png", "data": "SGVsbG8=" }
            ]),
            tool_calls: Vec::new(),
            tool_call_id: None,
            tool_name: None,
            tool_result_is_error: false,
        }];

        let openai_chat = openai_chat_messages(&messages);
        assert_eq!(
            openai_chat[1]
                .pointer("/content/1/image_url/url")
                .and_then(|value| value.as_str()),
            Some("data:image/png;base64,SGVsbG8=")
        );

        let responses = openai_responses_input(&messages);
        assert_eq!(
            responses[1]
                .pointer("/content/1/type")
                .and_then(|value| value.as_str()),
            Some("input_image")
        );

        let (_, anthropic) = split_system_messages(&messages);
        assert_eq!(
            anthropic[0]
                .pointer("/content/1/source/media_type")
                .and_then(|value| value.as_str()),
            Some("image/png")
        );

        let (_, gemini) = gemini_contents(&messages);
        assert_eq!(
            gemini[0]
                .pointer("/parts/1/inlineData/data")
                .and_then(|value| value.as_str()),
            Some("SGVsbG8=")
        );
    }

    #[test]
    fn maps_tool_definitions_calls_and_results_to_provider_payloads() {
        let tools = openai_chat_tools(&[ProviderToolDefinition {
            name: "mcp__files__read".to_string(),
            description: "读取文件".to_string(),
            input_schema: json!({ "type": "object", "properties": { "path": { "type": "string" } } }),
        }]);
        assert_eq!(
            tools[0]
                .pointer("/function/name")
                .and_then(|value| value.as_str()),
            Some("mcp__files__read")
        );

        let messages = vec![
            ModelMessage {
                role: "assistant".to_string(),
                content: String::new(),
                content_blocks: json!([]),
                tool_calls: vec![ProviderToolCall {
                    id: "call-1".to_string(),
                    name: "mcp__files__read".to_string(),
                    arguments: json!({ "path": "README.md" }),
                }],
                tool_call_id: None,
                tool_name: None,
                tool_result_is_error: false,
            },
            ModelMessage {
                role: "tool".to_string(),
                content: "内容".to_string(),
                content_blocks: json!([]),
                tool_calls: Vec::new(),
                tool_call_id: Some("call-1".to_string()),
                tool_name: Some("mcp__files__read".to_string()),
                tool_result_is_error: false,
            },
        ];
        let openai = openai_chat_messages(&messages);
        assert_eq!(
            openai[1]
                .pointer("/tool_calls/0/function/name")
                .and_then(|value| value.as_str()),
            Some("mcp__files__read")
        );
        assert_eq!(
            openai[2]
                .get("tool_call_id")
                .and_then(|value| value.as_str()),
            Some("call-1")
        );
        let (_, anthropic) = split_system_messages(&messages);
        assert_eq!(
            anthropic[0]
                .pointer("/content/0/type")
                .and_then(|value| value.as_str()),
            Some("tool_use")
        );
        let (_, gemini) = gemini_contents(&messages);
        assert_eq!(
            gemini[1]
                .pointer("/parts/0/functionResponse/name")
                .and_then(|value| value.as_str()),
            Some("mcp__files__read")
        );
        let responses = openai_responses_input(&messages);
        assert!(responses.iter().any(|item| {
            item.get("type").and_then(|value| value.as_str()) == Some("function_call_output")
        }));
    }

    #[test]
    fn merges_streamed_tool_call_arguments() {
        let mut calls = BTreeMap::<usize, ToolCallAccumulator>::new();
        merge_tool_call_delta(
            &mut calls,
            &ProviderToolCallDelta {
                index: 0,
                id: Some("call-1".to_string()),
                name: Some("tool".to_string()),
                arguments_delta: "{\"path\":".to_string(),
            },
        );
        merge_tool_call_delta(
            &mut calls,
            &ProviderToolCallDelta {
                index: 0,
                id: None,
                name: None,
                arguments_delta: "\"README.md\"}".to_string(),
            },
        );
        let calls = finalize_tool_calls(calls).unwrap();
        assert_eq!(calls[0].arguments["path"], "README.md");
    }

    #[tokio::test]
    async fn parses_tool_calls_from_all_streaming_protocols() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, Router::new().fallback(mock_provider_stream))
                .await
                .unwrap();
        });
        let tools = vec![ProviderToolDefinition {
            name: "mcp__test__read".to_string(),
            description: "读取".to_string(),
            input_schema: json!({ "type": "object" }),
        }];
        let messages = vec![ModelMessage {
            role: "user".to_string(),
            content: "调用工具".to_string(),
            content_blocks: json!([]),
            tool_calls: Vec::new(),
            tool_call_id: None,
            tool_name: None,
            tool_result_is_error: false,
        }];
        for (protocol, base_path) in [
            (AiProtocol::OpenaiChat, "/v1"),
            (AiProtocol::OpenaiResponses, "/v1"),
            (AiProtocol::AnthropicMessages, ""),
            (AiProtocol::GeminiGenerateContent, "/v1beta"),
        ] {
            let provider = StoredProvider {
                name: "Mock".to_string(),
                protocol,
                base_url: format!("http://{address}{base_path}"),
                enabled: true,
                secret_slot: "slot".to_string(),
            };
            let model = StoredModel {
                id: "model-row".to_string(),
                model_id: "model".to_string(),
                display_name: "Model".to_string(),
                capabilities: json!({}),
            };
            let (_, cancel) = tokio::sync::watch::channel(false);
            let outcome = stream_chat(
                &provider,
                &model,
                "test-key",
                &messages,
                &tools,
                cancel,
                |_| {},
            )
            .await
            .unwrap();
            assert_eq!(
                outcome.tool_calls.len(),
                1,
                "protocol={}",
                protocol.as_str()
            );
            assert_eq!(outcome.tool_calls[0].name, "mcp__test__read");
            assert_eq!(outcome.tool_calls[0].arguments["path"], "README.md");
        }
    }

    async fn mock_provider_stream(uri: Uri) -> impl IntoResponse {
        let body = match uri.path() {
            "/v1/chat/completions" => concat!(
                "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-chat\",\"function\":{\"name\":\"mcp__test__read\",\"arguments\":\"{\\\"path\\\":\\\"README.md\\\"}\"}}]}}]}\n\n",
                "data: [DONE]\n\n"
            ),
            "/v1/responses" => concat!(
                "data: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"type\":\"function_call\",\"call_id\":\"call-responses\",\"name\":\"mcp__test__read\",\"arguments\":\"\"}}\n\n",
                "data: {\"type\":\"response.function_call_arguments.delta\",\"output_index\":0,\"delta\":\"{\\\"path\\\":\\\"README.md\\\"}\"}\n\n",
                "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}}\n\n"
            ),
            "/v1/messages" => concat!(
                "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"call-anthropic\",\"name\":\"mcp__test__read\",\"input\":{}}}\n\n",
                "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"path\\\":\\\"README.md\\\"}\"}}\n\n",
                "data: {\"type\":\"message_stop\"}\n\n"
            ),
            path if path.ends_with(":streamGenerateContent") => {
                "data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"mcp__test__read\",\"args\":{\"path\":\"README.md\"}}}]}}]}\n\n"
            }
            _ => "data: {\"error\":{\"message\":\"unknown path\"}}\n\n",
        };
        ([("content-type", "text/event-stream")], body)
    }
}
