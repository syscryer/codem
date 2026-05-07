export type PtyEnsureRequest = {
  terminalTabId: string;
  cwd: string | null;
  cols: number;
  rows: number;
};

export type PtyOutputEvent = {
  terminalTabId: string;
  data: string;
  stream: string;
};

export function isTerminalBridgeAvailable() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function ensurePtySession(request: PtyEnsureRequest) {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('ensure_pty_session', { request });
}

export async function writePtyInput(request: { terminalTabId: string; data: string }) {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('write_pty_input', { request });
}

export async function resizePtySession(request: { terminalTabId: string; cols: number; rows: number }) {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('resize_pty_session', { request });
}

export async function closePtySession(terminalTabId: string) {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('close_pty_session', { terminalTabId });
}

export async function onPtyOutput(listener: (event: PtyOutputEvent) => void) {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<PtyOutputEvent>('pty-output', (event) => {
    listener(event.payload);
  });
}
