import { useMemo } from 'react';
import type { AppearanceSettings, SettingsSection } from '../../types';
import type { AppearanceSettingsUpdate } from '../../hooks/useAppSettings';
import { AppearanceSettingsSection } from './AppearanceSettings';
import { SettingsEmptySection } from './SettingsEmptySection';
import { SettingsSidebar } from './SettingsSidebar';

type SettingsViewProps = {
  activeSection: SettingsSection;
  appearance: AppearanceSettings;
  onSelectSection: (section: SettingsSection) => void;
  onUpdateAppearance: (update: AppearanceSettingsUpdate) => void;
  onReturnWorkspace: () => void;
};

const sectionTitles: Record<SettingsSection, string> = {
  basic: '基础设置',
  appearance: '外观',
  shortcuts: '快捷键',
  providers: '供应商管理',
  usage: '使用情况',
  sessions: '会话管理',
  mcp: 'MCP 管理',
  skills: 'Skills',
  globalPrompts: '全局提示词',
  openWith: '打开方式',
};

export function SettingsView({
  activeSection,
  appearance,
  onSelectSection,
  onUpdateAppearance,
  onReturnWorkspace,
}: SettingsViewProps) {
  const content = useMemo(() => {
    if (activeSection === 'appearance') {
      return (
        <AppearanceSettingsSection
          appearance={appearance}
          onUpdateAppearance={onUpdateAppearance}
        />
      );
    }

    return <SettingsEmptySection title={sectionTitles[activeSection]} />;
  }, [activeSection, appearance, onUpdateAppearance]);

  return (
    <main className="settings-view">
      <SettingsSidebar
        activeSection={activeSection}
        onSelectSection={onSelectSection}
        onReturnWorkspace={onReturnWorkspace}
      />
      <div className="settings-content">
        {content}
      </div>
    </main>
  );
}
