import { applyAgentRunEventToTurn } from './agent-run-events';
import type { AgentMuxRun, AgentMuxRunEvent } from './agent-mux-api';
import type { AgentRunEvent, ConversationTurn, TurnPhase } from '../types';

export function buildAgentMuxConversationTurn(
  run: AgentMuxRun,
  events: AgentMuxRunEvent[],
): ConversationTurn {
  let turn: ConversationTurn = {
    id: `agent-mux-${run.id}`,
    backendRunId: run.providerRunId ?? run.id,
    userText: run.prompt || '旧记录未保存原始提示词',
    workspace: run.workingDirectory ?? '',
    assistantText: '',
    tools: [],
    items: [],
    status: run.status === 'queued' ? 'pending' : 'running',
    activity: run.status === 'queued' ? '等待运行' : `正在运行 ${run.target}`,
    startedAtMs: parseAgentMuxTimestamp(events[0]?.createdAt) ?? Date.now(),
    pendingUserInputRequests: [],
    pendingApprovalRequests: [],
    providerName: run.target,
    modelName: run.profile,
  };

  for (const storedEvent of events) {
    const event = readStoredAgentRunEvent(storedEvent);
    if (event) {
      turn = applyAgentRunEventToTurn(turn, event);
    }
  }

  return reconcileAgentMuxRunState(turn, run);
}

function readStoredAgentRunEvent(storedEvent: AgentMuxRunEvent): AgentRunEvent | null {
  if (isAgentRunEvent(storedEvent.payload)) {
    return storedEvent.payload;
  }
  return convertLegacyAgentMuxEvent(storedEvent);
}

function isAgentRunEvent(value: unknown): value is AgentRunEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { type?: unknown; runId?: unknown };
  return typeof candidate.type === 'string' && typeof candidate.runId === 'string';
}

function convertLegacyAgentMuxEvent(event: AgentMuxRunEvent): AgentRunEvent | null {
  switch (event.eventType) {
    case 'output':
      return { type: 'delta', runId: event.runId, text: event.message };
    case 'status':
      return { type: 'status', runId: event.runId, message: event.message };
    case 'phase':
      return {
        type: 'phase',
        runId: event.runId,
        phase: legacyPhase(event.message),
        label: event.message,
      };
    case 'tool':
    case 'tool-start':
      return {
        type: 'tool-start',
        runId: event.runId,
        blockIndex: event.id,
        toolUseId: `legacy-agent-mux-tool-${event.id}`,
        name: event.message.replace(/^调用工具[：:]\s*/, '') || 'Tool',
      };
    case 'waiting':
      return { type: 'status', runId: event.runId, message: event.message || '等待用户处理' };
    case 'error':
      return { type: 'error', runId: event.runId, message: event.message };
    case 'cancelled':
      return { type: 'done', runId: event.runId, result: '', stopReason: 'cancelled' };
    default:
      return event.message
        ? { type: 'status', runId: event.runId, message: event.message }
        : null;
  }
}

function legacyPhase(message: string): TurnPhase {
  if (message.includes('思考')) {
    return 'thinking';
  }
  if (message.includes('工具')) {
    return 'tool';
  }
  return 'computing';
}

function reconcileAgentMuxRunState(turn: ConversationTurn, run: AgentMuxRun): ConversationTurn {
  const persistedDurationMs = parseAgentMuxDuration(run.duration);
  const durationMs = persistedDurationMs ?? turn.durationMs;
  if (turn.status === 'done' || turn.status === 'error' || turn.status === 'stopped') {
    return { ...turn, durationMs };
  }

  if (run.status === 'completed') {
    return { ...turn, status: 'done', activity: '运行完成', durationMs };
  }
  if (run.status === 'failed') {
    return { ...turn, status: 'error', activity: run.summary || 'Agent 运行失败', durationMs };
  }
  if (run.status === 'cancelled') {
    return { ...turn, status: 'stopped', activity: '已停止', durationMs };
  }
  if (run.status === 'waiting') {
    return { ...turn, status: 'running', activity: '等待用户处理', durationMs };
  }
  return {
    ...turn,
    status: run.status === 'queued' ? 'pending' : 'running',
    durationMs,
  };
}

export function parseAgentMuxTimestamp(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function formatAgentMuxRelativeTime(value: string | undefined, fallback = '刚刚', nowMs = Date.now()) {
  const timestamp = parseAgentMuxTimestamp(value);
  if (timestamp === undefined) return fallback;
  const diffMinutes = Math.max(0, Math.floor((nowMs - timestamp) / 60_000));
  if (diffMinutes < 1) return '刚刚';
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const date = new Date(timestamp);
  const now = new Date(nowMs);
  const prefix = date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}/`;
  return `${prefix}${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatAgentMuxExactTime(value: string | undefined) {
  const timestamp = parseAgentMuxTimestamp(value);
  return timestamp === undefined ? undefined : new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function parseAgentMuxDuration(value: string) {
  if (!value || value === '--') {
    return undefined;
  }
  const parts = value.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds * 1000;
}
