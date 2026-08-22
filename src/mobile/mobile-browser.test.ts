import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { isBrowsableHttpUrl, normalizeBrowserAddressInput, pushBrowserHistoryEntry, resolveMobileBrowsableUrl } from './lib/mobile-browser';

const browserPageSource = readFileSync(new URL('./pages/BrowserPage.tsx', import.meta.url), 'utf8');
const mobileCssSource = readFileSync(new URL('./mobile.css', import.meta.url), 'utf8');

test('resolveMobileBrowsableUrl rewrites loopback hosts to the current mobile host', () => {
  assert.equal(resolveMobileBrowsableUrl('http://localhost:3000/preview?a=1', '192.168.1.5'), 'http://192.168.1.5:3000/preview?a=1');
  assert.equal(resolveMobileBrowsableUrl('http://127.0.0.1:8080/', '100.64.2.9'), 'http://100.64.2.9:8080/');
  assert.equal(resolveMobileBrowsableUrl('http://[::1]:5173/index.html', 'tailscale-host'), 'http://tailscale-host:5173/index.html');
});

test('resolveMobileBrowsableUrl keeps remote and same-host urls unchanged', () => {
  assert.equal(resolveMobileBrowsableUrl('https://example.com/docs', '192.168.1.5'), 'https://example.com/docs');
  assert.equal(resolveMobileBrowsableUrl('http://192.168.1.5:3000/', '192.168.1.5'), 'http://192.168.1.5:3000/');
  assert.equal(resolveMobileBrowsableUrl('http://localhost:3000/', ''), 'http://localhost:3000/');
});

test('resolveMobileBrowsableUrl rejects non-http inputs', () => {
  assert.equal(resolveMobileBrowsableUrl('file:///C:/secret.txt', '192.168.1.5'), null);
  assert.equal(resolveMobileBrowsableUrl('javascript:alert(1)', '192.168.1.5'), null);
  assert.equal(resolveMobileBrowsableUrl('not a url', '192.168.1.5'), null);
});

test('isBrowsableHttpUrl only accepts absolute http(s) urls with a hostname', () => {
  assert.equal(isBrowsableHttpUrl('http://example.com'), true);
  assert.equal(isBrowsableHttpUrl('https://example.com/a'), true);
  assert.equal(isBrowsableHttpUrl('ftp://example.com'), false);
  assert.equal(isBrowsableHttpUrl('/relative/path'), false);
});

test('normalizeBrowserAddressInput adds https scheme for bare hosts', () => {
  assert.equal(normalizeBrowserAddressInput('example.com'), 'https://example.com/');
  assert.equal(normalizeBrowserAddressInput('  example.com/docs  '), 'https://example.com/docs');
  assert.equal(normalizeBrowserAddressInput('http://localhost:3000'), 'http://localhost:3000/');
  assert.equal(normalizeBrowserAddressInput('localhost:3000'), 'http://localhost:3000/');
  assert.equal(normalizeBrowserAddressInput('example.com:8080/x'), 'https://example.com:8080/x');
});

test('normalizeBrowserAddressInput rejects empty or non-http schemes', () => {
  assert.equal(normalizeBrowserAddressInput('   '), null);
  assert.equal(normalizeBrowserAddressInput('ftp://example.com'), null);
  assert.equal(normalizeBrowserAddressInput('mailto:a@b.com'), null);
});

test('pushBrowserHistoryEntry appends from empty state without skipping index', () => {
  const result = pushBrowserHistoryEntry([], 0, 'http://127.0.0.1:5173/mobile');
  assert.deepEqual(result, { entries: ['http://127.0.0.1:5173/mobile'], activeIndex: 0 });
});

test('pushBrowserHistoryEntry appends after active entry and truncates forward ones', () => {
  const first = pushBrowserHistoryEntry([], 0, 'http://a.example/');
  const second = pushBrowserHistoryEntry(first.entries, first.activeIndex, 'http://b.example/');
  assert.deepEqual(second, { entries: ['http://a.example/', 'http://b.example/'], activeIndex: 1 });
  const jumpedBack = { entries: second.entries, activeIndex: 0 };
  const third = pushBrowserHistoryEntry(jumpedBack.entries, jumpedBack.activeIndex, 'http://c.example/');
  assert.deepEqual(third, { entries: ['http://a.example/', 'http://c.example/'], activeIndex: 1 });
});

test('embedded browser page does not apply the desktop material overlay over iframe content', () => {
  assert.match(browserPageSource, /className="mobile-browser-page"/);
  assert.doesNotMatch(browserPageSource, /mobile-browser-page codex-desktop/);
});

test('embedded browser controls share one compact header row', () => {
  assert.doesNotMatch(browserPageSource, /mobile-browser-toolbar/);
  assert.match(browserPageSource, /aria-label="后退"/);
  assert.match(browserPageSource, /aria-label="前进"/);
  assert.match(browserPageSource, /aria-label="刷新"/);
  assert.match(browserPageSource, /aria-label="系统浏览器"/);
  assert.match(browserPageSource, /scrolling="yes"/);
  assert.match(mobileCssSource, /\.mobile-browser-frame\s*\{[\s\S]*overflow: auto;/);
  assert.match(mobileCssSource, /\.mobile-browser-frame iframe\s*\{[\s\S]*touch-action: pan-x pan-y;/);
});
