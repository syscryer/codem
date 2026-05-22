import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyWorkbenchNavigatorWidthOverride,
  buildWorkbenchFilesLayoutColumns,
  clampWorkbenchSplitPaneWidthPercent,
  clearWorkbenchNavigatorWidthOverride,
  clampWorkbenchNavigatorWidth,
  MAX_WORKBENCH_NAVIGATOR_WIDTH,
  MIN_WORKBENCH_NAVIGATOR_WIDTH,
  WORKBENCH_LAYOUT_COLUMNS_OVERRIDE_CSS_VAR,
  WORKBENCH_NAVIGATOR_WIDTH_OVERRIDE_CSS_VAR,
} from './workbench-layout';

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
