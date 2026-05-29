import type { RefObject } from 'react';

type ContextMenuDismissSelector = {
  selector: string;
  onDismiss: () => void;
  anchorRefs?: RefObject<HTMLElement | null>[];
};

type GitHistoryContextMenuDismissArgs = {
  branchMenuRef: RefObject<HTMLElement | null>;
  commitMenuRef: RefObject<HTMLElement | null>;
  fileMenuRef: RefObject<HTMLElement | null>;
  onDismissBranch: () => void;
  onDismissCommit: () => void;
  onDismissFile: () => void;
};

export function buildGitHistoryContextMenuDismissSelectors(
  args: GitHistoryContextMenuDismissArgs,
): ContextMenuDismissSelector[] {
  return [
    {
      selector: '.git-history-branch-context-menu',
      onDismiss: args.onDismissBranch,
      anchorRefs: [args.branchMenuRef],
    },
    {
      selector: '.git-history-commit-context-menu',
      onDismiss: args.onDismissCommit,
      anchorRefs: [args.commitMenuRef],
    },
    {
      selector: '.git-history-file-context-menu',
      onDismiss: args.onDismissFile,
      anchorRefs: [args.fileMenuRef],
    },
  ];
}
