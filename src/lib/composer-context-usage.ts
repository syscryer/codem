import type { AgentType, ConversationTurn } from '../types';

export type ComposerContextUsageLevel = 'empty' | 'low' | 'medium' | 'high' | 'critical';

export type ComposerContextUsage = {
  visible: boolean;
  hasUsage: boolean;
  percent: number;
  usedTokens: number;
  totalTokens: number;
  level: ComposerContextUsageLevel;
  compact: {
    thresholdTokens: number;
    remainingTokens: number;
    nearThreshold: boolean;
    reachedThreshold: boolean;
  };
  breakdown: {
    inputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    outputTokens: number;
  };
};

const DEFAULT_CLAUDE_CONTEXT_WINDOW = 200_000;
const CLAUDE_AUTO_COMPACT_BUFFER = 45_000;

export function buildComposerContextUsage(input: {
  agent: AgentType;
  model: string;
  turns: ConversationTurn[];
}): ComposerContextUsage {
  const totalTokens = resolveClaudeContextWindow(input.model);

  if (input.agent !== 'claude') {
    return createContextUsageResult({
      visible: false,
      totalTokens,
    });
  }

  const breakdown = resolveLatestUsageBreakdown(input.turns, totalTokens);

  const usedTokens =
    breakdown.inputTokens +
    breakdown.cacheCreationInputTokens +
    breakdown.cacheReadInputTokens;
  const hasUsage = usedTokens > 0;
  const compact = resolveCompactState(usedTokens, totalTokens);
  const percent = hasUsage && totalTokens > 0
    ? Math.min(100, Number(((usedTokens / totalTokens) * 100).toFixed(1)))
    : 0;

  return {
    visible: true,
    hasUsage,
    percent,
    usedTokens,
    totalTokens,
    level: resolveUsageLevel(hasUsage, percent),
    compact,
    breakdown,
  };
}

function resolveLatestUsageBreakdown(turns: ConversationTurn[], totalTokens: number) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const source = turn.contextUsage ?? turn;
    const breakdown = {
      inputTokens: source.inputTokens ?? 0,
      cacheCreationInputTokens: source.cacheCreationInputTokens ?? 0,
      cacheReadInputTokens: source.cacheReadInputTokens ?? 0,
      outputTokens: source.outputTokens ?? 0,
    };
    const currentTokens = breakdown.inputTokens + breakdown.cacheCreationInputTokens + breakdown.cacheReadInputTokens;

    if (
      breakdown.inputTokens > 0 ||
      breakdown.cacheCreationInputTokens > 0 ||
      breakdown.cacheReadInputTokens > 0
    ) {
      if (!isPlausibleContextSnapshot(currentTokens, totalTokens)) {
        continue;
      }
      return breakdown;
    }
  }

  return {
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
  };
}

function isPlausibleContextSnapshot(currentTokens: number, totalTokens: number) {
  if (currentTokens <= 0) {
    return false;
  }
  if (totalTokens <= 0) {
    return true;
  }

  return currentTokens <= totalTokens * 2;
}

function createContextUsageResult(input: {
  visible: boolean;
  totalTokens: number;
}): ComposerContextUsage {
  return {
    visible: input.visible,
    hasUsage: false,
    percent: 0,
    usedTokens: 0,
    totalTokens: input.totalTokens,
    level: 'empty',
    compact: resolveCompactState(0, input.totalTokens),
    breakdown: {
      inputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 0,
    },
  };
}

function resolveUsageLevel(hasUsage: boolean, percent: number): ComposerContextUsageLevel {
  if (!hasUsage) {
    return 'empty';
  }
  if (percent >= 90) {
    return 'critical';
  }
  if (percent >= 80) {
    return 'high';
  }
  if (percent >= 60) {
    return 'medium';
  }
  return 'low';
}

function resolveCompactState(usedTokens: number, totalTokens: number) {
  const thresholdTokens = Math.max(0, totalTokens - CLAUDE_AUTO_COMPACT_BUFFER);
  const remainingTokens = Math.max(0, thresholdTokens - usedTokens);
  const reachedThreshold = usedTokens >= thresholdTokens;
  const nearThreshold = reachedThreshold || (thresholdTokens > 0 && usedTokens >= thresholdTokens * 0.9);

  return {
    thresholdTokens,
    remainingTokens,
    nearThreshold,
    reachedThreshold,
  };
}

function resolveClaudeContextWindow(model: string) {
  const normalized = model.trim().toLowerCase();
  if (
    normalized.includes('sonnet') ||
    normalized.includes('opus') ||
    normalized.includes('haiku') ||
    normalized.includes('claude')
  ) {
    return DEFAULT_CLAUDE_CONTEXT_WINDOW;
  }

  return DEFAULT_CLAUDE_CONTEXT_WINDOW;
}
