import { useEffect, useMemo, useState } from 'react';

import { getCurrentLineSlashContext } from '../lib/slash-command-editor';
import type { SlashCommand, SlashCommandsResponse } from '../types';

type UseSlashCommandsArgs = {
  projectPath?: string;
  draft: string;
  selectionStart: number;
  showToast?: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

export function useSlashCommands({
  projectPath,
  draft,
  selectionStart,
  showToast,
}: UseSlashCommandsArgs) {
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadSlashCommands() {
      setLoading(true);
      try {
        const query = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : '';
        const response = await fetch(`/api/slash-commands${query}`, {
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw new Error('读取 Slash Commands 失败');
        }

        const payload = await response.json() as SlashCommandsResponse;
        setCommands(Array.isArray(payload.commands) ? payload.commands : []);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }
        showToast?.(error instanceof Error ? error.message : '读取 Slash Commands 失败', 'error');
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadSlashCommands();
    return () => abortController.abort();
  }, [projectPath, showToast]);

  const context = useMemo(
    () => getCurrentLineSlashContext(draft, selectionStart),
    [draft, selectionStart],
  );
  const query = context?.query.trim().toLowerCase() ?? '';
  const filteredCommands = useMemo(
    () => filterSlashCommands(commands, query),
    [commands, query],
  );
  const open = Boolean(context);

  return {
    commands,
    filteredCommands,
    open,
    loading,
    query,
    context,
  };
}

export function filterSlashCommands(commands: SlashCommand[], query: string) {
  if (!query) {
    return commands;
  }

  return commands.filter((command) => {
    const haystack = [
      command.slash,
      command.name,
      command.title,
      command.description ?? '',
      command.sourceLabel ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}
