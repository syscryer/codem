import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { getPlatformWindowMaterials, getWindowMaterialLabel, normalizeWindowMaterial } from './window-material.js';
import { defaultAppearanceSettings } from './settings-api.js';

const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const settingsViewSource = readFileSync(new URL('../components/settings/SettingsView.tsx', import.meta.url), 'utf8');
const settingsSidebarSource = readFileSync(new URL('../components/settings/SettingsSidebar.tsx', import.meta.url), 'utf8');
const windowsVisibleWindowMaterials = ['auto', 'mica', 'acrylic', 'micaAlt'] as const;

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertMaterialVariables(selector: string) {
  const selectorPattern = escapeRegex(selector);

  assert.match(
    stylesSource,
    new RegExp(
      `${selectorPattern}[^{}]*\\{[^}]*--app-material-fill:\\s*[^;]+;[^}]*--app-material-line:\\s*[^;]+;[^}]*--app-material-glow:\\s*[^;]+;[^}]*--app-material-blur:\\s*[^;]+;`,
      's',
    ),
  );
}

test('Windows 保留默认和可选材质，但不再暴露无选项', () => {
  assert.deepEqual(getPlatformWindowMaterials('windows'), ['auto', 'mica', 'acrylic', 'micaAlt']);
});

test('macOS 只保留默认窗口材质', () => {
  assert.deepEqual(getPlatformWindowMaterials('macos'), ['auto']);
});

test('自动材质文案改为默认', () => {
  assert.equal(getWindowMaterialLabel('auto'), '默认');
});

test('旧的无材质配置会回落到默认', () => {
  assert.equal(normalizeWindowMaterial('none', ['auto', 'mica', 'acrylic', 'micaAlt']), 'auto');
});

test('开箱默认窗口材质仍然是 Mica', () => {
  assert.equal(defaultAppearanceSettings.windowMaterial, 'mica');
});

test('默认材质使用不透明灰底样式', () => {
  assert.match(
    stylesSource,
    /\.codex-desktop\[data-window-material="auto"]\s*,\s*\.codex-desktop\[data-window-material="none"]\s*\{[^}]*--app-material-fill:\s*rgba\(242,\s*244,\s*247,\s*1\);[^}]*--app-material-glow:\s*rgba\(255,\s*255,\s*255,\s*0\);[^}]*--app-material-blur:\s*0px;[^}]*\}/s,
  );
  assert.match(
    stylesSource,
    /\.codex-desktop\[data-theme-mode="dark"]\[data-window-material="auto"]\s*,\s*\.codex-desktop\[data-theme-mode="dark"]\[data-window-material="none"]\s*\{[^}]*--app-material-fill:\s*rgba\(32,\s*32,\s*34,\s*1\);[^}]*--app-material-glow:\s*rgba\(255,\s*255,\s*255,\s*0\);[^}]*--app-material-blur:\s*0px;[^}]*\}/s,
  );
  assert.match(
    stylesSource,
    /\.codex-desktop\[data-theme-mode="system"]\[data-window-material="auto"]\s*,\s*\.codex-desktop\[data-theme-mode="system"]\[data-window-material="none"]\s*\{[^}]*--app-material-fill:\s*rgba\(32,\s*32,\s*34,\s*1\);[^}]*--app-material-glow:\s*rgba\(255,\s*255,\s*255,\s*0\);[^}]*--app-material-blur:\s*0px;[^}]*\}/s,
  );
});

test('浅色基准色和 Mica 材质改为中性冷灰', () => {
  assert.match(stylesSource, /--app-chrome:\s*#eef2f6;/i);
  assert.match(stylesSource, /--sidebar-bg:\s*#f4f6f8;/i);
  assert.match(stylesSource, /--sidebar-active:\s*#e7ebf0;/i);
  assert.match(stylesSource, /--app-border:\s*#e2e8f0;/i);
  assert.match(stylesSource, /--app-border-strong:\s*#d6dee8;/i);
  assert.match(
    stylesSource,
    /\.codex-desktop\[data-window-material="mica"]\s*\{[^}]*--app-material-fill:\s*rgba\(236,\s*240,\s*246,\s*0\);[^}]*--app-material-line:\s*rgba\(86,\s*98,\s*118,\s*0\.1(?:0)?\);[^}]*--app-material-glow:\s*rgba\(255,\s*255,\s*255,\s*0\.12\);/s,
  );
});

test('桌面模式下聊天主面板恢复与基础主题一致的左上圆角', () => {
  assert.match(
    stylesSource,
    /\.codex-desktop\s+\.chat-shell\s*\{[^}]*position:\s*relative;[^}]*border-top-left-radius:\s*12px;[^}]*box-shadow:\s*none;[^}]*\}/s,
  );
  assert.doesNotMatch(stylesSource, /\.codex-desktop\[data-platform="windows"]\s+\.chat-shell::before/s);
});

test('桌面主工作区保持透明，不再使用角落补片', () => {
  assert.match(
    stylesSource,
    /\.codex-desktop\s+\.chat-workspace\s*\{[^}]*background:\s*transparent;[^}]*\}/s,
  );
  assert.doesNotMatch(stylesSource, /\.codex-desktop\s+\.chat-workspace::before/s);
});

