import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  formatDuration,
  hasTurnVisibleOutput,
  shouldHideToolStep,
  summarizeToolRow,
} from '../lib/conversation';
import type { ConversationTurn, ToolStep } from '../types';

export function ConversationTurnView({
  turn,
  nowMs,
  isLiveRunning,
}: {
  turn: ConversationTurn;
  nowMs: number;
  isLiveRunning: boolean;
}) {
  const visibleItems = turn.items.filter((item) => item.type === 'text' || !shouldHideToolStep(item.tool));
  const running = isTurnInFlight(turn, isLiveRunning);
  const showProgressLine =
    running ||
    turn.status === 'stopped' ||
    turn.status === 'error' ||
    Boolean(turn.durationMs || turn.outputTokens || turn.inputTokens);

  return (
    <article className="turn">
      <section className="message user-message">
        <div className="message-label">You</div>
        <div className="message-body preserve-format">{turn.userText}</div>
      </section>

      <section className="message assistant-message">
        <div className="message-label">Claude</div>
        <div className="assistant-content">
          {visibleItems.length > 0 ? (
            visibleItems.map((item) =>
              item.type === 'text' ? (
                <MarkdownMessage key={item.id} content={item.text} />
              ) : (
                <ToolStepRow key={item.id} tool={item.tool} />
              ),
            )
          ) : (
            running ? (
              <TurnProgressLine turn={turn} nowMs={nowMs} isLiveRunning={isLiveRunning} />
            ) : null
          )}

          {visibleItems.length > 0 && running ? (
            <TurnProgressLine turn={turn} nowMs={nowMs} isLiveRunning={isLiveRunning} compact />
          ) : null}

          {showProgressLine && !running ? (
            <TurnProgressLine turn={turn} nowMs={nowMs} isLiveRunning={isLiveRunning} compact />
          ) : null}
          {!showProgressLine && turn.metrics ? <div className="turn-metrics">{turn.metrics}</div> : null}
          {turn.status === 'error' && turn.activity ? (
            <div className={`turn-status ${turn.status}`}>{turn.activity}</div>
          ) : null}
        </div>
      </section>
    </article>
  );
}

function TurnProgressLine({
  turn,
  nowMs,
  isLiveRunning,
  compact = false,
}: {
  turn: ConversationTurn;
  nowMs: number;
  isLiveRunning: boolean;
  compact?: boolean;
}) {
  const running = isTurnInFlight(turn, isLiveRunning);
  const text = formatTurnProgress(turn, running ? nowMs : undefined, isLiveRunning);

  return (
    <div className={`working-line tui-progress ${compact ? 'compact' : ''}`}>
      <span className={`activity-dot ${running ? 'pulse' : ''}`} />
      <span>{text}</span>
    </div>
  );
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="message-body markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function ToolStepRow({ tool }: { tool: ToolStep }) {
  const hasDetails = Boolean(tool.inputText?.trim() || tool.resultText?.trim());
  const summary = summarizeToolRow(tool);

  return (
    <div className={`tool-step tool-${tool.status}`}>
      <div className="tool-step-main">
        <span className="tool-status-dot" />
        <div>
          <div className="tool-title">{tool.title}</div>
          {summary ? <div className="tool-subtitle">{summary}</div> : null}
        </div>
      </div>

      {hasDetails ? (
        <details className="tool-details">
          <summary>查看详情</summary>
          {tool.inputText?.trim() ? (
            <>
              <h4>参数</h4>
              <pre>{tool.inputText}</pre>
            </>
          ) : null}
          {tool.resultText?.trim() ? (
            <>
              <h4>结果</h4>
              <pre>{tool.resultText}</pre>
            </>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

function formatTurnProgress(turn: ConversationTurn, nowMs?: number, isLiveRunning = false) {
  if (turn.status === 'stopped') {
    return 'Stopped';
  }

  if (turn.status === 'error') {
    return 'Error';
  }

  const running = isTurnInFlight(turn, isLiveRunning);
  const parts: string[] = [];
  const durationMs =
    turn.durationMs ??
    (running && nowMs && turn.startedAtMs ? Math.max(0, nowMs - turn.startedAtMs) : undefined);
  const duration = typeof durationMs === 'number' ? formatDuration(durationMs) : undefined;
  if (duration) {
    parts.push(duration);
  }
  if (typeof turn.outputTokens === 'number' && turn.outputTokens > 0) {
    parts.push(`↓ ${turn.outputTokens} tokens`);
  }
  if (typeof turn.totalCostUsd === 'number') {
    parts.push(`$${turn.totalCostUsd.toFixed(4)}`);
  }

  const prefix =
    !running
      ? getCompletedTurnLabel(turn)
      : turn.phase === 'thinking' || turn.phase === 'requesting'
        ? 'Thinking...'
        : 'Computing...';

  if (!running && prefix === 'Baked' && duration) {
    const tail = parts.slice(1);
    return tail.length > 0 ? `${prefix} for ${duration} · ${tail.join(' · ')}` : `${prefix} for ${duration}`;
  }

  return parts.length > 0 ? `${prefix} (${parts.join(' · ')})` : prefix;
}

function isTurnInFlight(turn: ConversationTurn, isLiveRunning = false) {
  if (turn.status !== 'pending' && turn.status !== 'running') {
    return false;
  }

  if (!isLiveRunning) {
    return false;
  }

  return !hasCompletionSignal(turn);
}

function hasCompletionSignal(turn: ConversationTurn) {
  return Boolean(
    turn.durationMs ||
      turn.totalCostUsd ||
      (turn.outputTokens && turn.assistantText.trim()) ||
      (turn.metrics && turn.assistantText.trim()) ||
      (turn.status === 'running' && turn.activity === '运行完成'),
  );
}

function getCompletedTurnLabel(turn: ConversationTurn) {
  if (turn.status === 'pending' || turn.status === 'running') {
    return hasTurnVisibleOutput(turn) ? 'Baked' : 'Stopped';
  }

  return turn.status === 'done' ? 'Baked' : 'Done';
}
