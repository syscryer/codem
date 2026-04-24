import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import {
  formatDuration,
  hasTurnVisibleOutput,
  shouldHideToolStep,
  summarizeToolRow,
} from '../lib/conversation';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ConversationTurn,
  RequestUserInputQuestion,
  RequestUserInputRequest,
  RuntimeRecoveryHint,
  RuntimeSuggestedAction,
  ToolStep,
} from '../types';

export function ConversationTurnView({
  turn,
  nowMs,
  isLiveRunning,
  isLatest,
  onSubmitRequestUserInput,
  onSubmitRuntimeRecoveryAction,
  onSubmitApprovalDecision,
}: {
  turn: ConversationTurn;
  nowMs: number;
  isLiveRunning: boolean;
  isLatest: boolean;
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
}) {
  const visibleItems = turn.items.filter(
    (item) => item.type === 'text' || !shouldHideTurnToolStep(turn, item.tool),
  );
  const running = isTurnInFlight(turn, isLiveRunning);
  const showProgressLine =
    running ||
    turn.status === 'stopped' ||
    turn.status === 'error' ||
    Boolean(turn.durationMs || turn.outputTokens || turn.inputTokens);

  const assistantCopyText = getAssistantCopyText(turn);
  const messageTime = formatMessageTime(turn.startedAtMs);

  return (
    <article className={`turn ${isLatest ? 'latest-turn' : ''}`}>
      <section className="message user-message">
        <div className="message-label">You</div>
        <div className="user-message-content">
          <div className="message-body preserve-format">{turn.userText}</div>
          <div className="turn-actions user-turn-actions" aria-label="用户消息操作">
            <InlineCopyButton text={turn.userText} title="复制消息" />
            {messageTime ? <span className="turn-time">{messageTime}</span> : null}
          </div>
        </div>
      </section>

      <section className="message assistant-message">
        <div className="message-label">Claude</div>
        <div className="assistant-content">
          {showProgressLine ? (
            <TurnProgressLine turn={turn} nowMs={nowMs} isLiveRunning={isLiveRunning} compact />
          ) : null}

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
              null
            ) : null
          )}

          {turn.pendingUserInputRequests?.map((request, index) => (
            <RequestUserInputCard
              key={request.requestId ?? `${turn.id}-request-input-${index}`}
              request={request}
              turn={turn}
              onSubmitRequestUserInput={onSubmitRequestUserInput}
            />
          ))}

          {turn.pendingApprovalRequests?.map((request, index) => (
            <ApprovalRequestCard
              key={request.requestId ?? `${turn.id}-approval-${index}`}
              request={request}
              turn={turn}
              onSubmitApprovalDecision={onSubmitApprovalDecision}
            />
          ))}

          {turn.recoveryHint && turn.status !== 'done' ? (
            <RuntimeRecoveryCard
              hint={turn.recoveryHint}
              turn={turn}
              onSubmitRuntimeRecoveryAction={onSubmitRuntimeRecoveryAction}
            />
          ) : null}

          {turn.status === 'error' && turn.activity ? (
            <div className={`turn-status ${turn.status}`}>{turn.activity}</div>
          ) : null}

          <div className="turn-actions" aria-label="消息操作">
            <InlineCopyButton text={assistantCopyText} title="复制回复" />
            {messageTime ? <span className="turn-time">{messageTime}</span> : null}
          </div>
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
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            const text = extractCodeText(children);
            return (
              <div className="code-block-shell">
                <pre>{children}</pre>
                <InlineCopyButton text={text} title="复制代码" className="code-copy-button" />
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function ToolStepRow({ tool }: { tool: ToolStep }) {
  const preview = useMemo(() => getToolPreview(tool), [tool]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (preview) {
    return <CompactToolPreview tool={tool} preview={preview} />;
  }

  const hasDetails = Boolean(preview || tool.inputText?.trim() || tool.resultText?.trim());
  const summary = getToolSummary(tool, preview);
  const displayTitle = tool.title;

  return (
    <div className={`tool-step tool-${tool.status}`}>
      <div className="tool-step-main">
        <span className="tool-status-dot" />
        <div>
          <div className="tool-title">{displayTitle}</div>
          {summary ? <div className="tool-subtitle">{summary}</div> : null}
        </div>
      </div>

      {hasDetails ? (
        <details className="tool-details" onToggle={(event) => setDetailsOpen((event.target as HTMLDetailsElement).open)}>
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
          {detailsOpen && preview ? <ToolPreviewPanel preview={preview} /> : null}
        </details>
      ) : null}
    </div>
  );
}

function CompactToolPreview({
  tool,
  preview,
}: {
  tool: ToolStep;
  preview: ToolPreview;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`tool-step tool-preview-step tool-${tool.status}`}>
      <button
        type="button"
        className="tool-preview-summary"
        onClick={() => setExpanded((current) => !current)}
      >
        <div className="tool-preview-summary-main">
          <span className="tool-preview-kind">{getToolPreviewTitle(preview)}</span>
          {preview.additions > 0 ? <span className="tool-preview-add">+{preview.additions}</span> : null}
          {preview.deletions > 0 ? <span className="tool-preview-del">-{preview.deletions}</span> : null}
          <span className="tool-preview-name">{preview.fileName}</span>
        </div>
        <span className={`tool-preview-chevron ${expanded ? 'expanded' : ''}`}>{'>'}</span>
      </button>
      {expanded ? <ToolPreviewPanel preview={preview} /> : null}
    </div>
  );
}

function ToolPreviewPanel({ preview }: { preview: ToolPreview }) {
  return (
    <div className="tool-preview-card">
      <div className="tool-preview-card-head">
        <span className="tool-preview-file">{preview.fileName}</span>
        <div className="tool-preview-stats">
          {preview.additions > 0 ? <span className="tool-preview-add">+{preview.additions}</span> : null}
          {preview.deletions > 0 ? <span className="tool-preview-del">-{preview.deletions}</span> : null}
        </div>
      </div>
      {preview.kind === 'write' ? (
        <pre className="tool-preview-code">{preview.afterText}</pre>
      ) : (
        <div className="tool-diff-preview">
          {preview.rows.map((row, index) => (
            <div key={`${row.type}-${index}`} className={`tool-diff-line ${row.type}`}>
              <span className="tool-diff-sign">{getDiffSign(row.type)}</span>
              <code>{row.text || ' '}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RequestUserInputCard({
  request,
  turn,
  onSubmitRequestUserInput,
}: {
  request: RequestUserInputRequest;
  turn: ConversationTurn;
  onSubmitRequestUserInput: (
    turn: ConversationTurn,
    request: RequestUserInputRequest,
    answers: Record<string, string>,
  ) => Promise<boolean>;
}) {
  const submitted = Boolean(request.submittedAnswers);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, number[]>>(() =>
    getRequestUserInputSelectionsFromAnswers(request),
  );
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    getRequestUserInputNotesFromAnswers(request),
  );
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!request.submittedAnswers) {
      return;
    }

    setSelectedOptions(getRequestUserInputSelectionsFromAnswers(request));
    setNotes(getRequestUserInputNotesFromAnswers(request));
  }, [request]);

  const canSubmit = request.questions.some((question, index) => {
    const key = question.id ?? `question-${index}`;
    return Boolean(selectedOptions[key]?.length || notes[key]?.trim());
  });

  async function handleSubmit() {
    if (submitted) {
      return;
    }

    const validationMessage = validateRequestUserInput(request, selectedOptions, notes);
    if (validationMessage) {
      setSubmitError(validationMessage);
      return;
    }

    const answers = buildRequestUserInputAnswers(request, selectedOptions, notes);
    setSubmitError('');
    setSubmitting(true);
    try {
      const submitted = await onSubmitRequestUserInput(turn, request, answers);
      if (!submitted) {
        setSubmitError('提交未完成，请稍后重试。');
        return;
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '提交失败，请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={`assistant-runtime-card request-user-input-card${submitted ? ' submitted' : ''}`}>
      <header className="assistant-runtime-card-head">
        <span className={`assistant-runtime-badge ${submitted ? 'answered' : 'waiting'}`}>
          {submitted ? '已回答' : '等待输入'}
        </span>
        <div className="assistant-runtime-card-heading">
          <strong>{request.title || 'Claude 需要补充信息'}</strong>
          {request.description ? <p>{request.description}</p> : null}
        </div>
      </header>

      <div className="assistant-runtime-question-list">
        {request.questions.map((question, index) => (
          <RequestUserInputQuestionBlock
            key={question.id ?? `${request.requestId ?? 'request'}-question-${index}`}
            question={question}
            questionKey={question.id ?? `question-${index}`}
            selectedOptions={selectedOptions[question.id ?? `question-${index}`] ?? []}
            note={notes[question.id ?? `question-${index}`] ?? ''}
            disabled={submitted || submitting}
            onToggleOption={(optionIndex) =>
              setSelectedOptions((current) =>
                updateQuestionSelections(
                  current,
                  question.id ?? `question-${index}`,
                  optionIndex,
                  Boolean(question.multiSelect),
                ),
              )
            }
            onNoteChange={(value) =>
              setNotes((current) => ({
                ...current,
                [question.id ?? `question-${index}`]: value,
              }))
            }
          />
        ))}
      </div>

      <div className="assistant-runtime-card-foot">
        <span className="assistant-runtime-footnote">
          {submitted ? '答案已提交，卡片保留为上下文记录。' : '填写后会作为续聊消息继续当前任务。'}
        </span>
        <button
          type="button"
          className="assistant-runtime-submit-button"
          disabled={submitted || !canSubmit || submitting}
          onClick={() => void handleSubmit()}
        >
          {submitted ? '已继续' : submitting ? '提交中...' : '继续任务'}
        </button>
      </div>
      {submitError ? <div className="assistant-runtime-error">{submitError}</div> : null}
    </section>
  );
}

function RequestUserInputQuestionBlock({
  question,
  questionKey,
  selectedOptions,
  note,
  disabled = false,
  onToggleOption,
  onNoteChange,
}: {
  question: RequestUserInputQuestion;
  questionKey: string;
  selectedOptions: number[];
  note: string;
  disabled?: boolean;
  onToggleOption: (optionIndex: number) => void;
  onNoteChange: (value: string) => void;
}) {
  const hint = getRequestQuestionHint(question);
  const showTextarea = !question.options?.length || question.isOther;

  return (
    <section className="assistant-runtime-question">
      {question.header ? <div className="assistant-runtime-question-header">{question.header}</div> : null}
      <div className="assistant-runtime-question-text">{question.question}</div>
      {question.options?.length ? (
        <div className="assistant-runtime-option-list">
          {question.options.map((option, index) => (
            <button
              key={`${question.id ?? question.question}-option-${index}`}
              type="button"
              className={`assistant-runtime-option-chip${selectedOptions.includes(index) ? ' selected' : ''}`}
              disabled={disabled}
              onClick={() => onToggleOption(index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {showTextarea ? (
        <textarea
          className="assistant-runtime-textarea"
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          disabled={disabled}
          placeholder={question.placeholder || '填写你的回答'}
          rows={question.options?.length ? 2 : 3}
          aria-label={questionKey}
        />
      ) : null}
      {hint ? <div className="assistant-runtime-question-hint">{hint}</div> : null}
    </section>
  );
}

function ApprovalRequestCard({
  request,
  turn,
  onSubmitApprovalDecision,
}: {
  request: ApprovalRequest;
  turn: ConversationTurn;
  onSubmitApprovalDecision: (
    turn: ConversationTurn,
    request: ApprovalRequest,
    decision: ApprovalDecision,
  ) => Promise<boolean>;
}) {
  const [submittingDecision, setSubmittingDecision] = useState<ApprovalDecision | null>(null);
  const [submitError, setSubmitError] = useState('');

  async function handleDecision(decision: ApprovalDecision) {
    setSubmitError('');
    setSubmittingDecision(decision);
    try {
      const submitted = await onSubmitApprovalDecision(turn, request, decision);
      if (!submitted) {
        setSubmitError('操作未完成，请稍后重试。');
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '操作失败，请稍后重试。');
    } finally {
      setSubmittingDecision(null);
    }
  }

  return (
    <section className="assistant-runtime-card approval-request-card">
      <header className="assistant-runtime-card-head">
        <span className="assistant-runtime-badge caution">等待批准</span>
        <div className="assistant-runtime-card-heading">
          <strong>{request.title}</strong>
          {request.description ? <p>{request.description}</p> : null}
        </div>
      </header>

      {request.command?.length ? (
        <pre className="assistant-runtime-code">{request.command.join(' ')}</pre>
      ) : null}

      <div className="assistant-runtime-card-foot">
        <span className="assistant-runtime-footnote">
          {request.danger === 'high'
            ? '该操作风险较高，批准前请确认目标范围。'
            : '该操作需要确认后才能继续。'}
        </span>
        <div className="assistant-runtime-action-list">
          <button
            type="button"
            className="assistant-runtime-submit-button danger"
            disabled={Boolean(submittingDecision)}
            onClick={() => void handleDecision('reject')}
          >
            {submittingDecision === 'reject' ? '处理中...' : '拒绝'}
          </button>
          <button
            type="button"
            className="assistant-runtime-submit-button"
            disabled={Boolean(submittingDecision)}
            onClick={() => void handleDecision('approve')}
          >
            {submittingDecision === 'approve' ? '处理中...' : '批准并继续'}
          </button>
        </div>
      </div>
      {submitError ? <div className="assistant-runtime-error">{submitError}</div> : null}
    </section>
  );
}

function RuntimeRecoveryCard({
  hint,
  turn,
  onSubmitRuntimeRecoveryAction,
}: {
  hint: RuntimeRecoveryHint;
  turn: ConversationTurn;
  onSubmitRuntimeRecoveryAction: (
    turn: ConversationTurn,
    action: RuntimeSuggestedAction,
  ) => Promise<boolean>;
}) {
  const [submittingAction, setSubmittingAction] = useState<RuntimeSuggestedAction | null>(null);
  const [submitError, setSubmitError] = useState('');
  const actions = getRecoveryActions(hint);

  async function handleAction(action: RuntimeSuggestedAction) {
    setSubmitError('');
    setSubmittingAction(action);
    try {
      const submitted = await onSubmitRuntimeRecoveryAction(turn, action);
      if (!submitted) {
        setSubmitError('恢复动作未完成，请稍后重试。');
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '恢复失败，请稍后重试。');
    } finally {
      setSubmittingAction(null);
    }
  }

  return (
    <section className="assistant-runtime-card runtime-recovery-card">
      <header className="assistant-runtime-card-head">
        <span className="assistant-runtime-badge recovery">可恢复</span>
        <div className="assistant-runtime-card-heading">
          <strong>{getRecoveryTitle(hint)}</strong>
          <p>{hint.message}</p>
        </div>
      </header>

      <div className="assistant-runtime-card-foot">
        <span className="assistant-runtime-footnote">
          建议操作：{formatRecoveryAction(hint.suggestedAction)}
        </span>
        <div className="assistant-runtime-action-list">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              className={`assistant-runtime-submit-button${action !== hint.suggestedAction ? ' secondary' : ''}`}
              disabled={Boolean(submittingAction)}
              onClick={() => void handleAction(action)}
            >
              {submittingAction === action ? '处理中...' : formatRecoveryAction(action)}
            </button>
          ))}
        </div>
      </div>
      {submitError ? <div className="assistant-runtime-error">{submitError}</div> : null}
    </section>
  );
}

function formatTurnProgress(turn: ConversationTurn, nowMs?: number, isLiveRunning = false) {
  if (turn.status === 'stopped') {
    return '已停止';
  }

  if (turn.status === 'error') {
    return '处理失败';
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

  const prefix =
    !running
      ? getCompletedTurnLabel(turn)
      : turn.phase === 'thinking' || turn.phase === 'requesting'
        ? '思考中'
        : '处理中';

  if (!running && prefix === '已处理' && duration) {
    return `${prefix} ${duration}`;
  }

  return parts.length > 0 ? `${prefix} ${parts.join(' · ')}` : prefix;
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
    return hasTurnVisibleOutput(turn) ? '已处理' : '已停止';
  }

  return turn.status === 'done' ? '已处理' : '已完成';
}

function getAssistantCopyText(turn: ConversationTurn) {
  const visibleText = turn.items
    .map((item) => (item.type === 'text' ? item.text : ''))
    .filter(Boolean)
    .join('\n\n')
    .trim();

  return visibleText || turn.assistantText.trim();
}

function formatMessageTime(timestamp?: number) {
  if (!timestamp) {
    return '';
  }

  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function extractCodeText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(extractCodeText).join('');
  }

  if (value && typeof value === 'object' && 'props' in value) {
    const props = (value as { props?: { children?: unknown } }).props;
    return extractCodeText(props?.children);
  }

  return '';
}

type ToolPreview = {
  kind: 'edit' | 'write';
  filePath: string;
  fileName: string;
  beforeText: string;
  afterText: string;
  additions: number;
  deletions: number;
  rows: Array<{ type: 'context' | 'add' | 'remove'; text: string }>;
};

const TOOL_DIFF_CONTEXT_LINE_COUNT = 2;

function getToolPreview(tool: ToolStep): ToolPreview | null {
  if (tool.name !== 'Edit' && tool.name !== 'Write' && tool.name !== 'NotebookEdit') {
    return null;
  }

  const input = parseToolInput(tool.inputText);
  if (!input) {
    return null;
  }

  const filePath = getToolInputString(input, ['file_path', 'path', 'notebook_path']);
  if (!filePath) {
    return null;
  }

  const oldString = getToolInputString(input, ['old_string']);
  const newString = getToolInputString(input, ['new_string']);
  const content = getToolInputString(input, ['content']);
  const diff = getToolInputString(input, ['diff', 'patch']);
  const changeType = getToolInputString(input, ['change_type']) ?? 'update';

  let kind: ToolPreview['kind'] = tool.name === 'Write' ? 'write' : 'edit';
  let beforeText = '';
  let afterText = '';

  if (oldString !== undefined || newString !== undefined) {
    beforeText = oldString ?? '';
    afterText = newString ?? '';
  } else if (content !== undefined) {
    if (changeType === 'delete') {
      beforeText = content;
      afterText = '';
    } else {
      afterText = content;
      if (tool.name !== 'Write') {
        kind = changeType === 'create' ? 'write' : 'edit';
      }
    }
  } else if (diff) {
    const parsedDiff = parseDiffContent(diff);
    beforeText = parsedDiff.beforeText;
    afterText = parsedDiff.afterText;
  }

  if (!beforeText && !afterText) {
    return null;
  }

  if (!beforeText && afterText) {
    kind = 'write';
  }

  const stats = calculateLineDiffStats(beforeText, afterText);

  return {
    kind,
    filePath,
    fileName: getFileName(filePath),
    beforeText,
    afterText,
    additions: stats.additions,
    deletions: stats.deletions,
    rows: kind === 'edit' ? buildDiffRows(beforeText, afterText) : [],
  };
}

function getToolPreviewTitle(preview: ToolPreview) {
  return preview.kind === 'write' ? '已新增' : '已编辑';
}

function getRequestQuestionHint(question: RequestUserInputQuestion) {
  const hints: string[] = [];
  if (question.multiSelect) {
    hints.push('可多选');
  } else if (question.options?.length) {
    hints.push('单选');
  }

  if (question.secret) {
    hints.push('保密输入');
  }

  if (!question.options?.length) {
    hints.push(question.placeholder || '文本回答');
  } else if (question.isOther) {
    hints.push(question.placeholder || '可补充备注');
  }

  return hints.join(' · ');
}

function getRecoveryTitle(hint: RuntimeRecoveryHint) {
  switch (hint.reason) {
    case 'resume-session-missing':
      return '原会话不可恢复，已切换为新会话';
    case 'stale-session':
      return '当前会话可能已失效';
    case 'broken-pipe':
      return '运行连接已中断';
    case 'runtime-ended':
      return '运行提前结束';
    case 'transport-error':
      return '运行通道异常';
    case 'unknown':
    default:
      return '运行可尝试恢复';
  }
}

function formatRecoveryAction(action: RuntimeRecoveryHint['suggestedAction']) {
  switch (action) {
    case 'recover':
      return '恢复运行';
    case 'resend':
      return '重发上一条消息';
    case 'retry':
    default:
      return '重试当前请求';
  }
}

function shouldHideTurnToolStep(turn: ConversationTurn, tool: ToolStep) {
  if (shouldHideToolStep(tool)) {
    return true;
  }

  const normalizedName = normalizeRuntimeToolName(tool.name);
  if (
    normalizedName === 'askuserquestion' ||
    normalizedName === 'requestuserinput' ||
    normalizedName === 'approvalrequest'
  ) {
    return true;
  }

  if (
    turn.pendingUserInputRequests?.length &&
    (normalizedName === 'askuserquestion' || normalizedName === 'requestuserinput')
  ) {
    return true;
  }

  if (
    turn.pendingApprovalRequests?.length &&
    normalizedName === 'approvalrequest'
  ) {
    return true;
  }

  if (
    turn.pendingApprovalRequests?.some(
      (request) => request.requestId && request.requestId === (tool.toolUseId ?? tool.id),
    )
  ) {
    return true;
  }

  if (normalizedName === 'bash' && isApprovalRequiredToolError(tool.resultText)) {
    return true;
  }

  return false;
}

function normalizeRuntimeToolName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isApprovalRequiredToolError(resultText?: string) {
  const normalized = resultText?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('this command requires approval') ||
    normalized.includes('requires approval') ||
    normalized.includes('requires your approval') ||
    normalized.includes('approval required')
  );
}

function getRecoveryActions(hint: RuntimeRecoveryHint): RuntimeSuggestedAction[] {
  const ordered: RuntimeSuggestedAction[] = [hint.suggestedAction];
  const fallbackActions: RuntimeSuggestedAction[] =
    hint.reason === 'resume-session-missing'
      ? ['resend', 'retry']
      : hint.reason === 'stale-session'
        ? ['recover', 'retry']
        : ['resend', 'recover'];

  for (const action of fallbackActions) {
    if (!ordered.includes(action)) {
      ordered.push(action);
    }
  }

  return ordered;
}

function updateQuestionSelections(
  current: Record<string, number[]>,
  questionKey: string,
  optionIndex: number,
  multiSelect: boolean,
) {
  const existing = current[questionKey] ?? [];
  let nextSelection: number[];
  if (multiSelect) {
    nextSelection = existing.includes(optionIndex)
      ? existing.filter((index) => index !== optionIndex)
      : [...existing, optionIndex];
  } else if (existing.length === 1 && existing[0] === optionIndex) {
    nextSelection = [];
  } else {
    nextSelection = [optionIndex];
  }

  return {
    ...current,
    [questionKey]: nextSelection,
  };
}

function validateRequestUserInput(
  request: RequestUserInputRequest,
  selectedOptions: Record<string, number[]>,
  notes: Record<string, string>,
) {
  for (let index = 0; index < request.questions.length; index += 1) {
    const question = request.questions[index];
    const key = question.id ?? `question-${index}`;
    const hasAnswer = Boolean(selectedOptions[key]?.length || notes[key]?.trim());
    if (question.required && !hasAnswer) {
      return `请先填写“${question.question}”。`;
    }
  }

  const hasAnyAnswer = request.questions.some((question, index) => {
    const key = question.id ?? `question-${index}`;
    return Boolean(selectedOptions[key]?.length || notes[key]?.trim());
  });
  if (!hasAnyAnswer) {
    return '请至少填写一项回答。';
  }

  return '';
}

function buildRequestUserInputAnswers(
  request: RequestUserInputRequest,
  selectedOptions: Record<string, number[]>,
  notes: Record<string, string>,
) {
  const answers: Record<string, string> = {};
  request.questions.forEach((question, index) => {
    const key = question.id ?? `question-${index}`;
    const optionLabels = (selectedOptions[key] ?? [])
      .map((optionIndex) => question.options?.[optionIndex]?.label ?? '')
      .filter(Boolean);
    const note = notes[key]?.trim();
    const parts = [...optionLabels];
    if (note) {
      parts.push(note);
    }
    if (parts.length > 0) {
      answers[key] = parts.join('\n');
    }
  });
  return answers;
}

function getRequestUserInputSelectionsFromAnswers(request: RequestUserInputRequest) {
  const selections: Record<string, number[]> = {};
  if (!request.submittedAnswers) {
    return selections;
  }

  request.questions.forEach((question, index) => {
    const key = question.id ?? `question-${index}`;
    const answerParts = splitSubmittedAnswer(request.submittedAnswers?.[key]);
    const selectedOptionIndexes = answerParts
      .map((answerPart) => question.options?.findIndex((option) => option.label === answerPart) ?? -1)
      .filter((optionIndex) => optionIndex >= 0);
    if (selectedOptionIndexes.length > 0) {
      selections[key] = selectedOptionIndexes;
    }
  });

  return selections;
}

function getRequestUserInputNotesFromAnswers(request: RequestUserInputRequest) {
  const notes: Record<string, string> = {};
  if (!request.submittedAnswers) {
    return notes;
  }

  request.questions.forEach((question, index) => {
    const key = question.id ?? `question-${index}`;
    const answerParts = splitSubmittedAnswer(request.submittedAnswers?.[key]);
    const optionLabels = new Set(question.options?.map((option) => option.label) ?? []);
    const noteParts = answerParts.filter((answerPart) => !optionLabels.has(answerPart));
    if (noteParts.length > 0) {
      notes[key] = noteParts.join('\n');
    }
  });

  return notes;
}

function splitSubmittedAnswer(answer?: string) {
  return answer
    ?.split('\n')
    .map((part) => part.trim())
    .filter(Boolean) ?? [];
}

function getToolSummary(tool: ToolStep, preview: ToolPreview | null) {
  if (!preview) {
    return summarizeToolRow(tool);
  }

  const stats: string[] = [];
  if (preview.additions > 0) {
    stats.push(`+${preview.additions}`);
  }
  if (preview.deletions > 0) {
    stats.push(`-${preview.deletions}`);
  }

  const fileLabel = preview.fileName || preview.filePath;
  return stats.length > 0 ? `${fileLabel} ${stats.join(' ')}` : fileLabel;
}

function parseToolInput(inputText?: string) {
  if (!inputText?.trim()) {
    return null;
  }

  try {
    return JSON.parse(inputText) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getToolInputString(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

function parseDiffContent(diff: string) {
  const lines = normalizePreviewText(diff).split('\n');
  const beforeLines: string[] = [];
  const afterLines: string[] = [];

  for (const line of lines) {
    if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('@@')
    ) {
      continue;
    }

    if (line.startsWith('-')) {
      beforeLines.push(line.slice(1));
      continue;
    }

    if (line.startsWith('+')) {
      afterLines.push(line.slice(1));
      continue;
    }

    const text = line.startsWith(' ') ? line.slice(1) : line;
    beforeLines.push(text);
    afterLines.push(text);
  }

  return {
    beforeText: beforeLines.join('\n'),
    afterText: afterLines.join('\n'),
  };
}

function calculateLineDiffStats(beforeText: string, afterText: string) {
  const beforeLines = splitPreviewLines(beforeText);
  const afterLines = splitPreviewLines(afterText);
  let prefix = 0;

  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return {
    additions: Math.max(0, afterLines.length - prefix - suffix),
    deletions: Math.max(0, beforeLines.length - prefix - suffix),
  };
}

function buildDiffRows(beforeText: string, afterText: string) {
  const beforeLines = splitPreviewLines(beforeText);
  const afterLines = splitPreviewLines(afterText);

  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const contextStart = Math.max(0, prefix - TOOL_DIFF_CONTEXT_LINE_COUNT);
  const beforeChangedEnd = Math.max(prefix, beforeLines.length - suffix);
  const afterChangedEnd = Math.max(prefix, afterLines.length - suffix);
  const rows: ToolPreview['rows'] = [];

  if (contextStart > 0) {
    rows.push({ type: 'context', text: '...' });
  }

  for (const line of afterLines.slice(contextStart, prefix)) {
    rows.push({ type: 'context', text: line });
  }

  for (const line of beforeLines.slice(prefix, beforeChangedEnd)) {
    rows.push({ type: 'remove', text: line });
  }

  for (const line of afterLines.slice(prefix, afterChangedEnd)) {
    rows.push({ type: 'add', text: line });
  }

  const trailingContext = afterLines.slice(
    afterChangedEnd,
    Math.min(afterChangedEnd + TOOL_DIFF_CONTEXT_LINE_COUNT, afterLines.length),
  );
  for (const line of trailingContext) {
    rows.push({ type: 'context', text: line });
  }

  if (afterChangedEnd + trailingContext.length < afterLines.length) {
    rows.push({ type: 'context', text: '...' });
  }

  if (rows.length === 0) {
    return [{ type: 'context' as const, text: afterLines[0] ?? '' }];
  }

  return rows;
}

function splitPreviewLines(value: string) {
  return normalizePreviewText(value).split('\n');
}

function normalizePreviewText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function getDiffSign(type: 'context' | 'add' | 'remove') {
  if (type === 'add') {
    return '+';
  }

  if (type === 'remove') {
    return '-';
  }

  return ' ';
}

function getFileName(filePath: string) {
  const segments = filePath.split(/[\\/]/);
  return segments[segments.length - 1] || filePath;
}

function InlineCopyButton({
  text,
  title,
  className = '',
}: {
  text: string;
  title: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  async function handleCopy() {
    if (!text.trim()) {
      return;
    }

    await navigator.clipboard.writeText(text);
    setCopied(true);

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      setCopied(false);
      timerRef.current = null;
    }, 1400);
  }

  return (
    <button
      type="button"
      className={`inline-copy-button ${copied ? 'copied' : ''} ${className}`.trim()}
      title={copied ? '已复制' : title}
      aria-label={copied ? '已复制' : title}
      disabled={!text.trim()}
      onClick={() => void handleCopy()}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}
