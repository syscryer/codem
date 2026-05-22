import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getWorkbenchVisibleLineRange,
  shouldUseLargeFilePreview,
  WORKBENCH_LARGE_FILE_CHAR_THRESHOLD,
  WORKBENCH_LARGE_FILE_LINE_THRESHOLD,
} from './workbench-code-preview';

test('shouldUseLargeFilePreview flips on large line count or content size', () => {
  assert.equal(shouldUseLargeFilePreview('small', 12), false);
  assert.equal(
    shouldUseLargeFilePreview('small', WORKBENCH_LARGE_FILE_LINE_THRESHOLD + 1),
    true,
  );
  assert.equal(
    shouldUseLargeFilePreview('x'.repeat(WORKBENCH_LARGE_FILE_CHAR_THRESHOLD + 1), 10),
    true,
  );
});

test('getWorkbenchVisibleLineRange returns overscanned viewport range', () => {
  assert.deepEqual(getWorkbenchVisibleLineRange(0, 0, 300), { start: 0, end: 0 });

  const top = getWorkbenchVisibleLineRange(2000, 0, 210);
  assert.equal(top.start, 0);
  assert.ok(top.end > 10);

  const middle = getWorkbenchVisibleLineRange(2000, 2100, 210);
  assert.ok(middle.start > 0);
  assert.ok(middle.end > middle.start);
  assert.ok(middle.end <= 2000);
});
