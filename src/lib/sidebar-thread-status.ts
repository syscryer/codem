import type { ThreadRuntimeStatus } from '../types';
import type { ThreadActivityNoticeMap } from './thread-activity-notices';

export type SidebarThreadStatusKind = 'completed' | 'running' | 'hot';

type ResolveSidebarThreadStatusOptions = {
  threadId: string;
  runningThreadIds: ReadonlySet<string>;
  runtimeStatuses?: Record<string, ThreadRuntimeStatus>;
  threadActivityNotices: ThreadActivityNoticeMap;
};

export function resolveSidebarThreadStatus({
  threadId,
  runningThreadIds,
  runtimeStatuses = {},
  threadActivityNotices,
}: ResolveSidebarThreadStatusOptions): SidebarThreadStatusKind | null {
  const runtimeStatus = runtimeStatuses[threadId];

  if (runningThreadIds.has(threadId) || runtimeStatus?.activeRun) {
    return 'running';
  }

  if (runtimeStatus?.alive) {
    return 'hot';
  }

  if (threadActivityNotices[threadId]) {
    return 'completed';
  }

  return null;
}
