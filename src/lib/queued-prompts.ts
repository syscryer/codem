import type {
  ClaudeEffortSelection,
  CompactOperationStatus,
  InputContentBlock,
  PermissionMode,
  UserImageAttachment,
} from '../types';
import { resolvePromptSubmissionSessionId } from './claude-run-session';

export type QueuedPromptStatus = 'preparing' | 'ready' | 'guiding' | 'guide-unknown';
export type QueuedPromptGuideOutcome = 'submitted' | 'rejected' | 'uncertain';

export function resolveGuideSuccessActivity(
  terminal: boolean,
  currentActivity: string | undefined,
) {
  return terminal ? currentActivity : '已发送引导消息，等待 Codex 接收';
}

type CodexQueuedPromptGuideCandidate = {
  prompt: string;
  queueStatus?: QueuedPromptStatus;
  attachments?: UserImageAttachment[];
  contentBlocks?: InputContentBlock[];
};

type QueuedPromptGuideSelectionCandidate = {
  id: string;
  queueStatus?: QueuedPromptStatus;
};

type QueuedPromptContinuationCandidate = {
  queueStatus?: QueuedPromptStatus;
};

export function getQueuedPromptContinuationState(
  queue: QueuedPromptContinuationCandidate[],
  compactStatus?: CompactOperationStatus,
): 'empty' | 'preparing' | 'paused' | 'blocked-by-compact' | 'ready' {
  if (compactStatus && compactStatus !== 'completed') {
    return 'blocked-by-compact';
  }
  if (queue.some((prompt) => prompt.queueStatus === 'guide-unknown')) {
    return 'paused';
  }
  const headStatus = queue[0]?.queueStatus;
  if (!headStatus) {
    return 'empty';
  }
  if (headStatus === 'preparing') {
    return 'preparing';
  }
  if (headStatus === 'guiding') {
    return 'paused';
  }
  return 'ready';
}

export function shouldResumePausedQueueAfterUnknownRemoval(
  removedStatus: QueuedPromptStatus | undefined,
  remainingQueue: QueuedPromptContinuationCandidate[],
  hasPausedContinuation: boolean,
) {
  return hasPausedContinuation &&
    removedStatus === 'guide-unknown' &&
    getQueuedPromptContinuationState(remainingQueue) !== 'paused';
}

export function getQueuedPromptGuideSelection(
  queue: QueuedPromptGuideSelectionCandidate[],
  promptId: string,
) {
  if (queue[0]?.id !== promptId) {
    return {
      available: false as const,
      reason: '只能引导队首排队消息。',
    };
  }
  if (queue.some((prompt) => prompt.queueStatus === 'guiding')) {
    return {
      available: false as const,
      reason: '已有排队消息正在引导。',
    };
  }
  return { available: true as const };
}

export function shouldContinueQueueAfterGuide(
  terminalAllowsQueueContinuation: boolean,
  blockedPromptId: string | undefined,
  resolvedPromptId: string,
  outcome: QueuedPromptGuideOutcome,
) {
  return terminalAllowsQueueContinuation &&
    blockedPromptId === resolvedPromptId &&
    outcome !== 'uncertain';
}

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
  isInterrupting?: boolean;
  hasPendingHumanInput: boolean;
  queueLength: number;
};

export function getCodexQueuedPromptGuideContent({
  prompt,
  queueStatus = 'ready',
  attachments,
  contentBlocks,
}: CodexQueuedPromptGuideCandidate) {
  if (queueStatus === 'guide-unknown') {
    return {
      available: false as const,
      reason: '引导结果尚未确认，请召回后再决定是否重发。',
    };
  }
  if (queueStatus === 'guiding') {
    return {
      available: false as const,
      reason: '正在引导当前运行。',
    };
  }
  if (queueStatus === 'preparing') {
    return {
      available: false as const,
      reason: '正在准备附件和文件引用。',
    };
  }
  const text = contentBlocks?.length
    ? contentBlocks
        .flatMap((block) => block.type === 'text' ? [block.text.trim()] : [])
        .filter(Boolean)
        .join('\n\n')
    : prompt.trim();
  if (!text && !attachments?.length && !contentBlocks?.some((block) => block.type !== 'text')) {
    return {
      available: false as const,
      reason: '缺少可引导的消息内容。',
    };
  }
  const attachmentName = contentBlocks
    ?.flatMap((block) => block.type !== 'text' && 'name' in block && block.name ? [block.name] : [])[0]
    || attachments?.find((attachment) => attachment.name)?.name;
  return { available: true as const, text: text || prompt.trim() || attachmentName || '附件消息' };
}

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
  isInterrupting = false,
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

  if (isInterrupting) {
    return {
      available: false,
      reason: '当前运行正在停止，暂不能引导。',
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
