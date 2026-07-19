import { useMemo } from 'react';
import type {
  AppearanceSettings,
  AgentNetworkProxySettings,
  AgentChannelBootstrap,
  AgentChannelSettingsFocus,
  AgentRuntimeSettings,
  AgentProviderDescriptor,
  AiChatProvider,
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
  AgentRuntimeSettingsUpdate,
  GeneralSettingsUpdate,
  ModelSettingsUpdate,
  OpenWithSettingsUpdate,
  ShortcutSettingsUpdate,
  AgentNetworkProxySettingsUpdate,
} from '../../hooks/useAppSettings';
import { AppearanceSettingsSection } from './AppearanceSettings';
import { AgentModelSettingsSection } from './AgentModelSettings';
import { AiProviderSettingsSection } from './AiProviderSettings';
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
import { NetworkProxySettingsSection } from './NetworkProxySettings';

type SettingsViewProps = {
  hidden?: boolean;
  activeSection: SettingsSection;
  activeProjectId: string | null;
  activeThreadId: string | null;
  activeProject: ProjectSummary | null;
  projects: ProjectSummary[];
  runningThreadIds: string[];
  general: GeneralSettings;
  agentRuntime: AgentRuntimeSettings;
  appearance: AppearanceSettings;
  effectiveWindowMaterial: WindowMaterialMode;
  supportedWindowMaterials: WindowMaterialMode[];
  windowMaterialLocked: boolean;
  models: ModelSettings;
  shortcuts: ShortcutSettings;
  openWith: OpenWithSettings;
  networkProxy: AgentNetworkProxySettings;
  openTargets: OpenAppTarget[];
  claudeModels: ClaudeModelInfo;
  aiChatProviders: AiChatProvider[];
  agentProviders: AgentProviderDescriptor[];
  agentProvidersLoading: boolean;
  agentProvidersError: string;
  agentChannelBootstrap: AgentChannelBootstrap;
  agentChannelsLoading: boolean;
  agentChannelsError: string;
  agentChannelFocus: AgentChannelSettingsFocus | null;
  onSelectSection: (section: SettingsSection) => void;
  onOpenThread: (projectId: string, threadId: string) => void | Promise<void>;
  onRemoveProject: (project: ProjectSummary) => void;
  onRenameThread: (thread: ThreadSummary) => void;
  onRemoveThread: (thread: ThreadSummary) => void;
  onOpenWorktreePath: (worktreePath: string) => Promise<void>;
  onSyncWorkspace: (workspace: WorkspaceBootstrap) => void;
  showToast: (message: string, tone?: ToastState['tone']) => void;
  onUpdateGeneral: (update: GeneralSettingsUpdate) => void | Promise<void>;
  onUpdateAgentRuntime: (update: AgentRuntimeSettingsUpdate) => void | Promise<void>;
  onUpdateAppearance: (update: AppearanceSettingsUpdate) => void;
  onUpdateSidebarCustomWidth: (width: number | undefined) => void;
  onUpdateModels: (update: ModelSettingsUpdate) => void | Promise<void>;
  onUpdateShortcuts: (update: ShortcutSettingsUpdate) => void | Promise<void>;
  onUpdateOpenWith: (update: OpenWithSettingsUpdate) => void | Promise<void>;
  onUpdateNetworkProxy: (update: AgentNetworkProxySettingsUpdate) => void | Promise<void>;
  onRefreshAiChatProviders: () => Promise<void> | void;
  onRefreshAgentProviders: () => Promise<void> | void;
  onRefreshAgentChannels: () => Promise<unknown> | unknown;
  onReturnWorkspace: () => void;
  returnLabel?: string;
};

