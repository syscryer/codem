import type { ReactNode } from 'react';
import { Code2, Columns3, Minus, Monitor, Moon, Plus, Rows3, Sun, Type } from 'lucide-react';
import type { AppearanceSettings, InterfaceDensity, SidebarWidthMode, ThemeMode } from '../../types';
import type { AppearanceSettingsUpdate } from '../../hooks/useAppSettings';

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

type SettingsRowProps = {
  icon: typeof Monitor;
  title: string;
  description: string;
  children: ReactNode;
};

function SettingsRow({ icon: Icon, title, description, children }: SettingsRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <Icon size={15} />
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
  icon?: typeof Monitor;
};

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<SegmentedControlOption<T>>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="settings-segmented">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            className={option.value === value ? 'active' : ''}
            onClick={() => onChange(option.value)}
          >
            {Icon ? <Icon size={13} /> : null}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Stepper<T extends number>({
  value,
  values,
  onChange,
}: {
  value: T;
  values: readonly T[];
  onChange: (value: T) => void;
}) {
  const currentIndex = values.indexOf(value);
  const canDecrease = currentIndex > 0;
  const canIncrease = currentIndex >= 0 && currentIndex < values.length - 1;

  return (
    <div className="settings-stepper">
      <button
        type="button"
        disabled={!canDecrease}
        onClick={() => canDecrease && onChange(values[currentIndex - 1])}
        aria-label="减小"
      >
        <Minus size={12} />
      </button>
      <span>{value}</span>
      <button
        type="button"
        disabled={!canIncrease}
        onClick={() => canIncrease && onChange(values[currentIndex + 1])}
        aria-label="增大"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}
