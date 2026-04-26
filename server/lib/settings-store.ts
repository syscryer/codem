import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

type SettingsStoreFileSystem = {
  renameSync: typeof renameSync;
  rmSync: typeof rmSync;
  writeFileSync: typeof writeFileSync;
};

const nodeSettingsStoreFileSystem: SettingsStoreFileSystem = {
  renameSync,
  rmSync,
  writeFileSync,
};

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

let defaultSettingsStore: ReturnType<typeof createSettingsStore> | undefined;

export function getAppSettings(): AppSettings {
  return getDefaultSettingsStore().getAppSettings();
}

export function updateAppearanceSettings(nextAppearance: unknown): AppSettings {
  return getDefaultSettingsStore().updateAppearanceSettings(nextAppearance);
}

function getDefaultSettingsStore() {
  defaultSettingsStore ??= createSettingsStore(resolveAppDirectory());
  return defaultSettingsStore;
}

export function createSettingsStore(
  directory: string,
  fileSystemOverrides: Partial<SettingsStoreFileSystem> = {},
) {
  const fileSystem = {
    ...nodeSettingsStoreFileSystem,
    ...fileSystemOverrides,
  };
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
    writeSettingsFile(directory, settingsPath, next, fileSystem);
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
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return defaultAppSettings;
    }

    if (error instanceof SyntaxError) {
      return defaultAppSettings;
    }

    throw error;
  }
}

function writeSettingsFile(
  directory: string,
  settingsPath: string,
  settings: AppSettings,
  fileSystem: SettingsStoreFileSystem,
) {
  mkdirSync(directory, { recursive: true });
  const temporaryPath = `${settingsPath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  try {
    fileSystem.writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    fileSystem.renameSync(temporaryPath, settingsPath);
  } catch (error) {
    try {
      fileSystem.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original write/rename failure for callers.
    }
    throw error;
  }
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
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
