import {
  Boxes,
  Check,
  CircleGauge,
  CircleCheck,
  CircleDashed,
  Cpu,
  Layers3,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AgentRuntimeSettings } from '../../types';
import type { AgentRuntimeSettingsUpdate } from '../../hooks/useAppSettings';
import { fetchDshNativeBootstrap, type DshNativeBootstrap } from '../../lib/settings-api';
import { AgentProviderIcon } from '../AgentProviderIcon';

type DshTab = 'overview' | 'presets' | 'tools' | 'native' | 'runtime';
type DshPreset = DshNativeBootstrap['presets']['presets'][number];

type DshSettingsPanelProps = {
  agentRuntime: AgentRuntimeSettings;
  onUpdateAgentRuntime: (update: AgentRuntimeSettingsUpdate) => void | Promise<void>;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
  runtimeContent: ReactNode;
};

const tabs: Array<{ id: DshTab; label: string; icon: typeof CircleGauge }> = [
  { id: 'overview', label: '概览', icon: CircleGauge },
  { id: 'presets', label: 'Agent 模式', icon: Sparkles },
  { id: 'tools', label: '工具', icon: Wrench },
  { id: 'native', label: '原生能力', icon: Layers3 },
  { id: 'runtime', label: '运行信息', icon: Settings2 },
];

const fallbackPresets: DshPreset[] = [
  { id: 'standard', name: '标准模式', description: '完整编码 Agent，支持文件、Shell、搜索、Skills、计划、子代理和工作流。', trust: 'system' as const, isDefault: true },
  { id: 'code', name: 'PTC 模式', description: '具备标准模式能力，并使用 TypeScript 程序组合多步工具操作。', trust: 'system' as const, isDefault: false },
  { id: 'minimal', name: '极简模式', description: '仅提供持久 Bash 与文本编辑工具，适合轻量编码任务。', trust: 'system' as const, isDefault: false },
  { id: 'cordis', name: '创造模式', description: '用于创建和调试自定义 Agent preset 与插件组合。', trust: 'system' as const, isDefault: false },
];

const toolModes = [
  { id: 'native', label: '原生工具', detail: 'DSH 标准工具调用，兼容性最好。' },
  { id: 'code', label: 'PTC Code Mode', detail: '通过 TypeScript 程序组合多步操作。' },
  { id: 'both', label: '两者都启用', detail: '同时提供原生工具与 Code Mode。' },
] as const;

