import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConversationOutputFileListState } from './conversation-output-file-list';
import type { ConversationOutputFile } from './conversation-output-files';

const files: ConversationOutputFile[] = [
  {
    path: 'docs/a.md',
    name: 'a.md',
    kindLabel: 'MD',
    openMode: 'preview',
    subtitle: '文档 · MD · 右侧预览',
  },
  {
    path: 'docs/b.md',
    name: 'b.md',
    kindLabel: 'MD',
    openMode: 'preview',
    subtitle: '文档 · MD · 右侧预览',
  },
  {
    path: 'docs/c.md',
    name: 'c.md',
    kindLabel: 'MD',
    openMode: 'preview',
    subtitle: '文档 · MD · 右侧预览',
  },
  {
    path: 'docs/d.md',
    name: 'd.md',
    kindLabel: 'MD',
    openMode: 'preview',
    subtitle: '文档 · MD · 右侧预览',
  },
  {
    path: 'docs/e.md',
    name: 'e.md',
    kindLabel: 'MD',
    openMode: 'preview',
    subtitle: '文档 · MD · 右侧预览',
  },
];

test('buildConversationOutputFileListState shows first three files and hidden count by default', () => {
  const state = buildConversationOutputFileListState(files, false);

  assert.equal(state.visibleFiles.length, 3);
  assert.deepEqual(state.visibleFiles.map((file) => file.name), ['a.md', 'b.md', 'c.md']);
  assert.equal(state.hiddenCount, 2);
  assert.equal(state.toggleLabel, '显示另外 2 个');
  assert.equal(state.showToggle, true);
});

test('buildConversationOutputFileListState shows all files and collapse label when expanded', () => {
  const state = buildConversationOutputFileListState(files, true);

  assert.equal(state.visibleFiles.length, 5);
  assert.equal(state.hiddenCount, 0);
  assert.equal(state.toggleLabel, '收起');
  assert.equal(state.showToggle, true);
});

test('buildConversationOutputFileListState hides toggle when file count does not exceed default limit', () => {
  const state = buildConversationOutputFileListState(files.slice(0, 3), false);

  assert.equal(state.visibleFiles.length, 3);
  assert.equal(state.hiddenCount, 0);
  assert.equal(state.toggleLabel, '');
  assert.equal(state.showToggle, false);
});
