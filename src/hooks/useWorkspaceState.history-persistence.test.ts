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
