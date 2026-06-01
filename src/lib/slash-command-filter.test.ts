import assert from 'node:assert/strict';
import test from 'node:test';

import { filterSlashCommands } from '../hooks/useSlashCommands';
import type { SlashCommand } from '../types';

const commands: SlashCommand[] = [
  {
    id: 'builtin:/compact',
    name: 'compact',
    slash: '/compact',
    title: 'Compact Context',
    description: '把当前 Claude 会话压缩成更短的上下文。',
    source: 'builtin',
    action: 'local-action',
    localActionId: 'compact-thread',
    sourceLabel: 'CodeM',
    category: 'session',
    agentScope: ['claude'],
  },
  {
    id: 'builtin:/context',
    name: 'context',
    slash: '/context',
    title: 'Context Usage',
    description: '查看当前会话的上下文使用情况。',
    source: 'builtin',
    action: 'local-action',
    localActionId: 'show-context',
    sourceLabel: 'CodeM',
    category: 'context',
    agentScope: ['claude'],
  },
];

test('filterSlashCommands prioritizes exact slash matches over descriptive matches', () => {
  const result = filterSlashCommands(commands, '/context');
  assert.deepEqual(result.map((command) => command.slash), ['/context', '/compact']);
});

test('filterSlashCommands keeps source grouping order while sorting within each group', () => {
  const result = filterSlashCommands(
    [
      ...commands,
      {
        id: 'plugin:/compact',
        name: 'compact',
        slash: '/compact',
        title: 'Plugin Compact Context',
        description: '插件描述里包含 context。',
        source: 'plugin',
        action: 'local-action',
        sourceLabel: 'Plugin',
        agentScope: ['claude'],
      },
      {
        id: 'plugin:/context',
        name: 'context',
        slash: '/context',
        title: 'Plugin Context',
        description: '插件命令。',
        source: 'plugin',
        action: 'local-action',
        sourceLabel: 'Plugin',
        agentScope: ['claude'],
      },
    ],
    '/context',
  );

  assert.deepEqual(result.map((command) => command.id), [
    'builtin:/context',
    'builtin:/compact',
    'plugin:/context',
    'plugin:/compact',
  ]);
});
