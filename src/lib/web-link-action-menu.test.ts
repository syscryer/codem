import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const componentUrl = new URL('../components/WebLinkActionMenu.tsx', import.meta.url);
const source = existsSync(componentUrl) ? readFileSync(componentUrl, 'utf8') : '';

test('网页链接菜单提供三项固定动作并复用统一弹层行为', () => {
  assert.ok(source, 'WebLinkActionMenu.tsx should exist');
  assert.match(source, /在右侧浏览器打开/);
  assert.match(source, /在外部浏览器打开/);
  assert.match(source, /复制链接/);
  assert.match(source, /PopoverPortal/);
  assert.match(source, /useOutsideDismiss/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /onClose\(\)/);
});

test('会话 Markdown 把默认打开和右键菜单交给共享网页动作', () => {
  const turnSource = readFileSync(new URL('../components/ConversationTurn.tsx', import.meta.url), 'utf8');
  const paneSource = readFileSync(new URL('../components/ConversationPane.tsx', import.meta.url), 'utf8');
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

  assert.match(turnSource, /onOpenWebLink/);
  assert.match(turnSource, /onCopyWebLink/);
  assert.match(turnSource, /WebLinkActionMenu/);
  assert.match(paneSource, /stableOpenWebLink/);
  assert.match(appSource, /openWith\.webLinkOpenTarget/);
  assert.match(appSource, /target === 'workbench' && isTauriRuntime\(\)/);
  assert.match(appSource, /if \(!await openExternalUrl\(url\)\)/);
});
