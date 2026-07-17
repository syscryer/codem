import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspaceSource = readFileSync(new URL('./useWorkspaceState.ts', import.meta.url), 'utf8');
const claudeRunSource = readFileSync(new URL('./useClaudeRun.ts', import.meta.url), 'utf8');
const agentRunSource = readFileSync(new URL('./useAgentRun.ts', import.meta.url), 'utf8');

test('ordinary history checkpoints keep a minimum interval after a successful write', () => {
  assert.match(workspaceSource, /const PERSIST_HISTORY_CHECKPOINT_INTERVAL_MS = 10_000;/);
  assert.match(
    workspaceSource,
    /state\.lastPersistedAtMs \+ PERSIST_HISTORY_CHECKPOINT_INTERVAL_MS - Date\.now\(\)/,
  );
  assert.match(workspaceSource, /state\.lastPersistedAtMs = Date\.now\(\);/);
  assert.match(workspaceSource, /if \(state\.timerId !== null && !state\.urgent\) \{\s*return;\s*\}/);
});

test('urgent history checkpoints bypass the interval without starting parallel writes', () => {
  assert.match(workspaceSource, /state\.urgent \|\|= options\?\.urgent === true;/);
  assert.match(workspaceSource, /if \(state\.inFlight\) \{\s*return;\s*\}/);
  assert.match(workspaceSource, /if \(state\.urgent\) \{\s*return 0;\s*\}/);
});

test('active history retries keep their retry budget when new events arrive', () => {
  assert.match(
    workspaceSource,
    /const retryCycleActive = state\.inFlight \|\| state\.retryTimerId !== null;/,
  );
  assert.match(
    workspaceSource,
    /if \(!retryCycleActive\) \{\s*state\.retryCount = 0;\s*\}\s*state\.pending = true;/,
  );
  assert.match(
    workspaceSource,
    /if \(state\.pending && state\.retryTimerId === null\) \{\s*const scheduledState[^;]+;\s*scheduledState\.retryCount = 0;/,
  );
});

test('removing a thread releases pending history and log state', () => {
  const cleanupIndex = workspaceSource.indexOf(
    'removePersistHistoryState(persistHistoryStateRef, removedThreadId);',
  );
  const selectionPersistIndex = workspaceSource.indexOf(
    'await persistSelection(activeProjectId, nextActiveThreadId);',
    cleanupIndex,
  );

  assert.notEqual(cleanupIndex, -1);
  assert.ok(selectionPersistIndex > cleanupIndex);
  assert.match(workspaceSource, /pendingLogBatchesRef\.current\.delete\(removedThreadId\);/);
  assert.match(workspaceSource, /window\.clearTimeout\(state\.timerId\);/);
  assert.match(workspaceSource, /window\.clearTimeout\(state\.retryTimerId\);/);
  assert.match(workspaceSource, /persistHistoryStateRef\.current\.delete\(threadId\);/);
});

test('history loading preserves turns changed after the request started', () => {
  assert.match(workspaceSource, /const turnsAtRequest = currentDetail\?\.turns;/);
  assert.match(
    workspaceSource,
    /preserveCurrentChanges: turnsAtRequest !== undefined && existing\.turns !== turnsAtRequest/,
  );
  assert.match(workspaceSource, /mergeLoadedThreadTurns\(repairedTurns, existing\.turns,/);
});

test('terminal and human interaction states request urgent persistence', () => {
  for (const eventType of ['request-user-input', 'approval-request', 'error', 'done']) {
    const eventStart = claudeRunSource.indexOf(`if (event.type === '${eventType}')`);
    const nextEvent = claudeRunSource.indexOf("if (event.type === '", eventStart + 1);
    const eventBody = claudeRunSource.slice(eventStart, nextEvent === -1 ? undefined : nextEvent);
    assert.notEqual(eventStart, -1);
    assert.match(eventBody, /schedulePersistThreadHistory\([^;]+\{ urgent: true \}\)/s);
  }

  assert.match(agentRunSource, /isAgentRunTerminalEvent\(event\) \|\|/);
  assert.match(agentRunSource, /event\.type === 'approval-request' \|\|/);
  assert.match(agentRunSource, /event\.type === 'request-user-input'/);
});
