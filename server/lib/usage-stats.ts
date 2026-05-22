import type { DatabaseSync } from 'node:sqlite';

export type UsageTotals = {
  projects: number;
  threads: number;
  messages: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  durationMs: number;
  totalCostUsd: number;
};

export type UsageProviderRow = UsageTotals & {
  provider: string;
  model: string;
  lastUsedAt: string | null;
};

export type UsageProjectRow = UsageTotals & {
  projectId: string;
  projectName: string;
  projectPath: string;
  lastUsedAt: string | null;
};

export type UsageThreadRow = UsageTotals & {
  threadId: string;
  projectId: string;
  projectName: string;
  title: string;
  sessionId: string;
  provider: string;
  model: string;
  workingDirectory: string;
  updatedAt: string | null;
  lastUsedAt: string | null;
};

export type UsageTrendPoint = {
  date: string;
  threads: number;
  messages: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  durationMs: number;
  totalCostUsd: number;
};

export type UsageStatsResponse = {
  generatedAt: string;
  totals: UsageTotals;
  byProvider: UsageProviderRow[];
  byProject: UsageProjectRow[];
  byThread: UsageThreadRow[];
  byDay: UsageTrendPoint[];
};

type UsageTotalsRow = {
  projects: number | null;
  threads: number | null;
  messages: number | null;
  toolCalls: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  totalCostUsd: number | null;
  durationMs: number | null;
};

type UsageProviderSqlRow = UsageTotalsRow & {
  provider: string | null;
  model: string | null;
  lastUsedAt: string | null;
};

type UsageProjectSqlRow = UsageTotalsRow & {
  projectId: string;
  projectName: string;
  projectPath: string;
  lastUsedAt: string | null;
};

type UsageThreadSqlRow = UsageTotalsRow & {
  threadId: string;
  projectId: string;
  projectName: string;
  title: string | null;
  sessionId: string | null;
  provider: string | null;
  model: string | null;
  workingDirectory: string | null;
  updatedAt: string | null;
  lastUsedAt: string | null;
};

type UsageTrendSqlRow = UsageTotalsRow & {
  date: string;
  totalTokens: number | null;
};

const usageCtes = `
  WITH turn_usage AS (
    SELECT
      thread_id,
      turn_id,
      MAX(COALESCE(input_tokens, 0)) AS inputTokens,
      MAX(COALESCE(output_tokens, 0)) AS outputTokens,
      MAX(COALESCE(cache_creation_input_tokens, 0)) AS cacheCreationInputTokens,
      MAX(COALESCE(cache_read_input_tokens, 0)) AS cacheReadInputTokens,
      MAX(COALESCE(total_cost_usd, 0)) AS totalCostUsd,
      MAX(COALESCE(duration_ms, 0)) AS durationMs
    FROM messages
    GROUP BY thread_id, turn_id
  ),
  turn_dates AS (
    SELECT
      thread_id,
      turn_id,
      MIN(created_at) AS createdAt,
      substr(MIN(created_at), 1, 10) AS usageDate
    FROM messages
    GROUP BY thread_id, turn_id
  ),
  turn_message_counts AS (
    SELECT
      thread_id,
      turn_id,
      COUNT(*) AS messages
    FROM messages
    GROUP BY thread_id, turn_id
  ),
  turn_tool_counts AS (
    SELECT
      thread_id,
      turn_id,
      COUNT(*) AS toolCalls
    FROM tool_calls
    GROUP BY thread_id, turn_id
  ),
  thread_usage AS (
    SELECT
      thread_id,
      SUM(inputTokens) AS inputTokens,
      SUM(outputTokens) AS outputTokens,
      SUM(cacheCreationInputTokens) AS cacheCreationInputTokens,
      SUM(cacheReadInputTokens) AS cacheReadInputTokens,
      SUM(totalCostUsd) AS totalCostUsd,
      SUM(durationMs) AS durationMs
    FROM turn_usage
    GROUP BY thread_id
  ),
  message_counts AS (
    SELECT thread_id, COUNT(*) AS messages
    FROM messages
    GROUP BY thread_id
  ),
  tool_counts AS (
    SELECT thread_id, COUNT(*) AS toolCalls
    FROM tool_calls
    GROUP BY thread_id
  )
`;

