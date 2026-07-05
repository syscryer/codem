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

test('Claude effort selection preserves ultracode for the run request', () => {
  const source = readFileSync(new URL('./useClaudeRun.ts', import.meta.url), 'utf8');
  const normalizeIndex = source.indexOf('function normalizeClaudeEffortSelection');
  const resolveIndex = source.indexOf('function resolveRequestEffort');
  assert.notEqual(normalizeIndex, -1);
  assert.notEqual(resolveIndex, -1);

  const normalizeBody = source.slice(normalizeIndex, resolveIndex);
  assert.match(normalizeBody, /value === ['"]ultracode['"]/);
  assert.match(source.slice(resolveIndex), /return effort === ['"]default['"] \? undefined : effort/);
});

test('stopRun softly interrupts the active Claude turn before hard cancellation fallback', () => {
  const source = readFileSync(new URL('./useClaudeRun.ts', import.meta.url), 'utf8');
  const stopIndex = source.indexOf('async function stopRun(');
  const nextFunctionIndex = source.indexOf('async function submitRequestUserInput', stopIndex);
  assert.notEqual(stopIndex, -1);
  assert.notEqual(nextFunctionIndex, -1);

  const stopBody = source.slice(stopIndex, nextFunctionIndex);
  assert.match(source, /const CLAUDE_INTERRUPT_FALLBACK_MS\s*=/);
  assert.match(stopBody, /context\.interrupting/);
  assert.match(stopBody, /fetch\(`\/api\/claude\/run\/\$\{currentRunId\}\/interrupt`/);
  assert.match(stopBody, /method:\s*['"]POST['"]/);
  assert.match(stopBody, /window\.setTimeout\(/);
  assert.match(stopBody, /fetch\(`\/api\/claude\/run\/\$\{currentRunId\}`/);
  assert.match(stopBody, /method:\s*['"]DELETE['"]/);
  assert.doesNotMatch(stopBody, /context\.abortController\?\.abort\(\)[\s\S]{0,240}\/interrupt/);
});

test('soft interrupt keeps queued prompts retained instead of auto-continuing', () => {
  const source = readFileSync(new URL('./useClaudeRun.ts', import.meta.url), 'utf8');
  const consumeIndex = source.indexOf('async function consumeClaudeEventStream');
  const handleLineIndex = source.indexOf('function handleStreamLine', consumeIndex);
  assert.notEqual(consumeIndex, -1);
  assert.notEqual(handleLineIndex, -1);

  const consumeBody = source.slice(consumeIndex, handleLineIndex);
  assert.match(consumeBody, /completedSuccessfully && !context\.interruptRequested/);
  assert.match(consumeBody, /maybeStartQueuedPrompt\(context\)/);
  assert.match(consumeBody, /notifyQueuedPromptsRetained\(context\.threadId\)/);
});

test('stream frames do not refresh the running clock on every line', () => {
  const source = readFileSync(new URL('./useClaudeRun.ts', import.meta.url), 'utf8');
  const handleLineIndex = source.indexOf('function handleStreamLine');
  const handleEventIndex = source.indexOf('function handleClaudeEvent', handleLineIndex);
  assert.notEqual(handleLineIndex, -1);
  assert.notEqual(handleEventIndex, -1);

  const handleLineBody = source.slice(handleLineIndex, handleEventIndex);
  assert.doesNotMatch(handleLineBody, /setClockNowMs\(Date\.now\(\)\)/);
  assert.doesNotMatch(handleLineBody, /markRunStreamProgress\(\)/);
  assert.match(source, /window\.setInterval\(\(\) => \{\s*setClockNowMs\(Date\.now\(\)\);\s*\}, 1000\)/);
});
