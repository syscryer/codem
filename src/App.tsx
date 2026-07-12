import { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitCommitHorizontal, ListChecks } from 'lucide-react';
import { AppMenubar } from './components/AppMenubar';
import { ChatHeader } from './components/ChatHeader';
import { CloneRepositoryDialog } from './components/CloneRepositoryDialog';
import { Composer } from './components/Composer';
import { ConversationPane } from './components/ConversationPane';
import { Dialogs } from './components/Dialogs';
import { GitDialog } from './components/GitDialog';
import { GitHistoryPanel } from './components/GitHistoryPanel';
import { RightWorkbench } from './components/RightWorkbench';
import { SessionSearchDialog } from './components/SessionSearchDialog';
import { SidebarProjects } from './components/SidebarProjects';
import { SettingsView } from './components/settings/SettingsView';
import { TerminalDock, useTerminalDockState, type TerminalRunRequest } from './components/TerminalDock';
import { TooltipLayer } from './components/TooltipLayer';
import { WorktreeCreateDialog } from './components/WorktreeCreateDialog';
import { WorkspaceStatus } from './components/WorkspaceStatus';
import { useClaudeRun } from './hooks/useClaudeRun';
import { useAgentRun } from './hooks/useAgentRun';
import { useAppSettings } from './hooks/useAppSettings';
import { useWorkspaceState } from './hooks/useWorkspaceState';
import { CLAUDE_CODE_PROVIDER_ID, GROK_BUILD_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID, resolveAccentColors, resolveChatFontStack, resolveCodeFontStack, resolveUiFontStack } from './constants';
import {
  buildCompactSlashCommandSubmission,
  buildContextSlashCardResult,
  buildCostSlashCardResult,
  buildStatusSlashCardResult,
} from './lib/claude-slash-system-commands';
import {
  closeWorkbenchPreviewTab,
  closeWorkbenchPreviewTabs,
  openWorkbenchPreviewTab,
  normalizeWorkbenchPreviewRequest,
  resolveWorkbenchPreviewContentOnOpen,
} from './lib/workbench-preview';
import { matchesShortcut } from './lib/shortcuts';
import { createSystemCommandItem, settleSystemCommandItem } from './lib/system-command-items';
import { modelLabel, permissionLabel } from './lib/ui-labels';
import {
  getPlatformWindowMaterials,
  getSupportedWindowMaterials,
  isTauriRuntime,
  normalizeWindowMaterial,
  resolveDesktopPlatform,
  setWindowMaterial,
} from './lib/window-material';
import { getQueuedPromptGuideAvailability } from './lib/queued-prompts';
import { resolveChatRuntimeKind } from './lib/agent-provider-registry';
import { GLOBAL_NEW_CHAT_DRAFT_KEY } from './lib/new-chat-draft';
import { fetchGitRemote, pullGitBranch, undoConversationChanges } from './lib/git-api';
import { fetchThreadRuntimeStatuses } from './lib/thread-runtime-statuses';
import {
  buildGitOperationToastDetail,
  normalizeGitOperationToastMessage,
} from './lib/git-operation-toast-detail';
import { resolveTerminalDockPanelIdOnRun, shouldRenderTerminalDock } from './lib/terminal-dock-state';
import { calculateRightWorkbenchResizeWidth, clampRightWorkbenchWidth } from './lib/workbench-layout';
import { showThreadSystemNotification } from './lib/thread-system-notifications';
import {
  clearThreadActivityNotice,
  shouldRequestTaskbarAttention,
  shouldSendThreadSystemNotification,
  upsertThreadActivityNotice,
  type ThreadActivityNotice,
  type ThreadActivityNoticeMap,
} from './lib/thread-activity-notices';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ClaudeContextRequestState,
  ClaudeContextSnapshot,
  ConversationTurn,
  RequestUserInputRequest,
  RuntimeSuggestedAction,
  RightWorkbenchTab,
  SlashCommand,
  WorkbenchPreviewContentState,
  WorkbenchPreviewRequest,
  WorkbenchPreviewTab,
  SettingsSection,
  SystemCommandItem,
  ThreadDetail,
  ThreadRuntimeStatus,
  ThreadSummary,
  ToolStep,
  ProjectSummary,
  GitCreateWorktreeResult,
  InputContentBlock,
  UndoConversationChange,
  UserImageAttachment,
  WindowMaterialMode,
} from './types';

type AppView = { kind: 'workspace' } | { kind: 'settings'; section: SettingsSection };

type AppLocation =
  | { kind: 'workspace'; projectId: string | null; threadId: string | null }
  | { kind: 'settings'; section: SettingsSection };

type NavigationHistory = {
  past: AppLocation[];
  future: AppLocation[];
};

type GitOperationToastContext = {
  operation: string;
  target?: string;
  branch?: string;
  command?: string;
};

type ComposerSubmission = {
  prompt: string;
  displayText: string;
  attachments?: UserImageAttachment[];
  contentBlocks?: InputContentBlock[];
  queueId?: string;
  queueStatus?: 'preparing' | 'ready';
};

type ClaudeContextApiResponse =
  | { ok: true; context: ClaudeContextSnapshot }
  | { ok: false; error?: string; code?: string };

async function fetchClaudeRuntimeContext(threadId: string, timeoutMs = 12_000) {
  const response = await fetch(`/api/claude/runtime/${encodeURIComponent(threadId)}/context`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ timeoutMs }),
  });
  const payload = (await response.json().catch(() => null)) as ClaudeContextApiResponse | null;
  if (!response.ok) {
    throw new Error(payload && !payload.ok ? payload.error || '获取 Claude /context 信息失败' : '获取 Claude /context 信息失败');
  }
  if (!payload?.ok) {
    throw new Error(payload?.error || '获取 Claude /context 信息失败');
  }

  return payload.context;
}

function formatClaudeContextDisplayError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/没有可复用|stream-json|请先发送一轮消息/i.test(message)) {
    return '当前线程还没有可读取的上下文，请先发送一轮消息。';
  }
  if (/正在运行|正在进行|runtime-busy/i.test(message)) {
    return '当前会话还在处理中，稍后再查看上下文。';
  }
  if (/timeout|超时|限定时间/i.test(message)) {
    return '读取上下文超时，请稍后重试。';
  }

  return message || '读取上下文失败。';
}

const MAX_NAVIGATION_HISTORY = 60;

