import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('RightWorkbench wires Git conflict state into the review panel', () => {
  const source = readFileSync(new URL('../components/RightWorkbench.tsx', import.meta.url), 'utf8');

  assert.match(source, /import \{ GitConflictCenter \} from '\.\/GitConflictCenter';/);
  assert.match(source, /fetchGitOperationState\(activeProject\.id\)/);
  assert.match(source, /<GitConflictCenter/);
  assert.match(source, /gitOperationState\?\.hasConflicts/);
  assert.match(source, /commitDisabled =[\s\S]*?gitOperationState\?\.hasConflicts/);
});

test('GitConflictCenter exposes a complete conflict resolution workflow', () => {
  const source = readFileSync(new URL('../components/GitConflictCenter.tsx', import.meta.url), 'utf8');

  assert.match(source, /pullGitBranch/);
  assert.match(source, /fetchGitConflictFile/);
  assert.match(source, /saveGitConflictResult/);
  assert.match(source, /markGitConflictResolved/);
  assert.match(source, /continueGitOperation/);
  assert.match(source, /abortGitOperation/);
  assert.match(source, /接受当前/);
  assert.match(source, /接受传入/);
  assert.match(source, /接受双方/);
  assert.match(source, /保存结果/);
  assert.match(source, /标记已解决/);
  assert.match(source, /继续操作/);
  assert.match(source, /中止操作/);
  assert.match(source, /operationState\.status !== 'diverged'/);
  assert.match(source, /operationState\.status !== 'blocked_dirty'/);
  assert.match(source, /当前分支与远端分叉/);
  assert.match(source, /远端有更新且当前存在未提交变更/);
});

test('GitConflictCenter offers direct recovery actions for diverged branches', () => {
  const source = readFileSync(new URL('../components/GitConflictCenter.tsx', import.meta.url), 'utf8');

  assert.match(source, /operationState\.status === 'diverged'/);
  assert.match(source, /useState<GitPullMode \| null>\(null\)/);
  assert.match(source, /onClick=\{\(\) => requestDivergedPull\('merge'\)\}/);
  assert.match(source, /onClick=\{\(\) => requestDivergedPull\('rebase'\)\}/);
  assert.match(source, /git-conflict-confirm-strip/);
  assert.match(source, /onClick=\{\(\) => void confirmDivergedPull\(\)\}/);
  assert.match(source, /合并拉取/);
  assert.match(source, /变基拉取/);
  assert.match(source, /await pullGitBranch\(projectId, operationState\?\.remote, operationState\?\.branch, mode\)/);
  assert.match(source, /await Promise\.resolve\(onChanged\(\)\)/);
  assert.match(source, /拉取已进入冲突状态/);
  assert.doesNotMatch(source, /window\.confirm/);
  assert.doesNotMatch(source, /确定要\$\\\{label\\\}当前分支吗/);
});
