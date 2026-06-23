import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { cloneDefaultWorkbenchIgnorePatterns, mergeWorkbenchIgnorePatterns } from '../../src/lib/review-ignore-patterns.js';

export type ThemeMode = 'system' | 'light' | 'dark';
export type InterfaceDensity = 'comfortable' | 'compact';
export type SidebarWidthMode = 'narrow' | 'default' | 'wide';
export type WindowMaterialMode = 'auto' | 'none' | 'mica' | 'acrylic' | 'micaAlt';
export type ReviewDisplayMode = 'tree' | 'flat';

export type GeneralSettings = {
  restoreLastSelectionOnLaunch: boolean;
  autoRefreshGitStatus: boolean;
  enableThreadSystemNotifications: boolean;
  autoGuideQueuedPrompts: boolean;
  autoCheckAppUpdate: boolean;
  showDebugButton: boolean;
  collapseIntermediateProcess: boolean;
  defaultPermissionMode: PermissionMode;
  reviewHideNoiseFilesByDefault: boolean;
  reviewDefaultDisplayMode: ReviewDisplayMode;
  reviewNoisePatterns: string[];
  reviewIgnorePatternsCustomized: boolean;
};

export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'auto' | 'dontAsk' | 'bypassPermissions';

export type AppearanceSettings = {
  themeMode: ThemeMode;
  density: InterfaceDensity;
  accentColor: 'blue' | 'emerald' | 'amber' | 'rose' | 'violet' | 'custom';
  accentColorCustom: string;
  uiFontMode: 'preset' | 'custom';
  uiFontPreset: 'codex' | 'system' | 'segoe' | 'yahei' | 'dengxian' | 'song' | 'sourceHanSans' | 'misans' | 'harmony';
  uiFontCustom: string;
  chatFontMode: 'followUi' | 'preset' | 'custom';
  chatFontPreset: 'codex' | 'system' | 'segoe' | 'yahei' | 'dengxian' | 'song' | 'sourceHanSans' | 'misans' | 'harmony';
  chatFontCustom: string;
  codeFontMode: 'preset' | 'custom';
  codeFontPreset: 'cascadia' | 'jetbrains' | 'consolas' | 'firaCode' | 'sourceCodePro';
  codeFontCustom: string;
  uiFontSize: 12 | 13 | 14 | 15;
  chatFontSize: 13 | 14 | 15 | 16;
  codeFontSize: 12 | 13 | 14;
  sidebarWidth: SidebarWidthMode;
  /** 用户拖拽 sidebar 后的精确像素宽度，覆盖 sidebarWidth 预设。 */
  sidebarCustomWidth?: number;
  windowMaterial: WindowMaterialMode;
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
  general: GeneralSettings;
  appearance: AppearanceSettings;
  models: ModelSettings;
  shortcuts: ShortcutSettings;
  openWith: OpenWithSettings;
};

const SETTINGS_FILE_NAME = 'settings.json';
const APP_DATA_DIR_ENV = 'CODEM_APP_DATA_DIR';

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
  accentColor: 'blue',
  accentColorCustom: '#2374C6',
  uiFontMode: 'preset',
  uiFontPreset: 'codex',
  uiFontCustom:
    '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI Variable Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  chatFontMode: 'followUi',
  chatFontPreset: 'codex',
  chatFontCustom:
    '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI Variable Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  codeFontMode: 'preset',
  codeFontPreset: 'cascadia',
  codeFontCustom: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
  uiFontSize: 14,
  chatFontSize: 14,
  codeFontSize: 12,
  sidebarWidth: 'default',
  windowMaterial: 'mica',
};

export const defaultGeneralSettings: GeneralSettings = {
  restoreLastSelectionOnLaunch: true,
  autoRefreshGitStatus: true,
  enableThreadSystemNotifications: true,
  autoGuideQueuedPrompts: false,
  autoCheckAppUpdate: true,
  showDebugButton: true,
  collapseIntermediateProcess: false,
  defaultPermissionMode: 'default',
  reviewHideNoiseFilesByDefault: true,
  reviewDefaultDisplayMode: 'tree',
  reviewNoisePatterns: cloneDefaultWorkbenchIgnorePatterns(),
  reviewIgnorePatternsCustomized: false,
};

export const defaultModelSettings: ModelSettings = {
  customModels: [],
  defaultModelId: '__default',
};
const CLAUDE_MODEL_SLOT_VALUES = ['sonnet', 'sonnet[1m]', 'opus', 'opus[1m]', 'haiku'] as const;

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
  general: defaultGeneralSettings,
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

