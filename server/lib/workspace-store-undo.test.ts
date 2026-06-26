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

test('undoProjectAiTurnChanges restores files deleted by shell commands within mixed turn undo', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-undo-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const restoredFile = path.join(repo, 'snake-game', 'style.css');
  const createdFile = path.join(repo, 'README.md');
  const editedFile = path.join(repo, 'snake-game', 'index.html');

  try {
    mkdirSync(path.dirname(editedFile), { recursive: true });
    writeFileSync(createdFile, '# Snake Game\n', 'utf8');
    writeFileSync(editedFile, '<title>Snake Game Pro</title>\n', 'utf8');

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

          mkdirSync(path.join(${JSON.stringify(repo)}, 'snake-game'), { recursive: true });
          const projectId = createProject(${JSON.stringify(repo)});
          const result = await undoProjectAiTurnChanges(projectId, [
            {
              path: 'snake-game/style.css',
              operations: [
                {
                  kind: 'restore-file',
                  beforeText: 'body { color: green; }\\n',
                  afterText: '',
                },
              ],
            },
            {
              path: 'README.md',
              operations: [
                {
                  kind: 'delete-file',
                  beforeText: '',
                  afterText: '# Snake Game\\n',
                },
              ],
            },
            {
              path: 'snake-game/index.html',
              operations: [
                {
                  kind: 'replace-snippet',
                  beforeText: '<title>Snake Game</title>',
                  afterText: '<title>Snake Game Pro</title>',
                },
              ],
            },
          ]);

          console.log(JSON.stringify({
            result,
            restored: readFileSync(path.join(${JSON.stringify(repo)}, 'snake-game', 'style.css'), 'utf8'),
            createdExists: existsSync(path.join(${JSON.stringify(repo)}, 'README.md')),
            edited: readFileSync(path.join(${JSON.stringify(repo)}, 'snake-game', 'index.html'), 'utf8'),
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
      restored: string;
      createdExists: boolean;
      edited: string;
    };
    assert.equal(payload.restored, 'body { color: green; }\n');
    assert.equal(payload.createdExists, false);
    assert.equal(payload.edited, '<title>Snake Game</title>\n');
    assert.deepEqual(payload.result.restored, ['snake-game/style.css', 'snake-game/index.html']);
    assert.deepEqual(payload.result.deleted, ['README.md']);
    assert.equal(readFileSync(restoredFile, 'utf8'), 'body { color: green; }\n');
    assert.equal(existsSync(createdFile), false);
    assert.equal(readFileSync(editedFile, 'utf8'), '<title>Snake Game</title>\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('undoProjectAiTurnChanges deletes created files when only trailing line whitespace changed', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-undo-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const createdFile = path.join(repo, 'src', 'created.html');
  const aiContent = '<section>\n    <h1>Title</h1>\n    \n    <p>Body</p>\n</section>\n';
  const currentContent = '<section>\n    <h1>Title</h1>\n\n    <p>Body</p>\n</section>\n';

  try {
    mkdirSync(path.dirname(createdFile), { recursive: true });
    writeFileSync(createdFile, currentContent, 'utf8');

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { mkdirSync, existsSync } = await import('node:fs');
          const path = await import('node:path');
          const {
            createProject,
            undoProjectAiTurnChanges,
          } = await import('./server/lib/workspace-store.ts');

          mkdirSync(path.join(${JSON.stringify(repo)}, 'src'), { recursive: true });
          const projectId = createProject(${JSON.stringify(repo)});
          const result = await undoProjectAiTurnChanges(projectId, [
            {
              path: 'src/created.html',
              operations: [
                {
                  kind: 'delete-file',
                  beforeText: '',
                  afterText: ${JSON.stringify(aiContent)},
                },
              ],
            },
          ]);

          console.log(JSON.stringify({
            result,
            createdExists: existsSync(path.join(${JSON.stringify(repo)}, 'src', 'created.html')),
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
      createdExists: boolean;
    };
    assert.equal(payload.createdExists, false);
    assert.deepEqual(payload.result.restored, []);
    assert.deepEqual(payload.result.deleted, ['src/created.html']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('undoProjectAiTurnChanges keeps created files when non-whitespace content changed', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-undo-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const createdFile = path.join(repo, 'src', 'created.html');

  try {
    mkdirSync(path.dirname(createdFile), { recursive: true });
    writeFileSync(createdFile, '<section>\n    <h1>Changed</h1>\n</section>\n', 'utf8');

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
                path: 'src/created.html',
                operations: [
                  {
                    kind: 'delete-file',
                    beforeText: '',
                    afterText: '<section>\\n    <h1>Title</h1>\\n</section>\\n',
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
    assert.equal(readFileSync(createdFile, 'utf8'), '<section>\n    <h1>Changed</h1>\n</section>\n');
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

test('undoProjectAiTurnChanges reverses all repeated snippets for replaceAll edits', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-undo-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const editedFile = path.join(repo, 'src', 'game.js');

  try {
    mkdirSync(path.dirname(editedFile), { recursive: true });
    writeFileSync(
      editedFile,
      'this.snakeLength = 5;\nthis.score += 20;\nthis.snakeLength = 5;\n',
      'utf8',
    );

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { mkdirSync, readFileSync } = await import('node:fs');
          const path = await import('node:path');
          const {
            createProject,
            undoProjectAiTurnChanges,
          } = await import('./server/lib/workspace-store.ts');

          mkdirSync(path.join(${JSON.stringify(repo)}, 'src'), { recursive: true });
          const projectId = createProject(${JSON.stringify(repo)});
          const result = await undoProjectAiTurnChanges(projectId, [
            {
              path: 'src/game.js',
              operations: [
                {
                  kind: 'replace-snippet',
                  beforeText: 'this.snakeLength = 3;',
                  afterText: 'this.snakeLength = 5;',
                  replaceAll: true,
                },
                {
                  kind: 'replace-snippet',
                  beforeText: 'this.score += 10;',
                  afterText: 'this.score += 20;',
                },
              ],
            },
          ]);

          console.log(JSON.stringify({
            result,
            edited: readFileSync(path.join(${JSON.stringify(repo)}, 'src', 'game.js'), 'utf8'),
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
    };
    assert.equal(payload.edited, 'this.snakeLength = 3;\nthis.score += 10;\nthis.snakeLength = 3;\n');
    assert.deepEqual(payload.result.restored, ['src/game.js']);
    assert.deepEqual(payload.result.deleted, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('undoProjectAiTurnChanges still rejects repeated snippets without replaceAll', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-undo-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const editedFile = path.join(repo, 'src', 'game.js');

  try {
    mkdirSync(path.dirname(editedFile), { recursive: true });
    writeFileSync(editedFile, 'this.snakeLength = 5;\nthis.snakeLength = 5;\n', 'utf8');

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
                path: 'src/game.js',
                operations: [
                  {
                    kind: 'replace-snippet',
                    beforeText: 'this.snakeLength = 3;',
                    afterText: 'this.snakeLength = 5;',
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
    assert.match(child.stdout.trim(), /存在重复片段，无法安全撤销/);
    assert.equal(readFileSync(editedFile, 'utf8'), 'this.snakeLength = 5;\nthis.snakeLength = 5;\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('undoProjectAiTurnChanges leaves files untouched when any change cannot be safely undone', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-undo-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const firstFile = path.join(repo, 'src', 'first.ts');
  const secondFile = path.join(repo, 'src', 'second.ts');

  try {
    mkdirSync(path.dirname(firstFile), { recursive: true });
    writeFileSync(firstFile, 'export const first = "latest";\n', 'utf8');
    writeFileSync(secondFile, 'export const second = "manually changed";\n', 'utf8');

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { mkdirSync, readFileSync } = await import('node:fs');
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
                path: 'src/first.ts',
                operations: [
                  {
                    kind: 'replace-snippet',
                    beforeText: 'export const first = "before";',
                    afterText: 'export const first = "latest";',
                  },
                ],
              },
              {
                path: 'src/second.ts',
                operations: [
                  {
                    kind: 'replace-snippet',
                    beforeText: 'export const second = "before";',
                    afterText: 'export const second = "latest";',
                  },
                ],
              },
            ]);
            console.log('unexpected-success');
          } catch (error) {
            console.log(JSON.stringify({
              message: error instanceof Error ? error.message : String(error),
              first: readFileSync(path.join(${JSON.stringify(repo)}, 'src', 'first.ts'), 'utf8'),
              second: readFileSync(path.join(${JSON.stringify(repo)}, 'src', 'second.ts'), 'utf8'),
            }));
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
    const payload = JSON.parse(child.stdout.trim()) as {
      message: string;
      first: string;
      second: string;
    };
    assert.match(payload.message, /已经不是上次 AI 修改后的内容|无法安全撤销/);
    assert.equal(payload.first, 'export const first = "latest";\n');
    assert.equal(payload.second, 'export const second = "manually changed";\n');
    assert.equal(readFileSync(firstFile, 'utf8'), 'export const first = "latest";\n');
    assert.equal(readFileSync(secondFile, 'utf8'), 'export const second = "manually changed";\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('undoProjectAiTurnChanges rolls back earlier writes when applying a later change fails', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-undo-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const firstFile = path.join(repo, 'src', 'first.ts');
  const blockedParent = path.join(repo, 'src', 'blocked');

  try {
    mkdirSync(path.dirname(firstFile), { recursive: true });
    writeFileSync(firstFile, 'export const first = "latest";\n', 'utf8');
    writeFileSync(blockedParent, 'this file blocks creating a child file\n', 'utf8');

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { mkdirSync, readFileSync, statSync } = await import('node:fs');
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
                path: 'src/first.ts',
                operations: [
                  {
                    kind: 'replace-snippet',
                    beforeText: 'export const first = "before";',
                    afterText: 'export const first = "latest";',
                  },
                ],
              },
              {
                path: 'src/blocked/restored.ts',
                operations: [
                  {
                    kind: 'restore-file',
                    beforeText: 'export const restored = true;\\n',
                    afterText: '',
                  },
                ],
              },
            ]);
            console.log('unexpected-success');
          } catch (error) {
            console.log(JSON.stringify({
              message: error instanceof Error ? error.message : String(error),
              first: readFileSync(path.join(${JSON.stringify(repo)}, 'src', 'first.ts'), 'utf8'),
              blockedIsFile: statSync(path.join(${JSON.stringify(repo)}, 'src', 'blocked')).isFile(),
            }));
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
    const payload = JSON.parse(child.stdout.trim()) as {
      message: string;
      first: string;
      blockedIsFile: boolean;
    };
    assert.match(payload.message, /EEXIST|ENOTDIR|not a directory|file already exists/i);
    assert.equal(payload.first, 'export const first = "latest";\n');
    assert.equal(payload.blockedIsFile, true);
    assert.equal(readFileSync(firstFile, 'utf8'), 'export const first = "latest";\n');
    assert.equal(readFileSync(blockedParent, 'utf8'), 'this file blocks creating a child file\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
