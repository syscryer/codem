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

  const repairedToolsById = new Map<string, ToolStep>();
  for (const item of repairedItems) {
    if (item.type === 'tool') {
      repairedToolsById.set(item.tool.id, item.tool);
    }
  }

  let toolsChanged = false;
  const repairedTools = turn.tools.map((tool) => {
    const nextTool = repairedToolsById.get(tool.id);
    if (!nextTool) {
      return tool;
    }

    const next = {
      ...tool,
      inputText: nextTool.inputText,
      resultText: nextTool.resultText,
      status: nextTool.status,
      isError: nextTool.isError,
      title: nextTool.title,
    };
    if (
      next.inputText === tool.inputText &&
      next.resultText === tool.resultText &&
      next.status === tool.status &&
      next.isError === tool.isError &&
      next.title === tool.title
    ) {
      return tool;
    }

    toolsChanged = true;
    return next;
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
      turn.items.some((item) => (item.type === 'text' ? item.text.trim() : item.type === 'tool')) ||
      turn.tools.length > 0,
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
    parentToolUseId: event.parentToolUseId,
    isSidechain: event.isSidechain,
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

export function upsertToolStepDeep(steps: ToolStep[], step: ToolStep) {
  if (!step.parentToolUseId) {
    return upsertToolStep(steps, step);
  }

  const attached = updateToolTree(steps, step.parentToolUseId, (parent) => ({
    ...parent,
    subtools: upsertToolStep(parent.subtools ?? [], step),
  }));

  return attached.changed ? attached.tools : upsertToolStep(steps, step);
}

export function upsertSubagentText(steps: ToolStep[], parentToolUseId: string | undefined, text: string) {
  if (!parentToolUseId || !text) {
    return steps;
  }

  const attached = updateToolTree(steps, parentToolUseId, (parent) => {
    const subMessages = [...(parent.subMessages ?? [])];
    const lastIndex = subMessages.length - 1;
    if (lastIndex >= 0) {
      subMessages[lastIndex] = `${subMessages[lastIndex]}${text}`;
    } else {
      subMessages.push(text);
    }

    return {
      ...parent,
      subMessages,
    };
  });

  return attached.changed ? attached.tools : steps;
}

export function upsertToolDeltaDeep(steps: ToolStep[], event: Extract<ClaudeEvent, { type: 'tool-input-delta' }>) {
  if (!event.parentToolUseId) {
    return upsertToolDelta(steps, event);
  }

  const attached = updateToolTree(steps, event.parentToolUseId, (parent) => ({
    ...parent,
    subtools: upsertToolDelta(parent.subtools ?? [], event),
  }));

  return attached.changed ? attached.tools : steps;
}

export function attachToolResultDeep(steps: ToolStep[], event: Extract<ClaudeEvent, { type: 'tool-result' }>) {
  if (!event.parentToolUseId) {
    return attachToolResult(steps, event);
  }

  const attached = updateToolTree(steps, event.parentToolUseId, (parent) => ({
    ...parent,
    subtools: attachToolResult(parent.subtools ?? [], event),
  }));

  return attached.changed ? attached.tools : attachToolResult(steps, event);
}

export function settleToolStopDeep(steps: ToolStep[], event: Extract<ClaudeEvent, { type: 'tool-stop' }>) {
  if (!event.parentToolUseId) {
    return settleToolStop(steps, event);
  }

  const attached = updateToolTree(steps, event.parentToolUseId, (parent) => ({
    ...parent,
    subtools: settleToolStop(parent.subtools ?? [], event),
  }));

  return attached.changed ? attached.tools : steps;
}

export function findToolByUseId(steps: ToolStep[], toolUseId?: string): ToolStep | undefined {
  if (!toolUseId) {
    return undefined;
  }

  for (const tool of steps) {
    if (tool.toolUseId === toolUseId || tool.id === toolUseId) {
      return tool;
    }

    const child = findToolByUseId(tool.subtools ?? [], toolUseId);
    if (child) {
      return child;
    }
  }

  return undefined;
}

export function findParentToolForEvent(steps: ToolStep[], event: { parentToolUseId?: string }) {
  return findToolByUseId(steps, event.parentToolUseId);
}

export function appendTextItem(items: AssistantItem[], text: string): AssistantItem[] {
  if (!text) {
    return items;
  }

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

export function appendThinkingItem(items: AssistantItem[], text: string): AssistantItem[] {
  if (!text) {
    return items;
  }

  const last = items.at(-1);
  if (last?.type === 'thinking') {
    return [
      ...items.slice(0, -1),
      {
        ...last,
        text: `${last.text}${text}`,
      },
    ];
  }

  return [...items, { id: crypto.randomUUID(), type: 'thinking', text }];
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
  const index = findLatestToolIndex(steps, event.blockIndex, event.toolUseId);
  if (index === -1) {
    return [
      ...steps,
      {
        id: `${event.runId}-${event.blockIndex}`,
        name: 'tool',
        title: '工具参数流',
        status: 'running' as const,
        blockIndex: event.blockIndex,
        toolUseId: event.toolUseId,
        parentToolUseId: event.parentToolUseId,
        isSidechain: event.isSidechain,
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
  const index = findToolResultIndex(steps, event);
  if (index === -1) {
    return [
      ...steps,
      {
        id: event.toolUseId ?? crypto.randomUUID(),
        name: 'tool_result',
        title: event.isError ? '工具返回异常' : '工具返回结果',
        status: event.isError ? ('error' as const) : ('done' as const),
        toolUseId: event.toolUseId,
        parentToolUseId: event.parentToolUseId,
        isSidechain: event.isSidechain,
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

export function findToolResultIndex(steps: ToolStep[], event: Extract<ClaudeEvent, { type: 'tool-result' }>) {
  if (event.toolUseId) {
    const exactIndex = steps.findIndex((item) => item.toolUseId === event.toolUseId);
    if (exactIndex !== -1) {
      return exactIndex;
    }
  }

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const tool = steps[index];
    if (tool.name !== 'tool_result' && !tool.resultText?.trim()) {
      return index;
    }
  }

  return -1;
}

export function settleToolStop(steps: ToolStep[], event: Extract<ClaudeEvent, { type: 'tool-stop' }>) {
  const index = findLatestToolIndex(steps, event.blockIndex, event.toolUseId);
  if (index === -1) {
    return steps;
  }

  return steps.map((tool, toolIndex) =>
    toolIndex === index && tool.status === 'running'
      ? { ...tool, status: 'done' as const }
      : tool,
  );
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

export function findLatestToolIndex(steps: ToolStep[], blockIndex: number, toolUseId?: string) {
  if (toolUseId) {
    const exactIndex = steps.findIndex((item) => item.toolUseId === toolUseId || item.id === toolUseId);
    if (exactIndex !== -1) {
      return exactIndex;
    }
  }

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
  const usageSummary = extractToolUsageSummary(tool);
  if (usageSummary) {
    return `${tool.status === 'error' ? 'Error' : 'Done'} (${usageSummary})`;
  }

  if (tool.name === 'Agent' || tool.name === 'Task') {
    if (tool.status === 'running') {
      return 'Running';
    }

    return tool.status === 'error' ? 'Error' : 'Done';
  }

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

export function metricsFromTurn(turn: ConversationTurn): string {
  const parts: string[] = [];
  if (turn.tools.length) parts.push(`${turn.tools.length} tool uses`);
  if (typeof turn.outputTokens === 'number') {
    const k = turn.outputTokens >= 1000 ? `${(turn.outputTokens / 1000).toFixed(1)}k` : `${turn.outputTokens}`;
    parts.push(`${k} tokens`);
  }
  if (typeof turn.durationMs === 'number') parts.push(`耗时 ${(turn.durationMs / 1000).toFixed(1)}s`);
  if (typeof turn.totalCostUsd === 'number') parts.push(`$${turn.totalCostUsd.toFixed(4)}`);
  return parts.join(' · ');
}

export function formatMetrics(event: Extract<ClaudeEvent, { type: 'done' }>, toolCount?: number) {
  const metrics: string[] = [];
  if (toolCount) {
    metrics.push(`${toolCount} tool uses`);
  }
  if (typeof event.outputTokens === 'number') {
    const k = event.outputTokens >= 1000 ? `${(event.outputTokens / 1000).toFixed(1)}k` : `${event.outputTokens}`;
    metrics.push(`${k} tokens`);
  }
  if (typeof event.durationMs === 'number') {
    metrics.push(`耗时 ${(event.durationMs / 1000).toFixed(1)}s`);
  }
  if (typeof event.totalCostUsd === 'number') {
    metrics.push(`$${event.totalCostUsd.toFixed(4)}`);
  }

  return metrics.join(' · ');
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
  const directoryPath = getString(input, ['path', 'directory', 'dir']);
  const pattern = getString(input, ['pattern', 'query']);
  const command = getString(input, ['command', 'cmd', 'cmdString']);
  const url = getString(input, ['url']);
  const agentName = getString(input, ['subagent_type', 'agent', 'agent_name', 'name']);
  const taskDescription = getString(input, ['description', 'summary', 'task', 'prompt']);

  if (name === 'Read' && filePath) {
    return `Read(${compactToolArgument(filePath)})`;
  }

  if (name === 'Grep' && pattern) {
    return `Grep(${compactToolArgument(pattern)})`;
  }

  if (name === 'Glob' && pattern) {
    return `Glob(${compactToolArgument(pattern)})`;
  }

  if (name === 'LS' && directoryPath) {
    return `LS(${compactToolArgument(directoryPath)})`;
  }

  if (name === 'Bash' && command) {
    return `Bash(${compactToolArgument(command)})`;
  }

  if (name === 'BashOutput') {
    return 'BashOutput';
  }

  if (name === 'KillShell') {
    return 'KillShell';
  }

  if ((name === 'Edit' || name === 'MultiEdit' || name === 'Write' || name === 'NotebookEdit') && filePath) {
    return `${name}(${compactToolArgument(filePath)})`;
  }

  if (name === 'TodoRead') {
    return 'TodoRead';
  }

  if (name === 'TodoWrite') {
    return 'TodoWrite';
  }

  if (name === 'UpdatePlan') {
    return 'UpdatePlan';
  }

  if (name === 'WebSearch' && pattern) {
    return `WebSearch(${compactToolArgument(pattern)})`;
  }

  if (name === 'WebFetch' && url) {
    return `WebFetch(${compactToolArgument(url)})`;
  }

  if (name === 'ViewImage' && filePath) {
    return `ViewImage(${compactToolArgument(filePath)})`;
  }

  if (name === 'TaskOutput') {
    return 'TaskOutput';
  }

  if (name === 'TaskCreate' || name === 'TaskUpdate' || name === 'TaskList' || name === 'TaskGet') {
    return taskDescription ? `${name}(${compactToolArgument(taskDescription)})` : name;
  }

  if (name === 'EnterPlanMode') {
    return '进入 Plan 模式';
  }

  if (name === 'Agent' || name === 'Task') {
    const summary = taskDescription || agentName;
    return summary ? `Agent(${compactToolArgument(summary)})` : 'Agent';
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

function extractToolUsageSummary(tool: ToolStep) {
  if ((tool.name !== 'Agent' && tool.name !== 'Task') || !tool.resultText?.trim()) {
    return '';
  }

  const usageBlockMatch = tool.resultText.match(/<usage>([\s\S]*?)<\/usage>/i);
  if (!usageBlockMatch) {
    return '';
  }

  const values = parseUsageBlock(usageBlockMatch[1]);
  const parts: string[] = [];
  if (typeof values.toolUses === 'number') {
    parts.push(`${values.toolUses} tool uses`);
  }
  if (typeof values.totalTokens === 'number') {
    parts.push(`${formatTokenCount(values.totalTokens)} tokens`);
  }
  if (typeof values.durationMs === 'number') {
    parts.push(formatUsageDuration(values.durationMs));
  }

  return parts.join(' · ');
}

function parseUsageBlock(block: string) {
  const result: {
    totalTokens?: number;
    toolUses?: number;
    durationMs?: number;
  } = {};

  const lines = block
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
      continue;
    }

    if (key === 'tool_uses') {
      result.toolUses = numericValue;
      continue;
    }

    if (key === 'duration_ms') {
      result.durationMs = numericValue;
    }
  }

  return result;
}

function formatTokenCount(value: number) {
  if (value < 1000) {
    return `${value}`;
  }

  const compact = (value / 1000).toFixed(1);
  return compact.endsWith('.0') ? `${compact.slice(0, -2)}k` : `${compact}k`;
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
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`);
  }
  parts.push(`${seconds}s`);

  return parts.join(' ');
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
  const mergedItems = mergeOrphanToolResultItems(items);
  const mergedToolEntries = mergedItems
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
  const repairCandidates = mergedToolEntries.filter(({ tool, chunks }) => !tool.inputText?.trim() || chunks.length > 1);
  const hasCombinedInput = mergedToolEntries.some(({ chunks }) => chunks.length > 1);

  if (!hasCombinedInput || repairCandidates.length <= 1) {
    return mergedItems;
  }

  const chunks = repairCandidates.flatMap(({ chunks }) => chunks);
  if (chunks.length < repairCandidates.length) {
    return mergedItems;
  }

  const repairedItems = [...mergedItems];
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

  return changed ? repairedItems : mergedItems;
}

function mergeOrphanToolResultItems(items: AssistantItem[]) {
  let changed = false;
  const mergedItems: AssistantItem[] = [];
  const toolIndexByUseId = new Map<string, number>();

  for (const item of items) {
    if (item.type !== 'tool' || item.tool.name !== 'tool_result') {
      if (item.type === 'tool') {
        const key = item.tool.toolUseId ?? item.tool.id;
        if (key) {
          toolIndexByUseId.set(key, mergedItems.length);
        }
      }
      mergedItems.push(item);
      continue;
    }

    const targetIndex =
      item.tool.toolUseId && toolIndexByUseId.has(item.tool.toolUseId)
        ? toolIndexByUseId.get(item.tool.toolUseId) ?? -1
        : findPreviousToolWithoutResult(mergedItems);
    if (targetIndex === -1) {
      mergedItems.push(item);
      continue;
    }

    const target = mergedItems[targetIndex];
    if (target.type !== 'tool') {
      mergedItems.push(item);
      continue;
    }

    changed = true;
    mergedItems[targetIndex] = {
      ...target,
      tool: {
        ...target.tool,
        status: item.tool.isError ? 'error' : 'done',
        resultText: item.tool.resultText,
        isError: item.tool.isError,
      },
    };
  }

  return changed ? mergedItems : items;
}

function updateToolTree(
  steps: ToolStep[],
  toolUseId: string,
  updater: (tool: ToolStep) => ToolStep,
): { tools: ToolStep[]; changed: boolean } {
  let changed = false;
  const tools = steps.map((tool) => {
    if (tool.toolUseId === toolUseId || tool.id === toolUseId) {
      changed = true;
      return updater(tool);
    }

    if (!tool.subtools?.length) {
      return tool;
    }

    const nested = updateToolTree(tool.subtools, toolUseId, updater);
    if (!nested.changed) {
      return tool;
    }

    changed = true;
    return {
      ...tool,
      subtools: nested.tools,
    };
  });

  return { tools, changed };
}

function findPreviousToolWithoutResult(items: AssistantItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.type === 'tool' && item.tool.name !== 'tool_result' && !item.tool.resultText?.trim()) {
      return index;
    }
  }

  return -1;
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

  if (toolName === 'Read' || toolName === 'ViewImage') {
    return typeof parsed.file_path === 'string' && !('old_string' in parsed) && !('new_string' in parsed);
  }

  if (toolName === 'LS') {
    return typeof parsed.path === 'string' || typeof parsed.directory === 'string';
  }

  if (toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') {
    return 'old_string' in parsed || 'new_string' in parsed || 'diff' in parsed || 'patch' in parsed;
  }

  if (toolName === 'Write') {
    return typeof parsed.file_path === 'string' && ('content' in parsed || 'diff' in parsed || 'patch' in parsed);
  }

  if (toolName === 'TodoWrite') {
    return Array.isArray(parsed.todos);
  }

  if (toolName === 'TodoRead' || toolName === 'UpdatePlan') {
    return true;
  }

  if (toolName === 'WebSearch') {
    return typeof parsed.query === 'string';
  }

  if (toolName === 'WebFetch') {
    return typeof parsed.url === 'string';
  }

  if (toolName === 'Task' || toolName === 'Agent') {
    return typeof parsed.description === 'string' || typeof parsed.prompt === 'string';
  }

  if (toolName === 'BashOutput' || toolName === 'KillShell' || toolName === 'TaskOutput') {
    return true;
  }

  return false;
}
