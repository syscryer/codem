import type { GitBranchCollections } from './git-branch-groups';

export type GitHistoryBranchSelectOption = {
  value: string;
  label: string;
};

export type GitHistoryBranchSelectSection = {
  id: 'local' | 'remote' | 'tag';
  label: string;
  options: GitHistoryBranchSelectOption[];
};

export function buildGitHistoryBranchSelectSections(
  collections: GitBranchCollections,
  keyword: string,
): GitHistoryBranchSelectSection[] {
  const normalizedKeyword = keyword.trim().toLowerCase();
  const matches = (values: Array<string | null | undefined>) =>
    !normalizedKeyword || values.some((value) => (value ?? '').toLowerCase().includes(normalizedKeyword));

  const localOptions = collections.localBranches
    .filter((branch) => matches([branch.name, branch.localName]))
    .map((branch) => ({ value: branch.name, label: branch.name }));

  const remoteOptions = collections.remoteGroups
    .flatMap((group) => group.branches)
    .filter((branch) => matches([branch.name, branch.localName, branch.remoteName]))
    .map((branch) => ({ value: branch.name, label: branch.name }));

  const tagOptions = collections.tagBranches
    .filter((branch) => matches([branch.name]))
    .map((branch) => ({ value: branch.name, label: branch.name }));

  const sections: GitHistoryBranchSelectSection[] = [
    { id: 'local', label: '本地', options: localOptions },
    { id: 'remote', label: '远程', options: remoteOptions },
    { id: 'tag', label: '标签', options: tagOptions },
  ];

  return sections.filter((section) => section.options.length > 0);
}
