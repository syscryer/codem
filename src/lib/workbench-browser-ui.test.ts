import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../components/RightWorkbench.tsx', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('browser workbench uses the native webview runtime instead of an iframe placeholder', () => {
  assert.match(source, /ensureWorkbenchBrowserWebview/);
  assert.match(source, /activeTab === 'browser'/);
  assert.match(source, /workbench-browser-address/);
  assert.match(source, /browserResizeGutter/);
  assert.doesNotMatch(source, /<iframe/i);
  assert.doesNotMatch(source, /placeholder="输入 URL" disabled/);
});

test('browser workbench exposes tab persistence and bounded tab creation', () => {
  assert.match(source, /WORKBENCH_BROWSER_STORAGE_KEY/);
  assert.match(source, /MAX_WORKBENCH_BROWSER_TABS/);
  assert.match(source, /新建标签页/);
  assert.match(source, /closeTab/);
});

test('browser address input keeps focus styling on the neutral outer capsule', () => {
  assert.match(
    stylesSource,
    /\.codex-desktop \.workbench-browser-address input:focus,[\s\S]*\.workbench-browser-address input:focus-visible\s*\{[\s\S]*border-color: transparent;[\s\S]*box-shadow: none;/,
  );
});
