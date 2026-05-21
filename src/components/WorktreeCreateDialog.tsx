import { GitBranchPlus, LoaderCircle, Wand2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createProjectWorktree, suggestProjectWorktreePath } from '../lib/worktree-api';
import type { GitCreateWorktreeResult, ProjectSummary } from '../types';

type WorktreeCreateDialogProps = {
  project: ProjectSummary | null;
  onClose: () => void;
  onCreated: (result: GitCreateWorktreeResult) => void;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

type Draft = {
  branch: string;
  base: string;
  path: string;
  addProject: boolean;
};

export function WorktreeCreateDialog({
  project,
  onClose,
  onCreated,
  showToast,
}: WorktreeCreateDialogProps) {
  const defaultBranch = useMemo(() => buildDefaultBranch(project), [project]);
  const [draft, setDraft] = useState<Draft>({
    branch: defaultBranch,
    base: project?.gitBranch || 'HEAD',
    path: '',
    addProject: true,
  });
  const [creating, setCreating] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    if (!project) {
      return;
    }

    const nextBranch = buildDefaultBranch(project);
    setDraft({
      branch: nextBranch,
      base: project.gitBranch || 'HEAD',
      path: '',
      addProject: true,
    });
    void suggestPath(nextBranch);
  }, [project?.id]);

  if (!project) {
    return null;
  }

  async function suggestPath(branch = draft.branch) {
    if (!project) {
      return;
    }

    setSuggesting(true);
    try {
      const path = await suggestProjectWorktreePath(project.id, branch);
      setDraft((current) => ({ ...current, path }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '生成工作树路径失败', 'error');
    } finally {
      setSuggesting(false);
    }
  }

  async function submit() {
    if (!project || creating) {
      return;
    }

    const branch = draft.branch.trim();
    const path = draft.path.trim();
    const base = draft.base.trim() || 'HEAD';
    if (!branch || !path) {
      showToast('请填写分支名和工作树路径。', 'error');
      return;
    }

    setCreating(true);
    try {
      const result = await createProjectWorktree(project.id, {
        branch,
        path,
        base,
        addProject: draft.addProject,
      });
      onCreated(result);
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '创建工作树失败', 'error');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => !creating && onClose()}>
      <div
        className="dialog-card worktree-dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="worktree-create-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-head worktree-dialog-head">
          <div>
            <h3 id="worktree-create-title">创建永久工作树</h3>
            <p>为“{project.name}”创建独立 Git worktree，创建后可作为单独项目运行 Claude Code。</p>
          </div>
          <button type="button" className="settings-icon-button" onClick={onClose} disabled={creating}>
            <X size={14} />
          </button>
        </div>
        <form
          className="worktree-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="clone-dialog-field">
            <span>新分支</span>
            <input
              autoFocus
              className="dialog-input"
              value={draft.branch}
              disabled={creating}
              onChange={(event) => setDraft((current) => ({ ...current, branch: event.target.value }))}
              onBlur={() => {
                if (!draft.path.trim()) {
                  void suggestPath();
                }
              }}
              placeholder="codex/my-task"
            />
            <small>创建命令会使用 `git worktree add -b 分支 路径 基础引用`。</small>
          </label>
          <label className="clone-dialog-field">
            <span>基础引用</span>
            <input
              className="dialog-input"
              value={draft.base}
              disabled={creating}
              onChange={(event) => setDraft((current) => ({ ...current, base: event.target.value }))}
              placeholder="HEAD"
            />
          </label>
          <label className="clone-dialog-field">
            <span>工作树路径</span>
            <div className="worktree-path-row">
              <input
                className="dialog-input"
                value={draft.path}
                disabled={creating}
                onChange={(event) => setDraft((current) => ({ ...current, path: event.target.value }))}
                placeholder="C:\\Users\\csm\\.codem\\worktrees\\..."
              />
              <button
                type="button"
                className="settings-action-button"
                disabled={creating || suggesting || !draft.branch.trim()}
                onClick={() => void suggestPath()}
              >
                {suggesting ? <LoaderCircle className="spin" size={14} /> : <Wand2 size={14} />}
                <span>生成</span>
              </button>
            </div>
          </label>
          <label className="worktree-dialog-option">
            <span>
              <strong>创建后添加为项目并切换</strong>
              <small>关闭后只创建 Git worktree，不切换当前工作区。</small>
            </span>
            <span className="settings-toggle">
              <input
                type="checkbox"
                checked={draft.addProject}
                disabled={creating}
                onChange={(event) => setDraft((current) => ({ ...current, addProject: event.target.checked }))}
              />
              <span aria-hidden="true" />
            </span>
          </label>
          <div className="dialog-actions">
            <button type="button" className="dialog-button secondary" onClick={onClose} disabled={creating}>
              取消
            </button>
            <button
              type="submit"
              className="dialog-button primary"
              disabled={creating || !draft.branch.trim() || !draft.path.trim()}
            >
              {creating ? <LoaderCircle className="spin" size={14} /> : <GitBranchPlus size={14} />}
              <span>{creating ? '创建中' : '创建工作树'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function buildDefaultBranch(project: ProjectSummary | null) {
  const projectName = project?.name || 'project';
  return `codex/${slug(projectName)}-${timestampSlug()}`;
}

function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

function timestampSlug() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}
