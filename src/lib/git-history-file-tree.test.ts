import assert from 'node:assert/strict';
import test from 'node:test';

import type { GitHistoryCommitFile } from '../types';
import { buildGitHistoryFileTree } from './git-history-file-tree';

test('buildGitHistoryFileTree 按目录组织提交文件', () => {
  const files: GitHistoryCommitFile[] = [
    { path: 'src/components/App.tsx', status: '修改', additions: 10, deletions: 2, binary: false },
    { path: 'src/lib/git-api.ts', status: '新增', additions: 12, deletions: 0, binary: false },
    { path: 'README.md', status: '修改', additions: 2, deletions: 1, binary: false },
  ];

  const tree = buildGitHistoryFileTree(files);

  assert.equal(tree.length, 2);
  assert.equal(tree[0]?.type, 'dir');
  assert.equal(tree[0]?.path, 'src');
  if (tree[0]?.type !== 'dir') {
    return;
  }
  assert.equal(tree[0].children.length, 2);
  assert.equal(tree[1]?.type, 'file');
  assert.equal(tree[1]?.path, 'README.md');
});

test('buildGitHistoryFileTree 为重命名文件保留原路径信息', () => {
  const files: GitHistoryCommitFile[] = [
    {
      path: 'src/new-name.ts',
      originalPath: 'src/old-name.ts',
      status: '重命名',
      additions: 0,
      deletions: 0,
      binary: false,
    },
  ];

  const tree = buildGitHistoryFileTree(files);
  assert.equal(tree[0]?.type, 'dir');
  if (tree[0]?.type !== 'dir') {
    return;
  }
  assert.equal(tree[0].children[0]?.type, 'file');
  if (tree[0].children[0]?.type !== 'file') {
    return;
  }
  assert.equal(tree[0].children[0].file.originalPath, 'src/old-name.ts');
});
