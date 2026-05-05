import { createSystemCommandItem } from './system-command-items';
import type { ConversationTurn } from '../types';

type ClaudeCliHealth = {
  available: boolean;
  command?: string;
  error?: string;
};

type ClaudeSlashSnapshot = {
  turns: ConversationTurn[];
};

type ClaudeStatusSnapshot = ClaudeSlashSnapshot & {
  projectName?: string | null;
  threadTitle?: string | null;
  workspace?: string;
  modelLabel: string;
  permissionLabel: string;
  sessionId?: string | null;
  isRunning: boolean;
  cliHealth: ClaudeCliHealth;
};

type ClaudeSlashCardResult = {
  title: string;
  cardType: 'status' | 'context' | 'cost';
  summary: string;
  details: Record<string, unknown>;
};

type CompactSlashCommandSubmission = {
  prompt: string;
  displayText: string;
  initialAssistantItems: ReturnType<typeof createSystemCommandItem>[];
  initialActivity: string;
  reuseSession: false;
};

type UsageTotals = {
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  runningTurnCount: number;
  lastTurnTokens: number;
};

export function buildStatusSlashCardResult(snapshot: ClaudeStatusSnapshot): ClaudeSlashCardResult {
  const usage = summarizeUsage(snapshot.turns);

  return {
    title: 'Status',
    cardType: 'status',
    summary: [
      `项目: ${snapshot.projectName ?? '(未选择)'}`,
      `线程: ${snapshot.threadTitle ?? '(未选择)'}`,
      `模型: ${snapshot.modelLabel}`,
      `权限: ${snapshot.permissionLabel}`,
      `运行中: ${snapshot.isRunning ? '是' : '否'}`,
    ].join('\n'),
    details: {
      workspace: snapshot.workspace?.trim() || '(未设置)',
      sessionId: snapshot.sessionId?.trim() || '(未绑定)',
      cli: snapshot.cliHealth.available
        ? `就绪 (${snapshot.cliHealth.command ?? 'unknown'})`
        : `不可用${snapshot.cliHealth.error ? ` - ${snapshot.cliHealth.error}` : ''}`,
      turnCount: usage.turnCount,
    },
  };
}

export function buildContextSlashCardResult(snapshot: ClaudeSlashSnapshot): ClaudeSlashCardResult {
  const usage = summarizeUsage(snapshot.turns);
  const recommendation =
    usage.totalTokens >= 12000 || usage.runningTurnCount > 0
      ? '建议: 如果上下文开始变长，可以执行 /compact'
      : '建议: 当前上下文还比较轻，可以继续直接对话';

  return {
    title: 'Context Usage',
    cardType: 'context',
    summary: usage.turnCount === 0
      ? '当前线程还没有上下文数据。'
      : [
          `回合: ${usage.turnCount}`,
          `总 tokens: ${formatTokenCount(usage.totalTokens)}`,
          `最近一轮: ${formatTokenCount(usage.lastTurnTokens)}`,
          recommendation,
        ].join('\n'),
    details: {
      turnCount: usage.turnCount,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      totalTokens: usage.totalTokens,
      runningTurnCount: usage.runningTurnCount,
    },
  };
}

export function buildCostSlashCardResult(snapshot: ClaudeSlashSnapshot): ClaudeSlashCardResult {
  const usage = summarizeUsage(snapshot.turns);

  return {
    title: 'Token Cost',
    cardType: 'cost',
    summary: usage.turnCount === 0
      ? '当前线程还没有 token / cost 数据。'
      : [
          `输入: ${formatTokenCount(usage.inputTokens)}`,
          `输出: ${formatTokenCount(usage.outputTokens)}`,
          `缓存读取: ${formatTokenCount(usage.cacheReadInputTokens)}`,
          `总计: ${formatTokenCount(usage.totalTokens)}${usage.totalCostUsd > 0 ? ` · ${formatUsd(usage.totalCostUsd)}` : ''}`,
        ].join('\n'),
    details: {
      turnCount: usage.turnCount,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      totalTokens: usage.totalTokens,
      totalCostUsd: usage.totalCostUsd,
    },
  };
}

export function buildCompactSlashCommandSubmission(commandText: string): CompactSlashCommandSubmission {
  return {
    prompt: commandText,
    displayText: commandText,
    initialAssistantItems: [
      createSystemCommandItem(commandText, 'Compact Context', 'compact'),
    ],
    initialActivity: '准备压缩上下文',
    reuseSession: false,
  };
}

function summarizeUsage(turns: ConversationTurn[]): UsageTotals {
  return turns.reduce<UsageTotals>(
    (totals, turn) => {
      const inputTokens = turn.inputTokens ?? 0;
      const outputTokens = turn.outputTokens ?? 0;
      const cacheCreationInputTokens = turn.cacheCreationInputTokens ?? 0;
      const cacheReadInputTokens = turn.cacheReadInputTokens ?? 0;
      const totalTokens = inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens;

      totals.turnCount += 1;
      totals.inputTokens += inputTokens;
      totals.outputTokens += outputTokens;
      totals.cacheCreationInputTokens += cacheCreationInputTokens;
      totals.cacheReadInputTokens += cacheReadInputTokens;
      totals.totalTokens += totalTokens;
      totals.totalCostUsd += turn.totalCostUsd ?? 0;
      totals.lastTurnTokens = totalTokens || totals.lastTurnTokens;
      if (turn.status === 'pending' || turn.status === 'running') {
        totals.runningTurnCount += 1;
      }
      return totals;
    },
    {
      turnCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      runningTurnCount: 0,
      lastTurnTokens: 0,
    },
  );
}

function formatTokenCount(value: number) {
  return `${value} tokens`;
}

function formatUsd(value: number) {
  return `$${value.toFixed(4)}`;
}
