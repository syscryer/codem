import {
  appendThinkingItem,
  appendTextItem,
  attachToolResult,
  closeTurnWithoutTerminalEvent,
  createToolStep,
  findLatestToolIndex,
  findToolResultIndex,
  formatMetrics,
  getElapsedDuration,
  mergeUsageSnapshot,
  sanitizeVisibleAssistantText,
  settleRunningToolSteps,
  settleToolStop,
  syncToolItem,
  upsertToolDelta,
  upsertToolStep,
} from './conversation';
import type {
  AgentRunEvent,
  ApprovalRequest,
  ConversationTurn,
  RequestUserInputRequest,
} from '../types';

export function applyAgentRunEventToTurn(
  turn: ConversationTurn,
  event: AgentRunEvent,
): ConversationTurn {
  const current = {
    ...turn,
    backendRunId: event.runId,
  };

  switch (event.type) {
    case 'status':
      return {
        ...current,
        status: 'running',
        activity: event.message || current.activity,
      };
    case 'session':
      return {
        ...current,
        status: 'running',
        sessionId: event.sessionId,
      };
    case 'delta': {
      const text = sanitizeVisibleAssistantText(event.text);
      if (!text) {
        return current;
      }
      return {
        ...current,
        status: 'running',
        assistantText: `${current.assistantText}${text}`,
        items: appendTextItem(current.items, text),
        activity: '生成回复中',
        phase: 'computing',
      };
    }
    case 'thinking-delta':
      if (!event.text) {
        return current;
      }
      return {
        ...current,
        status: 'running',
        items: appendThinkingItem(current.items, event.text),
        activity: '思考中',
        phase: 'thinking',
      };
    case 'phase':
      return {
        ...current,
        status: 'running',
        phase: event.phase,
        activity: event.label || current.activity,
        thoughtCount: event.thoughtCount ?? current.thoughtCount,
      };
    case 'usage':
      return {
        ...current,
        ...mergeUsageSnapshot(current, event),
      };
    case 'tool-start': {
      const step = createToolStep(event);
      return {
        ...current,
        status: 'running',
        tools: upsertToolStep(current.tools, step),
        items: syncToolItem(current.items, step),
        activity: step.title,
        phase: 'tool',
      };
    }
    case 'tool-input-delta': {
      const tools = upsertToolDelta(current.tools, event);
      const toolIndex = findLatestToolIndex(tools, event.blockIndex, event.toolUseId);
      return {
        ...current,
        status: 'running',
        tools,
        items: toolIndex >= 0 ? syncToolItem(current.items, tools[toolIndex]) : current.items,
        phase: 'tool',
      };
    }
    case 'tool-stop': {
      const tools = settleToolStop(current.tools, event);
      const toolIndex = findLatestToolIndex(tools, event.blockIndex, event.toolUseId);
      return {
        ...current,
        status: 'running',
        tools,
        items: toolIndex >= 0 ? syncToolItem(current.items, tools[toolIndex]) : current.items,
        phase: 'tool',
      };
    }
    case 'tool-result': {
      const tools = attachToolResult(current.tools, event);
      const toolIndex = findToolResultIndex(tools, event);
      return {
        ...current,
        status: 'running',
        tools,
        items: toolIndex >= 0 ? syncToolItem(current.items, tools[toolIndex]) : current.items,
        activity: event.isError ? '工具返回异常' : '工具执行完成',
        phase: 'tool',
      };
    }
    case 'request-user-input':
      return {
        ...current,
        status: 'running',
        pendingUserInputRequests: upsertUserInputRequest(
          current.pendingUserInputRequests,
          event.request,
        ),
        activity: '等待补充信息',
        phase: 'requesting',
      };
    case 'approval-request':
      return {
        ...current,
        status: 'running',
        pendingApprovalRequests: upsertApprovalRequest(
          current.pendingApprovalRequests,
          event.request,
        ),
        activity: '等待批准',
        phase: 'requesting',
      };
    case 'done':
      return settleDoneTurn(current, event);
    case 'error': {
      const settled = settleRunningToolSteps(current, 'error');
      return {
        ...current,
        ...settled,
        status: 'error',
        phase: undefined,
        durationMs: current.durationMs ?? getElapsedDuration(current),
        activity: event.message || 'Agent 运行失败',
        pendingUserInputRequests: [],
        pendingApprovalRequests: [],
      };
    }
    case 'trace':
    case 'claude-event':
    case 'assistant-snapshot':
    case 'raw':
    case 'stderr':
    case 'subagent-delta':
    case 'runtime-reconnect-hint':
    case 'retryable-error':
      return current;
    default:
      return current;
  }
}

export function closeAgentTurnWithoutTerminalEvent(
  turn: ConversationTurn,
  activity?: string,
) {
  const closed = closeTurnWithoutTerminalEvent(turn);
  const settled = {
    ...closed,
    pendingUserInputRequests: [],
    pendingApprovalRequests: [],
  };
  return activity ? { ...settled, activity } : settled;
}

export function isAgentRunTerminalEvent(event: AgentRunEvent) {
  return event.type === 'done' || event.type === 'error';
}

function settleDoneTurn(
  turn: ConversationTurn,
  event: Extract<AgentRunEvent, { type: 'done' }>,
) {
  const fallbackText = turn.assistantText.trim()
    ? ''
    : sanitizeVisibleAssistantText(event.result || '');
  const withText = fallbackText
    ? {
        ...turn,
        assistantText: fallbackText,
        items: appendTextItem(turn.items, fallbackText),
      }
    : turn;
  const stopped = /cancel/i.test(event.stopReason || '');
  const durationMs = event.durationMs ?? withText.durationMs ?? getElapsedDuration(withText);
  const usage = mergeUsageSnapshot(withText, event);
  const settled = settleRunningToolSteps(withText, 'done');
  const metrics = formatMetrics({ ...event, durationMs }, settled.tools.length);

  return {
    ...withText,
    ...usage,
    ...settled,
    status: stopped ? ('stopped' as const) : ('done' as const),
    phase: undefined,
    sessionId: event.sessionId || withText.sessionId,
    durationMs,
    totalCostUsd: event.totalCostUsd ?? withText.totalCostUsd,
    metrics: metrics || withText.metrics,
    activity: stopped ? '已停止' : '运行完成',
    pendingUserInputRequests: [],
    pendingApprovalRequests: [],
  };
}

function upsertUserInputRequest(
  requests: RequestUserInputRequest[] | undefined,
  request: RequestUserInputRequest,
) {
  const normalized = {
    ...request,
    readyAtMs: request.readyAtMs ?? Date.now(),
  };
  if (!request.requestId) {
    return [...(requests ?? []), normalized];
  }
  const current = requests ?? [];
  const index = current.findIndex((item) => item.requestId === request.requestId);
  if (index === -1) {
    return [...current, normalized];
  }
  const next = [...current];
  next[index] = normalized;
  return next;
}

function upsertApprovalRequest(
  requests: ApprovalRequest[] | undefined,
  request: ApprovalRequest,
) {
  if (!request.requestId) {
    return [...(requests ?? []), request];
  }
  const current = requests ?? [];
  const index = current.findIndex((item) => item.requestId === request.requestId);
  if (index === -1) {
    return [...current, request];
  }
  const next = [...current];
  next[index] = request;
  return next;
}
