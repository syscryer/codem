import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, rm } from 'node:fs/promises';

import {
  completeTrellisSession,
  getCurrentTrellisSession,
  recordTrellisNote,
  startTrellisSession,
  verifyTrellisSession,
} from './trellis.mjs';

async function withWorkspace(fn) {
  const root = await mkdtempWorkspace();
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function mkdtempWorkspace() {
  const { mkdtemp } = await import('node:fs/promises');
  const root = await mkdtemp(path.join(os.tmpdir(), 'codem-trellis-'));
  await mkdir(path.join(root, '.trellis', 'tasks'), { recursive: true });
  await mkdir(path.join(root, '.trellis', 'workspace'), { recursive: true });
  return root;
}

test('startTrellisSession creates task, session record, and current-session state', async () => {
  await withWorkspace(async (root) => {
    const session = await startTrellisSession(root, {
      slug: 'soft-interrupt',
      title: 'Soft Interrupt',
      objective: 'Add soft interrupt support',
    });

    assert.equal(session.slug, 'soft-interrupt');
    assert.equal(session.title, 'Soft Interrupt');
    assert.match(session.id, /^session-\d{8}-\d{6}-[a-z0-9]{4}$/);

    const current = await getCurrentTrellisSession(root);
    assert.equal(current.id, session.id);
    assert.equal(current.taskPath, path.join(root, '.trellis', 'tasks', 'soft-interrupt.md'));

    const task = await readFile(current.taskPath, 'utf8');
    assert.match(task, /# Task: Soft Interrupt/);
    assert.match(task, /Add soft interrupt support/);

    const record = await readFile(current.sessionPath, 'utf8');
    assert.match(record, /# Session Record: Soft Interrupt/);
    assert.match(record, /Task: \.trellis\/tasks\/soft-interrupt\.md/);
  });
});

test('startTrellisSession refuses to replace an active session unless forced', async () => {
  await withWorkspace(async (root) => {
    const first = await startTrellisSession(root, {
      slug: 'first-task',
      title: 'First Task',
    });

    await assert.rejects(
      () =>
        startTrellisSession(root, {
          slug: 'second-task',
          title: 'Second Task',
        }),
      /Active Trellis session already exists/,
    );

    assert.equal((await getCurrentTrellisSession(root)).id, first.id);

    const second = await startTrellisSession(root, {
      slug: 'second-task',
      title: 'Second Task',
      force: true,
    });

    assert.equal((await getCurrentTrellisSession(root)).id, second.id);
  });
});

test('recordTrellisNote appends to the session and task implementation record', async () => {
  await withWorkspace(async (root) => {
    const session = await startTrellisSession(root, {
      slug: 'runtime',
      title: 'Runtime Work',
    });

    await recordTrellisNote(root, 'Implemented runtime guard.');

    const record = await readFile(session.sessionPath, 'utf8');
    assert.match(record, /Implemented runtime guard\./);

    const task = await readFile(session.taskPath, 'utf8');
    assert.match(task, /## Implementation Record/);
    assert.match(task, /Implemented runtime guard\./);
  });
});

test('verifyTrellisSession records command and result in both files', async () => {
  await withWorkspace(async (root) => {
    const session = await startTrellisSession(root, {
      slug: 'verify',
      title: 'Verify Work',
    });

    await verifyTrellisSession(root, {
      command: 'node --test scripts/trellis.test.mjs',
      result: 'pass 5',
    });

    const record = await readFile(session.sessionPath, 'utf8');
    assert.match(record, /node --test scripts\/trellis\.test\.mjs/);
    assert.match(record, /pass 5/);

    const task = await readFile(session.taskPath, 'utf8');
    assert.match(task, /## Verification Results/);
    assert.match(task, /pass 5/);
  });
});

test('completeTrellisSession writes summary and clears current session', async () => {
  await withWorkspace(async (root) => {
    const session = await startTrellisSession(root, {
      slug: 'complete',
      title: 'Complete Work',
    });

    await completeTrellisSession(root, 'Finished first automation loop.');

    assert.equal(await getCurrentTrellisSession(root), null);

    const record = await readFile(session.sessionPath, 'utf8');
    assert.match(record, /## Completed/);
    assert.match(record, /Finished first automation loop\./);

    const task = await readFile(session.taskPath, 'utf8');
    assert.match(task, /## Completion Summary/);
    assert.match(task, /Finished first automation loop\./);
  });
});
