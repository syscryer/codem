import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyAgentRunEventToTurn, isAgentRunTerminalEvent } from '../../lib/agent-run-events';
import type { AgentRunEvent, ConversationTurn, InputContentBlockSummary } from '../../types';
import { mobileApi } from '../lib/mobile-api';
import type { MobileTask, MobileThreadPage } from '../types';

export type MobileStreamState = 'connecting' | 'live' | 'reconnecting' | 'idle';

export function useMobileThread(threadId: string, fallbackTask?: MobileTask) {
  const [page, setPage] = useState<MobileThreadPage>();
  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [error, setError] = useState<string>();
  const [streamState, setStreamState] = useState<MobileStreamState>('connecting');
  const cursorRef = useRef(0);
  const terminalRefreshRef = useRef<number | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      const next = await mobileApi.thread(threadId);
      cursorRef.current = next.liveEventCursor ?? 0;
      setPage((current) => ({
        ...next,
        task: mergeTask(next.task, current?.task ?? fallbackTask) ?? next.task,
      }));
      setError(undefined);
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载会话失败');
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [fallbackTask, threadId]);

  const loadEarlier = useCallback(async () => {
    if (!page?.hasMore || !page.nextCursor || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const older = await mobileApi.thread(threadId, page.nextCursor);
      setPage((current) => current ? {
        ...current,
        turns: mergeTurns(older.turns, current.turns),
        hasMore: older.hasMore,
        nextCursor: older.nextCursor,
      } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载更早消息失败');
    } finally {
      setLoadingEarlier(false);
    }
  }, [loadingEarlier, page?.hasMore, page?.nextCursor, threadId]);

  const appendOptimisticTurn = useCallback((userText: string, userContentBlocks: InputContentBlockSummary[]) => {
    const id = `mobile-pending-${crypto.randomUUID()}`;
    setPage((current) => {
      if (!current) return current;
      const task = mergeTask(current.task, fallbackTask) ?? current.task;
      return {
        ...current,
        turns: [...current.turns, {
          id,
          userText,
          userContentBlocks,
          workspace: '',
          assistantText: '',
          tools: [],
          items: [],
          status: 'pending',
          activity: '正在发送',
          startedAtMs: Date.now(),
          pendingApprovalRequests: [],
          pendingUserInputRequests: [],
          providerId: task.providerId,
          providerName: task.providerLabel,
          modelId: task.model,
          modelName: task.model,
        }],
        task: { ...task, phase: 'starting', latestActivity: '正在发送' },
      };
    });
    return id;
  }, [fallbackTask]);

  const removeOptimisticTurn = useCallback((turnId: string) => {
    setPage((current) => current ? {
      ...current,
      turns: current.turns.filter((turn) => turn.id !== turnId),
      task: current.task.phase === 'starting'
        ? { ...current.task, phase: 'idle', latestActivity: undefined }
        : current.task,
    } : current);
  }, []);

  useEffect(() => {
    let disposed = false;
    let events: EventSource | undefined;
    let streamSettled = false;
    const start = async () => {
      const initial = await reload();
      if (disposed || !initial) return;
      const after = initial.liveEventCursor ?? 0;
      const params = new URLSearchParams({ after: String(after) });
      if (initial.liveRunId) params.set('runId', initial.liveRunId);
      events = new EventSource(
        `/api/mobile/tasks/${encodeURIComponent(threadId)}/events?${params.toString()}`,
        { withCredentials: true },
      );
      events.onopen = () => {
        if (!streamSettled) setStreamState('live');
      };
      events.addEventListener('agent', (rawEvent) => {
        const message = rawEvent as MessageEvent<string>;
        const cursor = parseMobileLiveEventId(message.lastEventId);
        if (cursor) cursorRef.current = cursor.offset;
        try {
          const event = JSON.parse(message.data) as AgentRunEvent;
          const terminal = isAgentRunTerminalEvent(event);
          streamSettled = terminal;
          setPage((current) => current ? applyLiveEvent(current, event, fallbackTask) : current);
          setStreamState(terminal ? 'idle' : 'live');
          if (terminal) {
            if (terminalRefreshRef.current) window.clearTimeout(terminalRefreshRef.current);
            terminalRefreshRef.current = window.setTimeout(() => {
              terminalRefreshRef.current = undefined;
              void reload();
            }, 500);
          } else if (terminalRefreshRef.current) {
            window.clearTimeout(terminalRefreshRef.current);
            terminalRefreshRef.current = undefined;
          }
        } catch {
          void reload();
        }
      });
      events.addEventListener('idle', () => {
        streamSettled = true;
        setStreamState('idle');
      });
      events.onerror = () => setStreamState(streamSettled ? 'idle' : 'reconnecting');
    };
    setLoading(true);
    setStreamState('connecting');
    void start();
    return () => {
      disposed = true;
      events?.close();
      if (terminalRefreshRef.current) window.clearTimeout(terminalRefreshRef.current);
    };
  }, [fallbackTask, reload, threadId]);

  const task = useMemo(
    () => mergeTask(page?.task, fallbackTask),
    [fallbackTask, page?.task],
  );

  return {
    page,
    task,
    loading,
    loadingEarlier,
    error,
    streamState,
    reload,
    loadEarlier,
    appendOptimisticTurn,
    removeOptimisticTurn,
  };
}