export function collectUsageStats(db: DatabaseSync): UsageStatsResponse {
  const totalsRow = db.prepare(`
    ${usageCtes}
    SELECT
      (SELECT COUNT(*) FROM projects) AS projects,
      COUNT(t.id) AS threads,
      COALESCE(SUM(mc.messages), 0) AS messages,
      COALESCE(SUM(tc.toolCalls), 0) AS toolCalls,
      COALESCE(SUM(tu.inputTokens), 0) AS inputTokens,
      COALESCE(SUM(tu.outputTokens), 0) AS outputTokens,
      COALESCE(SUM(tu.cacheCreationInputTokens), 0) AS cacheCreationInputTokens,
      COALESCE(SUM(tu.cacheReadInputTokens), 0) AS cacheReadInputTokens,
      COALESCE(SUM(tu.totalCostUsd), 0) AS totalCostUsd,
      COALESCE(SUM(tu.durationMs), 0) AS durationMs
    FROM threads t
    LEFT JOIN thread_usage tu ON tu.thread_id = t.id
    LEFT JOIN message_counts mc ON mc.thread_id = t.id
    LEFT JOIN tool_counts tc ON tc.thread_id = t.id
  `).get() as UsageTotalsRow | undefined;

  const byProviderRows = db.prepare(`
    ${usageCtes}
    SELECT
      t.provider AS provider,
      COALESCE(t.model, '未配置') AS model,
      0 AS projects,
      COUNT(t.id) AS threads,
      COALESCE(SUM(mc.messages), 0) AS messages,
      COALESCE(SUM(tc.toolCalls), 0) AS toolCalls,
      COALESCE(SUM(tu.inputTokens), 0) AS inputTokens,
      COALESCE(SUM(tu.outputTokens), 0) AS outputTokens,
      COALESCE(SUM(tu.cacheCreationInputTokens), 0) AS cacheCreationInputTokens,
      COALESCE(SUM(tu.cacheReadInputTokens), 0) AS cacheReadInputTokens,
      (
        COALESCE(SUM(tu.inputTokens), 0) +
        COALESCE(SUM(tu.outputTokens), 0) +
        COALESCE(SUM(tu.cacheCreationInputTokens), 0) +
        COALESCE(SUM(tu.cacheReadInputTokens), 0)
      ) AS totalTokens,
      COALESCE(SUM(tu.totalCostUsd), 0) AS totalCostUsd,
      COALESCE(SUM(tu.durationMs), 0) AS durationMs,
      MAX(t.updated_at) AS lastUsedAt
    FROM threads t
    LEFT JOIN thread_usage tu ON tu.thread_id = t.id
    LEFT JOIN message_counts mc ON mc.thread_id = t.id
    LEFT JOIN tool_counts tc ON tc.thread_id = t.id
    GROUP BY t.provider, COALESCE(t.model, '未配置')
    ORDER BY totalTokens DESC, threads DESC, provider ASC
  `).all() as UsageProviderSqlRow[];

  const byProjectRows = db.prepare(`
    ${usageCtes}
    SELECT
      p.id AS projectId,
      p.name AS projectName,
      p.path AS projectPath,
      1 AS projects,
      COUNT(t.id) AS threads,
      COALESCE(SUM(mc.messages), 0) AS messages,
      COALESCE(SUM(tc.toolCalls), 0) AS toolCalls,
      COALESCE(SUM(tu.inputTokens), 0) AS inputTokens,
      COALESCE(SUM(tu.outputTokens), 0) AS outputTokens,
      COALESCE(SUM(tu.cacheCreationInputTokens), 0) AS cacheCreationInputTokens,
      COALESCE(SUM(tu.cacheReadInputTokens), 0) AS cacheReadInputTokens,
      COALESCE(SUM(tu.totalCostUsd), 0) AS totalCostUsd,
      COALESCE(SUM(tu.durationMs), 0) AS durationMs,
      MAX(COALESCE(t.updated_at, p.updated_at)) AS lastUsedAt
    FROM projects p
    LEFT JOIN threads t ON t.project_id = p.id
    LEFT JOIN thread_usage tu ON tu.thread_id = t.id
    LEFT JOIN message_counts mc ON mc.thread_id = t.id
    LEFT JOIN tool_counts tc ON tc.thread_id = t.id
    GROUP BY p.id, p.name, p.path
    ORDER BY (COALESCE(SUM(tu.inputTokens), 0) + COALESCE(SUM(tu.outputTokens), 0) + COALESCE(SUM(tu.cacheCreationInputTokens), 0) + COALESCE(SUM(tu.cacheReadInputTokens), 0)) DESC,
      threads DESC,
      p.updated_at DESC
  `).all() as UsageProjectSqlRow[];

  const byThreadRows = db.prepare(`
    ${usageCtes}
    SELECT
      t.id AS threadId,
      t.project_id AS projectId,
      p.name AS projectName,
      COALESCE(NULLIF(t.custom_title, ''), NULLIF(t.title, ''), NULLIF(t.session_id, ''), t.id) AS title,
      COALESCE(t.session_id, '') AS sessionId,
      COALESCE(t.provider, 'unknown') AS provider,
      COALESCE(t.model, '未配置') AS model,
      COALESCE(t.working_directory, '') AS workingDirectory,
      t.updated_at AS updatedAt,
      t.updated_at AS lastUsedAt,
      0 AS projects,
      1 AS threads,
      COALESCE(mc.messages, 0) AS messages,
      COALESCE(tc.toolCalls, 0) AS toolCalls,
      COALESCE(tu.inputTokens, 0) AS inputTokens,
      COALESCE(tu.outputTokens, 0) AS outputTokens,
      COALESCE(tu.cacheCreationInputTokens, 0) AS cacheCreationInputTokens,
      COALESCE(tu.cacheReadInputTokens, 0) AS cacheReadInputTokens,
      COALESCE(tu.totalCostUsd, 0) AS totalCostUsd,
      COALESCE(tu.durationMs, 0) AS durationMs
    FROM threads t
    INNER JOIN projects p ON p.id = t.project_id
    LEFT JOIN thread_usage tu ON tu.thread_id = t.id
    LEFT JOIN message_counts mc ON mc.thread_id = t.id
    LEFT JOIN tool_counts tc ON tc.thread_id = t.id
    ORDER BY COALESCE(tu.totalCostUsd, 0) DESC,
      (COALESCE(tu.inputTokens, 0) + COALESCE(tu.outputTokens, 0) + COALESCE(tu.cacheCreationInputTokens, 0) + COALESCE(tu.cacheReadInputTokens, 0)) DESC,
      t.updated_at DESC
  `).all() as UsageThreadSqlRow[];

  const byDayRows = db.prepare(`
    ${usageCtes}
    SELECT
      td.usageDate AS date,
      COUNT(DISTINCT td.thread_id) AS threads,
      COALESCE(SUM(tmc.messages), 0) AS messages,
      COALESCE(SUM(ttc.toolCalls), 0) AS toolCalls,
      COALESCE(SUM(tu.inputTokens), 0) AS inputTokens,
      COALESCE(SUM(tu.outputTokens), 0) AS outputTokens,
      COALESCE(SUM(tu.cacheCreationInputTokens), 0) AS cacheCreationInputTokens,
      COALESCE(SUM(tu.cacheReadInputTokens), 0) AS cacheReadInputTokens,
      (
        COALESCE(SUM(tu.inputTokens), 0) +
        COALESCE(SUM(tu.outputTokens), 0) +
        COALESCE(SUM(tu.cacheCreationInputTokens), 0) +
        COALESCE(SUM(tu.cacheReadInputTokens), 0)
      ) AS totalTokens,
      COALESCE(SUM(tu.durationMs), 0) AS durationMs,
      COALESCE(SUM(tu.totalCostUsd), 0) AS totalCostUsd,
      0 AS projects
    FROM turn_dates td
    LEFT JOIN turn_usage tu ON tu.thread_id = td.thread_id AND tu.turn_id = td.turn_id
    LEFT JOIN turn_message_counts tmc ON tmc.thread_id = td.thread_id AND tmc.turn_id = td.turn_id
    LEFT JOIN turn_tool_counts ttc ON ttc.thread_id = td.thread_id AND ttc.turn_id = td.turn_id
    WHERE td.usageDate IS NOT NULL
    GROUP BY td.usageDate
    ORDER BY td.usageDate ASC
  `).all() as UsageTrendSqlRow[];

  return {
    generatedAt: new Date().toISOString(),
    totals: normalizeTotals(totalsRow),
    byProvider: byProviderRows.map((row) => ({
      provider: row.provider || 'unknown',
      model: row.model || '未配置',
      lastUsedAt: row.lastUsedAt,
      ...normalizeTotals(row),
    })),
    byProject: byProjectRows.map((row) => ({
      projectId: row.projectId,
      projectName: row.projectName,
      projectPath: row.projectPath,
      lastUsedAt: row.lastUsedAt,
      ...normalizeTotals(row),
    })),
    byThread: byThreadRows.map((row) => ({
      threadId: row.threadId,
      projectId: row.projectId,
      projectName: row.projectName,
      title: row.title || row.threadId,
      sessionId: row.sessionId || '',
      provider: row.provider || 'unknown',
      model: row.model || '未配置',
      workingDirectory: row.workingDirectory || '',
      updatedAt: row.updatedAt,
      lastUsedAt: row.lastUsedAt,
      ...normalizeTotals(row),
    })),
    byDay: byDayRows.map((row) => ({
      date: row.date,
      ...normalizeTotals(row),
    })),
  };
}

function normalizeTotals(row: UsageTotalsRow | undefined): UsageTotals {
  const inputTokens = normalizeNumber(row?.inputTokens);
  const outputTokens = normalizeNumber(row?.outputTokens);
  const cacheCreationInputTokens = normalizeNumber(row?.cacheCreationInputTokens);
  const cacheReadInputTokens = normalizeNumber(row?.cacheReadInputTokens);
  return {
    projects: normalizeNumber(row?.projects),
    threads: normalizeNumber(row?.threads),
    messages: normalizeNumber(row?.messages),
    toolCalls: normalizeNumber(row?.toolCalls),
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
    durationMs: normalizeNumber(row?.durationMs),
    totalCostUsd: normalizeNumber(row?.totalCostUsd),
  };
}

function normalizeNumber(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}
