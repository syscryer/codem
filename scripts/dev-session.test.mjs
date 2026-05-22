import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import {
  clearDevSessionState,
  readDevSessionState,
  writeDevSessionState,
} from './dev-session.mjs';

test('readDevSessionState returns null when the session file is missing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codem-dev-session-'));

  try {
    const state = await readDevSessionState(root);
    assert.equal(state, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('writeDevSessionState persists the selected backend and web ports', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codem-dev-session-'));

  try {
    await writeDevSessionState(root, {
      backendPort: 3004,
      webPort: 5173,
      pid: 4321,
    });

    const state = await readDevSessionState(root);
    assert.deepEqual(state, {
      backendPort: 3004,
      webPort: 5173,
      pid: 4321,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('clearDevSessionState removes the session file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codem-dev-session-'));

  try {
    await writeDevSessionState(root, {
      backendPort: 3001,
      webPort: 5173,
      pid: 999,
    });

    await clearDevSessionState(root);

    const state = await readDevSessionState(root);
    assert.equal(state, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
