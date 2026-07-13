import {
  AlertCircle,
  Check,
  CheckCircle2,
  CircleDashed,
  Clock3,
  FileText,
  KeyRound,
  Layers3,
  LoaderCircle,
  Network,
  RefreshCw,
  RotateCw,
  SquareTerminal,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentRuntimeSettings,
  AgentProviderDescriptor,
  AgentProviderRegistry,
  ClaudeCliVersionInfo,
  ClaudeModelInfo,
  CodexAppServerProbeResult,
  GrokAcpProbeResult,
} from '../../types';
import {
  defaultAgentRuntimeSettings,
  fetchAgentRuntimeSettings,
  saveAgentRuntimeSettings,
} from '../../lib/settings-api';
import {
  fetchAgentProviderRegistry,
  probeCodexAgent,
  probeGrokAgent,
} from '../../lib/agent-provider-registry';
import {
  formatProviderCapabilityState,
  formatProviderListMeta,
  getCodexProbeStatusMessage,
  getGrokProbeStatusMessage,
  getProviderCapabilityGroups,
  getProviderModels,
  resolveProviderDiagnostics,
  resolveProviderStatus,
  type ProviderCapabilityItem,
  type ProviderStatusTone,
} from '../../lib/agent-provider-management';
import { readClaudeCliVersionInfo } from '../../lib/settings-runtime';
import { AgentProviderIcon } from '../AgentProviderIcon';

type ProviderLoadState = 'loading' | 'ready' | 'error';
type ProviderProbeState = 'idle' | 'checking' | 'ready' | 'error';

