import type { GitBranchSummary } from '../types';

export type GitRemoteBranchGroup = {
  name: string;
  branches: GitBranchSummary[];
};

export type GitBranchCollections = {
  headBranch: GitBranchSummary | null;
  localBranches: GitBranchSummary[];
  remoteGroups: GitRemoteBranchGroup[];
  tagBranches: GitBranchSummary[];
};

export function buildGitBranchCollections(
  branches: GitBranchSummary[],
  currentBranch: string,
): GitBranchCollections {
  const localBranches = branches.filter((branch) => branch.kind === 'local' || (!branch.kind && !branch.isRemote));
  const remoteBranches = branches.filter((branch) => branch.kind === 'remote' || branch.isRemote);
  const tagBranches = branches.filter((branch) => branch.kind === 'tag');
  const headBranch = localBranches.find((branch) => branch.localName === currentBranch || branch.name === currentBranch) ?? null;
  const remoteGroupsMap = new Map<string, GitBranchSummary[]>();

  for (const branch of remoteBranches) {
    const groupName = branch.remoteName?.trim() || branch.name.split('/')[0] || 'remote';
    const bucket = remoteGroupsMap.get(groupName);
    if (bucket) {
      bucket.push(branch);
      continue;
    }
    remoteGroupsMap.set(groupName, [branch]);
  }

  const remoteGroups = Array.from(remoteGroupsMap.entries()).map(([name, groupedBranches]) => ({
    name,
    branches: groupedBranches,
  }));

  return {
    headBranch,
    localBranches,
    remoteGroups,
    tagBranches,
  };
}
