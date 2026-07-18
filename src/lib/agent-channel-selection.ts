import type {
  AgentChannel,
  AgentModelCatalog,
  AgentModelOption,
  AgentProviderId,
  AgentSystemChannel,
  AiProviderTemplate,
  ClaudeModelOption,
} from '../types';

export const SYSTEM_AGENT_CHANNEL_ID = 'system';

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
  channels: AgentChannel[],
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
  channels: AgentChannel[],
  providerId: string,
  channelId: string,
) {
  return channelId === SYSTEM_AGENT_CHANNEL_ID
    || Boolean(getAgentChannel(channels, providerId, channelId)?.enabled);
}

export function threadAgentChannelId(channelId?: string | null) {
  return channelId?.trim() || SYSTEM_AGENT_CHANNEL_ID;
}

export function requestAgentChannelId(channelId: string) {
  return channelId === SYSTEM_AGENT_CHANNEL_ID ? undefined : channelId;
}

export function resolveRunAgentChannelSelection({
  threadId,
  activeThreadId,
  persistedChannelId,
  selectedChannelId,
}: {
  threadId: string;
  activeThreadId: string | null;
  persistedChannelId?: string | null;
  selectedChannelId: string;
}) {
  const persisted = threadAgentChannelId(persistedChannelId);
  const selected = threadId === activeThreadId
    ? threadAgentChannelId(selectedChannelId)
    : persisted;
  return {
    channelId: requestAgentChannelId(selected),
    reuseSession: selected === persisted,
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
      return {
        ...native,
        id: model.modelId,
        label: model.displayName || model.modelId,
        model: model.modelId,
        kind: 'custom' as const,
        description: native?.description || channel.name,
        contextWindowTokens: capabilityNumber(model.capabilities, 'contextWindowTokens')
          ?? native?.contextWindowTokens,
      };
    });
}

export function buildAgentChannelModelCatalog(
  providerId: AgentProviderId,
  channel: AgentChannel | undefined,
  nativeCatalog: AgentModelCatalog | null,
) {
  if (!channel) {
    return nativeCatalog;
  }

  const enabledModels = channel.models.filter((model) => model.enabled);
  const defaultModel = enabledModels.find((model) => model.isDefault);
  return {
    providerId,
    defaultModelId: defaultModel?.modelId,
    models: enabledModels.map((model) => {
      const native = nativeCatalog?.models.find((item) => item.id === model.modelId);
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
