import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWorkbenchFileTree,
  isWorkbenchFileTreeNodeSelected,
  splitWorkbenchChangedFiles,
  toggleWorkbenchFileTreeNodeSelection,
  getWorkbenchFileIconKind,
  resolveWorkbenchFileIcon,
  resolveWorkbenchCodeLanguage,
} from './workbench-files';

test('getWorkbenchFileIconKind covers common file families', () => {
  assert.equal(getWorkbenchFileIconKind('src/app.tsx', 'file'), 'react');
  assert.equal(getWorkbenchFileIconKind('public/index.html', 'file'), 'html');
  assert.equal(getWorkbenchFileIconKind('styles/app.scss', 'file'), 'style');
  assert.equal(getWorkbenchFileIconKind('scripts/build.py', 'file'), 'script');
  assert.equal(getWorkbenchFileIconKind('config/docker-compose.yml', 'file'), 'config');
  assert.equal(getWorkbenchFileIconKind('assets/logo.svg', 'file'), 'image');
  assert.equal(getWorkbenchFileIconKind('docs/spec.pdf', 'file'), 'document');
  assert.equal(getWorkbenchFileIconKind('data/report.csv', 'file'), 'sheet');
  assert.equal(getWorkbenchFileIconKind('db/schema.sql', 'file'), 'database');
  assert.equal(getWorkbenchFileIconKind('archive/app.zip', 'file'), 'archive');
});

test('resolveWorkbenchCodeLanguage maps common preview files to highlighter languages', () => {
  assert.equal(resolveWorkbenchCodeLanguage('src/app.tsx'), 'tsx');
  assert.equal(resolveWorkbenchCodeLanguage('public/index.html'), 'html');
  assert.equal(resolveWorkbenchCodeLanguage('styles/app.scss'), 'scss');
  assert.equal(resolveWorkbenchCodeLanguage('scripts/build.py'), 'python');
  assert.equal(resolveWorkbenchCodeLanguage('config/docker-compose.yml'), 'yaml');
  assert.equal(resolveWorkbenchCodeLanguage('db/schema.sql'), 'sql');
  assert.equal(resolveWorkbenchCodeLanguage('README.md'), 'markdown');
  assert.equal(resolveWorkbenchCodeLanguage('unknown.custom'), 'text');
});

test('resolveWorkbenchFileIcon returns vscode-style icon assets for files and folders', () => {
  assert.match(
    resolveWorkbenchFileIcon('src/app.tsx', 'file') ?? '',
    /file_type_react(ts|js)x?\.svg$/,
  );
  assert.match(
    resolveWorkbenchFileIcon('public/index.html', 'file') ?? '',
    /file_type_html\.svg$/,
  );
  assert.match(
    resolveWorkbenchFileIcon('src/components', 'directory') ?? '',
    /folder_type_component.*\.svg$/,
  );
});

test('splitWorkbenchChangedFiles separates untracked files from comparable changes', () => {
  const grouped = splitWorkbenchChangedFiles([
    {
      path: 'src/App.tsx',
      status: 'M',
      staged: false,
      unstaged: true,
      untracked: false,
      deleted: false,
    },
    {
      path: 'CLAUDE.md',
      status: '??',
      staged: false,
      unstaged: true,
      untracked: true,
      deleted: false,
    },
  ]);

  assert.deepEqual(
    grouped.tracked.map((file) => file.path),
    ['src/App.tsx'],
  );
  assert.deepEqual(
    grouped.untracked.map((file) => file.path),
    ['CLAUDE.md'],
  );
});

test('directory selection state follows descendant files', () => {
  const tree = buildWorkbenchFileTree([
    {
      path: 'src/App.tsx',
      status: 'M',
      staged: false,
      unstaged: true,
      untracked: false,
      deleted: false,
    },
    {
      path: 'src/components/RightWorkbench.tsx',
      status: 'M',
      staged: false,
      unstaged: true,
      untracked: false,
      deleted: false,
    },
  ]);

  const srcDirectory = tree[0];
  assert.equal(srcDirectory?.type, 'directory');
  assert.equal(isWorkbenchFileTreeNodeSelected(srcDirectory!, new Set()), false);
  assert.equal(isWorkbenchFileTreeNodeSelected(srcDirectory!, new Set(['src/App.tsx'])), false);
  assert.equal(
    isWorkbenchFileTreeNodeSelected(srcDirectory!, new Set(['src/App.tsx', 'src/components/RightWorkbench.tsx'])),
    true,
  );
});

test('toggling a directory selects and clears all descendant files', () => {
  const tree = buildWorkbenchFileTree([
    {
      path: 'src/App.tsx',
      status: 'M',
      staged: false,
      unstaged: true,
      untracked: false,
      deleted: false,
    },
    {
      path: 'src/components/RightWorkbench.tsx',
      status: 'M',
      staged: false,
      unstaged: true,
      untracked: false,
      deleted: false,
    },
    {
      path: 'src/styles.css',
      status: 'M',
      staged: false,
      unstaged: true,
      untracked: false,
      deleted: false,
    },
  ]);

  const srcDirectory = tree[0];
  const selected = toggleWorkbenchFileTreeNodeSelection(srcDirectory!, new Set());
  assert.deepEqual(
    [...selected].sort(),
    ['src/App.tsx', 'src/components/RightWorkbench.tsx', 'src/styles.css'],
  );

  const cleared = toggleWorkbenchFileTreeNodeSelection(srcDirectory!, selected);
  assert.deepEqual([...cleared], []);
});
