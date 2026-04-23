import { KeyboardEvent, useEffect, useRef } from 'react';
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
import type { ThreadSummary } from './types';

export default function App() {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const conversationBottomRef = useRef<HTMLDivElement | null>(null);
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
    handleCopySessionId,
    selectThread,
    selectProject,
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

  async function handleSelectProject(projectId: string) {
    activeTurnIdRef.current = '';
    await selectProject(projectId);
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
          onSelectProject={handleSelectProject}
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
            onUseProjectWorkspace={() => setWorkspace(activeProject?.path ?? '')}
          />

          <ConversationPane
            activeThread={activeThread}
            clockNowMs={clockNowMs}
            isRunning={isRunning}
            activeTurnId={activeTurnIdRef.current}
            transcriptRef={transcriptRef}
            bottomRef={conversationBottomRef}
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
        inputDialog={inputDialog}
        confirmDialog={confirmDialog}
        toast={toast}
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
