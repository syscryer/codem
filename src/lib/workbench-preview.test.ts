import assert from 'node:assert/strict';
import {
  buildChangedFilePreviewRequest,
  buildProjectFilePreviewRequest,
  isWorkbenchDiffPreviewRequest,
  isWorkbenchDiffPreviewSource,
  openWorkbenchPreviewTab,
  normalizeWorkbenchPreviewRequest,
  resolveWorkbenchPreviewFilePath,
} from './workbench-preview';
import type { WorkbenchPreviewRequest } from '../types';

const absoluteConversationRequest: WorkbenchPreviewRequest = {
  key: 'conversation:D:\\project\\codem\\server\\lib\\claude-service.ts',
  path: 'D:\\project\\codem\\server\\lib\\claude-service.ts',
  name: 'claude-service.ts',
  kind: 'code',
  source: 'conversation-card',
};

const normalized = normalizeWorkbenchPreviewRequest(
  absoluteConversationRequest,
  'D:\\project\\codem',
);

assert.equal(normalized.path, 'server/lib/claude-service.ts');
assert.equal(normalized.key, 'conversation:server/lib/claude-service.ts');

assert.equal(
  resolveWorkbenchPreviewFilePath('D:\\project\\codem', 'server/lib/claude-service.ts'),
  'D:\\project\\codem\\server\\lib\\claude-service.ts',
);

assert.equal(
  resolveWorkbenchPreviewFilePath('D:\\project\\codem', 'D:\\project\\codem\\server\\lib\\claude-service.ts'),
  'D:\\project\\codem\\server\\lib\\claude-service.ts',
);

const opened = openWorkbenchPreviewTab(
  [
    {
      key: 'file:server/lib/claude-service.ts',
      path: 'server/lib/claude-service.ts',
      name: 'claude-service.ts',
      kind: 'code',
      source: 'project-file',
    },
  ],
  {
    key: 'conversation:server/lib/claude-service.ts',
    path: 'server/lib/claude-service.ts',
    name: 'claude-service.ts',
    kind: 'code',
    source: 'conversation-card',
  },
);

assert.equal(opened.tabs.length, 2);
assert.equal(opened.activeKey, 'conversation:server/lib/claude-service.ts');

const projectPreview = buildProjectFilePreviewRequest({
  path: 'src/App.tsx',
  name: 'App.tsx',
  type: 'file',
});
const changedPreview = buildChangedFilePreviewRequest({
  path: 'src/App.tsx',
  status: 'M',
  untracked: false,
});
const untrackedPreview = buildChangedFilePreviewRequest({
  path: 'drafts/new-file.ts',
  status: '??',
  untracked: true,
});

assert.notEqual(
  projectPreview.key,
  changedPreview.key,
  '文件浏览和审查预览必须使用不同 key，避免内容状态串用',
);

assert.equal(changedPreview.previewMode, 'git-diff');
assert.equal(untrackedPreview.previewMode, 'file');
assert.equal(isWorkbenchDiffPreviewRequest(changedPreview), true);
assert.equal(isWorkbenchDiffPreviewRequest(untrackedPreview), false);

assert.equal(isWorkbenchDiffPreviewSource('conversation-card'), true);
assert.equal(isWorkbenchDiffPreviewSource('changed-file'), true);
assert.equal(isWorkbenchDiffPreviewSource('project-file'), false);
