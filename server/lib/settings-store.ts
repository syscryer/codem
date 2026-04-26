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

export type CustomModel = {
  id: string;
  label?: string;
  description?: string;
};

export type ModelSettings = {
  customModels: CustomModel[];
  defaultModelId: string;
};

export type AppSettings = {
  appearance: AppearanceSettings;
  models: ModelSettings;
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
  uiFontSize: 12,
  codeFontSize: 12,
  sidebarWidth: 'default',
};

export const defaultModelSettings: ModelSettings = {
  customModels: [],
  defaultModelId: '__default',
};

export const defaultAppSettings: AppSettings = {
  appearance: defaultAppearanceSettings,
  models: defaultModelSettings,
};

let defaultSettingsStore: ReturnType<typeof createSettingsStore> | undefined;

export function getAppSettings(): AppSettings {
  return getDefaultSettingsStore().getAppSettings();
}

export function updateAppearanceSettings(nextAppearance: unknown): AppSettings {
  return getDefaultSettingsStore().updateAppearanceSettings(nextAppearance);
}

export function updateModelSettings(nextModels: unknown): AppSettings {
  return getDefaultSettingsStore().updateModelSettings(nextModels);
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

  function updateStoreModelSettings(nextModels: unknown): AppSettings {
    const current = getStoreAppSettings();
    const next = normalizeAppSettings({
      ...current,
      models: nextModels,
    });
    writeSettingsFile(directory, settingsPath, next, fileSystem);
    return next;
  }

  return {
    getAppSettings: getStoreAppSettings,
    updateAppearanceSettings: updateStoreAppearanceSettings,
    updateModelSettings: updateStoreModelSettings,
  };
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const record = isRecord(value) ? value : {};
  return {
    appearance: normalizeAppearanceSettings(record.appearance),
    models: normalizeModelSettings(record.models),
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

function normalizeModelSettings(value: unknown): ModelSettings {
  const record = isRecord(value) ? value : {};
  const customModels = normalizeCustomModels(record.customModels);
  const defaultModelId = normalizeDefaultModelId(record.defaultModelId, customModels);

  return {
    customModels,
    defaultModelId,
  };
}

function normalizeCustomModels(value: unknown): CustomModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenIds = new Set<string>();
  const models: CustomModel[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const id = normalizeModelId(item.id);
    if (!id || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    const model: CustomModel = { id };
    const label = normalizeOptionalString(item.label);
    const description = normalizeOptionalString(item.description);
    if (label) {
      model.label = label;
    }
    if (description) {
      model.description = description;
    }
    models.push(model);
  }

  return models;
}

function normalizeDefaultModelId(value: unknown, customModels: CustomModel[]) {
  const id = normalizeModelId(value);
  if (!id || id === '__default') {
    return defaultModelSettings.defaultModelId;
  }

  return customModels.some((model) => model.id === id) ? id : defaultModelSettings.defaultModelId;
}

function normalizeModelId(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160 || /\s/.test(trimmed)) {
    return '';
  }

  return trimmed;
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
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
