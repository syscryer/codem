import assert from 'node:assert/strict';
import { buildComposerContextUsage } from './composer-context-usage';
import type { ConversationTurn } from '../types';

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
