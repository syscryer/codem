import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWorkbenchFileTree,
  filterWorkbenchNoiseFiles,
  getWorkbenchPreviewKind,
  isWorkbenchNoiseFilePath,
  isWorkbenchFileTreeNodeSelected,
  splitWorkbenchChangedFiles,
  toggleWorkbenchFileTreeNodeSelection,
  resolveWorkbenchCodeLanguage,
} from './workbench-files';

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

test('getWorkbenchPreviewKind treats common image assets as image previews', () => {
  assert.equal(getWorkbenchPreviewKind('assets/logo.png'), 'image');
  assert.equal(getWorkbenchPreviewKind('assets/logo.gif'), 'image');
  assert.equal(getWorkbenchPreviewKind('assets/logo.webp'), 'image');
  assert.equal(getWorkbenchPreviewKind('assets/logo.svg'), 'image');
  assert.equal(getWorkbenchPreviewKind('assets/logo.ico'), 'image');
  assert.equal(getWorkbenchPreviewKind('assets/logo.bmp'), 'image');
  assert.equal(getWorkbenchPreviewKind('assets/logo.avif'), 'image');
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

test('filterWorkbenchNoiseFiles hides only untracked noise paths by default', () => {
  const files = filterWorkbenchNoiseFiles(
    [
      {
        path: 'docs/design/.idea/workspace.xml',
        status: '??',
        staged: false,
        unstaged: true,
        untracked: true,
        deleted: false,
      },
      {
        path: 'docs/design/logs/ssh_audit_20260523.log',
        status: '??',
        staged: false,
        unstaged: true,
        untracked: true,
        deleted: false,
      },
      {
        path: 'docs/design/类型项目.txt',
        status: '??',
        staged: false,
        unstaged: true,
        untracked: true,
        deleted: false,
      },
      {
        path: 'config/.idea/code-style.xml',
        status: '修改',
        staged: false,
        unstaged: true,
        untracked: false,
        deleted: false,
      },
    ],
    false,
  );

  assert.deepEqual(
    files.map((file) => file.path),
    ['docs/design/类型项目.txt', 'config/.idea/code-style.xml'],
  );
});

test('isWorkbenchNoiseFilePath recognizes common temporary artifacts', () => {
  assert.equal(isWorkbenchNoiseFilePath('docs/design/.idea/workspace.xml'), true);
  assert.equal(isWorkbenchNoiseFilePath('logs/ssh_audit_20260523.log'), true);
  assert.equal(isWorkbenchNoiseFilePath('util/__pycache__/common_config.cpython-38.pyc'), true);
  assert.equal(isWorkbenchNoiseFilePath('docs/design/类型项目.txt'), false);
  assert.equal(isWorkbenchNoiseFilePath('.mcp.json'), false);
});

test('isWorkbenchNoiseFilePath supports custom directory and glob patterns', () => {
  assert.equal(isWorkbenchNoiseFilePath('cache/build/output.json', ['cache/**']), true);
  assert.equal(isWorkbenchNoiseFilePath('docs/design/notes.bak', ['*.bak']), true);
  assert.equal(isWorkbenchNoiseFilePath('tmp/custom-temp/result.txt', ['custom-temp']), true);
  assert.equal(isWorkbenchNoiseFilePath('docs/design/类型项目.txt', ['cache/**', '*.bak', 'custom-temp']), false);
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

test('toggling a directory can skip conflicted files that are not committable', () => {
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
      path: 'src/conflict-demo.ts',
      status: 'UU',
      staged: false,
      unstaged: true,
      untracked: false,
      deleted: false,
      conflicted: true,
      conflictKind: 'both_modified',
    },
  ]);

  const srcDirectory = tree[0];
  const selected = toggleWorkbenchFileTreeNodeSelection(
    srcDirectory!,
    new Set(),
    (file) => !file.conflicted,
  );

  assert.deepEqual([...selected], ['src/App.tsx']);
  assert.equal(isWorkbenchFileTreeNodeSelected(srcDirectory!, selected, (file) => !file.conflicted), true);
});
