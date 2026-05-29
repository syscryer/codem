import type { GitBranchSummary, GitHistoryCommitFile, GitHistoryLogCommit } from '../types';

export type GitHistoryContextAction = {
  id:
    | 'checkout'
    | 'create-branch'
    | 'create-tag'
    | 'compare-with-current'
    | 'pull-current'
    | 'pull-current-merge'
    | 'pull-current-rebase'
    | 'push-current'
    | 'fetch-remote'
    | 'copy-branch-name'
    | 'delete-branch'
    | 'open-commit'
    | 'checkout-detached'
    | 'cherry-pick'
    | 'copy-commit-hash'
    | 'copy-commit-summary'
    | 'copy-commit-message'
    | 'open-diff'
    | 'copy-path'
    | 'copy-original-path'
    | 'copy-full-path'
    | 'reveal-file';
  label: string;
  disabled?: boolean;
  danger?: boolean;
};

export function buildGitHistoryBranchContextActions(
  branch: GitBranchSummary,
  currentBranch?: string,
): GitHistoryContextAction[] {
  const branchName = branch.localName ?? branch.name;
  const matchesCurrent = branchMatchesCurrent(branch, currentBranch);
  const canSyncCurrentBranch = matchesCurrent && branch.kind !== 'tag' && !branch.isRemote;
  const actions: GitHistoryContextAction[] = [
    {
      id: 'checkout',
      label: branch.kind === 'tag' ? '签出标签（Detached）' : '签出',
      disabled: matchesCurrent,
    },
  ];

  if (canSyncCurrentBranch) {
    actions.push(
      { id: 'pull-current', label: '拉取当前分支' },
      { id: 'pull-current-merge', label: '合并拉取当前分支' },
      { id: 'pull-current-rebase', label: '变基拉取当前分支' },
      { id: 'push-current', label: '推送当前分支' },
    );
  }

  actions.push(
    { id: 'create-branch', label: '基于此创建分支' },
    { id: 'create-tag', label: '基于此创建标签' },
    {
      id: 'compare-with-current',
      label: '与当前分支比较',
      disabled: !currentBranch || matchesCurrent,
    },
  );

  if (branch.isRemote || branch.remoteName) {
    actions.push({
      id: 'fetch-remote',
      label: branch.remoteName ? `获取 ${branch.remoteName} 更新` : '获取远端更新',
    });
  }

  actions.push({ id: 'copy-branch-name', label: '复制分支名' });

  if (!matchesCurrent && branch.kind !== 'tag') {
    actions.push({
      id: 'delete-branch',
      label: branch.isRemote ? `删除远程分支 ${branchName}` : `删除分支 ${branchName}`,
      danger: true,
    });
  }

  return actions;
}

export function buildGitHistoryCommitContextActions(
  _commit: GitHistoryLogCommit,
  _options: { currentBranch?: string } = {},
): GitHistoryContextAction[] {
  return [
    { id: 'open-commit', label: '查看提交详情' },
    { id: 'create-branch', label: '基于此提交创建分支' },
    { id: 'create-tag', label: '基于此提交创建标签' },
    { id: 'checkout-detached', label: '签出此提交（Detached）' },
    { id: 'cherry-pick', label: 'Cherry-pick 此提交' },
    { id: 'copy-commit-hash', label: '复制提交哈希' },
    { id: 'copy-commit-summary', label: '复制提交标题' },
    { id: 'copy-commit-message', label: '复制提交信息' },
  ];
}

export function buildGitHistoryFileContextActions(file: GitHistoryCommitFile): GitHistoryContextAction[] {
  const actions: GitHistoryContextAction[] = [
    { id: 'open-diff', label: '打开变更' },
    { id: 'copy-path', label: '复制路径' },
  ];

  if (file.originalPath && file.originalPath !== file.path) {
    actions.push({ id: 'copy-original-path', label: '复制旧路径' });
  }

  actions.push({ id: 'copy-full-path', label: '复制完整路径' });

  if (!isDeletedHistoryFile(file)) {
    actions.push({ id: 'reveal-file', label: '在资源管理器中显示' });
  }

  return actions;
}

function branchMatchesCurrent(branch: GitBranchSummary, currentBranch?: string) {
  if (!currentBranch) {
    return branch.current;
  }

  return branch.current || branch.name === currentBranch || branch.localName === currentBranch;
}

function isDeletedHistoryFile(file: GitHistoryCommitFile) {
  return file.status === '删除' || file.status.toUpperCase().startsWith('D');
}
