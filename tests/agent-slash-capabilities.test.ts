import assert from 'node:assert/strict';
import test from 'node:test';

import { filterSlashCommandsForAgent } from '../src/lib/agent-slash-capabilities';
import type { SlashCommand } from '../src/types';

const sampleCommands: SlashCommand[] = [
  {
    id: 'builtin:/status',
    name: 'status',
    slash: '/status',
    title: 'Status',
    description: '显示当前项目、模型、权限模式和会话信息。',
    source: 'builtin',
    action: 'local-action',
    sourceLabel: 'CodeM',
    localActionId: 'show-status',
    agentScope: ['claude'],
  },
  {
    id: 'skill:/brainstorming',
    name: 'brainstorming',
    slash: '/brainstorming',
    title: 'Brainstorming',
    description: 'Structured design exploration',
    source: 'skill',
    action: 'insert-template',
    sourceLabel: 'plugin skill',
    template: '我们先做一轮结构化 brainstorming，再进入实现。',
    agentScope: ['codex'],
  },
];

test('filterSlashCommandsForAgent keeps only commands allowed for the active agent', () => {
  assert.deepEqual(
    filterSlashCommandsForAgent(sampleCommands, 'claude').map((command) => command.slash),
    ['/status'],
  );
});

test('filterSlashCommandsForAgent hides commands that are scoped to other agents', () => {
  assert.deepEqual(
    filterSlashCommandsForAgent(sampleCommands, 'codex').map((command) => command.slash),
    ['/brainstorming'],
  );
});
