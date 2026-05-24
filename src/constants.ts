import type {
  AccentColorPreset,
  AppearanceSettings,
  CodeFontFamilyPreset,
  PanelState,
  PermissionMode,
  UiFontFamilyPreset,
} from './types';

export const DEFAULT_MODEL_VALUE = '__default';
export const CLAUDE_MODEL_SLOT_VALUES = ['sonnet', 'sonnet[1m]', 'opus', 'opus[1m]', 'haiku'] as const;

export const permissionModes = [
  'default',
  'plan',
  'acceptEdits',
  'auto',
  'dontAsk',
  'bypassPermissions',
] as const satisfies readonly PermissionMode[];

export const permissionMenuModes = [
  'default',
  'auto',
  'bypassPermissions',
] as const satisfies readonly PermissionMode[];

export const EMPTY_PANEL_STATE: PanelState = {
  organizeBy: 'project',
  sortBy: 'updated',
  visibility: 'all',
};

export const DEFAULT_CUSTOM_ACCENT_COLOR = '#2374C6';

export const ACCENT_COLOR_PRESETS = [
  { value: 'blue', label: '海蓝', light: '#2374c6', dark: '#73b7ff' },
  { value: 'emerald', label: '松绿', light: '#168264', dark: '#57d8ae' },
  { value: 'amber', label: '琥珀', light: '#c97a19', dark: '#ffbf66' },
  { value: 'rose', label: '蔷薇', light: '#c85f82', dark: '#ff9db8' },
  { value: 'violet', label: '靛紫', light: '#7460de', dark: '#ac9cff' },
] as const satisfies ReadonlyArray<{
  value: AccentColorPreset;
  label: string;
  light: string;
  dark: string;
}>;

export const UI_FONT_PRESETS = [
  { value: 'system', label: '系统' },
  { value: 'segoe', label: 'Segoe UI' },
  { value: 'yahei', label: '微软雅黑' },
  { value: 'dengxian', label: '等线' },
  { value: 'song', label: '宋体' },
  { value: 'sourceHanSans', label: '思源黑体' },
  { value: 'misans', label: 'MiSans' },
  { value: 'harmony', label: 'HarmonyOS Sans' },
] as const satisfies ReadonlyArray<{
  value: UiFontFamilyPreset;
  label: string;
}>;

export const CODE_FONT_PRESETS = [
  { value: 'cascadia', label: 'Cascadia' },
  { value: 'jetbrains', label: 'JetBrains' },
  { value: 'consolas', label: 'Consolas' },
  { value: 'firaCode', label: 'Fira Code' },
  { value: 'sourceCodePro', label: 'Source Code Pro' },
] as const satisfies ReadonlyArray<{
  value: CodeFontFamilyPreset;
  label: string;
}>;

export const ACCENT_COLOR_VALUES: Record<AccentColorPreset, { light: string; dark: string }> =
  Object.fromEntries(ACCENT_COLOR_PRESETS.map((preset) => [preset.value, { light: preset.light, dark: preset.dark }])) as Record<
    AccentColorPreset,
    { light: string; dark: string }
  >;

export function normalizeAccentHexColor(value: unknown, fallback = DEFAULT_CUSTOM_ACCENT_COLOR) {
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

function createDarkAccentColor(lightHex: string) {
  const normalized = normalizeAccentHexColor(lightHex);
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  const boost = 0.24;
  const mix = (channel: number) => Math.round(channel + (255 - channel) * boost);
  return `#${[mix(red), mix(green), mix(blue)]
    .map((channel) => channel.toString(16).padStart(2, '0').toUpperCase())
    .join('')}`;
}

export function resolveAccentColors(appearance: Pick<AppearanceSettings, 'accentColor' | 'accentColorCustom'>) {
  if (appearance.accentColor === 'custom') {
    const light = normalizeAccentHexColor(appearance.accentColorCustom);
    return {
      light,
      dark: createDarkAccentColor(light),
    };
  }

  return ACCENT_COLOR_VALUES[appearance.accentColor];
}

export const UI_FONT_STACKS: Record<UiFontFamilyPreset, string> = {
  system: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif',
  segoe: '"Segoe UI Variable Text", "Segoe UI Variable Display", "Segoe UI", sans-serif',
  yahei: '"Microsoft YaHei UI", "Segoe UI", sans-serif',
  dengxian: '"DengXian", "Microsoft YaHei UI", "Segoe UI", sans-serif',
  song: '"SimSun", "NSimSun", serif',
  sourceHanSans: '"Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei UI", sans-serif',
  misans: '"MiSans", "Microsoft YaHei UI", "Segoe UI", sans-serif',
  harmony: '"HarmonyOS Sans SC", "HarmonyOS Sans", "Microsoft YaHei UI", sans-serif',
};

export const CODE_FONT_STACKS: Record<CodeFontFamilyPreset, string> = {
  cascadia: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
  jetbrains: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
  consolas: 'Consolas, "Cascadia Code", monospace',
  firaCode: '"Fira Code", "Cascadia Code", Consolas, monospace',
  sourceCodePro: '"Source Code Pro", "Cascadia Code", Consolas, monospace',
};

export function resolveUiFontStack(appearance: AppearanceSettings) {
  return appearance.uiFontMode === 'custom'
    ? appearance.uiFontCustom
    : UI_FONT_STACKS[appearance.uiFontPreset];
}

export function resolveChatFontStack(appearance: AppearanceSettings) {
  if (appearance.chatFontMode === 'followUi') {
    return resolveUiFontStack(appearance);
  }

  return appearance.chatFontMode === 'custom'
    ? appearance.chatFontCustom
    : UI_FONT_STACKS[appearance.chatFontPreset];
}

export function resolveCodeFontStack(appearance: AppearanceSettings) {
  return appearance.codeFontMode === 'custom'
    ? appearance.codeFontCustom
    : CODE_FONT_STACKS[appearance.codeFontPreset];
}