export function DshSettingsPanel({ agentRuntime, onUpdateAgentRuntime, showToast, runtimeContent }: DshSettingsPanelProps) {
  const [tab, setTab] = useState<DshTab>('overview');
  const [profile, setProfile] = useState(agentRuntime.dshProfile);
  const [native, setNative] = useState<DshNativeBootstrap | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => setProfile(agentRuntime.dshProfile), [agentRuntime.dshProfile]);
  useEffect(() => { void refreshNative(); }, []);

  const presets = native?.presets.presets.length ? native.presets.presets : fallbackPresets;
  const selectedPreset = presets.find((preset) => preset.id === agentRuntime.dshAgentPreset) ?? presets[0];
  const selectedToolMode = toolModes.find((mode) => mode.id === agentRuntime.dshToolsMode) ?? toolModes[0];
  const modelCount = useMemo(
    () => native?.models.groups.reduce((sum, group) => sum + group.models.length, 0) ?? 0,
    [native],
  );
  const activeProviderCount = native?.providers.providers.filter((provider) => provider.active).length ?? 0;

  async function update(updateValue: AgentRuntimeSettingsUpdate, message: string) {
    try {
      await onUpdateAgentRuntime(updateValue);
      showToast(message, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'DSH 设置保存失败', 'error');
    }
  }

  async function refreshNative() {
    setLoading(true);
    try {
      setNative(await fetchDshNativeBootstrap());
    } catch (error) {
      showToast(error instanceof Error ? error.message : '读取 DSH 原生能力失败', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="dsh-settings-panel">
      <header className="hermes-settings-header dsh-settings-header">
        <div className="hermes-settings-title">
          <span className="hermes-settings-title-icon" aria-hidden="true"><AgentProviderIcon providerId="deepseek-dsh" size={18} /></span>
          <div>
            <h3>DSH 设置</h3>
            <p>Agent 模式、工具与 Web Host 扩展</p>
          </div>
        </div>
        <div className="hermes-settings-header-actions">
          <div className="hermes-status-list" aria-label="DSH 状态">
            <DshStatusPill tone="positive" label="已启用" />
            <DshStatusPill tone="neutral" label={selectedPreset?.name || selectedPreset?.id || '标准模式'} />
            <DshStatusPill tone="neutral" label={selectedToolMode.label} />
          </div>
          <button type="button" className="settings-icon-button hermes-refresh-button" title="刷新 DSH 能力" aria-label="刷新 DSH 能力" disabled={loading} onClick={() => void refreshNative()}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </header>

      <div className="hermes-settings-tabs dsh-settings-tabs" role="tablist" aria-label="DSH 设置">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            id={`dsh-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`dsh-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div id={`dsh-panel-${tab}`} className="hermes-tab-panel dsh-tab-panel" role="tabpanel" aria-labelledby={`dsh-tab-${tab}`}>
        {tab === 'overview' ? (
          <div className="dsh-settings-stack">
            <div className="dsh-overview-hero">
              <span className="dsh-overview-icon"><Sparkles size={20} /></span>
              <div>
                <span>当前 Agent 模式</span>
                <strong>{selectedPreset?.name || selectedPreset?.id || '标准模式'}</strong>
                <p>{selectedPreset?.description || '使用 DSH 默认 Agent 预设。'}</p>
              </div>
              <button type="button" className="settings-action-button" onClick={() => setTab('presets')}>切换模式</button>
            </div>
            <div className="dsh-native-summary">
              <DshFact icon={Wrench} value={selectedToolMode.label} label="工具模式" />
              <DshFact icon={Sparkles} value={String(presets.length)} label="Agent 预设" />
              <DshFact icon={Cpu} value={String(activeProviderCount)} label="已启用供应商" />
              <DshFact icon={Boxes} value={String(modelCount)} label="可用模型" />
            </div>
            <div className="dsh-info-note">
              <ShieldCheck size={16} />
              <span>权限继续跟随 CodeM。Agent 模式和工具模式会用于新建会话，已有会话保持创建时的配置。</span>
            </div>
          </div>
        ) : null}

        {tab === 'presets' ? (
          <div className="dsh-settings-stack">
            <div className="dsh-section-intro">
              <div><h4>选择 Agent 模式</h4><p>点击卡片即可切换，新建 DSH 会话时生效。</p></div>
              <span>{presets.length} 个模式</span>
            </div>
            <div className="dsh-choice-grid dsh-preset-choice-grid">
              {presets.map((preset) => {
                const active = preset.id === agentRuntime.dshAgentPreset;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={active ? 'active' : ''}
                    aria-pressed={active}
                    disabled={Boolean(preset.broken)}
                    onClick={() => void update({ dshAgentPreset: preset.id }, `已切换到${preset.name || preset.id}，新会话生效`)}
                  >
                    <span className="dsh-choice-icon"><Sparkles size={17} /></span>
                    <span className="dsh-choice-copy">
                      <strong>{preset.name || preset.id}</strong>
                      <small>{preset.broken || preset.description || 'DSH Agent 预设'}</small>
                    </span>
                    <span className="dsh-choice-state">{active ? <><Check size={14} />当前</> : '点击切换'}</span>
                    <code>{preset.id}</code>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {tab === 'tools' ? (
          <div className="dsh-settings-stack">
            <div className="dsh-section-intro">
              <div><h4>工具呈现方式</h4><p>决定模型看到原生工具、Code Mode，或同时看到两者。</p></div>
              <span>点击切换</span>
            </div>
            <div className="dsh-choice-grid dsh-tool-choice-grid">
              {toolModes.map((mode) => {
                const active = agentRuntime.dshToolsMode === mode.id;
                return (
                  <button key={mode.id} type="button" className={active ? 'active' : ''} aria-pressed={active} onClick={() => void update({ dshToolsMode: mode.id }, `已切换到${mode.label}`)}>
                    <span className="dsh-choice-icon"><Wrench size={17} /></span>
                    <span className="dsh-choice-copy"><strong>{mode.label}</strong><small>{mode.detail}</small></span>
                    <span className="dsh-choice-state">{active ? <><Check size={14} />当前</> : '点击切换'}</span>
                  </button>
                );
              })}
            </div>
            <div className="dsh-info-note"><ShieldCheck size={16} /><span>通常推荐“原生工具”；需要让模型用程序组合多步操作时再选择 PTC Code Mode。</span></div>
          </div>
        ) : null}

        {tab === 'native' ? (
          <div className="dsh-settings-stack">
            <div className="dsh-native-summary">
              <DshFact icon={Sparkles} value={String(presets.length)} label="Agent 预设" />
              <DshFact icon={Cpu} value={String(activeProviderCount)} label="已启用供应商" />
              <DshFact icon={Boxes} value={String(modelCount)} label="可用模型" />
              <DshFact icon={SlidersHorizontal} value={String(native?.settings.namespaces.length ?? 0)} label="设置命名空间" />
            </div>
            <div className="dsh-info-note"><ShieldCheck size={16} /><span>此处只展示 DSH 脱敏后的能力摘要；供应商接入与凭证继续在渠道管理中维护。</span></div>
          </div>
        ) : null}

        {tab === 'runtime' ? (
          <div className="dsh-settings-stack">
            <section className="dsh-runtime-card">
              <div className="dsh-section-intro"><div><h4>Web Host</h4><p>CodeM 托管 HTTP RPC 与 WebSocket 实时事件服务。</p></div><span><Server size={14} />自动管理</span></div>
              <label className="dsh-profile-field">
                <span>Headless 兼容 Profile</span>
                <input value={profile} placeholder="headless" onChange={(event) => setProfile(event.target.value)} onBlur={() => void update({ dshProfile: profile.trim() || 'headless' }, 'DSH Profile 已保存')} />
                <small>仅用于没有 CodeM 聊天上下文的兼容任务，正常聊天使用 Web Session。</small>
              </label>
            </section>
            {runtimeContent}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DshFact({ icon: Icon, value, label }: { icon: typeof Wrench; value: string; label: string }) {
  return <div><Icon size={16} /><strong>{value}</strong><span>{label}</span></div>;
}

function DshStatusPill({ tone, label }: { tone: 'positive' | 'neutral'; label: string }) {
  const Icon = tone === 'positive' ? CircleCheck : CircleDashed;
  return <span className={`hermes-status-pill tone-${tone}`}><Icon size={12} /><span>{label}</span></span>;
}
