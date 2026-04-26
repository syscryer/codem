import { useMemo } from 'react';
import type {
  AppearanceSettings,
  ClaudeModelInfo,
  ModelSettings,
  OpenWithSettings,
  SettingsSection,
  ShortcutSettings,
} from '../../types';
import type {
  AppearanceSettingsUpdate,
  ModelSettingsUpdate,
  OpenWithSettingsUpdate,
  ShortcutSettingsUpdate,
} from '../../hooks/useAppSettings';
import { AppearanceSettingsSection } from './AppearanceSettings';
import { GlobalPromptSettingsSection } from './GlobalPromptSettings';
import { McpSettingsSection } from './McpSettings';
import { ModelSettingsSection } from './ModelSettings';
import { OpenWithSettingsSection } from './OpenWithSettings';
import { SettingsEmptySection } from './SettingsEmptySection';
import { SettingsSidebar } from './SettingsSidebar';
import { SkillsSettingsSection } from './SkillsSettings';
import { ShortcutsSettingsSection } from './ShortcutsSettings';

type SettingsViewProps = {
  activeSection: SettingsSection;
  appearance: AppearanceSettings;
  models: ModelSettings;
  shortcuts: ShortcutSettings;
  openWith: OpenWithSettings;
  claudeModels: ClaudeModelInfo;
  onSelectSection: (section: SettingsSection) => void;
  onUpdateAppearance: (update: AppearanceSettingsUpdate) => void;
  onUpdateModels: (update: ModelSettingsUpdate) => void | Promise<void>;
  onUpdateShortcuts: (update: ShortcutSettingsUpdate) => void | Promise<void>;
  onUpdateOpenWith: (update: OpenWithSettingsUpdate) => void | Promise<void>;
  onReturnWorkspace: () => void;
};

const sectionTitles: Record<SettingsSection, string> = {
  basic: '基础设置',
  appearance: '外观',
  shortcuts: '快捷键',
  providers: '模型设置',
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
  models,
  shortcuts,
  openWith,
  claudeModels,
  onSelectSection,
  onUpdateAppearance,
  onUpdateModels,
  onUpdateShortcuts,
  onUpdateOpenWith,
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

    if (activeSection === 'providers') {
      return (
        <ModelSettingsSection
          models={models}
          claudeModels={claudeModels}
          onUpdateModels={onUpdateModels}
        />
      );
    }

    if (activeSection === 'shortcuts') {
      return (
        <ShortcutsSettingsSection
          shortcuts={shortcuts}
          onUpdateShortcuts={onUpdateShortcuts}
        />
      );
    }

    if (activeSection === 'openWith') {
      return (
        <OpenWithSettingsSection
          openWith={openWith}
          onUpdateOpenWith={onUpdateOpenWith}
        />
      );
    }

    if (activeSection === 'globalPrompts') {
      return <GlobalPromptSettingsSection />;
    }

    if (activeSection === 'mcp') {
      return <McpSettingsSection />;
    }

    if (activeSection === 'skills') {
      return <SkillsSettingsSection />;
    }

    return <SettingsEmptySection title={sectionTitles[activeSection]} />;
  }, [
    activeSection,
    appearance,
    claudeModels,
    models,
    openWith,
    shortcuts,
    onUpdateAppearance,
    onUpdateModels,
    onUpdateOpenWith,
    onUpdateShortcuts,
  ]);

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
