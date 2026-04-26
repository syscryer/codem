import { useEffect, useRef, useState } from 'react';
import { DEFAULT_MODEL_VALUE, permissionMenuModes } from '../constants';
import {
  appendThinkingItem,
  appendTextItem,
  attachToolResult,
  attachToolResultDeep,
  closeDanglingTurns,
  closeTurnWithoutTerminalEvent,
  createToolStep,
  findParentToolForEvent,
  findToolResultIndex,
  findLatestToolIndex,
  formatJson,
  formatMetrics,
  getElapsedDuration,
  hasTurnVisibleOutput,
  isPermissionMode,
  mergeUsageSnapshot,
  settleRunningToolSteps,
  settleToolStopDeep,
  summarizeToolResult,
  syncToolItem,
  upsertSubagentText,
  upsertToolDelta,
  upsertToolDeltaDeep,
  upsertToolStep,
  upsertToolStepDeep,
} from '../lib/conversation';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ClaudeEvent,
  ClaudeModelInfo,
  ConversationTurn,
  DebugEvent,
  PermissionMode,
  RequestUserInputRequest,
  RuntimeEventSource,
  RuntimeRecoveryHint,
  RuntimeReconnectReason,
  RuntimeSuggestedAction,
  ToolStep,
  ThreadDetail,
  ThreadSummary,
} from '../types';

type ThreadMetadataPatch = {
  sessionId?: string;
  workingDirectory?: string;
  model?: string;
  permissionMode?: string;
};

type ActiveRunInfo = {
  active: true;
  runId: string;
  threadId: string;
  turnId?: string;
  prompt: string;
  workingDirectory: string;
  sessionId?: string;
  permissionMode: PermissionMode;
  model?: string;
  startedAtMs: number;
  eventCount: number;
  finished: boolean;
};

type ActiveRunView = {
  runId: string;
  turnId: string;
  startedAtMs: number;
};

type RunContext = {
  threadId: string;
  turnId: string;
  runId: string;
  abortController: AbortController | null;
  terminalRunId: string;
  workingDirectory: string;
  pendingAssistantText: string;
  assistantTextFrame: number | null;
  traceStartedAtMs: number;
  firstClientDeltaAtMs: number;
  firstTextApplyAtMs: number;
  model: string;
  permissionMode: PermissionMode;
};

type QueuedPrompt = {
  id: string;
  text: string;
  createdAtMs: number;
};

type UseClaudeRunArgs = {
  activeProjectId: string | null;
  activeProjectPath?: string;
  activeThreadId: string | null;
  activeThreadSummary: ThreadSummary | null;
  createThread: (projectId: string) => Promise<ThreadSummary | null>;
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
  appendRawEvent: (threadId: string, line: string) => void;
  schedulePersistThreadHistory: (threadId: string | null) => void;
  persistThreadMetadata: (threadId: string, payload: ThreadMetadataPatch) => Promise<void>;
  clearActiveTurnSelection: () => void;
};

