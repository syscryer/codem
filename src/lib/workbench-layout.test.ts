import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  applyWorkbenchNavigatorWidthOverride,
  buildWorkbenchFilesLayoutColumns,
  clampRightWorkbenchWidth,
  calculateRightWorkbenchResizeWidth,
  clampWorkbenchSplitPaneWidthPercent,
  clearWorkbenchNavigatorWidthOverride,
  clampWorkbenchNavigatorWidth,
  MIN_CHAT_SHELL_WIDTH_WITH_WORKBENCH,
  MIN_RIGHT_WORKBENCH_WIDTH,
  MAX_WORKBENCH_NAVIGATOR_WIDTH,
  MIN_WORKBENCH_NAVIGATOR_WIDTH,
  WORKBENCH_LAYOUT_COLUMNS_OVERRIDE_CSS_VAR,
  WORKBENCH_NAVIGATOR_WIDTH_OVERRIDE_CSS_VAR,
} from './workbench-layout';

const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('clampWorkbenchNavigatorWidth keeps width inside allowed range', () => {
  assert.equal(clampWorkbenchNavigatorWidth(MIN_WORKBENCH_NAVIGATOR_WIDTH - 40), MIN_WORKBENCH_NAVIGATOR_WIDTH);
  assert.equal(clampWorkbenchNavigatorWidth(361.8), 362);
  assert.equal(clampWorkbenchNavigatorWidth(MAX_WORKBENCH_NAVIGATOR_WIDTH + 80), MAX_WORKBENCH_NAVIGATOR_WIDTH);
});

test('buildWorkbenchFilesLayoutColumns reflects navigator visibility', () => {
  assert.equal(buildWorkbenchFilesLayoutColumns(false, 300), 'minmax(0, 1fr)');
  assert.equal(
    buildWorkbenchFilesLayoutColumns(true, 340),
    'minmax(0, 1fr) 340px',
  );
});

test('navigator width override writes and clears layout css variables', () => {
  const values = new Map<string, string>();
  const style = {
    setProperty(name: string, value: string) {
      values.set(name, value);
    },
    removeProperty(name: string) {
      const current = values.get(name) ?? '';
      values.delete(name);
      return current;
    },
  };

  applyWorkbenchNavigatorWidthOverride(style, 341.2);
  assert.equal(values.get(WORKBENCH_LAYOUT_COLUMNS_OVERRIDE_CSS_VAR), 'minmax(0, 1fr) 341px');
  assert.equal(values.get(WORKBENCH_NAVIGATOR_WIDTH_OVERRIDE_CSS_VAR), '341px');

  clearWorkbenchNavigatorWidthOverride(style);
  assert.equal(values.has(WORKBENCH_LAYOUT_COLUMNS_OVERRIDE_CSS_VAR), false);
  assert.equal(values.has(WORKBENCH_NAVIGATOR_WIDTH_OVERRIDE_CSS_VAR), false);
});

test('clampWorkbenchSplitPaneWidthPercent respects container width and pane minimums', () => {
  assert.equal(clampWorkbenchSplitPaneWidthPercent(10, 1000), 18);
  assert.equal(clampWorkbenchSplitPaneWidthPercent(50, 1000), 50);
  assert.equal(clampWorkbenchSplitPaneWidthPercent(90, 1000), 82);
  assert.equal(clampWorkbenchSplitPaneWidthPercent(50, 300), 50);
});

test('clampRightWorkbenchWidth keeps the close control inside narrow workspace layouts', () => {
  assert.equal(clampRightWorkbenchWidth(680, 1200), 680);
  assert.equal(clampRightWorkbenchWidth(680, 820), 460);
  assert.equal(clampRightWorkbenchWidth(680, 560), MIN_RIGHT_WORKBENCH_WIDTH);
  assert.equal(
    clampRightWorkbenchWidth(260, 900),
    MIN_RIGHT_WORKBENCH_WIDTH,
  );
  assert.equal(
    clampRightWorkbenchWidth(900, 1200),
    1200 - MIN_CHAT_SHELL_WIDTH_WITH_WORKBENCH,
  );
});

test('calculateRightWorkbenchResizeWidth uses the current pointer position and actual start width', () => {
  assert.equal(
    calculateRightWorkbenchResizeWidth({
      startWidth: 460,
      startX: 1000,
      currentX: 900,
      containerWidth: 820,
    }),
    460,
  );
  assert.equal(
    calculateRightWorkbenchResizeWidth({
      startWidth: 460,
      startX: 1000,
      currentX: 1100,
      containerWidth: 820,
    }),
    360,
  );
});

test('right workbench grid can shrink without clipping the close button', () => {
  assert.match(
    stylesSource,
    /\.chat-workspace\.workbench-open\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+var\(--right-workbench-width,\s*520px\);/,
  );
  assert.match(stylesSource, /\.right-workbench-close\s*\{[\s\S]*flex:\s*0\s+0\s+30px;/);
  assert.match(stylesSource, /\.right-workbench-tab\s*\{[\s\S]*min-width:\s*0;/);
});

test('review files panel only reserves a top row when the conflict center is visible', () => {
  const rightWorkbenchSource = readFileSync(new URL('../components/RightWorkbench.tsx', import.meta.url), 'utf8');

  assert.match(
    stylesSource,
    /\.workbench-files-panel\s*\{[\s\S]*grid-template-rows:\s*minmax\(0,\s*1fr\);/,
  );
  assert.match(
    stylesSource,
    /\.workbench-files-panel\.with-conflict-center\s*\{[\s\S]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\);/,
  );
  assert.match(
    rightWorkbenchSource,
    /showGitConflictCenter[\s\S]*gitOperationState\.hasConflicts[\s\S]*gitOperationState\.status === 'blocked_dirty'/,
  );
  assert.match(
    rightWorkbenchSource,
    /workbench-files-panel\$\{showGitConflictCenter \? ' with-conflict-center' : ''\}/,
  );
  assert.match(rightWorkbenchSource, /\{showGitConflictCenter \? \(\s*<GitConflictCenter/);
});
