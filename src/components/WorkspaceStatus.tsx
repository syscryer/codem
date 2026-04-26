import { Check, GitFork, LayoutPanelLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import type { GitBranchSummary, ProjectSummary, ThreadDetail } from '../types';

type WorkspaceStatusProps = {
  activeProject: ProjectSummary | null;
  activeThread: ThreadDetail | null;
  onLoadBranches: (projectId: string) => Promise<GitBranchSummary[]>;
  onSelectBranch: (projectId: string, branchName: string) => Promise<void>;
};

export function WorkspaceStatus({
  activeProject,
  activeThread,
  onLoadBranches,
  onSelectBranch,
}: WorkspaceStatusProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranchSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);
  const branchMenuRef = useRef<HTMLDivElement | null>(null);

  useOutsideDismiss({
    refs: [{ ref: branchMenuRef, onDismiss: () => setMenuOpen(false) }],
  });

  useEffect(() => {
    setMenuOpen(false);
    setBranches([]);
    setLoading(false);
    setLoadError(null);
    setSwitchingBranch(null);
  }, [activeProject?.id]);

  const canSelectBranch = Boolean(activeProject?.isGitRepo && activeProject?.id);

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

  return (
    <footer className="workspace-status">
      <span className="status-item status-workspace">
        <LayoutPanelLeft size={12} />
        <span>本地工作</span>
      </span>
      <div className="status-branch-picker" ref={branchMenuRef}>
        {menuOpen ? (
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
        ) : null}

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
      <span>{activeThread?.sessionId ? 'session 已连接' : '新会话'}</span>
    </footer>
  );
}
