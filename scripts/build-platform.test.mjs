import test from 'node:test';
import assert from 'node:assert/strict';

import {
  expandPlatformSelection,
  getBuildPlan,
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

test('getBuildPlan returns explicit Tauri commands for each supported target', () => {
  assert.deepEqual(getBuildPlan('win-x64').command, [
    'npm',
    ['run', 'desktop:build', '--', '--bundles', 'nsis,msi'],
  ]);
  assert.deepEqual(getBuildPlan('mac-arm64').command, [
    'npm',
    ['run', 'desktop:build', '--', '--target', 'aarch64-apple-darwin', '--bundles', 'app,dmg'],
  ]);
  assert.deepEqual(getBuildPlan('mac-x64').command, [
    'npm',
    ['run', 'desktop:build', '--', '--target', 'x86_64-apple-darwin', '--bundles', 'app,dmg'],
  ]);
  assert.deepEqual(getBuildPlan('mac-universal').command, [
    'npm',
    ['run', 'desktop:build', '--', '--target', 'universal-apple-darwin', '--bundles', 'app,dmg'],
  ]);
  assert.deepEqual(getBuildPlan('linux-x64').command, [
    'npm',
    ['run', 'desktop:build', '--', '--target', 'x86_64-unknown-linux-gnu', '--bundles', 'deb,rpm,appimage'],
  ]);
});

test('getBuildPlan rejects unsupported targets with a helpful message', () => {
  assert.throws(() => getBuildPlan('linux-arm64'), /Unsupported platform target: linux-arm64/);
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
