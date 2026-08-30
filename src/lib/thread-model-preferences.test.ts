import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MODEL_VALUE } from '../constants.js';
import {
  collectThreadModelPreferences,
  isModelSelectionChannelReady,
  nextThreadModelPreferences,
  reasoningEffortForThreadModel,
  shouldKeepPendingReasoningEffort,
  threadModelPreferenceKey,
  updateThreadModelReasoningEffort,
} from './thread-model-preferences.js';

test('provider default model keeps a stable preference key', () => {
  assert.equal(threadModelPreferenceKey(undefined), DEFAULT_MODEL_VALUE);
  assert.equal(threadModelPreferenceKey(null), DEFAULT_MODEL_VALUE);
  assert.equal(threadModelPreferenceKey(DEFAULT_MODEL_VALUE), DEFAULT_MODEL_VALUE);
  assert.equal(threadModelPreferenceKey('model-a'), 'model-a');
});

test('draft model restoration waits for the draft channel transition', () => {
  assert.equal(isModelSelectionChannelReady('thread-channel', 'draft-channel'), false);
  assert.equal(isModelSelectionChannelReady('draft-channel', 'draft-channel'), true);
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

test('current reasoning effort overrides a stale preference for the same model', () => {
  assert.deepEqual(
    collectThreadModelPreferences({
      model: 'model-a',
      reasoningEffort: 'low',
      modelPreferences: { 'model-a': 'high', 'model-b': 'medium' },
    }),
    { 'model-a': 'low', 'model-b': 'medium' },
  );
});

test('local metadata patch replaces a stale same-model preference', () => {
  const nextPreferences = nextThreadModelPreferences(
    {
      model: 'grok-4.6',
      reasoningEffort: 'high',
      modelPreferences: { 'grok-4.6': 'high' },
    },
    { reasoningEffort: 'low' },
  );
  assert.deepEqual(nextPreferences, { 'grok-4.6': 'low' });
  assert.equal(
    reasoningEffortForThreadModel(nextPreferences ?? {}, 'grok-4.6'),
    'low',
  );
});

test('channel changes keep existing model preferences', () => {
  assert.deepEqual(
    nextThreadModelPreferences(
      {
        model: 'grok-4.6',
        reasoningEffort: 'low',
        modelPreferences: { 'grok-4.6': 'low', 'grok-4': 'high' },
      },
      {},
      { channelChanged: true },
    ),
    { 'grok-4.6': 'low', 'grok-4': 'high' },
  );
});

test('pending effort stays until the restored thread matches the newest selection', () => {
  const pending = { model: 'grok-4.6', reasoningEffort: 'low' };
  assert.equal(
    shouldKeepPendingReasoningEffort(pending, {
      resolvedEffort: 'low',
      threadEffort: 'high',
      threadPreferences: { 'grok-4.6': 'high' },
    }),
    true,
  );
  assert.equal(
    shouldKeepPendingReasoningEffort(pending, {
      resolvedEffort: 'low',
      threadEffort: 'low',
      threadPreferences: { 'grok-4.6': 'low' },
    }),
    false,
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
