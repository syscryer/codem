import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGitHistoryContextMenuDismissSelectors } from './git-history-context-menu-dismiss.js';

test('buildGitHistoryContextMenuDismissSelectors only protects the open menu, not the whole history panel', () => {
  const branchMenuRef = createRef('branch-menu');
  const commitMenuRef = createRef('commit-menu');
  const fileMenuRef = createRef('file-menu');

  const selectors = buildGitHistoryContextMenuDismissSelectors({
    branchMenuRef,
    commitMenuRef,
    fileMenuRef,
    onDismissBranch: () => undefined,
    onDismissCommit: () => undefined,
    onDismissFile: () => undefined,
  });

  assert.deepEqual(selectors.map((entry) => entry.selector), [
    '.git-history-branch-context-menu',
    '.git-history-commit-context-menu',
    '.git-history-file-context-menu',
  ]);
  assert.deepEqual(selectors.map((entry) => entry.anchorRefs), [
    [branchMenuRef],
    [commitMenuRef],
    [fileMenuRef],
  ]);
});

function createRef(id: string) {
  return {
    current: {
      id,
      contains: () => false,
    } as unknown as HTMLElement,
  };
}
