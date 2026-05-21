import { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { AppMenubar } from './components/AppMenubar';
import { ChatHeader } from './components/ChatHeader';
import { CloneRepositoryDialog } from './components/CloneRepositoryDialog';
import { Composer } from './components/Composer';
import { ConversationPane } from './components/ConversationPane';
import { Dialogs } from './components/Dialogs';
import { GitDialog } from './components/GitDialog';
import { RightWorkbench } from './components/RightWorkbench';
import { SidebarProjects } from './components/SidebarProjects';
import { SettingsView } from './components/settings/SettingsView';
import { TerminalDock, useTerminalDockState, type TerminalRunRequest } from './components/TerminalDock';
import { WorktreeCreateDialog } from './components/WorktreeCreateDialog';
import { WorkspaceStatus } from './components/WorkspaceStatus';
import { useClaudeRun } from './hooks/useClaudeRun';
import { useAppSettings } from './hooks/useAppSettings';
import { useWorkspaceState } from './hooks/useWorkspaceState';
import {
  buildCompactSlashCommandSubmission,
  buildContextSlashCardResult,
  buildCostSlashCardResult,
  buildStatusSlashCardResult,
} from './lib/claude-slash-system-commands';
import { closeWorkbenchPreviewTab, openWorkbenchPreviewTab } from './lib/workbench-preview';
import { normalizeWorkbenchPreviewRequest } from './lib/workbench-preview';
import { matchesShortcut } from './lib/shortcuts';
import { createSystemCommandItem, settleSystemCommandItem } from './lib/system-command-items';
import { modelLabel, permissionLabel } from './lib/ui-labels';
import { isTauriRuntime, setWindowMaterial } from './lib/window-material';
import { getQueuedPromptGuideAvailability } from './lib/queued-prompts';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ConversationTurn,
  RequestUserInputRequest,
  RuntimeSuggestedAction,
  RightWorkbenchTab,
  SlashCommand,
  WorkbenchFileScope,
  WorkbenchPreviewContentState,
  WorkbenchPreviewRequest,
  WorkbenchPreviewTab,
  SettingsSection,
  SystemCommandItem,
  ThreadDetail,
  ThreadSummary,
  ToolStep,
  ProjectSummary,
  GitCreateWorktreeResult,
} from './types';

type AppView = { kind: 'workspace' } | { kind: 'settings'; section: SettingsSection };

type AppLocation =
  | { kind: 'workspace'; projectId: string | null; threadId: string | null }
  | { kind: 'settings'; section: SettingsSection };

type NavigationHistory = {
  past: AppLocation[];
  future: AppLocation[];
};

const MAX_NAVIGATION_HISTORY = 60;

