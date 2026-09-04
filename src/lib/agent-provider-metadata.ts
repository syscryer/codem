import {
  CLAUDE_CODE_PROVIDER_ID,
  DEEPSEEK_DSH_PROVIDER_ID,
  GROK_BUILD_PROVIDER_ID,
  GEMINI_CLI_PROVIDER_ID,
  HERMES_AGENT_PROVIDER_ID,
  KIMI_CODE_PROVIDER_ID,
  OPENAI_CODEX_PROVIDER_ID,
  QWEN_CODE_PROVIDER_ID,
  OPENCODE_PROVIDER_ID,
  PI_AGENT_PROVIDER_ID,
} from '../constants.js';
import type { AgentProviderId } from '../types.js';

export type AgentChatRuntimeKind = 'claude' | 'generic';

export type AgentProviderMetadata = {
  id: AgentProviderId;
  displayName: string;
  driverId: string;
  runtimeKind: AgentChatRuntimeKind;
  protocolLabel: string;
};

export const AGENT_PROVIDER_METADATA_BY_ID = {
  [CLAUDE_CODE_PROVIDER_ID]: {
    id: CLAUDE_CODE_PROVIDER_ID,
    displayName: 'Claude Code',
    driverId: 'claude-stream-json',
    runtimeKind: 'claude',
    protocolLabel: 'Claude stream-json',
  },
  [OPENAI_CODEX_PROVIDER_ID]: {
    id: OPENAI_CODEX_PROVIDER_ID,
    displayName: 'OpenAI Codex',
    driverId: 'codex-json-rpc',
    runtimeKind: 'generic',
    protocolLabel: 'Codex app-server',
  },
  [GROK_BUILD_PROVIDER_ID]: {
    id: GROK_BUILD_PROVIDER_ID,
    displayName: 'Grok Build',
    driverId: 'acp',
    runtimeKind: 'generic',
    protocolLabel: 'ACP',
  },
  [OPENCODE_PROVIDER_ID]: {
    id: OPENCODE_PROVIDER_ID,
    displayName: 'OpenCode',
    driverId: 'acp',
    runtimeKind: 'generic',
    protocolLabel: 'OpenCode ACP',
  },
  [PI_AGENT_PROVIDER_ID]: {
    id: PI_AGENT_PROVIDER_ID,
    displayName: 'Pi',
    driverId: 'pi-rpc',
    runtimeKind: 'generic',
    protocolLabel: 'Pi RPC',
  },
  [GEMINI_CLI_PROVIDER_ID]: {
    id: GEMINI_CLI_PROVIDER_ID,
    displayName: 'Gemini CLI',
    driverId: 'acp',
    runtimeKind: 'generic',
    protocolLabel: 'Gemini ACP',
  },
  [HERMES_AGENT_PROVIDER_ID]: {
    id: HERMES_AGENT_PROVIDER_ID,
    displayName: 'Hermes Agent',
    driverId: 'hermes-json-rpc',
    runtimeKind: 'generic',
    protocolLabel: 'Hermes JSON-RPC',
  },
  [DEEPSEEK_DSH_PROVIDER_ID]: {
    id: DEEPSEEK_DSH_PROVIDER_ID,
    displayName: 'DeepSeek DSH',
    driverId: 'acp',
    runtimeKind: 'generic',
    protocolLabel: 'DSH ACP',
  },
  [KIMI_CODE_PROVIDER_ID]: {
    id: KIMI_CODE_PROVIDER_ID,
    displayName: 'Kimi Code',
    driverId: 'acp',
    runtimeKind: 'generic',
    protocolLabel: 'Kimi ACP',
  },
  [QWEN_CODE_PROVIDER_ID]: {
    id: QWEN_CODE_PROVIDER_ID,
    displayName: 'Qwen Code',
    driverId: 'acp',
    runtimeKind: 'generic',
    protocolLabel: 'Qwen ACP',
  },
} satisfies Record<AgentProviderId, AgentProviderMetadata>;

export const AGENT_PROVIDER_METADATA = Object.values(AGENT_PROVIDER_METADATA_BY_ID);
export const AGENT_PROVIDER_IDS = AGENT_PROVIDER_METADATA.map((provider) => provider.id);

export function isAgentProviderId(value: unknown): value is AgentProviderId {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(AGENT_PROVIDER_METADATA_BY_ID, value);
}

export function getAgentProviderMetadata(providerId: string) {
  return isAgentProviderId(providerId)
    ? AGENT_PROVIDER_METADATA_BY_ID[providerId]
    : undefined;
}

export function getAgentProviderDisplayName(providerId: string) {
  return getAgentProviderMetadata(providerId)?.displayName ?? providerId;
}
