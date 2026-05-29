import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Git commit entry opens the right workbench review panel instead of the modal dialog', () => {
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

  assert.match(appSource, /function openGitCommitWorkbench\(\)/);
  assert.match(appSource, /setRightWorkbenchOpen\(true\);\s*setRightWorkbenchTab\('review'\);/);
  assert.match(appSource, /onOpenGitCommit=\{openGitCommitWorkbench\}/);
  assert.doesNotMatch(appSource, /setGitDialogMode\('commit'\)/);
});

test('GitDialog keeps push and branch modal flows but does not expose commit mode', () => {
  const gitDialogSource = readFileSync(new URL('../components/GitDialog.tsx', import.meta.url), 'utf8');

  assert.match(gitDialogSource, /type GitDialogMode = 'push' \| 'branch';/);
  assert.doesNotMatch(gitDialogSource, /activeMode === 'commit'/);
  assert.doesNotMatch(gitDialogSource, /提交并推送/);
});

test('GitDialog uses a compact confirmation layout and hides raw long warnings behind details', () => {
  const gitDialogSource = readFileSync(new URL('../components/GitDialog.tsx', import.meta.url), 'utf8');
  const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(gitDialogSource, /<GitDialogNotice message=\{error\} \/>/);
  assert.match(gitDialogSource, /function GitDialogNotice\(\{ message \}: \{ message: string \}\)/);
  assert.match(gitDialogSource, /部分路径过长，Git 状态读取受限/);
  assert.match(gitDialogSource, /查看详情/);
  assert.match(gitDialogSource, /复制详情/);
  assert.doesNotMatch(gitDialogSource, /<div className="dialog-error git-dialog-error">\{error\}<\/div>/);
  assert.match(stylesSource, /\.git-dialog-card \{\s*width: min\(620px, calc\(100vw - 36px\)\);/);
  assert.match(stylesSource, /\.git-dialog-notice-detail pre/);
  assert.match(stylesSource, /\.git-push-panel,\s*\.git-branch-panel \{\s*min-height: 0;/);
});

test('GitDialog keeps header, tabs, notices, and empty states visually compact', () => {
  const gitDialogSource = readFileSync(new URL('../components/GitDialog.tsx', import.meta.url), 'utf8');
  const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(gitDialogSource, /<div className="git-dialog-title-block">/);
  assert.match(gitDialogSource, /<div className="git-dialog-title-row">/);
  assert.match(gitDialogSource, /<div className="git-dialog-heading">/);
  assert.match(gitDialogSource, /className="git-dialog-meta"/);
  assert.match(gitDialogSource, /className="git-dialog-mode-strip"/);
  assert.match(stylesSource, /\.git-dialog-card \{\s*width: min\(620px, calc\(100vw - 36px\)\);[\s\S]*?gap: 10px;/);
  assert.match(stylesSource, /\.git-dialog-head \{[\s\S]*?display: grid;[\s\S]*?gap: 10px;/);
  assert.match(stylesSource, /\.git-dialog-title-row \{[\s\S]*?display: flex;[\s\S]*?flex-wrap: wrap;/);
  assert.match(stylesSource, /\.git-dialog-meta \{/);
  assert.match(stylesSource, /\.git-dialog-mode-strip \{/);
  assert.match(stylesSource, /\.git-dialog-notice \{[\s\S]*?padding: 9px 10px;/);
  assert.match(stylesSource, /\.git-push-empty \{[\s\S]*?min-height: 120px;/);
});
