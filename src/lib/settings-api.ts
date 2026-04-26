import { normalizeShortcutValue } from './shortcuts';
import type {
  AppSettings,
  AppearanceSettings,
  CustomModel,
  GeneralSettings,
  ModelSettings,
  OpenAppTarget,
  OpenWithSettings,
  OpenWithTargetsResponse,
  ShortcutSettings,
  UsageStatsResponse,
} from '../types';

export const defaultGeneralSettings: GeneralSettings = {
  restoreLastSelectionOnLaunch: true,
  autoRefreshGitStatus: true,
  showDebugButton: true,
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
  general: defaultGeneralSettings,
  appearance: defaultAppearanceSettings,
  models: defaultModelSettings,
  shortcuts: defaultShortcutSettings,
  openWith: defaultOpenWithSettings,
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

export async function saveGeneralSettings(general: GeneralSettings): Promise<AppSettings> {
  try {
    const response = await fetch('/api/settings/general', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizeGeneralSettings(general)),
    });
    return await readSettingsResponse(response, '保存基础设置失败');
  } catch {
    throw new Error('保存基础设置失败');
  }
}

export async function saveModelSettings(models: ModelSettings): Promise<AppSettings> {
  try {
    const response = await fetch('/api/settings/models', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizeModelSettings(models)),
    });
    return await readSettingsResponse(response, '保存模型设置失败');
  } catch {
    throw new Error('保存模型设置失败');
  }
}

export async function saveShortcutSettings(shortcuts: ShortcutSettings): Promise<AppSettings> {
  try {
    const response = await fetch('/api/settings/shortcuts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizeShortcutSettings(shortcuts)),
    });
    return await readSettingsResponse(response, '保存快捷键设置失败');
  } catch {
    throw new Error('保存快捷键设置失败');
  }
}

export async function saveOpenWithSettings(openWith: OpenWithSettings): Promise<AppSettings> {
  try {
    const response = await fetch('/api/settings/open-with', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizeOpenWithSettings(openWith)),
    });
    return await readSettingsResponse(response, '保存打开方式失败');
  } catch {
    throw new Error('保存打开方式失败');
  }
}

export async function fetchOpenWithTargets(): Promise<OpenWithTargetsResponse> {
  try {
    const response = await fetch('/api/open-with/targets');
    if (!response.ok) {
      throw new Error('读取打开工具失败');
    }
    return normalizeOpenWithTargetsResponse(await response.json());
  } catch {
    throw new Error('读取打开工具失败');
  }
}

export async function fetchUsageStats(): Promise<UsageStatsResponse> {
  try {
    const response = await fetch('/api/usage');
    if (!response.ok) {
      throw new Error('读取使用情况失败');
    }
    return normalizeUsageStats(await response.json());
  } catch {
    throw new Error('读取使用情况失败');
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
    general: normalizeGeneralSettings(record.general),
    appearance: normalizeAppearanceSettings(record.appearance),
    models: normalizeModelSettings(record.models),
    shortcuts: normalizeShortcutSettings(record.shortcuts),
    openWith: normalizeOpenWithSettings(record.openWith),
  };
}

export function normalizeGeneralSettings(general: unknown): GeneralSettings {
  const record = isRecord(general) ? general : {};
  return {
    restoreLastSelectionOnLaunch: normalizeBoolean(
      record.restoreLastSelectionOnLaunch,
      defaultGeneralSettings.restoreLastSelectionOnLaunch,
    ),
    autoRefreshGitStatus: normalizeBoolean(record.autoRefreshGitStatus, defaultGeneralSettings.autoRefreshGitStatus),
    showDebugButton: normalizeBoolean(record.showDebugButton, defaultGeneralSettings.showDebugButton),
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

function normalizeUsageStats(value: unknown): UsageStatsResponse {
  const record = isRecord(value) ? value : {};
  return {
    generatedAt: normalizeOptionalString(record.generatedAt) || new Date(0).toISOString(),
    totals: normalizeUsageTotals(record.totals),
    byProvider: normalizeUsageProviderRows(record.byProvider),
    byProject: normalizeUsageProjectRows(record.byProject),
  };
}

function normalizeUsageProviderRows(value: unknown): UsageStatsResponse['byProvider'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const totals = normalizeUsageTotals(item);
    return [{
      ...totals,
      provider: normalizeOptionalString(item.provider) || 'unknown',
      model: normalizeOptionalString(item.model) || '未配置',
      lastUsedAt: normalizeNullableString(item.lastUsedAt),
    }];
  });
}

