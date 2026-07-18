import assert from 'node:assert/strict';
import test from 'node:test';
import {
  browserTitleFromUrl,
  MAX_WORKBENCH_BROWSER_TABS,
  normalizeWorkbenchBrowserInput,
  normalizeWorkbenchBrowserState,
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
