import assert from 'node:assert/strict';
import {
  buildConversationOutputFilePreviewRequest,
  buildChangedFilePreviewRequest,
  buildProjectFilePreviewRequest,
  isWorkbenchDiffPreviewRequest,
  isWorkbenchDiffPreviewSource,
  openWorkbenchPreviewTab,
  normalizeWorkbenchPreviewRequest,
  resolveWorkbenchPreviewContentOnOpen,
  resolveWorkbenchPreviewFilePath,
} from './workbench-preview';
import type { WorkbenchPreviewRequest } from '../types';

const absoluteConversationRequest: WorkbenchPreviewRequest = {
  key: 'conversation:D:\\project\\codem\\src\\lib\\workbench-preview.ts',
  path: 'D:\\project\\codem\\src\\lib\\workbench-preview.ts',
  name: 'workbench-preview.ts',
  kind: 'code',
  source: 'conversation-card',
};

const conversationReviewRequest: WorkbenchPreviewRequest = {
  key: 'conversation:src/App.tsx',
  path: 'src/App.tsx',
  name: 'App.tsx',
  kind: 'code',
  source: 'conversation-card',
  reviewDiff: ['--- a/src/App.tsx', '+++ b/src/App.tsx', '-old title', '+new title'],
};

const normalized = normalizeWorkbenchPreviewRequest(
  absoluteConversationRequest,
  'D:\\project\\codem',
);

assert.equal(normalized.path, 'src/lib/workbench-preview.ts');
assert.equal(normalized.key, 'conversation:src/lib/workbench-preview.ts');

assert.equal(
  resolveWorkbenchPreviewFilePath('D:\\project\\codem', 'src/lib/workbench-preview.ts'),
  'D:\\project\\codem\\src\\lib\\workbench-preview.ts',
);

assert.equal(
  resolveWorkbenchPreviewFilePath('D:\\project\\codem', 'D:\\project\\codem\\src\\lib\\workbench-preview.ts'),
  'D:\\project\\codem\\src\\lib\\workbench-preview.ts',
);

const opened = openWorkbenchPreviewTab(
  [
    {
      key: 'file:src/lib/workbench-preview.ts',
      path: 'src/lib/workbench-preview.ts',
      name: 'workbench-preview.ts',
      kind: 'code',
      source: 'project-file',
    },
  ],
  {
    key: 'conversation:src/lib/workbench-preview.ts',
    path: 'src/lib/workbench-preview.ts',
    name: 'workbench-preview.ts',
    kind: 'code',
    source: 'conversation-card',
  },
);

assert.equal(opened.tabs.length, 2);
assert.equal(opened.activeKey, 'conversation:src/lib/workbench-preview.ts');

const projectPreview = buildProjectFilePreviewRequest({
  path: 'src/App.tsx',
  name: 'App.tsx',
  type: 'file',
});
const conversationOutputPreview = buildConversationOutputFilePreviewRequest({
  path: 'docs/roadmap.md',
  name: 'roadmap.md',
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
assert.equal(conversationOutputPreview.key, 'file:docs/roadmap.md');
assert.equal(conversationOutputPreview.source, 'conversation-output-file');

assert.equal(changedPreview.previewMode, 'git-diff');
assert.equal(untrackedPreview.previewMode, 'file');
assert.equal(isWorkbenchDiffPreviewRequest(changedPreview), true);
assert.equal(isWorkbenchDiffPreviewRequest(untrackedPreview), false);
assert.equal(
  isWorkbenchDiffPreviewRequest(absoluteConversationRequest),
  false,
  '普通聊天打开文件不应误判为 diff 预览',
);
assert.equal(
  isWorkbenchDiffPreviewRequest(conversationReviewRequest),
  true,
  '带 reviewDiff 的聊天审查请求应进入 diff 预览',
);

assert.equal(isWorkbenchDiffPreviewSource('conversation-card'), true);
assert.equal(isWorkbenchDiffPreviewSource('changed-file'), true);
assert.equal(isWorkbenchDiffPreviewSource('project-file'), false);

const existingPreviewContent = resolveWorkbenchPreviewContentOnOpen(
  {
    'file:docs/roadmap.md': {
      loading: false,
      content: '# roadmap',
      mode: 'markdown',
    },
  },
  {
    key: 'file:docs/roadmap.md',
    path: 'docs/roadmap.md',
    name: 'roadmap.md',
    kind: 'markdown',
    source: 'project-file',
  },
);

assert.deepEqual(existingPreviewContent['file:docs/roadmap.md'], {
  loading: false,
  content: '# roadmap',
  mode: 'markdown',
});
