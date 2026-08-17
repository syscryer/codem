import type { MobileAuthStatus, MobileBootstrap, MobileModelCatalog, MobileThreadPage } from '../types';
import type { InputContentBlock, RuntimeSuggestedAction } from '../../types';

export type MobileSendRequest = {
  prompt: string;
  mode: 'follow-up' | 'guide';
  model?: string | null;
  reasoningEffort?: string | null;
  permissionMode?: string;
  channelId?: string | null;
  contentBlocks: InputContentBlock[];
  recoveryAction?: RuntimeSuggestedAction;
};

export type MobileTaskSettingsRequest = Pick<
  MobileSendRequest,
  'model' | 'reasoningEffort' | 'permissionMode' | 'channelId'
>;

export class MobileApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/mobile${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new MobileApiError(body?.error || `请求失败 (${response.status})`, response.status);
  }
  return response.json() as Promise<T>;
}

export const mobileApi = {
  authStatus: () => request<MobileAuthStatus>('/auth/status'),
  login: (username: string, password: string, deviceName: string) => request<MobileAuthStatus>('/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password, deviceName }),
  }),
  bootstrap: () => request<MobileBootstrap>('/bootstrap'),
  models: (providerId: string, channelId?: string) => request<MobileModelCatalog>(`/providers/${encodeURIComponent(providerId)}/models${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ''}`),
  thread: (threadId: string, cursor?: string) => request<MobileThreadPage>(`/tasks/${encodeURIComponent(threadId)}${cursor ? `?before=${encodeURIComponent(cursor)}` : ''}`),
  updateSettings: (threadId: string, body: MobileTaskSettingsRequest) => request(`/tasks/${encodeURIComponent(threadId)}/settings`, { method: 'PATCH', body: JSON.stringify(body) }),
  createTask: (body: unknown) => request<{ threadId: string }>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  send: (threadId: string, body: MobileSendRequest) => request(`/tasks/${encodeURIComponent(threadId)}/send`, { method: 'POST', body: JSON.stringify(body) }),
  stop: (threadId: string) => request(`/tasks/${encodeURIComponent(threadId)}/stop`, { method: 'POST', body: '{}' }),
  approval: (threadId: string, requestId: string, approved: boolean) => request(`/tasks/${encodeURIComponent(threadId)}/approval`, { method: 'POST', body: JSON.stringify({ requestId, approved }) }),
  userInput: (threadId: string, requestId: string, answers: Record<string, string>, questions?: unknown[]) => request(`/tasks/${encodeURIComponent(threadId)}/user-input`, { method: 'POST', body: JSON.stringify({ requestId, answers, questions }) }),
};
