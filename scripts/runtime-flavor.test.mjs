import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_RUNTIME_FLAVOR,
  DEFAULT_RUNTIME_MODE,
  RUNTIME_ENV_NAME,
  flavorSuffix,
  flavorToMode,
  normalizeRuntimeFlavor,
} from './runtime-flavor.mjs';

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }

  assert.fail('Expected function to throw');
}

test('runtime flavor helpers expose the expected defaults', () => {
  assert.equal(DEFAULT_RUNTIME_FLAVOR, 'rust');
  assert.equal(DEFAULT_RUNTIME_MODE, 'rust');
  assert.equal(DEFAULT_RUNTIME_MODE, flavorToMode(DEFAULT_RUNTIME_FLAVOR));
  assert.equal(RUNTIME_ENV_NAME, 'CODEM_RUNTIME_MODE');
});

test('normalizeRuntimeFlavor defaults to rust', () => {
  assert.equal(normalizeRuntimeFlavor(undefined), 'rust');
  assert.equal(normalizeRuntimeFlavor(null), 'rust');
});

test('normalizeRuntimeFlavor keeps supported flavors unchanged', () => {
  assert.equal(normalizeRuntimeFlavor('rust'), 'rust');
});

test('flavorToMode maps flavors to runtime modes', () => {
  assert.equal(flavorToMode('rust'), 'rust');
});

test('flavorSuffix returns the public flavor suffix', () => {
  assert.equal(flavorSuffix('rust'), 'rust');
});

test('unsupported runtime flavors throw a clear error', () => {
  const normalizeError = captureError(() => normalizeRuntimeFlavor('portable'));
  assert.match(normalizeError.message, /Unsupported runtime flavor/);
  assert.match(normalizeError.message, /portable/);
  assert.match(normalizeError.message, /rust/);

  const modeError = captureError(() => flavorToMode('portable'));
  assert.match(modeError.message, /Unsupported runtime flavor/);
  assert.match(modeError.message, /portable/);
  assert.match(modeError.message, /rust/);

  const suffixError = captureError(() => flavorSuffix('portable'));
  assert.match(suffixError.message, /Unsupported runtime flavor/);
  assert.match(suffixError.message, /portable/);
  assert.match(suffixError.message, /rust/);
});
