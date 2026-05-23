import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Folder,
  FolderGit2,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  GitFork,
  LoaderCircle,
  RefreshCw,
  Search,
  Star,
  Tag,
  Tags,
  X,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  compareGitBranches,
  createGitBranchFromSource,
  fetchGitCommitDetails,
  fetchGitCommitFilePreview,
  fetchGitHistoryLog,
  fetchGitRemote,
} from '../lib/git-api';
import { buildGitBranchCollections } from '../lib/git-branch-groups';
import { resolveGitHistoryDatePresetRange, type GitHistoryDatePreset } from '../lib/git-history-date-filter';
import { buildGitHistoryFileTree, type GitHistoryFileTreeNode } from '../lib/git-history-file-tree';
import { buildVsCodeGitGraphRowVisuals, type GitGraphVisual } from '../lib/git-graph-visual';
import {
  filterGitHistorySearchableOptions,
  type GitHistorySearchableOption,
} from '../lib/git-history-searchable-select';
import { buildGitHistoryBranchSelectSections } from '../lib/git-history-branch-select';
import { highlightWorkbenchCodeLine } from '../lib/workbench-files';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { MemoGitDiffViewer, type GitDiffViewerMode } from './GitDiffViewer';
import { PopoverPortal } from './PopoverPortal';
import { FileIcon } from './RightWorkbench';
import type {
  GitBranchCompareResult,
  GitBranchCreateResult,
  GitBranchSummary,
  GitCommitFilePreview,
  GitHistoryCommitDetails,
  GitHistoryCommitFile,
  GitHistoryLogCommit,
  GitHistoryLogResponse,
  ProjectSummary,
} from '../types';

