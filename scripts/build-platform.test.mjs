import test from 'node:test';
import assert from 'node:assert/strict';
import { RUNTIME_ENV_NAME } from './runtime-flavor.mjs';

import {
  createBuildContext,
  expandPlatformSelection,
  getBuildPlan,
  runPlan,
  resolveSpawnInvocation,
} from './build-platform.mjs';

test('expandPlatformSelection maps all to the current operating system targets', () => {
  assert.deepEqual(expandPlatformSelection('all', { platform: 'win32', arch: 'x64' }), ['win-x64']);
  assert.deepEqual(expandPlatformSelection('all', { platform: 'linux', arch: 'x64' }), ['linux-x64']);
  assert.deepEqual(expandPlatformSelection('all', { platform: 'darwin', arch: 'arm64' }), [
    'mac-arm64',
    'mac-universal',
  ]);
});

test('createBuildContext uses the default runtime flavor when flavor is omitted', () => {
  assert.deepEqual(createBuildContext(['win-x64'], undefined), {
    targets: ['win-x64'],
    flavor: 'rust',
    runtimeMode: 'rust',
  });
});

test('getBuildPlan returns explicit Tauri commands for each supported target', () => {
  assert.deepEqual(getBuildPlan('win-x64', 'rust').command, [
    'npm',
    ['run', 'desktop:build', '--', '--bundles', 'nsis,msi'],
  ]);
  assert.deepEqual(getBuildPlan('mac-arm64', 'rust').command, [
    'npm',
    ['run', 'desktop:build', '--', '--target', 'aarch64-apple-darwin', '--bundles', 'app,dmg'],
  ]);
  assert.deepEqual(getBuildPlan('mac-x64', 'rust').command, [
    'npm',
    ['run', 'desktop:build', '--', '--target', 'x86_64-apple-darwin', '--bundles', 'app,dmg'],
  ]);
  assert.deepEqual(getBuildPlan('mac-universal', 'rust').command, [
    'npm',
    ['run', 'desktop:build', '--', '--target', 'universal-apple-darwin', '--bundles', 'app,dmg'],
  ]);
  assert.deepEqual(getBuildPlan('linux-x64', 'rust').command, [
    'npm',
    ['run', 'desktop:build', '--', '--target', 'x86_64-unknown-linux-gnu', '--bundles', 'deb,rpm,appimage'],
  ]);
});

test('getBuildPlan adds runtime flavor metadata for rust packaging', () => {
  assert.deepEqual(getBuildPlan('linux-x64', 'rust'), {
    label: 'Linux x64',
    command: [
      'npm',
      ['run', 'desktop:build', '--', '--target', 'x86_64-unknown-linux-gnu', '--bundles', 'deb,rpm,appimage'],
    ],
    runtimeFlavor: 'rust',
    runtimeMode: 'rust',
  });
});

test('getBuildPlan rejects unsupported targets with a helpful message', () => {
  assert.throws(() => getBuildPlan('linux-arm64', 'rust'), /Unsupported platform target: linux-arm64/);
});

test('runPlan passes the normalized runtime mode into spawnSync env', () => {
  let capturedOptions;
  const context = createBuildContext(['linux-x64'], 'rust');

  runPlan('linux-x64', context, {
    runtime: {
      cwd: () => 'D:\\cursor_project\\codem',
      env: {
        PATH: 'fake-path',
      },
      exit: () => {
        throw new Error('runPlan should not exit on successful fake spawn');
      },
    },
    spawn: (_command, _args, options) => {
      capturedOptions = options;
      return { status: 0 };
    },
  });

  assert.equal(capturedOptions.env[RUNTIME_ENV_NAME], 'rust');
  assert.equal(capturedOptions.env.PATH, 'fake-path');
});

test('runPlan appends updater artifact config only when release signing is enabled', () => {
  let capturedArgs;
  const context = createBuildContext(['win-x64'], 'rust');

  runPlan('win-x64', context, {
    runtime: {
      cwd: () => 'D:\\cursor_project\\codem',
      env: {
        CODEM_CREATE_UPDATER_ARTIFACTS: '1',
      },
      platform: 'linux',
      exit: () => {
        throw new Error('runPlan should not exit on successful fake spawn');
      },
    },
    spawn: (_command, args) => {
      capturedArgs = args;
      return { status: 0 };
    },
  });

  assert.deepEqual(capturedArgs.slice(-2), [
    '--config',
    '{"bundle":{"createUpdaterArtifacts":true}}',
  ]);
});

test('resolveSpawnInvocation runs npm through node on Windows when npm_execpath is available', () => {
  assert.deepEqual(
    resolveSpawnInvocation('npm', ['run', 'desktop:build'], {
      platform: 'win32',
      execPath: 'C:\\Program Files\\nodejs\\node.exe',
      env: {
        npm_execpath: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
      },
    }),
    {
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', 'run', 'desktop:build'],
    },
  );
});
