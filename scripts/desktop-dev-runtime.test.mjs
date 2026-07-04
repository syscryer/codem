import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDesktopDevPorts } from './desktop-dev-runtime.mjs';

test('resolveDesktopDevPorts reuses the backend port from the active dev session', async () => {
  const result = await resolveDesktopDevPorts({
    preferredPort: 3001,
    readSessionState: async () => ({ backendPort: 3004, webPort: 5173, pid: 4321 }),
    isPortOpen: async (port) => port === 3004 || port === 5173,
    isProcessAlive: async (pid) => pid === 4321,
    findAvailablePort: async () => 3005,
  });

  assert.deepEqual(result, {
    backendPort: 3004,
    webPort: 5173,
    shouldStartDevServer: false,
  });
});

test('resolveDesktopDevPorts falls back to a new backend port when the saved session is stale', async () => {
  const unavailable = new Set([3001, 5173]);
  const result = await resolveDesktopDevPorts({
    preferredPort: 3001,
    readSessionState: async () => ({ backendPort: 3004, webPort: 5173, pid: 4321 }),
    isPortOpen: async () => false,
    isProcessAlive: async () => false,
    findAvailablePort: async (preferredPort) => {
      for (let port = preferredPort; port < preferredPort + 10; port += 1) {
        if (!unavailable.has(port)) {
          return port;
        }
      }
      throw new Error('no port');
    },
  });

  assert.deepEqual(result, {
    backendPort: 3002,
    webPort: 5174,
    shouldStartDevServer: true,
  });
});

test('resolveDesktopDevPorts uses the preferred web port when available', async () => {
  const result = await resolveDesktopDevPorts({
    preferredPort: 3001,
    preferredWebPort: 6173,
    readSessionState: async () => null,
    isPortOpen: async () => false,
    findAvailablePort: async (preferredPort) => preferredPort,
  });

  assert.deepEqual(result, {
    backendPort: 3001,
    webPort: 6173,
    shouldStartDevServer: true,
  });
});

test('resolveDesktopDevPorts does not reuse occupied preferred ports without an active dev session', async () => {
  const unavailable = new Set([3001, 5173]);
  const result = await resolveDesktopDevPorts({
    preferredPort: 3001,
    preferredWebPort: 5173,
    readSessionState: async () => null,
    isPortOpen: async (port) => unavailable.has(port),
    findAvailablePort: async (preferredPort) => {
      for (let port = preferredPort; port < preferredPort + 10; port += 1) {
        if (!unavailable.has(port)) {
          return port;
        }
      }
      throw new Error('no port');
    },
  });

  assert.deepEqual(result, {
    backendPort: 3002,
    webPort: 5174,
    shouldStartDevServer: true,
  });
});

test('resolveDesktopDevPorts does not reuse session ports when the saved pid is no longer alive', async () => {
  const unavailable = new Set([3004, 5173]);
  const result = await resolveDesktopDevPorts({
    preferredPort: 3001,
    preferredWebPort: 5173,
    readSessionState: async () => ({ backendPort: 3004, webPort: 5173, pid: 4321 }),
    isPortOpen: async (port) => unavailable.has(port),
    isProcessAlive: async () => false,
    findAvailablePort: async (preferredPort) => {
      for (let port = preferredPort; port < preferredPort + 10; port += 1) {
        if (!unavailable.has(port)) {
          return port;
        }
      }
      throw new Error('no port');
    },
  });

  assert.deepEqual(result, {
    backendPort: 3001,
    webPort: 5174,
    shouldStartDevServer: true,
  });
});
