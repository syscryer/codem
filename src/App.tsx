import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Minus,
  PanelLeft,
  Square,
  X,
} from 'lucide-react';
import { ChatHeader } from './components/ChatHeader';
import { Composer } from './components/Composer';
import { ConversationPane } from './components/ConversationPane';
import { DebugDrawer } from './components/DebugDrawer';
import { Dialogs } from './components/Dialogs';
import { SidebarProjects } from './components/SidebarProjects';
import { WorkspaceStatus } from './components/WorkspaceStatus';
import { useClaudeRun } from './hooks/useClaudeRun';
import { useWorkspaceState } from './hooks/useWorkspaceState';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ConversationTurn,
  RequestUserInputRequest,
  RuntimeSuggestedAction,
  ThreadDetail,
  ThreadSummary,
} from './types';

export default function App() {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const conversationBottomRef = useRef<HTMLDivElement | null>(null);
  const [dismissedApprovalDialogKey, setDismissedApprovalDialogKey] = useState<string | null>(null);
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
  const wasRunningRef = useRef(false);
  const {
    prompt,
    permissionMode,
    model,
    models,
    isRunning,
    clockNowMs,
    activeTurnIdRef,
    setPrompt,
    setWorkspace,
    setModel,
    handlePermissionModeSelect,
    handleSubmit,
    submitRequestUserInput,
    submitRuntimeRecoveryAction,
    submitApprovalDecision,
    stopRun,
  } = useClaudeRun({
    activeProjectId,
    activeProjectPath: activeProject?.path,
    activeThreadId,
    activeThreadSummary,
    createThread,
    handlePickProjectDirectory,
    showToast,
    updateThreadDetail,
    updateThreadTurn,
    appendDebug,
    appendRawEvent,
    schedulePersistThreadHistory,
    persistThreadMetadata,
    clearActiveTurnSelection: () => {
      activeTurnIdRef.current = '';
    },
  });

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      conversationBottomRef.current?.scrollIntoView({ block: 'end' });
    });

    return () => cancelAnimationFrame(frame);
  }, [activeThread?.turns]);

  useEffect(() => {
    if (!activeProjectId) {
      return;
    }

    void refreshProjectGitSummary(activeProjectId);
  }, [activeProjectId]);

  useEffect(() => {
    const wasRunning = wasRunningRef.current;
    wasRunningRef.current = isRunning;

    if (activeProjectId && wasRunning && !isRunning) {
      void refreshProjectGitSummary(activeProjectId);
    }
  }, [activeProjectId, isRunning]);

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

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  async function handleSelectThread(projectId: string, threadId: string) {
    activeTurnIdRef.current = '';
    await selectThread(projectId, threadId);
  }

  function handleOpenRemoveThreadDialog(thread: ThreadSummary) {
    if (isRunning && thread.id === activeThreadId) {
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

  return (
    <div className="codex-desktop">
      <header className="desktop-menubar">
        <div className="window-nav">
          <button type="button" aria-label="侧边栏"><PanelLeft size={13} /></button>
          <button type="button" aria-label="后退"><ArrowLeft size={13} /></button>
          <button type="button" aria-label="前进"><ArrowRight size={13} /></button>
        </div>
        <nav className="desktop-menu">
          <span>文件</span>
          <span>编辑</span>
          <span>查看</span>
          <span>窗口</span>
          <span>帮助</span>
        </nav>
        <div className="window-controls">
          <span><Minus size={12} /></span>
          <span><Square size={11} /></span>
          <span><X size={12} /></span>
        </div>
      </header>

      <div className="codex-shell">
        <SidebarProjects
          activeProjectId={activeProjectId}
          activeThreadId={activeThreadId}
          filteredProjects={filteredProjects}
          collapsedProjects={collapsedProjects}
          searchOpen={searchOpen}
          searchQuery={searchQuery}
          panelState={panelState}
          onCreatePrimaryChat={() => activeProjectId ? void createThread(activeProjectId) : void handlePickProjectDirectory()}
          onToggleSearch={() => setSearchOpen((value) => !value)}
          onSearchQueryChange={setSearchQuery}
          onToggleAllProjects={toggleAllProjects}
          onPanelStateChange={handlePanelStateChange}
          onPickProjectDirectory={handlePickProjectDirectory}
          onCreateThread={createThread}
          onOpenProject={handleOpenProject}
          onOpenRenameProjectDialog={openRenameProjectDialog}
          onOpenRemoveProjectDialog={openRemoveProjectDialog}
          onToggleProjectCollapse={toggleProjectCollapse}
          onSelectThread={handleSelectThread}
          onOpenRenameThreadDialog={openRenameThreadDialog}
          onCopySessionId={handleCopySessionId}
          onOpenRemoveThreadDialog={handleOpenRemoveThreadDialog}
        />

        <main className="chat-shell">
          <ChatHeader
            activeProject={activeProject}
            activeThread={activeThread}
            onToggleDebug={() => setDebugOpen((value) => !value)}
            onOpenEditor={() => activeProject ? void handleOpenProjectInEditor(activeProject) : showToast('请先选择项目。', 'info')}
            onRefreshGitDiff={() => activeProjectId ? void refreshProjectGitSummary(activeProjectId) : undefined}
            onUseProjectWorkspace={() => setWorkspace(activeProject?.path ?? '')}
          />

          <ConversationPane
            activeThread={activeThread}
            clockNowMs={clockNowMs}
            isRunning={isRunning}
            activeTurnId={activeTurnIdRef.current}
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

          <Composer
            prompt={prompt}
            permissionMode={permissionMode}
            model={model}
            models={models}
            isRunning={isRunning}
            onSubmit={handleSubmit}
            onPromptChange={setPrompt}
            onKeyDown={handleComposerKeyDown}
            onSelectPermissionMode={handlePermissionModeSelect}
            onSelectModel={setModel}
            onStopRun={stopRun}
          />

          <WorkspaceStatus activeProject={activeProject} activeThread={activeThread} />
        </main>
      </div>

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

function getLatestPendingApprovalDialog(activeThread: ThreadDetail | null) {
  if (!activeThread) {
    return null;
  }

  for (let turnIndex = activeThread.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = activeThread.turns[turnIndex];
    const requests = turn.pendingApprovalRequests ?? [];
    if (!requests.length) {
      continue;
    }

    const requestIndex = requests.length - 1;
    const request = requests[requestIndex];
    return {
      key: buildApprovalDialogKey(activeThread.id, turn.id, request, requestIndex),
      turn,
      request,
    };
  }

  return null;
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
