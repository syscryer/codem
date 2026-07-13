import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAgentRunEventToTurn } from './agent-run-events.js';
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

test('generic Agent reducer exposes approvals and user input but hides thinking deltas', () => {
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
  assert.equal(turn.items.length, 0);
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
