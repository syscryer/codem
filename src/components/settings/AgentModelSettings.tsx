import { Bot, Route } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AgentChannelBootstrap, AgentChannelSettingsFocus, AgentProviderDescriptor, AgentRuntimeSettings, AiChatProvider, ClaudeModelInfo, ToastState } from '../../types';
import type { AgentRuntimeSettingsUpdate } from '../../hooks/useAppSettings';
import { AgentChannelSettings } from './AgentChannelSettings';
import { AgentProviderSettings } from './AgentProviderSettings';

type AgentSettingsTab = 'agents' | 'channels';

type AgentModelSettingsSectionProps = {
  agentRuntime: AgentRuntimeSettings;
  claudeModels: ClaudeModelInfo;
  providers: AgentProviderDescriptor[];
  providersLoading: boolean;
  providersError: string;
  channelBootstrap: AgentChannelBootstrap;
  channelsLoading: boolean;
  channelsError: string;
  channelFocus: AgentChannelSettingsFocus | null;
  aiChatProviders: AiChatProvider[];
  onUpdateAgentRuntime: (update: AgentRuntimeSettingsUpdate) => void | Promise<void>;
  onRefreshProviders: () => Promise<void> | void;
  onRefreshChannels: () => Promise<unknown> | unknown;
  onRefreshAiChatProviders: () => Promise<void> | void;
  showToast: (message: string, tone?: ToastState['tone']) => void;
};

export function AgentModelSettingsSection({
  agentRuntime,
  claudeModels,
  providers,
  providersLoading,
  providersError,
  channelBootstrap,
  channelsLoading,
  channelsError,
  channelFocus,
  aiChatProviders,
  onUpdateAgentRuntime,
  onRefreshProviders,
  onRefreshChannels,
  onRefreshAiChatProviders,
  showToast,
}: AgentModelSettingsSectionProps) {
  const [activeTab, setActiveTab] = useState<AgentSettingsTab>('agents');

  useEffect(() => {
    if (channelFocus) setActiveTab('channels');
  }, [channelFocus]);

  return (
    <section className="settings-page-section agent-model-settings">
      <header className="settings-section-head agent-settings-head">
        <h1>Agent 设置</h1>
        <div className="settings-segmented agent-settings-tabs" aria-label="Agent 设置页面">
          <button
            type="button"
            className={activeTab === 'agents' ? 'active' : ''}
            aria-pressed={activeTab === 'agents'}
            onClick={() => setActiveTab('agents')}
          >
            <Bot size={14} />
            <span>Agent 管理</span>
          </button>
          <button
            type="button"
            className={activeTab === 'channels' ? 'active' : ''}
            aria-pressed={activeTab === 'channels'}
            onClick={() => setActiveTab('channels')}
          >
            <Route size={14} />
            <span>渠道管理</span>
          </button>
        </div>
      </header>

      <div hidden={activeTab !== 'agents'}>
        <AgentProviderSettings
          agentRuntime={agentRuntime}
          claudeModels={claudeModels}
          providers={providers}
          providersLoading={providersLoading}
          providersError={providersError}
          onUpdateAgentRuntime={onUpdateAgentRuntime}
          onRefreshProviders={onRefreshProviders}
          showToast={showToast}
        />
      </div>
      <div hidden={activeTab !== 'channels'}>
        <AgentChannelSettings
          bootstrap={channelBootstrap}
          loading={channelsLoading}
          error={channelsError}
          focusRequest={channelFocus}
          onChanged={onRefreshChannels}
          aiChatProviders={aiChatProviders}
          onAiChatProvidersChanged={onRefreshAiChatProviders}
          showToast={showToast}
        />
      </div>
    </section>
  );
}
