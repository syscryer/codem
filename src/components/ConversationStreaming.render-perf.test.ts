import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const turnSource = readFileSync(new URL('./ConversationTurn.tsx', import.meta.url), 'utf8');
const agentRunSource = readFileSync(new URL('../hooks/useAgentRun.ts', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../hooks/useWorkspaceState.ts', import.meta.url), 'utf8');

test('streaming markdown yields expensive parsing behind deferred content', () => {
  assert.match(turnSource, /const deferredContent = useDeferredValue\(content\);/);
  assert.match(turnSource, /\{deferredContent\}\s*<\/ReactMarkdown>/);
});

test('generic agent deltas do not schedule a full-history persist every animation frame', () => {
  const flushStart = agentRunSource.indexOf('function flushTextDelta(context: AgentRunContext)');
  const flushEnd = agentRunSource.indexOf('async function stopRun', flushStart);
  const flushTextDelta = agentRunSource.slice(flushStart, flushEnd);

  assert.notEqual(flushStart, -1);
  assert.notEqual(flushEnd, -1);
  assert.match(flushTextDelta, /updateThreadTurn\(/);
  assert.doesNotMatch(flushTextDelta, /schedulePersistThreadHistory/);
});

test('history persistence debounce leaves room for interaction during bursty updates', () => {
  assert.match(workspaceSource, /const PERSIST_HISTORY_DEBOUNCE_MS = 750;/);
});
