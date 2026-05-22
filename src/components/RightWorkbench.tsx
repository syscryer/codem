import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  Globe2,
  GitPullRequest,
  LayoutDashboard,
  MoreHorizontal,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PopoverPortal } from './PopoverPortal';
import { fetchWorkspaceFilePreview } from '../lib/file-preview-api';
import { fetchGitStatus } from '../lib/git-api';
import { fetchProjectFiles } from '../lib/project-files-api';
import {
  buildWorkbenchFileTree,
  getWorkbenchFileIconKind,
  highlightWorkbenchCode,
  highlightWorkbenchCodeLine,
  resolveWorkbenchFileIcon,
  type HighlightedCodeToken,
  type WorkbenchFileTreeNode,
} from '../lib/workbench-files';
import {
  applyWorkbenchNavigatorWidthOverride,
  buildWorkbenchFilesLayoutColumns,
  clampWorkbenchNavigatorWidth,
  clearWorkbenchNavigatorWidthOverride,
} from '../lib/workbench-layout';
import {
  getWorkbenchVisibleLineRange,
  shouldUseLargeFilePreview,
  WORKBENCH_CODE_LINE_HEIGHT,
} from '../lib/workbench-code-preview';
import {
  buildChangedFilePreviewRequest,
  buildProjectFilePreviewRequest,
  resolveWorkbenchPreviewFilePath,
} from '../lib/workbench-preview';
import type {
  GitFileStatus,
  GitStatusSnapshot,
  ProjectFileEntry,
  ProjectSummary,
  RightWorkbenchTab,
  ThreadDetail,
  WorkbenchFileScope,
  WorkbenchPreviewContentState,
  WorkbenchPreviewRequest,
  WorkbenchPreviewTab,
} from '../types';

type RightWorkbenchProps = {
  activeTab: RightWorkbenchTab;
  activeProject: ProjectSummary | null;
  activeThread: ThreadDetail | null;
  fileScope: WorkbenchFileScope;
  isRunning: boolean;
  previewTabs: WorkbenchPreviewTab[];
  activePreviewKey: string;
  previewContentByKey: Record<string, WorkbenchPreviewContentState>;
  onSelectTab: (tab: RightWorkbenchTab) => void;
  onSelectFileScope: (scope: WorkbenchFileScope) => void;
  onOpenWorkbenchPreview: (request: WorkbenchPreviewRequest) => void;
  onSelectPreviewTab: (key: string) => void;
  onClosePreviewTab: (key: string) => void;
  onClosePreviewTabs: (keys: string[]) => void;
  onResolvePreviewContent: (key: string, state: WorkbenchPreviewContentState) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onClose: () => void;
};

export function RightWorkbench({
  activeTab,
  activeProject,
  activeThread,
  fileScope,
  isRunning,
  previewTabs,
  activePreviewKey,
  previewContentByKey,
  onSelectTab,
  onSelectFileScope,
  onOpenWorkbenchPreview,
  onSelectPreviewTab,
  onClosePreviewTab,
  onClosePreviewTabs,
  onResolvePreviewContent,
  onResizeStart,
  onClose,
}: RightWorkbenchProps) {
  return (
    <aside className="right-workbench" aria-label="右侧工作台">
      <div className="right-workbench-resizer" onPointerDown={onResizeStart} aria-hidden="true" />
      <div className="right-workbench-tabs" role="tablist" aria-label="工作台工具">
        <WorkbenchTab
          active={activeTab === 'overview'}
          icon={<LayoutDashboard size={15} />}
          label="概览"
          onClick={() => onSelectTab('overview')}
        />
        <WorkbenchTab
          active={activeTab === 'files'}
          icon={<Folder size={15} />}
          label="文件"
          onClick={() => onSelectTab('files')}
        />
        <WorkbenchTab
          active={activeTab === 'browser'}
          icon={<Globe2 size={15} />}
          label="浏览器"
          onClick={() => onSelectTab('browser')}
        />
        <button type="button" className="right-workbench-tab ghost" title="稍后添加工具">
          <Plus size={16} />
        </button>
        <button type="button" className="right-workbench-close" title="收起工作台" onClick={onClose}>
          <ExternalLink size={15} />
        </button>
      </div>

      <div className="right-workbench-content">
        {activeTab === 'overview' ? (
          <WorkbenchOverview activeProject={activeProject} activeThread={activeThread} isRunning={isRunning} />
        ) : null}
        {activeTab === 'files' ? (
          <WorkbenchFiles
            activeProject={activeProject}
            scope={fileScope}
            previewTabs={previewTabs}
            activePreviewKey={activePreviewKey}
            previewContentByKey={previewContentByKey}
            onSelectScope={onSelectFileScope}
            onOpenWorkbenchPreview={onOpenWorkbenchPreview}
            onSelectPreviewTab={onSelectPreviewTab}
            onClosePreviewTab={onClosePreviewTab}
            onClosePreviewTabs={onClosePreviewTabs}
            onResolvePreviewContent={onResolvePreviewContent}
          />
        ) : null}
        {activeTab === 'browser' ? <WorkbenchBrowserShell /> : null}
      </div>
    </aside>
  );
}

