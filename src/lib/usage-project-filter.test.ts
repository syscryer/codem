import assert from 'node:assert/strict';
import test from 'node:test';
import type { UsageProjectRow } from '../types';
import { filterUsageProjects } from './usage-project-filter';

const baseProjectTotals = {
  projects: 1,
  threads: 0,
  messages: 0,
  toolCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  totalTokens: 0,
  durationMs: 0,
  totalCostUsd: 0,
};

function project(projectId: string, projectName: string, projectPath: string): UsageProjectRow {
  return {
    ...baseProjectTotals,
    projectId,
    projectName,
    projectPath,
    lastUsedAt: null,
  };
}

test('filterUsageProjects matches project names and paths case-insensitively', () => {
  const projects = [
    project('codem', 'codem', 'D:\\project\\codem'),
    project('git-tools', 'Git Tools', 'D:\\work\\tools'),
    project('usage-lab', 'Usage Lab', 'D:\\project\\analytics'),
  ];

  assert.deepEqual(filterUsageProjects(projects, 'git').map((item) => item.projectId), ['git-tools']);
  assert.deepEqual(filterUsageProjects(projects, 'PROJECT').map((item) => item.projectId), ['codem', 'usage-lab']);
});

test('filterUsageProjects keeps every project when the query is blank', () => {
  const projects = [
    project('codem', 'codem', 'D:\\project\\codem'),
    project('usage-lab', 'Usage Lab', 'D:\\project\\analytics'),
  ];

  assert.deepEqual(filterUsageProjects(projects, '   '), projects);
});