export function useClaudeRun({
  activeProjectId,
  activeProjectPath,
  activeThreadId,
  activeThreadSummary,
  createThread,
  handlePickProjectDirectory,
  showToast,
  updateThreadDetail,
  updateThreadTurn,
  appendDebug,
  appendRawEvent,
  schedulePersistThreadHistory,
  persistThreadMetadata,
  clearActiveTurnSelection,
}: UseClaudeRunArgs) {
  const [workspace, setWorkspace] = useState('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('bypassPermissions');
  const [model, setModel] = useState(DEFAULT_MODEL_VALUE);
  const [models, setModels] = useState<string[]>([]);
  const [, setHealth] = useState<{ available: boolean; command?: string; error?: string }>({
    available: false,
  });
  const [activeRunsByThreadId, setActiveRunsByThreadId] = useState<Record<string, ActiveRunView>>({});
  const [queuedPromptsByThreadId, setQueuedPromptsByThreadId] = useState<Record<string, QueuedPrompt[]>>({});
  const [clockNowMs, setClockNowMs] = useState(Date.now());

  const runContextsByThreadIdRef = useRef(new Map<string, RunContext>());
  const runContextsByRunIdRef = useRef(new Map<string, RunContext>());
  const reconnectingThreadIdsRef = useRef(new Set<string>());
  const threadSummariesByIdRef = useRef(new Map<string, ThreadSummary>());
  const queuedPromptsByThreadIdRef = useRef<Record<string, QueuedPrompt[]>>({});
  const activeTurnIdRef = useRef('');

  const runningThreadIds = Object.keys(activeRunsByThreadId);
  const isRunning = runningThreadIds.length > 0;
  const runningThreadId = runningThreadIds[0] ?? null;
  const backendRunId = activeThreadId ? activeRunsByThreadId[activeThreadId]?.runId ?? '' : '';
  const activeThreadIsRunning = Boolean(activeThreadId && activeRunsByThreadId[activeThreadId]);
  const activeTurnIdsByThreadId = Object.fromEntries(
    Object.entries(activeRunsByThreadId).map(([threadId, run]) => [threadId, run.turnId]),
  );
  const queuedPrompts = activeThreadId ? queuedPromptsByThreadId[activeThreadId] ?? [] : [];

  useEffect(() => {
    void loadHealth();
    void loadClaudeModels();
  }, []);

  useEffect(() => {
    setModel(activeThreadSummary?.model?.trim() || DEFAULT_MODEL_VALUE);
  }, [activeThreadSummary?.id, activeThreadSummary?.model]);

  useEffect(() => {
    if (!activeThreadSummary || activeThreadIsRunning) {
      return;
    }

    void loadClaudeModels();
  }, [activeThreadSummary?.id, activeThreadIsRunning]);

  useEffect(() => {
    const nextWorkspace = activeThreadSummary?.workingDirectory || activeProjectPath || '';
    setWorkspace(nextWorkspace);
  }, [activeProjectPath, activeThreadSummary?.workingDirectory]);

  useEffect(() => {
    if (activeThreadSummary) {
      threadSummariesByIdRef.current.set(activeThreadSummary.id, activeThreadSummary);
    }
  }, [activeThreadSummary]);

  useEffect(() => {
    setPermissionMode(
      isVisiblePermissionMode(activeThreadSummary?.permissionMode)
        ? activeThreadSummary.permissionMode
        : 'bypassPermissions',
    );
  }, [activeThreadSummary?.id, activeThreadSummary?.permissionMode]);

  useEffect(() => {
    if (runningThreadIds.length === 0) {
      return undefined;
    }

    setClockNowMs(Date.now());
    const timer = window.setInterval(() => {
      setClockNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [runningThreadIds.length]);

  useEffect(() => {
    if (!activeThreadSummary || runContextsByThreadIdRef.current.has(activeThreadSummary.id)) {
      return;
    }

    void reconnectActiveRun(activeThreadSummary);
  }, [activeThreadSummary?.id]);

  useEffect(() => {
    return () => {
      for (const context of runContextsByThreadIdRef.current.values()) {
        if (context.assistantTextFrame !== null) {
          window.cancelAnimationFrame(context.assistantTextFrame);
        }
      }
    };
  }, []);

  async function loadHealth() {
    try {
      const response = await fetch('/api/health');
      const payload = (await response.json()) as { available: boolean; command?: string; error?: string };
      setHealth(payload);
    } catch (error) {
      setHealth({
        available: false,
        error: error instanceof Error ? error.message : '无法连接本地桥接服务',
      });
    }
  }

  async function loadClaudeModels() {
    try {
      const response = await fetch('/api/claude/models');
      const payload = (await response.json()) as ClaudeModelInfo;
      const nextModels = Array.isArray(payload.models) ? payload.models.filter(Boolean) : [];
      setModels(nextModels);
      setModel((current) => current || nextModels[0] || DEFAULT_MODEL_VALUE);
    } catch (error) {
      const targetThreadId = activeThreadId;
      if (!targetThreadId) {
        return;
      }

      appendDebug(targetThreadId, {
        title: '模型列表读取失败',
        content: error instanceof Error ? error.message : '无法读取 Claude Code 模型列表',
        tone: 'error',
      });
    }
  }

  async function ensureActiveThread() {
    if (activeThreadSummary) {
      return activeThreadSummary;
    }

    if (!activeProjectId) {
      await handlePickProjectDirectory();
      showToast('先添加一个项目目录，再开始新聊天。', 'info');
      return null;
    }

    try {
      return await createThread(activeProjectId);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '新建聊天失败', 'error');
      return null;
    }
  }

  function updateRunningTurn(context: RunContext, updater: (turn: ConversationTurn) => ConversationTurn) {
    if (!context.threadId || !context.turnId) {
      return;
    }

    updateThreadTurn(context.threadId, context.turnId, updater);
  }

  function registerRunContext(context: RunContext) {
    runContextsByThreadIdRef.current.set(context.threadId, context);
    if (context.runId) {
      runContextsByRunIdRef.current.set(context.runId, context);
    }
    setActiveRunsByThreadId((current) => ({
      ...current,
      [context.threadId]: {
        runId: context.runId,
        turnId: context.turnId,
        startedAtMs: context.traceStartedAtMs,
      },
    }));
    if (context.threadId === activeThreadId) {
      activeTurnIdRef.current = context.turnId;
    }
  }

  function updateRunContextRunId(context: RunContext, runId: string) {
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
        startedAtMs: context.traceStartedAtMs,
      },
    }));
  }

  function removeRunContext(context: RunContext) {
    if (context.assistantTextFrame !== null) {
      window.cancelAnimationFrame(context.assistantTextFrame);
      context.assistantTextFrame = null;
    }

    runContextsByThreadIdRef.current.delete(context.threadId);
    if (context.runId) {
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
    if (activeThreadId === context.threadId) {
      activeTurnIdRef.current = '';
      clearActiveTurnSelection();
    }
  }

  function isThreadRunning(threadId: string | null | undefined) {
    return Boolean(threadId && runContextsByThreadIdRef.current.has(threadId));
  }

  function updateQueuedPrompts(
    updater: (current: Record<string, QueuedPrompt[]>) => Record<string, QueuedPrompt[]>,
  ) {
    const next = updater(queuedPromptsByThreadIdRef.current);
    queuedPromptsByThreadIdRef.current = next;
    setQueuedPromptsByThreadId(next);
    return next;
  }

  function enqueuePrompt(thread: ThreadSummary, text: string) {
    const queuedPrompt: QueuedPrompt = {
      id: crypto.randomUUID(),
      text,
      createdAtMs: Date.now(),
    };
    threadSummariesByIdRef.current.set(thread.id, thread);
    updateQueuedPrompts((current) => ({
      ...current,
      [thread.id]: [...(current[thread.id] ?? []), queuedPrompt],
    }));
    appendDebug(thread.id, {
      title: '已排队下一轮提示',
      content: text,
    });
    return queuedPrompt;
  }

  function shiftQueuedPrompt(threadId: string) {
    const queue = queuedPromptsByThreadIdRef.current[threadId] ?? [];
    const [nextPrompt] = queue;
    if (!nextPrompt) {
      return null;
    }

    updateQueuedPrompts((current) => {
      const currentQueue = current[threadId] ?? [];
      if (currentQueue[0]?.id !== nextPrompt.id) {
        return current;
      }

      const remaining = currentQueue.slice(1);
      const next = { ...current };
      if (remaining.length) {
        next[threadId] = remaining;
      } else {
        delete next[threadId];
      }
      return next;
    });
    return nextPrompt;
  }

  function removeQueuedPrompt(promptId: string) {
    const targetThreadId = activeThreadId;
    if (!targetThreadId || !promptId) {
      return;
    }

    updateQueuedPrompts((current) => {
      const currentQueue = current[targetThreadId] ?? [];
      const nextQueue = currentQueue.filter((prompt) => prompt.id !== promptId);
      if (nextQueue.length === currentQueue.length) {
        return current;
      }

      const next = { ...current };
      if (nextQueue.length) {
        next[targetThreadId] = nextQueue;
      } else {
        delete next[targetThreadId];
      }
      return next;
    });
    appendDebug(targetThreadId, {
      title: '已取消排队提示',
      content: promptId,
    });
  }

  function maybeStartQueuedPrompt(threadId: string) {
    const nextPrompt = shiftQueuedPrompt(threadId);
    if (!nextPrompt) {
      return;
    }

    const thread = threadSummariesByIdRef.current.get(threadId);
    if (!thread) {
      updateQueuedPrompts((current) => ({
        ...current,
        [threadId]: [nextPrompt, ...(current[threadId] ?? [])],
      }));
      return;
    }

    window.setTimeout(() => {
      void startRun(thread, nextPrompt.text, {
        workingDirectory: thread.workingDirectory,
        sessionId: normalizeSessionId(thread.sessionId),
      }).then((started) => {
        if (started) {
          showToast('已发送排队提示。', 'success');
          return;
        }

        updateQueuedPrompts((current) => ({
          ...current,
          [threadId]: [nextPrompt, ...(current[threadId] ?? [])],
        }));
      });
    }, 0);
  }

  function markRunStreamProgress() {
    setClockNowMs(Date.now());
  }

  function appendRunningDebug(context: RunContext, event: Omit<DebugEvent, 'id'>) {
    appendDebug(context.threadId, event);
  }

  function appendTraceDebug(context: RunContext, name: string, atMs = Date.now(), detail?: string) {
    const startedAtMs = context.traceStartedAtMs || atMs;
    const elapsedMs = Math.max(0, atMs - startedAtMs);
    appendRunningDebug(context, {
      title: `Trace: ${name}`,
      content: detail ? `+${elapsedMs}ms\n${detail}` : `+${elapsedMs}ms`,
    });
  }

  function appendRunningRawEvent(context: RunContext, line: string) {
    appendRawEvent(context.threadId, line);
  }

  function applyAssistantTextDelta(context: RunContext, text: string) {
    updateRunningTurn(context, (turn) => ({
      ...turn,
      status: 'running',
      assistantText: `${turn.assistantText}${text}`,
      items: appendTextItem(turn.items, text),
      activity: '生成回复中',
      phase: 'computing',
    }));
  }

  function flushQueuedAssistantText(context: RunContext) {
    const text = context.pendingAssistantText;
    context.pendingAssistantText = '';
    context.assistantTextFrame = null;

    if (text) {
      applyAssistantTextDelta(context, text);
      if (!context.firstTextApplyAtMs) {
        context.firstTextApplyAtMs = Date.now();
        appendTraceDebug(context, 'client_first_text_apply', context.firstTextApplyAtMs, `${text.length} chars`);
      }
    }
  }

  function flushQueuedAssistantTextNow(context: RunContext) {
    if (context.assistantTextFrame !== null) {
      window.cancelAnimationFrame(context.assistantTextFrame);
      context.assistantTextFrame = null;
    }

    flushQueuedAssistantText(context);
  }

  function queueAssistantTextDelta(context: RunContext, text: string) {
    context.pendingAssistantText += text;

    if (context.assistantTextFrame !== null) {
      return;
    }

    context.assistantTextFrame = window.requestAnimationFrame(() => flushQueuedAssistantText(context));
  }

  async function startRun(
    thread: ThreadSummary,
    promptText: string,
    options?: {
      workingDirectory?: string;
      sessionId?: string;
      permissionModeOverride?: PermissionMode;
      toolResult?: {
        requestId: string;
        content: string;
        isError?: boolean;
      };
      onStarted?: () => void;
    },
  ) {
    const trimmedPrompt = promptText.trim();
    if (!trimmedPrompt || isThreadRunning(thread.id)) {
      return false;
    }

    const runWorkingDirectory =
      options?.workingDirectory?.trim() || thread.workingDirectory;
    const runSessionId =
      options?.sessionId && options.sessionId.trim() ? options.sessionId.trim() : undefined;
    const runPermissionMode = options?.permissionModeOverride ?? permissionMode;
    const runModel = model;
    const submitAtMs = Date.now();
    const turnId = crypto.randomUUID();
    const context: RunContext = {
      threadId: thread.id,
      turnId,
      runId: '',
      abortController: null,
      terminalRunId: '',
      workingDirectory: runWorkingDirectory,
      pendingAssistantText: '',
      assistantTextFrame: null,
      traceStartedAtMs: submitAtMs,
      firstClientDeltaAtMs: 0,
      firstTextApplyAtMs: 0,
      model: runModel,
      permissionMode: runPermissionMode,
    };
    registerRunContext(context);
    options?.onStarted?.();
    updateThreadDetail(
      thread.id,
      (existing) => ({
        ...existing,
        turns: [
          ...closeDanglingTurns(existing.turns),
          {
            id: turnId,
            userText: trimmedPrompt,
            workspace: runWorkingDirectory,
            assistantText: '',
            tools: [],
            items: [],
            status: 'pending',
            activity: '等待 Claude 响应',
            phase: 'requesting',
            startedAtMs: Date.now(),
            pendingUserInputRequests: [],
            pendingApprovalRequests: [],
          },
        ],
      }),
      thread,
    );

    const controller = new AbortController();
    context.abortController = controller;

    try {
      appendTraceDebug(context, 'client_submit', submitAtMs, `${trimmedPrompt.length} chars`);
      appendTraceDebug(context, 'fetch_start');
      const response = await fetch('/api/claude/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          threadId: thread.id,
          turnId,
          prompt: trimmedPrompt,
          workingDirectory: runWorkingDirectory,
          permissionMode: runPermissionMode,
          model: runModel === DEFAULT_MODEL_VALUE ? undefined : runModel,
          sessionId: runSessionId,
          toolResult: options?.toolResult,
          clientSubmitAtMs: submitAtMs,
        }),
        signal: controller.signal,
      });
      appendTraceDebug(context, 'response_headers');

      if (!response.ok || !response.body) {
        const message = await response.text();
        updateRunningTurn(context, (turn) => ({
          ...turn,
          status: 'error',
          durationMs: turn.durationMs ?? getElapsedDuration(turn),
          activity: message || '后端没有返回可读流。',
        }));
        schedulePersistThreadHistory(context.threadId);
        return true;
      }

      const sawTerminalEvent = await consumeClaudeEventStream(response, context);

      if (!sawTerminalEvent) {
        flushQueuedAssistantTextNow(context);
        updateRunningTurn(context, closeTurnAfterUnexpectedStreamEnd);
        schedulePersistThreadHistory(context.threadId);
      }
    } catch (error) {
      flushQueuedAssistantTextNow(context);
      updateRunningTurn(context, (turn) => ({
        ...turn,
        ...settleRunningToolSteps(turn, error instanceof DOMException && error.name === 'AbortError' ? 'done' : 'error'),
        status: error instanceof DOMException && error.name === 'AbortError' ? 'stopped' : 'error',
        durationMs: turn.durationMs ?? getElapsedDuration(turn),
        activity:
          error instanceof DOMException && error.name === 'AbortError'
            ? '已停止当前运行'
            : formatRuntimeErrorActivity(
                error instanceof Error ? error.message : '未知错误',
                turn.recoveryHint ??
                  createRuntimeRecoveryHint(error instanceof Error ? error.message : '未知错误', 'process') ??
                  undefined,
              ),
      }));
      schedulePersistThreadHistory(context.threadId);
    } finally {
      context.abortController = null;
      removeRunContext(context);
    }

    return true;
  }

  async function reconnectActiveRun(thread: ThreadSummary) {
    if (reconnectingThreadIdsRef.current.has(thread.id) || runContextsByThreadIdRef.current.has(thread.id)) {
      return;
    }

    reconnectingThreadIdsRef.current.add(thread.id);
    let context: RunContext | null = null;
    let retainContext = false;
    try {
      const activeResponse = await fetch(`/api/claude/runs/active/${encodeURIComponent(thread.id)}`);
      if (activeResponse.status === 404) {
        return;
      }
      if (!activeResponse.ok) {
        return;
      }

      const activeRun = (await activeResponse.json()) as ActiveRunInfo | { active: false };
      if (!activeRun.active || !activeRun.turnId) {
        return;
      }

      const startedAtMs = activeRun.startedAtMs || Date.now();
      context = {
        threadId: thread.id,
        turnId: activeRun.turnId,
        runId: activeRun.runId,
        abortController: null,
        terminalRunId: '',
        workingDirectory: activeRun.workingDirectory || thread.workingDirectory,
        pendingAssistantText: '',
        assistantTextFrame: null,
        traceStartedAtMs: startedAtMs,
        firstClientDeltaAtMs: 0,
        firstTextApplyAtMs: 0,
        model: activeRun.model || model,
        permissionMode: activeRun.permissionMode || permissionMode,
      };
      registerRunContext(context);

      updateThreadDetail(thread.id, (existing) => {
        const replayTurn: ConversationTurn = {
          id: activeRun.turnId ?? crypto.randomUUID(),
          backendRunId: activeRun.runId,
          userText: activeRun.prompt,
          workspace: activeRun.workingDirectory || thread.workingDirectory,
          assistantText: '',
          tools: [],
          items: [],
          status: 'running',
          activity: activeRun.finished ? '同步后台输出' : '重新连接 Claude 输出',
          phase: activeRun.finished ? 'computing' : 'requesting',
          startedAtMs,
          sessionId: activeRun.sessionId,
          pendingUserInputRequests: [],
          pendingApprovalRequests: [],
        };
        const turns = existing.turns.some((turn) => turn.id === replayTurn.id)
          ? existing.turns.map((turn) => (turn.id === replayTurn.id ? replayTurn : turn))
          : [...closeDanglingTurns(existing.turns), replayTurn];

        return {
          ...existing,
          turns,
        };
      }, thread);
      appendDebug(thread.id, {
        title: '已重新连接后台运行',
        content: `${activeRun.runId}\n${activeRun.eventCount} buffered events`,
      });

      const eventsResponse = await fetch(`/api/claude/run/${encodeURIComponent(activeRun.runId)}/events?after=0`);
      if (!eventsResponse.ok || !eventsResponse.body) {
        showToast('后台运行仍在，但事件流重连失败。', 'error');
        retainContext = true;
        return;
      }

      const sawTerminalEvent = await consumeClaudeEventStream(eventsResponse, context);
      if (!sawTerminalEvent && !activeRun.finished) {
        flushQueuedAssistantTextNow(context);
        updateRunningTurn(context, (turn) => ({
          ...turn,
          activity: '后台运行仍在，事件流暂时断开',
        }));
        retainContext = true;
      }

      if (sawTerminalEvent || activeRun.finished) {
        await fetch(`/api/claude/run/${encodeURIComponent(activeRun.runId)}/ack`, {
          method: 'POST',
        }).catch(() => undefined);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '后台运行重连失败', 'error');
    } finally {
      reconnectingThreadIdsRef.current.delete(thread.id);
      if (context && !retainContext) {
        removeRunContext(context);
      }
    }
  }

  async function consumeClaudeEventStream(response: Response, context: RunContext) {
    if (!response.body) {
      return false;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sawTerminalEvent = false;
    let completedSuccessfully = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const eventPayload = handleStreamLine(line, context);
        if (eventPayload?.type === 'done' || eventPayload?.type === 'error') {
          sawTerminalEvent = true;
          completedSuccessfully = eventPayload.type === 'done';
        }
      }
    }

    if (buffer.trim()) {
      const eventPayload = handleStreamLine(buffer, context);
      if (eventPayload?.type === 'done' || eventPayload?.type === 'error') {
        sawTerminalEvent = true;
        completedSuccessfully = eventPayload.type === 'done';
      }
    }

    if (completedSuccessfully) {
      maybeStartQueuedPrompt(context.threadId);
    }

    return sawTerminalEvent;
  }

  function handleStreamLine(line: string, context: RunContext) {
    if (!line.trim()) {
      return null;
    }

    markRunStreamProgress();
    appendRunningRawEvent(context, line);

    try {
      const eventPayload = JSON.parse(line) as ClaudeEvent;
      handleClaudeEvent(eventPayload, context);
      return eventPayload;
    } catch (error) {
      appendRunningDebug(context, {
        title: '事件解析失败',
        content: error instanceof Error ? error.message : '无法解析后端事件',
        tone: 'error',
      });
      return null;
    }
  }

  function handleClaudeEvent(event: ClaudeEvent, context: RunContext) {
    const eventRunId = 'runId' in event ? event.runId : '';
    if (eventRunId && context.terminalRunId === eventRunId) {
      return;
    }

    if (
      event.type === 'request-user-input' ||
      event.type === 'approval-request' ||
      event.type === 'runtime-reconnect-hint' ||
      event.type === 'retryable-error' ||
      event.type === 'thinking-delta' ||
      event.type === 'tool-start' ||
      event.type === 'tool-input-delta' ||
      event.type === 'tool-stop' ||
      event.type === 'tool-result' ||
      event.type === 'done' ||
      event.type === 'error'
    ) {
      flushQueuedAssistantTextNow(context);
    }

    if ('runId' in event && event.runId) {
      updateRunContextRunId(context, event.runId);
      updateRunningTurn(context, (turn) => ({
        ...turn,
        backendRunId: event.runId,
        status: turn.status === 'pending' ? 'running' : turn.status,
      }));
    }

    if (event.type === 'trace') {
      appendRunningDebug(context, {
        title: `Trace: ${event.name}`,
        content: event.detail ? `+${event.elapsedMs}ms\n${event.detail}` : `+${event.elapsedMs}ms`,
      });
      return;
    }

    if (event.type === 'raw') {
      appendRunningDebug(context, {
        title: 'Raw Event',
        content: formatJson(event.raw),
      });
      return;
    }

    if (event.type === 'status') {
      updateRunningTurn(context, (turn) => ({
        ...turn,
        status: 'running',
        activity: event.message.includes('已接收用户消息') ? 'Claude Code 已接收用户消息' : 'Claude Code 已启动',
        phase: 'requesting',
      }));
      appendRunningDebug(context, {
        title: '启动运行',
        content: event.message,
      });
      return;
    }

    if (event.type === 'phase') {
      updateRunningTurn(context, (turn) => ({
        ...turn,
        status: turn.status === 'pending' ? 'running' : turn.status,
        phase: event.phase,
        activity: event.label,
        thoughtCount: event.thoughtCount ?? turn.thoughtCount,
      }));
      return;
    }

    if (event.type === 'usage') {
      updateRunningTurn(context, (turn) => ({
        ...turn,
        ...mergeUsageSnapshot(turn, event),
      }));
      return;
    }

    if (event.type === 'session') {
      updateRunningTurn(context, (turn) => ({
        ...turn,
        sessionId: event.sessionId,
      }));
      void persistThreadMetadata(context.threadId, { sessionId: event.sessionId });
      appendRunningDebug(context, {
        title: 'Session 已绑定',
        content: event.sessionId,
      });
      return;
    }

    if (event.type === 'claude-event') {
      if (event.status === 'requesting') {
        updateRunningTurn(context, (turn) => ({
          ...turn,
          activity: '等待 Claude 响应',
        }));
      }

      appendRunningDebug(context, {
        title: event.label,
        content: formatJson(event.raw),
      });
      return;
    }

    if (event.type === 'request-user-input') {
      updateRunningTurn(context, (turn) => ({
        ...turn,
        status: turn.status === 'pending' ? 'running' : turn.status,
        activity: event.request.title || '等待补充输入',
        pendingUserInputRequests: upsertRequestUserInput(turn.pendingUserInputRequests, event.request),
      }));
      schedulePersistThreadHistory(context.threadId);
      appendRunningDebug(context, {
        title: '请求用户输入',
        content: formatJson(event.request),
      });
      return;
    }

    if (event.type === 'approval-request') {
      updateRunningTurn(context, (turn) => ({
        ...turn,
        status: turn.status === 'pending' ? 'running' : turn.status,
        activity: event.request.title || '等待批准',
        pendingApprovalRequests: upsertApprovalRequest(turn.pendingApprovalRequests, event.request),
      }));
      schedulePersistThreadHistory(context.threadId);
      appendRunningDebug(context, {
        title: '批准请求',
        content: formatJson(event.request),
      });
      return;
    }

    if (event.type === 'runtime-reconnect-hint') {
      updateRunningTurn(context, (turn) => ({
        ...turn,
        recoveryHint: event.hint,
      }));
      appendRunningDebug(context, {
        title: '运行恢复提示',
        content: formatRuntimeRecoveryHintDebug(event.hint),
        tone: 'error',
      });
      return;
    }

    if (event.type === 'retryable-error') {
      updateRunningTurn(context, (turn) => ({
        ...turn,
        recoveryHint: event.hint,
      }));
      appendRunningDebug(context, {
        title: '可恢复错误',
        content: formatRuntimeRecoveryHintDebug(event.hint),
        tone: 'error',
      });
      return;
    }

    if (event.type === 'delta') {
      if (!context.firstClientDeltaAtMs) {
        context.firstClientDeltaAtMs = Date.now();
        appendTraceDebug(context, 'client_first_delta_received', context.firstClientDeltaAtMs, `${event.text.length} chars`);
      }
      queueAssistantTextDelta(context, event.text);
      return;
    }

    if (event.type === 'thinking-delta') {
      updateRunningTurn(context, (turn) => {
        const toolIsRunning = hasRunningTool(turn);
        return {
          ...turn,
          status: 'running',
          activity: toolIsRunning ? turn.activity : '思考中',
          phase: toolIsRunning ? turn.phase : 'thinking',
          items: appendThinkingItem(turn.items, event.text),
        };
      });
      return;
    }

    if (event.type === 'tool-start') {
      updateRunningTurn(context, (turn) => {
        const step = createToolStep(event);
        const tools = event.parentToolUseId ? upsertToolStepDeep(turn.tools, step) : upsertToolStep(turn.tools, step);
        const visibleTool = event.parentToolUseId ? findParentToolForEvent(tools, event) : step;
        return {
          ...turn,
          status: 'running',
          activity: event.isSidechain ? turn.activity : step.title,
          phase: 'tool',
          tools,
          items: visibleTool ? syncToolItem(turn.items, visibleTool) : turn.items,
        };
      });
      return;
    }

    if (event.type === 'tool-input-delta') {
      updateRunningTurn(context, (turn) => {
        const tools = event.parentToolUseId ? upsertToolDeltaDeep(turn.tools, event) : upsertToolDelta(turn.tools, event);
        const toolIndex = event.parentToolUseId ? -1 : findLatestToolIndex(tools, event.blockIndex, event.toolUseId);
        const tool = event.parentToolUseId
          ? findParentToolForEvent(tools, event)
          : toolIndex >= 0
            ? tools[toolIndex]
            : undefined;
        return {
          ...turn,
          phase: 'tool',
          tools,
          items: tool ? syncToolItem(turn.items, tool) : turn.items,
        };
      });
      return;
    }

    if (event.type === 'tool-stop') {
      updateRunningTurn(context, (turn) => {
        const tools = settleToolStopDeep(turn.tools, event);
        const index = event.parentToolUseId ? -1 : findLatestToolIndex(tools, event.blockIndex, event.toolUseId);
        const tool = event.parentToolUseId
          ? findParentToolForEvent(tools, event)
          : index >= 0
            ? tools[index]
            : undefined;
        return {
          ...turn,
          tools,
          items: tool ? syncToolItem(turn.items, tool) : turn.items,
        };
      });
      return;
    }

    if (event.type === 'tool-result') {
      updateRunningTurn(context, (turn) => {
        const toolIndex = event.parentToolUseId ? -1 : findToolResultIndex(turn.tools, event);
        const tools = event.parentToolUseId ? attachToolResultDeep(turn.tools, event) : attachToolResult(turn.tools, event);
        const tool =
          event.parentToolUseId
            ? findParentToolForEvent(tools, event)
            : toolIndex >= 0
            ? tools[toolIndex]
            : tools.find((item) => item.toolUseId && item.toolUseId === event.toolUseId);
        const approvalRequest = event.parentToolUseId ? null : createApprovalRequestFromToolResult(tool, event);
        return {
          ...turn,
          activity: event.isSidechain ? turn.activity : summarizeToolResult(event),
          phase: event.isError ? turn.phase : event.isSidechain ? turn.phase : 'computing',
          tools,
          items: tool ? syncToolItem(turn.items, tool) : turn.items,
          pendingApprovalRequests: approvalRequest
            ? upsertApprovalRequest(turn.pendingApprovalRequests, approvalRequest)
            : turn.pendingApprovalRequests,
        };
      });
      schedulePersistThreadHistory(context.threadId);
      return;
    }

    if (event.type === 'subagent-delta') {
      updateRunningTurn(context, (turn) => {
        const tools = upsertSubagentText(turn.tools, event.parentToolUseId, event.text);
        const parentTool = findParentToolForEvent(tools, event);
        return {
          ...turn,
          tools,
          items: parentTool ? syncToolItem(turn.items, parentTool) : turn.items,
        };
      });
      return;
    }

    if (event.type === 'assistant-snapshot') {
      appendRunningDebug(context, {
        title: `Assistant Message Snapshot (${event.blocks.length} blocks)`,
        content: formatJson(event.blocks),
      });
      return;
    }

    if (event.type === 'stderr') {
      appendRunningDebug(context, {
        title: 'stderr',
        content: event.text,
        tone: 'error',
      });
      return;
    }

    if (event.type === 'error') {
      context.terminalRunId = event.runId;
      updateRunningTurn(context, (turn) => ({
        ...turn,
        ...settleRunningToolSteps(turn, 'error'),
        status: 'error',
        durationMs: turn.durationMs ?? getElapsedDuration(turn),
        activity: formatRuntimeErrorActivity(event.message, turn.recoveryHint),
      }));
      appendRunningDebug(context, {
        title: 'Claude 运行异常',
        content: event.message,
        tone: 'error',
      });
      schedulePersistThreadHistory(context.threadId);
      return;
    }

    if (event.type === 'done') {
      context.terminalRunId = event.runId;
      updateRunningTurn(context, (turn) => {
        if (turn.status === 'error' || turn.status === 'stopped') {
          return turn;
        }

        const assistantText = turn.assistantText.trim()
          ? turn.assistantText
          : event.result.trim()
            ? event.result
            : turn.assistantText;
        const nextTurn = {
          ...turn,
          ...settleRunningToolSteps(turn, 'done'),
          assistantText,
          items: turn.items.length > 0 || !event.result.trim() ? turn.items : appendTextItem(turn.items, event.result),
          activity: '运行完成',
          phase: undefined,
          metrics: formatMetrics(event, turn.tools.length),
          sessionId: event.sessionId ?? turn.sessionId,
          durationMs: event.durationMs ?? turn.durationMs ?? getElapsedDuration(turn),
          totalCostUsd: event.totalCostUsd ?? turn.totalCostUsd,
          recoveryHint: undefined,
          ...mergeUsageSnapshot(turn, event),
        };

        if (!hasTurnVisibleOutput(nextTurn)) {
          return {
            ...nextTurn,
            status: 'stopped',
            activity: '运行结束但没有返回正文',
          };
        }

        return {
          ...nextTurn,
          status: 'done',
        };
      });
      if (context.threadId) {
        void persistThreadMetadata(context.threadId, {
          sessionId: event.sessionId,
          model: context.model === DEFAULT_MODEL_VALUE ? undefined : context.model,
          permissionMode: context.permissionMode,
          workingDirectory: context.workingDirectory,
        });
      }
      schedulePersistThreadHistory(context.threadId);
    }
  }

  async function submitPrompt(promptText: string) {
    const trimmedPrompt = promptText.trim();
    if (!trimmedPrompt) {
      return false;
    }

    const thread = await ensureActiveThread();
    if (!thread) {
      return false;
    }

    if (isThreadRunning(thread.id)) {
      enqueuePrompt(thread, trimmedPrompt);
      showToast('已排队，当前运行完成后会继续发送。', 'success');
      return true;
    }

    return startRun(thread, trimmedPrompt, {
      workingDirectory: workspace.trim() || thread.workingDirectory,
      sessionId: normalizeSessionId(thread.sessionId),
    });
  }

  function handlePermissionModeSelect(mode: PermissionMode) {
    setPermissionMode(mode);

    if (activeThreadId) {
      void persistThreadMetadata(activeThreadId, { permissionMode: mode });
    }
  }

  async function stopRun(threadId = activeThreadId ?? undefined) {
    const context = threadId ? runContextsByThreadIdRef.current.get(threadId) : undefined;
    if (!context) {
      return;
    }

    const hadLocalStream = Boolean(context.abortController);
    context.abortController?.abort();
    const currentRunId = context.runId;

    if (!currentRunId) {
      flushQueuedAssistantTextNow(context);
      updateRunningTurn(context, closeTurnWithoutTerminalEvent);
      schedulePersistThreadHistory(context.threadId);
      removeRunContext(context);
      return;
    }

    try {
      await fetch(`/api/claude/run/${currentRunId}`, {
        method: 'DELETE',
      });
    } catch {
      appendRunningDebug(context, {
        title: '取消请求未确认',
        content: '前端已停止等待，但后端取消请求未确认完成。',
        tone: 'error',
      });
    } finally {
      if (!hadLocalStream) {
        flushQueuedAssistantTextNow(context);
        updateRunningTurn(context, (turn) => ({
          ...turn,
          ...settleRunningToolSteps(turn, 'done'),
          status: 'stopped',
          phase: undefined,
          durationMs: turn.durationMs ?? getElapsedDuration(turn),
          activity: '已停止当前运行',
        }));
        schedulePersistThreadHistory(context.threadId);
        removeRunContext(context);
      }
    }
  }

  async function submitRequestUserInput(
    turn: ConversationTurn,
    request: RequestUserInputRequest,
    answers: Record<string, string>,
  ) {
    if (!activeThreadId || !activeThreadSummary || activeThreadSummary.id !== activeThreadId) {
      showToast('当前线程状态不可用，请重新选择聊天后重试。', 'error');
      return false;
    }

    const promptText = buildRequestUserInputPrompt(request, answers);
    if (!promptText) {
      showToast('请先填写至少一项有效回答。', 'info');
      return false;
    }

    if (isThreadRunning(activeThreadId)) {
      const runId =
        runContextsByThreadIdRef.current.get(activeThreadId)?.runId ||
        turn.backendRunId ||
        activeRunsByThreadId[activeThreadId]?.runId ||
        '';
      if (!runId || !request.requestId) {
        showToast('当前提问还没有可提交的运行标识，请稍后重试。', 'info');
        return false;
      }

      const response = await fetch(`/api/claude/run/${encodeURIComponent(runId)}/request-user-input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: request.requestId,
          answers,
        }),
      });

      if (!response.ok) {
        const message = await readErrorResponseText(response);
        showToast(message || '提交补充信息失败。', 'error');
        return false;
      }

      updateThreadTurn(activeThreadId, turn.id, (currentTurn) => ({
        ...currentTurn,
        pendingUserInputRequests: markPendingUserInputRequestSubmitted(
          currentTurn.pendingUserInputRequests,
          request,
          answers,
        ),
      }));
      appendDebug(activeThreadId, {
        title: '已提交运行中提问答案',
        content: formatJson({ requestId: request.requestId, answers }),
      });
      schedulePersistThreadHistory(activeThreadId);
      showToast('已回答 Claude 的提问。', 'success');
      return true;
    }

    const started = await startRun(activeThreadSummary, promptText, {
      workingDirectory: turn.workspace.trim() || activeThreadSummary.workingDirectory,
      sessionId: normalizeSessionId(turn.sessionId) || normalizeSessionId(activeThreadSummary.sessionId),
    });

    if (!started) {
      return false;
    }

    updateThreadTurn(activeThreadId, turn.id, (currentTurn) => ({
      ...currentTurn,
      pendingUserInputRequests: markPendingUserInputRequestSubmitted(
        currentTurn.pendingUserInputRequests,
        request,
        answers,
      ),
    }));
    appendDebug(activeThreadId, {
      title: '已提交补充输入',
      content: formatJson({ requestId: request.requestId, answers }),
    });
    schedulePersistThreadHistory(activeThreadId);
    showToast('已将补充信息作为续聊提交。', 'success');
    return true;
  }

  async function submitRuntimeRecoveryAction(
    turn: ConversationTurn,
    action: RuntimeSuggestedAction,
  ) {
    if (!activeThreadId || !activeThreadSummary || activeThreadSummary.id !== activeThreadId) {
      showToast('当前线程状态不可用，请重新选择聊天后重试。', 'error');
      return false;
    }

    if (isThreadRunning(activeThreadId)) {
      showToast('当前聊天正在运行，请等待结束或先停止。', 'info');
      return false;
    }

    const promptText = turn.userText.trim();
    if (!promptText) {
      showToast('当前 turn 没有可重试的用户输入。', 'error');
      return false;
    }

    const sessionId =
      action === 'retry'
        ? normalizeSessionId(turn.sessionId) || normalizeSessionId(activeThreadSummary.sessionId)
        : undefined;
    const started = await startRun(activeThreadSummary, promptText, {
      workingDirectory: turn.workspace.trim() || activeThreadSummary.workingDirectory,
      sessionId,
    });

    if (!started) {
      return false;
    }

    updateThreadTurn(activeThreadId, turn.id, (currentTurn) => ({
      ...currentTurn,
      recoveryHint: undefined,
    }));
    appendDebug(activeThreadId, {
      title: '已触发恢复动作',
      content: formatJson({
        action,
        turnId: turn.id,
        reusedSessionId: sessionId ?? null,
      }),
    });
    schedulePersistThreadHistory(activeThreadId);
    showToast(getRecoveryToastMessage(action), 'success');
    return true;
  }

  async function submitApprovalDecision(
    turn: ConversationTurn,
    request: ApprovalRequest,
    decision: ApprovalDecision,
  ) {
    if (!activeThreadId || !activeThreadSummary || activeThreadSummary.id !== activeThreadId) {
      showToast('当前线程状态不可用，请重新选择聊天后重试。', 'error');
      return false;
    }

    const threadId = activeThreadId;
    const promptText = buildApprovalDecisionPrompt(request, decision);
    const toolResultContent = buildApprovalDecisionToolResultContent(request, decision);

    if (isThreadRunning(activeThreadId)) {
      const runId =
        runContextsByThreadIdRef.current.get(activeThreadId)?.runId ||
        turn.backendRunId ||
        activeRunsByThreadId[activeThreadId]?.runId ||
        '';
      if (!runId || !request.requestId) {
        showToast('当前批准请求还没有可提交的运行标识，请稍后重试。', 'info');
        return false;
      }

      const response = await fetch(`/api/claude/run/${encodeURIComponent(runId)}/approval-decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: request.requestId,
          decision,
          content: toolResultContent,
        }),
      });

      if (!response.ok) {
        const message = await readErrorResponseText(response);
        showToast(message || '提交批准结果失败。', 'error');
        return false;
      }

      updateThreadTurn(threadId, turn.id, (currentTurn) => ({
        ...currentTurn,
        activity: decision === 'approve' ? '继续执行中' : '等待 Claude 调整计划',
        phase: 'requesting',
        pendingApprovalRequests: removePendingApprovalRequest(currentTurn.pendingApprovalRequests, request),
      }));
      appendDebug(threadId, {
        title: decision === 'approve' ? '已批准请求' : '已拒绝请求',
        content: formatJson({
          requestId: request.requestId,
          title: request.title,
          decision,
          command: request.command,
          mode: 'stdin_tool_result',
        }),
      });
      schedulePersistThreadHistory(threadId);
      showToast(decision === 'approve' ? '已批准并继续任务。' : '已拒绝该操作并继续任务。', 'success');
      return true;
    }

    void startRun(activeThreadSummary, promptText, {
      workingDirectory: turn.workspace.trim() || activeThreadSummary.workingDirectory,
      sessionId: normalizeSessionId(turn.sessionId) || normalizeSessionId(activeThreadSummary.sessionId),
      permissionModeOverride: decision === 'approve' && !isPlanApprovalRequest(request) ? 'bypassPermissions' : undefined,
      toolResult: request.requestId
        ? {
            requestId: request.requestId,
            content: toolResultContent,
            isError: decision === 'reject',
          }
        : undefined,
      onStarted: () => {
        updateThreadTurn(threadId, turn.id, (currentTurn) => ({
          ...currentTurn,
          pendingApprovalRequests: removePendingApprovalRequest(currentTurn.pendingApprovalRequests, request),
        }));
        appendDebug(threadId, {
          title: decision === 'approve' ? '已批准请求' : '已拒绝请求',
          content: formatJson({
            requestId: request.requestId,
            title: request.title,
            decision,
            command: request.command,
          }),
        });
        schedulePersistThreadHistory(threadId);
      },
    });

    showToast(decision === 'approve' ? '已批准并继续任务。' : '已拒绝该操作并继续任务。', 'success');
    return true;
  }

  return {
    workspace,
    permissionMode,
    model,
    models,
    backendRunId,
    isRunning,
    runningThreadId,
    runningThreadIds,
    activeRunsByThreadId,
    activeTurnIdsByThreadId,
    queuedPrompts,
    clockNowMs,
    activeTurnIdRef,
    setWorkspace,
    setPermissionMode,
    setModel,
    handlePermissionModeSelect,
    submitPrompt,
    removeQueuedPrompt,
    submitRequestUserInput,
    submitRuntimeRecoveryAction,
    submitApprovalDecision,
    stopRun,
  };
}

