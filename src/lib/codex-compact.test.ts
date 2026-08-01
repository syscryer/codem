import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyCompactReconcileResult,
  applyCompactEvent,
  compactCapabilityKey,
  createAutomaticCompactTurn,
  createManualCompactTurn,
  findPendingCompactTurn,
  findUnconfirmedManualCompactTurn,
  getCompactAvailability,
  interruptUnconfirmedCompactTurn,
  prepareCompactTurn,
  readCompactMetadata,
  retryCompactTurn,
  skipCompactTurn,
} from './codex-compact.js';
import type { AgentRunEvent, ConversationTurn } from '../types.js';

type ContextCompactionEvent = Extract<AgentRunEvent, { type: 'context-compaction' }>;
const useAgentRunSource = readFileSync(new URL('../hooks/useAgentRun.ts', import.meta.url), 'utf8');

function textTurn(id: string): ConversationTurn {
  return {
    id,
    userText: 'message',
    workspace: 'D:/workspace',
    assistantText: 'answer',
    tools: [],
    items: [{ id: `${id}-text`, type: 'text', text: 'answer' }],
    status: 'done',
  };
}

function compactTurn(operationId: string): ConversationTurn {
  return createManualCompactTurn({
    operationId,
    providerThreadId: 'provider-thread-1',
    workspace: 'D:/workspace',
    status: 'preparing',
    nowMs: 100,
  });
}

function completedEvent(operationId: string): ContextCompactionEvent {
  return {
    type: 'context-compaction',
    runId: 'run-compact-1',
    operationId,
    source: 'manual',
    status: 'completed',
    providerThreadId: 'provider-thread-1',
    providerTurnId: 'provider-turn-1',
    providerItemId: 'provider-item-1',
    atMs: 200,
  };
}

test('createManualCompactTurn creates one system turn without a fake user message', () => {
  const turn = createManualCompactTurn({
    operationId: 'compact-1',
    providerThreadId: 'provider-thread-1',
    workspace: 'D:/workspace',
    status: 'waiting',
    nowMs: 100,
  });

  assert.equal(turn.kind, 'system');
  assert.equal(turn.userText, '');
  assert.equal(turn.items.length, 1);
  assert.equal(turn.items[0]?.type, 'system-command');
  assert.equal(
    turn.items[0]?.type === 'system-command' ? turn.items[0].compact?.status : '',
    'waiting',
  );
});

test('applyCompactEvent updates the existing card and preserves sibling turn identities', () => {
  const before = [textTurn('turn-1'), compactTurn('compact-1'), textTurn('turn-2')];
  const after = applyCompactEvent(before, completedEvent('compact-1'));

  assert.equal(after[0], before[0]);
  assert.notEqual(after[1], before[1]);
  assert.equal(after[2], before[2]);
  assert.equal(readCompactMetadata(after[1])?.status, 'completed');
  assert.equal(readCompactMetadata(after[1])?.providerItemId, 'provider-item-1');
});

test('compact lifecycle updates only its target in a 200-turn history', () => {
  const targetIndex = 137;
  const before = Array.from({ length: 200 }, (_, index) => textTurn(`turn-${index}`));
  before[targetIndex] = compactTurn('compact-1');

  const running = applyCompactEvent(before, {
    ...completedEvent('compact-1'),
    status: 'running',
  });
  const completed = applyCompactEvent(running, completedEvent('compact-1'));

  assert.notEqual(running, before);
  assert.notEqual(completed, running);
  assert.notEqual(running[targetIndex], before[targetIndex]);
  assert.notEqual(completed[targetIndex], running[targetIndex]);
  assert.equal(readCompactMetadata(running[targetIndex])?.status, 'running');
  assert.equal(readCompactMetadata(completed[targetIndex])?.status, 'completed');

  for (let index = 0; index < before.length; index += 1) {
    if (index === targetIndex) {
      continue;
    }
    assert.equal(running[index], before[index]);
    assert.equal(completed[index], running[index]);
  }
});

test('duplicate compact completion returns the original turn array', () => {
  const event = completedEvent('compact-1');
  const completed = applyCompactEvent([compactTurn('compact-1')], event);
  const duplicate = applyCompactEvent(completed, event);

  assert.equal(duplicate, completed);
});

