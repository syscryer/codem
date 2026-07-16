import type { AiChatProvider, ToastState } from '../../types';
import { AiProviderSettingsPanel } from '../AiProviderManagerDialog';

type AiProviderSettingsSectionProps = {
  providers: AiChatProvider[];
  onChanged: () => Promise<void> | void;
  showToast: (message: string, tone?: ToastState['tone']) => void;
};

export function AiProviderSettingsSection({
  providers,
  onChanged,
  showToast,
}: AiProviderSettingsSectionProps) {
  return (
    <section className="settings-page-section settings-page-wide ai-provider-settings-page">
      <div className="settings-section-head">
        <h1>普通聊天</h1>
        <p>为普通聊天配置独立的供应商和模型。这里的配置不会影响 Agent 设置。</p>
      </div>
      <div className="settings-panel ai-provider-settings-shell">
        <AiProviderSettingsPanel
          providers={providers}
          onChanged={onChanged}
          showToast={showToast}
        />
      </div>
    </section>
  );
}
