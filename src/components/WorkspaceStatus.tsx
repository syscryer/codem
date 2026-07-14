import { Activity, Check, GitBranchPlus, GitFork, LayoutPanelLeft, Link2, Plus, RefreshCw, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CLAUDE_CODE_PROVIDER_ID, GROK_BUILD_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID, OPENCODE_PROVIDER_ID } from '../constants';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { normalizeAgentRuntimeStatus } from '../lib/thread-runtime-statuses';
import { fetchProjectWorktrees } from '../lib/worktree-api';
import {
  buildWorkspaceSessionButtonState,
  summarizeWorkspaceSessionUsage,
  type WorkspaceSessionButtonState,
} from '../lib/workspace-session-status';
import { permissionLabel } from '../lib/ui-labels';
import { PopoverPortal } from './PopoverPortal';
import type { AgentRuntimeStatus, GitBranchSummary, GitWorktreeInfo, GitWorktreeList, PermissionMode, ProjectSummary, ThreadDetail, ThreadRuntimeStatus } from '../types';

type WorkspaceStatusProps = {
  activeProject: ProjectSummary | null;
  activeThread: ThreadDetail | null;
  isActiveThreadRunning: boolean;
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
  isActiveThreadRunning,
  projects,
  onLoadBranches,
  onSelectBranch,
  onOpenWorktreePath,
  onCreateWorktree,
}: WorkspaceStatusProps) {
  const usesClaudeRuntime = activeThread?.provider === CLAUDE_CODE_PROVIDER_ID;
  const usesAgentRuntime = activeThread?.provider === GROK_BUILD_PROVIDER_ID ||
    activeThread?.provider === OPENAI_CODEX_PROVIDER_ID ||
    activeThread?.provider === OPENCODE_PROVIDER_ID;
  const usesManagedRuntime = usesClaudeRuntime || usesAgentRuntime;
  const [menuOpen, setMenuOpen] = useState(false);
  const [worktreeMenuOpen, setWorktreeMenuOpen] = useState(false);
  const [runStatusOpen, setRunStatusOpen] = useState(false);
  const [runStatus, setRunStatus] = useState<ActiveRunPayload | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<ThreadRuntimeStatus | null>(null);
  const [runStatusLoading, setRunStatusLoading] = useState(false);
  const [runStatusError, setRunStatusError] = useState<string | null>(null);
  const [debugJsonOpen, setDebugJsonOpen] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [closingRuntime, setClosingRuntime] = useState(false);
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
    setRuntimeStatus(null);
    setRunStatusError(null);
    setRunStatusLoading(false);
    setDebugJsonOpen(false);
    setCopyError(null);
  }, [activeThread?.id]);

  useEffect(() => {
    if (!activeThread?.id || !usesManagedRuntime) {
      setRuntimeStatus(null);
      return;
    }

    const threadId = activeThread.id;
    let cancelled = false;
    async function refreshRuntimeStatus() {
      try {
        const nextRuntimeStatus = await fetchRuntimeStatusForThread(threadId, usesAgentRuntime);
        if (!cancelled) {
          setRuntimeStatus(nextRuntimeStatus);
        }
      } catch {
        if (!cancelled) {
          setRuntimeStatus(null);
        }
      }
    }

    void refreshRuntimeStatus();
    const timer = window.setInterval(() => void refreshRuntimeStatus(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeThread?.id, isActiveThreadRunning, usesAgentRuntime, usesManagedRuntime]);

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
      setRuntimeStatus(null);
      return;
    }

    if (!usesManagedRuntime) {
      setRunStatus({ active: false });
      setRuntimeStatus(null);
      setRunStatusError(null);
      return;
    }

    setRunStatusLoading(true);
    setRunStatusError(null);
    try {
      if (usesClaudeRuntime) {
        const [nextRunStatus, nextRuntimeStatus] = await Promise.all([
          fetchActiveRunStatus(activeThread.id),
          fetchRuntimeStatusForThread(activeThread.id, false),
        ]);
        setRunStatus(nextRunStatus);
        setRuntimeStatus(nextRuntimeStatus);
      } else {
        setRunStatus({ active: false });
        setRuntimeStatus(await fetchRuntimeStatusForThread(activeThread.id, true));
      }
    } catch (error) {
      setRunStatusError(error instanceof Error ? error.message : '读取运行状态失败');
    } finally {
      setRunStatusLoading(false);
    }
  }

  async function handleCopySessionId() {
    const sessionId = activeThread?.sessionId?.trim();
    if (!sessionId) {
      return;
    }

    setCopyError(null);
    try {
      await navigator.clipboard.writeText(sessionId);
    } catch {
      setCopyError(`复制失败，请手动复制：${sessionId}`);
    }
  }

  async function handleCloseRuntime() {
    if (!usesManagedRuntime || !activeThread?.id || !runtimeStatus?.alive || sessionActiveRun) {
      return;
    }

    setClosingRuntime(true);
    setRunStatusError(null);
    try {
      const response = usesAgentRuntime
        ? await fetch(`/api/agents/runtime/${encodeURIComponent(activeThread.id)}`, { method: 'DELETE' })
        : await fetch(`/api/claude/runtime/${encodeURIComponent(activeThread.id)}/close`, { method: 'POST' });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || '重置热连接失败');
      }

      setRuntimeStatus(await fetchRuntimeStatusForThread(activeThread.id, usesAgentRuntime));
    } catch (error) {
      setRunStatusError(error instanceof Error ? error.message : '重置热连接失败');
    } finally {
      setClosingRuntime(false);
    }
  }

  function handleRunStatusTriggerClick() {
    const nextOpen = !runStatusOpen;
    setRunStatusOpen(nextOpen);
    if (nextOpen) {
      void loadRunStatus();
    }
  }

  const sessionActiveRun = isActiveThreadRunning || Boolean(runtimeStatus?.activeRun) || runStatus?.active === true;
  const sessionRuntimeAlive = Boolean(runtimeStatus?.alive);
  const sessionButtonState = buildWorkspaceSessionButtonState({
    sessionId: activeThread?.sessionId,
    runtimeAlive: sessionRuntimeAlive,
    activeRun: sessionActiveRun,
  });
  const sessionUsage = summarizeWorkspaceSessionUsage(activeThread?.turns ?? []);
  const sessionTokenUsageLabel = formatTokenUsagePair(
    sessionUsage.inputTokenLabel,
    sessionUsage.outputTokenLabel,
  );
  const sessionCacheUsageLabel = formatCacheUsagePair(
    sessionUsage.cacheCreationTokenLabel,
    sessionUsage.cacheReadTokenLabel,
  );
  const sessionDescription = workspaceSessionDescription(sessionButtonState, activeThread?.provider);
  const sessionDebugPayload = {
    provider: activeThread?.provider ?? 'claude-code',
    state: sessionButtonState,
    activeRun: runStatus ?? { active: false },
    runtime: runtimeStatus ?? { threadId: activeThread?.id ?? '', alive: false, activeRun: false },
  };

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
          <span>工作区</span>
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
          <div className="status-run-menu" role="dialog" aria-label={`${providerDisplayName(activeThread?.provider)} 运行状态`}>
            <div className={`status-run-head is-${sessionButtonState.id}`}>
              <span className="status-session-icon" aria-hidden="true">
                <WorkspaceSessionStateIcon state={sessionButtonState} />
              </span>
              <div className="status-run-head-text">
                <strong>{providerDisplayName(activeThread?.provider)} 会话</strong>
                <span>{sessionButtonState.label} · {sessionDescription}</span>
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
            {!runStatusLoading ? (
              <div className="status-run-content">
                {runStatus?.active ? (
                  <section className="status-run-section">
                    <h4>当前运行</h4>
                    <StatusRunRow label="Run" value={compactIdentifier(runStatus.runId)} title={runStatus.runId} />
                    <StatusRunRow label="阶段" value={formatRunPhase(runStatus.currentPhase)} />
                    <StatusRunRow label="活动" value={runStatus.currentActivity || runStatus.lastToolName || '-'} />
                    <StatusRunRow label="事件" value={String(runStatus.eventCount)} />
                  </section>
                ) : runtimeStatus?.activeRun ? (
                  <section className="status-run-section">
                    <h4>当前运行</h4>
                    <StatusRunRow
                      label="Run"
                      value={compactIdentifier(runtimeStatus.currentRunId ?? '-')}
                      title={runtimeStatus.currentRunId}
                    />
                    <StatusRunRow label="阶段" value={formatAgentRuntimePhase(runtimeStatus.phase)} />
                    <StatusRunRow label="Provider" value={providerDisplayName(runtimeStatus.providerId)} />
                  </section>
                ) : null}

                <section className="status-run-section">
                  <h4>当前会话</h4>
                  <StatusRunRow label="Provider" value={providerDisplayName(activeThread?.provider)} />
                  <StatusRunRow label="回合" value={sessionUsage.turnCountLabel} />
                  <StatusRunRow label="耗时" value={sessionUsage.durationLabel} />
                  <StatusRunRow label="输入/输出" value={sessionTokenUsageLabel} />
                  {sessionCacheUsageLabel ? <StatusRunRow label="缓存" value={sessionCacheUsageLabel} /> : null}
                  <StatusRunRow label="Cost" value={sessionUsage.costLabel} />
                </section>

                {activeThread?.sessionId ? (
                  <section className="status-run-section">
                    <h4>Session</h4>
                    <StatusRunRow
                      label="Session"
                      value={activeThread.sessionId}
                      title={activeThread.sessionId}
                    />
                    <StatusRunRow label="工作目录" value={activeThread.workingDirectory || activeProject?.path || '-'} />
                  </section>
                ) : (
                  <section className="status-run-section">
                    <h4>工作目录</h4>
                    <p className="status-run-path">{activeProject?.path || activeThread?.workingDirectory || '-'}</p>
                  </section>
                )}

                <section className="status-run-section">
                  <h4>连接</h4>
                  <StatusRunRow label="后台运行" value={sessionActiveRun ? '是' : '无'} />
                  {usesManagedRuntime ? (
                    <>
                      <StatusRunRow label="热连接" value={formatHotRuntimeState(sessionActiveRun, sessionRuntimeAlive)} />
                      {usesClaudeRuntime ? (
                        <StatusRunRow label="PID" value={runtimeStatus?.pid ? String(runtimeStatus.pid) : '-'} />
                      ) : (
                        <StatusRunRow label="运行协议" value={agentRuntimeProtocol(activeThread?.provider)} />
                      )}
                    </>
                  ) : (
                    <StatusRunRow label="运行协议" value="按需启动" />
                  )}
                </section>

                {usesManagedRuntime && sessionButtonState.id === 'hot' ? (
                  <section className="status-run-section">
                    <h4>会话配置</h4>
                    <StatusRunRow label="模型" value={runtimeModelLabel(runtimeStatus, activeThread)} />
                    <StatusRunRow label="权限" value={runtimePermissionLabel(runtimeStatus, activeThread)} />
                  </section>
                ) : null}

                {copyError ? <div className="status-run-error inline">{copyError}</div> : null}

                <div className="status-run-actions">
                  {activeThread?.sessionId ? (
                    <button type="button" onClick={() => void handleCopySessionId()}>
                      复制 session
                    </button>
                  ) : null}
                  {usesManagedRuntime && sessionRuntimeAlive && !sessionActiveRun ? (
                    <button type="button" disabled={closingRuntime} onClick={() => void handleCloseRuntime()}>
                      {closingRuntime ? '重置中...' : '重置热连接'}
                    </button>
                  ) : null}
                  <button type="button" onClick={() => setDebugJsonOpen((value) => !value)}>
                    调试 JSON
                  </button>
                </div>

                {debugJsonOpen ? (
                  <pre className="status-run-json">{JSON.stringify(sessionDebugPayload, null, 2)}</pre>
                ) : null}
              </div>
            ) : null}
          </div>
        </PopoverPortal>
        <button
          type="button"
          className={`status-item status-run-trigger is-${sessionButtonState.id}`}
          aria-expanded={runStatusOpen}
          onClick={handleRunStatusTriggerClick}
        >
          <WorkspaceSessionStateIcon state={sessionButtonState} />
          <span>{sessionButtonState.label}</span>
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

