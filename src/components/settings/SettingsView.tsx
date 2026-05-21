import { useMemo } from 'react';
import type {
  AppearanceSettings,
  ClaudeModelInfo,
  GeneralSettings,
  ModelSettings,
  OpenAppTarget,
  OpenWithSettings,
  ProjectSummary,
  SettingsSection,
  ShortcutSettings,
  ToastState,
  WorkspaceBootstrap,
} from '../../types';
import type {
  AppearanceSettingsUpdate,
  GeneralSettingsUpdate,
  ModelSettingsUpdate,
  OpenWithSettingsUpdate,
  ShortcutSettingsUpdate,
} from '../../hooks/useAppSettings';
import { AppearanceSettingsSection } from './AppearanceSettings';
import { BasicSettingsSection } from './BasicSettings';
import { GlobalPromptSettingsSection } from './GlobalPromptSettings';
import { McpSettingsSection } from './McpSettings';
import { ModelSettingsSection } from './ModelSettings';
import { OpenWithSettingsSection } from './OpenWithSettings';
import { SettingsEmptySection } from './SettingsEmptySection';
import { SettingsSidebar } from './SettingsSidebar';
import { PluginsSettingsSection } from './PluginsSettings';
import { ShortcutsSettingsSection } from './ShortcutsSettings';
import { UsageSettingsSection } from './UsageSettings';
import { WorktreeSettingsSection } from './WorktreeSettings';

type SettingsViewProps = {
  activeSection: SettingsSection;
  activeProject: ProjectSummary | null;
  projects: ProjectSummary[];
  general: GeneralSettings;
  appearance: AppearanceSettings;
  models: ModelSettings;
  shortcuts: ShortcutSettings;
  openWith: OpenWithSettings;
  openTargets: OpenAppTarget[];
  claudeModels: ClaudeModelInfo;
  onSelectSection: (section: SettingsSection) => void;
  onOpenWorktreePath: (worktreePath: string) => Promise<void>;
  onSyncWorkspace: (workspace: WorkspaceBootstrap) => void;
  showToast: (message: string, tone?: ToastState['tone']) => void;
  onUpdateGeneral: (update: GeneralSettingsUpdate) => void | Promise<void>;
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
  worktree: '工作树',
  mcp: 'MCP 管理',
  plugins: '插件管理',
  globalPrompts: '全局提示词',
  openWith: '打开方式',
};

export function SettingsView({
  activeSection,
  activeProject,
  projects,
  general,
  appearance,
  models,
  shortcuts,
  openWith,
  openTargets,
  claudeModels,
  onSelectSection,
  onOpenWorktreePath,
  onSyncWorkspace,
  showToast,
  onUpdateGeneral,
  onUpdateAppearance,
  onUpdateModels,
  onUpdateShortcuts,
  onUpdateOpenWith,
  onReturnWorkspace,
}: SettingsViewProps) {
  const content = useMemo(() => {
    if (activeSection === 'basic') {
      return (
        <BasicSettingsSection
          general={general}
          onUpdateGeneral={onUpdateGeneral}
        />
      );
    }

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
          openTargets={openTargets}
          onUpdateOpenWith={onUpdateOpenWith}
        />
      );
    }

    if (activeSection === 'globalPrompts') {
      return <GlobalPromptSettingsSection />;
    }

    if (activeSection === 'usage') {
      return <UsageSettingsSection />;
    }

    if (activeSection === 'mcp') {
      return <McpSettingsSection projectPath={activeProject?.path} />;
    }

    if (activeSection === 'worktree') {
      return (
        <WorktreeSettingsSection
          activeProject={activeProject}
          projects={projects}
          onOpenWorktreePath={onOpenWorktreePath}
          onSyncWorkspace={onSyncWorkspace}
          showToast={showToast}
        />
      );
    }

    if (activeSection === 'plugins') {
      return <PluginsSettingsSection />;
    }

    return <SettingsEmptySection title={sectionTitles[activeSection]} />;
  }, [
    activeSection,
    activeProject,
    appearance,
    claudeModels,
    general,
    models,
    openWith,
    openTargets,
    projects,
    shortcuts,
    onOpenWorktreePath,
    onSyncWorkspace,
    onUpdateGeneral,
    onUpdateAppearance,
    onUpdateModels,
    onUpdateOpenWith,
    onUpdateShortcuts,
    showToast,
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
