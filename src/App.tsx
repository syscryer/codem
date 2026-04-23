import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import {
  AlignJustify,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Blocks,
  Check,
  Clock3,
  Code2,
  Folder,
  FolderPlus,
  GitBranch,
  Home,
  LayoutPanelLeft,
  Mic,
  Minus,
  MoreHorizontal,
  PanelLeft,
  Play,
  Plus,
  Search,
  Settings,
  Square,
  SquarePen,
  SquareSplitHorizontal,
  TerminalSquare,
  X,
} from 'lucide-react';
import { ConversationTurnView } from './components/ConversationTurn';
import { DEFAULT_MODEL_VALUE, permissionMenuModes, permissionModes } from './constants';
import { useClaudeRun } from './hooks/useClaudeRun';
import { useWorkspaceState } from './hooks/useWorkspaceState';
import type { ThreadSummary } from './types';

export default function App() {
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const conversationBottomRef = useRef<HTMLDivElement | null>(null);
  const permissionMenuRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const panelMenuRef = useRef<HTMLDivElement | null>(null);
  const workspaceState = useWorkspaceState();
  const {
    panelState,
    activeProjectId,
    activeThreadId,
    debugOpen,
    searchOpen,
    searchQuery,
    panelMenuOpen,
    projectMenuProjectId,
    threadMenuThreadId,
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
    setPanelMenuOpen,
    setProjectMenuProjectId,
    setThreadMenuThreadId,
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

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (!permissionMenuRef.current?.contains(target)) {
        setPermissionMenuOpen(false);
      }
      if (!modelMenuRef.current?.contains(target)) {
        setModelMenuOpen(false);
      }
      if (!panelMenuRef.current?.contains(target)) {
        setPanelMenuOpen(false);
      }

      const projectMenuElement = document.querySelector('.project-menu-popover');
      if (projectMenuElement && !projectMenuElement.contains(target)) {
        setProjectMenuProjectId(null);
      }

      const threadMenuElement = document.querySelector('.thread-menu-popover');
      if (threadMenuElement && !threadMenuElement.contains(target)) {
        setThreadMenuThreadId(null);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

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
      setThreadMenuThreadId(null);
      return;
    }

    openRemoveThreadDialog(thread);
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
        <aside className="app-sidebar">
          <nav className="sidebar-primary">
            <button type="button" onClick={() => activeProjectId ? void createThread(activeProjectId) : void handlePickProjectDirectory()}>
              <span><Plus size={14} /></span> 新建聊天
            </button>
            <button type="button" onClick={() => setSearchOpen((value) => !value)}>
              <span><Search size={14} /></span> 搜索
              <kbd>Ctrl+G</kbd>
            </button>
            <button type="button"><span><Blocks size={14} /></span> 插件</button>
            <button type="button"><span><Clock3 size={14} /></span> 自动化</button>
          </nav>

          <section className="sidebar-projects">
            <div className="sidebar-section-head sidebar-section-toolbar">
              <span>项目</span>
              <div className="sidebar-section-actions">
                <button type="button" className="sidebar-toolbar-icon" title="展开或折叠项目" onClick={toggleAllProjects}>
                  <SquareSplitHorizontal size={13} />
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
                  {panelMenuOpen ? (
                    <div className="workspace-menu panel-menu-popover">
                      <div className="workspace-menu-group-title">整理</div>
                      <button type="button" className="workspace-menu-item" onClick={() => void handlePanelStateChange({ organizeBy: 'project' })}>
                        <span>按项目</span>
                        {panelState.organizeBy === 'project' ? <Check size={14} /> : null}
                      </button>
                      <button type="button" className="workspace-menu-item" onClick={() => void handlePanelStateChange({ organizeBy: 'timeline' })}>
                        <span>时间顺序列表</span>
                        {panelState.organizeBy === 'timeline' ? <Check size={14} /> : null}
                      </button>
                      <button type="button" className="workspace-menu-item" onClick={() => void handlePanelStateChange({ organizeBy: 'chat-first' })}>
                        <span>聊天优先</span>
                        {panelState.organizeBy === 'chat-first' ? <Check size={14} /> : null}
                      </button>
                      <div className="workspace-menu-divider" />
                      <div className="workspace-menu-group-title">排序条件</div>
                      <button type="button" className="workspace-menu-item" onClick={() => void handlePanelStateChange({ sortBy: 'created' })}>
                        <span>已创建</span>
                        {panelState.sortBy === 'created' ? <Check size={14} /> : null}
                      </button>
                      <button type="button" className="workspace-menu-item" onClick={() => void handlePanelStateChange({ sortBy: 'updated' })}>
                        <span>已更新</span>
                        {panelState.sortBy === 'updated' ? <Check size={14} /> : null}
                      </button>
                      <div className="workspace-menu-divider" />
                      <div className="workspace-menu-group-title">显示</div>
                      <button type="button" className="workspace-menu-item" onClick={() => void handlePanelStateChange({ visibility: 'all' })}>
                        <span>所有聊天</span>
                        {panelState.visibility === 'all' ? <Check size={14} /> : null}
                      </button>
                      <button type="button" className="workspace-menu-item" onClick={() => void handlePanelStateChange({ visibility: 'relevant' })}>
                        <span>相关</span>
                        {panelState.visibility === 'relevant' ? <Check size={14} /> : null}
                      </button>
                    </div>
                  ) : null}
                </div>
                <button type="button" className="sidebar-toolbar-icon" title="新增项目" onClick={() => void handlePickProjectDirectory()}>
                  <FolderPlus size={13} />
                </button>
              </div>
            </div>

            {searchOpen ? (
              <div className="sidebar-search">
                <Search size={13} />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="搜索项目和聊天"
                />
              </div>
            ) : null}

            {filteredProjects.length === 0 ? (
              <div className="sidebar-empty">
                <p>当前还没有项目。</p>
                <p>点击右上角新增项目，或从 Claude Code 本地 session 自动导入。</p>
              </div>
            ) : (
              filteredProjects.map((project) => (
                <div key={project.id} className={`sidebar-project ${project.id === activeProjectId ? 'active' : ''}`}>
                  <div className="sidebar-project-row">
                    <button type="button" className="sidebar-project-title" onClick={() => void handleSelectProject(project.id)}>
                      <span><Folder size={14} /></span>
                      <strong>{project.name}</strong>
                      {project.gitBranch ? (
                        <small className="sidebar-branch">
                          <GitBranch size={11} />
                          {project.gitBranch}
                        </small>
                      ) : null}
                    </button>
                    <div className="sidebar-project-actions">
                      <button
                        type="button"
                        className="sidebar-row-action"
                        title="项目菜单"
                        onClick={() => setProjectMenuProjectId((value) => value === project.id ? null : project.id)}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                      <button
                        type="button"
                        className="sidebar-row-action"
                        title="新建该项目聊天"
                        onClick={() => void createThread(project.id)}
                      >
                        <SquarePen size={14} />
                      </button>
                      {projectMenuProjectId === project.id ? (
                        <div className="workspace-menu project-menu-popover">
                          <button type="button" className="workspace-menu-item" onClick={() => void handleOpenProject(project)}>
                            <span>在资源管理器中打开</span>
                          </button>
                          <button type="button" className="workspace-menu-item" onClick={() => openRenameProjectDialog(project)}>
                            <span>修改项目名称</span>
                          </button>
                          <button type="button" className="workspace-menu-item danger" onClick={() => openRemoveProjectDialog(project)}>
                            <span>移除</span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {!collapsedProjects[project.id] ? (
                    <div className="sidebar-thread-list">
                      {project.threads.map((thread) => (
                        <div key={thread.id} className={`sidebar-thread-row ${thread.id === activeThreadId ? 'active' : ''}`}>
                          <button type="button" className="sidebar-thread" onClick={() => void handleSelectThread(project.id, thread.id)}>
                            <span>{thread.title}</span>
                            <small>{thread.updatedLabel}</small>
                          </button>
                          <button
                            type="button"
                            className="sidebar-row-action thread-row-action"
                            title="聊天菜单"
                            onClick={() => setThreadMenuThreadId((value) => value === thread.id ? null : thread.id)}
                          >
                            <MoreHorizontal size={13} />
                          </button>
                          {threadMenuThreadId === thread.id ? (
                            <div className="workspace-menu thread-menu-popover">
                              <button type="button" className="workspace-menu-item" onClick={() => openRenameThreadDialog(thread)}>
                                <span>重命名聊天</span>
                              </button>
                              <button type="button" className="workspace-menu-item" onClick={() => void handleCopySessionId(thread)}>
                                <span>复制会话 ID</span>
                              </button>
                              <button type="button" className="workspace-menu-item danger" onClick={() => handleOpenRemoveThreadDialog(thread)}>
                                <span>删除聊天</span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <button type="button" className="sidebar-collapse-toggle" onClick={() => toggleProjectCollapse(project.id)}>
                    {collapsedProjects[project.id] ? '展开项目' : '折叠项目'}
                  </button>
                </div>
              ))
            )}
          </section>

          <div className="sidebar-footer">
            <button type="button"><span><Settings size={14} /></span> 设置</button>
          </div>
        </aside>

        <main className="chat-shell">
          <header className="chat-header">
            <div className="thread-title">
              <h2>{activeThread?.title ?? '选择一个聊天'}</h2>
              <span className="thread-project">{activeProject?.name ?? '未选择项目'}</span>
              <button type="button" className="more-button thread-more-button" aria-label="更多">
                <MoreHorizontal size={15} />
              </button>
            </div>
            <div className="header-actions">
              <button type="button" className="icon-button" title="运行">
                <Play size={14} />
              </button>
              <button type="button" className="editor-button" title="用编辑器打开">
                <Code2 className="editor-mark" size={16} />
                <span className="header-chevron" aria-hidden="true" />
              </button>
              <button type="button" className="pill-button">
                提交
                <span className="header-chevron" aria-hidden="true" />
              </button>
              <button type="button" className="icon-button" onClick={() => setDebugOpen((value) => !value)}>
                <TerminalSquare size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                title="使用当前项目目录"
                onClick={() => setWorkspace(activeProject?.path ?? '')}
              >
                <Home size={14} />
              </button>
              <button type="button" className="diff-chip">
                <span className="add">+407</span>
                <span className="del">-66</span>
              </button>
              <button type="button" className="icon-button" title="布局">
                <SquareSplitHorizontal size={14} />
              </button>
            </div>
          </header>

          <section className="conversation" ref={transcriptRef}>
            {!activeThread ? (
              <div className="empty-state">
                <h3>从左侧选择一个项目或聊天</h3>
                <p>CodeM 会导入 Claude Code 本地 session，并把它们组织到项目工作区下面。</p>
              </div>
            ) : activeThread.turns.length === 0 ? (
              <div className="empty-state">
                <h3>开始一次 Claude Code 会话</h3>
                <p>输入需求后，Claude 的正文会连续显示，工具调用会以轻量步骤内嵌在回答中。</p>
              </div>
            ) : (
              activeThread.turns.map((turn) => (
                <ConversationTurnView
                  key={turn.id}
                  turn={turn}
                  nowMs={clockNowMs}
                  isLiveRunning={isRunning && turn.id === activeTurnIdRef.current}
                />
              ))
            )}
            <div ref={conversationBottomRef} />
          </section>

          <form className="composer" onSubmit={handleSubmit}>
            <div className="composer-card">
              <textarea
                className="composer-input"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="要求后续变更"
              />
              <div className="composer-toolbar">
                <div className="composer-left-tools">
                  <button type="button" className="plain-icon"><Plus size={16} /></button>
                  <div className="permission-picker" ref={permissionMenuRef}>
                    {permissionMenuOpen ? (
                      <div className="permission-menu" role="menu">
                        {permissionMenuModes.map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            className="permission-menu-item"
                            role="menuitemradio"
                            aria-checked={permissionMode === mode}
                            onClick={() => {
                              handlePermissionModeSelect(mode);
                              setPermissionMenuOpen(false);
                            }}
                          >
                            <span className={`permission-icon permission-icon-${mode}`} aria-hidden="true" />
                            <span>{permissionLabel(mode)}</span>
                            {permissionMode === mode ? <Check className="permission-check" size={14} /> : null}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      className="permission-trigger"
                      aria-expanded={permissionMenuOpen}
                      onClick={() => setPermissionMenuOpen((value) => !value)}
                    >
                      <span className="permission-trigger-icon" aria-hidden="true" />
                      <span>{permissionLabel(permissionMode)}</span>
                      <span className="permission-trigger-chevron" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="composer-right-tools">
                  <div className="model-picker" ref={modelMenuRef}>
                    {modelMenuOpen ? (
                      <div className="model-menu" role="menu">
                        <div className="model-menu-title">模型</div>
                        {models.map((item) => (
                          <button
                            key={item}
                            type="button"
                            className="model-menu-item"
                            role="menuitemradio"
                            aria-checked={model === item}
                            onClick={() => {
                              setModel(item);
                              setModelMenuOpen(false);
                            }}
                          >
                            <span>{modelLabel(item)}</span>
                            {model === item ? <Check className="model-check" size={15} /> : null}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      className="model-trigger"
                      aria-expanded={modelMenuOpen}
                      disabled={models.length === 0 || isRunning}
                      title="Claude Code model"
                      onClick={() => setModelMenuOpen((value) => !value)}
                    >
                      <span>{modelTriggerLabel(model, models)}</span>
                      <span className="model-trigger-chevron" aria-hidden="true" />
                    </button>
                  </div>
                  <button type="button" className="plain-icon"><Mic size={15} /></button>
                  {isRunning ? (
                    <button type="button" className="send-button stop" onClick={stopRun} title="停止">
                      <Square size={13} fill="currentColor" />
                    </button>
                  ) : (
                    <button type="submit" className="send-button" disabled={!prompt.trim()} title="发送">
                      <ArrowUp size={18} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </form>

          <footer className="workspace-status">
            <span className="status-item status-workspace">
              <LayoutPanelLeft size={12} />
              <span>本地工作</span>
            </span>
            <span className="status-item status-branch">
              <GitBranch size={12} />
              <span>{activeProject?.gitBranch ?? '未检测到 Git'}</span>
              {activeProject?.gitBranch ? <span className="footer-chevron" aria-hidden="true" /> : null}
            </span>
            <span className="status-spacer" />
            <span>{activeThread?.sessionId ? 'session 已连接' : '新会话'}</span>
          </footer>
        </main>
      </div>

      {inputDialog ? (
        <div className="dialog-backdrop" role="presentation" onClick={() => setInputDialog(null)}>
          <div className="dialog-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-head">
              <h3>{inputDialog.title}</h3>
              <p>{inputDialog.description}</p>
            </div>
            <form
              className="dialog-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitInputDialog();
              }}
            >
              <input
                autoFocus
                className="dialog-input"
                value={inputDialog.value}
                onChange={(event) => setInputDialog((current) => current ? { ...current, value: event.target.value } : current)}
              />
              <div className="dialog-actions">
                <button type="button" className="dialog-button secondary" onClick={() => setInputDialog(null)}>
                  取消
                </button>
                <button type="submit" className="dialog-button primary">
                  {inputDialog.confirmLabel}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {confirmDialog ? (
        <div className="dialog-backdrop" role="presentation" onClick={() => setConfirmDialog(null)}>
          <div className="dialog-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-head">
              <h3>{confirmDialog.title}</h3>
              <p>{confirmDialog.description}</p>
            </div>
            <div className="dialog-actions">
              <button type="button" className="dialog-button secondary" onClick={() => setConfirmDialog(null)}>
                取消
              </button>
              <button type="button" className="dialog-button danger" onClick={() => void confirmRemoveDialog()}>
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? <div className={`app-toast ${toast.tone}`}>{toast.message}</div> : null}

      {debugOpen && activeThread ? (
        <aside className="debug-drawer">
          <div className="debug-head">
            <div>
              <p className="eyebrow">Debug</p>
              <h2>运行细节</h2>
            </div>
            <button type="button" className="ghost-button" onClick={() => setDebugOpen(false)}>
              关闭
            </button>
          </div>

          <details className="debug-section" open>
            <summary>事件摘要</summary>
            {activeThread.debugEvents.length === 0 ? (
              <p className="muted">暂无调试事件</p>
            ) : (
              activeThread.debugEvents.map((event) => (
                <article key={event.id} className={`debug-item ${event.tone === 'error' ? 'debug-error' : ''}`}>
                  <h3>{event.title}</h3>
                  <pre>{event.content}</pre>
                </article>
              ))
            )}
          </details>

          <details className="debug-section">
            <summary>Raw Events ({activeThread.rawEvents.length})</summary>
            <pre className="raw-pre">{activeThread.rawEvents.join('\n') || '暂无原始事件'}</pre>
          </details>
        </aside>
      ) : null}
    </div>
  );
}

function permissionLabel(mode: (typeof permissionModes)[number]) {
  const labels: Record<(typeof permissionModes)[number], string> = {
    default: '默认权限',
    plan: '计划模式',
    acceptEdits: '接受编辑',
    auto: '自动执行',
    dontAsk: '无需确认',
    bypassPermissions: '完全访问权限',
  };

  return labels[mode];
}

function modelLabel(model: string) {
  return model === DEFAULT_MODEL_VALUE ? '默认' : model;
}

function modelTriggerLabel(model: string, models: string[]) {
  if (model !== DEFAULT_MODEL_VALUE) {
    return modelLabel(model);
  }

  return models.find((item) => item !== DEFAULT_MODEL_VALUE) ?? '默认';
}
