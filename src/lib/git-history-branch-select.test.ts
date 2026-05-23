import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGitHistoryBranchSelectSections } from './git-history-branch-select';
import type { GitBranchCollections } from './git-branch-groups';

const collections: GitBranchCollections = {
  headBranch: null,
  localBranches: [
    { name: 'gtry', current: true, kind: 'local', isRemote: false, localName: 'gtry', remoteName: null, upstream: 'origin/gtry' },
    { name: 'master', current: false, kind: 'local', isRemote: false, localName: 'master', remoteName: null, upstream: 'origin/master' },
  ],
  remoteGroups: [
    {
      name: 'origin',
      branches: [
        { name: 'origin/gtry', current: false, kind: 'remote', isRemote: true, localName: 'gtry', remoteName: 'origin', upstream: null },
        { name: 'origin/main', current: false, kind: 'remote', isRemote: true, localName: 'main', remoteName: 'origin', upstream: null },
      ],
    },
    {
      name: 'upstream',
      branches: [
        { name: 'upstream/release', current: false, kind: 'remote', isRemote: true, localName: 'release', remoteName: 'upstream', upstream: null },
      ],
    },
  ],
  tagBranches: [
    { name: 'v1.0.0', current: false, kind: 'tag', isRemote: false, localName: null, remoteName: null, upstream: null },
  ],
};

test('buildGitHistoryBranchSelectSections 在空关键字时按本地远程标签分组且不带前缀', () => {
  const result = buildGitHistoryBranchSelectSections(collections, '');

  assert.deepEqual(result, [
    {
      id: 'local',
      label: '本地',
      options: [
        { value: 'gtry', label: 'gtry' },
        { value: 'master', label: 'master' },
      ],
    },
    {
      id: 'remote',
      label: '远程',
      options: [
        { value: 'origin/gtry', label: 'origin/gtry' },
        { value: 'origin/main', label: 'origin/main' },
        { value: 'upstream/release', label: 'upstream/release' },
      ],
    },
    {
      id: 'tag',
      label: '标签',
      options: [
        { value: 'v1.0.0', label: 'v1.0.0' },
      ],
    },
  ]);
});

test('buildGitHistoryBranchSelectSections 搜索时仅保留命中的分组和分支', () => {
  const result = buildGitHistoryBranchSelectSections(collections, 'main');

  assert.deepEqual(result, [
    {
      id: 'remote',
      label: '远程',
      options: [
        { value: 'origin/main', label: 'origin/main' },
      ],
    },
  ]);
});
