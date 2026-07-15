import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  AlignJustify,
  Blocks,
  Check,
  Clock3,
  Copy,
  Download,
  LoaderCircle,
  MessageSquareText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranchPlus,
  GitFork,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  X,
  SquarePen,
  SquareSplitHorizontal,
  Zap,
} from 'lucide-react';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { PopoverPortal } from './PopoverPortal';
import { resolveSidebarThreadStatus, type SidebarThreadStatusKind } from '../lib/sidebar-thread-status';
import type { ThreadActivityNoticeMap } from '../lib/thread-activity-notices';
import type { AiChatSummary, CloneTask, PanelState, ProjectSummary, ThreadRuntimeStatus, ThreadSummary } from '../types';

const VISIBLE_THREAD_PREVIEW_LIMIT = 5;

type SidebarProjectsProps = {
  activeProjectId: string | null;
  activeThreadId: string | null;
  activeOrdinaryChatId: string | null;
  ordinaryChatIsDraft: boolean;
  ordinaryChats: AiChatSummary[];
  runningOrdinaryChatIds: string[];
  runningThreadIds: string[];
  threadActivityNotices: ThreadActivityNoticeMap;
  threadRuntimeStatuses: Record<string, ThreadRuntimeStatus>;
  cloneTasks: CloneTask[];
  collapsedProjects: Record<string, boolean>;
  panelState: PanelState;
  onCreatePrimaryChat: () => void;
  onCreateOrdinaryChat: () => void;
  onSelectOrdinaryChat: (chatId: string) => void | Promise<void>;
  onTogglePinOrdinaryChat: (chatId: string, pinned: boolean) => void | Promise<void>;
  onRenameOrdinaryChat: (chat: AiChatSummary) => void;
  onDeleteOrdinaryChat: (chat: AiChatSummary) => void;
  onToggleSearch: () => void;
  onToggleAllProjects: () => void;
  onRefreshProjects: () => void | Promise<void>;
  refreshingProjects: boolean;
  onOpenPlugins: () => void;
  onPanelStateChange: (nextState: Partial<PanelState>) => void | Promise<void>;
  onPickProjectDirectory: () => void | Promise<void>;
  onOpenCloneDialog: () => void;
  onRetryCloneTask: (taskId: string) => void;
  onRemoveCloneTask: (taskId: string) => void;
  onCreateThread: (projectId: string) => void | Promise<unknown>;
  onOpenProject: (project: ProjectSummary) => void | Promise<void>;
  onCopyProjectPath: (project: ProjectSummary) => void | Promise<void>;
  onGitFetch: (project: ProjectSummary) => void | Promise<void>;
  onGitPull: (project: ProjectSummary) => void | Promise<void>;
  onCreateWorktree: (project: ProjectSummary) => void;
  onOpenRenameProjectDialog: (project: ProjectSummary) => void;
  onOpenRemoveProjectDialog: (project: ProjectSummary) => void;
  onToggleProjectCollapse: (projectId: string) => void;
  onSelectThread: (projectId: string, threadId: string) => void | Promise<void>;
  onOpenRenameThreadDialog: (thread: ThreadSummary) => void;
  onCopySessionId: (thread: ThreadSummary) => void | Promise<void>;
  onOpenRemoveThreadDialog: (thread: ThreadSummary) => void;
  onOpenSettings: () => void;
  pinnedThreads: ThreadSummary[];
  pinnedProjects: ProjectSummary[];
  unpinnedProjects: ProjectSummary[];
  onTogglePinThread: (threadId: string, pinned: boolean) => void | Promise<void>;
  onTogglePinProject: (projectId: string, pinned: boolean) => void | Promise<void>;
  sidebarCustomWidth?: number;
  onUpdateSidebarCustomWidth?: (width: number | undefined) => void;
};

