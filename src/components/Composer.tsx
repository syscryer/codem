import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEventHandler } from 'react';
import { ArrowUp, BookOpen, Brain, Check, ChevronDown, CornerDownRight, Globe, Image, Lightbulb, Loader2, Mic, Pencil, Plus, Puzzle, RefreshCw, Route, Server, ServerCog, Shield, Square, Unlock, X, Zap } from 'lucide-react';
import { CLAUDE_CODE_PROVIDER_ID, DEFAULT_MODEL_VALUE, GROK_BUILD_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID, OPENCODE_PROVIDER_ID, permissionMenuModes } from '../constants';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { useSlashCommands } from '../hooks/useSlashCommands';
import { buildComposerContextUsage, shouldRefreshNativeContextOnOpen } from '../lib/composer-context-usage';
import { classifyComposerFile, supportedComposerUploadAccept } from '../lib/composer-input-files';
import { extractAtFileReferences, shouldSearchFileReferenceQuery } from '../lib/file-reference-paths';
import { isTauriRuntime } from '../lib/window-material';
import { pickDesktopFiles } from '../lib/desktop-dialog';
import { subscribeDesktopDragDrop } from '../lib/desktop-drag-drop';
import {
  dedupeAndValidateDesktopPaths,
  getDesktopPathBasename,
  isDesktopImagePath,
} from '../lib/desktop-attachment-paths';
import { PopoverPortal } from './PopoverPortal';
import { ComposerContextIndicator } from './ComposerContextIndicator';
import { SlashCommandMenu } from './SlashCommandMenu';
import { WorkbenchFileIcon } from './WorkbenchFileIcon';
import { AgentProviderIcon } from './AgentProviderIcon';
import { ProviderBrandIcon } from './ProviderBrandIcon';
import { hasClaudeContext1mOptions } from '../lib/claude-model-selection';
import { applySlashCommandSelection, getNextSlashCommandIndex } from '../lib/slash-command-editor';
import { getSlashDismissResetKey, resolveSlashCommandSubmission } from '../lib/slash-command-submit';
import { shouldSubmitComposerOnEnter } from '../lib/composer-keyboard';
import { getAgentModelForSelection } from '../lib/agent-model-selection';
import { agentChannelTemplate, enabledAgentChannels, SYSTEM_AGENT_CHANNEL_ID, systemAgentChannelTemplate } from '../lib/agent-channel-selection';
import { modelContext1mMenuActionLabel, modelMenuDescriptionLabel, modelMenuPrimaryLabel, modelTriggerLabel, permissionLabel } from '../lib/ui-labels';
import type { AgentChannel, AgentModelCatalog, AgentModelOption, AgentProviderDescriptor, AgentSystemChannel, AgentType, AiChatReasoningEffort, AiKnowledgeBaseSummary, AiProviderTemplate, ClaudeContextRequestState, ClaudeEffortSelection, ClaudeModelOption, ConversationTurn, InputContentBlock, McpServerSummary, PermissionMode, SlashCommand, UserImageAttachment } from '../types';

type PendingComposerAttachment =
  | {
      id: string;
      kind: 'image';
      file?: File;
      previewUrl: string;
      // 桌面端拖拽 / 文件框选择的图片：已带真实路径与 base64，提交时直接复用，不走上传。
      desktopImage?: ResolvedDesktopImage;
    }
  | {
      id: string;
      kind: 'file_text';
      file: File;
      text: string;
    }
  | {
      id: string;
      kind: 'file_reference';
      file: File;
      reason: 'too_large' | 'unsupported';
    }
  | {
      id: string;
      // 桌面端拖拽 / 原生文件框选择的外部文件：直接持有真实磁盘绝对路径，作为路径引用发送。
      kind: 'path_reference';
      path: string;
      name: string;
    };

type ResolvedDesktopImage = {
  path: string;
  name: string;
  mimeType: string;
  size: number;
  data: string;
};

type FileReferenceSearchResult = {
  path: string;
  rel: string;
  isDirectory: boolean;
};

const claudeEffortOptions: Array<{
  value: ClaudeEffortSelection;
  label: string;
  description: string;
}> = [
  { value: 'default', label: '默认', description: '使用 Claude Code 默认思考级别' },
  { value: 'low', label: 'Low', description: '更快，适合简单修改' },
  { value: 'medium', label: 'Medium', description: '平衡速度和推理' },
  { value: 'high', label: 'High', description: '复杂代码和排查问题' },
  { value: 'xhigh', label: 'XHigh', description: '更深入的推理' },
  { value: 'max', label: 'Max', description: '当前会话最高努力级别' },
  { value: 'ultracode', label: 'Ultracode', description: 'xhigh 与自动 workflows，仅当前会话' },
];

type ComposerProps = {
  variant?: 'agent' | 'ordinary';
  agent: AgentType;
  providerId: string;
  providers: AgentProviderDescriptor[];
  providersLoading?: boolean;
  providersError?: string;
  agentChannels?: AgentChannel[];
  agentSystemChannels?: AgentSystemChannel[];
  agentChannelTemplates?: AiProviderTemplate[];
  agentChannelId?: string;
  canSelectProvider: boolean;
  allowAttachments: boolean;
  supportsQueue: boolean;
  workspace: string;
  permissionMode: PermissionMode;
  model: string;
  effort: ClaudeEffortSelection;
  models: ClaudeModelOption[];
  agentModel: string;
  agentReasoningEffort: string;
  agentModelCatalog: AgentModelCatalog | null;
  agentModelsLoading: boolean;
  agentModelsError: string;
  agentModelSelectionWarning: string;
  knowledgeBases?: AiKnowledgeBaseSummary[];
  selectedKnowledgeIds?: string[];
  mcpServers?: McpServerSummary[];
  selectedMcpIds?: string[];
  ordinaryThinkingEnabled?: boolean;
  ordinaryReasoningEffort?: AiChatReasoningEffort;
  ordinaryReasoningOptions?: AiChatReasoningEffort[];
  ordinaryWebSearchEnabled?: boolean;
  ordinaryWebSearchAvailable?: boolean;
  turns: ConversationTurn[];
  claudeContextState?: ClaudeContextRequestState;
  isRunning: boolean;
  isInterrupting?: boolean;
  draftScopeKey: string;
  draft: string;
  queuedPrompts: Array<{ id: string; displayText: string; createdAtMs: number; queueStatus?: 'preparing' | 'ready' }>;
  queuedPromptGuideAvailability: { available: boolean; reason?: string };
  onDraftChange: (value: string) => void;
  onSelectProvider: (providerId: string) => boolean | void;
  onSelectAgentChannel?: (channelId: string) => boolean | void;
  onManageAgentChannels?: (providerId: string) => void;
  onSubmitPrompt: (submission: {
    prompt: string;
    displayText: string;
    attachments?: UserImageAttachment[];
    contentBlocks?: InputContentBlock[];
    queueId?: string;
    queueStatus?: 'preparing' | 'ready';
  }) => Promise<boolean> | boolean;
  onRemoveQueuedPrompt: (promptId: string) => void;
  onRecallQueuedPrompt: (promptId: string) => void;
  onGuideQueuedPrompt: (promptId: string) => Promise<boolean> | boolean;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onSelectPermissionMode: (mode: PermissionMode) => void;
  onSelectModel: (model: string) => void;
  onSelectEffort: (effort: ClaudeEffortSelection) => void;
  onSelectAgentModel: (model: string) => void;
  onSelectAgentReasoningEffort: (effort: string) => void;
  onRetryAgentModels: () => void;
  onToggleKnowledgeBase?: (knowledgeBaseId: string) => boolean | void | Promise<boolean | void>;
  onManageKnowledgeBases?: () => void;
  onToggleMcpServer?: (serverId: string) => boolean | void | Promise<boolean | void>;
  onToggleOrdinaryThinking?: () => boolean | void | Promise<boolean | void>;
  onSelectOrdinaryReasoningEffort?: (effort: AiChatReasoningEffort) => boolean | void | Promise<boolean | void>;
  onToggleOrdinaryWebSearch?: () => boolean | void | Promise<boolean | void>;
  onOpenPlugins: () => void;
  onCreateNewChat: () => Promise<void> | void;
  onStopRun: () => void | Promise<void>;
  onRunSlashSystemCommand: (command: SlashCommand, submittedText: string) => Promise<void> | void;
  onRefreshClaudeContext: () => Promise<void> | void;
};

