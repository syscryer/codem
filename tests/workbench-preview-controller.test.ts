import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChangedFilePreviewRequest,
  buildProjectFilePreviewRequest,
  closeWorkbenchPreviewTab,
  openWorkbenchPreviewTab,
} from '../src/lib/workbench-preview';
import type { WorkbenchPreviewTab } from '../src/types';

test('openWorkbenchPreviewTab reuses an existing tab key instead of appending duplicates', () => {
  const existing: WorkbenchPreviewTab[] = [
    {
      key: 'file:README.md',
      path: 'README.md',
      name: 'README.md',
      kind: 'markdown',
      source: 'project-file',
    },
  ];

  const next = openWorkbenchPreviewTab(
    existing,
    buildProjectFilePreviewRequest({
      path: 'README.md',
      name: 'README.md',
      type: 'file',
    }),
  );

  assert.equal(next.tabs.length, 1);
  assert.equal(next.activeKey, 'file:README.md');
});

test('buildChangedFilePreviewRequest keeps changed files on file-preview tabs', () => {
  const preview = buildChangedFilePreviewRequest({
    path: 'src/App.tsx',
    status: 'M',
    staged: false,
    unstaged: true,
    untracked: false,
    deleted: false,
  });

  assert.equal(preview.key, 'file:src/App.tsx');
  assert.equal(preview.kind, 'code');
  assert.equal(preview.source, 'changed-file');
});

test('closeWorkbenchPreviewTab moves focus to the previous surviving tab', () => {
  const tabs: WorkbenchPreviewTab[] = [
    {
      key: 'file:README.md',
      path: 'README.md',
      name: 'README.md',
      kind: 'markdown',
      source: 'project-file',
    },
    {
      key: 'file:src/App.tsx',
      path: 'src/App.tsx',
      name: 'App.tsx',
      kind: 'code',
      source: 'changed-file',
    },
  ];

  const next = closeWorkbenchPreviewTab(tabs, 'file:src/App.tsx', 'file:src/App.tsx');

  assert.deepEqual(next.tabs.map((tab) => tab.key), ['file:README.md']);
  assert.equal(next.activeKey, 'file:README.md');
});

test('openWorkbenchPreviewTab appends a second file and activates it', () => {
  const first = openWorkbenchPreviewTab([], {
    key: 'file:README.md',
    path: 'README.md',
    name: 'README.md',
    kind: 'markdown',
    source: 'project-file',
  });

  const second = openWorkbenchPreviewTab(first.tabs, {
    key: 'file:src/App.tsx',
    path: 'src/App.tsx',
    name: 'App.tsx',
    kind: 'code',
    source: 'changed-file',
  });

  assert.deepEqual(second.tabs.map((tab) => tab.key), ['file:README.md', 'file:src/App.tsx']);
  assert.equal(second.activeKey, 'file:src/App.tsx');
});

test('buildChangedFilePreviewRequest uses code preview for modified TypeScript files', () => {
  const request = buildChangedFilePreviewRequest({
    path: 'src/components/RightWorkbench.tsx',
    status: 'M',
    staged: false,
    unstaged: true,
    untracked: false,
    deleted: false,
  });

  assert.equal(request.kind, 'code');
  assert.equal(request.name, 'RightWorkbench.tsx');
});