function normalizeUsageProjectRows(value: unknown): UsageStatsResponse['byProject'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const totals = normalizeUsageTotals(item);
    return [{
      ...totals,
      projectId: normalizeOptionalString(item.projectId),
      projectName: normalizeOptionalString(item.projectName) || '未命名项目',
      projectPath: normalizeOptionalString(item.projectPath),
      lastUsedAt: normalizeNullableString(item.lastUsedAt),
    }];
  });
}

function normalizeUsageTotals(value: unknown) {
  const record = isRecord(value) ? value : {};
  return {
    projects: normalizeNonNegativeNumber(record.projects),
    threads: normalizeNonNegativeNumber(record.threads),
    messages: normalizeNonNegativeNumber(record.messages),
    toolCalls: normalizeNonNegativeNumber(record.toolCalls),
    inputTokens: normalizeNonNegativeNumber(record.inputTokens),
    outputTokens: normalizeNonNegativeNumber(record.outputTokens),
    cacheCreationInputTokens: normalizeNonNegativeNumber(record.cacheCreationInputTokens),
    cacheReadInputTokens: normalizeNonNegativeNumber(record.cacheReadInputTokens),
    totalTokens: normalizeNonNegativeNumber(record.totalTokens),
    durationMs: normalizeNonNegativeNumber(record.durationMs),
    totalCostUsd: normalizeNonNegativeNumber(record.totalCostUsd),
  };
}

export function normalizeModelSettings(models: unknown): ModelSettings {
  const record = isRecord(models) ? models : {};
  const customModels = normalizeCustomModels(record.customModels);
  const defaultModelId = normalizeDefaultModelId(record.defaultModelId, customModels);

  return {
    customModels,
    defaultModelId,
  };
}

export function normalizeShortcutSettings(shortcuts: unknown): ShortcutSettings {
  const record = isRecord(shortcuts) ? shortcuts : {};
  return {
    newChat: normalizeShortcutValueWithFallback(record.newChat, defaultShortcutSettings.newChat),
    toggleSearch: normalizeShortcutValueWithFallback(record.toggleSearch, defaultShortcutSettings.toggleSearch),
    toggleDebug: normalizeShortcutValueWithFallback(record.toggleDebug, defaultShortcutSettings.toggleDebug),
    composerSend: normalizeOneOf(record.composerSend, ['enter', 'modEnter'], defaultShortcutSettings.composerSend),
  };
}

export function normalizeOpenWithSettings(openWith: unknown): OpenWithSettings {
  const record = isRecord(openWith) ? openWith : {};
  if ('target' in record) {
    return normalizeLegacyOpenWithSettings(record);
  }

  return {
    selectedTargetId: normalizeOpenTargetId(record.selectedTargetId) || defaultOpenWithSettings.selectedTargetId,
    customTargets: normalizeOpenAppTargets(record.customTargets),
  };
}

function normalizeLegacyOpenWithSettings(record: Record<string, unknown>): OpenWithSettings {
  const target = normalizeOneOf(record.target, ['auto', 'cursor', 'vscode', 'custom'], 'auto');
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

function normalizeOpenWithTargetsResponse(value: unknown): OpenWithTargetsResponse {
  const record = isRecord(value) ? value : {};
  const targets = normalizeOpenAppTargets(record.targets);
  return {
    targets,
    selectedTargetId: normalizeOpenTargetId(record.selectedTargetId) || targets[0]?.id || defaultOpenWithSettings.selectedTargetId,
  };
}

export function normalizeOpenAppTargets(value: unknown): OpenAppTarget[] {
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
    if (!id || !label || !kind || seenIds.has(id)) {
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
  if (!id || id === defaultModelSettings.defaultModelId) {
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
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableString(value: unknown) {
  const normalized = normalizeOptionalString(value);
  return normalized || null;
}

function normalizeShortcutValueWithFallback(value: unknown, fallback: string | null): string | null {
  if (value === null) {
    return null;
  }
  return normalizeShortcutValue(value) ?? fallback;
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

  return value.map((item) => normalizeLimitedString(item, maxItemLength)).filter(Boolean);
}

function normalizeOpenAppTargetKind(value: unknown): OpenAppTarget['kind'] | '' {
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

function normalizeOneOf<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeNonNegativeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
