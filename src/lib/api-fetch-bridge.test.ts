import test from 'node:test';
import assert from 'node:assert/strict';
import { installApiFetchBridge } from './api-fetch-bridge.js';

test('installApiFetchBridge leaves fetch untouched in plain web runtime', () => {
  const originalWindow = globalThis.window;
  const nativeFetch = (() => Promise.resolve(new Response('ok'))) as typeof fetch;
  const fakeWindow = {
    fetch: nativeFetch,
    location: {
      href: 'http://127.0.0.1:4001/',
      origin: 'http://127.0.0.1:4001',
    },
  } as Window & typeof globalThis;

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
