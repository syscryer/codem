import { spawn } from 'node:child_process';
import {
  DEFAULT_WEB_PORT,
  buildBackendPortEnv,
  findAvailablePort,
  isPortOpen,
  resolvePreferredBackendPort,
  waitForPort,
} from './dev-ports.mjs';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const children = new Set();

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  stopChildren();
  process.exit(1);
});

async function main() {
  const preferredPort = resolvePreferredBackendPort();
  const backendPort = await findAvailablePort(preferredPort);
  const childEnv = buildBackendPortEnv(process.env, backendPort);
  const requiredPorts = [
    { name: 'backend', port: backendPort },
    { name: 'web', port: DEFAULT_WEB_PORT },
  ];
  const portsReady = await Promise.all(requiredPorts.map(({ port }) => isPortOpen(port)));
  const shouldStartDevServer = portsReady.some((ready) => !ready);

  if (shouldStartDevServer) {
    const missing = requiredPorts
      .filter((_, index) => !portsReady[index])
      .map(({ name, port }) => `${name}:${port}`)
      .join(', ');
    console.log(`Starting CodeM dev services because these ports are not ready: ${missing}`);
    spawnChild(npmCommand, ['run', 'dev'], childEnv);
    await Promise.all(requiredPorts.map(({ port }) => waitForPort(port, 60_000)));
  } else {
    console.log(`Reusing existing CodeM dev services on ${backendPort} and ${DEFAULT_WEB_PORT}.`);
  }

  const tauri = spawnChild(npmCommand, ['run', 'desktop:shell'], childEnv);
  tauri.on('exit', (code) => {
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
