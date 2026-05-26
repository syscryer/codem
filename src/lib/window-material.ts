import type { DesktopPlatform, WindowMaterialMode } from '../types';

const windowMaterialIds: Record<WindowMaterialMode, number> = {
  auto: 0,
  none: 1,
  mica: 2,
  acrylic: 3,
  micaAlt: 4,
};

const windowMaterialById: Record<number, WindowMaterialMode | undefined> = {
  0: 'auto',
  1: 'none',
  2: 'mica',
  3: 'acrylic',
  4: 'micaAlt',
};

const windowMaterialLabels: Record<WindowMaterialMode, string> = {
  auto: '自动',
  none: '无',
  mica: 'Mica',
  acrylic: 'Acrylic',
  micaAlt: 'Mica Alt',
};

type NativeWindowMaterial = {
  id?: number;
  name?: string;
};

export function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function resolveDesktopPlatform(): DesktopPlatform {
  if (typeof navigator === 'undefined') {
    return 'unknown';
  }

  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };

  const platformText = [
    navigatorWithUserAgentData.userAgentData?.platform,
    navigator.platform,
    navigator.userAgent,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');

  if (/mac/i.test(platformText)) {
    return 'macos';
  }
  if (/win/i.test(platformText)) {
    return 'windows';
  }
  if (/linux|x11/i.test(platformText)) {
    return 'linux';
  }

  return 'unknown';
}

export function getPlatformWindowMaterials(platform: DesktopPlatform): WindowMaterialMode[] {
  if (platform === 'windows') {
    return ['auto', 'none', 'mica', 'acrylic', 'micaAlt'];
  }

  if (platform === 'macos') {
    return ['auto', 'none'];
  }

  return ['auto'];
}

export function normalizeWindowMaterial(
  material: WindowMaterialMode,
  supportedMaterials: readonly WindowMaterialMode[],
): WindowMaterialMode {
  if (supportedMaterials.includes(material)) {
    return material;
  }

  return supportedMaterials[0] ?? 'auto';
}

export function getWindowMaterialLabel(material: WindowMaterialMode) {
  return windowMaterialLabels[material];
}

export async function getSupportedWindowMaterials(): Promise<WindowMaterialMode[]> {
  const fallback = getPlatformWindowMaterials(resolveDesktopPlatform());

  if (!isTauriRuntime()) {
    return fallback;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const materials = await invoke<NativeWindowMaterial[]>('get_supported_window_materials');
    const normalized = Array.isArray(materials)
      ? materials
          .map((material) => {
            if (!material || typeof material.id !== 'number') {
              return undefined;
            }
            return windowMaterialById[material.id];
          })
          .filter((material): material is WindowMaterialMode => Boolean(material))
      : [];

    return normalized.length > 0 ? normalized : fallback;
  } catch {
    return fallback;
  }
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
