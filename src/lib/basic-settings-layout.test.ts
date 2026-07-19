import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../components/settings/BasicSettings.tsx', import.meta.url), 'utf8');

test('基础设置页包含应用更新设置分组', () => {
  assert.match(source, /title="应用更新"/);
  assert.match(source, /自动检查更新/);
  assert.match(source, /当前版本/);
  assert.match(source, /立即检查/);
});

test('基础设置页不再重复展示 Claude CLI 管理分组', () => {
  assert.doesNotMatch(source, /title="Claude CLI 版本"/);
  assert.doesNotMatch(source, /readClaudeCliVersionInfo/);
});

test('应用更新与 Claude CLI 版本区域不再展示冗余辅助文案', () => {
  assert.doesNotMatch(source, /最低支持：/);
  assert.doesNotMatch(source, /更新命令：/);
});

test('应用更新安装中使用加载图标而不是旋转下载箭头', () => {
  assert.match(source, /LoaderCircle/);
  assert.match(source, /updateInstalling\s*\?\s*<LoaderCircle className="spin" size=\{14\} \/>/);
  assert.doesNotMatch(source, /<Download size=\{14\} className=\{updateInstalling \? 'spin' : ''\} \/>/);
});
