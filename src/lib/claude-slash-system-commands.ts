import { createSystemCommandItem } from './system-command-items';
import type {
  ClaudeContextSnapshot as NativeClaudeContextSnapshot,
  ClaudeContextSummary,
  ConversationTurn,
} from '../types';

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

type ClaudeContextSlashSnapshot = ClaudeSlashSnapshot & {
  modelLabel?: string;
  nativeContext?: NativeClaudeContextSnapshot;
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

type ContextUsageSnapshot = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  usedTokens: number;
  contextWindowTokens: number;
  freeTokens: number;
  percent: number;
  source: 'context' | 'turn' | 'empty' | 'native';
};

const DEFAULT_CLAUDE_CONTEXT_WINDOW = 200_000;
const CLAUDE_1M_CONTEXT_WINDOW = 1_000_000;

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

export function buildContextSlashCardResult(snapshot: ClaudeContextSlashSnapshot): ClaudeSlashCardResult {
  const cumulativeUsage = summarizeUsage(snapshot.turns);
  const contextUsage = snapshot.nativeContext?.summary
    ? resolveNativeContextUsageSnapshot(snapshot.nativeContext.summary, snapshot)
    : resolveContextUsageSnapshot(snapshot);
  const nativeSummary = snapshot.nativeContext?.summary;
  const modelLabel = nativeSummary?.model ?? snapshot.modelLabel;
  const recommendation =
    contextUsage.usedTokens >= Math.max(0, contextUsage.contextWindowTokens - 45_000) ||
    cumulativeUsage.runningTurnCount > 0
      ? '建议: 如果上下文开始变长，可以执行 /compact'
      : '建议: 当前上下文还比较轻，可以继续直接对话';

  const summaryLines = nativeSummary
    ? buildNativeContextSummaryLines({
        modelLabel,
        contextUsage,
        summary: nativeSummary,
        recommendation,
      })
    : buildFallbackContextSummaryLines({
        modelLabel,
        contextUsage,
        cumulativeUsage,
        recommendation,
      });

  return {
    title: 'Context Usage',
    cardType: 'context',
    summary:
      cumulativeUsage.turnCount === 0 && contextUsage.usedTokens === 0
        ? '当前线程还没有上下文数据。'
        : summaryLines.join('\n'),
    details: buildContextDetails({
      modelLabel,
      contextUsage,
      cumulativeUsage,
      nativeSummary,
    }),
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

function resolveContextUsageSnapshot(snapshot: ClaudeContextSlashSnapshot): ContextUsageSnapshot {
  const contextWindowTokens = resolveContextWindowTokens(snapshot);

  for (let index = snapshot.turns.length - 1; index >= 0; index -= 1) {
    const turn = snapshot.turns[index];
    const source = turn.contextUsage ?? turn;
    const inputTokens = source.inputTokens ?? 0;
    const outputTokens = source.outputTokens ?? 0;
    const cacheCreationInputTokens = source.cacheCreationInputTokens ?? 0;
    const cacheReadInputTokens = source.cacheReadInputTokens ?? 0;
    const usedTokens = inputTokens + cacheCreationInputTokens + cacheReadInputTokens;

    if (usedTokens <= 0 || !isPlausibleContextSnapshot(usedTokens, contextWindowTokens)) {
      continue;
    }

    return createContextUsageSnapshot({
      inputTokens,
      outputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      contextWindowTokens,
      source: turn.contextUsage ? 'context' : 'turn',
    });
  }

  return createContextUsageSnapshot({
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    contextWindowTokens,
    source: 'empty',
  });
}

function resolveNativeContextUsageSnapshot(
  summary: ClaudeContextSummary,
  snapshot: ClaudeContextSlashSnapshot,
): ContextUsageSnapshot {
  const fallbackUsage = resolveContextUsageSnapshot(snapshot);
  const contextWindowTokens =
    typeof summary.totalTokens === 'number' && summary.totalTokens > 0
      ? summary.totalTokens
      : fallbackUsage.contextWindowTokens;
  const usedTokens =
    typeof summary.usedTokens === 'number'
      ? summary.usedTokens
      : typeof summary.totalTokens === 'number' && typeof summary.freeTokens === 'number'
        ? Math.max(0, summary.totalTokens - summary.freeTokens)
        : fallbackUsage.usedTokens;
  const freeTokens =
    typeof summary.freeTokens === 'number'
      ? summary.freeTokens
      : Math.max(0, contextWindowTokens - usedTokens);
  const percent =
    typeof summary.percent === 'number'
      ? summary.percent
      : contextWindowTokens > 0
        ? Math.min(100, Number(((usedTokens / contextWindowTokens) * 100).toFixed(1)))
        : 0;

  return {
    inputTokens: fallbackUsage.inputTokens,
    outputTokens: fallbackUsage.outputTokens,
    cacheCreationInputTokens: fallbackUsage.cacheCreationInputTokens,
    cacheReadInputTokens: fallbackUsage.cacheReadInputTokens,
    usedTokens,
    contextWindowTokens,
    freeTokens,
    percent,
    source: 'native',
  };
}

function buildNativeContextSummaryLines(input: {
  modelLabel?: string;
  contextUsage: ContextUsageSnapshot;
  summary: ClaudeContextSummary;
  recommendation: string;
}) {
  return [
    input.modelLabel ? `模型: ${input.modelLabel}` : null,
    `当前上下文: ${formatCompactTokenCount(input.contextUsage.usedTokens)}/${formatCompactTokenCount(input.contextUsage.contextWindowTokens)} tokens (${formatPercent(input.contextUsage.percent)})`,
    `可用空间: ${formatCompactTokenCount(input.contextUsage.freeTokens)} tokens`,
    `MCP tools: ${input.summary.mcpToolCount}`,
    `Memory files: ${input.summary.memoryFileCount}`,
    `Skills: ${input.summary.skillCount}`,
    input.recommendation,
  ].filter(Boolean) as string[];
}

function buildFallbackContextSummaryLines(input: {
  modelLabel?: string;
  contextUsage: ContextUsageSnapshot;
  cumulativeUsage: UsageTotals;
  recommendation: string;
}) {
  return [
    input.modelLabel ? `模型: ${input.modelLabel}` : null,
    `当前上下文: ${formatCompactTokenCount(input.contextUsage.usedTokens)}/${formatCompactTokenCount(input.contextUsage.contextWindowTokens)} tokens (${formatPercent(input.contextUsage.percent)})`,
    `可用空间: ${formatCompactTokenCount(input.contextUsage.freeTokens)} tokens`,
    `回合: ${input.cumulativeUsage.turnCount}`,
    input.recommendation,
  ].filter(Boolean) as string[];
}

function buildContextDetails(input: {
  modelLabel?: string;
  contextUsage: ContextUsageSnapshot;
  cumulativeUsage: UsageTotals;
  nativeSummary?: ClaudeContextSummary;
}) {
  const baseDetails: Record<string, unknown> = compactDetails({
    model: input.modelLabel,
    contextWindowTokens: input.contextUsage.contextWindowTokens,
    usedContextTokens: input.contextUsage.usedTokens,
    freeContextTokens: input.contextUsage.freeTokens,
    usagePercent: formatPercent(input.contextUsage.percent),
    usageSource: input.contextUsage.source === 'native'
      ? 'Claude stream-json /context'
      : input.contextUsage.source === 'context'
        ? 'Claude stream context_window.current_usage'
        : input.contextUsage.source === 'turn'
          ? 'latest turn usage fallback'
          : 'empty',
    turnCount: input.cumulativeUsage.turnCount,
    runningTurnCount: input.cumulativeUsage.runningTurnCount,
  });

  if (!input.nativeSummary) {
    return {
      ...baseDetails,
      note: '原生 Claude TUI 的 System prompt / Memory files / Skills / MCP tools 逐项明细目前没有通过 stream-json 事件稳定暴露；CodeM 展示当前能从事件流可靠取得的上下文窗口、占比、剩余空间和 token 分类。',
    };
  }

  return {
    ...baseDetails,
    ...compactDetails({
      mcpToolCount: input.nativeSummary.mcpToolCount,
      memoryFileCount: input.nativeSummary.memoryFileCount,
      skillCount: input.nativeSummary.skillCount,
      hasContextUsage: input.nativeSummary.hasContextUsage,
      hasMcpTools: input.nativeSummary.hasMcpTools,
      hasFreeSpace: input.nativeSummary.hasFreeSpace,
      hasSystemPrompt: input.nativeSummary.hasSystemPrompt,
      hasMemory: input.nativeSummary.hasMemory,
      hasSkills: input.nativeSummary.hasSkills,
      markdownChars: input.nativeSummary.markdownChars,
    }),
    note: '原生 Claude /context 摘要只保留结构化信息，不写入聊天历史。',
  };
}

function compactDetails(details: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined),
  );
}

