import { normalizeShortcutValue } from './shortcuts';
import {
  CLAUDE_CODE_PROVIDER_ID,
  CLAUDE_MODEL_SLOT_VALUES,
  DEFAULT_CUSTOM_ACCENT_COLOR,
  GROK_BUILD_PROVIDER_ID,
  normalizeAccentHexColor,
  OPENAI_CODEX_PROVIDER_ID,
  OPENCODE_PROVIDER_ID,
} from '../constants';
import { cloneDefaultWorkbenchIgnorePatterns, mergeWorkbenchIgnorePatterns } from './review-ignore-patterns';
import type {
  AgentProviderId,
  AgentRuntimeSettings,
  AppSettings,
  AppearanceSettings,
  CustomModel,
  GeneralSettings,
  AgentNetworkProxySettings,
  ModelSettings,
  OpenAppTarget,
  OpenWithSettings,
  OpenWithTargetsResponse,
  ShortcutSettings,
  UsageStatsResponse,
  UsageTrendPoint,
  UsageThreadRow,
} from '../types';

export const defaultAgentNetworkProxySettings: AgentNetworkProxySettings = {
  enabled: false,
  protocol: 'http',
  host: '',
  port: 7890,
  username: '',
  password: '',
  noProxy: 'localhost,127.0.0.1,::1',
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

export const defaultAppearanceSettings: AppearanceSettings = {
  themeMode: 'system',
  density: 'comfortable',
  accentColor: 'blue',
  accentColorCustom: DEFAULT_CUSTOM_ACCENT_COLOR,
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

export const defaultModelSettings: ModelSettings = {
  customModels: [],
  defaultModelId: '__default',
  modelCapabilities: [],
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

export const defaultAgentRuntimeSettings: AgentRuntimeSettings = {
  defaultProviderId: CLAUDE_CODE_PROVIDER_ID,
};

export const defaultAppSettings: AppSettings = {
  general: defaultGeneralSettings,
  agentRuntime: defaultAgentRuntimeSettings,
  appearance: defaultAppearanceSettings,
  models: defaultModelSettings,
  shortcuts: defaultShortcutSettings,
  openWith: defaultOpenWithSettings,
  networkProxy: defaultAgentNetworkProxySettings,
};

export async function fetchAppSettings(): Promise<AppSettings> {
  try {
    const response = await fetch('/api/settings');
    return await readSettingsResponse(response, '读取设置失败');
  } catch {
    throw new Error('读取设置失败');
  }
}

export async function fetchAgentRuntimeSettings(): Promise<AgentRuntimeSettings> {
  try {
    const response = await fetch('/api/agents/runtime-settings');
    if (!response.ok) {
      throw new Error('读取 Agent 运行设置失败');
    }
    return normalizeAgentRuntimeSettings(await response.json());
  } catch {
    throw new Error('读取 Agent 运行设置失败');
  }
}

export async function saveAgentRuntimeSettings(
  settings: AgentRuntimeSettings,
): Promise<AgentRuntimeSettings> {
  try {
    const response = await fetch('/api/agents/runtime-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizeAgentRuntimeSettings(settings)),
    });
    if (!response.ok) {
      throw new Error('保存 Agent 运行设置失败');
    }
    return normalizeAgentRuntimeSettings(await response.json());
  } catch {
    throw new Error('保存 Agent 运行设置失败');
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

export async function saveAgentNetworkProxySettings(
  settings: AgentNetworkProxySettings,
): Promise<AppSettings> {
  try {
    const response = await fetch('/api/settings/network-proxy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizeAgentNetworkProxySettings(settings)),
    });
    return await readSettingsResponse(response, '保存网络代理设置失败');
  } catch {
    throw new Error('保存网络代理设置失败');
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

export async function fetchUsageStats(
  range?: 1 | 7 | 30 | 90 | 'all',
  projectId?: string,
  providerId?: AgentProviderId,
): Promise<UsageStatsResponse> {
  try {
    const searchParams = new URLSearchParams();
    if (range && range !== 'all') {
      searchParams.set('range', `${range}`);
    }
    if (projectId) {
      searchParams.set('projectId', projectId);
    }
    if (providerId) {
      searchParams.set('providerId', providerId);
    }
    const queryText = searchParams.toString();
    const query = queryText ? `?${queryText}` : '';
    const response = await fetch(`/api/usage${query}`);
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
    agentRuntime: normalizeAgentRuntimeSettings(record.agentRuntime),
    appearance: normalizeAppearanceSettings(record.appearance),
    models: normalizeModelSettings(record.models),
    shortcuts: normalizeShortcutSettings(record.shortcuts),
    openWith: normalizeOpenWithSettings(record.openWith),
    networkProxy: normalizeAgentNetworkProxySettings(record.networkProxy),
  };
}

export function normalizeAgentNetworkProxySettings(value: unknown): AgentNetworkProxySettings {
  const record = isRecord(value) ? value : {};
  const protocol = record.protocol === 'https' || record.protocol === 'socks5' ? record.protocol : 'http';
  const portValue = typeof record.port === 'number' ? record.port : Number(record.port);
  return {
    enabled: normalizeBoolean(record.enabled, defaultAgentNetworkProxySettings.enabled),
    protocol,
    host: normalizeLimitedString(record.host, 255),
    port: Number.isInteger(portValue) && portValue >= 1 && portValue <= 65535
      ? portValue
      : defaultAgentNetworkProxySettings.port,
    username: normalizeLimitedString(record.username, 128),
    password: normalizeLimitedString(record.password, 256),
    noProxy: normalizeLimitedString(record.noProxy, 2000),
  };
}

export function normalizeAgentRuntimeSettings(value: unknown): AgentRuntimeSettings {
  const record = isRecord(value) ? value : {};
  return {
    defaultProviderId: normalizeAgentProviderId(record.defaultProviderId),
  };
}

function normalizeAgentProviderId(value: unknown): AgentProviderId {
  if (
    value === CLAUDE_CODE_PROVIDER_ID
    || value === GROK_BUILD_PROVIDER_ID
    || value === OPENAI_CODEX_PROVIDER_ID
    || value === OPENCODE_PROVIDER_ID
  ) {
    return value;
  }
  return defaultAgentRuntimeSettings.defaultProviderId;
}

export function normalizeGeneralSettings(general: unknown): GeneralSettings {
  const record = isRecord(general) ? general : {};
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
    defaultPermissionMode: normalizeOneOf(
      record.defaultPermissionMode,
      ['default', 'auto', 'bypassPermissions'],
      defaultGeneralSettings.defaultPermissionMode,
    ),
    reviewHideNoiseFilesByDefault: normalizeBoolean(
      record.reviewHideNoiseFilesByDefault,
      defaultGeneralSettings.reviewHideNoiseFilesByDefault,
    ),
    reviewDefaultDisplayMode: normalizeOneOf(
      record.reviewDefaultDisplayMode,
      ['tree', 'flat'],
      defaultGeneralSettings.reviewDefaultDisplayMode,
    ),
    reviewNoisePatterns,
    reviewIgnorePatternsCustomized,
  };
}

function normalizeAppearanceSettings(appearance: unknown): AppearanceSettings {
  const record = isRecord(appearance) ? appearance : {};
  const legacyUiFontPreset = normalizeOneOf(
    record.uiFontFamily,
    ['system', 'yahei', 'dengxian', 'song'],
    defaultAppearanceSettings.uiFontPreset,
  );
  const legacyCodeFontPreset = normalizeOneOf(
    record.codeFontFamily,
    ['cascadia', 'jetbrains', 'consolas'],
    defaultAppearanceSettings.codeFontPreset,
  );

  const normalizedSidebarCustomWidth = normalizeSidebarCustomWidth(record.sidebarCustomWidth);
  return {
    themeMode: normalizeOneOf(record.themeMode, ['system', 'light', 'dark'], defaultAppearanceSettings.themeMode),
    density: normalizeOneOf(record.density, ['comfortable', 'compact'], defaultAppearanceSettings.density),
    accentColor: normalizeOneOf(
      record.accentColor,
      ['blue', 'emerald', 'amber', 'rose', 'violet', 'custom'],
      defaultAppearanceSettings.accentColor,
    ),
    accentColorCustom: normalizeAccentHexColor(record.accentColorCustom, defaultAppearanceSettings.accentColorCustom),
    uiFontMode: normalizeOneOf(record.uiFontMode, ['preset', 'custom'], 'uiFontFamily' in record ? 'preset' : defaultAppearanceSettings.uiFontMode),
    uiFontPreset: normalizeOneOf(
      record.uiFontPreset,
      ['codex', 'system', 'segoe', 'yahei', 'dengxian', 'song', 'sourceHanSans', 'misans', 'harmony'],
      legacyUiFontPreset,
    ),
    uiFontCustom: normalizeFontFamilyValue(record.uiFontCustom, defaultAppearanceSettings.uiFontCustom),
    chatFontMode: normalizeOneOf(record.chatFontMode, ['followUi', 'preset', 'custom'], defaultAppearanceSettings.chatFontMode),
    chatFontPreset: normalizeOneOf(
      record.chatFontPreset,
      ['codex', 'system', 'segoe', 'yahei', 'dengxian', 'song', 'sourceHanSans', 'misans', 'harmony'],
      defaultAppearanceSettings.chatFontPreset,
    ),
    chatFontCustom: normalizeFontFamilyValue(record.chatFontCustom, defaultAppearanceSettings.chatFontCustom),
    codeFontMode: normalizeOneOf(record.codeFontMode, ['preset', 'custom'], 'codeFontFamily' in record ? 'preset' : defaultAppearanceSettings.codeFontMode),
    codeFontPreset: normalizeOneOf(
      record.codeFontPreset,
      ['cascadia', 'jetbrains', 'consolas', 'firaCode', 'sourceCodePro'],
      legacyCodeFontPreset,
    ),
    codeFontCustom: normalizeFontFamilyValue(record.codeFontCustom, defaultAppearanceSettings.codeFontCustom),
    uiFontSize: normalizeOneOf(record.uiFontSize, [12, 13, 14, 15], defaultAppearanceSettings.uiFontSize),
    chatFontSize: normalizeOneOf(record.chatFontSize, [13, 14, 15, 16], defaultAppearanceSettings.chatFontSize),
    codeFontSize: normalizeOneOf(record.codeFontSize, [12, 13, 14], defaultAppearanceSettings.codeFontSize),
    sidebarWidth: normalizeOneOf(record.sidebarWidth, ['narrow', 'default', 'wide'], defaultAppearanceSettings.sidebarWidth),
    ...(normalizedSidebarCustomWidth !== undefined ? { sidebarCustomWidth: normalizedSidebarCustomWidth } : {}),
    windowMaterial: normalizeOneOf(
      record.windowMaterial,
      ['auto', 'none', 'mica', 'acrylic', 'micaAlt'],
      defaultAppearanceSettings.windowMaterial,
    ),
  };
}

function normalizeUsageStats(value: unknown): UsageStatsResponse {
  const record = isRecord(value) ? value : {};
  return {
    generatedAt: normalizeOptionalString(record.generatedAt) || new Date(0).toISOString(),
    totals: normalizeUsageTotals(record.totals),
    projectOptions: normalizeUsageProjectRows(record.projectOptions ?? record.byProject),
    byProvider: normalizeUsageProviderRows(record.byProvider),
    byProject: normalizeUsageProjectRows(record.byProject),
    byThread: normalizeUsageThreadRows(record.byThread),
    byDay: normalizeUsageTrendRows(record.byDay),
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
    const fallbackModel = normalizeOptionalString(item.model) || '未配置';
    const lastUsedAt = normalizeNullableString(item.lastUsedAt);
    return [{
      ...totals,
      provider: normalizeOptionalString(item.provider) || 'unknown',
      providerKey: normalizeOptionalString(item.providerKey) || normalizeOptionalString(item.provider) || 'unknown',
      host: normalizeNullableString(item.host),
      inferred: Boolean(item.inferred),
      lastUsedAt,
      models: normalizeUsageProviderModelRows(item.models, fallbackModel, lastUsedAt, totals),
    }];
  });
}

function normalizeUsageProviderModelRows(
  value: unknown,
  fallbackModel: string,
  fallbackLastUsedAt: string | null,
  fallbackTotals: UsageStatsResponse['totals'],
): UsageStatsResponse['byProvider'][number]['models'] {
  if (!Array.isArray(value)) {
    return [{
      ...fallbackTotals,
      model: fallbackModel,
      lastUsedAt: fallbackLastUsedAt,
    }];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    return [{
      ...normalizeUsageTotals(item),
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

function normalizeUsageThreadRows(value: unknown): UsageThreadRow[] {
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
      threadId: normalizeOptionalString(item.threadId),
      projectId: normalizeOptionalString(item.projectId),
      projectName: normalizeOptionalString(item.projectName) || '未命名项目',
      title: normalizeOptionalString(item.title) || '未命名会话',
      sessionId: normalizeOptionalString(item.sessionId),
      provider: normalizeOptionalString(item.provider) || 'unknown',
      model: normalizeOptionalString(item.model) || '未配置',
      workingDirectory: normalizeOptionalString(item.workingDirectory),
      updatedAt: normalizeNullableString(item.updatedAt),
      lastUsedAt: normalizeNullableString(item.lastUsedAt),
    }];
  });
}

function normalizeUsageTrendRows(value: unknown): UsageTrendPoint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    return [{
      date: normalizeOptionalString(item.date),
      ...normalizeUsageTotals(item),
    }];
  }).filter((item) => Boolean(item.date));
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
  const modelCapabilities = normalizeModelCapabilities(record.modelCapabilities);

  return {
    customModels,
    defaultModelId,
    modelCapabilities,
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

function normalizeModelCapabilities(value: unknown): ModelSettings['modelCapabilities'] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenIds = new Set<string>();
  const capabilities: ModelSettings['modelCapabilities'] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const modelId = normalizeModelId(item.modelId);
    if (!modelId || seenIds.has(modelId)) {
      continue;
    }

    seenIds.add(modelId);
    const capability: ModelSettings['modelCapabilities'][number] = { modelId };
    const contextWindowTokens = normalizeContextWindowTokens(item.contextWindowTokens);
    const context1mModel = normalizeModelId(item.context1mModel);
    if (contextWindowTokens !== undefined) {
      capability.contextWindowTokens = contextWindowTokens;
    }
    if (typeof item.supportsContext1m === 'boolean') {
      capability.supportsContext1m = item.supportsContext1m;
    }
    if (context1mModel) {
      capability.context1mModel = context1mModel;
    }
    capabilities.push(capability);
  }

  return capabilities;
}

function normalizeDefaultModelId(value: unknown, customModels: CustomModel[]) {
  const id = normalizeLegacyModelId(normalizeModelId(value));
  if (!id || id === defaultModelSettings.defaultModelId) {
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

function normalizeContextWindowTokens(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 5_000_000) {
    return undefined;
  }

  return value;
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

function normalizeSidebarCustomWidth(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.round(Math.min(480, Math.max(220, value)));
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
