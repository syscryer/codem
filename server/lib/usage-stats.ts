import type { DatabaseSync } from 'node:sqlite';

export type UsageStatsRangeDays = 1 | 7 | 30 | 90;

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
  providerKey: string;
  host: string | null;
  inferred: boolean;
  lastUsedAt: string | null;
  models: UsageProviderModelRow[];
};

export type UsageProviderModelRow = UsageTotals & {
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
  projectOptions: UsageProjectRow[];
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
      strftime('%Y-%m-%dT%H:%M:%fZ', usageStartedAtMs / 1000.0, 'unixepoch') AS createdAt,
      date(usageStartedAtMs / 1000.0, 'unixepoch', 'localtime') AS usageDate
    FROM (
      SELECT
        thread_id,
        turn_id,
        MIN(
          CASE
            WHEN started_at_ms IS NOT NULL THEN started_at_ms
            ELSE CAST(strftime('%s', created_at) AS INTEGER) * 1000
          END
        ) AS usageStartedAtMs
      FROM messages
      GROUP BY thread_id, turn_id
    )
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

function buildFilteredUsageCtes(startDate: string) {
  return `
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
        strftime('%Y-%m-%dT%H:%M:%fZ', usageStartedAtMs / 1000.0, 'unixepoch') AS createdAt,
        date(usageStartedAtMs / 1000.0, 'unixepoch', 'localtime') AS usageDate
      FROM (
        SELECT
          thread_id,
          turn_id,
          MIN(
            CASE
              WHEN started_at_ms IS NOT NULL THEN started_at_ms
              ELSE CAST(strftime('%s', created_at) AS INTEGER) * 1000
            END
          ) AS usageStartedAtMs
        FROM messages
        GROUP BY thread_id, turn_id
      )
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
    filtered_turn_dates AS (
      SELECT
        thread_id,
        turn_id,
        createdAt,
        usageDate
      FROM turn_dates
      WHERE usageDate IS NOT NULL AND usageDate >= '${startDate}'
    ),
    thread_usage AS (
      SELECT
        tu.thread_id,
        SUM(tu.inputTokens) AS inputTokens,
        SUM(tu.outputTokens) AS outputTokens,
        SUM(tu.cacheCreationInputTokens) AS cacheCreationInputTokens,
        SUM(tu.cacheReadInputTokens) AS cacheReadInputTokens,
        SUM(tu.totalCostUsd) AS totalCostUsd,
        SUM(tu.durationMs) AS durationMs
      FROM turn_usage tu
      INNER JOIN filtered_turn_dates ftd
        ON ftd.thread_id = tu.thread_id AND ftd.turn_id = tu.turn_id
      GROUP BY tu.thread_id
    ),
    message_counts AS (
      SELECT
        tmc.thread_id,
        SUM(tmc.messages) AS messages
      FROM turn_message_counts tmc
      INNER JOIN filtered_turn_dates ftd
        ON ftd.thread_id = tmc.thread_id AND ftd.turn_id = tmc.turn_id
      GROUP BY tmc.thread_id
    ),
    tool_counts AS (
      SELECT
        ttc.thread_id,
        SUM(ttc.toolCalls) AS toolCalls
      FROM turn_tool_counts ttc
      INNER JOIN filtered_turn_dates ftd
        ON ftd.thread_id = ttc.thread_id AND ftd.turn_id = ttc.turn_id
      GROUP BY ttc.thread_id
    ),
    thread_last_used AS (
      SELECT
        thread_id,
        MAX(createdAt) AS lastUsedAt
      FROM filtered_turn_dates
      GROUP BY thread_id
    ),
    active_threads AS (
      SELECT DISTINCT thread_id
      FROM filtered_turn_dates
    )
  `;
}

export function collectUsageStats(
  db: DatabaseSync,
  options?: {
    rangeDays?: UsageStatsRangeDays;
    currentDate?: Date | string;
    projectId?: string;
  },
): UsageStatsResponse {
  const startDate = options?.rangeDays ? buildUsageRangeStartDate(options.rangeDays, options.currentDate) : null;
  const projectId = normalizeProjectId(options?.projectId);
  const projectParams = projectId ? [projectId] : [];
  const threadProjectWhere = projectId ? 'WHERE t.project_id = ?' : '';
  const projectWhere = projectId ? 'WHERE p.id = ?' : '';
  const dayProjectWhere = projectId ? 'AND t.project_id = ?' : '';
  const aggregateCtes = startDate ? buildFilteredUsageCtes(startDate) : usageCtes;
  const totalsFromClause = startDate
    ? `
      FROM active_threads at
      INNER JOIN threads t ON t.id = at.thread_id
      LEFT JOIN thread_usage tu ON tu.thread_id = t.id
      LEFT JOIN message_counts mc ON mc.thread_id = t.id
      LEFT JOIN tool_counts tc ON tc.thread_id = t.id
      ${threadProjectWhere}
    `
    : `
      FROM threads t
      LEFT JOIN thread_usage tu ON tu.thread_id = t.id
      LEFT JOIN message_counts mc ON mc.thread_id = t.id
      LEFT JOIN tool_counts tc ON tc.thread_id = t.id
      ${threadProjectWhere}
    `;
  const totalsProjectsSql = startDate
    ? 'COUNT(DISTINCT t.project_id) AS projects'
    : projectId ? 'COUNT(DISTINCT t.project_id) AS projects' : '(SELECT COUNT(*) FROM projects) AS projects';

  const totalsRow = db.prepare(`
    ${aggregateCtes}
    SELECT
      ${totalsProjectsSql},
      COUNT(t.id) AS threads,
      COALESCE(SUM(mc.messages), 0) AS messages,
      COALESCE(SUM(tc.toolCalls), 0) AS toolCalls,
      COALESCE(SUM(tu.inputTokens), 0) AS inputTokens,
      COALESCE(SUM(tu.outputTokens), 0) AS outputTokens,
      COALESCE(SUM(tu.cacheCreationInputTokens), 0) AS cacheCreationInputTokens,
      COALESCE(SUM(tu.cacheReadInputTokens), 0) AS cacheReadInputTokens,
      COALESCE(SUM(tu.totalCostUsd), 0) AS totalCostUsd,
      COALESCE(SUM(tu.durationMs), 0) AS durationMs
      ${totalsFromClause}
  `).get(...projectParams) as UsageTotalsRow | undefined;

  const byProviderRows = db.prepare(`
    ${aggregateCtes}
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
      MAX(${startDate ? 'tlu.lastUsedAt' : 't.updated_at'}) AS lastUsedAt
    ${startDate ? 'FROM active_threads at INNER JOIN threads t ON t.id = at.thread_id' : 'FROM threads t'}
    LEFT JOIN thread_usage tu ON tu.thread_id = t.id
    LEFT JOIN message_counts mc ON mc.thread_id = t.id
    LEFT JOIN tool_counts tc ON tc.thread_id = t.id
    ${startDate ? 'LEFT JOIN thread_last_used tlu ON tlu.thread_id = t.id' : ''}
    ${threadProjectWhere}
    GROUP BY t.provider, COALESCE(t.model, '未配置')
    ORDER BY totalTokens DESC, threads DESC, provider ASC
  `).all(...projectParams) as UsageProviderSqlRow[];

  const byProjectRows = db.prepare(`
    ${aggregateCtes}
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
      MAX(${startDate ? 'tlu.lastUsedAt' : 'COALESCE(t.updated_at, p.updated_at)'}) AS lastUsedAt
    ${
      startDate
        ? 'FROM active_threads at INNER JOIN threads t ON t.id = at.thread_id INNER JOIN projects p ON p.id = t.project_id'
        : 'FROM projects p LEFT JOIN threads t ON t.project_id = p.id'
    }
    LEFT JOIN thread_usage tu ON tu.thread_id = t.id
    LEFT JOIN message_counts mc ON mc.thread_id = t.id
    LEFT JOIN tool_counts tc ON tc.thread_id = t.id
    ${startDate ? 'LEFT JOIN thread_last_used tlu ON tlu.thread_id = t.id' : ''}
    ${projectWhere}
    GROUP BY p.id, p.name, p.path
    ORDER BY (COALESCE(SUM(tu.inputTokens), 0) + COALESCE(SUM(tu.outputTokens), 0) + COALESCE(SUM(tu.cacheCreationInputTokens), 0) + COALESCE(SUM(tu.cacheReadInputTokens), 0)) DESC,
      threads DESC,
      p.updated_at DESC
  `).all(...projectParams) as UsageProjectSqlRow[];

  const projectOptionRows = db.prepare(`
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
    ${aggregateCtes}
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
      ${startDate ? 'tlu.lastUsedAt' : 't.updated_at'} AS lastUsedAt,
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
    ${startDate ? 'FROM active_threads at INNER JOIN threads t ON t.id = at.thread_id' : 'FROM threads t'}
    INNER JOIN projects p ON p.id = t.project_id
    LEFT JOIN thread_usage tu ON tu.thread_id = t.id
    LEFT JOIN message_counts mc ON mc.thread_id = t.id
    LEFT JOIN tool_counts tc ON tc.thread_id = t.id
    ${startDate ? 'LEFT JOIN thread_last_used tlu ON tlu.thread_id = t.id' : ''}
    ${threadProjectWhere}
    ORDER BY COALESCE(tu.totalCostUsd, 0) DESC,
      (COALESCE(tu.inputTokens, 0) + COALESCE(tu.outputTokens, 0) + COALESCE(tu.cacheCreationInputTokens, 0) + COALESCE(tu.cacheReadInputTokens, 0)) DESC,
      t.updated_at DESC
  `).all(...projectParams) as UsageThreadSqlRow[];

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
    INNER JOIN threads t ON t.id = td.thread_id
    LEFT JOIN turn_usage tu ON tu.thread_id = td.thread_id AND tu.turn_id = td.turn_id
    LEFT JOIN turn_message_counts tmc ON tmc.thread_id = td.thread_id AND tmc.turn_id = td.turn_id
    LEFT JOIN turn_tool_counts ttc ON ttc.thread_id = td.thread_id AND ttc.turn_id = td.turn_id
    WHERE td.usageDate IS NOT NULL
      ${dayProjectWhere}
    GROUP BY td.usageDate
    ORDER BY td.usageDate ASC
  `).all(...projectParams) as UsageTrendSqlRow[];

  return {
    generatedAt: new Date().toISOString(),
    totals: normalizeTotals(totalsRow),
    projectOptions: projectOptionRows.map(normalizeProjectRow),
    byProvider: buildProviderRows(byProviderRows),
    byProject: byProjectRows.map(normalizeProjectRow),
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

function normalizeProjectRow(row: UsageProjectSqlRow): UsageProjectRow {
  return {
    projectId: row.projectId,
    projectName: row.projectName,
    projectPath: row.projectPath,
    lastUsedAt: row.lastUsedAt,
    ...normalizeTotals(row),
  };
}

function buildProviderRows(rows: UsageProviderSqlRow[]): UsageProviderRow[] {
  const groups = new Map<
    string,
    {
      provider: string;
      providerKey: string;
      host: string | null;
      inferred: boolean;
      lastUsedAt: string | null;
      totals: UsageTotals;
      models: UsageProviderModelRow[];
    }
  >();

  rows.forEach((row) => {
    const model = row.model || '未配置';
    const providerInfo = inferUsageProvider(row.provider || 'unknown', model);
    const groupKey = `${providerInfo.providerKey}:${providerInfo.host ?? ''}:${providerInfo.provider}`;
    const totals = normalizeTotals(row);
    const existing =
      groups.get(groupKey) ??
      {
        provider: providerInfo.provider,
        providerKey: providerInfo.providerKey,
        host: providerInfo.host,
        inferred: providerInfo.inferred,
        lastUsedAt: null,
        totals: createEmptyTotals(),
        models: [],
      };

    existing.totals = mergeTotals(existing.totals, totals);
    existing.lastUsedAt = latestIsoDate(existing.lastUsedAt, row.lastUsedAt);
    existing.models.push({
      model,
      lastUsedAt: row.lastUsedAt,
      ...totals,
    });
    groups.set(groupKey, existing);
  });

  return Array.from(groups.values())
    .map((group) => ({
      provider: group.provider,
      providerKey: group.providerKey,
      host: group.host,
      inferred: group.inferred,
      lastUsedAt: group.lastUsedAt,
      models: group.models.sort(sortUsageTotalsDesc),
      ...group.totals,
    }))
    .sort(sortProviderRows);
}

function inferUsageProvider(rawProvider: string, model: string) {
  const normalizedModel = model.trim().toLowerCase();
  const normalizedProvider = rawProvider.trim().toLowerCase();

  if (/\b(glm|zhipu|bigmodel)\b/i.test(normalizedModel)) {
    return {
      provider: '智谱 GLM',
      providerKey: 'zhipu',
      host: 'open.bigmodel.cn',
      inferred: true,
    };
  }

  if (/\bmimo\b/i.test(normalizedModel)) {
    return {
      provider: 'Mimo',
      providerKey: 'mimo',
      host: null,
      inferred: true,
    };
  }

  if (/\bminimax\b/i.test(normalizedModel)) {
    return {
      provider: 'MiniMax',
      providerKey: 'minimax',
      host: 'api.minimaxi.com',
      inferred: true,
    };
  }

  if (/\b(claude|sonnet|opus|haiku)\b/i.test(normalizedModel)) {
    return {
      provider: 'Anthropic / Claude',
      providerKey: 'anthropic',
      host: 'api.anthropic.com',
      inferred: true,
    };
  }

  if (/\bdeepseek\b/i.test(normalizedModel)) {
    return {
      provider: 'DeepSeek',
      providerKey: 'deepseek',
      host: 'api.deepseek.com',
      inferred: true,
    };
  }

  if (/\b(qwen|dashscope|tongyi)\b/i.test(normalizedModel)) {
    return {
      provider: '阿里 DashScope',
      providerKey: 'dashscope',
      host: 'dashscope.aliyuncs.com',
      inferred: true,
    };
  }

  if (/\bopenrouter\b/i.test(normalizedModel)) {
    return {
      provider: 'OpenRouter',
      providerKey: 'openrouter',
      host: 'openrouter.ai',
      inferred: true,
    };
  }

  if (normalizedProvider && normalizedProvider !== 'claude-code') {
    return {
      provider: formatProviderName(rawProvider),
      providerKey: normalizedProvider,
      host: null,
      inferred: false,
    };
  }

  return {
    provider: 'Claude Code',
    providerKey: 'claude-code',
    host: null,
    inferred: false,
  };
}

function createEmptyTotals(): UsageTotals {
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

function mergeTotals(current: UsageTotals, next: UsageTotals): UsageTotals {
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

function sortUsageTotalsDesc(left: UsageTotals, right: UsageTotals) {
  return right.totalTokens - left.totalTokens || right.threads - left.threads;
}

function sortProviderRows(left: UsageProviderRow, right: UsageProviderRow) {
  return (
    right.totalTokens - left.totalTokens ||
    right.threads - left.threads ||
    left.provider.localeCompare(right.provider, 'zh-CN')
  );
}

function latestIsoDate(current: string | null, next: string | null) {
  if (!current) {
    return next;
  }

  if (!next) {
    return current;
  }

  return next > current ? next : current;
}

function formatProviderName(provider: string) {
  const normalized = provider.trim();
  return normalized || 'unknown';
}

function normalizeNumber(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function normalizeProjectId(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function buildUsageRangeStartDate(rangeDays: UsageStatsRangeDays, currentDate?: Date | string) {
  const date = currentDate ? new Date(currentDate) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error('无效的 usage 统计时间。');
  }

  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (rangeDays - 1));
  return toIsoDate(date);
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}
