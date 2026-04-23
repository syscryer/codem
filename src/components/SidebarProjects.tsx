import { useRef, useState } from 'react';
import {
  AlignJustify,
  Blocks,
  Check,
  Clock3,
  Folder,
  FolderPlus,
  GitBranch,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  SquarePen,
  SquareSplitHorizontal,
} from 'lucide-react';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import type { PanelState, ProjectSummary, ThreadSummary } from '../types';

const VISIBLE_THREAD_PREVIEW_LIMIT = 5;

type SidebarProjectsProps = {
  activeProjectId: string | null;
  activeThreadId: string | null;
  filteredProjects: ProjectSummary[];
  collapsedProjects: Record<string, boolean>;
  searchOpen: boolean;
  searchQuery: string;
  panelState: PanelState;
  onCreatePrimaryChat: () => void;
  onToggleSearch: () => void;
  onSearchQueryChange: (value: string) => void;
  onToggleAllProjects: () => void;
  onPanelStateChange: (nextState: Partial<PanelState>) => void | Promise<void>;
  onPickProjectDirectory: () => void | Promise<void>;
  onCreateThread: (projectId: string) => void | Promise<unknown>;
  onOpenProject: (project: ProjectSummary) => void | Promise<void>;
  onOpenRenameProjectDialog: (project: ProjectSummary) => void;
  onOpenRemoveProjectDialog: (project: ProjectSummary) => void;
  onToggleProjectCollapse: (projectId: string) => void;
  onSelectThread: (projectId: string, threadId: string) => void | Promise<void>;
  onOpenRenameThreadDialog: (thread: ThreadSummary) => void;
  onCopySessionId: (thread: ThreadSummary) => void | Promise<void>;
  onOpenRemoveThreadDialog: (thread: ThreadSummary) => void;
};

export function SidebarProjects({
  activeProjectId,
  activeThreadId,
  filteredProjects,
  collapsedProjects,
  searchOpen,
  searchQuery,
  panelState,
  onCreatePrimaryChat,
  onToggleSearch,
  onSearchQueryChange,
  onToggleAllProjects,
  onPanelStateChange,
  onPickProjectDirectory,
  onCreateThread,
  onOpenProject,
  onOpenRenameProjectDialog,
  onOpenRemoveProjectDialog,
  onToggleProjectCollapse,
  onSelectThread,
  onOpenRenameThreadDialog,
  onCopySessionId,
  onOpenRemoveThreadDialog,
}: SidebarProjectsProps) {
  const [panelMenuOpen, setPanelMenuOpen] = useState(false);
  const [projectMenuProjectId, setProjectMenuProjectId] = useState<string | null>(null);
  const [threadMenuThreadId, setThreadMenuThreadId] = useState<string | null>(null);
  const [expandedThreadProjects, setExpandedThreadProjects] = useState<Record<string, boolean>>({});
  const panelMenuRef = useRef<HTMLDivElement | null>(null);

  useOutsideDismiss({
    refs: [{ ref: panelMenuRef, onDismiss: () => setPanelMenuOpen(false) }],
    selectors: [
      { selector: '.project-menu-popover', onDismiss: () => setProjectMenuProjectId(null) },
      { selector: '.thread-menu-popover', onDismiss: () => setThreadMenuThreadId(null) },
    ],
  });

  return (
    <aside className="app-sidebar">
      <nav className="sidebar-primary">
        <button type="button" onClick={onCreatePrimaryChat}>
          <span><Plus size={14} /></span> 新建聊天
        </button>
        <button type="button" onClick={onToggleSearch}>
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
            <button type="button" className="sidebar-toolbar-icon" title="展开或折叠项目" onClick={onToggleAllProjects}>
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
              ) : null}
            </div>
            <button type="button" className="sidebar-toolbar-icon" title="新增项目" onClick={() => void onPickProjectDirectory()}>
              <FolderPlus size={13} />
            </button>
          </div>
        </div>

        {searchOpen ? (
          <div className="sidebar-search">
            <Search size={13} />
            <input
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
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
          filteredProjects.map((project) => {
            const collapsed = Boolean(collapsedProjects[project.id]);
            const threadExpanded = Boolean(expandedThreadProjects[project.id]);
            const hasMoreThreads = project.threads.length > VISIBLE_THREAD_PREVIEW_LIMIT;
            const visibleThreads = threadExpanded
              ? project.threads
              : project.threads.slice(0, VISIBLE_THREAD_PREVIEW_LIMIT);

            return (
              <div key={project.id} className={`sidebar-project ${project.id === activeProjectId ? 'active' : ''}`}>
                <div className="sidebar-project-row">
                  <button
                    type="button"
                    className="sidebar-project-title"
                    onClick={() => onToggleProjectCollapse(project.id)}
                  >
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
                      onClick={() => void onCreateThread(project.id)}
                    >
                      <SquarePen size={14} />
                    </button>
                    {projectMenuProjectId === project.id ? (
                      <div className="workspace-menu project-menu-popover">
                        <button type="button" className="workspace-menu-item" onClick={() => { setProjectMenuProjectId(null); void onOpenProject(project); }}>
                          <span>在资源管理器中打开</span>
                        </button>
                        <button type="button" className="workspace-menu-item" onClick={() => { setProjectMenuProjectId(null); onOpenRenameProjectDialog(project); }}>
                          <span>修改项目名称</span>
                        </button>
                        <button type="button" className="workspace-menu-item danger" onClick={() => { setProjectMenuProjectId(null); onOpenRemoveProjectDialog(project); }}>
                          <span>移除</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                {!collapsed ? (
                  <div className="sidebar-thread-list">
                    {visibleThreads.map((thread) => (
                      <div key={thread.id} className={`sidebar-thread-row ${thread.id === activeThreadId ? 'active' : ''}`}>
                        <button type="button" className="sidebar-thread" onClick={() => void onSelectThread(project.id, thread.id)}>
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
                            <button type="button" className="workspace-menu-item" onClick={() => { setThreadMenuThreadId(null); onOpenRenameThreadDialog(thread); }}>
                              <span>重命名聊天</span>
                            </button>
                            <button type="button" className="workspace-menu-item" onClick={() => { setThreadMenuThreadId(null); void onCopySessionId(thread); }}>
                              <span>复制会话 ID</span>
                            </button>
                            <button type="button" className="workspace-menu-item danger" onClick={() => { setThreadMenuThreadId(null); onOpenRemoveThreadDialog(thread); }}>
                              <span>删除聊天</span>
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                {!collapsed && hasMoreThreads ? (
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
            );
          })
        )}
      </section>

      <div className="sidebar-footer">
        <button type="button"><span><Settings size={14} /></span> 设置</button>
      </div>
    </aside>
  );
}
