import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CLAUDE_CODE_PROVIDER_ID,
  DEFAULT_MODEL_VALUE,
  GROK_BUILD_PROVIDER_ID,
  OPENAI_CODEX_PROVIDER_ID,
  OPENCODE_PROVIDER_ID,
} from '../constants';
import {
  applyAgentRunEventToTurn,
  closeAgentTurnWithoutTerminalEvent,
  isAgentRunTerminalEvent,
} from '../lib/agent-run-events';
import {
  fetchAgentModelCatalog,
  fetchAgentProviderRegistry,
  resolveChatRuntimeKind,
} from '../lib/agent-provider-registry';
import {
  defaultReasoningEffortForSelection,
  resolveAgentModelSelection,
} from '../lib/agent-model-selection';
import { closeDanglingTurns, isVisiblePermissionMode } from '../lib/conversation';
import {
  buildHistoryContentBlocks,
  buildRunContentBlocks,
  stripTransientAttachmentData,
} from '../lib/claude-run-attachments';
import { buildNewChatTitleFromSubmission, shouldAutoRenameThreadTitle } from '../lib/new-chat-draft';
import type { ThreadActivityNoticeKind } from '../lib/thread-activity-notices';
import type {
  AgentProviderId,
  AgentProviderDescriptor,
  AgentModelCatalog,
  AgentRunEvent,
  ApprovalDecision,
  ApprovalRequest,
  ConversationTurn,
  DebugEvent,
  InputContentBlock,
  PermissionMode,
  RequestUserInputRequest,
  ThreadDetail,
  ThreadSummary,
  UserImageAttachment,
} from '../types';

type AgentPromptSubmission = {
  prompt: string;
  displayText: string;
  attachments?: UserImageAttachment[];
  contentBlocks?: InputContentBlock[];
  queueId?: string;
  queueStatus?: 'preparing' | 'ready';
};

type QueuedAgentPrompt = AgentPromptSubmission & {
  id: string;
  createdAtMs: number;
};

type ThreadMetadataPatch = {
  sessionId?: string | null;
  workingDirectory?: string;
  model?: string | null;
  reasoningEffort?: string | null;
  permissionMode?: PermissionMode;
};

type ActiveAgentRunView = {
  runId: string;
  turnId: string;
  startedAtMs: number;
  interrupting?: boolean;
};

type AgentRunContext = {
  providerId: string;
  providerName: string;
  threadId: string;
  threadTitle: string;
  turnId: string;
  runId: string;
  workingDirectory: string;
  sessionId?: string;
  permissionMode: PermissionMode;
  model?: string;
  reasoningEffort?: string;
  startedAtMs: number;
  abortController: AbortController;
  pendingText: string;
  textFrame: number | null;
  cancelFallbackTimer: number | null;
  interrupting: boolean;
  cancelRequested: boolean;
  cancelRequestSent: boolean;
  terminal: boolean;
};

type UseAgentRunArgs = {
  defaultProviderId: AgentProviderId;
  activeProjectId: string | null;
  activeProjectPath?: string;
  activeThreadId: string | null;
  activeThreadSummary: ThreadSummary | null;
  createThread: (
    projectId: string,
    title?: string,
    options?: {
      showToast?: boolean;
      providerId?: string;
      permissionMode?: PermissionMode;
      model?: string;
      reasoningEffort?: string;
    },
  ) => Promise<ThreadSummary | null>;
  renameThread: (
    threadId: string,
    title: string,
    options?: { showToast?: boolean },
  ) => Promise<ThreadSummary | null>;
  handlePickProjectDirectory: () => Promise<void>;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
  updateThreadDetail: (
    threadId: string,
    updater: (thread: ThreadDetail) => ThreadDetail,
    fallbackSummary?: ThreadSummary,
  ) => void;
  updateThreadTurn: (
    threadId: string,
    turnId: string,
    updater: (turn: ConversationTurn) => ConversationTurn,
    fallbackSummary?: ThreadSummary,
  ) => void;
  appendDebug: (threadId: string, event: Omit<DebugEvent, 'id'>) => void;
  schedulePersistThreadHistory: (threadId: string | null) => void;
  persistThreadMetadata: (threadId: string, payload: ThreadMetadataPatch) => Promise<void>;
  onThreadActivityNotice?: (notice: {
    threadId: string;
    kind: ThreadActivityNoticeKind;
    title: string;
    key: string;
    updatedAtMs: number;
  }) => void;
};

const AGENT_CANCEL_FALLBACK_MS = 6000;
const DEFAULT_AGENT_PERMISSION_MODE: PermissionMode = 'default';

