import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const testDir = dirname(fileURLToPath(import.meta.url));
const componentSource = readFileSync(resolve(testDir, 'WorkspaceStatus.tsx'), 'utf8');
const stylesSource = readFileSync(resolve(testDir, '../styles.css'), 'utf8');

test('workspace session popover removes recent prompt and shows the full session id', () => {
  assert.doesNotMatch(componentSource, /<h4>最近请求<\/h4>/);
  assert.doesNotMatch(componentSource, /quoteCompactText/);
  assert.match(componentSource, /label="Session"[\s\S]*value=\{activeThread\.sessionId\}[\s\S]*title=\{activeThread\.sessionId\}/);
});

test('workspace session popover keeps normal content compact without its own vertical scroller', () => {
  assert.doesNotMatch(componentSource, /status-session-hero/);
  assert.match(componentSource, /className=\{`status-run-head is-\$\{sessionButtonState\.id\}`\}/);
  assert.match(stylesSource, /\.status-run-content\s*\{[^}]*overflow-y:\s*visible;/s);
});

test('workspace session idle state uses a connection icon instead of a hollow circle', () => {
  assert.match(componentSource, /Link2/);
  assert.doesNotMatch(componentSource, /return <Circle size=\{12\} \/>/);
});

test('workspace session running state uses an activity icon instead of a circle dot', () => {
  assert.match(componentSource, /Activity/);
  assert.doesNotMatch(componentSource, /CircleDot/);
});

test('workspace session status supports Grok, Codex, and OpenCode managed hot runtimes', () => {
  assert.match(componentSource, /OPENAI_CODEX_PROVIDER_ID/);
  assert.match(componentSource, /GROK_BUILD_PROVIDER_ID/);
  assert.match(componentSource, /OPENCODE_PROVIDER_ID/);
  assert.match(componentSource, /\/api\/agents\/runtime\/\$\{encodeURIComponent\(activeThread\.id\)\}/);
  assert.match(componentSource, /method: 'DELETE'/);
  assert.match(componentSource, /Codex app-server/);
  assert.match(componentSource, /OpenCode ACP/);
  assert.match(componentSource, /进程仍在后台保留，下次发送会直接复用/);
});
