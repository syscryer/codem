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

export function repairConversationTurn(turn: ConversationTurn): ConversationTurn {
  const repairedItems = repairTurnItems(turn.items);
  if (repairedItems === turn.items) {
    return turn;
  }

  const repairedToolInputs = new Map<string, string | undefined>();
  for (const item of repairedItems) {
    if (item.type === 'tool') {
      repairedToolInputs.set(item.tool.id, item.tool.inputText);
    }
  }

  let toolsChanged = false;
  const repairedTools = turn.tools.map((tool) => {
    const nextInputText = repairedToolInputs.get(tool.id);
    if (nextInputText === undefined || nextInputText === tool.inputText) {
      return tool;
    }

    toolsChanged = true;
    return {
      ...tool,
      inputText: nextInputText,
    };
  });

  return {
    ...turn,
    items: repairedItems,
    tools: toolsChanged ? repairedTools : turn.tools,
  };
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
  const index = findLatestToolIndex(steps, event.blockIndex);
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

export function findLatestToolIndex(steps: ToolStep[], blockIndex: number) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const tool = steps[index];
    if (tool.status === 'running' && matchesToolBlock(tool, blockIndex)) {
      return index;
    }
  }

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const tool = steps[index];
    if (matchesToolBlock(tool, blockIndex)) {
      return index;
    }
  }

  return -1;
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

type ToolInputChunk = {
  raw: string;
  parsed: Record<string, unknown>;
};

function repairTurnItems(items: AssistantItem[]) {
  const toolEntries = items
    .map((item, index) =>
      item.type === 'tool'
        ? {
            index,
            tool: item.tool,
            chunks: splitToolInputChunks(item.tool.inputText),
          }
        : null,
    )
    .filter(Boolean) as Array<{ index: number; tool: ToolStep; chunks: ToolInputChunk[] }>;
  const repairCandidates = toolEntries.filter(({ tool, chunks }) => !tool.inputText?.trim() || chunks.length > 1);
  const hasCombinedInput = toolEntries.some(({ chunks }) => chunks.length > 1);

  if (!hasCombinedInput || repairCandidates.length <= 1) {
    return items;
  }

  const chunks = repairCandidates.flatMap(({ chunks }) => chunks);
  if (chunks.length < repairCandidates.length) {
    return items;
  }

  const repairedItems = [...items];
  const used = new Set<number>();
  let changed = false;

  repairCandidates.forEach(({ index, tool }, candidateIndex) => {
    const matchedChunkIndex = findMatchingChunkIndex(tool.name, chunks, used, candidateIndex);
    if (matchedChunkIndex === -1) {
      return;
    }

    const nextInputText = chunks[matchedChunkIndex].raw;
    if (nextInputText === tool.inputText) {
      used.add(matchedChunkIndex);
      return;
    }

    used.add(matchedChunkIndex);
    changed = true;
    repairedItems[index] = {
      ...repairedItems[index],
      tool: {
        ...tool,
        inputText: nextInputText,
      },
    } as AssistantItem;
  });

  return changed ? repairedItems : items;
}

function splitToolInputChunks(inputText?: string) {
  if (!inputText?.trim()) {
    return [];
  }

  const direct = parseLooseJson(inputText);
  if (direct) {
    return [{ raw: inputText, parsed: direct as Record<string, unknown> }];
  }

  const chunks: ToolInputChunk[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < inputText.length; index += 1) {
    const char = inputText[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char !== '}') {
      continue;
    }

    depth -= 1;
    if (depth !== 0 || start === -1) {
      continue;
    }

    const raw = inputText.slice(start, index + 1);
    try {
      chunks.push({
        raw,
        parsed: JSON.parse(raw) as Record<string, unknown>,
      });
    } catch {
      return [];
    }
    start = -1;
  }

  return chunks;
}

function findMatchingChunkIndex(
  toolName: string,
  chunks: ToolInputChunk[],
  used: Set<number>,
  fallbackIndex: number,
) {
  for (let index = 0; index < chunks.length; index += 1) {
    if (used.has(index)) {
      continue;
    }

    if (doesChunkMatchTool(toolName, chunks[index].parsed)) {
      return index;
    }
  }

  for (let index = fallbackIndex; index < chunks.length; index += 1) {
    if (!used.has(index)) {
      return index;
    }
  }

  return -1;
}

function doesChunkMatchTool(toolName: string, parsed: Record<string, unknown>) {
  if (toolName === 'Bash') {
    return typeof parsed.command === 'string' || typeof parsed.cmd === 'string' || typeof parsed.cmdString === 'string';
  }

  if (toolName === 'Grep' || toolName === 'Glob') {
    return typeof parsed.pattern === 'string' || typeof parsed.query === 'string';
  }

  if (toolName === 'Read') {
    return typeof parsed.file_path === 'string' && !('old_string' in parsed) && !('new_string' in parsed);
  }

  if (toolName === 'Edit' || toolName === 'NotebookEdit') {
    return 'old_string' in parsed || 'new_string' in parsed || 'diff' in parsed || 'patch' in parsed;
  }

  if (toolName === 'Write') {
    return typeof parsed.file_path === 'string' && ('content' in parsed || 'diff' in parsed || 'patch' in parsed);
  }

  return false;
}
