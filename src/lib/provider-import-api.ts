import type {
  AgentProviderId,
  ExternalProviderImportResult,
  ExternalProviderScanResponse,
  ExternalProviderSource,
  ExternalProviderTargetKind,
} from '../types';

export type ExternalProviderImportSelection = {
  sourceId: string;
  overwriteTargetId?: string;
};

export async function scanAgentExternalProviders(
  providerId?: AgentProviderId,
  signal?: AbortSignal,
) {
  const query = providerId ? `?providerId=${encodeURIComponent(providerId)}` : '';
  return requestJson<ExternalProviderScanResponse>(
    `/api/provider-import/agent/scan${query}`,
    { signal, cache: 'no-store' },
  );
}

export async function scanChatExternalProviders(signal?: AbortSignal) {
  return requestJson<ExternalProviderScanResponse>('/api/provider-import/chat/scan', {
    signal,
    cache: 'no-store',
  });
}

export async function importAgentExternalProviders(items: ExternalProviderImportSelection[]) {
  return requestJson<{ results: ExternalProviderImportResult[] }>(
    '/api/provider-import/agent/import',
    jsonRequest({ items }),
  );
}

export async function importChatExternalProviders(items: ExternalProviderImportSelection[]) {
  return requestJson<{ results: ExternalProviderImportResult[] }>(
    '/api/provider-import/chat/import',
    jsonRequest({ items }),
  );
}

export async function syncExternalProvider(input: {
  targetKind: ExternalProviderTargetKind;
  source: ExternalProviderSource;
  sourceId: string;
}) {
  return requestJson<{ result: ExternalProviderImportResult }>(
    '/api/provider-import/sync',
    jsonRequest(input),
  );
}

export async function copyAgentChannelToChat(input: {
  channelId: string;
  overwriteProviderId?: string;
}) {
  return requestJson<{ result: ExternalProviderImportResult }>(
    '/api/provider-import/agent/copy-to-chat',
    jsonRequest(input),
  );
}

function jsonRequest(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload: ({ error?: unknown } & T) | null = null;
  if (text.trim()) {
    try {
      payload = JSON.parse(text) as ({ error?: unknown } & T);
    } catch {
      if (!response.ok) throw new Error(text);
    }
  }
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error.trim() : '';
    throw new Error(message || `外部渠道请求失败：HTTP ${response.status}`);
  }
  if (!payload) throw new Error('外部渠道响应为空');
  return payload;
}
