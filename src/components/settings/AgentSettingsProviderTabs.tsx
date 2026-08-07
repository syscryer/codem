import { MessageCircle } from 'lucide-react';
import type { AgentProviderId } from '../../types';
import { AGENT_PROVIDER_METADATA } from '../../lib/agent-provider-metadata';
import { AgentProviderIcon } from '../AgentProviderIcon';

type AgentSettingsProviderTabsProps = {
  value: AgentProviderId | 'ordinary-chat';
  onChange: (providerId: AgentProviderId) => void;
  includeOrdinaryChat?: boolean;
  onSelectOrdinaryChat?: () => void;
  disabled?: boolean;
};

const providers = AGENT_PROVIDER_METADATA.map((provider) => ({
  id: provider.id,
  label: provider.displayName,
}));

export function AgentSettingsProviderTabs({
  value,
  onChange,
  includeOrdinaryChat = false,
  onSelectOrdinaryChat,
  disabled = false,
}: AgentSettingsProviderTabsProps) {
  const options: Array<{ id: AgentProviderId | 'ordinary-chat'; label: string }> = includeOrdinaryChat
    ? [...providers, { id: 'ordinary-chat', label: '普通聊天' }]
    : providers;
  return (
    <div
      className="settings-segmented agent-settings-provider-tabs"
      aria-label={includeOrdinaryChat ? '选择渠道类型' : '选择 Agent'}
    >
      {options.map((provider) => (
        <button
          key={provider.id}
          type="button"
          className={value === provider.id ? 'active' : ''}
          aria-pressed={value === provider.id}
          disabled={disabled}
          onClick={() => provider.id === 'ordinary-chat'
            ? onSelectOrdinaryChat?.()
            : onChange(provider.id)}
        >
          {provider.id === 'ordinary-chat'
            ? <MessageCircle size={15} />
            : <AgentProviderIcon providerId={provider.id} size={15} />}
          <span>{provider.label}</span>
        </button>
      ))}
    </div>
  );
}
