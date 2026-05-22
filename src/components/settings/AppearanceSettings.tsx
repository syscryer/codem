import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronDown, Code2, Columns3, MessageSquareQuote, Monitor, Moon, Palette, RotateCcw, Rows3, Sparkles, Sun, Type } from 'lucide-react';
import {
  ACCENT_COLOR_PRESETS,
  CODE_FONT_PRESETS,
  normalizeAccentHexColor,
  UI_FONT_PRESETS,
} from '../../constants';
import type {
  AppearanceSettings,
  ChatFontSettingMode,
  CodeFontFamilyPreset,
  FontSettingMode,
  InterfaceDensity,
  SidebarWidthMode,
  ThemeMode,
  UiFontFamilyPreset,
  WindowMaterialMode,
} from '../../types';
import { defaultAppearanceSettings, type AppearanceSettingsUpdate } from '../../hooks/useAppSettings';
import { useOutsideDismiss } from '../../hooks/useOutsideDismiss';
import { PopoverPortal } from '../PopoverPortal';
import { SegmentedControl, SettingsRow, Stepper } from './SettingsControls';

type AppearanceSettingsSectionProps = {
  appearance: AppearanceSettings;
  onUpdateAppearance: (update: AppearanceSettingsUpdate) => void;
};

type FontControlPreset<T extends string> = {
  value: T;
  label: string;
};

type FontControlMode<T extends string> = {
  value: T;
  label: string;
};

