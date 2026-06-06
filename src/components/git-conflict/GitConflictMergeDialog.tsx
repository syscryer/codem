import {
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronsLeftRight,
  LoaderCircle,
  Save,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type RefObject, type UIEvent } from 'react';

import {
  fetchGitConflictFile,
  markGitConflictResolved,
  saveGitConflictResult,
} from '../../lib/git-api';
import {
  buildConflictResolutionContent,
  buildConflictEditorLines,
  buildConflictSideLineMetadata,
  detectConflictBlocks,
  tokenizeCodeLine,
} from '../../lib/git-conflict-resolution';
import type { ConflictSideLineMetadata } from '../../lib/git-conflict-resolution';
import type { GitConflictFileDetail } from '../../types';

type GitConflictMergeDialogProps = {
  open: boolean;
  projectId: string;
  filePath: string;
  onClose: () => void;
  onResolved: () => Promise<void> | void;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

export function GitConflictMergeDialog({
  open,
  projectId,
  filePath,
  onClose,
  onResolved,
  showToast,
}: GitConflictMergeDialogProps) {
  const [detail, setDetail] = useState<GitConflictFileDetail | null>(null);
  const [resultContent, setResultContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [workingAction, setWorkingAction] = useState('');
  const [syncScroll, setSyncScroll] = useState(true);
  const [inlineStatus, setInlineStatus] = useState('');
  const leftScrollRef = useRef<HTMLDivElement | null>(null);
  const resultScrollRef = useRef<HTMLTextAreaElement | null>(null);
  const rightScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingScrollRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const showToastRef = useRef(showToast);

  onCloseRef.current = onClose;
  showToastRef.current = showToast;

  const currentLines = useMemo(() => buildConflictEditorLines(detail?.currentContent ?? ''), [detail?.currentContent]);
  const incomingLines = useMemo(() => buildConflictEditorLines(detail?.incomingContent ?? ''), [detail?.incomingContent]);
  const resultLines = useMemo(() => buildConflictEditorLines(resultContent), [resultContent]);
  const conflictBlocks = useMemo(() => detectConflictBlocks(resultContent), [resultContent]);
  const currentLineMetadata = useMemo(
    () => buildConflictSideLineMetadata(detail?.currentContent ?? '', conflictBlocks, 'current'),
    [conflictBlocks, detail?.currentContent],
  );
  const incomingLineMetadata = useMemo(
    () => buildConflictSideLineMetadata(detail?.incomingContent ?? '', conflictBlocks, 'incoming'),
    [conflictBlocks, detail?.incomingContent],
  );
  const activeConflictBlockIndexRef = useRef(0);
  const conflictSummary = conflictBlocks.length > 0
    ? `${conflictBlocks.length} 个冲突待处理`
    : '结果中没有冲突标记';
  const conflictLineNumbers = useMemo(() => {
    const next = new Set<number>();
    conflictBlocks.forEach((block) => {
      for (let lineNumber = block.startLine; lineNumber <= block.endLine; lineNumber += 1) {
        next.add(lineNumber);
      }
    });
    return next;
  }, [conflictBlocks]);

  useEffect(() => {
    if (!open || !filePath) {
      setDetail(null);
      setResultContent('');
      setInlineStatus('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchGitConflictFile(projectId, filePath)
      .then((nextDetail) => {
        if (!cancelled) {
          setDetail(nextDetail);
          setResultContent(nextDetail.resultContent);
          setInlineStatus('');
        }
      })
      .catch((caughtError: unknown) => {
        if (!cancelled) {
          showToastRef.current(caughtError instanceof Error ? caughtError.message : '读取冲突文件失败', 'error');
          onCloseRef.current();
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, open, projectId]);

  if (!open) {
    return null;
  }

  function acceptChoice(choice: 'current' | 'incoming' | 'both') {
    if (!detail) {
      return;
    }
    setInlineStatus('');

    if (choice === 'both') {
      setResultContent(buildConflictResolutionContent(detail, 'both'));
      return;
    }

    setResultContent(buildConflictResolutionContent(detail, choice));
  }

  async function runAction(action: string, callback: () => Promise<void>) {
    if (!detail) {
      return;
    }

    setWorkingAction(action);
    try {
      await callback();
    } catch (caughtError) {
      showToast(caughtError instanceof Error ? caughtError.message : '保存冲突结果失败', 'error');
    } finally {
      setWorkingAction('');
    }
  }

  async function saveResult() {
    await runAction('save', async () => {
      const nextDetail = await saveGitConflictResult(projectId, filePath, resultContent);
      setDetail(nextDetail);
      setResultContent(nextDetail.resultContent);
      setInlineStatus('冲突结果已保存');
    });
  }

  async function saveAndMarkResolved() {
    if (conflictBlocks.length > 0) {
      showToast('请先解决所有冲突标记。可以先保存结果作为草稿，但不能标记为已解决。', 'error');
      return;
    }

    await runAction('resolve', async () => {
      await saveGitConflictResult(projectId, filePath, resultContent);
      await markGitConflictResolved(projectId, filePath);
      await Promise.resolve(onResolved());
      onClose();
    });
  }

  function handleSynchronizedScroll(source: 'left' | 'result' | 'right', scrollTop: number) {
    if (!syncScroll || syncingScrollRef.current) {
      return;
    }

    const sourceElement = getScrollElement(source);
    if (!sourceElement) {
      return;
    }

    const maxSourceScroll = sourceElement.scrollHeight - sourceElement.clientHeight;
    const scrollRatio = maxSourceScroll > 0 ? scrollTop / maxSourceScroll : 0;
    syncingScrollRef.current = true;

    for (const target of ['left', 'result', 'right'] as const) {
      if (target === source) {
        continue;
      }
      const targetElement = getScrollElement(target);
      if (!targetElement) {
        continue;
      }
      const maxTargetScroll = targetElement.scrollHeight - targetElement.clientHeight;
      targetElement.scrollTop = maxTargetScroll > 0 ? maxTargetScroll * scrollRatio : 0;
    }

    window.requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  }

  function getScrollElement(source: 'left' | 'result' | 'right') {
    if (source === 'left') {
      return leftScrollRef.current;
    }
    if (source === 'right') {
      return rightScrollRef.current;
    }
    return resultScrollRef.current;
  }

  function goToConflictBlock(direction: 'previous' | 'next') {
    if (conflictBlocks.length === 0 || !resultScrollRef.current) {
      return;
    }

    const currentIndex = activeConflictBlockIndexRef.current;
    const nextIndex = direction === 'next'
      ? Math.min(currentIndex + 1, conflictBlocks.length - 1)
      : Math.max(currentIndex - 1, 0);
    const nextBlock = conflictBlocks[nextIndex];
    activeConflictBlockIndexRef.current = nextIndex;

    const lineHeight = parseFloat(window.getComputedStyle(resultScrollRef.current).lineHeight) || 20;
    const nextScrollTop = Math.max(0, (nextBlock.startLine - 2) * lineHeight);
    resultScrollRef.current.scrollTo({ top: nextScrollTop, behavior: 'smooth' });
    handleSynchronizedScroll('result', nextScrollTop);
  }

  return (
    <div className="dialog-backdrop git-conflict-dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        className="dialog-card git-conflict-merge-dialog idea-merge-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Git 合并编辑器"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="idea-merge-titlebar">
          <div className="idea-merge-titlemark" aria-hidden="true">M</div>
          <div className="idea-merge-titlecopy">
            <h3>合并 {filePath} 的修订</h3>
            <span>{detail?.label ?? '正在读取冲突内容。'}</span>
          </div>
          <button type="button" className="idea-merge-window-button" disabled={Boolean(workingAction)} onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </div>

        {loading ? (
          <div className="git-conflict-merge-loading idea">
            <LoaderCircle className="spin" size={16} />
            正在读取冲突内容...
          </div>
        ) : detail ? (
          <>
            <div className="idea-merge-toolbar" role="toolbar" aria-label="合并工具栏">
              <div className="idea-merge-toolbar-group">
                <button
                  type="button"
                  className={`idea-merge-icon-button${syncScroll ? ' active' : ''}`}
                  aria-pressed={syncScroll}
                  aria-label={syncScroll ? '关闭同步滚动' : '开启同步滚动'}
                  title={syncScroll ? '关闭同步滚动' : '开启同步滚动'}
                  onClick={() => setSyncScroll((current) => !current)}
                >
                  <ArrowLeftRight size={15} />
                </button>
                <button
                  type="button"
                  className="idea-merge-icon-button"
                  aria-label="上一个冲突"
                  title="上一个冲突"
                  disabled={conflictBlocks.length === 0}
                  onClick={() => goToConflictBlock('previous')}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  className="idea-merge-icon-button"
                  aria-label="下一个冲突"
                  title="下一个冲突"
                  disabled={conflictBlocks.length === 0}
                  onClick={() => goToConflictBlock('next')}
                >
                  <ArrowDown size={15} />
                </button>
              </div>
              <div className="idea-merge-spacer" />
              <strong className="idea-merge-summary">{conflictSummary}</strong>
            </div>

            <div className="idea-merge-workspace git-conflict-merge-grid" aria-label="三方合并编辑器">
              <IdeaMergePane
                side="left"
                title={`来自 ${detail.path}`}
                subtitle="当前"
                lines={currentLines}
                actionLabel="接受左侧"
                onAccept={() => acceptChoice('current')}
                disabled={Boolean(workingAction)}
                scrollRef={leftScrollRef}
                lineMetadata={currentLineMetadata}
                onScroll={(scrollTop) => handleSynchronizedScroll('left', scrollTop)}
              />
              <IdeaMergeResultPane
                filePath={filePath}
                lines={resultLines}
                conflictLineNumbers={conflictLineNumbers}
                resultContent={resultContent}
                onChange={(nextContent) => {
                  setResultContent(nextContent);
                  setInlineStatus('');
                }}
                scrollRef={resultScrollRef}
                onScroll={(scrollTop) => handleSynchronizedScroll('result', scrollTop)}
              />
              <IdeaMergePane
                side="right"
                title={`来自 ${detail.path}`}
                subtitle="传入"
                lines={incomingLines}
                actionLabel="接受右侧"
                onAccept={() => acceptChoice('incoming')}
                disabled={Boolean(workingAction)}
                scrollRef={rightScrollRef}
                lineMetadata={incomingLineMetadata}
                onScroll={(scrollTop) => handleSynchronizedScroll('right', scrollTop)}
              />
            </div>

            <div className="idea-merge-footer">
              <div className="idea-merge-footer-left">
                <button type="button" className="idea-merge-footer-button" disabled={Boolean(workingAction)} onClick={() => acceptChoice('current')}>
                  接受左侧
                </button>
                <button type="button" className="idea-merge-footer-button" disabled={Boolean(workingAction)} onClick={() => acceptChoice('incoming')}>
                  接受右侧
                </button>
                <button type="button" className="idea-merge-footer-button" disabled={Boolean(workingAction)} onClick={() => acceptChoice('both')}>
                  <ChevronsLeftRight size={14} />
                  接受双方
                </button>
              </div>
              <div className="idea-merge-footer-right">
                {inlineStatus ? <span className="git-conflict-inline-status">{inlineStatus}</span> : null}
                <button type="button" className="idea-merge-footer-button" disabled={Boolean(workingAction)} onClick={() => void saveResult()}>
                  {workingAction === 'save' ? <LoaderCircle className="spin" size={13} /> : <Save size={13} />}
                  保存结果
                </button>
                <button type="button" className="idea-merge-apply-button" disabled={Boolean(workingAction)} onClick={() => void saveAndMarkResolved()}>
                  {workingAction === 'resolve' ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}
                  保存并标记解决
                </button>
                <button type="button" className="idea-merge-cancel-button" disabled={Boolean(workingAction)} onClick={onClose}>
                  取消
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="git-conflict-merge-loading idea">选择冲突文件查看详情。</div>
        )}
      </section>
    </div>
  );
}

function IdeaMergePane({
  side,
  title,
  subtitle,
  lines,
  actionLabel,
  onAccept,
  disabled,
  scrollRef,
  lineMetadata,
  onScroll,
}: {
  side: 'left' | 'right';
  title: string;
  subtitle: string;
  lines: Array<{ lineNumber: number; text: string }>;
  actionLabel: string;
  onAccept: () => void;
  disabled: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  lineMetadata: Map<number, ConflictSideLineMetadata>;
  onScroll: (scrollTop: number) => void;
}) {
  return (
    <section className={`idea-merge-pane git-conflict-merge-pane ${side}`}>
      <div className="idea-merge-pane-head">
        <div>
          <span>{title}</span>
          <strong>{subtitle}</strong>
        </div>
        <button type="button" className="idea-merge-inline-action" disabled={disabled} onClick={onAccept}>
          {side === 'left' ? <ArrowRight size={14} /> : <ArrowLeft size={14} />}
          {actionLabel}
        </button>
      </div>
      <div ref={scrollRef} className="idea-merge-code" role="table" aria-label={title} onScroll={(event) => onScroll(event.currentTarget.scrollTop)}>
        {lines.map((line) => (
          <div
            key={`${side}-${line.lineNumber}-${line.text}`}
            className={`idea-merge-code-line${lineMetadata.get(line.lineNumber)?.conflict ? ' conflict' : ''}`}
            role="row"
          >
            <span className="idea-merge-line-number" role="cell">{line.lineNumber}</span>
            <code role="cell">
              {tokenizeCodeLine(line.text).map((token, tokenIndex) => (
                <span
                  key={`${line.lineNumber}-${tokenIndex}-${token.text}`}
                  className={`idea-merge-code-token ${token.kind}`}
                >
                  {token.text}
                </span>
              ))}
            </code>
          </div>
        ))}
      </div>
    </section>
  );
}

function IdeaMergeResultPane({
  filePath,
  lines,
  conflictLineNumbers,
  resultContent,
  onChange,
  scrollRef,
  onScroll,
}: {
  filePath: string;
  lines: Array<{ lineNumber: number; text: string }>;
  conflictLineNumbers: Set<number>;
  resultContent: string;
  onChange: (content: string) => void;
  scrollRef: RefObject<HTMLTextAreaElement | null>;
  onScroll: (scrollTop: number) => void;
}) {
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  function handleResultScroll(event: UIEvent<HTMLTextAreaElement>) {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = event.currentTarget.scrollTop;
    }
    if (highlightRef.current) {
      highlightRef.current.scrollTop = event.currentTarget.scrollTop;
    }
    onScroll(event.currentTarget.scrollTop);
  }

  return (
    <section className="idea-merge-pane git-conflict-merge-pane idea-merge-result">
      <div className="idea-merge-pane-head center">
        <div>
          <span>结果可直接编辑</span>
          <strong>{filePath}</strong>
        </div>
      </div>
      <div className="idea-merge-result-editor git-conflict-result-editor">
        <div ref={highlightRef} className="idea-merge-result-highlights" aria-hidden="true">
          {lines.map((line) => (
            <div
              key={`result-highlight-${line.lineNumber}`}
              className={`idea-merge-result-highlight-line${conflictLineNumbers.has(line.lineNumber) ? ' conflict' : ''}`}
            />
          ))}
        </div>
        <div ref={gutterRef} className="idea-merge-result-gutter" aria-hidden="true">
          {lines.map((line) => (
            <div
              key={`result-gutter-${line.lineNumber}`}
              className="idea-merge-result-line-number"
            >
              {line.lineNumber}
            </div>
          ))}
        </div>
        <textarea
          ref={scrollRef}
          className="idea-merge-result-textarea"
          aria-label="Result"
          spellCheck={false}
          value={resultContent}
          onScroll={handleResultScroll}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </section>
  );
}
