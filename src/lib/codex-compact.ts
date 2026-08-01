import { OPENAI_CODEX_PROVIDER_ID } from '../constants';
import type {
  AgentRunEvent,
  CodexCompactCapability,
  CompactOperationMetadata,
  CompactOperationStatus,
  ConversationTurn,
  SystemCommandItem,
} from '../types';

type ContextCompactionEvent = Extract<AgentRunEvent, { type: 'context-compaction' }>;

type CreateManualCompactTurnInput = {
  operationId: string;
  providerThreadId: string;
  workspace: string;
  status: Extract<CompactOperationStatus, 'waiting' | 'preparing'>;
  nowMs: number;
};

export type CompactAvailabilityInput = {
  providerId: string;
  sessionId?: string;
  capability: CodexCompactCapability;
  activeStatus?: CompactOperationStatus;
};

export type CompactAvailability = {
  available: boolean;
  busy: boolean;
  reason: string;
};

export type CompactCapabilityRuntime = {
  threadId: string;
  sessionId: string;
  workingDirectory: string;
  channelId?: string;
  model?: string;
  reasoningEffort?: string;
  permissionMode?: string;
};

const MAX_COMPACT_ERROR_CHARS = 2_000;

export function compactCapabilityKey(runtime: CompactCapabilityRuntime): string {
  return JSON.stringify([
    runtime.threadId,
    runtime.sessionId,
    runtime.workingDirectory,
    runtime.channelId ?? '',
    runtime.model ?? '',
    runtime.reasoningEffort ?? '',
    runtime.permissionMode ?? '',
  ]);
}

export function createManualCompactTurn(input: CreateManualCompactTurnInput): ConversationTurn {
  return createCompactTurn(
    {
      operationId: input.operationId,
      source: 'manual',
      status: input.status,
      attempt: 1,
      providerThreadId: input.providerThreadId,
      requestedAtMs: input.nowMs,
    },
    input.workspace,
  );
}

export function createAutomaticCompactTurn(
  event: ContextCompactionEvent,
  workspace: string,
): ConversationTurn {
  const operationId = automaticOperationId(event);
  const metadata: CompactOperationMetadata = {
    operationId,
    source: 'automatic',
    status: event.status,
    attempt: 1,
    providerThreadId: event.providerThreadId,
    providerTurnId: event.providerTurnId,
    providerItemId: event.providerItemId,
    requestedAtMs: event.atMs,
    startedAtMs: event.status === 'running' ? event.atMs : undefined,
    completedAtMs: event.status === 'completed' || event.status === 'failed' ? event.atMs : undefined,
    error: event.status === 'failed' ? sanitizeCompactError(event.error) : undefined,
  };
  return createCompactTurn(metadata, workspace);
}

export function readCompactMetadata(turn: ConversationTurn): CompactOperationMetadata | null {
  for (const item of turn.items) {
    if (item.type === 'system-command' && item.compact) {
      return item.compact;
    }
  }
  return null;
}

export function findPendingCompactTurn(turns: ConversationTurn[]): ConversationTurn | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const metadata = readCompactMetadata(turns[index]);
    if (
      metadata?.source === 'manual' &&
      metadata.resolution !== 'skipped' &&
      metadata.status !== 'completed'
    ) {
      return turns[index];
    }
  }
  return null;
}

export function applyCompactEvent(
  turns: ConversationTurn[],
  event: ContextCompactionEvent,
  workspace = '',
): ConversationTurn[] {
  let targetIndex = event.operationId
    ? turns.findIndex((turn) => readCompactMetadata(turn)?.operationId === event.operationId)
    : event.source === 'manual'
      ? findActiveManualCompactIndex(turns, event.providerThreadId)
      : -1;

  if (targetIndex === -1 && event.operationId && event.source !== 'automatic') {
    return turns;
  }

  if (targetIndex === -1) {
    const automaticTurn = createAutomaticCompactTurn(
      event,
      turns.at(-1)?.workspace ?? workspace,
    );
    const operationId = readCompactMetadata(automaticTurn)?.operationId;
    targetIndex = turns.findIndex(
      (turn) => readCompactMetadata(turn)?.operationId === operationId,
    );
    if (targetIndex === -1) {
      return [...turns, automaticTurn];
    }
  }

  const currentTurn = turns[targetIndex];
  const current = readCompactMetadata(currentTurn);
  if (!current) {
    return turns;
  }
  const next = compactMetadataFromEvent(current, event);
  if (compactMetadataEqual(current, next)) {
    return turns;
  }

  const updatedTurn = replaceCompactMetadata(currentTurn, next);
  const updatedTurns = [...turns];
  updatedTurns[targetIndex] = updatedTurn;
  return updatedTurns;
}

