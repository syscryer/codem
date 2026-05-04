import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('openProjectInExplorer surfaces launcher failures', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-open-'));
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
          const childProcess = await import('node:child_process');
          const { mock } = await import('node:test');
          mock.method(childProcess, 'spawnSync', () => ({
            status: 1,
            stdout: '',
            stderr: 'explorer unavailable',
          }));

          const { createProject, openProjectInExplorer } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});

          try {
            openProjectInExplorer(projectId);
            console.log('NO_ERROR');
          } catch (error) {
            console.log(error instanceof Error ? error.message : String(error));
          }
        `,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          LOCALAPPDATA: appData,
          APPDATA: '',
        },
      },
    );

    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.match(child.stdout.trim(), /资源管理器启动失败：explorer unavailable/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
