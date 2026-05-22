import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDesktopDevPorts } from './desktop-dev-runtime.mjs';

test('resolveDesktopDevPorts reuses the backend port from the active dev session', async () => {
  const result = await resolveDesktopDevPorts({
    preferredPort: 3001,
    readSessionState: async () => ({ backendPort: 3004, webPort: 5173 }),
    isPortOpen: async (port) => port === 3004 || port === 5173,
    findAvailablePort: async () => 3005,
  });

  assert.deepEqual(result, {
    backendPort: 3004,
    webPort: 5173,
    shouldStartDevServer: false,
  });
});

test('resolveDesktopDevPorts falls back to a new backend port when the saved session is stale', async () => {
  const result = await resolveDesktopDevPorts({
    preferredPort: 3001,
    readSessionState: async () => ({ backendPort: 3004, webPort: 5173 }),
    isPortOpen: async () => false,
    findAvailablePort: async () => 3006,
  });

  assert.deepEqual(result, {
    backendPort: 3006,
    webPort: 5173,
    shouldStartDevServer: true,
  });
});
