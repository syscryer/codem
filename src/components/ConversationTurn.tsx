import { memo, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PopoverPortal } from './PopoverPortal';
import { ImagePreviewDialog, type ImagePreviewItem } from './ImagePreviewDialog';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import {
  ArrowUpRight,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  CircleDollarSign,
  CircleGauge,
  ClipboardList,
  Copy,
  Eye,
  FilePenLine,
  FileText,
  Folder,
  Globe2,
  Image,
  ListChecks,
  Maximize2,
  Pencil,
  RotateCcw,
  Search,
  Sparkles,
  SquareTerminal,
  Trash2,
  Wrench,
} from 'lucide-react';
import {
  formatDuration,
  hasTurnVisibleOutput,
  shouldHideToolStep,
  summarizeToolRow,
} from '../lib/conversation';
import { buildAgentTaskPreview, isAgentTaskToolName, type AgentTaskPreviewData } from '../lib/agent-task-preview';
import {
  buildChangedFileReviewRequest,
  buildChangedFilesReviewRequests,
  buildConversationUndoChanges,
  type ConversationUndoChange,
} from '../lib/conversation-changed-files';
import { collectConversationOutputFiles, type ConversationOutputFile } from '../lib/conversation-output-files';
import { buildConversationOutputFileListState } from '../lib/conversation-output-file-list';
import { runConversationOutputFileMenuAction } from '../lib/conversation-output-file-interactions';
import { renderMarkdownImage, type MarkdownImagePreviewPayload } from '../lib/markdown-image';
import { renderMarkdownLink } from '../lib/markdown-link';
import { buildConversationOutputFilePreviewRequest, resolveWorkbenchPreviewFilePath } from '../lib/workbench-preview';
import { buildWorkspaceImagePreviewUrl } from '../lib/file-preview-api';
import { deleteProjectFile } from '../lib/project-files-api';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ConversationTurn,
  InputContentBlockSummary,
  ProjectSummary,
  RequestUserInputQuestion,
  RequestUserInputRequest,
  RuntimeRecoveryHint,
  RuntimeSuggestedAction,
  SystemCommandItem,
  ToolStep,
  UserImageAttachment,
  WorkbenchPreviewRequest,
} from '../types';

const CHANGED_FILES_SUMMARY_INITIAL_LIMIT = 8;

