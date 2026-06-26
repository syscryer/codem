import { ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ConversationTurnView } from './ConversationTurn';
import { findLatestChangedFilesTurnId } from '../lib/conversation-changed-files';
import { resolveEmptyConversationCopy } from '../lib/new-chat-draft';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ConversationTurn,
  ProjectSummary,
  RequestUserInputRequest,
  RuntimeSuggestedAction,
  ThreadDetail,
  UndoConversationChange,
  WorkbenchPreviewRequest,
} from '../types';

const BOTTOM_ANCHOR_THRESHOLD_PX = 96;

type ConversationScrollPosition = {
  scrollTop: number;
  anchoredToBottom: boolean;
};

type ConversationPaneProps = {
  activeThread: ThreadDetail | null;
  isNewChatDraft: boolean;
  activeProject: ProjectSummary | null;
  activeProjectName?: string;
  collapseIntermediateProcess: boolean;
  clockNowMs: number;
  isRunning: boolean;
  activeTurnId: string;
  transcriptRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  undoneTurnIds: Record<string, boolean>;
  onOpenWorkbenchPreview: (request: WorkbenchPreviewRequest) => void;
  onOpenOutputPath: (path: string) => Promise<void>;
  onRevealOutputPath: (path: string) => Promise<void>;
  onUndoChangedFiles: (turn: ConversationTurn, changes: UndoConversationChange[]) => void;
  onSubmitRequestUserInput: (
    turn: ConversationTurn,
    request: RequestUserInputRequest,
    answers: Record<string, string>,
  ) => Promise<boolean>;
  onSubmitRuntimeRecoveryAction: (
    turn: ConversationTurn,
    action: RuntimeSuggestedAction,
  ) => Promise<boolean>;
  onSubmitApprovalDecision: (
    turn: ConversationTurn,
    request: ApprovalRequest,
    decision: ApprovalDecision,
  ) => Promise<boolean>;
};

function useLatestCallback<T extends (...args: never[]) => unknown>(callback: T): T {
  const callbackRef = useRef(callback);

  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  return useCallback(((...args: Parameters<T>) => callbackRef.current(...args)) as T, []);
}

