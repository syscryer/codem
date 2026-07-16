import type {
  AgentChannel,
  AgentChannelBootstrap,
  AgentChannelModel,
  AgentProviderId,
  AiChatProtocol,
  AiDiscoveredModel,
} from '../types';

export type SaveAgentChannelInput = {
  providerId: AgentProviderId;
  name: string;
  protocol: AiChatProtocol;
  baseUrl: string;
  modelsUrl?: string;
  enabled?: boolean;
  isDefault?: boolean;
  apiKey?: string;
  models?: SaveAgentChannelModelInput[];
};

export type UpdateAgentChannelInput = Partial<Omit<SaveAgentChannelInput, 'providerId' | 'models'>> & {
  apiKeyTouched?: boolean;
};

export type SaveAgentChannelModelInput = {
  modelId: string;
  displayName?: string;
  enabled?: boolean;
  isDefault?: boolean;
  capabilities?: Record<string, unknown>;
};

export type UpdateAgentChannelModelInput = {
  displayName?: string;
  enabled?: boolean;
  isDefault?: boolean;
  capabilities?: Record<string, unknown>;
};

export async function fetchAgentChannelBootstrap(signal?: AbortSignal) {
  return requestJson<AgentChannelBootstrap>('/api/agents/channels/bootstrap', { signal });
}

export async function createAgentChannel(input: SaveAgentChannelInput) {
  return requestJson<{ channel: AgentChannel }>('/api/agents/channels', jsonRequest('POST', input));
}

export async function updateAgentChannel(channelId: string, input: UpdateAgentChannelInput) {
  return requestJson<{ channel: AgentChannel }>(
    `/api/agents/channels/${encodeURIComponent(channelId)}`,
    jsonRequest('PATCH', input),
  );
}

export async function deleteAgentChannel(channelId: string) {
  return requestJson<{ ok: true }>(
    `/api/agents/channels/${encodeURIComponent(channelId)}`,
    { method: 'DELETE' },
  );
}

export async function revealAgentChannelApiKey(channelId: string) {
  return requestJson<{ apiKey: string }>(
    `/api/agents/channels/${encodeURIComponent(channelId)}/api-key`,
    { cache: 'no-store' },
  );
}

export async function testAgentChannel(channelId: string) {
  return requestJson<{ ok: true; message: string }>(
    `/api/agents/channels/${encodeURIComponent(channelId)}/test`,
    { method: 'POST' },
  );
}

export async function discoverAgentChannelModels(channelId: string) {
  return requestJson<{ models: AiDiscoveredModel[] }>(
    `/api/agents/channels/${encodeURIComponent(channelId)}/models/discover`,
    { method: 'POST' },
  );
}

export async function addAgentChannelModels(channelId: string, models: SaveAgentChannelModelInput[]) {
  return requestJson<{ models: AgentChannelModel[] }>(
    `/api/agents/channels/${encodeURIComponent(channelId)}/models/batch`,
    jsonRequest('POST', { models }),
  );
}

export async function addAgentChannelModel(channelId: string, model: SaveAgentChannelModelInput) {
  return requestJson<{ models: AgentChannelModel[] }>(
    `/api/agents/channels/${encodeURIComponent(channelId)}/models`,
    jsonRequest('POST', model),
  );
}

export async function updateAgentChannelModel(modelId: string, input: UpdateAgentChannelModelInput) {
  return requestJson<{ models: AgentChannelModel[] }>(
    `/api/agents/channel-models/${encodeURIComponent(modelId)}`,
    jsonRequest('PATCH', input),
  );
}

export async function deleteAgentChannelModel(modelId: string) {
  return requestJson<{ ok: true }>(
    `/api/agents/channel-models/${encodeURIComponent(modelId)}`,
    { method: 'DELETE' },
  );
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null) as ({ error?: unknown } & T) | null;
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error.trim() : '';
    throw new Error(message || 'Agent 渠道请求失败');
  }
  if (!payload) {
    throw new Error('Agent 渠道响应为空');
  }
  return payload;
}
