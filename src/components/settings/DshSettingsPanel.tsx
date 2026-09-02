import { CircleCheck, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AgentRuntimeSettings } from '../../types';
import type { AgentRuntimeSettingsUpdate } from '../../hooks/useAppSettings';
import { AgentProviderIcon } from '../AgentProviderIcon';

type DshSettingsPanelProps = {
  agentRuntime: AgentRuntimeSettings;
  onUpdateAgentRuntime: (update: AgentRuntimeSettingsUpdate) => void | Promise<void>;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
  runtimeContent: ReactNode;
};

export function DshSettingsPanel({ runtimeContent }: DshSettingsPanelProps) {
  return (
    <section className="dsh-settings-panel">
      <header className="hermes-settings-header dsh-settings-header">
        <div className="hermes-settings-title">
          <span className="hermes-settings-title-icon" aria-hidden="true">
            <AgentProviderIcon providerId="deepseek-dsh" size={18} />
          </span>
          <div>
            <h3>DSH 设置</h3>
            <p>DeepSeek DSH ACP 自动化运行时</p>
          </div>
        </div>
        <span className="hermes-status-pill tone-positive">
          <CircleCheck size={12} />
          <span>ACP 已启用</span>
        </span>
      </header>

      <div className="dsh-settings-stack">
        <div className="dsh-info-note">
          <ShieldCheck size={16} />
          <span>
            CodeM 通过 DSH 官方 ACP stdio 接口运行会话、工具、权限、取消和恢复。DSH Web Host 仅属于独立的用户界面，不会因打开 Agent 页面或发送消息而启动。
          </span>
        </div>
        {runtimeContent}
      </div>
    </section>
  );
}
