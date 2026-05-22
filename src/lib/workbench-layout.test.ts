import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWorkbenchFilesLayoutColumns,
  clampWorkbenchNavigatorWidth,
  MAX_WORKBENCH_NAVIGATOR_WIDTH,
  MIN_WORKBENCH_NAVIGATOR_WIDTH,
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
