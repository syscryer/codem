import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationTurn, ThreadDetail } from '../types.js';
import {
  formatConversationPlanSummary,
  getLatestConversationPlanPreview,
} from './conversation-plan.js';

function createTurn(
  id: string,
  status: ConversationTurn['status'],
  plan?: ConversationTurn['plan'],
): ConversationTurn {
  return {
    id,
    userText: id,
    workspace: 'D:/workspace',
    assistantText: '',
    tools: [],
    items: [],
    status,
    plan,
  };
}

function createThread(turns: ConversationTurn[]): ThreadDetail {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Plan',
    sessionId: 'session-1',
    workingDirectory: 'D:/workspace',
    updatedAt: '2026-08-08T00:00:00.000Z',
    updatedLabel: '刚刚',
    provider: 'claude-code',
    turns,
    debugEvents: [],
    rawEvents: [],
    historyLoaded: true,
    historyLoading: false,
  };
}

test('context plan uses the latest active unified snapshot', () => {
  const preview = getLatestConversationPlanPreview(createThread([
    createTurn('done', 'done', { steps: [{ content: '旧计划', status: 'pending' }] }),
    createTurn('running', 'running', {
      steps: [
        { content: '分析', status: 'completed' },
        { content: '实现', status: 'in_progress' },
      ],
    }),
  ]));

  assert.deepEqual(preview?.counts, {
    pending: 0,
    in_progress: 1,
    completed: 1,
    unknown: 0,
  });
  assert.equal(formatConversationPlanSummary(preview!), '共 2 个任务，已经完成 1 个');
});

test('completed latest plan hides without falling back to an older open plan', () => {
  const preview = getLatestConversationPlanPreview(createThread([
    createTurn('old-running', 'running', { steps: [{ content: '旧计划', status: 'pending' }] }),
    createTurn('latest-running', 'running', { steps: [{ content: '新计划', status: 'completed' }] }),
  ]));

  assert.equal(preview, null);
});

test('history-only completed turns never expose a pinned plan', () => {
  assert.equal(
    getLatestConversationPlanPreview(createThread([
      createTurn('done', 'done', { steps: [{ content: '已完成', status: 'in_progress' }] }),
    ])),
    null,
  );
});
