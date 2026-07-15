export type ThreadActivityNoticeKind = 'approval' | 'failed' | 'completed';

export type ThreadActivityNotice = {
  threadId: string;
  kind: ThreadActivityNoticeKind;
  title: string;
  key: string;
  updatedAtMs: number;
};

export type ThreadActivityNoticeMap = Record<string, ThreadActivityNotice>;

const noticePriority: Record<ThreadActivityNoticeKind, number> = {
  approval: 3,
  failed: 2,
  completed: 1,
};

export function upsertThreadActivityNotice(
  current: ThreadActivityNoticeMap,
  notice: ThreadActivityNotice,
  activeThreadId: string | null,
  windowFocused = true,
): ThreadActivityNoticeMap {
  if (windowFocused && notice.threadId === activeThreadId) {
    return current;
  }

  const existing = current[notice.threadId];
  if (existing && noticePriority[existing.kind] > noticePriority[notice.kind]) {
    return current;
  }

  if (
    existing &&
    existing.kind === notice.kind &&
    existing.key === notice.key &&
    existing.title === notice.title &&
    existing.updatedAtMs === notice.updatedAtMs
  ) {
    return current;
  }

  return {
    ...current,
    [notice.threadId]: notice,
  };
}

export function clearThreadActivityNotice(
  current: ThreadActivityNoticeMap,
  threadId: string,
): ThreadActivityNoticeMap {
  if (!current[threadId]) {
    return current;
  }

  const next = { ...current };
  delete next[threadId];
  return next;
}

export function shouldSendThreadSystemNotification(
  kind: ThreadActivityNoticeKind,
  windowFocused: boolean,
  enabled = true,
) {
  return enabled && !windowFocused && (kind === 'completed' || kind === 'failed' || kind === 'approval');
}

export function shouldRequestTaskbarAttention(kind: ThreadActivityNoticeKind, windowFocused: boolean) {
  return !windowFocused && kind === 'approval';
}
