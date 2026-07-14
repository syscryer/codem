import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildWorkspaceSidebarSections } from './workspace-pinning';
import { defaultAppearanceSettings } from './settings-api.js';
import type { ProjectSummary } from '../types';

const workspaceStateSource = readFileSync(new URL('../hooks/useWorkspaceState.ts', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const sidebarProjectsSource = readFileSync(new URL('../components/SidebarProjects.tsx', import.meta.url), 'utf8');
const basicSettingsSource = readFileSync(new URL('../components/settings/BasicSettings.tsx', import.meta.url), 'utf8');
const settingsControlsSource = readFileSync(new URL('../components/settings/SettingsControls.tsx', import.meta.url), 'utf8');
const settingsSidebarSource = readFileSync(new URL('../components/settings/SettingsSidebar.tsx', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

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

test('会话搜索使用独立中央弹层而不是侧栏内联搜索框', () => {
  assert.match(appSource, /<SessionSearchDialog[\s\S]*open=\{searchOpen\}[\s\S]*query=\{searchQuery\}/);
  assert.doesNotMatch(sidebarProjectsSource, /className="sidebar-search"/);
  assert.match(stylesSource, /\.session-search-overlay\s*\{/);
  assert.match(stylesSource, /\.session-search-dialog\s*\{/);
  assert.match(stylesSource, /\.session-search-result\s*\{/);
  assert.match(stylesSource, /\.session-search-results\s*\{[\s\S]*gap:\s*3px;/);
  assert.match(stylesSource, /\.session-search-result\s*\{[\s\S]*min-height:\s*25px;[\s\S]*padding:\s*0\s+8px;[\s\S]*gap:\s*8px;/);
});

test('设置页切换时保留工作台节点，避免会话滚动位置丢失', () => {
  assert.match(appSource, /<SettingsView[\s\S]*hidden=\{appView\.kind !== 'settings'\}/);
  assert.match(appSource, /<div[\s\S]*className=\{`codex-shell\$\{sidebarVisible \? '' : ' sidebar-hidden'\}`\}[\s\S]*hidden=\{appView\.kind === 'settings'\}/);
  assert.match(stylesSource, /\.settings-view\[hidden\],\s*\.codex-shell\[hidden\]\s*\{[\s\S]*display:\s*none\s*!important;/);
});

test('设置侧栏字号和图标更接近 Codex 设置导航', () => {
  assert.match(settingsSidebarSource, /<RotateCcw size=\{16\}/);
  assert.match(settingsSidebarSource, /<Icon size=\{17\}/);
  assert.match(stylesSource, /\.settings-return,\s*\.settings-nav-item\s*\{[\s\S]*min-height:\s*34px;[\s\S]*gap:\s*10px;[\s\S]*padding:\s*0\s+10px;[\s\S]*font-size:\s*calc\(var\(--app-ui-font-size,\s*14px\)\s*\+\s*1px\);/);
  assert.match(stylesSource, /\.codex-desktop\s+\.settings-sidebar\s+:where\(\.settings-return,\s*\.settings-nav-item\)\s*\{[\s\S]*color:\s*color-mix\(in srgb,\s*var\(--app-text\)\s*86%,\s*var\(--app-muted\)\s*14%\);[\s\S]*font-size:\s*calc\(var\(--app-ui-font-size,\s*14px\)\s*\+\s*1px\);/);
  assert.match(stylesSource, /\.codex-desktop\s+\.settings-sidebar\s+:where\(\.settings-return,\s*\.settings-nav-item\)\s+svg\s*\{[\s\S]*color:\s*color-mix\(in srgb,\s*var\(--app-text\)\s*78%,\s*var\(--app-muted\)\s*22%\);/);
  assert.doesNotMatch(stylesSource, /\.codex-desktop\[data-density="compact"\]\s+\.settings-return,\s*\.codex-desktop\[data-density="compact"\]\s+\.settings-nav-item\s*\{[\s\S]*min-height:\s*26px;/);
});

test('默认 UI 字号为 14px', () => {
  assert.equal(defaultAppearanceSettings.uiFontSize, 14);
  assert.match(stylesSource, /\.codex-desktop\s*\{[\s\S]*font-size:\s*var\(--app-ui-font-size,\s*14px\);/);
  assert.match(stylesSource, /\.codex-desktop\s+:where\([\s\S]*\)\s*\{[\s\S]*font-size:\s*var\(--app-ui-font-size,\s*14px\);/);
});

test('设置项标题使用稍轻的字重', () => {
  assert.match(stylesSource, /\.settings-row-label\s+strong\s*\{[\s\S]*font-size:\s*14\.5px;[\s\S]*font-weight:\s*540;/);
});

test('基础设置分组标题不嵌在设置表格内部', () => {
  assert.match(settingsControlsSource, /export function SettingsGroup\(/);
  assert.match(settingsControlsSource, /<h2 className="settings-group-title">\{title\}<\/h2>/);
  assert.match(settingsControlsSource, /<div className="settings-panel">\{children\}<\/div>/);
  assert.match(basicSettingsSource, /<SettingsGroup title="Git 审查"(?:\s+[^>]*)?>/);
  assert.match(basicSettingsSource, /<\/SettingsGroup>/);
  assert.doesNotMatch(basicSettingsSource, /<h2 className="settings-group-title">Git 审查<\/h2>/);
  assert.doesNotMatch(basicSettingsSource, /settings-panel-subtitle">Git 审查/);
  assert.match(stylesSource, /\.settings-group-title\s*\{[\s\S]*margin:\s*26px\s+0\s+12px;[\s\S]*font-size:\s*14\.5px;/);
});

test('设置页主要文字跟随 UI 字号', () => {
  assert.match(stylesSource, /\.codex-desktop\s+\.settings-view\s+:where\([\s\S]*\.settings-segmented\s+button[\s\S]*\.settings-stepper\s+span[\s\S]*\)\s*\{[\s\S]*font-size:\s*var\(--app-ui-font-size,\s*14px\);/);
  assert.doesNotMatch(stylesSource, /\.codex-desktop\s+\.settings-view\s+:where\([\s\S]*\.settings-row-label\s+strong[\s\S]*\)\s*\{[\s\S]*font-size:\s*var\(--app-ui-font-size,\s*14px\);/);
  assert.match(stylesSource, /\.codex-desktop\s+\.settings-view\s+:where\([\s\S]*\.settings-row-label\s+small[\s\S]*\.settings-font-follow-text[\s\S]*\)\s*\{[\s\S]*font-size:\s*max\(11px,\s*calc\(var\(--app-ui-font-size,\s*14px\)\s*-\s*1px\)\);/);
  assert.match(stylesSource, /\.codex-desktop\s+\.settings-view\s+\.settings-section-head\s+h1\s*\{[\s\S]*font-size:\s*calc\(var\(--app-ui-font-size,\s*14px\)\s*\+\s*5px\);/);
  assert.doesNotMatch(stylesSource, /\.codex-desktop\s+\.settings-sidebar\s+:where\(\.settings-return,\s*\.settings-nav-item\)\s*\{[\s\S]*font-size:\s*15px;/);
});

test('会话标题使用更柔和的字重', () => {
  assert.match(
    stylesSource,
    /\.thread-title\s+h2\s*\{[\s\S]*max-width:\s*360px;[\s\S]*color:\s*#111827;[\s\S]*font-size:\s*14px;[\s\S]*font-weight:\s*560;[\s\S]*line-height:\s*1\.15;/,
  );
});

test('外观预览占位底色贴近左侧面板', () => {
  assert.match(stylesSource, /\.appearance-preview\s*\{[\s\S]*--appearance-preview-side-bg:\s*var\(--app-surface-muted,\s*#f5f7fa\);/);
  assert.match(stylesSource, /\.appearance-preview\s*\{[\s\S]*--appearance-preview-fill:\s*color-mix\(in srgb,\s*var\(--appearance-preview-side-bg\)\s*99\.5%,\s*#000000\s*0\.5%\);/);
  assert.match(stylesSource, /\.appearance-preview-sidebar\s*\{[\s\S]*background:\s*var\(--appearance-preview-side-bg\);/);
  assert.match(stylesSource, /\.appearance-preview-sidebar-line\s*\{[\s\S]*background:\s*var\(--appearance-preview-fill\);/);
  assert.match(stylesSource, /\.appearance-preview-message\s*\{[\s\S]*background:\s*var\(--appearance-preview-fill\);/);
  assert.match(stylesSource, /\.appearance-preview-code-pane\s*\{[\s\S]*background:\s*var\(--appearance-preview-fill\);/);
  assert.match(stylesSource, /\.appearance-preview-footer\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--accent\)\s*18%,\s*#ededed\);/);
});