function upsertRequestUserInput(
  requests: RequestUserInputRequest[] | undefined,
  request: RequestUserInputRequest,
) {
  const current = requests ?? [];
  if (!request.requestId) {
    return [...current, request];
  }

  const index = current.findIndex((item) => item.requestId === request.requestId);
  if (index === -1) {
    return [...current, request];
  }

  const next = [...current];
  next[index] = {
    ...request,
    submittedAnswers: current[index].submittedAnswers,
    submittedAtMs: current[index].submittedAtMs,
  };
  return next;
}

function markPendingUserInputRequestSubmitted(
  requests: RequestUserInputRequest[] | undefined,
  request: RequestUserInputRequest,
  answers: Record<string, string>,
) {
  const current = requests ?? [];
  const submittedRequest = {
    ...request,
    submittedAnswers: answers,
    submittedAtMs: Date.now(),
  };

  if (!request.requestId) {
    const targetSignature = JSON.stringify({
      title: request.title,
      description: request.description,
      questions: request.questions,
    });
    const index = current.findIndex((item) => {
      const itemSignature = JSON.stringify({
        title: item.title,
        description: item.description,
        questions: item.questions,
      });
      return itemSignature === targetSignature;
    });
    if (index === -1) {
      return [...current, submittedRequest];
    }

    const next = [...current];
    next[index] = {
      ...next[index],
      submittedAnswers: answers,
      submittedAtMs: submittedRequest.submittedAtMs,
    };
    return next;
  }

  const index = current.findIndex((item) => item.requestId === request.requestId);
  if (index === -1) {
    return [...current, submittedRequest];
  }

  const next = [...current];
  next[index] = {
    ...next[index],
    submittedAnswers: answers,
    submittedAtMs: submittedRequest.submittedAtMs,
  };
  return next;
}