export function Composer({
  variant = 'agent',
  agent,
  providerId,
  providers,
  providersLoading = false,
  providersError = '',
  agentChannels = [],
  agentSystemChannels = [],
  agentChannelTemplates = [],
  agentChannelId = SYSTEM_AGENT_CHANNEL_ID,
  canSelectProvider,
  allowAttachments,
  supportsQueue,
  workspace,
  permissionMode,
  model,
  effort,
  models,
  agentModel,
  agentReasoningEffort,
  agentModelCatalog,
  agentModelsLoading,
  agentModelsError,
  agentModelSelectionWarning,
  knowledgeBases = [],
  selectedKnowledgeIds = [],
  mcpServers = [],
  selectedMcpIds = [],
  ordinaryThinkingEnabled = false,
  ordinaryReasoningEffort = 'medium',
  ordinaryReasoningOptions = [],
  ordinaryWebSearchEnabled = false,
  ordinaryWebSearchAvailable = false,
  turns,
  claudeContextState,
  isRunning,
  isInterrupting = false,
  draftScopeKey,
  draft: persistedDraft,
  queuedPrompts,
  queuedPromptGuideAvailability,
  onDraftChange,
  onSelectProvider,
  onSelectAgentChannel = () => false,
  onManageAgentChannels,
  onSubmitPrompt,
  onRemoveQueuedPrompt,
  onRecallQueuedPrompt,
  onGuideQueuedPrompt,
  showToast,
  onKeyDown,
  onSelectPermissionMode,
  onSelectModel,
  onSelectEffort,
  onSelectAgentModel,
  onSelectAgentReasoningEffort,
  onRetryAgentModels,
  onToggleKnowledgeBase,
  onManageKnowledgeBases,
  onToggleMcpServer,
  onToggleOrdinaryThinking,
  onSelectOrdinaryReasoningEffort,
  onToggleOrdinaryWebSearch,
  onOpenPlugins,
  onCreateNewChat,
  onStopRun,
  onRunSlashSystemCommand,
  onRefreshClaudeContext,
}: ComposerProps) {
  const [draft, setLocalDraft] = useState(persistedDraft);
  const [attachments, setAttachments] = useState<PendingComposerAttachment[]>([]);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [agentChannelMenuOpen, setAgentChannelMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);
  const [knowledgeMenuOpen, setKnowledgeMenuOpen] = useState(false);
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const [mcpMenuOpen, setMcpMenuOpen] = useState(false);
  const permissionMenuRef = useRef<HTMLDivElement | null>(null);
  const providerMenuRef = useRef<HTMLDivElement | null>(null);
  const agentChannelMenuRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const knowledgeMenuRef = useRef<HTMLDivElement | null>(null);
  const reasoningMenuRef = useRef<HTMLDivElement | null>(null);
  const mcpMenuRef = useRef<HTMLDivElement | null>(null);
  const effortMenuRef = useRef<HTMLDivElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerCardRef = useRef<HTMLDivElement | null>(null);
  const fileReferenceMenuRef = useRef<HTMLDivElement | null>(null);
  const fileReferenceItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const attachmentsRef = useRef<PendingComposerAttachment[]>([]);
  const draftRef = useRef(persistedDraft);
  const lastPersistedDraftRef = useRef(persistedDraft);
  const draftScopeKeyRef = useRef(draftScopeKey);
  const pendingSelectionRef = useRef<{ start: number; end: number; restoreFocus: boolean } | null>(null);
  const [selectionStart, setSelectionStart] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);
  const [fileReferenceResults, setFileReferenceResults] = useState<FileReferenceSearchResult[]>([]);
  const [fileReferenceLoading, setFileReferenceLoading] = useState(false);
  const [fileReferenceSelectedIndex, setFileReferenceSelectedIndex] = useState(0);
  const [fileReferenceMenuDismissed, setFileReferenceMenuDismissed] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false);
  const activeFileReferenceToken = getActiveFileReferenceToken(draft, selectionStart, selectionEnd);
  const fileReferenceMenuOpen = Boolean(
    allowAttachments && activeFileReferenceToken && workspace.trim() && !fileReferenceMenuDismissed,
  );

  const {
    commands: slashCommands,
    filteredCommands,
    open: slashMenuOpen,
    loading: slashCommandsLoading,
    query: slashQuery,
    context: slashContext,
  } = useSlashCommands({
    enabled: variant !== 'ordinary',
    projectPath: workspace.trim() || undefined,
    activeAgent: agent,
    draft,
    selectionStart,
    showToast,
  });

  useOutsideDismiss({
    selectors: [
      { selector: '.composer-add-menu', onDismiss: () => setAddMenuOpen(false), anchorRefs: [addMenuRef] },
      { selector: '.provider-menu', onDismiss: () => setProviderMenuOpen(false), anchorRefs: [providerMenuRef] },
      { selector: '.agent-channel-menu', onDismiss: () => setAgentChannelMenuOpen(false), anchorRefs: [agentChannelMenuRef] },
      { selector: '.permission-menu', onDismiss: () => setPermissionMenuOpen(false), anchorRefs: [permissionMenuRef] },
      { selector: '.model-menu', onDismiss: () => setModelMenuOpen(false), anchorRefs: [modelMenuRef] },
      { selector: '.effort-menu', onDismiss: () => setEffortMenuOpen(false), anchorRefs: [effortMenuRef] },
      { selector: '.knowledge-menu', onDismiss: () => setKnowledgeMenuOpen(false), anchorRefs: [knowledgeMenuRef] },
      { selector: '.ordinary-reasoning-menu', onDismiss: () => setReasoningMenuOpen(false), anchorRefs: [reasoningMenuRef] },
      { selector: '.mcp-menu', onDismiss: () => setMcpMenuOpen(false), anchorRefs: [mcpMenuRef] },
      {
        selector: '.composer-file-reference-menu',
        onDismiss: () => setFileReferenceMenuDismissed(true),
        anchorRefs: [composerCardRef],
      },
    ],
  });
  const hasDraft = Boolean(draft.trim());
  const hasPendingContent = hasDraft || attachments.length > 0;
  const showStopButton = isRunning && (!hasPendingContent || !supportsQueue);
  const nativeContext = claudeContextState?.context;
  const nativeContextSummary = nativeContext?.summary;
  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === providerId),
    [providerId, providers],
  );
  const providerName = selectedProvider?.displayName
    ?? (providerDisplayName(providerId) || (variant === 'ordinary' ? '未配置供应商' : 'Provider'));
  const availableAgentChannels = useMemo(
    () => enabledAgentChannels(agentChannels, providerId),
    [agentChannels, providerId],
  );
  const selectedAgentChannel = availableAgentChannels.find((channel) => channel.id === agentChannelId);
  const systemAgentChannel = agentSystemChannels.find((channel) => channel.providerId === providerId);
  const systemAgentChannelBrand = systemAgentChannelTemplate(systemAgentChannel, agentChannelTemplates);
  const selectedAgentChannelTemplate = selectedAgentChannel
    ? agentChannelTemplate(selectedAgentChannel, agentChannelTemplates)
    : systemAgentChannelBrand;
  const agentChannelName = selectedAgentChannel?.name ?? '系统';
  const textOnlyInputMessage = `${providerName} 当前不支持附件输入。`;
  const providerSelectionDisabled =
    !canSelectProvider || isRunning || (providersLoading && providers.length === 0);
  const ordinarySelectionReady = variant !== 'ordinary'
    || Boolean(selectedProvider?.selectable && selectedProvider.available === true && agentModel);
  const permissionSelectionDisabled = agent !== 'claude' && isRunning;
  const selectedAgentModelOption = agentModelCatalog
    ? getAgentModelForSelection(agentModelCatalog, agentModel)
    : undefined;
  const defaultAgentModelOption = agentModelCatalog
    ? getAgentModelForSelection(agentModelCatalog, DEFAULT_MODEL_VALUE)
    : undefined;
  const agentReasoningEffortOptions = selectedAgentModelOption?.supportedReasoningEfforts ?? [];
  const selectedModelOption = useMemo(
    () => models.find((option) => option.id === model),
    [model, models],
  );
  const contextUsage = useMemo(
    () => buildComposerContextUsage({
      agent,
      model,
      turns,
      nativeContextSummary,
      nativeContextRequestedAtMs: nativeContext?.requestedAtMs,
      nativeContextWindowTokens: selectedModelOption?.contextWindowTokens,
    }),
    [agent, model, nativeContext?.requestedAtMs, nativeContextSummary, selectedModelOption?.contextWindowTokens, turns],
  );
  const shouldRefreshClaudeContextOnOpen = useMemo(
    () => agent === 'claude' && shouldRefreshNativeContextOnOpen({
      turns,
      nativeContextRequestedAtMs: nativeContext?.requestedAtMs,
    }),
    [agent, nativeContext?.requestedAtMs, turns],
  );
  const modelMenuHasContext1mOptions = useMemo(() => hasClaudeContext1mOptions(models), [models]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    if (canSelectProvider) {
      return;
    }
    setProviderMenuOpen(false);
  }, [canSelectProvider]);

  useEffect(() => {
    if (!permissionSelectionDisabled) {
      return;
    }
    setPermissionMenuOpen(false);
  }, [permissionSelectionDisabled]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }
    setAgentChannelMenuOpen(false);
    setModelMenuOpen(false);
    setEffortMenuOpen(false);
    setKnowledgeMenuOpen(false);
    setReasoningMenuOpen(false);
    setMcpMenuOpen(false);
  }, [isRunning]);

  useEffect(() => {
    if (allowAttachments || attachments.length === 0) {
      return;
    }
    disposeAttachmentPreviews(attachments);
    setAttachments([]);
    showToast(`${providerName} 当前不支持附件，待发送附件已移除。`, 'info');
  }, [allowAttachments, attachments, providerName, showToast]);

  // 桌面端：订阅原生文件拖放事件，把拖入的真实路径转成附件。用 ref 持有最新回调避免闭包过期。
  const appendDesktopPathsRef = useRef<(paths: string[]) => void>(() => {});
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    const unsubscribe = subscribeDesktopDragDrop({
      onPhaseChange: (phase) => {
        setDragActive(phase === 'enter' || phase === 'over');
      },
      onDrop: (paths) => {
        setDragActive(false);
        appendDesktopPathsRef.current(paths);
      },
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (persistedDraft === lastPersistedDraftRef.current) {
      return;
    }

    lastPersistedDraftRef.current = persistedDraft;
    draftRef.current = persistedDraft;
    setLocalDraft((current) => (current === persistedDraft ? current : persistedDraft));
    setSelectionStart(persistedDraft.length);
    setSelectionEnd(persistedDraft.length);
  }, [persistedDraft]);

  useEffect(() => {
    draftScopeKeyRef.current = draftScopeKey;
    lastPersistedDraftRef.current = persistedDraft;
    draftRef.current = persistedDraft;
    setLocalDraft((current) => (current === persistedDraft ? current : persistedDraft));
    disposeAttachmentPreviews(attachmentsRef.current);
    attachmentsRef.current = [];
    setAttachments([]);
    setSelectionStart(persistedDraft.length);
    setSelectionEnd(persistedDraft.length);
    setSlashMenuDismissed(false);
    return () => {
      flushDraftPersistence();
    };
  }, [draftScopeKey]);

  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [draft, selectionStart, filteredCommands.length]);

  useEffect(() => {
    setFileReferenceSelectedIndex(0);
  }, [activeFileReferenceToken?.query, fileReferenceResults.length]);

  useEffect(() => {
    if (!fileReferenceMenuOpen || fileReferenceLoading || fileReferenceResults.length === 0) {
      return;
    }

    const container = fileReferenceMenuRef.current;
    const selectedItem = fileReferenceItemRefs.current[fileReferenceSelectedIndex];
    if (!container || !selectedItem) {
      return;
    }

    // 在 fixed PopoverPortal 容器内手动算偏移，避免 scrollIntoView 在某些浏览器把"部分可见"判断成"无需滚动"。
    const itemTop = selectedItem.offsetTop;
    const itemBottom = itemTop + selectedItem.offsetHeight;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;

    if (itemTop < viewTop) {
      container.scrollTop = Math.max(0, itemTop);
    } else if (itemBottom > viewBottom) {
      container.scrollTop = itemBottom - container.clientHeight;
    }
  }, [fileReferenceLoading, fileReferenceMenuOpen, fileReferenceResults.length, fileReferenceSelectedIndex]);

  useEffect(() => {
    setFileReferenceMenuDismissed(false);
  }, [activeFileReferenceToken?.start, activeFileReferenceToken?.end, activeFileReferenceToken?.query]);

  useEffect(() => {
    setSlashMenuDismissed(false);
  }, [getSlashDismissResetKey(slashContext)]);

  useEffect(() => {
    const pendingSelection = pendingSelectionRef.current;
    if (!pendingSelection) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      const latestSelection = pendingSelectionRef.current;
      if (!textarea || !latestSelection) {
        return;
      }

      pendingSelectionRef.current = null;
      if (latestSelection.restoreFocus && document.activeElement !== textarea) {
        textarea.focus({ preventScroll: true });
      }
      if (textarea.selectionStart !== latestSelection.start || textarea.selectionEnd !== latestSelection.end) {
        textarea.setSelectionRange(latestSelection.start, latestSelection.end);
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [draft, selectionStart, selectionEnd]);

  useEffect(() => {
    if (!activeFileReferenceToken || !workspace.trim() || !shouldSearchFileReferenceQuery(activeFileReferenceToken.query)) {
      setFileReferenceLoading(false);
      setFileReferenceResults([]);
      return;
    }

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setFileReferenceLoading(true);
      try {
        const params = new URLSearchParams({
          workingDirectory: workspace.trim(),
          query: activeFileReferenceToken.query,
        });
        const response = await fetch(`/api/system/files/search?${params.toString()}`, {
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }

        const payload = await response.json() as { files?: FileReferenceSearchResult[] };
        setFileReferenceResults(Array.isArray(payload.files) ? payload.files : []);
      } catch (error) {
        if ((error as { name?: string }).name !== 'AbortError') {
          setFileReferenceResults([]);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setFileReferenceLoading(false);
        }
      }
    }, 180);

    return () => {
      abortController.abort();
      window.clearTimeout(timeoutId);
    };
  }, [activeFileReferenceToken?.query, workspace]);

  useEffect(() => {
    return () => {
      disposeAttachmentPreviews(attachmentsRef.current);
    };
  }, []);

  function flushDraftPersistence() {
    const nextDraft = draftRef.current;
    if (lastPersistedDraftRef.current === nextDraft) {
      return;
    }

    lastPersistedDraftRef.current = nextDraft;
    onDraftChange(nextDraft);
  }

  function setDraft(nextDraft: string) {
    draftRef.current = nextDraft;
    setLocalDraft((current) => (current === nextDraft ? current : nextDraft));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedDraft = draft;
    const submittedAttachments = attachments;
    const submitDraftScopeKey = draftScopeKeyRef.current;
    const localActionResolution = resolveSlashCommandSubmission(submittedDraft, slashCommands);

    if (localActionResolution) {
      disposeAttachmentPreviews(submittedAttachments);
      setDraft('');
      flushDraftPersistence();
      setAttachments([]);
      setSelectionStart(0);
      setSelectionEnd(0);

      if (localActionResolution.kind === 'clear-thread') {
        await onCreateNewChat();
        return;
      }

      await onRunSlashSystemCommand(localActionResolution.command, submittedDraft.trim());
      return;
    }

    if (!submittedDraft.trim() && submittedAttachments.length === 0) {
      if (isRunning) {
        await onStopRun();
      }
      return;
    }

    if (isRunning && !supportsQueue) {
      showToast(`${providerName} 暂不支持运行中排队，请等待当前回复结束。`, 'info');
      return;
    }

    if (!allowAttachments && submittedAttachments.length > 0) {
      showToast(textOnlyInputMessage, 'info');
      return;
    }

    function restoreSubmittedContent() {
      if (draftScopeKeyRef.current === submitDraftScopeKey) {
        setDraft(submittedDraft);
        setAttachments(submittedAttachments);
      } else {
        disposeAttachmentPreviews(submittedAttachments);
      }
    }

    setDraft('');
    setAttachments([]);
    setSelectionStart(0);
    setSelectionEnd(0);

    const trimmedDraft = submittedDraft.trim();
    const needsAsyncPreparation = allowAttachments && (
      submittedAttachments.length > 0 || extractAtFileReferences(submittedDraft).length > 0
    );
    const pendingQueueId = isRunning && needsAsyncPreparation ? crypto.randomUUID() : '';
    if (pendingQueueId) {
      const queued = await onSubmitPrompt({
        prompt: submittedDraft,
        displayText: trimmedDraft,
        queueId: pendingQueueId,
        queueStatus: 'preparing',
      });
      if (!queued) {
        restoreSubmittedContent();
        return;
      }
    }

    const contentBlocks: InputContentBlock[] = [];
    if (trimmedDraft) {
      contentBlocks.push({
        type: 'text',
        text: trimmedDraft,
      });
    }

    if (allowAttachments && workspace.trim()) {
      const fileReferenceBlocks = await resolveExistingFileReferenceBlocks(submittedDraft, workspace.trim());
      contentBlocks.push(...fileReferenceBlocks);
    }

    let uploadedAttachments: UserImageAttachment[] | undefined;
    const imageAttachments = submittedAttachments.filter((attachment) => attachment.kind === 'image');
    if (submittedAttachments.length > 0) {
      if (!workspace.trim() && variant !== 'ordinary') {
        showToast('请先选择工作目录后再添加附件。', 'info');
        if (pendingQueueId) {
          onRemoveQueuedPrompt(pendingQueueId);
        }
        restoreSubmittedContent();
        return;
      }
    }

    if (imageAttachments.length > 0) {
      try {
        uploadedAttachments = variant === 'ordinary'
          ? await buildInlineImageAttachments(imageAttachments)
          : await uploadImageAttachments(imageAttachments, workspace.trim());
      } catch (error) {
        showToast(error instanceof Error ? error.message : '图片粘贴上传失败。', 'error');
        if (pendingQueueId) {
          onRemoveQueuedPrompt(pendingQueueId);
        }
        restoreSubmittedContent();
        return;
      }
    }

    const uploadedImageAttachmentsById = new Map(uploadedAttachments?.map((attachment) => [attachment.id, attachment]) ?? []);

    for (const attachment of submittedAttachments) {
      if (attachment.kind === 'image') {
        const uploadedImage = uploadedImageAttachmentsById.get(attachment.id);
        if (uploadedImage) {
          contentBlocks.push({
            type: 'image',
            id: uploadedImage.id,
            path: uploadedImage.path,
            name: uploadedImage.name,
            mimeType: uploadedImage.mimeType,
            size: uploadedImage.size,
            data: uploadedImage.data,
          });
        }
        continue;
      }

      if (attachment.kind === 'file_text') {
        contentBlocks.push({
          type: 'file_text',
          id: attachment.id,
          path: attachment.file.name,
          name: attachment.file.name || 'file.txt',
          mimeType: attachment.file.type || 'text/plain',
          size: attachment.file.size,
          text: attachment.text,
        });
        continue;
      }

      if (attachment.kind === 'file_reference') {
        contentBlocks.push({
          type: 'attachment_metadata',
          id: attachment.id,
          name: attachment.file.name || 'file',
          mimeType: attachment.file.type || undefined,
          size: attachment.file.size,
          reason: attachment.reason === 'too_large' ? '文件超过 1MB，第一阶段不会内联发送。' : '文件类型暂不支持。',
        });
        continue;
      }

      if (attachment.kind === 'path_reference') {
        contentBlocks.push({
          type: 'file_reference',
          id: attachment.id,
          path: attachment.path,
          name: attachment.name,
          source: 'attachment',
        });
      }
    }

    const submitted = await onSubmitPrompt({
      prompt: submittedDraft,
      displayText: trimmedDraft,
      attachments: uploadedAttachments,
      contentBlocks,
      ...(pendingQueueId ? { queueId: pendingQueueId, queueStatus: 'ready' as const } : {}),
    });
    if (!submitted) {
      if (pendingQueueId) {
        onRemoveQueuedPrompt(pendingQueueId);
      }
      restoreSubmittedContent();
      return;
    }

    disposeAttachmentPreviews(submittedAttachments);
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((current) => {
      const target = current.find((item) => item.id === attachmentId);
      if (target?.kind === 'image' && target.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((item) => item.id !== attachmentId);
    });
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = extractImageFiles(event.clipboardData.items);
    if (files.length === 0) {
      return;
    }

    if (!allowAttachments) {
      event.preventDefault();
      showToast(textOnlyInputMessage, 'info');
      return;
    }

    event.preventDefault();
    await appendAttachments(files);
  }

  async function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (selectedFiles.length === 0) {
      return;
    }

    if (!allowAttachments) {
      showToast(textOnlyInputMessage, 'info');
      return;
    }

    await appendAttachments(selectedFiles);
  }

  async function appendAttachments(files: File[]) {
    if (!allowAttachments) {
      showToast(textOnlyInputMessage, 'info');
      return;
    }
    const nextAttachments: PendingComposerAttachment[] = [];

    try {
      for (const file of files) {
        const classification = classifyComposerFile(file);
        if (classification.kind === 'image') {
          nextAttachments.push({
            id: crypto.randomUUID(),
            kind: 'image',
            file,
            previewUrl: URL.createObjectURL(file),
          });
          continue;
        }

        if (classification.kind === 'text') {
          nextAttachments.push({
            id: crypto.randomUUID(),
            kind: 'file_text',
            file,
            text: await readFileAsText(file),
          });
          continue;
        }

        if (classification.kind === 'reference') {
          nextAttachments.push({
            id: crypto.randomUUID(),
            kind: 'file_reference',
            file,
            reason: classification.reason,
          });
          continue;
        }
      }
    } catch (error) {
      disposeAttachmentPreviews(nextAttachments);
      showToast(error instanceof Error ? error.message : '附件读取失败。', 'error');
      return;
    }

    if (nextAttachments.length === 0) {
      showToast('当前只支持图片和 1MB 以内的文本/代码文件。', 'info');
      return;
    }

    setAttachments((current) => [...current, ...nextAttachments]);
  }

  // 点击"添加附件"：桌面端走原生文件框拿真实路径，Web 端退回 HTML input。
  async function handleAddAttachmentClick() {
    if (!allowAttachments) {
      showToast(textOnlyInputMessage, 'info');
      return;
    }
    if (isTauriRuntime()) {
      const picked = await pickDesktopFiles(workspace.trim() || undefined);
      if (picked === undefined) {
        // 拿不到桌面对话框（异常）时退回 HTML input，保证仍可添加。
        fileInputRef.current?.click();
        return;
      }
      if (picked.length > 0) {
        await appendDesktopPaths(picked);
      }
      return;
    }
    fileInputRef.current?.click();
  }

  // 桌面端拖拽 / 文件框拿到的真实磁盘路径：图片读为 base64 多模态，其它作为路径引用附件。
  async function appendDesktopPaths(rawPaths: string[]) {
    if (!allowAttachments) {
      showToast(textOnlyInputMessage, 'info');
      return;
    }
    const validPaths = dedupeAndValidateDesktopPaths(rawPaths);
    if (validPaths.length === 0) {
      showToast('没有可添加的有效文件（已过滤敏感路径）。', 'info');
      return;
    }

    const existingPaths = new Set(
      attachmentsRef.current
        .map((item) => (item.kind === 'path_reference' ? item.path : ''))
        .filter(Boolean),
    );

    const nextAttachments: PendingComposerAttachment[] = [];

    for (const filePath of validPaths) {
      if (existingPaths.has(filePath)) {
        continue;
      }
      existingPaths.add(filePath);

      if (isDesktopImagePath(filePath)) {
        const image = await readDesktopImageAttachment(filePath);
        if (image) {
          nextAttachments.push({
            id: crypto.randomUUID(),
            kind: 'image',
            // 已经有 base64，直接用 data URL 预览，避免外部路径被 image-preview 的工作区校验拦下。
            previewUrl: `data:${image.mimeType};base64,${image.data}`,
            desktopImage: image,
          });
          continue;
        }
        // 读图失败则降级为路径引用，至少让模型能用工具读取。
      }

      nextAttachments.push({
        id: crypto.randomUUID(),
        kind: 'path_reference',
        path: filePath,
        name: getDesktopPathBasename(filePath),
      });
    }

    if (nextAttachments.length === 0) {
      showToast('文件已在附件列表中。', 'info');
      return;
    }

    setAttachments((current) => [...current, ...nextAttachments]);
  }

  // 让拖放订阅始终调用到最新的 appendDesktopPaths（捕获最新 workspace / attachments）。
  appendDesktopPathsRef.current = (paths: string[]) => {
    void appendDesktopPaths(paths);
  };

  function updateDraftSelection(
    nextSelectionStart: number,
    nextSelectionEnd = nextSelectionStart,
    options?: { restoreFocus?: boolean },
  ) {
    pendingSelectionRef.current = {
      start: nextSelectionStart,
      end: nextSelectionEnd,
      restoreFocus: Boolean(options?.restoreFocus),
    };
    setSelectionStart(nextSelectionStart);
    setSelectionEnd(nextSelectionEnd);
  }

  function handleDraftChange(nextDraft: string, nextSelectionStartValue?: number, nextSelectionEndValue?: number) {
    setDraft(nextDraft);
    setSelectionStart(nextSelectionStartValue ?? nextDraft.length);
    setSelectionEnd(nextSelectionEndValue ?? nextSelectionStartValue ?? nextDraft.length);
  }

  async function executeLocalSlashCommand(command: SlashCommand) {
    setSlashMenuDismissed(true);
    disposeAttachmentPreviews(attachmentsRef.current);
    setDraft('');
    flushDraftPersistence();
    setAttachments([]);
    setSelectionStart(0);
    setSelectionEnd(0);

    if (command.localActionId === 'clear-thread') {
      await onCreateNewChat();
      return;
    }

    await onRunSlashSystemCommand(command, command.slash);
  }

  function applySelectedSlashCommand(command = filteredCommands[slashSelectedIndex]) {
    if (!command || !textareaRef.current) {
      return;
    }

    if (command.action === 'local-action') {
      void executeLocalSlashCommand(command);
      return;
    }

    setSlashMenuDismissed(false);
    const result = applySlashCommandSelection(draft, selectionStart, selectionEnd, command);
    handleDraftChange(result.text, result.selectionStart, result.selectionEnd);
    updateDraftSelection(result.selectionStart, result.selectionEnd);
  }

  function applyFileReference(file: FileReferenceSearchResult) {
    if (!activeFileReferenceToken) {
      return;
    }

    // 路径含空格/引号/反引号时，未加引号的 @ 引用会被 extractAtFileReferences 截断到首个空格前，
    // 必须用 @"..." 形式插入，发送时才能被正确解析为 file_reference block。
    const needsQuoting = /[\s"'`]/.test(file.rel);
    const replacement = needsQuoting ? `@"${file.rel}" ` : `@${file.rel} `;
    const nextDraft = `${draft.slice(0, activeFileReferenceToken.start)}${replacement}${draft.slice(activeFileReferenceToken.end)}`;
    const nextSelection = activeFileReferenceToken.start + replacement.length;
    handleDraftChange(nextDraft, nextSelection, nextSelection);
    updateDraftSelection(nextSelection, nextSelection);
    setFileReferenceResults([]);
    setFileReferenceLoading(false);
    setFileReferenceMenuDismissed(true);
  }

  function handleComposerInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (fileReferenceMenuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setFileReferenceSelectedIndex((current) => {
          if (fileReferenceResults.length === 0) {
            return 0;
          }
          return (current + 1) % fileReferenceResults.length;
        });
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setFileReferenceSelectedIndex((current) => {
          if (fileReferenceResults.length === 0) {
            return 0;
          }
          return (current - 1 + fileReferenceResults.length) % fileReferenceResults.length;
        });
        return;
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && fileReferenceResults.length > 0) {
        event.preventDefault();
        applyFileReference(fileReferenceResults[fileReferenceSelectedIndex] ?? fileReferenceResults[0]);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setFileReferenceMenuDismissed(true);
        return;
      }
    }

    const slashMenuVisible = slashMenuOpen && !slashMenuDismissed;

    if (slashMenuVisible && filteredCommands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashSelectedIndex((current) => getNextSlashCommandIndex(current, 'next', filteredCommands.length));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashSelectedIndex((current) => getNextSlashCommandIndex(current, 'previous', filteredCommands.length));
        return;
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        applySelectedSlashCommand();
        return;
      }
    }

    if (slashMenuVisible && event.key === 'Escape') {
      event.preventDefault();
      setSlashMenuDismissed(true);
      return;
    }

    onKeyDown(event);
    if (
      variant === 'ordinary'
      && !event.defaultPrevented
      && shouldSubmitComposerOnEnter({
        key: event.key,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        isComposing: event.nativeEvent.isComposing,
      })
    ) {
      event.preventDefault();
      if (!ordinarySelectionReady) {
        showToast('请先在全局设置中配置 AI 供应商和模型', 'info');
        return;
      }
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form className="composer" onSubmit={(event) => void handleSubmit(event)}>
      <div ref={composerCardRef} className={`composer-card${dragActive ? ' composer-card-drag-active' : ''}`}>
        {dragActive ? (
          <div className="composer-drop-hint" aria-hidden="true">
            松开以添加文件
          </div>
        ) : null}
        <PopoverPortal
          open={fileReferenceMenuOpen}
          anchorRef={composerCardRef}
          placement="top-start"
          offset={10}
          matchAnchorWidth
        >
          <div ref={fileReferenceMenuRef} className="model-menu model-menu-compact composer-file-reference-menu" role="listbox" aria-label="@文件引用">
            <div className="model-menu-title">@文件</div>
            {fileReferenceLoading ? <div className="model-menu-item">搜索中...</div> : null}
            {!fileReferenceLoading && activeFileReferenceToken && !shouldSearchFileReferenceQuery(activeFileReferenceToken.query) ? (
              <div className="model-menu-item">输入文件名或路径后开始搜索</div>
            ) : null}
            {!fileReferenceLoading && activeFileReferenceToken && shouldSearchFileReferenceQuery(activeFileReferenceToken.query) && fileReferenceResults.length === 0 ? (
              <div className="model-menu-item">未找到匹配文件</div>
            ) : null}
            {!fileReferenceLoading
              ? fileReferenceResults.map((file, index) => (
                  <button
                    key={file.path}
                    ref={(element) => {
                      fileReferenceItemRefs.current[index] = element;
                    }}
                    type="button"
                    className="model-menu-item"
                    role="option"
                    aria-selected={index === fileReferenceSelectedIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyFileReference(file)}
                    >
                      <span className="composer-file-reference-row">
                        <ComposerFileReferenceIcon path={file.rel} isDirectory={file.isDirectory} />
                        <span className="composer-file-reference-copy">
                          <span className="composer-file-reference-name">{getPathBasename(file.rel)}</span>
                          {(() => {
                            const directoryLabel = getPathDirectoryLabel(file.rel);
                            return directoryLabel ? (
                              <span className="composer-file-reference-path">{directoryLabel}</span>
                            ) : null;
                          })()}
                        </span>
                      </span>
                      {index === fileReferenceSelectedIndex ? <Check className="model-check" size={15} /> : null}
                    </button>
                ))
              : null}
          </div>
        </PopoverPortal>
        <PopoverPortal
          open={slashMenuOpen && !slashMenuDismissed}
          anchorRef={composerCardRef}
          placement="top-start"
          offset={10}
          matchAnchorWidth
        >
          <SlashCommandMenu
            commands={filteredCommands}
            selectedIndex={slashSelectedIndex}
            loading={slashCommandsLoading}
            query={slashQuery}
            onSelect={(command) => {
              void applySelectedSlashCommand(command);
            }}
          />
        </PopoverPortal>
        {queuedPrompts.length > 0 ? (
          <div className="composer-queued-prompts" aria-label="已排队提示">
            <div className="composer-queued-head">
              <span>排队中，当前回复完成后发送</span>
              {!queuedPromptGuideAvailability.available && queuedPromptGuideAvailability.reason ? (
                <small>{queuedPromptGuideAvailability.reason}</small>
              ) : null}
            </div>
            {queuedPrompts.map((prompt, index) => {
              const isPreparing = prompt.queueStatus === 'preparing';
              const guideDisabled = isPreparing || !queuedPromptGuideAvailability.available;
              const guideTitle = isPreparing
                ? '正在准备附件和文件引用'
                : queuedPromptGuideAvailability.available
                  ? '立即引导当前运行'
                  : queuedPromptGuideAvailability.reason ?? '暂不能引导';
              return (
              <div key={prompt.id} className={`composer-queued-prompt${isPreparing ? ' is-preparing' : ''}`}>
                <span className="composer-queued-index">{index + 1}</span>
                <span className="composer-queued-text">
                  {prompt.displayText || '图片消息'}
                  {isPreparing ? <small className="composer-queued-status"> · 准备附件中...</small> : null}
                </span>
                <div className="composer-queued-actions">
                  <button
                    type="button"
                    className="composer-queued-action"
                    aria-label="立即引导当前运行"
                    title={guideTitle}
                    disabled={guideDisabled}
                    onClick={() => void onGuideQueuedPrompt(prompt.id)}
                  >
                    <CornerDownRight size={13} />
                  </button>
                  <button
                    type="button"
                    className="composer-queued-action"
                    aria-label="编辑排队提示"
                    title="编辑消息"
                    onClick={() => onRecallQueuedPrompt(prompt.id)}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="composer-queued-action"
                    aria-label="取消排队提示"
                    title="取消排队"
                    onClick={() => onRemoveQueuedPrompt(prompt.id)}
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <div className="composer-attachments" aria-label="待发送附件">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="composer-attachment">
                {attachment.kind === 'image' ? (
                  <img src={attachment.previewUrl} alt={attachmentDisplayName(attachment)} className="composer-attachment-preview" />
                ) : (
                  <div className="composer-attachment-preview" aria-hidden="true">
                    {attachment.kind === 'path_reference' ? <CornerDownRight size={18} /> : <Pencil size={18} />}
                  </div>
                )}
                <div className="composer-attachment-meta">
                  <span className="composer-attachment-name">{attachmentDisplayName(attachment)}</span>
                  {attachment.kind === 'path_reference' ? (
                    <span className="composer-attachment-size" title={attachment.path}>{attachment.path}</span>
                  ) : (
                    <span className="composer-attachment-size">{attachmentSizeLabel(attachment)}</span>
                  )}
                  <span className="composer-attachment-size">{attachmentLabel(attachment)}</span>
                </div>
                <button
                  type="button"
                  className="composer-attachment-remove"
                  aria-label="移除附件"
                  title="移除附件"
                  onClick={() => removeAttachment(attachment.id)}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          className="composer-input"
          value={draft}
          onChange={(event) =>
            handleDraftChange(event.target.value, event.target.selectionStart ?? event.target.value.length, event.target.selectionEnd ?? event.target.value.length)
          }
          onClick={(event) => {
            setSelectionStart(event.currentTarget.selectionStart ?? 0);
            setSelectionEnd(event.currentTarget.selectionEnd ?? 0);
          }}
          onSelect={(event) => {
            setSelectionStart(event.currentTarget.selectionStart ?? 0);
            setSelectionEnd(event.currentTarget.selectionEnd ?? 0);
          }}
          onPaste={(event) => void handlePaste(event)}
          onKeyDown={handleComposerInputKeyDown}
          onBlur={flushDraftPersistence}
          placeholder={
            variant === 'ordinary'
              ? isRunning
                ? `${providerName} 正在回复`
                : '发送消息'
              : isRunning && !supportsQueue
              ? `${providerName} 正在运行`
              : isRunning
                ? '等待当前回复完成'
                : agent !== 'claude'
                  ? `让 ${providerName} 完成任务`
                  : '要求后续变更'
          }
        />
        <div className="composer-toolbar">
          <div className="composer-left-tools">
            <input
              ref={fileInputRef}
              type="file"
              accept={supportedComposerUploadAccept}
              multiple
              disabled={!allowAttachments}
              className="composer-file-input"
              onChange={(event) => void handleFileSelection(event)}
            />
            <div className="composer-add-anchor" ref={addMenuRef}>
              <PopoverPortal open={addMenuOpen} anchorRef={addMenuRef} placement="top-start">
                <div className="composer-add-menu" role="menu">
                  <button
                    type="button"
                    className="composer-add-menu-item"
                    role="menuitem"
                    disabled={!allowAttachments}
                    title={allowAttachments ? '添加附件' : `${providerName} 当前不支持附件`}
                    onClick={() => {
                      setAddMenuOpen(false);
                      void handleAddAttachmentClick();
                    }}
                    >
                    <Image size={15} />
                    <span>{allowAttachments ? '添加附件' : '当前 Provider 不支持附件'}</span>
                  </button>
                  <button
                    type="button"
                    className="composer-add-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setAddMenuOpen(false);
                      onOpenPlugins();
                    }}
                  >
                    <Puzzle size={15} />
                    <span>{variant === 'ordinary' ? 'AI 供应商配置' : '插件管理'}</span>
                  </button>
                </div>
              </PopoverPortal>
              <button
                type="button"
                className="plain-icon"
                title="添加附件和插件"
                aria-expanded={addMenuOpen}
                onClick={() => setAddMenuOpen((value) => !value)}
              >
                <Plus size={16} />
              </button>
            </div>
            {variant === 'ordinary' ? (
              <div className="permission-picker ordinary-context-picker" ref={knowledgeMenuRef}>
                <PopoverPortal open={knowledgeMenuOpen} anchorRef={knowledgeMenuRef} placement="top-start">
                  <div className="model-menu model-menu-compact knowledge-menu" role="menu" aria-label="知识库">
                    <div className="model-menu-title">知识库</div>
                    {knowledgeBases.length === 0 ? (
                      <div className="provider-menu-empty">暂无知识库</div>
                    ) : knowledgeBases.map((knowledgeBase) => {
                      const selected = selectedKnowledgeIds.includes(knowledgeBase.id);
                      return (
                        <button
                          key={knowledgeBase.id}
                          type="button"
                          className={`model-menu-item${selected ? ' active' : ''}`}
                          role="menuitemcheckbox"
                          aria-checked={selected}
                          disabled={isRunning}
                          onClick={() => void onToggleKnowledgeBase?.(knowledgeBase.id)}
                        >
                          <span className="model-menu-copy">
                            <strong>{knowledgeBase.name}</strong>
                            <small>{knowledgeBase.sourceCount} 个来源 · {knowledgeBase.chunkCount} 个片段</small>
                          </span>
                          {selected ? <Check size={14} /> : null}
                        </button>
                      );
                    })}
                    {onManageKnowledgeBases ? (
                      <>
                        <div className="workspace-menu-divider" />
                        <button
                          type="button"
                          className="model-menu-item"
                          onClick={() => {
                            setKnowledgeMenuOpen(false);
                            onManageKnowledgeBases();
                          }}
                        >
                          <span className="model-menu-copy"><strong>管理知识库</strong></span>
                        </button>
                      </>
                    ) : null}
                  </div>
                </PopoverPortal>
                <button
                  type="button"
                  className={`permission-trigger ordinary-context-trigger${selectedKnowledgeIds.length > 0 ? ' active' : ''}`}
                  aria-expanded={knowledgeMenuOpen}
                  aria-label={`知识库，已选择 ${selectedKnowledgeIds.length} 个`}
                  title={selectedKnowledgeIds.length > 0 ? `已选择 ${selectedKnowledgeIds.length} 个知识库` : '选择知识库'}
                  disabled={isRunning}
                  onClick={() => setKnowledgeMenuOpen((value) => !value)}
                >
                  <BookOpen size={15} />
                  {selectedKnowledgeIds.length > 0 ? <span>{selectedKnowledgeIds.length}</span> : null}
                </button>
              </div>
            ) : null}
            {variant === 'ordinary' ? (
                <div className="permission-picker ordinary-context-picker" ref={reasoningMenuRef}>
                  {ordinaryReasoningOptions.length > 0 ? (
                    <PopoverPortal open={reasoningMenuOpen && ordinaryThinkingEnabled} anchorRef={reasoningMenuRef} placement="top-start">
                    <div className="model-menu model-menu-compact knowledge-menu ordinary-reasoning-menu" role="menu" aria-label="思考等级">
                      <div className="model-menu-title">思考等级</div>
                      {ordinaryReasoningOptions.map((effort) => (
                        <button
                          key={effort}
                          type="button"
                          className={`model-menu-item${ordinaryThinkingEnabled && ordinaryReasoningEffort === effort ? ' active' : ''}`}
                          role="menuitemradio"
                          aria-checked={ordinaryThinkingEnabled && ordinaryReasoningEffort === effort}
                          disabled={isRunning || !ordinaryThinkingEnabled}
                          onClick={() => {
                            void onSelectOrdinaryReasoningEffort?.(effort);
                            setReasoningMenuOpen(false);
                          }}
                        >
                          <span className="model-menu-copy"><strong>{formatOrdinaryReasoningEffort(effort)}</strong></span>
                          {ordinaryThinkingEnabled && ordinaryReasoningEffort === effort ? <Check size={14} /> : null}
                        </button>
                      ))}
                    </div>
                    </PopoverPortal>
                  ) : null}
                  <div
                    className={`ordinary-thinking-control${ordinaryThinkingEnabled ? ' active' : ''}`}
                    data-disabled={isRunning || ordinaryReasoningOptions.length === 0 ? 'true' : undefined}
                  >
                    <button
                      type="button"
                      className="permission-trigger ordinary-context-trigger ordinary-thinking-trigger"
                      aria-pressed={ordinaryThinkingEnabled}
                      aria-label={ordinaryReasoningOptions.length === 0
                        ? '当前模型不支持思考'
                        : ordinaryThinkingEnabled
                          ? `关闭思考，当前等级${formatOrdinaryReasoningEffort(ordinaryReasoningEffort)}`
                          : '开启思考'}
                      title={ordinaryReasoningOptions.length === 0
                        ? '当前供应商和模型不支持可控思考'
                        : ordinaryThinkingEnabled
                          ? '关闭思考'
                          : '开启思考'}
                      disabled={isRunning || ordinaryReasoningOptions.length === 0}
                      onClick={() => {
                        setReasoningMenuOpen(false);
                        void onToggleOrdinaryThinking?.();
                      }}
                    >
                      <Lightbulb size={15} />
                      <span>{ordinaryThinkingEnabled ? formatOrdinaryReasoningEffort(ordinaryReasoningEffort) : '思考'}</span>
                    </button>
                    <button
                      type="button"
                      className="ordinary-thinking-level-trigger"
                      aria-expanded={reasoningMenuOpen && ordinaryThinkingEnabled}
                      aria-haspopup="menu"
                      aria-label="选择思考等级"
                      title={ordinaryThinkingEnabled ? '选择思考等级' : '开启思考后选择等级'}
                      disabled={isRunning || !ordinaryThinkingEnabled || ordinaryReasoningOptions.length < 2}
                      onClick={() => setReasoningMenuOpen((value) => !value)}
                    >
                      <ChevronDown size={13} className="ordinary-context-chevron" />
                    </button>
                  </div>
                </div>
            ) : null}
            {variant === 'ordinary' ? (
              <button
                type="button"
                className={`permission-trigger ordinary-context-trigger ordinary-web-search-trigger${ordinaryWebSearchEnabled ? ' active' : ''}`}
                aria-label={ordinaryWebSearchAvailable ? (ordinaryWebSearchEnabled ? '联网搜索已开启' : '开启联网搜索') : '当前模型不支持联网搜索'}
                title={ordinaryWebSearchAvailable ? (ordinaryWebSearchEnabled ? '关闭联网搜索' : '开启联网搜索') : '当前供应商和模型不支持原生联网搜索'}
                disabled={isRunning || !ordinaryWebSearchAvailable}
                onClick={() => void onToggleOrdinaryWebSearch?.()}
              >
                <Globe size={15} />
                {ordinaryWebSearchEnabled ? <span>联网</span> : null}
              </button>
            ) : null}
            {variant === 'ordinary' ? (
              <div className="permission-picker ordinary-context-picker" ref={mcpMenuRef}>
                <PopoverPortal open={mcpMenuOpen} anchorRef={mcpMenuRef} placement="top-start">
                  <div className="model-menu model-menu-compact knowledge-menu mcp-menu" role="menu" aria-label="MCP 服务">
                    <div className="model-menu-title">MCP 服务</div>
                    {mcpServers.length === 0 ? (
                      <div className="provider-menu-empty">暂无可用 MCP 服务</div>
                    ) : mcpServers.map((server) => {
                      const selected = selectedMcpIds.includes(server.id);
                      return (
                        <button
                          key={server.id}
                          type="button"
                          className={`model-menu-item${selected ? ' active' : ''}`}
                          role="menuitemcheckbox"
                          aria-checked={selected}
                          disabled={isRunning || server.status === 'error'}
                          title={server.error || server.source}
                          onClick={() => void onToggleMcpServer?.(server.id)}
                        >
                          <span className="model-menu-copy">
                            <strong>{server.name}</strong>
                            <small>{server.command || server.source}</small>
                          </span>
                          {selected ? <Check size={14} /> : null}
                        </button>
                      );
                    })}
                  </div>
                </PopoverPortal>
                <button
                  type="button"
                  className={`permission-trigger ordinary-context-trigger${selectedMcpIds.length > 0 ? ' active' : ''}`}
                  aria-expanded={mcpMenuOpen}
                  aria-label={`MCP 服务，已选择 ${selectedMcpIds.length} 个`}
                  title={selectedMcpIds.length > 0 ? `已选择 ${selectedMcpIds.length} 个 MCP 服务` : '选择 MCP 服务'}
                  disabled={isRunning}
                  onClick={() => setMcpMenuOpen((value) => !value)}
                >
                  <Server size={15} />
                  {selectedMcpIds.length > 0 ? <span>{selectedMcpIds.length}</span> : null}
                </button>
              </div>
            ) : null}
            {variant !== 'ordinary' ? <div className="permission-picker provider-picker" ref={providerMenuRef}>
              <PopoverPortal open={providerMenuOpen} anchorRef={providerMenuRef} placement="top-start">
                <div className="model-menu model-menu-compact provider-menu" role="menu">
                  <div className="model-menu-title">Agent Provider</div>
                  {providers.length === 0 ? (
                    <>
                      <div className="provider-menu-empty">
                        {providersLoading ? '正在读取 Provider...' : providersError || '尚未配置 AI 供应商'}
                      </div>
                    </>
                  ) : providers.map((provider) => {
                    const selected = provider.id === providerId;
                    const unavailableReason = providerUnavailableReason(provider);
                    const disabled = !provider.selectable || provider.available !== true;
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        className="model-menu-item provider-menu-item"
                        role="menuitemradio"
                        aria-checked={selected}
                        disabled={disabled}
                        title={unavailableReason || provider.displayName}
                        onClick={() => {
                          const accepted = onSelectProvider(provider.id);
                          if (accepted !== false) {
                            setProviderMenuOpen(false);
                          }
                        }}
                      >
                        <AgentProviderIcon providerId={provider.id} size={15} />
                        <span className="model-menu-item-copy">
                          <span>{provider.displayName}</span>
                          <small>{unavailableReason || provider.driverId}</small>
                        </span>
                        {selected ? <Check className="model-check" size={15} /> : null}
                      </button>
                    );
                  })}
                </div>
              </PopoverPortal>

              <button
                type="button"
                className="permission-trigger provider-trigger"
                aria-expanded={providerMenuOpen}
                aria-label={
                  canSelectProvider
                    ? `选择 Agent Provider，当前为 ${providerName}`
                    : `当前 Agent Provider：${providerName}`
                }
                disabled={providerSelectionDisabled}
                title={
                  canSelectProvider
                    ? `选择 Agent Provider，当前为 ${providerName}`
                    : `${providerName}；Provider 在聊天创建后锁定，请新建聊天后选择`
                }
                onClick={() => setProviderMenuOpen((value) => !value)}
              >
                <AgentProviderIcon providerId={providerId} size={16} />
              </button>
            </div> : null}
            {variant !== 'ordinary' ? <div className="permission-picker agent-channel-picker" ref={agentChannelMenuRef}>
              <PopoverPortal open={agentChannelMenuOpen} anchorRef={agentChannelMenuRef} placement="top-start">
                <div className="model-menu model-menu-compact agent-channel-menu" role="menu" aria-label={`${providerName} 渠道`}>
                  <div className="model-menu-title">渠道</div>
                  <button
                    type="button"
                    className="model-menu-item"
                    role="menuitemradio"
                    aria-checked={agentChannelId === SYSTEM_AGENT_CHANNEL_ID}
                    disabled={isRunning}
                    onClick={() => {
                      const accepted = onSelectAgentChannel(SYSTEM_AGENT_CHANNEL_ID);
                      if (accepted !== false) {
                        setAgentChannelMenuOpen(false);
                      }
                    }}
                  >
                    {systemAgentChannelBrand
                      ? <ProviderBrandIcon icon={systemAgentChannelBrand.icon} name={systemAgentChannelBrand.vendorName} size={22} />
                      : <Route size={15} />}
                    <span className="model-menu-item-copy">
                      <span>系统渠道</span>
                      <small>跟随本机 {providerName} 当前配置</small>
                    </span>
                    {agentChannelId === SYSTEM_AGENT_CHANNEL_ID ? <Check className="model-check" size={15} /> : null}
                  </button>
                  {availableAgentChannels.map((channel) => {
                    const channelTemplate = agentChannelTemplate(channel, agentChannelTemplates);
                    return <button
                      key={channel.id}
                      type="button"
                      className="model-menu-item"
                      role="menuitemradio"
                      aria-checked={agentChannelId === channel.id}
                      disabled={isRunning}
                      onClick={() => {
                        const accepted = onSelectAgentChannel(channel.id);
                        if (accepted !== false) {
                          setAgentChannelMenuOpen(false);
                        }
                      }}
                    >
                      {channelTemplate
                        ? <ProviderBrandIcon icon={channelTemplate.icon} name={channelTemplate.vendorName} size={22} />
                        : <Route size={15} />}
                      <span className="model-menu-item-copy">
                        <span>{channel.name}</span>
                        <small>{channel.models.filter((item) => item.enabled).length} 个模型</small>
                      </span>
                      {agentChannelId === channel.id ? <Check className="model-check" size={15} /> : null}
                    </button>;
                  })}
                  {availableAgentChannels.length === 0 ? (
                    <div className="provider-menu-empty">暂无 CodeM 渠道，可在全局设置中新增</div>
                  ) : null}
                  <button
                    type="button"
                    className="model-menu-item agent-channel-manage-item"
                    role="menuitem"
                    onClick={() => {
                      setAgentChannelMenuOpen(false);
                      onManageAgentChannels?.(providerId);
                    }}
                  >
                    <ServerCog size={15} />
                    <span className="model-menu-item-copy"><span>管理渠道</span><small>打开 {providerName} 渠道设置</small></span>
                  </button>
                </div>
              </PopoverPortal>

              <button
                type="button"
                className={`permission-trigger agent-channel-trigger${agentChannelId !== SYSTEM_AGENT_CHANNEL_ID ? ' active' : ''}`}
                aria-expanded={agentChannelMenuOpen}
                aria-label={`渠道：${agentChannelName}`}
                disabled={isRunning}
                title={isRunning ? `${providerName} 运行中，渠道已锁定` : `渠道：${agentChannelName}`}
                onClick={() => setAgentChannelMenuOpen((value) => !value)}
              >
                {selectedAgentChannelTemplate
                  ? <ProviderBrandIcon icon={selectedAgentChannelTemplate.icon} name={selectedAgentChannelTemplate.vendorName} size={22} />
                  : <Route size={15} />}
                <span>{agentChannelName}</span>
                <span className="permission-trigger-chevron" aria-hidden="true" />
              </button>
            </div> : null}
            {variant !== 'ordinary' ? <div className="permission-picker" ref={permissionMenuRef}>
              <PopoverPortal open={permissionMenuOpen} anchorRef={permissionMenuRef} placement="top-end">
                <div className="permission-menu" role="menu" aria-label="权限模式">
                  {permissionMenuModes.map((mode) => {
                    const tooltip = permissionModeTooltip(agent, mode, providerName);
                    return (
                      <button
                        key={mode}
                        type="button"
                        className="permission-menu-item"
                        role="menuitemradio"
                        aria-checked={permissionMode === mode}
                        aria-label={tooltip}
                        title={tooltip}
                        onClick={() => {
                          onSelectPermissionMode(mode);
                          setPermissionMenuOpen(false);
                        }}
                      >
                        <PermissionModeIcon mode={mode} size={15} />
                        <span>{permissionLabel(mode)}</span>
                        {permissionMode === mode ? <Check className="permission-check" size={14} /> : null}
                      </button>
                    );
                  })}
                </div>
              </PopoverPortal>

              <button
                type="button"
                className="permission-trigger"
                aria-expanded={permissionMenuOpen}
                aria-label={`权限模式：${permissionLabel(permissionMode)}`}
                disabled={permissionSelectionDisabled}
                title={permissionSelectionDisabled ? `${providerName} 运行中，权限模式已锁定` : undefined}
                onClick={() => setPermissionMenuOpen((value) => !value)}
              >
                <PermissionModeIcon mode={permissionMode} size={15} />
                <span>{permissionLabel(permissionMode)}</span>
                <span className="permission-trigger-chevron" aria-hidden="true" />
              </button>
            </div> : null}
          </div>

          <div className="composer-right-tools">
            {agent === 'claude' ? (
              <>
                <div className="model-picker" ref={modelMenuRef}>
              <PopoverPortal open={modelMenuOpen} anchorRef={modelMenuRef} placement="top-end">
                <div className={`model-menu${modelMenuHasContext1mOptions ? '' : ' model-menu-compact'}`} role="menu">
                  <div className="model-menu-title">模型</div>
                  {models.map((item) => {
                    const description = modelMenuDescriptionLabel(item);
                    const context1mModel = item.context1mModel;
                    const context1mSelected = Boolean(context1mModel && model === context1mModel);
                    const rowSelected = model === item.id || context1mSelected;
                    const selectBaseModel = () => {
                      onSelectModel(item.id);
                      setModelMenuOpen(false);
                    };
                    const toggleContext1m = () => {
                      if (!context1mModel) {
                        return;
                      }

                      onSelectModel(context1mSelected ? item.id : context1mModel);
                      setModelMenuOpen(false);
                    };

                    return (
                      <div
                        key={item.id}
                        className={`model-menu-item${item.supportsContext1m ? ' model-menu-item-with-toggle' : ''}`}
                        role="menuitemradio"
                        aria-checked={rowSelected}
                        tabIndex={0}
                        onClick={selectBaseModel}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            selectBaseModel();
                          }
                        }}
                      >
                        <span className="model-menu-item-copy">
                          <span>{modelMenuPrimaryLabel(item)}</span>
                          {description ? <small>{description}</small> : null}
                        </span>
                        {item.supportsContext1m && context1mModel ? (
                          <span
                            className={`model-context-toggle${context1mSelected ? ' active' : ''}`}
                            role="switch"
                            aria-checked={context1mSelected}
                            tabIndex={0}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleContext1m();
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                event.stopPropagation();
                                toggleContext1m();
                              }
                            }}
                          >
                            {modelContext1mMenuActionLabel(context1mSelected)}
                          </span>
                        ) : null}
                        {rowSelected ? <Check className="model-check" size={15} /> : null}
                      </div>
                    );
                  })}
                </div>
              </PopoverPortal>

              <button
                type="button"
                className="model-trigger"
                aria-expanded={modelMenuOpen}
                disabled={models.length === 0 || isRunning}
                title="Claude Code model"
                onClick={() => setModelMenuOpen((value) => !value)}
              >
                <span>{modelTriggerLabel(model, models)}</span>
                <span className="model-trigger-chevron" aria-hidden="true" />
              </button>
                </div>
                <div className="effort-picker" ref={effortMenuRef}>
              <PopoverPortal open={effortMenuOpen} anchorRef={effortMenuRef} placement="top-end">
                <div className="effort-menu" role="menu">
                  <div className="model-menu-title">思考级别</div>
                  {claudeEffortOptions.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className="effort-menu-item"
                      role="menuitemradio"
                      aria-checked={effort === item.value}
                      onClick={() => {
                        onSelectEffort(item.value);
                        setEffortMenuOpen(false);
                      }}
                    >
                      <Brain size={14} />
                      <span className="model-menu-item-copy">
                        <span>{item.label}</span>
                        <small>{item.description}</small>
                      </span>
                      {effort === item.value ? <Check className="model-check" size={15} /> : null}
                    </button>
                  ))}
                </div>
              </PopoverPortal>

              <button
                type="button"
                className="effort-trigger"
                aria-expanded={effortMenuOpen}
                disabled={isRunning}
                title="Claude Code effort"
                onClick={() => setEffortMenuOpen((value) => !value)}
              >
                <Brain size={14} />
                <span>{effortLabel(effort)}</span>
                <span className="model-trigger-chevron" aria-hidden="true" />
              </button>
                </div>
                <ComposerContextIndicator
                  usage={contextUsage}
                  nativeContext={claudeContextState?.context}
                  nativeContextStatus={claudeContextState?.status ?? 'idle'}
                  onRefreshClaudeContext={onRefreshClaudeContext}
                  shouldRefreshClaudeContextOnOpen={shouldRefreshClaudeContextOnOpen}
                />
              </>
            ) : (
              <>
                {variant === 'ordinary' ? (
                  <OrdinaryProviderModelControls
                    providers={providers}
                    selectedProviderId={providerId}
                    selectedModelId={agentModel}
                    providersLoading={providersLoading}
                    providersError={providersError}
                    disabled={isRunning}
                    onSelectProvider={onSelectProvider}
                    onSelectModel={onSelectAgentModel}
                    onOpenSettings={onOpenPlugins}
                  />
                ) : <div className="model-picker" ref={modelMenuRef}>
                  <PopoverPortal open={modelMenuOpen} anchorRef={modelMenuRef} placement="top-end">
                    <div className="model-menu model-menu-compact agent-model-menu" role="menu" aria-label={`${providerName} 模型`}>
                      <div className="model-menu-title">模型</div>
                      <button
                        type="button"
                        className="model-menu-item"
                        role="menuitemradio"
                        aria-checked={agentModel === DEFAULT_MODEL_VALUE}
                        disabled={isRunning}
                        onClick={() => {
                          onSelectAgentModel(DEFAULT_MODEL_VALUE);
                          setModelMenuOpen(false);
                        }}
                      >
                        <span className="model-menu-item-copy">
                          <span>默认</span>
                          <small>
                            {defaultAgentModelOption
                              ? `当前：${defaultAgentModelOption.label}`
                              : '跟随渠道默认'}
                          </small>
                        </span>
                        {agentModel === DEFAULT_MODEL_VALUE ? <Check className="model-check" size={15} /> : null}
                      </button>
                      {agentModelsLoading ? (
                        <div className="provider-menu-empty">正在读取模型目录...</div>
                      ) : null}
                      {agentModelsError ? (
                        <>
                          <div className="provider-menu-empty" role="alert">{agentModelsError}</div>
                          <button
                            type="button"
                            className="model-menu-item"
                            onClick={onRetryAgentModels}
                          >
                            <RefreshCw size={14} />
                            <span>重试</span>
                          </button>
                        </>
                      ) : null}
                      {agentModelSelectionWarning ? (
                        <div className="provider-menu-empty" role="status">{agentModelSelectionWarning}</div>
                      ) : null}
                      {agentModelCatalog?.models.map((item) => {
                        const selected = agentModel === item.id;
                        const description = agentModelDescription(item);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className="model-menu-item"
                            role="menuitemradio"
                            aria-checked={selected}
                            disabled={isRunning}
                            title={item.label}
                            onClick={() => {
                              onSelectAgentModel(item.id);
                              setModelMenuOpen(false);
                            }}
                          >
                            <span className="model-menu-item-copy">
                              <span title={item.label}>{item.label}</span>
                              {description ? <small>{description}</small> : null}
                            </span>
                            {selected ? <Check className="model-check" size={15} /> : null}
                          </button>
                        );
                      })}
                    </div>
                  </PopoverPortal>

                  <button
                    type="button"
                    className="model-trigger"
                    aria-expanded={modelMenuOpen}
                    aria-label={`${providerName} model`}
                    disabled={isRunning}
                    title={
                      isRunning
                        ? `${providerName} 运行中，模型已锁定`
                        : agentModelSelectionWarning || agentModelsError || `${providerName} model`
                    }
                    onClick={() => setModelMenuOpen((value) => !value)}
                  >
                    {agentModelsLoading ? <Loader2 size={13} className="spin-icon" /> : null}
                    <span>{agentModelTriggerLabel(agentModel, selectedAgentModelOption)}</span>
                    <span className="model-trigger-chevron" aria-hidden="true" />
                  </button>
                </div>}
                {agent === 'codex' && agentReasoningEffortOptions.length > 0 ? (
                  <div className="effort-picker" ref={effortMenuRef}>
                    <PopoverPortal open={effortMenuOpen} anchorRef={effortMenuRef} placement="top-end">
                      <div className="effort-menu" role="menu" aria-label="Codex 思考级别">
                        <div className="model-menu-title">思考级别</div>
                        {agentReasoningEffortOptions.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="effort-menu-item"
                            role="menuitemradio"
                            aria-checked={agentReasoningEffort === item.id}
                            disabled={isRunning}
                            onClick={() => {
                              onSelectAgentReasoningEffort(item.id);
                              setEffortMenuOpen(false);
                            }}
                          >
                            <Brain size={14} />
                            <span className="model-menu-item-copy">
                              <span>{agentEffortLabel(item.id)}</span>
                              {item.description ? <small>{item.description}</small> : null}
                            </span>
                            {agentReasoningEffort === item.id ? <Check className="model-check" size={15} /> : null}
                          </button>
                        ))}
                      </div>
                    </PopoverPortal>

                    <button
                      type="button"
                      className="effort-trigger"
                      aria-expanded={effortMenuOpen}
                      disabled={isRunning}
                      title={isRunning ? 'Codex 运行中，思考级别已锁定' : 'Codex reasoning effort'}
                      onClick={() => setEffortMenuOpen((value) => !value)}
                    >
                      <Brain size={14} />
                      <span>{agentEffortLabel(agentReasoningEffort)}</span>
                      <span className="model-trigger-chevron" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </>
            )}
            <button type="button" className="plain-icon" title="语音输入暂未开放" aria-label="语音输入暂未开放">
              <Mic size={15} />
            </button>
            {showStopButton ? (
              <button
                type="button"
                className="send-button stop"
                onClick={() => void onStopRun()}
                disabled={isInterrupting}
                aria-label={isInterrupting ? '正在中断当前回合' : '中断当前回合'}
                title={isInterrupting ? '正在中断当前回合' : '中断当前回合'}
              >
                {isInterrupting ? <Loader2 size={14} className="spin-icon" /> : <Square size={13} fill="currentColor" />}
              </button>
            ) : (
              <button
                type="submit"
                className="send-button"
                disabled={!hasPendingContent || (isRunning && !supportsQueue) || !ordinarySelectionReady}
                title={!ordinarySelectionReady
                  ? '请先在全局设置中配置 AI 供应商和模型'
                  : isRunning && supportsQueue ? '发送到队列' : '发送'}
              >
                <ArrowUp size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

type OrdinaryProviderModelControlsProps = {
  providers: AgentProviderDescriptor[];
  selectedProviderId: string;
  selectedModelId: string;
  providersLoading: boolean;
  providersError: string;
  disabled: boolean;
  onSelectProvider: (providerId: string) => boolean | void;
  onSelectModel: (modelId: string) => void;
  onOpenSettings: () => void;
};

function OrdinaryProviderModelControls({
  providers,
  selectedProviderId,
  selectedModelId,
  providersLoading,
  providersError,
  disabled,
  onSelectProvider,
  onSelectModel,
  onOpenSettings,
}: OrdinaryProviderModelControlsProps) {
  const [providerOpen, setProviderOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const providerPickerRef = useRef<HTMLDivElement | null>(null);
  const modelPickerRef = useRef<HTMLDivElement | null>(null);
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const selectedModel = selectedProvider?.models?.find((model) => model.id === selectedModelId);
  const providerName = selectedProvider?.displayName ?? '未配置供应商';
  const modelName = selectedModel?.label ?? '未选择模型';
  const selectedProviderModels = selectedProvider?.models ?? [];

  useOutsideDismiss({
    selectors: [
      {
        selector: '.ordinary-provider-menu',
        onDismiss: () => setProviderOpen(false),
        anchorRefs: [providerPickerRef],
      },
      {
        selector: '.ordinary-model-menu',
        onDismiss: () => setModelOpen(false),
        anchorRefs: [modelPickerRef],
      },
    ],
  });

  function selectProvider(providerId: string) {
    const accepted = onSelectProvider(providerId);
    if (accepted !== false) setProviderOpen(false);
  }

  return (
    <div className="ordinary-provider-model-controls">
      <div className="permission-picker ordinary-provider-picker" ref={providerPickerRef}>
        <PopoverPortal open={providerOpen} anchorRef={providerPickerRef} placement="top-end">
          <div className="model-menu model-menu-compact ordinary-provider-menu" role="menu" aria-label="AI 供应商">
            <div className="model-menu-title">AI 供应商</div>
            {providersLoading && providers.length === 0 ? (
              <div className="provider-menu-empty">正在读取供应商...</div>
            ) : null}
            {!providersLoading && providers.length === 0 ? (
              <div className="provider-menu-empty">{providersError || '尚未配置 AI 供应商'}</div>
            ) : null}
            {providers.map((provider) => {
              const selected = provider.id === selectedProviderId;
              const unavailableReason = providerUnavailableReason(provider);
              const providerSelectable = provider.selectable && provider.available === true;
              return (
                <button
                  key={provider.id}
                  type="button"
                  className="model-menu-item ordinary-provider-menu-item"
                  role="menuitemradio"
                  aria-checked={selected}
                  disabled={disabled || !providerSelectable}
                  title={unavailableReason || provider.displayName}
                  onClick={() => selectProvider(provider.id)}
                >
                  <ProviderBrandIcon icon={provider.icon} name={provider.displayName} size={20} />
                  <span className="model-menu-item-copy">
                    <span>{provider.displayName}</span>
                    <small>{unavailableReason || `${provider.models?.length ?? 0} 个可用模型`}</small>
                  </span>
                  {selected ? <Check className="model-check" size={15} /> : null}
                </button>
              );
            })}
            <button
              type="button"
              className="model-menu-item ordinary-provider-settings"
              onClick={() => {
                setProviderOpen(false);
                onOpenSettings();
              }}
            >
              <ServerCog size={14} />
              <span>管理 AI 供应商</span>
            </button>
          </div>
        </PopoverPortal>
        <button
          type="button"
          className="permission-trigger ordinary-provider-trigger"
          aria-expanded={providerOpen}
          aria-label={`选择 AI 供应商，当前为 ${providerName}`}
          title={disabled ? `${providerName} 运行中，供应商已锁定` : providerName}
          disabled={disabled}
          onClick={() => {
            setModelOpen(false);
            setProviderOpen((value) => !value);
          }}
        >
          {providersLoading ? (
            <Loader2 size={16} className="spin-icon" />
          ) : (
            <ProviderBrandIcon icon={selectedProvider?.icon} name={providerName} size={20} />
          )}
        </button>
      </div>

      <div className="model-picker ordinary-model-picker" ref={modelPickerRef}>
        <PopoverPortal open={modelOpen} anchorRef={modelPickerRef} placement="top-end">
          <div className="model-menu model-menu-compact ordinary-model-menu" role="menu" aria-label={`${providerName} 模型`}>
            <div className="model-menu-title">{providerName} 模型</div>
            {selectedProviderModels.length === 0 ? (
              <div className="provider-menu-empty">当前供应商暂无可用模型</div>
            ) : null}
            {selectedProviderModels.map((model) => {
              const selected = model.id === selectedModelId;
              return (
                <button
                  key={model.id}
                  type="button"
                  className="model-menu-item ordinary-model-menu-item"
                  role="menuitemradio"
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => {
                    onSelectModel(model.id);
                    setModelOpen(false);
                  }}
                >
                  <span className="model-menu-item-copy">
                    <span>{model.label}</span>
                    {model.description ? <small>{model.description}</small> : null}
                  </span>
                  {selected ? <Check className="model-check" size={15} /> : null}
                </button>
              );
            })}
          </div>
        </PopoverPortal>
        <button
          type="button"
          className="model-trigger ordinary-model-trigger"
          aria-expanded={modelOpen}
          aria-label={`选择 ${providerName} 模型，当前为 ${modelName}`}
          title={disabled ? `${providerName} 运行中，模型已锁定` : modelName}
          disabled={disabled || !selectedProvider}
          onClick={() => {
            setProviderOpen(false);
            setModelOpen((value) => !value);
          }}
        >
          <span>{modelName}</span>
          <span className="model-trigger-chevron" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function extractImageFiles(items: DataTransferItemList) {
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) {
      continue;
    }
    const file = item.getAsFile();
    if (file) {
      files.push(file);
    }
  }
  return files;
}

async function uploadImageAttachments(attachments: PendingComposerAttachment[], workingDirectory: string) {
  const uploadedAttachments: UserImageAttachment[] = [];

  for (const attachment of attachments) {
    if (attachment.kind !== 'image') {
      continue;
    }

    // 桌面端图片已带真实路径与 base64，直接复用，无需再次上传落盘。
    if (attachment.desktopImage) {
      uploadedAttachments.push({
        id: attachment.id,
        path: attachment.desktopImage.path,
        mimeType: attachment.desktopImage.mimeType,
        size: attachment.desktopImage.size,
        name: attachment.desktopImage.name,
        data: attachment.desktopImage.data,
      });
      continue;
    }

    if (!attachment.file) {
      continue;
    }

    const dataUrl = await readFileAsDataUrl(attachment.file);
    const imagePayload = extractImageDataUrlPayload(dataUrl);
    const response = await fetch('/api/system/attachments/image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workingDirectory,
        fileName: attachment.file.name,
        mimeType: attachment.file.type,
        dataUrl,
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || '图片上传失败');
    }

    const payload = await response.json() as {
      path: string;
      mimeType?: string;
      size?: number;
      name?: string;
    };
    uploadedAttachments.push({
      id: attachment.id,
      path: payload.path,
      mimeType: payload.mimeType || attachment.file.type,
      size: typeof payload.size === 'number' ? payload.size : attachment.file.size,
      name: payload.name || attachment.file.name || 'pasted-image.png',
      data: imagePayload.data,
    });
  }

  return uploadedAttachments;
}

async function buildInlineImageAttachments(attachments: PendingComposerAttachment[]) {
  const images: UserImageAttachment[] = [];
  for (const attachment of attachments) {
    if (attachment.kind !== 'image') continue;
    if (attachment.desktopImage) {
      images.push({
        id: attachment.id,
        path: attachment.desktopImage.path,
        name: attachment.desktopImage.name,
        mimeType: attachment.desktopImage.mimeType,
        size: attachment.desktopImage.size,
        data: attachment.desktopImage.data,
      });
      continue;
    }
    if (!attachment.file) continue;
    const payload = extractImageDataUrlPayload(await readFileAsDataUrl(attachment.file));
    images.push({
      id: attachment.id,
      path: '',
      name: attachment.file.name || 'pasted-image.png',
      mimeType: payload.mimeType || attachment.file.type || 'image/png',
      size: attachment.file.size,
      data: payload.data,
    });
  }
  return images;
}

// 桌面端按真实路径读取图片，返回 base64，供构建多模态 image block。
async function readDesktopImageAttachment(filePath: string): Promise<ResolvedDesktopImage | null> {
  try {
    const response = await fetch('/api/system/attachments/image-from-path', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: filePath }),
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      path?: string;
      name?: string;
      mimeType?: string;
      size?: number;
      data?: string;
    };
    if (!payload.data || !payload.mimeType || !payload.path) {
      return null;
    }
    return {
      path: payload.path,
      name: payload.name || getDesktopPathBasename(filePath),
      mimeType: payload.mimeType,
      size: typeof payload.size === 'number' ? payload.size : 0,
      data: payload.data,
    };
  } catch {
    return null;
  }
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('图片读取失败'));
    };
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('文本文件读取失败'));
    };
    reader.onerror = () => reject(new Error('文本文件读取失败'));
    reader.readAsText(file);
  });
}

