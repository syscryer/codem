import assert from 'node:assert/strict';
import test from 'node:test';
import { buildComposerContextUsage, shouldRefreshNativeContextOnOpen } from './composer-context-usage';
import type { ClaudeContextSummary, ConversationTurn } from '../types';

function turn(overrides: Partial<ConversationTurn>): ConversationTurn {
  return {
    id: 'turn-1',
    userText: '',
    workspace: '',
    assistantText: '',
    tools: [],
    items: [],
    status: 'done',
    ...overrides,
  };
}

const usage = buildComposerContextUsage({
  agent: 'claude',
  model: '__default',
  turns: [
    turn({
      id: 'turn-valid',
      inputTokens: 20_000,
      cacheCreationInputTokens: 3_000,
      cacheReadInputTokens: 12_000,
      outputTokens: 2_000,
    }),
    turn({
      id: 'turn-cumulative-result',
      inputTokens: 17_994,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 1_418_240,
      outputTokens: 4_353,
    }),
  ],
});

assert.equal(usage.breakdown.cacheReadInputTokens, 12_000);
assert.equal(usage.usedTokens, 35_000);
assert.equal(usage.percent, 17.5);
assert.equal(usage.compact.remainingTokens, 120_000);

const onlyImplausibleUsage = buildComposerContextUsage({
  agent: 'claude',
  model: '__default',
  turns: [
    turn({
      id: 'turn-cumulative-result',
      inputTokens: 17_994,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 1_418_240,
      outputTokens: 4_353,
    }),
  ],
});

assert.equal(onlyImplausibleUsage.hasUsage, false);
assert.equal(onlyImplausibleUsage.usedTokens, 0);

const usageWithResultStats = buildComposerContextUsage({
  agent: 'claude',
  model: '__default',
  turns: [
    turn({
      id: 'turn-with-result-stats',
      inputTokens: 17_994,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 1_418_240,
      outputTokens: 4_353,
      contextUsage: {
        inputTokens: 1,
        cacheCreationInputTokens: 128_461,
        cacheReadInputTokens: 0,
        outputTokens: 1_589,
        usageSource: 'message',
      },
    }),
  ],
});

assert.equal(usageWithResultStats.usedTokens, 128_462);
assert.equal(usageWithResultStats.breakdown.outputTokens, 1_589);

test('buildComposerContextUsage prefers native 1m context window over stale turn usage', () => {
  const usage = buildComposerContextUsage({
    agent: 'claude',
    model: 'claude-opus-4-8[1m]',
    turns: [
      turn({
        id: 'turn-stale-window',
        inputTokens: 24_000,
        cacheCreationInputTokens: 2_000,
        cacheReadInputTokens: 1_000,
        outputTokens: 300,
        contextUsage: {
          inputTokens: 24_000,
          cacheCreationInputTokens: 2_000,
          cacheReadInputTokens: 1_000,
          outputTokens: 300,
          modelContextWindow: 200_000,
          usageSource: 'message',
        },
      }),
    ],
    nativeContextSummary: {
      usedTokens: 27_000,
      totalTokens: 1_000_000,
      freeTokens: 973_000,
      percent: 2.7,
    } as ClaudeContextSummary,
  });

  assert.equal(usage.totalTokens, 1_000_000);
  assert.equal(usage.usedTokens, 27_000);
  assert.equal(usage.percent, 2.7);
  assert.equal(usage.compact.thresholdTokens, 955_000);
});

test('buildComposerContextUsage treats GLM-5.2 1M aliases as a 1M context window', () => {
  const usage = buildComposerContextUsage({
    agent: 'claude',
    model: 'GLM-5.2[1m]',
    turns: [
      turn({
        id: 'turn-glm-52',
        inputTokens: 100_000,
        cacheCreationInputTokens: 50_000,
        cacheReadInputTokens: 0,
        outputTokens: 1_000,
      }),
    ],
  });

  assert.equal(usage.totalTokens, 1_000_000);
  assert.equal(usage.usedTokens, 150_000);
  assert.equal(usage.percent, 15);
  assert.equal(usage.compact.thresholdTokens, 955_000);
});

test('buildComposerContextUsage keeps bare provider models on the default window without explicit capability metadata', () => {
  const usage = buildComposerContextUsage({
    agent: 'claude',
    model: 'GLM-5.2',
    turns: [
      turn({
        id: 'turn-glm-52-bare',
        inputTokens: 100_000,
        cacheCreationInputTokens: 50_000,
        cacheReadInputTokens: 0,
        outputTokens: 1_000,
      }),
    ],
  });

  assert.equal(usage.totalTokens, 200_000);
  assert.equal(usage.usedTokens, 150_000);
  assert.equal(usage.percent, 75);
  assert.equal(usage.compact.thresholdTokens, 155_000);
});

