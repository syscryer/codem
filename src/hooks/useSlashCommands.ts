import { useEffect, useMemo, useState } from 'react';

import { filterSlashCommandsForAgent } from '../lib/agent-slash-capabilities';
import { PLUGINS_CHANGED_EVENT } from '../lib/plugins';
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
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    function handlePluginsChanged() {
      setRefreshToken((current) => current + 1);
    }

    window.addEventListener(PLUGINS_CHANGED_EVENT, handlePluginsChanged);
    return () => window.removeEventListener(PLUGINS_CHANGED_EVENT, handlePluginsChanged);
  }, []);

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
  }, [projectPath, refreshToken, showToast]);

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
  const normalizedQuery = normalizeSlashCommandQuery(query);
  if (!normalizedQuery) {
    return commands;
  }

  const groupRanks = buildSlashCommandGroupRanks(commands);
  return commands
    .map((command, originalIndex) => ({
      command,
      originalIndex,
      groupRank: groupRanks.get(command.source) ?? originalIndex,
      matchRank: scoreSlashCommandMatch(command, normalizedQuery),
    }))
    .filter((item): item is typeof item & { matchRank: number } => item.matchRank !== null)
    .sort((left, right) => {
      if (left.groupRank !== right.groupRank) {
        return left.groupRank - right.groupRank;
      }
      if (left.matchRank !== right.matchRank) {
        return left.matchRank - right.matchRank;
      }
      return left.originalIndex - right.originalIndex;
    })
    .map((item) => item.command);
}

function buildSlashCommandGroupRanks(commands: SlashCommand[]) {
  const ranks = new Map<SlashCommand['source'], number>();
  commands.forEach((command, index) => {
    if (!ranks.has(command.source)) {
      ranks.set(command.source, index);
    }
  });
  return ranks;
}

function scoreSlashCommandMatch(command: SlashCommand, query: string) {
  const slash = normalizeSlashCommandValue(command.slash);
  const name = normalizeSlashCommandValue(command.name);
  const title = normalizeSlashCommandValue(command.title);
  const description = normalizeSlashCommandValue(command.description ?? '');
  const sourceLabel = normalizeSlashCommandValue(command.sourceLabel ?? '');

  if (slash === query || name === query) {
    return 0;
  }
  if (slash.startsWith(query) || name.startsWith(query)) {
    return 1;
  }
  if (title === query) {
    return 2;
  }
  if (title.startsWith(query)) {
    return 3;
  }

  const haystack = `${slash} ${name} ${title} ${description} ${sourceLabel}`;
  return haystack.includes(query) ? 4 : null;
}

function normalizeSlashCommandQuery(query: string) {
  return normalizeSlashCommandValue(query).replace(/^\/+/, '');
}

function normalizeSlashCommandValue(value: string) {
  return value.trim().toLowerCase();
}
