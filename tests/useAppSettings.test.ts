import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppSettings, AppearanceSettings } from '../src/types';
import {
  createLatestAppearanceSaveQueue,
  defaultAppearanceSettings,
  resolveAppearanceUpdate,
} from '../src/hooks/useAppSettings';

test('resolveAppearanceUpdate merges patches against the latest appearance', () => {
  const first = resolveAppearanceUpdate(defaultAppearanceSettings, { themeMode: 'dark' });
  const second = resolveAppearanceUpdate(first, { density: 'compact' });

  assert.equal(second.themeMode, 'dark');
  assert.equal(second.density, 'compact');
});

test('resolveAppearanceUpdate accepts updater functions', () => {
  const next = resolveAppearanceUpdate(defaultAppearanceSettings, (current) => ({
    uiFontSize: current.uiFontSize === 13 ? 14 : 13,
  }));

  assert.equal(next.uiFontSize, 14);
  assert.equal(next.codeFontSize, defaultAppearanceSettings.codeFontSize);
});

test('createLatestAppearanceSaveQueue writes the latest pending appearance last', async () => {
  const savedPayloads: AppearanceSettings[] = [];
  const appliedPayloads: AppSettings[] = [];
  const failures: unknown[] = [];
  const firstSave = deferred<AppSettings>();
  const secondSave = deferred<AppSettings>();

  const queue = createLatestAppearanceSaveQueue({
    save: (appearance) => {
      savedPayloads.push(appearance);
      return savedPayloads.length === 1 ? firstSave.promise : secondSave.promise;
    },
    onSaved: (settings) => appliedPayloads.push(settings),
    onError: (error) => failures.push(error),
  });

  const firstAppearance = { ...defaultAppearanceSettings, themeMode: 'light' as const };
  const latestAppearance = { ...defaultAppearanceSettings, themeMode: 'dark' as const };

  queue.enqueue(firstAppearance);
  queue.enqueue(latestAppearance);

  assert.deepEqual(savedPayloads.map((appearance) => appearance.themeMode), ['light']);

  firstSave.resolve({ appearance: firstAppearance });
  await waitForMicrotasks();

  assert.deepEqual(appliedPayloads, []);
  assert.deepEqual(savedPayloads.map((appearance) => appearance.themeMode), ['light', 'dark']);

  secondSave.resolve({ appearance: latestAppearance });
  await waitForMicrotasks();

  assert.deepEqual(appliedPayloads, [{ appearance: latestAppearance }]);
  assert.deepEqual(failures, []);
});

test('createLatestAppearanceSaveQueue ignores stale save failures when a newer save is pending', async () => {
  const appliedPayloads: AppSettings[] = [];
  const failures: unknown[] = [];
  const firstSave = deferred<AppSettings>();
  const secondSave = deferred<AppSettings>();
  let saveCount = 0;

  const queue = createLatestAppearanceSaveQueue({
    save: () => {
      saveCount += 1;
      return saveCount === 1 ? firstSave.promise : secondSave.promise;
    },
    onSaved: (settings) => appliedPayloads.push(settings),
    onError: (error) => failures.push(error),
  });

  const firstAppearance = { ...defaultAppearanceSettings, themeMode: 'light' as const };
  const latestAppearance = { ...defaultAppearanceSettings, themeMode: 'dark' as const };

  queue.enqueue(firstAppearance);
  queue.enqueue(latestAppearance);

  firstSave.reject(new Error('old failure'));
  await waitForMicrotasks();

  assert.deepEqual(failures, []);

  secondSave.resolve({ appearance: latestAppearance });
  await waitForMicrotasks();

  assert.deepEqual(appliedPayloads, [{ appearance: latestAppearance }]);
  assert.deepEqual(failures, []);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

async function waitForMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}
