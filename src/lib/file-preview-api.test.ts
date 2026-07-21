import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDesktopImagePreviewUrl,
  buildWorkspaceImagePreviewUrl,
  fetchWorkspaceFilePreview,
} from './file-preview-api.js';

test('buildWorkspaceImagePreviewUrl rewrites desktop image preview urls to backend origin', () => {
  const originalWindow = globalThis.window;
  const fakeWindow = {
    __TAURI_INTERNALS__: {},
    location: {
      href: 'tauri://localhost/',
      origin: 'tauri://localhost',
    },
  } as unknown as Window & typeof globalThis;

  try {
    Object.defineProperty(globalThis, 'window', {
      value: fakeWindow,
      configurable: true,
    });

    assert.equal(
      buildWorkspaceImagePreviewUrl('D:\\workspace\\.codem-attachments\\image.png'),
      'http://127.0.0.1:3001/api/system/image-preview?path=D%3A%5Cworkspace%5C.codem-attachments%5Cimage.png',
    );
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
    });
  }
});

test('buildDesktopImagePreviewUrl uses the unrestricted desktop attachment preview route', () => {
  const originalWindow = globalThis.window;
  const fakeWindow = {
    __TAURI_INTERNALS__: {},
    location: {
      href: 'tauri://localhost/',
      origin: 'tauri://localhost',
    },
  } as unknown as Window & typeof globalThis;

  try {
    Object.defineProperty(globalThis, 'window', {
      value: fakeWindow,
      configurable: true,
    });

    assert.equal(
      buildDesktopImagePreviewUrl('C:\\Users\\demo\\Pictures\\chat.png'),
      'http://127.0.0.1:3001/api/system/attachments/image-preview?path=C%3A%5CUsers%5Cdemo%5CPictures%5Cchat.png',
    );
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
    });
  }
});

test('fetchWorkspaceFilePreview rewrites returned image preview urls for desktop runtime', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const fakeWindow = {
    __TAURI_INTERNALS__: {},
    location: {
      href: 'tauri://localhost/',
      origin: 'tauri://localhost',
    },
  } as unknown as Window & typeof globalThis;

  try {
    Object.defineProperty(globalThis, 'window', {
      value: fakeWindow,
      configurable: true,
    });

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'D:\\workspace\\.codem-attachments\\image.png',
          content: '',
          mode: 'image',
          previewUrl: '/api/system/image-preview?path=D%3A%5Cworkspace%5C.codem-attachments%5Cimage.png',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      )) as typeof fetch;

    const preview = await fetchWorkspaceFilePreview('D:\\workspace\\.codem-attachments\\image.png');
    assert.equal(preview.mode, 'image');
    assert.equal(
      preview.previewUrl,
      'http://127.0.0.1:3001/api/system/image-preview?path=D%3A%5Cworkspace%5C.codem-attachments%5Cimage.png',
    );
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
    });
    globalThis.fetch = originalFetch;
  }
});
