import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

test('getAppSettings falls back to defaults when settings JSON is damaged', () => {
  withTemporaryDirectory((directory) => {
    writeFileSync(path.join(directory, 'settings.json'), '{ damaged json', 'utf8');
    const store = createSettingsStore(directory);

    assert.deepEqual(store.getAppSettings(), defaultAppSettings);
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
