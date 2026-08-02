import type {
  CodexThreadForkCapability,
  ThreadDetail,
  ThreadForkAvailability,
  ThreadForkResponse,
  ThreadSummary,
} from '../types';

const OPENAI_CODEX_PROVIDER_ID = 'openai-codex';

export function threadForkCapabilityKey(thread: ThreadSummary): string {
  return JSON.stringify([
    thread.provider,
    thread.sessionId,
    thread.workingDirectory,
    thread.agentChannelId ?? '',
    thread.agentChannelFingerprint ?? '',
    thread.model ?? '',
    thread.reasoningEffort ?? '',
    thread.permissionMode ?? '',
  ]);
}

export function getThreadForkAvailability(input: {
  thread: ThreadSummary;
  capability?: CodexThreadForkCapability;
  busy: boolean;
  pendingHumanRequest: boolean;
  forking: boolean;
}): ThreadForkAvailability {
  if (input.thread.provider !== OPENAI_CODEX_PROVIDER_ID) {
    return { enabled: false, reason: '仅 Codex 聊天支持在新聊天中继续' };
  }
  if (!input.thread.sessionId.trim()) {
    return { enabled: false, reason: '当前聊天尚未绑定 Codex 会话' };
  }
  if (input.busy) {
    return { enabled: false, reason: '当前聊天正在运行' };
  }
  if (input.pendingHumanRequest) {
    return { enabled: false, reason: '当前聊天正在等待确认或输入' };
  }
  if (input.forking) {
    return { enabled: false, reason: '正在创建新聊天' };
  }
  if (!input.capability || input.capability.state === 'checking') {
    return { enabled: false, reason: '正在检查 Codex Fork 能力' };
  }
  if (input.capability.state === 'unsupported') {
    return {
      enabled: false,
      reason: input.capability.message
        ? `当前 Codex CLI 不支持在新聊天中继续，请升级 Codex CLI。${input.capability.message}`
        : '当前 Codex CLI 不支持在新聊天中继续，请升级 Codex CLI。',
    };
  }
  if (input.capability.state === 'error') {
    return {
      enabled: false,
      reason: input.capability.message || '无法检查 Codex Fork 能力',
    };
  }
  return { enabled: true };
}

export function threadDetailFromForkResponse(response: ThreadForkResponse): ThreadDetail {
  if (response.threadId !== response.thread.id || response.history.threadId !== response.threadId) {
    throw new Error('Fork 响应中的聊天 ID 不一致');
  }
  return {
    ...response.thread,
    turns: response.historyState === 'loaded' ? response.history.turns : [],
    debugEvents: [],
    rawEvents: [],
    claudeContext: response.historyState === 'loaded' ? response.history.claudeContext : undefined,
    historyLoaded: response.historyState === 'loaded',
    historyLoading: false,
  };
}