export default function App() {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const conversationBottomRef = useRef<HTMLDivElement | null>(null);
  const chatWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const appRootRef = useRef<HTMLDivElement | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const workspaceState = useWorkspaceState();
  const {
    projects,
    panelState,
    activeProjectId,
    activeThreadId,
    isNewChatDraft,
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
    pinnedThreads,
    pinnedProjects,
    unpinnedProjects,
    setSearchOpen,
    setSearchQuery,
    setInputDialog,
    setConfirmDialog,
    showToast,
    dismissToast,
    setToastDetailOpen,
    syncWorkspace,
    loadWorkspace,
    createThread,
    renameThread,
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
    enterNewChatDraft,
    setActiveProjectId,
    setActiveThreadId,
    clearNewChatDraft,
    handlePanelStateChange,
    togglePinThread,
    togglePinProject,
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
  const [gitDialogMode, setGitDialogMode] = useState<'push' | 'branch' | null>(null);
  const [rightWorkbenchOpen, setRightWorkbenchOpen] = useState(false);
  const [rightWorkbenchTab, setRightWorkbenchTab] = useState<RightWorkbenchTab>('overview');
  const [rightWorkbenchWidth, setRightWorkbenchWidth] = useState(680);
  const [chatWorkspaceWidth, setChatWorkspaceWidth] = useState(0);
  const [filePreviewTabs, setFilePreviewTabs] = useState<WorkbenchPreviewTab[]>([]);
  const [activeFilePreviewKey, setActiveFilePreviewKey] = useState('');
  const [reviewPreviewTabs, setReviewPreviewTabs] = useState<WorkbenchPreviewTab[]>([]);
  const [activeReviewPreviewKey, setActiveReviewPreviewKey] = useState('');
  const [previewContentByKey, setPreviewContentByKey] = useState<Record<string, WorkbenchPreviewContentState>>({});
  const [fileNavigatorManualVisibility, setFileNavigatorManualVisibility] = useState<boolean | null>(null);
  const [undoneTurnIds, setUndoneTurnIds] = useState<Record<string, boolean>>({});
  const [composerDraftsByKey, setComposerDraftsByKey] = useState<Record<string, string>>({});
  const [claudeContextByThreadId, setClaudeContextByThreadId] = useState<Record<string, ClaudeContextRequestState>>({});
  const [projectsRefreshing, setProjectsRefreshing] = useState(false);
  const [worktreeCreateProject, setWorktreeCreateProject] = useState<ProjectSummary | null>(null);
  const [threadActivityNotices, setThreadActivityNotices] = useState<ThreadActivityNoticeMap>({});
  const [threadRuntimeStatuses, setThreadRuntimeStatuses] = useState<Record<string, ThreadRuntimeStatus>>({});
  const activeThreadIdRef = useRef<string | null>(activeThreadId);
  const windowFocusedRef = useRef(isAppWindowFocused());
  const systemNotificationKeysRef = useRef(new Set<string>());
  const taskbarAttentionRequestedRef = useRef(false);
  const terminalDock = useTerminalDockState();
  const terminalDockAvailable = isTauriRuntime();
  const [terminalRunRequest, setTerminalRunRequest] = useState<TerminalRunRequest | null>(null);
  const [dockActivePanelId, setDockActivePanelId] = useState<'terminal' | 'git-history'>('terminal');
  const dockExtraPanels = useMemo(
    () => (activeProject?.isGitRepo
      ? [
          {
            id: 'git-history' as const,
            title: 'Git 日志',
            icon: <GitCommitHorizontal size={14} />,
            content: (
              <GitHistoryPanel
                project={activeProject}
                onClose={terminalDock.toggle}
                onLoadBranches={loadProjectGitBranches}
                onSwitchBranch={switchProjectGitBranch}
                onWorkspaceChanged={() => loadWorkspace()}
                showToast={showToast}
              />
            ),
          },
        ]
      : []),
    [activeProject, loadProjectGitBranches, loadWorkspace, showToast, switchProjectGitBranch, terminalDock.toggle],
  );
  const shouldShowDock = shouldRenderTerminalDock({
    isOpen: terminalDock.open,
    terminalAvailable: terminalDockAvailable,
    extraPanelIds: dockExtraPanels.map((panel) => panel.id),
  });
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

  const handleThreadActivityNotice = useCallback((notice: ThreadActivityNotice) => {
    const windowFocused = windowFocusedRef.current;
    const activeThreadIdSnapshot = activeThreadIdRef.current;

    setThreadActivityNotices((current) =>
      upsertThreadActivityNotice(current, notice, activeThreadIdSnapshot),
    );

    if (
      shouldSendThreadSystemNotification(
        notice.kind,
        windowFocused,
        general.enableThreadSystemNotifications,
      ) &&
      !systemNotificationKeysRef.current.has(notice.key)
    ) {
      systemNotificationKeysRef.current.add(notice.key);
      void showThreadSystemNotification(notice);
    }

    if (shouldRequestTaskbarAttention(notice.kind, windowFocused) && !taskbarAttentionRequestedRef.current) {
      taskbarAttentionRequestedRef.current = true;
      void requestTaskbarAttention();
    }
  }, [general.enableThreadSystemNotifications]);

  useEffect(() => {
    const root = appRootRef.current;
    if (!root) {
      return;
    }
    if (appearance.sidebarCustomWidth) {
      root.style.setProperty('--sidebar-width', `${appearance.sidebarCustomWidth}px`);
    } else {
      root.style.removeProperty('--sidebar-width');
    }
  }, [appearance.sidebarCustomWidth]);

  useEffect(() => {
    if (!activeProject?.isGitRepo && dockActivePanelId === 'git-history') {
      setDockActivePanelId('terminal');
    }
  }, [activeProject?.isGitRepo, dockActivePanelId]);
  const wasRunningRef = useRef(false);
  const materialErrorShownRef = useRef(false);
  const activeThreadRuntimeKind = resolveChatRuntimeKind(activeThreadSummary?.provider ?? '');
  const {
    workspace,
    permissionMode: claudePermissionMode,
    model,
    effort,
    models,
    claudeModels,
    health,
    backendRunId: claudeBackendRunId,
    isRunning: claudeIsRunning,
    runningThreadIds: claudeRunningThreadIds,
    activeRunsByThreadId: claudeActiveRunsByThreadId,
    activeTurnIdsByThreadId: claudeActiveTurnIdsByThreadId,
    queuedPrompts: claudeQueuedPrompts,
    removeQueuedPrompt,
    recallQueuedPrompt,
    guideQueuedPrompt,
    clockNowMs,
    setModel,
    setEffort,
    handlePermissionModeSelect: handleClaudePermissionModeSelect,
    submitPrompt: submitClaudePrompt,
    submitPromptToThread,
    submitRequestUserInput: submitClaudeRequestUserInput,
    submitRuntimeRecoveryAction,
    submitApprovalDecision: submitClaudeApprovalDecision,
    stopRun: stopClaudeRun,
  } = useClaudeRun({
    activeProjectId,
    activeProjectPath: activeProject?.path,
    activeThreadId: activeThreadSummary?.provider === CLAUDE_CODE_PROVIDER_ID ? activeThreadId : null,
    activeThreadSummary:
      activeThreadSummary?.provider === CLAUDE_CODE_PROVIDER_ID ? activeThreadSummary : null,
    appModelSettings,
    defaultPermissionMode: general.defaultPermissionMode,
    autoGuideQueuedPrompts: general.autoGuideQueuedPrompts,
    createThread,
    renameThread,
    handlePickProjectDirectory,
    showToast,
    updateThreadDetail,
    updateThreadTurn,
    appendDebug,
    appendRawEvent,
    schedulePersistThreadHistory,
    persistThreadMetadata,
    clearActiveTurnSelection: () => undefined,
    onThreadActivityNotice: handleThreadActivityNotice,
  });

  const {
    providers: agentProviders,
    providersLoading: agentProvidersLoading,
    providersError: agentProvidersError,
    draftProviderId,
    permissionMode: genericAgentPermissionMode,
    model: genericAgentModel,
    reasoningEffort: genericAgentReasoningEffort,
    modelCatalog: genericAgentModelCatalog,
    modelsLoading: genericAgentModelsLoading,
    modelsError: genericAgentModelsError,
    modelSelectionWarning: genericAgentModelSelectionWarning,
    selectDraftProvider,
    resetDraftProvider,
    handlePermissionModeSelect: handleGenericAgentPermissionModeSelect,
    handleModelSelect: handleGenericAgentModelSelect,
    handleReasoningEffortSelect: handleGenericAgentReasoningEffortSelect,
    retryModelCatalog: retryGenericAgentModelCatalog,
    isRunning: genericAgentIsRunning,
    runningThreadIds: genericAgentRunningThreadIds,
    activeRunsByThreadId: genericAgentActiveRunsByThreadId,
    activeTurnIdsByThreadId: genericAgentActiveTurnIdsByThreadId,
    submitPrompt: submitGenericAgentPrompt,
    submitRequestUserInput: submitGenericAgentRequestUserInput,
    submitApprovalDecision: submitGenericAgentApprovalDecision,
    stopRun: stopGenericAgentRun,
  } = useAgentRun({
    activeProjectId,
    activeProjectPath: activeProject?.path,
    activeThreadId: activeThreadRuntimeKind === 'generic' ? activeThreadId : null,
    activeThreadSummary:
      activeThreadRuntimeKind === 'generic' ? activeThreadSummary : null,
    createThread,
    renameThread,
    handlePickProjectDirectory,
    showToast,
    updateThreadDetail,
    updateThreadTurn,
    appendDebug,
    schedulePersistThreadHistory,
    persistThreadMetadata,
    onThreadActivityNotice: handleThreadActivityNotice,
  });

  const activeProviderId = activeThreadSummary?.provider || draftProviderId;
  const activeRuntimeKind = resolveChatRuntimeKind(activeProviderId);
  const activeUsesClaude = activeRuntimeKind === 'claude';
  const activeUsesGenericAgent = activeRuntimeKind === 'generic';
  const activeAgent = activeUsesClaude
    ? 'claude' as const
    : activeProviderId === GROK_BUILD_PROVIDER_ID
      ? 'grok' as const
      : activeProviderId === OPENAI_CODEX_PROVIDER_ID
        ? 'codex' as const
        : 'generic' as const;
  const activeProviderDisplayName = agentProviders.find((provider) => provider.id === activeProviderId)?.displayName
    ?? (activeProviderId === OPENAI_CODEX_PROVIDER_ID ? 'OpenAI Codex' : activeProviderId);
  const permissionMode = activeUsesClaude ? claudePermissionMode : genericAgentPermissionMode;
  const handlePermissionModeSelect = activeUsesClaude
    ? handleClaudePermissionModeSelect
    : handleGenericAgentPermissionModeSelect;
  const runningThreadIds = useMemo(
    () => Array.from(new Set([...claudeRunningThreadIds, ...genericAgentRunningThreadIds])),
    [claudeRunningThreadIds, genericAgentRunningThreadIds],
  );
  const activeRunsByThreadId = useMemo(
    () => ({ ...claudeActiveRunsByThreadId, ...genericAgentActiveRunsByThreadId }),
    [claudeActiveRunsByThreadId, genericAgentActiveRunsByThreadId],
  );
  const activeTurnIdsByThreadId = useMemo(
    () => ({ ...claudeActiveTurnIdsByThreadId, ...genericAgentActiveTurnIdsByThreadId }),
    [claudeActiveTurnIdsByThreadId, genericAgentActiveTurnIdsByThreadId],
  );
  const isRunning = claudeIsRunning || genericAgentIsRunning;
  const backendRunId = activeUsesClaude
    ? claudeBackendRunId
    : activeUsesGenericAgent && activeThreadId
      ? genericAgentActiveRunsByThreadId[activeThreadId]?.runId ?? ''
      : '';
  const queuedPrompts = activeUsesClaude ? claudeQueuedPrompts : [];

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
    if (!activeThreadId) {
      return;
    }

    setThreadActivityNotices((current) => clearThreadActivityNotice(current, activeThreadId));
  }, [activeThreadId]);

  useEffect(() => {
    let cancelled = false;

    async function refreshThreadRuntimeStatuses() {
      const statuses = await fetchThreadRuntimeStatuses();
      if (!cancelled) {
        setThreadRuntimeStatuses(statuses);
      }
    }

    void refreshThreadRuntimeStatuses();
    const timer = window.setInterval(() => void refreshThreadRuntimeStatuses(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    function updateWindowFocusState() {
      const focused = isAppWindowFocused();
      windowFocusedRef.current = focused;
      if (focused && taskbarAttentionRequestedRef.current) {
        taskbarAttentionRequestedRef.current = false;
        void clearTaskbarAttention();
      }
    }

    updateWindowFocusState();
    window.addEventListener('focus', updateWindowFocusState);
    window.addEventListener('blur', updateWindowFocusState);
    document.addEventListener('visibilitychange', updateWindowFocusState);
    return () => {
      window.removeEventListener('focus', updateWindowFocusState);
      window.removeEventListener('blur', updateWindowFocusState);
      document.removeEventListener('visibilitychange', updateWindowFocusState);
    };
  }, []);

  const currentAppLocation: AppLocation =
    appView.kind === 'settings'
      ? { kind: 'settings', section: appView.section }
      : { kind: 'workspace', projectId: activeProjectId, threadId: isNewChatDraft ? null : activeThreadId };
  const activeSettingsSection = appView.kind === 'settings' ? appView.section : 'appearance';
  const canNavigateBack = navigationHistory.past.length > 0;
  const canNavigateForward = navigationHistory.future.length > 0;
  const runtimePlatform = useMemo(() => resolveDesktopPlatform(), []);
  const [supportedWindowMaterials, setSupportedWindowMaterials] = useState<WindowMaterialMode[]>(
    () => getPlatformWindowMaterials(runtimePlatform),
  );
  const accentColors = resolveAccentColors(appearance);
  const uiFontStack = resolveUiFontStack(appearance);
  const chatFontStack = resolveChatFontStack(appearance);
  const codeFontStack = resolveCodeFontStack(appearance);
  const effectiveWindowMaterial = normalizeWindowMaterial(appearance.windowMaterial, supportedWindowMaterials);
  const effectiveRightWorkbenchWidth =
    rightWorkbenchOpen && chatWorkspaceWidth > 0
      ? clampRightWorkbenchWidth(rightWorkbenchWidth, chatWorkspaceWidth)
      : rightWorkbenchWidth;

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let cancelled = false;
    void getSupportedWindowMaterials().then((materials) => {
      if (!cancelled) {
        setSupportedWindowMaterials(materials);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (settingsLoading || appearance.windowMaterial === effectiveWindowMaterial) {
      return;
    }

    updateAppearance({ windowMaterial: effectiveWindowMaterial });
  }, [appearance.windowMaterial, effectiveWindowMaterial, settingsLoading, updateAppearance]);

  useEffect(() => {
    if (settingsLoading || !isTauriRuntime()) {
      return;
    }

    let cancelled = false;
    void setWindowMaterial(effectiveWindowMaterial).then((handled) => {
      if (!handled && !cancelled && !materialErrorShownRef.current) {
        materialErrorShownRef.current = true;
        showToast('窗口材质应用失败，请确认当前 Windows 版本支持该材质。', 'error');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [effectiveWindowMaterial, settingsLoading, showToast]);

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
    setFilePreviewTabs([]);
    setActiveFilePreviewKey('');
    setReviewPreviewTabs([]);
    setActiveReviewPreviewKey('');
    setPreviewContentByKey({});
  }, [activeProject?.id]);

  useEffect(() => {
    const workspaceElement = chatWorkspaceRef.current;
    if (!workspaceElement) {
      return;
    }
    const observedWorkspaceElement = workspaceElement;

    let rafId: number | null = null;
    function updateWorkspaceWidth() {
      if (rafId !== null) {
        return;
      }
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const newWidth = Math.round(observedWorkspaceElement.getBoundingClientRect().width);
        setChatWorkspaceWidth((prevWidth) => (prevWidth === newWidth ? prevWidth : newWidth));
      });
    }

    updateWorkspaceWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWorkspaceWidth);
      return () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }
        window.removeEventListener('resize', updateWorkspaceWidth);
      };
    }

    const observer = new ResizeObserver(updateWorkspaceWidth);
    observer.observe(observedWorkspaceElement);
    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      observer.disconnect();
    };
  }, []);

  const openSessionSearch = useCallback(() => {
    setSearchQuery('');
    setSearchOpen(true);
  }, [setSearchOpen, setSearchQuery]);

  const closeSessionSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
  }, [setSearchOpen, setSearchQuery]);

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
        openSessionSearch();
        return;
      }

      if (matchesShortcut(event, shortcuts.toggleDebug)) {
        event.preventDefault();
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [appView.kind, handleCreatePrimaryChat, openSessionSearch, shortcuts]);

  const composerDraftKey = activeThreadId ?? GLOBAL_NEW_CHAT_DRAFT_KEY;
  const composerDraft = composerDraftsByKey[composerDraftKey] ?? '';
  const historyClaudeContextState = activeThread?.claudeContext
    ? {
        status: 'success' as const,
        context: activeThread.claudeContext,
        updatedAtMs: activeThread.claudeContext.requestedAtMs,
      }
    : undefined;
  const activeClaudeContextState = activeThreadId
    ? claudeContextByThreadId[activeThreadId] ?? historyClaudeContextState ?? { status: 'idle' as const }
    : { status: 'idle' as const };
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

  async function handleSubmitPrompt(submission: ComposerSubmission) {
    if (activeUsesClaude) {
      return submitClaudePrompt(submission);
    }

    if (!activeUsesGenericAgent) {
      showToast('当前 Provider 尚未接入主聊天，请新建聊天并选择可用 Provider。', 'error');
      return false;
    }

    const hasUnsupportedInput = Boolean(
      submission.attachments?.length ||
      submission.contentBlocks?.some((block) => block.type !== 'text'),
    );
    if (hasUnsupportedInput) {
      showToast(`${activeProviderDisplayName} 首期仅支持文本输入，请新建 Claude Code 聊天使用附件。`, 'info');
      return false;
    }
    return submitGenericAgentPrompt({
      prompt: submission.prompt,
      displayText: submission.displayText,
    });
  }

  async function handleSubmitRequestUserInput(
    turn: ConversationTurn,
    request: RequestUserInputRequest,
    answers: Record<string, string>,
  ) {
    if (activeUsesGenericAgent) {
      return submitGenericAgentRequestUserInput(turn, request, answers);
    }
    if (activeUsesClaude) {
      return submitClaudeRequestUserInput(turn, request, answers);
    }
    showToast('当前 Provider 不支持这个交互。', 'error');
    return false;
  }

  async function handleSubmitApprovalDecision(
    turn: ConversationTurn,
    request: ApprovalRequest,
    decision: ApprovalDecision,
  ) {
    if (activeUsesGenericAgent) {
      return submitGenericAgentApprovalDecision(turn, request, decision);
    }
    if (activeUsesClaude) {
      return submitClaudeApprovalDecision(turn, request, decision);
    }
    showToast('当前 Provider 不支持这个交互。', 'error');
    return false;
  }

  function handleStopRun(threadId = activeThreadId ?? undefined) {
    const provider = threadId
      ? projects.flatMap((project) => project.threads).find((thread) => thread.id === threadId)?.provider
      : activeProviderId;
    const runtimeKind = resolveChatRuntimeKind(provider ?? '');
    if (runtimeKind === 'generic') {
      return stopGenericAgentRun(threadId);
    }
    if (runtimeKind === 'claude') {
      return stopClaudeRun(threadId);
    }
    showToast('当前 Provider 没有可停止的运行。', 'error');
  }

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

  const handleRefreshClaudeContext = useCallback(async () => {
    const threadId = activeThreadId;
    if (!threadId) {
      return;
    }
    const historyContext = activeThread?.id === threadId ? activeThread.claudeContext : undefined;

    setClaudeContextByThreadId((current) => ({
      ...current,
      [threadId]: {
        status: 'loading',
        context: current[threadId]?.context ?? historyContext,
        updatedAtMs: Date.now(),
      },
    }));

    try {
      const context = await fetchClaudeRuntimeContext(threadId);

      setClaudeContextByThreadId((current) => ({
        ...current,
        [threadId]: {
          status: 'success',
          context,
          updatedAtMs: Date.now(),
        },
      }));
    } catch (error) {
      const message = formatClaudeContextDisplayError(error);
      setClaudeContextByThreadId((current) => ({
        ...current,
        [threadId]: {
          status: 'error',
          context: current[threadId]?.context ?? historyContext,
          error: message,
          updatedAtMs: Date.now(),
        },
      }));
    }
  }, [activeThread?.claudeContext, activeThread?.id, activeThreadId]);

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
    setThreadActivityNotices((current) => clearThreadActivityNotice(current, threadId));
    await selectThread(projectId, threadId);
  }

  async function handleSelectProject(projectId: string) {
    const nextLocation: AppLocation = { kind: 'workspace', projectId, threadId: null };
    if (!isSameAppLocation(currentAppLocation, nextLocation)) {
      rememberCurrentLocation();
    }
    setAppView({ kind: 'workspace' });
    if (isNewChatDraft) {
      await enterNewChatDraft(projectId);
      return;
    }
    await selectProject(projectId);
  }

  async function handleRefreshProjects() {
    if (projectsRefreshing) {
      return;
    }

    setProjectsRefreshing(true);
    try {
      await loadWorkspace();
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

  async function handleCreateThread(projectId: string) {
    const nextLocation: AppLocation = { kind: 'workspace', projectId, threadId: null };
    if (!isSameAppLocation(currentAppLocation, nextLocation)) {
      rememberCurrentLocation();
    }
    setAppView({ kind: 'workspace' });
    resetDraftProvider();
    await enterNewChatDraft(projectId);
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
      let nativeContext: ClaudeContextSnapshot | undefined;
      let contextError: string | undefined;

      try {
        nativeContext = await fetchClaudeRuntimeContext(thread.id);
        setClaudeContextByThreadId((current) => ({
          ...current,
          [thread.id]: {
            status: 'success',
            context: nativeContext,
            updatedAtMs: Date.now(),
          },
        }));
      } catch (error) {
        contextError = formatClaudeContextDisplayError(error);
        setClaudeContextByThreadId((current) => ({
          ...current,
          [thread.id]: {
            status: 'error',
            context: current[thread.id]?.context,
            error: contextError,
            updatedAtMs: Date.now(),
          },
        }));
      }

      const result = buildContextSlashCardResult({
        turns,
        modelLabel: modelLabel(models.find((item) => item.id === model) ?? model),
        nativeContext,
      });
      appendSystemCommandTurn(
        thread,
        submittedText,
        settleSystemCommandItem(createSystemCommandItem(submittedText, result.title, result.cardType), {
          state: contextError ? 'error' : 'done',
          summary: contextError ? '读取上下文失败' : result.summary,
          details: contextError
            ? {
                ...result.details,
                error: contextError,
                usageSource: 'context read failed',
              }
            : result.details,
          errorMessage: contextError,
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
      clearNewChatDraft();
      setActiveProjectId(null);
      setActiveThreadId(null);
      return;
    }

    const project = projects.find((item) => item.id === location.projectId);
    if (!project) {
      clearNewChatDraft();
      setActiveProjectId(null);
      setActiveThreadId(null);
      return;
    }

    if (!location.threadId) {
      void enterNewChatDraft(project.id);
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
    setRightWorkbenchTab('review');
    if (activeProjectId) {
      void refreshProjectGitSummary(activeProjectId);
    }
  }

  function openGitCommitWorkbench() {
    if (!activeProject?.isGitRepo) {
      showToast('请先选择 Git 项目。', 'info');
      return;
    }
    setRightWorkbenchOpen(true);
    setRightWorkbenchTab('review');
    if (activeProjectId) {
      void refreshProjectGitSummary(activeProjectId);
    }
  }

  function openGitHistoryDock() {
    if (!activeProject?.isGitRepo) {
      showToast('请先选择 Git 项目。', 'info');
      return;
    }
    terminalDock.openDock();
    setDockActivePanelId('git-history');
  }

  function openFilesWorkbench() {
    setRightWorkbenchOpen(true);
    setRightWorkbenchTab('files');
  }

  async function handleGitFetch(project: ProjectSummary | null = activeProject) {
    if (!project?.isGitRepo) {
      showToast('当前项目不是 Git 仓库。', 'info');
      return;
    }

    const fetchToastContext: GitOperationToastContext = {
      operation: '获取远端',
      target: project.name,
      branch: project.gitBranch,
      command: 'git fetch --all --prune',
    };
    try {
      await fetchGitRemote(project.id);
      await refreshProjectGitSummary(project.id);
      showGitOperationSuccessToast(
        fetchToastContext,
        project.id === activeProjectId ? '远端信息已更新' : `“${project.name}”远端信息已更新`,
      );
    } catch (error) {
      showGitOperationErrorToast(fetchToastContext, error, '获取远端失败');
      if (isGitOperationStateError(error)) {
        openGitCommitWorkbench();
      }
    }
  }

  async function handleGitPull(project: ProjectSummary | null = activeProject) {
    if (!project?.isGitRepo) {
      showToast('当前项目不是 Git 仓库。', 'info');
      return;
    }

    const pullToastContext: GitOperationToastContext = {
      operation: '拉取',
      target: project.name,
      branch: project.gitBranch,
      command: 'git pull --ff-only',
    };
    try {
      const result = await pullGitBranch(project.id);
      await refreshProjectGitSummary(project.id);
      const commitCount = result.commitsPulled ?? 0;
      const fileCount = result.filesChanged ?? 0;
      const message =
        commitCount > 0
          ? `拉取完成：${commitCount} 个提交，${fileCount} 个文件`
          : '已经是最新版本';
      showGitOperationSuccessToast(
        pullToastContext,
        project.id === activeProjectId ? message : `“${project.name}”${message}`,
      );
    } catch (error) {
      showGitOperationErrorToast(pullToastContext, error, '拉取失败');
      if (isGitOperationStateError(error)) {
        openGitCommitWorkbench();
      }
    }
  }

  function showGitOperationSuccessToast(
    context: GitOperationToastContext,
    fallbackMessage: string,
  ) {
    showToast(fallbackMessage, 'success', {
      title: formatGitOperationToastTitle(context.operation, '完成'),
    });
  }

  function showGitOperationErrorToast(
    context: GitOperationToastContext,
    error: unknown,
    fallbackMessage: string,
  ) {
    const errorText = error instanceof Error ? error.message : fallbackMessage;
    showToast(normalizeGitOperationToastMessage(errorText, fallbackMessage), 'error', {
      title: formatGitOperationToastTitle(context.operation, '失败'),
      detail: buildGitOperationToastDetail({
        ...context,
        result: '失败',
        errorText,
      }),
    });
  }

  function openWorkbenchPreview(request: WorkbenchPreviewRequest) {
    if (!activeProject) {
      showToast('请先选择项目。', 'info');
      return;
    }

    const normalizedRequest = normalizeWorkbenchPreviewRequest(request, activeProject.path);
    const reviewRequest =
      normalizedRequest.source === 'conversation-card' || normalizedRequest.source === 'changed-file';
    const setTabs = reviewRequest ? setReviewPreviewTabs : setFilePreviewTabs;
    const setActiveKey = reviewRequest ? setActiveReviewPreviewKey : setActiveFilePreviewKey;

    setTabs((currentTabs) => openWorkbenchPreviewTab(currentTabs, normalizedRequest).tabs);
    setActiveKey(normalizedRequest.key);
    setPreviewContentByKey((current) => resolveWorkbenchPreviewContentOnOpen(current, normalizedRequest));
    setRightWorkbenchOpen(true);
    setRightWorkbenchTab(reviewRequest ? 'review' : 'files');
  }

  async function handleOpenOutputPath(targetPath: string) {
    const response = await fetch('/api/system/open-path', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: targetPath }),
    });
    if (!response.ok) {
      showToast(await response.text(), 'error');
    }
  }

  async function handleRevealOutputPath(targetPath: string) {
    const response = await fetch('/api/system/open-path', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: targetPath, mode: 'reveal' }),
    });
    if (!response.ok) {
      showToast(await response.text(), 'error');
    }
  }

  function closeWorkbenchPreview(kind: 'file' | 'review', tabKey: string) {
    const setTabs = kind === 'review' ? setReviewPreviewTabs : setFilePreviewTabs;
    const activeKey = kind === 'review' ? activeReviewPreviewKey : activeFilePreviewKey;
    const setActiveKey = kind === 'review' ? setActiveReviewPreviewKey : setActiveFilePreviewKey;

    setTabs((currentTabs) => {
      const next = closeWorkbenchPreviewTab(currentTabs, activeKey, tabKey);
      setActiveKey(next.activeKey);
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

  function closeWorkbenchPreviewMany(kind: 'file' | 'review', tabKeys: string[]) {
    const setTabs = kind === 'review' ? setReviewPreviewTabs : setFilePreviewTabs;
    const activeKey = kind === 'review' ? activeReviewPreviewKey : activeFilePreviewKey;
    const setActiveKey = kind === 'review' ? setActiveReviewPreviewKey : setActiveFilePreviewKey;

    setTabs((currentTabs) => {
      const next = closeWorkbenchPreviewTabs(currentTabs, activeKey, tabKeys);
      const closingSet = new Set(tabKeys);
      setActiveKey(next.activeKey);
      setPreviewContentByKey((current) => {
        let changed = false;
        const updated = { ...current };
        for (const key of closingSet) {
          if (key in updated) {
            delete updated[key];
            changed = true;
          }
        }
        return changed ? updated : current;
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
    const workspaceElement = chatWorkspaceRef.current;
    const workspaceWidth = workspaceElement?.getBoundingClientRect().width ?? window.innerWidth;
    const startWidth = clampRightWorkbenchWidth(effectiveRightWorkbenchWidth, workspaceWidth);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    let rafId: number | null = null;
    let latestClientX = startX;

    function applyResize(currentX: number) {
      const containerWidth = workspaceElement?.getBoundingClientRect().width ?? window.innerWidth;
      setRightWorkbenchWidth(
        calculateRightWorkbenchResizeWidth({
          startWidth,
          startX,
          currentX,
          containerWidth,
        }),
      );
    }

    function scheduleResize() {
      if (rafId !== null) {
        return;
      }
      rafId = requestAnimationFrame(() => {
        rafId = null;
        applyResize(latestClientX);
      });
    }

    function handlePointerMove(pointerEvent: PointerEvent) {
      latestClientX = pointerEvent.clientX;
      scheduleResize();
    }

    function handlePointerUp(pointerEvent: PointerEvent) {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      latestClientX = pointerEvent.clientX;
      applyResize(latestClientX);
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
      data-platform={runtimePlatform}
      data-window-material={effectiveWindowMaterial}
      data-density={appearance.density}
      data-sidebar-width={appearance.sidebarWidth}
      style={{
        '--app-accent-light': accentColors.light,
        '--app-accent-dark': accentColors.dark,
        '--app-ui-font-family': uiFontStack,
        '--app-chat-font-family': chatFontStack,
        '--app-code-font-family': codeFontStack,
        '--app-ui-font-size': `${appearance.uiFontSize}px`,
        '--app-chat-font-size': `${appearance.chatFontSize}px`,
        '--app-code-font-size': `${appearance.codeFontSize}px`,
      } as CSSProperties}
      ref={appRootRef}
    >
      <AppMenubar
        platform={runtimePlatform}
        sidebarVisible={sidebarVisible}
        windowMaterial={effectiveWindowMaterial}
        supportedWindowMaterials={supportedWindowMaterials}
        canNavigateBack={canNavigateBack}
        canNavigateForward={canNavigateForward}
        onToggleSidebar={() => setSidebarVisible((value) => !value)}
        onNavigateBack={navigateBack}
        onNavigateForward={navigateForward}
        onNewChat={() => void handleCreatePrimaryChat()}
        onOpenFolder={() => void handlePickProjectDirectory()}
        onOpenCloneDialog={() => setCloneDialogOpen(true)}
        onOpenSettings={() => openSettings('appearance')}
        onOpenSearch={openSessionSearch}
        onSelectWindowMaterial={(windowMaterial) => updateAppearance({ windowMaterial })}
        onShowAbout={showAbout}
        onShowShortcuts={showShortcuts}
        onUnsupportedWindowAction={handleUnsupportedWindowAction}
      />

      <SettingsView
        hidden={appView.kind !== 'settings'}
        activeSection={activeSettingsSection}
        activeProjectId={activeProjectId}
        activeThreadId={activeThreadId}
        activeProject={activeProject}
        projects={projects}
        runningThreadIds={runningThreadIds}
        general={general}
        appearance={appearance}
        effectiveWindowMaterial={effectiveWindowMaterial}
        supportedWindowMaterials={supportedWindowMaterials}
        models={appModelSettings}
        shortcuts={shortcuts}
        openWith={openWith}
        openTargets={openTargets}
        claudeModels={claudeModels}
        onSelectSection={(section) => navigateToLocation({ kind: 'settings', section })}
        onOpenThread={handleSelectThread}
        onRemoveProject={openRemoveProjectDialog}
        onRenameThread={openRenameThreadDialog}
        onRemoveThread={openRemoveThreadDialog}
        onOpenWorktreePath={openWorktreePath}
        onSyncWorkspace={syncWorkspace}
        showToast={showToast}
        onUpdateGeneral={updateGeneral}
        onUpdateAppearance={updateAppearance}
        onUpdateSidebarCustomWidth={(width) => updateAppearance({ sidebarCustomWidth: width })}
        onUpdateModels={updateModels}
        onUpdateShortcuts={updateShortcuts}
        onUpdateOpenWith={updateOpenWith}
        onReturnWorkspace={returnWorkspace}
      />
      <div
        className={`codex-shell${sidebarVisible ? '' : ' sidebar-hidden'}`}
        hidden={appView.kind === 'settings'}
      >
          {sidebarVisible ? (
            <SidebarProjects
              activeProjectId={activeProjectId}
              activeThreadId={activeThreadId}
              isNewChatDraft={isNewChatDraft}
              runningThreadIds={runningThreadIds}
              threadActivityNotices={threadActivityNotices}
              threadRuntimeStatuses={threadRuntimeStatuses}
              cloneTasks={cloneTasks}
              pinnedThreads={pinnedThreads}
              pinnedProjects={pinnedProjects}
              unpinnedProjects={unpinnedProjects}
              onTogglePinThread={togglePinThread}
              onTogglePinProject={togglePinProject}
              collapsedProjects={collapsedProjects}
              panelState={panelState}
              onCreatePrimaryChat={() => void handleCreatePrimaryChat()}
              onToggleSearch={openSessionSearch}
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
              onSelectProject={handleSelectProject}
              onSelectThread={handleSelectThread}
              onOpenRenameThreadDialog={openRenameThreadDialog}
              onCopySessionId={handleCopySessionId}
              onOpenRemoveThreadDialog={handleOpenRemoveThreadDialog}
              onOpenSettings={() => openSettings('appearance')}
              onGitFetch={handleGitFetch}
              onGitPull={handleGitPull}
              sidebarCustomWidth={appearance.sidebarCustomWidth}
              onUpdateSidebarCustomWidth={(width) => updateAppearance({ sidebarCustomWidth: width })}
            />
          ) : null}

          <div
            ref={chatWorkspaceRef}
            className={`chat-workspace${rightWorkbenchOpen ? ' workbench-open' : ''}`}
            style={{
              '--right-workbench-width': `${effectiveRightWorkbenchWidth}px`,
            } as CSSProperties}
          >
            <main className="chat-shell">
              <ChatHeader
                activeProject={activeProject}
                activeThread={activeThread}
                isNewChatDraft={isNewChatDraft}
                openTargets={openTargets}
                selectedOpenTargetId={openWith.selectedTargetId}
                runAvailable={terminalDockAvailable}
                onRunLaunchScript={handleRunLaunchScript}
                onOpenTarget={(targetId) => activeProject ? void handleOpenProjectInEditor(activeProject, targetId) : showToast('请先选择项目。', 'info')}
                onSelectOpenTarget={(targetId) => void updateOpenWith({ selectedTargetId: targetId })}
                onOpenFilesWorkbench={openFilesWorkbench}
                onOpenGitCommit={openGitCommitWorkbench}
                onOpenGitPush={() => activeProject ? setGitDialogMode('push') : showToast('请先选择项目。', 'info')}
                onOpenGitBranch={() => activeProject ? setGitDialogMode('branch') : showToast('请先选择项目。', 'info')}
                onOpenGitHistory={openGitHistoryDock}
                onGitFetch={() => void handleGitFetch()}
                onGitPull={() => void handleGitPull()}
                terminalDockOpen={terminalDock.open}
                onToggleTerminalDock={terminalDock.toggle}
                terminalDockAvailable={terminalDockAvailable}
                rightWorkbenchOpen={rightWorkbenchOpen}
                onToggleRightWorkbench={() => setRightWorkbenchOpen((value) => !value)}
                onOpenReviewWorkbench={openReviewWorkbench}
                onTogglePinThread={togglePinThread}
                onOpenRenameThreadDialog={openRenameThreadDialog}
                onCopySessionId={handleCopySessionId}
                onOpenRemoveThreadDialog={handleOpenRemoveThreadDialog}
              />

              <ConversationPane
                activeThread={activeThread}
                isNewChatDraft={isNewChatDraft}
                activeProject={activeProject}
                activeProjectName={activeProject?.name}
                collapseIntermediateProcess={general.collapseIntermediateProcess}
                clockNowMs={clockNowMs}
                isRunning={Boolean(activeThreadId && runningThreadIds.includes(activeThreadId))}
                activeTurnId={activeThreadId ? activeTurnIdsByThreadId[activeThreadId] ?? '' : ''}
                transcriptRef={transcriptRef}
                bottomRef={conversationBottomRef}
              undoneTurnIds={undoneTurnIds}
              onOpenWorkbenchPreview={openWorkbenchPreview}
              onOpenOutputPath={handleOpenOutputPath}
              onRevealOutputPath={handleRevealOutputPath}
              onUndoChangedFiles={handleUndoChangedFiles}
                onSubmitRequestUserInput={(
                  turn: ConversationTurn,
                  request: RequestUserInputRequest,
                  answers: Record<string, string>,
                ) => handleSubmitRequestUserInput(turn, request, answers)}
                onSubmitRuntimeRecoveryAction={(turn: ConversationTurn, action: RuntimeSuggestedAction) =>
                  submitRuntimeRecoveryAction(turn, action)}
                onSubmitApprovalDecision={(
                  turn: ConversationTurn,
                  request: ApprovalRequest,
                  decision: ApprovalDecision,
                ) => handleSubmitApprovalDecision(turn, request, decision)}
              />

              <CurrentTaskDock activeThread={activeThread} />

              <Composer
                agent={activeAgent}
                providerId={activeProviderId}
                providers={agentProviders}
                providersLoading={agentProvidersLoading}
                providersError={agentProvidersError}
                canSelectProvider={!activeThreadSummary}
                allowAttachments={activeUsesClaude}
                supportsQueue={activeUsesClaude}
                workspace={workspace}
                permissionMode={permissionMode}
                model={model}
                effort={effort}
                models={models}
                agentModel={genericAgentModel}
                agentReasoningEffort={genericAgentReasoningEffort}
                agentModelCatalog={genericAgentModelCatalog}
                agentModelsLoading={genericAgentModelsLoading}
                agentModelsError={genericAgentModelsError}
                agentModelSelectionWarning={genericAgentModelSelectionWarning}
                turns={activeThread?.turns ?? []}
                claudeContextState={activeClaudeContextState}
                isRunning={Boolean(activeThreadId && runningThreadIds.includes(activeThreadId))}
                isInterrupting={Boolean(activeThreadId && activeRunsByThreadId[activeThreadId]?.interrupting)}
                draftScopeKey={composerDraftKey}
                draft={composerDraft}
                queuedPrompts={queuedPrompts}
                queuedPromptGuideAvailability={queuedPromptGuideAvailability}
                onDraftChange={handleComposerDraftChange}
                onSelectProvider={selectDraftProvider}
                onSubmitPrompt={handleSubmitPrompt}
                onRemoveQueuedPrompt={removeQueuedPrompt}
                onRecallQueuedPrompt={handleRecallQueuedPrompt}
                onGuideQueuedPrompt={guideQueuedPrompt}
                showToast={showToast}
                onKeyDown={handleComposerKeyDown}
                onSelectPermissionMode={handlePermissionModeSelect}
                onSelectModel={setModel}
                onSelectEffort={setEffort}
                onSelectAgentModel={handleGenericAgentModelSelect}
                onSelectAgentReasoningEffort={handleGenericAgentReasoningEffortSelect}
                onRetryAgentModels={retryGenericAgentModelCatalog}
                onOpenPlugins={() => openSettings('plugins')}
                onCreateNewChat={() => void handleCreatePrimaryChat()}
                onStopRun={() => handleStopRun(activeThreadId ?? undefined)}
                onRunSlashSystemCommand={handleRunSlashSystemCommand}
                onRefreshClaudeContext={handleRefreshClaudeContext}
              />

              <WorkspaceStatus
                activeProject={activeProject}
                activeThread={activeThread}
                isActiveThreadRunning={Boolean(activeThreadId && runningThreadIds.includes(activeThreadId))}
                projects={projects}
                onLoadBranches={loadProjectGitBranches}
                onSelectBranch={switchProjectGitBranch}
                onOpenWorktreePath={openWorktreePath}
                onCreateWorktree={(project) => setWorktreeCreateProject(project)}
              />

              {shouldShowDock ? (
                <TerminalDock
                  isOpen={terminalDock.open}
                  onToggleOpen={terminalDock.toggle}
                  defaultWorkspace={activeProject}
                  runRequest={terminalRunRequest}
                  activePanelId={dockActivePanelId}
                  onActivePanelChange={(panelId) => setDockActivePanelId(panelId === 'git-history' ? 'git-history' : 'terminal')}
                  extraPanels={dockExtraPanels}
                />
              ) : null}
            </main>
            {rightWorkbenchOpen ? (
              <RightWorkbench
                activeTab={rightWorkbenchTab}
                activeProject={activeProject}
                activeThread={activeThread}
                isRunning={Boolean(activeThreadId && runningThreadIds.includes(activeThreadId))}
                filePreviewTabs={filePreviewTabs}
                activeFilePreviewKey={activeFilePreviewKey}
                reviewPreviewTabs={reviewPreviewTabs}
                activeReviewPreviewKey={activeReviewPreviewKey}
                previewContentByKey={previewContentByKey}
                fileNavigatorManualVisibility={fileNavigatorManualVisibility}
                onSelectTab={setRightWorkbenchTab}
                onOpenWorkbenchPreview={openWorkbenchPreview}
                onFileNavigatorManualVisibilityChange={setFileNavigatorManualVisibility}
                onSelectFilePreviewTab={setActiveFilePreviewKey}
                onSelectReviewPreviewTab={setActiveReviewPreviewKey}
                onCloseFilePreviewTab={(tabKey) => closeWorkbenchPreview('file', tabKey)}
                onCloseReviewPreviewTab={(tabKey) => closeWorkbenchPreview('review', tabKey)}
                onCloseFilePreviewTabs={(tabKeys) => closeWorkbenchPreviewMany('file', tabKeys)}
                onCloseReviewPreviewTabs={(tabKeys) => closeWorkbenchPreviewMany('review', tabKeys)}
                onResolvePreviewContent={resolveWorkbenchPreviewContent}
                onGitChanged={() => activeProjectId ? refreshProjectGitSummary(activeProjectId) : undefined}
                onOpenGitPushPreview={() => activeProject ? setGitDialogMode('push') : showToast('请先选择项目。', 'info')}
                reviewHideNoiseFilesByDefault={general.reviewHideNoiseFilesByDefault}
                reviewDefaultDisplayMode={general.reviewDefaultDisplayMode}
                reviewNoisePatterns={general.reviewNoisePatterns}
                showToast={showToast}
                onResizeStart={handleRightWorkbenchResizeStart}
                onClose={() => setRightWorkbenchOpen(false)}
              />
            ) : null}
          </div>
        </div>

      <SessionSearchDialog
        open={searchOpen}
        query={searchQuery}
        projects={projects}
        activeThreadId={activeThreadId}
        onClose={closeSessionSearch}
        onQueryChange={setSearchQuery}
        onSelectThread={handleSelectThread}
      />

      <Dialogs
        approvalDialog={null}
        inputDialog={inputDialog}
        confirmDialog={confirmDialog}
        toast={toast}
        onCloseApprovalDialog={() => undefined}
        onSubmitApprovalDecision={(
          turn: ConversationTurn,
          request: ApprovalRequest,
          decision: ApprovalDecision,
        ) => handleSubmitApprovalDecision(turn, request, decision)}
        onCloseInputDialog={() => setInputDialog(null)}
        onInputDialogValueChange={handleInputDialogValueChange}
        onSubmitInputDialog={submitInputDialog}
        onCloseConfirmDialog={() => setConfirmDialog(null)}
        onConfirmRemoveDialog={handleConfirmDialog}
        onDismissToast={dismissToast}
        onToastDetailOpenChange={setToastDetailOpen}
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
      <TooltipLayer />
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
    setDockActivePanelId(resolveTerminalDockPanelIdOnRun());
    setTerminalRunRequest({
      id: Date.now(),
      command,
      cwd: activeProject.path,
      title: activeProject.path,
    });
  }

  function handleUndoChangedFiles(turn: ConversationTurn, changes: UndoConversationChange[]) {
    if (!activeProject) {
      showToast('请先选择项目。', 'info');
      return;
    }
    if (changes.length === 0) {
      showToast('这次改动暂时没有可撤销的文件内容。', 'info');
      return;
    }

    setConfirmDialog({
      kind: 'undo-ai-change',
      title: '撤销本次 AI 改动',
      description: `会把这次 AI 修改过的 ${changes.length} 个文件恢复到修改前；本次新建的文件会被删除。`,
      confirmLabel: '撤销改动',
      projectId: activeProject.id,
      turnId: turn.id,
      changes,
    });
  }

  async function handleConfirmDialog() {
    if (confirmDialog?.kind !== 'undo-ai-change') {
      await confirmRemoveDialog();
      return;
    }

    try {
      const result = await undoConversationChanges(confirmDialog.projectId, confirmDialog.changes);
      setConfirmDialog(null);
      setUndoneTurnIds((current) => ({
        ...current,
        [confirmDialog.turnId]: true,
      }));
      if (activeProjectId === confirmDialog.projectId) {
        await refreshProjectGitSummary(confirmDialog.projectId);
      }

      const parts: string[] = [];
      if (result.restored.length > 0) {
        parts.push(`恢复 ${result.restored.length} 个文件`);
      }
      if (result.deleted.length > 0) {
        parts.push(`删除 ${result.deleted.length} 个新文件`);
      }
      showToast(parts.length > 0 ? `已撤销本次 AI 改动：${parts.join('，')}` : '已撤销本次 AI 改动');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '撤销失败', 'error');
    }
  }
}

function isAppWindowFocused() {
  if (typeof document === 'undefined') {
    return true;
  }

  return document.visibilityState === 'visible' && document.hasFocus();
}

async function requestTaskbarAttention() {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    const { getCurrentWindow, UserAttentionType } = await import('@tauri-apps/api/window');
    await getCurrentWindow().requestUserAttention(UserAttentionType.Critical);
  } catch {}
}

async function clearTaskbarAttention() {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().requestUserAttention(null);
  } catch {}
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

function formatGitOperationToastTitle(operation: string, result: '完成' | '失败') {
  return /[A-Za-z]$/.test(operation) ? `${operation} ${result}` : `${operation}${result}`;
}

function isGitOperationStateError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return Boolean(
    message.includes('冲突') ||
    message.includes('conflict') ||
    message.includes('unmerged') ||
    message.includes('不能快进') ||
    message.includes('not possible to fast-forward') ||
    message.includes('divergent branches'),
  );
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
