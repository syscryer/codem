import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('startRun shows the submitted user turn before refreshing Claude models', () => {
  const source = readFileSync(new URL('./useClaudeRun.ts', import.meta.url), 'utf8');
  const startRunIndex = source.indexOf('async function startRun(');
  assert.notEqual(startRunIndex, -1);

  const startRunBody = source.slice(startRunIndex);
  const showSubmittedTurnIndex = startRunBody.indexOf('updateThreadDetail(');
  const fetchRunIndex = startRunBody.indexOf("fetch('/api/claude/run'");
  const refreshModelsIndex = startRunBody.indexOf('void loadClaudeModels()');

  assert.notEqual(showSubmittedTurnIndex, -1);
  assert.notEqual(fetchRunIndex, -1);
  assert.notEqual(refreshModelsIndex, -1);
  assert.ok(
    showSubmittedTurnIndex < refreshModelsIndex,
    'submitted user turn should be inserted before async model refresh',
  );
  assert.ok(
    fetchRunIndex < refreshModelsIndex,
    'run request should be started before refreshing models in the background',
  );
  assert.doesNotMatch(startRunBody, /await loadClaudeModels\(\)/);
});

test('startRun resolves after launching the run lifecycle in the background', () => {
  const source = readFileSync(new URL('./useClaudeRun.ts', import.meta.url), 'utf8');
  const startRunIndex = source.indexOf('async function startRun(');
  assert.notEqual(startRunIndex, -1);

  const startRunBody = source.slice(startRunIndex);
  assert.match(startRunBody, /void \(async \(\) => \{[\s\S]*await consumeClaudeEventStream\(response, context\);/);
  assert.match(startRunBody, /\}\)\(\);\s*return true;/);
});
