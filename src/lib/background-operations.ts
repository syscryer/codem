import type { BackgroundOperation, BackgroundOperationKind } from '../types';

const COMPLETED_OPERATION_LIMIT = 40;

export type StartBackgroundOperationInput = {
  key: string;
  kind: BackgroundOperationKind;
  title: string;
  target: string;
  phase?: string;
  nowMs?: number;
};

export function createBackgroundOperation(input: StartBackgroundOperationInput): BackgroundOperation {
  return {
    id: `${input.key}:${input.nowMs ?? Date.now()}`,
    key: input.key,
    kind: input.kind,
    title: input.title,
    target: input.target,
    phase: input.phase ?? '正在处理',
    status: 'running',
    startedAtMs: input.nowMs ?? Date.now(),
  };
}

export function completeBackgroundOperation(
  operations: BackgroundOperation[],
  operationId: string,
  summary?: string,
  nowMs = Date.now(),
) {
  return pruneBackgroundOperations(operations.map((operation) => {
    if (operation.id !== operationId || operation.status !== 'running') {
      return operation;
    }
    return {
      ...operation,
      status: 'success' as const,
      phase: '已完成',
      finishedAtMs: nowMs,
      summary,
      unread: false,
    };
  }));
}

export function failBackgroundOperation(
  operations: BackgroundOperation[],
  operationId: string,
  error: unknown,
  nowMs = Date.now(),
) {
  return pruneBackgroundOperations(operations.map((operation) => {
    if (operation.id !== operationId || operation.status !== 'running') {
      return operation;
    }
    return {
      ...operation,
      status: 'error' as const,
      phase: '失败',
      finishedAtMs: nowMs,
      errorMessage: normalizeBackgroundOperationError(error),
      unread: true,
    };
  }));
}

export function pruneBackgroundOperations(operations: BackgroundOperation[]) {
  const running = operations.filter((operation) => operation.status === 'running');
  const completed = operations
    .filter((operation) => operation.status !== 'running')
    .sort((left, right) => (right.finishedAtMs ?? right.startedAtMs) - (left.finishedAtMs ?? left.startedAtMs))
    .slice(0, COMPLETED_OPERATION_LIMIT);
  return [...running, ...completed].sort((left, right) => right.startedAtMs - left.startedAtMs);
}

export function clearCompletedOperations(operations: BackgroundOperation[]) {
  return operations.filter((operation) => operation.status === 'running');
}

export function markBackgroundOperationFailuresRead(operations: BackgroundOperation[]) {
  return operations.map((operation) => (
    operation.status === 'error' && operation.unread
      ? { ...operation, unread: false }
      : operation
  ));
}

export function isBackgroundOperationRunning(operations: BackgroundOperation[], key: string) {
  return operations.some((operation) => operation.key === key && operation.status === 'running');
}

export function normalizeBackgroundOperationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.trim() || '操作失败';
}
