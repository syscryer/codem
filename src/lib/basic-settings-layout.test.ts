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

test('基础设置页包含 Claude CLI 版本检查分组', () => {
  assert.match(source, /title="Claude CLI 版本"/);
  assert.match(source, /重新检查/);
  assert.match(source, /安装说明|查看安装文档|执行更新|一键安装|重新安装/);
});

test('应用更新与 Claude CLI 版本区域不再展示冗余辅助文案', () => {
  assert.doesNotMatch(source, /最低支持：/);
  assert.doesNotMatch(source, /更新命令：/);
});