export function retryCompactTurn(turn: ConversationTurn, nowMs: number): ConversationTurn {
  const metadata = readCompactMetadata(turn);
  if (!metadata || metadata.source !== 'manual') {
    return turn;
  }
  return replaceCompactMetadata(turn, {
    ...metadata,
    status: 'preparing',
    attempt: metadata.attempt + 1,
    resolution: undefined,
    requestedAtMs: nowMs,
    startedAtMs: undefined,
    completedAtMs: undefined,
    providerTurnId: undefined,
    providerItemId: undefined,
    error: undefined,
  });
}

export function prepareCompactTurn(turn: ConversationTurn): ConversationTurn {
  const metadata = readCompactMetadata(turn);
  if (!metadata || metadata.source !== 'manual' || metadata.status !== 'waiting') {
    return turn;
  }
  return replaceCompactMetadata(turn, {
    ...metadata,
    status: 'preparing',
  });
}

export function skipCompactTurn(turn: ConversationTurn, nowMs: number): ConversationTurn {
  const metadata = readCompactMetadata(turn);
  if (!metadata || metadata.source !== 'manual' || metadata.status === 'completed') {
    return turn;
  }
  return replaceCompactMetadata(turn, {
    ...metadata,
    resolution: 'skipped',
    completedAtMs: metadata.completedAtMs ?? nowMs,
  });
}

export function interruptUnconfirmedCompactTurn(
  turn: ConversationTurn,
  nowMs: number,
): ConversationTurn {
  const metadata = readCompactMetadata(turn);
  if (
    !metadata ||
    metadata.resolution === 'skipped' ||
    !['waiting', 'preparing', 'running'].includes(metadata.status)
  ) {
    return turn;
  }
  return replaceCompactMetadata(turn, {
    ...metadata,
    status: 'interrupted',
    completedAtMs: nowMs,
    error: '应用关闭前未能确认上下文压缩结果',
  });
}

export function getCompactAvailability(input: CompactAvailabilityInput): CompactAvailability {
  if (input.providerId !== OPENAI_CODEX_PROVIDER_ID) {
    return { available: false, busy: false, reason: '仅 OpenAI Codex 支持原生上下文压缩' };
  }
  if (!input.sessionId?.trim()) {
    return {
      available: false,
      busy: false,
      reason: '完成至少一轮 Codex 对话后才能压缩上下文',
    };
  }
  if (input.activeStatus && input.activeStatus !== 'completed') {
    return { available: false, busy: true, reason: '当前已有上下文压缩操作' };
  }
  if (input.capability.state === 'unsupported') {
    return {
      available: false,
      busy: false,
      reason: '当前 Codex CLI 不支持原生会话压缩，请升级 Codex CLI。',
    };
  }
  if (input.capability.state === 'error') {
    return {
      available: false,
      busy: false,
      reason: input.capability.message || '无法确认 Codex 上下文压缩能力',
    };
  }
  if (input.capability.state !== 'supported') {
    return { available: false, busy: false, reason: '正在检查 Codex 上下文压缩能力' };
  }
  return { available: true, busy: false, reason: '' };
}

function createCompactTurn(
  metadata: CompactOperationMetadata,
  workspace: string,
): ConversationTurn {
  const visual = compactVisualState(metadata);
  return {
    id: `compact-turn:${metadata.operationId}`,
    kind: 'system',
    userText: '',
    workspace,
    assistantText: '',
    tools: [],
    items: [
      {
        id: `compact-item:${metadata.operationId}`,
        type: 'system-command',
        command: '/compact',
        title: '压缩上下文',
        cardType: 'compact',
        compact: metadata,
        ...visual.item,
      },
    ],
    status: visual.turnStatus,
    activity: visual.activity,
    startedAtMs: metadata.requestedAtMs,
    durationMs: metadata.completedAtMs
      ? Math.max(0, metadata.completedAtMs - metadata.requestedAtMs)
      : undefined,
  };
}