function WorkspaceSessionStateIcon({ state }: { state: WorkspaceSessionButtonState }) {
  if (state.id === 'new') {
    return <Plus size={12} />;
  }
  if (state.id === 'hot') {
    return <Zap size={12} />;
  }
  if (state.id === 'running') {
    return <Activity size={12} />;
  }

  return <Link2 size={12} />;
}

function formatTokenUsagePair(inputLabel: string, outputLabel: string) {
  return `${inputLabel} / ${outputLabel}`;
}

function formatCacheUsagePair(writeLabel: string, readLabel: string) {
  if (writeLabel === '-' && readLabel === '-') {
    return '';
  }

  if (writeLabel === '-') {
    return `读取 ${readLabel}`;
  }

  if (readLabel === '-') {
    return `写入 ${writeLabel}`;
  }

  return `写入 ${writeLabel} / 读取 ${readLabel}`;
}

function StatusRunRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="status-run-row">
      <span>{label}</span>
      <strong title={title ?? value}>{value}</strong>
    </div>
  );
}

function workspaceSessionDescription(state: WorkspaceSessionButtonState, provider?: string) {
  if (provider && provider !== CLAUDE_CODE_PROVIDER_ID) {
    const providerName = providerDisplayName(provider);
    if (state.id === 'new') {
      return '首次发送消息后会创建 Provider session。';
    }
    if (state.id === 'hot') {
      return `${providerName} 进程仍在后台保留，下次发送会直接复用。`;
    }
    if (state.id === 'running') {
      return `${providerName} 正在处理当前任务。`;
    }
    return `已绑定 ${providerName} session，下次发送会恢复上下文。`;
  }
  if (state.id === 'new') {
    return '首次发送消息后会创建 Claude session。';
  }
  if (state.id === 'hot') {
    return 'Claude 进程仍在后台保留，下次发送会直接复用。';
  }
  if (state.id === 'running') {
    return 'Claude 正在处理当前任务。';
  }

  return '已绑定 Claude session，下次发送会恢复上下文。';
}