function upsertApprovalRequest(
  requests: ApprovalRequest[] | undefined,
  request: ApprovalRequest,
) {
  const current = requests ?? [];
  const signature = getApprovalRequestSignature(request);
  const index = current.findIndex(
    (item) =>
      (request.requestId && item.requestId === request.requestId) ||
      getApprovalRequestSignature(item) === signature,
  );
  if (index === -1) {
    return [...current, request];
  }

  const next = [...current];
  next[index] = {
    ...next[index],
    ...request,
  };
  return next;
}

function removePendingApprovalRequest(
  requests: ApprovalRequest[] | undefined,
  request: ApprovalRequest,
) {
  const current = requests ?? [];
  const targetSignature = getApprovalRequestSignature(request);
  return current.filter(
    (item) =>
      !(
        (request.requestId && item.requestId === request.requestId) ||
        getApprovalRequestSignature(item) === targetSignature
      ),
  );
}

function hasRunningTool(turn: ConversationTurn) {
  return turn.tools.some((tool) => tool.status === 'running');
}

function getApprovalRequestSignature(request: ApprovalRequest) {
  return JSON.stringify({
    title: request.title,
    description: request.description,
    command: request.command ?? [],
    danger: request.danger,
  });
}

function createApprovalRequestFromToolResult(
  tool: ToolStep | undefined,
  event: Extract<ClaudeEvent, { type: 'tool-result' }>,
): ApprovalRequest | null {
  if (!event.isError || !isApprovalRequiredToolResult(event.content)) {
    return null;
  }

  const command = extractCommandFromTool(tool);
  const blockedBySecurityPolicy = isSecurityPolicyBlockedToolResult(event.content);

  return {
    requestId: tool?.toolUseId ?? event.toolUseId ?? tool?.id,
    title: blockedBySecurityPolicy ? '访问被安全策略拦截' : '工具调用需要你确认',
    description: blockedBySecurityPolicy
      ? '当前会话的访问范围不足。批准后会以完全访问模式继续执行。'
      : command?.length
        ? '当前会话未放行这一步。批准后会以完全访问模式继续执行该命令。'
        : 'Claude 返回该操作需要批准后才能继续。批准后会以完全访问模式继续执行。',
    command,
    danger: normalizeApprovalDanger(tool, command),
  };
}

