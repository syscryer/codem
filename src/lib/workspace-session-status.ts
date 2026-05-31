import type { ConversationTurn } from '../types';

export type WorkspaceSessionButtonStateId = 'new' | 'idle' | 'hot' | 'running';

export type WorkspaceSessionButtonState = {
  id: WorkspaceSessionButtonStateId;
  label: string;
};

export type WorkspaceSessionRuntimeSnapshot = {
  sessionId?: string | null;
  runtimeAlive?: boolean;
  activeRun?: boolean;
};

export type WorkspaceSessionUsageSummary = {
  turnCountLabel: string;
  durationLabel: string;
  tokenLabel: string;
  costLabel: string;
};

export function buildWorkspaceSessionButtonState(
  snapshot: WorkspaceSessionRuntimeSnapshot,
): WorkspaceSessionButtonState {
  if (snapshot.activeRun) {
    return { id: 'running', label: '运行中' };
  }

  if (!snapshot.sessionId?.trim()) {
    return { id: 'new', label: '新会话' };
  }

  if (snapshot.runtimeAlive) {
    return { id: 'hot', label: '热连接' };
  }

  return { id: 'idle', label: '空闲' };
}

export function summarizeWorkspaceSessionUsage(turns: ConversationTurn[]): WorkspaceSessionUsageSummary {
  const runTurns = getWorkspaceSessionRunTurns(turns);
  const totals = runTurns.reduce(
    (summary, turn) => {
      summary.durationMs += turn.durationMs ?? 0;
      summary.inputTokens +=
        (turn.inputTokens ?? 0) +
        (turn.cacheCreationInputTokens ?? 0) +
        (turn.cacheReadInputTokens ?? 0);
      summary.outputTokens += turn.outputTokens ?? 0;
      summary.totalCostUsd += turn.totalCostUsd ?? 0;
      return summary;
    },
    {
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalCostUsd: 0,
    },
  );

  return {
    turnCountLabel: String(runTurns.length),
    durationLabel: totals.durationMs > 0 ? formatCompactDuration(totals.durationMs) : '-',
    tokenLabel: totals.inputTokens > 0 || totals.outputTokens > 0
      ? `${formatCompactNumber(totals.inputTokens)} / ${formatCompactNumber(totals.outputTokens)}`
      : '-',
    costLabel: totals.totalCostUsd > 0 ? formatUsd(totals.totalCostUsd) : '-',
  };
}

export function getWorkspaceSessionRunTurns(turns: ConversationTurn[]) {
  return turns.filter((turn) => !isLocalSystemCommandTurn(turn));
}

export function formatCompactDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

export function formatCompactNumber(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2).replace(/\.?0+$/, '')}k`;
  }

  return String(value);
}

function formatUsd(value: number) {
  return `$${value.toFixed(2)}`;
}

function isLocalSystemCommandTurn(turn: ConversationTurn) {
  return (
    turn.items.length > 0 &&
    turn.items.every((item) => item.type === 'system-command') &&
    turn.tools.length === 0 &&
    !turn.assistantText.trim()
  );
}
