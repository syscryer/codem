import assert from 'node:assert/strict';
import test from 'node:test';
import { createClientId, installClientIdCompatibility } from './client-id';

test('creates an RFC 4122 style id when randomUUID is unavailable', () => {
  const source = {
    getRandomValues<T extends ArrayBufferView>(array: T): T {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      bytes.forEach((_, index) => { bytes[index] = index; });
      return array;
    },
  };

  assert.equal(createClientId(source), '00010203-0405-4607-8809-0a0b0c0d0e0f');
});

test('installs randomUUID compatibility for insecure mobile contexts', () => {
  const original = globalThis.crypto;
  const source = {
    getRandomValues<T extends ArrayBufferView>(array: T): T {
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(7);
      return array;
    },
  };
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: source });
  try {
    installClientIdCompatibility();
    assert.match((globalThis.crypto as Crypto).randomUUID(), /^[0-9a-f-]{36}$/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: original });
  }
});
