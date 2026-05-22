import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWorkbenchFullDiffRows,
  buildWorkbenchSplitDiffRows,
  collapseWorkbenchContextRows,
  findWorkbenchChangeBlockIndices,
} from './workbench-diff';

test('buildWorkbenchSplitDiffRows aligns removed and added lines side by side', () => {
  const rows = buildWorkbenchSplitDiffRows([
    '--- a/src/App.tsx',
    '+++ b/src/App.tsx',
    '@@ -1,3 +1,4 @@',
    ' import A',
    '-import B',
    '+import Bee',
    '+import C',
    ' const x = 1',
  ].join('\n'));

  assert.deepEqual(rows, [
    { type: 'hunk', text: '@@ -1,3 +1,4 @@' },
    {
      type: 'content',
      leftLineNumber: 1,
      rightLineNumber: 1,
      leftText: 'import A',
      rightText: 'import A',
      leftKind: 'context',
      rightKind: 'context',
    },
    {
      type: 'content',
      leftLineNumber: 2,
      rightLineNumber: 2,
      leftText: 'import B',
      rightText: 'import Bee',
      leftKind: 'removed',
      rightKind: 'added',
    },
    {
      type: 'content',
      leftLineNumber: null,
      rightLineNumber: 3,
      leftText: '',
      rightText: 'import C',
      leftKind: 'empty',
      rightKind: 'added',
    },
    {
      type: 'content',
      leftLineNumber: 3,
      rightLineNumber: 4,
      leftText: 'const x = 1',
      rightText: 'const x = 1',
      leftKind: 'context',
      rightKind: 'context',
    },
  ]);
});

