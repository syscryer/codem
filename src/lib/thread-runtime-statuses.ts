import type { AgentRuntimeStatus, ThreadRuntimeStatus } from '../types';

export async function fetchThreadRuntimeStatuses() {
  const [claudeStatuses, agentStatuses] = await Promise.all([
    fetchClaudeRuntimeStatuses(),
    fetchAgentRuntimeStatuses(),
  ]);
  return { ...claudeStatuses, ...agentStatuses };
}

export function normalizeAgentRuntimeStatus(status: AgentRuntimeStatus): ThreadRuntimeStatus {
  const alive = status.exists && (
    status.phase === 'starting' ||
    status.phase === 'ready' ||
    status.phase === 'running'
  );
  return {
    threadId: status.threadId,
    alive,
    activeRun: alive && Boolean(status.currentRunId || status.phase === 'running'),
    runtimeKind: 'agent',
    phase: status.phase,
    providerId: status.providerId,
    sessionId: status.sessionId,
    currentRunId: status.currentRunId,
    lastError: status.lastError,
  };
}

async function fetchClaudeRuntimeStatuses(): Promise<Record<string, ThreadRuntimeStatus>> {
  try {
    const response = await fetch('/api/claude/runtimes');
    if (!response.ok) {
      return {};
    }

    const statuses = (await response.json()) as Record<string, ThreadRuntimeStatus>;
    return Object.fromEntries(
      Object.entries(statuses).map(([threadId, status]) => [
        threadId,
        { ...status, runtimeKind: 'claude' as const },
      ]),
    );
  } catch {
    return {};
  }
}

async function fetchAgentRuntimeStatuses(): Promise<Record<string, ThreadRuntimeStatus>> {
  try {
    const response = await fetch('/api/agents/runtimes');
    if (!response.ok) {
      return {};
    }

    const statuses = (await response.json()) as Record<string, AgentRuntimeStatus>;
    return Object.fromEntries(
      Object.entries(statuses).map(([threadId, status]) => [
        threadId,
        normalizeAgentRuntimeStatus({ ...status, threadId }),
      ]),
    );
  } catch {
    return {};
  }
}
