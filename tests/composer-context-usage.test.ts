import assert from 'node:assert/strict';
import test from 'node:test';

import { buildComposerContextUsage } from '../src/lib/composer-context-usage';
import type { ConversationTurn } from '../src/types';

function createTurn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    userText: overrides.userText ?? '',
    workspace: overrides.workspace ?? 'D:\\project\\codem',
    assistantText: overrides.assistantText ?? '',
    tools: overrides.tools ?? [],
    items: overrides.items ?? [],
    status: overrides.status ?? 'done',
    inputTokens: overrides.inputTokens,
    outputTokens: overrides.outputTokens,
    cacheCreationInputTokens: overrides.cacheCreationInputTokens,
    cacheReadInputTokens: overrides.cacheReadInputTokens,
    totalCostUsd: overrides.totalCostUsd,
    startedAtMs: overrides.startedAtMs,
    durationMs: overrides.durationMs,
    sessionId: overrides.sessionId,
    phase: overrides.phase,
    activity: overrides.activity,
    metrics: overrides.metrics,
    thoughtCount: overrides.thoughtCount,
    pendingUserInputRequests: overrides.pendingUserInputRequests,
    pendingApprovalRequests: overrides.pendingApprovalRequests,
    recoveryHint: overrides.recoveryHint,
    backendRunId: overrides.backendRunId,
    userAttachments: overrides.userAttachments,
  };
}

test('buildComposerContextUsage only exposes the indicator for claude', () => {
  const usage = buildComposerContextUsage({
    agent: 'codex',
    model: 'claude-sonnet-4-5',
    turns: [],
  });

  assert.equal(usage.visible, false);
});

test('buildComposerContextUsage excludes output tokens from used context percentage', () => {
  const usage = buildComposerContextUsage({
    agent: 'claude',
    model: 'claude-sonnet-4-5',
    turns: [
      createTurn({
        inputTokens: 120_000,
        outputTokens: 50_000,
        cacheCreationInputTokens: 30_000,
        cacheReadInputTokens: 20_000,
      }),
    ],
  });

  assert.equal(usage.visible, true);
  assert.equal(usage.hasUsage, true);
  assert.equal(usage.usedTokens, 170_000);
  assert.equal(usage.totalTokens, 200_000);
  assert.equal(usage.percent, 85);
  assert.equal(usage.level, 'high');
  assert.equal(usage.compact.thresholdTokens, 155_000);
  assert.equal(usage.compact.remainingTokens, 0);
  assert.equal(usage.compact.nearThreshold, true);
  assert.equal(usage.compact.reachedThreshold, true);
  assert.deepEqual(usage.breakdown, {
    inputTokens: 120_000,
    outputTokens: 50_000,
    cacheCreationInputTokens: 30_000,
    cacheReadInputTokens: 20_000,
  });
});

test('buildComposerContextUsage uses the latest non-empty usage snapshot instead of cumulative thread totals', () => {
  const usage = buildComposerContextUsage({
    agent: 'claude',
    model: 'claude-sonnet-4-5',
    turns: [
      createTurn({
        id: 'older-turn',
        inputTokens: 90_000,
        cacheReadInputTokens: 10_000,
      }),
      createTurn({
        id: 'trailing-local-turn',
        status: 'stopped',
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      }),
      createTurn({
        id: 'latest-claude-turn',
        inputTokens: 8_000,
        outputTokens: 1_000,
        cacheCreationInputTokens: 2_000,
        cacheReadInputTokens: 30_000,
      }),
      createTurn({
        id: 'local-exit-turn',
        status: 'stopped',
      }),
    ],
  });

  assert.equal(usage.usedTokens, 40_000);
  assert.equal(usage.percent, 20);
  assert.equal(usage.level, 'low');
  assert.equal(usage.compact.thresholdTokens, 155_000);
  assert.equal(usage.compact.remainingTokens, 115_000);
  assert.equal(usage.compact.nearThreshold, false);
  assert.equal(usage.compact.reachedThreshold, false);
  assert.deepEqual(usage.breakdown, {
    inputTokens: 8_000,
    outputTokens: 1_000,
    cacheCreationInputTokens: 2_000,
    cacheReadInputTokens: 30_000,
  });
});

test('buildComposerContextUsage marks empty threads with a neutral state', () => {
  const usage = buildComposerContextUsage({
    agent: 'claude',
    model: 'claude-sonnet-4-5',
    turns: [],
  });

  assert.equal(usage.visible, true);
  assert.equal(usage.hasUsage, false);
  assert.equal(usage.usedTokens, 0);
  assert.equal(usage.percent, 0);
  assert.equal(usage.level, 'empty');
  assert.equal(usage.compact.thresholdTokens, 155_000);
  assert.equal(usage.compact.remainingTokens, 155_000);
});

test('buildComposerContextUsage maps threshold boundaries to stable levels', () => {
  const mediumUsage = buildComposerContextUsage({
    agent: 'claude',
    model: 'claude-sonnet-4-5',
    turns: [createTurn({ inputTokens: 120_000 })],
  });
  const highUsage = buildComposerContextUsage({
    agent: 'claude',
    model: 'claude-sonnet-4-5',
    turns: [createTurn({ inputTokens: 160_000 })],
  });
  const criticalUsage = buildComposerContextUsage({
    agent: 'claude',
    model: 'claude-sonnet-4-5',
    turns: [createTurn({ inputTokens: 180_000 })],
  });

  assert.equal(mediumUsage.percent, 60);
  assert.equal(mediumUsage.level, 'medium');
  assert.equal(highUsage.percent, 80);
  assert.equal(highUsage.level, 'high');
  assert.equal(criticalUsage.percent, 90);
  assert.equal(criticalUsage.level, 'critical');
});

test('buildComposerContextUsage marks near-compact usage before reaching the threshold', () => {
  const usage = buildComposerContextUsage({
    agent: 'claude',
    model: 'claude-sonnet-4-5',
    turns: [
      createTurn({
        inputTokens: 145_000,
      }),
    ],
  });

  assert.equal(usage.compact.thresholdTokens, 155_000);
  assert.equal(usage.compact.remainingTokens, 10_000);
  assert.equal(usage.compact.nearThreshold, true);
  assert.equal(usage.compact.reachedThreshold, false);
});

test('buildComposerContextUsage falls back to the default Claude window for unknown models', () => {
  const usage = buildComposerContextUsage({
    agent: 'claude',
    model: 'claude-unknown',
    turns: [],
  });

  assert.equal(usage.visible, true);
  assert.equal(usage.totalTokens, 200_000);
  assert.equal(usage.hasUsage, false);
  assert.equal(usage.level, 'empty');
});
