import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('startRun shows the submitted user turn before refreshing Claude models', () => {
  const source = readFileSync(new URL('./useClaudeRun.ts', import.meta.url), 'utf8');
  const startRunIndex = source.indexOf('async function startRun(');
  assert.notEqual(startRunIndex, -1);

  const startRunBody = source.slice(startRunIndex);
  const showSubmittedTurnIndex = startRunBody.indexOf('updateThreadDetail(');
  const refreshModelsIndex = startRunBody.indexOf('await loadClaudeModels()');

  assert.notEqual(showSubmittedTurnIndex, -1);
  assert.notEqual(refreshModelsIndex, -1);
  assert.ok(
    showSubmittedTurnIndex < refreshModelsIndex,
    'submitted user turn should be inserted before async model refresh',
  );
});
