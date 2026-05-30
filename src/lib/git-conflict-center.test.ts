import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('RightWorkbench wires Git conflict state into the review panel', () => {
  const source = readFileSync(new URL('../components/RightWorkbench.tsx', import.meta.url), 'utf8');

  assert.match(source, /import \{ GitConflictStatusStrip \} from '\.\/git-conflict\/GitConflictStatusStrip';/);
  assert.match(source, /fetchGitOperationState\(activeProject\.id\)/);
  assert.match(source, /<GitConflictStatusStrip/);
  assert.match(source, /gitOperationState\?\.hasConflicts/);
  assert.match(source, /commitDisabled =[\s\S]*?gitOperationState\?\.hasConflicts/);
});

test('GitConflictStatusStrip keeps the workbench as a status entry instead of an inline merge editor', () => {
  const rightWorkbenchSource = readFileSync(new URL('../components/RightWorkbench.tsx', import.meta.url), 'utf8');
  const statusStripSource = readFileSync(new URL('../components/git-conflict/GitConflictStatusStrip.tsx', import.meta.url), 'utf8');

  assert.match(rightWorkbenchSource, /GitConflictStatusStrip/);
  assert.match(statusStripSource, /解决冲突/);
  assert.match(statusStripSource, /当前分支与远端分叉/);
  assert.match(statusStripSource, /远端有更新，但工作区存在未提交变更/);
  assert.doesNotMatch(statusStripSource, /<textarea/);
});

test('GitConflictOverviewDialog exposes IDEA-style file list and file-level actions', () => {
  const source = readFileSync(new URL('../components/git-conflict/GitConflictOverviewDialog.tsx', import.meta.url), 'utf8');

  assert.match(source, /接受当前/);
  assert.match(source, /接受传入/);
  assert.match(source, /合并\.\.\./);
  assert.match(source, /继续操作/);
  assert.match(source, /中止操作/);
  assert.match(source, /saveGitConflictResult/);
  assert.match(source, /markGitConflictResolved/);
  assert.match(source, /buildConflictResolutionContent/);
});

test('GitConflictMergeDialog uses a large result editor and explicit save actions', () => {
  const source = readFileSync(new URL('../components/git-conflict/GitConflictMergeDialog.tsx', import.meta.url), 'utf8');

  assert.match(source, /idea-merge-toolbar/);
  assert.match(source, /idea-merge-pane/);
  assert.match(source, /idea-merge-result/);
  assert.match(source, /来自/);
  assert.match(source, /结果/);
  assert.match(source, /保存结果/);
  assert.match(source, /保存并标记解决/);
  assert.match(source, /个冲突待处理/);
  assert.match(source, /结果中没有冲突标记/);
  assert.doesNotMatch(source, /没有更改/);
  assert.match(source, /取消/);
  assert.match(source, /buildConflictResolutionContent\(detail, 'both'\)/);
  assert.match(source, /buildConflictEditorLines/);
  assert.match(source, /detectConflictBlocks/);
  assert.match(source, /saveGitConflictResult/);
  assert.match(source, /markGitConflictResolved/);
});

