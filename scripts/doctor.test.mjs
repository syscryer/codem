import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectDoctorChecks,
  getMissingDoctorChecks,
} from './doctor.mjs';

test('collectDoctorChecks includes the shared desktop build tools', () => {
  const checks = collectDoctorChecks({ platform: 'win32' }).map((check) => check.command);

  assert.deepEqual(checks.slice(0, 3), ['node', 'npm', 'cargo']);
  assert.ok(checks.includes('tauri'));
});

test('collectDoctorChecks includes Linux packaging dependencies only on Linux', () => {
  const linuxChecks = collectDoctorChecks({ platform: 'linux' }).map((check) => check.command);
  const windowsChecks = collectDoctorChecks({ platform: 'win32' }).map((check) => check.command);

  assert.ok(linuxChecks.includes('pkg-config'));
  assert.ok(linuxChecks.includes('patchelf'));
  assert.ok(!windowsChecks.includes('pkg-config'));
  assert.ok(!windowsChecks.includes('patchelf'));
});

test('getMissingDoctorChecks reports unavailable commands', () => {
  const missing = getMissingDoctorChecks(
    [
      { command: 'node', reason: 'Node.js runtime' },
      { command: 'pkg-config', reason: 'Linux native dependency discovery' },
    ],
    (command) => command === 'node',
  );

  assert.deepEqual(missing, [{ command: 'pkg-config', reason: 'Linux native dependency discovery' }]);
});

test('getMissingDoctorChecks accepts injected command availability for local CLIs', () => {
  const missing = getMissingDoctorChecks(
    [{ command: 'tauri', reason: 'Tauri CLI' }],
    (command) => command === 'tauri',
  );

  assert.deepEqual(missing, []);
});
