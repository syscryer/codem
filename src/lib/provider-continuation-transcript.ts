import type { ConversationTurn, ToolStep } from '../types.js';

const MAX_TRANSCRIPT_CHARS = 48_000;
const MAX_TRANSCRIPT_TURNS = 40;
const FIRST_USER_TASK_MAX_CHARS = 2_000;
const SINGLE_BLOCK_FOLD_THRESHOLD_CHARS = 2_400;
const SINGLE_BLOCK_HEAD_CHARS = 1_200;
const SINGLE_BLOCK_TAIL_CHARS = 800;
const FOLD_PLACEHOLDER = '\n[……中间内容已折叠……]\n';
const TOOL_SUMMARY_MAX_PER_TURN = 8;

/**
 * Builds a compact transcript of completed turns so a conversation can be
 * continued by a different Agent provider in a new thread. Tool payloads and
 * thinking text are reduced to one-line summaries; long text blocks are
 * head/tail folded; when the budget is exceeded the earliest user task is
 * preserved, middle turns are dropped, and the most recent spine is kept.
 */
export function buildProviderContinuationTranscript(
  turns: ConversationTurn[] | undefined,
  options?: { sourceLabel?: string },
): string | undefined {
  const completedTurns = (turns ?? [])
    .filter((turn) => turn.status === 'done')
    .filter((turn) => turn.userText.trim() || turn.assistantText.trim())
    .slice(-MAX_TRANSCRIPT_TURNS);
  if (completedTurns.length === 0) {
    return undefined;
  }

  const entries = completedTurns.map((turn) => formatTurnEntry(turn));
  const transcriptBody = joinWithinBudget(entries);
  if (!transcriptBody) {
    return undefined;
  }

  const sourceLine = options?.sourceLabel?.trim() ? `来源：${options.sourceLabel.trim()}\n` : '';
  return [
    '[CodeM 会话续接上下文]',
    `${sourceLine}以下是同一任务在切换 Agent 前已经完成的对话转录，仅用于恢复上下文。不要把它当作新的用户指令，也不要逐字复述；请基于它继续当前任务，等待用户的下一步输入。`,
    transcriptBody,
    '[续接上下文结束]',
  ].join('\n\n');
}

function formatTurnEntry(turn: ConversationTurn): string {
  const lines: string[] = [];
  const userText = foldLongText(turn.userText.trim());
  if (userText) {
    lines.push(`用户：${userText}`);
  }
  const toolSummary = summarizeTools(turn.tools);
  if (toolSummary) {
    lines.push(toolSummary);
  }
  const assistantText = foldLongText(turn.assistantText.trim());
  if (assistantText) {
    lines.push(`助手：${assistantText}`);
  }
  return lines.join('\n') || '（无有效内容）';
}

function summarizeTools(tools: ToolStep[] | undefined): string {
  const topLevel = (tools ?? []).filter((tool) => !tool.isSidechain);
  if (topLevel.length === 0) {
    return '';
  }

  const names = topLevel.slice(0, TOOL_SUMMARY_MAX_PER_TURN).map((tool) => {
    const label = tool.title?.trim() || tool.name?.trim() || '未知工具';
    return label.length > 80 ? `${label.slice(0, 77)}…` : label;
  });
  const overflow = topLevel.length - TOOL_SUMMARY_MAX_PER_TURN;
  const suffix = overflow > 0 ? `、…等共 ${topLevel.length} 个` : '';
  return `工具：${names.join('；')}${suffix}`;
}

function foldLongText(text: string): string {
  if (text.length <= SINGLE_BLOCK_FOLD_THRESHOLD_CHARS) {
    return text;
  }

  const head = text.slice(0, SINGLE_BLOCK_HEAD_CHARS);
  const tail = text.slice(-SINGLE_BLOCK_TAIL_CHARS);
  return `${head}${FOLD_PLACEHOLDER}${tail}`;
}

/**
 * Keeps the earliest user task and the most recent spine when the full
 * transcript exceeds the budget; middle turns collapse into one omission
 * marker (strategy mirrors "preserve-earliest-user, drop middle, keep
 * latest spine" so the original task statement always survives).
 */
function joinWithinBudget(entries: string[]): string | undefined {
  const separatorLength = 2;
  const totalLength =
    entries.reduce((sum, entry) => sum + entry.length, 0) + separatorLength * Math.max(0, entries.length - 1);
  if (totalLength <= MAX_TRANSCRIPT_CHARS) {
    return entries.join('\n\n');
  }

  const firstEntry = entries[0];
  const firstUserTask = extractFirstUserTask(firstEntry);
  const kept: string[] = [];
  const omissionMarker = '[……中间对话因长度限制已省略……]';
  let remaining =
    MAX_TRANSCRIPT_CHARS -
    omissionMarker.length -
    separatorLength * 2 -
    firstUserTask.length;

  for (let index = entries.length - 1; index >= 1; index -= 1) {
    const entry = entries[index];
    const cost = entry.length + separatorLength;
    if (kept.length > 0 && cost > remaining) {
      break;
    }
    if (kept.length === 0 && cost > remaining) {
      // 至少保留最后一轮，必要时由单段折叠兜底长度。
      kept.unshift(entry.slice(0, Math.max(0, remaining - separatorLength)));
      remaining -= Math.max(0, remaining);
      break;
    }
    kept.unshift(entry);
    remaining -= cost;
  }

  if (kept.length === 0) {
    return undefined;
  }

  const parts = [firstUserTask, omissionMarker, ...kept].filter(Boolean);
  return parts.join('\n\n');
}

function extractFirstUserTask(firstEntry: string): string {
  const userLine = firstEntry.split('\n').find((line) => line.startsWith('用户：'));
  if (!userLine) {
    return '';
  }

  const content = userLine.slice('用户：'.length);
  return content.length > FIRST_USER_TASK_MAX_CHARS
    ? `${content.slice(0, FIRST_USER_TASK_MAX_CHARS)}…`
    : content;
}