test('GitConflictMergeDialog does not show unimplemented IDEA toolbar controls', () => {
  const source = readFileSync(new URL('../components/git-conflict/GitConflictMergeDialog.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /应用不冲突的更改/);
  assert.doesNotMatch(source, /不忽略/);
  assert.doesNotMatch(source, /高亮显示单词/);
  assert.doesNotMatch(source, /idea-merge-select-button/);
  assert.doesNotMatch(source, /<Settings/);
});

test('GitConflictMergeDialog keeps accept actions out of the toolbar and implements synchronized scrolling', () => {
  const source = readFileSync(new URL('../components/git-conflict/GitConflictMergeDialog.tsx', import.meta.url), 'utf8');
  const toolbarBlock = source.match(/<div className="idea-merge-toolbar"[\s\S]*?<div className="idea-merge-spacer" \/>/)?.[0] ?? '';

  assert.doesNotMatch(toolbarBlock, /acceptChoice\('current'\)/);
  assert.doesNotMatch(toolbarBlock, /acceptChoice\('incoming'\)/);
  assert.doesNotMatch(toolbarBlock, /acceptChoice\('both'\)/);
  assert.match(source, /useState\(true\)/);
  assert.match(source, /leftScrollRef/);
  assert.match(source, /resultScrollRef/);
  assert.match(source, /rightScrollRef/);
  assert.match(source, /handleSynchronizedScroll/);
  assert.match(source, /aria-pressed=\{syncScroll\}/);
  assert.match(source, /aria-label=\{syncScroll \? '关闭同步滚动' : '开启同步滚动'\}/);
  assert.doesNotMatch(toolbarBlock, /<ArrowLeftRight size=\{15\} \/>\s*同步滚动/);
});

test('GitConflictMergeDialog can jump between conflict blocks from compact toolbar icons', () => {
  const source = readFileSync(new URL('../components/git-conflict/GitConflictMergeDialog.tsx', import.meta.url), 'utf8');
  const toolbarBlock = source.match(/<div className="idea-merge-toolbar"[\s\S]*?<div className="idea-merge-spacer" \/>/)?.[0] ?? '';

  assert.match(source, /ArrowUp/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /goToConflictBlock/);
  assert.match(toolbarBlock, /aria-label="上一个冲突"/);
  assert.match(toolbarBlock, /aria-label="下一个冲突"/);
  assert.match(toolbarBlock, /goToConflictBlock\('previous'\)/);
  assert.match(toolbarBlock, /goToConflictBlock\('next'\)/);
  assert.match(toolbarBlock, /disabled=\{conflictBlocks\.length === 0\}/);
});

test('GitConflictMergeDialog highlights side conflict blocks and code tokens', () => {
  const source = readFileSync(new URL('../components/git-conflict/GitConflictMergeDialog.tsx', import.meta.url), 'utf8');
  const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(source, /buildConflictSideLineMetadata/);
  assert.match(source, /tokenizeCodeLine/);
  assert.match(source, /currentLineMetadata/);
  assert.match(source, /incomingLineMetadata/);
  assert.match(source, /lineMetadata\.get\(line\.lineNumber\)\?\.conflict/);
  assert.match(source, /idea-merge-code-token/);
  assert.match(stylesSource, /\.idea-merge-code-line\.conflict/);
  assert.match(stylesSource, /\.idea-merge-code-token\.keyword/);
  assert.match(stylesSource, /\.idea-merge-code-token\.string/);
});

test('GitConflictMergeDialog allows saving unfinished conflict drafts but blocks marking unresolved content', () => {
  const source = readFileSync(new URL('../components/git-conflict/GitConflictMergeDialog.tsx', import.meta.url), 'utf8');
  const saveResultBlock = source.match(/async function saveResult\(\)[\s\S]*?\n  \}/)?.[0] ?? '';
  const saveAndMarkResolvedBlock = source.match(/async function saveAndMarkResolved\(\)[\s\S]*?\n  \}/)?.[0] ?? '';

  assert.doesNotMatch(saveResultBlock, /conflictBlocks\.length > 0/);
  assert.match(saveAndMarkResolvedBlock, /conflictBlocks\.length > 0/);
  assert.match(saveAndMarkResolvedBlock, /请先解决所有冲突标记/);
  assert.match(saveAndMarkResolvedBlock, /showToast/);
  assert.match(saveAndMarkResolvedBlock, /return;/);
  assert.match(source, /disabled=\{Boolean\(workingAction\)\}/);
});

test('GitConflictMergeDialog keeps conflict detail loading stable across parent callback rerenders', () => {
  const source = readFileSync(new URL('../components/git-conflict/GitConflictMergeDialog.tsx', import.meta.url), 'utf8');

  assert.match(source, /onCloseRef/);
  assert.match(source, /showToastRef/);
  assert.doesNotMatch(source, /\}, \[filePath, onClose, open, projectId, showToast\]\)/);
  assert.match(source, /\}, \[filePath, open, projectId\]\)/);
});

