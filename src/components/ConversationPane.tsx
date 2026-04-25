import { ArrowDown } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ConversationTurnView } from './ConversationTurn';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ConversationTurn,
  RequestUserInputRequest,
  RuntimeSuggestedAction,
  ThreadDetail,
} from '../types';

const BOTTOM_ANCHOR_THRESHOLD_PX = 96;

type ConversationPaneProps = {
  activeThread: ThreadDetail | null;
  clockNowMs: number;
  isRunning: boolean;
  activeTurnId: string;
  transcriptRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
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

export function ConversationPane({
  activeThread,
  clockNowMs,
  isRunning,
  activeTurnId,
  transcriptRef,
  bottomRef,
  onSubmitRequestUserInput,
  onSubmitRuntimeRecoveryAction,
  onSubmitApprovalDecision,
}: ConversationPaneProps) {
  const [showBottomAnchor, setShowBottomAnchor] = useState(false);
  const shouldAutoFollowRef = useRef(true);
  const previousThreadIdRef = useRef<string | null>(null);

  function syncBottomAnchorVisibility() {
    const transcript = transcriptRef.current;
    if (!transcript) {
      setShowBottomAnchor(false);
      return;
    }

    const distanceToBottom =
      transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    shouldAutoFollowRef.current = distanceToBottom <= BOTTOM_ANCHOR_THRESHOLD_PX;
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
    const threadChanged = previousThreadIdRef.current !== activeThread?.id;
    previousThreadIdRef.current = activeThread?.id ?? null;

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

  return (
    <div className="conversation-shell">
      <section className="conversation" ref={transcriptRef}>
        {!activeThread ? (
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
            <h3>开始一次 Claude Code 会话</h3>
            <p>输入需求后，Claude 的正文会连续显示，工具调用会以轻量步骤内嵌在回答中。</p>
          </div>
        ) : (
          activeThread.turns.map((turn, index) => (
            <ConversationTurnView
              key={turn.id}
              turn={turn}
              nowMs={clockNowMs}
              isLiveRunning={isRunning && turn.id === activeTurnId}
              isLatest={index === activeThread.turns.length - 1}
              onSubmitRequestUserInput={onSubmitRequestUserInput}
              onSubmitRuntimeRecoveryAction={onSubmitRuntimeRecoveryAction}
              onSubmitApprovalDecision={onSubmitApprovalDecision}
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
            <ArrowDown size={24} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
