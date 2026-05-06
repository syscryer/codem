import assert from 'node:assert/strict';
import {
  normalizeWorkbenchPreviewRequest,
  resolveWorkbenchPreviewFilePath,
} from './workbench-preview';
import type { WorkbenchPreviewRequest } from '../types';

const absoluteConversationRequest: WorkbenchPreviewRequest = {
  key: 'file:D:\\project\\codem\\server\\lib\\claude-service.ts',
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
assert.equal(normalized.key, 'file:server/lib/claude-service.ts');

assert.equal(
  resolveWorkbenchPreviewFilePath('D:\\project\\codem', 'server/lib/claude-service.ts'),
  'D:\\project\\codem\\server\\lib\\claude-service.ts',
);

assert.equal(
  resolveWorkbenchPreviewFilePath('D:\\project\\codem', 'D:\\project\\codem\\server\\lib\\claude-service.ts'),
  'D:\\project\\codem\\server\\lib\\claude-service.ts',
);
