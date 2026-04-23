import { permissionModes } from '../constants';
import type {
  AssistantItem,
  ClaudeEvent,
  ConversationTurn,
  ThreadDetail,
  ThreadSummary,
  ToolStep,
  UsageSnapshot,
} from '../types';

export function createThreadDetail(summary: ThreadSummary): ThreadDetail {
  return {
    ...summary,
    turns: [],
    debugEvents: [],
    rawEvents: [],
    historyLoaded: false,
    historyLoading: false,
  };
}

export function isPermissionMode(value: unknown): value is (typeof permissionModes)[number] {
  return typeof value === 'string' && permissionModes.includes(value as (typeof permissionModes)[number]);
}

export function closeDanglingTurns(turns: ConversationTurn[]) {
  return turns.map((turn) =>
    turn.status === 'pending' || turn.status === 'running'
      ? closeTurnWithoutTerminalEvent(turn)
      : turn,
  );
}

export function closeTurnWithoutTerminalEvent(turn: ConversationTurn): ConversationTurn {
  const hasVisibleOutput = hasTurnVisibleOutput(turn);

  return {
    ...turn,
    ...settleRunningToolSteps(turn, hasVisibleOutput ? 'done' : 'error'),
    status: hasVisibleOutput ? 'done' : 'stopped',
    phase: undefined,
    durationMs: turn.durationMs ?? getElapsedDuration(turn),
    activity: hasVisibleOutput ? '运行完成' : '运行结束但没有返回正文',
  };
}

export function normalizeTurnsForPersist(turns: ConversationTurn[]) {
  return turns.map((turn) => {
    if (turn.status !== 'pending' && turn.status !== 'running') {
      return turn;
    }

    return closeTurnWithoutTerminalEvent(turn);
  });
}

export function hasTurnVisibleOutput(turn: ConversationTurn) {
  return Boolean(
    turn.assistantText.trim() ||
      turn.items.length > 0 ||
      turn.tools.length > 0 ||
      turn.outputTokens ||
      turn.metrics,
  );
}

export function createToolStep(event: Extract<ClaudeEvent, { type: 'tool-start' }>): ToolStep {
  const inputText = formatInitialToolInput(event.input);
  const id = event.toolUseId ?? `${event.runId}-${event.blockIndex}`;

  return {
    id,
    name: event.name,
    title: describeToolCall(event.name, inputText),
    status: 'running',
    blockIndex: event.blockIndex,
    toolUseId: event.toolUseId,
    inputText,
  };
}

export function upsertToolStep(steps: ToolStep[], step: ToolStep) {
  const index = steps.findIndex((item) => item.id === step.id);
  if (index === -1) {
    return [...steps, step];
  }

  const next = [...steps];
  next[index] = { ...next[index], ...step };
  return next;
}

export function appendTextItem(items: AssistantItem[], text: string): AssistantItem[] {
  const last = items.at(-1);
  if (last?.type === 'text') {
    return [
      ...items.slice(0, -1),
      {
        ...last,
        text: `${last.text}${text}`,
      },
    ];
  }

  return [...items, { id: crypto.randomUUID(), type: 'text', text }];
}

export function syncToolItem(items: AssistantItem[], step: ToolStep): AssistantItem[] {
  const index = items.findIndex((item) => item.type === 'tool' && item.tool.id === step.id);
  if (index === -1) {
    return [...items, { id: step.id, type: 'tool', tool: step }];
  }

  const next = [...items];
  next[index] = { id: step.id, type: 'tool', tool: step };
  return next;
}

export function upsertToolDelta(steps: ToolStep[], event: Extract<ClaudeEvent, { type: 'tool-input-delta' }>) {
  const index = steps.findIndex((item) => matchesToolBlock(item, event.blockIndex));
  if (index === -1) {
    return [
      ...steps,
      {
        id: `${event.runId}-${event.blockIndex}`,
        name: 'tool',
        title: '工具参数流',
        status: 'running' as const,
        blockIndex: event.blockIndex,
        inputText: event.text,
      },
    ];
  }

  const next = [...steps];
  const item = next[index];
  const inputText = `${item.inputText ?? ''}${event.text}`;
  next[index] = {
    ...item,
    inputText,
    title: describeToolCall(item.name, inputText),
  };
  return next;
}

export function attachToolResult(steps: ToolStep[], event: Extract<ClaudeEvent, { type: 'tool-result' }>) {
  const index = steps.findIndex((item) => item.toolUseId && item.toolUseId === event.toolUseId);
  if (index === -1) {
    return [
      ...steps,
      {
        id: event.toolUseId ?? crypto.randomUUID(),
        name: 'tool_result',
        title: event.isError ? '工具返回异常' : '工具返回结果',
        status: event.isError ? ('error' as const) : ('done' as const),
        toolUseId: event.toolUseId,
        resultText: event.content,
        isError: event.isError,
      },
    ];
  }

  const next = [...steps];
  next[index] = {
    ...next[index],
    status: event.isError ? 'error' : 'done',
    resultText: event.content,
    isError: event.isError,
  };
  return next;
}

