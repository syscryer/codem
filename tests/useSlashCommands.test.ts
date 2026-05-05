import assert from 'node:assert/strict';
import test from 'node:test';

import { getCurrentLineSlashContext } from '../src/lib/slash-command-editor';
import { filterSlashCommands, getVisibleSlashCommands } from '../src/hooks/useSlashCommands';
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

test('filterSlashCommands returns all commands when query is empty', () => {
  assert.deepEqual(filterSlashCommands(sampleCommands, ''), sampleCommands);
});

test('filterSlashCommands matches slash, title, description, and source label', () => {
  assert.deepEqual(filterSlashCommands(sampleCommands, 'brain').map((command) => command.slash), ['/brainstorming']);
  assert.deepEqual(filterSlashCommands(sampleCommands, 'claude code').map((command) => command.slash), ['/compact']);
  assert.deepEqual(filterSlashCommands(sampleCommands, '新建').map((command) => command.slash), ['/clear']);
});

test('filterSlashCommands can operate after agent scoping removes out-of-scope entries', () => {
  const claudeCommands = sampleCommands.filter((command) => command.agentScope.includes('claude'));
  assert.deepEqual(filterSlashCommands(claudeCommands, '').map((command) => command.slash), ['/compact', '/clear']);
});

test('getVisibleSlashCommands hides out-of-scope commands before text matching', () => {
  assert.deepEqual(
    getVisibleSlashCommands(sampleCommands, 'brain', 'claude').map((command) => command.slash),
    [],
  );
  assert.deepEqual(
    getVisibleSlashCommands(sampleCommands, '', 'claude').map((command) => command.slash),
    ['/compact', '/clear'],
  );
});

test('current-line slash mode only opens when slash is the first non-whitespace token on the active line', () => {
  const multiline = '普通文本\n  /brain';
  const multilineContext = getCurrentLineSlashContext(multiline, multiline.length);

  assert.equal(multilineContext?.query, 'brain');
  assert.equal(getCurrentLineSlashContext('请执行 /brain', '请执行 /brain'.length), null);
});

test('slash commands endpoint query uses encoded project path', () => {
  const projectPath = 'D:\\project\\codem demo';
  const query = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : '';

  assert.equal(query, '?projectPath=D%3A%5Cproject%5Ccodem%20demo');
});