export function AppearanceSettingsSection({
  appearance,
  onUpdateAppearance,
}: AppearanceSettingsSectionProps) {
  const [accentDraft, setAccentDraft] = useState(() => appearance.accentColorCustom);
  const [fontDrafts, setFontDrafts] = useState(() => ({
    ui: appearance.uiFontCustom,
    chat: appearance.chatFontCustom,
    code: appearance.codeFontCustom,
  }));

  useEffect(() => {
    setAccentDraft(appearance.accentColorCustom);
  }, [appearance.accentColorCustom]);

  useEffect(() => {
    setFontDrafts({
      ui: appearance.uiFontCustom,
      chat: appearance.chatFontCustom,
      code: appearance.codeFontCustom,
    });
  }, [appearance.uiFontCustom, appearance.chatFontCustom, appearance.codeFontCustom]);

  function update(next: Partial<AppearanceSettings>) {
    onUpdateAppearance(next);
  }

  function updateDraft(key: keyof typeof fontDrafts, value: string) {
    setFontDrafts((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function commitCustomAccent(value: string) {
    const nextValue = normalizeAccentHexColor(value, defaultAppearanceSettings.accentColorCustom);
    setAccentDraft(nextValue);
    update({
      accentColor: 'custom',
      accentColorCustom: nextValue,
    });
  }

  function commitCustomFont(
    key: keyof typeof fontDrafts,
    field: 'uiFontCustom' | 'chatFontCustom' | 'codeFontCustom',
    fallback: string,
  ) {
    const nextValue = fontDrafts[key].trim() || fallback;
    setFontDrafts((current) => ({
      ...current,
      [key]: nextValue,
    }));
    update({ [field]: nextValue } as Pick<AppearanceSettings, typeof field>);
  }

  return (
    <section className="settings-page-section settings-appearance-section">
      <header className="settings-section-head">
        <h1>外观</h1>
      </header>

      <div className="appearance-preview" aria-hidden="true">
        <div className="appearance-preview-sidebar">
          <span className="appearance-preview-sidebar-accent" />
          <span className="appearance-preview-sidebar-line" />
          <span className="appearance-preview-sidebar-line short" />
        </div>
        <div className="appearance-preview-main">
          <div className="appearance-preview-header">
            <span>CodeM 预览</span>
            <i />
          </div>
          <div className="appearance-preview-message">聊天正文示例</div>
          <div className="appearance-preview-message short">阅读节奏与字面观感</div>
          <div className="appearance-preview-code">
            <div className="appearance-preview-code-pane neutral">
              <div className="appearance-preview-code-line">
                <span>1</span>
                <code>const previewCard = {'{'}</code>
              </div>
              <div className="appearance-preview-code-line">
                <span>2</span>
                <code>font: &quot;chat / code&quot;,</code>
              </div>
              <div className="appearance-preview-code-line">
                <span>3</span>
                <code>size: &quot;follow settings&quot;,</code>
              </div>
              <div className="appearance-preview-code-line">
                <span>4</span>
                <code>{'}'}</code>
              </div>
            </div>
          </div>
          <div className="appearance-preview-footer" />
        </div>
      </div>

      <div className="settings-panel">
        <SettingsRow icon={Monitor} title="主题" description="选择 CodeM 的明暗显示方式">
          <SegmentedControl<ThemeMode>
            value={appearance.themeMode}
            options={[
              { value: 'system', label: '系统', icon: Monitor },
              { value: 'light', label: '浅色', icon: Sun },
              { value: 'dark', label: '深色', icon: Moon },
            ]}
            onChange={(themeMode) => update({ themeMode })}
          />
        </SettingsRow>
        <SettingsRow icon={Palette} title="强调色" description="统一控制主按钮、选中态和关键提示色">
          <div className="settings-accent-picker">
            {ACCENT_COLOR_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className={preset.value === appearance.accentColor ? 'active' : ''}
                onClick={() => update({ accentColor: preset.value })}
                aria-label={preset.label}
                title={preset.label}
              >
                <span
                  className="settings-accent-swatch"
                  style={{ '--accent-swatch-light': preset.light, '--accent-swatch-dark': preset.dark } as CSSProperties}
                />
                <span>{preset.label}</span>
              </button>
            ))}
            <div className={`settings-accent-custom${appearance.accentColor === 'custom' ? ' active' : ''}`}>
              <label className="settings-accent-custom-trigger" title="选择自定义颜色">
                <input
                  className="settings-accent-native-picker"
                  type="color"
                  value={normalizeAccentHexColor(accentDraft, defaultAppearanceSettings.accentColorCustom)}
                  aria-label="选择自定义强调色"
                  onChange={(event) => {
                    const nextValue = normalizeAccentHexColor(event.target.value, defaultAppearanceSettings.accentColorCustom);
                    setAccentDraft(nextValue);
                    update({
                      accentColor: 'custom',
                      accentColorCustom: nextValue,
                    });
                  }}
                />
                <span
                  className="settings-accent-swatch"
                  style={{
                    '--accent-swatch-light': normalizeAccentHexColor(accentDraft, defaultAppearanceSettings.accentColorCustom),
                    '--accent-swatch-dark': normalizeAccentHexColor(accentDraft, defaultAppearanceSettings.accentColorCustom),
                  } as CSSProperties}
                />
                <span>自选</span>
              </label>
              <input
                className="settings-input settings-accent-value-input"
                value={accentDraft}
                aria-label="自定义强调色值"
                placeholder="#2374C6"
                maxLength={7}
                spellCheck={false}
                onFocus={() => {
                  if (appearance.accentColor !== 'custom') {
                    update({ accentColor: 'custom' });
                  }
                }}
                onChange={(event) => setAccentDraft(event.target.value)}
                onBlur={() => commitCustomAccent(accentDraft)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitCustomAccent(accentDraft);
                  }
                }}
              />
            </div>
          </div>
        </SettingsRow>
        <SettingsRow icon={Sparkles} title="窗口材质" description="设置桌面版启动后的默认 Windows 背景材质">
          <SegmentedControl<WindowMaterialMode>
            value={appearance.windowMaterial}
            options={[
              { value: 'auto', label: '自动' },
              { value: 'none', label: '无' },
              { value: 'mica', label: 'Mica' },
              { value: 'acrylic', label: 'Acrylic' },
              { value: 'micaAlt', label: 'Mica Alt' },
            ]}
            onChange={(windowMaterial) => update({ windowMaterial })}
          />
        </SettingsRow>
        <SettingsRow icon={Rows3} title="界面密度" description="控制列表、消息和底部状态栏间距">
          <SegmentedControl<InterfaceDensity>
            value={appearance.density}
            options={[
              { value: 'comfortable', label: '舒适' },
              { value: 'compact', label: '紧凑' },
            ]}
            onChange={(density) => update({ density })}
          />
        </SettingsRow>
        <SettingsRow icon={Type} title="界面字体" description="用于菜单、侧栏、按钮和设置页">
          <FontFamilyControl<FontSettingMode, UiFontFamilyPreset>
            modeValue={appearance.uiFontMode}
            modeOptions={[
              { value: 'preset', label: '预设字体' },
              { value: 'custom', label: '手动输入' },
            ]}
            onModeChange={(uiFontMode) => update({ uiFontMode })}
            presetValue={appearance.uiFontPreset}
            presetOptions={UI_FONT_PRESETS}
            onPresetChange={(uiFontPreset) => update({ uiFontPreset })}
            customValue={fontDrafts.ui}
            customPlaceholder='例如 MiSans 或 "MiSans", "Microsoft YaHei UI", sans-serif'
            followText=""
            onCustomChange={(value) => updateDraft('ui', value)}
            onCustomCommit={() => commitCustomFont('ui', 'uiFontCustom', defaultAppearanceSettings.uiFontCustom)}
          />
        </SettingsRow>
        <SettingsRow icon={MessageSquareQuote} title="聊天字体" description="用于消息正文和 Markdown 阅读内容">
          <FontFamilyControl<ChatFontSettingMode, UiFontFamilyPreset>
            modeValue={appearance.chatFontMode}
            modeOptions={[
              { value: 'followUi', label: '跟随界面' },
              { value: 'preset', label: '预设字体' },
              { value: 'custom', label: '手动输入' },
            ]}
            onModeChange={(chatFontMode) => update({ chatFontMode })}
            presetValue={appearance.chatFontPreset}
            presetOptions={UI_FONT_PRESETS}
            onPresetChange={(chatFontPreset) => update({ chatFontPreset })}
            customValue={fontDrafts.chat}
            customPlaceholder='例如 思源黑体 或 "Source Han Sans SC", "Noto Sans CJK SC", sans-serif'
            followText="跟随界面字体"
            onCustomChange={(value) => updateDraft('chat', value)}
            onCustomCommit={() => commitCustomFont('chat', 'chatFontCustom', defaultAppearanceSettings.chatFontCustom)}
          />
        </SettingsRow>
        <SettingsRow icon={Code2} title="代码字体" description="用于代码块、终端、日志和 Diff">
          <FontFamilyControl<FontSettingMode, CodeFontFamilyPreset>
            modeValue={appearance.codeFontMode}
            modeOptions={[
              { value: 'preset', label: '预设字体' },
              { value: 'custom', label: '手动输入' },
            ]}
            onModeChange={(codeFontMode) => update({ codeFontMode })}
            presetValue={appearance.codeFontPreset}
            presetOptions={CODE_FONT_PRESETS}
            onPresetChange={(codeFontPreset) => update({ codeFontPreset })}
            customValue={fontDrafts.code}
            customPlaceholder='例如 JetBrains Mono 或 "JetBrains Mono", "Cascadia Code", Consolas, monospace'
            followText=""
            onCustomChange={(value) => updateDraft('code', value)}
            onCustomCommit={() => commitCustomFont('code', 'codeFontCustom', defaultAppearanceSettings.codeFontCustom)}
          />
        </SettingsRow>
        <SettingsRow icon={Type} title="UI 字号" description="调整主要界面文字大小">
          <Stepper
            value={appearance.uiFontSize}
            values={[12, 13, 14, 15]}
            onChange={(uiFontSize) => update({ uiFontSize })}
          />
        </SettingsRow>
        <SettingsRow icon={MessageSquareQuote} title="聊天字号" description="调整消息正文和 Markdown 阅读大小">
          <Stepper
            value={appearance.chatFontSize}
            values={[13, 14, 15, 16]}
            onChange={(chatFontSize) => update({ chatFontSize })}
          />
        </SettingsRow>
        <SettingsRow icon={Code2} title="代码字号" description="调整代码块和等宽文本字号">
          <Stepper
            value={appearance.codeFontSize}
            values={[12, 13, 14]}
            onChange={(codeFontSize) => update({ codeFontSize })}
          />
        </SettingsRow>
        <SettingsRow icon={RotateCcw} title="重置字体" description="恢复默认字体族与字号">
          <button
            type="button"
            className="settings-action-button"
            onClick={() => update({
              uiFontMode: defaultAppearanceSettings.uiFontMode,
              uiFontPreset: defaultAppearanceSettings.uiFontPreset,
              uiFontCustom: defaultAppearanceSettings.uiFontCustom,
              chatFontMode: defaultAppearanceSettings.chatFontMode,
              chatFontPreset: defaultAppearanceSettings.chatFontPreset,
              chatFontCustom: defaultAppearanceSettings.chatFontCustom,
              codeFontMode: defaultAppearanceSettings.codeFontMode,
              codeFontPreset: defaultAppearanceSettings.codeFontPreset,
              codeFontCustom: defaultAppearanceSettings.codeFontCustom,
              uiFontSize: defaultAppearanceSettings.uiFontSize,
              chatFontSize: defaultAppearanceSettings.chatFontSize,
              codeFontSize: defaultAppearanceSettings.codeFontSize,
            })}
          >
            <RotateCcw size={14} />
            <span>重置</span>
          </button>
        </SettingsRow>
        <SettingsRow icon={Columns3} title="侧边栏宽度" description="调整项目侧栏宽度">
          <SegmentedControl<SidebarWidthMode>
            value={appearance.sidebarWidth}
            options={[
              { value: 'narrow', label: '窄' },
              { value: 'default', label: '默认' },
              { value: 'wide', label: '宽' },
            ]}
            onChange={(sidebarWidth) => update({ sidebarWidth })}
          />
        </SettingsRow>
      </div>
    </section>
  );
}