function isApprovalRequiredToolResult(content: string) {
  const normalized = content.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('this command requires approval') ||
    normalized.includes('requires approval') ||
    normalized.includes('requires your approval') ||
    normalized.includes('approval required') ||
    isSecurityPolicyBlockedToolResult(normalized)
  );
}

function isSecurityPolicyBlockedToolResult(content: string) {
  const normalized = content.trim().toLowerCase();
  return Boolean(
    normalized &&
      normalized.includes('was blocked') &&
      normalized.includes('for security') &&
      normalized.includes('claude code'),
  );
}

function extractCommandFromTool(tool?: ToolStep) {
  if (!tool?.inputText?.trim()) {
    return undefined;
  }

  try {
    const payload = JSON.parse(tool.inputText) as Record<string, unknown>;
    const directCommand = normalizeApprovalCommandInput(
      payload.command ?? payload.cmd ?? payload.cmdString ?? payload.argv ?? payload.args,
    );
    if (directCommand?.length) {
      return directCommand;
    }
  } catch {
    // Ignore malformed tool input and fall back to the summarized title below.
  }

  const bashMatch = tool.title.match(/^Bash\(([\s\S]+)\)$/);
  if (bashMatch?.[1]?.trim()) {
    return [bashMatch[1].trim()];
  }

  return undefined;
}

