import { useEffect, useMemo, useState } from 'react';

import { filterSlashCommandsForAgent } from '../lib/agent-slash-capabilities';
import { getCurrentLineSlashContext } from '../lib/slash-command-editor';
import type { AgentType, SlashCommand, SlashCommandsResponse } from '../types';

type UseSlashCommandsArgs = {
  projectPath?: string;
  activeAgent: AgentType;
  draft: string;
  selectionStart: number;
  showToast?: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

export function useSlashCommands({
  projectPath,
  activeAgent,
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
  const visibleCommands = useMemo(
    () => filterSlashCommandsForAgent(commands, activeAgent),
    [activeAgent, commands],
  );
  const filteredCommands = useMemo(
    () => getVisibleSlashCommands(commands, query, activeAgent),
    [activeAgent, commands, query],
  );
  const open = Boolean(context);

  return {
    commands: visibleCommands,
    filteredCommands,
    open,
    loading,
    query,
    context,
  };
}

export function getVisibleSlashCommands(commands: SlashCommand[], query: string, activeAgent: AgentType) {
  return filterSlashCommands(filterSlashCommandsForAgent(commands, activeAgent), query);
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
