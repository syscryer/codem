export type AgentMuxRuntimeProfile = {
  id: string;
  provider: string;
  model: string;
  nickname?: string | null;
  avatar?: string | null;
  reasoningEffort?: string | null;
  level: '高级' | '标准' | '轻量' | '未评级';
  tags: string[];
  role: string;
  status: 'available' | 'busy' | 'offline' | 'disabled';
  channelId?: string | null;
};

export type AgentMuxRecord = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  profiles: AgentMuxRuntimeProfile[];
};

export type AgentMuxRun = {
  id: string;
  caller: string;
  target: string;
  profile: string;
  nickname?: string | null;
  avatar?: string | null;
  skill: string;
  status: 'running' | 'completed' | 'failed' | 'queued' | 'waiting' | 'cancelled';
  duration: string;
  started: string;
  createdAt?: string;
  prompt: string;
  summary: string;
  profileId?: string | null;
  providerRunId?: string | null;
  workingDirectory?: string | null;
  threadId?: string | null;
  sessionId?: string | null;
};

export type AgentMuxRunEvent = {
  id: number;
  runId: string;
  eventType: string;
  message: string;
  payload?: AgentRunEvent | null;
  createdAt: string;
};

export type AgentMuxMetrics = {
  running: number;
  availableAgents: number;
  todayCalls: number;
  successRate: number | null;
};

export type AgentMuxOverview = {
  agents: AgentMuxRecord[];
  runs: AgentMuxRun[];
  metrics: AgentMuxMetrics;
};

/** Stable grouping key for repeated calls to the same child-agent session. */
export function agentMuxConversationKey(run: AgentMuxRun): string | null {
  if (!run.threadId || !run.profileId || !run.workingDirectory) return null;
  return [run.threadId, run.profileId, run.workingDirectory].join('\u001f');
}

export function groupAgentMuxRunsByConversation(runs: AgentMuxRun[]): AgentMuxRun[][] {
  const groups = new Map<string, AgentMuxRun[]>();
  return runs.reduce<AgentMuxRun[][]>((result, run) => {
    const key = agentMuxConversationKey(run);
    if (!key) {
      result.push([run]);
      return result;
    }
    const group = groups.get(key);
    if (group) group.push(run);
    else {
      const next = [run];
      groups.set(key, next);
      result.push(next);
    }
    return result;
  }, []);
}

export type AgentMuxRuntimeInfo = { cliPath: string; appDataDir: string; runtimeManaged: boolean };

export function filterAgentMuxRunsForThread(runs: AgentMuxRun[], threadId: string | null) {
  return threadId ? runs.filter((run) => run.threadId === threadId) : [];
}

export type AgentMuxSkillTargetState = 'not-installed' | 'installed' | 'update-available';

export type AgentMuxSkillTarget = {
  providerId: string;
  path: string;
  state: AgentMuxSkillTargetState;
};

export type AgentMuxSkillSource = {
  sourceDirectory: string;
  sourceFile: string;
  targets: AgentMuxSkillTarget[];
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message || `Agent Mux 请求失败（${response.status}）`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function listAgentMuxRecords() { return request<AgentMuxRecord[]>('/api/agent-mux/profiles'); }
export function getAgentMuxOverview() { return request<AgentMuxOverview>('/api/agent-mux/overview', { cache: 'no-store' }); }
export function getAgentMuxRuntimeInfo() { return request<AgentMuxRuntimeInfo>('/api/agent-mux/runtime-info', { cache: 'no-store' }); }
export function getAgentMuxSkillSource() { return request<AgentMuxSkillSource>('/api/agent-mux/skill-source', { cache: 'no-store' }); }
export function syncAgentMuxSkillSource(content: string) { return request<AgentMuxSkillSource>('/api/agent-mux/skill-source', { method: 'PUT', body: JSON.stringify({ content }) }); }
export function stopAgentMuxRuntime() { return request<{ stopping: boolean }>('/api/runtime/shutdown', { method: 'POST', body: '{}' }); }
export function listAgentMuxRuns() { return request<AgentMuxRun[]>('/api/agent-mux/runs', { cache: 'no-store' }); }
export function createAgentMuxRun(input: Omit<AgentMuxRun, 'id'>) { return request<AgentMuxRun>('/api/agent-mux/runs', { method: 'POST', body: JSON.stringify(input) }); }
export function updateAgentMuxRun(runId: string, input: Partial<Pick<AgentMuxRun, 'status' | 'duration' | 'summary' | 'providerRunId'>>) { return request<AgentMuxRun>(`/api/agent-mux/runs/${encodeURIComponent(runId)}`, { method: 'PATCH', body: JSON.stringify(input) }); }
export function listAgentMuxRunEvents(runId: string) { return request<AgentMuxRunEvent[]>(`/api/agent-mux/runs/${encodeURIComponent(runId)}/events`, { cache: 'no-store' }); }
export function createAgentMuxRunEvent(runId: string, event: AgentRunEvent) { return request<AgentMuxRunEvent>(`/api/agent-mux/runs/${encodeURIComponent(runId)}/events`, { method: 'POST', body: JSON.stringify({ eventType: event.type, message: getAgentRunEventLogMessage(event), payload: event }) }); }

export async function startAgentMuxProviderRun(input: { providerId: string; channelId?: string | null; prompt: string; workingDirectory: string; model: string; reasoningEffort?: string | null; permissionMode: string }) {
  const response = await fetch('/api/agents/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId: input.providerId,
      channelId: input.channelId || undefined,
      prompt: input.prompt,
      workingDirectory: input.workingDirectory,
      model: input.model,
      reasoningEffort: input.reasoningEffort || undefined,
      permissionMode: input.permissionMode,
    }),
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    throw new Error(body?.error || body?.message || `Agent 启动失败（${response.status}）`);
  }
  return { response, providerRunId: response.headers.get('X-CodeM-Agent-Run-Id') };
}

