import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySlashCommandSelection,
  getCurrentLineSlashContext,
  getNextSlashCommandIndex,
  replaceCurrentLineWithText,
} from '../src/lib/slash-command-editor';
import type { SlashCommand } from '../src/types';

const brainstormingCommand: SlashCommand = {
  id: 'skill:/brainstorming',
  name: 'brainstorming',
  slash: '/brainstorming',
  title: 'Brainstorming',
  description: 'Structured design exploration',
  source: 'skill',
  action: 'insert-template',
  sourceLabel: 'user skill',
  template: '我们先做一轮结构化 brainstorming，再进入实现。',
};

const compactCommand: SlashCommand = {
  id: 'builtin:/compact',
  name: 'compact',
  slash: '/compact',
  title: 'Compact Context',
  description: '把当前 Claude 会话压缩成更短的上下文。',
  source: 'builtin',
  action: 'passthrough',
  sourceLabel: 'Claude Code',
};

const clearCommand: SlashCommand = {
  id: 'app:/clear',
  name: 'clear',
  slash: '/clear',
  title: 'New Chat',
  description: '新建一个空聊天，不把当前输入发给 Claude。',
  source: 'app',
  action: 'local-action',
  sourceLabel: 'CodeM',
  localActionId: 'clear-thread',
};

const helpCommand: SlashCommand = {
  id: 'app:/help',
  name: 'help',
  slash: '/help',
  title: 'Slash Help',
  description: '显示 slash 命令的简短帮助提示。',
  source: 'app',
  action: 'local-action',
  sourceLabel: 'CodeM',
  localActionId: 'slash-help',
};

test('getCurrentLineSlashContext matches slash commands at current-line start', () => {
  const text = '  /brain';
  const context = getCurrentLineSlashContext(text, text.length);

  assert.deepEqual(context, {
    query: 'brain',
    lineStart: 0,
    lineEnd: text.length,
    commandText: '/brain',
  });
});

test('getCurrentLineSlashContext ignores slash text outside current-line start', () => {
  assert.equal(getCurrentLineSlashContext('请执行 /brain', '请执行 /brain'.length), null);

  const multiline = '第一行\n普通文本 /brain';
  assert.equal(getCurrentLineSlashContext(multiline, multiline.length), null);
});

test('getCurrentLineSlashContext works on the active line of multiline input', () => {
  const text = '第一行\n /compact';
  const context = getCurrentLineSlashContext(text, text.length);

  assert.deepEqual(context, {
    query: 'compact',
    lineStart: 4,
    lineEnd: text.length,
    commandText: '/compact',
  });
});

test('replaceCurrentLineWithText replaces only the active line', () => {
  const text = '第一行\n/brain';
  const result = replaceCurrentLineWithText(text, text.length, text.length, '/brainstorming ');

  assert.equal(result.text, '第一行\n/brainstorming ');
  assert.equal(result.selectionStart, '第一行\n/brainstorming '.length);
  assert.equal(result.selectionEnd, '第一行\n/brainstorming '.length);
});

test('applySlashCommandSelection inserts templates without auto-sending', () => {
  const text = '第一行\n/brain';
  const result = applySlashCommandSelection(text, text.length, text.length, brainstormingCommand);

  assert.equal(result.text, '第一行\n我们先做一轮结构化 brainstorming，再进入实现。');
  assert.equal(result.selectionStart, result.text.length);
  assert.equal(result.selectionEnd, result.text.length);
});

test('applySlashCommandSelection keeps passthrough commands in the composer with a trailing space', () => {
  const text = '/com';
  const result = applySlashCommandSelection(text, text.length, text.length, compactCommand);

  assert.equal(result.text, '/compact ');
  assert.equal(result.selectionStart, '/compact '.length);
  assert.equal(result.selectionEnd, '/compact '.length);
});

test('applySlashCommandSelection inserts local-action commands exactly for later submit resolution', () => {
  const text = '/cl';
  const result = applySlashCommandSelection(text, text.length, text.length, clearCommand);

  assert.equal(result.text, '/clear');
  assert.equal(result.selectionStart, '/clear'.length);
  assert.equal(result.selectionEnd, '/clear'.length);
});

test('applySlashCommandSelection leaves help local actions available for immediate execution', () => {
  const text = '/he';
  const result = applySlashCommandSelection(text, text.length, text.length, helpCommand);

  assert.equal(result.text, '/help');
  assert.equal(result.selectionStart, '/help'.length);
  assert.equal(result.selectionEnd, '/help'.length);
});

test('getNextSlashCommandIndex wraps through the available commands', () => {
  assert.equal(getNextSlashCommandIndex(0, 'next', 3), 1);
  assert.equal(getNextSlashCommandIndex(2, 'next', 3), 0);
  assert.equal(getNextSlashCommandIndex(0, 'previous', 3), 2);
  assert.equal(getNextSlashCommandIndex(0, 'next', 0), -1);
  assert.equal(getNextSlashCommandIndex(-1, 'previous', 3), 2);
});
