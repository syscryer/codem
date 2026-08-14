type HermesValue = Record<string, unknown>;

async function requestJson<T extends HermesValue>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null) as (T & { error?: unknown }) | null;
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : 'Hermes 请求失败';
    throw new Error(message);
  }
  if (!payload) throw new Error('Hermes 返回为空');
  return payload;
}

function jsonRequest(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

export function fetchHermesBootstrap() {
  return requestJson<HermesValue>('/api/agents/hermes/bootstrap', { cache: 'no-store' });
}

export function selectHermesProfile(profile: string) {
  return requestJson<HermesValue>('/api/agents/hermes/profiles/select', jsonRequest('POST', { profile }));
}

export function fetchHermesProfiles() {
  return requestJson<HermesValue>('/api/agents/hermes/profiles', { cache: 'no-store' });
}

export function fetchHermesProfileSoul(profile: string) {
  return requestJson<HermesValue>(`/api/agents/hermes/profiles/${encodeURIComponent(profile)}/soul`, { cache: 'no-store' });
}

export function saveHermesProfileSoul(profile: string, value: HermesValue) {
  return requestJson<HermesValue>(
    `/api/agents/hermes/profiles/${encodeURIComponent(profile)}/soul`,
    jsonRequest('PUT', value),
  );
}

export function fetchHermesResource(resource: 'memory' | 'learning' | 'skills' | 'mcp/servers' | 'status' | 'logs' | 'gateway/logs') {
  return requestJson<HermesValue>(`/api/agents/hermes/${resource}`, { cache: 'no-store' });
}

export function toggleHermesSkill(body: HermesValue) {
  return requestJson<HermesValue>('/api/agents/hermes/skills/toggle', jsonRequest('PUT', body));
}

export function fetchHermesLearningNode(id: string) {
  return requestJson<HermesValue>(`/api/agents/hermes/learning/node?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
}

export function saveHermesLearningNode(body: HermesValue) {
  return requestJson<HermesValue>('/api/agents/hermes/learning/node', jsonRequest('PUT', body));
}

export function deleteHermesLearningNode(body: HermesValue) {
  return requestJson<HermesValue>('/api/agents/hermes/learning/node', jsonRequest('DELETE', body));
}

export function fetchHermesSkillContent(name: string) {
  return requestJson<HermesValue>(`/api/agents/hermes/skills/content?name=${encodeURIComponent(name)}`, { cache: 'no-store' });
}

export function toggleHermesMcp(name: string, enabled: boolean) {
  return requestJson<HermesValue>(
    `/api/agents/hermes/mcp/servers/${encodeURIComponent(name)}/enabled`,
    jsonRequest('PUT', { enabled }),
  );
}

export function testHermesMcp(name: string) {
  return requestJson<HermesValue>(`/api/agents/hermes/mcp/servers/${encodeURIComponent(name)}/test`, jsonRequest('POST', {}));
}

export function createHermesMcp(body: HermesValue) {
  return requestJson<HermesValue>('/api/agents/hermes/mcp/servers', jsonRequest('POST', body));
}

export function saveHermesMcpServers(servers: HermesValue) {
  return requestJson<HermesValue>('/api/agents/hermes/mcp/servers', jsonRequest('PUT', { servers }));
}

export function deleteHermesMcp(name: string) {
  return requestJson<HermesValue>(`/api/agents/hermes/mcp/servers/${encodeURIComponent(name)}`, jsonRequest('DELETE'));
}

export function hermesAction(action: 'runtime/start' | 'runtime/stop' | 'runtime/restart' | 'runtime/dashboard' | 'memory/reset' | 'gateway/start' | 'gateway/stop' | 'gateway/restart' | 'diagnostics/doctor' | 'diagnostics/security-audit') {
  return requestJson<HermesValue>(`/api/agents/hermes/${action}`, jsonRequest('POST', {}));
}

export type { HermesValue };
