import { spawn } from 'node:child_process';
import net from 'node:net';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const requiredPorts = [
  { name: 'backend', port: 3001 },
  { name: 'web', port: 5173 },
];

const children = new Set();

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  stopChildren();
  process.exit(1);
});

async function main() {
  const portsReady = await Promise.all(requiredPorts.map(({ port }) => isPortOpen(port)));
  const shouldStartDevServer = portsReady.some((ready) => !ready);

  if (shouldStartDevServer) {
    const missing = requiredPorts
      .filter((_, index) => !portsReady[index])
      .map(({ name, port }) => `${name}:${port}`)
      .join(', ');
    console.log(`Starting CodeM dev services because these ports are not ready: ${missing}`);
    spawnChild(npmCommand, ['run', 'dev']);
    await Promise.all(requiredPorts.map(({ port }) => waitForPort(port, 60_000)));
  } else {
    console.log('Reusing existing CodeM dev services on 3001 and 5173.');
  }

  const tauri = spawnChild(npmCommand, ['run', 'desktop:shell']);
  tauri.on('exit', (code) => {
    stopChildren(tauri);
    process.exit(code ?? 0);
  });
}

function spawnChild(command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

function stopChildren(except) {
  for (const child of children) {
    if (child === except || child.killed) {
      continue;
    }
    child.kill();
  }
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(port)) {
      return;
    }
    await delay(400);
  }
  throw new Error(`Timed out waiting for port ${port}.`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
