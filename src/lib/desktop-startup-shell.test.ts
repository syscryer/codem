import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const indexSource = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');

test('desktop startup renders a themed shell before React replaces the root', () => {
  assert.match(indexSource, /id="root">\s*<div class="codem-startup-shell" data-codem-startup/);
  assert.match(indexSource, /class="codem-startup-icon" src="\/icon\.png"/);
  assert.match(indexSource, /@media \(prefers-color-scheme: dark\)/);
  assert.match(indexSource, /@media \(prefers-reduced-motion: reduce\)/);
});

test('API bridge initialization still completes before the application mounts', () => {
  const initializeIndex = mainSource.indexOf('await initializeApiFetchBridge()');
  const installIndex = mainSource.indexOf('installApiFetchBridge()');
  const renderIndex = mainSource.indexOf('ReactDOM.createRoot');

  assert.ok(initializeIndex >= 0);
  assert.ok(installIndex > initializeIndex);
  assert.ok(renderIndex > installIndex);
});
