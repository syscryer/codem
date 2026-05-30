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

export async function pickDesktopFiles(initialPath?: string): Promise<string[] | undefined> {
  if (!isTauriRuntime()) {
    return undefined;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const selectedPaths = await invoke<string[] | null>('pick_files', {
      initialPath: initialPath?.trim() || null,
    });
    return Array.isArray(selectedPaths)
      ? selectedPaths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
  } catch {
    return undefined;
  }
}
