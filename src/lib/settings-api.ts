import type { AppSettings, AppearanceSettings } from '../types';

export const defaultAppearanceSettings: AppearanceSettings = {
  themeMode: 'system',
  density: 'comfortable',
  uiFontSize: 13,
  codeFontSize: 12,
  sidebarWidth: 'default',
};

export const defaultAppSettings: AppSettings = {
  appearance: defaultAppearanceSettings,
};

export async function fetchAppSettings(): Promise<AppSettings> {
  try {
    const response = await fetch('/api/settings');
    return await readSettingsResponse(response, '读取设置失败');
  } catch {
    throw new Error('读取设置失败');
  }
}

export async function saveAppearanceSettings(appearance: AppearanceSettings): Promise<AppSettings> {
  try {
    const response = await fetch('/api/settings/appearance', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizeAppearanceSettings(appearance)),
    });
    return await readSettingsResponse(response, '保存外观设置失败');
  } catch {
    throw new Error('保存外观设置失败');
  }
}

async function readSettingsResponse(response: Response, failureMessage: string): Promise<AppSettings> {
  if (!response.ok) {
    throw new Error(failureMessage);
  }

  try {
    return normalizeAppSettings(await response.json());
  } catch {
    throw new Error(failureMessage);
  }
}

function normalizeAppSettings(settings: unknown): AppSettings {
  const record = isRecord(settings) ? settings : {};
  return {
    appearance: normalizeAppearanceSettings(record.appearance),
  };
}

function normalizeAppearanceSettings(appearance: unknown): AppearanceSettings {
  const record = isRecord(appearance) ? appearance : {};

  return {
    themeMode: normalizeOneOf(record.themeMode, ['system', 'light', 'dark'], defaultAppearanceSettings.themeMode),
    density: normalizeOneOf(record.density, ['comfortable', 'compact'], defaultAppearanceSettings.density),
    uiFontSize: normalizeOneOf(record.uiFontSize, [12, 13, 14, 15], defaultAppearanceSettings.uiFontSize),
    codeFontSize: normalizeOneOf(record.codeFontSize, [12, 13, 14], defaultAppearanceSettings.codeFontSize),
    sidebarWidth: normalizeOneOf(record.sidebarWidth, ['narrow', 'default', 'wide'], defaultAppearanceSettings.sidebarWidth),
  };
}

function normalizeOneOf<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
