#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const SHARED_CHECKS = [
  { command: 'node', reason: 'Node.js runtime' },
  { command: 'npm', reason: 'frontend package manager' },
  { command: 'cargo', reason: 'Rust build toolchain' },
  { command: 'rustc', reason: 'Rust compiler' },
  { command: 'tauri', reason: 'Tauri CLI' },
];

const LINUX_CHECKS = [
  { command: 'pkg-config', reason: 'Linux native dependency discovery' },
  { command: 'patchelf', reason: 'Linux bundle patching for AppImage' },
];

export function collectDoctorChecks(runtime = process) {
  if (runtime.platform === 'linux') {
    return [...SHARED_CHECKS, ...LINUX_CHECKS];
  }
  return [...SHARED_CHECKS];
}

export function getMissingDoctorChecks(checks, hasCommand = commandExists) {
  return checks.filter((check) => !hasCommand(check.command));
}

function commandExists(command) {
  if (command === 'tauri') {
    const localTauri = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri');
    if (existsSync(localTauri)) {
      return true;
    }
  }

  const checker = process.platform === 'win32' ? 'where' : 'command';
  const args = process.platform === 'win32' ? [command] : ['-v', command];
  const result = spawnSync(checker, args, { shell: process.platform !== 'win32', stdio: 'ignore' });
  return result.status === 0;
}

function printInstallHint() {
  if (process.platform === 'linux') {
    console.log('Ubuntu/Debian: sudo apt-get install -y pkg-config patchelf libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev');
    console.log('Fedora: sudo dnf install pkgconf-pkg-config patchelf webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel');
    return;
  }

  if (process.platform === 'darwin') {
    console.log('macOS: install Node.js, Rust, and Tauri CLI. Universal builds may require additional Rust targets.');
    return;
  }

  if (process.platform === 'win32') {
    console.log('Windows: install Node.js, Rust MSVC toolchain, and Tauri CLI.');
  }
}

function main() {
  const missing = getMissingDoctorChecks(collectDoctorChecks());
  if (missing.length === 0) {
    console.log('Doctor: OK');
    return;
  }

  console.log('Doctor: missing build dependencies:');
  for (const check of missing) {
    console.log(`- ${check.command}: ${check.reason}`);
  }
  printInstallHint();
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
