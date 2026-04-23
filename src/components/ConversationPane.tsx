import type { RefObject } from 'react';
import { ConversationTurnView } from './ConversationTurn';
import type { ThreadDetail } from '../types';

type ConversationPaneProps = {
  activeThread: ThreadDetail | null;
  clockNowMs: number;
  isRunning: boolean;
  activeTurnId: string;
  transcriptRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
};

export function ConversationPane({
  activeThread,
  clockNowMs,
  isRunning,
  activeTurnId,
  transcriptRef,
  bottomRef,
}: ConversationPaneProps) {
  return (
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
          />
        ))
      )}
      <div ref={bottomRef} />
    </section>
  );
}
