import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGitBranchCollections } from './git-branch-groups';
import type { GitBranchSummary } from '../types';

test('buildGitBranchCollections 按本地和远程名分组', () => {
  const branches: GitBranchSummary[] = [
    { name: 'lulu', current: true, kind: 'local', isRemote: false, localName: 'lulu', remoteName: null, upstream: 'origin/lulu' },
    { name: 'master', current: false, kind: 'local', isRemote: false, localName: 'master', remoteName: null, upstream: 'origin/master' },
    { name: 'origin/master', current: false, kind: 'remote', isRemote: true, localName: 'master', remoteName: 'origin', upstream: null },
    { name: 'origin/lulu', current: false, kind: 'remote', isRemote: true, localName: 'lulu', remoteName: 'origin', upstream: null },
    { name: 'upstream/release', current: false, kind: 'remote', isRemote: true, localName: 'release', remoteName: 'upstream', upstream: null },
    { name: 'v1.0.0', current: false, kind: 'tag', isRemote: false, localName: null, remoteName: null, upstream: null },
  ];

  const result = buildGitBranchCollections(branches, 'lulu');

  assert.equal(result.headBranch?.name, 'lulu');
  assert.deepEqual(result.localBranches.map((branch) => branch.name), ['lulu', 'master']);
  assert.deepEqual(result.tagBranches.map((branch) => branch.name), ['v1.0.0']);
  assert.deepEqual(
    result.remoteGroups.map((group) => ({
      name: group.name,
      branches: group.branches.map((branch) => branch.name),
    })),
    [
      { name: 'origin', branches: ['origin/master', 'origin/lulu'] },
      { name: 'upstream', branches: ['upstream/release'] },
    ],
  );
});

test('buildGitBranchCollections 在没有匹配 HEAD 分支时保留空 head', () => {
  const result = buildGitBranchCollections([], 'missing');

  assert.equal(result.headBranch, null);
  assert.deepEqual(result.localBranches, []);
  assert.deepEqual(result.remoteGroups, []);
  assert.deepEqual(result.tagBranches, []);
});
