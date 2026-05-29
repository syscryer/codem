import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('Git branch menu adapts to viewport height and scrolls when there are many branches', () => {
  assert.match(
    stylesSource,
    /\.status-branch-menu\s*\{[\s\S]*max-height:\s*min\(520px,\s*calc\(100vh\s*-\s*96px\)\);/,
  );
  assert.match(stylesSource, /\.status-branch-menu\s*\{[\s\S]*overscroll-behavior:\s*contain;/);
  assert.match(
    stylesSource,
    /:is\([^)]*\.status-branch-menu[\s\S]*?\)\s*\{[\s\S]*overflow:\s*hidden;[\s\S]*?\}\s*\.status-branch-menu\s*\{[\s\S]*overflow-y:\s*auto;/,
  );
});
