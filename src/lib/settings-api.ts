import type { AppSettings, AppearanceSettings, CustomModel, ModelSettings } from '../types';

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
    models: normalizeModelSettings(record.models),
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

export function normalizeModelSettings(models: unknown): ModelSettings {
  const record = isRecord(models) ? models : {};
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

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOneOf<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
