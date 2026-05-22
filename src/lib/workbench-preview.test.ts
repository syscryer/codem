import assert from 'node:assert/strict';
import {
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
