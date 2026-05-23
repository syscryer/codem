import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('getWorkspaceBootstrap includes git diff for the active project', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-git-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');

  try {
    run('git', ['init', repo]);
    run('git', ['config', 'user.email', 'codem@example.test'], repo);
    run('git', ['config', 'user.name', 'CodeM Test'], repo);
    writeFileSync(path.join(repo, 'tracked.txt'), 'base\n');
    run('git', ['add', 'tracked.txt'], repo);
    run('git', ['commit', '-m', 'initial'], repo);
    writeFileSync(path.join(repo, 'untracked.txt'), 'new\n');

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { createProject, getWorkspaceBootstrap } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});
          const bootstrap = getWorkspaceBootstrap();
          const project = bootstrap.projects.find((item) => item.id === projectId);
          console.log(JSON.stringify(project?.gitDiff));
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
    assert.deepEqual(JSON.parse(child.stdout.trim()), {
      additions: 0,
      deletions: 0,
      filesChanged: 1,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('getProjectGitStatus keeps untracked chinese paths readable', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-git-status-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');

  try {
    run('git', ['init', repo]);
    run('git', ['config', 'user.email', 'codem@example.test'], repo);
    run('git', ['config', 'user.name', 'CodeM Test'], repo);
    writeFileSync(path.join(repo, 'tracked.txt'), 'base\n');
    run('git', ['add', 'tracked.txt'], repo);
    run('git', ['commit', '-m', 'initial'], repo);
    mkdirSync(path.join(repo, 'docs', 'design'), { recursive: true });
    writeFileSync(path.join(repo, 'docs', 'design', '类型项目.txt'), 'content\n');

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { createProject, getProjectGitStatus } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});
          const status = await getProjectGitStatus(projectId);
          console.log(JSON.stringify(status.files));
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
    const files = JSON.parse(child.stdout.trim()) as Array<{ path: string; untracked: boolean }>;
    assert.equal(files.some((file) => file.untracked && file.path === 'docs/design/类型项目.txt'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('getProjectGitStatus returns paths relative to subdirectory projects', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-git-subdir-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const projectDir = path.join(repo, 'docs', 'design');

  try {
    run('git', ['init', repo]);
    run('git', ['config', 'user.email', 'codem@example.test'], repo);
    run('git', ['config', 'user.name', 'CodeM Test'], repo);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, 'tracked.txt'), 'base\n');
    run('git', ['add', '.'], repo);
    run('git', ['commit', '-m', 'initial'], repo);
    writeFileSync(path.join(projectDir, '.mcp.json'), '{\"ok\":true}\n');

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { createProject, getProjectGitStatus, getProjectGitFileDiff } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(projectDir)});
          const status = await getProjectGitStatus(projectId);
          const diff = await getProjectGitFileDiff(projectId, '.mcp.json');
          console.log(JSON.stringify({ files: status.files, diff }));
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
    const payload = JSON.parse(child.stdout.trim()) as {
      files: Array<{ path: string; untracked: boolean }>;
      diff: { path: string; afterContent: string; beforeContent: string };
    };
    assert.equal(payload.files.some((file) => file.untracked && file.path === '.mcp.json'), true);
    assert.equal(payload.diff.path, '.mcp.json');
    assert.equal(payload.diff.afterContent.includes('"ok":true'), true);
    assert.equal(payload.diff.beforeContent, '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function run(command: string, args: string[], cwd?: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
