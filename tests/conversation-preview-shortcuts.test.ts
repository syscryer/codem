import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildConversationPreviewRequest,
  collectConversationChangedFiles,
} from '../src/lib/conversation-preview-shortcuts';
import type { ToolStep } from '../src/types';

test('buildConversationPreviewRequest turns a write preview into a conversation preview request', () => {
  const preview = {
    kind: 'write',
    filePath: 'docs/notes.md',
    fileName: 'notes.md',
    beforeText: '',
    afterText: '# Notes',
    additions: 1,
    deletions: 0,
    rows: [],
  };

  const request = buildConversationPreviewRequest(preview);

  assert.equal(request?.key, 'conversation:docs/notes.md');
  assert.equal(request?.kind, 'markdown');
  assert.equal(request?.name, 'notes.md');
  assert.equal(request?.source, 'conversation-card');
});

test('buildConversationPreviewRequest returns null for previews without a file path', () => {
  assert.equal(buildConversationPreviewRequest(null), null);
});

test('collectConversationChangedFiles keeps one row per changed file in tool order', () => {
  const tools: ToolStep[] = [
    {
      id: 'tool-1',
      name: 'Write',
      title: 'Write',
      status: 'done',
      inputText: JSON.stringify({
        file_path: 'docs/notes.md',
        content: '# Notes',
      }),
    },
    {
      id: 'tool-2',
      name: 'Edit',
      title: 'Edit',
      status: 'done',
      inputText: JSON.stringify({
        file_path: 'src/App.tsx',
        old_string: 'old',
        new_string: 'new',
      }),
    },
  ];

  assert.deepEqual(
    collectConversationChangedFiles(tools).map((file) => file.path),
    ['docs/notes.md', 'src/App.tsx'],
  );
});
