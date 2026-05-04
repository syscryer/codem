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

test('resolveSlashCommandSubmission maps slash-help to a dedicated local action kind', () => {
  const commands: SlashCommand[] = [
    ...sampleCommands,
    {
      id: 'app:/help',
      name: 'help',
      slash: '/help',
      title: 'Slash Help',
      description: '显示 slash 命令的简短帮助提示。',
      source: 'app',
      action: 'local-action',
      sourceLabel: 'CodeM',
      localActionId: 'slash-help',
    },
  ];

  const resolution = resolveSlashCommandSubmission('/help', commands);

  assert.deepEqual(resolution, {
    kind: 'slash-help',
    command: commands[2],
  });
});

test('getSlashDismissResetKey depends on the slash command identity, not the current line end', () => {
  assert.equal(getSlashDismissResetKey({ lineStart: 12, commandText: '/brain' }), '12:/brain');
  assert.equal(getSlashDismissResetKey(null), '');
});
