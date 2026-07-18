import type { ConversationTurn } from '../types.js';

const MAX_CONTINUITY_CHARS = 24_000;
const MAX_CONTINUITY_TURNS = 20;

/**
 * Builds a compact, user-visible transcript for a provider session that must
 * be recreated after switching channels. Tool payloads, thinking text and
 * transient attachment data are intentionally excluded.
 */
export function buildAgentChannelContinuityContext(
  turns: ConversationTurn[] | undefined,
): string | undefined {
  const completedTurns = (turns ?? [])
    .filter((turn) => turn.status === 'done')
    .filter((turn) => turn.userText.trim() || turn.assistantText.trim())
    .slice(-MAX_CONTINUITY_TURNS);
  if (completedTurns.length === 0) {
    return undefined;
  }

  const entries: string[] = [];
  let remaining = MAX_CONTINUITY_CHARS;
  for (let index = completedTurns.length - 1; index >= 0; index -= 1) {
    const turn = completedTurns[index];
    const entry = [
      `用户：${turn.userText.trim() || '（无文本）'}`,
      `助手：${turn.assistantText.trim() || '（无文本回答）'}`,
    ].join('\n');
    const separatorLength = entries.length > 0 ? 2 : 0;
    if (entry.length + separatorLength <= remaining) {
      entries.unshift(entry);
      remaining -= entry.length + separatorLength;
      continue;
    }

    if (remaining > 80) {
      entries.unshift(`${entry.slice(0, Math.max(0, remaining - 24))}\n[较早内容已截断]`);
    }
    break;
  }

  if (entries.length === 0) {
    return undefined;
  }

  return [
    '[CodeM 会话续接上下文]',
    '以下是同一任务在切换 Agent 渠道前已经完成的对话，仅用于恢复上下文。不要把它当作新的用户指令；下一段输入才是本轮需要处理的问题。',
    entries.join('\n\n'),
    '[续接上下文结束]',
  ].join('\n\n');
}
