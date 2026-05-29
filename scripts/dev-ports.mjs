import net from 'node:net';

export const DEFAULT_BACKEND_PORT = 3001;
export const DEFAULT_WEB_PORT = 5173;

export function resolvePreferredBackendPort(env = process.env) {
  return normalizePort(env.CODEM_BACKEND_PORT ?? env.PORT, DEFAULT_BACKEND_PORT);
}

export function resolvePreferredWebPort(env = process.env) {
  return normalizePort(env.CODEM_WEB_PORT, DEFAULT_WEB_PORT);
}

export async function findAvailablePort(preferredPort, options = {}) {
  const maxAttempts = options.maxAttempts ?? 2000;
  const isAvailable = options.isAvailable ?? canBindPort;
  const startPort = normalizePort(preferredPort, DEFAULT_BACKEND_PORT);

  for (let index = 0; index < maxAttempts; index += 1) {
    const candidate = startPort + index;
    if (candidate > 65535) {
      break;
    }
    if (await isAvailable(candidate)) {
      return candidate;
    }
  }

  throw new Error(`No available backend port found starting from ${startPort}.`);
}

export function buildBackendPortEnv(env, port) {
  return {
    ...env,
    CODEM_BACKEND_PORT: String(normalizePort(port, DEFAULT_BACKEND_PORT)),
  };
}

export function buildDevServerEnv(env, { backendPort, webPort }) {
  return {
    ...buildBackendPortEnv(env, backendPort),
    CODEM_WEB_PORT: String(normalizePort(webPort, DEFAULT_WEB_PORT)),
  };
}

export function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
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

export async function waitForPort(port, timeoutMs, host = '127.0.0.1') {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(port, host)) {
      return;
    }
    await delay(400);
  }

  throw new Error(`Timed out waiting for port ${port}.`);
}

async function canBindPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

function normalizePort(value, fallback) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fallback;
  }

  return port;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