test('RightWorkbench does not auto-open the conflict overview from passive conflict state refreshes', () => {
  const source = readFileSync(new URL('../components/RightWorkbench.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /conflictAutoOpenKeyRef/);
  assert.doesNotMatch(source, /conflictSignature/);
  assert.doesNotMatch(source, /conflictAutoOpenKeyRef\.current !== conflictSignature/);
  assert.doesNotMatch(source, /if \(gitOperationState\?\.hasConflicts\) \{\s*setConflictOverviewOpen\(true\);/);
  assert.match(source, /if \(nextState\?\.hasConflicts && nextState\.conflicts\.length > 0\) \{[\s\S]*?setConflictOverviewOpen\(true\);/);
});

test('RightWorkbench closes conflict dialogs when unresolved conflicts are cleared', () => {
  const source = readFileSync(new URL('../components/RightWorkbench.tsx', import.meta.url), 'utf8');

  assert.match(source, /const hasUnresolvedConflicts = Boolean\(/);
  assert.match(source, /gitOperationState\?\.hasConflicts &&[\s\S]*?gitOperationState\.conflicts\.length > 0/);
  assert.match(source, /if \(!hasUnresolvedConflicts\) \{[\s\S]*?setMergeDialogPath\(''\);[\s\S]*?setConflictOverviewOpen\(false\);/);
});

test('GitConflictStatusStrip only shows the solve action for real unresolved conflict files', () => {
  const source = readFileSync(new URL('../components/git-conflict/GitConflictStatusStrip.tsx', import.meta.url), 'utf8');

  assert.match(source, /const hasConflicts = operationState\.hasConflicts && operationState\.conflicts\.length > 0;/);
  assert.doesNotMatch(source, /const hasConflicts = operationState\.hasConflicts \|\| operationState\.status === 'conflicted';/);
  assert.doesNotMatch(source, /if \(operationState\.hasConflicts \|\| operationState\.status === 'conflicted'\)/);
});

test('GitConflictMergeDialog uses a real visible result editor instead of a transparent overlay textarea', () => {
  const source = readFileSync(new URL('../components/git-conflict/GitConflictMergeDialog.tsx', import.meta.url), 'utf8');
  const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(source, /idea-merge-result-editor/);
  assert.match(source, /idea-merge-result-gutter/);
  assert.match(source, /idea-merge-result-textarea/);
  assert.match(source, /gutterRef/);
  assert.match(source, /handleResultScroll/);
  assert.match(source, /onScroll=\{handleResultScroll\}/);
  assert.match(source, /结果可直接编辑/);
  assert.doesNotMatch(stylesSource, /\.idea-merge-result-shell textarea\s*\{[\s\S]*?color:\s*transparent/);
  assert.match(stylesSource, /\.idea-merge-result-textarea\s*\{[\s\S]*?color:\s*var\(--app-text/);
});

test('RightWorkbench keeps conflict confirmation strips in the fixed top conflict area', () => {
  const source = readFileSync(new URL('../components/RightWorkbench.tsx', import.meta.url), 'utf8');
  const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(source, /git-conflict-workbench-top/);
  assert.match(stylesSource, /\.git-conflict-workbench-top\s*\{/);
  assert.match(stylesSource, /\.workbench-files-panel\.with-conflict-center\s*\{[\s\S]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\);/);
});

test('RightWorkbench keeps conflicted files visible in review without making them committable', () => {
  const source = readFileSync(new URL('../components/RightWorkbench.tsx', import.meta.url), 'utf8');
  const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(source, /const committableChangedFiles = useMemo\(/);
  assert.match(source, /visibleChangedFiles\.filter\(\(file\) => !file\.conflicted\)/);
  assert.match(source, /splitWorkbenchChangedFiles\(visibleChangedFiles\)/);
  assert.match(source, /if \(file\.conflicted\) \{[\s\S]*?setMergeDialogPath\(file\.path\);[\s\S]*?return;/);
  assert.match(source, /const checkDisabled = Boolean\([^)]*conflicted/);
  assert.match(source, /aria-disabled=\{checkDisabled\}/);
  assert.match(source, /if \(checkDisabled\) \{\s*return;/);
  assert.match(source, /workbench-conflict-badge/);
  assert.match(source, /\{node\.gitFile\?\.conflicted \? <span className="workbench-conflict-badge">冲突<\/span> : null\}/);
  assert.match(source, /\{file\.conflicted \? <span className="workbench-conflict-badge">冲突<\/span> : null\}/);
  assert.doesNotMatch(stylesSource, /\.workbench-tree-row\s*>\s*span:last-of-type\s*\{/);
  assert.match(stylesSource, /\.workbench-tree-row\s*>\s*\.workbench-file-name\s*\{/);
  assert.match(stylesSource, /\.workbench-file-name\.status-conflicted\s*\{[^}]*color:\s*(?:#b45309|color-mix\()/);
  assert.doesNotMatch(stylesSource, /\.workbench-file-name\.status-conflicted\s*\{[^}]*color:\s*var\(--app-text,\s*#242424\)/);
  assert.match(stylesSource, /\.workbench-conflict-badge\s*\{[\s\S]*?flex:\s*0\s+0\s+auto;/);
  assert.match(stylesSource, /\.workbench-conflict-badge\s*\{[\s\S]*?width:\s*fit-content;/);
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
