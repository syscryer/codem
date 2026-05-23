import {
  ArrowDown,
  ArrowUp,
  Link2,
  RotateCcw,
  Rows3,
  Unlink2,
  type LucideIcon,
} from 'lucide-react';
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  buildWorkbenchChangeMarkers,
  buildWorkbenchFullDiffRows,
  buildWorkbenchSplitDiffRows,
  collapseWorkbenchContextRows,
  findWorkbenchChangeBlockIndices,
  resolveWorkbenchChangeScrollTop,
  type WorkbenchSplitDiffRow,
} from '../lib/workbench-diff';
import { highlightWorkbenchCodeLine } from '../lib/workbench-files';
import { getWorkbenchVisibleLineRange, WORKBENCH_CODE_LINE_HEIGHT } from '../lib/workbench-code-preview';
import { clampWorkbenchSplitPaneWidthPercent } from '../lib/workbench-layout';

export type GitDiffViewerMode = 'unified' | 'split' | 'full';

type GitDiffViewerProps = {
  content: string;
  beforeContent?: string;
  afterContent?: string;
  filePath: string;
  viewMode: GitDiffViewerMode;
  onViewModeChange: (viewMode: GitDiffViewerMode) => void;
  className?: string;
  toolbarContainer?: HTMLElement | null;
  toolbarExtras?: ReactNode;
};

export function GitDiffViewer({
  content,
  beforeContent,
  afterContent,
  filePath,
  viewMode,
  onViewModeChange,
  className = '',
  toolbarContainer = null,
  toolbarExtras = null,
}: GitDiffViewerProps) {
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
    () => (collapseUnchanged ? collapseWorkbenchContextRows(baseRows) : baseRows),
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
  const isSplitView = viewMode === 'split' || viewMode === 'full';
  const toolbar = (
    <div className={`git-diff-toolbar${toolbarContainer ? ' docked' : ''}`} role="toolbar" aria-label="对比工具">
      <div className="git-diff-toolbar-group" role="tablist" aria-label="视图切换">
        <ToolbarButton active={viewMode === 'split'} ariaSelected={viewMode === 'split'} onClick={() => onViewModeChange('split')}>
          左右
        </ToolbarButton>
        <ToolbarButton
          active={viewMode === 'full'}
          ariaSelected={viewMode === 'full'}
          disabled={!canUseFullView}
          onClick={() => onViewModeChange('full')}
        >
          全文
        </ToolbarButton>
        <ToolbarButton active={viewMode === 'unified'} ariaSelected={viewMode === 'unified'} onClick={() => onViewModeChange('unified')}>
          统一
        </ToolbarButton>
      </div>
      <div className="git-diff-toolbar-group">
        <ToolbarIcon icon={ArrowUp} title="上一处变更" disabled={!isSplitView || changeRowIndices.length === 0} onClick={() => moveToChange(-1)} />
        <ToolbarIcon icon={ArrowDown} title="下一处变更" disabled={!isSplitView || changeRowIndices.length === 0} onClick={() => moveToChange(1)} />
        <ToolbarIcon
          icon={Rows3}
          active={collapseUnchanged}
          disabled={!isSplitView}
          title="折叠未修改"
          onClick={() => setCollapseUnchanged((current) => !current)}
        />
        <ToolbarIcon icon={RotateCcw} title="重置" disabled={!isSplitView} onClick={() => setSplitLeftWidth(50)} />
        <ToolbarIcon
          icon={syncScroll ? Link2 : Unlink2}
          active={syncScroll}
          disabled={!isSplitView}
          title={syncScroll ? '关闭同步滚动' : '开启同步滚动'}
          onClick={() => setSyncScroll((current) => !current)}
        />
      </div>
      {toolbarExtras ? <div className="git-diff-toolbar-group">{toolbarExtras}</div> : null}
    </div>
  );
  const toolbarPortal = toolbarContainer ? createPortal(toolbar, toolbarContainer) : null;

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
      <div className={`workbench-code-preview workbench-diff-content split ${className}`.trim()} role="region" aria-label="变更预览">
        <div
          ref={splitSurfaceRef}
          className="git-diff-split-surface"
          style={{ '--workbench-diff-split-left-width': `${splitLeftWidth}%` } as CSSProperties}
        >
          {toolbarPortal ?? toolbar}
          <div className="git-diff-split-grid">
            <div className="git-diff-split-pane-shell left">
              <div ref={leftPaneRef} className="git-diff-split-pane left">
                <div className="git-diff-virtual-spacer" style={{ height: `${totalRowsHeight}px` }}>
                  <div
                    className="git-diff-virtual-window"
                    style={{ transform: `translateY(${leftVisibleRange.start * WORKBENCH_CODE_LINE_HEIGHT}px)` }}
                  >
                    {leftVisibleRows.map((row, visibleIndex) => {
                      const rowIndex = leftVisibleRange.start + visibleIndex;
                      return (
                        <GitSplitDiffPaneRow
                          key={`left-${rowIndex}-${buildDiffRowKey(row)}`}
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
                <div className="git-diff-virtual-spacer" style={{ height: `${totalRowsHeight}px` }}>
                  <div
                    className="git-diff-virtual-window"
                    style={{ transform: `translateY(${rightVisibleRange.start * WORKBENCH_CODE_LINE_HEIGHT}px)` }}
                  >
                    {rightVisibleRows.map((row, visibleIndex) => {
                      const rowIndex = rightVisibleRange.start + visibleIndex;
                      return (
                        <GitSplitDiffPaneRow
                          key={`right-${rowIndex}-${buildDiffRowKey(row)}`}
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
    <div className={`workbench-code-preview workbench-diff-content ${className}`.trim()} role="region" aria-label="变更预览">
      {toolbarPortal}
      {lines.map((line, index) => (
        <div key={`${index}-${line}`} className={`git-diff-line ${getDiffLineClass(line)}`}>
          <span className="git-diff-line-no">{index + 1}</span>
          <span className="git-diff-line-text">{renderUnifiedDiffLineContent(line, filePath)}</span>
        </div>
      ))}
    </div>
  );
}

function ToolbarButton({
  active,
  ariaSelected,
  disabled = false,
  onClick,
  children,
}: {
  active: boolean;
  ariaSelected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`git-diff-toolbar-button${active ? ' active' : ''}`}
      role="tab"
      aria-selected={ariaSelected}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ToolbarIcon({
  icon: Icon,
  title,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`git-diff-toolbar-icon${active ? ' active' : ''}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={14} />
    </button>
  );
}

function buildDiffRowKey(row: WorkbenchSplitDiffRow) {
  if (row.type === 'content') {
    return `${row.leftLineNumber}-${row.rightLineNumber}`;
  }
  if (row.type === 'collapsed') {
    return `collapsed-${row.hiddenCount}`;
  }
  return row.text;
}

function getDiffLineClass(line: string) {
  if (line.startsWith('+')) {
    return 'added';
  }
  if (line.startsWith('-')) {
    return 'removed';
  }
  if (line.startsWith('@@')) {
    return 'hunk';
  }
  return '';
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

export const MemoGitDiffViewer = memo(GitDiffViewer);
