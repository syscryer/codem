import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MODEL_VALUE } from '../constants.js';
import type { AgentModelCatalog } from '../types.js';
import {
  defaultReasoningEffortForSelection,
  getAgentModelForSelection,
  resolveAgentModelSelection,
} from './agent-model-selection.js';

const catalog: AgentModelCatalog = {
  providerId: 'openai-codex',
  defaultModelId: 'model-default',
  models: [
    {
      id: 'model-default',
      label: 'Default model',
      isDefault: true,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }],
    },
    {
      id: 'model-fast',
      label: 'Fast model',
      isDefault: false,
      defaultReasoningEffort: 'low',
      supportedReasoningEfforts: [{ id: 'low' }],
    },
  ],
};

test('provider default resolves dynamically without hard-coding its model id', () => {
  assert.equal(getAgentModelForSelection(catalog, DEFAULT_MODEL_VALUE)?.id, 'model-default');
  assert.equal(defaultReasoningEffortForSelection(catalog, DEFAULT_MODEL_VALUE), 'medium');
});

test('saved model and reasoning effort restore when both remain available', () => {
  assert.deepEqual(resolveAgentModelSelection(catalog, 'model-default', 'high'), {
    modelId: 'model-default',
    reasoningEffort: 'high',
    selectedModel: catalog.models[0],
  });
});

test('stale saved model falls back visibly without changing the saved id', () => {
  const resolved = resolveAgentModelSelection(catalog, 'removed-model', 'xhigh');
  assert.equal(resolved.modelId, DEFAULT_MODEL_VALUE);
  assert.equal(resolved.reasoningEffort, 'medium');
  assert.equal(resolved.staleModelId, 'removed-model');
  assert.equal(resolved.staleReasoningEffort, 'xhigh');
});

test('changing models resolves that model default effort', () => {
  assert.equal(defaultReasoningEffortForSelection(catalog, 'model-fast'), 'low');
});
