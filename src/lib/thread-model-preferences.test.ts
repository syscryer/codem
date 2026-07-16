import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MODEL_VALUE } from '../constants.js';
import {
  collectThreadModelPreferences,
  reasoningEffortForThreadModel,
  threadModelPreferenceKey,
  updateThreadModelReasoningEffort,
} from './thread-model-preferences.js';

test('provider default model keeps a stable preference key', () => {
  assert.equal(threadModelPreferenceKey(undefined), DEFAULT_MODEL_VALUE);
  assert.equal(threadModelPreferenceKey(null), DEFAULT_MODEL_VALUE);
  assert.equal(threadModelPreferenceKey(DEFAULT_MODEL_VALUE), DEFAULT_MODEL_VALUE);
  assert.equal(threadModelPreferenceKey('model-a'), 'model-a');
});

test('legacy current effort is merged into the current model preference', () => {
  assert.deepEqual(
    collectThreadModelPreferences({
      model: 'model-a',
      reasoningEffort: 'high',
      modelPreferences: { 'model-b': 'low' },
    }),
    { 'model-a': 'high', 'model-b': 'low' },
  );
});

test('each model keeps an independent reasoning effort', () => {
  let preferences = updateThreadModelReasoningEffort({}, 'model-a', 'high');
  preferences = updateThreadModelReasoningEffort(preferences, 'model-b', 'low');
  assert.equal(reasoningEffortForThreadModel(preferences, 'model-a'), 'high');
  assert.equal(reasoningEffortForThreadModel(preferences, 'model-b'), 'low');

  preferences = updateThreadModelReasoningEffort(preferences, 'model-a', 'default');
  assert.equal(reasoningEffortForThreadModel(preferences, 'model-a'), undefined);
  assert.equal(reasoningEffortForThreadModel(preferences, 'model-b'), 'low');
});
