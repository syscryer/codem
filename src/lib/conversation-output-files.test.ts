import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectConversationOutputFiles,
  describeConversationOutputFile,
} from './conversation-output-files';
import type { ToolStep } from '../types';

test('collectConversationOutputFiles only keeps document-like outputs and deduplicates by path', () => {
  const tools: ToolStep[] = [
    {
      id: 'tool-1',
      name: 'Write',
      title: 'Write spec markdown',
      status: 'done',
      inputText: JSON.stringify({
        file_path: 'docs/spec.md',
        content: '# spec',
      }),
    },
    {
      id: 'tool-2',
      name: 'Edit',
      title: 'Edit report json',
      status: 'done',
      inputText: JSON.stringify({
        file_path: 'reports/summary.json',
        old_string: '{}',
        new_string: '{"ok":true}',
      }),
    },
    {
      id: 'tool-3',
      name: 'Write',
      title: 'Write word doc',
      status: 'done',
      inputText: JSON.stringify({
        file_path: 'deliverables/review.docx',
        content: 'binary-ref',
      }),
    },
    {
      id: 'tool-4',
      name: 'Edit',
      title: 'Edit code file should stay in review flow',
      status: 'done',
      inputText: JSON.stringify({
        file_path: 'src/App.tsx',
        old_string: 'old',
        new_string: 'new',
      }),
    },
    {
      id: 'tool-5',
      name: 'Write',
      title: 'Duplicate markdown path',
      status: 'done',
      inputText: JSON.stringify({
        file_path: 'docs/spec.md',
        content: '# updated spec',
      }),
    },
  ];

  assert.deepEqual(
    collectConversationOutputFiles(tools).map((file) => ({
      path: file.path,
      name: file.name,
      openMode: file.openMode,
      kindLabel: file.kindLabel,
    })),
    [
      {
        path: 'docs/spec.md',
        name: 'spec.md',
        openMode: 'preview',
        kindLabel: 'MD',
      },
      {
        path: 'reports/summary.json',
        name: 'summary.json',
        openMode: 'preview',
        kindLabel: 'JSON',
      },
      {
        path: 'deliverables/review.docx',
        name: 'review.docx',
        openMode: 'default-app',
        kindLabel: 'Word',
      },
    ],
  );
});

test('describeConversationOutputFile maps office and previewable extensions to stable labels', () => {
  assert.deepEqual(describeConversationOutputFile('notes/todo.txt'), {
    kindLabel: 'TXT',
    openMode: 'preview',
    subtitle: '文档 · TXT · 右侧预览',
  });

  assert.deepEqual(describeConversationOutputFile('slides/demo.pptx'), {
    kindLabel: 'PowerPoint',
    openMode: 'default-app',
    subtitle: '文档 · PowerPoint 打开',
  });

  assert.equal(describeConversationOutputFile('src/App.tsx'), null);
});
