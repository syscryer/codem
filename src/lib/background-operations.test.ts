import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearCompletedOperations,
  completeBackgroundOperation,
  createBackgroundOperation,
  failBackgroundOperation,
  isBackgroundOperationRunning,
  markBackgroundOperationFailuresRead,
  pruneBackgroundOperations,
} from './background-operations.js';
import type { BackgroundOperation } from '../types.js';

test('background operations prevent duplicate running keys', () => {
  const operation = createBackgroundOperation({
    key: 'git-fetch:p1',
    kind: 'git-fetch',
    title: '获取远端',
    target: 'CodeM',
    nowMs: 1000,
  });

  assert.equal(isBackgroundOperationRunning([operation], 'git-fetch:p1'), true);
  assert.equal(isBackgroundOperationRunning([operation], 'git-pull:p1'), false);
});

test('successful operation does not create unread failure marker', () => {
  const operation = createBackgroundOperation({
    key: 'git-pull:p1',
    kind: 'git-pull',
    title: '拉取',
    target: 'CodeM',
    nowMs: 1000,
  });
  const completed = completeBackgroundOperation([operation], operation.id, '已经是最新版本', 3000);

  assert.equal(completed[0]?.status, 'success');
  assert.equal(completed[0]?.summary, '已经是最新版本');
  assert.equal(completed[0]?.unread, false);
});

test('failed operation keeps unread marker until task center opens', () => {
  const operation = createBackgroundOperation({
    key: 'git-push:p1',
    kind: 'git-push',
    title: '推送',
    target: 'CodeM',
    nowMs: 1000,
  });
  const failed = failBackgroundOperation([operation], operation.id, new Error('remote rejected'), 3000);
  assert.equal(failed[0]?.status, 'error');
  assert.equal(failed[0]?.unread, true);
  assert.equal(failed[0]?.errorMessage, 'remote rejected');

  const read = markBackgroundOperationFailuresRead(failed);
  assert.equal(read[0]?.unread, false);
});

test('prune keeps all running operations and limits completed history', () => {
  const running = createBackgroundOperation({
    key: 'git-fetch:running',
    kind: 'git-fetch',
    title: '获取远端',
    target: 'Running',
    nowMs: 1,
  });
  const completed: BackgroundOperation[] = Array.from({ length: 45 }, (_, index) => ({
    id: `done-${index}`,
    key: `git-pull:${index}`,
    kind: 'git-pull',
    title: '拉取',
    target: `Project ${index}`,
    phase: '已完成',
    status: 'success',
    startedAtMs: 100 + index,
    finishedAtMs: 200 + index,
  }));

  const pruned = pruneBackgroundOperations([running, ...completed]);
  assert.equal(pruned.some((operation) => operation.id === running.id), true);
  assert.equal(pruned.filter((operation) => operation.status !== 'running').length, 40);
});

test('clear completed operations never removes running operations', () => {
  const running = createBackgroundOperation({
    key: 'git-fetch:p1',
    kind: 'git-fetch',
    title: '获取远端',
    target: 'CodeM',
    nowMs: 1000,
  });
  const completed = completeBackgroundOperation([
    createBackgroundOperation({
      key: 'git-pull:p1',
      kind: 'git-pull',
      title: '拉取',
      target: 'CodeM',
      nowMs: 900,
    }),
  ], 'git-pull:p1:900', '完成', 1200);

  assert.deepEqual(clearCompletedOperations([running, ...completed]).map((operation) => operation.id), [running.id]);
});
