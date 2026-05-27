import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function setupWorkspace(root: string, sessionEntries: Array<{ sessionName: string; sessionId: string; cwd: string }>) {
  for (const entry of sessionEntries) {
    const transcriptDir = path.join(root, '.claude', 'projects', `proj-${entry.sessionId}`);
    mkdirSync(transcriptDir, { recursive: true });
    mkdirSync(entry.cwd, { recursive: true });
    writeFileSync(
      path.join(transcriptDir, `${entry.sessionId}.jsonl`),
      JSON.stringify({
        sessionId: entry.sessionId,
        cwd: entry.cwd,
        timestamp: '2026-05-26T10:00:00.000Z',
        sessionName: entry.sessionName,
        message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      }) + '\n',
      'utf8',
    );
  }
}

function runWorkspaceScript(root: string, appData: string, script: string) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        LOCALAPPDATA: appData,
        APPDATA: '',
        USERPROFILE: root,
      },
    },
  );
}

test('setThreadPinned marks a thread pinned and the bootstrap exposes pinnedAt', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-pinned-thread-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo-a');

  try {
    setupWorkspace(root, [{ sessionName: '会话 A', sessionId: 'sess-a', cwd: repo }]);

    const child = runWorkspaceScript(root, appData, `
      const { getWorkspaceBootstrap, setThreadPinned } = await import('./server/lib/workspace-store.ts');
      const initial = getWorkspaceBootstrap();
      const thread = initial.projects[0].threads[0];
      if (!thread) throw new Error('expected thread');

      setThreadPinned(thread.id, true);
      const afterPin = getWorkspaceBootstrap();

      setThreadPinned(thread.id, false);
      const afterUnpin = getWorkspaceBootstrap();

      console.log(JSON.stringify({
        initialPinned: Boolean(initial.projects[0].threads[0].pinnedAt),
        afterPinHasValue: Boolean(afterPin.projects[0].threads[0].pinnedAt),
        afterUnpinPinned: Boolean(afterUnpin.projects[0].threads[0].pinnedAt),
      }));
    `);

    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.deepEqual(JSON.parse(child.stdout.trim()), {
      initialPinned: false,
      afterPinHasValue: true,
      afterUnpinPinned: false,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('setProjectPinned marks a project pinned and the bootstrap exposes pinnedAt', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-pinned-project-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo-b');

  try {
    setupWorkspace(root, [{ sessionName: '项目 B', sessionId: 'sess-b', cwd: repo }]);

    const child = runWorkspaceScript(root, appData, `
      const { getWorkspaceBootstrap, setProjectPinned } = await import('./server/lib/workspace-store.ts');
      const initial = getWorkspaceBootstrap();
      const project = initial.projects[0];
      if (!project) throw new Error('expected project');

      setProjectPinned(project.id, true);
      const afterPin = getWorkspaceBootstrap();

      setProjectPinned(project.id, false);
      const afterUnpin = getWorkspaceBootstrap();

      console.log(JSON.stringify({
        initialPinned: Boolean(initial.projects[0].pinnedAt),
        afterPinHasValue: Boolean(afterPin.projects[0].pinnedAt),
        afterUnpinPinned: Boolean(afterUnpin.projects[0].pinnedAt),
      }));
    `);

    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.deepEqual(JSON.parse(child.stdout.trim()), {
      initialPinned: false,
      afterPinHasValue: true,
      afterUnpinPinned: false,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('setThreadPinned throws when the thread id does not exist', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-pinned-missing-'));
  const appData = path.join(root, 'appdata');

  try {
    const child = runWorkspaceScript(root, appData, `
      const { setThreadPinned } = await import('./server/lib/workspace-store.ts');
      try {
        setThreadPinned('non-existent-id', true);
        console.log(JSON.stringify({ threw: false }));
      } catch (error) {
        console.log(JSON.stringify({ threw: true, message: error.message }));
      }
    `);

    assert.equal(child.status, 0, child.stderr || child.stdout);
    const result = JSON.parse(child.stdout.trim()) as { threw: boolean; message?: string };
    assert.equal(result.threw, true);
    assert.match(result.message ?? '', /聊天不存在/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
