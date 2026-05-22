import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('undoProjectAiTurnChanges restores snippet edits and deletes created files', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-undo-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const createdFile = path.join(repo, 'src', 'created.ts');
  const editedFile = path.join(repo, 'src', 'edited.ts');

  try {
    mkdirSync(path.dirname(editedFile), { recursive: true });
    writeFileSync(editedFile, 'const title = "latest";\n', 'utf8');
    writeFileSync(createdFile, 'export const created = true;\n', 'utf8');

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { mkdirSync, readFileSync, existsSync } = await import('node:fs');
          const path = await import('node:path');
          const {
            createProject,
            undoProjectAiTurnChanges,
          } = await import('./server/lib/workspace-store.ts');

          mkdirSync(path.join(${JSON.stringify(repo)}, 'src'), { recursive: true });
          const projectId = createProject(${JSON.stringify(repo)});
          const result = await undoProjectAiTurnChanges(projectId, [
            {
              path: 'src/edited.ts',
              operations: [
                {
                  kind: 'replace-snippet',
                  beforeText: 'const title = "before";',
                  afterText: 'const title = "latest";',
                },
              ],
            },
            {
              path: 'src/created.ts',
              operations: [
                {
                  kind: 'delete-file',
                  beforeText: '',
                  afterText: 'export const created = true;\\n',
                },
              ],
            },
          ]);

          console.log(JSON.stringify({
            result,
            edited: readFileSync(path.join(${JSON.stringify(repo)}, 'src', 'edited.ts'), 'utf8'),
            createdExists: existsSync(path.join(${JSON.stringify(repo)}, 'src', 'created.ts')),
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
    const payload = JSON.parse(child.stdout.trim()) as {
      result: { restored: string[]; deleted: string[] };
      edited: string;
      createdExists: boolean;
    };
    assert.equal(payload.edited, 'const title = "before";\n');
    assert.equal(payload.createdExists, false);
    assert.deepEqual(payload.result.restored, ['src/edited.ts']);
    assert.deepEqual(payload.result.deleted, ['src/created.ts']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('undoProjectAiTurnChanges fails when file content no longer matches the last AI change', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-undo-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const editedFile = path.join(repo, 'src', 'edited.ts');

  try {
    mkdirSync(path.dirname(editedFile), { recursive: true });
    writeFileSync(editedFile, 'const title = "manually changed";\n', 'utf8');

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { mkdirSync } = await import('node:fs');
          const path = await import('node:path');
          const {
            createProject,
            undoProjectAiTurnChanges,
          } = await import('./server/lib/workspace-store.ts');

          mkdirSync(path.join(${JSON.stringify(repo)}, 'src'), { recursive: true });
          const projectId = createProject(${JSON.stringify(repo)});
          try {
            await undoProjectAiTurnChanges(projectId, [
              {
                path: 'src/edited.ts',
                operations: [
                  {
                    kind: 'replace-snippet',
                    beforeText: 'const title = "before";',
                    afterText: 'const title = "latest";',
                  },
                ],
              },
            ]);
            console.log('unexpected-success');
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
          USERPROFILE: root,
        },
      },
    );

    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.match(child.stdout.trim(), /已经不是上次 AI 修改后的内容|无法安全撤销/);
    assert.equal(readFileSync(editedFile, 'utf8'), 'const title = "manually changed";\n');
    assert.equal(existsSync(editedFile), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