function extractImageDataUrlPayload(dataUrl: string) {
  const matched = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!matched) {
    throw new Error('图片读取失败');
  }

  return {
    mimeType: matched[1],
    data: matched[2],
  };
}

function formatAttachmentSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function effortLabel(effort: ClaudeEffortSelection) {
  return claudeEffortOptions.find((item) => item.value === effort)?.label ?? '默认';
}

function agentModelTriggerLabel(modelId: string, selectedModel?: AgentModelOption) {
  return modelId === DEFAULT_MODEL_VALUE ? '默认' : selectedModel?.label ?? modelId;
}

function agentModelDescription(model: AgentModelOption) {
  const context = model.contextWindowTokens
    ? `${compactTokenCount(model.contextWindowTokens)} 上下文`
    : '';
  return [model.isDefault ? '渠道默认' : '', context]
    .filter(Boolean)
    .join(' · ');
}

function compactTokenCount(tokens: number) {
  if (tokens >= 1_000_000) {
    return `${Number((tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1))}M`;
  }
  if (tokens >= 1_000) {
    return `${Number((tokens / 1_000).toFixed(tokens % 1_000 === 0 ? 0 : 1))}K`;
  }
  return String(tokens);
}

function agentEffortLabel(effort: string) {
  if (!effort) {
    return '默认';
  }
  if (effort.toLowerCase() === 'xhigh') {
    return 'XHigh';
  }
  return `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}

function attachmentLabel(attachment: PendingComposerAttachment) {
  if (attachment.kind === 'image') {
    return '图片';
  }
  if (attachment.kind === 'file_text') {
    return '文本内联';
  }
  if (attachment.kind === 'path_reference') {
    return '文件引用';
  }
  return '大文件引用';
}

function attachmentDisplayName(attachment: PendingComposerAttachment) {
  if (attachment.kind === 'path_reference') {
    return attachment.name || 'file';
  }
  if (attachment.kind === 'image') {
    return attachment.desktopImage?.name || attachment.file?.name || 'pasted-image.png';
  }
  return attachment.file.name || 'file';
}

function attachmentSizeLabel(attachment: PendingComposerAttachment) {
  if (attachment.kind === 'path_reference') {
    return '';
  }
  if (attachment.kind === 'image') {
    const size = attachment.desktopImage?.size ?? attachment.file?.size;
    return typeof size === 'number' ? formatAttachmentSize(size) : '';
  }
  return formatAttachmentSize(attachment.file.size);
}

function disposeAttachmentPreviews(attachments: PendingComposerAttachment[]) {
  for (const attachment of attachments) {
    if (attachment.kind === 'image' && attachment.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }
}

function getActiveFileReferenceToken(text: string, selectionStart: number, selectionEnd: number) {
  if (selectionStart !== selectionEnd) {
    return null;
  }

  const cursor = Math.max(0, Math.min(selectionStart, text.length));
  // 注意：String.prototype.lastIndexOf(s, fromIndex) 的 fromIndex 在 <0 时会被 clamp 为 0，
  // 仍可能命中位置 0 的 '@'，导致 atIndex 一直停在 0 形成死循环。这里显式在 atIndex==0 时终止。
  for (
    let atIndex = text.lastIndexOf('@', cursor - 1);
    atIndex >= 0;
    atIndex = atIndex > 0 ? text.lastIndexOf('@', atIndex - 1) : -1
  ) {
    const previousChar = atIndex > 0 ? text[atIndex - 1] : '';
    if (previousChar && !/[\s([{]/.test(previousChar)) {
      continue;
    }

    const quoted = text[atIndex + 1] === '"';
    if (quoted) {
      const contentStart = atIndex + 2;
      let contentEnd = contentStart;
      while (contentEnd < text.length && text[contentEnd] !== '"') {
        contentEnd += 1;
      }
      if (cursor < contentStart || cursor > contentEnd) {
        continue;
      }

      return {
        start: atIndex,
        end: contentEnd < text.length && text[contentEnd] === '"' ? contentEnd + 1 : contentEnd,
        query: text.slice(contentStart, cursor),
      };
    }

    const tokenStart = atIndex + 1;
    let tokenEnd = tokenStart;
    while (tokenEnd < text.length && isFileReferenceTokenChar(text[tokenEnd])) {
      tokenEnd += 1;
    }
    if (cursor < tokenStart || cursor > tokenEnd) {
      continue;
    }

    return {
      start: atIndex,
      end: tokenEnd,
      query: text.slice(tokenStart, cursor),
    };
  }

  return null;
}

function isFileReferenceTokenChar(char: string) {
  return /[A-Za-z0-9_./\\:-]/.test(char);
}

async function resolveExistingFileReferenceBlocks(draft: string, workspace: string): Promise<InputContentBlock[]> {
  const references = extractAtFileReferences(draft);
  const blocks: InputContentBlock[] = [];

  for (const reference of references) {
    const matchedFile = await findExistingRelativeFile(workspace, reference);
    if (!matchedFile) {
      continue;
    }

    blocks.push({
      type: 'file_reference',
      path: matchedFile.path,
      name: getPathBasename(matchedFile.path),
      source: 'mention',
    });
  }

  return blocks;
}

async function findExistingRelativeFile(workspace: string, reference: string) {
  const params = new URLSearchParams({
    workingDirectory: workspace,
    path: reference,
  });
  const response = await fetch(`/api/system/files/resolve?${params.toString()}`);
  if (!response.ok) {
    return null;
  }

  try {
    const payload = (await response.json()) as { path?: string; rel?: string; isDirectory?: boolean };
    if (!payload.path || !payload.rel) {
      return null;
    }
    return {
      path: payload.path,
      rel: payload.rel,
      isDirectory: Boolean(payload.isDirectory),
    } satisfies FileReferenceSearchResult;
  } catch {
    return null;
  }
}

function getPathBasename(filePath: string) {
  return filePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? filePath;
}

function getPathDirectoryLabel(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return '';
  }

  return segments.slice(0, -1).join('/');
}

function ComposerFileReferenceIcon({ path, isDirectory }: { path: string; isDirectory: boolean }) {
  return (
    <WorkbenchFileIcon
      path={path}
      type={isDirectory ? 'directory' : 'file'}
      className="composer-file-reference-icon"
      size={16}
    />
  );
}

function providerDisplayName(providerId: string) {
  if (providerId === CLAUDE_CODE_PROVIDER_ID) {
    return 'Claude Code';
  }
  if (providerId === GROK_BUILD_PROVIDER_ID) {
    return 'Grok Build';
  }
  if (providerId === OPENAI_CODEX_PROVIDER_ID) {
    return 'OpenAI Codex';
  }
  if (providerId === OPENCODE_PROVIDER_ID) {
    return 'OpenCode';
  }
  return providerId;
}

function providerUnavailableReason(provider: AgentProviderDescriptor) {
  if (provider.lifecycle === 'planned') {
    return provider.id === GROK_BUILD_PROVIDER_ID
      || provider.id === OPENAI_CODEX_PROVIDER_ID
      || provider.id === OPENCODE_PROVIDER_ID
      ? '请在设置中开启实验运行'
      : '规划中';
  }
  if (provider.available === false) {
    return '本机 CLI 不可用';
  }
  if (!provider.selectable) {
    return '当前不可选择';
  }
  return '';
}

function formatOrdinaryReasoningEffort(effort: AiChatReasoningEffort) {
  switch (effort) {
    case 'low': return '低';
    case 'high': return '高';
    case 'xhigh': return '极高';
    default: return '中';
  }
}

function permissionModeTooltip(agent: AgentType, mode: PermissionMode, providerName: string) {
  if (agent !== 'claude' && mode === 'bypassPermissions') {
    return `完全访问（YOLO）：跳过 ${providerName} 工具权限确认，仅用于可信目录`;
  }
  return permissionLabel(mode);
}

function PermissionModeIcon({ mode, size }: { mode: PermissionMode; size: number }) {
  if (mode === 'auto') {
    return <Zap className="permission-lucide-icon" size={size} aria-hidden="true" />;
  }

  if (mode === 'bypassPermissions') {
    return <Unlock className="permission-lucide-icon" size={size} aria-hidden="true" />;
  }

  return <Shield className="permission-lucide-icon" size={size} aria-hidden="true" />;
}