export function ConversationPane({
  activeThread,
  isNewChatDraft,
  activeProject,
  activeProjectName,
  collapseIntermediateProcess,
  clockNowMs,
  isRunning,
  activeTurnId,
  transcriptRef,
  bottomRef,
  undoneTurnIds,
  onOpenWorkbenchPreview,
  onOpenOutputPath,
  onRevealOutputPath,
  onUndoChangedFiles,
  onSubmitRequestUserInput,
  onSubmitRuntimeRecoveryAction,
  onSubmitApprovalDecision,
}: ConversationPaneProps) {
  const [showBottomAnchor, setShowBottomAnchor] = useState(false);
  const shouldAutoFollowRef = useRef(true);
  const previousThreadIdRef = useRef<string | null>(null);
  const scrollPositionsByThreadIdRef = useRef<Map<string, ConversationScrollPosition>>(new Map());
  const latestChangedFilesTurnId = activeThread ? findLatestChangedFilesTurnId(activeThread.turns) : null;
  const stableOpenWorkbenchPreview = useLatestCallback(onOpenWorkbenchPreview);
  const stableOpenOutputPath = useLatestCallback(onOpenOutputPath);
  const stableRevealOutputPath = useLatestCallback(onRevealOutputPath);
  const stableUndoChangedFiles = useLatestCallback(onUndoChangedFiles);
  const stableSubmitRequestUserInput = useLatestCallback(onSubmitRequestUserInput);
  const stableSubmitRuntimeRecoveryAction = useLatestCallback(onSubmitRuntimeRecoveryAction);
  const stableSubmitApprovalDecision = useLatestCallback(onSubmitApprovalDecision);

  function syncBottomAnchorVisibility() {
    const transcript = transcriptRef.current;
    if (!transcript) {
      setShowBottomAnchor(false);
      return;
    }

    const distanceToBottom =
      transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    const anchoredToBottom = distanceToBottom <= BOTTOM_ANCHOR_THRESHOLD_PX;
    if (activeThread?.id) {
      scrollPositionsByThreadIdRef.current.set(activeThread.id, {
        scrollTop: transcript.scrollTop,
        anchoredToBottom,
      });
    }
    shouldAutoFollowRef.current = anchoredToBottom;
    setShowBottomAnchor(
      Boolean(activeThread?.turns.length) && distanceToBottom > BOTTOM_ANCHOR_THRESHOLD_PX,
    );
  }

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) {
      setShowBottomAnchor(false);
      return undefined;
    }

    syncBottomAnchorVisibility();
    transcript.addEventListener('scroll', syncBottomAnchorVisibility, { passive: true });
    window.addEventListener('resize', syncBottomAnchorVisibility);

    return () => {
      transcript.removeEventListener('scroll', syncBottomAnchorVisibility);
      window.removeEventListener('resize', syncBottomAnchorVisibility);
    };
  }, [activeThread?.id, activeThread?.turns.length, transcriptRef]);

  useLayoutEffect(() => {
    const threadId = activeThread?.id ?? null;
    const threadChanged = previousThreadIdRef.current !== threadId;
    previousThreadIdRef.current = threadId;

    if (threadChanged && threadId && activeThread?.historyLoaded) {
      const savedPosition = scrollPositionsByThreadIdRef.current.get(threadId);
      if (savedPosition) {
        const frame = requestAnimationFrame(() => {
          const transcript = transcriptRef.current;
          if (!transcript) {
            return;
          }

          const maxScrollTop = Math.max(0, transcript.scrollHeight - transcript.clientHeight);
          transcript.scrollTop = savedPosition.anchoredToBottom
            ? maxScrollTop
            : Math.min(savedPosition.scrollTop, maxScrollTop);
          syncBottomAnchorVisibility();
        });

        return () => cancelAnimationFrame(frame);
      }
    }

    if (threadChanged) {
      shouldAutoFollowRef.current = true;
    }

    if (!threadChanged && !shouldAutoFollowRef.current) {
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      const transcript = transcriptRef.current;
      if (transcript) {
        transcript.scrollTop = transcript.scrollHeight;
      } else {
        bottomRef.current?.scrollIntoView({ block: 'end' });
      }
      setShowBottomAnchor(false);
      shouldAutoFollowRef.current = true;
    });

    return () => cancelAnimationFrame(frame);
  }, [activeThread?.id, activeThread?.turns, activeThread?.historyLoaded, bottomRef]);

  useLayoutEffect(() => {
    if (shouldAutoFollowRef.current) {
      return undefined;
    }

    const frame = requestAnimationFrame(syncBottomAnchorVisibility);
    return () => cancelAnimationFrame(frame);
  }, [activeThread?.turns, activeThread?.historyLoaded]);

  function handleScrollToBottom() {
    shouldAutoFollowRef.current = true;
    setShowBottomAnchor(false);
    bottomRef.current?.scrollIntoView({
      block: 'end',
      behavior: 'smooth',
    });
  }

  const emptyConversationCopy = activeThread?.turns.length === 0
    ? resolveEmptyConversationCopy({
        threadTitle: activeThread.title,
        activeProjectName,
      })
    : null;

  return (
    <div className="conversation-shell">
      <section className="conversation" ref={transcriptRef}>
        {!activeThread && isNewChatDraft ? (
          <div className="empty-state">
            <h3>{activeProjectName ? `在「${activeProjectName}」中创建会话` : '创建新会话'}</h3>
            <p>第一句话会落进当前项目，新的会话会从这里自然展开。</p>
          </div>
        ) : !activeThread ? (
          <div className="empty-state">
            <h3>从左侧选择一个项目或聊天</h3>
            <p>CodeM 会导入 Claude Code 本地 session，并把它们组织到项目工作区下面。</p>
          </div>
        ) : activeThread.historyLoading && activeThread.turns.length === 0 ? (
          <div className="empty-state">
            <h3>正在加载聊天历史</h3>
            <p>历史消息读取完成后会显示在这里。</p>
          </div>
        ) : activeThread.turns.length === 0 ? (
          <div className="empty-state">
            <h3>{emptyConversationCopy?.title}</h3>
            <p>{emptyConversationCopy?.description}</p>
          </div>
        ) : (
          activeThread.turns.map((turn, index) => (
            <ConversationTurnView
              key={turn.id}
              turn={turn}
              nowMs={isRunning && turn.id === activeTurnId ? clockNowMs : 0}
              isLiveRunning={isRunning && turn.id === activeTurnId}
              isLatest={index === activeThread.turns.length - 1}
              previousTurns={activeThread.turns.slice(0, index)}
              canUndoChangedFiles={turn.id === latestChangedFilesTurnId && undoneTurnIds[turn.id] !== true}
              activeProject={activeProject}
              collapseIntermediateProcess={collapseIntermediateProcess}
              onOpenWorkbenchPreview={stableOpenWorkbenchPreview}
              onOpenOutputPath={stableOpenOutputPath}
              onRevealOutputPath={stableRevealOutputPath}
              onUndoChangedFiles={stableUndoChangedFiles}
              onSubmitRequestUserInput={stableSubmitRequestUserInput}
              onSubmitRuntimeRecoveryAction={stableSubmitRuntimeRecoveryAction}
              onSubmitApprovalDecision={stableSubmitApprovalDecision}
            />
          ))
        )}
        <div ref={bottomRef} />
      </section>
      {showBottomAnchor ? (
        <div className="conversation-anchor-layer">
          <button
            type="button"
            className="conversation-bottom-anchor"
            aria-label="滚动到底部"
            title="到底部"
            onClick={handleScrollToBottom}
          >
            <ArrowDown size={16} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
