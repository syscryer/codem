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

function assertDefaultStoreWritesToPath(
  environment: NodeJS.ProcessEnv,
  expectedSettingsPath: string,
) {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '-e',
      `
        const { existsSync, readFileSync } = await import('node:fs');
        const assert = await import('node:assert/strict');
        const { updateAppearanceSettings } = await import('./server/lib/settings-store.ts');

        updateAppearanceSettings({ themeMode: 'dark' });

        const settingsPath = ${JSON.stringify(expectedSettingsPath)};
        assert.default.equal(existsSync(settingsPath), true);
        assert.default.equal(
          JSON.parse(readFileSync(settingsPath, 'utf8')).appearance.themeMode,
          'dark',
        );
      `,
    ],
    {
      cwd: process.cwd(),
      env: environment,
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
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
    models: defaultAppSettings.models,
    shortcuts: defaultAppSettings.shortcuts,
    openWith: defaultAppSettings.openWith,
  });
});

test('normalizeAppSettings preserves valid model settings', () => {
  const settings = normalizeAppSettings({
    models: {
      customModels: [
        {
          id: 'anthropic/claude-sonnet-4.5',
          label: 'Sonnet',
          description: 'Primary model',
        },
      ],
      defaultModelId: 'anthropic/claude-sonnet-4.5',
    },
  });

  assert.deepEqual(settings.models, {
    customModels: [
      {
        id: 'anthropic/claude-sonnet-4.5',
        label: 'Sonnet',
        description: 'Primary model',
      },
    ],
    defaultModelId: 'anthropic/claude-sonnet-4.5',
  });
});

