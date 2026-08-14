use serde::Serialize;
use serde_json::{Map, Value};
use tokio::sync::oneshot;

pub const CLAUDE_CODE_PROVIDER_ID: &str = "claude-code";
pub const GROK_BUILD_PROVIDER_ID: &str = "grok-build";
pub const OPENAI_CODEX_PROVIDER_ID: &str = "openai-codex";
pub const OPENCODE_PROVIDER_ID: &str = "opencode";
pub const PI_AGENT_PROVIDER_ID: &str = "pi-agent";
pub const GEMINI_CLI_PROVIDER_ID: &str = "gemini-cli";
pub const HERMES_AGENT_PROVIDER_ID: &str = "hermes-agent";
pub const DEEPSEEK_DSH_PROVIDER_ID: &str = "deepseek-dsh";
pub const CODEM_AGENT_PROVIDER_ID: &str = "codem-agent";
pub const DEFAULT_AGENT_PERMISSION_MODE: &str = "default";
pub const DEFAULT_GROK_PERMISSION_MODE: &str = DEFAULT_AGENT_PERMISSION_MODE;

pub fn is_active_agent_provider_id(provider_id: &str) -> bool {
    matches!(
        provider_id,
        CLAUDE_CODE_PROVIDER_ID
            | GROK_BUILD_PROVIDER_ID
            | OPENAI_CODEX_PROVIDER_ID
            | OPENCODE_PROVIDER_ID
            | PI_AGENT_PROVIDER_ID
            | GEMINI_CLI_PROVIDER_ID
            | HERMES_AGENT_PROVIDER_ID
            | DEEPSEEK_DSH_PROVIDER_ID
    )
}

pub fn normalize_agent_permission_mode(value: Option<&str>) -> Option<&'static str> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        None | Some("default") => Some(DEFAULT_AGENT_PERMISSION_MODE),
        Some("auto") => Some("auto"),
        Some("bypassPermissions") => Some("bypassPermissions"),
        Some(_) => None,
    }
}

pub fn normalize_grok_permission_mode(value: Option<&str>) -> Option<&'static str> {
    normalize_agent_permission_mode(value)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentPermissionDecision {
    Approve,
    Reject,
}

