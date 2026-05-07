import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('removeProject deletes imported Claude transcripts and keeps workspace clean on next bootstrap', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-projects-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const claudeProjectDir = path.join(root, '.claude', 'projects', 'demo-project');
  const transcriptPath = path.join(claudeProjectDir, 'session-1.jsonl');

  try {
    mkdirSync(repo, { recursive: true });
    mkdirSync(claudeProjectDir, { recursive: true });
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          sessionId: 'session-project-1',
          cwd: repo,
          timestamp: '2026-05-07T09:00:00.000Z',
          sessionName: '项目删除回归测试',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'hello project' }],
          },
        }),
      ].join('\n'),
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
          import { existsSync } from 'node:fs';
          const { getWorkspaceBootstrap, removeProject } = await import('./server/lib/workspace-store.ts');

          const imported = getWorkspaceBootstrap();
          const importedProjectId = imported.projects[0]?.id ?? null;
          if (!importedProjectId) {
            throw new Error('expected imported project');
          }

          removeProject(importedProjectId);
          const afterRemove = getWorkspaceBootstrap();

          console.log(JSON.stringify({
            importedProjectCount: imported.projects.length,
            importedThreadCount: imported.projects[0]?.threads.length ?? 0,
            afterRemoveProjectCount: afterRemove.projects.length,
            transcriptExistsAfterRemove: existsSync(${JSON.stringify(transcriptPath)}),
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
      importedProjectCount: 1,
      importedThreadCount: 1,
      afterRemoveProjectCount: 0,
      transcriptExistsAfterRemove: false,
    });
    assert.equal(existsSync(transcriptPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
