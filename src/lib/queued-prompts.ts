import type { ClaudeEffortSelection, PermissionMode } from '../types';
import { resolvePromptSubmissionSessionId } from './claude-run-session';

type QueuedPromptThreadMetadata = {
  sessionId?: string;
  workingDirectory: string;
  permissionMode: PermissionMode;
  model?: string;
  effort?: ClaudeEffortSelection;
};

type CompletedRunMetadata = {
  latestSessionId?: string;
  workingDirectory: string;
  permissionMode: PermissionMode;
  model?: string;
  effort?: ClaudeEffortSelection;
};

export type QueuedPromptRunOptions = {
  sessionId?: string;
  workingDirectory: string;
  permissionModeOverride: PermissionMode;
  modelOverride?: string;
  effortOverride?: ClaudeEffortSelection;
};

export type QueuedPromptGuideAvailability = {
  isRunning: boolean;
  runId?: string;
  hasPendingHumanInput: boolean;
  queueLength: number;
};

export function resolveQueuedPromptRunOptions(
  thread: QueuedPromptThreadMetadata,
  completedRun: CompletedRunMetadata,
  reuseSession = true,
): QueuedPromptRunOptions {
  return {
    sessionId: resolvePromptSubmissionSessionId(completedRun.latestSessionId ?? thread.sessionId, reuseSession),
    workingDirectory: completedRun.workingDirectory || thread.workingDirectory,
    permissionModeOverride: completedRun.permissionMode,
    modelOverride: completedRun.model || thread.model,
    effortOverride: completedRun.effort || thread.effort,
  };
}

export function getQueuedPromptGuideAvailability({
  isRunning,
  runId,
  hasPendingHumanInput,
  queueLength,
}: QueuedPromptGuideAvailability) {
  if (queueLength === 0) {
    return {
      available: false,
      reason: '暂无排队消息。',
    };
  }

  if (!isRunning || !runId) {
    return {
      available: false,
      reason: '当前没有运行中的任务。',
    };
  }

  if (hasPendingHumanInput) {
    return {
      available: false,
      reason: '当前运行正在等待问答或审批，暂不能引导。',
    };
  }

  return {
    available: true,
  };
}
