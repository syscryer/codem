import type { ProjectSummary, ThreadRuntimeStatus, ThreadSummary, UsageThreadRow, UsageTotals } from '../types';

export type SessionProjectId = string | 'all';

export type SessionManagementRow = {
  project: Pick<ProjectSummary, 'id' | 'name' | 'path'>;
  thread: ThreadSummary;
  active: boolean;
  running: boolean;
  hasSession: boolean;
  runtimeAlive: boolean;
  runtimePid?: number;
  runtimeActiveRun: boolean;
  searchableText: string;
};

export type SessionProjectSummary = {
  id: SessionProjectId;
  name: string;
  path: string;
  total: number;
  running: number;
  missingSession: number;
};

type BuildSessionManagementRowsOptions = {
  activeProjectId: string | null;
  activeThreadId: string | null;
  runningThreadIds: string[];
  runtimeStatuses?: Record<string, ThreadRuntimeStatus>;
};

type FilterSessionManagementRowsOptions = {
  query: string;
  projectId: SessionProjectId;
};

export function buildSessionManagementRows(
  projects: ProjectSummary[],
  options: BuildSessionManagementRowsOptions,
): SessionManagementRow[] {
  const runningThreadIds = new Set(options.runningThreadIds);

  return projects
    .flatMap((project) =>
      project.threads.map((thread) => {
        const runtimeStatus = options.runtimeStatuses?.[thread.id];
        return {
          project: {
            id: project.id,
            name: project.name,
            path: project.path,
          },
          thread,
          active: thread.id === options.activeThreadId,
          running: runningThreadIds.has(thread.id) || Boolean(runtimeStatus?.activeRun),
          hasSession: Boolean(thread.sessionId.trim()),
          runtimeAlive: Boolean(runtimeStatus?.alive),
          runtimePid: runtimeStatus?.alive ? runtimeStatus.pid : undefined,
          runtimeActiveRun: Boolean(runtimeStatus?.activeRun),
          searchableText: normalizeSearchText([
            thread.title,
            thread.sessionId,
            thread.workingDirectory,
            project.name,
            project.path,
          ]),
        };
      }),
    )
    .sort((left, right) => right.thread.updatedAt.localeCompare(left.thread.updatedAt));
}

export function buildSessionProjectSummaries(
  rows: SessionManagementRow[],
  projects: ProjectSummary[] = [],
): SessionProjectSummary[] {
  const summaries = new Map<string, SessionProjectSummary>();
  const allSummary: SessionProjectSummary = {
    id: 'all',
    name: '全部项目',
    path: '',
    total: rows.length,
    running: rows.filter((row) => row.running).length,
    missingSession: rows.filter((row) => !row.hasSession).length,
  };

  for (const project of projects) {
    summaries.set(project.id, {
      id: project.id,
      name: project.name,
      path: project.path,
      total: 0,
      running: 0,
      missingSession: 0,
    });
  }

  for (const row of rows) {
    const existing = summaries.get(row.project.id) ?? {
      id: row.project.id,
      name: row.project.name,
      path: row.project.path,
      total: 0,
      running: 0,
      missingSession: 0,
    };
    existing.total += 1;
    existing.running += row.running ? 1 : 0;
    existing.missingSession += row.hasSession ? 0 : 1;
    summaries.set(row.project.id, existing);
  }

  return [allSummary, ...summaries.values()];
}

export function resolveSessionProjectSelection(
  projectSummaries: SessionProjectSummary[],
  selectedProjectId: SessionProjectId,
): SessionProjectId {
  return projectSummaries.some((project) => project.id === selectedProjectId) ? selectedProjectId : 'all';
}

export function filterSessionManagementRows(
  rows: SessionManagementRow[],
  options: FilterSessionManagementRowsOptions,
) {
  const terms = normalizeSearchTerms(options.query);
  return rows.filter((row) => {
    if (options.projectId !== 'all' && row.project.id !== options.projectId) {
      return false;
    }

    return terms.every((term) => row.searchableText.includes(term));
  });
}

export function getSelectableSessionIds(rows: SessionManagementRow[]) {
  return rows
    .filter((row) => !row.running)
    .map((row) => row.thread.id);
}

export function summarizeSessionManagementUsage(
  rows: SessionManagementRow[],
  usageRows: UsageThreadRow[],
): UsageTotals {
  const usageByThreadId = buildUsageByThreadId(usageRows);
  return rows.reduce((totals, row) => mergeUsageTotals(totals, usageByThreadId.get(row.thread.id)), createEmptyUsageTotals());
}

export function buildSessionManagementUsageByProject(
  rows: SessionManagementRow[],
  usageRows: UsageThreadRow[],
): Map<SessionProjectId, UsageTotals> {
  const usageByThreadId = buildUsageByThreadId(usageRows);
  const usageByProjectId = new Map<SessionProjectId, UsageTotals>([['all', createEmptyUsageTotals()]]);

  for (const row of rows) {
    const usage = usageByThreadId.get(row.thread.id);
    usageByProjectId.set('all', mergeUsageTotals(usageByProjectId.get('all') ?? createEmptyUsageTotals(), usage));
    usageByProjectId.set(
      row.project.id,
      mergeUsageTotals(usageByProjectId.get(row.project.id) ?? createEmptyUsageTotals(), usage),
    );
  }

  return usageByProjectId;
}

export function shortSessionId(sessionId: string) {
  const trimmed = sessionId.trim();
  if (!trimmed) {
    return '未绑定';
  }
  if (trimmed.length <= 12) {
    return trimmed;
  }

  return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
}

function normalizeSearchTerms(value: string) {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeSearchText(values: Array<string | undefined>) {
  return values
    .filter((value): value is string => Boolean(value?.trim()))
    .join(' ')
    .toLowerCase();
}

function buildUsageByThreadId(usageRows: UsageThreadRow[]) {
  const usageByThreadId = new Map<string, UsageThreadRow>();
  for (const row of usageRows) {
    if (row.threadId) {
      usageByThreadId.set(row.threadId, row);
    }
  }
  return usageByThreadId;
}

function createEmptyUsageTotals(): UsageTotals {
  return {
    projects: 0,
    threads: 0,
    messages: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
    durationMs: 0,
    totalCostUsd: 0,
  };
}

function mergeUsageTotals(current: UsageTotals, next: UsageTotals | undefined): UsageTotals {
  if (!next) {
    return current;
  }

  return {
    projects: current.projects + next.projects,
    threads: current.threads + next.threads,
    messages: current.messages + next.messages,
    toolCalls: current.toolCalls + next.toolCalls,
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
    cacheCreationInputTokens: current.cacheCreationInputTokens + next.cacheCreationInputTokens,
    cacheReadInputTokens: current.cacheReadInputTokens + next.cacheReadInputTokens,
    totalTokens: current.totalTokens + next.totalTokens,
    durationMs: current.durationMs + next.durationMs,
    totalCostUsd: current.totalCostUsd + next.totalCostUsd,
  };
}
