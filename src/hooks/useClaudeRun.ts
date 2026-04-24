import { useEffect, useRef, useState } from 'react';
import { DEFAULT_MODEL_VALUE } from '../constants';
import {
  appendTextItem,
  attachToolResult,
  closeDanglingTurns,
  closeTurnWithoutTerminalEvent,
  createToolStep,
  findToolResultIndex,
  findLatestToolIndex,
  formatJson,
  formatMetrics,
  getElapsedDuration,
  hasTurnVisibleOutput,
  isPermissionMode,
  mergeUsageSnapshot,
  settleRunningToolSteps,
  summarizeToolResult,
  syncToolItem,
  upsertToolDelta,
  upsertToolStep,
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
  const [backendRunId, setBackendRunId] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [runningThreadId, setRunningThreadId] = useState<string | null>(null);
  const [clockNowMs, setClockNowMs] = useState(Date.now());

  const abortRef = useRef<AbortController | null>(null);
  const backendRunIdRef = useRef('');
  const activeTurnIdRef = useRef('');
  const runThreadIdRef = useRef<string | null>(null);
  const terminalRunIdRef = useRef('');
  const runWorkingDirectoryRef = useRef('');
  const pendingAssistantTextRef = useRef('');
  const assistantTextFrameRef = useRef<number | null>(null);
  const runTraceStartedAtRef = useRef(0);
  const firstClientDeltaAtRef = useRef(0);
  const firstTextApplyAtRef = useRef(0);

  useEffect(() => {
    void loadHealth();
    void loadClaudeModels();
  }, []);

  useEffect(() => {
    const nextWorkspace = activeThreadSummary?.workingDirectory || activeProjectPath || '';
    setWorkspace(nextWorkspace);
  }, [activeProjectPath, activeThreadSummary?.workingDirectory]);

  useEffect(() => {
    setPermissionMode(
      isPermissionMode(activeThreadSummary?.permissionMode)
        ? activeThreadSummary.permissionMode
        : 'bypassPermissions',
    );
  }, [activeThreadSummary?.id, activeThreadSummary?.permissionMode]);

  useEffect(() => {
    if (!isRunning) {
      return undefined;
    }

    setClockNowMs(Date.now());
    const timer = window.setInterval(() => {
      setClockNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isRunning]);

  useEffect(() => {
    return () => {
      if (assistantTextFrameRef.current !== null) {
        window.cancelAnimationFrame(assistantTextFrameRef.current);
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
      const targetThreadId = runThreadIdRef.current || activeThreadId;
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

  function updateRunningTurn(updater: (turn: ConversationTurn) => ConversationTurn) {
    const targetThreadId = runThreadIdRef.current || activeThreadId;
    const activeTurnId = activeTurnIdRef.current;
    if (!targetThreadId || !activeTurnId) {
      return;
    }

    updateThreadTurn(targetThreadId, activeTurnId, updater);
  }

  function setBackendRunIdValue(runId: string) {
    backendRunIdRef.current = runId;
    setBackendRunId(runId);
  }

  function markRunStreamProgress() {
    setClockNowMs(Date.now());
  }

  function appendRunningDebug(event: Omit<DebugEvent, 'id'>) {
    const targetThreadId = runThreadIdRef.current || activeThreadId;
    if (!targetThreadId) {
      return;
    }

    appendDebug(targetThreadId, event);
  }

  function appendTraceDebug(name: string, atMs = Date.now(), detail?: string) {
    const startedAtMs = runTraceStartedAtRef.current || atMs;
    const elapsedMs = Math.max(0, atMs - startedAtMs);
    appendRunningDebug({
      title: `Trace: ${name}`,
      content: detail ? `+${elapsedMs}ms\n${detail}` : `+${elapsedMs}ms`,
    });
  }

  function appendRunningRawEvent(line: string) {
    const targetThreadId = runThreadIdRef.current || activeThreadId;
    if (!targetThreadId) {
      return;
    }

    appendRawEvent(targetThreadId, line);
  }

  function applyAssistantTextDelta(text: string) {
    updateRunningTurn((turn) => ({
      ...turn,
      status: 'running',
      assistantText: `${turn.assistantText}${text}`,
      items: appendTextItem(turn.items, text),
      activity: 'Computing...',
      phase: 'computing',
    }));
  }

  function flushQueuedAssistantText() {
    const text = pendingAssistantTextRef.current;
    pendingAssistantTextRef.current = '';
    assistantTextFrameRef.current = null;

    if (text) {
      applyAssistantTextDelta(text);
      if (!firstTextApplyAtRef.current) {
        firstTextApplyAtRef.current = Date.now();
        appendTraceDebug('client_first_text_apply', firstTextApplyAtRef.current, `${text.length} chars`);
      }
    }
  }

  function flushQueuedAssistantTextNow() {
    if (assistantTextFrameRef.current !== null) {
      window.cancelAnimationFrame(assistantTextFrameRef.current);
      assistantTextFrameRef.current = null;
    }

    flushQueuedAssistantText();
  }

  function queueAssistantTextDelta(text: string) {
    pendingAssistantTextRef.current += text;

    if (assistantTextFrameRef.current !== null) {
      return;
    }

    assistantTextFrameRef.current = window.requestAnimationFrame(flushQueuedAssistantText);
  }

  async function startRun(
    thread: ThreadSummary,
    promptText: string,
    options?: {
      workingDirectory?: string;
      sessionId?: string;
      permissionModeOverride?: PermissionMode;
      onStarted?: () => void;
    },
  ) {
    const trimmedPrompt = promptText.trim();
    if (!trimmedPrompt || isRunning) {
      return false;
    }

    const runWorkingDirectory =
      options?.workingDirectory?.trim() || thread.workingDirectory;
    const runSessionId =
      options?.sessionId && options.sessionId.trim() ? options.sessionId.trim() : undefined;
    const runPermissionMode = options?.permissionModeOverride ?? permissionMode;
    const submitAtMs = Date.now();
    runTraceStartedAtRef.current = submitAtMs;
    firstClientDeltaAtRef.current = 0;
    firstTextApplyAtRef.current = 0;
    runWorkingDirectoryRef.current = runWorkingDirectory;
    const turnId = crypto.randomUUID();
    activeTurnIdRef.current = turnId;
    runThreadIdRef.current = thread.id;
    terminalRunIdRef.current = '';
    setBackendRunIdValue('');
    setIsRunning(true);
    setRunningThreadId(thread.id);
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
    abortRef.current = controller;

    try {
      appendTraceDebug('client_submit', submitAtMs, `${trimmedPrompt.length} chars`);
      appendTraceDebug('fetch_start');
      const response = await fetch('/api/claude/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          workingDirectory: runWorkingDirectory,
          permissionMode: runPermissionMode,
          model: model === DEFAULT_MODEL_VALUE ? undefined : model,
          sessionId: runSessionId,
          clientSubmitAtMs: submitAtMs,
        }),
        signal: controller.signal,
      });
      appendTraceDebug('response_headers');

      if (!response.ok || !response.body) {
        const message = await response.text();
        const targetThreadId = runThreadIdRef.current || activeThreadId;
        updateRunningTurn((turn) => ({
          ...turn,
          status: 'error',
          durationMs: turn.durationMs ?? getElapsedDuration(turn),
          activity: message || '后端没有返回可读流。',
        }));
        schedulePersistThreadHistory(targetThreadId);
        return true;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawTerminalEvent = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const eventPayload = handleStreamLine(line);
          if (eventPayload?.type === 'done' || eventPayload?.type === 'error') {
            sawTerminalEvent = true;
          }
        }
      }

      if (buffer.trim()) {
        const eventPayload = handleStreamLine(buffer);
        if (eventPayload?.type === 'done' || eventPayload?.type === 'error') {
          sawTerminalEvent = true;
        }
      }

      if (!sawTerminalEvent) {
        const targetThreadId = runThreadIdRef.current || activeThreadId;
        flushQueuedAssistantTextNow();
        updateRunningTurn(closeTurnAfterUnexpectedStreamEnd);
        schedulePersistThreadHistory(targetThreadId);
      }
    } catch (error) {
      const targetThreadId = runThreadIdRef.current || activeThreadId;
      flushQueuedAssistantTextNow();
      updateRunningTurn((turn) => ({
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
      schedulePersistThreadHistory(targetThreadId);
    } finally {
      abortRef.current = null;
      setIsRunning(false);
      setRunningThreadId(null);
      setBackendRunIdValue('');
      runThreadIdRef.current = null;
      terminalRunIdRef.current = '';
      clearActiveTurnSelection();
    }

    return true;
  }

  function handleStreamLine(line: string) {
    if (!line.trim()) {
      return null;
    }

    markRunStreamProgress();
    appendRunningRawEvent(line);

    try {
      const eventPayload = JSON.parse(line) as ClaudeEvent;
      handleClaudeEvent(eventPayload);
      return eventPayload;
    } catch (error) {
      appendRunningDebug({
        title: '事件解析失败',
        content: error instanceof Error ? error.message : '无法解析后端事件',
        tone: 'error',
      });
      return null;
    }
  }

  function handleClaudeEvent(event: ClaudeEvent) {
    const eventRunId = 'runId' in event ? event.runId : '';
    if (eventRunId && terminalRunIdRef.current === eventRunId) {
      return;
    }

    if (
      event.type === 'request-user-input' ||
      event.type === 'approval-request' ||
      event.type === 'runtime-reconnect-hint' ||
      event.type === 'retryable-error' ||
      event.type === 'tool-start' ||
      event.type === 'tool-input-delta' ||
      event.type === 'tool-stop' ||
      event.type === 'tool-result' ||
      event.type === 'done' ||
      event.type === 'error'
    ) {
      flushQueuedAssistantTextNow();
    }

    if ('runId' in event && event.runId) {
      setBackendRunIdValue(event.runId);
      updateRunningTurn((turn) => ({
        ...turn,
        backendRunId: event.runId,
        status: turn.status === 'pending' ? 'running' : turn.status,
      }));
    }

    if (event.type === 'trace') {
      appendRunningDebug({
        title: `Trace: ${event.name}`,
        content: event.detail ? `+${event.elapsedMs}ms\n${event.detail}` : `+${event.elapsedMs}ms`,
      });
      return;
    }

    if (event.type === 'raw') {
      appendRunningDebug({
        title: 'Raw Event',
        content: formatJson(event.raw),
      });
      return;
    }

    if (event.type === 'status') {
      updateRunningTurn((turn) => ({
        ...turn,
        status: 'running',
        activity: event.message.includes('已接收用户消息') ? 'Claude Code 已接收用户消息' : 'Claude Code 已启动',
        phase: 'requesting',
      }));
      appendRunningDebug({
        title: '启动运行',
        content: event.message,
      });
      return;
    }

    if (event.type === 'phase') {
      updateRunningTurn((turn) => ({
        ...turn,
        status: turn.status === 'pending' ? 'running' : turn.status,
        phase: event.phase,
        activity: event.label,
        thoughtCount: event.thoughtCount ?? turn.thoughtCount,
      }));
      return;
    }

    if (event.type === 'usage') {
      updateRunningTurn((turn) => ({
        ...turn,
        ...mergeUsageSnapshot(turn, event),
      }));
      return;
    }

    if (event.type === 'session') {
      const targetThreadId = runThreadIdRef.current || activeThreadId;
      if (!targetThreadId) {
        return;
      }

      updateRunningTurn((turn) => ({
        ...turn,
        sessionId: event.sessionId,
      }));
      void persistThreadMetadata(targetThreadId, { sessionId: event.sessionId });
      appendRunningDebug({
        title: 'Session 已绑定',
        content: event.sessionId,
      });
      return;
    }

    if (event.type === 'claude-event') {
      if (event.status === 'requesting') {
        updateRunningTurn((turn) => ({
          ...turn,
          activity: '等待 Claude 响应',
        }));
      }

      appendRunningDebug({
        title: event.label,
        content: formatJson(event.raw),
      });
      return;
    }

    if (event.type === 'request-user-input') {
      updateRunningTurn((turn) => ({
        ...turn,
        status: turn.status === 'pending' ? 'running' : turn.status,
        activity: event.request.title || '等待补充输入',
        pendingUserInputRequests: upsertRequestUserInput(turn.pendingUserInputRequests, event.request),
      }));
      appendRunningDebug({
        title: '请求用户输入',
        content: formatJson(event.request),
      });
      return;
    }

    if (event.type === 'approval-request') {
      updateRunningTurn((turn) => ({
        ...turn,
        status: turn.status === 'pending' ? 'running' : turn.status,
        activity: event.request.title || '等待批准',
        pendingApprovalRequests: upsertApprovalRequest(turn.pendingApprovalRequests, event.request),
      }));
      appendRunningDebug({
        title: '批准请求',
        content: formatJson(event.request),
      });
      return;
    }

    if (event.type === 'runtime-reconnect-hint') {
      updateRunningTurn((turn) => ({
        ...turn,
        recoveryHint: event.hint,
      }));
      appendRunningDebug({
        title: '运行恢复提示',
        content: formatRuntimeRecoveryHintDebug(event.hint),
        tone: 'error',
      });
      return;
    }

    if (event.type === 'retryable-error') {
      updateRunningTurn((turn) => ({
        ...turn,
        recoveryHint: event.hint,
      }));
      appendRunningDebug({
        title: '可恢复错误',
        content: formatRuntimeRecoveryHintDebug(event.hint),
        tone: 'error',
      });
      return;
    }

    if (event.type === 'delta') {
      if (!firstClientDeltaAtRef.current) {
        firstClientDeltaAtRef.current = Date.now();
        appendTraceDebug('client_first_delta_received', firstClientDeltaAtRef.current, `${event.text.length} chars`);
      }
      queueAssistantTextDelta(event.text);
      return;
    }

    if (event.type === 'tool-start') {
      updateRunningTurn((turn) => {
        const step = createToolStep(event);
        const tools = upsertToolStep(turn.tools, step);
        return {
          ...turn,
          status: 'running',
          activity: step.title,
          phase: 'tool',
          tools,
          items: syncToolItem(turn.items, step),
        };
      });
      return;
    }

    if (event.type === 'tool-input-delta') {
      updateRunningTurn((turn) => {
        const tools = upsertToolDelta(turn.tools, event);
        const toolIndex = findLatestToolIndex(tools, event.blockIndex);
        const tool = toolIndex >= 0 ? tools[toolIndex] : undefined;
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
      updateRunningTurn((turn) => {
        const index = findLatestToolIndex(turn.tools, event.blockIndex);
        const tools =
          index === -1
            ? turn.tools
            : turn.tools.map((tool, toolIndex) =>
                toolIndex === index && tool.status === 'running'
                  ? { ...tool, status: 'done' as const }
                  : tool,
              );
        const tool = index >= 0 ? tools[index] : undefined;
        return {
          ...turn,
          tools,
          items: tool ? syncToolItem(turn.items, tool) : turn.items,
        };
      });
      return;
    }

    if (event.type === 'tool-result') {
      updateRunningTurn((turn) => {
        const toolIndex = findToolResultIndex(turn.tools, event);
        const tools = attachToolResult(turn.tools, event);
        const tool =
          toolIndex >= 0
            ? tools[toolIndex]
            : tools.find((item) => item.toolUseId && item.toolUseId === event.toolUseId);
        const approvalRequest = createApprovalRequestFromToolResult(tool, event);
        return {
          ...turn,
          activity: summarizeToolResult(event),
          phase: event.isError ? turn.phase : 'computing',
          tools,
          items: tool ? syncToolItem(turn.items, tool) : turn.items,
          pendingApprovalRequests: approvalRequest
            ? upsertApprovalRequest(turn.pendingApprovalRequests, approvalRequest)
            : turn.pendingApprovalRequests,
        };
      });
      return;
    }

    if (event.type === 'assistant-snapshot') {
      appendRunningDebug({
        title: `Assistant Message Snapshot (${event.blocks.length} blocks)`,
        content: formatJson(event.blocks),
      });
      return;
    }

    if (event.type === 'stderr') {
      appendRunningDebug({
        title: 'stderr',
        content: event.text,
        tone: 'error',
      });
      return;
    }

    if (event.type === 'error') {
      terminalRunIdRef.current = event.runId;
      const targetThreadId = runThreadIdRef.current || activeThreadId;
      updateRunningTurn((turn) => ({
        ...turn,
        ...settleRunningToolSteps(turn, 'error'),
        status: 'error',
        durationMs: turn.durationMs ?? getElapsedDuration(turn),
        activity: formatRuntimeErrorActivity(event.message, turn.recoveryHint),
      }));
      appendRunningDebug({
        title: 'Claude 运行异常',
        content: event.message,
        tone: 'error',
      });
      schedulePersistThreadHistory(targetThreadId);
      return;
    }

    if (event.type === 'done') {
      terminalRunIdRef.current = event.runId;
      const targetThreadId = runThreadIdRef.current || activeThreadId;
      updateRunningTurn((turn) => {
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
      if (targetThreadId) {
        void persistThreadMetadata(targetThreadId, {
          sessionId: event.sessionId,
          model: model === DEFAULT_MODEL_VALUE ? undefined : model,
          permissionMode,
          workingDirectory:
            runWorkingDirectoryRef.current || workspace.trim() || activeThreadSummary?.workingDirectory,
        });
      }
      schedulePersistThreadHistory(targetThreadId);
    }
  }

  async function submitPrompt(promptText: string) {
    const trimmedPrompt = promptText.trim();
    if (!trimmedPrompt || isRunning) {
      return false;
    }

    const thread = await ensureActiveThread();
    if (!thread) {
      return false;
    }

    return startRun(thread, trimmedPrompt, {
      workingDirectory: workspace.trim() || thread.workingDirectory,
      sessionId: thread.sessionId.trim() ? thread.sessionId.trim() : undefined,
    });
  }

  function handlePermissionModeSelect(mode: PermissionMode) {
    setPermissionMode(mode);

    if (activeThreadId) {
      void persistThreadMetadata(activeThreadId, { permissionMode: mode });
    }
  }

  async function stopRun() {
    abortRef.current?.abort();
    const currentRunId = backendRunIdRef.current || backendRunId;

    if (!currentRunId) {
      const targetThreadId = runThreadIdRef.current || activeThreadId;
      flushQueuedAssistantTextNow();
      updateRunningTurn(closeTurnWithoutTerminalEvent);
      schedulePersistThreadHistory(targetThreadId);
      clearActiveTurnSelection();
      setIsRunning(false);
      setRunningThreadId(null);
      return;
    }

    try {
      await fetch(`/api/claude/run/${currentRunId}`, {
        method: 'DELETE',
      });
    } catch {
      appendRunningDebug({
        title: '取消请求未确认',
        content: '前端已停止等待，但后端取消请求未确认完成。',
        tone: 'error',
      });
    } finally {
      clearActiveTurnSelection();
    }
  }

  async function submitRequestUserInput(
    turn: ConversationTurn,
    request: RequestUserInputRequest,
    answers: Record<string, string>,
  ) {
    if (isRunning) {
      showToast('当前仍有运行中的请求，请先等待结束或停止后再提交。', 'info');
      return false;
    }

    if (!activeThreadId || !activeThreadSummary || activeThreadSummary.id !== activeThreadId) {
      showToast('当前线程状态不可用，请重新选择聊天后重试。', 'error');
      return false;
    }

    const promptText = buildRequestUserInputPrompt(request, answers);
    if (!promptText) {
      showToast('请先填写至少一项有效回答。', 'info');
      return false;
    }

    const started = await startRun(activeThreadSummary, promptText, {
      workingDirectory: turn.workspace.trim() || activeThreadSummary.workingDirectory,
      sessionId: turn.sessionId?.trim() || activeThreadSummary.sessionId.trim() || undefined,
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
    if (isRunning) {
      showToast('当前仍有运行中的请求，请先等待结束或停止后再操作。', 'info');
      return false;
    }

    if (!activeThreadId || !activeThreadSummary || activeThreadSummary.id !== activeThreadId) {
      showToast('当前线程状态不可用，请重新选择聊天后重试。', 'error');
      return false;
    }

    const promptText = turn.userText.trim();
    if (!promptText) {
      showToast('当前 turn 没有可重试的用户输入。', 'error');
      return false;
    }

    const sessionId =
      action === 'retry'
        ? turn.sessionId?.trim() || activeThreadSummary.sessionId.trim() || undefined
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
    if (isRunning) {
      showToast('当前仍有运行中的请求，请先等待结束或停止后再操作。', 'info');
      return false;
    }

    if (!activeThreadId || !activeThreadSummary || activeThreadSummary.id !== activeThreadId) {
      showToast('当前线程状态不可用，请重新选择聊天后重试。', 'error');
      return false;
    }

    const promptText = buildApprovalDecisionPrompt(request, decision);
    const started = await startRun(activeThreadSummary, promptText, {
      workingDirectory: turn.workspace.trim() || activeThreadSummary.workingDirectory,
      sessionId: turn.sessionId?.trim() || activeThreadSummary.sessionId.trim() || undefined,
      permissionModeOverride: decision === 'approve' ? 'bypassPermissions' : undefined,
    });

    if (!started) {
      return false;
    }

    updateThreadTurn(activeThreadId, turn.id, (currentTurn) => ({
      ...currentTurn,
      pendingApprovalRequests: removePendingApprovalRequest(currentTurn.pendingApprovalRequests, request),
    }));
    appendDebug(activeThreadId, {
      title: decision === 'approve' ? '已批准请求' : '已拒绝请求',
      content: formatJson({
        requestId: request.requestId,
        title: request.title,
        decision,
        command: request.command,
      }),
    });
    schedulePersistThreadHistory(activeThreadId);
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
    clockNowMs,
    activeTurnIdRef,
    setWorkspace,
    setPermissionMode,
    setModel,
    handlePermissionModeSelect,
    submitPrompt,
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

  return {
    requestId: tool?.toolUseId ?? event.toolUseId ?? tool?.id,
    title: '工具调用需要你确认',
    description: command?.length
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
    normalized.includes('approval required')
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