export async function cancelAgentMuxProviderRun(providerRunId: string) {
  return request<{ cancelled: boolean }>(`/api/agents/run/${encodeURIComponent(providerRunId)}`, { method: 'DELETE' });
}
export function createAgentMuxProfile(agentId: string, profile: AgentMuxRuntimeProfile) { return request<AgentMuxRuntimeProfile>('/api/agent-mux/profiles', { method: 'POST', body: JSON.stringify({ agentId, profile }) }); }
export function updateAgentMuxProfile(profile: AgentMuxRuntimeProfile) { return request<AgentMuxRuntimeProfile>(`/api/agent-mux/profiles/${encodeURIComponent(profile.id)}`, { method: 'PUT', body: JSON.stringify(profile) }); }
export function deleteAgentMuxProfile(profileId: string) { return request<void>(`/api/agent-mux/profiles/${encodeURIComponent(profileId)}`, { method: 'DELETE' }); }
export function updateAgentMuxProfileStatus(profileId: string, status: AgentMuxRuntimeProfile['status']) { return request<AgentMuxRuntimeProfile>(`/api/agent-mux/profiles/${encodeURIComponent(profileId)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); }

export async function probeAgentMuxAgent(agentId: string) {
  if (agentId === 'codex') {
    const result = await probeCodexAgent();
    const available = result.installed && result.initialized && Boolean(result.probe?.authenticated || result.probe?.requiresOpenaiAuth === false);
    return { available, message: available ? `Codex ${result.version ?? ''} 已连接`.trim() : result.error || 'Codex 未安装、未初始化或认证不可用' };
  }
  if (agentId === 'grok') {
    const result = await probeGrokAgent();
    const available = result.installed && result.initialized && Boolean(result.probe?.authenticated);
    return { available, message: available ? `Grok Build ${result.version ?? ''} 已连接`.trim() : result.probe?.authError || result.error || 'Grok Build 未安装、未初始化或认证不可用' };
  }
  if (agentId === 'pi') {
    const result = await probePiAgent();
    const available = result.installed && result.initialized && Boolean(result.probe?.authenticated);
    return { available, message: available ? `Pi Agent 已连接${result.probe?.currentModel ? ` · ${result.probe.currentModel}` : ''}` : result.error || 'Pi Agent 未安装、未初始化或认证不可用' };
  }
  if (agentId === 'opencode') {
    const result = await probeOpenCodeAgent();
    const available = result.installed && result.initialized && result.probe?.configured === true;
    return { available, message: available ? `OpenCode ${result.version ?? ''} 已连接 · ${result.probe?.modelCount ?? 0} 个模型`.trim() : result.error || 'OpenCode 未安装、未初始化或尚未配置模型' };
  }
  if (agentId === 'claude') {
    const result = await fetchAgentSettingsDiagnostics(CLAUDE_CODE_PROVIDER_ID, undefined, true);
    const available = result.installed && result.diagnostic.success === true;
    return { available, message: available ? `Claude Code ${result.version ?? ''} 已连接`.trim() : 'Claude Code 未安装或诊断命令执行失败' };
  }
  return { available: false, message: '当前 Agent 类型暂未接入真实连接检查' };
}
import { fetchAgentSettingsDiagnostics, probeCodexAgent, probeGrokAgent, probeOpenCodeAgent, probePiAgent } from './agent-provider-registry';
import { CLAUDE_CODE_PROVIDER_ID } from '../constants';
import { getAgentRunEventLogMessage } from './agent-run-events';
import type { AgentRunEvent } from '../types';
