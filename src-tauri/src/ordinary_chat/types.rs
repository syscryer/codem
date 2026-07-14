use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AiProtocol {
    OpenaiResponses,
    OpenaiChat,
    AnthropicMessages,
    GeminiGenerateContent,
}

impl AiProtocol {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::OpenaiResponses => "openai_responses",
            Self::OpenaiChat => "openai_chat",
            Self::AnthropicMessages => "anthropic_messages",
            Self::GeminiGenerateContent => "gemini_generate_content",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "openai_responses" => Some(Self::OpenaiResponses),
            "openai_chat" => Some(Self::OpenaiChat),
            "anthropic_messages" => Some(Self::AnthropicMessages),
            "gemini_generate_content" => Some(Self::GeminiGenerateContent),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderTemplate {
    pub id: &'static str,
    pub name: &'static str,
    pub protocol: AiProtocol,
    pub base_url: &'static str,
    pub api_key_url: &'static str,
    pub docs_url: &'static str,
    pub icon: &'static str,
    pub category: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiProviderSummary {
    pub id: String,
    pub preset_id: Option<String>,
    pub name: String,
    pub protocol: AiProtocol,
    pub base_url: String,
    pub enabled: bool,
    pub api_key_saved: bool,
    pub models: Vec<AiModelSummary>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiModelSummary {
    pub id: String,
    pub provider_id: String,
    pub model_id: String,
    pub display_name: String,
    pub enabled: bool,
    pub is_default: bool,
    pub capabilities: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug)]
pub(crate) struct StoredProvider {
    pub name: String,
    pub protocol: AiProtocol,
    pub base_url: String,
    pub enabled: bool,
    pub secret_slot: String,
}

#[derive(Clone, Debug)]
pub(crate) struct StoredModel {
    pub id: String,
    pub model_id: String,
    pub display_name: String,
    pub capabilities: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveProviderRequest {
    pub preset_id: Option<String>,
    pub name: String,
    pub protocol: AiProtocol,
    pub base_url: String,
    pub enabled: Option<bool>,
    pub api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateProviderRequest {
    pub preset_id: Option<String>,
    pub name: Option<String>,
    pub protocol: Option<AiProtocol>,
    pub base_url: Option<String>,
    pub enabled: Option<bool>,
    pub api_key: Option<String>,
    #[serde(default)]
    pub api_key_touched: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveModelRequest {
    pub model_id: String,
    pub display_name: Option<String>,
    pub enabled: Option<bool>,
    pub is_default: Option<bool>,
    pub capabilities: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateModelRequest {
    pub display_name: Option<String>,
    pub enabled: Option<bool>,
    pub is_default: Option<bool>,
    pub capabilities: Option<Value>,
}

#[derive(Clone, Debug)]
pub(crate) struct DiscoveredModel {
    pub model_id: String,
    pub display_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiChatSummary {
    pub id: String,
    pub title: String,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub selected_mcp_ids: Vec<String>,
    pub selected_skill_ids: Vec<String>,
    pub selected_knowledge_ids: Vec<String>,
    pub message_count: usize,
    pub last_message_preview: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub pinned_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiChatMessage {
    pub id: String,
    pub chat_id: String,
    pub turn_id: String,
    pub item_sort: i64,
    pub role: String,
    pub content: String,
    pub content_blocks: Value,
    pub provider_id: Option<String>,
    pub provider_name: Option<String>,
    pub model_id: Option<String>,
    pub model_name: Option<String>,
    pub status: String,
    pub usage: Option<Value>,
    pub citations: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiChatDetail {
    pub summary: AiChatSummary,
    pub messages: Vec<AiChatMessage>,
    pub tool_calls: Vec<AiToolCallRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateChatRequest {
    pub title: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateChatRequest {
    pub title: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub selected_mcp_ids: Option<Vec<String>>,
    pub selected_skill_ids: Option<Vec<String>>,
    pub selected_knowledge_ids: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum AiInputContentBlock {
    Text {
        text: String,
    },
    Image {
        id: Option<String>,
        path: Option<String>,
        name: Option<String>,
        mime_type: Option<String>,
        size: Option<u64>,
        data: Option<String>,
    },
    FileText {
        id: Option<String>,
        path: String,
        name: String,
        mime_type: Option<String>,
        size: Option<u64>,
        text: String,
        text_bytes: Option<u64>,
    },
    FileReference {
        id: Option<String>,
        path: String,
        name: String,
        mime_type: Option<String>,
        size: Option<u64>,
        reason: Option<String>,
        source: Option<String>,
    },
    AttachmentMetadata {
        id: Option<String>,
        name: String,
        mime_type: Option<String>,
        size: Option<u64>,
        reason: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartChatRunRequest {
    pub chat_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub turn_id: String,
    pub prompt: Option<String>,
    pub content_blocks: Option<Vec<AiInputContentBlock>>,
    pub operation: Option<String>,
    pub source_turn_id: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct ModelMessage {
    pub role: String,
    pub content: String,
    pub content_blocks: Value,
    pub tool_calls: Vec<ProviderToolCall>,
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub tool_result_is_error: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct ProviderToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Clone, Debug)]
pub(crate) struct ProviderToolCallDelta {
    pub index: usize,
    pub id: Option<String>,
    pub name: Option<String>,
    pub arguments_delta: String,
}

#[derive(Clone, Debug)]
pub(crate) enum ProviderStreamEvent {
    TextDelta(String),
    Usage(Value),
    ToolCallDelta(ProviderToolCallDelta),
}

#[derive(Clone, Debug)]
pub(crate) struct ProviderStreamOutcome {
    pub text: String,
    pub usage: Option<Value>,
    pub stop_reason: String,
    pub tool_calls: Vec<ProviderToolCall>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiToolCallRecord {
    pub id: String,
    pub chat_id: String,
    pub turn_id: String,
    pub tool_call_id: String,
    pub server_id: Option<String>,
    pub name: String,
    pub input: Value,
    pub result: Option<Value>,
    pub status: String,
    pub risk: String,
    pub approval: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApprovalDecisionRequest {
    pub decision: String,
}
