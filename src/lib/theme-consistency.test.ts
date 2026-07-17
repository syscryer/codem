import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('聊天 Markdown 的引用、行内代码和表格使用主题变量', () => {
  assert.match(
    stylesSource,
    /\.codex-desktop \.markdown-body blockquote\s*\{[^}]*border-left-color:\s*var\(--app-border-strong\);[^}]*background:\s*var\(--app-surface-subtle\);[^}]*color:\s*var\(--app-muted\);/s,
  );
  assert.match(
    stylesSource,
    /\.codex-desktop \.markdown-body code\s*\{[^}]*background:\s*var\(--app-surface-muted\);[^}]*color:\s*var\(--app-text\);/s,
  );
  assert.match(
    stylesSource,
    /\.codex-desktop \.markdown-body th\s*\{[^}]*background:\s*var\(--app-surface-muted\);[^}]*color:\s*var\(--app-text-strong\);/s,
  );
});

test('聊天文件卡片和展开 diff 使用主题表面与语义色', () => {
  assert.match(
    stylesSource,
    /\.codex-desktop :is\(\s*\.conversation-output-files-card,\s*\.changed-files-summary-card,\s*\.changed-file-diff-body\s*\)\s*\{[^}]*border-color:\s*var\(--app-border\);[^}]*background:\s*var\(--app-surface-subtle\);[^}]*color:\s*var\(--app-text\);/s,
  );
  assert.match(
    stylesSource,
    /\.codex-desktop \.changed-file-diff-line\.add\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--success\) 12%, var\(--app-surface-subtle\)\);/s,
  );
  assert.match(
    stylesSource,
    /\.codex-desktop \.changed-file-diff-line\.remove\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--danger\) 12%, var\(--app-surface-subtle\)\);/s,
  );
});

test('会话管理及后续设置页的主要表面统一使用主题变量', () => {
  assert.match(
    stylesSource,
    /\.codex-desktop :is\(\s*\.settings-open-target-row,\s*\.settings-list-row,\s*\.worktree-current-root,\s*\.session-project-list,\s*\.plugins-primary-tabs,\s*\.plugins-help-panel\s*\)\s*\{[^}]*border-color:\s*var\(--app-border\);[^}]*background:\s*var\(--app-surface-subtle\);[^}]*color:\s*var\(--app-text\);/s,
  );
  assert.match(
    stylesSource,
    /\.codex-desktop \.settings-search\s*\{[^}]*border-color:\s*var\(--app-border\);[^}]*background:\s*var\(--app-surface-muted\);[^}]*color:\s*var\(--app-muted\);/s,
  );
  assert.match(
    stylesSource,
    /\.codex-desktop \.session-project-item\.active\s*\{[^}]*background:\s*var\(--app-surface\);[^}]*box-shadow:\s*0 0 0 1px var\(--app-border\);/s,
  );
});

test('设置页成功、错误和插件标签状态保留主题化语义反馈', () => {
  assert.match(
    stylesSource,
    /\.codex-desktop \.plugins-error-panel\s*\{[^}]*border-color:\s*color-mix\(in srgb, var\(--danger\) 34%, var\(--app-border\)\);[^}]*background:\s*color-mix\(in srgb, var\(--danger\) 10%, var\(--app-surface\)\);/s,
  );
  assert.match(
    stylesSource,
    /\.codex-desktop \.plugins-primary-tabs button\.active\s*\{[^}]*background:\s*var\(--app-surface\);[^}]*color:\s*var\(--app-text-strong\);/s,
  );
  assert.match(
    stylesSource,
    /\.codex-desktop \.settings-badge\.available,[\s\S]*?background:\s*color-mix\(in srgb, var\(--success\) 14%, var\(--app-surface\)\);/s,
  );
});
