import { homedir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

export const DEFAULT_BACKEND_PORT = 3001;
export const DEFAULT_WEB_PORT = 5173;
export const APP_DATA_DIR_ENV = 'CODEM_APP_DATA_DIR';
export const DEV_APP_DATA_DIR_ENV = 'CODEM_DEV_APP_DATA_DIR';

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
    [APP_DATA_DIR_ENV]: resolveDevAppDataDirectory(env),
  };
}

export function resolveDevAppDataDirectory(env = process.env, platform = process.platform) {
  const explicitDirectory = normalizeDirectory(env[APP_DATA_DIR_ENV]);
  if (explicitDirectory) {
    return explicitDirectory;
  }

  const devDirectory = normalizeDirectory(env[DEV_APP_DATA_DIR_ENV]);
  if (devDirectory) {
    return devDirectory;
  }

  const homeDirectory = normalizeDirectory(env.HOME) || normalizeDirectory(env.USERPROFILE) || homedir();
  if (platform === 'darwin') {
    return path.join(homeDirectory, 'Library', 'Application Support', 'com.mnl.codem.dev', 'data');
  }
  if (platform === 'win32') {
    const baseDirectory =
      normalizeDirectory(env.LOCALAPPDATA) ||
      normalizeDirectory(env.APPDATA) ||
      path.join(homeDirectory, 'AppData', 'Local');
    return path.join(baseDirectory, 'CodeM Dev');
  }
  if (platform === 'linux') {
    const baseDirectory = normalizeDirectory(env.XDG_DATA_HOME) || path.join(homeDirectory, '.local', 'share');
    return path.join(baseDirectory, 'codem-dev');
  }

  return path.join(homeDirectory, '.codem-dev');
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

function normalizeDirectory(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