function ConversationTurnViewComponent({
  turn,
  nowMs,
  isLiveRunning,
  isLatest,
  previousTurns,
  canUndoChangedFiles,
  activeProject,
  collapseIntermediateProcess,
  thinkingLabel,
  onOpenWorkbenchPreview,
  onOpenOutputPath,
  onRevealOutputPath,
  onUndoChangedFiles,
  onSubmitRequestUserInput,
  onSubmitRuntimeRecoveryAction,
  onSubmitApprovalDecision,
  onEditUserMessage,
  onDeleteTurn,
  onRegenerateTurn,
}: {
  turn: ConversationTurn;
  nowMs: number;
  isLiveRunning: boolean;
  isLatest: boolean;
  previousTurns: ConversationTurn[];
  canUndoChangedFiles: boolean;
  activeProject: ProjectSummary | null;
  collapseIntermediateProcess: boolean;
  thinkingLabel: string;
  onOpenWorkbenchPreview: (request: WorkbenchPreviewRequest) => void;
  onOpenOutputPath: (path: string) => Promise<void>;
  onRevealOutputPath: (path: string) => Promise<void>;
  onUndoChangedFiles: (turn: ConversationTurn, changes: ConversationUndoChange[]) => void;
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
  onEditUserMessage?: (turn: ConversationTurn) => void;
  onDeleteTurn?: (turn: ConversationTurn) => void;
  onRegenerateTurn?: (turn: ConversationTurn) => void;
}) {
  const [imagePreview, setImagePreview] = useState<ImagePreviewItem | null>(null);
  const [intermediateProcessExpanded, setIntermediateProcessExpanded] = useState(false);
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
    if (item.type === 'text' || item.type === 'thinking' || item.type === 'system-command') {
      return true;
    }

    return !shouldHideTurnToolStep(turn, item.tool) || Boolean(getToolAnchoredRequest(item.tool, requestCardsByToolId));
  });
  const groupedVisibleItems = useMemo(() => groupToolItems(visibleItems), [visibleItems]);
  const shouldCollapseIntermediateItems = collapseIntermediateProcess && !running;
  const intermediateItems = shouldCollapseIntermediateItems
    ? groupedVisibleItems.filter(isIntermediateAssistantItem)
    : [];
  const narrativeItems = shouldCollapseIntermediateItems
    ? groupedVisibleItems.filter((item) => !isIntermediateAssistantItem(item))
    : groupedVisibleItems;
  const canToggleIntermediateProcess = shouldCollapseIntermediateItems && intermediateItems.length > 0;
  const changedFileGroups = useMemo(() => collectConversationChangedFileGroups(turn.tools), [turn.tools]);
  const outputFiles = useMemo(() => collectConversationOutputFiles(turn.tools), [turn.tools]);
  const undoChanges = useMemo(
    () => buildConversationUndoChanges(turn.tools, activeProject?.path ?? turn.workspace, previousTurns),
    [activeProject?.path, previousTurns, turn.tools, turn.workspace],
  );
  const showProgressLine =
    running ||
    turn.status === 'stopped' ||
    turn.status === 'error' ||
    canToggleIntermediateProcess ||
    Boolean(turn.durationMs || turn.outputTokens || turn.inputTokens);
  const showLeadingProgressLine = showProgressLine && !running;
  const showTrailingProgressLine = showProgressLine && running;

  const assistantCopyText = getAssistantCopyText(turn);
  const messageTime = formatMessageTime(turn.startedAtMs);
  const showAssistantActions = Boolean(assistantCopyText || messageTime || onRegenerateTurn);
  const hasUserText = Boolean(turn.userText.trim());
  const hasUserContentBlocks = Boolean(turn.userContentBlocks?.length);
  const hasUserAttachments = Boolean(turn.userAttachments?.length);

  return (
    <article className={`turn ${isLatest ? 'latest-turn' : ''}`}>
      <section className="message user-message">
        <div className="message-label">You</div>
        <div className="user-message-content">
          {hasUserContentBlocks ? (
            <UserContentBlocks blocks={turn.userContentBlocks ?? []} onPreviewImage={setImagePreview} />
          ) : hasUserAttachments ? (
            <UserAttachmentGallery
              attachments={turn.userAttachments ?? []}
              onPreviewImage={setImagePreview}
            />
          ) : null}
          {hasUserText ? <div className="message-body preserve-format">{turn.userText}</div> : null}
          {hasUserText || messageTime ? (
            <div className="turn-actions user-turn-actions" aria-label="用户消息操作">
              {hasUserText ? <InlineCopyButton text={turn.userText} title="复制消息" /> : null}
              {onEditUserMessage && !running ? (
                <button
                  type="button"
                  className="inline-copy-button"
                  title="编辑并重新发送"
                  aria-label="编辑并重新发送"
                  onClick={() => onEditUserMessage(turn)}
                >
                  <Pencil size={14} />
                </button>
              ) : null}
              {onDeleteTurn && !running ? (
                <button
                  type="button"
                  className="inline-copy-button"
                  title="删除这一轮"
                  aria-label="删除这一轮"
                  onClick={() => onDeleteTurn(turn)}
                >
                  <Trash2 size={14} />
                </button>
              ) : null}
              {messageTime ? <span className="turn-time">{messageTime}</span> : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="message assistant-message">
        <div className="message-label" title={turn.modelName || turn.modelId}>
          {turn.providerName || 'Claude'}
        </div>
        <div className="assistant-content">
          {showLeadingProgressLine ? (
            <TurnProgressLine
              turn={turn}
              nowMs={nowMs}
              isLiveRunning={isLiveRunning}
              compact
              intermediateProcessExpanded={intermediateProcessExpanded}
              canToggleIntermediateProcess={canToggleIntermediateProcess}
              onToggleIntermediateProcess={() => setIntermediateProcessExpanded((expanded) => !expanded)}
            />
          ) : null}

          {intermediateItems.length > 0 && intermediateProcessExpanded ? (
            <IntermediateProcessBody
              items={intermediateItems}
              turn={turn}
              turnInFlight={running}
              requestCardsByToolId={requestCardsByToolId}
              onOpenWorkbenchPreview={onOpenWorkbenchPreview}
              onSubmitRequestUserInput={onSubmitRequestUserInput}
              onPreviewImage={setImagePreview}
              thinkingLabel={thinkingLabel}
            />
          ) : null}

          {narrativeItems.length > 0 ? (
            narrativeItems.map((item) => renderAssistantItem({
              item,
              turn,
              turnInFlight: running,
              requestCardsByToolId,
              onOpenWorkbenchPreview,
              onSubmitRequestUserInput,
              onPreviewImage: setImagePreview,
              thinkingLabel,
            }))
          ) : (
            running ? (
              null
            ) : null
          )}

          {showTrailingProgressLine ? (
            <TurnProgressLine turn={turn} nowMs={nowMs} isLiveRunning={isLiveRunning} compact />
          ) : null}

          {outputFiles.length > 0 ? (
            <ConversationOutputFilesCard
              files={outputFiles}
              onOpenWorkbenchPreview={onOpenWorkbenchPreview}
              onOpenOutputPath={onOpenOutputPath}
              onRevealOutputPath={onRevealOutputPath}
            />
          ) : null}

          {changedFileGroups.length > 0 ? (
            <ChangedFilesSummaryCard
              files={changedFileGroups}
              canUndo={canUndoChangedFiles}
              activeProject={activeProject}
              onReview={() => {
                const requests = buildChangedFilesReviewRequests(changedFileGroups);
                requests.forEach((request) => onOpenWorkbenchPreview(request));
              }}
              onReviewFile={(file) => {
                const request = buildChangedFileReviewRequest(file);
                if (request) {
                  onOpenWorkbenchPreview(request);
                }
              }}
              onOpenOutputPath={onOpenOutputPath}
              onRevealOutputPath={onRevealOutputPath}
              onUndo={() => onUndoChangedFiles(turn, undoChanges)}
            />
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

          {turn.citations?.length ? <KnowledgeCitations citations={turn.citations} /> : null}

          {showAssistantActions ? (
            <div className="turn-actions" aria-label="消息操作">
              {assistantCopyText ? <InlineCopyButton text={assistantCopyText} title="复制回复" /> : null}
              {onRegenerateTurn && !running ? (
                <button
                  type="button"
                  className="inline-copy-button"
                  title={turn.status === 'error' ? '重试' : '按原模型重新生成'}
                  aria-label={turn.status === 'error' ? '重试' : '按原模型重新生成'}
                  onClick={() => onRegenerateTurn(turn)}
                >
                  <RotateCcw size={14} />
                </button>
              ) : null}
              {messageTime ? <span className="turn-time">{messageTime}</span> : null}
            </div>
          ) : null}
        </div>
      </section>

      {imagePreview ? <ImagePreviewDialog preview={imagePreview} onClose={() => setImagePreview(null)} /> : null}
    </article>
  );
}

function KnowledgeCitations({ citations }: { citations: NonNullable<ConversationTurn['citations']> }) {
  return (
    <details className="knowledge-citations">
      <summary>
        <BookOpen size={14} aria-hidden="true" />
        <span>知识库来源</span>
        <small>{citations.length}</small>
      </summary>
      <div className="knowledge-citation-list">
        {citations.map((citation, index) => (
          <div key={`${citation.sourceId}-${citation.chunkIndex}-${index}`} className="knowledge-citation-item">
            <div className="knowledge-citation-head">
              <strong>[来源 {index + 1}] {citation.sourceName}</strong>
              <small>{Math.round(citation.score * 100)}%</small>
            </div>
            {citation.sourcePath ? <span className="knowledge-citation-path">{citation.sourcePath}</span> : null}
            <p>{citation.content}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

function TurnProgressLine({
  turn,
  nowMs,
  isLiveRunning,
  compact = false,
  intermediateProcessExpanded = false,
  canToggleIntermediateProcess = false,
  onToggleIntermediateProcess,
}: {
  turn: ConversationTurn;
  nowMs: number;
  isLiveRunning: boolean;
  compact?: boolean;
  intermediateProcessExpanded?: boolean;
  canToggleIntermediateProcess?: boolean;
  onToggleIntermediateProcess?: () => void;
}) {
  const running = isTurnInFlight(turn, isLiveRunning);
  const text = formatTurnProgress(turn, running ? nowMs : undefined, isLiveRunning);
  const className = `working-line tui-progress ${compact ? 'compact' : ''} ${running ? 'running' : ''} ${
    canToggleIntermediateProcess ? 'can-toggle-intermediate' : ''
  }`;
  const content = (
    <>
      <TurnProgressIcon turn={turn} running={running} />
      <span className="tui-progress-text">{text}</span>
      {canToggleIntermediateProcess ? (
        <ChevronDown
          className={`progress-collapse-chevron ${intermediateProcessExpanded ? 'expanded' : ''}`}
          size={14}
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  if (canToggleIntermediateProcess) {
    return (
      <button
        type="button"
        className={className}
        aria-expanded={intermediateProcessExpanded}
        title={intermediateProcessExpanded ? '收起中间过程' : '展开中间过程'}
        onClick={onToggleIntermediateProcess}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={className}>{content}</div>
  );
}

function TurnProgressIcon({ turn, running }: { turn: ConversationTurn; running: boolean }) {
  const Icon =
    turn.status === 'error'
      ? Wrench
      : turn.phase === 'tool'
        ? SquareTerminal
        : turn.phase === 'thinking'
          ? Sparkles
          : running
            ? CircleGauge
            : Check;

  return (
    <span className="execution-type-icon progress-type-icon" aria-hidden="true">
      <Icon size={13} />
    </span>
  );
}

function MarkdownMessage({
  content,
  onPreviewImage,
}: {
  content: string;
  onPreviewImage: (preview: MarkdownImagePreviewPayload) => void;
}) {
  return (
    <div className="message-body markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, title, children }) {
            return renderMarkdownLink({ href, title, children });
          },
          img({ src, alt, title }) {
            return renderMarkdownImage({ src, alt, title, onPreview: onPreviewImage });
          },
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

function ThinkingMessage({ content, label }: { content: string; label: string }) {
  const cleanContent = content.trim();
  if (!cleanContent) {
    return null;
  }

  return (
    <details className="thinking-message">
      <summary>
        <span className="execution-type-icon thinking-type-icon" aria-hidden="true">
          <Sparkles size={13} />
        </span>
        <span>{label}</span>
        <span className="thinking-count">{formatThinkingLength(cleanContent)}</span>
      </summary>
      <pre>{cleanContent}</pre>
    </details>
  );
}

function SystemCommandCard({
  item,
  onPreviewImage,
}: {
  item: SystemCommandItem;
  onPreviewImage: (preview: ImagePreviewItem) => void;
}) {
  const detailText = formatSystemCommandDetails(item.details);
  const Icon = getSystemCommandIcon(item.cardType);

  return (
    <section className={`system-command-card is-${item.state}`}>
      <div className="system-command-card-head">
        <div className="system-command-card-heading">
          <strong>
            <span className="execution-type-icon system-command-icon" aria-hidden="true">
              <Icon size={13} />
            </span>
            <span>{item.title}</span>
          </strong>
          {shouldShowSystemCommandCode(item) ? <code>{item.command}</code> : null}
        </div>
        <span className="system-command-card-state">{formatSystemCommandState(item.state)}</span>
      </div>
      {item.summary ? <div className="system-command-card-summary preserve-format">{item.summary}</div> : null}
      {item.attachments?.length ? (
        <UserAttachmentGallery attachments={item.attachments} onPreviewImage={onPreviewImage} />
      ) : null}
      {item.errorMessage ? <div className="system-command-card-error preserve-format">{item.errorMessage}</div> : null}
      {detailText ? (
        <details className="system-command-card-details">
          <summary>详情</summary>
          <pre>{detailText}</pre>
        </details>
      ) : null}
    </section>
  );
}

function shouldShowSystemCommandCode(item: SystemCommandItem) {
  return item.command !== 'guide';
}

export const ConversationTurnView = memo(ConversationTurnViewComponent);

function UserContentBlocks({
  blocks,
  onPreviewImage,
}: {
  blocks: InputContentBlockSummary[];
  onPreviewImage: (preview: ImagePreviewItem) => void;
}) {
  // file_reference 分两种来源：'mention'（@文件，路径已体现在 prompt 文本里）保持隐藏；
  // 'attachment'（桌面端拖拽 / 文件框选择的文件）需要显示成附件卡片。
  const visibleBlocks = blocks.filter((block) => {
    if (block.type === 'text') {
      return false;
    }
    if (block.type === 'file_reference') {
      return block.source === 'attachment';
    }
    return true;
  });
  if (visibleBlocks.length === 0) {
    return null;
  }

  return (
    <div className="user-message-attachments" aria-label="用户附件">
      {visibleBlocks.map((block, index) => {
        if (block.type === 'image' && block.path) {
          const imagePath = block.path;
          return (
            <figure key={`${block.type}-${index}`} className="user-message-attachment">
              <button
                type="button"
                className="user-message-attachment-button"
                aria-label={`预览图片：${block.name || '图片附件'}`}
                onClick={() =>
                  onPreviewImage({
                    src: buildUserAttachmentPreviewUrl(imagePath),
                    alt: block.name || '图片附件',
                    title: block.name || undefined,
                  })
                }
              >
                <img
                  src={buildUserAttachmentPreviewUrl(imagePath)}
                  alt={block.name || '图片附件'}
                  className="user-message-attachment-preview"
                  loading="lazy"
                />
              </button>
            </figure>
          );
        }

        return (
          <figure key={`${block.type}-${index}`} className="user-message-attachment user-message-attachment-file-card">
            <div className="user-message-attachment-file">
              <strong className="user-message-attachment-file-name" title={'name' in block ? block.name : '附件'}>
                {'name' in block ? block.name : '附件'}
              </strong>
            </div>
          </figure>
        );
      })}
    </div>
  );
}

function UserAttachmentGallery({
  attachments,
  onPreviewImage,
}: {
  attachments: UserImageAttachment[];
  onPreviewImage: (preview: ImagePreviewItem) => void;
}) {
  return (
    <div className="user-message-attachments" aria-label="用户图片附件">
      {attachments.map((attachment) => (
        <figure key={attachment.id} className="user-message-attachment">
          <button
            type="button"
            className="user-message-attachment-button"
            aria-label={`预览图片：${attachment.name || '图片附件'}`}
            onClick={() =>
              onPreviewImage({
                src: buildUserAttachmentPreviewUrl(attachment.path),
                alt: attachment.name || '图片附件',
                title: attachment.name || undefined,
              })
            }
          >
            <img
              src={buildUserAttachmentPreviewUrl(attachment.path)}
              alt={attachment.name || '图片附件'}
              className="user-message-attachment-preview"
              loading="lazy"
            />
          </button>
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
  | { id: string; type: 'tool-group'; variant: 'read' | 'generic'; tools: ToolStep[] };

type AssistantItemRenderProps = {
  item: DisplayAssistantItem;
  turn: ConversationTurn;
  turnInFlight: boolean;
  requestCardsByToolId: Map<string, RequestUserInputRequest>;
  onOpenWorkbenchPreview: (request: WorkbenchPreviewRequest) => void;
  onSubmitRequestUserInput: (
    turn: ConversationTurn,
    request: RequestUserInputRequest,
    answers: Record<string, string>,
  ) => Promise<boolean>;
  onPreviewImage: (preview: ImagePreviewItem) => void;
  thinkingLabel: string;
};

function isIntermediateAssistantItem(item: DisplayAssistantItem) {
  return item.type === 'thinking' || item.type === 'tool' || item.type === 'tool-group';
}

function IntermediateProcessBody({
  items,
  turn,
  turnInFlight,
  requestCardsByToolId,
  onOpenWorkbenchPreview,
  onSubmitRequestUserInput,
  onPreviewImage,
  thinkingLabel,
}: Omit<AssistantItemRenderProps, 'item'> & {
  items: DisplayAssistantItem[];
}) {
  return (
    <div className="intermediate-process-body">
      {items.map((item) => renderAssistantItem({
        item,
        turn,
        turnInFlight,
        requestCardsByToolId,
        onOpenWorkbenchPreview,
        onSubmitRequestUserInput,
        onPreviewImage,
        thinkingLabel,
      }))}
    </div>
  );
}

function renderAssistantItem({
  item,
  turn,
  turnInFlight,
  requestCardsByToolId,
  onOpenWorkbenchPreview,
  onSubmitRequestUserInput,
  onPreviewImage,
  thinkingLabel,
}: AssistantItemRenderProps) {
  if (item.type === 'text') {
    return (
      <MarkdownMessage
        key={item.id}
        content={item.text}
        onPreviewImage={onPreviewImage}
      />
    );
  }

  if (item.type === 'thinking') {
    return <ThinkingMessage key={item.id} content={item.text} label={thinkingLabel} />;
  }

  if (item.type === 'system-command') {
    return <SystemCommandCard key={item.id} item={item} onPreviewImage={onPreviewImage} />;
  }

  if (item.type === 'tool-group') {
    return <ToolStepsGroup key={item.id} tools={item.tools} variant={item.variant} />;
  }

  return (
    <ToolItemWithAnchoredCards
      key={item.id}
      tool={item.tool}
      turn={turn}
      turnInFlight={turnInFlight}
      requestCardsByToolId={requestCardsByToolId}
      onOpenWorkbenchPreview={onOpenWorkbenchPreview}
      onSubmitRequestUserInput={onSubmitRequestUserInput}
    />
  );
}

function ToolStepsGroup({ tools, variant }: { tools: ToolStep[]; variant: 'read' | 'generic' }) {
  const [expanded, setExpanded] = useState(false);
  const status = tools.some((tool) => tool.status === 'error')
    ? 'error'
    : tools.some((tool) => tool.status === 'running')
      ? 'running'
      : 'done';
  const summary = variant === 'read' ? getReadGroupSummary(tools) : getGenericToolGroupSummary(tools);
  const title = variant === 'read' ? `批量读取 ${tools.length} 个文件` : `批量工具调用 ${tools.length} 项`;

  return (
    <div className={`tool-step read-group-step tool-${status}`}>
      <button
        type="button"
        className="tool-preview-summary read-group-summary"
        onClick={() => setExpanded((current) => !current)}
      >
        <ToolTypeIcon toolName={variant === 'read' ? 'Read' : 'Bash'} />
        <div className="tool-preview-summary-main read-group-summary-main">
          <span className="read-group-title">{title}</span>
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

function getReadGroupSummary(tools: ToolStep[]) {
  const fileNames = tools
    .map((tool) => getReadToolPath(tool))
    .filter((filePath): filePath is string => Boolean(filePath))
    .map((filePath) => getFileName(filePath));
  return fileNames.length
    ? fileNames.slice(0, 3).join('、') + (fileNames.length > 3 ? ` 等 ${fileNames.length} 个文件` : '')
    : `${tools.length} 个文件`;
}

function getGenericToolGroupSummary(tools: ToolStep[]) {
  const names = tools.map((tool) => getReadableToolGroupName(tool.name));
  const counts = new Map<string, number>();
  for (const name of names) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => (count > 1 ? `${name} x${count}` : name))
    .slice(0, 4)
    .join('、') || `${tools.length} 项`;
}

function ToolItemWithAnchoredCards({
  tool,
  turn,
  turnInFlight,
  requestCardsByToolId,
  onOpenWorkbenchPreview,
  onSubmitRequestUserInput,
}: {
  tool: ToolStep;
  turn: ConversationTurn;
  turnInFlight: boolean;
  requestCardsByToolId: Map<string, RequestUserInputRequest>;
  onOpenWorkbenchPreview: (request: WorkbenchPreviewRequest) => void;
  onSubmitRequestUserInput: (
    turn: ConversationTurn,
    request: RequestUserInputRequest,
    answers: Record<string, string>,
  ) => Promise<boolean>;
}) {
  const request = getToolAnchoredRequest(tool, requestCardsByToolId);

  return (
    <>
      {!shouldHideTurnToolStep(turn, tool) ? (
        <ToolStepRow tool={tool} onOpenWorkbenchPreview={onOpenWorkbenchPreview} />
      ) : null}
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

function ToolStepRow({
  tool,
  onOpenWorkbenchPreview,
}: {
  tool: ToolStep;
  onOpenWorkbenchPreview?: (request: WorkbenchPreviewRequest) => void;
}) {
  const preview = useMemo(() => getToolPreview(tool), [tool]);
  const todoPreview = useMemo(() => getTodoWritePreview(tool), [tool]);
  const agentPreview = useMemo(() => buildAgentTaskPreview(tool), [tool]);
  const structuredPreview = useMemo(() => getStructuredToolPreview(tool), [tool]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (agentPreview) {
    return <AgentTaskPreview tool={tool} preview={agentPreview} />;
  }

  if (todoPreview) {
    return <TodoWritePreview tool={tool} preview={todoPreview} />;
  }

  if (preview) {
    return (
      <CompactToolPreview
        tool={tool}
        preview={preview}
        onOpenWorkbenchPreview={onOpenWorkbenchPreview}
      />
    );
  }

  if (structuredPreview) {
    return <StructuredToolPreview tool={tool} preview={structuredPreview} />;
  }

  const hasDetails = Boolean(preview || tool.inputText?.trim() || tool.resultText?.trim());
  const summary = getToolSummary(tool, preview);
  const displayTitle = tool.title;

  return (
    <div className={`tool-step tool-${tool.status}`}>
      {hasDetails ? (
        <details className="tool-details tool-details-inline" onToggle={(event) => setDetailsOpen((event.target as HTMLDetailsElement).open)}>
          <summary className="tool-inline-summary">
            <ToolTypeIcon toolName={tool.name} />
            <span className="tool-title">{displayTitle}</span>
            {summary ? <span className="tool-subtitle">{summary}</span> : null}
          </summary>
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
          {detailsOpen && preview ? (
            <ToolPreviewPanel
              preview={preview}
              onOpenWorkbenchPreview={onOpenWorkbenchPreview}
            />
          ) : null}
        </details>
      ) : (
        <div className="tool-step-main">
          <ToolTypeIcon toolName={tool.name} />
          <div>
            <div className="tool-title">{displayTitle}</div>
            {summary ? <div className="tool-subtitle">{summary}</div> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function CompactToolPreview({
  tool,
  preview,
  onOpenWorkbenchPreview,
}: {
  tool: ToolStep;
  preview: ToolPreview;
  onOpenWorkbenchPreview?: (request: WorkbenchPreviewRequest) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`tool-step tool-preview-step tool-${tool.status}`}>
      <div className="tool-preview-summary-row">
        <button
          type="button"
          className="tool-preview-summary"
          onClick={() => setExpanded((current) => !current)}
        >
          <ToolTypeIcon toolName={tool.name} />
          <div className="tool-preview-summary-main">
            <span className="tool-preview-kind">{getToolPreviewTitle(preview)}</span>
            {preview.additions > 0 ? <span className="tool-preview-add">+{preview.additions}</span> : null}
            {preview.deletions > 0 ? <span className="tool-preview-del">-{preview.deletions}</span> : null}
            <span className="tool-preview-name">{preview.fileName}</span>
          </div>
          <span className={`tool-preview-chevron ${expanded ? 'expanded' : ''}`}>{'>'}</span>
        </button>
      </div>
      {expanded ? (
        <ToolPreviewPanel
          preview={preview}
          onOpenWorkbenchPreview={onOpenWorkbenchPreview}
        />
      ) : null}
    </div>
  );
}

function ToolPreviewPanel({
  preview,
  onOpenWorkbenchPreview,
}: {
  preview: ToolPreview;
  onOpenWorkbenchPreview?: (request: WorkbenchPreviewRequest) => void;
}) {
  const request = buildConversationToolReviewRequest(preview);

  return (
    <div className="tool-preview-card">
      <div className="tool-preview-card-head">
        <span className="tool-preview-file">{preview.fileName}</span>
        <div className="tool-preview-card-actions">
          <div className="tool-preview-stats">
            {preview.additions > 0 ? <span className="tool-preview-add">+{preview.additions}</span> : null}
            {preview.deletions > 0 ? <span className="tool-preview-del">-{preview.deletions}</span> : null}
          </div>
          {request && onOpenWorkbenchPreview ? (
            <button
              type="button"
              className="tool-preview-link-button"
              onClick={() => onOpenWorkbenchPreview(request)}
            >
              审查
            </button>
          ) : null}
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

function ConversationOutputFilesCard({
  files,
  onOpenWorkbenchPreview,
  onOpenOutputPath,
  onRevealOutputPath,
}: {
  files: ConversationOutputFile[];
  onOpenWorkbenchPreview: (request: WorkbenchPreviewRequest) => void;
  onOpenOutputPath: (path: string) => Promise<void>;
  onRevealOutputPath: (path: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const listState = useMemo(
    () => buildConversationOutputFileListState(files, expanded),
    [expanded, files],
  );

  return (
    <section className="conversation-output-files-card">
      <div className="conversation-output-files-list">
        {listState.visibleFiles.map((file) => (
          <ConversationOutputFileCard
            key={file.path}
            file={file}
            onOpenWorkbenchPreview={onOpenWorkbenchPreview}
            onOpenOutputPath={onOpenOutputPath}
            onRevealOutputPath={onRevealOutputPath}
          />
        ))}
      </div>
      {listState.showToggle ? (
        <button
          type="button"
          className="conversation-output-files-toggle"
          onClick={() => setExpanded((current) => !current)}
        >
          <span>{listState.toggleLabel}</span>
          <ChevronDown className={expanded ? 'expanded' : ''} size={16} />
        </button>
      ) : null}
    </section>
  );
}

function ConversationOutputFileCard({
  file,
  onOpenWorkbenchPreview,
  onOpenOutputPath,
  onRevealOutputPath,
}: {
  file: ConversationOutputFile;
  onOpenWorkbenchPreview: (request: WorkbenchPreviewRequest) => void;
  onOpenOutputPath: (path: string) => Promise<void>;
  onRevealOutputPath: (path: string) => Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const canPreviewInWorkbench = file.openMode === 'preview';

  useOutsideDismiss({
    selectors: [
      {
        selector: '.conversation-output-file-menu',
        onDismiss: () => {
          setMenuOpen(false);
          setContextMenu(null);
        },
        anchorRefs: [menuButtonRef],
      },
    ],
  });

  function closeMenus() {
    setMenuOpen(false);
    setContextMenu(null);
  }

  function openInWorkbenchPreview() {
    onOpenWorkbenchPreview(buildConversationOutputFilePreviewRequest({
      path: file.path,
      name: file.name,
      type: 'file',
    }));
  }

  function handlePrimaryOpen() {
    if (file.openMode === 'preview') {
      openInWorkbenchPreview();
      return;
    }

    void onOpenOutputPath(file.path);
  }

  async function handleCopyPath() {
    try {
      await navigator.clipboard.writeText(file.path);
    } finally {
      closeMenus();
    }
  }

  return (
    <article
      className="conversation-output-file-item"
      role="button"
      tabIndex={0}
      onClick={handlePrimaryOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handlePrimaryOpen();
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(false);
        setContextMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <div className="conversation-output-file-icon" aria-hidden="true">
        <FileText size={22} />
      </div>
      <div className="conversation-output-file-main">
        <div className="conversation-output-file-name" title={file.name}>{file.name}</div>
        <div className="conversation-output-file-subtitle">{file.subtitle}</div>
      </div>
      <button
        ref={menuButtonRef}
        type="button"
        className="conversation-output-file-menu-button"
        aria-haspopup="menu"
        aria-expanded={menuOpen || Boolean(contextMenu)}
        onClick={(event) => {
          runConversationOutputFileMenuAction(event, () => {
            setContextMenu(null);
            setMenuOpen((current) => !current);
          });
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
        }}
      >
        <span>打开方式</span>
        <ChevronDown size={14} />
      </button>
      <PopoverPortal
        open={menuOpen || Boolean(contextMenu)}
        anchorRef={menuButtonRef}
        virtualAnchor={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        placement="bottom-end"
        offset={8}
      >
        <div
          className="workspace-menu conversation-output-file-menu"
          role="menu"
          aria-label={`文件操作 ${file.name}`}
          onClick={(event) => {
            event.stopPropagation();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
          }}
        >
          {canPreviewInWorkbench ? (
            <button
              type="button"
              className="workspace-menu-item conversation-output-file-menu-item"
              role="menuitem"
              onClick={(event) => {
                runConversationOutputFileMenuAction(event, () => {
                  openInWorkbenchPreview();
                  closeMenus();
                });
              }}
            >
              <Maximize2 size={14} />
              <span>在右侧预览</span>
            </button>
          ) : null}
          <button
            type="button"
            className="workspace-menu-item conversation-output-file-menu-item"
            role="menuitem"
            onClick={(event) => {
              runConversationOutputFileMenuAction(event, () => {
                void onOpenOutputPath(file.path);
                closeMenus();
              });
            }}
          >
            <ArrowUpRight size={14} />
            <span>用默认应用打开</span>
          </button>
          <button
            type="button"
            className="workspace-menu-item conversation-output-file-menu-item"
            role="menuitem"
            onClick={(event) => {
              runConversationOutputFileMenuAction(event, () => {
                void onRevealOutputPath(file.path);
                closeMenus();
              });
            }}
          >
            <Folder size={14} />
            <span>在文件浏览器打开</span>
          </button>
          <button
            type="button"
            className="workspace-menu-item conversation-output-file-menu-item"
            role="menuitem"
            onClick={(event) => {
              runConversationOutputFileMenuAction(event, () => {
                void handleCopyPath();
              });
            }}
          >
            <Copy size={14} />
            <span>复制路径</span>
          </button>
        </div>
      </PopoverPortal>
    </article>
  );
}

function ChangedFilesSummaryCard({
  files,
  canUndo,
  activeProject,
  onReview,
  onReviewFile,
  onOpenOutputPath,
  onRevealOutputPath,
  onUndo,
}: {
  files: ChangedFilePreviewGroup[];
  canUndo: boolean;
  activeProject: ProjectSummary | null;
  onReview: () => void;
  onReviewFile: (file: ChangedFilePreviewGroup) => void;
  onOpenOutputPath: (path: string) => Promise<void>;
  onRevealOutputPath: (path: string) => Promise<void>;
  onUndo: () => void;
}) {
  const [expandedFilePaths, setExpandedFilePaths] = useState<string[]>([]);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [hiddenDeletedFilePaths, setHiddenDeletedFilePaths] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<{
    file: ChangedFilePreviewGroup;
    x: number;
    y: number;
  } | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const visibleFiles = useMemo(
    () => files.filter((file) => !hiddenDeletedFilePaths.includes(file.path)),
    [files, hiddenDeletedFilePaths],
  );
  const renderedFiles = showAllFiles ? visibleFiles : visibleFiles.slice(0, CHANGED_FILES_SUMMARY_INITIAL_LIMIT);
  const hiddenFilesCount = Math.max(0, visibleFiles.length - renderedFiles.length);
  const totals = useMemo(
    () =>
      visibleFiles.reduce(
        (summary, file) => ({
          additions: summary.additions + file.additions,
          deletions: summary.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [visibleFiles],
  );

  useOutsideDismiss({
    refs: [
      { ref: contextMenuRef, onDismiss: () => setContextMenu(null) },
    ],
  });

  useEffect(() => {
    setExpandedFilePaths((current) => {
      const validPaths = new Set(visibleFiles.map((file) => file.path));
      return current.filter((filePath) => validPaths.has(filePath));
    });
  }, [visibleFiles]);

  useEffect(() => {
    setHiddenDeletedFilePaths((current) => {
      const validPaths = new Set(files.map((file) => file.path));
      return current.filter((filePath) => validPaths.has(filePath));
    });
  }, [files]);

  useEffect(() => {
    if (visibleFiles.length <= CHANGED_FILES_SUMMARY_INITIAL_LIMIT) {
      setShowAllFiles(false);
    }
  }, [visibleFiles.length]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    }

    function handleResize() {
      setContextMenu(null);
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [contextMenu]);

  function toggleFile(filePath: string) {
    setExpandedFilePaths((current) =>
      current.includes(filePath)
        ? current.filter((item) => item !== filePath)
        : [...current, filePath],
    );
  }

  function resolveFileFullPath(file: ChangedFilePreviewGroup) {
    return activeProject ? resolveWorkbenchPreviewFilePath(activeProject.path, file.path) : file.path;
  }

  function openFileContextMenu(event: ReactMouseEvent<HTMLElement>, file: ChangedFilePreviewGroup) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      file,
      x: event.clientX,
      y: event.clientY,
    });
  }

  async function copyChangedFilePath(file: ChangedFilePreviewGroup, fullPath: boolean) {
    setContextMenu(null);
    await navigator.clipboard.writeText(fullPath ? resolveFileFullPath(file) : file.path);
  }

  async function deleteChangedFile(file: ChangedFilePreviewGroup) {
    if (!activeProject) {
      setContextMenu(null);
      return;
    }

    const confirmed = window.confirm(`确认删除文件「${file.path}」？\n\n该操作会从磁盘删除。`);
    if (!confirmed) {
      return;
    }

    setContextMenu(null);
    await deleteProjectFile(activeProject.id, file.path);
    setHiddenDeletedFilePaths((current) => current.includes(file.path) ? current : [...current, file.path]);
  }

  if (visibleFiles.length === 0) {
    return null;
  }

  return (
    <section ref={cardRef} className="changed-files-summary-card">
      <header className="changed-files-summary-head">
        <div className="changed-files-summary-title">
          <strong>{visibleFiles.length} 个文件已更改</strong>
          {totals.additions > 0 ? <span className="tool-preview-add">+{totals.additions}</span> : null}
          {totals.deletions > 0 ? <span className="tool-preview-del">-{totals.deletions}</span> : null}
        </div>
        <div className="changed-files-summary-actions" aria-label="文件汇总操作">
          {canUndo ? (
            <button type="button" className="tool-preview-open-button" onClick={onUndo}>
              <RotateCcw size={14} />
              撤销
            </button>
          ) : null}
          <button type="button" className="tool-preview-open-button" onClick={onReview}>
            审查
            <ArrowUpRight size={14} />
          </button>
        </div>
      </header>
      <div className="changed-files-summary-list">
        {renderedFiles.map((file) => {
          const expanded = expandedFilePaths.includes(file.path);

          return (
            <article key={file.path} className={`changed-file-block${expanded ? ' expanded' : ''}`}>
              <div className="changed-files-summary-row-shell">
                <div
                  className="changed-files-summary-row"
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  onClick={() => toggleFile(file.path)}
                  onContextMenu={(event) => openFileContextMenu(event, file)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggleFile(file.path);
                    }
                  }}
                >
                  <span className="changed-files-summary-path">{formatChangedFilePath(file.path)}</span>
                  <button
                    type="button"
                    className="changed-file-review-button"
                    aria-label={`审查文件 ${file.path}`}
                    title="审查此文件"
                    onClick={(event) => {
                      event.stopPropagation();
                      onReviewFile(file);
                    }}
                  >
                    <ClipboardList size={14} />
                  </button>
                  <span className="changed-files-summary-stats">
                    {file.additions > 0 ? <span className="tool-preview-add">+{file.additions}</span> : null}
                    {file.deletions > 0 ? <span className="tool-preview-del">-{file.deletions}</span> : null}
                  </span>
                  <ChevronDown className="changed-file-chevron" size={16} aria-hidden="true" />
                </div>
              </div>
              {expanded ? <ChangedFileInlineDiff file={file} /> : null}
            </article>
          );
        })}
      </div>
      {hiddenFilesCount > 0 || showAllFiles ? (
        <button
          type="button"
          className="changed-files-summary-more"
          onClick={() => setShowAllFiles((current) => !current)}
        >
          {showAllFiles ? '收起文件列表' : `展开剩余 ${hiddenFilesCount} 个文件`}
          <ChevronDown className={showAllFiles ? 'expanded' : ''} size={15} aria-hidden="true" />
        </button>
      ) : null}
      <PopoverPortal
        open={Boolean(contextMenu)}
        anchorRef={cardRef}
        virtualAnchor={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        placement="bottom-start"
        offset={0}
      >
        <div
          ref={contextMenuRef}
          className="workspace-menu changed-files-summary-menu"
          role="menu"
          aria-label="审查文件菜单"
        >
          <button
            type="button"
            className="workspace-menu-item"
            role="menuitem"
            onClick={() => {
              if (!contextMenu) return;
              onReviewFile(contextMenu.file);
              setContextMenu(null);
            }}
          >
            <Eye size={14} />
            <span>打开预览</span>
          </button>
          <button
            type="button"
            className="workspace-menu-item"
            role="menuitem"
            onClick={() => {
              if (!contextMenu) return;
              void onOpenOutputPath(resolveFileFullPath(contextMenu.file));
              setContextMenu(null);
            }}
          >
            <ArrowUpRight size={14} />
            <span>用默认应用打开</span>
          </button>
          <button
            type="button"
            className="workspace-menu-item"
            role="menuitem"
            onClick={() => {
              if (!contextMenu) return;
              void onRevealOutputPath(resolveFileFullPath(contextMenu.file));
              setContextMenu(null);
            }}
          >
            <Folder size={14} />
            <span>在资源管理器中显示</span>
          </button>
          <div className="workspace-menu-divider" role="separator" />
          <button
            type="button"
            className="workspace-menu-item"
            role="menuitem"
            onClick={() => contextMenu ? void copyChangedFilePath(contextMenu.file, false) : undefined}
          >
            <Copy size={14} />
            <span>复制路径</span>
          </button>
          <button
            type="button"
            className="workspace-menu-item"
            role="menuitem"
            onClick={() => contextMenu ? void copyChangedFilePath(contextMenu.file, true) : undefined}
          >
            <Copy size={14} />
            <span>复制完整路径</span>
          </button>
          <div className="workspace-menu-divider" role="separator" />
          <button
            type="button"
            className="workspace-menu-item danger"
            role="menuitem"
            disabled={!activeProject}
            onClick={() => contextMenu ? void deleteChangedFile(contextMenu.file) : undefined}
          >
            <Trash2 size={14} />
            <span>删除</span>
          </button>
        </div>
      </PopoverPortal>
    </section>
  );
}

function buildConversationToolReviewRequest(preview: ToolPreview): WorkbenchPreviewRequest {
  return {
    key: `conversation:${preview.filePath}`,
    path: preview.filePath,
    name: preview.fileName,
    kind: 'code',
    source: 'conversation-card',
    reviewDiff: buildConversationToolReviewDiff(preview),
  };
}

function buildConversationToolReviewDiff(preview: ToolPreview) {
  const beforeLines = splitPreviewLines(preview.beforeText);
  const afterLines = splitPreviewLines(preview.afterText);
  const lines = [`--- a/${preview.filePath}`, `+++ b/${preview.filePath}`];

  if (!beforeLines.length && !afterLines.length) {
    return lines;
  }

  const maxLength = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < maxLength; index += 1) {
    const beforeLine = beforeLines[index];
    const afterLine = afterLines[index];

    if (beforeLine === afterLine) {
      if (beforeLine !== undefined) {
        lines.push(` ${beforeLine}`);
      }
      continue;
    }

    if (beforeLine !== undefined) {
      lines.push(`-${beforeLine}`);
    }
    if (afterLine !== undefined) {
      lines.push(`+${afterLine}`);
    }
  }

  return lines;
}

function ChangedFileInlineDiff({ file }: { file: ChangedFilePreviewGroup }) {
  return (
    <div className="changed-file-diff-body">
      {file.previews.map((preview, index) => (
        <div key={`${preview.kind}-${index}`} className="changed-file-diff-fragment">
          {file.previews.length > 1 ? (
            <div className="changed-file-diff-fragment-head">
              <span>{getToolPreviewTitle(preview)} {index + 1}</span>
              <span>
                {preview.additions > 0 ? `+${preview.additions}` : ''}
                {preview.additions > 0 && preview.deletions > 0 ? ' ' : ''}
                {preview.deletions > 0 ? `-${preview.deletions}` : ''}
              </span>
            </div>
          ) : null}
          <div className="changed-file-diff-code">
            {buildNumberedDiffRows(preview).map((row, rowIndex) => (
              <div key={`${row.type}-${rowIndex}`} className={`changed-file-diff-line ${row.type}`}>
                <span className="changed-file-diff-line-no">
                  {row.afterLine ?? row.beforeLine ?? ''}
                </span>
                <code>{row.text || ' '}</code>
              </div>
            ))}
          </div>
        </div>
      ))}
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
  const [collapsedResultsExpanded, setCollapsedResultsExpanded] = useState(false);

  return (
    <div className={`tool-step agent-preview-step tool-${tool.status}`}>
      <button
        type="button"
        className="tool-preview-summary agent-preview-summary"
        onClick={() => setExpanded((current) => !current)}
      >
        <ToolTypeIcon toolName={tool.name} />
        <div className="tool-preview-summary-main agent-preview-summary-main">
          <span className="agent-preview-title">{preview.agentType}</span>
          <span className="agent-preview-meta">{preview.summary}</span>
        </div>
        <span className={`agent-preview-status is-${preview.statusTone}`}>{preview.statusLabel}</span>
        <span className={`tool-preview-chevron ${expanded ? 'expanded' : ''}`}>{'>'}</span>
      </button>

      {expanded ? (
        <div className="agent-preview-card">
          <section className="agent-preview-hero">
            <div className="agent-preview-avatar" aria-hidden>
              <Bot size={18} />
            </div>
            <div className="agent-preview-hero-main">
              <div className="agent-preview-hero-title-row">
                <strong>{preview.agentType}</strong>
                <span className={`agent-preview-status is-${preview.statusTone}`}>{preview.statusLabel}</span>
              </div>
              <p>{preview.taskDescription}</p>
              {preview.metrics.length > 0 ? (
                <div className="agent-preview-metrics">
                  {preview.metrics.map((metric) => (
                    <span key={metric}>{metric}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
          {preview.identifiers.length > 0 ? (
            <section className="agent-preview-section">
              <h4>标识</h4>
              <div className="agent-preview-id-grid">
                {preview.identifiers.map((item) => (
                  <div key={`${item.label}-${item.value}`} className="agent-preview-id-row">
                    <span>{item.label}</span>
                    <code>{item.value}</code>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {preview.promptText && preview.promptText !== preview.taskDescription ? (
            <section className="agent-preview-section agent-preview-prompt-section">
              <h4>子代理 Prompt</h4>
              <pre>{preview.promptText}</pre>
            </section>
          ) : null}
          {preview.resultText ? (
            <section className="agent-preview-section">
              <h4>输出摘要</h4>
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
          {preview.subtools.length > 0 || preview.hiddenSubtoolCount > 0 ? (
            <section className="agent-preview-section">
              <h4>
                子代理工具
                {preview.hiddenSubtoolCount > 0 ? (
                  <span>已收起 {preview.hiddenSubtoolCount} 条成功结果</span>
                ) : null}
              </h4>
              {preview.subtools.length > 0 ? (
                <div className="agent-preview-tool-timeline">
                  {preview.subtools.map((subtool) => (
                    <div key={subtool.id} className={`agent-preview-tool-row tool-${subtool.status}`}>
                      <span className="agent-preview-tool-dot" aria-hidden />
                      <div className="agent-preview-tool-main">
                        <span className="agent-preview-tool-title">{subtool.title}</span>
                        <span className="agent-preview-tool-summary">
                          {subtool.statusLabel} · {subtool.summary}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {preview.hiddenSubtoolCount > 0 ? (
                <div className="agent-preview-collapsed-tools">
                  <button
                    type="button"
                    className="agent-preview-collapsed-toggle"
                    onClick={() => setCollapsedResultsExpanded((current) => !current)}
                  >
                    <span>{collapsedResultsExpanded ? '收起成功结果' : `查看 ${preview.hiddenSubtoolCount} 条成功结果`}</span>
                    <span className={`tool-preview-chevron ${collapsedResultsExpanded ? 'expanded' : ''}`}>{'>'}</span>
                  </button>
                  <div className="agent-preview-collapsed-summary">
                    <span>最近结果</span>
                    {preview.collapsedSubtoolSummary.map((summary, index) => (
                      <code key={`${summary}-${index}`}>{summary}</code>
                    ))}
                  </div>
                  {collapsedResultsExpanded ? (
                    <div className="agent-preview-collapsed-list">
                      {preview.collapsedSubtools.map((subtool) => (
                        <div key={subtool.id} className="agent-preview-collapsed-row">
                          <span>{subtool.statusLabel}</span>
                          <code>{subtool.summary}</code>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
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
        <ToolTypeIcon toolName={tool.name} />
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
  const readyToSubmit = !turnInFlight || Boolean(request.readyAtMs);

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
    if (submitted || !readyToSubmit) {
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
            : !readyToSubmit
              ? '等待 Claude 完成提问后再提交。'
            : turnInFlight
              ? '填写后会直接回答当前运行中的提问。'
              : '填写后会作为续聊消息继续当前任务。'}
        </span>
        <button
          type="button"
          className="assistant-runtime-submit-button"
          disabled={submitted || !readyToSubmit || !canSubmit || submitting}
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

  if (planApproval) {
    return (
      <section className="assistant-runtime-card plan-ready-card">
        <header className="plan-ready-head">
          <div className="plan-ready-title">
            <span className="plan-ready-icon" aria-hidden="true">
              <ListChecks size={17} />
            </span>
            <div>
              <strong>{interactive ? '执行计划已就绪' : '计划确认记录'}</strong>
              <p>{interactive ? '确认后会退出 Plan mode 并开始执行。' : '这是历史计划确认记录。'}</p>
            </div>
          </div>
          {request.description ? <InlineCopyButton text={request.description} title="复制计划" /> : null}
        </header>

        {request.description ? (
          <pre className="assistant-runtime-code plan-ready-code">{request.description}</pre>
        ) : null}

        <div className="assistant-runtime-card-foot plan-ready-foot">
          <span className="assistant-runtime-footnote">
            {interactive ? '如果计划还不对，可以让 Claude 继续调整。' : '历史记录不会自动继续旧运行。'}
          </span>
          {interactive ? (
            <div className="assistant-runtime-action-list">
              <button
                type="button"
                className="assistant-runtime-submit-button secondary"
                disabled={Boolean(submittingDecision)}
                onClick={() => void handleDecision('reject')}
              >
                {submittingDecision === 'reject' ? '处理中...' : '继续修改计划'}
              </button>
              <button
                type="button"
                className="assistant-runtime-submit-button"
                disabled={Boolean(submittingDecision)}
                onClick={() => void handleDecision('approve')}
              >
                {submittingDecision === 'approve' ? '处理中...' : '退出 Plan mode 并执行'}
              </button>
            </div>
          ) : null}
        </div>
        {submitError ? <p className="assistant-runtime-error">{submitError}</p> : null}
      </section>
    );
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
    getDurationMsFromMetrics(turn.metrics) ??
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
  const prefix =
    !running
      ? getCompletedTurnLabel(turn)
      : getRunningTurnLabel(turn);

  return parts.length > 0 ? `${prefix} ${parts.join(' · ')}` : prefix;
}

function getDurationMsFromMetrics(metrics?: string) {
  const match = metrics?.match(/耗时\s*([\d.]+)s/);
  if (!match) {
    return undefined;
  }

  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds)) {
    return undefined;
  }

  return Math.max(0, Math.round(seconds * 1000));
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
    const activity = turn.activity?.trim();
    if (turn.activity === '继续执行中') {
      return '继续执行中';
    }

    if (turn.activity === '等待 Claude 调整计划') {
      return '等待调整计划';
    }

    if (
      activity &&
      activity !== '等待 Claude 响应' &&
      activity !== 'Claude Code 已启动' &&
      activity !== 'Claude Code 已接收用户消息'
    ) {
      return activity;
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
    .map((item) => {
      if (item.type === 'text') {
        return item.text;
      }
      if (item.type === 'system-command') {
        return [item.command, item.summary, item.errorMessage].filter(Boolean).join('\n');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();

  return visibleText || turn.assistantText.trim();
}

function ToolTypeIcon({ toolName }: { toolName: string }) {
  const Icon = getToolTypeIcon(toolName);
  return (
    <span className="execution-type-icon tool-type-icon" aria-hidden="true">
      <Icon size={13} />
    </span>
  );
}

function getSystemCommandIcon(cardType: SystemCommandItem['cardType']) {
  if (cardType === 'status') {
    return CircleGauge;
  }
  if (cardType === 'context') {
    return ClipboardList;
  }
  if (cardType === 'cost') {
    return CircleDollarSign;
  }
  if (cardType === 'compact') {
    return Sparkles;
  }

  return SquareTerminal;
}

function getToolTypeIcon(toolName: string) {
  const normalized = toolName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  if (normalized === 'bash' || normalized === 'bashoutput' || normalized === 'killshell') {
    return SquareTerminal;
  }
  if (normalized === 'read' || normalized === 'fileread' || normalized === 'notebookread') {
    return FileText;
  }
  if (normalized === 'grep' || normalized === 'glob' || normalized === 'websearch') {
    return Search;
  }
  if (normalized === 'ls' || normalized === 'listmcpresources' || normalized === 'readmcpresource') {
    return Folder;
  }
  if (
    normalized === 'edit' ||
    normalized === 'multiedit' ||
    normalized === 'write' ||
    normalized === 'notebookedit' ||
    normalized === 'fileedit' ||
    normalized === 'filewrite'
  ) {
    return FilePenLine;
  }
  if (normalized === 'webfetch' || normalized === 'mcp') {
    return Globe2;
  }
  if (normalized === 'viewimage') {
    return Image;
  }
  if (normalized === 'todowrite' || normalized === 'todoread' || normalized === 'updateplan') {
    return ListChecks;
  }
  if (normalized === 'agent' || normalized === 'task' || normalized === 'taskoutput') {
    return Bot;
  }
  if (toolName.startsWith('mcp__')) {
    return Wrench;
  }

  return Wrench;
}

function formatSystemCommandState(state: SystemCommandItem['state']) {
  if (state === 'running') {
    return '运行中';
  }

  if (state === 'error') {
    return '失败';
  }

  return '已完成';
}

function formatSystemCommandDetails(details?: Record<string, unknown>) {
  if (!details || Object.keys(details).length === 0) {
    return '';
  }

  return Object.entries(details)
    .map(([key, value]) => `${getSystemCommandDetailLabel(key)}: ${formatSystemCommandDetailValue(value)}`)
    .join('\n');
}

function getSystemCommandDetailLabel(key: string) {
  switch (key) {
    case 'workspace':
      return '工作目录';
    case 'sessionId':
      return 'Session';
    case 'cli':
      return 'Claude CLI';
    case 'turnCount':
      return '回合数';
    case 'inputTokens':
      return '输入 tokens';
    case 'outputTokens':
      return '输出 tokens';
    case 'cacheCreationInputTokens':
      return '缓存创建 tokens';
    case 'cacheReadInputTokens':
      return '缓存读取 tokens';
    case 'totalTokens':
      return '总 tokens';
    case 'totalCostUsd':
      return '总成本';
    case 'runningTurnCount':
      return '运行中回合';
    case 'contextWindowTokens':
      return '上下文窗口';
    case 'usedContextTokens':
      return '已用上下文';
    case 'freeContextTokens':
      return '剩余上下文';
    case 'usagePercent':
      return '上下文占比';
    case 'usageSource':
      return '统计来源';
    case 'cumulativeInputTokens':
      return '累计输入 tokens';
    case 'cumulativeOutputTokens':
      return '累计输出 tokens';
    case 'cumulativeCacheCreationInputTokens':
      return '累计缓存创建 tokens';
    case 'cumulativeCacheReadInputTokens':
      return '累计缓存读取 tokens';
    case 'cumulativeTotalTokens':
      return '累计总 tokens';
    case 'note':
      return '说明';
    case 'mcpToolCount':
      return 'MCP tools';
    case 'memoryFileCount':
      return 'Memory 文件数';
    case 'skillCount':
      return 'Skills 数';
    case 'systemPromptTokens':
      return 'System prompt tokens';
    case 'memoryFilesTokens':
      return 'Memory files tokens';
    case 'skillsTokens':
      return 'Skills tokens';
    case 'messagesTokens':
      return 'Messages tokens';
    case 'freeSpaceTokens':
      return 'Free space tokens';
    case 'hasContextUsage':
      return '包含 Context Usage';
    case 'hasMcpTools':
      return '包含 MCP tools';
    case 'hasFreeSpace':
      return '包含 Free space';
    case 'hasSystemPrompt':
      return '包含 System prompt';
    case 'hasMemory':
      return '包含 Memory';
    case 'hasSkills':
      return '包含 Skills';
    case 'markdownChars':
      return '原始 Markdown 字符数';
    case 'error':
      return '错误';
    default:
      return key;
  }
}

function formatSystemCommandDetailValue(value: unknown) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? `${value}` : value.toFixed(4);
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value == null) {
    return '-';
  }

  return JSON.stringify(value, null, 2);
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

type ChangedFilePreviewGroup = {
  path: string;
  name: string;
  additions: number;
  deletions: number;
  previews: ToolPreview[];
};

type NumberedDiffRow = {
  type: 'context' | 'add' | 'remove';
  text: string;
  beforeLine?: number;
  afterLine?: number;
};

type TodoWritePreviewData = {
  todos: Array<{
    content: string;
    status: TodoStatus;
  }>;
  counts: Record<TodoStatus, number>;
};

type StructuredToolPreviewData = {
  title: string;
  summary: string;
  rows: Array<{ label: string; value: string }>;
  content?: string;
};

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'unknown';

const TOOL_DIFF_CONTEXT_LINE_COUNT = 2;

function collectConversationChangedFileGroups(tools: ToolStep[]) {
  const grouped = new Map<string, ChangedFilePreviewGroup>();

  for (const tool of tools) {
    const preview = getToolPreview(tool);
    if (!preview) {
      continue;
    }

    const current =
      grouped.get(preview.filePath) ??
      {
        path: preview.filePath,
        name: preview.fileName,
        additions: 0,
        deletions: 0,
        previews: [],
      };

    current.additions += preview.additions;
    current.deletions += preview.deletions;
    current.previews.push(preview);
    grouped.set(preview.filePath, current);
  }

  return [...grouped.values()];
}

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

function buildNumberedDiffRows(preview: ToolPreview): NumberedDiffRow[] {
  const beforeLines = splitPreviewLines(preview.beforeText);
  const afterLines = splitPreviewLines(preview.afterText);

  if (preview.kind === 'write') {
    return afterLines.map<NumberedDiffRow>((text, index) => ({
      type: 'add' as const,
      text,
      afterLine: index + 1,
    }));
  }

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
  const rows: NumberedDiffRow[] = [];

  if (contextStart > 0) {
    rows.push({ type: 'context', text: '...', beforeLine: undefined, afterLine: undefined });
  }

  for (let index = contextStart; index < prefix; index += 1) {
    rows.push({
      type: 'context',
      text: afterLines[index] ?? '',
      beforeLine: index + 1,
      afterLine: index + 1,
    });
  }

  for (let index = prefix; index < beforeChangedEnd; index += 1) {
    rows.push({
      type: 'remove',
      text: beforeLines[index] ?? '',
      beforeLine: index + 1,
    });
  }

  for (let index = prefix; index < afterChangedEnd; index += 1) {
    rows.push({
      type: 'add',
      text: afterLines[index] ?? '',
      afterLine: index + 1,
    });
  }

  const trailingContext = afterLines.slice(
    afterChangedEnd,
    Math.min(afterChangedEnd + TOOL_DIFF_CONTEXT_LINE_COUNT, afterLines.length),
  );
  trailingContext.forEach((text, offset) => {
    const lineIndex = afterChangedEnd + offset;
    rows.push({
      type: 'context',
      text,
      beforeLine: lineIndex + 1,
      afterLine: lineIndex + 1,
    });
  });

  if (afterChangedEnd + trailingContext.length < afterLines.length) {
    rows.push({ type: 'context', text: '...' });
  }

  if (rows.length === 0) {
    return [
      {
        type: 'context' as const,
        text: afterLines[0] ?? '',
        afterLine: afterLines[0] ? 1 : undefined,
        beforeLine: beforeLines[0] ? 1 : undefined,
      },
    ];
  }

  return rows;
}

function formatChangedFilePath(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const projectPathMarkers = [
    'src/',
    'server/',
    'scripts/',
    'public/',
    '.trellis/',
    '.codex-logs/',
    'openspec/',
  ];

  for (const marker of projectPathMarkers) {
    const markerIndex = normalizedPath.indexOf(marker);
    if (markerIndex >= 0) {
      return normalizedPath.slice(markerIndex);
    }
  }

  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length <= 2) {
    return normalizedPath;
  }

  return segments.slice(-3).join('/');
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
      summary: tool.status === 'error' ? '调用失败' : '已返回结果',
      rows,
      content: resultText,
    };
  }

  return null;
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

function getReadableToolGroupName(name: string) {
  switch (normalizeRuntimeToolName(name)) {
    case 'bash':
      return 'Bash';
    case 'bashoutput':
      return 'BashOutput';
    case 'read':
      return 'Read';
    case 'grep':
      return 'Grep';
    case 'glob':
      return 'Glob';
    case 'ls':
      return 'LS';
    case 'edit':
      return 'Edit';
    case 'multiedit':
      return 'MultiEdit';
    case 'write':
      return 'Write';
    case 'toolresult':
      return '工具结果';
    default:
      return name.startsWith('mcp__') ? name.split('__').filter(Boolean).at(-1) ?? name : name;
  }
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

function groupToolItems(items: ConversationTurn['items']): DisplayAssistantItem[] {
  const result: DisplayAssistantItem[] = [];
  let pendingTools: ToolStep[] = [];

  const flushTools = () => {
    if (pendingTools.length === 0) {
      return;
    }

    const allReadTools = pendingTools.every(isReadTool);
    const variant = allReadTools ? 'read' : 'generic';
    const groupThreshold = allReadTools ? 2 : 3;
    if (pendingTools.length >= groupThreshold) {
      result.push({
        id: `${variant}-tool-group-${pendingTools.map((tool) => tool.id).join('-')}`,
        type: 'tool-group',
        variant,
        tools: pendingTools,
      });
    } else {
      for (const tool of pendingTools) {
        result.push({
          id: tool.id,
          type: 'tool',
          tool,
        });
      }
    }

    pendingTools = [];
  };

  for (const item of items) {
    if (item.type === 'tool' && isBatchGroupableTool(item.tool)) {
      pendingTools.push(item.tool);
      continue;
    }

    flushTools();
    result.push(item);
  }

  flushTools();
  return result;
}

function isBatchGroupableTool(tool: ToolStep) {
  if (tool.status === 'running') {
    return false;
  }

  const normalizedName = normalizeRuntimeToolName(tool.name);
  if (normalizedName === 'read') {
    return true;
  }

  if (
    normalizedName === 'todowrite' ||
    normalizedName === 'enterplanmode' ||
    normalizedName === 'askuserquestion' ||
    normalizedName === 'requestuserinput' ||
    normalizedName === 'approvalrequest' ||
    normalizedName === 'exitplanmode'
  ) {
    return false;
  }

  return !getTodoWritePreview(tool) && !isAgentTaskToolName(tool.name);
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
  return request.kind === 'plan-exit' || request.title === '计划待确认';
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
  return buildWorkspaceImagePreviewUrl(filePath);
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
