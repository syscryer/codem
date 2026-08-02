import assert from 'node:assert/strict';
import test from 'node:test';
import type { ThreadForkResponse, ThreadSummary } from '../types';
import {
  getThreadForkAvailability,
  threadDetailFromForkResponse,
  threadForkCapabilityKey,
} from './thread-fork';

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
    agentChannelFingerprint: 'fingerprint-1',
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
            id: 'provider:provider-child:turn-1',
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

test('fork availability supports Claude Code and Codex CLI', () => {
  const base = {
    capability: { state: 'supported' as const },
    busy: false,
    pendingHumanRequest: false,
    forking: false,
  };

  assert.deepEqual(
    getThreadForkAvailability({ ...base, thread: thread({ provider: 'openai-codex' }) }),
    { enabled: true },
  );
  assert.deepEqual(
    getThreadForkAvailability({ ...base, thread: thread({ provider: 'claude-code' }) }),
    { enabled: true },
  );
  assert.deepEqual(
    getThreadForkAvailability({ ...base, thread: thread({ provider: 'opencode' }) }),
    { enabled: false, reason: '当前 Agent 暂不支持在新聊天中继续' },
  );
});

test('fork availability uses provider-aware capability messages', () => {
  const base = {
    busy: false,
    pendingHumanRequest: false,
    forking: false,
  };
  const providers = [
    { provider: 'openai-codex', agent: 'Codex CLI' },
    { provider: 'claude-code', agent: 'Claude Code' },
  ];

  for (const { provider, agent } of providers) {
    assert.deepEqual(
      getThreadForkAvailability({
        ...base,
        thread: thread({ provider, sessionId: '' }),
        capability: { state: 'supported' },
      }),
      { enabled: false, reason: `当前聊天尚未绑定 ${agent} 会话` },
    );
    assert.deepEqual(
      getThreadForkAvailability({ ...base, thread: thread({ provider }), capability: undefined }),
      { enabled: false, reason: `正在检查 ${agent} Fork 能力` },
    );
    assert.deepEqual(
      getThreadForkAvailability({
        ...base,
        thread: thread({ provider }),
        capability: { state: 'checking' },
      }),
      { enabled: false, reason: `正在检查 ${agent} Fork 能力` },
    );
    assert.deepEqual(
      getThreadForkAvailability({
        ...base,
        thread: thread({ provider }),
        capability: { state: 'unsupported' },
      }),
      {
        enabled: false,
        reason: `当前 ${agent} 不支持在新聊天中继续，请升级 ${agent}。`,
      },
    );
    assert.deepEqual(
      getThreadForkAvailability({
        ...base,
        thread: thread({ provider }),
        capability: { state: 'unsupported', message: 'method not found' },
      }),
      {
        enabled: false,
        reason: `当前 ${agent} 不支持在新聊天中继续，请升级 ${agent}。method not found`,
      },
    );
  }
});

test('fork availability preserves runtime and operation gates', () => {
  const base = {
    thread: thread(),
    capability: { state: 'supported' as const },
    busy: false,
    pendingHumanRequest: false,
    forking: false,
  };

  assert.deepEqual(getThreadForkAvailability({ ...base, busy: true }), {
    enabled: false,
    reason: '当前聊天正在运行',
  });
  assert.deepEqual(getThreadForkAvailability({ ...base, pendingHumanRequest: true }), {
    enabled: false,
    reason: '当前聊天正在等待确认或输入',
  });
  assert.deepEqual(getThreadForkAvailability({ ...base, forking: true }), {
    enabled: false,
    reason: '正在创建新聊天',
  });
  assert.deepEqual(
    getThreadForkAvailability({
      ...base,
      capability: { state: 'error', message: 'probe failed' },
    }),
    { enabled: false, reason: 'probe failed' },
  );
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
  assert.deepEqual(detail.debugEvents, []);
  assert.deepEqual(detail.rawEvents, []);
  assert.equal(detail.historyLoaded, false);
  assert.equal(detail.historyLoading, false);
});

test('fork response rejects inconsistent thread identities', () => {
  const mismatchedThread = response('loaded');
  mismatchedThread.threadId = 'other-thread';
  assert.throws(() => threadDetailFromForkResponse(mismatchedThread), /聊天 ID 不一致/);

  const mismatchedHistory = response('loaded');
  mismatchedHistory.history.threadId = 'other-thread';
  assert.throws(() => threadDetailFromForkResponse(mismatchedHistory), /聊天 ID 不一致/);
});

test('fork capability key changes with every trusted runtime identity field', () => {
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
    { agentChannelFingerprint: 'fingerprint-2' },
  ];
  for (const change of changes) {
    assert.notEqual(threadForkCapabilityKey(thread(change)), baseKey);
  }
  assert.equal(threadForkCapabilityKey({ ...source }), baseKey);
});