export function parseMobileLiveEventId(value: string): { runId: string; offset: number } | undefined {
  const separator = value.lastIndexOf('|');
  if (separator <= 0) return undefined;
  const offset = Number(value.slice(separator + 1));
  if (!Number.isSafeInteger(offset) || offset < 0) return undefined;
  return { runId: value.slice(0, separator), offset };
}

export function applyLiveEvent(page: MobileThreadPage, event: AgentRunEvent, fallbackTask?: MobileTask): MobileThreadPage {
  const turns = [...page.turns];
  let index = turns.findIndex((turn) => turn.backendRunId === event.runId);
  if (index < 0) {
    const currentRunId = page.liveRunId || page.task.activeRunId;
    const hasDifferentActiveRun = Boolean(
      currentRunId
      && currentRunId !== event.runId
      && turns.some((turn) => (
        turn.backendRunId === currentRunId
        && (turn.status === 'running' || turn.status === 'pending')
      )),
    );
    if (hasDifferentActiveRun && isAgentRunTerminalEvent(event)) {
      return page;
    }
    index = turns.findIndex((turn) => (
      !turn.backendRunId
      && (turn.status === 'running' || turn.status === 'pending')
    ));
  }
  if (index < 0) {
    turns.push(createLiveTurn(event.runId, fallbackTask ?? page.task));
    index = turns.length - 1;
  }
  turns[index] = applyAgentRunEventToTurn(turns[index], event);
  const phase = event.type === 'approval-request' || event.type === 'request-user-input'
    ? 'waiting'
    : event.type === 'error'
      ? 'error'
      : event.type === 'done'
        ? (/cancel/i.test(event.stopReason || '') ? 'stopped' : 'done')
        : 'running';
  const task = mergeTask(page.task, fallbackTask) ?? page.task;
  return {
    ...page,
    liveRunId: event.runId,
    turns,
    task: {
      ...task,
      activeRunId: isAgentRunTerminalEvent(event) ? undefined : event.runId,
      phase,
      latestActivity: turns[index].activity,
    },
  };
}

function createLiveTurn(runId: string, task?: MobileTask): ConversationTurn {
  return {
    id: `mobile-live-${runId}`,
    backendRunId: runId,
    userText: '',
    workspace: '',
    assistantText: '',
    tools: [],
    items: [],
    status: 'running',
    activity: '正在运行',
    startedAtMs: Date.now(),
    pendingApprovalRequests: [],
    pendingUserInputRequests: [],
    providerId: task?.providerId,
    providerName: task?.providerLabel,
    modelId: task?.model,
    modelName: task?.model,
  };
}

function mergeTurns(older: ConversationTurn[], current: ConversationTurn[]) {
  const byId = new Map<string, ConversationTurn>();
  for (const turn of [...older, ...current]) byId.set(turn.id, turn);
  return [...byId.values()];
}

function mergeTask(primary?: MobileTask, fallback?: MobileTask): MobileTask | undefined {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    ...fallback,
    ...primary,
    projectId: primary.projectId || fallback.projectId,
    projectName: primary.projectName || fallback.projectName,
    title: primary.title === '会话' ? fallback.title : primary.title || fallback.title,
    providerId: primary.providerId || fallback.providerId,
    providerLabel: primary.providerLabel === 'Agent' ? fallback.providerLabel : primary.providerLabel,
    updatedAt: primary.updatedAt || fallback.updatedAt,
  };
}
