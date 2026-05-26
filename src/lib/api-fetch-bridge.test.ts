import test from 'node:test';
import assert from 'node:assert/strict';
import { installApiFetchBridge, resolveApiUrl } from './api-fetch-bridge.js';

test('installApiFetchBridge leaves fetch untouched in plain web runtime', () => {
  const originalWindow = globalThis.window;
  const nativeFetch = (() => Promise.resolve(new Response('ok'))) as typeof fetch;
  const fakeWindow = {
    fetch: nativeFetch,
    location: {
      href: 'http://127.0.0.1:4001/',
      origin: 'http://127.0.0.1:4001',
    },
  } as unknown as Window & typeof globalThis;

  try {
    Object.defineProperty(globalThis, 'window', {
      value: fakeWindow,
      configurable: true,
    });

    installApiFetchBridge();

    assert.equal(globalThis.window.fetch, nativeFetch);
    assert.equal(globalThis.window.__codemApiFetchBridgeInstalled, undefined);
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
    });
  }
});

test('resolveApiUrl keeps relative api paths unchanged in plain web runtime', () => {
  const originalWindow = globalThis.window;
  const fakeWindow = {
    location: {
      href: 'http://127.0.0.1:4001/',
      origin: 'http://127.0.0.1:4001',
    },
  } as unknown as Window & typeof globalThis;

  try {
    Object.defineProperty(globalThis, 'window', {
      value: fakeWindow,
      configurable: true,
    });

    assert.equal(
      resolveApiUrl('/api/system/image-preview?path=D%3A%5Cworkspace%5Cimage.png'),
      '/api/system/image-preview?path=D%3A%5Cworkspace%5Cimage.png',
    );
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
    });
  }
});

test('resolveApiUrl rewrites relative api paths to desktop backend origin in tauri runtime', () => {
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
      resolveApiUrl('/api/system/image-preview?path=D%3A%5Cworkspace%5Cimage.png'),
      'http://127.0.0.1:3001/api/system/image-preview?path=D%3A%5Cworkspace%5Cimage.png',
    );
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
    });
  }
});
