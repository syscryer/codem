import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRunImageAttachments,
  stripTransientAttachmentData,
} from './claude-run-attachments.js';
import * as claudeRunAttachments from './claude-run-attachments.js';

const source = readFileSync(new URL('./claude-run-attachments.ts', import.meta.url), 'utf8');

test('stripTransientAttachmentData removes base64 data before storing turn history', () => {
  const attachments = [
    {
      id: 'image-1',
      path: 'D:\\workspace\\.codem-attachments\\image.png',
      name: 'image.png',
      mimeType: 'image/png',
      size: 5,
      data: 'SGVsbG8=',
    },
  ];

  const stripped = stripTransientAttachmentData(attachments);

  assert.deepEqual(stripped, [
    {
      id: 'image-1',
      path: 'D:\\workspace\\.codem-attachments\\image.png',
      name: 'image.png',
      mimeType: 'image/png',
      size: 5,
    },
  ]);
  assert.equal(attachments[0].data, 'SGVsbG8=');
});

test('buildRunImageAttachments keeps queued image data for the runtime request only', () => {
  const attachments = [
    {
      id: 'image-1',
      path: 'D:\\workspace\\.codem-attachments\\image.png',
      name: 'image.png',
      mimeType: ' image/png ',
      size: 5,
      data: ' SGVsbG8= ',
    },
    {
      id: 'image-2',
      path: 'D:\\workspace\\.codem-attachments\\missing-data.png',
      name: 'missing-data.png',
      mimeType: 'image/png',
    },
  ];

  const turnAttachments = stripTransientAttachmentData(attachments);
  const runAttachments = buildRunImageAttachments(attachments);

  assert.deepEqual(runAttachments, [
    {
      mimeType: 'image/png',
      data: 'SGVsbG8=',
    },
  ]);
  assert.equal('data' in turnAttachments![0], false);
  assert.equal(attachments[0].data, ' SGVsbG8= ');
});

test('block-aware helper builds neutral content blocks from legacy prompt and attachments', () => {
  assert.match(source, /import\s*\{\s*normalizeInputContentBlocks,\s*stripTransientInputBlockData\s*\}\s*from ['"]\.\/input-content-blocks['"]/);

  const buildRunContentBlocks = (claudeRunAttachments as Record<string, unknown>).buildRunContentBlocks;
  assert.equal(typeof buildRunContentBlocks, 'function');

  const blocks = (
    buildRunContentBlocks as (options: {
      prompt?: string;
      attachments?: Array<{
        id: string;
        path: string;
        name: string;
        mimeType?: string;
        size?: number;
        data?: string;
      }>;
    }) => unknown
  )({
    prompt: '  请看这张图  ',
    attachments: [
      {
        id: 'image-1',
        path: 'D:\\workspace\\.codem-attachments\\image.png',
        name: 'image.png',
        mimeType: ' image/png ',
        size: 5,
        data: ' SGVsbG8= ',
      },
    ],
  });

  assert.deepEqual(blocks, [
    {
      type: 'text',
      text: '请看这张图',
    },
    {
      type: 'image',
      id: 'image-1',
      path: 'D:\\workspace\\.codem-attachments\\image.png',
      name: 'image.png',
      mimeType: 'image/png',
      size: 5,
      data: 'SGVsbG8=',
    },
  ]);
});

test('buildRunContentBlocks keeps non-text content when prompt is blank', () => {
  const buildRunContentBlocks = (claudeRunAttachments as Record<string, unknown>).buildRunContentBlocks;
  assert.equal(typeof buildRunContentBlocks, 'function');

  const blocks = (
    buildRunContentBlocks as (options: {
      prompt?: string;
      contentBlocks?: Array<{
        type: 'file_reference';
        path: string;
        name: string;
        reason?: 'too_large';
      }>;
    }) => unknown
  )({
    prompt: '   ',
    contentBlocks: [
      {
        type: 'file_reference',
        path: 'D:\\workspace\\src\\App.tsx',
        name: 'App.tsx',
        reason: 'too_large',
      },
    ],
  });

  assert.deepEqual(blocks, [
    {
      type: 'file_reference',
      path: 'D:\\workspace\\src\\App.tsx',
      name: 'App.tsx',
      reason: 'too_large',
    },
  ]);
});

test('stripTransientContentBlockData removes transient block payloads from history-safe projection', () => {
  assert.match(source, /export function stripTransientContentBlockData\(/);

  const stripTransientContentBlockData = (claudeRunAttachments as Record<string, unknown>).stripTransientContentBlockData;
  assert.equal(typeof stripTransientContentBlockData, 'function');

  const historyBlocks = (
    stripTransientContentBlockData as (blocks: Array<
      | {
          type: 'text';
          text: string;
        }
      | {
          type: 'image';
          path?: string;
          name?: string;
          mimeType?: string;
          size?: number;
          data?: string;
        }
      | {
          type: 'file_text';
          path: string;
          name: string;
          text: string;
        }
    >) => unknown
  )([
      {
        type: 'text',
        text: '保留这段文字',
      },
      {
        type: 'image',
        path: 'D:\\workspace\\.codem-attachments\\image.png',
        name: 'image.png',
        mimeType: 'image/png',
        size: 5,
        data: 'SGVsbG8=',
      },
      {
        type: 'file_text',
        path: 'D:\\workspace\\notes\\todo.md',
        name: 'todo.md',
        text: '不要把这段文件内容写进历史',
      },
    ]);

  assert.deepEqual(historyBlocks, [
    {
      type: 'text',
      text: '保留这段文字',
    },
    {
      type: 'image',
      path: 'D:\\workspace\\.codem-attachments\\image.png',
      name: 'image.png',
      mimeType: 'image/png',
      size: 5,
      imageBytes: 5,
    },
    {
      type: 'file_text',
      path: 'D:\\workspace\\notes\\todo.md',
      name: 'todo.md',
      textBytes: Buffer.byteLength('不要把这段文件内容写进历史', 'utf8'),
    },
  ]);
});

test('buildHistoryContentBlocks reuses the shared transient stripping helper', () => {
  assert.match(source, /return stripTransientContentBlockData\(buildRunContentBlocks\(options\)\) \?\? \[\]/);
});
