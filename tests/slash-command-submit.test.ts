import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSlashDismissResetKey,
  resolveSlashCommandSubmission,
} from '../src/lib/slash-command-submit';
import type { SlashCommand } from '../src/types';

const sampleCommands: SlashCommand[] = [
  {
    id: 'builtin:/compact',
    name: 'compact',
    slash: '/compact',
    title: 'Compact Context',
    description: '把当前 Claude 会话压缩成更短的上下文。',
    source: 'builtin',
    action: 'passthrough',
    sourceLabel: 'Claude Code',
    agentScope: ['claude'],
  },
  {
    id: 'app:/clear',
    name: 'clear',
    slash: '/clear',
    title: 'New Chat',
    description: '新建一个空聊天，不把当前输入发给 Claude。',
    source: 'app',
    action: 'local-action',
    sourceLabel: 'CodeM',
    localActionId: 'clear-thread',
    agentScope: ['claude'],
  },
];

test('resolveSlashCommandSubmission returns the matching local action for an exact slash command', () => {
  const resolution = resolveSlashCommandSubmission('/clear', sampleCommands);

  assert.deepEqual(resolution, {
    kind: 'clear-thread',
    command: sampleCommands[1],
  });
});

test('resolveSlashCommandSubmission ignores non-local or partial slash commands', () => {
  assert.equal(resolveSlashCommandSubmission('/compact', sampleCommands), null);
  assert.equal(resolveSlashCommandSubmission('/cle', sampleCommands), null);
  assert.equal(resolveSlashCommandSubmission('/clear later', sampleCommands), null);
});

test('resolveSlashCommandSubmission maps show-context to a dedicated local action kind', () => {
  const commands: SlashCommand[] = [
    ...sampleCommands,
    {
      id: 'builtin:/context',
      name: 'context',
      slash: '/context',
      title: 'Context Usage',
      description: '查看当前会话的上下文使用情况。',
      source: 'builtin',
      action: 'local-action',
      sourceLabel: 'CodeM',
      localActionId: 'show-context',
      agentScope: ['claude'],
    },
  ];

  const resolution = resolveSlashCommandSubmission('/context', commands);

  assert.deepEqual(resolution, {
    kind: 'show-context',
    command: commands[2],
  });
});

test('resolveSlashCommandSubmission maps show-status to a dedicated local action kind', () => {
  const commands: SlashCommand[] = [
    ...sampleCommands,
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
  ];

  const resolution = resolveSlashCommandSubmission('/status', commands);

  assert.deepEqual(resolution, {
    kind: 'show-status',
    command: commands[2],
  });
});

test('resolveSlashCommandSubmission maps show-cost to a dedicated local action kind', () => {
  const commands: SlashCommand[] = [
    {
      id: 'builtin:/cost',
      name: 'cost',
      slash: '/cost',
      title: 'Token Cost',
      description: '查看 Token 使用统计。',
      source: 'builtin',
      action: 'local-action',
      sourceLabel: 'CodeM',
      localActionId: 'show-cost',
      agentScope: ['claude'],
    },
  ];

  const resolution = resolveSlashCommandSubmission('/cost', commands);

  assert.deepEqual(resolution, {
    kind: 'show-cost',
    command: commands[0],
  });
});

test('resolveSlashCommandSubmission maps compact-thread to a dedicated local action kind', () => {
  const commands: SlashCommand[] = [
    {
      id: 'builtin:/compact',
      name: 'compact',
      slash: '/compact',
      title: 'Compact Context',
      description: '把当前 Claude 会话压缩成更短的上下文。',
      source: 'builtin',
      action: 'local-action',
      sourceLabel: 'CodeM',
      localActionId: 'compact-thread',
      agentScope: ['claude'],
    },
  ];

  const resolution = resolveSlashCommandSubmission('/compact', commands);

  assert.deepEqual(resolution, {
    kind: 'compact-thread',
    command: commands[0],
  });
});

test('getSlashDismissResetKey depends on the slash command identity, not the current line end', () => {
  assert.equal(getSlashDismissResetKey({ lineStart: 12, commandText: '/brain' }), '12:/brain');
  assert.equal(getSlashDismissResetKey(null), '');
});
