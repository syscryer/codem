import type { AgentProviderId, AiChatProtocol, AiProviderTemplate } from '../types';

export type AiProviderVendor = {
  id: string;
  name: string;
  icon: string;
  templates: AiProviderTemplate[];
};

export type AiProviderTemplateChannel = {
  id: string;
  name: string;
  templates: AiProviderTemplate[];
};

const protocolSearchLabels: Record<AiProviderTemplate['protocol'], string> = {
  openai_responses: 'OpenAI Responses',
  openai_chat: 'OpenAI Chat',
  anthropic_messages: 'Anthropic Claude',
  gemini_generate_content: 'Gemini Google',
};

const agentChannelProtocols: Record<AgentProviderId, readonly AiChatProtocol[]> = {
  'claude-code': ['anthropic_messages'],
  'openai-codex': ['openai_responses'],
  'grok-build': ['openai_chat', 'openai_responses', 'anthropic_messages'],
  opencode: ['openai_chat', 'openai_responses', 'anthropic_messages'],
  'pi-agent': ['openai_chat', 'openai_responses', 'anthropic_messages'],
  'gemini-cli': ['gemini_generate_content'],
  'hermes-agent': ['anthropic_messages', 'openai_chat', 'openai_responses'],
};

export function protocolsForAgent(providerId: AgentProviderId): AiChatProtocol[] {
  return [...agentChannelProtocols[providerId]];
}

export function templateSupportsAgent(template: AiProviderTemplate, providerId: AgentProviderId) {
  return agentChannelProtocols[providerId].includes(template.protocol);
}

export function agentChannelProtocolHint(
  providerId: AgentProviderId,
  protocol: AiChatProtocol,
) {
  if (providerId === 'grok-build') {
    if (protocol === 'openai_responses') {
      return '仅在上游明确提供 /responses 时使用；普通 OpenAI 兼容渠道请选择 OpenAI Chat。';
    }
    if (protocol === 'anthropic_messages') {
      return '仅在上游明确提供 Anthropic Messages 接口时使用。';
    }
    return '适用于大多数 OpenAI 兼容渠道，也是 Grok 自定义渠道的默认选项。';
  }
  if (providerId === 'opencode') {
    if (protocol === 'anthropic_messages') {
      return 'OpenCode 将通过 Anthropic AI SDK 连接此渠道。';
    }
    return protocol === 'openai_responses'
      ? 'OpenCode 将通过 OpenAI SDK 连接上游 /responses 接口。'
      : 'OpenCode 的普通 OpenAI 兼容渠道使用 Chat Completions。';
  }
  if (providerId === 'gemini-cli') {
    return 'Gemini CLI 使用原生 Gemini Generate Content 接口连接此渠道。';
  }
  if (providerId === 'hermes-agent') {
    return protocol === 'anthropic_messages'
      ? 'Hermes 将通过 Anthropic Messages 兼容接口使用该渠道。'
      : 'Hermes 将通过 OpenAI 兼容接口使用该渠道。';
  }
  return '';
}

export function groupProviderTemplates(templates: AiProviderTemplate[]) {
  const vendors = new Map<string, AiProviderVendor>();
  for (const template of templates) {
    const vendor = vendors.get(template.vendorId);
    if (vendor) {
      vendor.templates.push(template);
      continue;
    }
    vendors.set(template.vendorId, {
      id: template.vendorId,
      name: template.vendorName,
      icon: template.icon,
      templates: [template],
    });
  }
  return [...vendors.values()];
}

export function filterProviderVendors(templates: AiProviderTemplate[], query: string) {
  const vendors = groupProviderTemplates(templates);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return vendors;
  }

  return vendors.filter((vendor) =>
    [vendor.name, vendor.id, ...vendor.templates.flatMap((template) => [
      template.name,
      template.id,
      template.channelName,
      template.baseUrl,
      protocolSearchLabels[template.protocol],
    ])].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
  );
}

export function groupProviderTemplateChannels(templates: AiProviderTemplate[]) {
  const channels = new Map<string, AiProviderTemplateChannel>();
  for (const template of templates) {
    const channel = channels.get(template.channelId);
    if (channel) {
      channel.templates.push(template);
      continue;
    }
    channels.set(template.channelId, {
      id: template.channelId,
      name: template.channelName,
      templates: [template],
    });
  }
  return [...channels.values()];
}

export function filterProviderTemplates(templates: AiProviderTemplate[], query: string) {
  return filterProviderVendors(templates, query).flatMap((vendor) => vendor.templates);
}
