import { Bot, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { ClaudeModelInfo, ModelSettings } from '../../types';
import type { ModelSettingsUpdate } from '../../hooks/useAppSettings';
import { AgentProviderSettings } from './AgentProviderSettings';
import { ModelSettingsPanel } from './ModelSettings';

type AgentSettingsTab = 'providers' | 'models';

type AgentModelSettingsSectionProps = {
  models: ModelSettings;
  claudeModels: ClaudeModelInfo;
  onUpdateModels: (update: ModelSettingsUpdate) => void | Promise<void>;
};

export function AgentModelSettingsSection({
  models,
  claudeModels,
  onUpdateModels,
}: AgentModelSettingsSectionProps) {
  const [activeTab, setActiveTab] = useState<AgentSettingsTab>('providers');

  return (
    <section className="settings-page-section agent-model-settings">
      <header className="settings-section-head settings-section-head-row agent-settings-head">
        <h1>Agent 与模型</h1>
        <div className="settings-segmented agent-settings-tabs" aria-label="Agent 与模型页面">
          <button
            type="button"
            className={activeTab === 'providers' ? 'active' : ''}
            aria-pressed={activeTab === 'providers'}
            onClick={() => setActiveTab('providers')}
          >
            <Bot size={14} />
            <span>提供商</span>
          </button>
          <button
            type="button"
            className={activeTab === 'models' ? 'active' : ''}
            aria-pressed={activeTab === 'models'}
            onClick={() => setActiveTab('models')}
          >
            <SlidersHorizontal size={14} />
            <span>模型与默认值</span>
          </button>
        </div>
      </header>

      <div hidden={activeTab !== 'providers'}>
        <AgentProviderSettings claudeModels={claudeModels} />
      </div>
      <div hidden={activeTab !== 'models'}>
        <ModelSettingsPanel
          models={models}
          claudeModels={claudeModels}
          onUpdateModels={onUpdateModels}
        />
      </div>
    </section>
  );
}
