import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTooltipAnchorX } from './TooltipLayer.js';

test('pointer tooltip anchors to the actual hover position on a wide target', () => {
  assert.equal(resolveTooltipAnchorX(400, 1200, 1080), 1080);
});

test('keyboard tooltip falls back to the target center', () => {
  assert.equal(resolveTooltipAnchorX(400, 1200), 800);
});

test('pointer tooltip anchor stays within the target bounds', () => {
  assert.equal(resolveTooltipAnchorX(400, 1200, 200), 400);
  assert.equal(resolveTooltipAnchorX(400, 1200, 1400), 1200);
});
