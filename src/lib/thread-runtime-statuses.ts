import type { ThreadRuntimeStatus } from '../types';

export async function fetchThreadRuntimeStatuses() {
  try {
    const response = await fetch('/api/claude/runtimes');
    if (!response.ok) {
      return {};
    }

    return (await response.json()) as Record<string, ThreadRuntimeStatus>;
  } catch {
    return {};
  }
}