function normalizeApprovalCommandInput(value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const command = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);

  return command.length > 0 ? command : undefined;
}

function normalizeApprovalDanger(
  tool: ToolStep | undefined,
  command: string[] | undefined,
): ApprovalRequest['danger'] {
  if (tool?.name === 'Bash' || command?.length) {
    return 'medium';
  }

  return 'low';
}

function createRuntimeRecoveryHint(
  message: string,
  source: RuntimeEventSource,
): RuntimeRecoveryHint | null {
  const normalized = message.trim();
  if (!normalized) {
    return null;
  }

  const lower = normalized.toLowerCase();
  let reason: RuntimeReconnectReason | null = null;
  if (lower.includes('broken pipe') || lower.includes('epipe')) {
    reason = 'broken-pipe';
  } else if (
    lower.includes('socket hang up') ||
    lower.includes('connection reset') ||
    lower.includes('stream closed') ||
    lower.includes('network error')
  ) {
    reason = 'transport-error';
  } else if (
    lower.includes('runtime ended') ||
    lower.includes('unexpected eof') ||
    lower.includes(' has ended') ||
    lower === 'eof'
  ) {
    reason = 'runtime-ended';
  } else if (
    lower.includes('stale') ||
    lower.includes('session expired') ||
    lower.includes('thread expired')
  ) {
    reason = 'stale-session';
  } else if (lower.includes('resume') && lower.includes('not exist')) {
    reason = 'resume-session-missing';
  }

  if (!reason) {
    return null;
  }

  return {
    reason,
    message: normalized,
    retryable: true,
    suggestedAction: getSuggestedRuntimeAction(reason),
    source,
  };
}

