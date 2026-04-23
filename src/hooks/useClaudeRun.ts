import { FormEvent, useEffect, useRef, useState } from 'react';
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
  ClaudeEvent,
  ClaudeModelInfo,
  ConversationTurn,
  DebugEvent,
  PermissionMode,
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
  const [prompt, setPrompt] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [model, setModel] = useState(DEFAULT_MODEL_VALUE);
  const [models, setModels] = useState<string[]>([]);
  const [, setHealth] = useState<{ available: boolean; command?: string; error?: string }>({
    available: false,
  });
  const [backendRunId, setBackendRunId] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [clockNowMs, setClockNowMs] = useState(Date.now());

  const abortRef = useRef<AbortController | null>(null);
  const activeTurnIdRef = useRef('');
  const runThreadIdRef = useRef<string | null>(null);

  useEffect(() => {
    void loadHealth();
    void loadClaudeModels();
  }, []);

  useEffect(() => {
    const nextWorkspace = activeThreadSummary?.workingDirectory || activeProjectPath || '';
    setWorkspace(nextWorkspace);
  }, [activeProjectPath, activeThreadSummary?.workingDirectory]);

  useEffect(() => {
    setPermissionMode(isPermissionMode(activeThreadSummary?.permissionMode) ? activeThreadSummary.permissionMode : 'default');
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

    return createThread(activeProjectId);
  }

  function updateRunningTurn(updater: (turn: ConversationTurn) => ConversationTurn) {
    const targetThreadId = runThreadIdRef.current || activeThreadId;
    const activeTurnId = activeTurnIdRef.current;
    if (!targetThreadId || !activeTurnId) {
      return;
    }

    updateThreadTurn(targetThreadId, activeTurnId, updater);
  }

  function appendRunningDebug(event: Omit<DebugEvent, 'id'>) {
    const targetThreadId = runThreadIdRef.current || activeThreadId;
    if (!targetThreadId) {
      return;
    }

    appendDebug(targetThreadId, event);
  }

  function appendRunningRawEvent(line: string) {
    const targetThreadId = runThreadIdRef.current || activeThreadId;
    if (!targetThreadId) {
      return;
    }

    appendRawEvent(targetThreadId, line);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || isRunning) {
      return;
    }

    const thread = await ensureActiveThread();
    if (!thread) {
      return;
    }

    const turnId = crypto.randomUUID();
    activeTurnIdRef.current = turnId;
    runThreadIdRef.current = thread.id;
    setBackendRunId('');
    setPrompt('');
    setIsRunning(true);
    updateThreadDetail(
      thread.id,
      (existing) => ({
        ...existing,
        turns: [
          ...closeDanglingTurns(existing.turns),
          {
            id: turnId,
            userText: trimmedPrompt,
            workspace: workspace.trim() || thread.workingDirectory,
            assistantText: '',
            tools: [],
            items: [],
            status: 'pending',
            activity: '等待 Claude 响应',
            phase: 'requesting',
            startedAtMs: Date.now(),
          },
        ],
      }),
      thread,
    );

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/claude/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          workingDirectory: workspace.trim() || thread.workingDirectory,
          permissionMode,
          model: model === DEFAULT_MODEL_VALUE ? undefined : model,
          sessionId: thread.sessionId.trim() ? thread.sessionId.trim() : undefined,
        }),
        signal: controller.signal,
      });

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
        return;
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
        updateRunningTurn(closeTurnWithoutTerminalEvent);
        schedulePersistThreadHistory(targetThreadId);
      }
    } catch (error) {
      const targetThreadId = runThreadIdRef.current || activeThreadId;
      updateRunningTurn((turn) => ({
        ...turn,
        ...settleRunningToolSteps(turn, error instanceof DOMException && error.name === 'AbortError' ? 'done' : 'error'),
        status: error instanceof DOMException && error.name === 'AbortError' ? 'stopped' : 'error',
        durationMs: turn.durationMs ?? getElapsedDuration(turn),
        activity:
          error instanceof DOMException && error.name === 'AbortError'
            ? '已停止当前运行'
            : error instanceof Error
              ? error.message
              : '未知错误',
      }));
      schedulePersistThreadHistory(targetThreadId);
    } finally {
      abortRef.current = null;
      setIsRunning(false);
      setBackendRunId('');
      runThreadIdRef.current = null;
      clearActiveTurnSelection();
    }
  }

  function handleStreamLine(line: string) {
    if (!line.trim()) {
      return null;
    }

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
    if ('runId' in event && event.runId) {
      setBackendRunId(event.runId);
      updateRunningTurn((turn) => ({
        ...turn,
        backendRunId: event.runId,
        status: turn.status === 'pending' ? 'running' : turn.status,
      }));
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
        activity: 'Claude Code 已启动',
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

    if (event.type === 'delta') {
      updateRunningTurn((turn) => ({
        ...turn,
        status: 'running',
        assistantText: `${turn.assistantText}${event.text}`,
        items: appendTextItem(turn.items, event.text),
        activity: 'Computing...',
        phase: 'computing',
      }));
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
        return {
          ...turn,
          activity: summarizeToolResult(event),
          phase: event.isError ? turn.phase : 'computing',
          tools,
          items: tool ? syncToolItem(turn.items, tool) : turn.items,
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
      const targetThreadId = runThreadIdRef.current || activeThreadId;
      updateRunningTurn((turn) => ({
        ...turn,
        ...settleRunningToolSteps(turn, 'error'),
        status: 'error',
        durationMs: turn.durationMs ?? getElapsedDuration(turn),
        activity: event.message,
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
      const targetThreadId = runThreadIdRef.current || activeThreadId;
      updateRunningTurn((turn) => {
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
          metrics: formatMetrics(event),
          sessionId: event.sessionId ?? turn.sessionId,
          durationMs: event.durationMs ?? turn.durationMs ?? getElapsedDuration(turn),
          totalCostUsd: event.totalCostUsd ?? turn.totalCostUsd,
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
          workingDirectory: workspace.trim() || activeThreadSummary?.workingDirectory,
        });
      }
      schedulePersistThreadHistory(targetThreadId);
    }
  }

  function handlePermissionModeSelect(mode: PermissionMode) {
    setPermissionMode(mode);

    if (activeThreadId) {
      void persistThreadMetadata(activeThreadId, { permissionMode: mode });
    }
  }

  async function stopRun() {
    abortRef.current?.abort();

    if (!backendRunId) {
      clearActiveTurnSelection();
      return;
    }

    try {
      await fetch(`/api/claude/run/${backendRunId}`, {
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

  return {
    prompt,
    workspace,
    permissionMode,
    model,
    models,
    backendRunId,
    isRunning,
    clockNowMs,
    activeTurnIdRef,
    setPrompt,
    setWorkspace,
    setPermissionMode,
    setModel,
    handlePermissionModeSelect,
    handleSubmit,
    stopRun,
  };
}
