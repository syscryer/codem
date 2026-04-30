import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  Globe2,
  GitPullRequest,
  LayoutDashboard,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fetchWorkspaceFilePreview } from '../lib/file-preview-api';
import { fetchGitFileDiff, fetchGitStatus } from '../lib/git-api';
import { fetchProjectFiles } from '../lib/project-files-api';
import {
  buildWorkbenchFileTree,
  combineProjectFilePath,
  getWorkbenchFileIconKind,
  getWorkbenchPreviewKind,
  highlightWorkbenchCodeLine,
  type WorkbenchFileTreeNode,
  type WorkbenchPreviewKind,
} from '../lib/workbench-files';
import type {
  GitFileStatus,
  GitStatusSnapshot,
  ProjectFileEntry,
  ProjectSummary,
  RightWorkbenchTab,
  ThreadDetail,
  WorkbenchFileScope,
  WorkbenchFileTab,
} from '../types';

type RightWorkbenchProps = {
  activeTab: RightWorkbenchTab;
  activeProject: ProjectSummary | null;
  activeThread: ThreadDetail | null;
  fileScope: WorkbenchFileScope;
  isRunning: boolean;
  files: WorkbenchFileTab[];
  onSelectTab: (tab: RightWorkbenchTab) => void;
  onSelectFileScope: (scope: WorkbenchFileScope) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onClose: () => void;
};

