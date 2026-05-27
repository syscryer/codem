import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('getThreadSummary returns a lightweight summary for a newly created thread', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-create-thread-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');

  try {
    mkdirSync(repo, { recursive: true });
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { createProject, createThread, getThreadSummary } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});
          const threadId = createThread(projectId, 'first prompt title');
          const thread = getThreadSummary(threadId);
          console.log(JSON.stringify({
            projectId,
            threadId,
            thread,
          }));
        `,
      ],
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

    assert.equal(child.status, 0, child.stderr || child.stdout);
    const payload = JSON.parse(child.stdout.trim());
    assert.equal(payload.thread.id, payload.threadId);
    assert.equal(payload.thread.projectId, payload.projectId);
    assert.equal(payload.thread.title, 'first prompt title');
    assert.equal(payload.thread.sessionId, '');
    assert.equal(payload.thread.workingDirectory, repo);
    assert.equal(payload.thread.provider, 'claude-code');
    assert.equal(payload.thread.imported, false);
    assert.equal(payload.thread.updatedLabel, '现在');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
