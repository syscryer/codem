import { isTauriRuntime } from './window-material';

export async function pickDesktopDirectory(initialPath?: string) {
  if (!isTauriRuntime()) {
    return undefined;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const selectedPath = await invoke<string | null>('pick_directory', {
      initialPath: initialPath?.trim() || null,
    });
    return typeof selectedPath === 'string' && selectedPath.trim() ? selectedPath : null;
  } catch {
    return undefined;
  }
}
