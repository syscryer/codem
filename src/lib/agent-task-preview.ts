import type { ToolStep } from '../types.js';

export type AgentTaskStatusTone = 'running' | 'completed' | 'error';

export type AgentTaskIdentifier = {
  label: string;
  value: string;
};

export type AgentTaskChildToolPreview = {
  id: string;
  title: string;
  status: ToolStep['status'];
  statusLabel: string;
  summary: string;
};

export type AgentTaskPreviewData = {
  summary: string;
  agentType: string;
  taskDescription: string;
  promptText: string;
  statusLabel: string;
  statusTone: AgentTaskStatusTone;
  metrics: string[];
  identifiers: AgentTaskIdentifier[];
  files: string[];
  resultText: string;
  subMessages: string[];
  subtools: AgentTaskChildToolPreview[];
  hiddenSubtoolCount: number;
};

type UsageMetrics = {
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
};

export function buildAgentTaskPreview(tool: ToolStep): AgentTaskPreviewData | null {
  if (!isAgentTaskToolName(tool.name)) {
    return null;
  }

  const input = parseToolInput(tool.inputText);
  const usage = parseUsageMetrics(tool.resultText);
  const resultText = stripUsageBlock(tool.resultText ?? '').trim();
  const files = extractAgentResultFiles(resultText);
  const metrics = formatAgentMetrics(usage, files.length, tool.subtools?.length ?? 0);
  const statusTone = getAgentStatusTone(tool, resultText);
  const statusLabel = getAgentStatusLabel(statusTone);
  const agentType = readString(input, ['subagent_type', 'agent', 'agent_name', 'name', 'type']) ?? 'Agent';
  const taskDescription =
    readString(input, ['description', 'task', 'summary', 'query']) ??
    summarizePlainText(resultText, 120);
  const promptText = readString(input, ['prompt']) ?? taskDescription;
  const identifiers = buildAgentIdentifiers(tool, input);
  const subtoolPreview = buildChildToolPreviews(tool.subtools ?? []);

  return {
    summary: formatAgentTaskSummary(statusLabel, metrics, files.length),
    agentType,
    taskDescription,
    promptText,
    statusLabel,
    statusTone,
    metrics,
    identifiers,
    files,
    resultText,
    subMessages: tool.subMessages?.filter((message) => message.trim()) ?? [],
    subtools: subtoolPreview.items,
    hiddenSubtoolCount: subtoolPreview.hiddenCount,
  };
}

export function isAgentTaskToolName(name: string) {
  const normalizedName = normalizeRuntimeToolName(name);
  return normalizedName === 'agent' || normalizedName === 'task';
}

function normalizeRuntimeToolName(name: string) {
  return name.replace(/[\s_-]/g, '').toLowerCase();
}

function parseToolInput(value?: string): Record<string, unknown> | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readString(input: Record<string, unknown> | null, keys: string[]) {
  if (!input) {
    return undefined;
  }

  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function buildAgentIdentifiers(tool: ToolStep, input: Record<string, unknown> | null) {
  const identifiers: AgentTaskIdentifier[] = [];
  const taskId = readString(input, ['taskId', 'task_id', 'id']);
  if (taskId) {
    identifiers.push({ label: 'taskId', value: taskId });
  }
  if (tool.toolUseId) {
    identifiers.push({ label: 'toolUseId', value: tool.toolUseId });
  }
  return identifiers;
}

function buildChildToolPreviews(tools: ToolStep[]) {
  const items: AgentTaskChildToolPreview[] = [];
  let hiddenCount = 0;

  for (const tool of tools) {
    if (isSuccessfulOrphanToolResult(tool)) {
      hiddenCount += 1;
      continue;
    }

    items.push(formatChildToolPreview(tool));
  }

  return { items, hiddenCount };
}

function isSuccessfulOrphanToolResult(tool: ToolStep) {
  return normalizeRuntimeToolName(tool.name) === 'toolresult' && tool.status !== 'error' && !tool.isError;
}

function formatChildToolPreview(tool: ToolStep): AgentTaskChildToolPreview {
  return {
    id: tool.id,
    title: tool.title || tool.name,
    status: tool.status,
    statusLabel: getToolStatusLabel(tool),
    summary: summarizeChildTool(tool),
  };
}

function summarizeChildTool(tool: ToolStep) {
  if (tool.resultText?.trim()) {
    const firstLine = tool.resultText
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean);
    if (firstLine) {
      return summarizePlainText(firstLine, 90);
    }
  }

  if (tool.inputText?.trim()) {
    return summarizePlainText(tool.inputText, 90);
  }

  return getToolStatusLabel(tool);
}