const DEFAULT_LEFT_PANE_WIDTH = 250;
const DEFAULT_RIGHT_PANE_WIDTH = 380;
const MIN_LEFT_PANE_WIDTH = 220;
const MIN_CENTER_PANE_WIDTH = 420;
const MIN_RIGHT_PANE_WIDTH = 320;
const GIT_HISTORY_LOG_ROW_HEIGHT = 34;
type GitHistoryPanelProps = {
  project: ProjectSummary | null;
  onClose: () => void;
  onLoadBranches: (projectId: string) => Promise<GitBranchSummary[]>;
  onSwitchBranch: (projectId: string, branchName: string) => Promise<void>;
  onWorkspaceChanged: () => void | Promise<void>;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

type BranchContextMenuState = {
  branch: GitBranchSummary;
  x: number;
  y: number;
};

type HistoryPreviewState = {
  commitSha: string;
  files: GitHistoryCommitFile[];
  fileIndex: number;
};

type GitHistoryFilters = {
  author: string;
  datePreset: GitHistoryDatePreset;
  path: string;
  search: string;
};

type PaneSide = 'left' | 'right';
type DetailsDisplayMode = 'tree' | 'flat';

export function GitHistoryPanel({
  project,
  onLoadBranches,
  onSwitchBranch,
  onWorkspaceChanged,
  showToast,
}: GitHistoryPanelProps) {
  const [branches, setBranches] = useState<GitBranchSummary[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState('');
  const [selectedBranchName, setSelectedBranchName] = useState('');
  const [branchTreeSearch, setBranchTreeSearch] = useState('');
  const [collapsedBranchGroups, setCollapsedBranchGroups] = useState<Record<string, boolean>>({});
  const [historyResponse, setHistoryResponse] = useState<GitHistoryLogResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyFilters, setHistoryFilters] = useState<GitHistoryFilters>({
    author: '',
    datePreset: 'all',
    path: '',
    search: '',
  });
  const [selectedCommitSha, setSelectedCommitSha] = useState('');
  const [commitDetails, setCommitDetails] = useState<GitHistoryCommitDetails | null>(null);
  const [commitDetailsLoading, setCommitDetailsLoading] = useState(false);
  const [commitDetailsError, setCommitDetailsError] = useState('');
  const [detailsDisplayMode, setDetailsDisplayMode] = useState<DetailsDisplayMode>('tree');
  const [expandedDetailDirs, setExpandedDetailDirs] = useState<Record<string, boolean>>({});
  const [selectedDetailPath, setSelectedDetailPath] = useState('');
  const [compareState, setCompareState] = useState<GitBranchCompareResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState('');
  const [branchContextMenu, setBranchContextMenu] = useState<BranchContextMenuState | null>(null);
  const [branchWorkingName, setBranchWorkingName] = useState('');
  const [createBranchDialog, setCreateBranchDialog] = useState<{ source: string; name: string } | null>(null);
  const [createBranchWorking, setCreateBranchWorking] = useState(false);
  const [previewState, setPreviewState] = useState<HistoryPreviewState | null>(null);
  const [previewData, setPreviewData] = useState<GitCommitFilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewMode, setPreviewMode] = useState<'diff' | 'before' | 'after'>('diff');
  const [previewDiffMode, setPreviewDiffMode] = useState<GitDiffViewerMode>('split');
  const [leftPaneWidth, setLeftPaneWidth] = useState(DEFAULT_LEFT_PANE_WIDTH);
  const [rightPaneWidth, setRightPaneWidth] = useState(DEFAULT_RIGHT_PANE_WIDTH);
  const contextMenuAnchorRef = useRef<HTMLDivElement | null>(null);
  const branchMenuRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const commitListRef = useRef<HTMLDivElement | null>(null);
  const historyRequestIdRef = useRef(0);
  const deferredSearch = useDeferredValue(historyFilters.search.trim());
  const deferredPath = useDeferredValue(historyFilters.path.trim());
  const normalizedBranchTreeSearch = branchTreeSearch.trim().toLowerCase();

  useOutsideDismiss({
    selectors: [
      {
        selector: '.git-history-branch-context-menu',
        onDismiss: () => setBranchContextMenu(null),
        anchorRefs: [contextMenuAnchorRef, branchMenuRef],
      },
    ],
  });

  const currentBranch = project?.gitBranch ?? '';
  const currentRef = selectedBranchName || currentBranch || 'HEAD';
  const selectedPreviewFile = previewState ? previewState.files[previewState.fileIndex] ?? null : null;
  const historyCommits = historyResponse?.commits ?? [];
  const historyGraphVisuals = useMemo(
    () =>
      buildVsCodeGitGraphRowVisuals(
        historyCommits.map((commit) => ({
          id: commit.sha,
          parentIds: commit.parents,
        })),
        { rowHeight: GIT_HISTORY_LOG_ROW_HEIGHT },
      ),
    [historyCommits],
  );
  const branchCollections = useMemo(
    () => buildGitBranchCollections(branches, currentBranch),
    [branches, currentBranch],
  );
  const filteredBranchCollections = useMemo(
    () => filterBranchCollections(branchCollections, currentBranch, normalizedBranchTreeSearch),
    [branchCollections, currentBranch, normalizedBranchTreeSearch],
  );
  const authorOptions = historyResponse?.availableAuthors ?? [];
  const detailTree = useMemo(
    () => (commitDetails ? buildGitHistoryFileTree(commitDetails.files) : []),
    [commitDetails],
  );

  useEffect(() => {
    if (!project?.id) {
      return;
    }
    const persisted = readGitHistoryPaneWidths(project.id);
    setLeftPaneWidth(persisted.leftPaneWidth);
    setRightPaneWidth(persisted.rightPaneWidth);
  }, [project?.id]);

  useEffect(() => {
    if (!project?.id) {
      return;
    }
    writeGitHistoryPaneWidths(project.id, { leftPaneWidth, rightPaneWidth });
  }, [leftPaneWidth, project?.id, rightPaneWidth]);

  useEffect(() => {
    setPreviewState(null);
    setPreviewData(null);
    setPreviewError('');
    setCompareState(null);
    setCompareError('');
    setSelectedCommitSha('');
    setSelectedDetailPath('');
    setCommitDetails(null);
    setCommitDetailsError('');
      setHistoryResponse(null);
      setHistoryError('');
      setHistoryFilters({
        author: '',
        datePreset: 'all',
        path: '',
        search: '',
      });
    setBranchTreeSearch('');
    setSelectedBranchName(project?.gitBranch ?? 'HEAD');
    setCollapsedBranchGroups({});
    setExpandedDetailDirs({});
  }, [project?.id, project?.gitBranch]);

  useEffect(() => {
    if (!project?.id) {
      setBranches([]);
      return;
    }
    void loadBranches(true);
  }, [project?.id]);

  useEffect(() => {
    if (!project?.id || compareState) {
      return;
    }
    void loadHistoryLog();
  }, [
    compareState,
    currentBranch,
    deferredPath,
    deferredSearch,
    historyFilters.author,
    historyFilters.datePreset,
    project?.id,
    selectedBranchName,
  ]);

  useEffect(() => {
    if (!project?.id || !selectedCommitSha) {
      setCommitDetails(null);
      return;
    }

    let cancelled = false;
    setCommitDetailsLoading(true);
    setCommitDetailsError('');
    fetchGitCommitDetails(project.id, selectedCommitSha)
      .then((details) => {
        if (cancelled) {
          return;
        }
        setCommitDetails(details);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setCommitDetails(null);
        setCommitDetailsError(error instanceof Error ? error.message : '读取提交详情失败');
      })
      .finally(() => {
        if (!cancelled) {
          setCommitDetailsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [project?.id, selectedCommitSha]);

  useEffect(() => {
    if (!commitDetails) {
      setExpandedDetailDirs({});
      setSelectedDetailPath('');
      return;
    }

    setExpandedDetailDirs(buildDefaultExpandedDirs(detailTree));
    setSelectedDetailPath(commitDetails.files[0]?.path ?? '');
  }, [commitDetails, detailTree]);

  useEffect(() => {
    if (!project?.id || !previewState || !selectedPreviewFile) {
      setPreviewData(null);
      setPreviewError('');
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError('');
    fetchGitCommitFilePreview(project.id, previewState.commitSha, selectedPreviewFile.path)
      .then((payload) => {
        if (!cancelled) {
          setPreviewData(payload);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPreviewData(null);
          setPreviewError(error instanceof Error ? error.message : '读取历史文件预览失败');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [previewState, project?.id, selectedPreviewFile]);

  async function loadBranches(force = false) {
    if (!project?.id || (branchesLoading && !force)) {
      return;
    }
    setBranchesLoading(true);
    setBranchesError('');
    try {
      setBranches(await onLoadBranches(project.id));
    } catch (error) {
      setBranchesError(error instanceof Error ? error.message : '读取分支失败');
    } finally {
      setBranchesLoading(false);
    }
  }

  async function loadHistoryLog(cursor?: string | null) {
    if (!project?.id) {
      return;
    }
    const append = Boolean(cursor);
    const requestId = historyRequestIdRef.current + 1;
    historyRequestIdRef.current = requestId;
    if (append) {
      setHistoryLoadingMore(true);
    } else {
      setHistoryLoading(true);
      setHistoryError('');
      setHistoryResponse(null);
    }
    try {
      const dateRange = resolveGitHistoryDatePresetRange(historyFilters.datePreset);
      const payload = await fetchGitHistoryLog(project.id, {
        refs: currentRef ? [currentRef] : ['HEAD'],
        authors: historyFilters.author ? [historyFilters.author] : [],
        dateFrom: dateRange.dateFrom,
        dateTo: dateRange.dateTo,
        paths: deferredPath ? [deferredPath] : [],
        search: deferredSearch || undefined,
        limit: 80,
        cursor,
      });
      if (historyRequestIdRef.current !== requestId) {
        return;
      }

      setHistoryResponse((current) => {
        if (!append || !current) {
          return payload;
        }
        return {
          ...payload,
          commits: [...current.commits, ...payload.commits],
          availableAuthors: Array.from(new Set([...current.availableAuthors, ...payload.availableAuthors])),
          activeRefs: payload.activeRefs,
        };
      });
      if (!append) {
        setSelectedCommitSha((current) => {
          if (current && payload.commits.some((commit) => commit.sha === current)) {
            return current;
          }
          return payload.commits[0]?.sha ?? '';
        });
      }
    } catch (error) {
      if (historyRequestIdRef.current !== requestId) {
        return;
      }
      if (!append) {
        setHistoryResponse(null);
        setSelectedCommitSha('');
      }
      setHistoryError(error instanceof Error ? error.message : '读取 Git 日志失败');
    } finally {
      if (historyRequestIdRef.current === requestId) {
        setHistoryLoading(false);
        setHistoryLoadingMore(false);
      }
    }
  }

  async function handleCheckoutBranch(branch: GitBranchSummary) {
    if (!project?.id) {
      return;
    }
    setBranchWorkingName(branch.name);
    try {
      await onSwitchBranch(project.id, branch.name);
      await Promise.resolve(onWorkspaceChanged());
      await loadBranches(true);
      setSelectedBranchName(branch.localName ?? branch.name);
      setCompareState(null);
      showToast(`已切换到 ${branch.localName ?? branch.name}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '切换分支失败', 'error');
    } finally {
      setBranchWorkingName('');
      setBranchContextMenu(null);
    }
  }

  async function handleCompareBranch(branch: GitBranchSummary) {
    if (!project?.id || !currentBranch) {
      return;
    }
    setCompareLoading(true);
    setCompareError('');
    setBranchContextMenu(null);
    try {
      const result = await compareGitBranches(project.id, branch.name, currentBranch);
      setCompareState(result);
      const firstCommit = result.targetOnlyCommits[0] ?? result.currentOnlyCommits[0] ?? null;
      setSelectedCommitSha(firstCommit?.sha ?? '');
    } catch (error) {
      setCompareState(null);
      setCompareError(error instanceof Error ? error.message : '读取分支比较失败');
    } finally {
      setCompareLoading(false);
    }
  }

  async function handleFetchRemote(branch: GitBranchSummary) {
    if (!project?.id) {
      return;
    }
    setBranchWorkingName(branch.name);
    try {
      const result = await fetchGitRemote(project.id, branch.remoteName ?? undefined);
      await Promise.resolve(onWorkspaceChanged());
      await loadBranches(true);
      showToast(result.output || `已更新 ${branch.remoteName ?? '远端'}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '更新远程分支失败', 'error');
    } finally {
      setBranchWorkingName('');
      setBranchContextMenu(null);
    }
  }

  async function handleCreateBranch() {
    if (!project?.id || !createBranchDialog?.name.trim()) {
      return;
    }
    setCreateBranchWorking(true);
    try {
      const result: GitBranchCreateResult = await createGitBranchFromSource(
        project.id,
        createBranchDialog.name.trim(),
        createBranchDialog.source,
      );
      await Promise.resolve(onWorkspaceChanged());
      await loadBranches(true);
      setSelectedBranchName(result.branch);
      setCreateBranchDialog(null);
      showToast(`已创建并切换到 ${result.branch}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '创建分支失败', 'error');
    } finally {
      setCreateBranchWorking(false);
    }
  }

  function openHistoryPreview(fileIndex: number) {
    if (!selectedCommitSha || !commitDetails) {
      return;
    }
    setPreviewMode('diff');
    setPreviewDiffMode('split');
    setPreviewState({
      commitSha: selectedCommitSha,
      files: commitDetails.files,
      fileIndex,
    });
  }

  function handleSelectDetailFile(filePath: string) {
    setSelectedDetailPath(filePath);
    if (previewState && commitDetails) {
      const nextIndex = commitDetails.files.findIndex((file) => file.path === filePath);
      if (nextIndex >= 0) {
        setPreviewState({
          commitSha: commitDetails.sha,
          files: commitDetails.files,
          fileIndex: nextIndex,
        });
      }
    }
  }

  function handleOpenDetailFile(filePath: string) {
    if (!commitDetails) {
      return;
    }
    const fileIndex = commitDetails.files.findIndex((file) => file.path === filePath);
    if (fileIndex >= 0) {
      openHistoryPreview(fileIndex);
    }
  }

  function beginResize(side: PaneSide, clientX: number) {
    const layout = layoutRef.current;
    if (!layout) {
      return;
    }
    const containerWidth = layout.getBoundingClientRect().width;
    const startLeftWidth = leftPaneWidth;
    const startRightWidth = rightPaneWidth;

    const onPointerMove = (event: MouseEvent) => {
      const deltaX = event.clientX - clientX;
      if (side === 'left') {
        const maxLeft = Math.max(MIN_LEFT_PANE_WIDTH, containerWidth - MIN_CENTER_PANE_WIDTH - startRightWidth - 12);
        setLeftPaneWidth(clamp(startLeftWidth + deltaX, MIN_LEFT_PANE_WIDTH, maxLeft));
        return;
      }
      const maxRight = Math.max(MIN_RIGHT_PANE_WIDTH, containerWidth - MIN_CENTER_PANE_WIDTH - startLeftWidth - 12);
      setRightPaneWidth(clamp(startRightWidth - deltaX, MIN_RIGHT_PANE_WIDTH, maxRight));
    };

    const onPointerUp = () => {
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
      document.body.classList.remove('git-history-resizing');
    };

    document.body.classList.add('git-history-resizing');
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp, { once: true });
  }

  function renderHistoryPane() {
    if (historyLoading || compareLoading) {
      return <PanelEmpty icon={LoaderCircle} spinning title="正在读取提交历史" description="请稍等。" />;
    }
    if (historyError || compareError) {
      return <PanelEmpty icon={GitCommitHorizontal} title="读取失败" description={historyError || compareError} />;
    }
    if (compareState) {
      const compareCommits = [
        ...compareState.targetOnlyCommits.map((commit) => ({ commit, group: 'target' as const })),
        ...compareState.currentOnlyCommits.map((commit) => ({ commit, group: 'current' as const })),
      ];
      if (compareCommits.length === 0) {
        return <PanelEmpty icon={GitCommitHorizontal} title="没有比较结果" description="两个分支目前没有差异提交。" />;
      }
      return (
        <div className="git-history-commit-list" ref={commitListRef}>
          <div className="git-history-compare-banner">
            <span>{compareState.branch}</span>
            <span>vs</span>
            <span>{compareState.compareBranch}</span>
            <button
              type="button"
              className="git-history-clear-compare"
              onClick={() => {
                setCompareState(null);
                setCompareError('');
                setSelectedBranchName(currentBranch || 'HEAD');
              }}
            >
              退出比较
            </button>
          </div>
          <CommitSectionLabel label={`${compareState.branch} 独有`} count={compareState.targetOnlyCommits.length} />
          {compareCommits.filter((entry) => entry.group === 'target').map(({ commit }) => renderCompareCommitRow(commit))}
          <CommitSectionLabel label={`${compareState.compareBranch} 独有`} count={compareState.currentOnlyCommits.length} />
          {compareCommits.filter((entry) => entry.group === 'current').map(({ commit }) => renderCompareCommitRow(commit))}
        </div>
      );
    }
    if (historyCommits.length === 0) {
      return <PanelEmpty icon={GitCommitHorizontal} title="没有匹配的提交" description="可以尝试切换分支或清空筛选。" />;
    }

    return (
      <div
        ref={commitListRef}
        className="git-history-commit-list git-history-commit-table"
        onScroll={(event) => {
          const element = event.currentTarget;
          if (
            !historyLoadingMore &&
            historyResponse?.hasMore &&
            element.scrollTop + element.clientHeight >= element.scrollHeight - 96
          ) {
            void loadHistoryLog(historyResponse.nextCursor);
          }
        }}
      >
        <div
          className="git-history-log-body"
          style={
            {
              '--git-history-log-body-height': `${historyCommits.length * GIT_HISTORY_LOG_ROW_HEIGHT}px`,
            } as CSSProperties
          }
        >
          {historyCommits.map((commit, index) => renderLogCommitRow(commit, historyGraphVisuals[index]))}
        </div>
        {historyLoadingMore ? (
          <div className="git-history-load-more">
            <LoaderCircle className="spin" size={14} />
            <span>正在加载更多提交…</span>
          </div>
        ) : null}
      </div>
    );
  }

  function renderCompareCommitRow(commit: { sha: string; summary: string; author: string; shortSha: string; commitTime: number }) {
    const active = commit.sha === selectedCommitSha;
    return (
      <button
        key={commit.sha}
        type="button"
        className={`git-history-commit-row${active ? ' active' : ''}`}
        onClick={() => setSelectedCommitSha(commit.sha)}
      >
        <div className="git-history-commit-main">
          <strong>{commit.summary || '无提交信息'}</strong>
          <span>{commit.author}</span>
        </div>
        <div className="git-history-commit-meta">
          <code>{commit.shortSha}</code>
          <span>{formatCommitTime(commit.commitTime)}</span>
        </div>
      </button>
    );
  }

  function renderLogCommitRow(commit: GitHistoryLogCommit, graphVisual?: GitGraphVisual) {
    const active = commit.sha === selectedCommitSha;
    const rowStyle = {
      '--git-history-log-row-height': `${GIT_HISTORY_LOG_ROW_HEIGHT}px`,
      '--git-history-row-graph-width': `${graphVisual?.width ?? 22}px`,
    } as CSSProperties;

    return (
      <button
        key={commit.sha}
        type="button"
        className={`git-history-log-row${active ? ' active' : ''}`}
        style={rowStyle}
        onClick={() => setSelectedCommitSha(commit.sha)}
      >
        <div className="git-history-log-graph-cell" aria-hidden="true">
          {graphVisual ? <GitGraphVisualSvg visual={graphVisual} /> : null}
        </div>
        <div className="git-history-log-subject">
          <div className="git-history-log-summary">
            <strong>{commit.summary || '无提交信息'}</strong>
            {commit.refs.length > 0 ? (
              <span className="git-history-log-refs" aria-label="提交引用">
                {commit.refs.map((ref) => (
                  <span key={`${commit.sha}-${ref}`} className={buildRefClassName(ref)}>
                    {ref}
                  </span>
                ))}
              </span>
            ) : null}
          </div>
        </div>
        <div className="git-history-log-author">{commit.author}</div>
        <div className="git-history-log-time">{formatCommitTime(commit.commitTime, true)}</div>
      </button>
    );
  }

  function renderBranchTree() {
    const hasSearch = Boolean(normalizedBranchTreeSearch);
    const hasAnyBranch =
      filteredBranchCollections.localBranches.length > 0 ||
      filteredBranchCollections.remoteGroups.length > 0 ||
      filteredBranchCollections.tagBranches.length > 0 ||
      filteredBranchCollections.headBranchVisible;
    if (!hasAnyBranch) {
      return <div className="git-history-branch-empty standalone">没有匹配的分支或标签</div>;
    }

    return (
      <>
        {filteredBranchCollections.headBranchVisible ? (
          <div className="git-history-head-branch-label">HEAD(当前分支)</div>
        ) : null}
        <BranchTreeGroup groupId="local" title="本地" forceExpanded={hasSearch}>
          {filteredBranchCollections.localBranches.length === 0 ? (
            <div className="git-history-branch-empty">暂无</div>
          ) : (
            <div className="git-history-branch-children">
              {renderBranchRows(filteredBranchCollections.localBranches)}
            </div>
          )}
        </BranchTreeGroup>
        <BranchTreeGroup groupId="remote" title="远程" forceExpanded={hasSearch}>
          {filteredBranchCollections.remoteGroups.length === 0 ? (
            <div className="git-history-branch-empty">暂无</div>
          ) : (
            <div className="git-history-branch-children">
              {filteredBranchCollections.remoteGroups.map((group) => (
                <BranchTreeGroup
                  key={group.name}
                  groupId={`remote:${group.name}`}
                  title={group.name}
                  nested
                  icon={<Folder size={14} className="git-history-branch-group-icon remote-folder" />}
                  forceExpanded={hasSearch}
                >
                  <div className="git-history-branch-children nested">
                    {renderBranchRows(group.branches)}
                  </div>
                </BranchTreeGroup>
              ))}
            </div>
          )}
        </BranchTreeGroup>
        <BranchTreeGroup groupId="tag" title="标签" forceExpanded={hasSearch}>
          {filteredBranchCollections.tagBranches.length === 0 ? (
            <div className="git-history-branch-empty">暂无</div>
          ) : (
            <div className="git-history-branch-children">
              {renderBranchRows(filteredBranchCollections.tagBranches)}
            </div>
          )}
        </BranchTreeGroup>
      </>
    );
  }

  function BranchTreeGroup({
    groupId,
    title,
    children,
    nested = false,
    icon,
    forceExpanded = false,
  }: {
    groupId: string;
    title: string;
    children: ReactNode;
    nested?: boolean;
    icon?: ReactNode;
    forceExpanded?: boolean;
  }) {
    const collapsed = forceExpanded ? false : collapsedBranchGroups[groupId] === true;
    return (
      <div className={`git-history-branch-group${nested ? ' nested' : ''}`}>
        <button
          type="button"
          className={`git-history-branch-group-toggle${nested ? ' nested' : ''}`}
          onClick={() => {
            if (forceExpanded) {
              return;
            }
            setCollapsedBranchGroups((current) => ({
              ...current,
              [groupId]: !collapsed,
            }));
          }}
        >
          <ChevronDown size={14} className={`git-history-branch-group-chevron${collapsed ? ' collapsed' : ''}`} />
          {icon}
          <span>{title}</span>
        </button>
        {collapsed ? null : children}
      </div>
    );
  }

  function renderBranchRows(items: GitBranchSummary[]) {
    return items.map((branch) => {
      const active = !compareState && currentRef === branch.name;
      const displayName = branch.kind === 'remote' ? branch.localName ?? branch.name : branch.name;
      return (
        <button
          key={branch.name}
          type="button"
          className={`git-history-branch-row${active ? ' active' : ''}`}
          onClick={() => {
            setCompareState(null);
            setCompareError('');
            setSelectedBranchName(branch.name);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setBranchContextMenu({
              branch,
              x: event.clientX,
              y: event.clientY,
            });
          }}
        >
          <span className="git-history-branch-row-main">
            <BranchKindIcon branch={branch} />
            <strong title={branch.name}>{displayName}</strong>
          </span>
          {branchWorkingName === branch.name ? (
            <LoaderCircle className="spin" size={14} />
          ) : null}
        </button>
      );
    });
  }

  function renderDetailsPane() {
    if (commitDetailsLoading) {
      return <PanelEmpty icon={LoaderCircle} spinning title="正在读取提交详情" description="请稍等。" />;
    }
    if (commitDetailsError) {
      return <PanelEmpty icon={GitCommitHorizontal} title="读取失败" description={commitDetailsError} />;
    }
    if (!commitDetails) {
      return <PanelEmpty icon={GitCommitHorizontal} title="请选择一个提交" description="点击中间列表中的提交查看详情。" />;
    }

    return (
      <div className="git-history-details-body">
        <div className="git-history-details-meta">
          <h4>{commitDetails.summary || '无提交信息'}</h4>
          <div className="git-history-details-submeta">
            <code>{commitDetails.shortSha}</code>
            <span>{commitDetails.author}</span>
            <span>{formatCommitTime(commitDetails.commitTime, true)}</span>
          </div>
          {commitDetails.refs && commitDetails.refs.length > 0 ? (
            <div className="git-history-details-refs">
              <span>在 {commitDetails.refs.length} 个分支中：</span>
              <strong>{commitDetails.refs.join(', ')}</strong>
            </div>
          ) : null}
          {commitDetails.message && commitDetails.message !== commitDetails.summary ? (
            <pre className="git-history-details-message">{commitDetails.message}</pre>
          ) : null}
        </div>
        <div className="git-history-files-scroll">
          {detailsDisplayMode === 'flat' ? (
            <div className="git-history-files-list">
              {commitDetails.files.map((file) => renderFileRow(file))}
            </div>
          ) : (
            <div className="git-history-file-tree">
              {detailTree.map((node) => renderTreeNode(node, 0))}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderTreeNode(node: GitHistoryFileTreeNode, depth: number): ReactNode {
    if (node.type === 'file') {
      return renderFileRow(node.file, depth, true);
    }
    const expanded = expandedDetailDirs[node.path] !== false;
    return (
      <div key={node.path} className="git-history-tree-group">
        <button
          type="button"
          className="git-history-tree-dir"
          style={{ '--tree-depth': depth } as CSSProperties}
          onClick={() => {
            setExpandedDetailDirs((current) => ({
              ...current,
              [node.path]: !expanded,
            }));
          }}
        >
          <ChevronDown size={14} className={`git-history-branch-group-chevron${expanded ? '' : ' collapsed'}`} />
          <Folder size={14} />
          <strong>{node.name}</strong>
        </button>
        {expanded ? node.children.map((child) => renderTreeNode(child, depth + 1)) : null}
      </div>
    );
  }

  function renderFileRow(file: GitHistoryCommitFile, depth = 0, tree = false) {
    const fileName = getFileName(file.path);
    const fileDirectory = tree ? '' : getFileDirectory(file.path);
    const originalFileName = file.originalPath ? getFileName(file.originalPath) : '';
    const originalDirectory = file.originalPath ? getFileDirectory(file.originalPath) : '';
    const statusClassName = normalizeStatusClassName(file.status);

    return (
      <button
        key={`${file.path}-${file.status}`}
        type="button"
        className={`git-history-file-row${selectedDetailPath === file.path ? ' active' : ''}${tree ? ' tree' : ''}`}
        style={tree ? ({ '--tree-depth': depth } as CSSProperties) : undefined}
        onClick={() => handleSelectDetailFile(file.path)}
        onDoubleClick={() => handleOpenDetailFile(file.path)}
      >
        <div className="git-history-file-main">
          <span
            className={`git-history-file-status status-${statusClassName}`}
            title={file.status}
            aria-label={file.status}
          >
            {formatFileStatusLabel(file.status)}
          </span>
          <FileIcon path={file.path} type="file" />
          <span className="git-history-file-text">
            <span className="git-history-file-name-line">
              <strong title={file.path}>{fileName}</strong>
              {fileDirectory ? <small title={fileDirectory}>{fileDirectory}</small> : null}
            </span>
          </span>
          {file.originalPath && file.originalPath !== file.path ? (
            <small className="git-history-file-rename" title={file.originalPath}>
              {originalFileName}{originalDirectory ? ` · ${originalDirectory}` : ''}
            </small>
          ) : null}
        </div>
      </button>
    );
  }

  if (!project) {
    return <PanelEmpty icon={FolderGit2} title="请选择一个项目" description="选择 Git 仓库后才可以查看日志。" />;
  }

  return (
    <section className="git-history-panel">
      <div
        ref={(node) => {
          contextMenuAnchorRef.current = node;
          layoutRef.current = node;
        }}
        className="git-history-layout"
        style={
          {
            '--git-history-left-width': `${leftPaneWidth}px`,
            '--git-history-right-width': `${rightPaneWidth}px`,
          } as CSSProperties
        }
      >
        <aside className="git-history-branches-column">
          <div className="git-history-pane-toolbar branch">
            <label className="git-history-branch-search">
              <Search size={14} />
              <input
                value={branchTreeSearch}
                onChange={(event) => setBranchTreeSearch(event.target.value)}
                placeholder="分支或标签"
              />
            </label>
            <button type="button" className="git-history-toolbar-icon" onClick={() => void loadBranches(true)} title="刷新分支">
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="git-history-branch-tree">
            {branchesError ? <div className="git-history-error">{branchesError}</div> : null}
            {branchesLoading && branches.length === 0 ? (
              <PanelEmpty icon={LoaderCircle} spinning title="正在读取分支" description="请稍等。" />
            ) : (
              renderBranchTree()
            )}
          </div>
        </aside>

        <button
          type="button"
          className="git-history-splitter"
          aria-label="调整分支区宽度"
          onMouseDown={(event) => {
            event.preventDefault();
            beginResize('left', event.clientX);
          }}
          onDoubleClick={() => setLeftPaneWidth(DEFAULT_LEFT_PANE_WIDTH)}
        />

        <section className="git-history-commits-column">
          <div className="git-history-pane-toolbar commits">
            <label className="git-history-toolbar-search wide">
              <Search size={14} />
              <input
                value={historyFilters.search}
                onChange={(event) => setHistoryFilters((current) => ({ ...current, search: event.target.value }))}
                placeholder="文本或哈希"
              />
            </label>
            <div className="git-history-inline-filters">
              <div className="git-history-inline-filter">
                <GitHistoryBranchSelect
                  collections={branchCollections}
                  value={selectedBranchName}
                  displayValue={selectedBranchName || '选择分支'}
                  ariaLabel="选择 Git 日志分支"
                  onChange={(value) => {
                    setCompareState(null);
                    setCompareError('');
                    setSelectedBranchName(value);
                  }}
                />
              </div>
              <div className="git-history-inline-filter">
                <GitHistorySearchableSelect
                  menuClassName="author"
                  triggerClassName="author"
                  value={historyFilters.author}
                  displayValue={historyFilters.author || '全部作者'}
                  options={[
                    { value: '', label: '全部作者' },
                    ...authorOptions.map((author) => ({ value: author, label: author })),
                  ]}
                  searchPlaceholder="搜索作者"
                  emptyText="没有匹配的作者"
                  ariaLabel="按作者筛选 Git 日志"
                  onChange={(value) => setHistoryFilters((current) => ({ ...current, author: value }))}
                />
              </div>
              <div className="git-history-inline-filter">
                <GitHistorySimpleSelect
                  menuClassName="date"
                  triggerClassName="date"
                  value={historyFilters.datePreset}
                  displayValue={formatGitHistoryDatePreset(historyFilters.datePreset)}
                  options={[
                    { value: 'all', label: '全部日期' },
                    { value: '24h', label: '过去 24 小时' },
                    { value: '7d', label: '过去 7 天' },
                    { value: '30d', label: '过去 30 天' },
                  ]}
                  ariaLabel="按日期筛选 Git 日志"
                  onChange={(value) =>
                    setHistoryFilters((current) => ({
                      ...current,
                      datePreset: value as GitHistoryDatePreset,
                    }))
                  }
                />
              </div>
            </div>
            <div className="git-history-pane-toolbar-actions">
              {compareState ? (
                <button
                  type="button"
                  className="git-history-toolbar-icon"
                  onClick={() => {
                    setCompareState(null);
                    setCompareError('');
                    setSelectedBranchName(currentBranch || 'HEAD');
                  }}
                  title="退出比较"
                >
                  <GitFork size={14} />
                </button>
              ) : null}
              <button type="button" className="git-history-toolbar-icon" onClick={() => void loadHistoryLog()} title="刷新日志">
                <RefreshCw size={14} />
              </button>
            </div>
          </div>
          {renderHistoryPane()}
        </section>

        <button
          type="button"
          className="git-history-splitter"
          aria-label="调整详情区宽度"
          onMouseDown={(event) => {
            event.preventDefault();
            beginResize('right', event.clientX);
          }}
          onDoubleClick={() => setRightPaneWidth(DEFAULT_RIGHT_PANE_WIDTH)}
        />

        <section className="git-history-details-column">
          <div className="git-history-pane-toolbar details">
            <div className="git-history-details-toolbar-meta">
              <strong>提交详情</strong>
              {commitDetails ? <span>{commitDetails.files.length} 个文件</span> : null}
            </div>
            <div className="git-history-view-mode">
              <button
                type="button"
                className={`git-history-view-chip${detailsDisplayMode === 'tree' ? ' active' : ''}`}
                onClick={() => setDetailsDisplayMode('tree')}
              >
                目录
              </button>
              <button
                type="button"
                className={`git-history-view-chip${detailsDisplayMode === 'flat' ? ' active' : ''}`}
                onClick={() => setDetailsDisplayMode('flat')}
              >
                平铺
              </button>
            </div>
          </div>
          {renderDetailsPane()}
        </section>
      </div>

      <PopoverPortal
        open={Boolean(branchContextMenu)}
        anchorRef={contextMenuAnchorRef}
        virtualAnchor={branchContextMenu ? { x: branchContextMenu.x, y: branchContextMenu.y } : null}
        placement="bottom-start"
        offset={0}
      >
        <div ref={branchMenuRef} className="workspace-menu git-history-branch-context-menu" role="menu" aria-label="分支菜单">
          <button
            type="button"
            className="workspace-menu-item"
            disabled={branchWorkingName === branchContextMenu?.branch.name}
            onClick={() => branchContextMenu ? void handleCheckoutBranch(branchContextMenu.branch) : undefined}
          >
            <GitBranch size={15} />
            <span>签出</span>
          </button>
          <button
            type="button"
            className="workspace-menu-item"
            onClick={() => {
              if (!branchContextMenu) {
                return;
              }
              setCreateBranchDialog({
                source: branchContextMenu.branch.name,
                name: suggestBranchName(branchContextMenu.branch),
              });
              setBranchContextMenu(null);
            }}
          >
            <GitBranchPlus size={15} />
            <span>基于此创建分支</span>
          </button>
          <button
            type="button"
            className="workspace-menu-item"
            disabled={!currentBranch || branchMatchesCurrent(branchContextMenu?.branch, currentBranch)}
            onClick={() => branchContextMenu ? void handleCompareBranch(branchContextMenu.branch) : undefined}
          >
            <GitFork size={15} />
            <span>与当前分支比较</span>
          </button>
          {branchContextMenu?.branch.isRemote ? (
            <button
              type="button"
              className="workspace-menu-item"
              disabled={branchWorkingName === branchContextMenu.branch.name}
              onClick={() => void handleFetchRemote(branchContextMenu.branch)}
            >
              <Download size={15} />
              <span>更新</span>
            </button>
          ) : null}
        </div>
      </PopoverPortal>

      {createBranchDialog ? (
        <div className="dialog-backdrop git-history-dialog-backdrop" role="presentation" onClick={() => !createBranchWorking && setCreateBranchDialog(null)}>
          <section className="dialog-card git-history-inline-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-head">
              <h3>基于 {createBranchDialog.source} 创建分支</h3>
              <p>创建后会自动切换到新分支。</p>
            </div>
            <label className="clone-dialog-field">
              <span>分支名</span>
              <input
                className="dialog-input"
                value={createBranchDialog.name}
                onChange={(event) => setCreateBranchDialog((current) => current ? { ...current, name: event.target.value } : current)}
                placeholder="feature/new-branch"
              />
            </label>
            <div className="dialog-actions">
              <button type="button" className="dialog-button secondary" disabled={createBranchWorking} onClick={() => setCreateBranchDialog(null)}>
                取消
              </button>
              <button type="button" className="dialog-button primary" disabled={createBranchWorking || !createBranchDialog.name.trim()} onClick={() => void handleCreateBranch()}>
                {createBranchWorking ? <LoaderCircle className="spin" size={14} /> : null}
                创建并切换
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {previewState ? (
        <div className="dialog-backdrop git-history-preview-backdrop" role="presentation" onClick={() => setPreviewState(null)}>
          <section className="git-history-preview-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="git-history-preview-head">
              <div className="git-history-preview-title">
                <strong title={selectedPreviewFile?.path}>{selectedPreviewFile?.path ?? '历史文件预览'}</strong>
                {previewData ? (
                  <span className="git-history-diff-stats">
                    <span className="git-diff-add">+{previewData.additions}</span>
                    <span className="git-history-diff-sep">/</span>
                    <span className="git-diff-del">-{previewData.deletions}</span>
                  </span>
                ) : null}
              </div>
              <div className="git-history-preview-actions">
                <button type="button" className={`git-history-preview-chip${previewMode === 'diff' ? ' active' : ''}`} onClick={() => setPreviewMode('diff')}>
                  Diff
                </button>
                <button type="button" className={`git-history-preview-chip${previewMode === 'after' ? ' active' : ''}`} onClick={() => setPreviewMode('after')}>
                  提交后
                </button>
                <button type="button" className={`git-history-preview-chip${previewMode === 'before' ? ' active' : ''}`} onClick={() => setPreviewMode('before')}>
                  提交前
                </button>
                <button
                  type="button"
                  className="git-history-preview-icon"
                  disabled={(previewState.fileIndex ?? 0) <= 0}
                  onClick={() => setPreviewState((current) => current ? { ...current, fileIndex: Math.max(0, current.fileIndex - 1) } : current)}
                  title="上一文件"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  className="git-history-preview-icon"
                  disabled={!previewState.files[previewState.fileIndex + 1]}
                  onClick={() => setPreviewState((current) => current ? { ...current, fileIndex: Math.min(current.files.length - 1, current.fileIndex + 1) } : current)}
                  title="下一文件"
                >
                  <ChevronRight size={16} />
                </button>
                <button type="button" className="git-history-preview-icon" onClick={() => setPreviewState(null)} title="关闭">
                  <X size={16} />
                </button>
              </div>
            </header>
            <div className="git-history-preview-meta">
              <code>{previewState.commitSha.slice(0, 7)}</code>
              <span>{selectedPreviewFile?.status}</span>
              {selectedPreviewFile?.originalPath && selectedPreviewFile.originalPath !== selectedPreviewFile.path ? (
                <span>{selectedPreviewFile.originalPath} → {selectedPreviewFile.path}</span>
              ) : null}
            </div>
            <div className="git-history-preview-body">
              {previewLoading ? (
                <PanelEmpty icon={LoaderCircle} spinning title="正在读取历史文件" description="请稍等。" />
              ) : previewError ? (
                <PanelEmpty icon={FileText} title="预览失败" description={previewError} />
              ) : !previewData ? (
                <PanelEmpty icon={FileText} title="没有预览内容" description="请选择一个历史文件。" />
              ) : previewMode === 'diff' ? (
                <MemoGitDiffViewer
                  content={previewData.content}
                  beforeContent={previewData.beforeContent}
                  afterContent={previewData.afterContent}
                  filePath={previewData.path}
                  viewMode={previewDiffMode}
                  onViewModeChange={setPreviewDiffMode}
                />
              ) : (
                <CodeSnapshotViewer
                  filePath={previewData.path}
                  content={previewMode === 'before' ? previewData.beforeContent : previewData.afterContent}
                />
              )}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function BranchKindIcon({ branch }: { branch: GitBranchSummary }) {
  if (branch.kind === 'tag') {
    return <Tags size={14} className="git-history-branch-kind-icon tag" />;
  }
  const normalizedName = (branch.localName ?? branch.name).toLowerCase();
  if (branch.current) {
    return <Tag size={14} className="git-history-branch-kind-icon current" />;
  }
  if (normalizedName === 'main' || normalizedName === 'master') {
    return <Star size={14} className="git-history-branch-kind-icon default" />;
  }
  return <GitBranch size={14} className={`git-history-branch-kind-icon${branch.kind === 'remote' ? ' remote' : ' local'}`} />;
}

function GitGraphVisualSvg({ visual }: { visual: GitGraphVisual }) {
  return (
    <svg
      className="git-history-graph-visual git-history-graph-row-visual"
      width={visual.width}
      height={visual.height}
      viewBox={`0 0 ${visual.width} ${visual.height}`}
      aria-hidden="true"
    >
      {visual.lines.map((line) => (
        <line
          key={line.key}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke={resolveGitGraphVisualColor(line.colorIndex)}
          strokeWidth="1.5"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {visual.curves.map((curve) => (
        <path
          key={curve.key}
          d={curve.d}
          fill="none"
          stroke={resolveGitGraphVisualColor(curve.colorIndex)}
          strokeWidth="1.5"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {visual.nodes.map((node) => (
        <circle
          key={node.key}
          cx={node.cx}
          cy={node.cy}
          r="4.5"
          fill={resolveGitGraphVisualColor(node.colorIndex)}
          stroke={resolveGitGraphVisualColor(node.colorIndex)}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function resolveGitGraphVisualColor(index: number) {
  const palette = [
    '#0078d4',
    '#ffb000',
    '#dc267f',
    '#994f00',
    '#40b0a6',
    '#b66dff',
    '#38bdf8',
    '#22c55e',
  ];
  return palette[index % palette.length] ?? palette[0];
}

function CommitSectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="git-history-commit-section-label">
      <span>{label}</span>
      <small>{count}</small>
    </div>
  );
}

function PanelEmpty({
  icon: Icon,
  title,
  description,
  spinning = false,
}: {
  icon: typeof GitCommitHorizontal;
  title: string;
  description: string;
  spinning?: boolean;
}) {
  return (
    <div className="git-history-empty-state">
      <Icon className={spinning ? 'spin' : undefined} size={20} />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function CodeSnapshotViewer({ filePath, content }: { filePath: string; content: string }) {
  const lines = (content || '').split('\n');
  return (
    <div className="workbench-code-preview git-history-snapshot-viewer">
      {lines.map((line, index) => (
        <div key={`${index}-${line}`} className="workbench-code-line">
          <span className="workbench-code-line-no">{index + 1}</span>
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

function GitHistorySearchableSelect({
  value,
  displayValue,
  options,
  searchPlaceholder,
  emptyText,
  ariaLabel,
  menuClassName,
  triggerClassName,
  onChange,
}: {
  value: string;
  displayValue: string;
  options: ReadonlyArray<GitHistorySearchableOption>;
  searchPlaceholder: string;
  emptyText: string;
  ariaLabel: string;
  menuClassName: string;
  triggerClassName: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filteredOptions = useMemo(() => filterGitHistorySearchableOptions(options, keyword), [keyword, options]);

  useOutsideDismiss({
    selectors: [
      {
        selector: `.git-history-filter-menu.${menuClassName}`,
        onDismiss: () => {
          setOpen(false);
          setKeyword('');
        },
        anchorRefs: [anchorRef],
      },
    ],
  });

  useEffect(() => {
    if (!open) {
      setKeyword('');
      return;
    }
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  return (
    <div className="git-history-searchable-select-anchor" ref={anchorRef}>
      <button
        type="button"
        className={`git-history-searchable-select-trigger ${triggerClassName}${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={displayValue}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{displayValue}</span>
        <ChevronDown size={14} />
      </button>
      <PopoverPortal open={open} anchorRef={anchorRef} placement="bottom-start" offset={8}>
        <div className={`workspace-menu git-history-filter-menu ${menuClassName}`} role="menu" aria-label={ariaLabel}>
          <label className="git-history-filter-menu-search">
            <Search size={14} />
            <input
              ref={inputRef}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={searchPlaceholder}
            />
          </label>
          <div className="workspace-menu-divider" role="separator" />
          <div className="git-history-filter-menu-list">
            {filteredOptions.length === 0 ? <div className="git-history-filter-menu-empty">{emptyText}</div> : null}
            {filteredOptions.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={`${menuClassName}-${option.value || '__all__'}`}
                  type="button"
                  className={`workspace-menu-item git-history-filter-menu-item${selected ? ' current' : ''}`}
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                    setKeyword('');
                  }}
                >
                  <span>{option.label}</span>
                  {selected ? <Check size={15} /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverPortal>
    </div>
  );
}

function GitHistorySimpleSelect({
  value,
  displayValue,
  options,
  ariaLabel,
  menuClassName,
  triggerClassName,
  onChange,
}: {
  value: string;
  displayValue: string;
  options: ReadonlyArray<GitHistorySearchableOption>;
  ariaLabel: string;
  menuClassName: string;
  triggerClassName: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useOutsideDismiss({
    selectors: [
      {
        selector: `.git-history-filter-menu.${menuClassName}`,
        onDismiss: () => setOpen(false),
        anchorRefs: [anchorRef],
      },
    ],
  });

  return (
    <div className="git-history-searchable-select-anchor" ref={anchorRef}>
      <button
        type="button"
        className={`git-history-searchable-select-trigger ${triggerClassName}${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={displayValue}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{displayValue}</span>
        <ChevronDown size={14} />
      </button>
      <PopoverPortal open={open} anchorRef={anchorRef} placement="bottom-start" offset={8}>
        <div className={`workspace-menu git-history-filter-menu ${menuClassName}`} role="menu" aria-label={ariaLabel}>
          <div className="git-history-filter-menu-list compact">
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={`${menuClassName}-${option.value}`}
                  type="button"
                  className={`workspace-menu-item git-history-filter-menu-item${selected ? ' current' : ''}`}
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span>{option.label}</span>
                  {selected ? <Check size={15} /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverPortal>
    </div>
  );
}

function GitHistoryBranchSelect({
  collections,
  value,
  displayValue,
  ariaLabel,
  onChange,
}: {
  collections: ReturnType<typeof buildGitBranchCollections>;
  value: string;
  displayValue: string;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sections = useMemo(() => buildGitHistoryBranchSelectSections(collections, keyword), [collections, keyword]);

  useOutsideDismiss({
    selectors: [
      {
        selector: '.git-history-filter-menu.branch',
        onDismiss: () => {
          setOpen(false);
          setKeyword('');
        },
        anchorRefs: [anchorRef],
      },
    ],
  });

  useEffect(() => {
    if (!open) {
      setKeyword('');
      return;
    }
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  return (
    <div className="git-history-searchable-select-anchor" ref={anchorRef}>
      <button
        type="button"
        className={`git-history-searchable-select-trigger branch${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={displayValue}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{displayValue}</span>
        <ChevronDown size={14} />
      </button>
      <PopoverPortal open={open} anchorRef={anchorRef} placement="bottom-start" offset={8}>
        <div className="workspace-menu git-history-filter-menu branch" role="menu" aria-label={ariaLabel}>
          <label className="git-history-filter-menu-search">
            <Search size={14} />
            <input
              ref={inputRef}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索分支或标签"
            />
          </label>
          <div className="workspace-menu-divider" role="separator" />
          <div className="git-history-filter-menu-list">
            {sections.length === 0 ? <div className="git-history-filter-menu-empty">没有匹配的分支或标签</div> : null}
            {sections.map((section, sectionIndex) => (
              <div key={section.id} className="git-history-filter-menu-group">
                {sectionIndex > 0 ? <div className="workspace-menu-divider" role="separator" /> : null}
                <div className="workspace-menu-group-title">{section.label}</div>
                {section.options.map((option) => {
                  const selected = option.value === value;
                  return (
                    <button
                      key={`${section.id}-${option.value}`}
                      type="button"
                      className={`workspace-menu-item git-history-filter-menu-item${selected ? ' current' : ''}`}
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                        setKeyword('');
                      }}
                    >
                      <span>{option.label}</span>
                      {selected ? <Check size={15} /> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </PopoverPortal>
    </div>
  );
}

function readGitHistoryPaneWidths(projectId: string) {
  if (typeof window === 'undefined') {
    return {
      leftPaneWidth: DEFAULT_LEFT_PANE_WIDTH,
      rightPaneWidth: DEFAULT_RIGHT_PANE_WIDTH,
    };
  }
  try {
    const raw = window.localStorage.getItem(`codem:git-history-pane-widths:${projectId}`);
    if (!raw) {
      return {
        leftPaneWidth: DEFAULT_LEFT_PANE_WIDTH,
        rightPaneWidth: DEFAULT_RIGHT_PANE_WIDTH,
      };
    }
    const parsed = JSON.parse(raw) as { leftPaneWidth?: number; rightPaneWidth?: number };
    return {
      leftPaneWidth: Number.isFinite(parsed.leftPaneWidth) ? clamp(parsed.leftPaneWidth ?? DEFAULT_LEFT_PANE_WIDTH, MIN_LEFT_PANE_WIDTH, 480) : DEFAULT_LEFT_PANE_WIDTH,
      rightPaneWidth: Number.isFinite(parsed.rightPaneWidth) ? clamp(parsed.rightPaneWidth ?? DEFAULT_RIGHT_PANE_WIDTH, MIN_RIGHT_PANE_WIDTH, 640) : DEFAULT_RIGHT_PANE_WIDTH,
    };
  } catch {
    return {
      leftPaneWidth: DEFAULT_LEFT_PANE_WIDTH,
      rightPaneWidth: DEFAULT_RIGHT_PANE_WIDTH,
    };
  }
}

function writeGitHistoryPaneWidths(
  projectId: string,
  widths: { leftPaneWidth: number; rightPaneWidth: number },
) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(`codem:git-history-pane-widths:${projectId}`, JSON.stringify(widths));
  } catch {
    // ignore persistence failures
  }
}

function filterBranchCollections(
  collections: ReturnType<typeof buildGitBranchCollections>,
  currentBranch: string,
  keyword: string,
) {
  if (!keyword) {
    return {
      ...collections,
      headBranchVisible: true,
    };
  }

  const matches = (branch: GitBranchSummary) =>
    [branch.name, branch.localName ?? '', branch.remoteName ?? ''].some((value) => value.toLowerCase().includes(keyword));
  const localBranches = collections.localBranches.filter(matches);
  const remoteGroups = collections.remoteGroups
    .map((group) => ({
      ...group,
      branches: group.branches.filter(matches),
    }))
    .filter((group) => group.branches.length > 0 || group.name.toLowerCase().includes(keyword));
  const tagBranches = collections.tagBranches.filter(matches);
  const headBranchVisible = currentBranch.toLowerCase().includes(keyword);

  return {
    headBranch: collections.headBranch,
    headBranchVisible,
    localBranches,
    remoteGroups,
    tagBranches,
  };
}

function branchMatchesCurrent(branch: GitBranchSummary | null | undefined, currentBranch: string) {
  if (!branch || !currentBranch) {
    return false;
  }
  return branch.current || branch.name === currentBranch || branch.localName === currentBranch;
}

function suggestBranchName(branch: GitBranchSummary) {
  const source = branch.localName ?? branch.name;
  const leaf = source.split('/').filter(Boolean).at(-1) ?? 'branch';
  return `${leaf}-copy`;
}

function normalizeStatusClassName(status: string) {
  if (status.includes('新增')) {
    return 'added';
  }
  if (status.includes('删除')) {
    return 'deleted';
  }
  if (status.includes('重命名')) {
    return 'renamed';
  }
  return 'modified';
}

function formatFileStatusLabel(status: string) {
  if (status.includes('新增')) {
    return 'A';
  }
  if (status.includes('删除')) {
    return 'D';
  }
  if (status.includes('重命名')) {
    return 'R';
  }
  return 'M';
}

function getFileName(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}

function getFileDirectory(filePath: string) {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

function formatCommitTime(commitTime: number, full = false) {
  if (!commitTime) {
    return '';
  }
  const date = new Date(commitTime * 1000);
  return full ? date.toLocaleString() : date.toLocaleDateString();
}

function buildDefaultExpandedDirs(nodes: GitHistoryFileTreeNode[]) {
  const expanded: Record<string, boolean> = {};
  for (const node of nodes) {
    if (node.type === 'dir') {
      expanded[node.path] = true;
    }
  }
  return expanded;
}

function buildRefClassName(ref: string) {
  if (ref.includes('HEAD ->')) {
    return 'git-history-ref-badge head';
  }
  if (ref.startsWith('tag:')) {
    return 'git-history-ref-badge tag';
  }
  if (ref.includes('/')) {
    return 'git-history-ref-badge remote';
  }
  return 'git-history-ref-badge';
}

function formatGitHistoryDatePreset(preset: GitHistoryDatePreset) {
  if (preset === '24h') {
    return '过去 24 小时';
  }
  if (preset === '7d') {
    return '过去 7 天';
  }
  if (preset === '30d') {
    return '过去 30 天';
  }
  return '全部日期';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
