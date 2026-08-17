import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationTurn } from '../../types';
import type { MobileTask, MobileThreadPage } from '../types';
import { applyLiveEvent, parseMobileLiveEventId } from './useMobileThread';

const task: MobileTask = {
  threadId: 'thread',
  projectId: 'project',
  projectName: 'Project',
  title: 'Task',
  providerId: 'claude-code',
  providerLabel: 'Claude Code',
  phase: 'running',
  updatedAt: '2026-07-30T00:00:00.000Z',
  latestActivity: '正在运行',
  pendingActions: [],
  activeRunId: 'new-run',
};

function liveTurn(runId?: string): ConversationTurn {
  return {
    id: 'live-turn',
    backendRunId: runId,
    userText: '继续',
    workspace: '',
    assistantText: '',
    tools: [],
    items: [],
    status: 'running',
    activity: '正在运行',
    startedAtMs: 1,
    pendingApprovalRequests: [],
    pendingUserInputRequests: [],
  };
}

function page(turn: ConversationTurn): MobileThreadPage {
  return {
    task,
    turns: [turn],
    hasMore: false,
    liveRunId: 'new-run',
    liveEventCursor: 0,
  };
}

test('ignores a stale terminal event while a newer run is active', () => {
  const current = page(liveTurn('new-run'));
  const next = applyLiveEvent(current, {
    type: 'done',
    runId: 'old-run',
    result: '',
    stopReason: 'cancelled',
  });

  assert.equal(next, current);
  assert.equal(next.turns.length, 1);
  assert.equal(next.turns[0].status, 'running');
  assert.equal(next.turns[0].backendRunId, 'new-run');
});

test('binds an unassigned optimistic turn to the first live event', () => {
  const current = page(liveTurn());
  const next = applyLiveEvent(current, {
    type: 'status',
    runId: 'new-run',
    message: '已复用 Claude Code 会话',
  });

  assert.equal(next.turns.length, 1);
  assert.equal(next.turns[0].backendRunId, 'new-run');
  assert.equal(next.turns[0].status, 'running');
  assert.equal(next.turns[0].activity, '已复用 Claude Code 会话');
});

test('live event cursors retain the run identity across reconnects', () => {
  assert.deepEqual(parseMobileLiveEventId('run-2|17'), { runId: 'run-2', offset: 17 });
  assert.equal(parseMobileLiveEventId('17'), undefined);
  assert.equal(parseMobileLiveEventId('run-2|not-a-number'), undefined);
});