export function AgentProviderSettings({ claudeModels }: { claudeModels: ClaudeModelInfo }) {
  const [registry, setRegistry] = useState<AgentProviderRegistry | null>(null);
  const [loadState, setLoadState] = useState<ProviderLoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [selectedProviderId, setSelectedProviderId] = useState('claude-code');
  const [claudeCliInfo, setClaudeCliInfo] = useState<ClaudeCliVersionInfo | null>(null);
  const [grokProbeState, setGrokProbeState] = useState<ProviderProbeState>('idle');
  const [grokProbe, setGrokProbe] = useState<GrokAcpProbeResult | null>(null);
  const [grokProbeError, setGrokProbeError] = useState('');
  const [codexProbeState, setCodexProbeState] = useState<ProviderProbeState>('idle');
  const [codexProbe, setCodexProbe] = useState<CodexAppServerProbeResult | null>(null);
  const [codexProbeError, setCodexProbeError] = useState('');
  const [agentRuntimeSettings, setAgentRuntimeSettings] = useState<AgentRuntimeSettings>(defaultAgentRuntimeSettings);
  const [agentRuntimeSaving, setAgentRuntimeSaving] = useState(false);
  const [agentRuntimeError, setAgentRuntimeError] = useState('');
  const registryControllerRef = useRef<AbortController | null>(null);
  const grokControllerRef = useRef<AbortController | null>(null);
  const codexControllerRef = useRef<AbortController | null>(null);

  const loadProviders = useCallback(async () => {
    registryControllerRef.current?.abort();
    const controller = new AbortController();
    registryControllerRef.current = controller;
    setLoadState('loading');
    setLoadError('');

    try {
      const [nextRegistry, nextClaudeCliInfo, nextAgentRuntimeSettings] = await Promise.all([
        fetchAgentProviderRegistry(controller.signal),
        readClaudeCliVersionInfo(),
        fetchAgentRuntimeSettings(),
      ]);
      if (controller.signal.aborted) {
        return;
      }
      setRegistry(nextRegistry);
      setClaudeCliInfo(nextClaudeCliInfo);
      setAgentRuntimeSettings(nextAgentRuntimeSettings);
      setSelectedProviderId((current) =>
        nextRegistry.providers.some((provider) => provider.id === current)
          ? current
          : (nextRegistry.providers[0]?.id ?? ''),
      );
      setLoadState('ready');
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      setLoadError(error instanceof Error ? error.message : '读取 Agent Provider 列表失败');
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    void loadProviders();
    return () => {
      registryControllerRef.current?.abort();
      grokControllerRef.current?.abort();
      codexControllerRef.current?.abort();
    };
  }, [loadProviders]);

  const selectedProvider = useMemo(
    () => registry?.providers.find((provider) => provider.id === selectedProviderId) ?? null,
    [registry, selectedProviderId],
  );

  async function runGrokProbe() {
    if (grokProbeState === 'checking') {
      return;
    }

    grokControllerRef.current?.abort();
    const controller = new AbortController();
    grokControllerRef.current = controller;
    setGrokProbeState('checking');
    setGrokProbeError('');

    try {
      const result = await probeGrokAgent(controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      setGrokProbe(result);
      setGrokProbeState('ready');
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      setGrokProbeError(error instanceof Error ? error.message : '检测 Grok Build 失败');
      setGrokProbeState('error');
    }
  }

  async function runCodexProbe() {
    if (codexProbeState === 'checking') {
      return;
    }

    codexControllerRef.current?.abort();
    const controller = new AbortController();
    codexControllerRef.current = controller;
    setCodexProbeState('checking');
    setCodexProbeError('');

    try {
      const result = await probeCodexAgent(controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      setCodexProbe(result);
      setCodexProbeState('ready');
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      setCodexProbeError(error instanceof Error ? error.message : '检测 OpenAI Codex 失败');
      setCodexProbeState('error');
    }
  }

  async function updateExperimentalAgentRun(enabled: boolean) {
    if (agentRuntimeSaving) {
      return;
    }

    setAgentRuntimeSaving(true);
    setAgentRuntimeError('');
    try {
      const saved = await saveAgentRuntimeSettings({ experimentalAgentRunEnabled: enabled });
      setAgentRuntimeSettings(saved);
      await loadProviders();
    } catch (error) {
      setAgentRuntimeError(error instanceof Error ? error.message : '保存实验 Agent 设置失败');
    } finally {
      setAgentRuntimeSaving(false);
    }
  }

  if (loadState === 'loading' && !registry) {
    return (
      <div className="settings-panel agent-provider-loading" role="status">
        <LoaderCircle size={17} className="spin" />
        <span>正在读取 Agent Provider</span>
      </div>
    );
  }

  if (loadState === 'error' && !registry) {
    return (
      <div className="settings-panel agent-provider-load-error" role="alert">
        <AlertCircle size={18} />
        <div>
          <strong>Provider 列表读取失败</strong>
          <span>{loadError}</span>
        </div>
        <button type="button" className="settings-action-button" onClick={() => void loadProviders()}>
          <RefreshCw size={14} />
          <span>重试</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="settings-panel agent-provider-shell"
      aria-busy={loadState === 'loading'}
    >
      <div className="agent-provider-experimental-setting">
        <div>
          <strong>启用实验性 Agent 运行</strong>
          <span>
            {agentRuntimeSettings.experimentalAgentRunEnabled
              ? '新建的 Grok Build 与 OpenAI Codex 会话可在对应 CLI 可用时使用。'
              : '关闭时不允许新建实验 Agent 会话，运行中的会话不受影响。'}
          </span>
          {agentRuntimeError ? <small role="alert">{agentRuntimeError}</small> : null}
        </div>
        <label className="settings-toggle" aria-label="启用实验性 Agent 运行">
          <input
            type="checkbox"
            checked={agentRuntimeSettings.experimentalAgentRunEnabled}
            disabled={agentRuntimeSaving}
            onChange={(event) => void updateExperimentalAgentRun(event.currentTarget.checked)}
          />
          <span aria-hidden="true" />
        </label>
      </div>
      <div className="agent-provider-manager">
        <aside className="agent-provider-list" aria-label="Agent Provider">
          <div className="agent-provider-list-head">
            <span>{registry?.providers.length ?? 0} 个提供商</span>
            <button
              type="button"
              className="settings-icon-button"
              title="刷新 Provider 列表"
              aria-label="刷新 Provider 列表"
              disabled={loadState === 'loading'}
              onClick={() => void loadProviders()}
            >
              <RefreshCw size={14} className={loadState === 'loading' ? 'spin' : ''} />
            </button>
          </div>
          <div className="agent-provider-list-items">
            {loadState === 'error' ? (
              <div className="agent-provider-list-error" role="alert" title={loadError}>
                <AlertCircle size={13} />
                <span>{loadError}</span>
              </div>
            ) : null}
            {registry?.providers.map((provider) => {
              const status = resolveProviderStatus(provider, claudeCliInfo, grokProbe, codexProbe);
              return (
                <button
                  key={provider.id}
                  type="button"
                  className={`agent-provider-list-item${provider.id === selectedProviderId ? ' active' : ''}`}
                  aria-pressed={provider.id === selectedProviderId}
                  onClick={() => setSelectedProviderId(provider.id)}
                >
                  <span className="agent-provider-list-icon" aria-hidden="true">
                    <AgentProviderIcon providerId={provider.id} size={17} />
                  </span>
                  <span className="agent-provider-list-copy">
                    <strong>{provider.displayName}</strong>
                    <small>{formatProviderListMeta(provider, claudeCliInfo, grokProbe, codexProbe)}</small>
                  </span>
                  <ProviderStatusIcon tone={status.tone} label={status.label} compact />
                </button>
              );
            })}
          </div>
        </aside>

        {selectedProvider ? (
          <ProviderDetail
            provider={selectedProvider}
            claudeCliInfo={claudeCliInfo}
            claudeModels={claudeModels}
            grokProbe={grokProbe}
            grokProbeState={grokProbeState}
            grokProbeError={grokProbeError}
            codexProbe={codexProbe}
            codexProbeState={codexProbeState}
            codexProbeError={codexProbeError}
            onProbeGrok={runGrokProbe}
            onProbeCodex={runCodexProbe}
            onRefresh={loadProviders}
          />
        ) : null}
      </div>
    </div>
  );
}

function ProviderDetail({
  provider,
  claudeCliInfo,
  claudeModels,
  grokProbe,
  grokProbeState,
  grokProbeError,
  codexProbe,
  codexProbeState,
  codexProbeError,
  onProbeGrok,
  onProbeCodex,
  onRefresh,
}: {
  provider: AgentProviderDescriptor;
  claudeCliInfo: ClaudeCliVersionInfo | null;
  claudeModels: ClaudeModelInfo;
  grokProbe: GrokAcpProbeResult | null;
  grokProbeState: ProviderProbeState;
  grokProbeError: string;
  codexProbe: CodexAppServerProbeResult | null;
  codexProbeState: ProviderProbeState;
  codexProbeError: string;
  onProbeGrok: () => Promise<void>;
  onProbeCodex: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const status = resolveProviderStatus(provider, claudeCliInfo, grokProbe, codexProbe);
  const diagnostics = resolveProviderDiagnostics(provider, claudeCliInfo, grokProbe, codexProbe);
  const capabilityGroups = getProviderCapabilityGroups(provider);
  const models = getProviderModels(provider.id, claudeModels, grokProbe);
  const grokStatusMessage = getGrokProbeStatusMessage(grokProbeState, grokProbe, grokProbeError);
  const codexStatusMessage = getCodexProbeStatusMessage(
    codexProbeState,
    codexProbe,
    codexProbeError,
  );
  const probeState = provider.id === 'grok-build'
    ? grokProbeState
    : provider.id === 'openai-codex'
      ? codexProbeState
      : 'idle';
  const probeResultAvailable = provider.id === 'grok-build'
    ? Boolean(grokProbe?.probe?.authenticated)
    : provider.id === 'openai-codex'
      ? Boolean(codexProbe?.probe?.authenticated)
      : false;

  return (
    <section
      className="agent-provider-detail"
      aria-labelledby={`agent-provider-${provider.id}`}
      aria-busy={probeState === 'checking'}
    >
      <div className="agent-provider-detail-head">
        <div className="agent-provider-detail-title">
          <span className="agent-provider-detail-icon" aria-hidden="true">
            <AgentProviderIcon providerId={provider.id} size={20} />
          </span>
          <div>
            <h2 id={`agent-provider-${provider.id}`}>{provider.displayName}</h2>
            <p>{provider.id} · {provider.driverId}</p>
          </div>
        </div>
        <div className="agent-provider-detail-actions">
          <ProviderStatusIcon tone={status.tone} label={status.label} />
          {provider.id === 'grok-build' || provider.id === 'openai-codex' ? (
            <button
              type="button"
              className="settings-action-button"
              disabled={probeState === 'checking'}
              onClick={() => void (provider.id === 'grok-build' ? onProbeGrok() : onProbeCodex())}
            >
              {probeState === 'checking' ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <RotateCw size={14} />
              )}
              <span>{probeState === 'checking' ? '检测中' : '检测连接'}</span>
            </button>
          ) : provider.id === 'claude-code' ? (
            <button type="button" className="settings-action-button" onClick={() => void onRefresh()}>
              <RefreshCw size={14} />
              <span>重新检测</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="agent-provider-badges" aria-label="Provider 状态">
        <span className={`agent-provider-badge lifecycle-${provider.lifecycle}`}>
          {provider.lifecycle === 'active' ? '已启用' : '规划中'}
        </span>
        <span className={`agent-provider-badge${provider.selectable ? ' selectable' : ''}`}>
          {provider.selectable ? '聊天可用' : '不可选择'}
        </span>
      </div>

      <dl className="agent-provider-facts">
        <ProviderFact icon={SquareTerminal} label="CLI" value={diagnostics.cli} />
        <ProviderFact icon={KeyRound} label="认证" value={diagnostics.auth} />
        <ProviderFact icon={Layers3} label="版本" value={diagnostics.version} />
        <ProviderFact icon={Network} label="Driver" value={provider.driverId} code />
        {diagnostics.command ? (
          <ProviderFact icon={FileText} label="可执行文件" value={diagnostics.command} code wide />
        ) : null}
      </dl>

      {provider.id === 'grok-build' ? (
        <div className="agent-provider-live-status" aria-live="polite">
          {grokProbeState === 'checking' ? <LoaderCircle size={15} className="spin" /> : null}
          {grokProbeState === 'error' || (grokProbeState === 'ready' && grokProbe && !grokProbe.probe) ? (
            <AlertCircle size={15} />
          ) : null}
          {grokProbeState === 'ready' && grokProbe?.probe?.authenticated ? <CheckCircle2 size={15} /> : null}
          <span>{grokStatusMessage}</span>
        </div>
      ) : null}

      {provider.id === 'openai-codex' ? (
        <div className="agent-provider-live-status" aria-live="polite">
          {codexProbeState === 'checking' ? <LoaderCircle size={15} className="spin" /> : null}
          {codexProbeState === 'error' || (codexProbeState === 'ready' && !probeResultAvailable) ? (
            <AlertCircle size={15} />
          ) : null}
          {codexProbeState === 'ready' && probeResultAvailable ? <CheckCircle2 size={15} /> : null}
          <span>{codexStatusMessage}</span>
        </div>
      ) : null}

      {provider.id === 'grok-build' && grokProbe?.probe ? (
        <DetectedAcpCapabilities probe={grokProbe} />
      ) : null}

      <div className="agent-provider-section">
        <div className="agent-provider-section-head">
          <h3>能力</h3>
          <span>来自 Provider Registry</span>
        </div>
        <div className="agent-provider-capability-groups">
          {capabilityGroups.map((group) => (
            <div key={group.title} className="agent-provider-capability-group">
              <h4>{group.title}</h4>
              {group.items.map((item) => (
                <CapabilityState key={item.label} item={item} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="agent-provider-section">
        <div className="agent-provider-section-head">
          <h3>可用模型</h3>
          <span>{models.length > 0 ? `${models.length} 个` : '尚未检测'}</span>
        </div>
        {models.length > 0 ? (
          <div className="agent-provider-models">
            {models.map((model) => (
              <div key={model.id} className={`agent-provider-model${model.current ? ' current' : ''}`}>
                <span>
                  <strong>{model.label}</strong>
                  <code>{model.id}</code>
                </span>
                {model.detail ? <small>{model.detail}</small> : null}
                {model.current ? <span className="agent-provider-current-model">当前</span> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="agent-provider-empty">
            {provider.lifecycle === 'planned' ? 'Driver 接入后显示运行时模型' : '当前 Provider 未返回模型'}
          </div>
        )}
      </div>
    </section>
  );
}

function ProviderFact({
  icon: Icon,
  label,
  value,
  code = false,
  wide = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  code?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`agent-provider-fact${wide ? ' wide' : ''}`}>
      <dt><Icon size={14} />{label}</dt>
      <dd title={value}>{code ? <code>{value}</code> : value}</dd>
    </div>
  );
}

function ProviderStatusIcon({
  tone,
  label,
  compact = false,
}: {
  tone: ProviderStatusTone;
  label: string;
  compact?: boolean;
}) {
  const Icon = tone === 'positive'
    ? CheckCircle2
    : tone === 'negative'
      ? XCircle
      : tone === 'warning'
        ? AlertCircle
        : Clock3;
  return (
    <span
      className={`agent-provider-status tone-${tone}${compact ? ' compact' : ''}`}
      title={compact ? label : undefined}
      aria-label={compact ? label : undefined}
    >
      <Icon size={compact ? 14 : 13} />
      {compact ? <span className="sr-only">{label}</span> : <span>{label}</span>}
    </span>
  );
}

function CapabilityState({ item }: { item: ProviderCapabilityItem }) {
  const state = formatProviderCapabilityState(item.value);
  const Icon = state.tone === 'positive'
    ? Check
    : state.tone === 'negative'
      ? X
      : CircleDashed;
  return (
    <div className={`agent-provider-capability tone-${state.tone}`}>
      <span>{item.label}</span>
      <strong><Icon size={13} />{state.label}</strong>
    </div>
  );
}

function DetectedAcpCapabilities({ probe }: { probe: GrokAcpProbeResult }) {
  const initialize = probe.probe?.initialize;
  if (!initialize) {
    return null;
  }

  const detected = [
    { label: `ACP v${initialize.protocolVersion}`, supported: true },
    { label: '恢复会话', supported: initialize.loadSession },
    { label: '图片输入', supported: initialize.promptCapabilities.image },
    { label: '嵌入上下文', supported: initialize.promptCapabilities.embeddedContext },
    { label: 'MCP HTTP', supported: initialize.mcpCapabilities.http },
    { label: 'MCP SSE', supported: initialize.mcpCapabilities.sse },
  ];

  return (
    <div className="agent-provider-detected">
      <div className="agent-provider-section-head">
        <h3>本次 ACP 检测</h3>
        <span>只保留公开能力摘要</span>
      </div>
      <div className="agent-provider-detected-items">
        {detected.map((item) => (
          <span key={item.label} className={item.supported ? 'supported' : 'unsupported'}>
            {item.supported ? <Check size={12} /> : <X size={12} />}
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
