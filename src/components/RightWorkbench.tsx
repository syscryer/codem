import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CloudUpload,
  FileText,
  Folder,
  Globe2,
  GitPullRequest,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  PanelRightClose,
  Plus,
  RefreshCw,
  RotateCcw,
  Rows3,
  Search,
  Square,
  Unlink2,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PopoverPortal } from './PopoverPortal';
import { MemoGitDiffViewer } from './GitDiffViewer';
import { ImagePreviewDialog, type ImagePreviewItem } from './ImagePreviewDialog';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { fetchWorkspaceFilePreview } from '../lib/file-preview-api';
import { commitGitChanges, fetchGitFileDiff, fetchGitStatus } from '../lib/git-api';
import { renderMarkdownImage } from '../lib/markdown-image';
import { fetchProjectFiles } from '../lib/project-files-api';
import {
  buildWorkbenchFileTree,
  filterWorkbenchNoiseFiles,
  getWorkbenchFileIconKind,
  highlightWorkbenchCode,
  highlightWorkbenchCodeLine,
  isWorkbenchFileTreeNodeSelected,
  resolveWorkbenchFileIcon,
  splitWorkbenchChangedFiles,
  toggleWorkbenchFileTreeNodeSelection,
  type HighlightedCodeToken,
  type WorkbenchFileTreeNode,
} from '../lib/workbench-files';
import {
  buildWorkbenchChangeMarkers,
  buildWorkbenchFullDiffRows,
  buildWorkbenchSplitDiffRows,
  collapseWorkbenchContextRows,
  findWorkbenchChangeBlockIndices,
  resolveWorkbenchChangeScrollTop,
  type WorkbenchSplitDiffRow,
} from '../lib/workbench-diff';
import {
  applyWorkbenchNavigatorWidthOverride,
  buildWorkbenchFilesLayoutColumns,
  clampWorkbenchSplitPaneWidthPercent,
  clampWorkbenchNavigatorWidth,
  clearWorkbenchNavigatorWidthOverride,
} from '../lib/workbench-layout';
import {
  getWorkbenchVisibleLineRange,
  shouldUseLargeFilePreview,
  WORKBENCH_CODE_LINE_HEIGHT,
} from '../lib/workbench-code-preview';
import {
  buildChangedWorkbenchPreviewKey,
  buildProjectWorkbenchPreviewKey,
  buildChangedFilePreviewRequest,
  buildProjectFilePreviewRequest,
  isWorkbenchDiffPreviewRequest,
  resolveWorkbenchPreviewFilePath,
} from '../lib/workbench-preview';
import { resolveWorkbenchNavigatorVisibility } from '../lib/workbench-navigator-visibility';
import type {
  GitFileStatus,
  GitStatusSnapshot,
  ProjectFileEntry,
  ProjectSummary,
  ReviewDisplayMode,
  RightWorkbenchTab,
  ThreadDetail,
  WorkbenchPreviewContentState,
  WorkbenchPreviewRequest,
  WorkbenchPreviewTab,
} from '../types';

type RightWorkbenchProps = {
  activeTab: RightWorkbenchTab;
  activeProject: ProjectSummary | null;
  activeThread: ThreadDetail | null;
  isRunning: boolean;
  filePreviewTabs: WorkbenchPreviewTab[];
  activeFilePreviewKey: string;
  reviewPreviewTabs: WorkbenchPreviewTab[];
  activeReviewPreviewKey: string;
  previewContentByKey: Record<string, WorkbenchPreviewContentState>;
  fileNavigatorManualVisibility: boolean | null;
  onSelectTab: (tab: RightWorkbenchTab) => void;
  onOpenWorkbenchPreview: (request: WorkbenchPreviewRequest) => void;
  onFileNavigatorManualVisibilityChange: (visible: boolean | null) => void;
  onSelectFilePreviewTab: (key: string) => void;
  onSelectReviewPreviewTab: (key: string) => void;
  onCloseFilePreviewTab: (key: string) => void;
  onCloseReviewPreviewTab: (key: string) => void;
  onCloseFilePreviewTabs: (keys: string[]) => void;
  onCloseReviewPreviewTabs: (keys: string[]) => void;
  onResolvePreviewContent: (key: string, state: WorkbenchPreviewContentState) => void;
  onGitChanged?: () => void | Promise<void>;
  onOpenGitPushPreview?: () => void;
  reviewHideNoiseFilesByDefault: boolean;
  reviewDefaultDisplayMode: ReviewDisplayMode;
  reviewNoisePatterns: string[];
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onClose: () => void;
};

export function RightWorkbench({
  activeTab,
  activeProject,
  activeThread,
  isRunning,
  filePreviewTabs,
  activeFilePreviewKey,
  reviewPreviewTabs,
  activeReviewPreviewKey,
  previewContentByKey,
  fileNavigatorManualVisibility,
  onSelectTab,
  onOpenWorkbenchPreview,
  onFileNavigatorManualVisibilityChange,
  onSelectFilePreviewTab,
  onSelectReviewPreviewTab,
  onCloseFilePreviewTab,
  onCloseReviewPreviewTab,
  onCloseFilePreviewTabs,
  onCloseReviewPreviewTabs,
  onResolvePreviewContent,
  onGitChanged,
  onOpenGitPushPreview,
  reviewHideNoiseFilesByDefault,
  reviewDefaultDisplayMode,
  reviewNoisePatterns,
  showToast,
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
          active={activeTab === 'review'}
          icon={<GitPullRequest size={15} />}
          label="审查"
          onClick={() => onSelectTab('review')}
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
          <PanelRightClose size={15} />
        </button>
      </div>

      <div className="right-workbench-content">
        <WorkbenchTabPanel active={activeTab === 'overview'}>
          <MemoWorkbenchOverview activeProject={activeProject} activeThread={activeThread} isRunning={isRunning} />
        </WorkbenchTabPanel>
        <WorkbenchTabPanel active={activeTab === 'files'}>
          <MemoWorkbenchFiles
            activeProject={activeProject}
            scope="all"
            scopeLocked
            scopeLabel="所有文件"
            previewTabs={filePreviewTabs}
            activePreviewKey={activeFilePreviewKey}
            previewContentByKey={previewContentByKey}
            navigatorManualVisibility={fileNavigatorManualVisibility}
            onOpenWorkbenchPreview={onOpenWorkbenchPreview}
            onNavigatorManualVisibilityChange={onFileNavigatorManualVisibilityChange}
            onSelectPreviewTab={onSelectFilePreviewTab}
            onClosePreviewTab={onCloseFilePreviewTab}
            onClosePreviewTabs={onCloseFilePreviewTabs}
            hideScopeCount
            navigatorEmptyTitle="没有文件"
            onResolvePreviewContent={onResolvePreviewContent}
            onGitChanged={onGitChanged}
            showToast={showToast}
          />
        </WorkbenchTabPanel>
        <WorkbenchTabPanel active={activeTab === 'review'}>
          <MemoWorkbenchFiles
            activeProject={activeProject}
            scope="changed"
            scopeLocked
            scopeLabel="审查文件"
            previewTabs={reviewPreviewTabs}
            activePreviewKey={activeReviewPreviewKey}
            previewContentByKey={previewContentByKey}
            onOpenWorkbenchPreview={onOpenWorkbenchPreview}
            onSelectPreviewTab={onSelectReviewPreviewTab}
            onClosePreviewTab={onCloseReviewPreviewTab}
            onClosePreviewTabs={onCloseReviewPreviewTabs}
            navigatorEmptyTitle="当前没有可审查的变更"
            onResolvePreviewContent={onResolvePreviewContent}
            showCommitBar
            onGitChanged={onGitChanged}
            onOpenGitPushPreview={onOpenGitPushPreview}
            reviewHideNoiseFilesByDefault={reviewHideNoiseFilesByDefault}
            reviewDefaultDisplayMode={reviewDefaultDisplayMode}
            reviewNoisePatterns={reviewNoisePatterns}
            showToast={showToast}
          />
        </WorkbenchTabPanel>
        <WorkbenchTabPanel active={activeTab === 'browser'}>
          <MemoWorkbenchBrowserShell />
        </WorkbenchTabPanel>
      </div>
    </aside>
  );
}