test('桌面根容器使用统一材质底层贯通菜单栏和侧边栏', () => {
  assert.match(
    stylesSource,
    /\.codex-desktop::before\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*var\(--app-material-glow\),\s*transparent\s+58%\),\s*var\(--app-material-fill\);[^}]*backdrop-filter:\s*blur\(var\(--app-material-blur,\s*48px\)\)\s+saturate\(1\.35\);[^}]*\}/s,
  );
  assert.match(
    stylesSource,
    /\.codex-desktop\s+\.codex-shell\s*\{[^}]*background:\s*transparent;[^}]*\}/s,
  );
  assert.doesNotMatch(stylesSource, /\.codex-desktop\s+\.codex-shell::before/s);
  assert.doesNotMatch(stylesSource, /\.codex-desktop\[data-window-material="auto"]\s+\.app-sidebar/s);
  assert.doesNotMatch(stylesSource, /\.codex-desktop\[data-window-material="auto"]\s+\.desktop-menubar/s);
});

test('所有 Windows 可选材质都通过桌面根容器提供完整材质变量', () => {
  for (const material of windowsVisibleWindowMaterials) {
    assertMaterialVariables(`.codex-desktop[data-window-material="${material}"]`);
    assertMaterialVariables(`.codex-desktop[data-theme-mode="dark"][data-window-material="${material}"]`);
    assertMaterialVariables(`.codex-desktop[data-theme-mode="system"][data-window-material="${material}"]`);
  }
});

test('桌面菜单栏不再使用独立高光层分割侧边栏材质', () => {
  assert.match(
    stylesSource,
    /\.codex-desktop\s+\.desktop-menubar::after\s*\{[^}]*content:\s*none;[^}]*\}/s,
  );
});

test('Windows 侧边栏不再使用独立顶部高光分割菜单栏材质', () => {
  assert.match(
    stylesSource,
    /\.codex-desktop\[data-platform="windows"]\s+\.app-sidebar::before\s*\{[^}]*content:\s*none;[^}]*\}/s,
  );
});

test('设置页内容层位于根材质层之上并复用对话侧栏宽度', () => {
  assert.match(
    stylesSource,
    /\.codex-desktop\s+\.settings-view\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;[^}]*grid-template-columns:\s*var\(--sidebar-width,\s*300px\)\s+minmax\(0,\s*1fr\);[^}]*background:\s*transparent;[^}]*\}/s,
  );
});

test('设置页左侧面板复用对话左侧栏材质和交互色', () => {
  assert.match(
    stylesSource,
    /\.codex-desktop\s+\.settings-sidebar\s*\{[^}]*background:\s*transparent;[^}]*border-right-color:\s*var\(--sidebar-border-color\);[^}]*color:\s*var\(--app-text\);[^}]*box-shadow:\s*var\(--sidebar-glass-shadow\);[^}]*\}/s,
  );
  assert.match(
    stylesSource,
    /\.codex-desktop\s+\.settings-return:hover\s*,\s*\.codex-desktop\s+\.settings-nav-item:hover\s*\{[^}]*background:\s*var\(--sidebar-hover-surface\);[^}]*color:\s*var\(--app-text-strong\);[^}]*\}/s,
  );
  assert.match(
    stylesSource,
    /\.codex-desktop\s+\.settings-nav-item\.active\s*\{[^}]*background:\s*var\(--sidebar-active-surface\);[^}]*box-shadow:\s*none;[^}]*color:\s*var\(--app-text-strong\);[^}]*\}/s,
  );
  assert.doesNotMatch(stylesSource, /\.codex-desktop\s+\.settings-sidebar\s*\{[^}]*background:\s*var\(--settings-sidebar-bg\)/s);
});

test('设置页左侧面板复用对话左侧栏拖动宽度逻辑', () => {
  assert.match(
    appSource,
    /<SettingsView[\s\S]*onUpdateSidebarCustomWidth=\{\(width\)\s*=>\s*updateAppearance\(\{\s*sidebarCustomWidth:\s*width\s*\}\)\}/,
  );
  assert.match(
    settingsViewSource,
    /<SettingsSidebar[\s\S]*sidebarCustomWidth=\{appearance\.sidebarCustomWidth\}[\s\S]*onUpdateSidebarCustomWidth=\{onUpdateSidebarCustomWidth\}/,
  );
  assert.match(settingsSidebarSource, /className="settings-sidebar app-sidebar"/);
  assert.match(settingsSidebarSource, /className="app-sidebar-resizer"/);
  assert.match(settingsSidebarSource, /handleSidebarResizePointerDown/);
  assert.match(settingsSidebarSource, /handleSidebarResizeDoubleClick/);
});

test('设置页右侧内容恢复和聊天主面板一致的桌面圆角', () => {
  assert.match(
    stylesSource,
    /\.codex-desktop\s+\.settings-content\s*\{[^}]*position:\s*relative;[^}]*border-top-left-radius:\s*12px;[^}]*\}/s,
  );
});

test('侧栏拖动线默认隐藏，仅在交互时使用浅灰色', () => {
  assert.match(
    stylesSource,
    /\.app-sidebar-resizer::after\s*\{[^}]*background:\s*transparent;[^}]*\}/s,
  );
  assert.match(
    stylesSource,
    /\.app-sidebar-resizer:hover::after\s*,\s*\.app-sidebar-resizer:active::after\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--app-border,\s*#e2e8f0\)\s*88%,\s*transparent\);[^}]*\}/s,
  );
});