export function useAgentRun({
  defaultProviderId,
  activeProjectId,
  activeProjectPath,
  activeThreadId,
  activeThreadSummary,
  createThread,
  renameThread,
  handlePickProjectDirectory,
  showToast,
  updateThreadDetail,
  updateThreadTurn,
  appendDebug,
  schedulePersistThreadHistory,
  persistThreadMetadata,
  onThreadActivityNotice,
}: UseAgentRunArgs) {
  const [providers, setProviders] = useState<AgentProviderDescriptor[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState('');
  const [draftProviderId, setDraftProviderId] = useState<string>(defaultProviderId);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(DEFAULT_AGENT_PERMISSION_MODE);
  const [model, setModelState] = useState(DEFAULT_MODEL_VALUE);
  const [reasoningEffort, setReasoningEffortState] = useState('');
  const [modelCatalog, setModelCatalog] = useState<AgentModelCatalog | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelSelectionWarning, setModelSelectionWarning] = useState('');
  const [modelCatalogReloadKey, setModelCatalogReloadKey] = useState(0);
  const [activeRunsByThreadId, setActiveRunsByThreadId] = useState<
    Record<string, ActiveAgentRunView>
  >({});
  const [queuedPromptsByThreadId, setQueuedPromptsByThreadId] = useState<
    Record<string, QueuedAgentPrompt[]>
  >({});
  const [clockNowMs, setClockNowMs] = useState(Date.now());
  const runContextsByThreadIdRef = useRef(new Map<string, AgentRunContext>());
  const runContextsByRunIdRef = useRef(new Map<string, AgentRunContext>());
  const queuedPromptsByThreadIdRef = useRef<Record<string, QueuedAgentPrompt[]>>({});
  const threadSummariesByIdRef = useRef(new Map<string, ThreadSummary>());
  const autoStartAfterPreparationThreadIdsRef = useRef(new Set<string>());
  const permissionModeRef = useRef<PermissionMode>(DEFAULT_AGENT_PERMISSION_MODE);
  const modelRef = useRef(DEFAULT_MODEL_VALUE);
  const reasoningEffortRef = useRef('');
  const modelCatalogCacheRef = useRef(new Map<string, AgentModelCatalog>());
  const defaultProviderIdRef = useRef(defaultProviderId);
  const providersControllerRef = useRef<AbortController | null>(null);

  const runningThreadIds = Object.keys(activeRunsByThreadId);
  const activeTurnIdsByThreadId = Object.fromEntries(
    Object.entries(activeRunsByThreadId).map(([threadId, run]) => [threadId, run.turnId]),
  );
  const selectedProviderId = activeThreadSummary?.provider || draftProviderId;
  const currentModelCatalog = modelCatalog?.providerId === selectedProviderId ? modelCatalog : null;
  const queuedPrompts = activeThreadId
    ? queuedPromptsByThreadId[activeThreadId] ?? []
    : [];

  useEffect(() => {
    const previousDefaultProviderId = defaultProviderIdRef.current;
    defaultProviderIdRef.current = defaultProviderId;
    setDraftProviderId((current) =>
      current === previousDefaultProviderId ? defaultProviderId : current,
    );
  }, [defaultProviderId]);

  useEffect(() => {
    if (runningThreadIds.length === 0) {
      return undefined;
    }

    setClockNowMs(Date.now());
    const timer = window.setInterval(() => setClockNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [runningThreadIds.length]);

  const refreshProviders = useCallback(async () => {
    providersControllerRef.current?.abort();
    const controller = new AbortController();
    providersControllerRef.current = controller;
    setProvidersLoading(true);
    setProvidersError('');

    try {
      const registry = await fetchAgentProviderRegistry(controller.signal);
      if (!controller.signal.aborted) {
        setProviders(registry.providers);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setProvidersError(error instanceof Error ? error.message : '读取 Agent Provider 列表失败');
      }
    } finally {
      if (!controller.signal.aborted) {
        setProvidersLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshProviders();
    return () => providersControllerRef.current?.abort();
  }, [refreshProviders]);

  useEffect(() => {
    if (!activeThreadSummary) {
      return;
    }
    setAgentPermissionMode(
      isVisiblePermissionMode(activeThreadSummary.permissionMode)
        ? activeThreadSummary.permissionMode
        : DEFAULT_AGENT_PERMISSION_MODE,
    );
  }, [activeThreadSummary?.id, activeThreadSummary?.permissionMode]);

  useEffect(() => {
    if (resolveChatRuntimeKind(selectedProviderId) !== 'generic') {
      setModelCatalog(null);
      setModelsLoading(false);
      setModelsError('');
      setModelSelectionWarning('');
      return;
    }
    const cached = modelCatalogCacheRef.current.get(selectedProviderId);
    if (cached) {
      setModelCatalog(cached);
      setModelsLoading(false);
      setModelsError('');
      return;
    }

    const controller = new AbortController();
    setModelCatalog(null);
    setModelsLoading(true);
    setModelsError('');
    void fetchAgentModelCatalog(selectedProviderId, controller.signal)
      .then((catalog) => {
        if (controller.signal.aborted) {
          return;
        }
        if (catalog.providerId !== selectedProviderId) {
          throw new Error('模型目录 Provider 与当前聊天不一致');
        }
        modelCatalogCacheRef.current.set(selectedProviderId, catalog);
        setModelCatalog(catalog);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setModelsError(error instanceof Error ? error.message : '读取 Agent 模型目录失败');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setModelsLoading(false);
        }
      });
    return () => controller.abort();
  }, [modelCatalogReloadKey, selectedProviderId]);

  useEffect(() => {
    if (!currentModelCatalog) {
      setAgentModel(DEFAULT_MODEL_VALUE);
      setAgentReasoningEffort('');
      setModelSelectionWarning('');
      return;
    }
    const threadMatchesCatalog = activeThreadSummary?.provider === currentModelCatalog.providerId;
    const resolved = resolveAgentModelSelection(
      currentModelCatalog,
      threadMatchesCatalog ? activeThreadSummary?.model : undefined,
      threadMatchesCatalog ? activeThreadSummary?.reasoningEffort : undefined,
    );
    setAgentModel(resolved.modelId);
    setAgentReasoningEffort(resolved.reasoningEffort);
    if (resolved.staleModelId) {
      setModelSelectionWarning(
        `已保存的模型 ${resolved.staleModelId} 当前不可用，运行时将使用 Provider 默认模型。`,
      );
    } else if (resolved.staleReasoningEffort) {
      setModelSelectionWarning(
        `已保存的思考级别 ${resolved.staleReasoningEffort} 当前不受该模型支持，已临时回落到模型默认值。`,
      );
    } else {
      setModelSelectionWarning('');
    }
  }, [
    activeThreadSummary?.id,
    activeThreadSummary?.model,
    activeThreadSummary?.provider,
    activeThreadSummary?.reasoningEffort,
    currentModelCatalog,
  ]);

  useEffect(() => {
    return () => {
      for (const context of runContextsByThreadIdRef.current.values()) {
        context.abortController.abort();
        if (context.textFrame !== null) {
          window.cancelAnimationFrame(context.textFrame);
        }
        if (context.cancelFallbackTimer !== null) {
          window.clearTimeout(context.cancelFallbackTimer);
        }
      }
      runContextsByThreadIdRef.current.clear();
      runContextsByRunIdRef.current.clear();
    };
  }, []);

  function resetDraftProvider() {
    setDraftProviderId(defaultProviderIdRef.current);
    setAgentPermissionMode(DEFAULT_AGENT_PERMISSION_MODE);
    setAgentModel(DEFAULT_MODEL_VALUE);
    setAgentReasoningEffort('');
    setModelSelectionWarning('');
  }

  function selectDraftProvider(providerId: string) {
    if (providerId === CLAUDE_CODE_PROVIDER_ID) {
      setDraftProviderId(providerId);
      setAgentModel(DEFAULT_MODEL_VALUE);
      setAgentReasoningEffort('');
      setModelSelectionWarning('');
      return true;
    }

    const error = getProviderRunError(providerId, providers, providersLoading, providersError);
    if (error) {
      showToast(error, 'info');
      return false;
    }
    if (draftProviderId !== providerId) {
      setAgentPermissionMode(DEFAULT_AGENT_PERMISSION_MODE);
      setAgentModel(DEFAULT_MODEL_VALUE);
      setAgentReasoningEffort('');
      setModelSelectionWarning('');
    }
    setDraftProviderId(providerId);
    return true;
  }

  function setAgentPermissionMode(mode: PermissionMode) {
    permissionModeRef.current = mode;
    setPermissionMode(mode);
  }

  function setAgentModel(nextModel: string) {
    modelRef.current = nextModel;
    setModelState(nextModel);
  }

  function setAgentReasoningEffort(nextEffort: string) {
    reasoningEffortRef.current = nextEffort;
    setReasoningEffortState(nextEffort);
  }

  function handleModelSelect(nextModel: string) {
    if (activeThreadId && runContextsByThreadIdRef.current.has(activeThreadId)) {
      showToast('当前 Agent 正在运行，模型已锁定。', 'info');
      return;
    }
    if (!currentModelCatalog && nextModel === DEFAULT_MODEL_VALUE) {
      setAgentModel(DEFAULT_MODEL_VALUE);
      setAgentReasoningEffort('');
      setModelSelectionWarning('');
      if (activeThreadId) {
        void persistThreadMetadata(activeThreadId, {
          model: null,
          reasoningEffort: null,
        }).catch((error) => {
          showToast(error instanceof Error ? error.message : '保存 Agent 模型失败', 'error');
        });
      }
      return;
    }
    if (!currentModelCatalog) {
      showToast(modelsError || '模型目录尚未加载完成。', 'info');
      return;
    }
    if (
      nextModel !== DEFAULT_MODEL_VALUE
      && !currentModelCatalog.models.some((item) => item.id === nextModel)
    ) {
      showToast('所选模型已不在当前 Provider 目录中。', 'error');
      return;
    }
    const nextEffort = defaultReasoningEffortForSelection(currentModelCatalog, nextModel);
    setAgentModel(nextModel);
    setAgentReasoningEffort(nextEffort);
    setModelSelectionWarning('');
    if (activeThreadId) {
      void persistThreadMetadata(activeThreadId, {
        model: nextModel === DEFAULT_MODEL_VALUE ? null : nextModel,
        reasoningEffort: nextEffort || null,
      }).catch((error) => {
        showToast(error instanceof Error ? error.message : '保存 Agent 模型失败', 'error');
      });
    }
  }

  function handleReasoningEffortSelect(nextEffort: string) {
    if (activeThreadId && runContextsByThreadIdRef.current.has(activeThreadId)) {
      showToast('当前 Agent 正在运行，思考级别已锁定。', 'info');
      return;
    }
    const selectedModel = currentModelCatalog
      ? resolveAgentModelSelection(currentModelCatalog, modelRef.current).selectedModel
      : undefined;
    if (!selectedModel?.supportedReasoningEfforts.some((effort) => effort.id === nextEffort)) {
      showToast('当前模型不支持所选思考级别。', 'error');
      return;
    }
    setAgentReasoningEffort(nextEffort);
    setModelSelectionWarning('');
    if (activeThreadId) {
      void persistThreadMetadata(activeThreadId, { reasoningEffort: nextEffort }).catch((error) => {
        showToast(error instanceof Error ? error.message : '保存 Agent 思考级别失败', 'error');
      });
    }
  }

  function retryModelCatalog() {
    modelCatalogCacheRef.current.delete(selectedProviderId);
    setModelCatalog(null);
    setModelsError('');
    setModelCatalogReloadKey((value) => value + 1);
  }

  function handlePermissionModeSelect(mode: PermissionMode) {
    if (!isVisiblePermissionMode(mode)) {
      showToast('当前 Agent Provider 不支持该权限模式。', 'error');
      return;
    }
    setAgentPermissionMode(mode);
    if (activeThreadId) {
      void persistThreadMetadata(activeThreadId, { permissionMode: mode }).catch((error) => {
        showToast(error instanceof Error ? error.message : '保存 Agent 权限模式失败', 'error');
      });
    }
  }

  function updateQueuedPrompts(
    updater: (current: Record<string, QueuedAgentPrompt[]>) => Record<string, QueuedAgentPrompt[]>,
  ) {
    const next = updater(queuedPromptsByThreadIdRef.current);
    queuedPromptsByThreadIdRef.current = next;
    setQueuedPromptsByThreadId(next);
    return next;
  }

  function enqueuePrompt(thread: ThreadSummary, submission: AgentPromptSubmission) {
    const queuedPrompt: QueuedAgentPrompt = {
      ...submission,
      id: submission.queueId ?? crypto.randomUUID(),
      queueStatus: submission.queueStatus ?? 'ready',
      createdAtMs: Date.now(),
    };
    threadSummariesByIdRef.current.set(thread.id, thread);
    updateQueuedPrompts((current) => ({
      ...current,
      [thread.id]: [...(current[thread.id] ?? []), queuedPrompt],
    }));
    appendDebug(thread.id, {
      title: '已排队下一轮提示',
      content: submission.displayText || '附件消息',
    });
    return queuedPrompt;
  }

  function updateQueuedPrompt(
    threadId: string,
    promptId: string,
    submission: AgentPromptSubmission,
  ) {
    const queue = queuedPromptsByThreadIdRef.current[threadId] ?? [];
    const index = queue.findIndex((prompt) => prompt.id === promptId);
    if (index === -1) {
      return null;
    }
    const updatedPrompt: QueuedAgentPrompt = {
      ...queue[index],
      ...submission,
      id: promptId,
      queueStatus: submission.queueStatus ?? 'ready',
    };
    updateQueuedPrompts((current) => {
      const currentQueue = current[threadId] ?? [];
      const currentIndex = currentQueue.findIndex((prompt) => prompt.id === promptId);
      if (currentIndex === -1) {
        return current;
      }
      const nextQueue = [...currentQueue];
      nextQueue[currentIndex] = updatedPrompt;
      return { ...current, [threadId]: nextQueue };
    });
    return updatedPrompt;
  }

  function removeQueuedPromptFromThread(threadId: string, promptId: string) {
    const removedPrompt = (queuedPromptsByThreadIdRef.current[threadId] ?? [])
      .find((prompt) => prompt.id === promptId) ?? null;
    if (!removedPrompt) {
      return null;
    }
    updateQueuedPrompts((current) => {
      const queue = current[threadId] ?? [];
      if (!queue.some((prompt) => prompt.id === promptId)) {
        return current;
      }
      const remaining = queue.filter((prompt) => prompt.id !== promptId);
      const next = { ...current };
      if (remaining.length > 0) {
        next[threadId] = remaining;
      } else {
        delete next[threadId];
      }
      return next;
    });
    if ((queuedPromptsByThreadIdRef.current[threadId] ?? []).length === 0) {
      autoStartAfterPreparationThreadIdsRef.current.delete(threadId);
    }
    return removedPrompt;
  }

  function shiftQueuedPrompt(threadId: string) {
    const nextPrompt = queuedPromptsByThreadIdRef.current[threadId]?.[0];
    if (!nextPrompt) {
      return null;
    }
    removeQueuedPromptFromThread(threadId, nextPrompt.id);
    return nextPrompt;
  }

  function restoreQueuedPrompt(threadId: string, prompt: QueuedAgentPrompt) {
    updateQueuedPrompts((current) => ({
      ...current,
      [threadId]: [prompt, ...(current[threadId] ?? [])],
    }));
  }

  function removeQueuedPrompt(promptId: string) {
    if (!activeThreadId || !promptId) {
      return;
    }
    if (!removeQueuedPromptFromThread(activeThreadId, promptId)) {
      return;
    }
    appendDebug(activeThreadId, {
      title: '已取消排队提示',
      content: promptId,
    });
  }

  function recallQueuedPrompt(promptId: string) {
    if (!activeThreadId || !promptId) {
      return null;
    }
    const prompt = removeQueuedPromptFromThread(activeThreadId, promptId);
    if (!prompt) {
      return null;
    }
    appendDebug(activeThreadId, {
      title: '已召回排队提示',
      content: promptId,
    });
    return prompt.displayText || prompt.prompt;
  }

  async function guideQueuedPrompt() {
    showToast('当前 Provider 不支持运行中引导，消息会在本轮完成后自动发送。', 'info');
    return false;
  }

  function maybeStartQueuedPrompt(context: AgentRunContext) {
    const queue = queuedPromptsByThreadIdRef.current[context.threadId] ?? [];
    if (queue[0]?.queueStatus === 'preparing') {
      autoStartAfterPreparationThreadIdsRef.current.add(context.threadId);
      return;
    }
    autoStartAfterPreparationThreadIdsRef.current.delete(context.threadId);
    const nextPrompt = shiftQueuedPrompt(context.threadId);
    if (!nextPrompt) {
      return;
    }
    const cachedThread = threadSummariesByIdRef.current.get(context.threadId);
    if (!cachedThread) {
      restoreQueuedPrompt(context.threadId, nextPrompt);
      return;
    }
    const thread = {
      ...cachedThread,
      sessionId: context.sessionId ?? cachedThread.sessionId,
      workingDirectory: context.workingDirectory,
    };
    threadSummariesByIdRef.current.set(thread.id, thread);
    window.setTimeout(() => {
      const started = startAgentRun(
        thread,
        nextPrompt,
        context.permissionMode,
        context.model,
        context.reasoningEffort,
      );
      if (!started) {
        restoreQueuedPrompt(context.threadId, nextPrompt);
      }
    }, 0);
  }

  function notifyQueuedPromptsRetained(threadId: string) {
    autoStartAfterPreparationThreadIdsRef.current.delete(threadId);
    if ((queuedPromptsByThreadIdRef.current[threadId] ?? []).length > 0) {
      showToast('当前运行未正常完成，队列已保留。', 'info');
    }
  }

  async function ensureAgentThread(
    submission: AgentPromptSubmission,
    providerId: string,
    runPermissionMode: PermissionMode,
    runModel?: string,
    runReasoningEffort?: string,
  ) {
    const providerError = getProviderRunError(
      providerId,
      providers,
      providersLoading,
      providersError,
    );
    if (providerError) {
      showToast(providerError, 'error');
      return null;
    }

    if (activeThreadSummary) {
      if (activeThreadSummary.provider !== providerId) {
        showToast('当前聊天的 Provider 与运行请求不一致，请新建聊天后重试。', 'error');
        return null;
      }
      const nextTitle = buildNewChatTitleFromSubmission(submission);
      if (shouldAutoRenameThreadTitle(activeThreadSummary.title, nextTitle)) {
        void renameThread(activeThreadSummary.id, nextTitle, { showToast: false }).catch((error) => {
          showToast(error instanceof Error ? error.message : '聊天名称更新失败', 'error');
        });
      }
      threadSummariesByIdRef.current.set(activeThreadSummary.id, activeThreadSummary);
      return activeThreadSummary;
    }

    if (!activeProjectId) {
      await handlePickProjectDirectory();
      showToast('先添加一个项目目录，再开始新聊天。', 'info');
      return null;
    }

    try {
      const thread = await createThread(
        activeProjectId,
        buildNewChatTitleFromSubmission(submission),
        {
          showToast: false,
          providerId,
          permissionMode: runPermissionMode,
          ...(runModel ? { model: runModel } : {}),
          ...(runReasoningEffort ? { reasoningEffort: runReasoningEffort } : {}),
        },
      );
      if (thread) {
        threadSummariesByIdRef.current.set(thread.id, thread);
      }
      return thread;
    } catch (error) {
      showToast(error instanceof Error ? error.message : '新建聊天失败', 'error');
      return null;
    }
  }

  async function submitPrompt(submission: AgentPromptSubmission) {
    const providerId = activeThreadSummary?.provider || draftProviderId;
    if (resolveChatRuntimeKind(providerId) !== 'generic') {
      showToast('当前 Provider 不使用通用 Agent 运行链路。', 'error');
      return false;
    }
    const runPermissionMode = permissionModeRef.current;
    const runModel = modelRef.current === DEFAULT_MODEL_VALUE ? undefined : modelRef.current;
    const runReasoningEffort = reasoningEffortRef.current || undefined;
    const thread = await ensureAgentThread(
      submission,
      providerId,
      runPermissionMode,
      runModel,
      runReasoningEffort,
    );
    if (!thread) {
      return false;
    }
    const submissionContentBlocks = buildRunContentBlocks({
      prompt: submission.prompt,
      attachments: submission.attachments,
      contentBlocks: submission.contentBlocks,
    });
    if (submissionContentBlocks.length === 0 && submission.queueStatus !== 'preparing') {
      return false;
    }
    const activeContext = runContextsByThreadIdRef.current.get(thread.id);
    if (submission.queueId) {
      const queuedPrompt = updateQueuedPrompt(thread.id, submission.queueId, submission);
      if (queuedPrompt) {
        if (submission.queueStatus === 'preparing' || activeContext) {
          return true;
        }
        const queueHead = queuedPromptsByThreadIdRef.current[thread.id]?.[0];
        if (
          queueHead?.id !== queuedPrompt.id ||
          !autoStartAfterPreparationThreadIdsRef.current.delete(thread.id)
        ) {
          return true;
        }
        shiftQueuedPrompt(thread.id);
        const started = startAgentRun(
          thread,
          queuedPrompt,
          runPermissionMode,
          runModel,
          runReasoningEffort,
        );
        if (!started) {
          restoreQueuedPrompt(thread.id, queuedPrompt);
        }
        return started;
      }
    }
    if (activeContext || submission.queueStatus === 'preparing') {
      enqueuePrompt(thread, submission);
      return true;
    }
    return startAgentRun(
      thread,
      submission,
      runPermissionMode,
      runModel,
      runReasoningEffort,
    );
  }

  function startAgentRun(
    thread: ThreadSummary,
    submission: AgentPromptSubmission,
    runPermissionMode: PermissionMode,
    runModel?: string,
    runReasoningEffort?: string,
  ) {
    const prompt = submission.prompt.trim();
    const requestContentBlocks = buildRunContentBlocks({
      prompt,
      attachments: submission.attachments,
      contentBlocks: submission.contentBlocks,
    });
    if (requestContentBlocks.length === 0) {
      return false;
    }
    if (runContextsByThreadIdRef.current.has(thread.id)) {
      enqueuePrompt(thread, submission);
      return true;
    }

    const workingDirectory =
      thread.workingDirectory.trim() || activeProjectPath?.trim() || '';
    if (!workingDirectory) {
      showToast('当前聊天缺少工作目录。', 'error');
      return false;
    }

    const turnId = crypto.randomUUID();
    const startedAtMs = Date.now();
    const controller = new AbortController();
    const providerName = providerDisplayName(thread.provider, providers);
    const context: AgentRunContext = {
      providerId: thread.provider,
      providerName,
      threadId: thread.id,
      threadTitle: thread.title,
      turnId,
      runId: '',
      workingDirectory,
      sessionId: thread.sessionId.trim() || undefined,
      permissionMode: runPermissionMode,
      model: runModel,
      reasoningEffort: runReasoningEffort,
      startedAtMs,
      abortController: controller,
      pendingText: '',
      textFrame: null,
      cancelFallbackTimer: null,
      interrupting: false,
      cancelRequested: false,
      cancelRequestSent: false,
      terminal: false,
    };

    registerRunContext(context);
    updateThreadDetail(
      thread.id,
      (existing) => ({
        ...existing,
        turns: [
          ...closeDanglingTurns(existing.turns),
          {
            id: turnId,
            userText: submission.displayText.trim() || prompt,
            userAttachments: stripTransientAttachmentData(submission.attachments),
            userContentBlocks: buildHistoryContentBlocks({
              prompt,
              attachments: submission.attachments,
              contentBlocks: requestContentBlocks,
            }),
            workspace: workingDirectory,
            assistantText: '',
            tools: [],
            items: [],
            status: 'pending',
            activity: `正在启动 ${providerName}`,
            phase: 'requesting',
            startedAtMs,
            pendingUserInputRequests: [],
            pendingApprovalRequests: [],
          },
        ],
      }),
      thread,
    );
    schedulePersistThreadHistory(thread.id);

    void (async () => {
      try {
        const response = await fetch('/api/agents/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerId: context.providerId,
            threadId: context.threadId,
            prompt,
            contentBlocks: requestContentBlocks,
            workingDirectory,
            sessionId: context.sessionId,
            permissionMode: context.permissionMode,
            model: context.model,
            reasoningEffort: context.reasoningEffort,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error((await readErrorResponseText(response)) || `${providerName} 运行启动失败`);
        }
        const responseRunId = response.headers.get('X-CodeM-Agent-Run-Id')?.trim();
        if (responseRunId) {
          observeRunId(context, responseRunId);
        }
        await consumeAgentEventStream(response, context);
        if (!context.terminal && runContextsByThreadIdRef.current.get(context.threadId) === context) {
          settleRunWithoutTerminal(context, 'Agent 事件流已结束');
        }
      } catch (error) {
        if (context.terminal || runContextsByThreadIdRef.current.get(context.threadId) !== context) {
          return;
        }
        if (controller.signal.aborted || context.cancelRequested) {
          settleRunWithoutTerminal(context, '已停止');
          return;
        }
        handleAgentRunFailure(
          context,
          error instanceof Error ? error.message : `${providerName} 运行失败`,
        );
      }
    })();

    return true;
  }

  async function consumeAgentEventStream(response: Response, context: AgentRunContext) {
    if (!response.body) {
      throw new Error('Agent 事件流不可读');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        handleAgentStreamLine(line, context);
      }
      if (done) {
        if (buffer.trim()) {
          handleAgentStreamLine(buffer, context);
        }
        break;
      }
    }
  }

  function handleAgentStreamLine(line: string, context: AgentRunContext) {
    if (!line.trim()) {
      return;
    }
    let event: AgentRunEvent;
    try {
      const value = JSON.parse(line) as Partial<AgentRunEvent>;
      if (typeof value.type !== 'string' || typeof value.runId !== 'string') {
        throw new Error('事件缺少 type/runId');
      }
      event = value as AgentRunEvent;
    } catch {
      appendDebug(context.threadId, {
        title: 'Agent 事件解析失败',
        content: '收到了一条无法解析的本地 Agent 事件；原始内容未写入日志。',
        tone: 'error',
      });
      return;
    }
    handleAgentEvent(event, context);
  }

  function handleAgentEvent(event: AgentRunEvent, context: AgentRunContext) {
    if (context.terminal || runContextsByThreadIdRef.current.get(context.threadId) !== context) {
      return;
    }
    observeRunId(context, event.runId);
    if (event.type === 'delta') {
      queueTextDelta(context, event.text);
      return;
    }

    flushTextDelta(context);
    updateThreadTurn(context.threadId, context.turnId, (turn) =>
      applyAgentRunEventToTurn(turn, event),
    );

    if (event.type === 'session' || event.type === 'done') {
      context.sessionId = event.sessionId;
      void persistThreadMetadata(context.threadId, {
        sessionId: event.sessionId,
        workingDirectory: context.workingDirectory,
        permissionMode: context.permissionMode,
      }).catch((error) => {
        appendDebug(context.threadId, {
          title: 'Agent session 保存失败',
          content: error instanceof Error ? error.message : '保存 Agent session 失败',
          tone: 'error',
        });
      });
    }

    if (event.type === 'approval-request' || event.type === 'request-user-input') {
      emitThreadNotice(context, 'approval', event.runId);
    }
    schedulePersistThreadHistory(context.threadId);

    if (isAgentRunTerminalEvent(event)) {
      context.terminal = true;
      removeRunContext(context);
      emitThreadNotice(context, event.type === 'error' ? 'failed' : 'completed', event.runId);
      if (event.type === 'done' && !context.cancelRequested) {
        maybeStartQueuedPrompt(context);
      } else {
        notifyQueuedPromptsRetained(context.threadId);
      }
    }
  }

  function queueTextDelta(context: AgentRunContext, text: string) {
    context.pendingText += text;
    if (context.textFrame !== null) {
      return;
    }
    context.textFrame = window.requestAnimationFrame(() => flushTextDelta(context));
  }

  function flushTextDelta(context: AgentRunContext) {
    if (context.textFrame !== null) {
      window.cancelAnimationFrame(context.textFrame);
      context.textFrame = null;
    }
    const text = context.pendingText;
    context.pendingText = '';
    if (!text) {
      return;
    }
    updateThreadTurn(context.threadId, context.turnId, (turn) =>
      applyAgentRunEventToTurn(turn, {
        type: 'delta',
        runId: context.runId,
        text,
      }),
    );
    schedulePersistThreadHistory(context.threadId);
  }

  async function stopRun(threadId = activeThreadId ?? undefined) {
    const context = threadId ? runContextsByThreadIdRef.current.get(threadId) : undefined;
    if (!context || context.interrupting) {
      return;
    }
    context.cancelRequested = true;
    setRunInterrupting(context, true);
    updateThreadTurn(context.threadId, context.turnId, (turn) => ({
      ...turn,
      activity: `正在停止 ${context.providerName}`,
    }));
    if (context.cancelFallbackTimer === null) {
      context.cancelFallbackTimer = window.setTimeout(() => {
        context.cancelFallbackTimer = null;
        if (!context.terminal && runContextsByThreadIdRef.current.get(context.threadId) === context) {
          context.abortController.abort();
          settleRunWithoutTerminal(context, '已停止');
        }
      }, AGENT_CANCEL_FALLBACK_MS);
    }
    if (context.runId) {
      void requestAgentCancel(context);
    }
  }

  async function requestAgentCancel(context: AgentRunContext) {
    if (!context.runId || context.cancelRequestSent || context.terminal) {
      return;
    }
    context.cancelRequestSent = true;
    try {
      const response = await fetch(`/api/agents/run/${encodeURIComponent(context.runId)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error((await readErrorResponseText(response)) || '停止请求失败');
      }
    } catch (error) {
      appendDebug(context.threadId, {
        title: 'Agent 停止请求未确认',
        content: error instanceof Error ? error.message : '停止 Agent 失败',
        tone: 'error',
      });
      context.abortController.abort();
      settleRunWithoutTerminal(context, '已停止');
    }
  }

  async function submitRequestUserInput(
    turn: ConversationTurn,
    request: RequestUserInputRequest,
    answers: Record<string, string>,
  ) {
    const context = activeThreadId
      ? runContextsByThreadIdRef.current.get(activeThreadId)
      : undefined;
    if (!context || context.turnId !== turn.id || !request.requestId) {
      showToast('当前 Agent 运行已结束，无法继续提交这个问题。', 'error');
      return false;
    }
    const normalizedAnswers = Object.fromEntries(
      Object.entries(answers).filter(([, value]) => value.trim().length > 0),
    );
    if (Object.keys(normalizedAnswers).length === 0) {
      showToast('请先填写至少一项有效回答。', 'info');
      return false;
    }
    const response = await fetch(
      `/api/agents/run/${encodeURIComponent(context.runId)}/request-user-input`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: request.requestId, answers: normalizedAnswers }),
      },
    );
    if (!response.ok) {
      showToast((await readErrorResponseText(response)) || '提交补充信息失败。', 'error');
      return false;
    }
    updateThreadTurn(context.threadId, context.turnId, (current) => ({
      ...current,
      pendingUserInputRequests: (current.pendingUserInputRequests ?? []).filter(
        (item) => item.requestId !== request.requestId,
      ),
      activity: '继续执行中',
      phase: 'requesting',
    }));
    schedulePersistThreadHistory(context.threadId);
    return true;
  }

  async function submitApprovalDecision(
    turn: ConversationTurn,
    request: ApprovalRequest,
    decision: ApprovalDecision,
  ) {
    const context = activeThreadId
      ? runContextsByThreadIdRef.current.get(activeThreadId)
      : undefined;
    if (!context || context.turnId !== turn.id || !request.requestId) {
      showToast('当前 Agent 运行已结束，无法继续提交这个审批。', 'error');
      return false;
    }
    const response = await fetch(
      `/api/agents/run/${encodeURIComponent(context.runId)}/approval-decision`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: request.requestId, decision }),
      },
    );
    if (!response.ok) {
      showToast((await readErrorResponseText(response)) || '提交审批结果失败。', 'error');
      return false;
    }
    updateThreadTurn(context.threadId, context.turnId, (current) => ({
      ...current,
      pendingApprovalRequests: (current.pendingApprovalRequests ?? []).filter(
        (item) => item.requestId !== request.requestId,
      ),
      activity: decision === 'approve' ? '继续执行中' : '已拒绝操作，等待调整',
      phase: 'requesting',
    }));
    schedulePersistThreadHistory(context.threadId);
    return true;
  }

  function registerRunContext(context: AgentRunContext) {
    runContextsByThreadIdRef.current.set(context.threadId, context);
    setActiveRunsByThreadId((current) => ({
      ...current,
      [context.threadId]: {
        runId: context.runId,
        turnId: context.turnId,
        startedAtMs: context.startedAtMs,
        interrupting: false,
      },
    }));
  }

  function observeRunId(context: AgentRunContext, runId: string) {
    if (!runId || context.runId === runId) {
      return;
    }
    if (context.runId) {
      runContextsByRunIdRef.current.delete(context.runId);
    }
    context.runId = runId;
    runContextsByRunIdRef.current.set(runId, context);
    setActiveRunsByThreadId((current) => ({
      ...current,
      [context.threadId]: {
        runId,
        turnId: context.turnId,
        startedAtMs: context.startedAtMs,
        interrupting: context.interrupting,
      },
    }));
    if (context.cancelRequested) {
      void requestAgentCancel(context);
    }
  }

  function setRunInterrupting(context: AgentRunContext, interrupting: boolean) {
    context.interrupting = interrupting;
    setActiveRunsByThreadId((current) => {
      const active = current[context.threadId];
      if (!active) {
        return current;
      }
      return {
        ...current,
        [context.threadId]: { ...active, interrupting },
      };
    });
  }

  function removeRunContext(context: AgentRunContext) {
    if (context.textFrame !== null) {
      window.cancelAnimationFrame(context.textFrame);
      context.textFrame = null;
    }
    if (context.cancelFallbackTimer !== null) {
      window.clearTimeout(context.cancelFallbackTimer);
      context.cancelFallbackTimer = null;
    }
    if (runContextsByThreadIdRef.current.get(context.threadId) === context) {
      runContextsByThreadIdRef.current.delete(context.threadId);
    }
    if (context.runId && runContextsByRunIdRef.current.get(context.runId) === context) {
      runContextsByRunIdRef.current.delete(context.runId);
    }
    setActiveRunsByThreadId((current) => {
      if (!current[context.threadId]) {
        return current;
      }
      const next = { ...current };
      delete next[context.threadId];
      return next;
    });
  }

  function settleRunWithoutTerminal(context: AgentRunContext, activity: string) {
    flushTextDelta(context);
    context.terminal = true;
    updateThreadTurn(context.threadId, context.turnId, (turn) =>
      closeAgentTurnWithoutTerminalEvent(turn, activity),
    );
    schedulePersistThreadHistory(context.threadId);
    removeRunContext(context);
    notifyQueuedPromptsRetained(context.threadId);
  }

  function handleAgentRunFailure(context: AgentRunContext, message: string) {
    flushTextDelta(context);
    const event: AgentRunEvent = {
      type: 'error',
      runId: context.runId || `local-${context.turnId}`,
      message,
    };
    updateThreadTurn(context.threadId, context.turnId, (turn) =>
      applyAgentRunEventToTurn(turn, event),
    );
    appendDebug(context.threadId, {
      title: `${context.providerName} 运行失败`,
      content: message,
      tone: 'error',
    });
    schedulePersistThreadHistory(context.threadId);
    context.terminal = true;
    removeRunContext(context);
    emitThreadNotice(context, 'failed', event.runId);
    notifyQueuedPromptsRetained(context.threadId);
  }

  function emitThreadNotice(
    context: AgentRunContext,
    kind: ThreadActivityNoticeKind,
    eventKey: string,
  ) {
    onThreadActivityNotice?.({
      threadId: context.threadId,
      kind,
      title:
        kind === 'approval'
          ? `${context.threadTitle} 等待确认`
          : kind === 'failed'
            ? `${context.threadTitle} 运行失败`
            : `${context.threadTitle} 已完成`,
      key: `agent:${eventKey}:${kind}`,
      updatedAtMs: Date.now(),
    });
  }

  return {
    providers,
    providersLoading,
    providersError,
    refreshProviders,
    draftProviderId,
    permissionMode,
    model,
    reasoningEffort,
    modelCatalog: currentModelCatalog,
    modelsLoading,
    modelsError,
    modelSelectionWarning,
    selectDraftProvider,
    resetDraftProvider,
    handlePermissionModeSelect,
    handleModelSelect,
    handleReasoningEffortSelect,
    retryModelCatalog,
    isRunning: runningThreadIds.length > 0,
    runningThreadIds,
    activeRunsByThreadId,
    activeTurnIdsByThreadId,
    clockNowMs,
    queuedPrompts,
    removeQueuedPrompt,
    recallQueuedPrompt,
    guideQueuedPrompt,
    submitPrompt,
    submitRequestUserInput,
    submitApprovalDecision,
    stopRun,
  };
}

function getProviderRunError(
  providerId: string,
  providers: AgentProviderDescriptor[],
  loading: boolean,
  requestError: string,
) {
  if (providerId === CLAUDE_CODE_PROVIDER_ID) {
    return '';
  }
  if (resolveChatRuntimeKind(providerId) !== 'generic') {
    return '当前 Provider 尚未接入主聊天。';
  }
  const name = providerDisplayName(providerId, providers);
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) {
    if (loading) {
      return `正在读取 ${name} 状态，请稍后重试。`;
    }
    return requestError || `${name} 不在当前 Provider Registry 中。`;
  }
  if (provider.lifecycle !== 'active') {
    return `${name} 实验运行未开启，请在“Agent 与模型”设置中启用。`;
  }
  if (provider.available !== true) {
    if (providerId === OPENAI_CODEX_PROVIDER_ID) {
      return '未检测到可由 CodeM 启动的 Codex CLI，请安装独立 CLI、检查 PATH 或设置 CODEX_CLI_PATH 后重启。';
    }
    if (providerId === OPENCODE_PROVIDER_ID) {
      return '未检测到可由 CodeM 启动的 OpenCode CLI，请安装 OpenCode、检查 PATH 或设置 OPENCODE_CLI_PATH 后重启。';
    }
    return '未检测到可用的 grok CLI，请安装或检查 PATH 后重启。';
  }
  if (!provider.selectable) {
    return `${name} 当前不可用于新建聊天。`;
  }
  return '';
}

function providerDisplayName(providerId: string, providers: AgentProviderDescriptor[]) {
  return providers.find((provider) => provider.id === providerId)?.displayName
    ?? (providerId === GROK_BUILD_PROVIDER_ID
      ? 'Grok Build'
      : providerId === OPENAI_CODEX_PROVIDER_ID
        ? 'OpenAI Codex'
        : providerId === OPENCODE_PROVIDER_ID
          ? 'OpenCode'
        : providerId);
}

async function readErrorResponseText(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    return '';
  }
  try {
    const payload = JSON.parse(text) as { error?: unknown };
    return typeof payload.error === 'string' ? payload.error : text;
  } catch {
    return text;
  }
}