function FontFamilyControl<TMode extends string, TPreset extends string>({
  modeValue,
  modeOptions,
  onModeChange,
  presetValue,
  presetOptions,
  onPresetChange,
  customValue,
  customPlaceholder,
  followText,
  onCustomChange,
  onCustomCommit,
}: {
  modeValue: TMode;
  modeOptions: readonly FontControlMode<TMode>[];
  onModeChange: (value: TMode) => void;
  presetValue: TPreset;
  presetOptions: readonly FontControlPreset<TPreset>[];
  onPresetChange: (value: TPreset) => void;
  customValue: string;
  customPlaceholder: string;
  followText: string;
  onCustomChange: (value: string) => void;
  onCustomCommit: () => void;
}) {
  const customVisible = modeValue === ('custom' as TMode);
  const followVisible = modeValue === ('followUi' as TMode);
  const presetVisible = !customVisible && !followVisible;

  return (
    <div className="settings-font-control">
      <div className="settings-font-main">
        <SettingsDropdown
          value={modeValue}
          options={modeOptions}
          ariaLabel="选择字体模式"
          onChange={onModeChange}
        />
        {customVisible ? (
          <input
            className="settings-input settings-font-custom-input"
            value={customValue}
            placeholder={customPlaceholder}
            title="支持直接输入字体名，或输入完整 font-family 栈。"
            aria-label="自定义字体"
            onChange={(event) => onCustomChange(event.target.value)}
            onBlur={onCustomCommit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onCustomCommit();
              }
            }}
          />
        ) : followVisible ? (
          <div className="settings-font-follow-text">{followText}</div>
        ) : presetVisible ? (
          <SettingsDropdown
            value={presetValue}
            options={presetOptions}
            ariaLabel="选择字体预设"
            onChange={onPresetChange}
          />
        ) : null}
      </div>
    </div>
  );
}

function SettingsDropdown<T extends string>({
  value,
  options,
  ariaLabel,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  ariaLabel: string;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useOutsideDismiss({
    selectors: [
      { selector: '.settings-select-menu', onDismiss: () => setOpen(false), anchorRefs: [anchorRef] },
    ],
  });

  return (
    <div className="settings-select-anchor" ref={anchorRef}>
      <button
        type="button"
        className={`settings-select-trigger${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected?.label ?? ''}</span>
        <ChevronDown size={15} className="settings-select-chevron" />
      </button>
      <PopoverPortal open={open} anchorRef={anchorRef} placement="bottom-start" offset={8}>
        <div className="settings-select-menu" role="menu" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`settings-select-menu-item${option.value === value ? ' current' : ''}`}
              role="menuitemradio"
              aria-checked={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check size={15} /> : null}
            </button>
          ))}
        </div>
      </PopoverPortal>
    </div>
  );
}