export default function App() {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const conversationBottomRef = useRef<HTMLDivElement | null>(null);
  const chatWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const [dismissedApprovalDialogKey, setDismissedApprovalDialogKey] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const workspaceState = useWorkspaceState();
  const {
    projects,
    panelState,
    activeProjectId,
    activeThreadId,
    searchOpen,
    searchQuery,
    collapsedProjects,
    cloneTasks,
    inputDialog,
    confirmDialog,
    toast,
    activeProject,
    activeThreadSummary,
    activeThread,
    filteredProjects,
    setSearchOpen,
    setSearchQuery,
    setInputDialog,
    setConfirmDialog,
    showToast,
    syncWorkspace,
    loadWorkspace,
    createThread,
    openWorktreePath,
    selectDirectoryPath,
    cloneRepositoryAndAttach,
    retryCloneTask,
    removeCloneTask,
    handlePickProjectDirectory,
    submitInputDialog,
    confirmRemoveDialog,
    handleOpenProject,
    handleOpenProjectInEditor,
    handleCopyProjectPath,
    refreshProjectGitSummary,
    loadProjectGitBranches,
    switchProjectGitBranch,
    handleCopySessionId,
    selectThread,
    selectProject,
    setActiveProjectId,
    setActiveThreadId,
    handlePanelStateChange,
    toggleProjectCollapse,
    toggleAllProjects,
    openRenameProjectDialog,
    openRenameThreadDialog,
    openRemoveProjectDialog,
    openRemoveThreadDialog,
    persistThreadMetadata,
    updateThreadDetail,
    updateThreadTurn,
    appendDebug,
    appendRawEvent,
    schedulePersistThreadHistory,
  } = workspaceState;
  const [appView, setAppView] = useState<AppView>({
    kind: 'workspace',
  });
  const [navigationHistory, setNavigationHistory] = useState<NavigationHistory>({ past: [], future: [] });
  const [gitDialogMode, setGitDialogMode] = useState<'commit' | 'push' | null>(null);
  const [rightWorkbenchOpen, setRightWorkbenchOpen] = useState(false);
  const [rightWorkbenchTab, setRightWorkbenchTab] = useState<RightWorkbenchTab>('overview');
  const [rightWorkbenchFileScope, setRightWorkbenchFileScope] = useState<WorkbenchFileScope>('all');
  const [rightWorkbenchWidth, setRightWorkbenchWidth] = useState(520);
  const [previewTabs, setPreviewTabs] = useState<WorkbenchPreviewTab[]>([]);
  const [activePreviewKey, setActivePreviewKey] = useState('');
  const [previewContentByKey, setPreviewContentByKey] = useState<Record<string, WorkbenchPreviewContentState>>({});
  const [composerDraftsByKey, setComposerDraftsByKey] = useState<Record<string, string>>({});
  const [projectsRefreshing, setProjectsRefreshing] = useState(false);
  const [worktreeCreateProject, setWorktreeCreateProject] = useState<ProjectSummary | null>(null);
  const terminalDock = useTerminalDockState();
  const terminalDockAvailable = isTauriRuntime();
  const [terminalRunRequest, setTerminalRunRequest] = useState<TerminalRunRequest | null>(null);
  const {
    general,
    appearance,
    models: appModelSettings,
    shortcuts,
    openWith,
    openTargets,
    loading: settingsLoading,
    updateAppearance,
    updateGeneral,
    updateModels,
    updateShortcuts,
    updateOpenWith,
  } = useAppSettings(showToast);
  const wasRunningRef = useRef(false);
  const materialErrorShownRef = useRef(false);
  const {
    workspace,
    permissionMode,
    model,
    models,
    claudeModels,
    health,
    backendRunId,
    isRunning,
    runningThreadIds,
    activeTurnIdsByThreadId,
    queuedPrompts,
    removeQueuedPrompt,
    recallQueuedPrompt,
    guideQueuedPrompt,
    clockNowMs,
    setModel,
    handlePermissionModeSelect,
    submitPrompt,
    submitPromptToThread,
    submitRequestUserInput,
    submitRuntimeRecoveryAction,
    submitApprovalDecision,
    stopRun,
  } = useClaudeRun({
    activeProjectId,
    activeProjectPath: activeProject?.path,
    activeThreadId,
    activeThreadSummary,
    appModelSettings,
    defaultPermissionMode: general.defaultPermissionMode,
    createThread,
    handlePickProjectDirectory,
    showToast,
    updateThreadDetail,
    updateThreadTurn,
    appendDebug,
    appendRawEvent,
    schedulePersistThreadHistory,
    persistThreadMetadata,
    clearActiveTurnSelection: () => undefined,
  });

  const currentAppLocation: AppLocation =
    appView.kind === 'settings'
      ? { kind: 'settings', section: appView.section }
      : { kind: 'workspace', projectId: activeProjectId, threadId: activeThreadId };
  const canNavigateBack = navigationHistory.past.length > 0;
  const canNavigateForward = navigationHistory.future.length > 0;

  useEffect(() => {
    if (settingsLoading || !isTauriRuntime()) {
      return;
    }

    let cancelled = false;
    void setWindowMaterial(appearance.windowMaterial).then((handled) => {
      if (!handled && !cancelled && !materialErrorShownRef.current) {
        materialErrorShownRef.current = true;
        showToast('窗口材质应用失败，请确认当前 Windows 版本支持该材质。', 'error');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [appearance.windowMaterial, settingsLoading, showToast]);

  useEffect(() => {
    if (!general.autoRefreshGitStatus || !activeProjectId) {
      return;
    }

    void refreshProjectGitSummary(activeProjectId);
  }, [activeProjectId, general.autoRefreshGitStatus]);

  useEffect(() => {
    const wasRunning = wasRunningRef.current;
    wasRunningRef.current = isRunning;

    if (general.autoRefreshGitStatus && activeProjectId && wasRunning && !isRunning) {
      void refreshProjectGitSummary(activeProjectId);
    }
  }, [activeProjectId, general.autoRefreshGitStatus, isRunning]);

  useEffect(() => {
    setPreviewTabs([]);
    setActivePreviewKey('');
    setPreviewContentByKey({});
  }, [activeProject?.id]);

  useEffect(() => {
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent) {
      if (isEditableShortcutTarget(event.target)) {
        return;
      }

      if (matchesShortcut(event, shortcuts.newChat)) {
        event.preventDefault();
        if (appView.kind === 'workspace') {
          void handleCreatePrimaryChat();
        }
        return;
      }

      if (matchesShortcut(event, shortcuts.toggleSearch)) {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }

      if (matchesShortcut(event, shortcuts.toggleDebug)) {
        event.preventDefault();
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [appView.kind, handleCreatePrimaryChat, setSearchOpen, shortcuts]);

  const latestApprovalDialog = useMemo(
    () => getLatestPendingApprovalDialog(activeThread),
    [activeThread],
  );
  const approvalDialog =
    latestApprovalDialog && latestApprovalDialog.key !== dismissedApprovalDialogKey
      ? latestApprovalDialog
      : null;
  const composerDraftKey = activeThreadId ?? (activeProjectId ? `project:${activeProjectId}` : 'global');
  const composerDraft = composerDraftsByKey[composerDraftKey] ?? '';
  const activeRunTurnId = activeThreadId ? activeTurnIdsByThreadId[activeThreadId] : undefined;
  const activeRunTurn = activeRunTurnId
    ? activeThread?.turns.find((turn) => turn.id === activeRunTurnId)
    : undefined;
  const queuedPromptGuideAvailability = getQueuedPromptGuideAvailability({
    isRunning: Boolean(activeThreadId && runningThreadIds.includes(activeThreadId)),
    runId: backendRunId,
    hasPendingHumanInput: Boolean(
      activeRunTurn?.pendingUserInputRequests?.length ||
      activeRunTurn?.pendingApprovalRequests?.length,
    ),
    queueLength: queuedPrompts.length,
  });
  const handleComposerDraftChange = useCallback(
    (value: string) => {
      setComposerDraftsByKey((current) => {
        if (value) {
          return { ...current, [composerDraftKey]: value };
        }
        if (!(composerDraftKey in current)) {
          return current;
        }
        const { [composerDraftKey]: _removed, ...next } = current;
        return next;
      });
    },
    [composerDraftKey],
  );

  function handleRecallQueuedPrompt(promptId: string) {
    const recalledText = recallQueuedPrompt(promptId);
    if (!recalledText) {
      return;
    }

    handleComposerDraftChange(recalledText);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    const shouldSubmit =
      shortcuts.composerSend === 'enter'
        ? !event.ctrlKey && !event.metaKey && !event.altKey
        : (event.ctrlKey || event.metaKey) && !event.altKey;
    if (!shouldSubmit) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  async function handleSelectThread(projectId: string, threadId: string) {
    const nextLocation: AppLocation = { kind: 'workspace', projectId, threadId };
    if (!isSameAppLocation(currentAppLocation, nextLocation)) {
      rememberCurrentLocation();
    }
    setAppView({ kind: 'workspace' });
    await selectThread(projectId, threadId);
  }

  async function handleRefreshProjects() {
    if (projectsRefreshing) {
      return;
    }

    setProjectsRefreshing(true);
    try {
      await loadWorkspace();
      showToast('项目已刷新');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '刷新项目失败', 'error');
    } finally {
      setProjectsRefreshing(false);
    }
  }

  function handleOpenRemoveThreadDialog(thread: ThreadSummary) {
    if (runningThreadIds.includes(thread.id)) {
      showToast('当前聊天正在运行，请先停止再删除。', 'info');
      return;
    }

    openRemoveThreadDialog(thread);
  }

  function handleInputDialogValueChange(value: string) {
    setInputDialog((current) => (current ? { ...current, value } : current));
  }

  function handleCloseApprovalDialog() {
    if (!latestApprovalDialog) {
      return;
    }

    setDismissedApprovalDialogKey(latestApprovalDialog.key);
  }

  async function handleCreateThread(projectId: string) {
    try {
      rememberCurrentLocation();
      await createThread(projectId);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '新建聊天失败', 'error');
    }
  }

  async function handleCreatePrimaryChat() {
    if (!activeProjectId) {
      await handlePickProjectDirectory();
      return;
    }

    await handleCreateThread(activeProjectId);
  }

  async function ensureSlashCommandThread() {
    if (activeThreadSummary) {
      return activeThreadSummary;
    }

    if (!activeProjectId) {
      await handlePickProjectDirectory();
      showToast('先添加一个项目目录，再开始新聊天。', 'info');
      return null;
    }

    try {
      return await createThread(activeProjectId, undefined, { showToast: false });
    } catch (error) {
      showToast(error instanceof Error ? error.message : '新建聊天失败', 'error');
      return null;
    }
  }

  function appendSystemCommandTurn(
    thread: ThreadSummary,
    submittedText: string,
    item: SystemCommandItem,
  ) {
    const turnId = crypto.randomUUID();
    updateThreadDetail(
      thread.id,
      (existing) => ({
        ...existing,
        turns: [
          ...existing.turns,
          {
            id: turnId,
            userText: submittedText,
            workspace: thread.workingDirectory || workspace,
            assistantText: '',
            tools: [],
            items: [item],
            status: item.state === 'error' ? 'error' : item.state === 'running' ? 'running' : 'done',
            activity: item.state === 'error' ? (item.errorMessage || '命令执行失败') : '命令已完成',
            startedAtMs: Date.now(),
            pendingUserInputRequests: [],
            pendingApprovalRequests: [],
          },
        ],
      }),
      thread,
    );
    schedulePersistThreadHistory(thread.id);
    return turnId;
  }

  async function handleRunSlashSystemCommand(command: SlashCommand, submittedText: string) {
    const thread = await ensureSlashCommandThread();
    if (!thread) {
      return;
    }

    const threadDetail = activeThread?.id === thread.id ? activeThread : null;
    const turns = threadDetail?.turns ?? [];

    if (command.localActionId === 'show-status') {
      const result = buildStatusSlashCardResult({
        projectName: activeProject?.name,
        threadTitle: threadDetail?.title ?? thread.title,
        workspace: workspace || thread.workingDirectory,
        modelLabel: modelLabel(models.find((item) => item.id === model) ?? model),
        permissionLabel: permissionLabel(permissionMode),
        sessionId: threadDetail?.sessionId ?? thread.sessionId,
        isRunning: Boolean(activeThreadId && runningThreadIds.includes(activeThreadId) && thread.id === activeThreadId),
        cliHealth: health,
        turns,
      });
      appendSystemCommandTurn(
        thread,
        submittedText,
        settleSystemCommandItem(createSystemCommandItem(submittedText, result.title, result.cardType), {
          state: 'done',
          summary: result.summary,
          details: result.details,
          errorMessage: undefined,
        }),
      );
      return;
    }

    if (command.localActionId === 'show-context') {
      const result = buildContextSlashCardResult({ turns });
      appendSystemCommandTurn(
        thread,
        submittedText,
        settleSystemCommandItem(createSystemCommandItem(submittedText, result.title, result.cardType), {
          state: 'done',
          summary: result.summary,
          details: result.details,
          errorMessage: undefined,
        }),
      );
      return;
    }

    if (command.localActionId === 'show-cost') {
      const result = buildCostSlashCardResult({ turns });
      appendSystemCommandTurn(
        thread,
        submittedText,
        settleSystemCommandItem(createSystemCommandItem(submittedText, result.title, result.cardType), {
          state: 'done',
          summary: result.summary,
          details: result.details,
          errorMessage: undefined,
        }),
      );
      return;
    }

    if (command.localActionId === 'compact-thread') {
      await submitPromptToThread(thread, buildCompactSlashCommandSubmission(submittedText));
      return;
    }

    showToast(`不支持的命令：${command.slash}`, 'error');
  }

  function openSettings(section: SettingsSection = 'appearance') {
    navigateToLocation({ kind: 'settings', section });
  }

  function returnWorkspace() {
    navigateToLocation({ kind: 'workspace', projectId: activeProjectId, threadId: activeThreadId });
  }

  function showShortcuts() {
    openSettings('shortcuts');
  }

  function showAbout() {
    showToast('CodeM 0.1.0 · Tauri 桌面壳预览版', 'info');
  }

  async function handleCloneRepository(payload: {
    repoUrl: string;
    baseDirectory: string;
    folderName: string;
  }) {
    await cloneRepositoryAndAttach(payload);
  }

  function handleUnsupportedWindowAction(action: string) {
    showToast(`${action} 会在接入 Tauri 窗口 API 后启用。`, 'info');
  }

  function rememberCurrentLocation() {
    setNavigationHistory((current) => ({
      past: appendNavigationLocation(current.past, currentAppLocation),
      future: [],
    }));
  }

  function navigateToLocation(location: AppLocation) {
    if (isSameAppLocation(currentAppLocation, location)) {
      return;
    }

    setNavigationHistory((current) => ({
      past: appendNavigationLocation(current.past, currentAppLocation),
      future: [],
    }));
    applyLocation(location);
  }

  function navigateBack() {
    const previous = navigationHistory.past.at(-1);
    if (!previous) {
      return;
    }

    setNavigationHistory({
      past: navigationHistory.past.slice(0, -1),
      future: [currentAppLocation, ...navigationHistory.future].slice(0, MAX_NAVIGATION_HISTORY),
    });
    applyLocation(previous);
  }

  function navigateForward() {
    const next = navigationHistory.future[0];
    if (!next) {
      return;
    }

    setNavigationHistory({
      past: appendNavigationLocation(navigationHistory.past, currentAppLocation),
      future: navigationHistory.future.slice(1),
    });
    applyLocation(next);
  }

  function applyLocation(location: AppLocation) {
    if (location.kind === 'settings') {
      setAppView({ kind: 'settings', section: location.section });
      return;
    }

    setAppView({ kind: 'workspace' });
    if (!location.projectId) {
      setActiveProjectId(null);
      setActiveThreadId(null);
      return;
    }

    const project = projects.find((item) => item.id === location.projectId);
    if (!project) {
      setActiveProjectId(null);
      setActiveThreadId(null);
      return;
    }

    const targetThreadId = project.threads.some((thread) => thread.id === location.threadId)
      ? location.threadId
      : project.threads[0]?.id ?? null;
    if (targetThreadId) {
      void selectThread(project.id, targetThreadId);
      return;
    }

    void selectProject(project.id);
  }

  function openReviewWorkbench() {
    setRightWorkbenchOpen(true);
    setRightWorkbenchTab('files');
    setRightWorkbenchFileScope('changed');
    if (activeProjectId) {
      void refreshProjectGitSummary(activeProjectId);
    }
  }

  function openFilesWorkbench() {
    setRightWorkbenchOpen(true);
    setRightWorkbenchTab('files');
    setRightWorkbenchFileScope('all');
  }

  function openWorkbenchPreview(request: WorkbenchPreviewRequest) {
    if (!activeProject) {
      showToast('请先选择项目。', 'info');
      return;
    }

    const normalizedRequest = normalizeWorkbenchPreviewRequest(request, activeProject.path);
    setPreviewTabs((currentTabs) => openWorkbenchPreviewTab(currentTabs, normalizedRequest).tabs);
    setActivePreviewKey(normalizedRequest.key);
    setPreviewContentByKey((current) => {
      const next = { ...current };
      delete next[normalizedRequest.key];
      return next;
    });
    setRightWorkbenchOpen(true);
    setRightWorkbenchTab('files');
  }

  function closeWorkbenchPreview(tabKey: string) {
    setPreviewTabs((currentTabs) => {
      const next = closeWorkbenchPreviewTab(currentTabs, activePreviewKey, tabKey);
      setActivePreviewKey(next.activeKey);
      setPreviewContentByKey((current) => {
        if (!(tabKey in current)) {
          return current;
        }
        const updated = { ...current };
        delete updated[tabKey];
        return updated;
      });
      return next.tabs;
    });
  }

  const resolveWorkbenchPreviewContent = useCallback((key: string, state: WorkbenchPreviewContentState) => {
    setPreviewContentByKey((current) => ({
      ...current,
      [key]: state,
    }));
  }, []);

  function handleRightWorkbenchResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rightWorkbenchWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function handlePointerMove(pointerEvent: PointerEvent) {
      const nextWidth = startWidth - (pointerEvent.clientX - startX);
      const workspaceWidth = chatWorkspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const maxWidth = Math.max(300, workspaceWidth - 360);
      setRightWorkbenchWidth(Math.min(maxWidth, Math.max(320, nextWidth)));
    }

    function handlePointerUp() {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  }

  function handleWorktreeCreated(result: GitCreateWorktreeResult) {
    if (result.workspace) {
      syncWorkspace(result.workspace);
    }
    showToast(result.projectId ? '工作树已创建并切换' : '工作树已创建');
  }

  return (
    <div
      className="codex-desktop"
      data-theme-mode={appearance.themeMode}
      data-window-material={appearance.windowMaterial}
      data-density={appearance.density}
      data-sidebar-width={appearance.sidebarWidth}
      style={{
        '--app-ui-font-size': `${appearance.uiFontSize}px`,
        '--app-code-font-size': `${appearance.codeFontSize}px`,
      } as CSSProperties}
    >
      <AppMenubar
        sidebarVisible={sidebarVisible}
        windowMaterial={appearance.windowMaterial}
        canNavigateBack={canNavigateBack}
        canNavigateForward={canNavigateForward}
        onToggleSidebar={() => setSidebarVisible((value) => !value)}
        onNavigateBack={navigateBack}
        onNavigateForward={navigateForward}
        onNewChat={() => void handleCreatePrimaryChat()}
        onOpenFolder={() => void handlePickProjectDirectory()}
        onOpenCloneDialog={() => setCloneDialogOpen(true)}
        onOpenSettings={() => openSettings('appearance')}
        onOpenSearch={() => setSearchOpen(true)}
        onSelectWindowMaterial={(windowMaterial) => updateAppearance({ windowMaterial })}
        onShowAbout={showAbout}
        onShowShortcuts={showShortcuts}
        onUnsupportedWindowAction={handleUnsupportedWindowAction}
      />

      {appView.kind === 'settings' ? (
        <SettingsView
          activeSection={appView.section}
          activeProject={activeProject}
          projects={projects}
          general={general}
          appearance={appearance}
          models={appModelSettings}
          shortcuts={shortcuts}
          openWith={openWith}
          openTargets={openTargets}
          claudeModels={claudeModels}
          onSelectSection={(section) => navigateToLocation({ kind: 'settings', section })}
          onOpenWorktreePath={openWorktreePath}
          onSyncWorkspace={syncWorkspace}
          showToast={showToast}
          onUpdateGeneral={updateGeneral}
          onUpdateAppearance={updateAppearance}
          onUpdateModels={updateModels}
          onUpdateShortcuts={updateShortcuts}
          onUpdateOpenWith={updateOpenWith}
          onReturnWorkspace={returnWorkspace}
        />
      ) : (
        <div className={`codex-shell${sidebarVisible ? '' : ' sidebar-hidden'}`}>
          {sidebarVisible ? (
            <SidebarProjects
              activeProjectId={activeProjectId}
              activeThreadId={activeThreadId}
              runningThreadIds={runningThreadIds}
              cloneTasks={cloneTasks}
              filteredProjects={filteredProjects}
              collapsedProjects={collapsedProjects}
              searchOpen={searchOpen}
              searchQuery={searchQuery}
              panelState={panelState}
              onCreatePrimaryChat={() => void handleCreatePrimaryChat()}
              onToggleSearch={() => setSearchOpen((value) => !value)}
              onSearchQueryChange={setSearchQuery}
              onToggleAllProjects={toggleAllProjects}
              onRefreshProjects={handleRefreshProjects}
              refreshingProjects={projectsRefreshing}
              onOpenPlugins={() => openSettings('plugins')}
              onPanelStateChange={handlePanelStateChange}
              onPickProjectDirectory={handlePickProjectDirectory}
              onOpenCloneDialog={() => setCloneDialogOpen(true)}
              onRetryCloneTask={retryCloneTask}
              onRemoveCloneTask={removeCloneTask}
              onCreateThread={handleCreateThread}
              onOpenProject={handleOpenProject}
              onCopyProjectPath={handleCopyProjectPath}
              onCreateWorktree={(project) => setWorktreeCreateProject(project)}
              onOpenRenameProjectDialog={openRenameProjectDialog}
              onOpenRemoveProjectDialog={openRemoveProjectDialog}
              onToggleProjectCollapse={toggleProjectCollapse}
              onSelectThread={handleSelectThread}
              onOpenRenameThreadDialog={openRenameThreadDialog}
              onCopySessionId={handleCopySessionId}
              onOpenRemoveThreadDialog={handleOpenRemoveThreadDialog}
              onOpenSettings={() => openSettings('appearance')}
            />
          ) : null}

          <div
            ref={chatWorkspaceRef}
            className={`chat-workspace${rightWorkbenchOpen ? ' workbench-open' : ''}`}
            style={{
              '--right-workbench-width': `${rightWorkbenchWidth}px`,
            } as CSSProperties}
          >
            <main className="chat-shell">
              <ChatHeader
                activeProject={activeProject}
                activeThread={activeThread}
                openTargets={openTargets}
                selectedOpenTargetId={openWith.selectedTargetId}
                runAvailable={terminalDockAvailable}
                onRunLaunchScript={handleRunLaunchScript}
                onOpenTarget={(targetId) => activeProject ? void handleOpenProjectInEditor(activeProject, targetId) : showToast('请先选择项目。', 'info')}
                onSelectOpenTarget={(targetId) => void updateOpenWith({ selectedTargetId: targetId })}
                onOpenFilesWorkbench={openFilesWorkbench}
                onOpenGitCommit={() => activeProject ? setGitDialogMode('commit') : showToast('请先选择项目。', 'info')}
                onOpenGitPush={() => activeProject ? setGitDialogMode('push') : showToast('请先选择项目。', 'info')}
                terminalDockOpen={terminalDock.open}
                onToggleTerminalDock={terminalDock.toggle}
                terminalDockAvailable={terminalDockAvailable}
                rightWorkbenchOpen={rightWorkbenchOpen}
                onToggleRightWorkbench={() => setRightWorkbenchOpen((value) => !value)}
                onOpenReviewWorkbench={openReviewWorkbench}
              />

              <ConversationPane
                activeThread={activeThread}
                clockNowMs={clockNowMs}
                isRunning={Boolean(activeThreadId && runningThreadIds.includes(activeThreadId))}
                activeTurnId={activeThreadId ? activeTurnIdsByThreadId[activeThreadId] ?? '' : ''}
                transcriptRef={transcriptRef}
                bottomRef={conversationBottomRef}
                onOpenWorkbenchPreview={openWorkbenchPreview}
                onSubmitRequestUserInput={(
                  turn: ConversationTurn,
                  request: RequestUserInputRequest,
                  answers: Record<string, string>,
                ) => submitRequestUserInput(turn, request, answers)}
                onSubmitRuntimeRecoveryAction={(turn: ConversationTurn, action: RuntimeSuggestedAction) =>
                  submitRuntimeRecoveryAction(turn, action)}
                onSubmitApprovalDecision={(
                  turn: ConversationTurn,
                  request: ApprovalRequest,
                  decision: ApprovalDecision,
                ) => submitApprovalDecision(turn, request, decision)}
              />

              <CurrentTaskDock activeThread={activeThread} />

              <Composer
                agent="claude"
                workspace={workspace}
                permissionMode={permissionMode}
                model={model}
                models={models}
                turns={activeThread?.turns ?? []}
                isRunning={Boolean(activeThreadId && runningThreadIds.includes(activeThreadId))}
                draftScopeKey={composerDraftKey}
                draft={composerDraft}
                queuedPrompts={queuedPrompts}
                queuedPromptGuideAvailability={queuedPromptGuideAvailability}
                onDraftChange={handleComposerDraftChange}
                onSubmitPrompt={submitPrompt}
                onRemoveQueuedPrompt={removeQueuedPrompt}
                onRecallQueuedPrompt={handleRecallQueuedPrompt}
                onGuideQueuedPrompt={guideQueuedPrompt}
                showToast={showToast}
                onKeyDown={handleComposerKeyDown}
                onSelectPermissionMode={handlePermissionModeSelect}
                onSelectModel={setModel}
                onOpenPlugins={() => openSettings('plugins')}
                onCreateNewChat={() => void handleCreatePrimaryChat()}
                onStopRun={() => stopRun(activeThreadId ?? undefined)}
                onRunSlashSystemCommand={handleRunSlashSystemCommand}
              />

              <WorkspaceStatus
                activeProject={activeProject}
                activeThread={activeThread}
                projects={projects}
                onLoadBranches={loadProjectGitBranches}
                onSelectBranch={switchProjectGitBranch}
                onOpenWorktreePath={openWorktreePath}
                onCreateWorktree={(project) => setWorktreeCreateProject(project)}
              />

              {terminalDockAvailable ? (
                <TerminalDock
                  isOpen={terminalDock.open}
                  onToggleOpen={terminalDock.toggle}
                  defaultWorkspace={activeProject}
                  runRequest={terminalRunRequest}
                />
              ) : null}
            </main>
            {rightWorkbenchOpen ? (
              <RightWorkbench
                activeTab={rightWorkbenchTab}
                activeProject={activeProject}
                activeThread={activeThread}
                fileScope={rightWorkbenchFileScope}
                isRunning={Boolean(activeThreadId && runningThreadIds.includes(activeThreadId))}
                previewTabs={previewTabs}
                activePreviewKey={activePreviewKey}
                previewContentByKey={previewContentByKey}
                onSelectTab={setRightWorkbenchTab}
                onSelectFileScope={setRightWorkbenchFileScope}
                onOpenWorkbenchPreview={openWorkbenchPreview}
                onSelectPreviewTab={setActivePreviewKey}
                onClosePreviewTab={closeWorkbenchPreview}
                onResolvePreviewContent={resolveWorkbenchPreviewContent}
                onResizeStart={handleRightWorkbenchResizeStart}
                onClose={() => setRightWorkbenchOpen(false)}
              />
            ) : null}
          </div>
        </div>
      )}

      <Dialogs
        approvalDialog={
          approvalDialog
            ? {
                turn: approvalDialog.turn,
                request: approvalDialog.request,
              }
            : null
        }
        inputDialog={inputDialog}
        confirmDialog={confirmDialog}
        toast={toast}
        onCloseApprovalDialog={handleCloseApprovalDialog}
        onSubmitApprovalDecision={(
          turn: ConversationTurn,
          request: ApprovalRequest,
          decision: ApprovalDecision,
        ) => submitApprovalDecision(turn, request, decision)}
        onCloseInputDialog={() => setInputDialog(null)}
        onInputDialogValueChange={handleInputDialogValueChange}
        onSubmitInputDialog={submitInputDialog}
        onCloseConfirmDialog={() => setConfirmDialog(null)}
        onConfirmRemoveDialog={confirmRemoveDialog}
      />
      {worktreeCreateProject ? (
        <WorktreeCreateDialog
          project={worktreeCreateProject}
          onClose={() => setWorktreeCreateProject(null)}
          onCreated={handleWorktreeCreated}
          showToast={showToast}
        />
      ) : null}
      {gitDialogMode && activeProject ? (
        <GitDialog
          mode={gitDialogMode}
          project={activeProject}
          onClose={() => setGitDialogMode(null)}
          onChanged={() => activeProjectId ? refreshProjectGitSummary(activeProjectId) : undefined}
          showToast={showToast}
        />
      ) : null}
      <CloneRepositoryDialog
        open={cloneDialogOpen}
        initialBaseDirectory={activeProject?.path}
        onClose={() => setCloneDialogOpen(false)}
        onPickBaseDirectory={(currentBaseDirectory) => selectDirectoryPath(currentBaseDirectory || activeProject?.path)}
        onSubmit={handleCloneRepository}
      />
    </div>
  );

  function handleRunLaunchScript(command: string) {
    if (!activeProject) {
      showToast('请先选择项目。', 'info');
      return;
    }
    if (!terminalDockAvailable) {
      showToast('启动脚本仅在桌面版可用。', 'info');
      return;
    }
    terminalDock.openDock();
    setTerminalRunRequest({
      id: Date.now(),
      command,
      cwd: activeProject.path,
      title: activeProject.path,
    });
  }
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
}

function appendNavigationLocation(locations: AppLocation[], location: AppLocation) {
  if (isSameAppLocation(locations.at(-1) ?? null, location)) {
    return locations;
  }

  return [...locations, location].slice(-MAX_NAVIGATION_HISTORY);
}

function isSameAppLocation(left: AppLocation | null, right: AppLocation | null) {
  if (!left || !right || left.kind !== right.kind) {
    return false;
  }

  if (left.kind === 'settings' && right.kind === 'settings') {
    return left.section === right.section;
  }

  if (left.kind === 'workspace' && right.kind === 'workspace') {
    return left.projectId === right.projectId && left.threadId === right.threadId;
  }

  return false;
}

function CurrentTaskDock({ activeThread }: { activeThread: ThreadDetail | null }) {
  const preview = useMemo(() => getLatestTodoWritePreview(activeThread), [activeThread]);
  if (!preview) {
    return null;
  }

  return (
    <section className="task-dock" aria-label="当前任务">
      <div className="task-dock-card">
        <header className="task-dock-head">
          <div className="task-dock-title">
            <ListChecks size={15} aria-hidden="true" />
            <span>{formatTodoDockSummary(preview)}</span>
          </div>
        </header>
        <ol className="task-dock-list">
          {preview.todos.map((todo, index) => (
            <li key={`${todo.content}-${index}`} className={`task-dock-item ${todo.status}`}>
              <span className="task-dock-status" aria-hidden="true">
                {todo.status === 'completed' ? '✓' : ''}
              </span>
              <span className="task-dock-content">
                {index + 1}. {todo.content}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function getLatestPendingApprovalDialog(activeThread: ThreadDetail | null) {
  if (!activeThread) {
    return null;
  }

  const turn = activeThread.turns.at(-1);
  const requests = (turn?.pendingApprovalRequests ?? []).filter(isActionableApprovalRequest);
  if (!turn || !requests.length) {
    return null;
  }

  const requestIndex = requests.length - 1;
  const request = requests[requestIndex];
  return {
    key: buildApprovalDialogKey(activeThread.id, turn.id, request, requestIndex),
    turn,
    request,
  };
}

function isActionableApprovalRequest(request: ApprovalRequest) {
  return request.historical !== true && request.kind !== 'plan-exit';
}

function buildApprovalDialogKey(
  threadId: string,
  turnId: string,
  request: ApprovalRequest,
  requestIndex: number,
) {
  const identity =
    request.requestId?.trim() ||
    request.command?.join(' ') ||
    request.title.trim() ||
    `${requestIndex}`;
  return `${threadId}:${turnId}:${identity}`;
}

type TodoDockStatus = 'pending' | 'in_progress' | 'completed' | 'unknown';

type TodoDockPreview = {
  todos: Array<{
    content: string;
    status: TodoDockStatus;
  }>;
  counts: Record<TodoDockStatus, number>;
};

function getLatestTodoWritePreview(activeThread: ThreadDetail | null): TodoDockPreview | null {
  if (!activeThread) {
    return null;
  }

  for (let turnIndex = activeThread.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = activeThread.turns[turnIndex];
    if (!isActiveTaskDockTurn(turn)) {
      continue;
    }

    for (let toolIndex = turn.tools.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const preview = getTodoWritePreviewFromTool(turn.tools[toolIndex]);
      if (preview) {
        return hasOpenTodoDockItems(preview) ? preview : null;
      }
    }
  }

  return null;
}

function isActiveTaskDockTurn(turn: ConversationTurn) {
  return turn.status === 'pending' || turn.status === 'running';
}

function getTodoWritePreviewFromTool(tool: ToolStep): TodoDockPreview | null {
  if (normalizeToolName(tool.name) !== 'todowrite') {
    return null;
  }

  const input = parseToolJson(tool.inputText);
  if (!input || !Array.isArray(input.todos)) {
    return null;
  }

  const todos = input.todos
    .map((item) => normalizeTodoDockItem(item))
    .filter((item): item is TodoDockPreview['todos'][number] => Boolean(item));
  if (!todos.length) {
    return null;
  }

  const counts: Record<TodoDockStatus, number> = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    unknown: 0,
  };
  todos.forEach((todo) => {
    counts[todo.status] += 1;
  });

  return { todos, counts };
}

function normalizeTodoDockItem(item: unknown) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const record = item as Record<string, unknown>;
  const content = getStringValue(record.content) ?? getStringValue(record.text) ?? getStringValue(record.title);
  if (!content) {
    return null;
  }

  return {
    content,
    status: normalizeTodoDockStatus(getStringValue(record.status)),
  };
}

function normalizeTodoDockStatus(status?: string): TodoDockStatus {
  switch (status) {
    case 'pending':
    case 'in_progress':
    case 'completed':
      return status;
    default:
      return 'unknown';
  }
}

function formatTodoDockSummary(preview: TodoDockPreview) {
  return `共 ${preview.todos.length} 个任务，已经完成 ${preview.counts.completed} 个`;
}

function hasOpenTodoDockItems(preview: TodoDockPreview) {
  return preview.counts.pending > 0 || preview.counts.in_progress > 0 || preview.counts.unknown > 0;
}

function parseToolJson(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getStringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeToolName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
