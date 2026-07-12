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
  ThreadSummary,
  ToastState,
  WindowMaterialMode,
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
import { AgentModelSettingsSection } from './AgentModelSettings';
import { BasicSettingsSection } from './BasicSettings';
import { GlobalPromptSettingsSection } from './GlobalPromptSettings';
import { McpSettingsSection } from './McpSettings';
import { OpenWithSettingsSection } from './OpenWithSettings';
import { SettingsEmptySection } from './SettingsEmptySection';
import { SettingsSidebar } from './SettingsSidebar';
import { SessionManagementSettingsSection } from './SessionManagementSettings';
import { PluginsSettingsSection } from './PluginsSettings';
import { ShortcutsSettingsSection } from './ShortcutsSettings';
import { UsageSettingsSection } from './UsageSettings';
import { WorktreeSettingsSection } from './WorktreeSettings';

type SettingsViewProps = {
  hidden?: boolean;
  activeSection: SettingsSection;
  activeProjectId: string | null;
  activeThreadId: string | null;
  activeProject: ProjectSummary | null;
  projects: ProjectSummary[];
  runningThreadIds: string[];
  general: GeneralSettings;
  appearance: AppearanceSettings;
  effectiveWindowMaterial: WindowMaterialMode;
  supportedWindowMaterials: WindowMaterialMode[];
  models: ModelSettings;
  shortcuts: ShortcutSettings;
  openWith: OpenWithSettings;
  openTargets: OpenAppTarget[];
  claudeModels: ClaudeModelInfo;
  onSelectSection: (section: SettingsSection) => void;
  onOpenThread: (projectId: string, threadId: string) => void | Promise<void>;
  onRemoveProject: (project: ProjectSummary) => void;
  onRenameThread: (thread: ThreadSummary) => void;
  onRemoveThread: (thread: ThreadSummary) => void;
  onOpenWorktreePath: (worktreePath: string) => Promise<void>;
  onSyncWorkspace: (workspace: WorkspaceBootstrap) => void;
  showToast: (message: string, tone?: ToastState['tone']) => void;
  onUpdateGeneral: (update: GeneralSettingsUpdate) => void | Promise<void>;
  onUpdateAppearance: (update: AppearanceSettingsUpdate) => void;
  onUpdateSidebarCustomWidth: (width: number | undefined) => void;
  onUpdateModels: (update: ModelSettingsUpdate) => void | Promise<void>;
  onUpdateShortcuts: (update: ShortcutSettingsUpdate) => void | Promise<void>;
  onUpdateOpenWith: (update: OpenWithSettingsUpdate) => void | Promise<void>;
  onReturnWorkspace: () => void;
};

const sectionTitles: Record<SettingsSection, string> = {
  basic: '基础设置',
  appearance: '外观',
  shortcuts: '快捷键',
  providers: 'Agent 与模型',
  usage: '使用情况',
  sessions: '会话管理',
  worktree: '工作树',
  mcp: 'MCP 管理',
  plugins: '插件管理',
  globalPrompts: '全局提示词',
  openWith: '打开方式',
};

export function SettingsView({
  hidden = false,
  activeSection,
  activeProjectId,
  activeThreadId,
  activeProject,
  projects,
  runningThreadIds,
  general,
  appearance,
  effectiveWindowMaterial,
  supportedWindowMaterials,
  models,
  shortcuts,
  openWith,
  openTargets,
  claudeModels,
  onSelectSection,
  onOpenThread,
  onRemoveProject,
  onRenameThread,
  onRemoveThread,
  onOpenWorktreePath,
  onSyncWorkspace,
  showToast,
  onUpdateGeneral,
  onUpdateAppearance,
  onUpdateSidebarCustomWidth,
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
          effectiveWindowMaterial={effectiveWindowMaterial}
          supportedWindowMaterials={supportedWindowMaterials}
          onUpdateAppearance={onUpdateAppearance}
        />
      );
    }

    if (activeSection === 'providers') {
      return (
        <AgentModelSettingsSection
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

    if (activeSection === 'sessions') {
      return (
        <SessionManagementSettingsSection
          activeProjectId={activeProjectId}
          activeThreadId={activeThreadId}
          projects={projects}
          runningThreadIds={runningThreadIds}
          onOpenThread={onOpenThread}
          onRemoveProject={onRemoveProject}
          onRenameThread={onRenameThread}
          onRemoveThread={onRemoveThread}
          onSyncWorkspace={onSyncWorkspace}
          showToast={showToast}
        />
      );
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
    activeProjectId,
    activeThreadId,
    activeProject,
    appearance,
    effectiveWindowMaterial,
    claudeModels,
    general,
    models,
    openWith,
    openTargets,
    projects,
    runningThreadIds,
    shortcuts,
    supportedWindowMaterials,
    onOpenThread,
    onRenameThread,
    onRemoveThread,
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
    <main className="settings-view" hidden={hidden}>
      <SettingsSidebar
        activeSection={activeSection}
        sidebarCustomWidth={appearance.sidebarCustomWidth}
        onSelectSection={onSelectSection}
        onUpdateSidebarCustomWidth={onUpdateSidebarCustomWidth}
        onReturnWorkspace={onReturnWorkspace}
      />
      <div className="settings-content">
        {content}
      </div>
    </main>
  );
}
