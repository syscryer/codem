import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppSettings, AppearanceSettings, ModelSettings } from '../src/types';
import {
  createLatestAppearanceSaveQueue,
  defaultAppearanceSettings,
  defaultModelSettings,
  defaultOpenWithSettings,
  defaultShortcutSettings,
  resolveAppearanceUpdate,
  resolveModelSettingsUpdate,
  resolveOpenWithSettingsUpdate,
  resolveShortcutSettingsUpdate,
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

test('resolveModelSettingsUpdate merges patches against the latest model settings', () => {
  const current: ModelSettings = {
    customModels: [{ id: 'custom/model' }],
    defaultModelId: 'custom/model',
  };

  const next = resolveModelSettingsUpdate(current, {
    customModels: [...current.customModels, { id: 'other/model' }],
  });

  assert.deepEqual(next, {
    customModels: [{ id: 'custom/model' }, { id: 'other/model' }],
    defaultModelId: 'custom/model',
  });
});

test('resolveModelSettingsUpdate normalizes duplicate custom models and stale defaults', () => {
  const next = resolveModelSettingsUpdate(defaultModelSettings, {
    customModels: [{ id: ' custom/model ' }, { id: 'custom/model' }, { id: 'bad model' }],
    defaultModelId: 'missing/model',
  });

  assert.deepEqual(next, {
    customModels: [{ id: 'custom/model' }],
    defaultModelId: '__default',
  });
});

test('resolveShortcutSettingsUpdate normalizes shortcuts and supports clearing actions', () => {
  const next = resolveShortcutSettingsUpdate(defaultShortcutSettings, {
    newChat: ' Ctrl + Alt + N ',
    toggleSearch: null,
    composerSend: 'modEnter',
  });

  assert.deepEqual(next, {
    ...defaultShortcutSettings,
    newChat: 'ctrl+alt+n',
    toggleSearch: null,
    composerSend: 'modEnter',
  });
});

test('resolveOpenWithSettingsUpdate normalizes selected target and custom tools', () => {
  const next = resolveOpenWithSettingsUpdate(defaultOpenWithSettings, {
    selectedTargetId: ' custom-editor ',
    customTargets: [
      {
        id: ' custom-editor ',
        label: ' Custom Editor ',
        kind: 'command',
        command: ' C:\\Tools\\editor.exe ',
        args: [' --reuse-window '],
      },
    ],
  });

  assert.deepEqual(next, {
    selectedTargetId: 'custom-editor',
    customTargets: [
      {
        id: 'custom-editor',
        label: 'Custom Editor',
        kind: 'command',
        command: 'C:\\Tools\\editor.exe',
        args: ['--reuse-window'],
      },
    ],
  });
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

  firstSave.resolve({ appearance: firstAppearance } as AppSettings);
  await waitForMicrotasks();

  assert.deepEqual(appliedPayloads, []);
  assert.deepEqual(savedPayloads.map((appearance) => appearance.themeMode), ['light', 'dark']);

  secondSave.resolve({ appearance: latestAppearance } as AppSettings);
  await waitForMicrotasks();

  assert.deepEqual(appliedPayloads, [{ appearance: latestAppearance } as AppSettings]);
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

  secondSave.resolve({ appearance: latestAppearance } as AppSettings);
  await waitForMicrotasks();

  assert.deepEqual(appliedPayloads, [{ appearance: latestAppearance } as AppSettings]);
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