function getToolStatusLabel(tool: ToolStep) {
  if (tool.status === 'running') {
    return '运行中';
  }
  return tool.status === 'error' || tool.isError ? '失败' : '完成';
}

function getAgentStatusTone(tool: ToolStep, resultText: string): AgentTaskStatusTone {
  if (tool.status === 'error' || tool.isError) {
    return 'error';
  }
  if (tool.status === 'running' || !resultText.trim()) {
    return 'running';
  }
  return 'completed';
}

function getAgentStatusLabel(status: AgentTaskStatusTone) {
  switch (status) {
    case 'running':
      return '运行中';
    case 'error':
      return '失败';
    case 'completed':
      return '完成';
  }
}

function formatAgentTaskSummary(statusLabel: string, metrics: string[], fileCount: number) {
  const details = metrics.length > 0 ? metrics : fileCount > 0 ? [`${fileCount} 个文件`] : [];
  return details.length ? `${statusLabel}子任务 · ${details.join(' · ')}` : `${statusLabel}子任务`;
}

function formatAgentMetrics(usage: UsageMetrics, fileCount: number, subtoolCount: number) {
  const metrics: string[] = [];
  if (typeof usage.toolUses === 'number') {
    metrics.push(`${usage.toolUses} 个工具`);
  } else if (subtoolCount > 0) {
    metrics.push(`${subtoolCount} 个工具`);
  }
  if (typeof usage.totalTokens === 'number') {
    metrics.push(formatUsageTokenCount(usage.totalTokens));
  }
  if (typeof usage.durationMs === 'number') {
    metrics.push(formatUsageDuration(usage.durationMs));
  }
  if (metrics.length === 0 && fileCount > 0) {
    metrics.push(`${fileCount} 个文件`);
  }
  return metrics;
}

function parseUsageMetrics(value?: string): UsageMetrics {
  const usageBlockMatch = value?.match(/<usage>([\s\S]*?)<\/usage>/i);
  if (!usageBlockMatch) {
    return {};
  }

  const result: UsageMetrics = {};
  const lines = usageBlockMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    const numericValue = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(numericValue)) {
      continue;
    }

    if (key === 'total_tokens') {
      result.totalTokens = numericValue;
    } else if (key === 'tool_uses') {
      result.toolUses = numericValue;
    } else if (key === 'duration_ms') {
      result.durationMs = numericValue;
    }
  }

  return result;
}

function stripUsageBlock(value: string) {
  return value.replace(/<usage>[\s\S]*?<\/usage>/gi, '').trim();
}

function extractAgentResultFiles(resultText: string) {
  const files: string[] = [];
  const seen = new Set<string>();
  const lines = resultText
    .split(/\r?\n/)
    .map((line) => normalizeAgentResultLine(line))
    .filter(Boolean);

  for (const line of lines) {
    if (!isLikelyFilePath(line) || seen.has(line)) {
      continue;
    }

    seen.add(line);
    files.push(line);
    if (files.length >= 12) {
      break;
    }
  }

  return files;
}

function normalizeAgentResultLine(line: string) {
  return line
    .trim()
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^`+|`+$/g, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

function isLikelyFilePath(value: string) {
  if (!value || value.length > 180 || /\s{2,}/.test(value)) {
    return false;
  }

  return /^(?:[\w.@()[\]-]+[\\/])*[\w .@()[\]-]+\.[A-Za-z0-9]{1,8}$/.test(value);
}

function summarizePlainText(value: string, maxLength: number) {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) {
    return '无输出';
  }

  return clean.length > maxLength ? `${clean.slice(0, maxLength - 3)}...` : clean;
}

function formatUsageTokenCount(value: number) {
  if (value < 1000) {
    return `${value} tokens`;
  }

  const compact = (value / 1000).toFixed(1);
  return `${compact.endsWith('.0') ? compact.slice(0, -2) : compact}k tokens`;
}

function formatUsageDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }

  return parts.join(' ');
}
