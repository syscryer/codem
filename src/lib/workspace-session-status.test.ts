import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkspaceSessionButtonState,
  getWorkspaceSessionRunTurns,
  summarizeWorkspaceSessionUsage,
} from './workspace-session-status.js';
import type { ConversationTurn } from '../types.js';

test('buildWorkspaceSessionButtonState resolves the four footer states', () => {
  assert.deepEqual(buildWorkspaceSessionButtonState({ sessionId: '', runtimeAlive: false, activeRun: false }), {
    id: 'new',
    label: '新会话',
  });
  assert.deepEqual(buildWorkspaceSessionButtonState({ sessionId: 'session-1', runtimeAlive: false, activeRun: false }), {
    id: 'idle',
    label: '空闲',
  });
  assert.deepEqual(buildWorkspaceSessionButtonState({ sessionId: 'session-1', runtimeAlive: true, activeRun: false }), {
    id: 'hot',
    label: '热连接',
  });
  assert.deepEqual(buildWorkspaceSessionButtonState({ sessionId: 'session-1', runtimeAlive: true, activeRun: true }), {
    id: 'running',
    label: '运行中',
  });
});

test('getWorkspaceSessionRunTurns skips local system command cards', () => {
  const assistantTurn = turn({
    id: 'assistant-turn',
    userText: '继续看看这里',
    inputTokens: 12400,
    outputTokens: 2100,
    durationMs: 102000,
    totalCostUsd: 0.08,
  });
  const localStatusTurn = turn({
    id: 'local-status',
    userText: '/status',
    assistantText: '',
    items: [
      {
        id: 'system-1',
        type: 'system-command',
        command: '/status',
        title: 'Status',
        cardType: 'status',
        state: 'done',
      },
    ],
  });

  assert.deepEqual(getWorkspaceSessionRunTurns([assistantTurn, localStatusTurn]).map((item) => item.id), [
    'assistant-turn',
  ]);
});

test('summarizeWorkspaceSessionUsage formats current session totals for the panel', () => {
  assert.deepEqual(
    summarizeWorkspaceSessionUsage([
      turn({
        id: 'turn-1',
        durationMs: 102000,
        inputTokens: 12400,
        outputTokens: 2100,
        totalCostUsd: 0.08,
      }),
      turn({
        id: 'turn-2',
        durationMs: 892000,
        inputTokens: 30200,
        outputTokens: 5700,
        totalCostUsd: 0.04,
      }),
      turn({
        id: 'local-status',
        userText: '/status',
        assistantText: '',
        items: [
          {
            id: 'system-1',
            type: 'system-command',
            command: '/status',
            title: 'Status',
            cardType: 'status',
            state: 'done',
          },
        ],
        durationMs: 5000,
        inputTokens: 9999,
        outputTokens: 9999,
        totalCostUsd: 9,
      }),
    ]),
    {
      turnCountLabel: '2',
      durationLabel: '16m 34s',
      tokenLabel: '42.6k / 7.8k',
      costLabel: '$0.12',
    },
  );
});

function turn(overrides: Partial<ConversationTurn>): ConversationTurn {
  return {
    id: 'turn-1',
    userText: 'hello',
    workspace: 'D:/project/codem',
    assistantText: 'done',
    tools: [],
    items: [{ id: 'text-1', type: 'text', text: 'done' }],
    status: 'done',
    pendingUserInputRequests: [],
    pendingApprovalRequests: [],
    ...overrides,
  };
}