export function settleRunningToolSteps(
  turn: ConversationTurn,
  nextStatus: Exclude<ToolStep['status'], 'running'>,
) {
  const tools = turn.tools.map((tool) =>
    tool.status === 'running'
      ? {
          ...tool,
          status: nextStatus,
        }
      : tool,
  );

  const items = turn.items.map((item) =>
    item.type === 'tool' && item.tool.status === 'running'
      ? {
          ...item,
          tool: {
            ...item.tool,
            status: nextStatus,
          },
        }
      : item,
  );

  return {
    tools,
    items,
  };
}

export function mergeUsageSnapshot(turn: ConversationTurn, snapshot: UsageSnapshot): Partial<ConversationTurn> {
  return {
    inputTokens: snapshot.inputTokens ?? turn.inputTokens,
    outputTokens: snapshot.outputTokens ?? turn.outputTokens,
    cacheCreationInputTokens: snapshot.cacheCreationInputTokens ?? turn.cacheCreationInputTokens,
    cacheReadInputTokens: snapshot.cacheReadInputTokens ?? turn.cacheReadInputTokens,
  };
}

export function getElapsedDuration(turn: ConversationTurn) {
  if (!turn.startedAtMs) {
    return undefined;
  }

  return Math.max(0, Date.now() - turn.startedAtMs);
}

export function matchesToolBlock(tool: ToolStep, blockIndex: number) {
  return tool.blockIndex === blockIndex;
}

export function shouldHideToolStep(tool: ToolStep) {
  const hasDetails = Boolean(tool.inputText?.trim() || tool.resultText?.trim());
  if (hasDetails) {
    return false;
  }

  return tool.title === getReadableToolName(tool.name);
}

export function summarizeToolResult(event: Extract<ClaudeEvent, { type: 'tool-result' }>) {
  return event.isError ? 'Error' : 'Done';
}

export function summarizeToolRow(tool: ToolStep) {
  if (tool.resultText?.trim()) {
    const firstLine = extractToolResultSummary(tool.resultText);
    return tool.isError ? `Error: ${firstLine}` : firstLine;
  }

  if (tool.status === 'running') {
    return 'Running';
  }

  return tool.status === 'error' ? 'Error' : 'Done';
}

export function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${seconds}s`;
}

export function formatMetrics(event: Extract<ClaudeEvent, { type: 'done' }>) {
  const metrics: string[] = [];
  if (typeof event.totalCostUsd === 'number') {
    metrics.push(`花费 $${event.totalCostUsd.toFixed(4)}`);
  }
  if (typeof event.durationMs === 'number') {
    metrics.push(`耗时 ${(event.durationMs / 1000).toFixed(1)}s`);
  }
  if (typeof event.outputTokens === 'number') {
    metrics.push(`输出 ${event.outputTokens} tokens`);
  }

  return metrics.join('，');
}

export function formatJson(value: unknown) {
  if (value == null || value === '') {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function describeToolCall(name: string, inputText?: string) {
  const input = parseLooseJson(inputText);
  const filePath = getString(input, ['file_path', 'path', 'notebook_path']);
  const pattern = getString(input, ['pattern', 'query']);
  const command = getString(input, ['command', 'cmd', 'cmdString']);

  if (name === 'Read' && filePath) {
    return `Read(${compactToolArgument(filePath)})`;
  }

  if (name === 'Grep' && pattern) {
    return `Grep(${compactToolArgument(pattern)})`;
  }

  if (name === 'Glob' && pattern) {
    return `Glob(${compactToolArgument(pattern)})`;
  }

  if (name === 'Bash' && command) {
    return `Bash(${compactToolArgument(command)})`;
  }

  if ((name === 'Edit' || name === 'Write' || name === 'NotebookEdit') && filePath) {
    return `${name}(${compactToolArgument(filePath)})`;
  }

  if (name.startsWith('mcp__')) {
    return `MCP(${getReadableToolName(name)})`;
  }

  return getReadableToolName(name);
}

function getReadableToolName(name: string) {
  if (name.startsWith('mcp__')) {
    const segments = name.split('__').filter(Boolean);
    return segments.at(-1) ?? name;
  }

  return name;
}

function extractToolResultSummary(text: string) {
  const clean = text.replace(/\r/g, '').trim();
  const exitMatch = clean.match(/Error:\s*Exit code\s*(\d+)/i);
  if (exitMatch) {
    return `Exit code ${exitMatch[1]}`;
  }

  const lines = clean
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const line = lines.find((item) => !item.startsWith('```')) ?? lines[0] ?? clean;
  return summarizeText(line);
}

function summarizeText(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) {
    return '无输出';
  }

  return clean.length > 80 ? `${clean.slice(0, 80)}...` : clean;
}

function compactToolArgument(value: string) {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= 96) {
    return clean;
  }

  return `${clean.slice(0, 93)}...`;
}

function formatInitialToolInput(value: unknown) {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  ) {
    return '';
  }

  return formatJson(value);
}

function parseLooseJson(value?: string) {
  if (!value?.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function getString(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}
