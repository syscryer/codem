import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveConversationOutputFileActionPath,
  runConversationOutputFileMenuAction,
} from './conversation-output-file-interactions';

test('runConversationOutputFileMenuAction stops propagation before running menu action', () => {
  const calls: string[] = [];

  runConversationOutputFileMenuAction(
    {
      stopPropagation() {
        calls.push('stopPropagation');
      },
    },
    () => {
      calls.push('action');
    },
  );

  assert.deepEqual(calls, ['stopPropagation', 'action']);
});

test('resolveConversationOutputFileActionPath resolves relative output paths from the turn workspace', () => {
  assert.equal(
    resolveConversationOutputFileActionPath(
      'C:\\Users\\demo\\AppData\\Local\\Temp\\codem-smoke',
      'deliverable.md',
    ),
    'C:\\Users\\demo\\AppData\\Local\\Temp\\codem-smoke\\deliverable.md',
  );
  assert.equal(
    resolveConversationOutputFileActionPath(
      'C:\\Users\\demo\\AppData\\Local\\Temp\\codem-smoke',
      'D:\\exports\\deliverable.md',
    ),
    'D:\\exports\\deliverable.md',
  );
  assert.equal(resolveConversationOutputFileActionPath('', 'deliverable.md'), 'deliverable.md');
});

test('resolveConversationOutputFileActionPath preserves unicode spaces and absolute paths', () => {
  assert.equal(
    resolveConversationOutputFileActionPath('D:\\项目 工作区', 'docs\\验收 文档.md'),
    'D:\\项目 工作区\\docs\\验收 文档.md',
  );
  assert.equal(
    resolveConversationOutputFileActionPath('D:\\项目 工作区', 'C:\\导出\\验收 文档.md'),
    'C:\\导出\\验收 文档.md',
  );
});
