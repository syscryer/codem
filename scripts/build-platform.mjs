#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

import {
  DEFAULT_RUNTIME_FLAVOR,
  RUNTIME_ENV_NAME,
  flavorToMode,
  normalizeRuntimeFlavor,
} from './runtime-flavor.mjs';

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
const CREATE_UPDATER_ARTIFACTS_ENV = 'CODEM_CREATE_UPDATER_ARTIFACTS';
const CREATE_UPDATER_ARTIFACTS_CONFIG = JSON.stringify({
  bundle: {
    createUpdaterArtifacts: true,
  },
});

function createRuntimeContext(flavor = DEFAULT_RUNTIME_FLAVOR) {
  const runtimeFlavor = normalizeRuntimeFlavor(flavor);
  return {
    flavor: runtimeFlavor,
    runtimeMode: flavorToMode(runtimeFlavor),
  };
}

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

export function createBuildContext(targets, flavor = DEFAULT_RUNTIME_FLAVOR) {
  const runtimeContext = createRuntimeContext(flavor);
  return {
    targets,
    ...runtimeContext,
  };
}

export function getBuildPlan(target, contextOrFlavor = DEFAULT_RUNTIME_FLAVOR) {
  const plan = SUPPORTED_TARGETS.get(target);
  if (!plan) {
    throw new Error(`Unsupported platform target: ${target}`);
  }

  const runtimeContext =
    typeof contextOrFlavor === 'object' && contextOrFlavor !== null
      ? createRuntimeContext(contextOrFlavor.flavor)
      : createRuntimeContext(contextOrFlavor);

  return {
    ...plan,
    runtimeFlavor: runtimeContext.flavor,
    runtimeMode: runtimeContext.runtimeMode,
  };
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

function createSpawnOptions(plan, runtime = process) {
  return {
    cwd: runtime.cwd(),
    env: {
      ...runtime.env,
      [RUNTIME_ENV_NAME]: plan.runtimeMode,
    },
    shell: false,
    stdio: 'inherit',
  };
}

export function runPlan(
  target,
  contextOrFlavor = DEFAULT_RUNTIME_FLAVOR,
  { runtime = process, spawn = spawnSync } = {},
) {
  const plan = getBuildPlan(target, contextOrFlavor);
  const [command, args] = plan.command;
  const buildArgs = [...args, ...updaterArtifactsArgs(runtime)];
  console.log(`\nBuilding ${plan.label}...`);
  console.log(`> ${command} ${buildArgs.join(' ')}`);

  const invocation = resolveSpawnInvocation(command, buildArgs, runtime);
  const result = spawn(invocation.command, invocation.args, createSpawnOptions(plan, runtime));

  if (result.status !== 0) {
    runtime.exit(result.status ?? 1);
  }
}

function updaterArtifactsArgs(runtime = process) {
  return runtime.env?.[CREATE_UPDATER_ARTIFACTS_ENV] === '1'
    ? ['--config', CREATE_UPDATER_ARTIFACTS_CONFIG]
    : [];
}

function main() {
  const selection = process.argv[2] ?? 'all';
  const flavor = process.argv[3] ?? DEFAULT_RUNTIME_FLAVOR;
  const targets = expandPlatformSelection(selection);
  const context = createBuildContext(targets, flavor);
  for (const target of context.targets) {
    runPlan(target, context);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
