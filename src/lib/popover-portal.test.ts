import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const portalSource = readFileSync(new URL('../components/PopoverPortal.tsx', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('PopoverPortal 使用 body 级独立宿主，避免嵌套根窗口 backdrop-filter', () => {
  assert.match(portalSource, /className="popover-portal-host"/);
  assert.match(portalSource, /createPortal\([\s\S]*document\.body,\s*\);/);
  assert.doesNotMatch(portalSource, /const container = document\.querySelector\('\.codex-desktop'\)/);
});

test('独立宿主同步主题数据属性和计算后的 CSS 自定义变量', () => {
  for (const attribute of ['data-theme-mode', 'data-platform', 'data-window-material', 'data-density', 'data-sidebar-width']) {
    assert.match(portalSource, new RegExp(`'${attribute}'`));
  }
  assert.match(portalSource, /const rootStyle = getComputedStyle\(root\)/);
  assert.match(portalSource, /property\.startsWith\('--'\)/);
  assert.match(portalSource, /new MutationObserver\(syncThemeContext\)/);
  assert.match(portalSource, /matchMedia\('\(prefers-color-scheme: dark\)'\)/);
});

test('菜单材质作用域包含独立宿主且没有复用桌面根容器类', () => {
  assert.doesNotMatch(portalSource, /className="[^"]*codex-desktop[^"]*"/);
  assert.match(
    stylesSource,
    /:is\(\.codex-desktop,\s*\.popover-portal-host\)\s+:is\(\.workspace-menu,[^)]*\.desktop-menu-popover\)\s*\{[^}]*backdrop-filter:\s*blur\(24px\)/s,
  );
  assert.match(
    stylesSource,
    /:is\(\.codex-desktop,\s*\.popover-portal-host\)\s+:is\(\.project-menu-popover,\s*\.thread-menu-popover\)\s*\{[^}]*backdrop-filter:\s*blur\(34px\)/s,
  );
  assert.match(
    stylesSource,
    /:is\(\.codex-desktop,\s*\.popover-portal-host\)\s+:is\(\s*\.workspace-menu-item,[^)]*\.settings-select-menu-item\s*\)\s*\{[^}]*color:\s*var\(--app-text\);/s,
  );
  assert.doesNotMatch(stylesSource, /\.popover-portal-host::before\s*\{[^}]*backdrop-filter:/s);
});

test('独立宿主中的滚动容器继续使用全局滚动条 Token', () => {
  assert.match(
    stylesSource,
    /:is\(\.codex-desktop,\s*\.popover-portal-host\)\s+\*:hover\s*\{[^}]*scrollbar-color:\s*var\(--app-scrollbar-thumb-hover\)\s+transparent;/s,
  );
  assert.match(
    stylesSource,
    /:is\(\.codex-desktop,\s*\.popover-portal-host\)\s+\*::-(?:webkit|Webkit)-scrollbar-thumb\s*\{[^}]*background-color:\s*transparent;/s,
  );
  assert.match(
    stylesSource,
    /:is\(\.codex-desktop,\s*\.popover-portal-host\)\s+\*:hover::-(?:webkit|Webkit)-scrollbar-thumb\s*\{[^}]*background-color:\s*var\(--app-scrollbar-thumb-hover\);/s,
  );
});

test('对话框材质仍由原有样式独立控制', () => {
  assert.match(stylesSource, /\.dialog-backdrop\s*\{[^}]*backdrop-filter:\s*blur\(4px\);/s);
  assert.match(stylesSource, /\.dialog-card\s*\{[^}]*background:\s*#ffffff;/s);
  assert.match(stylesSource, /\.codex-desktop\s+\.dialog-card\s*\{[^}]*background:\s*var\(--app-surface\);/s);
  assert.doesNotMatch(stylesSource, /\.popover-portal-host[^,{]*\.dialog-(?:backdrop|card)/);
});