function getSuggestedRuntimeAction(reason: RuntimeReconnectReason): RuntimeSuggestedAction {
  if (reason === 'resume-session-missing') {
    return 'recover';
  }

  if (reason === 'stale-session') {
    return 'resend';
  }

  return 'retry';
}

function closeTurnAfterUnexpectedStreamEnd(turn: ConversationTurn): ConversationTurn {
  const hasVisibleOutput = hasTurnVisibleOutput(turn);

  return {
    ...turn,
    ...settleRunningToolSteps(turn, 'error'),
    status: 'error',
    phase: undefined,
    durationMs: turn.durationMs ?? getElapsedDuration(turn),
    activity: hasVisibleOutput ? '连接中断，已保留部分输出' : '连接中断，Claude 未返回完成事件',
  };
}

function formatRuntimeErrorActivity(message: string, hint?: RuntimeRecoveryHint) {
  if (!hint) {
    return message;
  }

  return `${message}（可尝试${formatSuggestedRuntimeAction(hint.suggestedAction)}）`;
}

function formatRuntimeRecoveryHintDebug(hint: RuntimeRecoveryHint) {
  return [
    `reason: ${hint.reason}`,
    `source: ${hint.source}`,
    `action: ${hint.suggestedAction}`,
    `message: ${hint.message}`,
  ].join('\n');
}

