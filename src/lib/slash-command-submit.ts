import type { SlashCommand } from '../types';
import type { SlashLineContext } from './slash-command-editor';

export type SlashSubmissionResolution =
  | {
      kind: 'clear-thread' | 'slash-help' | 'show-status' | 'not-implemented';
      command: SlashCommand;
    }
  | null;

export function resolveSlashCommandSubmission(
  draft: string,
  commands: SlashCommand[],
): SlashSubmissionResolution {
  const trimmed = draft.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const command = commands.find(
    (item) => item.action === 'local-action' && item.slash.toLowerCase() === trimmed.toLowerCase(),
  );
  if (!command) {
    return null;
  }

  // 派发优先级:已实现的 kind 显式匹配,其它 local-action 一律按"待实现"提示
  if (command.localActionId === 'clear-thread') {
    return { kind: 'clear-thread', command };
  }
  if (command.localActionId === 'slash-help') {
    return { kind: 'slash-help', command };
  }
  if (command.localActionId === 'show-status') {
    return { kind: 'show-status', command };
  }
  return { kind: 'not-implemented', command };
}

export function getSlashDismissResetKey(context: Pick<SlashLineContext, 'lineStart' | 'commandText'> | null) {
  if (!context) {
    return '';
  }

  return `${context.lineStart}:${context.commandText}`;
}
