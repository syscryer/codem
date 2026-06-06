import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const useWorkspaceStateSource = readFileSync(new URL('../hooks/useWorkspaceState.ts', import.meta.url), 'utf8');
const useClaudeRunSource = readFileSync(new URL('../hooks/useClaudeRun.ts', import.meta.url), 'utf8');
const rightWorkbenchSource = readFileSync(new URL('../components/RightWorkbench.tsx', import.meta.url), 'utf8');
const sessionManagementSource = readFileSync(new URL('../components/settings/SessionManagementSettings.tsx', import.meta.url), 'utf8');
const worktreeSettingsSource = readFileSync(new URL('../components/settings/WorktreeSettings.tsx', import.meta.url), 'utf8');
const gitConflictCenterSource = readFileSync(new URL('../components/GitConflictCenter.tsx', import.meta.url), 'utf8');
const gitConflictMergeDialogSource = readFileSync(new URL('../components/git-conflict/GitConflictMergeDialog.tsx', import.meta.url), 'utf8');
const gitConflictOverviewDialogSource = readFileSync(new URL('../components/git-conflict/GitConflictOverviewDialog.tsx', import.meta.url), 'utf8');

test('conversation flow success feedback stays in the conversation UI instead of toast', () => {
  assert.doesNotMatch(useClaudeRunSource, /已回答 Claude 的提问。/);
  assert.doesNotMatch(useClaudeRunSource, /已将补充信息作为续聊提交。/);
  assert.doesNotMatch(useClaudeRunSource, /已批准并继续任务。/);
  assert.doesNotMatch(useClaudeRunSource, /已拒绝该操作并继续任务。/);
});

test('obvious workspace updates stay silent while failures still toast', () => {
  assert.doesNotMatch(appSource, /showToast\('项目已刷新'\)/);
  assert.doesNotMatch(useWorkspaceStateSource, /已新建聊天/);
  assert.doesNotMatch(useWorkspaceStateSource, /聊天名称已更新/);
  assert.doesNotMatch(useWorkspaceStateSource, /项目名称已更新/);
  assert.doesNotMatch(useWorkspaceStateSource, /已切换到工作树/);
  assert.match(appSource, /showToast\(error instanceof Error \? error\.message : '刷新项目失败', 'error'\)/);
  assert.match(useWorkspaceStateSource, /showToast\(error instanceof Error \? error\.message : '操作失败', 'error'\)/);
});

test('copy path success is inline or silent while copy failures still toast', () => {
  const copyNavigatorContextPathSource = extractFunctionBody(rightWorkbenchSource, 'copyNavigatorContextPath');

  assert.doesNotMatch(copyNavigatorContextPathSource, /完整路径已复制|路径已复制/);
  assert.match(copyNavigatorContextPathSource, /showToast\('复制路径失败', 'error'\)/);
});

test('confirm-again prompts use inline confirmation state instead of toast', () => {
  assert.doesNotMatch(sessionManagementSource, /showToast\(`再次点击“删除所选”/);
  assert.match(sessionManagementSource, /确认删除所选/);
  assert.match(sessionManagementSource, /再次点击将删除/);

  assert.doesNotMatch(worktreeSettingsSource, /showToast\(`再次点击“删除”/);
  assert.match(worktreeSettingsSource, /确认删除/);
  assert.match(worktreeSettingsSource, /再次点击将移除该工作树/);
});

test('git conflict success feedback is inline while error toasts remain', () => {
  assert.doesNotMatch(gitConflictCenterSource, /showToast\('冲突结果已保存'\)/);
  assert.doesNotMatch(gitConflictCenterSource, /showToast\('已标记冲突解决'\)/);
  assert.match(gitConflictCenterSource, /git-conflict-inline-status/);
  assert.match(gitConflictCenterSource, /showToast\(error instanceof Error \? error\.message : 'Git 冲突操作失败', 'error'\)/);

  assert.doesNotMatch(gitConflictMergeDialogSource, /showToast\('冲突结果已保存'\)/);
  assert.doesNotMatch(gitConflictMergeDialogSource, /showToast\('已保存并标记冲突解决'\)/);
  assert.match(gitConflictMergeDialogSource, /git-conflict-inline-status/);
  assert.match(gitConflictMergeDialogSource, /showToast\(caughtError instanceof Error \? caughtError\.message : '保存冲突结果失败', 'error'\)/);

  assert.doesNotMatch(gitConflictOverviewDialogSource, /showToast\(choice === 'current' \? '已接受当前版本' : '已接受传入版本'\)/);
  assert.match(gitConflictOverviewDialogSource, /git-conflict-inline-status/);
  assert.match(gitConflictOverviewDialogSource, /showToast\(caughtError instanceof Error \? caughtError\.message : 'Git 冲突操作失败', 'error'\)/);
});

function extractFunctionBody(source: string, functionName: string) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `Missing function ${functionName}`);
  const bodyStart = source.indexOf('{', start);
  assert.ok(bodyStart >= 0, `Missing body for ${functionName}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart + 1, index);
      }
    }
  }
  throw new Error(`Could not extract function ${functionName}`);
}
