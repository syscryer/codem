import type { WindowMaterialMode } from '../types';

const windowMaterialIds: Record<WindowMaterialMode, number> = {
  auto: 0,
  none: 1,
  mica: 2,
  acrylic: 3,
  micaAlt: 4,
};

export function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function setWindowMaterial(material: WindowMaterialMode | number) {
  if (!isTauriRuntime()) {
    return false;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_window_material', {
      material: typeof material === 'number' ? material : windowMaterialIds[material],
    });
    return true;
  } catch {
    return false;
  }
}
