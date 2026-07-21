import { useCallback, useRef, useState } from 'react';
import {
  clearCompletedOperations,
  completeBackgroundOperation,
  createBackgroundOperation,
  failBackgroundOperation,
  isBackgroundOperationRunning,
  markBackgroundOperationFailuresRead,
  pruneBackgroundOperations,
  type StartBackgroundOperationInput,
} from '../lib/background-operations';
import type { BackgroundOperation } from '../types';

export function useBackgroundOperations() {
  const [operations, setOperations] = useState<BackgroundOperation[]>([]);
  const operationsRef = useRef<BackgroundOperation[]>([]);

  const updateOperations = useCallback((updater: (current: BackgroundOperation[]) => BackgroundOperation[]) => {
    setOperations((current) => {
      const next = updater(current);
      operationsRef.current = next;
      return next;
    });
  }, []);

  const startOperation = useCallback((input: StartBackgroundOperationInput) => {
    if (isBackgroundOperationRunning(operationsRef.current, input.key)) {
      return null;
    }
    const operation = createBackgroundOperation(input);
    const nextOperations = pruneBackgroundOperations([operation, ...operationsRef.current]);
    operationsRef.current = nextOperations;
    setOperations(nextOperations);
    return operation.id;
  }, []);

  const completeOperation = useCallback((operationId: string, summary?: string) => {
    updateOperations((current) => completeBackgroundOperation(current, operationId, summary));
  }, [updateOperations]);

  const failOperation = useCallback((operationId: string, error: unknown) => {
    updateOperations((current) => failBackgroundOperation(current, operationId, error));
  }, [updateOperations]);

  const markFailuresRead = useCallback(() => {
    updateOperations(markBackgroundOperationFailuresRead);
  }, [updateOperations]);

  const clearCompleted = useCallback(() => {
    updateOperations(clearCompletedOperations);
  }, [updateOperations]);

  const isRunning = useCallback((key: string) => isBackgroundOperationRunning(operationsRef.current, key), []);
  const runningCount = operations.filter((operation) => operation.status === 'running').length;
  const unreadFailureCount = operations.filter((operation) => operation.status === 'error' && operation.unread).length;

  return {
    operations,
    startOperation,
    completeOperation,
    failOperation,
    markFailuresRead,
    clearCompleted,
    isRunning,
    runningCount,
    unreadFailureCount,
  };
}
