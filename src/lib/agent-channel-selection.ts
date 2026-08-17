import type {
  AgentChannel,
  AgentModelCatalog,
  AgentModelOption,
  AgentProviderId,
  AgentSystemChannel,
  AiProviderTemplate,
  ClaudeModelOption,
} from '../types';
import {
  CLAUDE_CODE_PROVIDER_ID,
  DEFAULT_MODEL_VALUE,
  HERMES_AGENT_PROVIDER_ID,
  OPENAI_CODEX_PROVIDER_ID,
} from '../constants';

export const SYSTEM_AGENT_CHANNEL_ID = 'system';

type AgentChannelSelectionEntry = {
  id: string;
  providerId: string;
  enabled: boolean;
  isDefault: boolean;
};

export function getAgentChannel(
  channels: AgentChannel[],
  providerId: string,
  channelId: string,
) {
  if (!channelId || channelId === SYSTEM_AGENT_CHANNEL_ID) {
    return undefined;
  }
  return channels.find((channel) => channel.id === channelId && channel.providerId === providerId);
}

export function enabledAgentChannels(channels: AgentChannel[], providerId: string) {
  return channels.filter((channel) => channel.providerId === providerId && channel.enabled);
}

export function agentChannelTemplate(
  channel: AgentChannel,
  templates: AiProviderTemplate[],
) {
  const persisted = channel.templateId
    ? templates.find((template) => template.id === channel.templateId)
    : undefined;
  if (persisted) return persisted;
  const baseUrl = normalizedChannelBaseUrl(channel.baseUrl);
  return templates.find(
    (template) => template.protocol === channel.protocol
      && normalizedChannelBaseUrl(template.baseUrl) === baseUrl,
  );
}

export function systemAgentChannelTemplate(
  channel: AgentSystemChannel | undefined | null,
  templates: AiProviderTemplate[],
) {
  if (!channel) return undefined;
  const baseUrl = channel.baseUrl ? normalizedChannelBaseUrl(channel.baseUrl) : '';
  const providerName = channel.ccSwitchProviderName?.toLocaleLowerCase() ?? '';
  return templates.find((template) => Boolean(baseUrl)
    && normalizedChannelBaseUrl(template.baseUrl) === baseUrl
    && (!channel.protocol || channel.protocol === template.protocol))
    ?? templates.find((template) => providerName.includes(template.vendorName.toLocaleLowerCase()))
    ?? templates.find((template) => providerName.includes(template.vendorId.toLocaleLowerCase()));
}

export function defaultAgentChannelId(
  channels: AgentChannelSelectionEntry[],
  providerId: string,
  configuredChannelId?: string | null,
) {
  const candidate = configuredChannelId?.trim()
    || channels.find(
      (channel) => channel.providerId === providerId && channel.enabled && channel.isDefault,
    )?.id;
  return candidate && isAgentChannelSelectionAvailable(channels, providerId, candidate)
    ? candidate
    : SYSTEM_AGENT_CHANNEL_ID;
}

export function isAgentChannelSelectionAvailable(
  channels: AgentChannelSelectionEntry[],
  providerId: string,
  channelId: string,
) {
  return channelId === SYSTEM_AGENT_CHANNEL_ID
    || Boolean(channels.find((channel) => channel.id === channelId && channel.providerId === providerId)?.enabled);
}

export function threadAgentChannelId(channelId?: string | null) {
  return channelId?.trim() || SYSTEM_AGENT_CHANNEL_ID;
}

export function shouldPreservePendingAgentChannelSelection({
  selectedChannelId,
  pendingChannelId,
  hasSelectedChannel,
}: {
  selectedChannelId: string;
  pendingChannelId: string | null;
  hasSelectedChannel: boolean;
}) {
  return !hasSelectedChannel
    && selectedChannelId !== SYSTEM_AGENT_CHANNEL_ID
    && pendingChannelId === selectedChannelId;
}

export function requestAgentChannelId(channelId: string) {
  return channelId === SYSTEM_AGENT_CHANNEL_ID ? undefined : channelId;
}

export function agentChannelMetadataPatch(providerId: string, channelId: string) {
  return {
    channelId: requestAgentChannelId(channelId) ?? null,
    model: null,
    reasoningEffort: null,
    ...(agentSessionIsChannelBound(providerId) ? { sessionId: null } : {}),
  };
}

