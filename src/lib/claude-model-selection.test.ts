import assert from 'node:assert/strict';
import test from 'node:test';

import type { ClaudeModelOption } from '../types';
import {
  hasClaudeContext1mOptions,
  resolveInitialClaudeModelId,
  resolveRunModelSelection,
} from './claude-model-selection';

const glmModels: ClaudeModelOption[] = [
  { id: '__default', label: '默认', kind: 'default' },
  { id: 'sonnet', label: 'Sonnet', model: 'glm-5.1', kind: 'slot' },
  { id: 'opus', label: 'Opus', model: 'glm-5.1', kind: 'slot' },
  { id: 'haiku', label: 'Haiku', model: 'glm-5.1', kind: 'slot' },
];

const mimoModels: ClaudeModelOption[] = [
  { id: '__default', label: '默认', model: 'MiniMax-M2', kind: 'default' },
  { id: 'sonnet', label: 'Sonnet', model: 'MiniMax-M2', kind: 'slot' },
];

test('resolveInitialClaudeModelId falls back when a stale Claude 1M slot is unavailable', () => {
  assert.equal(resolveInitialClaudeModelId('sonnet[1m]', glmModels, '__default'), '__default');
});

test('resolveInitialClaudeModelId avoids arbitrarily picking a duplicated gateway slot', () => {
  assert.equal(resolveInitialClaudeModelId('glm-5.1', glmModels, '__default'), '__default');
});

test('resolveInitialClaudeModelId falls back to settings default when a stale Claude model is no longer configured', () => {
  assert.equal(resolveInitialClaudeModelId('claude-opus-4-7', glmModels, '__default'), '__default');
});

test('resolveInitialClaudeModelId preserves unknown non-slot model ids', () => {
  assert.equal(resolveInitialClaudeModelId('provider/custom-model', glmModels, '__default'), 'provider/custom-model');
});

test('resolveInitialClaudeModelId falls back for stale bare provider model ids', () => {
  assert.equal(resolveInitialClaudeModelId('glm-5.1', mimoModels, '__default'), '__default');
});

test('hasClaudeContext1mOptions only enables the wide model menu when a usable 1M toggle exists', () => {
  assert.equal(hasClaudeContext1mOptions(glmModels), false);
  assert.equal(
    hasClaudeContext1mOptions([
      ...glmModels,
      { id: 'opus', label: 'Opus', model: 'opus', supportsContext1m: true, context1mModel: 'opus[1m]' },
    ]),
    true,
  );
});

test('resolveRunModelSelection refreshes stale provider default models before sending', () => {
  assert.deepEqual(resolveRunModelSelection('glm-5.1', mimoModels, '__default', glmModels), {
    selectedModelId: '__default',
    requestModel: undefined,
    staleProviderModel: true,
  });
});

test('resolveRunModelSelection falls back for old threads that only saved a stale bare model', () => {
  assert.deepEqual(resolveRunModelSelection('glm-5.1', mimoModels, '__default'), {
    selectedModelId: '__default',
    requestModel: undefined,
    staleProviderModel: true,
  });
});

test('resolveRunModelSelection preserves explicit custom models before sending', () => {
  assert.deepEqual(resolveRunModelSelection('provider/custom-model', mimoModels, '__default'), {
    selectedModelId: 'provider/custom-model',
    requestModel: 'provider/custom-model',
    staleProviderModel: false,
  });
});
