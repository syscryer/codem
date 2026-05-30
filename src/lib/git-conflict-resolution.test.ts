import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildConflictEditorLines,
  buildConflictOperationTitle,
  buildConflictResolutionContent,
  detectConflictBlocks,
  buildConflictSideLineMetadata,
  tokenizeCodeLine,
  canContinueGitOperation,
} from './git-conflict-resolution.js';
import type { GitConflictFileDetail, GitOperationState } from '../types';

test('buildConflictOperationTitle describes merge and rebase operations', () => {
  assert.equal(
    buildConflictOperationTitle({
      status: 'conflicted',
      operation: 'merge',
      branch: 'master',
      upstream: 'origin/master',
      remote: 'origin',
      ahead: 1,
      behind: 1,
      hasConflicts: true,
      canContinue: false,
      canAbort: true,
      conflicts: [],
      files: [],
      message: '',
    }),
    '将 origin/master 合并到 master',
  );

  assert.equal(
    buildConflictOperationTitle({
      status: 'conflicted',
      operation: 'rebase',
      branch: 'master',
      upstream: 'origin/master',
      remote: 'origin',
      ahead: 1,
      behind: 1,
      hasConflicts: true,
      canContinue: false,
      canAbort: true,
      conflicts: [],
      files: [],
      message: '',
    }),
    '将 master 变基到 origin/master',
  );
});

test('buildConflictOperationTitle avoids self-merge wording when upstream is unknown', () => {
  assert.equal(
    buildConflictOperationTitle({
      status: 'conflicted',
      operation: 'merge',
      branch: 'feature/conflict',
      ahead: 0,
      behind: 0,
      hasConflicts: true,
      canContinue: false,
      canAbort: true,
      conflicts: [],
      files: [],
      message: '',
    }),
    '解决 feature/conflict 的合并冲突',
  );
});

test('buildConflictResolutionContent returns current incoming or both content', () => {
  const detail: GitConflictFileDetail = {
    path: 'README.md',
    status: 'UU',
    conflictKind: 'both_modified',
    label: '双方修改',
    baseContent: 'base\n',
    currentContent: 'ours\n',
    incomingContent: 'theirs\n',
    resultContent: '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n',
    isText: true,
    binary: false,
  };

  assert.equal(buildConflictResolutionContent(detail, 'current'), 'ours\n');
  assert.equal(buildConflictResolutionContent(detail, 'incoming'), 'theirs\n');
  assert.equal(buildConflictResolutionContent(detail, 'both'), 'ours\ntheirs\n');
});

test('buildConflictEditorLines preserves line numbers and trailing empty lines', () => {
  assert.deepEqual(buildConflictEditorLines('left\nright\n'), [
    { lineNumber: 1, text: 'left' },
    { lineNumber: 2, text: 'right' },
  ]);
  assert.deepEqual(buildConflictEditorLines(''), [{ lineNumber: 1, text: '' }]);
});

test('detectConflictBlocks finds marker-based result conflicts', () => {
  const blocks = detectConflictBlocks('<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n');

  assert.deepEqual(blocks, [
    {
      startLine: 1,
      separatorLine: 3,
      endLine: 5,
      currentLines: ['ours'],
      incomingLines: ['theirs'],
    },
  ]);
});

test('buildConflictSideLineMetadata marks side lines that belong to conflict blocks', () => {
  const resultContent = [
    'stable before',
    '<<<<<<< HEAD',
    'current one',
    'current two',
    '=======',
    'incoming one',
    '>>>>>>> branch',
    'stable after',
  ].join('\n');

  assert.deepEqual(
    buildConflictSideLineMetadata('current one\ncurrent two\nstable after\n', detectConflictBlocks(resultContent), 'current'),
    new Map([
      [1, { conflict: true }],
      [2, { conflict: true }],
    ]),
  );
  assert.deepEqual(
    buildConflictSideLineMetadata('incoming one\nstable after\n', detectConflictBlocks(resultContent), 'incoming'),
    new Map([[1, { conflict: true }]]),
  );
});

test('tokenizeCodeLine produces lightweight syntax tokens for TypeScript-like code', () => {
  assert.deepEqual(tokenizeCodeLine("export function demo(value: string) { return 'ok'; }"), [
    { text: 'export', kind: 'keyword' },
    { text: ' ', kind: 'plain' },
    { text: 'function', kind: 'keyword' },
    { text: ' demo', kind: 'plain' },
    { text: '(value', kind: 'plain' },
    { text: ':', kind: 'punctuation' },
    { text: ' string', kind: 'plain' },
    { text: ')', kind: 'punctuation' },
    { text: ' ', kind: 'plain' },
    { text: '{', kind: 'punctuation' },
    { text: ' ', kind: 'plain' },
    { text: 'return', kind: 'keyword' },
    { text: ' ', kind: 'plain' },
    { text: "'ok'", kind: 'string' },
    { text: ';', kind: 'punctuation' },
    { text: ' ', kind: 'plain' },
    { text: '}', kind: 'punctuation' },
  ]);
});

test('canContinueGitOperation requires no conflicts and a continuable operation', () => {
  const state: GitOperationState = {
    status: 'in_progress',
    operation: 'merge',
    branch: 'master',
    upstream: 'origin/master',
    remote: 'origin',
    ahead: 1,
    behind: 1,
    hasConflicts: false,
    canContinue: true,
    canAbort: true,
    conflicts: [],
    files: [],
    message: '',
  };

  assert.equal(canContinueGitOperation(state), true);
  assert.equal(canContinueGitOperation({ ...state, hasConflicts: true }), false);
  assert.equal(canContinueGitOperation({ ...state, canContinue: false }), false);
});
