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
  findAvailablePort: findPort = findAvailablePort,
} = {}) {
  const session = await readSessionState();
  const sessionReady = await getSessionPortsIfReady(session, checkPort);
  if (sessionReady) {
    return {
      backendPort: sessionReady.backendPort,
      webPort: sessionReady.webPort,
      shouldStartDevServer: false,
    };
  }

  const preferredPortsReady = await Promise.all([
    checkPort(preferredPort),
    checkPort(preferredWebPort),
  ]);
  if (preferredPortsReady.every(Boolean)) {
    return {
      backendPort: preferredPort,
      webPort: preferredWebPort,
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

async function getSessionPortsIfReady(session, checkPort) {
  if (!session || !Number.isInteger(session.backendPort) || !Number.isInteger(session.webPort)) {
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