export function SidebarProjects({
  activeProjectId,
  activeThreadId,
  activeOrdinaryChatId,
  ordinaryChatIsDraft,
  ordinaryChats,
  runningOrdinaryChatIds,
  runningThreadIds,
  threadActivityNotices,
  threadRuntimeStatuses,
  cloneTasks,
  collapsedProjects,
  panelState,
  onCreatePrimaryChat,
  onCreateOrdinaryChat,
  onSelectOrdinaryChat,
  onTogglePinOrdinaryChat,
  onRenameOrdinaryChat,
  onDeleteOrdinaryChat,
  onToggleSearch,
  onToggleAllProjects,
  onRefreshProjects,
  refreshingProjects,
  onOpenPlugins,
  onPanelStateChange,
  onPickProjectDirectory,
  onOpenCloneDialog,
  onRetryCloneTask,
  onRemoveCloneTask,
  onCreateThread,
  onOpenProject,
  onCopyProjectPath,
  onGitFetch,
  onGitPull,
  onCreateWorktree,
  onOpenRenameProjectDialog,
  onOpenRemoveProjectDialog,
  onToggleProjectCollapse,
  onSelectThread,
  onOpenRenameThreadDialog,
  onCopySessionId,
  onOpenRemoveThreadDialog,
  onOpenSettings,
  pinnedThreads,
  pinnedProjects,
  unpinnedProjects,
  onTogglePinThread,
  onTogglePinProject,
  sidebarCustomWidth,
  onUpdateSidebarCustomWidth,
}: SidebarProjectsProps) {
  const [panelMenuOpen, setPanelMenuOpen] = useState(false);
  const [addProjectMenuOpen, setAddProjectMenuOpen] = useState(false);
  const [expandedCloneLogs, setExpandedCloneLogs] = useState<Record<string, boolean>>({});
  const [projectMenuProjectId, setProjectMenuProjectId] = useState<string | null>(null);
  const [projectMenuAnchor, setProjectMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [threadMenuThreadId, setThreadMenuThreadId] = useState<string | null>(null);
  const [threadMenuAnchor, setThreadMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [ordinaryChatMenuId, setOrdinaryChatMenuId] = useState<string | null>(null);
  const [ordinaryChatMenuAnchor, setOrdinaryChatMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [expandedThreadProjects, setExpandedThreadProjects] = useState<Record<string, boolean>>({});
  const panelMenuRef = useRef<HTMLDivElement | null>(null);
  const addProjectMenuRef = useRef<HTMLDivElement | null>(null);
  const projectMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const threadMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const ordinaryChatMenuTriggerRef = useRef<HTMLButtonElement | null>(null);

  useOutsideDismiss({
    selectors: [
      { selector: '.panel-menu-popover', onDismiss: () => setPanelMenuOpen(false), anchorRefs: [panelMenuRef] },
      { selector: '.add-project-menu-popover', onDismiss: () => setAddProjectMenuOpen(false), anchorRefs: [addProjectMenuRef] },
      { selector: '.project-menu-popover', onDismiss: () => setProjectMenuProjectId(null), anchorRefs: [projectMenuTriggerRef] },
      { selector: '.thread-menu-popover', onDismiss: () => setThreadMenuThreadId(null), anchorRefs: [threadMenuTriggerRef] },
      { selector: '.ordinary-chat-sidebar-menu-popover', onDismiss: () => setOrdinaryChatMenuId(null), anchorRefs: [ordinaryChatMenuTriggerRef] },
    ],
  });
  const runningThreadIdSet = new Set(runningThreadIds);
  const noticedThreadIdSet = new Set(Object.keys(threadActivityNotices));

  function openProjectMenu(projectId: string, anchor?: { x: number; y: number }) {
    setThreadMenuThreadId(null);
    setThreadMenuAnchor(null);
    setOrdinaryChatMenuId(null);
    setOrdinaryChatMenuAnchor(null);
    setProjectMenuAnchor(anchor ?? null);
    setProjectMenuProjectId(projectId);
  }

  function openThreadMenu(threadId: string, anchor?: { x: number; y: number }) {
    setProjectMenuProjectId(null);
    setProjectMenuAnchor(null);
    setOrdinaryChatMenuId(null);
    setOrdinaryChatMenuAnchor(null);
    setThreadMenuAnchor(anchor ?? null);
    setThreadMenuThreadId(threadId);
  }

  function openOrdinaryChatMenu(chatId: string, anchor?: { x: number; y: number }) {
    setProjectMenuProjectId(null);
    setProjectMenuAnchor(null);
    setThreadMenuThreadId(null);
    setThreadMenuAnchor(null);
    setOrdinaryChatMenuAnchor(anchor ?? null);
    setOrdinaryChatMenuId(chatId);
  }

  function toggleCloneLog(taskId: string) {
    setExpandedCloneLogs((current) => ({
      ...current,
      [taskId]: !current[taskId],
    }));
  }

  function handleSidebarResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!onUpdateSidebarCustomWidth) {
      return;
    }
    event.preventDefault();
    const sidebarElement = (event.currentTarget.parentElement as HTMLElement | null) ?? null;
    const startX = event.clientX;
    const startWidth = sidebarElement?.getBoundingClientRect().width
      ?? sidebarCustomWidth
      ?? 300;
    const root = document.querySelector<HTMLElement>('.codex-desktop');

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    let latest = startWidth;

    function clampWidth(width: number) {
      return Math.round(Math.min(480, Math.max(220, width)));
    }

    function handlePointerMove(moveEvent: PointerEvent) {
      const next = clampWidth(startWidth + (moveEvent.clientX - startX));
      latest = next;
      if (root) {
        root.style.setProperty('--sidebar-width', `${next}px`);
      }
    }

    function handlePointerUp() {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      onUpdateSidebarCustomWidth?.(latest);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  function handleSidebarResizeDoubleClick() {
    if (!onUpdateSidebarCustomWidth) {
      return;
    }
    const root = document.querySelector<HTMLElement>('.codex-desktop');
    root?.style.removeProperty('--sidebar-width');
    onUpdateSidebarCustomWidth(undefined);
  }

  function renderThreadRow(thread: ThreadSummary, hostProjectId: string) {
    const threadStatus = resolveSidebarThreadStatus({
      threadId: thread.id,
      runningThreadIds: runningThreadIdSet,
      runtimeStatuses: threadRuntimeStatuses,
      threadActivityNotices,
    });
    const isRunningThread = threadStatus === 'running';
    const isPinned = Boolean(thread.pinnedAt);
    return (
      <div
        key={thread.id}
        className={`sidebar-thread-row ${thread.id === activeThreadId ? 'active' : ''}${isRunningThread ? ' running' : ''}${isPinned ? ' pinned' : ''}`}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openThreadMenu(thread.id, { x: event.clientX, y: event.clientY });
        }}
      >
        <button type="button" className="sidebar-thread" onClick={() => void onSelectThread(hostProjectId, thread.id)}>
          <span className="sidebar-thread-title">
            <span className="sidebar-thread-title-text">{thread.title}</span>
          </span>
          <span className="sidebar-thread-meta">
            <SidebarThreadStatusIcon status={threadStatus} />
            {isRunningThread ? null : <small>{thread.updatedLabel}</small>}
          </span>
        </button>
        <PopoverPortal
          open={threadMenuThreadId === thread.id}
          anchorRef={threadMenuTriggerRef}
          virtualAnchor={threadMenuThreadId === thread.id ? threadMenuAnchor : null}
          placement="bottom-end"
        >
          <div className="workspace-menu thread-menu-popover">
            <button type="button" className="workspace-menu-item" onClick={() => { setThreadMenuThreadId(null); void onTogglePinThread(thread.id, !isPinned); }}>
              {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
              <span>{isPinned ? '取消置顶' : '置顶聊天'}</span>
            </button>
            <button type="button" className="workspace-menu-item" onClick={() => { setThreadMenuThreadId(null); onOpenRenameThreadDialog(thread); }}>
              <Pencil size={14} />
              <span>重命名聊天</span>
            </button>
            <button type="button" className="workspace-menu-item" onClick={() => { setThreadMenuThreadId(null); void onCopySessionId(thread); }}>
              <Copy size={14} />
              <span>复制会话 ID</span>
            </button>
            <button type="button" className="workspace-menu-item danger" onClick={() => { setThreadMenuThreadId(null); onOpenRemoveThreadDialog(thread); }}>
              <Trash2 size={14} />
              <span>删除聊天</span>
            </button>
          </div>
        </PopoverPortal>
      </div>
    );
  }

  function renderOrdinaryChatRow(chat: AiChatSummary) {
    const pinned = Boolean(chat.pinnedAt);
    const running = runningOrdinaryChatIds.includes(chat.id);
    return (
      <div
        key={chat.id}
        className={`sidebar-thread-row ordinary-chat-row${chat.id === activeOrdinaryChatId ? ' active' : ''}${running ? ' running' : ''}${pinned ? ' pinned' : ''}`}
        onContextMenu={(event) => {
          event.preventDefault();
          openOrdinaryChatMenu(chat.id, { x: event.clientX, y: event.clientY });
        }}
      >
        <button
          type="button"
          className="sidebar-thread"
          onClick={() => void onSelectOrdinaryChat(chat.id)}
        >
          <span className="sidebar-thread-title">
            <MessageSquareText size={13} aria-hidden="true" />
            <span className="sidebar-thread-title-text">{chat.title}</span>
          </span>
          <span className="sidebar-thread-meta">
            {running ? <SidebarThreadStatusIcon status="running" /> : null}
            {running ? null : <small>{formatOrdinaryChatUpdatedAt(chat.updatedAt)}</small>}
          </span>
        </button>
        <PopoverPortal
          open={ordinaryChatMenuId === chat.id}
          anchorRef={ordinaryChatMenuTriggerRef}
          virtualAnchor={ordinaryChatMenuId === chat.id ? ordinaryChatMenuAnchor : null}
          placement="bottom-end"
        >
          <div className="workspace-menu ordinary-chat-sidebar-menu-popover">
            <button type="button" className="workspace-menu-item" onClick={() => { setOrdinaryChatMenuId(null); void onTogglePinOrdinaryChat(chat.id, !pinned); }}>
              {pinned ? <PinOff size={14} /> : <Pin size={14} />}
              <span>{pinned ? '取消置顶' : '置顶聊天'}</span>
            </button>
            <button type="button" className="workspace-menu-item" onClick={() => { setOrdinaryChatMenuId(null); onRenameOrdinaryChat(chat); }}>
              <Pencil size={14} />
              <span>重命名聊天</span>
            </button>
            <div className="workspace-menu-divider" />
            <button type="button" className="workspace-menu-item danger" disabled={running} onClick={() => { setOrdinaryChatMenuId(null); onDeleteOrdinaryChat(chat); }}>
              <Trash2 size={14} />
              <span>{running ? '生成中不可删除' : '删除聊天'}</span>
            </button>
          </div>
        </PopoverPortal>
      </div>
    );
  }

  function renderProjectCard(project: ProjectSummary) {
    const collapsed = Boolean(collapsedProjects[project.id]);
    const threadExpanded = Boolean(expandedThreadProjects[project.id]);
    const hasMoreThreads = project.threads.length > VISIBLE_THREAD_PREVIEW_LIMIT;
    const previewThreads = project.threads.slice(0, VISIBLE_THREAD_PREVIEW_LIMIT);
    const runningThreads = project.threads.filter((thread) => runningThreadIdSet.has(thread.id));
    const noticedThreads = project.threads.filter((thread) => noticedThreadIdSet.has(thread.id));
    const runtimeThreads = project.threads.filter((thread) => Boolean(threadRuntimeStatuses[thread.id]?.alive));
    const visibleThreads = threadExpanded
      ? project.threads
      : mergeVisibleThreads(previewThreads, runningThreads, runtimeThreads, noticedThreads);
    const isPinnedProject = Boolean(project.pinnedAt);

    return (
      <div
        key={project.id}
        className={`sidebar-project ${project.id === activeProjectId ? 'active' : ''}${isPinnedProject ? ' pinned' : ''}`}
        onContextMenu={(event) => {
          event.preventDefault();
          openProjectMenu(project.id, { x: event.clientX, y: event.clientY });
        }}
      >
        <div className="sidebar-project-row">
          <button
            type="button"
            className={`sidebar-project-title${project.isGitWorktree ? ' has-worktree-badge' : ''}`}
            title={project.path}
            onClick={() => onToggleProjectCollapse(project.id)}
          >
            <span><Folder size={14} /></span>
            <strong>{project.name}</strong>
            {project.isGitWorktree ? (
              <span className="sidebar-worktree-badge" title="Git 工作树">
                <GitFork size={12} />
              </span>
            ) : null}
          </button>
          <div className="sidebar-project-actions">
            <button
              type="button"
              className="sidebar-row-action"
              title="项目菜单"
              ref={projectMenuProjectId === project.id ? projectMenuTriggerRef : undefined}
              onClick={() => {
                setProjectMenuProjectId((value) => {
                  if (value === project.id && !projectMenuAnchor) {
                    return null;
                  }
                  setProjectMenuAnchor(null);
                  return project.id;
                });
              }}
            >
              <MoreHorizontal size={14} />
            </button>
            <button
              type="button"
              className="sidebar-row-action"
              title="新建该项目聊天"
              onClick={() => void onCreateThread(project.id)}
            >
              <SquarePen size={14} />
            </button>
            <PopoverPortal
              open={projectMenuProjectId === project.id}
              anchorRef={projectMenuTriggerRef}
              virtualAnchor={projectMenuProjectId === project.id ? projectMenuAnchor : null}
              placement="bottom-end"
            >
              <div className="workspace-menu project-menu-popover">
                <button type="button" className="workspace-menu-item" onClick={() => { setProjectMenuProjectId(null); void onTogglePinProject(project.id, !isPinnedProject); }}>
                  {isPinnedProject ? <PinOff size={14} /> : <Pin size={14} />}
                  <span>{isPinnedProject ? '取消置顶' : '置顶项目'}</span>
                </button>
                <button type="button" className="workspace-menu-item" onClick={() => { setProjectMenuProjectId(null); void onOpenProject(project); }}>
                  <FolderOpen size={14} />
                  <span>在资源管理器中打开</span>
                </button>
                <button type="button" className="workspace-menu-item" onClick={() => { setProjectMenuProjectId(null); void onCopyProjectPath(project); }}>
                  <Copy size={14} />
                  <span>复制路径</span>
                </button>
                <button
                  type="button"
                  className="workspace-menu-item"
                  disabled={!project.isGitRepo}
                  onClick={() => {
                    setProjectMenuProjectId(null);
                    void onGitFetch(project);
                  }}
                >
                  <RefreshCw size={14} />
                  <span>获取远端</span>
                </button>
                <button
                  type="button"
                  className="workspace-menu-item"
                  disabled={!project.isGitRepo}
                  onClick={() => {
                    setProjectMenuProjectId(null);
                    void onGitPull(project);
                  }}
                >
                  <Download size={14} />
                  <span>拉取</span>
                </button>
                <button
                  type="button"
                  className="workspace-menu-item"
                  disabled={!project.isGitRepo}
                  onClick={() => {
                    setProjectMenuProjectId(null);
                    onCreateWorktree(project);
                  }}
                >
                  <GitBranchPlus size={14} />
                  <span>创建永久工作树</span>
                </button>
                <button type="button" className="workspace-menu-item" onClick={() => { setProjectMenuProjectId(null); onOpenRenameProjectDialog(project); }}>
                  <Pencil size={14} />
                  <span>修改项目名称</span>
                </button>
                <button type="button" className="workspace-menu-item danger" onClick={() => { setProjectMenuProjectId(null); onOpenRemoveProjectDialog(project); }}>
                  <Trash2 size={14} />
                  <span>删除</span>
                </button>
              </div>
            </PopoverPortal>
          </div>
        </div>

        <div className={`sidebar-thread-collapse${collapsed ? ' is-collapsed' : ''}`}>
          <div className="sidebar-thread-collapse-inner">
            <div className="sidebar-thread-list">
              {visibleThreads.length === 0 ? (
                <div className="sidebar-thread-empty">暂无对话</div>
              ) : null}
              {visibleThreads.map((thread) => renderThreadRow(thread, project.id))}
            </div>
            {hasMoreThreads ? (
              <button
                type="button"
                className="sidebar-collapse-toggle"
                onClick={() =>
                  setExpandedThreadProjects((current) => ({
                    ...current,
                    [project.id]: !current[project.id],
                  }))
                }
              >
                {threadExpanded ? '折叠显示' : '展开显示'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const PINNED_THREADS_EXPAND_KEY = '__pinned_threads__';
  const pinnedThreadsExpanded = Boolean(expandedThreadProjects[PINNED_THREADS_EXPAND_KEY]);
  const hasMorePinnedThreads = pinnedThreads.length > VISIBLE_THREAD_PREVIEW_LIMIT;
  const visiblePinnedThreads = pinnedThreadsExpanded
    ? pinnedThreads
    : mergeVisibleThreads(
        pinnedThreads.slice(0, VISIBLE_THREAD_PREVIEW_LIMIT),
        pinnedThreads.filter((thread) => runningThreadIdSet.has(thread.id)),
        pinnedThreads.filter((thread) => Boolean(threadRuntimeStatuses[thread.id]?.alive)),
        pinnedThreads.filter((thread) => noticedThreadIdSet.has(thread.id)),
      );
  const hasAnyPinned = pinnedThreads.length > 0 || pinnedProjects.length > 0;

  return (
    <aside className="app-sidebar">
      <nav className="sidebar-primary">
        <button type="button" onClick={onCreatePrimaryChat}>
          <span><Plus size={14} /></span> 新建任务
        </button>
        <button type="button" onClick={onCreateOrdinaryChat}>
          <span><MessageSquareText size={14} /></span> 新建聊天
        </button>
        <button type="button" onClick={onToggleSearch}>
          <span><Search size={14} /></span> 搜索
          <kbd>Ctrl+G</kbd>
        </button>
        <button type="button" onClick={onOpenPlugins}><span><Blocks size={14} /></span> 插件</button>
        <button type="button"><span><Clock3 size={14} /></span> 自动化</button>
      </nav>

      <div className="sidebar-scroll-region">
        <section className="sidebar-ordinary-chats">
          <div className="sidebar-section-head sidebar-section-toolbar">
            <span>聊天</span>
            <div className="sidebar-section-actions">
              <button type="button" className="sidebar-toolbar-icon" title="新建聊天" onClick={onCreateOrdinaryChat}>
                <SquarePen size={14} />
              </button>
            </div>
          </div>
          <div className="sidebar-thread-list ordinary-chat-list">
            {ordinaryChatIsDraft ? (
              <div className="sidebar-thread-row ordinary-chat-row active draft">
                <button type="button" className="sidebar-thread" onClick={onCreateOrdinaryChat}>
                  <span className="sidebar-thread-title">
                    <MessageSquareText size={13} aria-hidden="true" />
                    <span className="sidebar-thread-title-text">新建聊天</span>
                  </span>
                  <span className="sidebar-thread-meta"><small>草稿</small></span>
                </button>
              </div>
            ) : null}
            {ordinaryChats.map(renderOrdinaryChatRow)}
            {ordinaryChats.length === 0 && !ordinaryChatIsDraft ? (
              <div className="sidebar-thread-empty">暂无普通聊天</div>
            ) : null}
          </div>
        </section>

        {hasAnyPinned ? (
          <section className="sidebar-pinned">
            <div className="sidebar-section-head">
              <span>置顶</span>
            </div>
            {visiblePinnedThreads.length > 0 ? (
              <div className="sidebar-pinned-threads">
                <div className="sidebar-thread-list">
                  {visiblePinnedThreads.map((thread) => renderThreadRow(thread, thread.projectId))}
                </div>
                {hasMorePinnedThreads ? (
                  <button
                    type="button"
                    className="sidebar-collapse-toggle"
                    onClick={() =>
                      setExpandedThreadProjects((current) => ({
                        ...current,
                        [PINNED_THREADS_EXPAND_KEY]: !current[PINNED_THREADS_EXPAND_KEY],
                      }))
                    }
                  >
                    {pinnedThreadsExpanded ? '折叠显示' : '展开显示'}
                  </button>
                ) : null}
              </div>
            ) : null}
            {pinnedProjects.map((project) => renderProjectCard(project))}
          </section>
        ) : null}

        <section className="sidebar-projects">
          <div className="sidebar-section-head sidebar-section-toolbar">
            <span>项目</span>
            <div className="sidebar-section-actions">
              <button type="button" className="sidebar-toolbar-icon" title="展开或折叠项目" onClick={onToggleAllProjects}>
                <SquareSplitHorizontal size={13} />
              </button>
              <button
                type="button"
                className="sidebar-toolbar-icon"
                title="刷新项目"
                disabled={refreshingProjects}
                onClick={() => void onRefreshProjects()}
              >
                <RefreshCw size={13} className={refreshingProjects ? 'spin' : undefined} />
              </button>
              <div className="panel-menu-anchor" ref={panelMenuRef}>
                  <button
                    type="button"
                    className="sidebar-toolbar-icon"
                    title="整理和排序"
                    onClick={() => setPanelMenuOpen((value) => !value)}
                  >
                  <AlignJustify size={13} />
                </button>
                <PopoverPortal open={panelMenuOpen} anchorRef={panelMenuRef} placement="bottom-end">
                  <div className="workspace-menu panel-menu-popover">
                    <div className="workspace-menu-group-title">整理</div>
                    <button type="button" className="workspace-menu-item" onClick={() => { setPanelMenuOpen(false); void onPanelStateChange({ organizeBy: 'project' }); }}>
                      <span>按项目</span>
                      {panelState.organizeBy === 'project' ? <Check size={14} /> : null}
                    </button>
                    <button type="button" className="workspace-menu-item" onClick={() => { setPanelMenuOpen(false); void onPanelStateChange({ organizeBy: 'timeline' }); }}>
                      <span>时间顺序列表</span>
                      {panelState.organizeBy === 'timeline' ? <Check size={14} /> : null}
                    </button>
                    <button type="button" className="workspace-menu-item" onClick={() => { setPanelMenuOpen(false); void onPanelStateChange({ organizeBy: 'chat-first' }); }}>
                      <span>聊天优先</span>
                      {panelState.organizeBy === 'chat-first' ? <Check size={14} /> : null}
                    </button>
                    <div className="workspace-menu-divider" />
                    <div className="workspace-menu-group-title">排序条件</div>
                    <button type="button" className="workspace-menu-item" onClick={() => { setPanelMenuOpen(false); void onPanelStateChange({ sortBy: 'created' }); }}>
                      <span>已创建</span>
                      {panelState.sortBy === 'created' ? <Check size={14} /> : null}
                    </button>
                    <button type="button" className="workspace-menu-item" onClick={() => { setPanelMenuOpen(false); void onPanelStateChange({ sortBy: 'updated' }); }}>
                      <span>已更新</span>
                      {panelState.sortBy === 'updated' ? <Check size={14} /> : null}
                    </button>
                    <div className="workspace-menu-divider" />
                    <div className="workspace-menu-group-title">显示</div>
                    <button type="button" className="workspace-menu-item" onClick={() => { setPanelMenuOpen(false); void onPanelStateChange({ visibility: 'all' }); }}>
                      <span>所有聊天</span>
                      {panelState.visibility === 'all' ? <Check size={14} /> : null}
                    </button>
                    <button type="button" className="workspace-menu-item" onClick={() => { setPanelMenuOpen(false); void onPanelStateChange({ visibility: 'relevant' }); }}>
                      <span>相关</span>
                      {panelState.visibility === 'relevant' ? <Check size={14} /> : null}
                    </button>
                  </div>
                </PopoverPortal>
              </div>
              <div className="panel-menu-anchor" ref={addProjectMenuRef}>
                <button type="button" className="sidebar-toolbar-icon" title="新增项目" onClick={() => setAddProjectMenuOpen((value) => !value)}>
                  <FolderPlus size={13} />
                </button>
                <PopoverPortal open={addProjectMenuOpen} anchorRef={addProjectMenuRef} placement="bottom-end">
                  <div className="workspace-menu add-project-menu-popover">
                    <div className="workspace-menu-group-title">新增项目</div>
                    <button type="button" className="workspace-menu-item" onClick={() => { setAddProjectMenuOpen(false); void onPickProjectDirectory(); }}>
                      <FolderOpen size={14} />
                      <span>选择本地文件夹...</span>
                    </button>
                    <button type="button" className="workspace-menu-item" onClick={() => { setAddProjectMenuOpen(false); onOpenCloneDialog(); }}>
                      <GitBranchPlus size={14} />
                      <span>克隆 Git 仓库...</span>
                    </button>
                  </div>
                </PopoverPortal>
              </div>
            </div>
          </div>
          {cloneTasks.length === 0 && unpinnedProjects.length === 0 && !hasAnyPinned ? (
            <div className="sidebar-empty">
              <p>当前还没有项目。</p>
              <p>点击右上角新增项目，或从 Claude Code 本地 session 自动导入。</p>
            </div>
          ) : (
            <>
              {cloneTasks.map((task) => (
                <div key={task.id} className={`sidebar-project clone-task ${task.status}`}>
                  <div className="sidebar-project-row clone-task-row">
                    <div className="sidebar-project-title clone-task-title">
                      <span>{task.status === 'failed' ? <GitBranchPlus size={14} /> : <LoaderCircle className="spin" size={14} />}</span>
                      <strong>{task.projectName}</strong>
                      <small className={`sidebar-project-status-badge ${task.status}`}>
                        {task.status === 'cloning' ? '克隆中' : task.status === 'attaching' ? '处理中' : '失败'}
                      </small>
                    </div>
                  </div>
                  <div className="sidebar-project-task-body">
                    <p className="sidebar-project-substatus">{task.errorMessage || task.detail}</p>
                    {task.status === 'failed' ? (
                      <div className="sidebar-project-task-actions">
                        {task.rawLog ? (
                          <button type="button" className="sidebar-task-button" onClick={() => toggleCloneLog(task.id)}>
                            {expandedCloneLogs[task.id] ? '收起' : '日志'}
                          </button>
                        ) : null}
                        <button type="button" className="sidebar-task-button" onClick={() => onRetryCloneTask(task.id)}>
                          <RefreshCw size={12} />
                          重试
                        </button>
                        <button type="button" className="sidebar-task-button danger" onClick={() => onRemoveCloneTask(task.id)}>
                          <X size={12} />
                          移除
                        </button>
                      </div>
                    ) : null}
                    {task.status === 'failed' && task.rawLog && expandedCloneLogs[task.id] ? (
                      <div className="sidebar-task-log-card">
                        <pre>{task.rawLog}</pre>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              {unpinnedProjects.map((project) => renderProjectCard(project))}
            </>
          )}
        </section>
      </div>

      <div className="sidebar-footer">
        <button type="button" onClick={onOpenSettings}><span><Settings size={14} /></span> 设置</button>
      </div>

      {onUpdateSidebarCustomWidth ? (
        <div
          className="app-sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调整侧边栏宽度，双击恢复默认"
          onPointerDown={handleSidebarResizePointerDown}
          onDoubleClick={handleSidebarResizeDoubleClick}
        />
      ) : null}
    </aside>
  );
}

function SidebarThreadStatusIcon({ status }: { status: SidebarThreadStatusKind | null }) {
  if (!status) {
    return null;
  }

  if (status === 'hot') {
    return (
      <span className="sidebar-thread-status-icon hot" aria-label="热会话" title="热会话">
        <Zap size={12} />
      </span>
    );
  }

  return (
    <span
      className={`sidebar-thread-status-icon ${status}`}
      aria-label={status === 'running' ? '运行中' : '完成'}
      title={status === 'running' ? '运行中' : '完成'}
    />
  );
}

function mergeVisibleThreads(
  ...threadGroups: ThreadSummary[][]
) {
  const seen = new Set<string>();
  const merged: ThreadSummary[] = [];

  for (const threadGroup of threadGroups) {
    for (const thread of threadGroup) {
      if (seen.has(thread.id)) {
        continue;
      }

      seen.add(thread.id);
      merged.push(thread);
    }
  }

  return merged;
}

function formatOrdinaryChatUpdatedAt(updatedAt: string) {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
