import { spawn } from 'node:child_process';
import {
  buildDevServerEnv,
  findAvailablePort,
  resolvePreferredBackendPort,
  resolvePreferredWebPort,
} from './dev-ports.mjs';
import { clearDevSessionState, writeDevSessionState } from './dev-session.mjs';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = new Set();

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await stopChildren();
  process.exit(1);
});

registerSignalHandlers();

async function main() {
  const preferredPort = resolvePreferredBackendPort();
  const preferredWebPort = resolvePreferredWebPort();
  const backendPort = await findAvailablePort(preferredPort);
  const webPort = await findAvailablePort(preferredWebPort);
  const childEnv = buildDevServerEnv(process.env, { backendPort, webPort });

  await writeDevSessionState(process.cwd(), {
    backendPort,
    webPort,
    pid: process.pid,
  });

  if (backendPort !== preferredPort) {
    console.log(`Backend port ${preferredPort} is unavailable; using ${backendPort}.`);
  } else {
    console.log(`Using backend port ${backendPort}.`);
  }
  if (webPort !== preferredWebPort) {
    console.log(`Web port ${preferredWebPort} is unavailable; using ${webPort}.`);
  } else {
    console.log(`Using web port ${webPort}.`);
  }
  console.log(`Web dev server will proxy /api to http://127.0.0.1:${backendPort}.`);

  const server = spawnChild(npmCommand, ['run', 'dev:server'], childEnv);
  const web = spawnChild(npmCommand, ['run', 'dev:web'], childEnv);

  server.on('exit', async (code) => {
    await stopChildren(server);
    process.exit(code ?? 0);
  });
  web.on('exit', async (code) => {
    await stopChildren(web);
    process.exit(code ?? 0);
  });

  console.log(`Expected local web URL: http://127.0.0.1:${webPort}/`);
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

async function stopChildren(except) {
  for (const child of children) {
    if (child === except || child.killed) {
      continue;
    }
    child.kill();
  }
  await clearDevSessionState(process.cwd());
}

function registerSignalHandlers() {
  const shutdown = async (exitCode) => {
    await stopChildren();
    process.exit(exitCode);
  };

  process.once('SIGINT', () => void shutdown(130));
  process.once('SIGTERM', () => void shutdown(143));
}
