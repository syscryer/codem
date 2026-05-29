import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BACKEND_PORT,
  DEFAULT_WEB_PORT,
  buildBackendPortEnv,
  buildDevServerEnv,
  findAvailablePort,
  resolvePreferredBackendPort,
  resolvePreferredWebPort,
} from './dev-ports.mjs';

test('resolvePreferredBackendPort defaults to 3001', () => {
  assert.equal(resolvePreferredBackendPort({}), DEFAULT_BACKEND_PORT);
});

test('resolvePreferredBackendPort honors CODEM_BACKEND_PORT before PORT', () => {
  assert.equal(resolvePreferredBackendPort({ CODEM_BACKEND_PORT: '4100', PORT: '4200' }), 4100);
});

test('resolvePreferredWebPort honors CODEM_WEB_PORT', () => {
  assert.equal(resolvePreferredWebPort({ CODEM_WEB_PORT: '6173' }), 6173);
  assert.equal(resolvePreferredWebPort({}), DEFAULT_WEB_PORT);
});

test('findAvailablePort starts at preferred port and skips unavailable ports', async () => {
  const unavailable = new Set([3001, 3002, 3003]);
  const port = await findAvailablePort(3001, {
    maxAttempts: 8,
    isAvailable: async (candidate) => !unavailable.has(candidate),
  });

  assert.equal(port, 3004);
});

test('buildBackendPortEnv passes the selected port to child processes', () => {
  assert.deepEqual(buildBackendPortEnv({ PORT: '9999' }, 3004), {
    PORT: '9999',
    CODEM_BACKEND_PORT: '3004',
  });
});

test('buildDevServerEnv passes backend and web ports to child processes', () => {
  assert.deepEqual(buildDevServerEnv({ PORT: '9999' }, { backendPort: 3004, webPort: 6173 }), {
    PORT: '9999',
    CODEM_BACKEND_PORT: '3004',
    CODEM_WEB_PORT: '6173',
  });
});
