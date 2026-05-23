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

test('listProjectGitBranches includes local and remote branches', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-git-branches-'));
  const appData = path.join(root, 'appdata');
  const remote = path.join(root, 'remote.git');
  const repo = path.join(root, 'repo');

  try {
    run('git', ['init', '--bare', remote]);
    run('git', ['init', '-b', 'main', repo]);
    run('git', ['config', 'user.email', 'codem@example.test'], repo);
    run('git', ['config', 'user.name', 'CodeM Test'], repo);
    writeFileSync(path.join(repo, 'tracked.txt'), 'base\n');
    run('git', ['add', 'tracked.txt'], repo);
    run('git', ['commit', '-m', 'initial'], repo);
    run('git', ['remote', 'add', 'origin', remote], repo);
    run('git', ['push', '-u', 'origin', 'main'], repo);
    run('git', ['checkout', '-b', 'feature/demo'], repo);
    writeFileSync(path.join(repo, 'feature.txt'), 'feature\n');
    run('git', ['add', 'feature.txt'], repo);
    run('git', ['commit', '-m', 'feature'], repo);
    run('git', ['push', '-u', 'origin', 'feature/demo'], repo);
    run('git', ['checkout', 'main'], repo);

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { createProject, listProjectGitBranches } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});
          const branches = await listProjectGitBranches(projectId);
          console.log(JSON.stringify(branches));
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
    const branches = JSON.parse(child.stdout.trim()) as Array<{
      name: string;
      current: boolean;
      isRemote?: boolean;
    }>;
    assert.equal(branches.some((branch) => branch.name === 'main' && branch.current), true);
    assert.equal(branches.some((branch) => branch.name === 'feature/demo' && !branch.isRemote), true);
    assert.equal(branches.some((branch) => branch.name === 'origin/main' && branch.isRemote), true);
    assert.equal(branches.some((branch) => branch.name === 'origin/feature/demo' && branch.isRemote), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('listProjectGitBranches includes tags as a separate kind', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-git-tags-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');

  try {
    run('git', ['init', '-b', 'main', repo]);
    run('git', ['config', 'user.email', 'codem@example.test'], repo);
    run('git', ['config', 'user.name', 'CodeM Test'], repo);
    writeFileSync(path.join(repo, 'tracked.txt'), 'base\n');
    run('git', ['add', 'tracked.txt'], repo);
    run('git', ['commit', '-m', 'initial'], repo);
    run('git', ['tag', 'v1.0.0'], repo);

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { createProject, listProjectGitBranches } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});
          const branches = await listProjectGitBranches(projectId);
          console.log(JSON.stringify(branches));
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
    const branches = JSON.parse(child.stdout.trim()) as Array<{
      name: string;
      current: boolean;
      isRemote?: boolean;
      kind?: string;
    }>;
    assert.equal(branches.some((branch) => branch.name === 'main' && branch.kind === 'local'), true);
    assert.equal(branches.some((branch) => branch.name === 'v1.0.0' && branch.kind === 'tag' && !branch.isRemote), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('git history APIs return commit sets, details and file preview', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-git-history-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');

  try {
    run('git', ['init', '-b', 'main', repo]);
    run('git', ['config', 'user.email', 'codem@example.test'], repo);
    run('git', ['config', 'user.name', 'CodeM Test'], repo);
    writeFileSync(path.join(repo, 'tracked.txt'), 'base\n');
    run('git', ['add', 'tracked.txt'], repo);
    run('git', ['commit', '-m', 'initial'], repo);

    run('git', ['checkout', '-b', 'feature/demo'], repo);
    writeFileSync(path.join(repo, 'tracked.txt'), 'base\nfeature\n');
    run('git', ['add', 'tracked.txt'], repo);
    run('git', ['commit', '-m', 'feature change'], repo);
    writeFileSync(path.join(repo, 'extra.txt'), 'extra\n');
    run('git', ['add', 'extra.txt'], repo);
    run('git', ['commit', '-m', 'extra file'], repo);

    run('git', ['checkout', 'main'], repo);
    writeFileSync(path.join(repo, 'main.txt'), 'main\n');
    run('git', ['add', 'main.txt'], repo);
    run('git', ['commit', '-m', 'main change'], repo);

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const {
            compareProjectGitBranches,
            createProject,
            getProjectGitCommitDetails,
            getProjectGitCommitFilePreview,
            listProjectGitHistory,
          } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});
          const history = await listProjectGitHistory(projectId);
          const compare = await compareProjectGitBranches(projectId, 'feature/demo', 'main');
          const targetCommit = compare.targetOnlyCommits.at(-1);
          const details = await getProjectGitCommitDetails(projectId, targetCommit.sha);
          const preview = await getProjectGitCommitFilePreview(projectId, targetCommit.sha, 'tracked.txt');
          console.log(JSON.stringify({ history, compare, details, preview }));
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
      history: Array<{ summary: string }>;
      compare: {
        targetOnlyCommits: Array<{ sha: string; summary: string }>;
        currentOnlyCommits: Array<{ sha: string; summary: string }>;
      };
      details: {
        summary: string;
        totalAdditions: number;
        totalDeletions: number;
        files: Array<{ path: string; additions: number; deletions: number }>;
      };
      preview: {
        path: string;
        beforeContent: string;
        afterContent: string;
        content: string;
      };
    };

    assert.equal(payload.history[0]?.summary, 'main change');
    assert.equal(payload.compare.targetOnlyCommits.length, 2);
    assert.equal(payload.compare.currentOnlyCommits.length, 1);
    assert.equal(payload.compare.targetOnlyCommits.some((commit) => commit.summary === 'feature change'), true);
    assert.equal(payload.details.summary, 'feature change');
    assert.equal(payload.details.totalAdditions, 1);
    assert.equal(payload.details.totalDeletions, 0);
    assert.equal(
      payload.details.files.some((file) => file.path === 'tracked.txt' && file.additions === 1 && file.deletions === 0),
      true,
    );
    assert.equal(payload.preview.path, 'tracked.txt');
    assert.equal(payload.preview.beforeContent, 'base\n');
    assert.equal(payload.preview.afterContent, 'base\nfeature\n');
    assert.equal(payload.preview.content.includes('@@'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('listProjectGitHistoryLog returns parents refs and graph metadata for merge commits', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-git-history-log-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');

  try {
    run('git', ['init', '-b', 'main', repo]);
    run('git', ['config', 'user.email', 'codem@example.test'], repo);
    run('git', ['config', 'user.name', 'CodeM Test'], repo);
    writeFileSync(path.join(repo, 'tracked.txt'), 'base\n');
    run('git', ['add', 'tracked.txt'], repo);
    run('git', ['commit', '-m', 'initial'], repo);
    run('git', ['tag', 'v1.0.0'], repo);

    run('git', ['checkout', '-b', 'feature/demo'], repo);
    writeFileSync(path.join(repo, 'tracked.txt'), 'base\nfeature\n');
    run('git', ['add', 'tracked.txt'], repo);
    run('git', ['commit', '-m', 'feature change'], repo);

    run('git', ['checkout', 'main'], repo);
    writeFileSync(path.join(repo, 'main.txt'), 'main\n');
    run('git', ['add', 'main.txt'], repo);
    run('git', ['commit', '-m', 'main change'], repo);
    run('git', ['merge', '--no-ff', 'feature/demo', '-m', 'merge feature'], repo);

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { createProject, listProjectGitHistoryLog } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});
          const history = await listProjectGitHistoryLog(projectId, { refs: ['main'], limit: 20 });
          console.log(JSON.stringify(history));
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
      commits: Array<{
        summary: string;
        parents: string[];
        refs: string[];
        graphText?: string;
        graph: {
          lane: number;
          colorIndex: number;
          segmentsBefore: Array<{ lane: number; kind: string; colorIndex?: number }>;
          segmentsAfter: Array<{ lane: number; kind: string; colorIndex?: number }>;
        };
      }>;
      availableAuthors: string[];
      activeRefs: string[];
      hasMore: boolean;
      nextCursor: string | null;
    };
    const mergeCommit = payload.commits.find((commit) => commit.summary === 'merge feature');
    const mainCommit = payload.commits.find((commit) => commit.summary === 'main change');
    const taggedCommit = payload.commits.find((commit) => commit.refs.includes('tag: v1.0.0'));

    assert.equal(Boolean(mergeCommit), true);
    assert.equal(Boolean(mainCommit), true);
    assert.equal(typeof mergeCommit?.graphText, 'string');
    assert.equal(mergeCommit?.graphText?.includes('*'), true, 'Git 日志应返回原生 graph 文本，前端优先使用它渲染');
    assert.equal(mergeCommit?.parents.length, 2);
    assert.equal(
      mergeCommit?.graph.segmentsAfter.some((segment) => segment.kind === 'merge-left' || segment.kind === 'merge-right'),
      true,
    );
    assert.equal(
      mergeCommit?.graph.colorIndex,
      mainCommit?.graph.colorIndex,
      '合并提交与主干延续车道应保持相同颜色，避免图线视觉断裂',
    );
    const mergedBranchSegment = mergeCommit?.graph.segmentsAfter.find(
      (segment) => segment.kind === 'merge-right' || segment.kind === 'merge-left',
    );
    const parallelBranchSegment = mainCommit?.graph.segmentsBefore.find(
      (segment) => segment.lane === mergedBranchSegment?.lane,
    );
    assert.notEqual(mergedBranchSegment?.colorIndex, undefined, '合并线段需要携带自己的颜色');
    assert.equal(
      parallelBranchSegment?.colorIndex,
      mergedBranchSegment?.colorIndex,
      '同一并行车道跨提交行的线段颜色应保持连续',
    );
    assert.notEqual(
      parallelBranchSegment?.colorIndex,
      mainCommit?.graph.colorIndex,
      '并行车道不能被当前提交点颜色覆盖，否则视觉上会断线',
    );
    assert.equal(Boolean(taggedCommit), true);
    assert.equal(payload.availableAuthors.includes('CodeM Test'), true);
    assert.equal(payload.activeRefs.includes('main'), true);
    assert.equal(payload.hasMore, false);
    assert.equal(payload.nextCursor, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('listProjectGitHistoryLog keeps existing lanes stable when merge adds a lane', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-git-history-lane-shift-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');

  try {
    run('git', ['init', '-b', 'main', repo]);
    run('git', ['config', 'user.email', 'codem@example.test'], repo);
    run('git', ['config', 'user.name', 'CodeM Test'], repo);
    writeFileSync(path.join(repo, 'base.txt'), 'base\n');
    run('git', ['add', 'base.txt'], repo);
    run('git', ['commit', '-m', 'base'], repo);

    run('git', ['checkout', '-b', 'feature/a'], repo);
    writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    run('git', ['add', 'a.txt'], repo);
    run('git', ['commit', '-m', 'feature a'], repo);

    run('git', ['checkout', 'main'], repo);
    run('git', ['checkout', '-b', 'feature/b'], repo);
    writeFileSync(path.join(repo, 'b.txt'), 'b\n');
    run('git', ['add', 'b.txt'], repo);
    run('git', ['commit', '-m', 'feature b'], repo);

    run('git', ['checkout', 'main'], repo);
    writeFileSync(path.join(repo, 'main.txt'), 'main\n');
    run('git', ['add', 'main.txt'], repo);
    run('git', ['commit', '-m', 'main change'], repo);
    run('git', ['merge', '--no-ff', 'feature/a', '-m', 'merge a'], repo);
    run('git', ['merge', '--no-ff', 'feature/b', '-m', 'merge b'], repo);

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { createProject, listProjectGitHistoryLog } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});
          const history = await listProjectGitHistoryLog(projectId, { refs: ['main'], limit: 20 });
          console.log(JSON.stringify(history));
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
      commits: Array<{
        summary: string;
        graph: {
          lane: number;
          colorIndex: number;
          segmentsAfter: Array<{ lane: number; fromLane?: number; kind: string; colorIndex?: number }>;
        };
      }>;
    };
    const mergeA = payload.commits.find((commit) => commit.summary === 'merge a');
    const featureB = payload.commits.find((commit) => commit.summary === 'feature b');

    assert.equal(Boolean(mergeA), true);
    assert.equal(Boolean(featureB), true);
    assert.equal(
      mergeA?.graph.segmentsAfter.some((segment) => segment.kind === 'start'),
      false,
      'merge 插入新车道时不应额外画从中点开始的竖线',
    );
    assert.equal(
      mergeA?.graph.segmentsAfter.some((segment) => segment.kind === 'shift-right' || segment.kind === 'shift-left'),
      false,
      'merge 新增车道不应挤动已有车道，否则会出现成排彩色斜线',
    );
    assert.equal(
      featureB?.graph.lane,
      1,
      '已有并行分支应保持原 lane，新增 merge 父提交应追加到空位或最右侧',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('listProjectGitHistoryLog keeps merge graph lines compact for repeated merges', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-git-history-compact-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');

  try {
    run('git', ['init', '-b', 'main', repo]);
    run('git', ['config', 'user.email', 'codem@example.test'], repo);
    run('git', ['config', 'user.name', 'CodeM Test'], repo);
    writeFileSync(path.join(repo, 'base.txt'), 'base\n');
    run('git', ['add', 'base.txt'], repo);
    run('git', ['commit', '-m', 'base'], repo);

    for (const branchName of ['feature/a', 'feature/b', 'feature/c', 'feature/d']) {
      run('git', ['checkout', 'main'], repo);
      run('git', ['checkout', '-b', branchName], repo);
      writeFileSync(path.join(repo, `${branchName.replace('/', '-')}.txt`), `${branchName}\n`);
      run('git', ['add', '.'], repo);
      run('git', ['commit', '-m', branchName], repo);
    }

    run('git', ['checkout', 'main'], repo);
    for (const branchName of ['feature/a', 'feature/b', 'feature/c', 'feature/d']) {
      writeFileSync(path.join(repo, `main-${branchName.replace('/', '-')}.txt`), `${branchName}\n`);
      run('git', ['add', '.'], repo);
      run('git', ['commit', '-m', `main before ${branchName}`], repo);
      run('git', ['merge', '--no-ff', branchName, '-m', `merge ${branchName}`], repo);
    }

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { createProject, listProjectGitHistoryLog } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});
          const history = await listProjectGitHistoryLog(projectId, { refs: ['main'], limit: 40 });
          console.log(JSON.stringify(history));
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
      commits: Array<{
        summary: string;
        graph: {
          segmentsAfter: Array<{ lane: number; fromLane?: number; kind: string }>;
        };
      }>;
    };
    const mergeSegments = payload.commits
      .filter((commit) => commit.summary.startsWith('merge feature/'))
      .flatMap((commit) =>
        commit.graph.segmentsAfter.filter((segment) => segment.kind === 'merge-left' || segment.kind === 'merge-right'),
      );
    const maxMergeSpan = Math.max(
      0,
      ...mergeSegments.map((segment) => Math.abs(segment.lane - (segment.fromLane ?? segment.lane))),
    );

    assert.equal(mergeSegments.length, 4);
    assert.equal(maxMergeSpan <= 2, true, '重复 merge 时不应出现跨越大量车道的长斜线');
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
