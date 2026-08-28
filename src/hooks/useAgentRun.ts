import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CLAUDE_CODE_PROVIDER_ID,
  DEEPSEEK_DSH_PROVIDER_ID,
  DEFAULT_MODEL_VALUE,
  GEMINI_CLI_PROVIDER_ID,
  GROK_BUILD_PROVIDER_ID,
  OPENAI_CODEX_PROVIDER_ID,
  OPENCODE_PROVIDER_ID,
  PI_AGENT_PROVIDER_ID,
} from '../constants';
import {
  applyAgentRunEventToTurn,
  closeAgentTurnWithoutTerminalEvent,
  consumeAgentRunEventStream,
  isAgentRunTerminalEvent,
  shouldSettleAgentStreamAsStopped,
} from '../lib/agent-run-events';
import {
  fetchAgentProviderRegistry,
  resolveChatRuntimeKind,
} from '../lib/agent-provider-registry';
import { agentModelCatalogCache } from '../lib/agent-model-catalog-cache';
import {
  agentChannelMetadataPatch,
  buildAgentChannelModelCatalog,
  defaultAgentChannelId,
  getAgentChannel,
  isAgentChannelSelectionAvailable,
  requestAgentChannelId,
  resolveRunAgentChannelSelection,
  SYSTEM_AGENT_CHANNEL_ID,
  threadAgentChannelId,
} from '../lib/agent-channel-selection';
import {
  resolveAgentModelSelection,
} from '../lib/agent-model-selection';
import { closeDanglingTurns, isVisiblePermissionMode } from '../lib/conversation';
import {
  applyCompactReconcileResult,
  applyCompactEvent,
  compactCapabilityKey,
  createManualCompactTurn,
  findUnconfirmedManualCompactTurn,
  getCompactAvailability,
  prepareCompactTurn,
  readCompactMetadata,
  retryCompactTurn,
  skipCompactTurn,
  type CompactCapabilityRuntime,
  type CompactReconcileResult,
} from '../lib/codex-compact';
import {
  buildHistoryContentBlocks,
  buildRunContentBlocks,
  stripTransientAttachmentData,
} from '../lib/claude-run-attachments';
import { buildNewChatTitleFromSubmission, shouldAutoRenameThreadTitle } from '../lib/new-chat-draft';
import {
  collectThreadModelPreferences,
  isModelSelectionChannelReady,
  reasoningEffortForThreadModel,
  updateThreadModelReasoningEffort,
  type ThreadModelPreferences,
} from '../lib/thread-model-preferences';
import {
  getCodexQueuedPromptGuideContent,
  getQueuedPromptContinuationState,
  getQueuedPromptGuideSelection,
  resolveGuideSuccessActivity,
  shouldResumePausedQueueAfterUnknownRemoval,
  shouldContinueQueueAfterGuide,
  type QueuedPromptStatus,
} from '../lib/queued-prompts';
import type { ThreadActivityNoticeKind } from '../lib/thread-activity-notices';
import type {
  AgentProviderId,
  AgentChannel,
  AgentProviderDescriptor,
  AgentRuntimeStatus,
  AgentModelCatalog,
  AgentRunEvent,
  ApprovalDecision,
  ApprovalRequest,
  ConversationTurn,
  CodexCompactCapability,
  CompactOperationStatus,
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
  automationExecution?: boolean;
};

type QueuedAgentPrompt = Omit<AgentPromptSubmission, 'queueStatus'> & {
  id: string;
  queueStatus: QueuedPromptStatus;
  createdAtMs: number;
};

type ThreadMetadataPatch = {
  sessionId?: string | null;
  workingDirectory?: string;
  model?: string | null;
  reasoningEffort?: string | null;
  permissionMode?: PermissionMode;
  channelId?: string | null;
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
  channelId?: string;
  startedAtMs: number;
  abortController: AbortController;
  pendingText: string;
  textFrame: number | null;
  cancelFallbackTimer: number | null;
  interrupting: boolean;
  cancelRequested: boolean;
  cancelRequestSent: boolean;
  terminal: boolean;
  terminalAllowsQueueContinuation: boolean;
  terminalBlockedGuidePromptId?: string;
};

type CompactOperationContext = {
  operationId: string;
  turnId: string;
  status: CompactOperationStatus;
  thread: ThreadSummary;
  runtime: CompactCapabilityRuntime;
  trigger: 'slash' | 'context' | 'retry' | 'reconcile';
  abortController?: AbortController;
  terminalConfirmed: boolean;
};

type CompactCapabilityEntry = CodexCompactCapability & {
  key: string;
  checkedAtMs?: number;
};

