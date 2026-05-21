import {
  Check,
  Copy,
  ExternalLink,
  GitBranchPlus,
  LoaderCircle,
  RefreshCw,
  Trash2,
  TreePine,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchProjectWorktrees, removeProjectWorktree } from '../../lib/worktree-api';
import type { GitCreateWorktreeResult, GitWorktreeInfo, GitWorktreeList, ProjectSummary, WorkspaceBootstrap } from '../../types';
import { WorktreeCreateDialog } from '../WorktreeCreateDialog';

type WorktreeSettingsSectionProps = {
  activeProject: ProjectSummary | null;
  projects: ProjectSummary[];
  onOpenWorktreePath: (worktreePath: string) => Promise<void>;
  onSyncWorkspace: (workspace: WorkspaceBootstrap) => void;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

export function WorktreeSettingsSection({
  activeProject,
  projects,
  onOpenWorktreePath,
  onSyncWorkspace,
  showToast,
}: WorktreeSettingsSectionProps) {
  const [list, setList] = useState<GitWorktreeList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingRemovePath, setPendingRemovePath] = useState('');
  const [removingPath, setRemovingPath] = useState('');
  const [copiedPath, setCopiedPath] = useState('');

  const projectByPath = useMemo(() => {
    const map = new Map<string, ProjectSummary>();
    for (const project of projects) {
      map.set(normalizePath(project.path), project);
    }
    return map;
  }, [projects]);

  useEffect(() => {
    void refresh();
  }, [activeProject?.id]);

  async function refresh() {
    setList(null);
    setError('');
    if (!activeProject) {
      return;
    }

    setLoading(true);
    try {
      setList(await fetchProjectWorktrees(activeProject.id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取工作树失败');
    } finally {
      setLoading(false);
    }
  }

  async function openPath(worktreePath: string) {
    const response = await fetch('/api/system/open-path', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: worktreePath }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
  }

  async function copyPath(worktreePath: string) {
    try {
      await navigator.clipboard.writeText(worktreePath);
      setCopiedPath(worktreePath);
      window.setTimeout(() => setCopiedPath((current) => (current === worktreePath ? '' : current)), 1400);
    } catch {
      showToast(`复制失败，请手动复制：${worktreePath}`, 'error');
    }
  }

  async function removeWorktree(worktree: GitWorktreeInfo) {
    if (!activeProject || removingPath) {
      return;
    }

    if (pendingRemovePath !== worktree.path) {
      setPendingRemovePath(worktree.path);
      showToast(`再次点击“删除”即可移除 ${worktreeTitle(worktree)}。`, 'info');
      return;
    }

    setRemovingPath(worktree.path);
    try {
      const workspace = await removeProjectWorktree(activeProject.id, worktree.path);
      onSyncWorkspace(workspace);
      setPendingRemovePath('');
      showToast('工作树已删除');
      await refresh();
    } catch (removeError) {
      showToast(removeError instanceof Error ? removeError.message : '删除工作树失败', 'error');
    } finally {
      setRemovingPath('');
    }
  }

  function handleCreated(result: GitCreateWorktreeResult) {
    if (result.workspace) {
      onSyncWorkspace(result.workspace);
    }
    showToast(result.projectId ? '工作树已创建并切换' : '工作树已创建');
    void refresh();
  }

  const worktrees = list?.worktrees ?? [];
  const canCreate = Boolean(activeProject?.isGitRepo && list?.isRepo);

  return (
    <section className="settings-page-section settings-page-wide">
      <header className="settings-section-head settings-section-head-row">
        <h1>工作树</h1>
        <div className="settings-editor-actions">
          <button
            type="button"
            className="settings-action-button"
            onClick={() => setCreateOpen(true)}
            disabled={!canCreate || loading}
          >
            <GitBranchPlus size={14} />
            <span>新建工作树</span>
          </button>
          <button type="button" className="settings-action-button" onClick={() => void refresh()} disabled={loading || !activeProject}>
            <RefreshCw className={loading ? 'spin' : undefined} size={14} />
            <span>刷新</span>
          </button>
        </div>
      </header>

      <div className="settings-panel settings-editor-panel worktree-suite-panel">
        <div className="settings-editor-head">
          <div className="settings-editor-title">
            <TreePine size={15} />
            <span>
              <strong>Git 工作树</strong>
              <small>为当前仓库创建和管理隔离目录，适合让 Claude Code 在独立分支上工作。</small>
            </span>
          </div>
        </div>

        {!activeProject ? (
          <div className="settings-list-empty">当前没有选择项目。</div>
        ) : error ? (
          <div className="plugins-error-panel">
            <strong>读取工作树失败</strong>
            <small>{error}</small>
          </div>
        ) : list && !list.isRepo ? (
          <div className="settings-list-empty">当前项目不是 Git 仓库，不能使用工作树。</div>
        ) : (
          <>
            <div className="plugins-help-panel">
              <span>
                默认只管理当前 Git 仓库的 worktree。删除时使用 <code>git worktree remove</code>，存在未提交变更时 Git 会拒绝删除。
              </span>
            </div>

            {list?.currentRoot ? (
              <div className="worktree-current-root">
                <span>当前仓库</span>
                <code>{list.currentRoot}</code>
              </div>
            ) : null}

            <div className="settings-list settings-list-spaced worktree-list">
              {loading ? <div className="settings-list-empty">正在读取工作树</div> : null}
              {!loading && worktrees.length === 0 ? (
                <div className="settings-list-empty">暂无工作树，可以点击右上角新建。</div>
              ) : null}
              {worktrees.map((worktree, index) => {
                const project = projectByPath.get(normalizePath(worktree.path)) ?? null;
                return (
                  <WorktreeRow
                    key={worktree.path}
                    worktree={worktree}
                    isMain={worktree.main || index === 0}
                    project={project}
                    copied={copiedPath === worktree.path}
                    pendingRemove={pendingRemovePath === worktree.path}
                    removing={removingPath === worktree.path}
                    onOpen={() => void openPath(worktree.path).catch((openError) =>
                      showToast(openError instanceof Error ? openError.message : '打开工作树失败', 'error'),
                    )}
                    onCopy={() => void copyPath(worktree.path)}
                    onSelect={() => void onOpenWorktreePath(worktree.path)}
                    onRemove={() => void removeWorktree(worktree)}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>

      {createOpen ? (
        <WorktreeCreateDialog
          project={activeProject}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
          showToast={showToast}
        />
      ) : null}
    </section>
  );
}

function WorktreeRow({
  worktree,
  isMain,
  project,
  copied,
  pendingRemove,
  removing,
  onOpen,
  onCopy,
  onSelect,
  onRemove,
}: {
  worktree: GitWorktreeInfo;
  isMain: boolean;
  project: ProjectSummary | null;
  copied: boolean;
  pendingRemove: boolean;
  removing: boolean;
  onOpen: () => void;
  onCopy: () => void;
  onSelect: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="settings-list-row settings-list-row-tall worktree-list-row">
      <div className="worktree-row-main">
        <div className="worktree-row-title">
          <strong>{worktreeTitle(worktree)}</strong>
          <span className="settings-badge">{isMain ? '主工作区' : '工作树'}</span>
          {worktree.current ? <span className="settings-badge available">当前使用</span> : null}
          {project ? <span className="settings-badge available">已加入项目</span> : null}
          {worktree.changedFiles ? <span className="settings-badge">{worktree.changedFiles} 个变更</span> : null}
          {worktree.detached ? <span className="settings-badge">detached</span> : null}
          {!worktree.exists ? <span className="settings-badge error">路径不存在</span> : null}
        </div>
        <small className="worktree-row-path" title={worktree.path}>{worktree.path}</small>
        {worktree.statusError ? <small className="mcp-warning-inline">{worktree.statusError}</small> : null}
      </div>
      <div className="settings-list-actions worktree-list-actions">
        <button type="button" className="settings-action-button" onClick={onOpen} disabled={!worktree.exists}>
          <ExternalLink size={14} />
          <span>打开</span>
        </button>
        <button type="button" className="settings-action-button" onClick={onCopy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
        <button type="button" className="settings-action-button" onClick={onSelect} disabled={!worktree.exists}>
          <TreePine size={14} />
          <span>{project ? '切换' : '加入并切换'}</span>
        </button>
        <button
          type="button"
          className="settings-action-button danger"
          onClick={onRemove}
          disabled={worktree.current || worktree.bare || removing}
        >
          {removing ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
          <span>{pendingRemove ? '确认删除' : '删除'}</span>
        </button>
      </div>
    </div>
  );
}

function worktreeTitle(worktree: GitWorktreeInfo) {
  if (worktree.branch) {
    return worktree.branch;
  }
  if (worktree.detached && worktree.head) {
    return `detached ${worktree.head.slice(0, 8)}`;
  }
  return basename(worktree.path);
}

function basename(value: string) {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? 'worktree';
}

function normalizePath(value: string) {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
