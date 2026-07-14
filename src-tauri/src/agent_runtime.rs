use serde::Serialize;
use serde_json::{Map, Value};
use tokio::sync::oneshot;

pub const CLAUDE_CODE_PROVIDER_ID: &str = "claude-code";
pub const GROK_BUILD_PROVIDER_ID: &str = "grok-build";
pub const OPENAI_CODEX_PROVIDER_ID: &str = "openai-codex";
pub const CODEM_AGENT_PROVIDER_ID: &str = "codem-agent";
pub const DEFAULT_AGENT_PERMISSION_MODE: &str = "default";
pub const DEFAULT_GROK_PERMISSION_MODE: &str = DEFAULT_AGENT_PERMISSION_MODE;

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
    pub total_cost_usd: Option<f64>,
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
    experimental_agent_run_enabled: bool,
    grok_available: bool,
    codex_available: bool,
) -> AgentProviderRegistry {
    let grok_provider = if experimental_agent_run_enabled {
        AgentProviderDescriptor {
            id: GROK_BUILD_PROVIDER_ID,
            display_name: "Grok Build",
            driver_id: "acp",
            lifecycle: AgentProviderLifecycle::Active,
            available: Some(grok_available),
            selectable: grok_available,
            capabilities: grok_capabilities(),
        }
    } else {
        planned_provider(GROK_BUILD_PROVIDER_ID, "Grok Build", "acp")
    };
    let codex_provider = if experimental_agent_run_enabled {
        AgentProviderDescriptor {
            id: OPENAI_CODEX_PROVIDER_ID,
            display_name: "OpenAI Codex",
            driver_id: "codex-json-rpc",
            lifecycle: AgentProviderLifecycle::Active,
            available: Some(codex_available),
            selectable: codex_available,
            capabilities: codex_capabilities(),
        }
    } else {
        planned_provider(OPENAI_CODEX_PROVIDER_ID, "OpenAI Codex", "codex-json-rpc")
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
        agent_provider_registry, normalize_grok_permission_mode, AgentApprovalOption,
        AgentApprovalRequest, AgentCancelSupport, AgentCapabilitySupport, AgentProviderLifecycle,
        AgentRunEvent, CLAUDE_CODE_PROVIDER_ID, GROK_BUILD_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID,
    };
    use serde_json::json;
    use std::collections::HashSet;

    #[test]
    fn agent_runtime_registry_keeps_provider_ids_unique() {
        let registry = agent_provider_registry(true, false, false, false);
        let ids = registry
            .providers
            .iter()
            .map(|provider| provider.id)
            .collect::<HashSet<_>>();

        assert_eq!(ids.len(), registry.providers.len());
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
    fn agent_runtime_registry_keeps_claude_as_the_only_active_provider() {
        let registry = agent_provider_registry(true, false, false, false);
        let active = registry
            .providers
            .iter()
            .filter(|provider| provider.lifecycle == AgentProviderLifecycle::Active)
            .collect::<Vec<_>>();

        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, CLAUDE_CODE_PROVIDER_ID);
        assert_eq!(active[0].available, Some(true));
        assert!(active[0].selectable);
        assert_eq!(
            active[0].capabilities.tools.approval,
            AgentCapabilitySupport::Supported
        );
    }

    #[test]
    fn agent_runtime_registry_never_selects_planned_providers() {
        let registry = agent_provider_registry(false, false, false, false);

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
    fn agent_runtime_registry_enables_grok_only_when_experiment_and_cli_are_available() {
        let unavailable = agent_provider_registry(true, true, false, false);
        let grok = unavailable
            .providers
            .iter()
            .find(|provider| provider.id == GROK_BUILD_PROVIDER_ID)
            .expect("Grok provider");
        assert_eq!(grok.lifecycle, AgentProviderLifecycle::Active);
        assert_eq!(grok.available, Some(false));
        assert!(!grok.selectable);

        let available = agent_provider_registry(true, true, true, false);
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
    fn agent_runtime_registry_enables_codex_only_when_experiment_and_cli_are_available() {
        let unavailable = agent_provider_registry(true, true, true, false);
        let codex = unavailable
            .providers
            .iter()
            .find(|provider| provider.id == OPENAI_CODEX_PROVIDER_ID)
            .expect("Codex provider");
        assert_eq!(codex.lifecycle, AgentProviderLifecycle::Active);
        assert_eq!(codex.available, Some(false));
        assert!(!codex.selectable);

        let available = agent_provider_registry(true, true, false, true);
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
    }
}
