import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildWorkspaceSidebarSections } from './workspace-pinning';
import type { ProjectSummary } from '../types';

const workspaceStateSource = readFileSync(new URL('../hooks/useWorkspaceState.ts', import.meta.url), 'utf8');

function createProject(overrides: Partial<ProjectSummary> & Pick<ProjectSummary, 'id' | 'name'>): ProjectSummary {
  return {
    id: overrides.id,
    name: overrides.name,
    path: overrides.path ?? `D:\\workspace\\${overrides.name}`,
    createdAt: overrides.createdAt ?? '2026-05-26T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-05-26T10:00:00.000Z',
    gitDiff: overrides.gitDiff ?? { additions: 0, deletions: 0, filesChanged: 0 },
    isGitRepo: overrides.isGitRepo ?? true,
    isGitWorktree: overrides.isGitWorktree ?? false,
    threads: overrides.threads ?? [],
    gitBranch: overrides.gitBranch,
    pinnedAt: overrides.pinnedAt,
  };
}

test('搜索未命中时仍保留置顶项目和置顶会话区', () => {
  const sections = buildWorkspaceSidebarSections(
    [
      createProject({
        id: 'project-pinned',
        name: 'codem',
        pinnedAt: '2026-05-26T12:00:00.000Z',
        threads: [
          {
            id: 'thread-pinned',
            projectId: 'project-pinned',
            title: '置顶会话',
            sessionId: 'sess-1',
            workingDirectory: 'D:\\workspace\\codem',
            updatedAt: '2026-05-26T12:00:00.000Z',
            updatedLabel: '刚刚',
            provider: 'claude',
            pinnedAt: '2026-05-26T12:30:00.000Z',
          },
          {
            id: 'thread-plain',
            projectId: 'project-pinned',
            title: '普通会话',
            sessionId: 'sess-2',
            workingDirectory: 'D:\\workspace\\codem',
            updatedAt: '2026-05-26T11:00:00.000Z',
            updatedLabel: '1 小时前',
            provider: 'claude',
          },
        ],
      }),
      createProject({
        id: 'project-plain',
        name: 'other',
        threads: [
          {
            id: 'thread-match',
            projectId: 'project-plain',
            title: 'search-hit thread',
            sessionId: 'sess-3',
            workingDirectory: 'D:\\workspace\\other',
            updatedAt: '2026-05-26T09:00:00.000Z',
            updatedLabel: '2 小时前',
            provider: 'claude',
          },
        ],
      }),
    ],
    'search-hit',
    'updated',
  );

  assert.deepEqual(sections.pinnedThreads.map((thread) => thread.id), ['thread-pinned']);
  assert.deepEqual(sections.pinnedProjects.map((project) => project.id), ['project-pinned']);
  assert.deepEqual(sections.pinnedProjects[0]?.threads.map((thread) => thread.id), ['thread-plain']);
  assert.deepEqual(sections.unpinnedProjects.map((project) => project.id), ['project-plain']);
  assert.deepEqual(sections.unpinnedProjects[0]?.threads.map((thread) => thread.id), ['thread-match']);
});

test('未置顶项目列表会剔除已经提升到置顶区的会话', () => {
  const sections = buildWorkspaceSidebarSections(
    [
      createProject({
        id: 'project-a',
        name: 'alpha',
        threads: [
          {
            id: 'thread-a',
            projectId: 'project-a',
            title: 'Pinned thread',
            sessionId: 'sess-a',
            workingDirectory: 'D:\\workspace\\alpha',
            updatedAt: '2026-05-26T10:00:00.000Z',
            updatedLabel: '刚刚',
            provider: 'claude',
            pinnedAt: '2026-05-26T11:00:00.000Z',
          },
          {
            id: 'thread-b',
            projectId: 'project-a',
            title: 'Plain thread',
            sessionId: 'sess-b',
            workingDirectory: 'D:\\workspace\\alpha',
            updatedAt: '2026-05-26T09:30:00.000Z',
            updatedLabel: '30 分钟前',
            provider: 'claude',
          },
        ],
      }),
    ],
    '',
    'updated',
  );

  assert.deepEqual(sections.pinnedThreads.map((thread) => thread.id), ['thread-a']);
  assert.deepEqual(sections.unpinnedProjects[0]?.threads.map((thread) => thread.id), ['thread-b']);
});

test('useWorkspaceState 通过共享 helper 构建侧边栏置顶分区，避免搜索逻辑分叉', () => {
  assert.match(workspaceStateSource, /buildWorkspaceSidebarSections\(/);
});

test('侧边栏批量折叠只作用普通项目区，不影响置顶项目', () => {
  assert.match(workspaceStateSource, /const shouldCollapse = unpinnedProjects\.some\(\(project\) => !collapsedProjects\[project\.id\]\)/);
  assert.match(workspaceStateSource, /for \(const project of unpinnedProjects\)/);
});
