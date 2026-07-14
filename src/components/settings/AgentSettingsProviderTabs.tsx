import type { AgentProviderId } from '../../types';
import { AgentProviderIcon } from '../AgentProviderIcon';

type AgentSettingsProviderTabsProps = {
  value: AgentProviderId;
  onChange: (providerId: AgentProviderId) => void;
  disabled?: boolean;
};

const providers: Array<{ id: AgentProviderId; label: string }> = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'openai-codex', label: 'OpenAI Codex' },
  { id: 'grok-build', label: 'Grok Build' },
];

export function AgentSettingsProviderTabs({
  value,
  onChange,
  disabled = false,
}: AgentSettingsProviderTabsProps) {
  return (
    <div className="settings-segmented agent-settings-provider-tabs" aria-label="选择 Agent">
      {providers.map((provider) => (
        <button
          key={provider.id}
          type="button"
          className={value === provider.id ? 'active' : ''}
          aria-pressed={value === provider.id}
          disabled={disabled}
          onClick={() => onChange(provider.id)}
        >
          <AgentProviderIcon providerId={provider.id} size={15} />
          <span>{provider.label}</span>
        </button>
      ))}
    </div>
  );
}
