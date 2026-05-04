import type { SlashCommand } from '../types';
import type { SlashLineContext } from './slash-command-editor';

export type SlashSubmissionResolution =
  | {
      kind: 'clear-thread' | 'slash-help';
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

  return {
    kind: command.localActionId === 'clear-thread' ? 'clear-thread' : 'slash-help',
    command,
  };
}

export function getSlashDismissResetKey(context: Pick<SlashLineContext, 'lineStart' | 'commandText'> | null) {
  if (!context) {
    return '';
  }

  return `${context.lineStart}:${context.commandText}`;
}
