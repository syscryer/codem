import { CSSProperties, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { AppMenubar } from './components/AppMenubar';
import { ChatHeader } from './components/ChatHeader';
import { Composer } from './components/Composer';
import { ConversationPane } from './components/ConversationPane';
import { DebugDrawer } from './components/DebugDrawer';
import { Dialogs } from './components/Dialogs';
import { SidebarProjects } from './components/SidebarProjects';
import { SettingsView } from './components/settings/SettingsView';
import { WorkspaceStatus } from './components/WorkspaceStatus';
import { useClaudeRun } from './hooks/useClaudeRun';
import { useAppSettings } from './hooks/useAppSettings';
import { useWorkspaceState } from './hooks/useWorkspaceState';
import { matchesShortcut } from './lib/shortcuts';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ConversationTurn,
  RequestUserInputRequest,
  RuntimeSuggestedAction,
  SettingsSection,
  ThreadDetail,
  ThreadSummary,
  ToolStep,
} from './types';

export default function App() {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const conversationBottomRef = useRef<HTMLDivElement | null>(null);
  const [dismissedApprovalDialogKey, setDismissedApprovalDialogKey] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const workspaceState = useWorkspaceState();
  const {
    panelState,
    activeProjectId,
    activeThreadId,
    debugOpen,
    searchOpen,
    searchQuery,
    collapsedProjects,
    inputDialog,
    confirmDialog,
    toast,
    activeProject,
    activeThreadSummary,
    activeThread,
    filteredProjects,
    setDebugOpen,
    setSearchOpen,
    setSearchQuery,
    setInputDialog,
    setConfirmDialog,
    showToast,
    createThread,
    handlePickProjectDirectory,
    submitInputDialog,
    confirmRemoveDialog,
    handleOpenProject,
    handleOpenProjectInEditor,
    refreshProjectGitSummary,
    loadProjectGitBranches,
    switchProjectGitBranch,
    handleCopySessionId,
    selectThread,
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
  const [appView, setAppView] = useState<{ kind: 'workspace' } | { kind: 'settings'; section: SettingsSection }>({
    kind: 'workspace',
  });
  const {
    general,
    appearance,
    models: appModelSettings,
    shortcuts,
    openWith,
    openTargets,
    updateAppearance,
    updateGeneral,
    updateModels,
    updateShortcuts,
    updateOpenWith,
  } = useAppSettings(showToast);
  const wasRunningRef = useRef(false);
  const {
    workspace,
    permissionMode,
    model,
    models,
    claudeModels,
    isRunning,
    runningThreadIds,
    activeTurnIdsByThreadId,
    queuedPrompts,
    removeQueuedPrompt,
    clockNowMs,
    setWorkspace,
    setModel,
    handlePermissionModeSelect,
    submitPrompt,
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
        setDebugOpen((value) => !value);
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [appView.kind, handleCreatePrimaryChat, setDebugOpen, setSearchOpen, shortcuts]);

  const latestApprovalDialog = useMemo(
    () => getLatestPendingApprovalDialog(activeThread),
    [activeThread],
  );
  const approvalDialog =
    latestApprovalDialog && latestApprovalDialog.key !== dismissedApprovalDialogKey
      ? latestApprovalDialog
      : null;

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
    await selectThread(projectId, threadId);
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

  function openSettings(section: SettingsSection = 'appearance') {
    setAppView({ kind: 'settings', section });
  }

  function returnWorkspace() {
    setAppView({ kind: 'workspace' });
  }

  function showShortcuts() {
    openSettings('shortcuts');
  }

  function showAbout() {
    showToast('CodeM 0.1.0 · Tauri 桌面壳预览版', 'info');
  }

  function handleUnsupportedWindowAction(action: string) {
    showToast(`${action} 会在接入 Tauri 窗口 API 后启用。`, 'info');
  }

  return (
    <div
      className="codex-desktop"
      data-theme-mode={appearance.themeMode}
      data-density={appearance.density}
      data-sidebar-width={appearance.sidebarWidth}
      style={{
        '--app-ui-font-size': `${appearance.uiFontSize}px`,
        '--app-code-font-size': `${appearance.codeFontSize}px`,
      } as CSSProperties}
    >
      <AppMenubar
        sidebarVisible={sidebarVisible}
        onToggleSidebar={() => setSidebarVisible((value) => !value)}
        onNewChat={() => void handleCreatePrimaryChat()}
        onOpenFolder={() => void handlePickProjectDirectory()}
        onOpenSettings={() => openSettings('appearance')}
        onOpenSearch={() => setSearchOpen(true)}
        onToggleDebug={() => setDebugOpen((value) => !value)}
        onShowAbout={showAbout}
        onShowShortcuts={showShortcuts}
        onUnsupportedWindowAction={handleUnsupportedWindowAction}
      />

      {appView.kind === 'settings' ? (
        <SettingsView
          activeSection={appView.section}
          general={general}
          appearance={appearance}
          models={appModelSettings}
          shortcuts={shortcuts}
          openWith={openWith}
          openTargets={openTargets}
          claudeModels={claudeModels}
          onSelectSection={(section) => setAppView({ kind: 'settings', section })}
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
              filteredProjects={filteredProjects}
              collapsedProjects={collapsedProjects}
              searchOpen={searchOpen}
              searchQuery={searchQuery}
              panelState={panelState}
              onCreatePrimaryChat={() => void handleCreatePrimaryChat()}
              onToggleSearch={() => setSearchOpen((value) => !value)}
              onSearchQueryChange={setSearchQuery}
              onToggleAllProjects={toggleAllProjects}
              onPanelStateChange={handlePanelStateChange}
              onPickProjectDirectory={handlePickProjectDirectory}
              onCreateThread={handleCreateThread}
              onOpenProject={handleOpenProject}
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

          <main className="chat-shell">
            <ChatHeader
              activeProject={activeProject}
              activeThread={activeThread}
              openTargets={openTargets}
              selectedOpenTargetId={openWith.selectedTargetId}
              showDebugButton={general.showDebugButton}
              onToggleDebug={() => setDebugOpen((value) => !value)}
              onOpenTarget={(targetId) => activeProject ? void handleOpenProjectInEditor(activeProject, targetId) : showToast('请先选择项目。', 'info')}
              onSelectOpenTarget={(targetId) => void updateOpenWith({ selectedTargetId: targetId })}
              onRefreshGitDiff={() => activeProjectId ? void refreshProjectGitSummary(activeProjectId) : undefined}
              onUseProjectWorkspace={() => setWorkspace(activeProject?.path ?? '')}
            />

            <ConversationPane
              activeThread={activeThread}
              clockNowMs={clockNowMs}
              isRunning={Boolean(activeThreadId && runningThreadIds.includes(activeThreadId))}
              activeTurnId={activeThreadId ? activeTurnIdsByThreadId[activeThreadId] ?? '' : ''}
              transcriptRef={transcriptRef}
              bottomRef={conversationBottomRef}
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
              workspace={workspace}
              permissionMode={permissionMode}
              model={model}
              models={models}
              isRunning={Boolean(activeThreadId && runningThreadIds.includes(activeThreadId))}
              queuedPrompts={queuedPrompts}
              onSubmitPrompt={submitPrompt}
              onRemoveQueuedPrompt={removeQueuedPrompt}
              showToast={showToast}
              onKeyDown={handleComposerKeyDown}
              onSelectPermissionMode={handlePermissionModeSelect}
              onSelectModel={setModel}
              onStopRun={() => stopRun(activeThreadId ?? undefined)}
            />

            <WorkspaceStatus
              activeProject={activeProject}
              activeThread={activeThread}
              onLoadBranches={loadProjectGitBranches}
              onSelectBranch={switchProjectGitBranch}
            />
          </main>
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
      <DebugDrawer activeThread={activeThread} open={debugOpen} onClose={() => setDebugOpen(false)} />
    </div>
  );
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
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
  return request.historical !== true;
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
