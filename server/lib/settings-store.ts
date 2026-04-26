import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

export type ThemeMode = 'system' | 'light' | 'dark';
export type InterfaceDensity = 'comfortable' | 'compact';
export type SidebarWidthMode = 'narrow' | 'default' | 'wide';

export type AppearanceSettings = {
  themeMode: ThemeMode;
  density: InterfaceDensity;
  uiFontSize: 12 | 13 | 14 | 15;
  codeFontSize: 12 | 13 | 14;
  sidebarWidth: SidebarWidthMode;
};

export type AppSettings = {
  appearance: AppearanceSettings;
};

const SETTINGS_FILE_NAME = 'settings.json';

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

const defaultSettingsStore = createSettingsStore(resolveAppDirectory());

export function getAppSettings(): AppSettings {
  return defaultSettingsStore.getAppSettings();
}

export function updateAppearanceSettings(nextAppearance: unknown): AppSettings {
  return defaultSettingsStore.updateAppearanceSettings(nextAppearance);
}

export function createSettingsStore(directory: string) {
  const settingsPath = path.join(directory, SETTINGS_FILE_NAME);

  function getStoreAppSettings(): AppSettings {
    const raw = readSettingsFile(settingsPath);
    return normalizeAppSettings(raw);
  }

  function updateStoreAppearanceSettings(nextAppearance: unknown): AppSettings {
    const current = getStoreAppSettings();
    const next = normalizeAppSettings({
      ...current,
      appearance: nextAppearance,
    });
    writeSettingsFile(directory, settingsPath, next);
    return next;
  }

  return {
    getAppSettings: getStoreAppSettings,
    updateAppearanceSettings: updateStoreAppearanceSettings,
  };
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const record = isRecord(value) ? value : {};
  return {
    appearance: normalizeAppearanceSettings(record.appearance),
  };
}

function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  const record = isRecord(value) ? value : {};
  return {
    themeMode: normalizeEnum(record.themeMode, ['system', 'light', 'dark'], defaultAppearanceSettings.themeMode),
    density: normalizeEnum(record.density, ['comfortable', 'compact'], defaultAppearanceSettings.density),
    uiFontSize: normalizeNumber(record.uiFontSize, [12, 13, 14, 15], defaultAppearanceSettings.uiFontSize),
    codeFontSize: normalizeNumber(record.codeFontSize, [12, 13, 14], defaultAppearanceSettings.codeFontSize),
    sidebarWidth: normalizeEnum(record.sidebarWidth, ['narrow', 'default', 'wide'], defaultAppearanceSettings.sidebarWidth),
  };
}

function readSettingsFile(settingsPath: string): unknown {
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown;
  } catch {
    return defaultAppSettings;
  }
}

function writeSettingsFile(directory: string, settingsPath: string, settings: AppSettings) {
  mkdirSync(directory, { recursive: true });
  const temporaryPath = `${settingsPath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, settingsPath);
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeNumber<T extends number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'number' && allowed.includes(value as T) ? (value as T) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveAppDirectory() {
  const baseDirectory =
    process.env.LOCALAPPDATA ||
    process.env.APPDATA ||
    path.join(homedir(), 'AppData', 'Local');
  const directory = path.join(baseDirectory, 'CodeM');
  mkdirSync(directory, { recursive: true });
  return directory;
}