test('manual compact events never update a different operation', () => {
  const before = [compactTurn('compact-a')];
  const after = applyCompactEvent(before, completedEvent('compact-b'));

  assert.equal(after, before);
  assert.equal(readCompactMetadata(after[0])?.status, 'preparing');
});

test('automatic compact turns use provider identity for a stable operation id', () => {
  const event: ContextCompactionEvent = {
    ...completedEvent('ignored'),
    operationId: undefined,
    source: 'automatic',
  };
  const first = createAutomaticCompactTurn(event, 'D:/workspace');
  const second = createAutomaticCompactTurn(event, 'D:/workspace');

  assert.equal(first.id, second.id);
  assert.equal(readCompactMetadata(first)?.operationId, readCompactMetadata(second)?.operationId);
  assert.equal(readCompactMetadata(first)?.source, 'automatic');
});

test('automatic compact event keeps the runtime workspace when history is empty', () => {
  const event: ContextCompactionEvent = {
    ...completedEvent('ignored'),
    operationId: undefined,
    source: 'automatic',
  };
  const turns = applyCompactEvent([], event, 'D:/runtime-workspace');

  assert.equal(turns[0]?.workspace, 'D:/runtime-workspace');
});

test('automatic compact never completes a pending manual compact card', () => {
  const manual = createManualCompactTurn({
    operationId: 'manual-1',
    providerThreadId: 'provider-thread-1',
    workspace: 'D:/workspace',
    status: 'waiting',
    nowMs: 100,
  });
  const automatic: ContextCompactionEvent = {
    ...completedEvent('ignored'),
    operationId: undefined,
    source: 'automatic',
    providerTurnId: 'automatic-turn-1',
  };
  const turns = applyCompactEvent([manual], automatic, 'D:/workspace');

  assert.equal(turns.length, 2);
  assert.equal(readCompactMetadata(turns[0])?.status, 'waiting');
  assert.equal(readCompactMetadata(turns[1])?.source, 'automatic');
  assert.equal(readCompactMetadata(turns[1])?.status, 'completed');
});

test('compact errors redact assignments and stay bounded', () => {
  const failed = applyCompactEvent([compactTurn('compact-1')], {
    ...completedEvent('compact-1'),
    status: 'failed',
    error: `OPENAI_API_KEY=secret-value token=other-secret ${'x'.repeat(3_000)}`,
  });
  const error = readCompactMetadata(failed[0])?.error ?? '';

  assert.ok(error.length <= 2_000);
  assert.doesNotMatch(error, /secret-value|other-secret/);
  assert.match(error, /OPENAI_API_KEY=\[已隐藏\]/);
});

test('retry reuses the card while skip and restart interruption preserve the failure fact', () => {
  const original = compactTurn('compact-1');
  const failed = applyCompactEvent([original], {
    ...completedEvent('compact-1'),
    status: 'failed',
    error: 'failed',
  })[0];
  const retried = retryCompactTurn(failed, 300);
  const skipped = skipCompactTurn(failed, 400);
  const interrupted = interruptUnconfirmedCompactTurn(original, 500);

  assert.equal(retried.id, failed.id);
  assert.equal(readCompactMetadata(retried)?.attempt, 2);
  assert.equal(readCompactMetadata(retried)?.status, 'preparing');
  assert.equal(readCompactMetadata(skipped)?.status, 'failed');
  assert.equal(readCompactMetadata(skipped)?.resolution, 'skipped');
  assert.equal(readCompactMetadata(interrupted)?.status, 'interrupted');
  assert.equal(findPendingCompactTurn([skipped]), null);
  assert.equal(findPendingCompactTurn([interrupted])?.id, interrupted.id);
});

test('compact availability reports provider, session, capability and busy reasons', () => {
  assert.equal(
    getCompactAvailability({
      providerId: 'claude-code',
      sessionId: 'session-1',
      capability: { state: 'supported' },
    }).available,
    false,
  );
  assert.match(
    getCompactAvailability({
      providerId: 'openai-codex',
      capability: { state: 'supported' },
    }).reason,
    /至少一轮/,
  );
  assert.match(
    getCompactAvailability({
      providerId: 'openai-codex',
      sessionId: 'session-1',
      capability: { state: 'unsupported' },
    }).reason,
    /升级/,
  );
  assert.equal(
    getCompactAvailability({
      providerId: 'openai-codex',
      sessionId: 'session-1',
      capability: { state: 'supported' },
      activeStatus: 'running',
    }).busy,
    true,
  );
  assert.deepEqual(
    getCompactAvailability({
      providerId: 'openai-codex',
      sessionId: 'session-1',
      capability: { state: 'supported' },
    }),
    { available: true, busy: false, reason: '' },
  );
});