test('normalizeAppSettings preserves valid shortcuts and open-with settings', () => {
  const settings = normalizeAppSettings({
    shortcuts: {
      newChat: ' ctrl+alt+n ',
      toggleSearch: 'ctrl+shift+f',
      toggleDebug: null,
      composerSend: 'modEnter',
    },
    openWith: {
      selectedTargetId: ' custom-editor ',
      customTargets: [
        {
          id: ' custom-editor ',
          label: ' Custom Editor ',
          kind: 'command',
          command: ' C:\\Tools\\editor.exe ',
          args: [' --reuse-window ', 3, ''],
        },
      ],
    },
  });

  assert.deepEqual(settings.shortcuts, {
    newChat: 'ctrl+alt+n',
    toggleSearch: 'ctrl+shift+f',
    toggleDebug: null,
    composerSend: 'modEnter',
  });
  assert.deepEqual(settings.openWith, {
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

test('normalizeAppSettings falls back for invalid shortcuts and open-with settings', () => {
  const settings = normalizeAppSettings({
    shortcuts: {
      newChat: 'n',
      toggleSearch: 3,
      toggleDebug: 'shift',
      composerSend: 'bad',
    },
    openWith: {
      selectedTargetId: 'bad id',
      customTargets: [
        { id: '', label: 'Missing id', kind: 'command', command: 'x' },
        { id: 'x'.repeat(161), label: 'Long id', kind: 'command', command: 'x' },
        { id: 'ok', label: '', kind: 'command', command: 'x' },
        { id: 'bad-kind', label: 'Bad kind', kind: 'nope', command: 'x' },
      ],
    },
  });

  assert.deepEqual(settings.shortcuts, defaultAppSettings.shortcuts);
  assert.deepEqual(settings.openWith, defaultAppSettings.openWith);
});

test('updateShortcutSettings and updateOpenWithSettings write formatted JSON and can read it back', () => {
  withTemporaryDirectory((directory) => {
    const store = createSettingsStore(directory);

    store.updateShortcutSettings({
      newChat: 'ctrl+alt+n',
      toggleSearch: null,
      composerSend: 'modEnter',
    });
    const settings = store.updateOpenWithSettings({
      selectedTargetId: 'custom-editor',
      customTargets: [
        {
          id: 'custom-editor',
          label: 'Custom Editor',
          kind: 'command',
          command: 'custom-editor',
          args: ['--reuse-window'],
        },
      ],
    });

    const expected = {
      appearance: defaultAppSettings.appearance,
      models: defaultAppSettings.models,
      shortcuts: {
        ...defaultAppSettings.shortcuts,
        newChat: 'ctrl+alt+n',
        toggleSearch: null,
        composerSend: 'modEnter',
      },
      openWith: {
        selectedTargetId: 'custom-editor',
        customTargets: [
          {
            id: 'custom-editor',
            label: 'Custom Editor',
            kind: 'command',
            command: 'custom-editor',
            args: ['--reuse-window'],
          },
        ],
      },
    };
    const serialized = readFileSync(path.join(directory, 'settings.json'), 'utf8');

    assert.deepEqual(settings, expected);
    assert.equal(serialized, `${JSON.stringify(expected, null, 2)}\n`);
    assert.deepEqual(store.getAppSettings(), expected);
  });
});

test('normalizeAppSettings migrates legacy open-with settings', () => {
  assert.deepEqual(
    normalizeAppSettings({
      openWith: {
        target: 'cursor',
        customCommand: '',
        customArgs: '',
      },
    }).openWith,
    {
      selectedTargetId: 'cursor',
      customTargets: [],
    },
  );

  assert.deepEqual(
    normalizeAppSettings({
      openWith: {
        target: 'custom',
        customCommand: 'custom-editor',
        customArgs: '--reuse-window "--profile default"',
      },
    }).openWith,
    {
      selectedTargetId: 'custom',
      customTargets: [
        {
          id: 'custom',
          label: 'Custom',
          kind: 'command',
          command: 'custom-editor',
          args: ['--reuse-window', '--profile default'],
        },
      ],
    },
  );
});

test('normalizeAppSettings filters invalid and duplicate custom models', () => {
  const settings = normalizeAppSettings({
    models: {
      customModels: [
        { id: ' custom/model ' },
        { id: 'custom/model', label: 'Duplicate' },
        { id: 'has spaces' },
        { id: '' },
        { id: 'x'.repeat(161) },
        { id: 'provider/model:202604[beta]', label: '  Beta  ', description: '  Experimental  ' },
      ],
      defaultModelId: 'missing/model',
    },
  });

  assert.deepEqual(settings.models, {
    customModels: [
      { id: 'custom/model' },
      { id: 'provider/model:202604[beta]', label: 'Beta', description: 'Experimental' },
    ],
    defaultModelId: '__default',
  });
});

test('updateModelSettings writes formatted JSON and can read it back', () => {
  withTemporaryDirectory((directory) => {
    const store = createSettingsStore(directory);

    const settings = store.updateModelSettings({
      customModels: [{ id: 'custom/model' }],
      defaultModelId: 'custom/model',
    });

    const expected = {
      appearance: defaultAppSettings.appearance,
      models: {
        customModels: [{ id: 'custom/model' }],
        defaultModelId: 'custom/model',
      },
      shortcuts: defaultAppSettings.shortcuts,
      openWith: defaultAppSettings.openWith,
    };
    const serialized = readFileSync(path.join(directory, 'settings.json'), 'utf8');

    assert.deepEqual(settings, expected);
    assert.equal(serialized, `${JSON.stringify(expected, null, 2)}\n`);
    assert.deepEqual(store.getAppSettings(), expected);
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

test('default settings store writes under LOCALAPPDATA when it is set', () => {
  withTemporaryDirectory((directory) => {
    const localAppData = path.join(directory, 'local-app-data');
    const appData = path.join(directory, 'app-data');
    const home = path.join(directory, 'home');
    const expectedSettingsPath = path.join(localAppData, 'CodeM', 'settings.json');

    assertDefaultStoreWritesToPath(
      {
        ...process.env,
        LOCALAPPDATA: localAppData,
        APPDATA: appData,
        HOME: home,
        USERPROFILE: home,
      },
      expectedSettingsPath,
    );

    assert.equal(existsSync(expectedSettingsPath), true);
    assert.equal(existsSync(path.join(appData, 'CodeM', 'settings.json')), false);
  });
});

test('default settings store writes under APPDATA when LOCALAPPDATA is unset', () => {
  withTemporaryDirectory((directory) => {
    const appData = path.join(directory, 'app-data');
    const home = path.join(directory, 'home');
    const expectedSettingsPath = path.join(appData, 'CodeM', 'settings.json');

    assertDefaultStoreWritesToPath(
      {
        ...process.env,
        LOCALAPPDATA: '',
        APPDATA: appData,
        HOME: home,
        USERPROFILE: home,
      },
      expectedSettingsPath,
    );

    assert.equal(existsSync(expectedSettingsPath), true);
    assert.equal(existsSync(path.join(home, 'AppData', 'Local', 'CodeM', 'settings.json')), false);
  });
});

test('default settings store writes under homedir AppData Local when app data env vars are unset', () => {
  withTemporaryDirectory((directory) => {
    const home = path.join(directory, 'home');
    const expectedSettingsPath = path.join(home, 'AppData', 'Local', 'CodeM', 'settings.json');

    assertDefaultStoreWritesToPath(
      {
        ...process.env,
        LOCALAPPDATA: '',
        APPDATA: '',
        HOME: home,
        USERPROFILE: home,
      },
      expectedSettingsPath,
    );

    assert.equal(existsSync(expectedSettingsPath), true);
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
      models: defaultAppSettings.models,
      shortcuts: defaultAppSettings.shortcuts,
      openWith: defaultAppSettings.openWith,
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
      models: defaultAppSettings.models,
      shortcuts: defaultAppSettings.shortcuts,
      openWith: defaultAppSettings.openWith,
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

test('updateAppearanceSettings removes temporary settings files when rename fails', () => {
  withTemporaryDirectory((directory) => {
    const renameError = new Error('rename failed');
    const store = createSettingsStore(directory, {
      renameSync() {
        throw renameError;
      },
    });

    assert.throws(
      () => store.updateAppearanceSettings({ themeMode: 'dark' }),
      (error) => error === renameError,
    );
    assert.deepEqual(
      readdirSync(directory).filter((fileName) => fileName.endsWith('.tmp')),
      [],
    );
  });
});
