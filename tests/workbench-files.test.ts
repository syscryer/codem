import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkbenchFileTree, getWorkbenchPreviewKind, highlightWorkbenchCodeLine } from '../src/lib/workbench-files';
import type { GitFileStatus } from '../src/types';

test('buildWorkbenchFileTree groups changed files into nested directories', () => {
  const files: GitFileStatus[] = [
    {
      path: '.trellis/tasks/right-workbench.md',
      status: 'M',
      staged: false,
      unstaged: true,
      untracked: false,
      deleted: false,
    },
    {
      path: 'src/components/ChatHeader.tsx',
      status: 'M',
      staged: false,
      unstaged: true,
      untracked: false,
      deleted: false,
    },
    {
      path: 'src/App.tsx',
      status: 'M',
      staged: false,
      unstaged: true,
      untracked: false,
      deleted: false,
    },
  ];

  const tree = buildWorkbenchFileTree(files);

  assert.deepEqual(
    tree.map((node) => [node.name, node.type]),
    [
      ['.trellis', 'directory'],
      ['src', 'directory'],
    ],
  );
  assert.equal(tree[0].children[0]?.name, 'tasks');
  assert.equal(tree[0].children[0]?.children[0]?.name, 'right-workbench.md');
  assert.equal(tree[1].children[0]?.name, 'components');
  assert.equal(tree[1].children[0]?.children[0]?.name, 'ChatHeader.tsx');
  assert.equal(tree[1].children[1]?.name, 'App.tsx');
});

test('getWorkbenchPreviewKind renders markdown files as markdown by default', () => {
  assert.equal(getWorkbenchPreviewKind('README.md'), 'markdown');
  assert.equal(getWorkbenchPreviewKind('.trellis/tasks/right-workbench.md'), 'markdown');
  assert.equal(getWorkbenchPreviewKind('src/App.tsx'), 'code');
});

test('highlightWorkbenchCodeLine highlights script keywords and strings', () => {
  const segments = highlightWorkbenchCodeLine("import { App } from './App';", 'src/main.tsx');

  assert.deepEqual(
    segments.filter((segment) => segment.kind).map((segment) => [segment.text, segment.kind]),
    [
      ['import', 'keyword'],
      ['{', 'punctuation'],
      ['}', 'punctuation'],
      ['from', 'keyword'],
      ["'./App'", 'string'],
      [';', 'punctuation'],
    ],
  );
});
