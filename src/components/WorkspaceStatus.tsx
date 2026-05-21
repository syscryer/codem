import { Activity, Check, GitBranchPlus, GitFork, LayoutPanelLeft, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { fetchProjectWorktrees } from '../lib/worktree-api';
import { PopoverPortal } from './PopoverPortal';
import type { GitBranchSummary, GitWorktreeInfo, GitWorktreeList, ProjectSummary, ThreadDetail } from '../types';

type WorkspaceStatusProps = {
  activeProject: ProjectSummary | null;
  activeThread: ThreadDetail | null;
  projects: ProjectSummary[];
  onLoadBranches: (projectId: string) => Promise<GitBranchSummary[]>;
  onSelectBranch: (projectId: string, branchName: string) => Promise<void>;
  onOpenWorktreePath: (worktreePath: string) => Promise<void>;
  onCreateWorktree: (project: ProjectSummary) => void;
};

type ActiveRunPayload =
  | {
      active: false;
    }
  | {
      active: true;
      runId: string;
      threadId: string;
      turnId?: string;
      prompt: string;
      workingDirectory: string;
      sessionId?: string;
      permissionMode: string;
      model?: string;
      startedAtMs: number;
      lastActivityAtMs?: number;
      lastStdoutAtMs?: number;
      lastStderrAtMs?: number;
      lastOutputAtMs?: number;
      lastEventType?: string;
      lastTraceName?: string;
      lastToolName?: string;
      toolCallCount?: number;
      currentPhase?: string;
      currentActivity?: string;
      eventCount: number;
      finished: boolean;
    };

export function WorkspaceStatus({
  activeProject,
  activeThread,
  projects,
  onLoadBranches,
  onSelectBranch,
  onOpenWorktreePath,
  onCreateWorktree,
}: WorkspaceStatusProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [worktreeMenuOpen, setWorktreeMenuOpen] = useState(false);
  const [runStatusOpen, setRunStatusOpen] = useState(false);
  const [runStatus, setRunStatus] = useState<ActiveRunPayload | null>(null);
  const [runStatusLoading, setRunStatusLoading] = useState(false);
  const [runStatusError, setRunStatusError] = useState<string | null>(null);
  const [branches, setBranches] = useState<GitBranchSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);
  const [worktrees, setWorktrees] = useState<GitWorktreeList | null>(null);
  const [worktreesLoading, setWorktreesLoading] = useState(false);
  const [worktreesError, setWorktreesError] = useState<string | null>(null);
  const [switchingWorktreePath, setSwitchingWorktreePath] = useState<string | null>(null);
  const branchMenuRef = useRef<HTMLDivElement | null>(null);
  const worktreeMenuRef = useRef<HTMLDivElement | null>(null);
  const runStatusRef = useRef<HTMLDivElement | null>(null);

  useOutsideDismiss({
    selectors: [
      { selector: '.status-branch-menu', onDismiss: () => setMenuOpen(false), anchorRefs: [branchMenuRef] },
      { selector: '.status-worktree-menu', onDismiss: () => setWorktreeMenuOpen(false), anchorRefs: [worktreeMenuRef] },
      { selector: '.status-run-menu', onDismiss: () => setRunStatusOpen(false), anchorRefs: [runStatusRef] },
    ],
  });

  useEffect(() => {
    setMenuOpen(false);
    setBranches([]);
    setLoading(false);
    setLoadError(null);
    setSwitchingBranch(null);
    setWorktreeMenuOpen(false);
    setWorktrees(null);
    setWorktreesError(null);
    setWorktreesLoading(false);
    setSwitchingWorktreePath(null);
  }, [activeProject?.id]);

  useEffect(() => {
    setRunStatusOpen(false);
    setRunStatus(null);
    setRunStatusError(null);
    setRunStatusLoading(false);
  }, [activeThread?.id]);

  const canSelectBranch = Boolean(activeProject?.isGitRepo && activeProject?.id);
  const canSelectWorktree = Boolean(activeProject?.isGitRepo && activeProject?.id);

  async function ensureBranchesLoaded(force = false) {
    if (!activeProject?.id || !canSelectBranch) {
      return;
    }

    if (loading || (branches.length > 0 && !force)) {
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      setBranches(await onLoadBranches(activeProject.id));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '读取分支失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleBranchTriggerClick() {
    if (!canSelectBranch) {
      return;
    }

    const nextOpen = !menuOpen;
    setMenuOpen(nextOpen);
    if (nextOpen) {
      await ensureBranchesLoaded();
    }
  }

  async function handleBranchSelect(branchName: string) {
    if (!activeProject?.id) {
      return;
    }

    if (branchName === activeProject.gitBranch) {
      setMenuOpen(false);
      return;
    }

    setSwitchingBranch(branchName);
    setLoadError(null);
    try {
      await onSelectBranch(activeProject.id, branchName);
      setBranches(await onLoadBranches(activeProject.id));
      setMenuOpen(false);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '切换分支失败');
    } finally {
      setSwitchingBranch(null);
    }
  }

  async function ensureWorktreesLoaded(force = false) {
    if (!activeProject?.id || !canSelectWorktree) {
      return;
    }

    if (worktreesLoading || (worktrees && !force)) {
      return;
    }

    setWorktreesLoading(true);
    setWorktreesError(null);
    try {
      setWorktrees(await fetchProjectWorktrees(activeProject.id));
    } catch (error) {
      setWorktreesError(error instanceof Error ? error.message : '读取工作树失败');
    } finally {
      setWorktreesLoading(false);
    }
  }

  async function handleWorktreeTriggerClick() {
    if (!canSelectWorktree) {
      return;
    }

    const nextOpen = !worktreeMenuOpen;
    setWorktreeMenuOpen(nextOpen);
    if (nextOpen) {
      await ensureWorktreesLoaded();
    }
  }

  async function handleWorktreeSelect(worktree: GitWorktreeInfo) {
    if (!activeProject) {
      return;
    }

    if (samePath(worktree.path, activeProject.path)) {
      setWorktreeMenuOpen(false);
      return;
    }

    setSwitchingWorktreePath(worktree.path);
    try {
      await onOpenWorktreePath(worktree.path);
      setWorktreeMenuOpen(false);
    } catch (error) {
      setWorktreesError(error instanceof Error ? error.message : '切换工作树失败');
    } finally {
      setSwitchingWorktreePath(null);
    }
  }

  function handleCreateWorktreeClick() {
    if (!activeProject || !canSelectWorktree) {
      return;
    }

    setWorktreeMenuOpen(false);
    onCreateWorktree(activeProject);
  }

  async function loadRunStatus() {
    if (!activeThread?.id) {
      setRunStatus({ active: false });
      return;
    }

    setRunStatusLoading(true);
    setRunStatusError(null);
    try {
      const response = await fetch(`/api/claude/runs/active/${encodeURIComponent(activeThread.id)}`);
      if (response.status === 404) {
        setRunStatus({ active: false });
        return;
      }

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || '读取运行状态失败');
      }

      setRunStatus((await response.json()) as ActiveRunPayload);
    } catch (error) {
      setRunStatusError(error instanceof Error ? error.message : '读取运行状态失败');
    } finally {
      setRunStatusLoading(false);
    }
  }

  function handleRunStatusTriggerClick() {
    const nextOpen = !runStatusOpen;
    setRunStatusOpen(nextOpen);
    if (nextOpen) {
      void loadRunStatus();
    }
  }

  return (
    <footer className="workspace-status">
      <div className="status-workspace-picker" ref={worktreeMenuRef}>
        <PopoverPortal open={worktreeMenuOpen} anchorRef={worktreeMenuRef} placement="top-start">
          <div className="status-branch-menu status-worktree-menu" role="menu" aria-label="Git 工作树">
            <div className="status-branch-menu-title">切换工作树</div>
            {worktreesLoading ? <div className="status-branch-menu-state">正在读取工作树...</div> : null}
            {!worktreesLoading && worktreesError ? <div className="status-branch-menu-error">{worktreesError}</div> : null}
            {!worktreesLoading && !worktreesError && (worktrees?.worktrees.length ?? 0) <= 1 ? (
              <div className="status-branch-menu-state">当前只有主工作区，可以新建工作树。</div>
            ) : null}
            {!worktreesLoading && !worktreesError
              ? (worktrees?.worktrees ?? []).map((worktree, index) => {
                  const isCurrent = activeProject ? samePath(worktree.path, activeProject.path) : false;
                  const isMain = worktree.main || index === 0;
                  const isSwitching = switchingWorktreePath === worktree.path;
                  const project = projects.find((item) => samePath(item.path, worktree.path));
                  return (
                    <button
                      key={worktree.path}
                      type="button"
                      className={`status-branch-menu-item${isCurrent ? ' current' : ''}`}
                      role="menuitemradio"
                      aria-checked={isCurrent}
                      disabled={Boolean(switchingWorktreePath) || !worktree.exists}
                      onClick={() => void handleWorktreeSelect(worktree)}
                    >
                      <span>{worktreeMenuLabel(worktree, isMain)}</span>
                      {isCurrent ? (
                        <Check className="status-branch-check" size={14} />
                      ) : isSwitching ? (
                        <span className="status-branch-menu-meta">切换中...</span>
                      ) : project ? (
                        <span className="status-branch-menu-meta">已加入</span>
                      ) : null}
                    </button>
                  );
                })
              : null}
            {!worktreesLoading && worktreesError ? (
              <button type="button" className="status-branch-menu-item" onClick={() => void ensureWorktreesLoaded(true)}>
                <span>重新加载</span>
              </button>
            ) : null}
            <div className="status-menu-divider" />
            <button
              type="button"
              className="status-branch-menu-item status-worktree-create-item"
              role="menuitem"
              disabled={!canSelectWorktree}
              onClick={handleCreateWorktreeClick}
            >
              <span>新建工作树</span>
              <GitBranchPlus size={14} />
            </button>
          </div>
        </PopoverPortal>

        <button
          type="button"
          className="status-item status-workspace status-branch-trigger"
          title={activeWorktreeLabel(activeProject, worktrees)}
          aria-expanded={worktreeMenuOpen}
          disabled={!canSelectWorktree}
          onClick={() => void handleWorktreeTriggerClick()}
        >
          <LayoutPanelLeft size={12} />
          <span>本地工作</span>
          {canSelectWorktree ? <span className="footer-chevron" aria-hidden="true" /> : null}
        </button>
      </div>
      <div className="status-branch-picker" ref={branchMenuRef}>
        <PopoverPortal open={menuOpen} anchorRef={branchMenuRef} placement="top-start">
          <div className="status-branch-menu" role="menu" aria-label="Git 分支">
            <div className="status-branch-menu-title">切换分支</div>
            {loading ? <div className="status-branch-menu-state">正在读取分支...</div> : null}
            {!loading && loadError ? <div className="status-branch-menu-error">{loadError}</div> : null}
            {!loading && !loadError && branches.length === 0 ? (
              <div className="status-branch-menu-state">当前项目没有可切换的本地分支。</div>
            ) : null}
            {!loading && !loadError
              ? branches.map((branch) => {
                  const isCurrent = branch.current;
                  const isSwitching = switchingBranch === branch.name;
                  return (
                    <button
                      key={branch.name}
                      type="button"
                      className={`status-branch-menu-item${isCurrent ? ' current' : ''}`}
                      role="menuitemradio"
                      aria-checked={isCurrent}
                      disabled={Boolean(switchingBranch)}
                      onClick={() => void handleBranchSelect(branch.name)}
                    >
                      <span>{branch.name}</span>
                      {isCurrent ? (
                        <Check className="status-branch-check" size={14} />
                      ) : isSwitching ? (
                        <span className="status-branch-menu-meta">切换中...</span>
                      ) : null}
                    </button>
                  );
                })
              : null}
            {!loading && loadError ? (
              <button
                type="button"
                className="status-branch-menu-item"
                onClick={() => void ensureBranchesLoaded(true)}
              >
                <span>重新加载</span>
              </button>
            ) : null}
          </div>
        </PopoverPortal>

        <button
          type="button"
          className="status-item status-branch status-branch-trigger"
          aria-expanded={menuOpen}
          disabled={!canSelectBranch}
          onClick={() => void handleBranchTriggerClick()}
        >
          <GitFork size={12} />
          <span>{activeProject?.gitBranch ?? '未检测到 Git'}</span>
          {canSelectBranch ? <span className="footer-chevron" aria-hidden="true" /> : null}
        </button>
      </div>
      <span className="status-spacer" />
      <div className="status-run-picker" ref={runStatusRef}>
        <PopoverPortal open={runStatusOpen} anchorRef={runStatusRef} placement="top-end">
          <div className="status-run-menu" role="dialog" aria-label="Claude 运行状态">
            <div className="status-run-head">
              <div>
                <strong>运行状态接口</strong>
                <span>/api/claude/runs/active/{activeThread?.id ?? ':threadId'}</span>
              </div>
              <button
                type="button"
                className="status-run-refresh"
                title="刷新"
                onClick={() => void loadRunStatus()}
              >
                <RefreshCw size={13} />
              </button>
            </div>
            {runStatusLoading ? <div className="status-run-state">正在读取...</div> : null}
            {!runStatusLoading && runStatusError ? <div className="status-run-error">{runStatusError}</div> : null}
            {!runStatusLoading && !runStatusError ? (
              <pre className="status-run-json">{JSON.stringify(runStatus ?? { active: false }, null, 2)}</pre>
            ) : null}
          </div>
        </PopoverPortal>
        <button
          type="button"
          className="status-item status-run-trigger"
          aria-expanded={runStatusOpen}
          onClick={handleRunStatusTriggerClick}
        >
          <Activity size={12} />
          <span>{activeThread?.sessionId ? 'session 已连接' : '新会话'}</span>
          <span className="footer-chevron" aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
}

function activeWorktreeLabel(activeProject: ProjectSummary | null, worktrees: GitWorktreeList | null) {
  if (!activeProject?.isGitRepo) {
    return '无工作树';
  }

  const currentIndex = worktrees?.worktrees.findIndex((worktree) => samePath(worktree.path, activeProject.path)) ?? -1;
  const current = currentIndex >= 0 ? worktrees?.worktrees[currentIndex] : null;
  return current ? worktreeMenuLabel(current, current.main || currentIndex === 0) : '当前工作区';
}

function worktreeMenuLabel(worktree: GitWorktreeInfo, isMain: boolean) {
  if (isMain) {
    return '主工作区';
  }
  return worktreeLabel(worktree);
}

function worktreeLabel(worktree: GitWorktreeInfo) {
  if (worktree.branch) {
    return worktree.branch;
  }
  if (worktree.detached && worktree.head) {
    return `detached ${worktree.head.slice(0, 8)}`;
  }
  return worktree.path.split(/[\\/]/).filter(Boolean).at(-1) ?? '工作树';
}

function samePath(left: string, right: string) {
  return left.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() ===
    right.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
