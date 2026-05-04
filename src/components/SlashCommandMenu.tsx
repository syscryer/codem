import { useEffect, useRef } from 'react';
import type { SlashCommand } from '../types';

type SlashCommandMenuProps = {
  commands: SlashCommand[];
  selectedIndex: number;
  loading: boolean;
  query: string;
  onSelect: (command: SlashCommand) => void;
};

type GroupedSlashCommands = {
  label: string;
  commands: Array<{
    command: SlashCommand;
    index: number;
  }>;
};

export function SlashCommandMenu({
  commands,
  selectedIndex,
  loading,
  query,
  onSelect,
}: SlashCommandMenuProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const groupedCommands = groupSlashCommands(commands);
  const hasQuery = query.trim().length > 0;

  useEffect(() => {
    if (loading || commands.length === 0) {
      return;
    }

    const selectedItem = itemRefs.current[selectedIndex];
    selectedItem?.scrollIntoView({
      block: 'nearest',
    });
  }, [commands.length, loading, selectedIndex]);

  return (
    <div className="slash-command-menu" role="listbox" aria-label="Slash commands">
      {loading ? <div className="slash-command-empty">正在读取命令…</div> : null}
      {!loading && commands.length === 0 && hasQuery ? (
        <div className="slash-command-empty">没有匹配 “{query}” 的命令</div>
      ) : null}
      {!loading && commands.length === 0 && !hasQuery ? (
        <div className="slash-command-empty">当前没有可用命令</div>
      ) : null}
      {!loading
        ? groupedCommands.map((group) => (
            <section key={group.label} className="slash-command-group" aria-label={group.label}>
              <div className="slash-command-group-label">{group.label}</div>
              <div className="slash-command-group-items">
                {group.commands.map(({ command, index }) => (
                  <button
                    key={command.id}
                    ref={(element) => {
                      itemRefs.current[index] = element;
                    }}
                    type="button"
                    className={`slash-command-item${index === selectedIndex ? ' is-selected' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onSelect(command)}
                  >
                    <div className="slash-command-item-main">
                      <span className="slash-command-item-slash">{command.slash}</span>
                      <span className="slash-command-item-title">{command.title}</span>
                    </div>
                    {command.description ? (
                      <div className="slash-command-item-description">{command.description}</div>
                    ) : null}
                  </button>
                ))}
              </div>
            </section>
          ))
        : null}
    </div>
  );
}

function groupSlashCommands(commands: SlashCommand[]): GroupedSlashCommands[] {
  const labels = new Map<string, GroupedSlashCommands>();

  commands.forEach((command, index) => {
    const label = getSlashGroupLabel(command.source);
    if (!labels.has(label)) {
      labels.set(label, {
        label,
        commands: [],
      });
    }

    labels.get(label)?.commands.push({
      command,
      index,
    });
  });

  return [...labels.values()];
}

function getSlashGroupLabel(source: SlashCommand['source']) {
  switch (source) {
    case 'builtin':
      return '内建';
    case 'project':
    case 'user':
      return '项目与用户';
    case 'plugin':
    case 'skill':
      return '插件与 Skill';
    case 'mcp':
      return 'MCP';
    case 'app':
      return 'CodeM';
    default:
      return '其它';
  }
}
