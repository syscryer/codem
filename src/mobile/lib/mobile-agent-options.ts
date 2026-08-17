import {
  CLAUDE_CODE_PROVIDER_ID,
  CLAUDE_EFFORT_OPTIONS,
  DEEPSEEK_DSH_PROVIDER_ID,
  DEFAULT_MODEL_VALUE,
  GEMINI_CLI_PROVIDER_ID,
  GROK_BUILD_PROVIDER_ID,
  HERMES_AGENT_PROVIDER_ID,
  OPENAI_CODEX_PROVIDER_ID,
  OPENCODE_PROVIDER_ID,
  PI_AGENT_PROVIDER_ID,
  permissionMenuModes,
} from '../../constants.js';
import { getAgentModelForSelection } from '../../lib/agent-model-selection.js';
import { permissionLabel } from '../../lib/ui-labels.js';
import type { MobileBootstrap, MobileModelCatalog } from '../types.js';

export const mobilePermissionOptions = permissionMenuModes.map((value) => ({
  value,
  label: permissionLabel(value),
  ...(value === 'bypassPermissions' ? { description: '仅用于可信项目' } : {}),
}));

export function supportsDynamicModelCatalog(providerId: string) {
  return providerId === CLAUDE_CODE_PROVIDER_ID
    || providerId === OPENAI_CODEX_PROVIDER_ID
    || providerId === GROK_BUILD_PROVIDER_ID
    || providerId === OPENCODE_PROVIDER_ID
    || providerId === PI_AGENT_PROVIDER_ID
    || providerId === GEMINI_CLI_PROVIDER_ID
    || providerId === HERMES_AGENT_PROVIDER_ID
    || providerId === DEEPSEEK_DSH_PROVIDER_ID;
}

export function channelModelCatalog(
  providerId: string,
  models: MobileBootstrap['channels']['channels'][number]['models'],
  nativeCatalog?: MobileModelCatalog,
): MobileModelCatalog {
  return {
    providerId,
    defaultModelId: models.find((option) => option.isDefault)?.modelId,
    models: models.map((option) => {
      const native = nativeCatalog?.models.find((item) => (
        item.id === option.modelId || item.id.endsWith(`/${option.modelId}`)
      ));
      const configuredEfforts = reasoningEffortsFromCapabilities(option.capabilities);
      return {
        id: option.modelId,
        label: option.displayName,
        description: native?.description,
        contextWindowTokens: native?.contextWindowTokens,
        isDefault: option.isDefault,
        defaultReasoningEffort: capabilityString(option.capabilities, 'defaultReasoningEffort')
          ?? native?.defaultReasoningEffort,
        supportedReasoningEfforts: configuredEfforts.length > 0
          ? configuredEfforts
          : native?.supportedReasoningEfforts ?? [],
      };
    }),
  };
}

export function mobileReasoningOptions(
  providerId: string,
  catalog: MobileModelCatalog | undefined,
  modelId: string,
) {
  if (providerId === CLAUDE_CODE_PROVIDER_ID) {
    return CLAUDE_EFFORT_OPTIONS.map((option) => ({ ...option }));
  }
  if (!catalog || catalog.providerId !== providerId) return [];
  const selected = getAgentModelForSelection(catalog, modelId || DEFAULT_MODEL_VALUE);
  return (selected?.supportedReasoningEfforts ?? []).map((option) => ({
    value: option.id,
    label: agentEffortLabel(option.id),
    description: option.description,
  }));
}

export function defaultMobileReasoningEffort(
  providerId: string,
  catalog: MobileModelCatalog | undefined,
  modelId: string,
) {
  if (providerId === CLAUDE_CODE_PROVIDER_ID) return 'default';
  const options = mobileReasoningOptions(providerId, catalog, modelId);
  if (!catalog || catalog.providerId !== providerId) return '';
  const selected = getAgentModelForSelection(catalog, modelId || DEFAULT_MODEL_VALUE);
  return selected?.defaultReasoningEffort || options[0]?.value || '';
}

export function mobileReasoningEffortRequest(providerId: string, effort: string) {
  if (!effort || (providerId === CLAUDE_CODE_PROVIDER_ID && effort === 'default')) return undefined;
  return effort;
}

function capabilityString(capabilities: Record<string, unknown> | undefined, key: string) {
  const value = capabilities?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function reasoningEffortsFromCapabilities(capabilities: Record<string, unknown> | undefined) {
  const value = capabilities?.reasoningEfforts;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [{ id: item.trim() }];
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    if (!id) return [];
    return [{
      id,
      ...(typeof candidate.description === 'string' ? { description: candidate.description } : {}),
    }];
  });
}

function agentEffortLabel(effort: string) {
  if (effort.toLowerCase() === 'xhigh') return 'XHigh';
  return effort ? `${effort.charAt(0).toUpperCase()}${effort.slice(1)}` : '默认';
}
