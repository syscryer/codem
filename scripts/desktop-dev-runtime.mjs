import {
  findAvailablePort,
  isPortOpen,
  resolvePreferredWebPort,
} from './dev-ports.mjs';
import { readDevSessionState } from './dev-session.mjs';

export async function resolveDesktopDevPorts({
  preferredPort,
  preferredWebPort = resolvePreferredWebPort(),
  readSessionState = () => readDevSessionState(process.cwd()),
  isPortOpen: checkPort = isPortOpen,
  isProcessAlive = defaultIsProcessAlive,
  findAvailablePort: findPort = findAvailablePort,
} = {}) {
  const session = await readSessionState();
  const sessionReady = await getSessionPortsIfReady(session, checkPort, isProcessAlive);
  if (sessionReady) {
    return {
      backendPort: sessionReady.backendPort,
      webPort: sessionReady.webPort,
      shouldStartDevServer: false,
    };
  }

  const [backendPort, webPort] = await Promise.all([
    findPort(preferredPort),
    findPort(preferredWebPort),
  ]);
  return {
    backendPort,
    webPort,
    shouldStartDevServer: true,
  };
}

async function getSessionPortsIfReady(session, checkPort, isProcessAlive) {
  if (
    !session ||
    !Number.isInteger(session.backendPort) ||
    !Number.isInteger(session.webPort) ||
    !Number.isInteger(session.pid) ||
    !(await isProcessAlive(session.pid))
  ) {
    return null;
  }

  const portsReady = await Promise.all([
    checkPort(session.backendPort),
    checkPort(session.webPort),
  ]);
  if (!portsReady.every(Boolean)) {
    return null;
  }

  return {
    backendPort: session.backendPort,
    webPort: session.webPort,
  };
}

async function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
