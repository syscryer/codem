import { spawn } from 'node:child_process';
import {
  DEFAULT_WEB_PORT,
  buildBackendPortEnv,
  findAvailablePort,
  resolvePreferredBackendPort,
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

  if (backendPort !== preferredPort) {
    console.log(`Backend port ${preferredPort} is unavailable; using ${backendPort}.`);
  } else {
    console.log(`Using backend port ${backendPort}.`);
  }
  console.log(`Web dev server will proxy /api to http://127.0.0.1:${backendPort}.`);

  const server = spawnChild(npmCommand, ['run', 'dev:server'], childEnv);
  const web = spawnChild(npmCommand, ['run', 'dev:web'], childEnv);

  server.on('exit', (code) => {
    stopChildren(server);
    process.exit(code ?? 0);
  });
  web.on('exit', (code) => {
    stopChildren(web);
    process.exit(code ?? 0);
  });

  console.log(`Expected local web URL: http://127.0.0.1:${DEFAULT_WEB_PORT}/`);
}

function spawnChild(command, args, env) {
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