function providerDisplayName(provider?: string) {
  if (!provider || provider === CLAUDE_CODE_PROVIDER_ID) {
    return 'Claude Code';
  }
  if (provider === GROK_BUILD_PROVIDER_ID) {
    return 'Grok Build';
  }
  if (provider === OPENAI_CODEX_PROVIDER_ID) {
    return 'OpenAI Codex';
  }
  if (provider === OPENCODE_PROVIDER_ID) {
    return 'OpenCode';
  }
  return provider;
}

function agentRuntimeProtocol(provider?: string) {
  if (provider === OPENAI_CODEX_PROVIDER_ID) {
    return 'Codex app-server';
  }
  return provider === OPENCODE_PROVIDER_ID ? 'OpenCode ACP' : 'ACP';
}

function compactIdentifier(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '-';
  }
  if (trimmed.length <= 18) {
    return trimmed;
  }
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-6)}`;
}

function formatRunPhase(phase?: string) {
  if (phase === 'requesting') {
    return '请求中';
  }
  if (phase === 'thinking') {
    return '思考中';
  }
  if (phase === 'computing') {
    return '生成中';
  }
  if (phase === 'tool') {
    return '工具调用';
  }

  return '-';
}

function formatAgentRuntimePhase(phase?: ThreadRuntimeStatus['phase']) {
  if (phase === 'starting') {
    return '连接中';
  }
  if (phase === 'running') {
    return '运行中';
  }
  if (phase === 'ready') {
    return '热连接';
  }
  if (phase === 'failed') {
    return '连接失败';
  }
  if (phase === 'closed') {
    return '已关闭';
  }
  return '-';
}

function formatHotRuntimeState(activeRun: boolean, runtimeAlive: boolean) {
  if (activeRun) {
    return '使用中';
  }
  if (runtimeAlive) {
    return '已保留';
  }
  return '未保留';
}

function runtimeModelLabel(_runtimeStatus: ThreadRuntimeStatus | null, activeThread: ThreadDetail | null) {
  return activeThread?.model?.trim() || '-';
}

function runtimePermissionLabel(_runtimeStatus: ThreadRuntimeStatus | null, activeThread: ThreadDetail | null) {
  const mode = activeThread?.permissionMode?.trim();
  if (!mode) {
    return '-';
  }
  return isPermissionMode(mode) ? permissionLabel(mode) : mode;
}

function isPermissionMode(value: string): value is PermissionMode {
  return value === 'default' ||
    value === 'plan' ||
    value === 'acceptEdits' ||
    value === 'auto' ||
    value === 'dontAsk' ||
    value === 'bypassPermissions';
}

async function fetchActiveRunStatus(threadId: string): Promise<ActiveRunPayload> {
  const response = await fetch(`/api/claude/runs/active/${encodeURIComponent(threadId)}`);
  if (response.status === 404) {
    return { active: false };
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || '读取运行状态失败');
  }

  return (await response.json()) as ActiveRunPayload;
}

async function fetchRuntimeStatusForThread(threadId: string, usesAgentRuntime: boolean) {
  if (usesAgentRuntime) {
    const response = await fetch(`/api/agents/runtime/${encodeURIComponent(threadId)}`);
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || '读取 Agent 热连接状态失败');
    }
    return normalizeAgentRuntimeStatus((await response.json()) as AgentRuntimeStatus);
  }

  const response = await fetch('/api/claude/runtimes');
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || '读取热连接状态失败');
  }

  const statuses = (await response.json()) as Record<string, ThreadRuntimeStatus>;
  return statuses[threadId] ?? null;
}