function WorkbenchTabPanel({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`workbench-tab-panel${active ? ' active' : ''}`} aria-hidden={!active}>
      {children}
    </div>
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
  scopeLocked = false,
  scopeLabel,
  previewTabs,
  activePreviewKey,
  previewContentByKey,
  navigatorManualVisibility,
  onOpenWorkbenchPreview,
  onNavigatorManualVisibilityChange,
  onSelectPreviewTab,
  onClosePreviewTab,
  onClosePreviewTabs,
  hideScopeCount = false,
  navigatorEmptyTitle,
  onResolvePreviewContent,
  showCommitBar = false,
  onGitChanged,
  onOpenGitPushPreview,
  reviewHideNoiseFilesByDefault = true,
  reviewDefaultDisplayMode = 'tree',
  reviewNoisePatterns = [],
  showToast,
}: {
  activeProject: ProjectSummary | null;
  scope: 'all' | 'changed';
  scopeLocked?: boolean;
  scopeLabel?: string;
  previewTabs: WorkbenchPreviewTab[];
  activePreviewKey: string;
  previewContentByKey: Record<string, WorkbenchPreviewContentState>;
  navigatorManualVisibility?: boolean | null;
  onOpenWorkbenchPreview: (request: WorkbenchPreviewRequest) => void;
  onNavigatorManualVisibilityChange?: (visible: boolean | null) => void;
  onSelectPreviewTab: (key: string) => void;
  onClosePreviewTab: (key: string) => void;
  onClosePreviewTabs: (keys: string[]) => void;
  hideScopeCount?: boolean;
  navigatorEmptyTitle: string;
  onResolvePreviewContent: (key: string, state: WorkbenchPreviewContentState) => void;
  showCommitBar?: boolean;
  onGitChanged?: () => void | Promise<void>;
  onOpenGitPushPreview?: () => void;
  reviewHideNoiseFilesByDefault?: boolean;
  reviewDefaultDisplayMode?: ReviewDisplayMode;
  reviewNoisePatterns?: string[];
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
}) {
  const [projectFiles, setProjectFiles] = useState<ProjectFileEntry[]>([]);
  const [directoryFiles, setDirectoryFiles] = useState<Record<string, ProjectFileEntry[]>>({});
  const [expandedDirectories, setExpandedDirectories] = useState<string[]>([]);
  const [expandedChangedDirectories, setExpandedChangedDirectories] = useState<string[]>([]);
  const [expandedUntrackedDirectories, setExpandedUntrackedDirectories] = useState<string[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState('');
  const [gitStatus, setGitStatus] = useState<GitStatusSnapshot | null>(null);
  const [fileFilter, setFileFilter] = useState('');
  const [fallbackNavigatorVisible, setFallbackNavigatorVisible] = useState(true);
  const [navigatorWidth, setNavigatorWidth] = useState(292);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [commitWorking, setCommitWorking] = useState<'commit' | 'push' | null>(null);
  const [commitError, setCommitError] = useState('');
  const [selectedCommitPaths, setSelectedCommitPaths] = useState<Set<string>>(new Set());
  const [showNoiseFiles, setShowNoiseFiles] = useState(() => !reviewHideNoiseFilesByDefault);
  const [changedDisplayMode, setChangedDisplayMode] = useState<ReviewDisplayMode>(reviewDefaultDisplayMode);
  const [reviewOptionsOpen, setReviewOptionsOpen] = useState(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const reviewOptionsRef = useRef<HTMLDivElement | null>(null);
  const dragNavigatorWidthRef = useRef<number | null>(null);
  const dragFrameRef = useRef<number | null>(null);

  const changedFiles = gitStatus?.files ?? [];
  const visibleChangedFiles = useMemo(
    () => filterWorkbenchNoiseFiles(changedFiles, showNoiseFiles, reviewNoisePatterns),
    [changedFiles, reviewNoisePatterns, showNoiseFiles],
  );
  const trackedCommitPaths = useMemo(
    () => visibleChangedFiles.filter((file) => !file.untracked).map((file) => file.path),
    [visibleChangedFiles],
  );
  const untrackedCommitPaths = useMemo(
    () => visibleChangedFiles.filter((file) => file.untracked).map((file) => file.path),
    [visibleChangedFiles],
  );
  const commitFilesCount = selectedCommitPaths.size;
  const trackedCommitAllSelected =
    trackedCommitPaths.length > 0 && trackedCommitPaths.every((path) => selectedCommitPaths.has(path));
  const untrackedCommitAllSelected =
    untrackedCommitPaths.length > 0 && untrackedCommitPaths.every((path) => selectedCommitPaths.has(path));
  const commitDisabled = !activeProject || commitWorking !== null || commitFilesCount === 0 || !commitMessage.trim();
  const { tracked: comparableChangedFiles, untracked: untrackedChangedFiles } = useMemo(
    () => splitWorkbenchChangedFiles(visibleChangedFiles),
    [visibleChangedFiles],
  );
  const changedTree = useMemo(() => buildWorkbenchFileTree(comparableChangedFiles), [comparableChangedFiles]);
  const untrackedTree = useMemo(() => buildWorkbenchFileTree(untrackedChangedFiles), [untrackedChangedFiles]);
  const filteredChangedTree = useMemo(() => filterWorkbenchTree(changedTree, fileFilter), [changedTree, fileFilter]);
  const filteredUntrackedTree = useMemo(() => filterWorkbenchTree(untrackedTree, fileFilter), [untrackedTree, fileFilter]);
  const filteredComparableChangedFiles = useMemo(
    () => filterChangedFiles(comparableChangedFiles, fileFilter),
    [comparableChangedFiles, fileFilter],
  );
  const filteredUntrackedChangedFiles = useMemo(
    () => filterChangedFiles(untrackedChangedFiles, fileFilter),
    [untrackedChangedFiles, fileFilter],
  );
  const activePreviewTab = previewTabs.find((tab) => tab.key === activePreviewKey);
  const activePreviewTabKey = activePreviewTab?.key ?? '';
  const activePreviewPath = activePreviewTab?.path ?? '';
  const navigatorVisible =
    scope === 'all'
      ? resolveWorkbenchNavigatorVisibility(navigatorManualVisibility ?? null, activePreviewTab?.source)
      : fallbackNavigatorVisible;
  const previewContentRef = useRef(previewContentByKey);
  const previewRequestKeysRef = useRef(new Set<string>());
  const activeProjectIdRef = useRef(activeProject?.id ?? '');
  previewContentRef.current = previewContentByKey;
  activeProjectIdRef.current = activeProject?.id ?? '';

  useOutsideDismiss({
    selectors: [
      { selector: '.workbench-review-options-menu', onDismiss: () => setReviewOptionsOpen(false), anchorRefs: [reviewOptionsRef] },
    ],
  });

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
    setReviewOptionsOpen(false);
  }, [activeProject?.id, scope]);

  useEffect(() => {
    setShowNoiseFiles(!reviewHideNoiseFilesByDefault);
  }, [reviewHideNoiseFilesByDefault]);

  useEffect(() => {
    setChangedDisplayMode(reviewDefaultDisplayMode);
  }, [reviewDefaultDisplayMode]);

  useEffect(() => {
    if (showNoiseFiles) {
      return;
    }

    const visiblePaths = new Set(visibleChangedFiles.map((file) => file.path));
    setSelectedCommitPaths((current) => {
      let changed = false;
      const next = new Set<string>();
      current.forEach((path) => {
        if (visiblePaths.has(path)) {
          next.add(path);
        } else {
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [showNoiseFiles, visibleChangedFiles]);

  useEffect(() => {
    if (!activeProject || !activePreviewTabKey) {
      return;
    }

    if (activePreviewTab && isWorkbenchDiffPreviewRequest(activePreviewTab)) {
      if (activePreviewTab.source === 'conversation-card') {
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

      fetchGitFileDiff(projectId, activePreviewPath)
        .then((payload) => {
          if (activeProjectIdRef.current === projectId) {
            onResolvePreviewContent(activePreviewTabKey, {
              loading: false,
              content: payload.content,
              mode: 'git-diff',
              beforeContent: payload.beforeContent,
              afterContent: payload.afterContent,
            });
          }
        })
        .catch((caughtError: unknown) => {
          if (activeProjectIdRef.current === projectId) {
            onResolvePreviewContent(activePreviewTabKey, {
              loading: false,
              content: '',
              error: caughtError instanceof Error ? caughtError.message : '读取文件差异失败',
            });
          }
        })
        .finally(() => {
          previewRequestKeysRef.current.delete(requestKey);
        });
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
          onResolvePreviewContent(activePreviewTabKey, {
            loading: false,
            content: payload.content,
            mode: payload.mode ?? 'code',
            previewUrl: payload.mode === 'image' ? payload.previewUrl : undefined,
          });
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
  }, [activePreviewPath, activePreviewTab, activePreviewTabKey, activeProject?.id, activeProject?.path, onResolvePreviewContent]);

  function updateNavigatorVisibility(visible: boolean) {
    if (scope === 'all' && onNavigatorManualVisibilityChange) {
      onNavigatorManualVisibilityChange(visible);
      return;
    }

    setFallbackNavigatorVisible(visible);
  }

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
        const visibleStatusFiles = filterWorkbenchNoiseFiles(nextStatus.files, showNoiseFiles, reviewNoisePatterns);
        // 默认仅选中已纳入版本管理的变更文件，未跟踪文件需要用户主动勾选才纳入提交。
        setSelectedCommitPaths(
          new Set(visibleStatusFiles.filter((file) => !file.untracked).map((file) => file.path)),
        );
        const nextGroups = splitWorkbenchChangedFiles(visibleStatusFiles);
        setExpandedChangedDirectories(collectDirectoryPaths(buildWorkbenchFileTree(nextGroups.tracked)));
        setExpandedUntrackedDirectories(collectDirectoryPaths(buildWorkbenchFileTree(nextGroups.untracked)));
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

  async function handleSubmitCommit(thenPush: boolean) {
    if (!activeProject || commitDisabled) {
      return;
    }

    // thenPush=true 时只完成提交，再交给上层打开"推送预览"对话框，由用户在预览里确认远端/分支再点推送。
    setCommitWorking(thenPush ? 'push' : 'commit');
    setCommitError('');
    try {
      await commitGitChanges(activeProject.id, Array.from(selectedCommitPaths), commitMessage.trim());
      setCommitMessage('');
      await loadScope('changed');
      void Promise.resolve(onGitChanged?.()).catch((caughtError: unknown) => {
        showToast(caughtError instanceof Error ? caughtError.message : '刷新 Git 状态失败', 'error');
      });
      if (thenPush) {
        showToast('提交完成，请在推送预览中确认');
        onOpenGitPushPreview?.();
      } else {
        showToast('提交完成');
      }
    } catch (caughtError) {
      setCommitError(caughtError instanceof Error ? caughtError.message : thenPush ? '提交失败' : '提交失败');
    } finally {
      setCommitWorking(null);
    }
  }

  function toggleCommitNode(node: WorkbenchFileTreeNode) {
    setSelectedCommitPaths((current) => toggleWorkbenchFileTreeNodeSelection(node, current));
  }

  function toggleCommitFile(file: GitFileStatus) {
    setSelectedCommitPaths((current) => {
      const next = new Set(current);
      if (next.has(file.path)) {
        next.delete(file.path);
      } else {
        next.add(file.path);
      }
      return next;
    });
  }

  function toggleTrackedCommitPaths() {
    setSelectedCommitPaths((current) => {
      const next = new Set(current);
      if (trackedCommitAllSelected) {
        trackedCommitPaths.forEach((path) => next.delete(path));
      } else {
        trackedCommitPaths.forEach((path) => next.add(path));
      }
      return next;
    });
  }

  function toggleUntrackedCommitPaths() {
    setSelectedCommitPaths((current) => {
      const next = new Set(current);
      if (untrackedCommitAllSelected) {
        untrackedCommitPaths.forEach((path) => next.delete(path));
      } else {
        untrackedCommitPaths.forEach((path) => next.add(path));
      }
      return next;
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

  function toggleUntrackedDirectory(directoryPath: string) {
    setExpandedUntrackedDirectories((directories) =>
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

  function handleShowNoiseFilesChange() {
    setReviewOptionsOpen(false);
    setShowNoiseFiles((current) => !current);
  }

  function handleChangedDisplayModeChange(nextMode: ReviewDisplayMode) {
    setChangedDisplayMode(nextMode);
    setReviewOptionsOpen(false);
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
                scopeLocked={scopeLocked}
                scopeLabel={scopeLabel}
                loading={loading}
                error={error}
                filter={fileFilter}
                changedFilesCount={visibleChangedFiles.length}
                projectFiles={projectFiles}
                directoryFiles={directoryFiles}
                expandedDirectories={expandedDirectories}
                expandedChangedDirectories={expandedChangedDirectories}
                expandedUntrackedDirectories={expandedUntrackedDirectories}
                loadingDirectory={loadingDirectory}
                changedFiles={filteredComparableChangedFiles}
                untrackedFiles={filteredUntrackedChangedFiles}
                changedTree={filteredChangedTree}
                untrackedTree={filteredUntrackedTree}
                changedDisplayMode={changedDisplayMode}
                showNoiseFiles={showNoiseFiles}
                reviewOptionsOpen={reviewOptionsOpen}
                reviewOptionsRef={reviewOptionsRef}
                activePreviewKey={activePreviewKey}
                onFilterChange={setFileFilter}
                onSelectScope={null}
                onRefresh={() => void loadScope(scope)}
                onHide={() => updateNavigatorVisibility(false)}
                onToggleDirectory={toggleDirectory}
                onToggleChangedDirectory={toggleChangedDirectory}
                onToggleUntrackedDirectory={toggleUntrackedDirectory}
                onOpenProjectFile={openProjectFilePreview}
                onOpenChangedFile={openChangedPreview}
                onToggleCommitFile={toggleCommitFile}
                hideScopeCount={hideScopeCount}
                emptyTitle={navigatorEmptyTitle}
                showCommitBar={showCommitBar}
                selectedCommitPaths={selectedCommitPaths}
                onToggleCommitNode={toggleCommitNode}
                commitFilesCount={commitFilesCount}
                trackedCommitAllSelected={trackedCommitAllSelected}
                untrackedCommitAllSelected={untrackedCommitAllSelected}
                commitMessage={commitMessage}
                commitError={commitError}
                commitWorking={commitWorking}
                commitDisabled={commitDisabled}
                onToggleTrackedCommitPaths={toggleTrackedCommitPaths}
                onToggleUntrackedCommitPaths={toggleUntrackedCommitPaths}
                onCommitMessageChange={setCommitMessage}
                onSubmitCommit={() => void handleSubmitCommit(false)}
                onSubmitCommitAndPush={() => void handleSubmitCommit(true)}
                onToggleReviewOptions={() => setReviewOptionsOpen((current) => !current)}
                onToggleShowNoiseFiles={handleShowNoiseFilesChange}
                onChangeChangedDisplayMode={handleChangedDisplayModeChange}
              />
            </>
          ) : (
            <button
              type="button"
              className="workbench-file-navigator-rail"
              title="显示文件树"
              onClick={() => updateNavigatorVisibility(true)}
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
  const activeContent = activeTab ? contentByKey[activeTab.key] : undefined;
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  const contextMenuAnchorRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [diffViewByKey, setDiffViewByKey] = useState<Record<string, 'unified' | 'split' | 'full'>>({});
  const [contextMenu, setContextMenu] = useState<{
    key: string;
    name: string;
    path: string;
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const handleDiffViewChange = useCallback((key: string, nextViewMode: 'unified' | 'split' | 'full') => {
    setDiffViewByKey((current) => {
      if (current[key] === nextViewMode) {
        return current;
      }

      return {
        ...current,
        [key]: nextViewMode,
      };
    });
  }, []);

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

  useEffect(() => {
    setDiffViewByKey((current) => {
      const activeDiffKeys = new Set(
        tabs
          .filter((tab) => contentByKey[tab.key]?.mode === 'git-diff')
          .map((tab) => tab.key),
      );
      let changed = false;
      const next: Record<string, 'unified' | 'split' | 'full'> = {};
      for (const [key, mode] of Object.entries(current)) {
        if (activeDiffKeys.has(key)) {
          next[key] = mode;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [contentByKey, tabs]);

  const activeDiffView = activeTab ? diffViewByKey[activeTab.key] ?? 'split' : 'split';
  const showDiffViewToggle = Boolean(activeTab && activeContent?.mode === 'git-diff');
  const showFullDiffToggle = Boolean(activeContent?.beforeContent !== undefined || activeContent?.afterContent !== undefined);
  const activeDiffStats = useMemo(
    () => activeContent?.mode === 'git-diff' ? readGitDiffStats(activeContent.content) : null,
    [activeContent],
  );

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
                    {isWorkbenchDiffPreviewRequest(tab) ? (
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
        <div className="workbench-preview-head-actions">
          {activeDiffStats ? (
            <span className="git-history-diff-stats workbench-diff-stats">
              <span className="git-diff-add">+{activeDiffStats.additions}</span>
              <span className="git-history-diff-sep">/</span>
              <span className="git-diff-del">-{activeDiffStats.deletions}</span>
            </span>
          ) : null}
          {showDiffViewToggle && activeDiffView === 'unified' ? (
            <div className="workbench-diff-view-toggle" role="tablist" aria-label="对比视图">
              <button
                type="button"
                className="workbench-diff-view-button"
                role="tab"
                aria-selected={false}
                onClick={() => {
                  if (!activeTab) {
                    return;
                  }
                  setDiffViewByKey((current) => ({
                    ...current,
                    [activeTab.key]: 'split',
                  }));
                }}
              >
                左右
              </button>
              {showFullDiffToggle ? (
                <button
                  type="button"
                  className="workbench-diff-view-button"
                  role="tab"
                  aria-selected={false}
                  onClick={() => {
                    if (!activeTab) {
                      return;
                    }
                    setDiffViewByKey((current) => ({
                      ...current,
                      [activeTab.key]: 'full',
                    }));
                  }}
                >
                  全文
                </button>
              ) : null}
              <button
                type="button"
                className={`workbench-diff-view-button${activeDiffView === 'unified' ? ' active' : ''}`}
                role="tab"
                aria-selected={activeDiffView === 'unified'}
                onClick={() => {
                  if (!activeTab) {
                    return;
                  }
                  setDiffViewByKey((current) => ({
                    ...current,
                    [activeTab.key]: 'unified',
                  }));
                }}
              >
                统一
              </button>
            </div>
          ) : null}
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
                          {isWorkbenchDiffPreviewRequest(tab) ? (
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
          <WorkbenchEmpty icon={<FileText size={24} />} title="选择文件查看预览" description="从右侧文件树选择代码、Markdown、图片或变更文件。" />
        ) : (
          tabs.map((tab) => {
            const content = contentByKey[tab.key];
            const active = tab.key === activeKey;

            return (
              <MemoPreviewContentPanel
                key={tab.key}
                tab={tab}
                active={active}
                content={content}
                diffView={diffViewByKey[tab.key] ?? 'split'}
                onDiffViewChange={handleDiffViewChange}
              />
            );
          })
        )}
      </div>
    </main>
  );
}

function PreviewContentPanel({
  tab,
  active,
  content,
  diffView,
  onDiffViewChange,
}: {
  tab: WorkbenchPreviewTab;
  active: boolean;
  content: WorkbenchPreviewContentState | undefined;
  diffView: 'unified' | 'split' | 'full';
  onDiffViewChange: (key: string, nextViewMode: 'unified' | 'split' | 'full') => void;
}) {
  const handleViewModeChange = useCallback(
    (nextViewMode: 'unified' | 'split' | 'full') => {
      onDiffViewChange(tab.key, nextViewMode);
    },
    [onDiffViewChange, tab.key],
  );

  return (
    <div className={`workbench-preview-panel${active ? ' active' : ''}`} aria-hidden={!active}>
      {content?.loading ? (
        <WorkbenchEmpty icon={<RefreshCw className="spin" size={24} />} title="正在读取文件" description={tab.path} />
      ) : content?.error ? (
        <WorkbenchEmpty icon={<FileText size={24} />} title="预览失败" description={content.error} />
      ) : content?.mode === 'git-diff' ? (
        <MemoGitDiffViewer
          content={content.content}
          beforeContent={content.beforeContent}
          afterContent={content.afterContent}
          filePath={tab.path}
          viewMode={diffView}
          onViewModeChange={handleViewModeChange}
        />
      ) : content?.mode === 'image' || tab.kind === 'image' ? (
        <MemoImagePreview previewUrl={content?.previewUrl ?? ''} fileName={tab.name} />
      ) : tab.kind === 'markdown' ? (
        <MemoMarkdownPreview content={content?.content ?? ''} />
      ) : (
        <MemoCodePreview content={content?.content ?? ''} filePath={tab.path} />
      )}
    </div>
  );
}

const MemoPreviewContentPanel = memo(PreviewContentPanel);

function ImagePreview({
  previewUrl,
  fileName,
}: {
  previewUrl: string;
  fileName: string;
}) {
  if (!previewUrl) {
    return <WorkbenchEmpty icon={<FileText size={24} />} title="预览失败" description="图片预览地址缺失" />;
  }

  return (
    <div className="workbench-image-preview">
      <img src={previewUrl} alt={fileName || '图片预览'} className="workbench-image-preview-image" />
    </div>
  );
}

const MemoImagePreview = memo(ImagePreview);

function FileNavigator({
  scope,
  scopeLocked = false,
  scopeLabel,
  loading,
  error,
  filter,
  changedFilesCount,
  projectFiles,
  directoryFiles,
  expandedDirectories,
  expandedChangedDirectories,
  expandedUntrackedDirectories,
  loadingDirectory,
  changedFiles,
  untrackedFiles,
  changedTree,
  untrackedTree,
  changedDisplayMode = 'tree',
  showNoiseFiles = false,
  reviewOptionsOpen = false,
  reviewOptionsRef,
  activePreviewKey,
  onFilterChange,
  onSelectScope,
  onRefresh,
  onHide,
  onToggleDirectory,
  onToggleChangedDirectory,
  onToggleUntrackedDirectory,
  onOpenProjectFile,
  onOpenChangedFile,
  onToggleCommitFile,
  hideScopeCount = false,
  emptyTitle,
  showCommitBar = false,
  selectedCommitPaths,
  onToggleCommitNode,
  commitFilesCount = 0,
  trackedCommitAllSelected = false,
  untrackedCommitAllSelected = false,
  commitMessage = '',
  commitError = '',
  commitWorking = null,
  commitDisabled = true,
  onToggleTrackedCommitPaths,
  onToggleUntrackedCommitPaths,
  onCommitMessageChange,
  onSubmitCommit,
  onSubmitCommitAndPush,
  onToggleReviewOptions,
  onToggleShowNoiseFiles,
  onChangeChangedDisplayMode,
}: {
  scope: 'all' | 'changed';
  scopeLocked?: boolean;
  scopeLabel?: string;
  loading: boolean;
  error: string;
  filter: string;
  changedFilesCount: number;
  projectFiles: ProjectFileEntry[];
  directoryFiles: Record<string, ProjectFileEntry[]>;
  expandedDirectories: string[];
  expandedChangedDirectories: string[];
  expandedUntrackedDirectories: string[];
  loadingDirectory: string;
  changedFiles: GitFileStatus[];
  untrackedFiles: GitFileStatus[];
  changedTree: WorkbenchFileTreeNode[];
  untrackedTree: WorkbenchFileTreeNode[];
  changedDisplayMode?: ReviewDisplayMode;
  showNoiseFiles?: boolean;
  reviewOptionsOpen?: boolean;
  reviewOptionsRef: RefObject<HTMLDivElement | null>;
  activePreviewKey: string;
  onFilterChange: (filter: string) => void;
  onSelectScope: ((scope: 'all' | 'changed') => void) | null;
  onRefresh: () => void;
  onHide: () => void;
  onToggleDirectory: (directoryPath: string) => void;
  onToggleChangedDirectory: (directoryPath: string) => void;
  onToggleUntrackedDirectory: (directoryPath: string) => void;
  onOpenProjectFile: (file: ProjectFileEntry) => void;
  onOpenChangedFile: (file: GitFileStatus) => void;
  onToggleCommitFile?: (file: GitFileStatus) => void;
  hideScopeCount?: boolean;
  emptyTitle: string;
  showCommitBar?: boolean;
  selectedCommitPaths?: Set<string>;
  onToggleCommitNode?: (node: WorkbenchFileTreeNode) => void;
  commitFilesCount?: number;
  trackedCommitAllSelected?: boolean;
  untrackedCommitAllSelected?: boolean;
  commitMessage?: string;
  commitError?: string;
  commitWorking?: 'commit' | 'push' | null;
  commitDisabled?: boolean;
  onToggleTrackedCommitPaths?: () => void;
  onToggleUntrackedCommitPaths?: () => void;
  onCommitMessageChange?: (message: string) => void;
  onSubmitCommit?: () => void;
  onSubmitCommitAndPush?: () => void;
  onToggleReviewOptions?: () => void;
  onToggleShowNoiseFiles?: () => void;
  onChangeChangedDisplayMode?: (mode: ReviewDisplayMode) => void;
}) {
  return (
    <aside className={`workbench-file-navigator${showCommitBar ? ' with-commit-bar' : ''}`} aria-label="文件导航">
      <div className="workbench-files-head">
        {scopeLocked ? (
          <div className="workbench-scope-label">
            <strong>{scopeLabel ?? (scope === 'all' ? '所有文件' : '已更改文件')}</strong>
            {scope === 'changed' && !hideScopeCount ? <span>{changedFilesCount}</span> : null}
          </div>
        ) : (
          <button
            type="button"
            className="workbench-scope-trigger"
            onClick={() => onSelectScope?.(scope === 'all' ? 'changed' : 'all')}
          >
            {scope === 'all' ? '所有文件' : '已更改文件'}
            {scope === 'changed' && !hideScopeCount ? <span>{changedFilesCount}</span> : null}
            <ChevronDown size={15} />
          </button>
        )}
        <div className="workbench-files-actions">
          {scope === 'changed' ? (
            <div ref={reviewOptionsRef} className="workbench-files-menu-anchor">
              <button
                type="button"
                className={`workbench-icon-button${reviewOptionsOpen ? ' active' : ''}`}
                title="审查视图选项"
                aria-label="审查视图选项"
                aria-haspopup="menu"
                aria-expanded={reviewOptionsOpen}
                onClick={onToggleReviewOptions}
              >
                <Rows3 size={15} />
              </button>
              <PopoverPortal open={reviewOptionsOpen} anchorRef={reviewOptionsRef} placement="bottom-end" offset={8}>
                <div className="workspace-menu workbench-review-options-menu" role="menu" aria-label="审查视图选项">
                  <div className="workspace-menu-group-title">分组依据</div>
                  <button
                    type="button"
                    className={`workspace-menu-item${changedDisplayMode === 'tree' ? ' current' : ''}`}
                    role="menuitemradio"
                    aria-checked={changedDisplayMode === 'tree'}
                    onClick={() => onChangeChangedDisplayMode?.('tree')}
                  >
                    {changedDisplayMode === 'tree' ? <Check size={16} /> : <Folder size={16} />}
                    <span>目录</span>
                  </button>
                  <button
                    type="button"
                    className={`workspace-menu-item${changedDisplayMode === 'flat' ? ' current' : ''}`}
                    role="menuitemradio"
                    aria-checked={changedDisplayMode === 'flat'}
                    onClick={() => onChangeChangedDisplayMode?.('flat')}
                  >
                    {changedDisplayMode === 'flat' ? <Check size={16} /> : <Rows3 size={16} />}
                    <span>平铺</span>
                  </button>
                  <div className="workspace-menu-divider" role="separator" />
                  <div className="workspace-menu-group-title">显示</div>
                  <button
                    type="button"
                    className={`workspace-menu-item${showNoiseFiles ? ' current' : ''}`}
                    role="menuitemcheckbox"
                    aria-checked={showNoiseFiles}
                    onClick={onToggleShowNoiseFiles}
                  >
                    {showNoiseFiles ? <Check size={16} /> : <Square size={16} />}
                    <span>显示已忽略文件</span>
                  </button>
                </div>
              </PopoverPortal>
            </div>
          ) : null}
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
        <Search size={14} aria-hidden="true" />
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
        ) : changedTree.length || untrackedTree.length || changedFiles.length || untrackedFiles.length ? (
          <ChangedFileTree
            displayMode={changedDisplayMode}
            changedFiles={changedFiles}
            untrackedFiles={untrackedFiles}
            changedNodes={changedTree}
            untrackedNodes={untrackedTree}
            expandedChangedDirectories={expandedChangedDirectories}
            expandedUntrackedDirectories={expandedUntrackedDirectories}
            activePreviewKey={activePreviewKey}
            selectedCommitPaths={selectedCommitPaths ?? new Set()}
            allTrackedCommitSelected={trackedCommitAllSelected}
            allUntrackedCommitSelected={untrackedCommitAllSelected}
            onToggleChangedDirectory={onToggleChangedDirectory}
            onToggleUntrackedDirectory={onToggleUntrackedDirectory}
            onToggleCommitNode={onToggleCommitNode ?? (() => undefined)}
            onToggleCommitFile={onToggleCommitFile ?? (() => undefined)}
            onToggleAllTrackedCommitPaths={onToggleTrackedCommitPaths ?? (() => undefined)}
            onToggleAllUntrackedCommitPaths={onToggleUntrackedCommitPaths ?? (() => undefined)}
            onOpenFile={onOpenChangedFile}
          />
        ) : (
          <WorkbenchEmpty icon={<GitPullRequest size={24} />} title={emptyTitle} description="工作区很干净，可以继续开发。" />
        )}
      </div>
      {showCommitBar ? (
        <div className="workbench-commit-bar">
          <div className="workbench-commit-bar-head">
            <strong>提交</strong>
            <span>{commitFilesCount} 个文件</span>
          </div>
          {commitError ? <div className="workbench-commit-bar-error">{commitError}</div> : null}
          <textarea
            className="workbench-commit-bar-input"
            value={commitMessage}
            onChange={(event) => onCommitMessageChange?.(event.target.value)}
            placeholder="填写提交消息"
            rows={3}
          />
          <div className="workbench-commit-bar-actions">
            <button
              type="button"
              className="workbench-commit-bar-button"
              disabled={commitDisabled}
              onClick={onSubmitCommit}
            >
              {commitWorking === 'commit' ? <LoaderCircle className="spin" size={14} /> : null}
              <span>提交</span>
            </button>
            <button
              type="button"
              className="workbench-commit-bar-button primary"
              disabled={commitDisabled}
              onClick={onSubmitCommitAndPush}
            >
              {commitWorking === 'push' ? <LoaderCircle className="spin" size={14} /> : <CloudUpload size={14} />}
              <span>提交并推送</span>
            </button>
          </div>
        </div>
      ) : null}
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
        className={`workbench-tree-row${activePreviewKey === buildProjectWorkbenchPreviewKey(file.path) ? ' active' : ''}`}
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
  displayMode,
  changedFiles,
  untrackedFiles,
  changedNodes,
  untrackedNodes,
  expandedChangedDirectories,
  expandedUntrackedDirectories,
  activePreviewKey,
  selectedCommitPaths,
  allTrackedCommitSelected,
  allUntrackedCommitSelected,
  onToggleChangedDirectory,
  onToggleUntrackedDirectory,
  onToggleCommitNode,
  onToggleCommitFile,
  onToggleAllTrackedCommitPaths,
  onToggleAllUntrackedCommitPaths,
  onOpenFile,
}: {
  displayMode: ReviewDisplayMode;
  changedFiles: GitFileStatus[];
  untrackedFiles: GitFileStatus[];
  changedNodes: WorkbenchFileTreeNode[];
  untrackedNodes: WorkbenchFileTreeNode[];
  expandedChangedDirectories: string[];
  expandedUntrackedDirectories: string[];
  activePreviewKey: string;
  selectedCommitPaths: Set<string>;
  allTrackedCommitSelected: boolean;
  allUntrackedCommitSelected: boolean;
  onToggleChangedDirectory: (directoryPath: string) => void;
  onToggleUntrackedDirectory: (directoryPath: string) => void;
  onToggleCommitNode: (node: WorkbenchFileTreeNode) => void;
  onToggleCommitFile: (file: GitFileStatus) => void;
  onToggleAllTrackedCommitPaths: () => void;
  onToggleAllUntrackedCommitPaths: () => void;
  onOpenFile: (file: GitFileStatus) => void;
}) {
  return (
    <div className="workbench-all-files-list">
      {changedNodes.length || changedFiles.length ? (
        <ChangedFileTreeSection
          title="变更"
          count={displayMode === 'flat' ? changedFiles.length : countWorkbenchFileTreeFiles(changedNodes)}
          nodes={changedNodes}
          files={changedFiles}
          displayMode={displayMode}
          expandedDirectories={expandedChangedDirectories}
          activePreviewKey={activePreviewKey}
          selectedCommitPaths={selectedCommitPaths}
          allSelected={allTrackedCommitSelected}
          onToggleDirectory={onToggleChangedDirectory}
          onToggleCommitNode={onToggleCommitNode}
          onToggleCommitFile={onToggleCommitFile}
          onToggleAll={onToggleAllTrackedCommitPaths}
          onOpenFile={onOpenFile}
        />
      ) : null}
      {untrackedNodes.length || untrackedFiles.length ? (
        <ChangedFileTreeSection
          title="未进行版本管理的文件"
          count={displayMode === 'flat' ? untrackedFiles.length : countWorkbenchFileTreeFiles(untrackedNodes)}
          nodes={untrackedNodes}
          files={untrackedFiles}
          displayMode={displayMode}
          expandedDirectories={expandedUntrackedDirectories}
          activePreviewKey={activePreviewKey}
          selectedCommitPaths={selectedCommitPaths}
          allSelected={allUntrackedCommitSelected}
          onToggleDirectory={onToggleUntrackedDirectory}
          onToggleCommitNode={onToggleCommitNode}
          onToggleCommitFile={onToggleCommitFile}
          onToggleAll={onToggleAllUntrackedCommitPaths}
          onOpenFile={onOpenFile}
          untracked
        />
      ) : null}
    </div>
  );
}

function ChangedFileTreeSection({
  title,
  count,
  nodes,
  files,
  displayMode,
  expandedDirectories,
  activePreviewKey,
  selectedCommitPaths,
  allSelected = false,
  onToggleDirectory,
  onToggleCommitNode,
  onToggleCommitFile,
  onToggleAll,
  onOpenFile,
  untracked = false,
}: {
  title: string;
  count: number;
  nodes: WorkbenchFileTreeNode[];
  files: GitFileStatus[];
  displayMode: ReviewDisplayMode;
  expandedDirectories: string[];
  activePreviewKey: string;
  selectedCommitPaths: Set<string>;
  allSelected?: boolean;
  onToggleDirectory: (directoryPath: string) => void;
  onToggleCommitNode: (node: WorkbenchFileTreeNode) => void;
  onToggleCommitFile: (file: GitFileStatus) => void;
  onToggleAll?: () => void;
  onOpenFile: (file: GitFileStatus) => void;
  untracked?: boolean;
}) {
  // 未进行版本管理的文件默认折叠，避免在审查页占用过多视觉空间。
  const [collapsed, setCollapsed] = useState(untracked);

  return (
    <section className={`workbench-tree-section${collapsed ? ' is-collapsed' : ''}`}>
      <div className="workbench-tree-section-head">
        <div className="workbench-tree-section-title">
          <button
            type="button"
            className="workbench-tree-section-chevron"
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? `展开${title}` : `折叠${title}`}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            type="button"
            className="workbench-tree-select-all"
            onClick={onToggleAll}
            aria-label={allSelected ? '取消全选' : '全选'}
          >
            {allSelected ? <CheckSquare size={15} /> : <Square size={15} />}
          </button>
          <button
            type="button"
            className="workbench-tree-section-label"
            onClick={() => setCollapsed((value) => !value)}
          >
            <strong>{title}</strong>
          </button>
        </div>
        <span>{count} 个文件</span>
      </div>
      {collapsed
        ? null
        : displayMode === 'flat'
          ? renderChangedFileFlatRows({
              files,
              activePreviewKey,
              selectedCommitPaths,
              onToggleCommitFile,
              onOpenFile,
              untracked,
            })
          : renderChangedFileTreeRows({
              nodes,
              expandedDirectories,
              activePreviewKey,
              selectedCommitPaths,
              depth: 0,
              onToggleDirectory,
              onToggleCommitNode,
              onOpenFile,
              untracked,
            })}
    </section>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  const [imagePreview, setImagePreview] = useState<ImagePreviewItem | null>(null);

  return (
    <>
      <div className="workbench-markdown-preview">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            img({ src, alt, title }) {
              return renderMarkdownImage({
                src,
                alt,
                title,
                onPreview: setImagePreview,
              });
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
      {imagePreview ? <ImagePreviewDialog preview={imagePreview} onClose={() => setImagePreview(null)} /> : null}
    </>
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
  selectedCommitPaths,
  depth,
  onToggleDirectory,
  onToggleCommitNode,
  onOpenFile,
  untracked = false,
}: {
  nodes: WorkbenchFileTreeNode[];
  expandedDirectories: string[];
  activePreviewKey: string;
  selectedCommitPaths: Set<string>;
  depth: number;
  onToggleDirectory: (directoryPath: string) => void;
  onToggleCommitNode: (node: WorkbenchFileTreeNode) => void;
  onOpenFile: (file: GitFileStatus) => void;
  untracked?: boolean;
}): ReactNode[] {
  return nodes.flatMap((node): ReactNode[] => {
    const expanded = node.type === 'directory' && expandedDirectories.includes(node.path);
    const statusTone = !untracked && node.gitFile ? getGitStatusTone(node.gitFile.status) : '';
    const checked = isWorkbenchFileTreeNodeSelected(node, selectedCommitPaths);
    const row = (
      <button
        key={node.path}
        type="button"
        className={`workbench-tree-row selectable has-check${statusTone ? ` status-${statusTone}` : ''}${activePreviewKey === buildChangedWorkbenchPreviewKey(node.path) ? ' active' : ''}`}
        style={{ paddingLeft: `${16 + depth * 18}px` }}
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
        <span
          className="workbench-tree-check"
          role="checkbox"
          aria-checked={checked}
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            onToggleCommitNode(node);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onToggleCommitNode(node);
            }
          }}
        >
          {checked ? <CheckSquare size={15} /> : <Square size={15} />}
        </span>
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
        selectedCommitPaths,
        depth: depth + 1,
        onToggleDirectory,
        onToggleCommitNode,
        onOpenFile,
        untracked,
      }),
    ];
  });
}

function renderChangedFileFlatRows({
  files,
  activePreviewKey,
  selectedCommitPaths,
  onToggleCommitFile,
  onOpenFile,
  untracked = false,
}: {
  files: GitFileStatus[];
  activePreviewKey: string;
  selectedCommitPaths: Set<string>;
  onToggleCommitFile: (file: GitFileStatus) => void;
  onOpenFile: (file: GitFileStatus) => void;
  untracked?: boolean;
}): ReactNode[] {
  return files.map((file) => {
    const checked = selectedCommitPaths.has(file.path);
    const statusTone = !untracked ? getGitStatusTone(file.status) : '';
    const fileName = getFileName(file.path);
    const directoryPath = getFileDirectoryPath(file.path);

    return (
      <button
        key={file.path}
        type="button"
        className={`workbench-tree-row selectable has-check flat${statusTone ? ` status-${statusTone}` : ''}${activePreviewKey === buildChangedWorkbenchPreviewKey(file.path) ? ' active' : ''}`}
        onClick={() => onOpenFile(file)}
      >
        <span className="workbench-tree-spacer" />
        <span
          className="workbench-tree-check"
          role="checkbox"
          aria-checked={checked}
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            onToggleCommitFile(file);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onToggleCommitFile(file);
            }
          }}
        >
          {checked ? <CheckSquare size={15} /> : <Square size={15} />}
        </span>
        <FileIcon path={file.path} type="file" />
        <span className="workbench-tree-row-main">
          <span className={statusTone ? `workbench-file-name status-${statusTone}` : 'workbench-file-name'} title={file.path}>
            {fileName}
          </span>
          <span className="workbench-tree-row-meta" title={directoryPath || '项目根目录'}>
            {directoryPath || '项目根目录'}
          </span>
        </span>
      </button>
    );
  });
}

function countWorkbenchFileTreeFiles(nodes: WorkbenchFileTreeNode[]): number {
  return nodes.reduce((count, node) => {
    if (node.type === 'file') {
      return count + 1;
    }

    return count + countWorkbenchFileTreeFiles(node.children);
  }, 0);
}

export function FileIcon({
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

function filterChangedFiles(files: GitFileStatus[], filter: string) {
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

function getFileName(filePath: string) {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
}

function getFileDirectoryPath(filePath: string) {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
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

const MemoWorkbenchOverview = memo(WorkbenchOverview);
const MemoWorkbenchFiles = memo(WorkbenchFiles);
const MemoWorkbenchBrowserShell = memo(WorkbenchBrowserShell);

export function GitDiffPreview({
  content,
  beforeContent,
  afterContent,
  filePath,
  viewMode,
  onViewModeChange,
}: {
  content: string;
  beforeContent?: string;
  afterContent?: string;
  filePath: string;
  viewMode: 'unified' | 'split' | 'full';
  onViewModeChange: (viewMode: 'unified' | 'split' | 'full') => void;
}) {
  const normalizedContent = content.trim() ? content : '当前没有可显示的改动。';
  const lines = normalizedContent.split('\n');
  const splitRows = useMemo(() => buildWorkbenchSplitDiffRows(content), [content]);
  const fullRows = useMemo(
    () => buildWorkbenchFullDiffRows(beforeContent ?? '', afterContent ?? ''),
    [afterContent, beforeContent],
  );
  const splitSurfaceRef = useRef<HTMLDivElement | null>(null);
  const leftPaneRef = useRef<HTMLDivElement | null>(null);
  const rightPaneRef = useRef<HTMLDivElement | null>(null);
  const [splitLeftWidth, setSplitLeftWidth] = useState(50);
  const [collapseUnchanged, setCollapseUnchanged] = useState(viewMode !== 'full');
  const [syncScroll, setSyncScroll] = useState(true);
  const [activeChangeCursor, setActiveChangeCursor] = useState(-1);
  const [leftScrollTop, setLeftScrollTop] = useState(0);
  const [rightScrollTop, setRightScrollTop] = useState(0);
  const [leftViewportHeight, setLeftViewportHeight] = useState(420);
  const [rightViewportHeight, setRightViewportHeight] = useState(420);
  const canUseFullView = beforeContent !== undefined || afterContent !== undefined;

  useEffect(() => {
    setSplitLeftWidth(50);
    setActiveChangeCursor(-1);
    setLeftScrollTop(0);
    setRightScrollTop(0);
  }, [content]);

  useEffect(() => {
    setCollapseUnchanged(viewMode !== 'full');
  }, [viewMode]);

  const baseRows = viewMode === 'full' ? fullRows : splitRows;
  const rows = useMemo(
    () => collapseUnchanged ? collapseWorkbenchContextRows(baseRows) : baseRows,
    [baseRows, collapseUnchanged],
  );
  const changeRowIndices = useMemo(() => findWorkbenchChangeBlockIndices(rows), [rows]);
  const totalRowsHeight = useMemo(
    () => Math.max(rows.length * WORKBENCH_CODE_LINE_HEIGHT, WORKBENCH_CODE_LINE_HEIGHT),
    [rows.length],
  );
  const leftVisibleRange = useMemo(
    () => getWorkbenchVisibleLineRange(rows.length, leftScrollTop, leftViewportHeight),
    [leftScrollTop, leftViewportHeight, rows.length],
  );
  const rightVisibleRange = useMemo(
    () => getWorkbenchVisibleLineRange(rows.length, rightScrollTop, rightViewportHeight),
    [rightScrollTop, rightViewportHeight, rows.length],
  );
  const leftVisibleRows = useMemo(
    () => rows.slice(leftVisibleRange.start, leftVisibleRange.end),
    [leftVisibleRange.end, leftVisibleRange.start, rows],
  );
  const rightVisibleRows = useMemo(
    () => rows.slice(rightVisibleRange.start, rightVisibleRange.end),
    [rightVisibleRange.end, rightVisibleRange.start, rows],
  );
  const changeMarkers = useMemo(
    () => buildWorkbenchChangeMarkers(changeRowIndices, rows, leftViewportHeight, WORKBENCH_CODE_LINE_HEIGHT),
    [changeRowIndices, leftViewportHeight, rows],
  );

  useEffect(() => {
    setActiveChangeCursor((current) => {
      if (changeRowIndices.length === 0) {
        return -1;
      }

      return current < 0 ? -1 : Math.min(current, changeRowIndices.length - 1);
    });
  }, [changeRowIndices]);

  useEffect(() => {
    const leftPane = leftPaneRef.current;
    const rightPane = rightPaneRef.current;
    if (!leftPane || !rightPane) {
      return;
    }

    const updateViewportHeights = () => {
      setLeftViewportHeight(leftPane.clientHeight);
      setRightViewportHeight(rightPane.clientHeight);
    };

    updateViewportHeights();
    const observer = new ResizeObserver(updateViewportHeights);
    observer.observe(leftPane);
    observer.observe(rightPane);
    return () => observer.disconnect();
  }, [viewMode]);

  useEffect(() => {
    const leftPaneElement = leftPaneRef.current;
    const rightPaneElement = rightPaneRef.current;
    if (!leftPaneElement || !rightPaneElement) {
      return;
    }
    const leftPane = leftPaneElement;
    const rightPane = rightPaneElement;
    setLeftScrollTop(leftPane.scrollTop);
    setRightScrollTop(rightPane.scrollTop);
    if (syncScroll) {
      rightPane.scrollLeft = leftPane.scrollLeft;
      rightPane.scrollTop = leftPane.scrollTop;
      setRightScrollTop(leftPane.scrollTop);
    }

    let syncingSide: 'left' | 'right' | null = null;

    function handleLeftScroll() {
      setLeftScrollTop(leftPane.scrollTop);
      if (!syncScroll) {
        return;
      }
      if (syncingSide === 'right') {
        syncingSide = null;
        return;
      }
      syncingSide = 'left';
      rightPane.scrollLeft = leftPane.scrollLeft;
      rightPane.scrollTop = leftPane.scrollTop;
      setRightScrollTop(leftPane.scrollTop);
    }

    function handleRightScroll() {
      setRightScrollTop(rightPane.scrollTop);
      if (!syncScroll) {
        return;
      }
      if (syncingSide === 'left') {
        syncingSide = null;
        return;
      }
      syncingSide = 'right';
      leftPane.scrollLeft = rightPane.scrollLeft;
      leftPane.scrollTop = rightPane.scrollTop;
      setLeftScrollTop(rightPane.scrollTop);
    }

    leftPane.addEventListener('scroll', handleLeftScroll, { passive: true });
    rightPane.addEventListener('scroll', handleRightScroll, { passive: true });
    return () => {
      leftPane.removeEventListener('scroll', handleLeftScroll);
      rightPane.removeEventListener('scroll', handleRightScroll);
    };
  }, [syncScroll, viewMode]);

  function handleSplitResizerPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const surface = splitSurfaceRef.current;
    if (!surface) {
      return;
    }

    const bounds = surface.getBoundingClientRect();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function handlePointerMove(moveEvent: PointerEvent) {
      const rawWidth = ((moveEvent.clientX - bounds.left) / bounds.width) * 100;
      setSplitLeftWidth(clampSplitDiffWidth(rawWidth, bounds.width));
    }

    function stopResize() {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize, { once: true });
  }

  function moveToChange(direction: -1 | 1) {
    if (changeRowIndices.length === 0) {
      return;
    }

    const nextCursor =
      activeChangeCursor < 0
        ? direction > 0
          ? 0
          : changeRowIndices.length - 1
        : direction > 0
          ? (activeChangeCursor + 1) % changeRowIndices.length
          : (activeChangeCursor - 1 + changeRowIndices.length) % changeRowIndices.length;
    scrollToChange(nextCursor);
  }

  function scrollToChange(cursor: number) {
    const targetRowIndex = changeRowIndices[cursor];
    const leftPane = leftPaneRef.current;
    const rightPane = rightPaneRef.current;
    if (!leftPane || !rightPane || targetRowIndex === undefined) {
      return;
    }

    const nextScrollTop = resolveWorkbenchChangeScrollTop(
      targetRowIndex,
      rows.length,
      leftPane.clientHeight || leftViewportHeight,
      WORKBENCH_CODE_LINE_HEIGHT,
    );
    leftPane.scrollTo({ top: nextScrollTop, behavior: 'smooth' });
    if (!syncScroll) {
      rightPane.scrollTo({ top: nextScrollTop, behavior: 'smooth' });
    }
    setActiveChangeCursor(cursor);
  }

  if ((viewMode === 'split' || viewMode === 'full') && content.trim()) {
    return (
      <div className="workbench-code-preview workbench-diff-content split" role="region" aria-label="变更预览">
        <div
          ref={splitSurfaceRef}
          className="git-diff-split-surface"
          style={{ '--workbench-diff-split-left-width': `${splitLeftWidth}%` } as CSSProperties}
        >
          <div className="git-diff-toolbar" role="toolbar" aria-label="对比工具">
            <div className="git-diff-toolbar-group" role="tablist" aria-label="视图切换">
              <button
                type="button"
                className={`git-diff-toolbar-button${viewMode === 'split' ? ' active' : ''}`}
                role="tab"
                aria-selected={viewMode === 'split'}
                onClick={() => onViewModeChange('split')}
              >
                左右
              </button>
              <button
                type="button"
                className={`git-diff-toolbar-button${viewMode === 'full' ? ' active' : ''}`}
                role="tab"
                aria-selected={viewMode === 'full'}
                disabled={!canUseFullView}
                onClick={() => onViewModeChange('full')}
              >
                全文
              </button>
              <button
                type="button"
                className="git-diff-toolbar-button"
                onClick={() => onViewModeChange('unified')}
              >
                统一
              </button>
            </div>
            <div className="git-diff-toolbar-group">
              <button
                type="button"
                className="git-diff-toolbar-icon"
                title="上一处变更"
                onClick={() => moveToChange(-1)}
              >
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                className="git-diff-toolbar-icon"
                title="下一处变更"
                onClick={() => moveToChange(1)}
              >
                <ArrowDown size={14} />
              </button>
              <button
                type="button"
                className={`git-diff-toolbar-icon${collapseUnchanged ? ' active' : ''}`}
                title="折叠未修改"
                onClick={() => setCollapseUnchanged((current) => !current)}
              >
                <Rows3 size={14} />
              </button>
              <button
                type="button"
                className="git-diff-toolbar-icon"
                title="重置"
                onClick={() => setSplitLeftWidth(50)}
              >
                <RotateCcw size={14} />
              </button>
              <button
                type="button"
                className={`git-diff-toolbar-icon${syncScroll ? ' active' : ''}`}
                title={syncScroll ? '关闭同步滚动' : '开启同步滚动'}
                onClick={() => setSyncScroll((current) => !current)}
              >
                {syncScroll ? <Link2 size={14} /> : <Unlink2 size={14} />}
              </button>
            </div>
          </div>
          <div className="git-diff-split-grid">
            <div className="git-diff-split-pane-shell left">
              <div ref={leftPaneRef} className="git-diff-split-pane left">
                <div
                  className="git-diff-virtual-spacer"
                  style={{ height: `${totalRowsHeight}px` }}
                >
                  <div
                    className="git-diff-virtual-window"
                    style={{ transform: `translateY(${leftVisibleRange.start * WORKBENCH_CODE_LINE_HEIGHT}px)` }}
                  >
                    {leftVisibleRows.map((row, visibleIndex) => {
                      const rowIndex = leftVisibleRange.start + visibleIndex;
                      return (
                        <GitSplitDiffPaneRow
                          key={`left-${rowIndex}-${row.type === 'content' ? `${row.leftLineNumber}-${row.rightLineNumber}` : row.type === 'collapsed' ? `collapsed-${row.hiddenCount}` : row.text}`}
                          row={row}
                          side="left"
                          filePath={filePath}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
              {changeMarkers.length ? (
                <GitDiffChangeMap
                  side="left"
                  markers={changeMarkers}
                  activeChangeCursor={activeChangeCursor}
                  onSelect={scrollToChange}
                />
              ) : null}
            </div>
            <div className="git-diff-split-divider" aria-hidden="true" />
            <div className="git-diff-split-pane-shell right">
              <div ref={rightPaneRef} className="git-diff-split-pane right">
                <div
                  className="git-diff-virtual-spacer"
                  style={{ height: `${totalRowsHeight}px` }}
                >
                  <div
                    className="git-diff-virtual-window"
                    style={{ transform: `translateY(${rightVisibleRange.start * WORKBENCH_CODE_LINE_HEIGHT}px)` }}
                  >
                    {rightVisibleRows.map((row, visibleIndex) => {
                      const rowIndex = rightVisibleRange.start + visibleIndex;
                      return (
                        <GitSplitDiffPaneRow
                          key={`right-${rowIndex}-${row.type === 'content' ? `${row.leftLineNumber}-${row.rightLineNumber}` : row.type === 'collapsed' ? `collapsed-${row.hiddenCount}` : row.text}`}
                          row={row}
                          side="right"
                          filePath={filePath}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
              {changeMarkers.length ? (
                <GitDiffChangeMap
                  side="right"
                  markers={changeMarkers}
                  activeChangeCursor={activeChangeCursor}
                  onSelect={scrollToChange}
                />
              ) : null}
            </div>
          </div>
          <div className="git-diff-split-resizer-track" aria-hidden="true">
            <button
              type="button"
              className="git-diff-split-resizer"
              tabIndex={-1}
              onPointerDown={handleSplitResizerPointerDown}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="workbench-code-preview workbench-diff-content" role="region" aria-label="变更预览">
      {lines.map((line, index) => (
        <div key={`${index}-${line}`} className={`git-diff-line ${getDiffLineClass(line)}`}>
          <span className="git-diff-line-no">{index + 1}</span>
          <span className="git-diff-line-text">
            {renderUnifiedDiffLineContent(line, filePath)}
          </span>
        </div>
      ))}
    </div>
  );
}

function GitSplitDiffPaneRow({
  row,
  side,
  filePath,
}: {
  row: WorkbenchSplitDiffRow;
  side: 'left' | 'right';
  filePath: string;
}) {
  if (row.type === 'collapsed') {
    return (
      <div className="git-diff-collapsed-row">
        <span>折叠 {row.hiddenCount} 行未修改</span>
      </div>
    );
  }

  if (row.type !== 'content') {
    return <div className={`git-diff-split-banner ${row.type}`}>{row.text}</div>;
  }

  const lineNumber = side === 'left' ? row.leftLineNumber : row.rightLineNumber;
  const text = side === 'left' ? row.leftText : row.rightText;
  const kind = side === 'left' ? row.leftKind : row.rightKind;
  const renderedLine = useMemo(
    () => renderDiffCodeLineContent(kind === 'empty' ? '' : text, filePath),
    [filePath, kind, text],
  );

  return (
    <div className={`git-diff-split-side ${side} ${kind}`}>
      <span className="git-diff-split-line-no">{lineNumber ?? ''}</span>
      <span className="git-diff-split-line-text">{kind === 'empty' ? ' ' : renderedLine}</span>
    </div>
  );
}

function clampSplitDiffWidth(value: number, containerWidth = 0) {
  if (containerWidth <= 0) {
    return Math.max(18, Math.min(82, value));
  }

  return clampWorkbenchSplitPaneWidthPercent(value, containerWidth);
}

function GitDiffChangeMap({
  side,
  markers,
  activeChangeCursor,
  onSelect,
}: {
  side: 'left' | 'right';
  markers: Array<{ cursor: number; rowIndex: number; position: number; kind: 'added' | 'removed' | 'modified' }>;
  activeChangeCursor: number;
  onSelect: (cursor: number) => void;
}) {
  return (
    <div className={`git-diff-change-map ${side}`} aria-label="变更位置">
      {markers.map((marker) => (
        <button
          key={`${side}-marker-${marker.cursor}-${marker.rowIndex}`}
          type="button"
          className={`git-diff-change-marker ${marker.kind}${marker.cursor === activeChangeCursor ? ' active' : ''}`}
          style={{ top: `${marker.position * 100}%` }}
          title={`跳转到第 ${marker.cursor + 1} 处变更`}
          aria-label={`跳转到第 ${marker.cursor + 1} 处变更`}
          onClick={() => onSelect(marker.cursor)}
        />
      ))}
    </div>
  );
}

function renderUnifiedDiffLineContent(line: string, filePath: string) {
  if (!line) {
    return ' ';
  }

  const firstCharacter = line[0];
  if (firstCharacter !== '+' && firstCharacter !== '-' && firstCharacter !== ' ') {
    return line;
  }

  return (
    <>
      <span>{firstCharacter}</span>
      {renderDiffCodeLineContent(line.slice(1), filePath)}
    </>
  );
}

function renderDiffCodeLineContent(line: string, filePath: string) {
  return highlightWorkbenchCodeLine(line, filePath).map((segment, segmentIndex) => (
    <span
      key={`${segmentIndex}-${segment.text}`}
      className={segment.kind ? `syntax-${segment.kind}` : undefined}
    >
      {segment.text || ' '}
    </span>
  ));
}

function readGitDiffStats(content: string) {
  let additions = 0;
  let deletions = 0;
  for (const line of content.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      additions += 1;
    } else if (line.startsWith('-')) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="workbench-info-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
