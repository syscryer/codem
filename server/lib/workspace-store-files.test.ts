import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('deleteProjectFile removes files and directories only inside the project root', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-files-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const nested = path.join(repo, 'nested');
  const outside = path.join(root, 'outside.txt');

  try {
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(repo, 'notes.txt'), 'hello', 'utf8');
    writeFileSync(path.join(nested, 'child.txt'), 'child', 'utf8');
    writeFileSync(outside, 'outside', 'utf8');

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          import { existsSync } from 'node:fs';
          import path from 'node:path';
          const { createProject, deleteProjectFile, listProjectFiles } = await import('./server/lib/workspace-store.ts');

          const projectId = createProject(${JSON.stringify(repo)});
          deleteProjectFile(projectId, 'notes.txt');
          deleteProjectFile(projectId, 'nested');

          let rootError = '';
          try {
            deleteProjectFile(projectId, '');
          } catch (error) {
            rootError = error instanceof Error ? error.message : String(error);
          }

          let traversalError = '';
          try {
            deleteProjectFile(projectId, '../outside.txt');
          } catch (error) {
            traversalError = error instanceof Error ? error.message : String(error);
          }

          console.log(JSON.stringify({
            fileExists: existsSync(path.join(${JSON.stringify(repo)}, 'notes.txt')),
            directoryExists: existsSync(path.join(${JSON.stringify(repo)}, 'nested')),
            outsideExists: existsSync(${JSON.stringify(outside)}),
            rootError,
            traversalError,
            entries: listProjectFiles(projectId).map((entry) => entry.path),
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
    assert.deepEqual(JSON.parse(child.stdout.trim()), {
      fileExists: false,
      directoryExists: false,
      outsideExists: true,
      rootError: '文件路径必须是项目内的相对路径',
      traversalError: '文件不在项目目录内：../outside.txt',
      entries: [],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
