import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSettingsStore,
  defaultAppSettings,
  normalizeAppSettings,
} from './settings-store.js';

function withTemporaryDirectory<T>(callback: (directory: string) => T): T {
  const directory = mkdtempSync(path.join(tmpdir(), 'codem-settings-store-'));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('normalizeAppSettings preserves valid appearance values', () => {
  const settings = normalizeAppSettings({
    appearance: {
      themeMode: 'dark',
      density: 'compact',
      uiFontSize: 15,
      codeFontSize: 14,
      sidebarWidth: 'wide',
    },
  });

  assert.deepEqual(settings, {
    appearance: {
      themeMode: 'dark',
      density: 'compact',
      uiFontSize: 15,
      codeFontSize: 14,
      sidebarWidth: 'wide',
    },
  });
});

test('normalizeAppSettings falls back to defaults for invalid appearance values', () => {
  const settings = normalizeAppSettings({
    appearance: {
      themeMode: 'sepia',
      density: 'spacious',
      uiFontSize: 16,
      codeFontSize: 11,
      sidebarWidth: 'extra-wide',
    },
  });

  assert.deepEqual(settings, defaultAppSettings);
});

test('normalizeAppSettings falls back to defaults for non-object and array input', () => {
  assert.deepEqual(normalizeAppSettings(null), defaultAppSettings);
  assert.deepEqual(normalizeAppSettings('invalid'), defaultAppSettings);
  assert.deepEqual(normalizeAppSettings([]), defaultAppSettings);
});

test('importing settings store does not create the default app settings directory', () => {
  withTemporaryDirectory((directory) => {
    const localAppData = path.join(directory, 'appdata');
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '-e', "await import('./server/lib/settings-store.ts')"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          APPDATA: '',
          LOCALAPPDATA: localAppData,
        },
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(path.join(localAppData, 'CodeM')), false);
  });
});

test('getAppSettings falls back to defaults when settings JSON is damaged', () => {
  withTemporaryDirectory((directory) => {
    writeFileSync(path.join(directory, 'settings.json'), '{ damaged json', 'utf8');
    const store = createSettingsStore(directory);

    assert.deepEqual(store.getAppSettings(), defaultAppSettings);
  });
});

test('getAppSettings falls back to defaults when settings file is missing', () => {
  withTemporaryDirectory((directory) => {
    const store = createSettingsStore(directory);

    assert.deepEqual(store.getAppSettings(), defaultAppSettings);
  });
});

test('getAppSettings rethrows file system errors other than missing files', () => {
  withTemporaryDirectory((directory) => {
    const settingsPath = path.join(directory, 'settings.json');
    const store = createSettingsStore(directory);
    // Create a directory where the settings file should be so readFileSync fails
    // with a real filesystem error, not a missing-file error.
    mkdirSync(settingsPath);

    assert.throws(() => store.getAppSettings());
  });
});

test('getAppSettings fills defaults for missing appearance fields', () => {
  withTemporaryDirectory((directory) => {
    writeFileSync(
      path.join(directory, 'settings.json'),
      JSON.stringify({
        appearance: {
          themeMode: 'dark',
          uiFontSize: 15,
        },
      }),
      'utf8',
    );
    const store = createSettingsStore(directory);

    assert.deepEqual(store.getAppSettings(), {
      appearance: {
        ...defaultAppSettings.appearance,
        themeMode: 'dark',
        uiFontSize: 15,
      },
    });
  });
});

test('updateAppearanceSettings writes formatted JSON and can read it back', () => {
  withTemporaryDirectory((directory) => {
    const store = createSettingsStore(directory);

    const settings = store.updateAppearanceSettings({
      themeMode: 'light',
      density: 'compact',
      uiFontSize: 14,
      codeFontSize: 13,
      sidebarWidth: 'narrow',
    });

    const expected = {
      appearance: {
        themeMode: 'light',
        density: 'compact',
        uiFontSize: 14,
        codeFontSize: 13,
        sidebarWidth: 'narrow',
      },
    };
    const serialized = readFileSync(path.join(directory, 'settings.json'), 'utf8');

    assert.deepEqual(settings, expected);
    assert.equal(serialized, `${JSON.stringify(expected, null, 2)}\n`);
    assert.deepEqual(store.getAppSettings(), expected);
  });
});

test('updateAppearanceSettings recursively creates the settings directory', () => {
  withTemporaryDirectory((directory) => {
    const settingsDirectory = path.join(directory, 'nested', 'settings');
    const store = createSettingsStore(settingsDirectory);

    store.updateAppearanceSettings({
      themeMode: 'light',
    });

    assert.equal(existsSync(path.join(settingsDirectory, 'settings.json')), true);
  });
});

test('updateAppearanceSettings leaves no temporary settings files after rename', () => {
  withTemporaryDirectory((directory) => {
    const store = createSettingsStore(directory);

    store.updateAppearanceSettings({
      themeMode: 'light',
    });

    assert.deepEqual(
      readdirSync(directory).filter((fileName) => fileName.endsWith('.tmp')),
      [],
    );
  });
});
