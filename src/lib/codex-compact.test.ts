import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCompactEvent,
  createAutomaticCompactTurn,
  createManualCompactTurn,
  findPendingCompactTurn,
  getCompactAvailability,
  interruptUnconfirmedCompactTurn,
  readCompactMetadata,
  retryCompactTurn,
  skipCompactTurn,
} from './codex-compact.js';
import type { AgentRunEvent, ConversationTurn } from '../types.js';

type ContextCompactionEvent = Extract<AgentRunEvent, { type: 'context-compaction' }>;

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
