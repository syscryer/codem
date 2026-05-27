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
  assert.equal(DEFAULT_RUNTIME_FLAVOR, 'with-node');
  assert.equal(DEFAULT_RUNTIME_MODE, 'bundled');
  assert.equal(DEFAULT_RUNTIME_MODE, flavorToMode(DEFAULT_RUNTIME_FLAVOR));
  assert.equal(RUNTIME_ENV_NAME, 'CODEM_RUNTIME_MODE');
});

test('normalizeRuntimeFlavor defaults to with-node', () => {
  assert.equal(normalizeRuntimeFlavor(undefined), 'with-node');
  assert.equal(normalizeRuntimeFlavor(null), 'with-node');
});

test('normalizeRuntimeFlavor keeps supported flavors unchanged', () => {
  assert.equal(normalizeRuntimeFlavor('with-node'), 'with-node');
  assert.equal(normalizeRuntimeFlavor('no-node'), 'no-node');
});

test('flavorToMode maps flavors to runtime modes', () => {
  assert.equal(flavorToMode('with-node'), 'bundled');
  assert.equal(flavorToMode('no-node'), 'external');
});

test('flavorSuffix returns the public flavor suffix', () => {
  assert.equal(flavorSuffix('with-node'), 'with-node');
  assert.equal(flavorSuffix('no-node'), 'no-node');
});

test('unsupported runtime flavors throw a clear error', () => {
  const normalizeError = captureError(() => normalizeRuntimeFlavor('portable'));
  assert.match(normalizeError.message, /Unsupported runtime flavor/);
  assert.match(normalizeError.message, /portable/);
  assert.match(normalizeError.message, /with-node/);
  assert.match(normalizeError.message, /no-node/);

  const modeError = captureError(() => flavorToMode('portable'));
  assert.match(modeError.message, /Unsupported runtime flavor/);
  assert.match(modeError.message, /portable/);
  assert.match(modeError.message, /with-node/);
  assert.match(modeError.message, /no-node/);

  const suffixError = captureError(() => flavorSuffix('portable'));
  assert.match(suffixError.message, /Unsupported runtime flavor/);
  assert.match(suffixError.message, /portable/);
  assert.match(suffixError.message, /with-node/);
  assert.match(suffixError.message, /no-node/);
});