const sectionTitles: Record<SettingsSection, string> = {
  basic: '基础设置',
  appearance: '外观',
  shortcuts: '快捷键',
  providers: 'Agent 设置',
  aiProviders: '普通聊天',
  usage: '使用情况',
  sessions: '会话管理',
  worktree: '工作树',
  mcp: 'MCP 管理',
  plugins: '插件与技能',
  globalPrompts: '全局规则',
  openWith: '打开方式',
  networkProxy: '网络代理',
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
  agentRuntime,
  appearance,
  effectiveWindowMaterial,
  supportedWindowMaterials,
  windowMaterialLocked,
  models,
  shortcuts,
  openWith,
  networkProxy,
  openTargets,
  claudeModels,
  aiChatProviders,
  agentProviders,
  agentProvidersLoading,
  agentProvidersError,
  agentChannelBootstrap,
  agentChannelsLoading,
  agentChannelsError,
  agentChannelFocus,
  onSelectSection,
  onOpenThread,
  onRemoveProject,
  onRenameThread,
  onRemoveThread,
  onOpenWorktreePath,
  onSyncWorkspace,
  showToast,
  onUpdateGeneral,
  onUpdateAgentRuntime,
  onUpdateAppearance,
  onUpdateSidebarCustomWidth,
  onUpdateModels,
  onUpdateShortcuts,
  onUpdateOpenWith,
  onUpdateNetworkProxy,
  onRefreshAiChatProviders,
  onRefreshAgentProviders,
  onRefreshAgentChannels,
  onReturnWorkspace,
  returnLabel,
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
          windowMaterialLocked={windowMaterialLocked}
          onUpdateAppearance={onUpdateAppearance}
        />
      );
    }

    if (activeSection === 'providers') {
      return (
        <AgentModelSettingsSection
          agentRuntime={agentRuntime}
          claudeModels={claudeModels}
          providers={agentProviders}
          providersLoading={agentProvidersLoading}
          providersError={agentProvidersError}
          channelBootstrap={agentChannelBootstrap}
          channelsLoading={agentChannelsLoading}
          channelsError={agentChannelsError}
          channelFocus={agentChannelFocus}
          aiChatProviders={aiChatProviders}
          onUpdateAgentRuntime={onUpdateAgentRuntime}
          onRefreshProviders={onRefreshAgentProviders}
          onRefreshChannels={onRefreshAgentChannels}
          onRefreshAiChatProviders={onRefreshAiChatProviders}
          showToast={showToast}
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

    if (activeSection === 'networkProxy') {
      return <NetworkProxySettingsSection settings={networkProxy} onUpdate={onUpdateNetworkProxy} showToast={showToast} />;
    }

    if (activeSection === 'globalPrompts') {
      return <GlobalPromptSettingsSection defaultProviderId={agentRuntime.defaultProviderId} projectPath={activeProject?.path} />;
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
      return (
        <McpSettingsSection
          defaultProviderId={agentRuntime.defaultProviderId}
          projectPath={activeProject?.path}
        />
      );
    }

    if (activeSection === 'aiProviders') {
      return (
        <AiProviderSettingsSection
          providers={aiChatProviders}
          onChanged={onRefreshAiChatProviders}
          showToast={showToast}
        />
      );
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
      return (
        <PluginsSettingsSection
          defaultProviderId={agentRuntime.defaultProviderId}
          projectPath={activeProject?.path}
        />
      );
    }

    return <SettingsEmptySection title={sectionTitles[activeSection]} />;
  }, [
    activeSection,
    activeProjectId,
    activeThreadId,
    activeProject,
    agentRuntime,
    agentProviders,
    agentProvidersLoading,
    agentProvidersError,
    agentChannelBootstrap,
    agentChannelsLoading,
    agentChannelsError,
    agentChannelFocus,
    aiChatProviders,
    appearance,
    effectiveWindowMaterial,
    claudeModels,
    general,
    models,
    openWith,
    networkProxy,
    openTargets,
    projects,
    runningThreadIds,
    shortcuts,
    supportedWindowMaterials,
    windowMaterialLocked,
    onOpenThread,
    onRenameThread,
    onRemoveThread,
    onOpenWorktreePath,
    onSyncWorkspace,
    onUpdateGeneral,
    onUpdateAgentRuntime,
    onUpdateAppearance,
    onUpdateModels,
    onUpdateOpenWith,
    onUpdateNetworkProxy,
    onUpdateShortcuts,
    onRefreshAiChatProviders,
    onRefreshAgentProviders,
    onRefreshAgentChannels,
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
        returnLabel={returnLabel}
      />
      <div className="settings-content">
        {content}
      </div>
    </main>
  );
}