test('buildWorkbenchSplitDiffRows omits patch header metadata in split mode', () => {
  const rows = buildWorkbenchSplitDiffRows([
    'diff --git a/src/App.tsx b/src/App.tsx',
    'index 1111111..2222222 100644',
    '--- a/src/App.tsx',
    '+++ b/src/App.tsx',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n'));

  assert.deepEqual(rows, [
    { type: 'hunk', text: '@@ -1 +1 @@' },
    {
      type: 'content',
      leftLineNumber: 1,
      rightLineNumber: 1,
      leftText: 'old',
      rightText: 'new',
      leftKind: 'removed',
      rightKind: 'added',
    },
  ]);
});

test('buildWorkbenchSplitDiffRows keeps unmatched removals on the left side', () => {
  const rows = buildWorkbenchSplitDiffRows([
    '@@ -4,3 +4,1 @@',
    '-const a = 1',
    '-const b = 2',
    '+const value = 2',
  ].join('\n'));

  assert.deepEqual(rows, [
    { type: 'hunk', text: '@@ -4,3 +4,1 @@' },
    {
      type: 'content',
      leftLineNumber: 4,
      rightLineNumber: 4,
      leftText: 'const a = 1',
      rightText: 'const value = 2',
      leftKind: 'removed',
      rightKind: 'added',
    },
    {
      type: 'content',
      leftLineNumber: 5,
      rightLineNumber: null,
      leftText: 'const b = 2',
      rightText: '',
      leftKind: 'removed',
      rightKind: 'empty',
    },
  ]);
});

test('buildWorkbenchFullDiffRows aligns inserted and deleted lines across full file content', () => {
  const rows = buildWorkbenchFullDiffRows(
    [
      'import a',
      'import b',
      'const value = 1',
      'return value',
    ].join('\n'),
    [
      'import a',
      'const inserted = true',
      'const value = 2',
      'return value',
      'console.log(value)',
    ].join('\n'),
  );

  assert.deepEqual(rows, [
    {
      type: 'content',
      leftLineNumber: 1,
      rightLineNumber: 1,
      leftText: 'import a',
      rightText: 'import a',
      leftKind: 'context',
      rightKind: 'context',
    },
    {
      type: 'content',
      leftLineNumber: 2,
      rightLineNumber: null,
      leftText: 'import b',
      rightText: '',
      leftKind: 'removed',
      rightKind: 'empty',
    },
    {
      type: 'content',
      leftLineNumber: null,
      rightLineNumber: 2,
      leftText: '',
      rightText: 'const inserted = true',
      leftKind: 'empty',
      rightKind: 'added',
    },
    {
      type: 'content',
      leftLineNumber: 3,
      rightLineNumber: 3,
      leftText: 'const value = 1',
      rightText: 'const value = 2',
      leftKind: 'removed',
      rightKind: 'added',
    },
    {
      type: 'content',
      leftLineNumber: 4,
      rightLineNumber: 4,
      leftText: 'return value',
      rightText: 'return value',
      leftKind: 'context',
      rightKind: 'context',
    },
    {
      type: 'content',
      leftLineNumber: null,
      rightLineNumber: 5,
      leftText: '',
      rightText: 'console.log(value)',
      leftKind: 'empty',
      rightKind: 'added',
    },
  ]);
});

test('collapseWorkbenchContextRows folds long unchanged runs but preserves nearby context', () => {
  const rows = collapseWorkbenchContextRows(
    [
      { type: 'hunk', text: '@@ -1,12 +1,12 @@' },
      { type: 'content', leftLineNumber: 1, rightLineNumber: 1, leftText: 'a', rightText: 'a', leftKind: 'context', rightKind: 'context' },
      { type: 'content', leftLineNumber: 2, rightLineNumber: 2, leftText: 'b', rightText: 'b', leftKind: 'context', rightKind: 'context' },
      { type: 'content', leftLineNumber: 3, rightLineNumber: 3, leftText: 'c', rightText: 'c', leftKind: 'context', rightKind: 'context' },
      { type: 'content', leftLineNumber: 4, rightLineNumber: 4, leftText: 'd', rightText: 'd', leftKind: 'context', rightKind: 'context' },
      { type: 'content', leftLineNumber: 5, rightLineNumber: 5, leftText: 'e', rightText: 'e', leftKind: 'context', rightKind: 'context' },
      { type: 'content', leftLineNumber: 6, rightLineNumber: 6, leftText: 'before', rightText: 'after', leftKind: 'removed', rightKind: 'added' },
      { type: 'content', leftLineNumber: 7, rightLineNumber: 7, leftText: 'f', rightText: 'f', leftKind: 'context', rightKind: 'context' },
      { type: 'content', leftLineNumber: 8, rightLineNumber: 8, leftText: 'g', rightText: 'g', leftKind: 'context', rightKind: 'context' },
      { type: 'content', leftLineNumber: 9, rightLineNumber: 9, leftText: 'h', rightText: 'h', leftKind: 'context', rightKind: 'context' },
      { type: 'content', leftLineNumber: 10, rightLineNumber: 10, leftText: 'i', rightText: 'i', leftKind: 'context', rightKind: 'context' },
      { type: 'content', leftLineNumber: 11, rightLineNumber: 11, leftText: 'j', rightText: 'j', leftKind: 'context', rightKind: 'context' },
    ],
    { minimumRunLength: 4, edgeContext: 1 },
  );

  assert.deepEqual(rows, [
    { type: 'hunk', text: '@@ -1,12 +1,12 @@' },
    { type: 'content', leftLineNumber: 1, rightLineNumber: 1, leftText: 'a', rightText: 'a', leftKind: 'context', rightKind: 'context' },
    { type: 'collapsed', hiddenCount: 3 },
    { type: 'content', leftLineNumber: 5, rightLineNumber: 5, leftText: 'e', rightText: 'e', leftKind: 'context', rightKind: 'context' },
    { type: 'content', leftLineNumber: 6, rightLineNumber: 6, leftText: 'before', rightText: 'after', leftKind: 'removed', rightKind: 'added' },
    { type: 'content', leftLineNumber: 7, rightLineNumber: 7, leftText: 'f', rightText: 'f', leftKind: 'context', rightKind: 'context' },
    { type: 'collapsed', hiddenCount: 3 },
    { type: 'content', leftLineNumber: 11, rightLineNumber: 11, leftText: 'j', rightText: 'j', leftKind: 'context', rightKind: 'context' },
  ]);
});

test('findWorkbenchChangeBlockIndices returns block anchors instead of every changed row', () => {
  const indices = findWorkbenchChangeBlockIndices([
    { type: 'collapsed', hiddenCount: 4 },
    { type: 'content', leftLineNumber: 1, rightLineNumber: 1, leftText: 'same', rightText: 'same', leftKind: 'context', rightKind: 'context' },
    { type: 'hunk', text: '@@ -2 +2 @@' },
    { type: 'content', leftLineNumber: 2, rightLineNumber: 2, leftText: 'old', rightText: 'new', leftKind: 'removed', rightKind: 'added' },
    { type: 'content', leftLineNumber: 3, rightLineNumber: null, leftText: 'deleted', rightText: '', leftKind: 'removed', rightKind: 'empty' },
    { type: 'content', leftLineNumber: 4, rightLineNumber: 4, leftText: 'same', rightText: 'same', leftKind: 'context', rightKind: 'context' },
    { type: 'content', leftLineNumber: null, rightLineNumber: 5, leftText: '', rightText: 'added', leftKind: 'empty', rightKind: 'added' },
  ]);

  assert.deepEqual(indices, [2, 6]);
});
