import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const turnSource = readFileSync(new URL('./ConversationTurn.tsx', import.meta.url), 'utf8');
const agentRunSource = readFileSync(new URL('../hooks/useAgentRun.ts', import.meta.url), 'utf8');
const claudeRunSource = readFileSync(new URL('../hooks/useClaudeRun.ts', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../hooks/useWorkspaceState.ts', import.meta.url), 'utf8');

test('streaming markdown memoizes expensive parsing behind deferred content', () => {
  assert.match(turnSource, /const deferredContent = useDeferredValue\(content\);/);
  assert.match(turnSource, /const DeferredMarkdownContent = memo\(function DeferredMarkdownContent/);
  assert.match(turnSource, /<DeferredMarkdownContent content=\{deferredContent\}/);
  assert.match(turnSource, /\{content\}\s*<\/ReactMarkdown>/);
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

test('Claude high-frequency structured deltas are merged once per animation frame', () => {
  assert.match(claudeRunSource, /pendingIncrementalTurnUpdates/);
  assert.match(claudeRunSource, /requestAnimationFrame\(\(\) =>\s*flushQueuedIncrementalTurnUpdates/);

  for (const eventType of ['thinking-delta', 'tool-input-delta', 'subagent-delta']) {
    const eventStart = claudeRunSource.indexOf(`if (event.type === '${eventType}')`);
    const nextEvent = claudeRunSource.indexOf("if (event.type === '", eventStart + 1);
    const eventBody = claudeRunSource.slice(eventStart, nextEvent);
    assert.notEqual(eventStart, -1);
    assert.match(eventBody, /queueIncrementalTurnUpdate\(/);
  }
});

test('history persistence throttles checkpoints while urgent states bypass the interval', () => {
  assert.match(workspaceSource, /const PERSIST_HISTORY_DEBOUNCE_MS = 750;/);
  assert.match(workspaceSource, /const PERSIST_HISTORY_CHECKPOINT_INTERVAL_MS = 10_000;/);
  assert.match(workspaceSource, /if \(state\.urgent\) \{\s*return 0;\s*\}/);
  assert.match(workspaceSource, /state\.lastPersistedAtMs = Date\.now\(\);/);
  assert.match(claudeRunSource, /schedulePersistThreadHistory\(context\.threadId, \{ urgent: true \}\)/);
  assert.match(agentRunSource, /isAgentRunTerminalEvent\(event\) \|\|/);
});
