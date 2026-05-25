import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWorkbenchNavigatorVisibility } from './workbench-navigator-visibility';

test('resolveWorkbenchNavigatorVisibility hides navigator for conversation output previews by default', () => {
  assert.equal(resolveWorkbenchNavigatorVisibility(null, 'conversation-output-file'), false);
});

test('resolveWorkbenchNavigatorVisibility keeps default navigator visible for normal file previews', () => {
  assert.equal(resolveWorkbenchNavigatorVisibility(null, 'project-file'), true);
});

test('resolveWorkbenchNavigatorVisibility respects manual open preference over preview source', () => {
  assert.equal(resolveWorkbenchNavigatorVisibility(true, 'conversation-output-file'), true);
});

test('resolveWorkbenchNavigatorVisibility respects manual close preference over preview source', () => {
  assert.equal(resolveWorkbenchNavigatorVisibility(false, 'project-file'), false);
});