#[derive(Debug)]
pub enum AgentControlCommand {
    Guide {
        text: String,
        acknowledgement: oneshot::Sender<Result<(), String>>,
    },
    Permission {
        request_id: String,
        decision: AgentPermissionDecision,
        option_id: Option<String>,
        acknowledgement: oneshot::Sender<Result<(), String>>,
    },
    UserInput {
        request_id: String,
        answers: Map<String, Value>,
        acknowledgement: oneshot::Sender<Result<(), String>>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentProviderLifecycle {
    Active,
    Planned,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentCapabilitySupport {
    Supported,
    Unsupported,
    RuntimeDetected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentCancelSupport {
    None,
    Hard,
    Soft,
    RuntimeDetected,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionCapabilities {
    pub create: AgentCapabilitySupport,
    pub resume: AgentCapabilitySupport,
    pub list: AgentCapabilitySupport,
    pub import: AgentCapabilitySupport,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInputCapabilities {
    pub text: AgentCapabilitySupport,
    pub images: AgentCapabilitySupport,
    pub file_references: AgentCapabilitySupport,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolCapabilities {
    pub streaming: AgentCapabilitySupport,
    pub approval: AgentCapabilitySupport,
    pub user_input: AgentCapabilitySupport,
    pub mcp: AgentCapabilitySupport,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeCapabilities {
    pub cancel: AgentCancelSupport,
    pub reconnect: AgentCapabilitySupport,
    pub concurrent_sessions: AgentCapabilitySupport,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilities {
    pub sessions: AgentSessionCapabilities,
    pub input: AgentInputCapabilities,
    pub tools: AgentToolCapabilities,
    pub runtime: AgentRuntimeCapabilities,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderDescriptor {
    pub id: &'static str,
    pub display_name: &'static str,
    pub driver_id: &'static str,
    pub lifecycle: AgentProviderLifecycle,
    pub available: Option<bool>,
    pub selectable: bool,
    pub capabilities: AgentCapabilities,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderRegistry {
    pub providers: Vec<AgentProviderDescriptor>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalOption {
    pub id: String,
    pub label: String,
    pub kind: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalRequest {
    pub request_id: String,
    pub kind: String,
    pub title: String,
    pub description: Option<String>,
    pub danger: String,
    pub options: Vec<AgentApprovalOption>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUserInputOption {
    pub label: String,
    pub value: String,
    pub description: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUserInputQuestion {
    pub id: String,
    pub header: Option<String>,
    pub question: String,
    pub input_type: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<AgentUserInputOption>,
    pub multi_select: bool,
    pub required: bool,
    pub secret: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUserInputRequest {
    pub request_id: String,
    pub title: Option<String>,
    pub description: String,
    pub questions: Vec<AgentUserInputQuestion>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsageSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_creation_input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read_input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_context_window: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_used_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_system_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_tools_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_message_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_token_duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_token_steps: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decode_duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decode_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_cost_usd: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentCompactionSource {
    Manual,
    Automatic,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentCompactionStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentCompactCapabilityState {
    Supported,
    Unsupported,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCompactCapabilitySummary {
    pub state: AgentCompactCapabilityState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

const MAX_AGENT_PLAN_STEPS: usize = 64;
const MAX_AGENT_PLAN_TEXT_BYTES: usize = 8 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentPlanStepStatus {
    Pending,
    InProgress,
    Completed,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanStep {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub content: String,
    pub status: AgentPlanStepStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub blocked_by: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explanation: Option<String>,
    pub steps: Vec<AgentPlanStep>,
}

pub fn agent_plan_snapshot_from_tool_input(
    tool_name: &str,
    input: &Value,
) -> Option<AgentPlanSnapshot> {
    let normalized_name = tool_name
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    let object = input.as_object()?;
    let has_todos = object
        .get("todos")
        .is_some_and(|value| value.is_array() || value.is_object());
    let has_other_plan_collection = ["plan", "steps"].into_iter().any(|key| {
        object
            .get(key)
            .is_some_and(|value| value.is_array() || value.is_object())
    });
    let is_plan_tool = ["todo", "plan", "task", "progress"]
        .into_iter()
        .any(|marker| normalized_name.contains(marker));
    if !has_todos && !(has_other_plan_collection && is_plan_tool) {
        return None;
    }
    agent_plan_snapshot_from_value(input)
}

pub fn agent_plan_snapshot_from_value(value: &Value) -> Option<AgentPlanSnapshot> {
    let (collection, explanation, singular) = if value.is_array() {
        (value, None, false)
    } else {
        let root = value.as_object()?;
        let state = root.get("state").and_then(Value::as_object).unwrap_or(root);
        let (collection_key, collection) = ["todos", "plan", "steps", "tasks", "task"]
            .into_iter()
            .find_map(|key| state.get(key).map(|value| (key, value)))?;
        let explanation = root
            .get("explanation")
            .or_else(|| state.get("explanation"))
            .and_then(Value::as_str)
            .map(bounded_plan_string)
            .filter(|value| !value.is_empty());
        (collection, explanation, collection_key == "task")
    };

    let mut steps = Vec::new();
    if singular {
        if let Some(step) = normalize_agent_plan_step(collection, None) {
            steps.push(step);
        }
        return Some(AgentPlanSnapshot { explanation, steps });
    }
    match collection {
        Value::Array(items) => {
            for item in items.iter().take(MAX_AGENT_PLAN_STEPS) {
                if let Some(step) = normalize_agent_plan_step(item, None) {
                    steps.push(step);
                }
            }
        }
        Value::Object(items) => {
            for (id, item) in items.iter().take(MAX_AGENT_PLAN_STEPS) {
                if let Some(step) = normalize_agent_plan_step(item, Some(id)) {
                    steps.push(step);
                }
            }
        }
        _ => return None,
    }

    Some(AgentPlanSnapshot { explanation, steps })
}

fn normalize_agent_plan_step(value: &Value, fallback_id: Option<&str>) -> Option<AgentPlanStep> {
    let item = value.as_object()?;
    let content = ["content", "step", "subject", "text", "title", "description"]
        .into_iter()
        .find_map(|key| item.get(key).and_then(Value::as_str))
        .map(bounded_plan_string)
        .filter(|value| !value.is_empty())?;
    let id = ["id", "taskId", "task_id"]
        .into_iter()
        .find_map(|key| item.get(key).and_then(Value::as_str))
        .or(fallback_id)
        .map(bounded_plan_string)
        .filter(|value| !value.is_empty());
    let status = match item
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .replace(['-', ' '], "_")
        .as_str()
    {
        "pending" | "todo" | "not_started" => AgentPlanStepStatus::Pending,
        "inprogress" | "in_progress" | "running" | "active" => AgentPlanStepStatus::InProgress,
        "completed" | "complete" | "done" | "cancelled" | "canceled" | "deleted" => {
            AgentPlanStepStatus::Completed
        }
        _ => AgentPlanStepStatus::Unknown,
    };
    let priority = item
        .get("priority")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| matches!(value.as_str(), "high" | "medium" | "low"));
    let owner = item
        .get("owner")
        .and_then(Value::as_str)
        .map(bounded_plan_string)
        .filter(|value| !value.is_empty());
    let blocked_by = item
        .get("blockedBy")
        .or_else(|| item.get("blocked_by"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .take(MAX_AGENT_PLAN_STEPS)
        .map(bounded_plan_string)
        .filter(|value| !value.is_empty())
        .collect();

    Some(AgentPlanStep {
        id,
        content,
        status,
        priority,
        owner,
        blocked_by,
    })
}

fn bounded_plan_string(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= MAX_AGENT_PLAN_TEXT_BYTES {
        return trimmed.to_string();
    }
    let mut end = MAX_AGENT_PLAN_TEXT_BYTES;
    while end > 0 && !trimmed.is_char_boundary(end) {
        end -= 1;
    }
    trimmed[..end].to_string()
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum AgentRunEvent {
    Status {
        run_id: String,
        message: String,
    },
    Phase {
        run_id: String,
        phase: String,
        label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        thought_count: Option<u64>,
    },
    Session {
        run_id: String,
        session_id: String,
    },
    Delta {
        run_id: String,
        text: String,
    },
    ThinkingDelta {
        run_id: String,
        text: String,
    },
    PlanUpdated {
        run_id: String,
        plan: AgentPlanSnapshot,
    },
    Usage {
        run_id: String,
        #[serde(flatten)]
        usage: AgentUsageSnapshot,
        usage_source: &'static str,
    },
    RequestUserInput {
        run_id: String,
        request: AgentUserInputRequest,
    },
    ApprovalRequest {
        run_id: String,
        request: AgentApprovalRequest,
    },
    ToolStart {
        run_id: String,
        block_index: u64,
        tool_use_id: String,
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<Value>,
    },
    ToolStop {
        run_id: String,
        block_index: u64,
        tool_use_id: String,
    },
    ToolResult {
        run_id: String,
        tool_use_id: String,
        content: String,
        is_error: bool,
    },
    ContextCompaction {
        run_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        operation_id: Option<String>,
        source: AgentCompactionSource,
        status: AgentCompactionStatus,
        provider_thread_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        provider_turn_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        provider_item_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
        at_ms: i64,
    },
    Done {
        run_id: String,
        session_id: String,
        result: String,
        stop_reason: String,
        #[serde(flatten)]
        usage: AgentUsageSnapshot,
        usage_source: &'static str,
    },
    Error {
        run_id: String,
        message: String,
    },
}

pub fn agent_provider_registry(
    claude_available: bool,
    grok_available: bool,
    codex_available: bool,
    opencode_available: bool,
    pi_available: bool,
    gemini_available: bool,
    hermes_available: bool,
    dsh_available: bool,
) -> AgentProviderRegistry {
    let grok_provider = AgentProviderDescriptor {
        id: GROK_BUILD_PROVIDER_ID,
        display_name: "Grok Build",
        driver_id: "acp",
        lifecycle: AgentProviderLifecycle::Active,
        available: Some(grok_available),
        selectable: grok_available,
        capabilities: grok_capabilities(),
    };
    let codex_provider = AgentProviderDescriptor {
        id: OPENAI_CODEX_PROVIDER_ID,
        display_name: "OpenAI Codex",
        driver_id: "codex-json-rpc",
        lifecycle: AgentProviderLifecycle::Active,
        available: Some(codex_available),
        selectable: codex_available,
        capabilities: codex_capabilities(),
    };
    let opencode_provider = AgentProviderDescriptor {
        id: OPENCODE_PROVIDER_ID,
        display_name: "OpenCode",
        driver_id: "acp",
        lifecycle: AgentProviderLifecycle::Active,
        available: Some(opencode_available),
        selectable: opencode_available,
        capabilities: opencode_capabilities(),
    };
    let pi_provider = AgentProviderDescriptor {
        id: PI_AGENT_PROVIDER_ID,
        display_name: "Pi",
        driver_id: "pi-rpc",
        lifecycle: AgentProviderLifecycle::Active,
        available: Some(pi_available),
        selectable: pi_available,
        capabilities: pi_capabilities(),
    };
    let gemini_provider = AgentProviderDescriptor {
        id: GEMINI_CLI_PROVIDER_ID,
        display_name: "Gemini CLI",
        driver_id: "acp",
        lifecycle: AgentProviderLifecycle::Active,
        available: Some(gemini_available),
        selectable: gemini_available,
        capabilities: gemini_capabilities(),
    };
    let hermes_provider = AgentProviderDescriptor {
        id: HERMES_AGENT_PROVIDER_ID,
        display_name: "Hermes Agent",
        driver_id: "hermes-json-rpc",
        lifecycle: AgentProviderLifecycle::Active,
        available: Some(hermes_available),
        selectable: hermes_available,
        capabilities: hermes_capabilities(),
    };
    let dsh_provider = AgentProviderDescriptor {
        id: DEEPSEEK_DSH_PROVIDER_ID,
        display_name: "DeepSeek DSH",
        driver_id: "dsh-web-api",
        lifecycle: AgentProviderLifecycle::Active,
        available: Some(dsh_available),
        selectable: dsh_available,
        capabilities: dsh_capabilities(),
    };

    AgentProviderRegistry {
        providers: vec![
            AgentProviderDescriptor {
                id: CLAUDE_CODE_PROVIDER_ID,
                display_name: "Claude Code",
                driver_id: "claude-stream-json",
                lifecycle: AgentProviderLifecycle::Active,
                available: Some(claude_available),
                selectable: claude_available,
                capabilities: claude_capabilities(),
            },
            grok_provider,
            codex_provider,
            opencode_provider,
            pi_provider,
            gemini_provider,
            hermes_provider,
            dsh_provider,
            planned_provider(CODEM_AGENT_PROVIDER_ID, "CodeM Agent", "acp"),
        ],
    }
}

fn planned_provider(
    id: &'static str,
    display_name: &'static str,
    driver_id: &'static str,
) -> AgentProviderDescriptor {
    AgentProviderDescriptor {
        id,
        display_name,
        driver_id,
        lifecycle: AgentProviderLifecycle::Planned,
        available: None,
        selectable: false,
        capabilities: runtime_detected_capabilities(),
    }
}

fn claude_capabilities() -> AgentCapabilities {
    use AgentCapabilitySupport::Supported;

    AgentCapabilities {
        sessions: AgentSessionCapabilities {
            create: Supported,
            resume: Supported,
            list: Supported,
            import: Supported,
        },
        input: AgentInputCapabilities {
            text: Supported,
            images: Supported,
            file_references: Supported,
        },
        tools: AgentToolCapabilities {
            streaming: Supported,
            approval: Supported,
            user_input: Supported,
            mcp: Supported,
        },
        runtime: AgentRuntimeCapabilities {
            cancel: AgentCancelSupport::Soft,
            reconnect: Supported,
            concurrent_sessions: Supported,
        },
    }
}

fn grok_capabilities() -> AgentCapabilities {
    use AgentCapabilitySupport::{RuntimeDetected, Supported, Unsupported};

    AgentCapabilities {
        sessions: AgentSessionCapabilities {
            create: Supported,
            resume: Supported,
            list: Unsupported,
            import: Unsupported,
        },
        input: AgentInputCapabilities {
            text: Supported,
            images: Supported,
            file_references: Supported,
        },
        tools: AgentToolCapabilities {
            streaming: Supported,
            approval: Supported,
            user_input: Supported,
            mcp: RuntimeDetected,
        },
        runtime: AgentRuntimeCapabilities {
            cancel: AgentCancelSupport::Soft,
            reconnect: Supported,
            concurrent_sessions: Supported,
        },
    }
}

fn codex_capabilities() -> AgentCapabilities {
    use AgentCapabilitySupport::{RuntimeDetected, Supported, Unsupported};

    AgentCapabilities {
        sessions: AgentSessionCapabilities {
            create: Supported,
            resume: Supported,
            list: Unsupported,
            import: Unsupported,
        },
        input: AgentInputCapabilities {
            text: Supported,
            images: Supported,
            file_references: Supported,
        },
        tools: AgentToolCapabilities {
            streaming: Supported,
            approval: Supported,
            user_input: Supported,
            mcp: RuntimeDetected,
        },
        runtime: AgentRuntimeCapabilities {
            cancel: AgentCancelSupport::Soft,
            reconnect: Supported,
            concurrent_sessions: Supported,
        },
    }
}

fn opencode_capabilities() -> AgentCapabilities {
    use AgentCapabilitySupport::{RuntimeDetected, Supported, Unsupported};

    AgentCapabilities {
        sessions: AgentSessionCapabilities {
            create: Supported,
            resume: Supported,
            list: Supported,
            import: Unsupported,
        },
        input: AgentInputCapabilities {
            text: Supported,
            images: Supported,
            file_references: Supported,
        },
        tools: AgentToolCapabilities {
            streaming: Supported,
            approval: Supported,
            user_input: Supported,
            mcp: RuntimeDetected,
        },
        runtime: AgentRuntimeCapabilities {
            cancel: AgentCancelSupport::Soft,
            reconnect: Supported,
            concurrent_sessions: Supported,
        },
    }
}

fn pi_capabilities() -> AgentCapabilities {
    use AgentCapabilitySupport::{Supported, Unsupported};

    AgentCapabilities {
        sessions: AgentSessionCapabilities {
            create: Supported,
            resume: Supported,
            list: Supported,
            import: Unsupported,
        },
        input: AgentInputCapabilities {
            text: Supported,
            images: Supported,
            file_references: Supported,
        },
        tools: AgentToolCapabilities {
            streaming: Supported,
            approval: Supported,
            user_input: Supported,
            mcp: Unsupported,
        },
        runtime: AgentRuntimeCapabilities {
            cancel: AgentCancelSupport::Soft,
            reconnect: Supported,
            concurrent_sessions: Supported,
        },
    }
}

fn gemini_capabilities() -> AgentCapabilities {
    use AgentCapabilitySupport::{Supported, Unsupported};

    AgentCapabilities {
        sessions: AgentSessionCapabilities {
            create: Supported,
            resume: Supported,
            list: Unsupported,
            import: Unsupported,
        },
        input: AgentInputCapabilities {
            text: Supported,
            images: Supported,
            file_references: Supported,
        },
        tools: AgentToolCapabilities {
            streaming: Supported,
            approval: Supported,
            user_input: Supported,
            mcp: Supported,
        },
        runtime: AgentRuntimeCapabilities {
            cancel: AgentCancelSupport::Soft,
            reconnect: Supported,
            concurrent_sessions: Supported,
        },
    }
}

fn hermes_capabilities() -> AgentCapabilities {
    use AgentCapabilitySupport::{RuntimeDetected, Supported, Unsupported};

    AgentCapabilities {
        sessions: AgentSessionCapabilities {
            create: Supported,
            resume: Supported,
            list: Supported,
            import: Unsupported,
        },
        input: AgentInputCapabilities {
            text: Supported,
            images: RuntimeDetected,
            file_references: Supported,
        },
        tools: AgentToolCapabilities {
            streaming: Supported,
            approval: Supported,
            user_input: Supported,
            mcp: Supported,
        },
        runtime: AgentRuntimeCapabilities {
            cancel: AgentCancelSupport::Soft,
            reconnect: Supported,
            concurrent_sessions: Supported,
        },
    }
}

fn dsh_capabilities() -> AgentCapabilities {
    use AgentCapabilitySupport::{Supported, Unsupported};

    AgentCapabilities {
        sessions: AgentSessionCapabilities {
            create: Supported,
            resume: Supported,
            list: Supported,
            import: Unsupported,
        },
        input: AgentInputCapabilities {
            text: Supported,
            images: Unsupported,
            file_references: Supported,
        },
        tools: AgentToolCapabilities {
            streaming: Supported,
            approval: Supported,
            user_input: Supported,
            mcp: Supported,
        },
        runtime: AgentRuntimeCapabilities {
            cancel: AgentCancelSupport::Soft,
            reconnect: Supported,
            concurrent_sessions: Supported,
        },
    }
}

fn runtime_detected_capabilities() -> AgentCapabilities {
    use AgentCapabilitySupport::RuntimeDetected;

    AgentCapabilities {
        sessions: AgentSessionCapabilities {
            create: RuntimeDetected,
            resume: RuntimeDetected,
            list: RuntimeDetected,
            import: RuntimeDetected,
        },
        input: AgentInputCapabilities {
            text: RuntimeDetected,
            images: RuntimeDetected,
            file_references: RuntimeDetected,
        },
        tools: AgentToolCapabilities {
            streaming: RuntimeDetected,
            approval: RuntimeDetected,
            user_input: RuntimeDetected,
            mcp: RuntimeDetected,
        },
        runtime: AgentRuntimeCapabilities {
            cancel: AgentCancelSupport::RuntimeDetected,
            reconnect: RuntimeDetected,
            concurrent_sessions: RuntimeDetected,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{
        agent_plan_snapshot_from_tool_input, agent_plan_snapshot_from_value,
        agent_provider_registry, is_active_agent_provider_id, normalize_grok_permission_mode,
        AgentApprovalOption, AgentApprovalRequest, AgentCancelSupport, AgentCapabilitySupport,
        AgentCompactionSource, AgentCompactionStatus, AgentPlanStepStatus, AgentProviderLifecycle,
        AgentRunEvent, CLAUDE_CODE_PROVIDER_ID, DEEPSEEK_DSH_PROVIDER_ID, GEMINI_CLI_PROVIDER_ID,
        GROK_BUILD_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID, OPENCODE_PROVIDER_ID,
        PI_AGENT_PROVIDER_ID,
    };
    use serde_json::json;
    use std::collections::HashSet;

    #[test]
    fn agent_plan_normalizes_codex_grok_and_opencode_shapes() {
        let codex = agent_plan_snapshot_from_value(&json!({
            "explanation": "执行顺序",
            "plan": [
                { "step": "检查项目", "status": "inProgress" },
                { "step": "运行测试", "status": "pending" }
            ]
        }))
        .expect("Codex plan");
        assert_eq!(codex.explanation.as_deref(), Some("执行顺序"));
        assert_eq!(codex.steps[0].status, AgentPlanStepStatus::InProgress);

        let grok = agent_plan_snapshot_from_value(&json!({
            "type": "Todo",
            "todos": {
                "2": { "content": "验证结果", "status": "completed" },
                "1": { "content": "定位问题", "status": "in_progress" }
            }
        }))
        .expect("Grok todos");
        assert_eq!(grok.steps.len(), 2);
        assert_eq!(grok.steps[0].id.as_deref(), Some("1"));

        let opencode = agent_plan_snapshot_from_tool_input(
            "todowrite",
            &json!({
                "todos": [{
                    "content": "实现修复",
                    "status": "cancelled",
                    "priority": "high"
                }]
            }),
        )
        .expect("OpenCode todos");
        assert_eq!(opencode.steps[0].status, AgentPlanStepStatus::Completed);
        assert_eq!(opencode.steps[0].priority.as_deref(), Some("high"));
    }

    #[test]
    fn agent_plan_event_uses_stable_camel_case_contract() {
        let plan = agent_plan_snapshot_from_value(&json!({
            "todos": [{
                "id": "task-1",
                "content": "检查项目",
                "status": "in_progress",
                "blockedBy": ["task-0"]
            }]
        }))
        .expect("plan");
        assert_eq!(
            serde_json::to_value(AgentRunEvent::PlanUpdated {
                run_id: "run-1".to_string(),
                plan,
            })
            .expect("serialize"),
            json!({
                "type": "plan-updated",
                "runId": "run-1",
                "plan": {
                    "steps": [{
                        "id": "task-1",
                        "content": "检查项目",
                        "status": "in_progress",
                        "blockedBy": ["task-0"]
                    }]
                }
            })
        );
    }

    #[test]
    fn context_compaction_event_uses_stable_camel_case_contract() {
        let event = AgentRunEvent::ContextCompaction {
            run_id: "run-1".to_string(),
            operation_id: Some("compact-1".to_string()),
            source: AgentCompactionSource::Manual,
            status: AgentCompactionStatus::Running,
            provider_thread_id: "provider-thread-1".to_string(),
            provider_turn_id: Some("provider-turn-1".to_string()),
            provider_item_id: Some("provider-item-1".to_string()),
            error: None,
            at_ms: 1_754_000_000_000,
        };

        assert_eq!(
            serde_json::to_value(event).expect("serialize"),
            json!({
                "type": "context-compaction",
                "runId": "run-1",
                "operationId": "compact-1",
                "source": "manual",
                "status": "running",
                "providerThreadId": "provider-thread-1",
                "providerTurnId": "provider-turn-1",
                "providerItemId": "provider-item-1",
                "atMs": 1754000000000_i64
            })
        );
    }

    #[test]
    fn agent_runtime_registry_keeps_provider_ids_unique() {
        let registry =
            agent_provider_registry(true, false, false, false, false, false, false, false);
        let ids = registry
            .providers
            .iter()
            .map(|provider| provider.id)
            .collect::<HashSet<_>>();

        assert_eq!(ids.len(), registry.providers.len());
    }

    #[test]
    fn active_provider_id_validation_covers_the_registry() {
        let registry = agent_provider_registry(true, true, true, true, true, true, true, false);
        let active_ids = registry
            .providers
            .iter()
            .filter(|provider| provider.lifecycle == AgentProviderLifecycle::Active)
            .map(|provider| provider.id)
            .collect::<Vec<_>>();

        assert!(active_ids
            .iter()
            .all(|provider_id| is_active_agent_provider_id(provider_id)));
        assert!(!is_active_agent_provider_id("codem-agent"));
        assert!(!is_active_agent_provider_id("future-provider"));
    }

    #[test]
    fn grok_permission_modes_default_and_reject_unknown_values() {
        assert_eq!(normalize_grok_permission_mode(None), Some("default"));
        assert_eq!(normalize_grok_permission_mode(Some("  ")), Some("default"));
        assert_eq!(normalize_grok_permission_mode(Some("auto")), Some("auto"));
        assert_eq!(
            normalize_grok_permission_mode(Some("bypassPermissions")),
            Some("bypassPermissions")
        );
        assert_eq!(normalize_grok_permission_mode(Some("dontAsk")), None);
    }

    #[test]
    fn agent_runtime_registry_keeps_supported_agents_active() {
        let registry =
            agent_provider_registry(true, false, false, false, false, false, false, false);
        let active = registry
            .providers
            .iter()
            .filter(|provider| provider.lifecycle == AgentProviderLifecycle::Active)
            .collect::<Vec<_>>();

        assert_eq!(active.len(), 8);
        let claude = active
            .iter()
            .find(|provider| provider.id == CLAUDE_CODE_PROVIDER_ID)
            .expect("Claude provider");
        assert_eq!(claude.available, Some(true));
        assert!(claude.selectable);
        assert_eq!(
            claude.capabilities.tools.approval,
            AgentCapabilitySupport::Supported
        );
    }

    #[test]
    fn agent_runtime_registry_never_selects_planned_providers() {
        let registry =
            agent_provider_registry(false, false, false, false, false, false, false, false);

        for provider in registry
            .providers
            .iter()
            .filter(|provider| provider.lifecycle == AgentProviderLifecycle::Planned)
        {
            assert_eq!(provider.available, None);
            assert!(!provider.selectable);
            assert_eq!(
                provider.capabilities.sessions.create,
                AgentCapabilitySupport::RuntimeDetected
            );
        }

        let claude = registry
            .providers
            .iter()
            .find(|provider| provider.id == CLAUDE_CODE_PROVIDER_ID)
            .expect("Claude provider");
        assert_eq!(claude.available, Some(false));
        assert!(!claude.selectable);
    }

    #[test]
    fn agent_runtime_registry_selects_grok_when_cli_is_available() {
        let unavailable =
            agent_provider_registry(true, false, false, false, false, false, false, false);
        let grok = unavailable
            .providers
            .iter()
            .find(|provider| provider.id == GROK_BUILD_PROVIDER_ID)
            .expect("Grok provider");
        assert_eq!(grok.lifecycle, AgentProviderLifecycle::Active);
        assert_eq!(grok.available, Some(false));
        assert!(!grok.selectable);

        let available =
            agent_provider_registry(true, true, false, false, false, false, false, false);
        let grok = available
            .providers
            .iter()
            .find(|provider| provider.id == GROK_BUILD_PROVIDER_ID)
            .expect("Grok provider");
        assert_eq!(grok.available, Some(true));
        assert!(grok.selectable);
        assert_eq!(
            grok.capabilities.input.images,
            AgentCapabilitySupport::Supported
        );
        assert_eq!(
            grok.capabilities.input.file_references,
            AgentCapabilitySupport::Supported
        );
        assert_eq!(
            grok.capabilities.tools.approval,
            AgentCapabilitySupport::Supported
        );
    }

    #[test]
    fn agent_runtime_registry_selects_codex_when_cli_is_available() {
        let unavailable =
            agent_provider_registry(true, true, false, false, false, false, false, false);
        let codex = unavailable
            .providers
            .iter()
            .find(|provider| provider.id == OPENAI_CODEX_PROVIDER_ID)
            .expect("Codex provider");
        assert_eq!(codex.lifecycle, AgentProviderLifecycle::Active);
        assert_eq!(codex.available, Some(false));
        assert!(!codex.selectable);

        let available =
            agent_provider_registry(true, false, true, false, false, false, false, false);
        let codex = available
            .providers
            .iter()
            .find(|provider| provider.id == OPENAI_CODEX_PROVIDER_ID)
            .expect("Codex provider");
        assert_eq!(codex.available, Some(true));
        assert!(codex.selectable);
        assert_eq!(
            codex.capabilities.input.images,
            AgentCapabilitySupport::Supported
        );
        assert_eq!(
            codex.capabilities.input.file_references,
            AgentCapabilitySupport::Supported
        );
        assert_eq!(
            codex.capabilities.tools.approval,
            AgentCapabilitySupport::Supported
        );
        assert_eq!(codex.capabilities.runtime.cancel, AgentCancelSupport::Soft);
    }

    #[test]
    fn agent_runtime_registry_selects_opencode_when_cli_is_available() {
        let unavailable =
            agent_provider_registry(true, true, true, false, false, false, false, false);
        let opencode = unavailable
            .providers
            .iter()
            .find(|provider| provider.id == OPENCODE_PROVIDER_ID)
            .expect("OpenCode provider");
        assert_eq!(opencode.lifecycle, AgentProviderLifecycle::Active);
        assert_eq!(opencode.available, Some(false));
        assert!(!opencode.selectable);

        let available =
            agent_provider_registry(true, false, false, true, false, false, false, false);
        let opencode = available
            .providers
            .iter()
            .find(|provider| provider.id == OPENCODE_PROVIDER_ID)
            .expect("OpenCode provider");
        assert_eq!(opencode.available, Some(true));
        assert!(opencode.selectable);
        assert_eq!(
            opencode.capabilities.sessions.list,
            AgentCapabilitySupport::Supported
        );
        assert_eq!(
            opencode.capabilities.tools.mcp,
            AgentCapabilitySupport::RuntimeDetected
        );
        assert_eq!(
            opencode.capabilities.runtime.cancel,
            AgentCancelSupport::Soft
        );
    }

    #[test]
    fn agent_runtime_registry_selects_pi_when_cli_is_available() {
        let registry =
            agent_provider_registry(false, false, false, false, true, false, false, false);
        let pi = registry
            .providers
            .iter()
            .find(|provider| provider.id == PI_AGENT_PROVIDER_ID)
            .expect("Pi provider");

        assert_eq!(pi.driver_id, "pi-rpc");
        assert_eq!(pi.lifecycle, AgentProviderLifecycle::Active);
        assert_eq!(pi.available, Some(true));
        assert!(pi.selectable);
        assert_eq!(
            pi.capabilities.tools.mcp,
            AgentCapabilitySupport::Unsupported
        );
        assert_eq!(pi.capabilities.runtime.cancel, AgentCancelSupport::Soft);
    }

    #[test]
    fn agent_runtime_registry_selects_gemini_when_cli_is_available() {
        let registry =
            agent_provider_registry(false, false, false, false, false, true, false, false);
        let gemini = registry
            .providers
            .iter()
            .find(|provider| provider.id == GEMINI_CLI_PROVIDER_ID)
            .expect("Gemini provider");

        assert_eq!(gemini.driver_id, "acp");
        assert_eq!(gemini.lifecycle, AgentProviderLifecycle::Active);
        assert_eq!(gemini.available, Some(true));
        assert!(gemini.selectable);
        assert_eq!(
            gemini.capabilities.tools.mcp,
            AgentCapabilitySupport::Supported
        );
        assert_eq!(gemini.capabilities.runtime.cancel, AgentCancelSupport::Soft);
    }

    #[test]
    fn agent_runtime_registry_selects_dsh_when_cli_is_available() {
        let registry =
            agent_provider_registry(false, false, false, false, false, false, false, true);
        let dsh = registry
            .providers
            .iter()
            .find(|provider| provider.id == DEEPSEEK_DSH_PROVIDER_ID)
            .expect("DSH provider");

        assert_eq!(dsh.driver_id, "dsh-web-api");
        assert_eq!(dsh.lifecycle, AgentProviderLifecycle::Active);
        assert_eq!(dsh.available, Some(true));
        assert!(dsh.selectable);
        assert_eq!(
            dsh.capabilities.sessions.resume,
            AgentCapabilitySupport::Supported
        );
        assert_eq!(dsh.capabilities.runtime.cancel, AgentCancelSupport::Soft);
    }

    #[test]
    fn agent_run_events_serialize_with_the_frontend_contract() {
        let done = serde_json::to_value(AgentRunEvent::Done {
            run_id: "run-1".to_string(),
            session_id: "session-1".to_string(),
            result: "ok".to_string(),
            stop_reason: "cancelled".to_string(),
            usage: super::AgentUsageSnapshot::default(),
            usage_source: "result",
        })
        .unwrap();
        assert_eq!(
            done,
            json!({
                "type": "done",
                "runId": "run-1",
                "sessionId": "session-1",
                "result": "ok",
                "stopReason": "cancelled",
                "usageSource": "result"
            })
        );

        let approval = serde_json::to_value(AgentRunEvent::ApprovalRequest {
            run_id: "run-1".to_string(),
            request: AgentApprovalRequest {
                request_id: "request-1".to_string(),
                kind: "permission".to_string(),
                title: "Run command".to_string(),
                description: None,
                danger: "medium".to_string(),
                options: vec![AgentApprovalOption {
                    id: "allow-once".to_string(),
                    label: "Allow once".to_string(),
                    kind: "allow_once".to_string(),
                }],
            },
        })
        .unwrap();
        assert_eq!(approval["type"], "approval-request");
        assert_eq!(approval["runId"], "run-1");
        assert_eq!(approval["request"]["requestId"], "request-1");
        assert_eq!(approval["request"]["options"][0]["id"], "allow-once");

        let thinking = serde_json::to_value(AgentRunEvent::ThinkingDelta {
            run_id: "run-1".to_string(),
            text: "checking files".to_string(),
        })
        .unwrap();
        assert_eq!(
            thinking,
            json!({
                "type": "thinking-delta",
                "runId": "run-1",
                "text": "checking files"
            })
        );
    }
}