function formatSuggestedRuntimeAction(action: RuntimeSuggestedAction) {
  switch (action) {
    case 'recover':
      return '恢复运行';
    case 'resend':
      return '重发上一条消息';
    case 'retry':
    default:
      return '重试';
  }
}

function getRecoveryToastMessage(action: RuntimeSuggestedAction) {
  switch (action) {
    case 'recover':
      return '已尝试在新会话中恢复当前任务。';
    case 'resend':
      return '已重发上一条消息。';
    case 'retry':
    default:
      return '已重新发起当前请求。';
  }
}

function buildRequestUserInputPrompt(
  request: RequestUserInputRequest,
  answers: Record<string, string>,
) {
  const sections = request.questions
    .map((question, index) => {
      const key = question.id ?? `question-${index}`;
      const answer = answers[key]?.trim();
      if (!answer) {
        return '';
      }

      return [
        `${index + 1}. ${question.question}`,
        answer,
      ].join('\n');
    })
    .filter(Boolean);

  if (sections.length === 0) {
    return '';
  }

  const header = request.title?.trim() || '补充输入';
  const description = request.description?.trim();

  return [
    `以下是针对“${header}”的补充信息，请基于这些回答继续刚才的任务。`,
    description ? `补充说明：${description}` : '',
    '',
    sections.join('\n\n'),
  ]
    .filter(Boolean)
    .join('\n');
}

function buildApprovalDecisionPrompt(request: ApprovalRequest, decision: ApprovalDecision) {
  if (isPlanApprovalRequest(request)) {
    const lines = [
      decision === 'approve'
        ? '用户已批准这个计划，请退出 Plan 模式并开始执行。'
        : '用户拒绝了这个计划，请继续保持 Plan 模式，重新调整计划后再提交确认。',
      request.description ? `计划内容：\n${request.description}` : '',
    ];
    return lines.filter(Boolean).join('\n\n');
  }

  const command = request.command?.length ? request.command.join(' ') : '';
  const lines = [
    decision === 'approve'
      ? '用户已批准刚才请求的操作，请继续执行原任务。'
      : '用户已拒绝刚才请求的操作，请不要执行该操作，并改用安全替代方案继续原任务。',
    `请求：${request.title}`,
    request.description ? `说明：${request.description}` : '',
    command ? `命令：${command}` : '',
    request.danger ? `风险级别：${request.danger}` : '',
  ];

  return lines.filter(Boolean).join('\n');
}

function buildApprovalDecisionToolResultContent(request: ApprovalRequest, decision: ApprovalDecision) {
  if (isPlanApprovalRequest(request)) {
    return decision === 'approve'
      ? 'The user approved this plan. Exit plan mode and proceed with implementation.'
      : 'The user rejected this plan. Stay in plan mode, revise the plan, and ask for approval again.';
  }

  return decision === 'approve'
    ? 'The user approved this request. Continue the original task.'
    : 'The user rejected this request. Do not perform the requested action; choose a safe alternative.';
}

function isPlanApprovalRequest(request: ApprovalRequest) {
  return request.title === '计划待确认';
}

function isVisiblePermissionMode(value: unknown): value is (typeof permissionMenuModes)[number] {
  return isPermissionMode(value) && permissionMenuModes.includes(value as (typeof permissionMenuModes)[number]);
}

function normalizeSessionId(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
