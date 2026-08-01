import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const componentUrl = new URL('../components/ConversationWebPreviewCard.tsx', import.meta.url);
const componentSource = existsSync(componentUrl) ? readFileSync(componentUrl, 'utf8') : '';
const turnSource = readFileSync(new URL('../components/ConversationTurn.tsx', import.meta.url), 'utf8');

test('本地网页预览卡片复用统一链接动作且不主动抓取网页资源', () => {
  assert.ok(componentSource, 'ConversationWebPreviewCard.tsx should exist');
  assert.match(componentSource, /Globe2/);
  assert.match(componentSource, /MoreHorizontal/);
  assert.match(componentSource, /WebLinkActionMenu/);
  assert.match(componentSource, /onOpen\(url\)/);
  assert.doesNotMatch(componentSource, /fetch\s*\(/);
  assert.doesNotMatch(componentSource, /favicon|screenshot|截图/i);
});

test('会话只从 text item 派生本地网页预览并放在文件产物之前', () => {
  assert.match(turnSource, /extractLocalWebPreviewUrls/);
  assert.match(turnSource, /turn\.items\.filter\(\(item\) => item\.type === 'text'\)/);
  assert.match(turnSource, /<ConversationWebPreviewCard/);
  assert.doesNotMatch(turnSource, /thinking[^\n]*extractLocalWebPreviewUrls/);
});