function createContextUsageSnapshot(input: {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  contextWindowTokens: number;
  source: ContextUsageSnapshot['source'];
}): ContextUsageSnapshot {
  const usedTokens = input.inputTokens + input.cacheCreationInputTokens + input.cacheReadInputTokens;
  const freeTokens = Math.max(0, input.contextWindowTokens - usedTokens);
  const percent = input.contextWindowTokens > 0
    ? Math.min(100, Number(((usedTokens / input.contextWindowTokens) * 100).toFixed(1)))
    : 0;

  return {
    ...input,
    usedTokens,
    freeTokens,
    percent,
  };
}

function resolveContextWindowTokens(snapshot: ClaudeContextSlashSnapshot) {
  for (let index = snapshot.turns.length - 1; index >= 0; index -= 1) {
    const value = snapshot.turns[index].contextUsage?.modelContextWindow;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return snapshot.modelLabel && /(?:\b1m\b|\[1m\]|1m context)/i.test(snapshot.modelLabel)
    ? CLAUDE_1M_CONTEXT_WINDOW
    : DEFAULT_CLAUDE_CONTEXT_WINDOW;
}

function isPlausibleContextSnapshot(usedTokens: number, contextWindowTokens: number) {
  if (usedTokens <= 0) {
    return false;
  }
  if (contextWindowTokens <= 0) {
    return true;
  }

  return usedTokens <= contextWindowTokens * 2;
}

function formatTokenCount(value: number) {
  return `${value} tokens`;
}

function formatCompactTokenCount(value: number) {
  if (value >= 1_000_000) {
    const compact = value / 1_000_000;
    return `${Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1)}m`;
  }
  if (value >= 1000) {
    const compact = value / 1000;
    return `${Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1)}k`;
  }

  return `${value}`;
}

function formatPercent(value: number) {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

function formatUsd(value: number) {
  return `$${value.toFixed(4)}`;
}