export function updateGeneralSettings(nextGeneral: unknown): AppSettings {
  return getDefaultSettingsStore().updateGeneralSettings(nextGeneral);
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

  function updateStoreGeneralSettings(nextGeneral: unknown): AppSettings {
    const current = getStoreAppSettings();
    const next = normalizeAppSettings({
      ...current,
      general: {
        ...current.general,
        ...(isRecord(nextGeneral) ? nextGeneral : {}),
      },
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
    updateGeneralSettings: updateStoreGeneralSettings,
    updateAppearanceSettings: updateStoreAppearanceSettings,
    updateModelSettings: updateStoreModelSettings,
    updateShortcutSettings: updateStoreShortcutSettings,
    updateOpenWithSettings: updateStoreOpenWithSettings,
  };
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const record = isRecord(value) ? value : {};
  return {
    general: normalizeGeneralSettings(record.general),
    appearance: normalizeAppearanceSettings(record.appearance),
    models: normalizeModelSettings(record.models),
    shortcuts: normalizeShortcutSettings(record.shortcuts),
    openWith: normalizeOpenWithSettings(record.openWith),
  };
}

function normalizeGeneralSettings(value: unknown): GeneralSettings {
  const record = isRecord(value) ? value : {};
  const normalizedPatterns = normalizeStringArray(record.reviewNoisePatterns, 160);
  const hasCustomizedFlag = typeof record.reviewIgnorePatternsCustomized === 'boolean';
  const reviewIgnorePatternsCustomized = normalizeBoolean(record.reviewIgnorePatternsCustomized, false);
  const reviewNoisePatterns = hasCustomizedFlag
    ? reviewIgnorePatternsCustomized
      ? normalizedPatterns
      : cloneDefaultWorkbenchIgnorePatterns()
    : mergeWorkbenchIgnorePatterns([
      ...cloneDefaultWorkbenchIgnorePatterns(),
      ...normalizedPatterns,
    ]);

  return {
    restoreLastSelectionOnLaunch: normalizeBoolean(
      record.restoreLastSelectionOnLaunch,
      defaultGeneralSettings.restoreLastSelectionOnLaunch,
    ),
    autoRefreshGitStatus: normalizeBoolean(record.autoRefreshGitStatus, defaultGeneralSettings.autoRefreshGitStatus),
    enableThreadSystemNotifications: normalizeBoolean(
      record.enableThreadSystemNotifications,
      defaultGeneralSettings.enableThreadSystemNotifications,
    ),
    autoGuideQueuedPrompts: normalizeBoolean(
      record.autoGuideQueuedPrompts,
      defaultGeneralSettings.autoGuideQueuedPrompts,
    ),
    autoCheckAppUpdate: normalizeBoolean(
      record.autoCheckAppUpdate,
      defaultGeneralSettings.autoCheckAppUpdate,
    ),
    showDebugButton: normalizeBoolean(record.showDebugButton, defaultGeneralSettings.showDebugButton),
    collapseIntermediateProcess: normalizeBoolean(
      record.collapseIntermediateProcess,
      defaultGeneralSettings.collapseIntermediateProcess,
    ),
    defaultPermissionMode: normalizeEnum(
      record.defaultPermissionMode,
      ['default', 'auto', 'bypassPermissions'],
      defaultGeneralSettings.defaultPermissionMode,
    ),
    reviewHideNoiseFilesByDefault: normalizeBoolean(
      record.reviewHideNoiseFilesByDefault,
      defaultGeneralSettings.reviewHideNoiseFilesByDefault,
    ),
    reviewDefaultDisplayMode: normalizeEnum(
      record.reviewDefaultDisplayMode,
      ['tree', 'flat'],
      defaultGeneralSettings.reviewDefaultDisplayMode,
    ),
    reviewNoisePatterns,
    reviewIgnorePatternsCustomized,
  };
}

function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  const record = isRecord(value) ? value : {};
  const legacyUiFontPreset = normalizeEnum(
    record.uiFontFamily,
    ['system', 'yahei', 'dengxian', 'song'],
    defaultAppearanceSettings.uiFontPreset,
  );
  const legacyCodeFontPreset = normalizeEnum(
    record.codeFontFamily,
    ['cascadia', 'jetbrains', 'consolas'],
    defaultAppearanceSettings.codeFontPreset,
  );
  const normalizedSidebarCustomWidth = normalizeSidebarCustomWidth(record.sidebarCustomWidth);
  return {
    themeMode: normalizeEnum(record.themeMode, ['system', 'light', 'dark'], defaultAppearanceSettings.themeMode),
    density: normalizeEnum(record.density, ['comfortable', 'compact'], defaultAppearanceSettings.density),
    accentColor: normalizeEnum(
      record.accentColor,
      ['blue', 'emerald', 'amber', 'rose', 'violet', 'custom'],
      defaultAppearanceSettings.accentColor,
    ),
    accentColorCustom: normalizeAccentHexColor(record.accentColorCustom, defaultAppearanceSettings.accentColorCustom),
    uiFontMode: normalizeEnum(record.uiFontMode, ['preset', 'custom'], 'uiFontFamily' in record ? 'preset' : defaultAppearanceSettings.uiFontMode),
    uiFontPreset: normalizeEnum(
      record.uiFontPreset,
      ['codex', 'system', 'segoe', 'yahei', 'dengxian', 'song', 'sourceHanSans', 'misans', 'harmony'],
      legacyUiFontPreset,
    ),
    uiFontCustom: normalizeFontFamilyValue(record.uiFontCustom, defaultAppearanceSettings.uiFontCustom),
    chatFontMode: normalizeEnum(record.chatFontMode, ['followUi', 'preset', 'custom'], defaultAppearanceSettings.chatFontMode),
    chatFontPreset: normalizeEnum(
      record.chatFontPreset,
      ['codex', 'system', 'segoe', 'yahei', 'dengxian', 'song', 'sourceHanSans', 'misans', 'harmony'],
      defaultAppearanceSettings.chatFontPreset,
    ),
    chatFontCustom: normalizeFontFamilyValue(record.chatFontCustom, defaultAppearanceSettings.chatFontCustom),
    codeFontMode: normalizeEnum(record.codeFontMode, ['preset', 'custom'], 'codeFontFamily' in record ? 'preset' : defaultAppearanceSettings.codeFontMode),
    codeFontPreset: normalizeEnum(
      record.codeFontPreset,
      ['cascadia', 'jetbrains', 'consolas', 'firaCode', 'sourceCodePro'],
      legacyCodeFontPreset,
    ),
    codeFontCustom: normalizeFontFamilyValue(record.codeFontCustom, defaultAppearanceSettings.codeFontCustom),
    uiFontSize: normalizeNumber(record.uiFontSize, [12, 13, 14, 15], defaultAppearanceSettings.uiFontSize),
    chatFontSize: normalizeNumber(record.chatFontSize, [13, 14, 15, 16], defaultAppearanceSettings.chatFontSize),
    codeFontSize: normalizeNumber(record.codeFontSize, [12, 13, 14], defaultAppearanceSettings.codeFontSize),
    sidebarWidth: normalizeEnum(record.sidebarWidth, ['narrow', 'default', 'wide'], defaultAppearanceSettings.sidebarWidth),
    ...(normalizedSidebarCustomWidth !== undefined ? { sidebarCustomWidth: normalizedSidebarCustomWidth } : {}),
    windowMaterial: normalizeEnum(
      record.windowMaterial,
      ['auto', 'none', 'mica', 'acrylic', 'micaAlt'],
      defaultAppearanceSettings.windowMaterial,
    ),
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
  const id = normalizeLegacyModelId(normalizeModelId(value));
  if (!id || id === '__default') {
    return defaultModelSettings.defaultModelId;
  }

  return customModels.some((model) => model.id === id) || (CLAUDE_MODEL_SLOT_VALUES as readonly string[]).includes(id)
    ? id
    : defaultModelSettings.defaultModelId;
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

function normalizeLegacyModelId(id: string) {
  if (id === 'opus-1m') {
    return 'opus[1m]';
  }

  return id;
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

function normalizeSidebarCustomWidth(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.round(Math.min(480, Math.max(220, value)));
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeFontFamilyValue(value: unknown, fallback: string) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 320 || /[\r\n\t]/.test(trimmed)) {
    return fallback;
  }

  return trimmed;
}

function normalizeAccentHexColor(value: unknown, fallback: string) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  const shortMatch = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  const fullMatch = /^#([0-9a-fA-F]{6})$/.exec(trimmed);
  if (fullMatch) {
    return `#${fullMatch[1].toUpperCase()}`;
  }

  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function resolveAppDirectory() {
  const explicitDirectory = normalizeAppDataDirectory(process.env[APP_DATA_DIR_ENV]);
  if (explicitDirectory) {
    mkdirSync(explicitDirectory, { recursive: true });
    return explicitDirectory;
  }

  const baseDirectory =
    process.env.LOCALAPPDATA ||
    process.env.APPDATA ||
    path.join(homedir(), 'AppData', 'Local');
  const directory = path.join(baseDirectory, 'CodeM');
  mkdirSync(directory, { recursive: true });
  return directory;
}

function normalizeAppDataDirectory(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}
