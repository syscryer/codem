import type { AiProviderTemplate } from '../types';

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