test('compact capability key changes with session, workspace, channel and runtime selection', () => {
  const base = {
    threadId: 'thread-1',
    sessionId: 'session-1',
    workingDirectory: 'D:/workspace',
    channelId: 'channel-1',
    model: 'gpt-5.3-codex',
    reasoningEffort: 'high',
    permissionMode: 'default',
  };
  const first = compactCapabilityKey(base);

  for (const patch of [
    { sessionId: 'session-2' },
    { workingDirectory: 'D:/other' },
    { channelId: 'channel-2' },
    { model: 'gpt-5.4' },
    { reasoningEffort: 'medium' },
    { permissionMode: 'auto' },
  ]) {
    assert.notEqual(compactCapabilityKey({ ...base, ...patch }), first);
  }
});

test('preparing a waiting compact updates the same card without incrementing attempt', () => {
  const waiting = createManualCompactTurn({
    operationId: 'compact-1',
    providerThreadId: 'provider-thread-1',
    workspace: 'D:/workspace',
    status: 'waiting',
    nowMs: 100,
  });
  const preparing = prepareCompactTurn(waiting);

  assert.equal(preparing.id, waiting.id);
  assert.equal(readCompactMetadata(preparing)?.status, 'preparing');
  assert.equal(readCompactMetadata(preparing)?.attempt, 1);
});

test('restart reconciliation selects only the latest unfinished manual compact', () => {
  const automatic = createAutomaticCompactTurn({
    ...completedEvent('ignored'),
    operationId: undefined,
    source: 'automatic',
    status: 'running',
  }, 'D:/workspace');
  const interrupted = interruptUnconfirmedCompactTurn(compactTurn('compact-old'), 200);
  const waiting = createManualCompactTurn({
    operationId: 'compact-waiting',
    providerThreadId: 'provider-thread-1',
    workspace: 'D:/workspace',
    status: 'waiting',
    nowMs: 300,
  });

  assert.equal(
    findUnconfirmedManualCompactTurn([automatic, interrupted, waiting])?.id,
    waiting.id,
  );
  assert.equal(findUnconfirmedManualCompactTurn([automatic, interrupted]), null);
});

test('restart reconciliation updates the existing compact card without adding a turn', () => {
  const running = compactTurn('compact-1');
  const confirmed = applyCompactReconcileResult(running, {
    state: 'confirmed',
    providerTurnId: 'provider-turn-recovered',
    providerItemId: 'provider-item-recovered',
  }, 500);
  const interrupted = applyCompactReconcileResult(running, { state: 'not_found' }, 600);

  assert.equal(confirmed.id, running.id);
  assert.equal(readCompactMetadata(confirmed)?.status, 'completed');
  assert.equal(readCompactMetadata(confirmed)?.providerTurnId, 'provider-turn-recovered');
  assert.equal(readCompactMetadata(confirmed)?.providerItemId, 'provider-item-recovered');
  assert.equal(interrupted.id, running.id);
  assert.equal(readCompactMetadata(interrupted)?.status, 'interrupted');
});

test('useAgentRun routes compact lifecycle before ordinary turn events', () => {
  assert.match(
    useAgentRunSource,
    /if \(event\.type === 'context-compaction'\) \{[\s\S]*applyContextCompactionEvent\([\s\S]*return;\s*\}/,
  );
  assert.match(
    useAgentRunSource,
    /async function requestThreadCompaction\([\s\S]*trigger: 'slash' \| 'context' \| 'retry'/,
  );
  assert.match(useAgentRunSource, /\/api\/agents\/codex\/compact-capability/);
  assert.match(useAgentRunSource, /\/api\/agents\/runtime\/\$\{encodeURIComponent\(thread\.id\)\}\/compact/);
  assert.match(useAgentRunSource, /reconciledCompactOperationIdsRef/);
  assert.match(useAgentRunSource, /\/compact\/reconcile/);
  const reconcileFunction = useAgentRunSource.match(
    /async function reconcilePersistedCompactOperation[\s\S]*?\n  function [a-zA-Z]/,
  )?.[0] ?? '';
  assert.doesNotMatch(reconcileFunction, /requestThreadCompaction|startCompactRequest/);
});