test('buildComposerContextUsage uses configured capability metadata for bare provider model windows', () => {
  const usage = buildComposerContextUsage({
    agent: 'claude',
    model: 'GLM-5.2',
    nativeContextWindowTokens: 1_000_000,
    turns: [
      turn({
        id: 'turn-provider-capability',
        inputTokens: 100_000,
        cacheCreationInputTokens: 50_000,
        cacheReadInputTokens: 0,
        outputTokens: 1_000,
      }),
    ],
  });

  assert.equal(usage.totalTokens, 1_000_000);
  assert.equal(usage.usedTokens, 150_000);
  assert.equal(usage.percent, 15);
  assert.equal(usage.compact.thresholdTokens, 955_000);
});

test('buildComposerContextUsage uses native context usage for the primary number', () => {
  const usage = buildComposerContextUsage({
    agent: 'claude',
    model: 'claude-opus-4-8[1m]',
    turns: [
      turn({
        id: 'turn-message-usage',
        inputTokens: 75,
        cacheCreationInputTokens: 43_113,
        cacheReadInputTokens: 0,
        outputTokens: 211,
        contextUsage: {
          inputTokens: 75,
          cacheCreationInputTokens: 43_113,
          cacheReadInputTokens: 0,
          outputTokens: 211,
          usageSource: 'message',
        },
      }),
    ],
    nativeContextSummary: {
      usedTokens: 2_800,
      totalTokens: 1_000_000,
      freeTokens: 997_200,
      percent: 0,
    },
  });

  assert.equal(usage.totalTokens, 1_000_000);
  assert.equal(usage.usedTokens, 2_800);
  assert.equal(usage.percent, 0);
  assert.equal(usage.compact.remainingTokens, 952_200);
  assert.equal(usage.breakdown.cacheCreationInputTokens, 43_113);
  assert.equal(usage.breakdown.outputTokens, 211);
});

test('buildComposerContextUsage lets newer runtime usage raise a stale native context snapshot', () => {
  const usage = buildComposerContextUsage({
    agent: 'claude',
    model: 'claude-opus-4-8[1m]',
    turns: [
      turn({
        id: 'turn-after-context',
        startedAtMs: 2_000,
        contextUsage: {
          inputTokens: 97,
          cacheCreationInputTokens: 4_719,
          cacheReadInputTokens: 118_881,
          outputTokens: 451,
          usageSource: 'message',
        },
      }),
    ],
    nativeContextRequestedAtMs: 1_000,
    nativeContextSummary: {
      usedTokens: 2_800,
      totalTokens: 1_000_000,
      freeTokens: 997_200,
      percent: 0,
    },
  });

  assert.equal(usage.totalTokens, 1_000_000);
  assert.equal(usage.usedTokens, 123_697);
  assert.equal(usage.percent, 12.4);
  assert.equal(usage.breakdown.cacheReadInputTokens, 118_881);
});

test('buildComposerContextUsage does not let stale runtime usage undercut the native context snapshot', () => {
  const usage = buildComposerContextUsage({
    agent: 'claude',
    model: 'claude-opus-4-8[1m]',
    turns: [
      turn({
        id: 'turn-after-context',
        startedAtMs: 2_000,
        contextUsage: {
          inputTokens: 97,
          cacheCreationInputTokens: 1_000,
          cacheReadInputTokens: 20_000,
          outputTokens: 451,
          usageSource: 'message',
        },
      }),
    ],
    nativeContextRequestedAtMs: 1_000,
    nativeContextSummary: {
      usedTokens: 111_000,
      totalTokens: 1_000_000,
      freeTokens: 889_000,
      percent: 11.1,
    },
  });

  assert.equal(usage.usedTokens, 111_000);
  assert.equal(usage.percent, 11.1);
});

test('shouldRefreshNativeContextOnOpen only asks for /context when the snapshot is missing or stale', () => {
  const turns = [
    turn({
      id: 'turn-with-context',
      startedAtMs: 2_000,
      contextUsage: {
        inputTokens: 10,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 20,
        outputTokens: 5,
        usageSource: 'message',
      },
    }),
  ];

  assert.equal(shouldRefreshNativeContextOnOpen({ turns }), true);
  assert.equal(shouldRefreshNativeContextOnOpen({ turns, nativeContextRequestedAtMs: 1_000 }), true);
  assert.equal(shouldRefreshNativeContextOnOpen({ turns, nativeContextRequestedAtMs: 3_000 }), false);
  assert.equal(shouldRefreshNativeContextOnOpen({ turns: [] }), false);
});
