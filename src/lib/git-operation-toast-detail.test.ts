import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildGitOperationToastDetail, normalizeGitOperationToastMessage } from './git-operation-toast-detail.js';

test('buildGitOperationToastDetail keeps operation metadata and diagnostic sections', () => {
  const detail = buildGitOperationToastDetail({
    operation: 'Cherry-pick',
    target: 'abc1234 add menu',
    branch: 'main',
    result: '失败',
    command: 'git cherry-pick abc1234',
    errorText: '当前存在冲突，需要先解决冲突后再继续 Git 操作。\n\nCONFLICT (content): file.ts',
    outputText: 'Auto-merging file.ts',
    occurredAt: new Date(2026, 4, 29, 8, 30, 0),
  });

  assert.equal(detail.title, 'Git 操作详情');
  assert.deepEqual(
    detail.rows.map((row) => [row.label, row.value]),
    [
      ['操作', 'Cherry-pick'],
      ['目标', 'abc1234 add menu'],
      ['分支', 'main'],
      ['结果', '失败'],
      ['时间', '2026-05-29 08:30:00'],
    ],
  );
  assert.equal(detail.sections[0]?.label, 'stderr');
  assert.equal(detail.sections[0]?.defaultOpen, true);
  assert.equal(detail.sections[1]?.label, 'stdout');
  assert.equal(detail.sections[2]?.label, '命令');
});

test('normalizeGitOperationToastMessage returns a short first diagnostic line', () => {
  assert.equal(
    normalizeGitOperationToastMessage('当前存在冲突，需要先解决冲突后再继续 Git 操作。\n\nCONFLICT (content): file.ts', '操作失败'),
    '当前存在冲突，需要先解决冲突后再继续 Git 操作。',
  );
  assert.equal(normalizeGitOperationToastMessage('', '操作失败'), '操作失败');
});

test('App toolbar Git sync failures expose diagnostic toast details', () => {
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

  assert.match(appSource, /buildGitOperationToastDetail/);
  assert.match(appSource, /const fetchToastContext: GitOperationToastContext = \{/);
  assert.match(appSource, /const pullToastContext: GitOperationToastContext = \{/);
  assert.match(appSource, /showGitOperationErrorToast\(fetchToastContext, error, '获取远端失败'\)/);
  assert.match(appSource, /showGitOperationErrorToast\(pullToastContext, error, '拉取失败'\)/);
  assert.doesNotMatch(appSource, /showToast\(error instanceof Error \? error\.message : '拉取失败', 'error'\)/);
});

test('Git operation success toasts stay concise while failures keep diagnostics', () => {
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const historyPanelSource = readFileSync(new URL('../components/GitHistoryPanel.tsx', import.meta.url), 'utf8');

  for (const source of [appSource, historyPanelSource]) {
    const successToastSource = extractFunctionSource(source, 'showGitOperationSuccessToast');
    const errorToastSource = extractFunctionSource(source, 'showGitOperationErrorToast');

    assert.match(successToastSource, /showToast\(fallbackMessage, 'success', \{/);
    assert.match(successToastSource, /title: formatGitOperationToastTitle\(context\.operation, '完成'\)/);
    assert.doesNotMatch(successToastSource, /detail: buildGitOperationToastDetail/);
    assert.doesNotMatch(successToastSource, /durationMs: 6500/);
    assert.match(errorToastSource, /detail: buildGitOperationToastDetail/);
  }
});

test('external open actions only toast on failure', () => {
  const workspaceStateSource = readFileSync(new URL('../hooks/useWorkspaceState.ts', import.meta.url), 'utf8');
  const historyPanelSource = readFileSync(new URL('../components/GitHistoryPanel.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(workspaceStateSource, /showToast\('已在资源管理器中打开项目'\)/);
  assert.doesNotMatch(workspaceStateSource, /showToast\('已请求编辑器打开项目'\)/);
  assert.doesNotMatch(historyPanelSource, /showToast\(mode === 'reveal' \? '已在资源管理器中显示' : '已打开文件'\)/);
  assert.match(workspaceStateSource, /showToast\(await response\.text\(\), 'error'\)/);
  assert.match(historyPanelSource, /showToast\(error instanceof Error \? error\.message : '打开路径失败', 'error'\)/);
});

test('expanded toast details pause automatic dismissal until collapsed or closed manually', () => {
  const workspaceStateSource = readFileSync(new URL('../hooks/useWorkspaceState.ts', import.meta.url), 'utf8');
  const dialogsSource = readFileSync(new URL('../components/Dialogs.tsx', import.meta.url), 'utf8');
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

  assert.match(workspaceStateSource, /if \(!toast \|\| toast\.detailOpen\) \{/);
  assert.match(workspaceStateSource, /const setToastDetailOpen = useCallback\(\(toastId: string, detailOpen: boolean\) => \{/);
  assert.match(dialogsSource, /onToastDetailOpenChange\(toast\.id, nextExpandedToastId === toast\.id\)/);
  assert.match(appSource, /onToastDetailOpenChange=\{setToastDetailOpen\}/);
});

function extractFunctionSource(source: string, functionName: string) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `${functionName} not found`);

  const bodyStart = source.indexOf('{', start);
  assert.notEqual(bodyStart, -1, `${functionName} body not found`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`${functionName} body is not closed`);
}