function agentSessionIsChannelBound(providerId: string) {
  return providerId === OPENAI_CODEX_PROVIDER_ID;
}

export function resolveRunAgentChannelSelection({
  providerId,
  threadId,
  activeThreadId,
  persistedChannelId,
  selectedChannelId,
}: {
  providerId: string;
  threadId: string;
  activeThreadId: string | null;
  persistedChannelId?: string | null;
  selectedChannelId: string;
}) {
  const persisted = threadAgentChannelId(persistedChannelId);
  const selected = threadId === activeThreadId
    ? threadAgentChannelId(selectedChannelId)
    : persisted;
  const channelChanged = selected !== persisted;
  return {
    channelId: requestAgentChannelId(selected),
    channelChanged,
    // Codex sessions are channel-bound. Hermes switches the model/provider on
    // its persistent session through the native gateway protocol.
    reuseSession: !agentSessionIsChannelBound(providerId) || !channelChanged,
  };
}

export function buildClaudeChannelModels(
  channel: AgentChannel | undefined,
  nativeModels: ClaudeModelOption[],
) {
  if (!channel) {
    return nativeModels;
  }
  return channel.models
    .filter((model) => model.enabled)
    .map((model) => {
      const native = nativeModels.find(
        (item) => item.id === model.modelId || item.model === model.modelId,
      );
      const supportsContext1m = agentChannelModelSupportsContext1m(model);
      return {
        ...native,
        id: model.modelId,
        label: model.displayName || model.modelId,
        model: claudeContextModelId(model),
        kind: 'custom' as const,
        description: native?.description || channel.name,
        contextWindowTokens: supportsContext1m
          ? 1_000_000
          : capabilityNumber(model.capabilities, 'contextWindowTokens') ?? native?.contextWindowTokens,
      };
    });
}

export function agentChannelModelSupportsContext1m(
  model: Pick<AgentChannel['models'][number], 'modelId' | 'capabilities'>,
) {
  const configured = model.capabilities.supportsContext1m;
  return typeof configured === 'boolean'
    ? configured
    : /\[1m\]$/i.test(model.modelId.trim());
}

function claudeContextModelId(
  model: Pick<AgentChannel['models'][number], 'modelId' | 'capabilities'>,
) {
  const baseModelId = model.modelId.trim().replace(/\[1m\]$/i, '');
  return agentChannelModelSupportsContext1m(model) ? `${baseModelId}[1m]` : baseModelId;
}

export function buildAgentChannelModelCatalog(
  providerId: AgentProviderId,
  channel: AgentChannel | undefined,
  nativeCatalog: AgentModelCatalog | null,
) {
  if (!channel) {
    return withKnownAgentModelCapabilities(providerId, nativeCatalog);
  }

  const enabledModels = channel.models.filter((model) => model.enabled);
  // Hermes reasoning is a runtime capability. A custom channel may only
  // configure its endpoint and credentials, so keep the native default model
  // as the selection anchor instead of hiding the shared Brain control.
  if (providerId === HERMES_AGENT_PROVIDER_ID && enabledModels.length === 0) {
    const nativeDefault = nativeCatalog?.models.find((model) => model.id === DEFAULT_MODEL_VALUE);
    return withKnownAgentModelCapabilities(providerId, {
      providerId,
      defaultModelId: DEFAULT_MODEL_VALUE,
      models: [{
        id: DEFAULT_MODEL_VALUE,
        label: nativeDefault?.label || 'Hermes 配置默认模型',
        description: nativeDefault?.description || channel.name,
        contextWindowTokens: nativeDefault?.contextWindowTokens,
        isDefault: true,
        defaultReasoningEffort: nativeDefault?.defaultReasoningEffort,
        supportedReasoningEfforts: nativeDefault?.supportedReasoningEfforts ?? [],
      }],
    });
  }

  const defaultModel = enabledModels.find((model) => model.isDefault);
  return withKnownAgentModelCapabilities(providerId, {
    providerId,
    defaultModelId: defaultModel?.modelId,
    models: enabledModels.map((model) => {
      const native = nativeCatalog?.models.find((item) =>
        item.id === model.modelId || item.id.endsWith(`/${model.modelId}`));
      const configuredEfforts = capabilityReasoningEfforts(model.capabilities);
      return {
        id: model.modelId,
        label: model.displayName || model.modelId,
        description: native?.description || channel.name,
        contextWindowTokens: capabilityNumber(model.capabilities, 'contextWindowTokens')
          ?? native?.contextWindowTokens,
        isDefault: model.isDefault,
        defaultReasoningEffort: capabilityString(model.capabilities, 'defaultReasoningEffort')
          ?? native?.defaultReasoningEffort,
        supportedReasoningEfforts: configuredEfforts.length > 0
          ? configuredEfforts
          : native?.supportedReasoningEfforts ?? [],
      } satisfies AgentModelOption;
    }),
  } satisfies AgentModelCatalog);
}