type UseAgentRunArgs = {
  defaultProviderId: AgentProviderId;
  defaultPermissionMode: PermissionMode;
  dshProfile: string;
  dshAgentPreset: string;
  dshToolsMode: 'native' | 'code' | 'both';
  agentChannels: AgentChannel[];
  defaultAgentChannelIds: Record<AgentProviderId, string>;
  agentChannelsLoading: boolean;
  activeProjectId: string | null;
  activeProjectPath?: string;
  activeThreadId: string | null;
  activeThreadSummary: ThreadSummary | null;
  activeThreadDetail: ThreadDetail | null;
  isNewChatDraft: boolean;
  createThread: (
    projectId: string,
    title?: string,
    options?: {
      showToast?: boolean;
      providerId?: string;
      permissionMode?: PermissionMode;
      model?: string;
      reasoningEffort?: string;
      channelId?: string;
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
  schedulePersistThreadHistory: (
    threadId: string | null,
    options?: { urgent?: boolean },
  ) => void;
  persistThreadMetadata: (threadId: string, payload: ThreadMetadataPatch) => Promise<void>;
  onThreadActivityNotice?: (notice: {
    threadId: string;
    kind: ThreadActivityNoticeKind;
    title: string;
    key: string;
    updatedAtMs: number;
  }) => void;
};

type AgentDraftSelection = {
  permissionMode?: PermissionMode;
  channelId?: string;
  model?: string;
  reasoningEffort?: string;
  modelPreferences: ThreadModelPreferences;
};

const AGENT_CANCEL_FALLBACK_MS = 6000;
export function useAgentRun({
  defaultProviderId,
  defaultPermissionMode,
  dshProfile,
  dshAgentPreset,
  dshToolsMode,
  agentChannels,
  defaultAgentChannelIds,
  agentChannelsLoading,
  activeProjectId,
  activeProjectPath,
  activeThreadId,
  activeThreadSummary,
  activeThreadDetail,
  isNewChatDraft,
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
  const initialProviderId = activeThreadSummary?.provider || defaultProviderId;
  const [providers, setProviders] = useState<AgentProviderDescriptor[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState('');
  const [draftProviderId, setDraftProviderId] = useState<string>(defaultProviderId);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(defaultPermissionMode);
  const [model, setModelState] = useState(DEFAULT_MODEL_VALUE);
  const [reasoningEffort, setReasoningEffortState] = useState('');
  const [channelId, setChannelIdState] = useState(SYSTEM_AGENT_CHANNEL_ID);
  const [modelCatalog, setModelCatalog] = useState<AgentModelCatalog | null>(
    () => agentModelCatalogCache.peek(
      initialProviderId,
      agentProviderCatalogUsesChannel(initialProviderId)
        ? threadAgentChannelId(activeThreadSummary?.agentChannelId)
        : undefined,
    )?.catalog ?? null,
  );
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelSelectionWarning, setModelSelectionWarning] = useState('');
  const [activeRunsByThreadId, setActiveRunsByThreadId] = useState<
    Record<string, ActiveAgentRunView>
  >({});
  const [queuedPromptsByThreadId, setQueuedPromptsByThreadId] = useState<
    Record<string, QueuedAgentPrompt[]>
  >({});
  const [compactCapabilitiesByKey, setCompactCapabilitiesByKey] = useState<
    Record<string, CompactCapabilityEntry>
  >({});
  const [clockNowMs, setClockNowMs] = useState(Date.now());
  const runContextsByThreadIdRef = useRef(new Map<string, AgentRunContext>());
  const runContextsByRunIdRef = useRef(new Map<string, AgentRunContext>());
  const queuedPromptsByThreadIdRef = useRef<Record<string, QueuedAgentPrompt[]>>({});
  const threadSummariesByIdRef = useRef(new Map<string, ThreadSummary>());
  const autoStartAfterPreparationThreadIdsRef = useRef(new Set<string>());
  const pausedQueueContinuationsByThreadIdRef = useRef(new Map<string, AgentRunContext>());
  const compactOperationsByThreadIdRef = useRef(new Map<string, CompactOperationContext>());
  const reconciledCompactOperationIdsRef = useRef(new Set<string>());
  const pausedQueueAfterCompactByThreadIdRef = useRef(new Map<string, AgentRunContext>());
  const compactCapabilitiesByKeyRef = useRef<Record<string, CompactCapabilityEntry>>({});
  const compactCapabilityControllerRef = useRef<AbortController | null>(null);
  const permissionModeRef = useRef<PermissionMode>(defaultPermissionMode);
  const modelRef = useRef(DEFAULT_MODEL_VALUE);
  const reasoningEffortRef = useRef('');
  const channelIdRef = useRef(SYSTEM_AGENT_CHANNEL_ID);
  const modelPreferencesRef = useRef(collectThreadModelPreferences(activeThreadSummary));
  const pendingReasoningEffortRef = useRef<{
    threadId: string;
    model: string;
    reasoningEffort: string;
    modelPreferences: ThreadModelPreferences;
    revision: number;
  } | null>(null);
  const reasoningEffortRevisionRef = useRef(0);
  const defaultProviderIdRef = useRef(defaultProviderId);
  const selectedProviderIdRef = useRef(initialProviderId);
  const providersControllerRef = useRef<AbortController | null>(null);
  const draftSelectionRef = useRef<AgentDraftSelection>({ modelPreferences: {} });

  const runningThreadIds = Object.keys(activeRunsByThreadId);
  const activeTurnIdsByThreadId = Object.fromEntries(
    Object.entries(activeRunsByThreadId).map(([threadId, run]) => [threadId, run.turnId]),
  );
  const selectedProviderId = activeThreadSummary?.provider || draftProviderId;
  selectedProviderIdRef.current = selectedProviderId;
  const modelCatalogChannelId = agentProviderCatalogUsesChannel(selectedProviderId)
    && channelId !== SYSTEM_AGENT_CHANNEL_ID
    ? channelId
    : undefined;
  const nativeModelCatalog = modelCatalog?.providerId === selectedProviderId ? modelCatalog : null;
  const selectedChannel = getAgentChannel(agentChannels, selectedProviderId, channelId);
  const selectedProviderDefaultChannelId = defaultAgentChannelId(
    agentChannels,
    selectedProviderId,
    defaultAgentChannelIds[selectedProviderId as AgentProviderId],
  );
  const currentModelCatalog = useMemo(
    () => channelId === SYSTEM_AGENT_CHANNEL_ID
      ? nativeModelCatalog
      : selectedChannel
        ? buildAgentChannelModelCatalog(
            selectedProviderId as AgentProviderId,
            selectedChannel,
            nativeModelCatalog,
          )
        : null,
    [channelId, nativeModelCatalog, selectedChannel, selectedProviderId],
  );
  const activeCompactRuntime = activeThreadSummary?.provider === OPENAI_CODEX_PROVIDER_ID
    ? resolveCompactCapabilityRuntime({
        thread: activeThreadSummary,
        activeProjectPath,
        permissionMode,
        model,
        reasoningEffort,
        channelId,
      })
    : null;
  const activeCompactCapabilityKey = activeCompactRuntime
    ? compactCapabilityKey(activeCompactRuntime)
    : '';
  const compactCapability: CodexCompactCapability = activeCompactCapabilityKey
    ? compactCapabilitiesByKey[activeCompactCapabilityKey] ?? { state: 'unknown' }
    : { state: 'unknown' };
  const queuedPrompts = activeThreadId
    ? (queuedPromptsByThreadId[activeThreadId] ?? []).map((prompt) => {
        const guideContent = selectedProviderId === OPENAI_CODEX_PROVIDER_ID
          ? getCodexQueuedPromptGuideContent(prompt)
          : null;
        return {
          ...prompt,
          guideUnavailableReason: guideContent && !guideContent.available
            ? guideContent.reason
            : undefined,
        };
      })
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
    compactCapabilityControllerRef.current?.abort();
    if (!activeCompactRuntime) {
      return undefined;
    }
    const key = compactCapabilityKey(activeCompactRuntime);
    const existing = compactCapabilitiesByKeyRef.current[key];
    if (existing && existing.state !== 'error' && existing.state !== 'unknown') {
      return undefined;
    }

    const controller = new AbortController();
    compactCapabilityControllerRef.current = controller;
    storeCompactCapability({ key, state: 'checking' });
    void (async () => {
      try {
        const response = await fetch('/api/agents/codex/compact-capability', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...activeCompactRuntime,
            refresh: false,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error((await readErrorResponseText(response)) || '检查 Codex 压缩能力失败');
        }
        const capability = await response.json() as CodexCompactCapability;
        if (!['supported', 'unsupported', 'error'].includes(capability.state)) {
          throw new Error('Codex 压缩能力响应无效');
        }
        if (!controller.signal.aborted) {
          storeCompactCapability({ ...capability, key, checkedAtMs: Date.now() });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          storeCompactCapability({
            key,
            state: 'error',
            message: error instanceof Error ? error.message : '检查 Codex 压缩能力失败',
            checkedAtMs: Date.now(),
          });
        }
      }
    })();
    return () => controller.abort();
  }, [activeCompactCapabilityKey]);

  function storeCompactCapability(entry: CompactCapabilityEntry) {
    const next = { ...compactCapabilitiesByKeyRef.current, [entry.key]: entry };
    compactCapabilitiesByKeyRef.current = next;
    setCompactCapabilitiesByKey(next);
  }

  useEffect(() => {
    if (providersLoading || resolveChatRuntimeKind(defaultProviderId) !== 'generic') {
      return;
    }
    const defaultProvider = providers.find((provider) => provider.id === defaultProviderId);
    if (!defaultProvider?.selectable || defaultProvider.available !== true) {
      return;
    }
    void agentModelCatalogCache.load(defaultProviderId).catch(() => undefined);
  }, [defaultProviderId, providers, providersLoading]);

  useEffect(() => {
    if (!activeThreadSummary && !isNewChatDraft) {
      return;
    }
    const draftPermissionMode = draftSelectionRef.current.permissionMode;
    const nextPermissionMode = activeThreadSummary
      ? isVisiblePermissionMode(activeThreadSummary.permissionMode)
        ? activeThreadSummary.permissionMode
        : defaultPermissionMode
      : isVisiblePermissionMode(draftPermissionMode)
        ? draftPermissionMode
        : defaultPermissionMode;
    setAgentPermissionMode(nextPermissionMode);
    if (!activeThreadSummary) {
      draftSelectionRef.current = {
        ...draftSelectionRef.current,
        permissionMode: nextPermissionMode,
      };
    }
  }, [
    activeThreadSummary?.id,
    activeThreadSummary?.permissionMode,
    defaultPermissionMode,
    isNewChatDraft,
  ]);

  useEffect(() => {
    if (!activeThreadSummary && !isNewChatDraft) {
      return;
    }
    if (!activeThreadSummary && agentChannelsLoading) {
      return;
    }
    const nextChannelId = activeThreadSummary
      ? threadAgentChannelId(activeThreadSummary.agentChannelId)
      : draftSelectionRef.current.channelId ?? selectedProviderDefaultChannelId;
    channelIdRef.current = nextChannelId;
    setChannelIdState(nextChannelId);
    if (!activeThreadSummary) {
      draftSelectionRef.current = {
        ...draftSelectionRef.current,
        channelId: nextChannelId,
      };
    }
  }, [
    activeThreadSummary?.agentChannelId,
    activeThreadSummary?.id,
    agentChannelsLoading,
    selectedProviderId,
    selectedProviderDefaultChannelId,
    isNewChatDraft,
  ]);

  useEffect(() => {
    if (!activeThreadSummary && !isNewChatDraft) {
      return;
    }
    const selectedChannelId = channelIdRef.current;
    if (
      agentChannelsLoading
      || selectedChannelId === SYSTEM_AGENT_CHANNEL_ID
      || (activeThreadId && runContextsByThreadIdRef.current.has(activeThreadId))
      || isAgentChannelSelectionAvailable(agentChannels, selectedProviderId, selectedChannelId)
    ) {
      return;
    }

    channelIdRef.current = SYSTEM_AGENT_CHANNEL_ID;
    modelPreferencesRef.current = {};
    setChannelIdState(SYSTEM_AGENT_CHANNEL_ID);
    setAgentModel(DEFAULT_MODEL_VALUE);
    setAgentReasoningEffort('');
    setModelSelectionWarning('');
    if (!activeThreadSummary) {
      draftSelectionRef.current = {
        ...draftSelectionRef.current,
        channelId: SYSTEM_AGENT_CHANNEL_ID,
        model: DEFAULT_MODEL_VALUE,
        reasoningEffort: '',
        modelPreferences: {},
      };
    }
    if (activeThreadId) {
      void persistThreadMetadata(activeThreadId, {
        channelId: null,
        model: null,
        reasoningEffort: null,
      }).catch((error) => {
        showToast(error instanceof Error ? error.message : '清理失效 Agent 渠道失败', 'error');
      });
    }
  }, [
    activeThreadId,
    agentChannels,
    agentChannelsLoading,
    activeThreadSummary,
    isNewChatDraft,
    persistThreadMetadata,
    selectedProviderId,
    showToast,
  ]);

  useEffect(() => {
    if (resolveChatRuntimeKind(selectedProviderId) !== 'generic') {
      setModelCatalog(null);
      setModelsLoading(false);
      setModelsError('');
      setModelSelectionWarning('');
      return;
    }
    const snapshot = agentModelCatalogCache.peek(selectedProviderId, modelCatalogChannelId);
    const usesCodeMChannel = channelId !== SYSTEM_AGENT_CHANNEL_ID;
    if (snapshot) {
      setModelCatalog(snapshot.catalog);
      setModelsLoading(false);
      setModelsError('');
      if (!snapshot.stale) {
        return;
      }
    } else {
      setModelCatalog(null);
      setModelsLoading(!usesCodeMChannel);
      setModelsError('');
    }

    let cancelled = false;
    void agentModelCatalogCache.load(selectedProviderId, { channelId: modelCatalogChannelId })
      .then((catalog) => {
        if (!cancelled) {
          setModelCatalog(catalog);
          setModelsError('');
        }
      })
      .catch((error) => {
        if (!cancelled && !snapshot && !usesCodeMChannel) {
          setModelsError(error instanceof Error ? error.message : '读取 Agent 模型目录失败');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setModelsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, modelCatalogChannelId, selectedProviderId]);

  useEffect(() => {
    if (!activeThreadSummary && !isNewChatDraft) {
      return;
    }
    const draftSelection = draftSelectionRef.current;
    const targetChannelId = activeThreadSummary
      ? threadAgentChannelId(activeThreadSummary.agentChannelId)
      : draftSelection.channelId ?? selectedProviderDefaultChannelId;
    if (!isModelSelectionChannelReady(channelId, targetChannelId)) {
      return;
    }
    const pendingReasoningEffort = activeThreadSummary
      && pendingReasoningEffortRef.current?.threadId === activeThreadSummary.id
      ? pendingReasoningEffortRef.current
      : null;
    if (!currentModelCatalog) {
      modelPreferencesRef.current = pendingReasoningEffort?.modelPreferences
        ?? (activeThreadSummary ? {} : draftSelection.modelPreferences);
      setAgentModel(pendingReasoningEffort?.model
        ?? (activeThreadSummary ? DEFAULT_MODEL_VALUE : draftSelection.model ?? DEFAULT_MODEL_VALUE));
      setAgentReasoningEffort(pendingReasoningEffort?.reasoningEffort
        ?? (activeThreadSummary ? '' : draftSelection.reasoningEffort ?? ''));
      setModelSelectionWarning('');
      return;
    }
    const threadMatchesCatalog = activeThreadSummary?.provider === currentModelCatalog.providerId;
    const preferences = pendingReasoningEffort?.modelPreferences ?? (threadMatchesCatalog
      ? collectThreadModelPreferences(activeThreadSummary)
      : isNewChatDraft
        ? draftSelection.modelPreferences
        : {});
    const savedModelId = pendingReasoningEffort?.model ?? (threadMatchesCatalog
      ? activeThreadSummary?.model
      : isNewChatDraft
        ? draftSelection.model
        : undefined);
    const savedReasoningEffort = pendingReasoningEffort?.reasoningEffort
      ?? reasoningEffortForThreadModel(preferences, savedModelId);
    modelPreferencesRef.current = preferences;
    const resolved = resolveAgentModelSelection(
      currentModelCatalog,
      savedModelId,
      savedReasoningEffort,
    );
    setAgentModel(resolved.modelId);
    setAgentReasoningEffort(resolved.reasoningEffort);
    if (!activeThreadSummary) {
      draftSelectionRef.current = {
        ...draftSelection,
        model: resolved.modelId,
        reasoningEffort: resolved.reasoningEffort,
        modelPreferences: preferences,
      };
    }
    if (resolved.staleModelId) {
      setModelSelectionWarning(
        `已保存的模型 ${resolved.staleModelId} 当前不可用，运行时将使用 Provider 默认模型。`,
      );
    } else if (resolved.staleReasoningEffort) {
      setModelSelectionWarning(
        `已保存的思考级别 ${resolved.staleReasoningEffort} 当前不受该模型支持，已更新为模型默认值。`,
      );
      modelPreferencesRef.current = updateThreadModelReasoningEffort(
        preferences,
        resolved.modelId,
        resolved.reasoningEffort,
      );
      if (!activeThreadSummary) {
        draftSelectionRef.current = {
          ...draftSelectionRef.current,
          model: resolved.modelId,
          reasoningEffort: resolved.reasoningEffort,
          modelPreferences: modelPreferencesRef.current,
        };
      }
      if (activeThreadId) {
        void persistThreadMetadata(activeThreadId, {
          model: resolved.modelId === DEFAULT_MODEL_VALUE ? null : resolved.modelId,
          reasoningEffort: resolved.reasoningEffort || null,
        }).catch((error) => {
          showToast(error instanceof Error ? error.message : '更新 Agent 思考级别失败', 'error');
        });
      }
    } else {
      setModelSelectionWarning('');
    }
  }, [
    activeThreadSummary?.id,
    activeThreadSummary?.model,
    activeThreadSummary?.provider,
    activeThreadSummary?.reasoningEffort,
    activeThreadSummary?.modelPreferences,
    activeThreadSummary?.agentChannelId,
    channelId,
    activeThreadId,
    currentModelCatalog,
    isNewChatDraft,
    selectedProviderDefaultChannelId,
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

  useEffect(() => {
    if (
      !activeThreadDetail?.historyLoaded ||
      activeThreadDetail.provider !== OPENAI_CODEX_PROVIDER_ID
    ) {
      return;
    }
    const turn = findUnconfirmedManualCompactTurn(activeThreadDetail.turns);
    const metadata = turn ? readCompactMetadata(turn) : null;
    if (!turn || !metadata || reconciledCompactOperationIdsRef.current.has(metadata.operationId)) {
      return;
    }
    reconciledCompactOperationIdsRef.current.add(metadata.operationId);

    const permission = isVisiblePermissionMode(activeThreadDetail.permissionMode)
      ? activeThreadDetail.permissionMode
      : defaultPermissionMode;
    const persistedRuntime = resolveCompactCapabilityRuntime({
      thread: activeThreadDetail,
      activeProjectPath,
      permissionMode: permission,
      model: activeThreadDetail.model?.trim() || DEFAULT_MODEL_VALUE,
      reasoningEffort: activeThreadDetail.reasoningEffort?.trim() || '',
      channelId: threadAgentChannelId(activeThreadDetail.agentChannelId),
    });
    const runtime: CompactCapabilityRuntime = {
      threadId: activeThreadDetail.id,
      sessionId: metadata.providerThreadId,
      workingDirectory:
        persistedRuntime?.workingDirectory ||
        activeThreadDetail.workingDirectory.trim() ||
        activeProjectPath?.trim() ||
        turn.workspace,
      permissionMode: persistedRuntime?.permissionMode ?? permission,
      model: persistedRuntime?.model,
      reasoningEffort: persistedRuntime?.reasoningEffort,
      channelId: persistedRuntime?.channelId,
    };
    const operation: CompactOperationContext = {
      operationId: metadata.operationId,
      turnId: turn.id,
      status: metadata.status,
      thread: activeThreadDetail,
      runtime,
      trigger: 'reconcile',
      terminalConfirmed: false,
    };
    compactOperationsByThreadIdRef.current.set(activeThreadDetail.id, operation);
    threadSummariesByIdRef.current.set(activeThreadDetail.id, activeThreadDetail);
    void reconcilePersistedCompactOperation(operation, metadata.providerTurnId, metadata.providerItemId);
  }, [
    activeProjectPath,
    activeThreadDetail,
    defaultPermissionMode,
  ]);

  function selectDraftProvider(providerId: string) {
    const nextChannelId = defaultAgentChannelId(
      agentChannels,
      providerId,
      defaultAgentChannelIds[providerId as AgentProviderId],
    );
    if (providerId === CLAUDE_CODE_PROVIDER_ID) {
      setDraftProviderId(providerId);
      channelIdRef.current = nextChannelId;
      setChannelIdState(nextChannelId);
      draftSelectionRef.current = {
        permissionMode: defaultPermissionMode,
        channelId: nextChannelId,
        model: DEFAULT_MODEL_VALUE,
        reasoningEffort: '',
        modelPreferences: {},
      };
      resetDraftModelSelection(providerId, nextChannelId);
      setModelSelectionWarning('');
      return true;
    }

    const error = getProviderRunError(providerId, providers, providersLoading, providersError);
    if (error) {
      showToast(error, 'info');
      return false;
    }
    if (draftProviderId !== providerId) {
      setAgentPermissionMode(defaultPermissionMode);
      channelIdRef.current = nextChannelId;
      setChannelIdState(nextChannelId);
      draftSelectionRef.current = {
        permissionMode: defaultPermissionMode,
        channelId: nextChannelId,
        model: DEFAULT_MODEL_VALUE,
        reasoningEffort: '',
        modelPreferences: {},
      };
      resetDraftModelSelection(providerId, nextChannelId);
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

  function resetDraftModelSelection(providerId: string, nextChannelId?: string) {
    modelPreferencesRef.current = {};
    const snapshot = resolveChatRuntimeKind(providerId) === 'generic'
      ? agentModelCatalogCache.peek(
        providerId,
        agentProviderCatalogUsesChannel(providerId) && nextChannelId !== SYSTEM_AGENT_CHANNEL_ID
          ? nextChannelId
          : undefined,
      )
      : undefined;
    const cached = snapshot?.catalog;
    if (!cached) {
      setAgentModel(DEFAULT_MODEL_VALUE);
      setAgentReasoningEffort('');
      if (isNewChatDraft) {
        draftSelectionRef.current = {
          ...draftSelectionRef.current,
          model: DEFAULT_MODEL_VALUE,
          reasoningEffort: '',
          modelPreferences: {},
        };
      }
      return;
    }
    setModelCatalog(cached);
    const resolved = resolveAgentModelSelection(cached);
    setAgentModel(resolved.modelId);
    setAgentReasoningEffort(resolved.reasoningEffort);
    if (isNewChatDraft) {
      draftSelectionRef.current = {
        ...draftSelectionRef.current,
        model: resolved.modelId,
        reasoningEffort: resolved.reasoningEffort,
        modelPreferences: {},
      };
    }
    if (snapshot.stale) {
      const catalogChannelId = agentProviderCatalogUsesChannel(providerId)
        && nextChannelId !== SYSTEM_AGENT_CHANNEL_ID
        ? nextChannelId
        : undefined;
      void agentModelCatalogCache.load(providerId, { channelId: catalogChannelId }).then((catalog) => {
        if (selectedProviderIdRef.current === providerId
          && channelIdRef.current === (nextChannelId ?? channelIdRef.current)) {
          setModelCatalog(catalog);
        }
      }).catch(() => undefined);
    }
  }

  function handleModelSelect(nextModel: string) {
    if (activeThreadId && runContextsByThreadIdRef.current.has(activeThreadId)) {
      showToast('当前 Agent 正在运行，模型已锁定。', 'info');
      return;
    }
    if (!currentModelCatalog && nextModel === DEFAULT_MODEL_VALUE) {
      const previousModel = modelRef.current;
      const previousEffort = reasoningEffortRef.current;
      const previousPreferences = modelPreferencesRef.current;
      setAgentModel(DEFAULT_MODEL_VALUE);
      setAgentReasoningEffort('');
      modelPreferencesRef.current = updateThreadModelReasoningEffort(
        previousPreferences,
        DEFAULT_MODEL_VALUE,
        null,
      );
      setModelSelectionWarning('');
      if (isNewChatDraft) {
        draftSelectionRef.current = {
          ...draftSelectionRef.current,
          model: DEFAULT_MODEL_VALUE,
          reasoningEffort: '',
          modelPreferences: modelPreferencesRef.current,
        };
      }
      if (activeThreadId) {
        void persistThreadMetadata(activeThreadId, {
          model: null,
          reasoningEffort: null,
        }).catch((error) => {
          setAgentModel(previousModel);
          setAgentReasoningEffort(previousEffort);
          modelPreferencesRef.current = previousPreferences;
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
    const previousModel = modelRef.current;
    const previousEffort = reasoningEffortRef.current;
    const previousPreferences = modelPreferencesRef.current;
    const savedEffort = reasoningEffortForThreadModel(previousPreferences, nextModel);
    const resolved = resolveAgentModelSelection(currentModelCatalog, nextModel, savedEffort);
    const nextEffort = resolved.reasoningEffort;
    if (resolved.staleReasoningEffort) {
      showToast(
        `已保存的思考级别 ${resolved.staleReasoningEffort} 当前不可用，已更新为模型默认值。`,
        'info',
      );
    }
    setAgentModel(nextModel);
    setAgentReasoningEffort(nextEffort);
    modelPreferencesRef.current = updateThreadModelReasoningEffort(
      previousPreferences,
      nextModel,
      nextEffort,
    );
    setModelSelectionWarning('');
    if (isNewChatDraft) {
      draftSelectionRef.current = {
        ...draftSelectionRef.current,
        model: nextModel,
        reasoningEffort: nextEffort,
        modelPreferences: modelPreferencesRef.current,
      };
    }
    if (activeThreadId) {
      void persistThreadMetadata(activeThreadId, {
        model: nextModel === DEFAULT_MODEL_VALUE ? null : nextModel,
        reasoningEffort: nextEffort || null,
      }).catch((error) => {
        setAgentModel(previousModel);
        setAgentReasoningEffort(previousEffort);
        modelPreferencesRef.current = previousPreferences;
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
    const previousEffort = reasoningEffortRef.current;
    const previousPreferences = modelPreferencesRef.current;
    const revision = reasoningEffortRevisionRef.current + 1;
    reasoningEffortRevisionRef.current = revision;
    setAgentReasoningEffort(nextEffort);
    modelPreferencesRef.current = updateThreadModelReasoningEffort(
      previousPreferences,
      modelRef.current,
      nextEffort,
    );
    setModelSelectionWarning('');
    if (isNewChatDraft) {
      draftSelectionRef.current = {
        ...draftSelectionRef.current,
        model: modelRef.current,
        reasoningEffort: nextEffort,
        modelPreferences: modelPreferencesRef.current,
      };
    }
    if (activeThreadId) {
      pendingReasoningEffortRef.current = {
        threadId: activeThreadId,
        model: modelRef.current,
        reasoningEffort: nextEffort,
        modelPreferences: modelPreferencesRef.current,
        revision,
      };
      void persistThreadMetadata(activeThreadId, {
        model: modelRef.current === DEFAULT_MODEL_VALUE ? null : modelRef.current,
        reasoningEffort: nextEffort,
      }).then(() => {
        if (pendingReasoningEffortRef.current?.revision === revision) {
          pendingReasoningEffortRef.current = null;
        }
      }).catch((error) => {
        if (pendingReasoningEffortRef.current?.revision !== revision) {
          return;
        }
        pendingReasoningEffortRef.current = null;
        setAgentReasoningEffort(previousEffort);
        modelPreferencesRef.current = previousPreferences;
        showToast(error instanceof Error ? error.message : '保存 Agent 思考级别失败', 'error');
      });
    }
  }

  function retryModelCatalog() {
    const providerId = selectedProviderId;
    const snapshot = agentModelCatalogCache.peek(providerId, modelCatalogChannelId);
    if (snapshot) {
      setModelCatalog(snapshot.catalog);
    }
    setModelsLoading(true);
    setModelsError('');
    void agentModelCatalogCache.load(providerId, { force: true, channelId: modelCatalogChannelId })
      .then((catalog) => {
        if (selectedProviderIdRef.current === providerId) {
          setModelCatalog(catalog);
          setModelsError('');
        }
      })
      .catch((error) => {
        if (selectedProviderIdRef.current === providerId) {
          setModelsError(error instanceof Error ? error.message : '读取 Agent 模型目录失败');
        }
      })
      .finally(() => {
        if (selectedProviderIdRef.current === providerId) {
          setModelsLoading(false);
        }
      });
  }

  function handleChannelSelect(nextChannelId: string) {
    if (activeThreadId && runContextsByThreadIdRef.current.has(activeThreadId)) {
      showToast('当前 Agent 正在运行，渠道已锁定。', 'info');
      return false;
    }
    if (nextChannelId !== SYSTEM_AGENT_CHANNEL_ID) {
      const nextChannel = getAgentChannel(agentChannels, selectedProviderId, nextChannelId);
      if (!nextChannel?.enabled) {
        showToast('所选 Agent 渠道不可用。', 'error');
        return false;
      }
    }
    if (nextChannelId === channelIdRef.current) {
      return true;
    }

    const previousChannelId = channelIdRef.current;
    const previousModel = modelRef.current;
    const previousEffort = reasoningEffortRef.current;
    const previousPreferences = modelPreferencesRef.current;
    channelIdRef.current = nextChannelId;
    modelPreferencesRef.current = {};
    setChannelIdState(nextChannelId);
    setAgentModel(DEFAULT_MODEL_VALUE);
    setAgentReasoningEffort('');
    setModelSelectionWarning('');
    if (isNewChatDraft) {
      draftSelectionRef.current = {
        ...draftSelectionRef.current,
        channelId: nextChannelId,
        model: DEFAULT_MODEL_VALUE,
        reasoningEffort: '',
        modelPreferences: {},
      };
    }

    if (activeThreadId) {
      void persistThreadMetadata(
        activeThreadId,
        agentChannelMetadataPatch(selectedProviderId, nextChannelId),
      ).catch((error) => {
        channelIdRef.current = previousChannelId;
        modelPreferencesRef.current = previousPreferences;
        setChannelIdState(previousChannelId);
        setAgentModel(previousModel);
        setAgentReasoningEffort(previousEffort);
        showToast(error instanceof Error ? error.message : '保存 Agent 渠道失败', 'error');
      });
    }
    return true;
  }

  function handlePermissionModeSelect(mode: PermissionMode) {
    if (!isVisiblePermissionMode(mode)) {
      showToast('当前 Agent Provider 不支持该权限模式。', 'error');
      return;
    }
    const previousMode = permissionModeRef.current;
    setAgentPermissionMode(mode);
    if (isNewChatDraft) {
      draftSelectionRef.current = {
        ...draftSelectionRef.current,
        permissionMode: mode,
      };
    }
    if (activeThreadId) {
      void persistThreadMetadata(activeThreadId, { permissionMode: mode }).catch((error) => {
        setAgentPermissionMode(previousMode);
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
    const removedPrompt = removeQueuedPromptFromThread(activeThreadId, promptId);
    if (!removedPrompt) {
      return;
    }
    resumePausedQueueAfterUnknownRemoval(activeThreadId, removedPrompt);
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
    resumePausedQueueAfterUnknownRemoval(activeThreadId, prompt);
    appendDebug(activeThreadId, {
      title: '已召回排队提示',
      content: promptId,
    });
    return prompt.displayText || prompt.prompt;
  }

  function resumePausedQueueAfterUnknownRemoval(
    threadId: string,
    removedPrompt: QueuedAgentPrompt,
  ) {
    const context = pausedQueueContinuationsByThreadIdRef.current.get(threadId);
    if (!shouldResumePausedQueueAfterUnknownRemoval(
      removedPrompt.queueStatus,
      queuedPromptsByThreadIdRef.current[threadId] ?? [],
      Boolean(context),
    ) || !context) {
      return;
    }
    pausedQueueContinuationsByThreadIdRef.current.delete(threadId);
    maybeStartQueuedPrompt(context);
  }

  async function guideQueuedPrompt(promptId: string) {
    const targetThreadId = activeThreadId;
    const context = targetThreadId
      ? runContextsByThreadIdRef.current.get(targetThreadId)
      : undefined;
    if (!targetThreadId || !context?.runId) {
      showToast('当前没有可引导的运行。', 'info');
      return false;
    }
    if (context.providerId !== OPENAI_CODEX_PROVIDER_ID) {
      showToast('当前 Provider 不支持运行中引导，消息会在本轮完成后自动发送。', 'info');
      return false;
    }
    if (context.interrupting) {
      showToast('当前运行正在停止，暂不能引导。', 'info');
      return false;
    }
    const queue = queuedPromptsByThreadIdRef.current[targetThreadId] ?? [];
    const guideSelection = getQueuedPromptGuideSelection(queue, promptId);
    if (!guideSelection.available) {
      showToast(guideSelection.reason, 'info');
      return false;
    }
    const targetPrompt = queue[0];
    const guideContent = getCodexQueuedPromptGuideContent(targetPrompt);
    if (!guideContent.available) {
      showToast(guideContent.reason, 'info');
      return false;
    }

    updateQueuedPromptStatus(targetThreadId, promptId, 'guiding');
    let resultUncertain = true;
    try {
      const response = await fetch(
        `/api/agents/run/${encodeURIComponent(context.runId)}/guide`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: targetPrompt.prompt,
            contentBlocks: buildRunContentBlocks({
              prompt: targetPrompt.prompt,
              attachments: targetPrompt.attachments,
              contentBlocks: targetPrompt.contentBlocks,
            }),
            workingDirectory: context.workingDirectory,
          }),
        },
      );
      const payload = await response.json().catch(() => null) as {
        submitted?: boolean;
        uncertain?: boolean;
        error?: string;
      } | null;
      if (!response.ok || payload?.submitted !== true) {
        resultUncertain = payload?.uncertain === true || response.status >= 500 || response.ok;
        updateQueuedPromptStatus(
          targetThreadId,
          promptId,
          resultUncertain ? 'guide-unknown' : 'ready',
        );
        if (shouldContinueQueueAfterGuide(
          context.terminalAllowsQueueContinuation,
          context.terminalBlockedGuidePromptId,
          promptId,
          resultUncertain ? 'uncertain' : 'rejected',
        )) {
          context.terminalBlockedGuidePromptId = undefined;
          maybeStartQueuedPrompt(context);
        }
        throw new Error(payload?.error || '发送引导消息失败');
      }

      resultUncertain = false;
      removeQueuedPromptFromThread(targetThreadId, promptId);
      if (shouldContinueQueueAfterGuide(
        context.terminalAllowsQueueContinuation,
        context.terminalBlockedGuidePromptId,
        promptId,
        'submitted',
      )) {
        context.terminalBlockedGuidePromptId = undefined;
        maybeStartQueuedPrompt(context);
      }
      updateThreadTurn(context.threadId, context.turnId, (turn) => ({
        ...turn,
        items: [
          ...turn.items,
          createAgentGuideSystemItem(targetPrompt.displayText || guideContent.text),
        ],
        activity: resolveGuideSuccessActivity(context.terminal, turn.activity),
      }));
      schedulePersistThreadHistory(context.threadId, { urgent: true });
      appendDebug(targetThreadId, {
        title: '已引导当前运行',
        content: guideContent.text,
      });
      return true;
    } catch (error) {
      const queuedPrompt = (queuedPromptsByThreadIdRef.current[targetThreadId] ?? [])
        .find((prompt) => prompt.id === promptId);
      if (queuedPrompt?.queueStatus === 'guiding') {
        updateQueuedPromptStatus(
          targetThreadId,
          promptId,
          resultUncertain ? 'guide-unknown' : 'ready',
        );
      }
      showToast(error instanceof Error ? error.message : '发送引导消息失败', 'error');
      return false;
    }
  }

  function updateQueuedPromptStatus(
    threadId: string,
    promptId: string,
    queueStatus: QueuedPromptStatus,
  ) {
    updateQueuedPrompts((current) => {
      const queue = current[threadId] ?? [];
      const index = queue.findIndex((prompt) => prompt.id === promptId);
      if (index === -1 || queue[index].queueStatus === queueStatus) {
        return current;
      }
      const nextQueue = [...queue];
      nextQueue[index] = { ...nextQueue[index], queueStatus };
      return { ...current, [threadId]: nextQueue };
    });
  }

  function maybeStartQueuedPrompt(context: AgentRunContext) {
    const queue = queuedPromptsByThreadIdRef.current[context.threadId] ?? [];
    const compactOperation = compactOperationsByThreadIdRef.current.get(context.threadId);
    const continuationState = getQueuedPromptContinuationState(queue, compactOperation?.status);
    if (continuationState === 'blocked-by-compact') {
      pausedQueueAfterCompactByThreadIdRef.current.set(context.threadId, context);
      autoStartAfterPreparationThreadIdsRef.current.delete(context.threadId);
      return;
    }
    pausedQueueAfterCompactByThreadIdRef.current.delete(context.threadId);
    if (continuationState !== 'paused') {
      pausedQueueContinuationsByThreadIdRef.current.delete(context.threadId);
    }
    if (continuationState === 'preparing') {
      autoStartAfterPreparationThreadIdsRef.current.add(context.threadId);
      return;
    }
    if (continuationState === 'paused') {
      if (
        context.terminalAllowsQueueContinuation &&
        queue[0]?.queueStatus === 'guiding'
      ) {
        context.terminalBlockedGuidePromptId = queue[0].id;
      }
      if (context.terminalAllowsQueueContinuation) {
        pausedQueueContinuationsByThreadIdRef.current.set(context.threadId, context);
      }
      autoStartAfterPreparationThreadIdsRef.current.delete(context.threadId);
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

  function maybeStartPendingCompaction(context: AgentRunContext) {
    const compactOperation = compactOperationsByThreadIdRef.current.get(context.threadId);
    if (compactOperation?.status !== 'waiting') {
      return false;
    }
    pausedQueueAfterCompactByThreadIdRef.current.set(context.threadId, context);
    if (context.sessionId) {
      compactOperation.runtime = {
        ...compactOperation.runtime,
        sessionId: context.sessionId,
        workingDirectory: context.workingDirectory,
      };
    }
    void startCompactRequest(compactOperation);
    return true;
  }

  async function requestThreadCompaction(
    thread: ThreadSummary,
    trigger: 'slash' | 'context' | 'retry',
  ): Promise<boolean> {
    if (!thread.sessionId.trim()) {
      showToast('完成至少一轮 Codex 对话后才能压缩上下文', 'error');
      return false;
    }
    const runtime = resolveCompactCapabilityRuntime({
      thread,
      activeProjectPath,
      permissionMode: permissionModeRef.current,
      model: modelRef.current,
      reasoningEffort: reasoningEffortRef.current,
      channelId: channelIdRef.current,
    });
    if (!runtime) {
      showToast('当前聊天缺少工作目录。', 'error');
      return false;
    }
    const activeOperation = compactOperationsByThreadIdRef.current.get(thread.id);
    const capability = compactCapabilitiesByKeyRef.current[compactCapabilityKey(runtime)]
      ?? { state: 'unknown' as const };
    const availability = getCompactAvailability({
      providerId: thread.provider,
      sessionId: runtime.sessionId,
      capability,
      activeStatus: trigger === 'retry' || activeOperation?.terminalConfirmed
        ? undefined
        : activeOperation?.status === 'completed'
          ? 'running'
          : activeOperation?.status,
    });
    if (!availability.available) {
      showToast(availability.reason, availability.busy ? 'info' : 'error');
      return false;
    }
    if (trigger === 'retry') {
      if (!activeOperation || !['failed', 'interrupted'].includes(activeOperation.status)) {
        showToast('当前没有可重试的上下文压缩。', 'info');
        return false;
      }
      activeOperation.trigger = trigger;
      activeOperation.thread = thread;
      activeOperation.runtime = runtime;
      activeOperation.status = 'preparing';
      activeOperation.terminalConfirmed = false;
      updateThreadTurn(thread.id, activeOperation.turnId, (turn) => retryCompactTurn(turn, Date.now()));
      schedulePersistThreadHistory(thread.id, { urgent: true });
      return startCompactRequest(activeOperation);
    }

    const operationId = crypto.randomUUID();
    reconciledCompactOperationIdsRef.current.add(operationId);
    const waiting = runContextsByThreadIdRef.current.has(thread.id);
    const operation: CompactOperationContext = {
      operationId,
      turnId: `compact-turn:${operationId}`,
      status: waiting ? 'waiting' : 'preparing',
      thread,
      runtime,
      trigger,
      terminalConfirmed: false,
    };
    compactOperationsByThreadIdRef.current.set(thread.id, operation);
    threadSummariesByIdRef.current.set(thread.id, thread);
    updateThreadDetail(
      thread.id,
      (existing) => ({
        ...existing,
        turns: [
          ...existing.turns,
          createManualCompactTurn({
            operationId,
            providerThreadId: runtime.sessionId,
            workspace: runtime.workingDirectory,
            status: operation.status === 'waiting' ? 'waiting' : 'preparing',
            nowMs: Date.now(),
          }),
        ],
      }),
      thread,
    );
    schedulePersistThreadHistory(thread.id, { urgent: !waiting });
    if (waiting) {
      showToast('将在当前回答完成后压缩上下文。', 'info');
      return true;
    }
    return startCompactRequest(operation);
  }

  function skipThreadCompaction(thread: ThreadSummary): boolean {
    const operation = compactOperationsByThreadIdRef.current.get(thread.id);
    if (!operation || !['failed', 'interrupted'].includes(operation.status)) {
      showToast('当前没有可跳过的上下文压缩。', 'info');
      return false;
    }
    updateThreadTurn(
      thread.id,
      operation.turnId,
      (turn) => skipCompactTurn(turn, Date.now()),
      thread,
    );
    schedulePersistThreadHistory(thread.id, { urgent: true });
    compactOperationsByThreadIdRef.current.delete(thread.id);
    releaseQueueAfterCompact(thread.id, operation);
    return true;
  }

  async function startCompactRequest(operation: CompactOperationContext): Promise<boolean> {
    operation.status = 'preparing';
    updateThreadTurn(operation.thread.id, operation.turnId, prepareCompactTurn, operation.thread);
    schedulePersistThreadHistory(operation.thread.id);
    const controller = new AbortController();
    operation.abortController?.abort();
    operation.abortController = controller;
    try {
      const thread = operation.thread;
      const response = await fetch(
        `/api/agents/runtime/${encodeURIComponent(thread.id)}/compact`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operationId: operation.operationId,
            providerId: OPENAI_CODEX_PROVIDER_ID,
            sessionId: operation.runtime.sessionId,
            workingDirectory: operation.runtime.workingDirectory,
            permissionMode: operation.runtime.permissionMode,
            model: operation.runtime.model,
            reasoningEffort: operation.runtime.reasoningEffort,
            channelId: operation.runtime.channelId,
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error((await readErrorResponseText(response)) || '启动 Codex 上下文压缩失败');
      }
      await consumeCompactEventStream(response, operation);
      return compactOperationsByThreadIdRef.current.get(operation.thread.id)?.status === 'completed';
    } catch (error) {
      if (controller.signal.aborted) {
        return false;
      }
      failCompactOperation(
        operation,
        error instanceof Error ? error.message : 'Codex 上下文压缩失败',
      );
      return false;
    }
  }

  async function reconcilePersistedCompactOperation(
    operation: CompactOperationContext,
    providerTurnId?: string,
    providerItemId?: string,
  ) {
    let result: CompactReconcileResult;
    try {
      const response = await fetch(
        `/api/agents/runtime/${encodeURIComponent(operation.thread.id)}/compact/reconcile`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operationId: operation.operationId,
            providerId: OPENAI_CODEX_PROVIDER_ID,
            sessionId: operation.runtime.sessionId,
            workingDirectory: operation.runtime.workingDirectory,
            permissionMode: operation.runtime.permissionMode,
            model: operation.runtime.model,
            reasoningEffort: operation.runtime.reasoningEffort,
            channelId: operation.runtime.channelId,
            providerTurnId,
            providerItemId,
          }),
        },
      );
      if (!response.ok) {
        throw new Error('无法核对 Codex 上下文压缩历史');
      }
      const payload = await response.json() as Partial<CompactReconcileResult>;
      if (!['confirmed', 'unconfirmed', 'not_found'].includes(payload.state ?? '')) {
        throw new Error('Codex 上下文压缩历史响应无效');
      }
      result = {
        state: payload.state as CompactReconcileResult['state'],
        providerTurnId: typeof payload.providerTurnId === 'string'
          ? payload.providerTurnId
          : undefined,
        providerItemId: typeof payload.providerItemId === 'string'
          ? payload.providerItemId
          : undefined,
      };
    } catch {
      result = { state: 'error' };
    }

    operation.status = result.state === 'confirmed' ? 'completed' : 'interrupted';
    operation.terminalConfirmed = true;
    updateThreadTurn(
      operation.thread.id,
      operation.turnId,
      (turn) => applyCompactReconcileResult(turn, result, Date.now()),
      operation.thread,
    );
    schedulePersistThreadHistory(operation.thread.id, { urgent: true });
    appendDebug(operation.thread.id, {
      title: result.state === 'confirmed'
        ? '已恢复 Codex 压缩状态'
        : 'Codex 压缩状态未确认',
      content: result.state === 'confirmed'
        ? '已从原生历史确认上下文压缩完成。'
        : '未从原生历史确认完成，已标记为中断，可手动重试。',
      tone: result.state === 'confirmed' ? 'neutral' : 'error',
    });
  }

  async function consumeCompactEventStream(
    response: Response,
    operation: CompactOperationContext,
  ) {
    if (!response.body) {
      throw new Error('Codex 压缩事件流不可读');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let terminal = false;
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      if (done && buffer.trim()) {
        lines.push(buffer);
      }
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        let event: AgentRunEvent;
        try {
          event = JSON.parse(line) as AgentRunEvent;
        } catch {
          appendDebug(operation.thread.id, {
            title: 'Codex 压缩事件解析失败',
            content: '收到了一条无法解析的压缩事件；原始内容未写入日志。',
            tone: 'error',
          });
          continue;
        }
        if (event.type === 'context-compaction') {
          applyContextCompactionEvent(
            operation.thread.id,
            event,
            operation.runtime.workingDirectory,
          );
          continue;
        }
        if (event.type === 'error') {
          terminal = true;
          operation.terminalConfirmed = true;
          if (operation.status !== 'failed') {
            failCompactOperation(operation, event.message);
          }
          continue;
        }
        if (event.type === 'done') {
          terminal = true;
          operation.terminalConfirmed = true;
          if (operation.status === 'completed') {
            releaseQueueAfterCompact(operation.thread.id, operation);
          } else {
            failCompactOperation(operation, '压缩请求已结束，但未收到原生完成事件');
          }
        }
      }
      if (done) {
        break;
      }
    }
    if (!terminal) {
      failCompactOperation(operation, 'Codex 压缩事件流意外结束');
    }
  }

  function applyContextCompactionEvent(
    threadId: string,
    event: Extract<AgentRunEvent, { type: 'context-compaction' }>,
    workingDirectory: string,
  ) {
    const operation = compactOperationsByThreadIdRef.current.get(threadId);
    if (operation && event.source === 'manual' && event.operationId === operation.operationId) {
      operation.status = event.status;
    }
    updateThreadDetail(
      threadId,
      (thread) => {
        const turns = applyCompactEvent(thread.turns, event, workingDirectory);
        return turns === thread.turns ? thread : { ...thread, turns };
      },
      operation?.thread ?? threadSummariesByIdRef.current.get(threadId),
    );
    schedulePersistThreadHistory(threadId, { urgent: event.status !== 'running' });
    if (!operation && event.source === 'automatic') {
      appendDebug(threadId, {
        title: 'Codex 自动压缩上下文',
        content: event.status === 'completed' ? '原生自动压缩已完成。' : '正在同步原生自动压缩状态。',
        tone: 'neutral',
      });
    }
  }

  function failCompactOperation(operation: CompactOperationContext, message: string) {
    if (operation.status === 'completed') {
      return;
    }
    applyContextCompactionEvent(
      operation.thread.id,
      {
        type: 'context-compaction',
        runId: `local:${operation.operationId}`,
        operationId: operation.operationId,
        source: 'manual',
        status: 'failed',
        providerThreadId: operation.runtime.sessionId,
        error: message,
        atMs: Date.now(),
      },
      operation.runtime.workingDirectory,
    );
    showToast(message, 'error');
  }

  function releaseQueueAfterCompact(
    threadId: string,
    operation?: CompactOperationContext,
  ) {
    const continuation = pausedQueueAfterCompactByThreadIdRef.current.get(threadId);
    pausedQueueAfterCompactByThreadIdRef.current.delete(threadId);
    if (continuation) {
      maybeStartQueuedPrompt(continuation);
      return;
    }
    if (!operation) {
      return;
    }
    const nextPrompt = shiftQueuedPrompt(threadId);
    if (!nextPrompt) {
      return;
    }
    const thread = threadSummariesByIdRef.current.get(threadId) ?? operation.thread;
    window.setTimeout(() => {
      const started = startAgentRun(
        thread,
        nextPrompt,
        (operation.runtime.permissionMode as PermissionMode | undefined) ?? permissionModeRef.current,
        operation.runtime.model,
        operation.runtime.reasoningEffort,
      );
      if (!started) {
        restoreQueuedPrompt(threadId, nextPrompt);
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
    runChannelId?: string,
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
          ...(runChannelId ? { channelId: runChannelId } : {}),
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
    const runChannelId = requestAgentChannelId(channelIdRef.current);
    const thread = await ensureAgentThread(
      submission,
      providerId,
      runPermissionMode,
      runModel,
      runReasoningEffort,
      runChannelId,
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
    const compactOperation = compactOperationsByThreadIdRef.current.get(thread.id);
    if (submission.queueId) {
      const queuedPrompt = updateQueuedPrompt(thread.id, submission.queueId, submission);
      if (queuedPrompt) {
        if (submission.queueStatus === 'preparing' || activeContext) {
          return true;
        }
        const queueHead = queuedPromptsByThreadIdRef.current[thread.id]?.[0];
        if (
          queueHead?.id !== queuedPrompt.id ||
          getQueuedPromptContinuationState(
            queuedPromptsByThreadIdRef.current[thread.id] ?? [],
          ) === 'paused' ||
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
    if (
      activeContext ||
      (compactOperation && (
        !compactOperation.terminalConfirmed || compactOperation.status !== 'completed'
      )) ||
      submission.queueStatus === 'preparing' ||
      pausedQueueContinuationsByThreadIdRef.current.has(thread.id)
    ) {
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

  function submitAutomationPromptToThread(
    thread: ThreadSummary,
    prompt: string,
    options: {
      permissionMode: PermissionMode;
      model?: string;
      reasoningEffort?: string;
      automationExecution?: boolean;
    },
  ) {
    if (resolveChatRuntimeKind(thread.provider) !== 'generic') {
      return false;
    }
    threadSummariesByIdRef.current.set(thread.id, thread);
    return startAgentRun(
      thread,
      {
        prompt,
        displayText: prompt,
        automationExecution: options.automationExecution === true,
      },
      options.permissionMode,
      options.model,
      options.reasoningEffort,
    );
  }

  function startAgentRun(
    thread: ThreadSummary,
    submission: Omit<AgentPromptSubmission, 'queueStatus'>,
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
    const channelSelection = resolveRunAgentChannelSelection({
      providerId: thread.provider,
      threadId: thread.id,
      activeThreadId,
      persistedChannelId: thread.agentChannelId,
      selectedChannelId: channelIdRef.current,
    });
    const context: AgentRunContext = {
      providerId: thread.provider,
      providerName,
      threadId: thread.id,
      threadTitle: thread.title,
      turnId,
      runId: '',
      workingDirectory,
      sessionId: channelSelection.reuseSession
        ? thread.sessionId.trim() || undefined
        : undefined,
      permissionMode: runPermissionMode,
      model: runModel,
      reasoningEffort: runReasoningEffort,
      channelId: channelSelection.channelId,
      startedAtMs,
      abortController: controller,
      pendingText: '',
      textFrame: null,
      cancelFallbackTimer: null,
      interrupting: false,
      cancelRequested: false,
      cancelRequestSent: false,
      terminal: false,
      terminalAllowsQueueContinuation: false,
      terminalBlockedGuidePromptId: undefined,
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
            channelId: context.channelId,
            ...(context.providerId === DEEPSEEK_DSH_PROVIDER_ID
              ? { dshProfile, dshAgentPreset, dshToolsMode }
              : {}),
            automationExecution: submission.automationExecution === true,
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
        await consumeAgentRunEventStream(
          response,
          (event) => handleAgentEvent(event, context),
          () => appendDebug(context.threadId, {
            title: 'Agent 事件解析失败',
            content: '收到了一条无法解析的本地 Agent 事件；原始内容未写入日志。',
            tone: 'error',
          }),
        );
        if (!context.terminal && runContextsByThreadIdRef.current.get(context.threadId) === context) {
          if (shouldSettleAgentStreamAsStopped(context.cancelRequested, controller.signal.aborted)) {
            settleRunWithoutTerminal(context, '已停止');
          } else {
            handleAgentRunFailure(
              context,
              `${providerName} 事件流意外结束，未收到完成结果。请检查 CLI、渠道配置或运行日志。`,
            );
          }
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
    if (event.type === 'context-compaction') {
      applyContextCompactionEvent(context.threadId, event, context.workingDirectory);
      return;
    }
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
    schedulePersistThreadHistory(context.threadId, {
      urgent:
        isAgentRunTerminalEvent(event) ||
        event.type === 'approval-request' ||
        event.type === 'request-user-input',
    });

    if (isAgentRunTerminalEvent(event)) {
      context.terminal = true;
      context.terminalAllowsQueueContinuation = event.type === 'done' && !context.cancelRequested;
      removeRunContext(context);
      emitThreadNotice(context, event.type === 'error' ? 'failed' : 'completed', event.runId);
      if (event.type === 'done' && !context.cancelRequested) {
        if (!maybeStartPendingCompaction(context)) {
          maybeStartQueuedPrompt(context);
        }
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
        void reconcileCancelledRun(context);
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
      context.cancelRequestSent = false;
      setRunInterrupting(context, false);
      updateThreadTurn(context.threadId, context.turnId, (turn) => ({
        ...turn,
        activity: '停止请求未确认，可重试停止',
      }));
    }
  }

  async function reconcileCancelledRun(context: AgentRunContext) {
    if (context.terminal || runContextsByThreadIdRef.current.get(context.threadId) !== context) {
      return;
    }
    try {
      const response = await fetch(`/api/agents/runtime/${encodeURIComponent(context.threadId)}`);
      if (!response.ok) {
        throw new Error((await readErrorResponseText(response)) || '读取 Agent 运行状态失败');
      }
      const status = await response.json() as AgentRuntimeStatus;
      const oldRunReleased = status.phase === 'absent' || (
        status.currentRunId !== context.runId && status.phase !== 'running'
      );
      if (oldRunReleased) {
        context.abortController.abort();
        settleRunWithoutTerminal(context, '已停止');
        return;
      }
      context.cancelRequestSent = false;
      setRunInterrupting(context, false);
      updateThreadTurn(context.threadId, context.turnId, (turn) => ({
        ...turn,
        activity: '仍在停止，可重试停止',
      }));
    } catch (error) {
      appendDebug(context.threadId, {
        title: 'Agent 停止状态未确认',
        content: error instanceof Error ? error.message : '读取 Agent 运行状态失败',
        tone: 'error',
      });
      context.cancelRequestSent = false;
      setRunInterrupting(context, false);
      updateThreadTurn(context.threadId, context.turnId, (turn) => ({
        ...turn,
        activity: '停止状态未确认，可重试停止',
      }));
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
    schedulePersistThreadHistory(context.threadId, { urgent: true });
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
    schedulePersistThreadHistory(context.threadId, { urgent: true });
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
    schedulePersistThreadHistory(context.threadId, { urgent: true });
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
    schedulePersistThreadHistory(context.threadId, { urgent: true });
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
    channelId,
    modelCatalog: currentModelCatalog,
    modelsLoading,
    modelsError,
    modelSelectionWarning,
    selectDraftProvider,
    handlePermissionModeSelect,
    handleModelSelect,
    handleReasoningEffortSelect,
    handleChannelSelect,
    retryModelCatalog,
    isRunning: runningThreadIds.length > 0,
    runningThreadIds,
    activeRunsByThreadId,
    activeTurnIdsByThreadId,
    clockNowMs,
    queuedPrompts,
    compactCapability,
    requestThreadCompaction,
    skipThreadCompaction,
    removeQueuedPrompt,
    recallQueuedPrompt,
    guideQueuedPrompt,
    submitPrompt,
    submitAutomationPromptToThread,
    submitRequestUserInput,
    submitApprovalDecision,
    stopRun,
  };
}

function createAgentGuideSystemItem(summary: string) {
  return {
    id: crypto.randomUUID(),
    type: 'system-command' as const,
    command: 'guide',
    title: '已引导当前运行',
    cardType: 'compact' as const,
    state: 'done' as const,
    summary: summary.trim(),
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
    return `${name} 尚未开放，当前不能用于新建任务。`;
  }
  if (provider.available !== true) {
    if (providerId === OPENAI_CODEX_PROVIDER_ID) {
      return '未检测到可由 CodeM 启动的 Codex CLI，请安装独立 CLI、检查 PATH 或设置 CODEX_CLI_PATH 后重启。';
    }
    if (providerId === OPENCODE_PROVIDER_ID) {
      return '未检测到可由 CodeM 启动的 OpenCode CLI，请安装 OpenCode、检查 PATH 或设置 OPENCODE_CLI_PATH 后重启。';
    }
    if (providerId === PI_AGENT_PROVIDER_ID) {
      return '未检测到可由 CodeM 启动的 Pi CLI，请安装 Pi、检查 Node 版本与 PATH 或设置 PI_CLI_PATH 后重启。';
    }
    if (providerId === GEMINI_CLI_PROVIDER_ID) {
      return '未检测到可由 CodeM 启动的 Gemini CLI，请安装 Gemini CLI、检查 PATH 或设置 GEMINI_CLI_PATH 后重启。';
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
          : providerId === PI_AGENT_PROVIDER_ID
            ? 'Pi'
            : providerId === GEMINI_CLI_PROVIDER_ID
              ? 'Gemini CLI'
        : providerId);
}

function agentProviderCatalogUsesChannel(providerId: string) {
  return providerId === OPENCODE_PROVIDER_ID || providerId === GEMINI_CLI_PROVIDER_ID;
}

function resolveCompactCapabilityRuntime(input: {
  thread: ThreadSummary;
  activeProjectPath?: string;
  permissionMode: PermissionMode;
  model: string;
  reasoningEffort: string;
  channelId: string;
}): CompactCapabilityRuntime | null {
  const sessionId = input.thread.sessionId.trim();
  const workingDirectory = input.thread.workingDirectory.trim() || input.activeProjectPath?.trim() || '';
  if (!sessionId || !workingDirectory) {
    return null;
  }
  return {
    threadId: input.thread.id,
    sessionId,
    workingDirectory,
    permissionMode: input.permissionMode,
    model: input.model === DEFAULT_MODEL_VALUE ? undefined : input.model,
    reasoningEffort: input.reasoningEffort || undefined,
    channelId: requestAgentChannelId(input.channelId),
  };
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
