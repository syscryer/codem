import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAgentRunEventToTurn,
  shouldSettleAgentStreamAsStopped,
} from './agent-run-events.js';
import type { AgentRunEvent, ConversationTurn } from '../types.js';

function createTurn(): ConversationTurn {
  return {
    id: 'turn-1',
    userText: 'inspect',
    workspace: 'D:/workspace',
    assistantText: '',
    tools: [],
    items: [],
    status: 'pending',
    activity: '正在启动',
    startedAtMs: Date.now() - 50,
    pendingUserInputRequests: [],
    pendingApprovalRequests: [],
  };
}

function apply(turn: ConversationTurn, event: AgentRunEvent) {
  return applyAgentRunEventToTurn(turn, event);
}

test('generic Agent events preserve text and tool ordering without duplicating final result', () => {
  let turn = createTurn();
  turn = apply(turn, { type: 'delta', runId: 'run-1', text: 'First. ' });
  turn = apply(turn, {
    type: 'tool-start',
    runId: 'run-1',
    blockIndex: 0,
    toolUseId: 'tool-1',
    name: 'Read',
    input: { file_path: 'README.md' },
  });
  turn = apply(turn, {
    type: 'tool-result',
    runId: 'run-1',
    toolUseId: 'tool-1',
    content: 'ok',
    isError: false,
  });
  turn = apply(turn, { type: 'delta', runId: 'run-1', text: 'Done.' });
  turn = apply(turn, {
    type: 'done',
    runId: 'run-1',
    sessionId: 'session-1',
    result: 'First. Done.',
    stopReason: 'end_turn',
  });

  assert.equal(turn.status, 'done');
  assert.equal(turn.sessionId, 'session-1');
  assert.equal(turn.assistantText, 'First. Done.');
  assert.deepEqual(turn.items.map((item) => item.type), ['text', 'tool', 'text']);
  assert.equal(turn.tools[0]?.status, 'done');
  assert.equal(turn.tools[0]?.resultText, 'ok');
});

test('generic Agent events hide trailing OpenCode DCP message ids', () => {
  let turn = createTurn();
  turn = apply(turn, {
    type: 'delta',
    runId: 'run-1',
    text: '我是 MiniMax-M3。\n\n<dcp-message-id>m0004</dcp-message-id>',
  });

  assert.equal(turn.assistantText, '我是 MiniMax-M3。\n');
  assert.deepEqual(turn.items.map((item) => item.type), ['text']);
  assert.equal(
    turn.items[0]?.type === 'text' ? turn.items[0].text : '',
    '我是 MiniMax-M3。\n',
  );
});

test('generic Agent reducer preserves public thinking before approvals and user input', () => {
  let turn = createTurn();
  turn = apply(turn, {
    type: 'phase',
    runId: 'run-1',
    phase: 'thinking',
    label: '思考中',
  });
  assert.equal(turn.phase, 'thinking');
  assert.equal(turn.activity, '思考中');
  turn = apply(turn, { type: 'thinking-delta', runId: 'run-1', text: 'private reasoning' });
  assert.equal(turn.assistantText, '');
  assert.deepEqual(turn.items.map((item) => item.type), ['thinking']);
  assert.equal(turn.items[0]?.type === 'thinking' ? turn.items[0].text : '', 'private reasoning');
  turn = apply(turn, {
    type: 'approval-request',
    runId: 'run-1',
    request: {
      requestId: 'approval-1',
      kind: 'permission',
      title: 'Run command',
      danger: 'medium',
      options: [{ id: 'allow', label: 'Allow', kind: 'allow_once' }],
    },
  });
  turn = apply(turn, {
    type: 'request-user-input',
    runId: 'run-1',
    request: {
      requestId: 'question-1',
      questions: [{ id: 'name', question: 'Name?', required: true, secret: false }],
    },
  });

  assert.equal(turn.assistantText, '');
  assert.equal(turn.items.length, 1);
  assert.equal(turn.pendingApprovalRequests?.[0]?.requestId, 'approval-1');
  assert.equal(turn.pendingUserInputRequests?.[0]?.requestId, 'question-1');
  assert.equal(turn.activity, '等待补充信息');
});

test('cancelled generic Agent runs settle as stopped', () => {
  const turn = apply(createTurn(), {
    type: 'done',
    runId: 'run-1',
    sessionId: 'session-1',
    result: '',
    stopReason: 'cancelled',
  });

  assert.equal(turn.status, 'stopped');
  assert.equal(turn.activity, '已停止');
});

test('generic Agent done events persist usage cost and token snapshots', () => {
  const turn = apply(createTurn(), {
    type: 'done',
    runId: 'run-1',
    sessionId: 'session-1',
    result: 'OK',
    stopReason: 'end_turn',
    inputTokens: 100,
    outputTokens: 7,
    cacheReadInputTokens: 20,
    totalCostUsd: 0.25,
    usageSource: 'result',
  });

  assert.equal(turn.inputTokens, 100);
  assert.equal(turn.outputTokens, 7);
  assert.equal(turn.cacheReadInputTokens, 20);
  assert.equal(turn.totalCostUsd, 0.25);
});

test('terminal generic Agent events clear stale approval and input cards', () => {
  const waiting = {
    ...createTurn(),
    pendingApprovalRequests: [{ requestId: 'approval-1', title: 'Confirm' }],
    pendingUserInputRequests: [{ requestId: 'input-1', questions: [{ question: 'Continue?' }] }],
  } satisfies ConversationTurn;
  const done = applyAgentRunEventToTurn(waiting, {
    type: 'done',
    runId: 'run-1',
    sessionId: 'thread-1',
    result: '',
  });
  const failed = applyAgentRunEventToTurn(waiting, {
    type: 'error',
    runId: 'run-1',
    message: 'failed',
  });

  assert.deepEqual(done.pendingApprovalRequests, []);
  assert.deepEqual(done.pendingUserInputRequests, []);
  assert.deepEqual(failed.pendingApprovalRequests, []);
  assert.deepEqual(failed.pendingUserInputRequests, []);
});

test('generic Agent errors preserve the provider detail for the conversation view', () => {
  const failed = apply(createTurn(), {
    type: 'error',
    runId: 'run-1',
    message: 'ACP Provider 请求失败（RPC 429）：All credentials for model grok-4.5 are cooling down',
  });

  assert.equal(failed.status, 'error');
  assert.equal(
    failed.activity,
    'ACP Provider 请求失败（RPC 429）：All credentials for model grok-4.5 are cooling down',
  );
});

test('cancelled generic Agent streams remain stopped when EOF has no terminal event', () => {
  assert.equal(shouldSettleAgentStreamAsStopped(true, false), true);
  assert.equal(shouldSettleAgentStreamAsStopped(false, true), true);
  assert.equal(shouldSettleAgentStreamAsStopped(false, false), false);
});
