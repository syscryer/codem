import { MessageCircle } from 'lucide-react';
import type { AgentProviderId } from '../../types';
import { AgentProviderIcon } from '../AgentProviderIcon';

type AgentSettingsProviderTabsProps = {
  value: AgentProviderId | 'ordinary-chat';
  onChange: (providerId: AgentProviderId) => void;
  includeOrdinaryChat?: boolean;
  onSelectOrdinaryChat?: () => void;
  disabled?: boolean;
};

const providers: Array<{ id: AgentProviderId; label: string }> = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'openai-codex', label: 'OpenAI Codex' },
  { id: 'grok-build', label: 'Grok Build' },
  { id: 'opencode', label: 'OpenCode' },
];

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