function replaceCompactMetadata(
  turn: ConversationTurn,
  metadata: CompactOperationMetadata,
): ConversationTurn {
  let changed = false;
  const visual = compactVisualState(metadata);
  const items = turn.items.map((item) => {
    if (item.type !== 'system-command' || !item.compact) {
      return item;
    }
    changed = true;
    return {
      ...item,
      ...visual.item,
      compact: metadata,
    };
  });
  if (!changed) {
    return turn;
  }
  return {
    ...turn,
    kind: 'system',
    items,
    status: visual.turnStatus,
    activity: visual.activity,
    errorMessage: metadata.status === 'failed' || metadata.status === 'interrupted'
      ? metadata.error
      : undefined,
    durationMs: metadata.completedAtMs
      ? Math.max(0, metadata.completedAtMs - metadata.requestedAtMs)
      : undefined,
  };
}

function compactVisualState(metadata: CompactOperationMetadata): {
  item: Pick<SystemCommandItem, 'state' | 'summary' | 'errorMessage'>;
  turnStatus: ConversationTurn['status'];
  activity: string;
} {
  if (metadata.resolution === 'skipped') {
    return {
      item: { state: 'done', summary: '已跳过压缩并继续发送', errorMessage: metadata.error },
      turnStatus: 'done',
      activity: '已跳过上下文压缩',
    };
  }
  switch (metadata.status) {
    case 'waiting':
      return {
        item: { state: 'waiting', summary: '等待当前回答完成' },
        turnStatus: 'pending',
        activity: '等待压缩上下文',
      };
    case 'preparing':
      return {
        item: { state: 'running', summary: '正在准备压缩' },
        turnStatus: 'running',
        activity: '正在准备压缩上下文',
      };
    case 'running':
      return {
        item: { state: 'running', summary: '正在压缩上下文' },
        turnStatus: 'running',
        activity: '正在压缩上下文',
      };
    case 'completed':
      return {
        item: { state: 'done', summary: '上下文压缩完成' },
        turnStatus: 'done',
        activity: '上下文压缩完成',
      };
    case 'failed':
      return {
        item: { state: 'error', summary: '上下文压缩失败', errorMessage: metadata.error },
        turnStatus: 'error',
        activity: '上下文压缩失败',
      };
    case 'interrupted':
      return {
        item: { state: 'error', summary: '上下文压缩已中断', errorMessage: metadata.error },
        turnStatus: 'stopped',
        activity: '上下文压缩已中断',
      };
  }
}

function compactMetadataFromEvent(
  current: CompactOperationMetadata,
  event: ContextCompactionEvent,
): CompactOperationMetadata {
  return {
    ...current,
    status: event.status,
    providerThreadId: event.providerThreadId,
    providerTurnId: event.providerTurnId ?? current.providerTurnId,
    providerItemId: event.providerItemId ?? current.providerItemId,
    startedAtMs: event.status === 'running'
      ? current.startedAtMs ?? event.atMs
      : current.startedAtMs,
    completedAtMs: event.status === 'completed' || event.status === 'failed'
      ? event.atMs
      : current.completedAtMs,
    error: event.status === 'failed' ? sanitizeCompactError(event.error) : undefined,
  };
}

function findActiveManualCompactIndex(turns: ConversationTurn[], providerThreadId: string): number {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const metadata = readCompactMetadata(turns[index]);
    if (
      metadata?.source === 'manual' &&
      metadata.providerThreadId === providerThreadId &&
      metadata.resolution !== 'skipped' &&
      metadata.status !== 'completed'
    ) {
      return index;
    }
  }
  return -1;
}

function automaticOperationId(event: ContextCompactionEvent): string {
  const providerOperationId = event.providerTurnId ?? event.providerItemId ?? event.runId;
  return `automatic:${event.providerThreadId}:${providerOperationId}`;
}

function sanitizeCompactError(error: string | undefined): string | undefined {
  if (!error?.trim()) {
    return undefined;
  }
  const redacted = error
    .replace(
      /\b([A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*([^\s,;]+)/gi,
      '$1=[已隐藏]',
    )
    .replace(/\b(token|api[_-]?key|secret|password)\s*=\s*([^\s,;]+)/gi, '$1=[已隐藏]');
  return redacted.slice(0, MAX_COMPACT_ERROR_CHARS);
}

function compactMetadataEqual(
  left: CompactOperationMetadata,
  right: CompactOperationMetadata,
): boolean {
  return (
    left.operationId === right.operationId &&
    left.source === right.source &&
    left.status === right.status &&
    left.attempt === right.attempt &&
    left.resolution === right.resolution &&
    left.providerThreadId === right.providerThreadId &&
    left.providerTurnId === right.providerTurnId &&
    left.providerItemId === right.providerItemId &&
    left.requestedAtMs === right.requestedAtMs &&
    left.startedAtMs === right.startedAtMs &&
    left.completedAtMs === right.completedAtMs &&
    left.error === right.error
  );
}
