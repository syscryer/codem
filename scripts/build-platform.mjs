#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const SUPPORTED_TARGETS = new Map([
  [
    'win-x64',
    {
      label: 'Windows x64',
      command: ['npm', ['run', 'desktop:build', '--', '--bundles', 'nsis,msi']],
    },
  ],
  [
    'mac-arm64',
    {
      label: 'macOS Apple Silicon',
      command: ['npm', ['run', 'desktop:build', '--', '--target', 'aarch64-apple-darwin', '--bundles', 'app,dmg']],
    },
  ],
  [
    'mac-x64',
    {
      label: 'macOS Intel',
      command: ['npm', ['run', 'desktop:build', '--', '--target', 'x86_64-apple-darwin', '--bundles', 'app,dmg']],
    },
  ],
  [
    'mac-universal',
    {
      label: 'macOS Universal',
      command: ['npm', ['run', 'desktop:build', '--', '--target', 'universal-apple-darwin', '--bundles', 'app,dmg']],
    },
  ],
  [
    'linux-x64',
    {
      label: 'Linux x64',
      command: [
        'npm',
        ['run', 'desktop:build', '--', '--target', 'x86_64-unknown-linux-gnu', '--bundles', 'deb,rpm,appimage'],
      ],
    },
  ],
]);

export function expandPlatformSelection(selection, runtime = process) {
  if (selection !== 'all') {
    return [selection];
  }

  if (runtime.platform === 'win32') {
    return ['win-x64'];
  }
  if (runtime.platform === 'darwin') {
    return runtime.arch === 'arm64' ? ['mac-arm64', 'mac-universal'] : ['mac-x64'];
  }
  if (runtime.platform === 'linux') {
    return ['linux-x64'];
  }

  throw new Error(`Unsupported host platform: ${runtime.platform}`);
}

export function getBuildPlan(target) {
  const plan = SUPPORTED_TARGETS.get(target);
  if (!plan) {
    throw new Error(`Unsupported platform target: ${target}`);
  }
  return plan;
}

export function resolveSpawnInvocation(command, args, runtime = process) {
  if (runtime.platform === 'win32' && command === 'npm' && runtime.env?.npm_execpath) {
    return {
      command: runtime.execPath,
      args: [runtime.env.npm_execpath, ...args],
    };
  }

  return {
    command: runtime.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command,
    args,
  };
}

function runPlan(target) {
  const plan = getBuildPlan(target);
  const [command, args] = plan.command;
  console.log(`\nBuilding ${plan.label}...`);
  console.log(`> ${command} ${args.join(' ')}`);

  const invocation = resolveSpawnInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  const selection = process.argv[2] ?? 'all';
  const targets = expandPlatformSelection(selection);
  for (const target of targets) {
    runPlan(target);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
