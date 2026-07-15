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

test('getWorkspaceBootstrap skips imported sessions whose cwd is not a directory', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-projects-'));
  const appData = path.join(root, 'appdata');
  const cwdFile = path.join(root, 'not-a-directory.txt');
  const claudeProjectDir = path.join(root, '.claude', 'projects', 'bad-cwd-project');
  const transcriptPath = path.join(claudeProjectDir, 'session-bad-cwd.jsonl');

  try {
    mkdirSync(claudeProjectDir, { recursive: true });
    writeFileSync(cwdFile, 'not a project directory\n', 'utf8');
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          sessionId: 'session-bad-cwd',
          cwd: cwdFile,
          timestamp: '2026-07-06T04:00:00.000Z',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'hello bad cwd' }],
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
          const { getWorkspaceBootstrap } = await import('./server/lib/workspace-store.ts');
          const workspace = getWorkspaceBootstrap();
          console.log(JSON.stringify({
            projectCount: workspace.projects.length,
            activeProjectId: workspace.activeProjectId,
            activeThreadId: workspace.activeThreadId,
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
      projectCount: 0,
      activeProjectId: null,
      activeThreadId: null,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('getWorkspaceBootstrap keeps stored imported sessions visible when transcript is missing', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-projects-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const claudeProjectDir = path.join(root, '.claude', 'projects', 'demo-project');
  const transcriptPath = path.join(claudeProjectDir, 'session-visible-after-missing-transcript.jsonl');

  try {
    mkdirSync(repo, { recursive: true });
    mkdirSync(claudeProjectDir, { recursive: true });
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: 'user',
          sessionId: 'session-visible-after-missing-transcript',
          cwd: repo,
          timestamp: '2026-04-20T09:00:00.000Z',
          sessionName: '缺失 transcript 的历史会话',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'hello project' }],
          },
        }),
        JSON.stringify({
          type: 'assistant',
          sessionId: 'session-visible-after-missing-transcript',
          cwd: repo,
          timestamp: '2026-04-20T09:00:01.000Z',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'hello back' }],
            usage: {
              input_tokens: 100,
              output_tokens: 20,
            },
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
          import { unlinkSync } from 'node:fs';
          const { getWorkspaceBootstrap, getThreadHistory } = await import('./server/lib/workspace-store.ts');

          const imported = getWorkspaceBootstrap();
          const importedThread = imported.projects[0]?.threads[0];
          if (!importedThread) {
            throw new Error('expected imported thread');
          }

          getThreadHistory(importedThread.id);
          unlinkSync(${JSON.stringify(transcriptPath)});

          const afterMissingTranscript = getWorkspaceBootstrap();
          const restoredThread = afterMissingTranscript.projects[0]?.threads.find((item) => item.id === importedThread.id);

          console.log(JSON.stringify({
            importedThreadCount: imported.projects[0]?.threads.length ?? 0,
            afterMissingTranscriptThreadCount: afterMissingTranscript.projects[0]?.threads.length ?? 0,
            restoredTitle: restoredThread?.title ?? null,
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
      importedThreadCount: 1,
      afterMissingTranscriptThreadCount: 1,
      restoredTitle: '缺失 transcript 的历史会话',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('removeProject physically deletes stored sessions and empty Claude project directories', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-projects-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const claudeProjectDir = path.join(root, '.claude', 'projects', 'demo-project');
  const transcriptPath = path.join(claudeProjectDir, 'session-physical-delete.jsonl');

  try {
    mkdirSync(repo, { recursive: true });
    mkdirSync(claudeProjectDir, { recursive: true });
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          sessionId: 'session-physical-delete',
          cwd: repo,
          timestamp: '2026-04-20T09:00:00.000Z',
          sessionName: '物理删除项目',
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
          import path from 'node:path';
          import { DatabaseSync } from 'node:sqlite';
          const { getWorkspaceBootstrap, removeProject, saveThreadHistory } = await import('./server/lib/workspace-store.ts');

          const imported = getWorkspaceBootstrap();
          const project = imported.projects[0];
          const thread = project?.threads[0];
          if (!project || !thread) {
            throw new Error('expected imported project and thread');
          }

          saveThreadHistory(thread.id, [{
            id: 'turn-1',
            userText: 'hello project',
            assistantText: 'hello back',
            workspace: ${JSON.stringify(repo)},
            status: 'done',
            items: [],
            tools: [{
              id: 'tool-1',
              name: 'Read',
              title: '读取文件',
              status: 'done',
            }],
          }]);

          removeProject(project.id);

          const db = new DatabaseSync(path.join(${JSON.stringify(appData)}, 'CodeM', 'codem.sqlite'), { readOnly: true });
          const counts = db.prepare(\`
            SELECT
              (SELECT COUNT(*) FROM messages WHERE thread_id = ?) AS messages,
              (SELECT COUNT(*) FROM tool_calls WHERE thread_id = ?) AS toolCalls,
              (SELECT COUNT(*) FROM threads WHERE id = ?) AS threads,
              (SELECT COUNT(*) FROM projects WHERE id = ?) AS projects
          \`).get(thread.id, thread.id, thread.id, project.id);
          db.close();

          console.log(JSON.stringify({
            ...counts,
            transcriptExists: existsSync(${JSON.stringify(transcriptPath)}),
            claudeProjectDirExists: existsSync(${JSON.stringify(claudeProjectDir)}),
            repoExists: existsSync(${JSON.stringify(repo)}),
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
      messages: 0,
      toolCalls: 0,
      threads: 0,
      projects: 0,
      transcriptExists: false,
      claudeProjectDirExists: false,
      repoExists: true,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
