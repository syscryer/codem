import type { GitDiffSummary } from '../types';

export function getGitDiffBadgeLabels(diff: GitDiffSummary) {
  const additions = normalizeCount(diff.additions);
  const deletions = normalizeCount(diff.deletions);
  const filesChanged = normalizeCount(diff.filesChanged);
  const hasLineChanges = additions > 0 || deletions > 0;

  return {
    primary: String(filesChanged),
    secondary: '变更',
    detail: hasLineChanges ? `+${additions} -${deletions}` : '无行增删',
  };
}

function normalizeCount(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
