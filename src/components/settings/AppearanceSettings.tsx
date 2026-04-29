import { Code2, Columns3, Monitor, Moon, RotateCcw, Rows3, Sparkles, Sun, Type } from 'lucide-react';
import type { AppearanceSettings, InterfaceDensity, SidebarWidthMode, ThemeMode, WindowMaterialMode } from '../../types';
import { defaultAppearanceSettings, type AppearanceSettingsUpdate } from '../../hooks/useAppSettings';
import { SegmentedControl, SettingsRow, Stepper } from './SettingsControls';

type AppearanceSettingsSectionProps = {
  appearance: AppearanceSettings;
  onUpdateAppearance: (update: AppearanceSettingsUpdate) => void;
};

export function AppearanceSettingsSection({
  appearance,
  onUpdateAppearance,
}: AppearanceSettingsSectionProps) {
  function update(next: Partial<AppearanceSettings>) {
    onUpdateAppearance(next);
  }

  return (
    <section className="settings-page-section settings-appearance-section">
      <header className="settings-section-head">
        <h1>外观</h1>
      </header>

      <div className="appearance-preview" aria-hidden="true">
        <div className="appearance-preview-sidebar">
          <span />
          <span />
          <span />
        </div>
        <div className="appearance-preview-main">
          <div className="appearance-preview-header" />
          <div className="appearance-preview-message" />
          <div className="appearance-preview-message short" />
          <div className="appearance-preview-composer" />
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
        <SettingsRow icon={Type} title="UI 字号" description="调整主要界面文字大小">
          <Stepper
            value={appearance.uiFontSize}
            values={[12, 13, 14, 15]}
            onChange={(uiFontSize) => update({ uiFontSize })}
          />
        </SettingsRow>
        <SettingsRow icon={Code2} title="代码字号" description="调整代码块和等宽文本字号">
          <Stepper
            value={appearance.codeFontSize}
            values={[12, 13, 14]}
            onChange={(codeFontSize) => update({ codeFontSize })}
          />
        </SettingsRow>
        <SettingsRow icon={RotateCcw} title="重置字号" description="恢复 UI 和代码字号默认值">
          <button
            type="button"
            className="settings-action-button"
            onClick={() => update({
              uiFontSize: defaultAppearanceSettings.uiFontSize,
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
