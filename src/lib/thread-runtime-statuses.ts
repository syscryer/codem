import type { AgentRuntimeStatus, ThreadRuntimeStatus } from '../types';

const runtimeStatusFields = [
  'threadId',
  'pid',
  'alive',
  'activeRun',
  'runtimeKind',
  'phase',
  'providerId',
  'sessionId',
  'currentRunId',
  'lastError',
] as const satisfies ReadonlyArray<keyof ThreadRuntimeStatus>;

export function areThreadRuntimeStatusesEqual(
  current: Record<string, ThreadRuntimeStatus>,
  next: Record<string, ThreadRuntimeStatus>,
) {
  const currentThreadIds = Object.keys(current);
  const nextThreadIds = Object.keys(next);
  if (currentThreadIds.length !== nextThreadIds.length) {
    return false;
  }

  return currentThreadIds.every((threadId) => {
    const currentStatus = current[threadId];
    const nextStatus = next[threadId];
    return Boolean(nextStatus) && runtimeStatusFields.every((field) => currentStatus[field] === nextStatus[field]);
  });
}

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
