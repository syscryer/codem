import { memo, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, ListChecks, Maximize2 } from 'lucide-react';
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
  UserImageAttachment,
} from '../types';

function ConversationTurnViewComponent({
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
  const running = isTurnInFlight(turn, isLiveRunning);
  const requestCardsByToolId = useMemo(() => {
    const requests = turn.pendingUserInputRequests ?? [];
    return new Map(
      requests
        .filter((request) => request.requestId)
        .map((request) => [request.requestId as string, request]),
    );
  }, [turn.pendingUserInputRequests]);
  const anchoredRequestIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of turn.items) {
      if (item.type === 'tool') {
        const request = getToolAnchoredRequest(item.tool, requestCardsByToolId);
        if (request?.requestId) {
          ids.add(request.requestId);
        }
      }
    }
    return ids;
  }, [requestCardsByToolId, turn.items]);
  const visibleItems = turn.items.filter((item) => {
    if (item.type === 'text' || item.type === 'thinking') {
      return true;
    }

    return !shouldHideTurnToolStep(turn, item.tool) || Boolean(getToolAnchoredRequest(item.tool, requestCardsByToolId));
  });
  const groupedVisibleItems = useMemo(() => groupReadToolItems(visibleItems), [visibleItems]);
  const showProgressLine =
    running ||
    turn.status === 'stopped' ||
    turn.status === 'error' ||
    Boolean(turn.durationMs || turn.outputTokens || turn.inputTokens);
  const showLeadingProgressLine = showProgressLine && !running;
  const showTrailingProgressLine = showProgressLine && running;

  const assistantCopyText = getAssistantCopyText(turn);
  const messageTime = formatMessageTime(turn.startedAtMs);
  const hasUserText = Boolean(turn.userText.trim());
  const hasUserAttachments = Boolean(turn.userAttachments?.length);

  return (
    <article className={`turn ${isLatest ? 'latest-turn' : ''}`}>
      <section className="message user-message">
        <div className="message-label">You</div>
        <div className="user-message-content">
          {hasUserAttachments ? <UserAttachmentGallery attachments={turn.userAttachments ?? []} /> : null}
          {hasUserText ? <div className="message-body preserve-format">{turn.userText}</div> : null}
          {hasUserText || messageTime ? (
            <div className="turn-actions user-turn-actions" aria-label="用户消息操作">
              {hasUserText ? <InlineCopyButton text={turn.userText} title="复制消息" /> : null}
              {messageTime ? <span className="turn-time">{messageTime}</span> : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="message assistant-message">
        <div className="message-label">Claude</div>
        <div className="assistant-content">
          {showLeadingProgressLine ? (
            <TurnProgressLine turn={turn} nowMs={nowMs} isLiveRunning={isLiveRunning} compact />
          ) : null}

          {groupedVisibleItems.length > 0 ? (
            groupedVisibleItems.map((item) => {
              if (item.type === 'text') {
                return <MarkdownMessage key={item.id} content={item.text} />;
              }

              if (item.type === 'thinking') {
                return <ThinkingMessage key={item.id} content={item.text} />;
              }

              if (item.type === 'read-group') {
                return <ReadToolsGroup key={item.id} tools={item.tools} />;
              }

              return (
                <ToolItemWithAnchoredCards
                  key={item.id}
                  tool={item.tool}
                  turn={turn}
                  turnInFlight={running}
                  requestCardsByToolId={requestCardsByToolId}
                  onSubmitRequestUserInput={onSubmitRequestUserInput}
                />
              );
            })
          ) : (
            running ? (
              null
            ) : null
          )}

          {showTrailingProgressLine ? (
            <TurnProgressLine turn={turn} nowMs={nowMs} isLiveRunning={isLiveRunning} compact />
          ) : null}

          {turn.pendingUserInputRequests?.map((request, index) => {
            if (request.requestId && anchoredRequestIds.has(request.requestId)) {
              return null;
            }

            return (
              <RequestUserInputCard
                key={request.requestId ?? `${turn.id}-request-input-${index}`}
                request={request}
                turn={turn}
                turnInFlight={running}
                onSubmitRequestUserInput={onSubmitRequestUserInput}
              />
            );
          })}

          {turn.pendingApprovalRequests?.map((request, index) => (
            <ApprovalRequestCard
              key={request.requestId ?? `${turn.id}-approval-${index}`}
              request={request}
              turn={turn}
              interactive={isLatest && request.historical !== true}
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
    <div className={`working-line tui-progress ${compact ? 'compact' : ''} ${running ? 'running' : ''}`}>
      <span className="tui-progress-text">{text}</span>
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

function ThinkingMessage({ content }: { content: string }) {
  const cleanContent = content.trim();
  if (!cleanContent) {
    return null;
  }

  return (
    <details className="thinking-message">
      <summary>
        <span className="thinking-dot" />
        <span>Thinking</span>
        <span className="thinking-count">{formatThinkingLength(cleanContent)}</span>
      </summary>
      <pre>{cleanContent}</pre>
    </details>
  );
}

export const ConversationTurnView = memo(ConversationTurnViewComponent);

function UserAttachmentGallery({ attachments }: { attachments: UserImageAttachment[] }) {
  return (
    <div className="user-message-attachments" aria-label="用户图片附件">
      {attachments.map((attachment) => (
        <figure key={attachment.id} className="user-message-attachment">
          <img
            src={buildUserAttachmentPreviewUrl(attachment.path)}
            alt={attachment.name || '图片附件'}
            className="user-message-attachment-preview"
            loading="lazy"
          />
          <figcaption className="user-message-attachment-name" title={attachment.name}>
            {attachment.name}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

type DisplayAssistantItem =
  | ConversationTurn['items'][number]
  | { id: string; type: 'read-group'; tools: ToolStep[] };

function ReadToolsGroup({ tools }: { tools: ToolStep[] }) {
  const [expanded, setExpanded] = useState(false);
  const status = tools.some((tool) => tool.status === 'error')
    ? 'error'
    : tools.some((tool) => tool.status === 'running')
      ? 'running'
      : 'done';
  const fileNames = tools
    .map((tool) => getReadToolPath(tool))
    .filter((filePath): filePath is string => Boolean(filePath))
    .map((filePath) => getFileName(filePath));
  const summary = fileNames.length
    ? fileNames.slice(0, 3).join('、') + (fileNames.length > 3 ? ` 等 ${fileNames.length} 个文件` : '')
    : `${tools.length} 个文件`;

  return (
    <div className={`tool-step read-group-step tool-${status}`}>
      <button
        type="button"
        className="tool-preview-summary read-group-summary"
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="tool-status-dot" />
        <div className="tool-preview-summary-main read-group-summary-main">
          <span className="read-group-title">批量读取 {tools.length} 个文件</span>
          <span className="read-group-meta">{summary}</span>
        </div>
        <span className={`tool-preview-chevron ${expanded ? 'expanded' : ''}`}>{'>'}</span>
      </button>

      {expanded ? (
        <div className="read-group-card">
          {tools.map((tool) => (
            <ToolStepRow key={tool.id} tool={tool} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ToolItemWithAnchoredCards({
  tool,
  turn,
  turnInFlight,
  requestCardsByToolId,
  onSubmitRequestUserInput,
}: {
  tool: ToolStep;
  turn: ConversationTurn;
  turnInFlight: boolean;
  requestCardsByToolId: Map<string, RequestUserInputRequest>;
  onSubmitRequestUserInput: (
    turn: ConversationTurn,
    request: RequestUserInputRequest,
    answers: Record<string, string>,
  ) => Promise<boolean>;
}) {
  const request = getToolAnchoredRequest(tool, requestCardsByToolId);

  return (
    <>
      {!shouldHideTurnToolStep(turn, tool) ? <ToolStepRow tool={tool} /> : null}
      {request ? (
        <RequestUserInputCard
          request={request}
          turn={turn}
          turnInFlight={turnInFlight}
          onSubmitRequestUserInput={onSubmitRequestUserInput}
        />
      ) : null}
    </>
  );
}

function ToolStepRow({ tool }: { tool: ToolStep }) {
  const preview = useMemo(() => getToolPreview(tool), [tool]);
  const todoPreview = useMemo(() => getTodoWritePreview(tool), [tool]);
  const agentPreview = useMemo(() => getAgentTaskPreview(tool), [tool]);
  const structuredPreview = useMemo(() => getStructuredToolPreview(tool), [tool]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (agentPreview) {
    return <AgentTaskPreview tool={tool} preview={agentPreview} />;
  }

  if (todoPreview) {
    return <TodoWritePreview tool={tool} preview={todoPreview} />;
  }

  if (preview) {
    return <CompactToolPreview tool={tool} preview={preview} />;
  }

  if (structuredPreview) {
    return <StructuredToolPreview tool={tool} preview={structuredPreview} />;
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

function AgentTaskPreview({
  tool,
  preview,
}: {
  tool: ToolStep;
  preview: AgentTaskPreviewData;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`tool-step agent-preview-step tool-${tool.status}`}>
      <button
        type="button"
        className="tool-preview-summary agent-preview-summary"
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="tool-status-dot" />
        <div className="tool-preview-summary-main agent-preview-summary-main">
          <span className="agent-preview-title">{tool.title}</span>
          <span className="agent-preview-meta">{preview.summary}</span>
        </div>
        <span className={`tool-preview-chevron ${expanded ? 'expanded' : ''}`}>{'>'}</span>
      </button>

      {expanded ? (
        <div className="agent-preview-card">
          {preview.files.length > 0 ? (
            <section className="agent-preview-section">
              <h4>涉及文件</h4>
              <div className="agent-preview-file-list">
                {preview.files.map((filePath) => (
                  <code key={filePath}>{filePath}</code>
                ))}
              </div>
            </section>
          ) : null}
          {preview.resultText ? (
            <section className="agent-preview-section">
              <h4>结果</h4>
              <pre>{preview.resultText}</pre>
            </section>
          ) : null}
          {preview.subMessages.length > 0 ? (
            <section className="agent-preview-section">
              <h4>子代理消息</h4>
              {preview.subMessages.map((message, index) => (
                <pre key={`sub-message-${index}`}>{message}</pre>
              ))}
            </section>
          ) : null}
          {preview.subtools.length > 0 ? (
            <section className="agent-preview-section">
              <h4>子代理工具</h4>
              <div className="structured-preview-list">
                {preview.subtools.map((subtool) => (
                  <div key={subtool.id} className={`structured-preview-row tool-${subtool.status}`}>
                    <span className="structured-preview-label">工具</span>
                    <span className="structured-preview-value">
                      {subtool.title} · {summarizeToolRow(subtool)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StructuredToolPreview({
  tool,
  preview,
}: {
  tool: ToolStep;
  preview: StructuredToolPreviewData;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`tool-step structured-preview-step tool-${tool.status}`}>
      <button
        type="button"
        className="tool-preview-summary structured-preview-summary"
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="tool-status-dot" />
        <div className="tool-preview-summary-main structured-preview-summary-main">
          <span className="structured-preview-title">{preview.title}</span>
          <span className="structured-preview-meta">{preview.summary}</span>
        </div>
        <span className={`tool-preview-chevron ${expanded ? 'expanded' : ''}`}>{'>'}</span>
      </button>

      {expanded ? (
        <div className="structured-preview-card">
          {preview.rows.length > 0 ? (
            <div className="structured-preview-list">
              {preview.rows.map((row, index) => (
                <div key={`${row.label}-${index}`} className="structured-preview-row">
                  <span className="structured-preview-label">{row.label}</span>
                  <span className="structured-preview-value">{row.value}</span>
                </div>
              ))}
            </div>
          ) : null}
          {preview.content ? <pre>{preview.content}</pre> : null}
          {tool.inputText?.trim() || tool.resultText?.trim() ? (
            <details className="tool-details structured-preview-raw">
              <summary>原始详情</summary>
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
      ) : null}
    </div>
  );
}

function TodoWritePreview({
  tool,
  preview,
}: {
  tool: ToolStep;
  preview: TodoWritePreviewData;
}) {
  const resultText = getTodoWriteVisibleResult(tool.resultText);

  return (
    <div className={`tool-step todo-preview-step tool-${tool.status}`}>
      <div className="todo-preview-card">
        <header className="todo-preview-head">
          <div className="todo-preview-title">
            <ListChecks size={15} aria-hidden="true" />
            <span>{formatTodoPreviewSummary(preview)}</span>
          </div>
          <Maximize2 className="todo-preview-expand-icon" size={14} aria-hidden="true" />
        </header>

        <ol className="todo-preview-list">
          {preview.todos.map((todo, index) => (
            <li key={`${todo.content}-${index}`} className={`todo-preview-item ${todo.status}`}>
              <span className="todo-preview-status" aria-hidden="true">
                {todo.status === 'completed' ? '✓' : ''}
              </span>
              <span className="todo-preview-content">
                {index + 1}. {todo.content}
              </span>
            </li>
          ))}
        </ol>

        {resultText ? (
          <footer className="todo-preview-result">{resultText}</footer>
        ) : null}
      </div>
    </div>
  );
}

function RequestUserInputCard({
  request,
  turn,
  turnInFlight,
  onSubmitRequestUserInput,
}: {
  request: RequestUserInputRequest;
  turn: ConversationTurn;
  turnInFlight: boolean;
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
    if (submitted || turnInFlight) {
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
          {submitted
            ? '答案已提交，卡片保留为上下文记录。'
            : turnInFlight
              ? '填写后会直接回答当前运行中的提问。'
              : '填写后会作为续聊消息继续当前任务。'}
        </span>
        <button
          type="button"
          className="assistant-runtime-submit-button"
          disabled={submitted || !canSubmit || submitting}
          onClick={() => void handleSubmit()}
        >
          {submitted
            ? '已继续'
            : submitting
              ? '提交中...'
              : turnInFlight
                ? '提交答案'
                : '继续任务'}
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
  interactive,
  onSubmitApprovalDecision,
}: {
  request: ApprovalRequest;
  turn: ConversationTurn;
  interactive: boolean;
  onSubmitApprovalDecision: (
    turn: ConversationTurn,
    request: ApprovalRequest,
    decision: ApprovalDecision,
  ) => Promise<boolean>;
}) {
  const [submittingDecision, setSubmittingDecision] = useState<ApprovalDecision | null>(null);
  const [submitError, setSubmitError] = useState('');
  const planApproval = isPlanApprovalRequest(request);

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
    <section className={`assistant-runtime-card approval-request-card${planApproval ? ' plan-approval-card' : ''}`}>
      <header className="assistant-runtime-card-head">
        <span className="assistant-runtime-badge caution">
          {interactive ? (planApproval ? '计划确认' : '等待批准') : '历史审批'}
        </span>
        <div className="assistant-runtime-card-heading">
          <strong>{request.title}</strong>
          {request.description && !planApproval ? <p>{request.description}</p> : null}
        </div>
      </header>

      {planApproval && request.description ? (
        <pre className="assistant-runtime-code plan-approval-code">{request.description}</pre>
      ) : null}

      {request.command?.length ? (
        <pre className="assistant-runtime-code">{request.command.join(' ')}</pre>
      ) : null}

      <div className="assistant-runtime-card-foot">
        <span className="assistant-runtime-footnote">
          {!interactive
            ? '这是历史审批记录，不会自动弹窗或继续旧运行。'
            : planApproval
            ? '批准后继续执行计划；拒绝后会让 Claude 重新调整。'
            : request.danger === 'high'
            ? '该操作风险较高，批准前请确认目标范围。'
            : '该操作需要确认后才能继续。'}
        </span>
        {interactive ? (
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
        ) : null}
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
  if (running) {
    const estimatedOutputTokens = estimateOutputTokens(turn.assistantText);
    const realOutputTokens = typeof turn.outputTokens === 'number' ? turn.outputTokens : 0;
    if (estimatedOutputTokens > realOutputTokens) {
      parts.push(`↓ ≈ ${formatTokenCount(estimatedOutputTokens)} tokens`);
    } else if (realOutputTokens > 0) {
      parts.push(`↓ ${formatTokenCount(realOutputTokens)} tokens`);
    }
  } else if (typeof turn.outputTokens === 'number') {
    parts.push(`↓ ${formatTokenCount(turn.outputTokens)} tokens`);
  }
  if (typeof turn.thoughtCount === 'number' && turn.thoughtCount > 0 && (!running || turn.phase === 'thinking')) {
    parts.push(`思考 ${turn.thoughtCount} 段`);
  }

  const prefix =
    !running
      ? getCompletedTurnLabel(turn)
      : getRunningTurnLabel(turn);

  if (!running && prefix === '已处理' && duration) {
    return `${prefix} ${duration}`;
  }

  return parts.length > 0 ? `${prefix} ${parts.join(' · ')}` : prefix;
}

function getRunningTurnLabel(turn: ConversationTurn) {
  if (turn.pendingApprovalRequests?.length) {
    return '等待批准';
  }

  if (turn.pendingUserInputRequests?.length) {
    return '等待输入';
  }

  if (turn.phase === 'thinking') {
    return '思考中';
  }

  if (turn.phase === 'requesting') {
    if (turn.activity === '继续执行中') {
      return '继续执行中';
    }

    if (turn.activity === '等待 Claude 调整计划') {
      return '等待调整计划';
    }

    return '等待响应';
  }

  if (turn.phase === 'tool') {
    return '执行工具中';
  }

  if (turn.phase === 'computing') {
    return '生成回复中';
  }

  return turn.activity?.trim() || '处理中';
}

function formatTokenCount(tokens: number) {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }

  return `${tokens}`;
}

function estimateOutputTokens(text: string) {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }

  let asciiCount = 0;
  let nonAsciiCount = 0;
  for (const char of normalized) {
    if (/\s/.test(char)) {
      continue;
    }

    if (char.charCodeAt(0) <= 0x7f) {
      asciiCount += 1;
    } else {
      nonAsciiCount += 1;
    }
  }

  return Math.max(1, Math.round(asciiCount / 4 + nonAsciiCount / 1.7));
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
  if (turn.status === 'pending' || turn.status === 'running') {
    return turn.activity === '运行完成';
  }

  return Boolean(
    turn.durationMs ||
      turn.totalCostUsd ||
      (turn.outputTokens && turn.assistantText.trim()) ||
      (turn.metrics && turn.assistantText.trim()),
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

function formatThinkingLength(content: string) {
  const chars = content.trim().length;
  if (chars >= 1000) {
    return `${(chars / 1000).toFixed(1)}k chars`;
  }

  return `${chars} chars`;
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

type TodoWritePreviewData = {
  todos: Array<{
    content: string;
    status: TodoStatus;
  }>;
  counts: Record<TodoStatus, number>;
};

type AgentTaskPreviewData = {
  summary: string;
  files: string[];
  resultText: string;
  subMessages: string[];
  subtools: ToolStep[];
};

type StructuredToolPreviewData = {
  title: string;
  summary: string;
  rows: Array<{ label: string; value: string }>;
  content?: string;
};

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'unknown';

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

function getAgentTaskPreview(tool: ToolStep): AgentTaskPreviewData | null {
  const normalizedName = normalizeRuntimeToolName(tool.name);
  if (normalizedName !== 'agent' && normalizedName !== 'task') {
    return null;
  }

  const resultText = stripUsageBlock(tool.resultText ?? '').trim();
  const usageSummary = getUsageSummaryFromText(tool.resultText);
  const files = extractAgentResultFiles(resultText);
  const summary = formatAgentTaskSummary(tool, usageSummary, files.length);

  return {
    summary,
    files,
    resultText,
    subMessages: tool.subMessages?.filter((message) => message.trim()) ?? [],
    subtools: tool.subtools ?? [],
  };
}

function getStructuredToolPreview(tool: ToolStep): StructuredToolPreviewData | null {
  const normalizedName = normalizeRuntimeToolName(tool.name);
  const input = parseToolInput(tool.inputText);
  const rows: StructuredToolPreviewData['rows'] = [];
  const resultText = normalizeToolResultText(tool.resultText);

  if (input) {
    const filePath = getToolInputString(input, ['file_path', 'path', 'notebook_path']);
    const pattern = getToolInputString(input, ['pattern', 'query']);
    const url = getToolInputString(input, ['url']);
    const command = getToolInputString(input, ['command', 'cmd', 'cmdString']);
    const description = getToolInputString(input, ['description', 'summary', 'task', 'prompt']);

    if (filePath) rows.push({ label: '路径', value: filePath });
    if (pattern) rows.push({ label: normalizedName === 'websearch' ? '查询' : '匹配', value: pattern });
    if (url) rows.push({ label: 'URL', value: url });
    if (command) rows.push({ label: '命令', value: command });
    if (description) rows.push({ label: '任务', value: summarizePlainText(description, 140) });
  }

  if (normalizedName === 'enterplanmode') {
    return {
      title: '进入 Plan 模式',
      summary: '后续写入和执行会先请求确认',
      rows,
      content: resultText,
    };
  }

  if (normalizedName === 'updatplan' || normalizedName === 'updateplan') {
    const planRows = extractPlanRows(input);
    return {
      title: '更新计划',
      summary: planRows.length ? `${planRows.length} 项` : summarizeToolRow(tool),
      rows: planRows.length ? planRows : rows,
      content: resultText,
    };
  }

  if (normalizedName === 'todoread') {
    return {
      title: '读取 Todo',
      summary: resultText ? `${countNonEmptyLines(resultText)} 行结果` : summarizeToolRow(tool),
      rows,
      content: resultText,
    };
  }

  if (normalizedName === 'ls') {
    return {
      title: '目录列表',
      summary: resultText ? `${countNonEmptyLines(resultText)} 项` : summarizeToolRow(tool),
      rows,
      content: resultText,
    };
  }

  if (normalizedName === 'grep' || normalizedName === 'glob') {
    return {
      title: normalizedName === 'grep' ? '搜索匹配' : '文件匹配',
      summary: resultText ? `${countNonEmptyLines(resultText)} 条结果` : summarizeToolRow(tool),
      rows,
      content: resultText,
    };
  }

  if (normalizedName === 'websearch' || normalizedName === 'webfetch') {
    return {
      title: normalizedName === 'websearch' ? '网页搜索' : '网页读取',
      summary: resultText ? summarizePlainText(resultText, 90) : summarizeToolRow(tool),
      rows,
      content: resultText,
    };
  }

  if (normalizedName === 'bashoutput' || normalizedName === 'killshell' || normalizedName === 'taskoutput') {
    return {
      title: getReadableStructuredToolTitle(tool.name),
      summary: resultText ? summarizePlainText(resultText, 90) : summarizeToolRow(tool),
      rows,
      content: resultText,
    };
  }

  if (normalizedName === 'multiedit') {
    const editCount = input && Array.isArray(input.edits) ? input.edits.length : 0;
    return {
      title: '批量编辑',
      summary: editCount > 0 ? `${editCount} 处修改` : summarizeToolRow(tool),
      rows,
      content: resultText,
    };
  }

  if (normalizedName === 'viewimage') {
    return {
      title: '查看图片',
      summary: rows[0]?.value ?? summarizeToolRow(tool),
      rows,
      content: resultText,
    };
  }

  if (
    normalizedName === 'taskcreate' ||
    normalizedName === 'taskupdate' ||
    normalizedName === 'tasklist' ||
    normalizedName === 'taskget'
  ) {
    return {
      title: getReadableStructuredToolTitle(tool.name),
      summary: resultText ? summarizePlainText(resultText, 90) : summarizeToolRow(tool),
      rows,
      content: resultText,
    };
  }

  if (tool.name.startsWith('mcp__') && resultText) {
    return {
      title: tool.title,
      summary: summarizePlainText(resultText, 90),
      rows,
      content: resultText,
    };
  }

  return null;
}

function formatAgentTaskSummary(tool: ToolStep, usageSummary: string, fileCount: number) {
  const state = tool.status === 'running' ? '运行中' : tool.status === 'error' ? 'Error' : '完成子任务';
  const details: string[] = [];
  if (usageSummary) {
    details.push(usageSummary);
  } else if (fileCount > 0) {
    details.push(`${fileCount} 个文件`);
  }

  return details.length ? `${state} · ${details.join(' · ')}` : state;
}

function extractPlanRows(input: Record<string, unknown> | null): StructuredToolPreviewData['rows'] {
  if (!input) {
    return [];
  }

  const rawItems = Array.isArray(input.plan)
    ? input.plan
    : Array.isArray(input.todos)
      ? input.todos
      : Array.isArray(input.items)
        ? input.items
        : [];

  return rawItems
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const record = item as Record<string, unknown>;
      const step = getStringValue(record.step) ?? getStringValue(record.content) ?? getStringValue(record.title);
      if (!step) {
        return null;
      }

      const status = getStringValue(record.status) ?? 'pending';
      return {
        label: `${index + 1}. ${formatPlanStatus(status)}`,
        value: step,
      };
    })
    .filter((item): item is { label: string; value: string } => Boolean(item));
}

function formatPlanStatus(status: string) {
  switch (status) {
    case 'completed':
    case 'complete':
      return '已完成';
    case 'in_progress':
    case 'running':
      return '进行中';
    case 'pending':
      return '待处理';
    default:
      return status;
  }
}

function normalizeToolResultText(value?: string) {
  const text = value?.trim() ?? '';
  if (!text) {
    return '';
  }

  const parsed = parseJsonResultContent(text);
  if (parsed) {
    return parsed;
  }

  return text;
}

function parseJsonResultContent(text: string) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') {
      return parsed;
    }

    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') {
            const record = item as Record<string, unknown>;
            if (typeof record.text === 'string') return record.text;
            if (typeof record.content === 'string') return record.content;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n')
        .trim();
    }

    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (typeof record.text === 'string') return record.text;
      if (typeof record.content === 'string') return record.content;
    }
  } catch {
    return '';
  }

  return '';
}

function countNonEmptyLines(value: string) {
  return value.split(/\r?\n/).filter((line) => line.trim()).length;
}

function summarizePlainText(value: string, maxLength: number) {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) {
    return '无输出';
  }

  return clean.length > maxLength ? `${clean.slice(0, maxLength - 3)}...` : clean;
}

function getReadableStructuredToolTitle(name: string) {
  switch (normalizeRuntimeToolName(name)) {
    case 'bashoutput':
      return '读取命令输出';
    case 'killshell':
      return '停止命令';
    case 'taskoutput':
      return '读取任务输出';
    case 'taskcreate':
      return '创建任务';
    case 'taskupdate':
      return '更新任务';
    case 'tasklist':
      return '任务列表';
    case 'taskget':
      return '任务详情';
    default:
      return name;
  }
}

function extractAgentResultFiles(resultText: string) {
  const files: string[] = [];
  const seen = new Set<string>();
  const lines = resultText
    .split(/\r?\n/)
    .map((line) => normalizeAgentResultLine(line))
    .filter(Boolean);

  for (const line of lines) {
    if (!isLikelyFilePath(line) || seen.has(line)) {
      continue;
    }

    seen.add(line);
    files.push(line);
    if (files.length >= 12) {
      break;
    }
  }

  return files;
}

function normalizeAgentResultLine(line: string) {
  return line
    .trim()
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^`+|`+$/g, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

function isLikelyFilePath(value: string) {
  if (!value || value.length > 180 || /\s{2,}/.test(value)) {
    return false;
  }

  return /^(?:[\w.@()[\]-]+[\\/])*[\w .@()[\]-]+\.[A-Za-z0-9]{1,8}$/.test(value);
}

function stripUsageBlock(value: string) {
  return value.replace(/<usage>[\s\S]*?<\/usage>/gi, '').trim();
}

function getUsageSummaryFromText(value?: string) {
  const usageBlockMatch = value?.match(/<usage>([\s\S]*?)<\/usage>/i);
  if (!usageBlockMatch) {
    return '';
  }

  const values = parseUsageBlock(usageBlockMatch[1]);
  const parts: string[] = [];
  if (typeof values.toolUses === 'number') {
    parts.push(`${values.toolUses} tool uses`);
  }
  if (typeof values.totalTokens === 'number') {
    parts.push(formatUsageTokenCount(values.totalTokens));
  }
  if (typeof values.durationMs === 'number') {
    parts.push(formatUsageDuration(values.durationMs));
  }

  return parts.join(' · ');
}

function parseUsageBlock(block: string) {
  const result: {
    totalTokens?: number;
    toolUses?: number;
    durationMs?: number;
  } = {};

  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    const numericValue = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(numericValue)) {
      continue;
    }

    if (key === 'total_tokens') {
      result.totalTokens = numericValue;
      continue;
    }

    if (key === 'tool_uses') {
      result.toolUses = numericValue;
      continue;
    }

    if (key === 'duration_ms') {
      result.durationMs = numericValue;
    }
  }

  return result;
}

function formatUsageTokenCount(value: number) {
  if (value < 1000) {
    return `${value} tokens`;
  }

  const compact = (value / 1000).toFixed(1);
  return `${compact.endsWith('.0') ? compact.slice(0, -2) : compact}k tokens`;
}

function formatUsageDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`);
  }
  parts.push(`${seconds}s`);

  return parts.join(' ');
}

function getTodoWritePreview(tool: ToolStep): TodoWritePreviewData | null {
  if (normalizeRuntimeToolName(tool.name) !== 'todowrite') {
    return null;
  }

  const input = parseToolInput(tool.inputText);
  if (!input || !Array.isArray(input.todos)) {
    return null;
  }

  const todos = input.todos
    .map((item) => normalizeTodoWriteItem(item))
    .filter((item): item is { content: string; status: TodoStatus } => Boolean(item));
  if (todos.length === 0) {
    return null;
  }

  const counts: Record<TodoStatus, number> = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    unknown: 0,
  };
  todos.forEach((todo) => {
    counts[todo.status] += 1;
  });

  return {
    todos,
    counts,
  };
}

function normalizeTodoWriteItem(item: unknown) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const record = item as Record<string, unknown>;
  const content = getStringValue(record.content) ?? getStringValue(record.text) ?? getStringValue(record.title);
  if (!content) {
    return null;
  }

  return {
    content,
    status: normalizeTodoStatus(getStringValue(record.status)),
  };
}

function normalizeTodoStatus(status?: string): TodoStatus {
  switch (status) {
    case 'pending':
    case 'in_progress':
    case 'completed':
      return status;
    default:
      return 'unknown';
  }
}

function formatTodoPreviewSummary(preview: TodoWritePreviewData) {
  return `共 ${preview.todos.length} 个任务，已经完成 ${preview.counts.completed} 个`;
}

function getTodoWriteVisibleResult(resultText?: string) {
  const text = resultText?.trim();
  if (!text) {
    return '';
  }

  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
  if (
    normalized ===
    'todos have been modified successfully. ensure that you continue to use the todo list to track your progress. please proceed with the current tasks if applicable'
  ) {
    return '';
  }

  return text;
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

function getToolAnchoredRequest(
  tool: ToolStep,
  requestCardsByToolId: Map<string, RequestUserInputRequest>,
) {
  const normalizedName = normalizeRuntimeToolName(tool.name);
  if (normalizedName !== 'askuserquestion' && normalizedName !== 'requestuserinput') {
    return null;
  }

  const requestId = tool.toolUseId ?? tool.id;
  return requestCardsByToolId.get(requestId) ?? null;
}

function groupReadToolItems(items: ConversationTurn['items']): DisplayAssistantItem[] {
  const result: DisplayAssistantItem[] = [];
  let pendingReadTools: ToolStep[] = [];

  const flushReadTools = () => {
    if (pendingReadTools.length === 0) {
      return;
    }

    if (pendingReadTools.length === 1) {
      const tool = pendingReadTools[0];
      result.push({
        id: tool.id,
        type: 'tool',
        tool,
      });
    } else {
      result.push({
        id: `read-group-${pendingReadTools.map((tool) => tool.id).join('-')}`,
        type: 'read-group',
        tools: pendingReadTools,
      });
    }

    pendingReadTools = [];
  };

  for (const item of items) {
    if (item.type === 'tool' && isReadTool(item.tool)) {
      pendingReadTools.push(item.tool);
      continue;
    }

    flushReadTools();
    result.push(item);
  }

  flushReadTools();
  return result;
}

function isReadTool(tool: ToolStep) {
  return normalizeRuntimeToolName(tool.name) === 'read';
}

function getReadToolPath(tool: ToolStep) {
  const input = parseToolInput(tool.inputText);
  return input ? getToolInputString(input, ['file_path', 'path']) : undefined;
}

function shouldHideTurnToolStep(turn: ConversationTurn, tool: ToolStep) {
  if (shouldHideToolStep(tool)) {
    return true;
  }

  const normalizedName = normalizeRuntimeToolName(tool.name);
  if (
    normalizedName === 'askuserquestion' ||
    normalizedName === 'requestuserinput' ||
    normalizedName === 'approvalrequest' ||
    normalizedName === 'exitplanmode'
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

function isPlanApprovalRequest(request: ApprovalRequest) {
  return request.title === '计划待确认';
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
    normalized.includes('approval required') ||
    isSecurityPolicyBlockedToolError(normalized)
  );
}

function isSecurityPolicyBlockedToolError(normalized: string) {
  return Boolean(
    normalized &&
      normalized.includes('was blocked') &&
      normalized.includes('for security') &&
      normalized.includes('claude code'),
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

function getStringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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

function buildUserAttachmentPreviewUrl(filePath: string) {
  return `/api/system/image-preview?path=${encodeURIComponent(filePath)}`;
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
