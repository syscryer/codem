import assert from 'node:assert/strict';
import test from 'node:test';
import type { ThreadForkResponse, ThreadSummary } from '../types';
import {
  getThreadForkAvailability,
  threadDetailFromForkResponse,
  threadForkCapabilityKey,
} from './codex-thread-fork';

function thread(overrides: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id: 'source-local',
    projectId: 'project-1',
    title: 'Source chat',
    sessionId: 'source-provider',
    workingDirectory: 'D:/workspace',
    updatedAt: '2026-08-02T00:00:00.000Z',
    updatedLabel: '刚刚',
    provider: 'openai-codex',
    model: 'gpt-5-codex',
    reasoningEffort: 'high',
    permissionMode: 'auto',
    agentChannelId: 'channel-1',
    ...overrides,
  };
}

function response(historyState: 'loaded' | 'pending'): ThreadForkResponse {
  const child = thread({ id: 'local-child', sessionId: 'provider-child' });
  return {
    ok: true,
    operationId: 'operation-1',
    threadId: child.id,
    thread: child,
    historyState,
    history: {
      threadId: child.id,
      turns: historyState === 'loaded'
        ? [{
            id: 'codex:provider-child:turn-1',
            userText: 'hello',
            workspace: child.workingDirectory,
            assistantText: 'answer',
            tools: [],
            items: [{ id: 'text-1', type: 'text', text: 'answer' }],
            status: 'done',
          }]
        : [],
    },
  };
}

test('fork availability reports every blocking reason', () => {
  const base = {
    thread: thread(),
    capability: { state: 'supported' as const },
    busy: false,
    pendingHumanRequest: false,
    forking: false,
  };
  assert.deepEqual(
    getThreadForkAvailability({ ...base, thread: thread({ provider: 'claude-code' }) }),
    { enabled: false, reason: '仅 Codex 聊天支持在新聊天中继续' },
  );
  assert.deepEqual(
    getThreadForkAvailability({ ...base, thread: thread({ sessionId: '' }) }),
    { enabled: false, reason: '当前聊天尚未绑定 Codex 会话' },
  );
  assert.deepEqual(getThreadForkAvailability({ ...base, busy: true }), {
    enabled: false,
    reason: '当前聊天正在运行',
  });
  assert.deepEqual(getThreadForkAvailability({ ...base, pendingHumanRequest: true }), {
    enabled: false,
    reason: '当前聊天正在等待确认或输入',
  });
  assert.deepEqual(getThreadForkAvailability({ ...base, capability: undefined }), {
    enabled: false,
    reason: '正在检查 Codex Fork 能力',
  });
  assert.match(
    getThreadForkAvailability({ ...base, capability: { state: 'unsupported' } }).reason ?? '',
    /升级 Codex CLI/,
  );
  assert.match(
    getThreadForkAvailability({
      ...base,
      capability: { state: 'unsupported', message: 'method not found' },
    }).reason ?? '',
    /升级 Codex CLI/,
  );
  assert.deepEqual(
    getThreadForkAvailability({
      ...base,
      capability: { state: 'error', message: 'probe failed' },
    }),
    { enabled: false, reason: 'probe failed' },
  );
  assert.deepEqual(getThreadForkAvailability({ ...base, forking: true }), {
    enabled: false,
    reason: '正在创建新聊天',
  });
  assert.deepEqual(getThreadForkAvailability(base), { enabled: true });
});

test('fork response creates an isolated loaded ThreadDetail', () => {
  const detail = threadDetailFromForkResponse(response('loaded'));
  assert.equal(detail.id, 'local-child');
  assert.equal(detail.sessionId, 'provider-child');
  assert.equal(detail.turns[0]?.assistantText, 'answer');
  assert.deepEqual(detail.debugEvents, []);
  assert.deepEqual(detail.rawEvents, []);
  assert.equal(detail.historyLoaded, true);
  assert.equal(detail.historyLoading, false);
});

test('history-pending fork detail stays recoverable without source fallback', () => {
  assert.equal(threadDetailFromForkResponse.length, 1);
  const detail = threadDetailFromForkResponse(response('pending'));
  assert.equal(detail.id, 'local-child');
  assert.equal(detail.sessionId, 'provider-child');
  assert.deepEqual(detail.turns, []);
  assert.equal(detail.historyLoaded, false);
  assert.equal(detail.historyLoading, false);
});

test('fork capability key changes with trusted runtime identity', () => {
  const source = thread();
  const baseKey = threadForkCapabilityKey(source);
  const changes: Array<Partial<ThreadSummary>> = [
    { provider: 'claude-code' },
    { sessionId: 'provider-other' },
    { workingDirectory: 'D:/workspace/subdir' },
    { model: 'gpt-5.1-codex' },
    { reasoningEffort: 'medium' },
    { permissionMode: 'bypassPermissions' },
    { agentChannelId: 'channel-2' },
  ];
  for (const change of changes) {
    assert.notEqual(threadForkCapabilityKey(thread(change)), baseKey);
  }
  assert.equal(threadForkCapabilityKey({ ...source }), baseKey);
});
