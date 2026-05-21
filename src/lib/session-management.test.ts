import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSessionProjectSummaries,
  buildSessionManagementRows,
  filterSessionManagementRows,
  getSelectableSessionIds,
  shortSessionId,
} from './session-management.js';
import type { ProjectSummary, ThreadSummary } from '../types.js';

test('buildSessionManagementRows flattens projects and marks active, running, and session state', () => {
  const rows = buildSessionManagementRows([
    project('project-a', 'CodeM', 'D:/project/codem', [
      thread('thread-a', 'project-a', '昨天的会话', 'session-old', '2026-05-20T10:00:00.000Z', false),
      thread('thread-b', 'project-a', '当前运行', 'session-running', '2026-05-21T10:00:00.000Z', true),
    ]),
    project('project-b', 'Empty', 'D:/project/empty', [
      thread('thread-c', 'project-b', '未绑定', '', '2026-05-19T10:00:00.000Z', false),
    ]),
  ], {
    activeProjectId: 'project-a',
    activeThreadId: 'thread-a',
    runningThreadIds: ['thread-b'],
  });

  assert.deepEqual(
    rows.map((row) => ({
      id: row.thread.id,
      projectName: row.project.name,
      active: row.active,
      running: row.running,
      hasSession: row.hasSession,
    })),
    [
      { id: 'thread-b', projectName: 'CodeM', active: false, running: true, hasSession: true },
      { id: 'thread-a', projectName: 'CodeM', active: true, running: false, hasSession: true },
      { id: 'thread-c', projectName: 'Empty', active: false, running: false, hasSession: false },
    ],
  );
});

test('buildSessionManagementRows marks managed runtime state from backend status', () => {
  const rows = buildSessionManagementRows([
    project('project-a', 'CodeM', 'D:/project/codem', [
      thread('thread-a', 'project-a', '有后台连接', 'session-hot', '2026-05-21T10:00:00.000Z', false),
      thread('thread-b', 'project-a', '普通历史', 'session-cold', '2026-05-20T10:00:00.000Z', false),
    ]),
  ], {
    activeProjectId: 'project-a',
    activeThreadId: 'thread-a',
    runningThreadIds: [],
    runtimeStatuses: {
      'thread-a': { threadId: 'thread-a', pid: 1234, alive: true, activeRun: false },
      'thread-b': { threadId: 'thread-b', alive: false, activeRun: false },
    },
  });

  assert.deepEqual(
    rows.map((row) => ({
      id: row.thread.id,
      runtimeAlive: row.runtimeAlive,
      runtimePid: row.runtimePid,
      runtimeActiveRun: row.runtimeActiveRun,
    })),
    [
      { id: 'thread-a', runtimeAlive: true, runtimePid: 1234, runtimeActiveRun: false },
      { id: 'thread-b', runtimeAlive: false, runtimePid: undefined, runtimeActiveRun: false },
    ],
  );
});

test('filterSessionManagementRows searches across title, project, path, and session id', () => {
  const rows = buildSessionManagementRows([
    project('project-a', 'CodeM', 'D:/project/codem', [
      thread('thread-a', 'project-a', '修复设置', 'session-abc', '2026-05-21T10:00:00.000Z', false),
    ]),
    project('project-b', 'Tools', 'D:/tools', [
      thread('thread-b', 'project-b', '插件整理', 'session-def', '2026-05-20T10:00:00.000Z', true),
    ]),
  ], {
    activeProjectId: 'project-a',
    activeThreadId: 'thread-a',
    runningThreadIds: [],
  });

  assert.deepEqual(
    filterSessionManagementRows(rows, { query: 'codem 设置', projectId: 'all' })
      .map((row) => row.thread.id),
    ['thread-a'],
  );
  assert.deepEqual(
    filterSessionManagementRows(rows, { query: 'def', projectId: 'all' })
      .map((row) => row.thread.id),
    ['thread-b'],
  );
  assert.deepEqual(
    filterSessionManagementRows(rows, { query: '', projectId: 'project-a' })
      .map((row) => row.thread.id),
    ['thread-a'],
  );
});

test('buildSessionProjectSummaries creates the left project navigation', () => {
  const rows = buildSessionManagementRows([
    project('project-a', 'CodeM', 'D:/project/codem', [
      thread('thread-a', 'project-a', '本地', 'session-local', '2026-05-21T10:00:00.000Z', false),
      thread('thread-b', 'project-a', '运行中', 'session-running', '2026-05-20T10:00:00.000Z', true),
    ]),
    project('project-b', 'Other', 'D:/other', [
      thread('thread-c', 'project-b', '空会话', '', '2026-05-19T10:00:00.000Z', false),
    ]),
  ], {
    activeProjectId: 'project-a',
    activeThreadId: 'thread-a',
    runningThreadIds: ['thread-b'],
  });

  assert.deepEqual(buildSessionProjectSummaries(rows), [
    { id: 'all', name: '全部项目', path: '', total: 3, running: 1, missingSession: 1 },
    { id: 'project-a', name: 'CodeM', path: 'D:/project/codem', total: 2, running: 1, missingSession: 0 },
    { id: 'project-b', name: 'Other', path: 'D:/other', total: 1, running: 0, missingSession: 1 },
  ]);
});

test('getSelectableSessionIds excludes running sessions from bulk delete', () => {
  const rows = buildSessionManagementRows([
    project('project-a', 'CodeM', 'D:/project/codem', [
      thread('thread-a', 'project-a', '可删除', 'session-local', '2026-05-21T10:00:00.000Z', false),
      thread('thread-b', 'project-a', '运行中', 'session-running', '2026-05-20T10:00:00.000Z', false),
    ]),
  ], {
    activeProjectId: 'project-a',
    activeThreadId: 'thread-a',
    runningThreadIds: ['thread-b'],
  });

  assert.deepEqual(getSelectableSessionIds(rows), ['thread-a']);
});

test('shortSessionId keeps empty values readable and compacts long ids', () => {
  assert.equal(shortSessionId(''), '未绑定');
  assert.equal(shortSessionId('abc123'), 'abc123');
  assert.equal(shortSessionId('1234567890abcdef'), '12345678...cdef');
});

function project(id: string, name: string, path: string, threads: ThreadSummary[]): ProjectSummary {
  return {
    id,
    name,
    path,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
    gitDiff: {
      additions: 0,
      deletions: 0,
      filesChanged: 0,
    },
    isGitRepo: true,
    isGitWorktree: false,
    threads,
  };
}

function thread(
  id: string,
  projectId: string,
  title: string,
  sessionId: string,
  updatedAt: string,
  imported: boolean,
): ThreadSummary {
  return {
    id,
    projectId,
    title,
    sessionId,
    workingDirectory: `D:/workspace/${projectId}`,
    updatedAt,
    updatedLabel: updatedAt,
    provider: 'claude',
    imported,
    model: 'sonnet',
    permissionMode: 'default',
  };
}