export function buildAgentSystemChannelModelCatalog(
  providerId: AgentProviderId,
  channel: AgentSystemChannel | undefined,
  nativeCatalog: AgentModelCatalog | null,
) {
  const configuredModelId = channel?.model?.trim();
  const nativeModel = configuredModelId
    ? nativeCatalog?.models.find((model) => model.id === configuredModelId)
    : nativeCatalog?.models.find((model) => model.isDefault) ?? nativeCatalog?.models[0];
  const modelId = configuredModelId || nativeModel?.id;
  if (!modelId) {
    return null;
  }
  return withKnownAgentModelCapabilities(providerId, {
    providerId,
    defaultModelId: modelId,
    models: [{
      id: modelId,
      label: nativeModel?.label || modelId,
      description: nativeModel?.description || channel?.detail,
      contextWindowTokens: nativeModel?.contextWindowTokens,
      isDefault: true,
      defaultReasoningEffort: nativeModel?.defaultReasoningEffort,
      supportedReasoningEfforts: nativeModel?.supportedReasoningEfforts ?? [],
    }],
  });
}

function withKnownAgentModelCapabilities(
  providerId: AgentProviderId,
  catalog: AgentModelCatalog | null,
) {
  if (!catalog) {
    return catalog;
  }
  return {
    ...catalog,
    models: catalog.models.map((model) => {
      if (model.supportedReasoningEfforts.length > 0) {
        return model;
      }
      if (providerId === 'hermes-agent') {
        return {
          ...model,
          defaultReasoningEffort: model.defaultReasoningEffort || 'medium',
          supportedReasoningEfforts: [
            { id: 'none', description: '关闭思考' },
            { id: 'minimal', description: '最少思考' },
            { id: 'low', description: '较快响应' },
            { id: 'medium', description: '平衡速度和推理' },
            { id: 'high', description: '适合复杂任务' },
            { id: 'xhigh', description: '更深入的推理' },
            { id: 'max', description: '最大思考强度' },
            { id: 'ultra', description: '最高思考强度' },
          ],
        };
      }
      if (providerId === CLAUDE_CODE_PROVIDER_ID) {
        return {
          ...model,
          supportedReasoningEfforts: [
            { id: 'low', description: '更快，适合简单修改' },
            { id: 'medium', description: '平衡速度和推理' },
            { id: 'high', description: '复杂代码和排查问题' },
            { id: 'xhigh', description: '更深入的推理' },
            { id: 'max', description: '当前会话最高努力级别' },
            { id: 'ultracode', description: 'xhigh 与自动 workflows，仅当前会话' },
          ],
        };
      }
      return model;
    }),
  } satisfies AgentModelCatalog;
}

function capabilityNumber(capabilities: Record<string, unknown>, key: string) {
  const value = capabilities[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizedChannelBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '').toLocaleLowerCase();
}

function capabilityString(capabilities: Record<string, unknown>, key: string) {
  const value = capabilities[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function capabilityReasoningEfforts(capabilities: Record<string, unknown>) {
  const value = capabilities.reasoningEfforts;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) {
      const id = item.trim();
      return [{ id, label: id }];
    }
    if (!item || typeof item !== 'object') {
      return [];
    }
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    if (!id) {
      return [];
    }
    return [{
      id,
      label: typeof candidate.label === 'string' && candidate.label.trim()
        ? candidate.label.trim()
        : id,
      description: typeof candidate.description === 'string' && candidate.description.trim()
        ? candidate.description.trim()
        : undefined,
    }];
  });
}
