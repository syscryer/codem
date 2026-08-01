import assert from 'node:assert/strict';
import test from 'node:test';
import {
  browserTitleFromUrl,
  MAX_WORKBENCH_BROWSER_TABS,
  normalizeWorkbenchBrowserInput,
  normalizeWorkbenchBrowserState,
  openWorkbenchBrowserUrl,
} from './workbench-browser.js';

test('browser input accepts explicit web urls and common host names', () => {
  assert.equal(normalizeWorkbenchBrowserInput('https://example.com/docs'), 'https://example.com/docs');
  assert.equal(normalizeWorkbenchBrowserInput('example.com'), 'https://example.com/');
  assert.equal(normalizeWorkbenchBrowserInput('localhost:5173'), 'http://localhost:5173/');
});

test('browser input turns plain text into a web search', () => {
  assert.equal(
    normalizeWorkbenchBrowserInput('Tauri child webview'),
    'https://www.google.com/search?q=Tauri%20child%20webview',
  );
});

test('browser input rejects unsafe schemes and embedded credentials', () => {
  assert.throws(() => normalizeWorkbenchBrowserInput('javascript:alert(1)'), /HTTP/);
  assert.throws(() => normalizeWorkbenchBrowserInput('file:///C:/secret.txt'), /HTTP/);
  assert.throws(() => normalizeWorkbenchBrowserInput('https://user:pass@example.com'), /账号或密码/);
});

test('stored browser state removes invalid tabs and enforces the tab limit', () => {
  const tabs = Array.from({ length: MAX_WORKBENCH_BROWSER_TABS + 3 }, (_, index) => ({
    id: `browser-tab-${index}`,
    title: `Tab ${index}`,
    url: `https://example.com/${index}`,
  }));
  const state = normalizeWorkbenchBrowserState({ tabs, activeTabId: tabs.at(-1)?.id });
  assert.equal(state.tabs.length, MAX_WORKBENCH_BROWSER_TABS);
  assert.equal(state.activeTabId, state.tabs[0].id);
});

test('browser title uses the hostname without the www prefix', () => {
  assert.equal(browserTitleFromUrl('https://www.github.com/openai'), 'github.com');
});

test('external requests reuse matching or empty browser tabs before creating a tab', () => {
  const empty = {
    tabs: [{ id: 'browser-tab-empty', title: '新标签页', url: '' }],
    activeTabId: 'browser-tab-empty',
  };
  const opened = openWorkbenchBrowserUrl(empty, 'http://localhost:5173');
  assert.equal(opened.outcome, 'opened');
  assert.equal(opened.state.tabs.length, 1);
  assert.equal(opened.state.tabs[0].url, 'http://localhost:5173/');

  const reused = openWorkbenchBrowserUrl(opened.state, 'http://localhost:5173/');
  assert.equal(reused.outcome, 'reused');
  assert.equal(reused.state.tabs.length, 1);
  assert.equal(reused.state.activeTabId, opened.state.tabs[0].id);
});

test('external requests preserve state when the browser tab limit is reached', () => {
  const tabs = Array.from({ length: MAX_WORKBENCH_BROWSER_TABS }, (_, index) => ({
    id: `browser-tab-${index}`,
    title: `Tab ${index}`,
    url: `https://example.com/${index}`,
  }));
  const current = { tabs, activeTabId: tabs[0].id };
  const result = openWorkbenchBrowserUrl(current, 'http://127.0.0.1:3000');
  assert.equal(result.outcome, 'limit-reached');
  assert.deepEqual(result.state, current);
});
