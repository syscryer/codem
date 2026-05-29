import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGitHistoryBranchContextActions,
  buildGitHistoryCommitContextActions,
  buildGitHistoryFileContextActions,
} from './git-history-context-menu.js';
import type { GitBranchSummary, GitHistoryCommitFile, GitHistoryLogCommit } from '../types.js';

test('buildGitHistoryBranchContextActions gives remote branches fetch compare create and copy actions', () => {
  const branch: GitBranchSummary = {
    name: 'origin/feature/menu',
    current: false,
    kind: 'remote',
    isRemote: true,
    remoteName: 'origin',
    localName: 'feature/menu',
    upstream: null,
  };

  const actions = buildGitHistoryBranchContextActions(branch, 'main').map((action) => action.id);

  assert.deepEqual(actions, [
    'checkout',
    'create-branch',
    'create-tag',
    'compare-with-current',
    'fetch-remote',
    'copy-branch-name',
    'delete-branch',
  ]);

  assert.equal(
    buildGitHistoryBranchContextActions(branch, 'main').find((action) => action.id === 'fetch-remote')?.label,
    '获取 origin 更新',
  );
});

test('buildGitHistoryBranchContextActions protects the current local branch from delete and compare', () => {
  const branch: GitBranchSummary = {
    name: 'main',
    current: true,
    kind: 'local',
    isRemote: false,
    remoteName: null,
    localName: 'main',
    upstream: 'origin/main',
  };

  const actions = buildGitHistoryBranchContextActions(branch, 'main');
  const checkout = actions.find((action) => action.id === 'checkout');
  const compare = actions.find((action) => action.id === 'compare-with-current');

  assert.equal(checkout?.disabled, true);
  assert.equal(compare?.disabled, true);
  assert.equal(actions.some((action) => action.id === 'pull-current'), true);
  assert.equal(actions.some((action) => action.id === 'pull-current-merge'), true);
  assert.equal(actions.some((action) => action.id === 'pull-current-rebase'), true);
  assert.equal(actions.some((action) => action.id === 'push-current'), true);
  assert.equal(actions.some((action) => action.id === 'delete-branch'), false);
});

test('buildGitHistoryCommitContextActions exposes safe copy and ref creation actions first', () => {
  const commit = buildCommit();

  const actions = buildGitHistoryCommitContextActions(commit, { currentBranch: 'main' }).map((action) => action.id);

  assert.deepEqual(actions, [
    'open-commit',
    'create-branch',
    'create-tag',
    'checkout-detached',
    'cherry-pick',
    'copy-commit-hash',
    'copy-commit-summary',
    'copy-commit-message',
  ]);
});

test('buildGitHistoryFileContextActions includes rename-aware copy actions', () => {
  const file: GitHistoryCommitFile = {
    path: 'src/new-name.ts',
    originalPath: 'src/old-name.ts',
    status: '重命名',
    additions: 4,
    deletions: 2,
    binary: false,
  };

  const actions = buildGitHistoryFileContextActions(file).map((action) => action.id);

  assert.deepEqual(actions, [
    'open-diff',
    'copy-path',
    'copy-original-path',
    'copy-full-path',
    'reveal-file',
  ]);
});

function buildCommit(): GitHistoryLogCommit {
  return {
    sha: '1234567890abcdef',
    shortSha: '1234567',
    summary: 'add menu actions',
    message: 'add menu actions\n\nbody',
    author: 'MNL',
    authorEmail: 'mnl@example.test',
    commitTime: 1710000000,
    parents: ['abcdef1234567890'],
    refs: [],
    graphText: '',
    graph: {
      lane: 0,
      colorIndex: 0,
      segmentsBefore: [],
      segmentsAfter: [],
    },
  };
}
