import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildDevServerEnv,
  findAvailablePort,
  resolvePreferredBackendPort,
  resolvePreferredWebPort,
  waitForPort,
} from './dev-ports.mjs';

const viteCliPath = resolvePackageFile('vite/bin/vite.js');
const tauriCliPath = resolvePackageFile('@tauri-apps/cli/tauri.js');

const children = new Set();
let activeTauriConfigPath = null;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  stopChildren();
  process.exit(1);
});

registerSignalHandlers();

async function main() {
  cleanupStaleDesktopDevArtifacts();

  const preferredBackendPort = resolvePreferredBackendPort();
  const preferredWebPort = resolvePreferredWebPort();
  const backendPort = await findAvailablePort(preferredBackendPort);
  const webPort = await findAvailablePort(preferredWebPort);
  const childEnv = buildDevServerEnv(process.env, {
    backendPort,
    webPort,
  });

  console.log(`Starting CodeM desktop dev on rust-backend:${backendPort} and web:${webPort}.`);
  spawnChild(process.execPath, [viteCliPath], childEnv);
  await waitForPort(webPort, 60_000);

  const tauriConfigPath = writeTauriDevConfig(webPort);
  activeTauriConfigPath = tauriConfigPath;
  const tauri = spawnChild(process.execPath, [tauriCliPath, 'dev', '--config', tauriConfigPath], childEnv);
  tauri.on('exit', (code) => {
    cleanupTauriDevConfig(tauriConfigPath);
    activeTauriConfigPath = null;
    stopChildren(tauri);
    process.exit(code ?? 0);
  });
}

function spawnChild(command, args, env = process.env) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout?.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

function stopChildren(except) {
  for (const child of children) {
    if (child === except || child.killed) {
      continue;
    }
    killProcessTree(child);
  }
}

function killProcessTree(child) {
  if (!child.pid) {
    return;
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  child.kill();
}

function writeTauriDevConfig(webPort) {
  const configDir = tauriDevConfigDir();
  mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, `tauri-dev-${process.pid}.json`);
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        productName: 'CodeM Dev',
        identifier: 'com.mnl.codem.dev',
        build: { devUrl: `http://127.0.0.1:${webPort}` },
      },
      null,
      2,
    ),
    'utf8',
  );
  return configPath;
}

function cleanupTauriDevConfig(configPath) {
  try {
    rmSync(configPath, { force: true });
  } catch {
    // 临时启动配置清理失败不影响开发服务退出。
  }
}

function resolvePackageFile(packagePath) {
  return path.join(process.cwd(), 'node_modules', ...packagePath.split('/'));
}

function cleanupStaleDesktopDevArtifacts() {
  cleanupStaleWorkspaceDesktopProcess();
  cleanupTauriDevConfigDirectory();
  cleanupLegacyWorkspaceTauriDevConfigs();
}

function cleanupStaleWorkspaceDesktopProcess() {
  if (process.platform !== 'win32') {
    return;
  }

  const targetExe = path.join(process.cwd(), 'src-tauri', 'target', 'debug', 'codem.exe');
  const escapedTarget = targetExe.replaceAll("'", "''");
  const command = `$target = '${escapedTarget}'; Get-CimInstance Win32_Process -Filter "name = 'codem.exe'" | Where-Object { $_.ExecutablePath -ieq $target } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;

  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

function cleanupTauriDevConfigDirectory() {
  const configDir = tauriDevConfigDir();
  for (const entry of safeReadDir(configDir)) {
    if (!entry.startsWith('tauri-dev-') || !entry.endsWith('.json')) {
      continue;
    }
    cleanupTauriDevConfig(path.join(configDir, entry));
  }
}

function cleanupLegacyWorkspaceTauriDevConfigs() {
  for (const entry of safeReadDir(process.cwd())) {
    if (!entry.startsWith('.codem-tauri-dev-') || !entry.endsWith('.json')) {
      continue;
    }
    cleanupTauriDevConfig(path.join(process.cwd(), entry));
  }
}

function safeReadDir(directory) {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

function tauriDevConfigDir() {
  return path.join(os.tmpdir(), 'codem-tauri-dev');
}

function registerSignalHandlers() {
  const shutdown = (exitCode) => {
    stopChildren();
    if (activeTauriConfigPath) {
      cleanupTauriDevConfig(activeTauriConfigPath);
      activeTauriConfigPath = null;
    }
    process.exit(exitCode);
  };

  process.once('SIGINT', () => shutdown(130));
  process.once('SIGTERM', () => shutdown(143));
}
