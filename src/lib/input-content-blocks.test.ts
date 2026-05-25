import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeInputContentBlocks,
  stripTransientInputBlockData,
  summarizeInputContentBlocksForTrace,
} from './input-content-blocks.js';

test('legacy prompt and image attachments normalize into neutral input blocks', () => {
  const blocks = normalizeInputContentBlocks({
    prompt: '  请看这张图  ',
    imageAttachments: [
      {
        id: 'image-1',
        path: 'D:\\workspace\\.codem-attachments\\image.png',
        name: 'image.png',
        mimeType: 'image/png',
        size: 5,
        data: 'SGVsbG8=',
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

test('attachment-only messages do not fabricate fallback text blocks', () => {
  const blocks = normalizeInputContentBlocks({
    prompt: '',
    imageAttachments: [
      {
        id: 'image-1',
        path: 'D:\\workspace\\.codem-attachments\\image.png',
        name: 'image.png',
        mimeType: 'image/png',
        size: 5,
        data: 'SGVsbG8=',
      },
    ],
  });

  assert.deepEqual(blocks, [
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

test('legacy image attachments without mimeType and path are skipped', () => {
  const blocks = normalizeInputContentBlocks({
    prompt: '  保留文本  ',
    imageAttachments: [
      {
        id: 'image-invalid',
        path: '',
        name: 'missing-metadata.png',
        data: 'SGVsbG8=',
      },
      {
        id: 'image-valid',
        path: 'D:\\workspace\\.codem-attachments\\image.png',
        name: 'image.png',
        data: 'SGVsbG8=',
      },
    ],
  });

  assert.deepEqual(blocks, [
    {
      type: 'text',
      text: '保留文本',
    },
    {
      type: 'image',
      id: 'image-valid',
      path: 'D:\\workspace\\.codem-attachments\\image.png',
      name: 'image.png',
      data: 'SGVsbG8=',
    },
  ]);
});

test('empty or invalid content blocks fall back to prompt and imageAttachments', () => {
  const blocks = normalizeInputContentBlocks({
    prompt: '  回退到 legacy  ',
    contentBlocks: [
      {
        type: 'text',
        text: '   ',
      },
    ],
    imageAttachments: [
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
        path: 'D:\\workspace\\.codem-attachments\\broken.png',
        name: 'broken.png',
        mimeType: 'image/png',
        size: 10,
      },
    ],
  });

  assert.deepEqual(blocks, [
    {
      type: 'text',
      text: '回退到 legacy',
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
    {
      type: 'image',
      id: 'image-2',
      path: 'D:\\workspace\\.codem-attachments\\broken.png',
      name: 'broken.png',
      mimeType: 'image/png',
      size: 10,
    },
  ]);
});

test('valid contentBlocks take priority over prompt and imageAttachments', () => {
  const blocks = normalizeInputContentBlocks({
    prompt: '这段 prompt 不应被拼进去',
    contentBlocks: [
      {
        type: 'text',
        text: '  只使用 direct blocks  ',
      },
      {
        type: 'attachment_metadata',
        name: 'unsupported.bin',
        reason: '不能直接发送',
      },
    ],
    imageAttachments: [
      {
        id: 'image-1',
        path: 'D:\\workspace\\.codem-attachments\\image.png',
        name: 'image.png',
        mimeType: 'image/png',
        data: 'SGVsbG8=',
      },
    ],
  });

  assert.deepEqual(blocks, [
    {
      type: 'text',
      text: '只使用 direct blocks',
    },
    {
      type: 'attachment_metadata',
      name: 'unsupported.bin',
      reason: '不能直接发送',
    },
  ]);
});

test('direct contentBlocks keep image blocks when path exists and drop invalid metadata blocks', () => {
  const blocks = normalizeInputContentBlocks({
    prompt: 'fallback should not be used',
    contentBlocks: [
      {
        type: 'image',
        path: 'D:\\workspace\\.codem-attachments\\image-only-path.png',
        name: 'image-only-path.png',
      },
      {
        type: 'image',
        name: 'invalid-data-only.png',
        data: 'SGVsbG8=',
      },
      {
        type: 'attachment_metadata',
        name: 'missing-reason.bin',
      },
      {
        type: 'attachment_metadata',
        name: 'unsupported.bin',
        reason: '不能直接发送',
        mimeType: 'application/octet-stream',
        size: 12,
      },
    ],
    imageAttachments: [
      {
        id: 'legacy-image',
        path: 'D:\\workspace\\.codem-attachments\\legacy.png',
        name: 'legacy.png',
        data: 'SGVsbG8=',
      },
    ],
  });

  assert.deepEqual(blocks, [
    {
      type: 'image',
      path: 'D:\\workspace\\.codem-attachments\\image-only-path.png',
      name: 'image-only-path.png',
    },
    {
      type: 'attachment_metadata',
      name: 'unsupported.bin',
      reason: '不能直接发送',
      mimeType: 'application/octet-stream',
      size: 12,
    },
  ]);
});

test('stripTransientInputBlockData removes base64 and file text payloads but keeps summary bytes', () => {
  const blocks = [
    {
      type: 'text' as const,
      text: '保留文本块',
    },
    {
      type: 'image' as const,
      id: 'image-1',
      path: 'D:\\workspace\\.codem-attachments\\image.png',
      name: 'image.png',
      mimeType: 'image/png',
      size: 5,
      data: 'SGVsbG8=',
    },
    {
      type: 'image' as const,
      id: 'image-2',
      mimeType: 'image/png',
      data: 'SGVsbG8=',
    },
    {
      type: 'file_text' as const,
      path: 'D:\\workspace\\notes\\todo.md',
      name: 'todo.md',
      mimeType: 'text/markdown',
      text: '  中文abc  ',
    },
  ];

  const stripped = stripTransientInputBlockData(blocks);

  assert.deepEqual(stripped, [
    {
      type: 'text',
      text: '保留文本块',
    },
    {
      type: 'image',
      id: 'image-1',
      path: 'D:\\workspace\\.codem-attachments\\image.png',
      name: 'image.png',
      mimeType: 'image/png',
      size: 5,
      imageBytes: 5,
    },
    {
      type: 'image',
      id: 'image-2',
      mimeType: 'image/png',
      imageBytes: 5,
    },
    {
      type: 'file_text',
      path: 'D:\\workspace\\notes\\todo.md',
      name: 'todo.md',
      mimeType: 'text/markdown',
      textBytes: Buffer.byteLength('  中文abc  ', 'utf8'),
    },
  ]);

  assert.equal(blocks[1].data, 'SGVsbG8=');
  assert.equal(blocks[2].data, 'SGVsbG8=');
  assert.equal(blocks[3].text, '  中文abc  ');
});

test('stripTransientInputBlockData works without global Buffer', () => {
  const originalBuffer = globalThis.Buffer;
  try {
    Object.assign(globalThis, { Buffer: undefined });

    const stripped = stripTransientInputBlockData([
      {
        type: 'image',
        mimeType: 'image/png',
        data: 'SGVsbG8=',
      },
      {
        type: 'file_text',
        path: 'D:\\workspace\\notes\\todo.md',
        name: 'todo.md',
        text: '中文abc',
      },
    ]);

    assert.deepEqual(stripped, [
      {
        type: 'image',
        mimeType: 'image/png',
        imageBytes: 5,
      },
      {
        type: 'file_text',
        path: 'D:\\workspace\\notes\\todo.md',
        name: 'todo.md',
        textBytes: 9,
      },
    ]);
  } finally {
    Object.assign(globalThis, { Buffer: originalBuffer });
  }
});

test('trace summary exposes only block counts and image bytes', () => {
  const summary = summarizeInputContentBlocksForTrace([
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
    {
      type: 'file_text',
      path: 'D:\\workspace\\notes\\todo.md',
      name: 'todo.md',
      mimeType: 'text/markdown',
      text: '不要泄露这段文本',
    },
    {
      type: 'file_reference',
      path: 'D:\\workspace\\logs\\large.log',
      name: 'large.log',
      reason: 'too_large',
    },
  ]);

  assert.equal(summary, 'text=1, images=1, fileText=1, fileReferences=1, metadata=0, imageBytes=5');

  assert.doesNotMatch(summary, /请看这张图/);
  assert.doesNotMatch(summary, /不要泄露这段文本/);
  assert.doesNotMatch(summary, /SGVsbG8=/);
});

test('trace summary works without global Buffer', () => {
  const originalBuffer = globalThis.Buffer;
  try {
    Object.assign(globalThis, { Buffer: undefined });

    const summary = summarizeInputContentBlocksForTrace([
      {
        type: 'image',
        mimeType: 'image/png',
        data: 'SGVsbG8=',
      },
    ]);

    assert.equal(summary, 'text=0, images=1, fileText=0, fileReferences=0, metadata=0, imageBytes=5');
  } finally {
    Object.assign(globalThis, { Buffer: originalBuffer });
  }
});

test('direct file_text normalization preserves original text whitespace', () => {
  const blocks = normalizeInputContentBlocks({
    contentBlocks: [
      {
        type: 'file_text',
        path: '  D:\\workspace\\notes\\todo.md  ',
        name: '  todo.md  ',
        mimeType: ' text/markdown ',
        text: '  line 1\nline 2  ',
      },
    ],
  });

  assert.deepEqual(blocks, [
    {
      type: 'file_text',
      path: 'D:\\workspace\\notes\\todo.md',
      name: 'todo.md',
      mimeType: 'text/markdown',
      text: '  line 1\nline 2  ',
    },
  ]);
});

test('normalizeInputContentBlocks strips invalid sizes from normalized blocks', () => {
  const blocks = normalizeInputContentBlocks({
    contentBlocks: [
      {
        type: 'image',
        path: 'D:\\workspace\\.codem-attachments\\image.png',
        size: Number.NaN,
      },
      {
        type: 'file_text',
        path: 'D:\\workspace\\notes\\todo.md',
        name: 'todo.md',
        size: Number.POSITIVE_INFINITY,
        text: 'abc',
      },
      {
        type: 'file_reference',
        path: 'D:\\workspace\\logs\\large.log',
        name: 'large.log',
        size: -1,
        reason: 'too_large',
      },
      {
        type: 'attachment_metadata',
        name: 'unsupported.bin',
        reason: '不能直接发送',
        size: 0,
      },
    ],
  });

  assert.deepEqual(blocks, [
    {
      type: 'image',
      path: 'D:\\workspace\\.codem-attachments\\image.png',
    },
    {
      type: 'file_text',
      path: 'D:\\workspace\\notes\\todo.md',
      name: 'todo.md',
      text: 'abc',
    },
    {
      type: 'file_reference',
      path: 'D:\\workspace\\logs\\large.log',
      name: 'large.log',
      reason: 'too_large',
    },
    {
      type: 'attachment_metadata',
      name: 'unsupported.bin',
      reason: '不能直接发送',
      size: 0,
    },
  ]);
});

test('unsupported block errors do not leak block payloads', () => {
  assert.throws(
    () =>
      summarizeInputContentBlocksForTrace([
        {
          type: 'unknown',
          text: '不要泄露这段文本',
          data: 'SGVsbG8=',
        } as unknown as never,
      ]),
    (error) => {
      assert.match(String(error), /Unsupported input content block: unknown/);
      assert.doesNotMatch(String(error), /不要泄露这段文本/);
      assert.doesNotMatch(String(error), /SGVsbG8=/);
      return true;
    },
  );
});
