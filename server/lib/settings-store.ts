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

export type ComposerSendShortcut = 'enter' | 'modEnter';

export type ShortcutSettings = {
  newChat: string | null;
  toggleSearch: string | null;
  toggleDebug: string | null;
  composerSend: ComposerSendShortcut;
};

export type OpenAppTargetKind = 'app' | 'command' | 'explorer' | 'terminal' | 'git-bash' | 'wsl';

export type OpenAppTarget = {
  id: string;
  label: string;
  kind: OpenAppTargetKind;
  command?: string;
  args: string[];
};

export type OpenWithSettings = {
  selectedTargetId: string;
  customTargets: OpenAppTarget[];
};

export type AppSettings = {
  appearance: AppearanceSettings;
  models: ModelSettings;
  shortcuts: ShortcutSettings;
  openWith: OpenWithSettings;
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

export const defaultModelSettings: ModelSettings = {
  customModels: [],
  defaultModelId: '__default',
};

export const defaultShortcutSettings: ShortcutSettings = {
  newChat: 'ctrl+n',
  toggleSearch: 'ctrl+g',
  toggleDebug: 'ctrl+shift+d',
  composerSend: 'enter',
};

export const defaultOpenWithSettings: OpenWithSettings = {
  selectedTargetId: 'vscode',
  customTargets: [],
};

export const defaultAppSettings: AppSettings = {
  appearance: defaultAppearanceSettings,
  models: defaultModelSettings,
  shortcuts: defaultShortcutSettings,
  openWith: defaultOpenWithSettings,
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

export function updateShortcutSettings(nextShortcuts: unknown): AppSettings {
  return getDefaultSettingsStore().updateShortcutSettings(nextShortcuts);
}

export function updateOpenWithSettings(nextOpenWith: unknown): AppSettings {
  return getDefaultSettingsStore().updateOpenWithSettings(nextOpenWith);
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

  function updateStoreShortcutSettings(nextShortcuts: unknown): AppSettings {
    const current = getStoreAppSettings();
    const next = normalizeAppSettings({
      ...current,
      shortcuts: {
        ...current.shortcuts,
        ...(isRecord(nextShortcuts) ? nextShortcuts : {}),
      },
    });
    writeSettingsFile(directory, settingsPath, next, fileSystem);
    return next;
  }

  function updateStoreOpenWithSettings(nextOpenWith: unknown): AppSettings {
    const current = getStoreAppSettings();
    const next = normalizeAppSettings({
      ...current,
      openWith: {
        ...current.openWith,
        ...(isRecord(nextOpenWith) ? nextOpenWith : {}),
      },
    });
    writeSettingsFile(directory, settingsPath, next, fileSystem);
    return next;
  }

  return {
    getAppSettings: getStoreAppSettings,
    updateAppearanceSettings: updateStoreAppearanceSettings,
    updateModelSettings: updateStoreModelSettings,
    updateShortcutSettings: updateStoreShortcutSettings,
    updateOpenWithSettings: updateStoreOpenWithSettings,
  };
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const record = isRecord(value) ? value : {};
  return {
    appearance: normalizeAppearanceSettings(record.appearance),
    models: normalizeModelSettings(record.models),
    shortcuts: normalizeShortcutSettings(record.shortcuts),
    openWith: normalizeOpenWithSettings(record.openWith),
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

function normalizeShortcutSettings(value: unknown): ShortcutSettings {
  const record = isRecord(value) ? value : {};
  return {
    newChat: normalizeShortcutValue(record.newChat, defaultShortcutSettings.newChat),
    toggleSearch: normalizeShortcutValue(record.toggleSearch, defaultShortcutSettings.toggleSearch),
    toggleDebug: normalizeShortcutValue(record.toggleDebug, defaultShortcutSettings.toggleDebug),
    composerSend: normalizeEnum(record.composerSend, ['enter', 'modEnter'], defaultShortcutSettings.composerSend),
  };
}

function normalizeOpenWithSettings(value: unknown): OpenWithSettings {
  const record = isRecord(value) ? value : {};
  if ('target' in record) {
    return normalizeLegacyOpenWithSettings(record);
  }

  const customTargets = normalizeOpenAppTargets(record.customTargets);
  const selectedTargetId = normalizeOpenTargetId(record.selectedTargetId) || defaultOpenWithSettings.selectedTargetId;
  return {
    selectedTargetId,
    customTargets,
  };
}

function normalizeLegacyOpenWithSettings(record: Record<string, unknown>): OpenWithSettings {
  const target = normalizeEnum(record.target, ['auto', 'cursor', 'vscode', 'custom'], 'auto');
  if (target === 'cursor' || target === 'vscode') {
    return {
      selectedTargetId: target,
      customTargets: [],
    };
  }

  if (target === 'custom') {
    const command = normalizeLimitedString(record.customCommand, 300);
    if (command) {
      return {
        selectedTargetId: 'custom',
        customTargets: [
          {
            id: 'custom',
            label: 'Custom',
            kind: 'command',
            command,
            args: parseOpenWithArgs(normalizeLimitedString(record.customArgs, 600)),
          },
        ],
      };
    }
  }

  return defaultOpenWithSettings;
}

function normalizeOpenAppTargets(value: unknown): OpenAppTarget[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenIds = new Set<string>();
  const targets: OpenAppTarget[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const id = normalizeOpenTargetId(item.id);
    const label = normalizeLimitedString(item.label, 80);
    const kind = normalizeOpenAppTargetKind(item.kind);
    if (!id || seenIds.has(id) || !label || !kind) {
      continue;
    }

    seenIds.add(id);
    const command = normalizeLimitedString(item.command, 300);
    targets.push({
      id,
      label,
      kind,
      command: command || undefined,
      args: normalizeStringArray(item.args, 80),
    });
  }

  return targets;
}

function normalizeOpenAppTargetKind(value: unknown): OpenAppTargetKind | '' {
  if (
    value === 'app' ||
    value === 'command' ||
    value === 'explorer' ||
    value === 'terminal' ||
    value === 'git-bash' ||
    value === 'wsl'
  ) {
    return value;
  }

  return '';
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

function normalizeOpenTargetId(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160 || !/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
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

function normalizeShortcutValue(value: unknown, fallback: string | null): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const parts = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .split('+')
    .map((part) => normalizeShortcutPart(part))
    .filter(Boolean);
  if (parts.length < 2) {
    return fallback;
  }

  const key = parts.at(-1);
  if (!key || isShortcutModifier(key)) {
    return fallback;
  }

  const modifiers = parts.slice(0, -1);
  if (!modifiers.some((part) => part === 'cmd' || part === 'ctrl' || part === 'alt')) {
    return fallback;
  }

  const normalizedModifiers = ['cmd', 'ctrl', 'alt', 'shift'].filter((modifier) => modifiers.includes(modifier));
  return [...normalizedModifiers, key].join('+');
}

function normalizeShortcutPart(value: string) {
  if (value === 'control') {
    return 'ctrl';
  }
  if (value === 'meta' || value === 'command') {
    return 'cmd';
  }
  if (value === ' ') {
    return 'space';
  }
  if (value === 'esc') {
    return 'escape';
  }
  if (value === 'return') {
    return 'enter';
  }
  return value;
}

function isShortcutModifier(value: string) {
  return ['shift', 'control', 'ctrl', 'alt', 'meta', 'cmd', 'command'].includes(value);
}

function normalizeLimitedString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : '';
}

function normalizeStringArray(value: unknown, maxItemLength: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeLimitedString(item, maxItemLength))
    .filter(Boolean);
}

function parseOpenWithArgs(value: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if ((character === '"' || character === "'") && !quote) {
      quote = character;
      continue;
    }
    if (quote && character === quote) {
      quote = null;
      continue;
    }
    if (!quote && /\s/.test(character)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += character;
  }

  if (current) {
    args.push(current);
  }

  return args;
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
