import { ArrowDown } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';
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

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) {
      setShowBottomAnchor(false);
      return undefined;
    }

    const syncAnchorVisibility = () => {
      const distanceToBottom =
        transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
      setShowBottomAnchor(
        Boolean(activeThread?.turns.length) && distanceToBottom > BOTTOM_ANCHOR_THRESHOLD_PX,
      );
    };

    syncAnchorVisibility();
    transcript.addEventListener('scroll', syncAnchorVisibility, { passive: true });
    window.addEventListener('resize', syncAnchorVisibility);

    return () => {
      transcript.removeEventListener('scroll', syncAnchorVisibility);
      window.removeEventListener('resize', syncAnchorVisibility);
    };
  }, [activeThread?.id, activeThread?.turns, transcriptRef]);

  function handleScrollToBottom() {
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
