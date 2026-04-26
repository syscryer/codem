import assert from 'node:assert/strict';
import test from 'node:test';
import { getGitDiffBadgeLabels } from '../src/lib/git-diff';

test('getGitDiffBadgeLabels uses changed files as the primary count', () => {
  const labels = getGitDiffBadgeLabels({
    additions: 0,
    deletions: 0,
    filesChanged: 10,
  });

  assert.equal(labels.primary, '10');
  assert.equal(labels.secondary, '变更');
  assert.equal(labels.detail, '无行增删');
});

test('getGitDiffBadgeLabels includes line delta details when available', () => {
  const labels = getGitDiffBadgeLabels({
    additions: 12,
    deletions: 3,
    filesChanged: 2,
  });

  assert.equal(labels.primary, '2');
  assert.equal(labels.secondary, '变更');
  assert.equal(labels.detail, '+12 -3');
});