export function RightWorkbench({
  activeTab,
  activeProject,
  activeThread,
  fileScope,
  isRunning,
  files,
  onSelectTab,
  onSelectFileScope,
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
        {files.map((file) => (
          <WorkbenchTab
            key={file.path}
            active={activeTab === `file:${file.path}`}
            icon={<FileText size={15} />}
            label={file.name}
            onClick={() => onSelectTab(`file:${file.path}`)}
          />
        ))}
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
            onSelectScope={onSelectFileScope}
          />
        ) : null}
        {activeTab === 'browser' ? <WorkbenchBrowserShell /> : null}
        {activeTab.startsWith('file:') ? (
          <WorkbenchFilePlaceholder file={files.find((item) => activeTab === `file:${item.path}`)} />
        ) : null}
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
  onSelectScope,
}: {
  activeProject: ProjectSummary | null;
  scope: WorkbenchFileScope;
  onSelectScope: (scope: WorkbenchFileScope) => void;
}) {
  const [projectFiles, setProjectFiles] = useState<ProjectFileEntry[]>([]);
  const [directoryFiles, setDirectoryFiles] = useState<Record<string, ProjectFileEntry[]>>({});
  const [expandedDirectories, setExpandedDirectories] = useState<string[]>([]);
  const [expandedChangedDirectories, setExpandedChangedDirectories] = useState<string[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState('');
  const [gitStatus, setGitStatus] = useState<GitStatusSnapshot | null>(null);
  const [previewTabs, setPreviewTabs] = useState<WorkbenchPreviewTab[]>([]);
  const [activePreviewKey, setActivePreviewKey] = useState('');
  const [previewContentByKey, setPreviewContentByKey] = useState<Record<string, PreviewContentState>>({});
  const [fileFilter, setFileFilter] = useState('');
  const [navigatorVisible, setNavigatorVisible] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const changedFiles = gitStatus?.files ?? [];
  const changedTree = useMemo(() => buildWorkbenchFileTree(changedFiles), [changedFiles]);
  const filteredChangedTree = useMemo(
    () => filterWorkbenchTree(changedTree, fileFilter),
    [changedTree, fileFilter],
  );
  const activePreviewTab = previewTabs.find((tab) => tab.key === activePreviewKey);

  useEffect(() => {
    if (!activeProject) {
      setProjectFiles([]);
      setGitStatus(null);
      setPreviewTabs([]);
      setActivePreviewKey('');
      setPreviewContentByKey({});
      setError('');
      return;
    }

    void loadScope(scope);
  }, [activeProject?.id, scope]);

  useEffect(() => {
    if (!activeProject || !activePreviewTab || previewContentByKey[activePreviewTab.key]) {
      return;
    }

    let cancelled = false;
    setPreviewContentByKey((current) => ({
      ...current,
      [activePreviewTab.key]: { loading: true, content: '' },
    }));

    const request =
      activePreviewTab.kind === 'diff'
        ? fetchGitFileDiff(activeProject.id, activePreviewTab.path)
        : fetchWorkspaceFilePreview(combineProjectFilePath(activeProject.path, activePreviewTab.path));

    request
      .then((payload) => {
        if (!cancelled) {
          setPreviewContentByKey((current) => ({
            ...current,
            [activePreviewTab.key]: { loading: false, content: payload.content },
          }));
        }
      })
      .catch((caughtError: unknown) => {
        if (!cancelled) {
          setPreviewContentByKey((current) => ({
            ...current,
            [activePreviewTab.key]: {
              loading: false,
              content: '',
              error: caughtError instanceof Error ? caughtError.message : '读取文件失败',
            },
          }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activePreviewTab?.key, activeProject?.id]);

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
        const activeDiffPath = activePreviewKey.startsWith('diff:') ? activePreviewKey.slice('diff:'.length) : '';
        const activeDiffStillExists = nextStatus.files.some((file) => file.path === activeDiffPath);
        if (nextStatus.files[0] && !activeDiffStillExists) {
          openChangedPreview(nextStatus.files[0]);
        }
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

    const tab: WorkbenchPreviewTab = {
      key: `file:${file.path}`,
      path: file.path,
      name: file.name,
      kind: getWorkbenchPreviewKind(file.path),
    };
    openPreviewTab(tab);
  }

  function openChangedPreview(file: GitFileStatus) {
    const tab: WorkbenchPreviewTab = {
      key: `diff:${file.path}`,
      path: file.path,
      name: getFileName(file.path),
      kind: 'diff',
      status: file.status,
    };
    openPreviewTab(tab);
  }

  function openPreviewTab(tab: WorkbenchPreviewTab) {
    setPreviewTabs((currentTabs) => {
      if (currentTabs.some((item) => item.key === tab.key)) {
        return currentTabs;
      }

      return [...currentTabs, tab];
    });
    setActivePreviewKey(tab.key);
  }

  function closePreviewTab(tabKey: string) {
    setPreviewTabs((currentTabs) => {
      const tabIndex = currentTabs.findIndex((tab) => tab.key === tabKey);
      const nextTabs = currentTabs.filter((tab) => tab.key !== tabKey);
      if (activePreviewKey === tabKey) {
        setActivePreviewKey(nextTabs[Math.max(0, tabIndex - 1)]?.key ?? '');
      }

      return nextTabs;
    });
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

  return (
    <section className="workbench-panel workbench-files-panel">
      {!activeProject ? (
        <WorkbenchEmpty icon={<Folder size={24} />} title="未选择项目" description="选择项目后查看项目文件。" />
      ) : (
        <div className={`workbench-files-layout${navigatorVisible ? '' : ' navigator-hidden'}`}>
          <PreviewPane
            tabs={previewTabs}
            activeKey={activePreviewKey}
            content={activePreviewKey ? previewContentByKey[activePreviewKey] : undefined}
            onSelectTab={setActivePreviewKey}
            onCloseTab={closePreviewTab}
          />
          {navigatorVisible ? (
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

type WorkbenchPreviewTab = {
  key: string;
  path: string;
  name: string;
  kind: WorkbenchPreviewKind | 'diff';
  status?: string;
};

type PreviewContentState = {
  loading: boolean;
  content: string;
  error?: string;
};

function PreviewPane({
  tabs,
  activeKey,
  content,
  onSelectTab,
  onCloseTab,
}: {
  tabs: WorkbenchPreviewTab[];
  activeKey: string;
  content?: PreviewContentState;
  onSelectTab: (key: string) => void;
  onCloseTab: (key: string) => void;
}) {
  const activeTab = tabs.find((tab) => tab.key === activeKey);

  return (
    <main className="workbench-preview-pane">
      <div className="workbench-preview-tabs" role="tablist" aria-label="文件预览">
        <span className="workbench-preview-fixed-tab">审查</span>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`workbench-preview-tab${tab.key === activeKey ? ' active' : ''}`}
            onClick={() => onSelectTab(tab.key)}
          >
            <FileIcon path={tab.path} type="file" />
            <span>{tab.name}</span>
            <X
              size={13}
              onClick={(event) => {
                event.stopPropagation();
                onCloseTab(tab.key);
              }}
            />
          </button>
        ))}
      </div>
      <div className="workbench-preview-content">
        {!activeTab ? (
          <WorkbenchEmpty icon={<FileText size={24} />} title="选择文件查看预览" description="从右侧文件树选择代码、Markdown 或变更文件。" />
        ) : content?.loading ? (
          <WorkbenchEmpty icon={<RefreshCw className="spin" size={24} />} title="正在读取文件" description={activeTab.path} />
        ) : content?.error ? (
          <WorkbenchEmpty icon={<FileText size={24} />} title="预览失败" description={content.error} />
        ) : activeTab.kind === 'diff' ? (
          <DiffPreview content={content?.content || '正在准备差异预览。'} />
        ) : activeTab.kind === 'markdown' ? (
          <MarkdownPreview content={content?.content ?? ''} />
        ) : (
          <CodePreview content={content?.content ?? ''} filePath={activeTab.path} />
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

function DiffPreview({ content }: { content: string }) {
  return (
    <div className="git-diff-content workbench-diff-content" role="region" aria-label="文件差异预览">
      {content.split('\n').map((line, index) => (
        <div key={`${index}-${line}`} className={`git-diff-line ${getDiffLineClass(line)}`}>
          <span className="git-diff-line-no">{index + 1}</span>
          <span className="git-diff-line-text">{line || ' '}</span>
        </div>
      ))}
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
  const lines = content ? content.split('\n') : ['文件为空。'];

  return (
    <div className="workbench-code-preview" role="region" aria-label="代码预览">
      {lines.map((line, lineIndex) => (
        <div key={`${lineIndex}-${line}`} className="workbench-code-line">
          <span className="workbench-code-line-no">{lineIndex + 1}</span>
          <span className="workbench-code-line-text">
            {highlightWorkbenchCodeLine(line, filePath).map((segment, segmentIndex) => (
              <span
                key={`${segmentIndex}-${segment.text}`}
                className={segment.kind ? `syntax-${segment.kind}` : undefined}
              >
                {segment.text || ' '}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
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
        className={`workbench-tree-row${statusTone ? ` status-${statusTone}` : ''}${activePreviewKey === `diff:${node.path}` ? ' active' : ''}`}
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
        <FileIcon path={node.path} type={node.type} />
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

function FileIcon({ path, type }: { path: string; type: 'directory' | 'file' }) {
  const iconKind = getWorkbenchFileIconKind(path, type);
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
  if (iconKind === 'ts') {
    return 'TS';
  }
  if (iconKind === 'css') {
    return 'CSS';
  }
  if (iconKind === 'md') {
    return 'M';
  }
  if (iconKind === 'json') {
    return '{}';
  }

  return '·';
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

function getDiffLineClass(line: string) {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return 'added';
  }

  if (line.startsWith('-') && !line.startsWith('---')) {
    return 'removed';
  }

  if (line.startsWith('@@')) {
    return 'hunk';
  }

  if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) {
    return 'meta';
  }

  return '';
}

function getFileName(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return normalizedPath.split('/').pop() || normalizedPath;
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

function WorkbenchFilePlaceholder({ file }: { file?: WorkbenchFileTab }) {
  return (
    <section className="workbench-panel">
      <div className="workbench-section-head with-action">
        <div>
          <h3>{file?.name ?? '文件预览'}</h3>
          <p>{file?.path ?? '文件预览会在下一阶段接入。'}</p>
        </div>
        <button type="button" className="workbench-icon-button" title="关闭文件预览">
          <X size={15} />
        </button>
      </div>
      <div className="workbench-placeholder">
        <FileText size={24} />
        <strong>文件预览骨架已就绪</strong>
        <span>下一步接入 Markdown 渲染和只读文本预览。</span>
      </div>
    </section>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="workbench-info-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
