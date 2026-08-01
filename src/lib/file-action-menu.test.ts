import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const componentUrl = new URL('../components/FileActionMenu.tsx', import.meta.url);
const componentSource = existsSync(componentUrl) ? readFileSync(componentUrl, 'utf8') : '';
const turnSource = readFileSync(new URL('../components/ConversationTurn.tsx', import.meta.url), 'utf8');

test('文件动作菜单提供四项固定动作和统一关闭行为', () => {
  assert.ok(componentSource, 'FileActionMenu.tsx should exist');
  assert.equal((componentSource.match(/在右侧预览/g) ?? []).length, 1);
  assert.equal((componentSource.match(/用默认应用打开/g) ?? []).length, 1);
  assert.equal((componentSource.match(/在文件浏览器中显示/g) ?? []).length, 1);
  assert.equal((componentSource.match(/复制完整路径/g) ?? []).length, 1);
  assert.match(componentSource, /PopoverPortal/);
  assert.match(componentSource, /useOutsideDismiss/);
  assert.match(componentSource, /event\.key === 'Escape'/);
  assert.match(componentSource, /finally[\s\S]*onClose\(\)/);
});

test('正文文件链接和文件产物卡片共同使用 FileActionMenu', () => {
  assert.match(turnSource, /import \{ FileActionMenu/);
  assert.ok((turnSource.match(/<FileActionMenu/g) ?? []).length >= 2);
  assert.match(turnSource, /onOpenLocalFileContextMenu/);
  assert.doesNotMatch(turnSource, /<span>在文件浏览器打开<\/span>/);
});
