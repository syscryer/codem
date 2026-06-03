import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSidebarThreadStatus } from './sidebar-thread-status.js';

test('resolveSidebarThreadStatus prioritizes running over hot and completed notices', () => {
  assert.equal(
    resolveSidebarThreadStatus({
      threadId: 'thread-1',
      runningThreadIds: new Set(['thread-1']),
      runtimeStatuses: {
        'thread-1': { threadId: 'thread-1', alive: true, activeRun: false },
      },
      threadActivityNotices: {
        'thread-1': {
          threadId: 'thread-1',
          kind: 'failed',
          title: '失败也按完成提示展示',
          key: 'failed:thread-1:turn-1',
          updatedAtMs: 100,
        },
      },
    }),
    'running',
  );
});

test('resolveSidebarThreadStatus marks alive inactive runtimes as hot sessions', () => {
  assert.equal(
    resolveSidebarThreadStatus({
      threadId: 'thread-1',
      runningThreadIds: new Set(),
      runtimeStatuses: {
        'thread-1': { threadId: 'thread-1', pid: 1234, alive: true, activeRun: false },
      },
      threadActivityNotices: {},
    }),
    'hot',
  );
});

test('resolveSidebarThreadStatus treats any background notice as completed indicator', () => {
  assert.equal(
    resolveSidebarThreadStatus({
      threadId: 'thread-1',
      runningThreadIds: new Set(),
      runtimeStatuses: {},
      threadActivityNotices: {
        'thread-1': {
          threadId: 'thread-1',
          kind: 'approval',
          title: '需要处理',
          key: 'approval:thread-1:turn-1',
          updatedAtMs: 100,
        },
      },
    }),
    'completed',
  );
});
