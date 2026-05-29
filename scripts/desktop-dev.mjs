import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildDevServerEnv,
  resolvePreferredBackendPort,
  resolvePreferredWebPort,
  waitForPort,
} from './dev-ports.mjs';
import { resolveDesktopDevPorts } from './desktop-dev-runtime.mjs';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const children = new Set();

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  stopChildren();
  process.exit(1);
});

async function main() {
  const preferredPort = resolvePreferredBackendPort();
  const preferredWebPort = resolvePreferredWebPort();
  const resolved = await resolveDesktopDevPorts({ preferredPort, preferredWebPort });
  const childEnv = buildDevServerEnv(process.env, {
    backendPort: resolved.backendPort,
    webPort: resolved.webPort,
  });
  const requiredPorts = [
    { name: 'backend', port: resolved.backendPort },
    { name: 'web', port: resolved.webPort },
  ];

  if (resolved.shouldStartDevServer) {
    console.log(
      `Starting CodeM dev services on backend:${resolved.backendPort} and web:${resolved.webPort}.`,
    );
    spawnChild(npmCommand, ['run', 'dev'], childEnv);
    await Promise.all(requiredPorts.map(({ port }) => waitForPort(port, 60_000)));
  } else {
    console.log(
      `Reusing existing CodeM dev services on backend:${resolved.backendPort} and web:${resolved.webPort}.`,
    );
  }

  const tauriConfigPath = writeTauriDevConfig(resolved.webPort);
  const tauri = spawnChild(npmCommand, ['run', 'desktop:shell', '--', '--config', tauriConfigPath], childEnv);
  tauri.on('exit', (code) => {
    cleanupTauriDevConfig(tauriConfigPath);
    stopChildren(tauri);
    process.exit(code ?? 0);
  });
}

function spawnChild(command, args, env = process.env) {
  const child = spawn(resolveSpawnCommand(command), resolveSpawnArgs(command, args), {
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

function resolveSpawnCommand(command) {
  return process.platform === 'win32' && command.endsWith('.cmd') ? 'cmd.exe' : command;
}

function resolveSpawnArgs(command, args) {
  return process.platform === 'win32' && command.endsWith('.cmd')
    ? ['/d', '/s', '/c', command, ...args]
    : args;
}

function stopChildren(except) {
  for (const child of children) {
    if (child === except || child.killed) {
      continue;
    }
    child.kill();
  }
}

function writeTauriDevConfig(webPort) {
  const configPath = path.join(process.cwd(), `.codem-tauri-dev-${process.pid}.json`);
  writeFileSync(
    configPath,
    JSON.stringify({ build: { devUrl: `http://127.0.0.1:${webPort}` } }, null, 2),
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
