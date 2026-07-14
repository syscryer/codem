import type {
  AiChatBootstrap,
  AiChatDetail,
  AiChatProvider,
  AiKnowledgeBaseDetail,
  AiKnowledgeBaseSummary,
  AiKnowledgeCitation,
  AiProviderTemplate,
  InputContentBlock,
} from '../types';

type ChatResponse = { chat: AiChatDetail };

export async function loadAiChatBootstrap(signal?: AbortSignal) {
  return requestJson<AiChatBootstrap>('/api/ai/bootstrap', { signal });
}

export async function loadAiProviderTemplates(signal?: AbortSignal) {
  const payload = await requestJson<{ templates: AiProviderTemplate[] }>(
    '/api/ai/providers/templates',
    { signal },
  );
  return payload.templates;
}

export async function createAiChat(input: {
  title?: string;
  providerId?: string;
  modelId?: string;
}) {
  const payload = await requestJson<ChatResponse>('/api/ai/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return payload.chat;
}

export async function loadAiChat(chatId: string, signal?: AbortSignal) {
  const payload = await requestJson<ChatResponse>(`/api/ai/chats/${encodeURIComponent(chatId)}`, {
    signal,
  });
  return payload.chat;
}

export async function updateAiChat(
  chatId: string,
  input: {
    title?: string;
    providerId?: string;
    modelId?: string;
    selectedMcpIds?: string[];
    selectedSkillIds?: string[];
    selectedKnowledgeIds?: string[];
  },
) {
  const payload = await requestJson<ChatResponse>(`/api/ai/chats/${encodeURIComponent(chatId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return payload.chat;
}

export async function pinAiChat(chatId: string, pinned: boolean) {
  const payload = await requestJson<ChatResponse>(
    `/api/ai/chats/${encodeURIComponent(chatId)}/pin`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned }),
    },
  );
  return payload.chat;
}

export async function clearAiChat(chatId: string) {
  const payload = await requestJson<ChatResponse>(
    `/api/ai/chats/${encodeURIComponent(chatId)}/clear`,
    { method: 'POST' },
  );
  return payload.chat;
}

export async function deleteAiChat(chatId: string) {
  return requestJson<{ deleted: boolean }>(`/api/ai/chats/${encodeURIComponent(chatId)}`, {
    method: 'DELETE',
  });
}

export async function deleteAiChatTurn(chatId: string, turnId: string) {
  const payload = await requestJson<ChatResponse>(
    `/api/ai/chats/${encodeURIComponent(chatId)}/turns/${encodeURIComponent(turnId)}`,
    { method: 'DELETE' },
  );
  return payload.chat;
}

export async function loadAiKnowledgeBases(signal?: AbortSignal) {
  const payload = await requestJson<{ knowledgeBases: AiKnowledgeBaseSummary[] }>(
    '/api/ai/knowledge-bases',
    { signal },
  );
  return payload.knowledgeBases;
}

export async function createAiKnowledgeBase(input: { name: string; description?: string }) {
  const payload = await requestJson<{ knowledgeBase: AiKnowledgeBaseDetail }>(
    '/api/ai/knowledge-bases',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return payload.knowledgeBase;
}

export async function loadAiKnowledgeBase(knowledgeBaseId: string, signal?: AbortSignal) {
  const payload = await requestJson<{ knowledgeBase: AiKnowledgeBaseDetail }>(
    `/api/ai/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`,
    { signal },
  );
  return payload.knowledgeBase;
}

export async function updateAiKnowledgeBase(
  knowledgeBaseId: string,
  input: { name?: string; description?: string; chunkSize?: number; chunkOverlap?: number },
) {
  const payload = await requestJson<{ knowledgeBase: AiKnowledgeBaseDetail }>(
    `/api/ai/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return payload.knowledgeBase;
}

export async function importAiKnowledgeSources(
  knowledgeBaseId: string,
  input: { path?: string; text?: string; name?: string },
) {
  return requestJson<{ knowledgeBase: AiKnowledgeBaseDetail }>(
    `/api/ai/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/sources/import`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export async function deleteAiKnowledgeSource(knowledgeBaseId: string, sourceId: string) {
  return requestJson<{ deleted: boolean }>(
    `/api/ai/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/sources/${encodeURIComponent(sourceId)}`,
    { method: 'DELETE' },
  );
}

export async function rebuildAiKnowledgeBase(knowledgeBaseId: string) {
  const payload = await requestJson<{ knowledgeBase: AiKnowledgeBaseDetail }>(
    `/api/ai/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/rebuild`,
    { method: 'POST' },
  );
  return payload.knowledgeBase;
}

export async function deleteAiKnowledgeBase(knowledgeBaseId: string) {
  return requestJson<{ deleted: boolean }>(
    `/api/ai/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`,
    { method: 'DELETE' },
  );
}

export async function searchAiKnowledge(input: {
  query: string;
  knowledgeBaseIds: string[];
  limit?: number;
}) {
  const payload = await requestJson<{ hits: AiKnowledgeCitation[] }>('/api/ai/knowledge/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return payload.hits;
}

export async function createAiProvider(input: {
  presetId?: string;
  name: string;
  protocol: string;
  baseUrl: string;
  enabled?: boolean;
  apiKey?: string;
}) {
  const payload = await requestJson<{ provider: AiChatProvider }>('/api/ai/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return payload.provider;
}

export async function updateAiProvider(
  providerId: string,
  input: {
    presetId?: string;
    name?: string;
    protocol?: string;
    baseUrl?: string;
    enabled?: boolean;
    apiKey?: string;
    apiKeyTouched?: boolean;
  },
) {
  const payload = await requestJson<{ provider: AiChatProvider }>(
    `/api/ai/providers/${encodeURIComponent(providerId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return payload.provider;
}

export async function deleteAiProvider(providerId: string) {
  return requestJson<{ deleted: boolean }>(`/api/ai/providers/${encodeURIComponent(providerId)}`, {
    method: 'DELETE',
  });
}

export async function testAiProvider(providerId: string) {
  return requestJson<{ ok: boolean; message: string }>(
    `/api/ai/providers/${encodeURIComponent(providerId)}/test`,
    { method: 'POST' },
  );
}

export async function refreshAiProviderModels(providerId: string) {
  return requestJson<{ models: AiChatProvider['models'] }>(
    `/api/ai/providers/${encodeURIComponent(providerId)}/models/refresh`,
    { method: 'POST' },
  );
}

export async function createAiModel(
  providerId: string,
  input: {
    modelId: string;
    displayName?: string;
    enabled?: boolean;
    isDefault?: boolean;
    capabilities?: Record<string, unknown>;
  },
) {
  return requestJson<{ models: AiChatProvider['models'] }>(
    `/api/ai/providers/${encodeURIComponent(providerId)}/models`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export async function updateAiModel(
  modelId: string,
  input: {
    displayName?: string;
    enabled?: boolean;
    isDefault?: boolean;
    capabilities?: Record<string, unknown>;
  },
) {
  return requestJson<{ models: AiChatProvider['models'] }>(
    `/api/ai/models/${encodeURIComponent(modelId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export async function deleteAiModel(modelId: string) {
  return requestJson<{ deleted: boolean }>(`/api/ai/models/${encodeURIComponent(modelId)}`, {
    method: 'DELETE',
  });
}

export async function startAiChatRun(input: {
  chatId: string;
  providerId: string;
  modelId: string;
  turnId: string;
  prompt: string;
  contentBlocks: InputContentBlock[];
  operation?: 'regenerate' | 'retry' | 'edit';
  sourceTurnId?: string;
}, signal: AbortSignal) {
  const response = await fetch('/api/ai/chat/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) {
    throw new Error((await readError(response)) || '普通聊天启动失败');
  }
  return response;
}

export async function cancelAiChatRun(runId: string) {
  return requestJson<{ cancelled: boolean }>(`/api/ai/chat/run/${encodeURIComponent(runId)}`, {
    method: 'DELETE',
  });
}

export async function submitAiChatApproval(
  runId: string,
  requestId: string,
  decision: 'approve' | 'reject',
) {
  return requestJson<{ accepted: boolean }>(
    `/api/ai/chat/run/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(requestId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    },
  );
}

export async function loadActiveAiChatRun(chatId: string, signal?: AbortSignal) {
  const payload = await requestJson<{ runId: string | null }>(
    `/api/ai/chat/runs/active/${encodeURIComponent(chatId)}`,
    { signal },
  );
  return payload.runId;
}

export async function reconnectAiChatRun(runId: string, signal: AbortSignal, after = 0) {
  const response = await fetch(
    `/api/ai/chat/run/${encodeURIComponent(runId)}/events?after=${Math.max(0, after)}`,
    { signal },
  );
  if (!response.ok) {
    throw new Error((await readError(response)) || '普通聊天运行重连失败');
  }
  return response;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error((await readError(response)) || `请求失败：HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function readError(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    return '';
  }
  try {
    const payload = JSON.parse(text) as { error?: unknown };
    return typeof payload.error === 'string' ? payload.error : text;
  } catch {
    return text;
  }
}
