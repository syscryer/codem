import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearThreadActivityNotice,
  shouldRequestTaskbarAttention,
  shouldSendThreadSystemNotification,
  upsertThreadActivityNotice,
  type ThreadActivityNoticeMap,
} from './thread-activity-notices.js';

test('upsertThreadActivityNotice ignores the active thread but marks background threads', () => {
  const notices = upsertThreadActivityNotice(
    {},
    {
      threadId: 'thread-2',
      kind: 'completed',
      title: '后台任务',
      key: 'completed:thread-2:turn-1',
      updatedAtMs: 100,
    },
    'thread-1',
  );

  assert.equal(notices['thread-2']?.kind, 'completed');

  const unchanged = upsertThreadActivityNotice(
    notices,
    {
      threadId: 'thread-1',
      kind: 'failed',
      title: '当前任务',
      key: 'failed:thread-1:turn-1',
      updatedAtMs: 200,
    },
    'thread-1',
  );

  assert.deepEqual(unchanged, notices);
});

test('upsertThreadActivityNotice keeps the highest priority notice for a thread', () => {
  const completed = upsertThreadActivityNotice(
    {},
    {
      threadId: 'thread-1',
      kind: 'completed',
      title: '任务',
      key: 'completed:thread-1:turn-1',
      updatedAtMs: 100,
    },
    'thread-2',
  );
  const approval = upsertThreadActivityNotice(
    completed,
    {
      threadId: 'thread-1',
      kind: 'approval',
      title: '任务',
      key: 'approval:thread-1:turn-1',
      updatedAtMs: 200,
    },
    'thread-2',
  );
  const failed = upsertThreadActivityNotice(
    approval,
    {
      threadId: 'thread-1',
      kind: 'failed',
      title: '任务',
      key: 'failed:thread-1:turn-1',
      updatedAtMs: 300,
    },
    'thread-2',
  );

  assert.equal(approval['thread-1']?.kind, 'approval');
  assert.equal(failed['thread-1']?.kind, 'approval');
});

test('clearThreadActivityNotice removes only the selected thread notice', () => {
  const notices: ThreadActivityNoticeMap = {
    'thread-1': {
      threadId: 'thread-1',
      kind: 'failed',
      title: '失败任务',
      key: 'failed:thread-1:turn-1',
      updatedAtMs: 100,
    },
    'thread-2': {
      threadId: 'thread-2',
      kind: 'completed',
      title: '完成任务',
      key: 'completed:thread-2:turn-1',
      updatedAtMs: 100,
    },
  };

  assert.deepEqual(clearThreadActivityNotice(notices, 'thread-1'), {
    'thread-2': notices['thread-2'],
  });
});

test('system notifications respect focus state and the user setting', () => {
  assert.equal(shouldSendThreadSystemNotification('completed', false, true), true);
  assert.equal(shouldSendThreadSystemNotification('failed', false, true), true);
  assert.equal(shouldSendThreadSystemNotification('approval', false, true), true);
  assert.equal(shouldSendThreadSystemNotification('failed', true, true), false);
  assert.equal(shouldSendThreadSystemNotification('failed', false, false), false);
  assert.equal(shouldSendThreadSystemNotification('approval', false, false), false);
});

test('taskbar attention is only requested for approvals while unfocused', () => {
  assert.equal(shouldRequestTaskbarAttention('approval', false), true);
  assert.equal(shouldRequestTaskbarAttention('completed', false), false);
  assert.equal(shouldRequestTaskbarAttention('failed', false), false);
  assert.equal(shouldRequestTaskbarAttention('approval', true), false);
});