function WorkbenchTab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`right-workbench-tab${active ? ' active' : ''}`}
      role="tab"
      aria-selected={active}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function WorkbenchOverview({
  activeProject,
  activeThread,
  isRunning,
}: {
  activeProject: ProjectSummary | null;
  activeThread: ThreadDetail | null;
  isRunning: boolean;
}) {
  return (
    <section className="workbench-panel">
      <div className="workbench-section-head">
        <h3>概览</h3>
        <p>当前项目和会话的轻量状态。</p>
      </div>
      <div className="workbench-overview-grid">
        <InfoTile label="项目" value={activeProject?.name ?? '未选择项目'} />
        <InfoTile label="会话" value={activeThread?.title ?? '未选择聊天'} />
        <InfoTile label="运行状态" value={isRunning ? '正在运行' : '空闲'} />
        <InfoTile
          label="Git 变更"
          value={activeProject ? `${activeProject.gitDiff.filesChanged} 个文件` : '无项目'}
        />
      </div>
    </section>
  );
}

function WorkbenchFiles({
  activeProject,
  scope,
  previewTabs,
  activePreviewKey,
  previewContentByKey,
  onSelectScope,
  onOpenWorkbenchPreview,
  onSelectPreviewTab,
  onClosePreviewTab,
  onClosePreviewTabs,
  onResolvePreviewContent,
}: {
  activeProject: ProjectSummary | null;
  scope: WorkbenchFileScope;
  previewTabs: WorkbenchPreviewTab[];
  activePreviewKey: string;
  previewContentByKey: Record<string, WorkbenchPreviewContentState>;
  onSelectScope: (scope: WorkbenchFileScope) => void;
  onOpenWorkbenchPreview: (request: WorkbenchPreviewRequest) => void;
  onSelectPreviewTab: (key: string) => void;
  onClosePreviewTab: (key: string) => void;
  onClosePreviewTabs: (keys: string[]) => void;
  onResolvePreviewContent: (key: string, state: WorkbenchPreviewContentState) => void;
}) {
  const [projectFiles, setProjectFiles] = useState<ProjectFileEntry[]>([]);
  const [directoryFiles, setDirectoryFiles] = useState<Record<string, ProjectFileEntry[]>>({});
  const [expandedDirectories, setExpandedDirectories] = useState<string[]>([]);
  const [expandedChangedDirectories, setExpandedChangedDirectories] = useState<string[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState('');
  const [gitStatus, setGitStatus] = useState<GitStatusSnapshot | null>(null);
  const [fileFilter, setFileFilter] = useState('');
  const [navigatorVisible, setNavigatorVisible] = useState(true);
  const [navigatorWidth, setNavigatorWidth] = useState(292);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const dragNavigatorWidthRef = useRef<number | null>(null);
  const dragFrameRef = useRef<number | null>(null);

  const changedFiles = gitStatus?.files ?? [];
  const changedTree = useMemo(() => buildWorkbenchFileTree(changedFiles), [changedFiles]);
  const filteredChangedTree = useMemo(
    () => filterWorkbenchTree(changedTree, fileFilter),
    [changedTree, fileFilter],
  );
  const activePreviewTab = previewTabs.find((tab) => tab.key === activePreviewKey);
  const activePreviewTabKey = activePreviewTab?.key ?? '';
  const activePreviewPath = activePreviewTab?.path ?? '';
  const previewContentRef = useRef(previewContentByKey);
  const previewRequestKeysRef = useRef(new Set<string>());
  const activeProjectIdRef = useRef(activeProject?.id ?? '');
  previewContentRef.current = previewContentByKey;
  activeProjectIdRef.current = activeProject?.id ?? '';

  useEffect(() => {
    if (!activeProject) {
      setProjectFiles([]);
      setGitStatus(null);
      setError('');
      return;
    }

    void loadScope(scope);
  }, [activeProject?.id, scope]);

  useEffect(() => {
    if (!activeProject || !activePreviewTabKey) {
      return;
    }

    if (activePreviewTab?.source === 'conversation-card') {
      return;
    }

    const existingContent = previewContentRef.current[activePreviewTabKey];
    if (existingContent && !existingContent.loading) {
      return;
    }

    const projectId = activeProject.id;
    const requestKey = `${projectId}:${activePreviewTabKey}`;
    if (previewRequestKeysRef.current.has(requestKey)) {
      return;
    }

    previewRequestKeysRef.current.add(requestKey);
    onResolvePreviewContent(activePreviewTabKey, { loading: true, content: '' });

    const request = fetchWorkspaceFilePreview(resolveWorkbenchPreviewFilePath(activeProject.path, activePreviewPath));

    request
      .then((payload) => {
        if (activeProjectIdRef.current === projectId) {
          onResolvePreviewContent(activePreviewTabKey, { loading: false, content: payload.content });
        }
      })
      .catch((caughtError: unknown) => {
        if (activeProjectIdRef.current === projectId) {
          onResolvePreviewContent(activePreviewTabKey, {
            loading: false,
            content: '',
            error: caughtError instanceof Error ? caughtError.message : '读取文件失败',
          });
        }
      })
      .finally(() => {
        previewRequestKeysRef.current.delete(requestKey);
      });
  }, [activePreviewPath, activePreviewTab?.source, activePreviewTabKey, activeProject?.id, activeProject?.path, onResolvePreviewContent]);

  async function loadScope(nextScope = scope) {
    if (!activeProject) {
      return;
    }

    setLoading(true);
    setError('');
    try {
      if (nextScope === 'all') {
        const rootFiles = await fetchProjectFiles(activeProject.id);
        setProjectFiles(rootFiles);
        setDirectoryFiles({ '': rootFiles });
        setExpandedDirectories([]);
      } else {
        const nextStatus = await fetchGitStatus(activeProject.id);
        setGitStatus(nextStatus);
        const nextTree = buildWorkbenchFileTree(nextStatus.files);
        setExpandedChangedDirectories(collectDirectoryPaths(nextTree));
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '读取文件失败');
    } finally {
      setLoading(false);
    }
  }

  function openProjectFilePreview(file: ProjectFileEntry) {
    if (file.type !== 'file') {
      return;
    }

    onOpenWorkbenchPreview(buildProjectFilePreviewRequest(file));
  }

  function openChangedPreview(file: GitFileStatus) {
    onOpenWorkbenchPreview(buildChangedFilePreviewRequest(file));
  }

  async function toggleDirectory(directoryPath: string) {
    if (!activeProject) {
      return;
    }

    if (expandedDirectories.includes(directoryPath)) {
      setExpandedDirectories((directories) => directories.filter((item) => item !== directoryPath));
      return;
    }

    setExpandedDirectories((directories) => [...directories, directoryPath]);
    if (directoryFiles[directoryPath]) {
      return;
    }

    setLoadingDirectory(directoryPath);
    try {
      const children = await fetchProjectFiles(activeProject.id, directoryPath);
      setDirectoryFiles((current) => ({
        ...current,
        [directoryPath]: children,
      }));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '读取文件夹失败');
      setExpandedDirectories((directories) => directories.filter((item) => item !== directoryPath));
    } finally {
      setLoadingDirectory('');
    }
  }

  function toggleChangedDirectory(directoryPath: string) {
    setExpandedChangedDirectories((directories) =>
      directories.includes(directoryPath)
        ? directories.filter((item) => item !== directoryPath)
        : [...directories, directoryPath],
    );
  }

  function handleNavigatorResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (!navigatorVisible) {
      return;
    }

    event.preventDefault();
    const layout = layoutRef.current;
    if (!layout) {
      return;
    }

    const bounds = layout.getBoundingClientRect();
    const layoutStyle = layout.style;

    function flushNavigatorWidthOverride() {
      dragFrameRef.current = null;
      const nextWidth = dragNavigatorWidthRef.current;
      if (nextWidth === null) {
        return;
      }

      applyWorkbenchNavigatorWidthOverride(layoutStyle, nextWidth);
    }

    function handlePointerMove(moveEvent: PointerEvent) {
      const nextWidth = bounds.right - moveEvent.clientX;
      const clampedWidth = clampWorkbenchNavigatorWidth(nextWidth);
      dragNavigatorWidthRef.current = clampedWidth;
      if (dragFrameRef.current === null) {
        dragFrameRef.current = window.requestAnimationFrame(flushNavigatorWidthOverride);
      }
    }

    function stopResize() {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
        flushNavigatorWidthOverride();
      }

      const finalWidth = dragNavigatorWidthRef.current;
      dragNavigatorWidthRef.current = null;
      if (finalWidth !== null && finalWidth !== navigatorWidth) {
        setNavigatorWidth(finalWidth);
        requestAnimationFrame(() => clearWorkbenchNavigatorWidthOverride(layoutStyle));
        return;
      }

      clearWorkbenchNavigatorWidthOverride(layoutStyle);
    }

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize, { once: true });
  }

  return (
    <section className="workbench-panel workbench-files-panel">
      {!activeProject ? (
        <WorkbenchEmpty icon={<Folder size={24} />} title="未选择项目" description="选择项目后查看项目文件。" />
      ) : (
        <div
          ref={layoutRef}
          className={`workbench-files-layout${navigatorVisible ? '' : ' navigator-hidden'}`}
          style={{
            '--workbench-layout-columns': buildWorkbenchFilesLayoutColumns(navigatorVisible, navigatorWidth),
            '--workbench-navigator-width': `${clampWorkbenchNavigatorWidth(navigatorWidth)}px`,
          } as CSSProperties}
        >
          <PreviewPane
            tabs={previewTabs}
            activeKey={activePreviewKey}
            contentByKey={previewContentByKey}
            onSelectTab={onSelectPreviewTab}
            onCloseTab={onClosePreviewTab}
            onCloseTabs={onClosePreviewTabs}
          />
          {navigatorVisible ? (
            <>
              <div
                className="workbench-files-inner-resizer"
                onPointerDown={handleNavigatorResizeStart}
                aria-hidden="true"
              />
              <FileNavigator
                scope={scope}
                loading={loading}
                error={error}
                filter={fileFilter}
                changedFilesCount={changedFiles.length}
                projectFiles={projectFiles}
                directoryFiles={directoryFiles}
                expandedDirectories={expandedDirectories}
                expandedChangedDirectories={expandedChangedDirectories}
                loadingDirectory={loadingDirectory}
                changedTree={filteredChangedTree}
                activePreviewKey={activePreviewKey}
                onFilterChange={setFileFilter}
                onSelectScope={onSelectScope}
                onRefresh={() => void loadScope(scope)}
                onHide={() => setNavigatorVisible(false)}
                onToggleDirectory={toggleDirectory}
                onToggleChangedDirectory={toggleChangedDirectory}
                onOpenProjectFile={openProjectFilePreview}
                onOpenChangedFile={openChangedPreview}
              />
            </>
          ) : (
            <button
              type="button"
              className="workbench-file-navigator-rail"
              title="显示文件树"
              onClick={() => setNavigatorVisible(true)}
            >
              <Folder size={15} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function PreviewPane({
  tabs,
  activeKey,
  contentByKey,
  onSelectTab,
  onCloseTab,
  onCloseTabs,
}: {
  tabs: WorkbenchPreviewTab[];
  activeKey: string;
  contentByKey: Record<string, WorkbenchPreviewContentState>;
  onSelectTab: (key: string) => void;
  onCloseTab: (key: string) => void;
  onCloseTabs: (keys: string[]) => void;
}) {
  const activeTab = tabs.find((tab) => tab.key === activeKey);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  const contextMenuAnchorRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    key: string;
    name: string;
    path: string;
    index: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    });
  }, [activeKey, tabs.length]);

  useEffect(() => {
    setOverflowOpen(false);
  }, [activeKey, tabs.length]);

  useEffect(() => {
    if (!overflowOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!overflowRef.current?.contains(event.target as Node)) {
        setOverflowOpen(false);
      }
    }

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [overflowOpen]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!contextMenuRef.current?.contains(event.target as Node)) {
        setContextMenu(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    }

    function handleResize() {
      setContextMenu(null);
    }

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [contextMenu]);

  return (
    <main className="workbench-preview-pane">
      <div ref={contextMenuAnchorRef} className="workbench-preview-head">
        <div className="workbench-preview-tabs" role="tablist" aria-label="文件预览">
          {tabs.map((tab, index) => {
            const active = tab.key === activeKey;

            return (
              <div
                key={tab.key}
                className={`workbench-preview-tab-shell${active ? ' active' : ''}`}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({
                    key: tab.key,
                    name: tab.name,
                    path: tab.path,
                    index,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                >
                <button
                  ref={active ? activeTabRef : null}
                  type="button"
                  className={`workbench-preview-tab${active ? ' active' : ''}`}
                  onClick={() => onSelectTab(tab.key)}
                  >
                    <FileIcon path={tab.path} type="file" />
                    <span className="workbench-preview-tab-label">
                      {tab.source === 'conversation-card' ? (
                        <GitPullRequest className="workbench-preview-review-icon" size={12} />
                    ) : null}
                    <span>{tab.name}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="workbench-preview-tab-close"
                  title={`关闭 ${tab.name}`}
                  aria-label={`关闭 ${tab.name}`}
                  onClick={() => onCloseTab(tab.key)}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
        {tabs.length > 1 ? (
          <div ref={overflowRef} className={`workbench-preview-overflow${overflowOpen ? ' open' : ''}`}>
            <button
              type="button"
              className="workbench-icon-button workbench-preview-overflow-trigger"
              title="标签列表"
              aria-label="标签列表"
              aria-expanded={overflowOpen}
              onClick={() => setOverflowOpen((current) => !current)}
            >
              <MoreHorizontal size={15} />
            </button>
            {overflowOpen ? (
              <div className="workbench-preview-overflow-menu">
                {tabs.map((tab, index) => {
                  const active = tab.key === activeKey;

                  return (
                    <button
                      key={`overflow-${tab.key}`}
                      type="button"
                      className={`workbench-preview-overflow-item${active ? ' active' : ''}`}
                      onClick={() => onSelectTab(tab.key)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setContextMenu({
                          key: tab.key,
                          name: tab.name,
                          path: tab.path,
                          index,
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                    >
                      <FileIcon path={tab.path} type="file" />
                      <span className="workbench-preview-overflow-label">
                        {tab.source === 'conversation-card' ? (
                          <GitPullRequest className="workbench-preview-review-icon" size={12} />
                        ) : null}
                        <span title={tab.path}>{tab.name}</span>
                      </span>
                      {active ? <Check size={13} /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <PopoverPortal
        open={Boolean(contextMenu)}
        anchorRef={contextMenuAnchorRef}
        virtualAnchor={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        placement="bottom-start"
        offset={0}
      >
        <div ref={contextMenuRef} className="workspace-menu workbench-preview-context-menu" role="menu" aria-label="标签菜单">
          <button
            type="button"
            className="workspace-menu-item"
            role="menuitem"
            disabled={tabs.length <= 1}
            onClick={() => {
              if (!contextMenu) {
                return;
              }

              onCloseTab(contextMenu.key);
              setContextMenu(null);
            }}
          >
            <span>关闭</span>
          </button>
          <button
            type="button"
            className="workspace-menu-item"
            role="menuitem"
            onClick={() => {
              if (!contextMenu) {
                return;
              }

              onCloseTabs(tabs.filter((tab) => tab.key !== contextMenu.key).map((tab) => tab.key));
              setContextMenu(null);
            }}
          >
            <span>关闭其他标签页</span>
          </button>
          <button
            type="button"
            className="workspace-menu-item"
            role="menuitem"
            disabled={!contextMenu || contextMenu.index <= 0}
            onClick={() => {
              if (!contextMenu) {
                return;
              }

              onCloseTabs(tabs.slice(0, contextMenu.index).map((tab) => tab.key));
              setContextMenu(null);
            }}
          >
            <span>关闭左侧标签页</span>
          </button>
          <button
            type="button"
            className="workspace-menu-item"
            role="menuitem"
            disabled={!contextMenu || contextMenu.index >= tabs.length - 1}
            onClick={() => {
              if (!contextMenu) {
                return;
              }

              onCloseTabs(tabs.slice(contextMenu.index + 1).map((tab) => tab.key));
              setContextMenu(null);
            }}
          >
            <span>关闭右侧标签页</span>
          </button>
          <button
            type="button"
            className="workspace-menu-item"
            role="menuitem"
            disabled={tabs.length === 0}
            onClick={() => {
              onCloseTabs(tabs.map((tab) => tab.key));
              setContextMenu(null);
            }}
          >
            <span>关闭所有标签页</span>
          </button>
          <div className="workspace-menu-divider" role="separator" />
          <button
            type="button"
            className="workspace-menu-item"
            role="menuitem"
            onClick={() => {
              if (!contextMenu) {
                return;
              }

              void navigator.clipboard.writeText(contextMenu.path);
              setContextMenu(null);
            }}
          >
            <span>复制路径</span>
          </button>
        </div>
      </PopoverPortal>
      <div className="workbench-preview-content">
        {!activeTab ? (
          <WorkbenchEmpty icon={<FileText size={24} />} title="选择文件查看预览" description="从右侧文件树选择代码、Markdown 或变更文件。" />
        ) : (
          tabs.map((tab) => {
            const content = contentByKey[tab.key];
            const active = tab.key === activeKey;

            return (
              <div key={tab.key} className={`workbench-preview-panel${active ? ' active' : ''}`} aria-hidden={!active}>
                {content?.loading ? (
                  <WorkbenchEmpty icon={<RefreshCw className="spin" size={24} />} title="正在读取文件" description={tab.path} />
                ) : content?.error ? (
                  <WorkbenchEmpty icon={<FileText size={24} />} title="预览失败" description={content.error} />
                ) : content?.mode === 'git-diff' ? (
                  <MemoGitDiffPreview content={content.content} />
                ) : tab.kind === 'markdown' ? (
                  <MemoMarkdownPreview content={content?.content ?? ''} />
                ) : (
                  <MemoCodePreview content={content?.content ?? ''} filePath={tab.path} />
                )}
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}

function FileNavigator({
  scope,
  loading,
  error,
  filter,
  changedFilesCount,
  projectFiles,
  directoryFiles,
  expandedDirectories,
  expandedChangedDirectories,
  loadingDirectory,
  changedTree,
  activePreviewKey,
  onFilterChange,
  onSelectScope,
  onRefresh,
  onHide,
  onToggleDirectory,
  onToggleChangedDirectory,
  onOpenProjectFile,
  onOpenChangedFile,
}: {
  scope: WorkbenchFileScope;
  loading: boolean;
  error: string;
  filter: string;
  changedFilesCount: number;
  projectFiles: ProjectFileEntry[];
  directoryFiles: Record<string, ProjectFileEntry[]>;
  expandedDirectories: string[];
  expandedChangedDirectories: string[];
  loadingDirectory: string;
  changedTree: WorkbenchFileTreeNode[];
  activePreviewKey: string;
  onFilterChange: (filter: string) => void;
  onSelectScope: (scope: WorkbenchFileScope) => void;
  onRefresh: () => void;
  onHide: () => void;
  onToggleDirectory: (directoryPath: string) => void;
  onToggleChangedDirectory: (directoryPath: string) => void;
  onOpenProjectFile: (file: ProjectFileEntry) => void;
  onOpenChangedFile: (file: GitFileStatus) => void;
}) {
  return (
    <aside className="workbench-file-navigator" aria-label="文件导航">
      <div className="workbench-files-head">
        <button
          type="button"
          className="workbench-scope-trigger"
          onClick={() => onSelectScope(scope === 'all' ? 'changed' : 'all')}
        >
          {scope === 'all' ? '所有文件' : '已更改文件'}
          {scope === 'changed' ? <span>{changedFilesCount}</span> : null}
          <ChevronDown size={15} />
        </button>
        <div className="workbench-files-actions">
          <button
            type="button"
            className="workbench-icon-button"
            title="刷新"
            disabled={loading}
            onClick={onRefresh}
          >
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            className="workbench-icon-button"
            title="隐藏文件树"
            onClick={onHide}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <label className="workbench-file-filter">
        <span>⌕</span>
        <input
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder="筛选文件..."
        />
      </label>
      <div className="workbench-file-tree-scroll">
        {error ? (
          <WorkbenchEmpty icon={<Folder size={24} />} title="读取失败" description={error} />
        ) : loading ? (
          <WorkbenchEmpty icon={<RefreshCw className="spin" size={24} />} title="正在读取文件" description="请稍等。" />
        ) : scope === 'all' ? (
          <AllFilesList
            files={projectFiles}
            directoryFiles={directoryFiles}
            expandedDirectories={expandedDirectories}
            loadingDirectory={loadingDirectory}
            filter={filter}
            activePreviewKey={activePreviewKey}
            onToggleDirectory={onToggleDirectory}
            onOpenFile={onOpenProjectFile}
          />
        ) : changedTree.length ? (
          <ChangedFileTree
            nodes={changedTree}
            expandedDirectories={expandedChangedDirectories}
            activePreviewKey={activePreviewKey}
            onToggleDirectory={onToggleChangedDirectory}
            onOpenFile={onOpenChangedFile}
          />
        ) : (
          <WorkbenchEmpty icon={<GitPullRequest size={24} />} title="当前没有变更" description="工作区很干净，可以继续开发。" />
        )}
      </div>
    </aside>
  );
}

function AllFilesList({
  files,
  directoryFiles,
  expandedDirectories,
  loadingDirectory,
  filter,
  activePreviewKey,
  onToggleDirectory,
  onOpenFile,
}: {
  files: ProjectFileEntry[];
  directoryFiles: Record<string, ProjectFileEntry[]>;
  expandedDirectories: string[];
  loadingDirectory: string;
  filter: string;
  activePreviewKey: string;
  onToggleDirectory: (directoryPath: string) => void;
  onOpenFile: (file: ProjectFileEntry) => void;
}) {
  if (files.length === 0) {
    return <WorkbenchEmpty icon={<Folder size={24} />} title="没有文件" description="当前项目目录为空。" />;
  }

  return (
    <div className="workbench-all-files-list">
      {renderProjectFileRows({
        files,
        directoryFiles,
        expandedDirectories,
        loadingDirectory,
        filter,
        activePreviewKey,
        depth: 0,
        onToggleDirectory,
        onOpenFile,
      })}
    </div>
  );
}

function renderProjectFileRows({
  files,
  directoryFiles,
  expandedDirectories,
  loadingDirectory,
  filter,
  activePreviewKey,
  depth,
  onToggleDirectory,
  onOpenFile,
}: {
  files: ProjectFileEntry[];
  directoryFiles: Record<string, ProjectFileEntry[]>;
  expandedDirectories: string[];
  loadingDirectory: string;
  filter: string;
  activePreviewKey: string;
  depth: number;
  onToggleDirectory: (directoryPath: string) => void;
  onOpenFile: (file: ProjectFileEntry) => void;
}): ReactNode[] {
  return files.flatMap<ReactNode>((file): ReactNode[] => {
    const isDirectory = file.type === 'directory';
    const expanded = isDirectory && expandedDirectories.includes(file.path);
    const children = directoryFiles[file.path] ?? [];
    const visibleChildren = filterProjectEntries(children, filter);
    if (filter && !file.path.toLowerCase().includes(filter.toLowerCase()) && visibleChildren.length === 0) {
      return [];
    }

    const row = (
      <button
        key={file.path}
        type="button"
        className={`workbench-tree-row${activePreviewKey === `file:${file.path}` ? ' active' : ''}`}
        style={{ paddingLeft: `${10 + depth * 18}px` }}
        onClick={() => {
          if (isDirectory) {
            void onToggleDirectory(file.path);
          } else {
            onOpenFile(file);
          }
        }}
      >
        {isDirectory ? (
          expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />
        ) : (
          <span className="workbench-tree-spacer" />
        )}
        <FileIcon path={file.path} type={file.type} />
        <span title={file.path}>{file.name}</span>
        {loadingDirectory === file.path ? <RefreshCw className="spin" size={13} /> : null}
      </button>
    );

    if (!expanded) {
      return [row];
    }

    const childRows: ReactNode[] = visibleChildren.length
      ? renderProjectFileRows({
          files: visibleChildren,
          directoryFiles,
          expandedDirectories,
          loadingDirectory,
          filter,
          activePreviewKey,
          depth: depth + 1,
          onToggleDirectory,
          onOpenFile,
        })
      : [
          <div key={`${file.path}:empty`} className="workbench-tree-empty" style={{ paddingLeft: `${43 + depth * 18}px` }}>
            空文件夹
          </div>,
        ];

    return [row, ...childRows];
  });
}

function ChangedFileTree({
  nodes,
  expandedDirectories,
  activePreviewKey,
  onToggleDirectory,
  onOpenFile,
}: {
  nodes: WorkbenchFileTreeNode[];
  expandedDirectories: string[];
  activePreviewKey: string;
  onToggleDirectory: (directoryPath: string) => void;
  onOpenFile: (file: GitFileStatus) => void;
}) {
  return (
    <div className="workbench-all-files-list">
      {renderChangedFileTreeRows({
        nodes,
        expandedDirectories,
        activePreviewKey,
        depth: 0,
        onToggleDirectory,
        onOpenFile,
      })}
    </div>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="workbench-markdown-preview">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function CodePreview({ content, filePath }: { content: string; filePath: string }) {
  const lines = useMemo(() => (content ? content.split('\n') : ['文件为空。']), [content]);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [highlightedLines, setHighlightedLines] = useState<HighlightedCodeToken[][] | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(420);
  const largeFilePreview = shouldUseLargeFilePreview(content, lines.length);

  const visibleRange = useMemo(
    () => getWorkbenchVisibleLineRange(lines.length, scrollTop, viewportHeight),
    [lines.length, scrollTop, viewportHeight],
  );
  const visibleLines = useMemo(
    () => lines.slice(visibleRange.start, visibleRange.end),
    [lines, visibleRange.end, visibleRange.start],
  );
  const totalHeight = lines.length * WORKBENCH_CODE_LINE_HEIGHT;

  useEffect(() => {
    let cancelled = false;
    setHighlightedLines(null);

    if (!content || largeFilePreview) {
      return undefined;
    }

    void highlightWorkbenchCode(content, filePath).then((nextLines) => {
      if (!cancelled) {
        setHighlightedLines(nextLines);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [content, filePath, largeFilePreview]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) {
      return undefined;
    }

    const updateViewportHeight = () => {
      setViewportHeight(preview.clientHeight);
    };

    updateViewportHeight();
    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(preview);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={previewRef}
      className={`workbench-code-preview${largeFilePreview ? ' large-file' : ''}`}
      role="region"
      aria-label="代码预览"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div
        className="workbench-code-virtual-spacer"
        style={{ height: `${Math.max(totalHeight, WORKBENCH_CODE_LINE_HEIGHT)}px` }}
      >
        <div
          className="workbench-code-virtual-window"
          style={{ transform: `translateY(${visibleRange.start * WORKBENCH_CODE_LINE_HEIGHT}px)` }}
        >
          {visibleLines.map((line, visibleIndex) => {
            const lineIndex = visibleRange.start + visibleIndex;

            return (
              <div key={`${lineIndex}-${line}`} className="workbench-code-line">
                <span className="workbench-code-line-no">{lineIndex + 1}</span>
                <span className="workbench-code-line-text">
                  {renderCodeLineContent(
                    largeFilePreview ? undefined : highlightedLines?.[lineIndex],
                    line,
                    filePath,
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const MemoMarkdownPreview = memo(MarkdownPreview);
const MemoCodePreview = memo(CodePreview);

function renderCodeLineContent(
  highlightedLine: HighlightedCodeToken[] | undefined,
  fallbackLine: string,
  filePath: string,
) {
  if (highlightedLine?.length) {
    return highlightedLine.map((token, index) => (
      <span
        key={`${index}-${token.content}`}
        style={{
          color: token.color,
          fontStyle: token.fontStyle && (token.fontStyle & 1) ? 'italic' : undefined,
          fontWeight: token.fontStyle && (token.fontStyle & 2) ? 600 : undefined,
          textDecoration: token.fontStyle && (token.fontStyle & 4) ? 'underline' : undefined,
        }}
      >
        {token.content || ' '}
      </span>
    ));
  }

  return highlightWorkbenchCodeLine(fallbackLine, filePath).map((segment, segmentIndex) => (
    <span
      key={`${segmentIndex}-${segment.text}`}
      className={segment.kind ? `syntax-${segment.kind}` : undefined}
    >
      {segment.text || ' '}
    </span>
  ));
}

function renderChangedFileTreeRows({
  nodes,
  expandedDirectories,
  activePreviewKey,
  depth,
  onToggleDirectory,
  onOpenFile,
}: {
  nodes: WorkbenchFileTreeNode[];
  expandedDirectories: string[];
  activePreviewKey: string;
  depth: number;
  onToggleDirectory: (directoryPath: string) => void;
  onOpenFile: (file: GitFileStatus) => void;
}): ReactNode[] {
  return nodes.flatMap((node): ReactNode[] => {
    const expanded = node.type === 'directory' && expandedDirectories.includes(node.path);
    const statusTone = node.gitFile ? getGitStatusTone(node.gitFile.status) : '';
    const row = (
      <button
        key={node.path}
        type="button"
        className={`workbench-tree-row${statusTone ? ` status-${statusTone}` : ''}${activePreviewKey === `file:${node.path}` ? ' active' : ''}`}
        style={{ paddingLeft: `${10 + depth * 18}px` }}
        onClick={() => {
          if (node.type === 'directory') {
            onToggleDirectory(node.path);
          } else if (node.gitFile) {
            onOpenFile(node.gitFile);
          }
        }}
      >
        {node.type === 'directory' ? (
          expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />
        ) : (
          <span className="workbench-tree-spacer" />
        )}
        <FileIcon path={node.path} type={node.type} expanded={expanded} />
        <span className={statusTone ? `workbench-file-name status-${statusTone}` : 'workbench-file-name'} title={node.path}>
          {node.name}
        </span>
      </button>
    );

    if (node.type !== 'directory' || !expanded) {
      return [row];
    }

    return [
      row,
      ...renderChangedFileTreeRows({
        nodes: node.children,
        expandedDirectories,
        activePreviewKey,
        depth: depth + 1,
        onToggleDirectory,
        onOpenFile,
      }),
    ];
  });
}

function FileIcon({
  path,
  type,
  expanded = false,
}: {
  path: string;
  type: 'directory' | 'file';
  expanded?: boolean;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  const iconSrc = resolveWorkbenchFileIcon(path, type, { expanded });
  const iconKind = getWorkbenchFileIconKind(path, type);
  if (!iconFailed && iconSrc) {
    return (
      <img
        className={`workbench-file-icon ${type === 'directory' ? 'folder' : 'file'}`}
        src={iconSrc}
        alt=""
        aria-hidden="true"
        onError={() => setIconFailed(true)}
      />
    );
  }

  if (iconKind === 'folder') {
    return <Folder size={16} />;
  }

  return (
    <span className={`workbench-file-badge ${iconKind}`} aria-hidden="true">
      {getFileBadgeLabel(iconKind)}
    </span>
  );
}

function getGitStatusTone(status: string) {
  const normalizedStatus = status.trim().toLowerCase();
  if (normalizedStatus.includes('新增') || normalizedStatus.includes('未跟踪') || normalizedStatus.includes('untracked') || normalizedStatus === 'a' || normalizedStatus === '??') {
    return 'added';
  }
  if (normalizedStatus.includes('删除') || normalizedStatus.includes('deleted') || normalizedStatus === 'd') {
    return 'deleted';
  }
  if (normalizedStatus.includes('重命名') || normalizedStatus.includes('renamed') || normalizedStatus === 'r') {
    return 'renamed';
  }

  return 'modified';
}

function getFileBadgeLabel(iconKind: string) {
  if (iconKind === 'react') {
    return '⚛';
  }
  if (iconKind === 'html') {
    return 'HT';
  }
  if (iconKind === 'style') {
    return 'ST';
  }
  if (iconKind === 'md') {
    return 'M';
  }
  if (iconKind === 'json') {
    return '{}';
  }
  if (iconKind === 'script') {
    return '</>';
  }
  if (iconKind === 'config') {
    return 'CFG';
  }
  if (iconKind === 'database') {
    return 'DB';
  }
  if (iconKind === 'sheet') {
    return 'XL';
  }
  if (iconKind === 'image') {
    return 'IMG';
  }
  if (iconKind === 'document') {
    return 'DOC';
  }
  if (iconKind === 'archive') {
    return 'ZIP';
  }
  if (iconKind === 'media') {
    return 'AV';
  }

  return '·';
}

function getDiffLineClass(line: string) {
  if (line.startsWith('+++') || line.startsWith('---')) {
    return 'meta';
  }
  if (line.startsWith('@@')) {
    return 'hunk';
  }
  if (line.startsWith('+')) {
    return 'added';
  }
  if (line.startsWith('-')) {
    return 'removed';
  }

  return '';
}

function filterProjectEntries(files: ProjectFileEntry[], filter: string) {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) {
    return files;
  }

  return files.filter((file) => file.path.toLowerCase().includes(normalizedFilter));
}

function filterWorkbenchTree(nodes: WorkbenchFileTreeNode[], filter: string): WorkbenchFileTreeNode[] {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) {
    return nodes;
  }

  return nodes.flatMap((node) => {
    const children = filterWorkbenchTree(node.children, filter);
    if (node.path.toLowerCase().includes(normalizedFilter) || children.length > 0) {
      return [{ ...node, children }];
    }

    return [];
  });
}

function collectDirectoryPaths(nodes: WorkbenchFileTreeNode[]) {
  return nodes.flatMap((node): string[] => {
    if (node.type !== 'directory') {
      return [];
    }

    return [node.path, ...collectDirectoryPaths(node.children)];
  });
}

function WorkbenchEmpty({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="workbench-placeholder">
      {icon}
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function WorkbenchBrowserShell() {
  return (
    <section className="workbench-panel workbench-browser-panel">
      <div className="workbench-browser-toolbar">
        <button type="button" disabled>←</button>
        <button type="button" disabled>→</button>
        <button type="button" disabled>↻</button>
        <input type="text" placeholder="输入 URL" disabled />
        <button type="button" disabled>↗</button>
      </div>
      <div className="workbench-browser-empty">空白页</div>
    </section>
  );
}

function GitDiffPreview({ content }: { content: string }) {
  const lines = content ? content.split('\n') : ['当前没有可显示的改动。'];

  return (
    <div className="workbench-code-preview workbench-diff-content" role="region" aria-label="变更预览">
      {lines.map((line, index) => (
        <div key={`${index}-${line}`} className={`git-diff-line ${getDiffLineClass(line)}`}>
          <span className="git-diff-line-no">{index + 1}</span>
          <span className="git-diff-line-text">{line || ' '}</span>
        </div>
      ))}
    </div>
  );
}

const MemoGitDiffPreview = memo(GitDiffPreview);

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="workbench-info-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
