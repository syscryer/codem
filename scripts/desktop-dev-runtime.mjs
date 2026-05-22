import {
  DEFAULT_WEB_PORT,
  findAvailablePort,
  isPortOpen,
} from './dev-ports.mjs';
import { readDevSessionState } from './dev-session.mjs';

export async function resolveDesktopDevPorts({
  preferredPort,
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
    checkPort(DEFAULT_WEB_PORT),
  ]);
  if (preferredPortsReady.every(Boolean)) {
    return {
      backendPort: preferredPort,
      webPort: DEFAULT_WEB_PORT,
      shouldStartDevServer: false,
    };
  }

  const backendPort = await findPort(preferredPort);
  return {
    backendPort,
    webPort: DEFAULT_WEB_PORT,
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
