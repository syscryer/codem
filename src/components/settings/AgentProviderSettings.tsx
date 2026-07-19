import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileText,
  KeyRound,
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
  AgentProviderId,
  AgentRuntimeSettings,
  AgentProviderDescriptor,
  AgentSettingsDiagnostics,
  ClaudeCliVersionInfo,
  ClaudeModelInfo,
  CodexAppServerProbeResult,
  GrokAcpProbeResult,
  OpenCodeAcpProbeResult,
} from '../../types';
import type { AgentRuntimeSettingsUpdate } from '../../hooks/useAppSettings';
import { useOutsideDismiss } from '../../hooks/useOutsideDismiss';
import {
  fetchAgentLatestVersion,
  fetchAgentSettingsDiagnostics,
  probeCodexAgent,
  probeGrokAgent,
  probeOpenCodeAgent,
  runAgentLifecycleAction,
} from '../../lib/agent-provider-registry';
import {
  formatProviderCapabilityState,
  formatProviderListMeta,
  getCodexProbeStatusMessage,
  getGrokProbeStatusMessage,
  getOpenCodeProbeStatusMessage,
  getProviderInstallDocsUrl,
  getProviderCapabilityGroups,
  getProviderModels,
  reconcileProviderAvailability,
  resolveProviderDiagnostics,
  resolveProviderStatus,
  type ProviderCapabilityItem,
  type ProviderStatusTone,
} from '../../lib/agent-provider-management';
import { openExternalUrl } from '../../lib/markdown-link';
import { readClaudeCliVersionInfo } from '../../lib/settings-runtime';
import { AgentProviderIcon } from '../AgentProviderIcon';
import { PopoverPortal } from '../PopoverPortal';

type ProviderProbeState = 'idle' | 'checking' | 'ready' | 'error';

type AgentProviderSettingsProps = {
  agentRuntime: AgentRuntimeSettings;
  claudeModels: ClaudeModelInfo;
  providers: AgentProviderDescriptor[];
  providersLoading: boolean;
  providersError: string;
  onUpdateAgentRuntime: (update: AgentRuntimeSettingsUpdate) => void | Promise<void>;
  onRefreshProviders: () => Promise<void> | void;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

export function AgentProviderSettings({
  agentRuntime,
  claudeModels,
  providers,
  providersLoading,
  providersError,
  onUpdateAgentRuntime,
  onRefreshProviders,
  showToast,
}: AgentProviderSettingsProps) {
  const [selectedProviderId, setSelectedProviderId] = useState('claude-code');
  const [claudeCliInfo, setClaudeCliInfo] = useState<ClaudeCliVersionInfo | null>(null);
  const [settingsDiagnostics, setSettingsDiagnostics] = useState<Partial<Record<AgentProviderId, AgentSettingsDiagnostics>>>({});
  const [diagnosticsLoading, setDiagnosticsLoading] = useState<Partial<Record<AgentProviderId, boolean>>>({});
  const [diagnosticsErrors, setDiagnosticsErrors] = useState<Partial<Record<AgentProviderId, string>>>({});
  const [latestVersionLoading, setLatestVersionLoading] = useState<Partial<Record<AgentProviderId, boolean>>>({});
  const [detailsError, setDetailsError] = useState('');
  const [grokProbeState, setGrokProbeState] = useState<ProviderProbeState>('idle');
  const [grokProbe, setGrokProbe] = useState<GrokAcpProbeResult | null>(null);
  const [grokProbeError, setGrokProbeError] = useState('');
  const [codexProbeState, setCodexProbeState] = useState<ProviderProbeState>('idle');
  const [codexProbe, setCodexProbe] = useState<CodexAppServerProbeResult | null>(null);
  const [codexProbeError, setCodexProbeError] = useState('');
  const [openCodeProbeState, setOpenCodeProbeState] = useState<ProviderProbeState>('idle');
  const [openCodeProbe, setOpenCodeProbe] = useState<OpenCodeAcpProbeResult | null>(null);
  const [openCodeProbeError, setOpenCodeProbeError] = useState('');
  const [agentRuntimeSaving, setAgentRuntimeSaving] = useState(false);
  const [diagnosticCheckingProviderId, setDiagnosticCheckingProviderId] = useState<AgentProviderId | null>(null);
  const [lifecycleAction, setLifecycleAction] = useState<{ providerId: AgentProviderId; action: 'install' | 'update' } | null>(null);
  const registrySyncAttemptsRef = useRef(new Set<string>());
  const claudeInfoRequestIdRef = useRef(0);
  const detailsControllersRef = useRef(new Map<AgentProviderId, AbortController>());
  const grokControllerRef = useRef<AbortController | null>(null);
  const codexControllerRef = useRef<AbortController | null>(null);
  const openCodeControllerRef = useRef<AbortController | null>(null);

  const loadProviderDetails = useCallback(async (
    requestedProviderIds?: AgentProviderId[],
  ) => {
    setDetailsError('');

    const providerIds = requestedProviderIds ?? (
      ['claude-code', 'openai-codex', 'grok-build', 'opencode'] satisfies AgentProviderId[]
    );
    const loadingState = Object.fromEntries(providerIds.map((providerId) => [providerId, true]));
    setDiagnosticsLoading((current) => ({ ...current, ...loadingState }));
    setLatestVersionLoading((current) => ({ ...current, ...loadingState }));
    setDiagnosticsErrors((current) => {
      const next = { ...current };
      providerIds.forEach((providerId) => delete next[providerId]);
      return next;
    });

    const claudeInfoRequestId = providerIds.includes('claude-code')
      ? ++claudeInfoRequestIdRef.current
      : claudeInfoRequestIdRef.current;
    const claudeInfoRequest = providerIds.includes('claude-code')
      ? readClaudeCliVersionInfo()
          .then((value) => {
            if (claudeInfoRequestIdRef.current === claudeInfoRequestId) {
              setClaudeCliInfo(value);
            }
          })
          .catch(() => undefined)
      : Promise.resolve();

    const providerRequests = providerIds.map(async (providerId) => {
      detailsControllersRef.current.get(providerId)?.abort();
      const controller = new AbortController();
      detailsControllersRef.current.set(providerId, controller);
      const isCurrentRequest = () => (
        detailsControllersRef.current.get(providerId) === controller && !controller.signal.aborted
      );
      let diagnostics: AgentSettingsDiagnostics;
      try {
        diagnostics = await fetchAgentSettingsDiagnostics(providerId, controller.signal);
        if (!isCurrentRequest()) {
          return;
        }
        setSettingsDiagnostics((current) => {
          const previous = current[providerId];
          return {
            ...current,
            [providerId]: {
              ...diagnostics,
              latestVersion: previous?.latestVersion ?? null,
              updateAvailable: previous?.updateAvailable ?? false,
              versionCheckError: null,
            },
          };
        });
      } catch (error) {
        if (!isCurrentRequest()) {
          return;
        }
        setDiagnosticsErrors((current) => ({
          ...current,
          [providerId]: error instanceof Error
            ? error.message
            : `${defaultAgentProviderName(providerId)} 诊断读取失败`,
        }));
        setLatestVersionLoading((current) => ({ ...current, [providerId]: false }));
        return;
      } finally {
        if (isCurrentRequest()) {
          setDiagnosticsLoading((current) => ({ ...current, [providerId]: false }));
        }
      }

      try {
        const versionCheck = await fetchAgentLatestVersion(
          providerId,
          diagnostics.version,
          controller.signal,
        );
        if (!isCurrentRequest()) {
          return;
        }
        setSettingsDiagnostics((current) => {
          const previous = current[providerId] ?? diagnostics;
          return {
            ...current,
            [providerId]: {
              ...previous,
              latestVersion: versionCheck.latestVersion ?? previous.latestVersion,
              updateAvailable: versionCheck.latestVersion
                ? versionCheck.updateAvailable
                : previous.updateAvailable,
              versionCheckError: versionCheck.error,
            },
          };
        });
      } catch (error) {
        if (!isCurrentRequest()) {
          return;
        }
        setSettingsDiagnostics((current) => {
          const previous = current[providerId] ?? diagnostics;
          return {
            ...current,
            [providerId]: {
              ...previous,
              versionCheckError: error instanceof Error ? error.message : '查询最新版本失败',
            },
          };
        });
      } finally {
        if (isCurrentRequest()) {
          setLatestVersionLoading((current) => ({ ...current, [providerId]: false }));
        }
      }
    });

    await Promise.allSettled([claudeInfoRequest, ...providerRequests]);
  }, []);

  const refreshProviders = useCallback(async () => {
    await Promise.allSettled([
      Promise.resolve().then(() => onRefreshProviders()),
      loadProviderDetails(),
    ]);
  }, [loadProviderDetails, onRefreshProviders]);

  useEffect(() => {
    void loadProviderDetails();
    return () => {
      claudeInfoRequestIdRef.current += 1;
      detailsControllersRef.current.forEach((controller) => controller.abort());
      detailsControllersRef.current.clear();
      grokControllerRef.current?.abort();
      codexControllerRef.current?.abort();
      openCodeControllerRef.current?.abort();
    };
  }, [loadProviderDetails]);

  useEffect(() => {
    setSelectedProviderId((current) =>
      providers.some((provider) => provider.id === current)
        ? current
        : (providers[0]?.id ?? current),
    );
  }, [providers]);

  const effectiveProviders = useMemo(
    () => providers.map((provider) => reconcileProviderAvailability(
      provider,
      settingsDiagnostics[provider.id as AgentProviderId],
    )),
    [providers, settingsDiagnostics],
  );

  useEffect(() => {
    providers.forEach((provider) => {
      if (provider.available === true) {
        for (const key of registrySyncAttemptsRef.current) {
          if (key.startsWith(`${provider.id}:`)) {
            registrySyncAttemptsRef.current.delete(key);
          }
        }
      }
    });
    if (providersLoading) {
      return;
    }
    const mismatch = providers.find((provider) => (
      provider.lifecycle === 'active'
      && provider.available !== true
      && settingsDiagnostics[provider.id as AgentProviderId]?.installed === true
    ));
    if (!mismatch) {
      return;
    }
    const diagnostics = settingsDiagnostics[mismatch.id as AgentProviderId];
    const attemptKey = `${mismatch.id}:${diagnostics?.command ?? ''}`;
    if (registrySyncAttemptsRef.current.has(attemptKey)) {
      return;
    }
    registrySyncAttemptsRef.current.add(attemptKey);
    void Promise.resolve()
      .then(() => onRefreshProviders())
      .catch(() => undefined);
  }, [onRefreshProviders, providers, providersLoading, settingsDiagnostics]);

  const selectedProvider = useMemo(
    () => effectiveProviders.find((provider) => provider.id === selectedProviderId) ?? null,
    [effectiveProviders, selectedProviderId],
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

  async function runOpenCodeProbe() {
    if (openCodeProbeState === 'checking') {
      return;
    }

    openCodeControllerRef.current?.abort();
    const controller = new AbortController();
    openCodeControllerRef.current = controller;
    setOpenCodeProbeState('checking');
    setOpenCodeProbeError('');

    try {
      const result = await probeOpenCodeAgent(controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      setOpenCodeProbe(result);
      setOpenCodeProbeState('ready');
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      setOpenCodeProbeError(error instanceof Error ? error.message : '检测 OpenCode 失败');
      setOpenCodeProbeState('error');
    }
  }

  async function updateDefaultProvider(defaultProviderId: AgentProviderId) {
    if (agentRuntimeSaving || defaultProviderId === agentRuntime.defaultProviderId) {
      return;
    }
    setAgentRuntimeSaving(true);
    try {
      await onUpdateAgentRuntime({ defaultProviderId });
    } finally {
      setAgentRuntimeSaving(false);
    }
  }

  async function runNativeDiagnostic(providerId: AgentProviderId) {
    if (diagnosticCheckingProviderId) {
      return;
    }
    setDiagnosticCheckingProviderId(providerId);
    try {
      const diagnostics = await fetchAgentSettingsDiagnostics(providerId, undefined, true);
      setSettingsDiagnostics((current) => ({
        ...current,
        [providerId]: {
          ...diagnostics,
          latestVersion: current[providerId]?.latestVersion ?? null,
          updateAvailable: current[providerId]?.updateAvailable ?? false,
          versionCheckError: current[providerId]?.versionCheckError ?? null,
        },
      }));
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : '运行原生诊断失败');
    } finally {
      setDiagnosticCheckingProviderId(null);
    }
  }

  async function runLifecycleAction(providerId: AgentProviderId, action: 'install' | 'update') {
    if (lifecycleAction) {
      return;
    }
    setLifecycleAction({ providerId, action });
    setDetailsError('');
    try {
      const previousVersion = settingsDiagnostics[providerId]?.version ?? null;
      const { result, diagnostics } = await runAgentLifecycleAction(providerId, action);
      setSettingsDiagnostics((current) => ({ ...current, [providerId]: diagnostics }));
      const probe = providerId === 'grok-build'
        ? runGrokProbe()
        : providerId === 'openai-codex'
          ? runCodexProbe()
          : providerId === 'opencode'
            ? runOpenCodeProbe()
            : Promise.resolve();
      await Promise.allSettled([
        Promise.resolve().then(() => onRefreshProviders()),
        loadProviderDetails([providerId]),
        probe,
      ]);
      const providerName = defaultAgentProviderName(providerId);
      const versionLabel = diagnostics.version ? `，当前版本 ${diagnostics.version}` : '';
      const mirrorLabel = result.usedMirror ? '，已使用国内镜像' : '';
      if (!result.installed || !diagnostics.installed) {
        showToast(
          `${providerName} ${action === 'install' ? '安装' : '更新'}命令已完成，但 CodeM 仍未检测到可执行文件，请点击“重新检测”或查看诊断信息`,
          'error',
        );
      } else if (
        action === 'update'
        && diagnostics.updateAvailable
        && previousVersion
        && diagnostics.version === previousVersion
      ) {
        showToast(
          `${providerName} 更新命令已完成，但版本仍为 ${diagnostics.version}，请查看安装命令或诊断信息`,
          'info',
        );
      } else {
        showToast(
          `${providerName} ${action === 'install' ? '安装' : '更新'}完成${versionLabel}${mirrorLabel}`,
          'success',
        );
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : `${action === 'install' ? '安装' : '更新'} Agent 失败`;
      setDetailsError(message);
      showToast(message, 'error');
    } finally {
      setLifecycleAction(null);
    }
  }

  return (
    <div
      className="settings-panel agent-provider-shell"
    >
      <div className="agent-provider-runtime-settings">
        <div className="agent-provider-default-setting">
          <div>
            <strong>默认 Agent</strong>
            <span>用于以后新建的聊天，已有聊天保持原来的 Provider。</span>
          </div>
          <AgentProviderDropdown
            value={agentRuntime.defaultProviderId}
            providers={effectiveProviders}
            disabled={agentRuntimeSaving}
            onChange={(providerId) => void updateDefaultProvider(providerId)}
          />
        </div>
      </div>
      <div className="agent-provider-manager">
        <aside className="agent-provider-list" aria-label="Agent Provider">
          <div className="agent-provider-list-head">
            <span>{providersLoading && providers.length === 0 ? '正在读取提供商' : `${providers.length} 个提供商`}</span>
            <button
              type="button"
              className="settings-icon-button"
              title="刷新 Provider 列表"
              aria-label="刷新 Provider 列表"
              disabled={providersLoading}
              onClick={() => void refreshProviders()}
            >
              <RefreshCw
                size={14}
                className={providersLoading || Object.values(diagnosticsLoading).some(Boolean) ? 'spin' : ''}
              />
            </button>
          </div>
          <div className="agent-provider-list-items">
            {providersError ? (
              <div className="agent-provider-list-error" role="alert" title={providersError}>
                <AlertCircle size={13} />
                <span>{providersError}</span>
                <button type="button" onClick={() => void refreshProviders()}>重试</button>
              </div>
            ) : null}
            {providersLoading && providers.length === 0 ? <AgentProviderListSkeleton /> : null}
            {effectiveProviders.map((provider) => {
              const status = resolveProviderStatus(provider, claudeCliInfo, grokProbe, codexProbe, openCodeProbe);
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
                    <small>{formatProviderListMeta(provider, claudeCliInfo, grokProbe, codexProbe, openCodeProbe)}</small>
                  </span>
                  <ProviderStatusIcon tone={status.tone} label={status.label} compact />
                </button>
              );
            })}
          </div>
        </aside>

        {selectedProvider ? (
          <div className="agent-provider-detail-region">
            {diagnosticsLoading[selectedProvider.id as AgentProviderId]
              || diagnosticsErrors[selectedProvider.id as AgentProviderId]
              || detailsError ? (
              <div
                className={`agent-provider-detail-progress${diagnosticsErrors[selectedProvider.id as AgentProviderId] || detailsError ? ' error' : ''}`}
                role={diagnosticsErrors[selectedProvider.id as AgentProviderId] || detailsError ? 'alert' : 'status'}
              >
                {diagnosticsErrors[selectedProvider.id as AgentProviderId] || detailsError
                  ? <AlertCircle size={13} />
                  : <LoaderCircle size={13} className="spin" />}
                <span>
                  {diagnosticsErrors[selectedProvider.id as AgentProviderId]
                    || detailsError
                    || `正在读取 ${selectedProvider.displayName} 本机信息`}
                </span>
                {diagnosticsErrors[selectedProvider.id as AgentProviderId] || detailsError ? (
                  <button
                    type="button"
                    onClick={() => void loadProviderDetails([selectedProvider.id as AgentProviderId])}
                  >
                    重试
                  </button>
                ) : null}
              </div>
            ) : null}
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
              openCodeProbe={openCodeProbe}
              openCodeProbeState={openCodeProbeState}
              openCodeProbeError={openCodeProbeError}
              settingsDiagnostics={settingsDiagnostics[selectedProvider.id as AgentProviderId] ?? null}
              diagnosticsLoading={Boolean(diagnosticsLoading[selectedProvider.id as AgentProviderId])}
              latestVersionLoading={Boolean(latestVersionLoading[selectedProvider.id as AgentProviderId])}
              onProbeGrok={runGrokProbe}
              onProbeCodex={runCodexProbe}
              onProbeOpenCode={runOpenCodeProbe}
              onRefresh={() => loadProviderDetails([selectedProvider.id as AgentProviderId])}
              diagnosticChecking={diagnosticCheckingProviderId === selectedProvider.id}
              onRunNativeDiagnostic={() => runNativeDiagnostic(selectedProvider.id as AgentProviderId)}
              lifecycleAction={lifecycleAction?.providerId === selectedProvider.id ? lifecycleAction.action : null}
              onRunLifecycleAction={(action) => void runLifecycleAction(selectedProvider.id as AgentProviderId, action)}
            />
          </div>
        ) : providersLoading ? (
          <AgentProviderDetailSkeleton />
        ) : (
          <div className="agent-provider-detail-empty" role={providersError ? 'alert' : 'status'}>
            <AlertCircle size={18} />
            <strong>{providersError ? 'Provider 列表读取失败' : '暂无 Agent Provider'}</strong>
            <span>{providersError || '刷新后重试。'}</span>
            <button type="button" className="settings-action-button" onClick={() => void refreshProviders()}>
              <RefreshCw size={14} />
              <span>重试</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AgentProviderListSkeleton() {
  return (
    <div className="agent-provider-list-skeleton" aria-hidden="true">
      {[0, 1, 2, 3].map((item) => (
        <div className="agent-provider-skeleton-row" key={item}>
          <span className="agent-provider-skeleton-icon" />
          <span className="agent-provider-skeleton-copy">
            <i />
            <i />
          </span>
        </div>
      ))}
    </div>
  );
}

function AgentProviderDetailSkeleton() {
  return (
    <div className="agent-provider-detail-skeleton" aria-hidden="true">
      <div className="agent-provider-detail-skeleton-head">
        <span className="agent-provider-skeleton-icon large" />
        <span className="agent-provider-skeleton-copy">
          <i />
          <i />
        </span>
      </div>
      <div className="agent-provider-detail-skeleton-badges"><i /><i /><i /></div>
      <div className="agent-provider-detail-skeleton-lines"><i /><i /><i /><i /></div>
    </div>
  );
}

function AgentProviderDropdown({
  value,
  providers,
  disabled,
  onChange,
}: {
  value: AgentProviderId;
  providers: AgentProviderDescriptor[];
  disabled: boolean;
  onChange: (providerId: AgentProviderId) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const options = providers.filter(isDefaultAgentProvider);
  const selected = options.find((provider) => provider.id === value) ?? {
    id: value,
    displayName: defaultAgentProviderName(value),
    lifecycle: 'planned' as const,
    available: null,
    selectable: false,
  };

  useOutsideDismiss({
    selectors: [
      { selector: '.agent-provider-default-menu', onDismiss: () => setOpen(false), anchorRefs: [anchorRef] },
    ],
  });

  return (
    <div className="settings-select-anchor agent-provider-default-select" ref={anchorRef}>
      <button
        type="button"
        className={`settings-select-trigger${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="选择默认 Agent"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="agent-provider-default-option-main">
          <AgentProviderIcon providerId={selected.id} size={16} />
          <span>{selected.displayName}</span>
        </span>
        <ChevronDown size={15} className="settings-select-chevron" />
      </button>
      <PopoverPortal open={open} anchorRef={anchorRef} placement="bottom-start" offset={8}>
        <div className="settings-select-menu agent-provider-default-menu" role="menu" aria-label="选择默认 Agent">
          {options.map((provider) => {
            const selectable = provider.lifecycle === 'active' && provider.available === true && provider.selectable;
            const unavailableLabel = provider.lifecycle === 'planned' ? '未启用' : '不可用';
            return (
              <button
                key={provider.id}
                type="button"
                className={`settings-select-menu-item${provider.id === value ? ' current' : ''}`}
                role="menuitemradio"
                aria-checked={provider.id === value}
                disabled={!selectable}
                onClick={() => {
                  onChange(provider.id);
                  setOpen(false);
                }}
              >
                <span className="agent-provider-default-option-main">
                  <AgentProviderIcon providerId={provider.id} size={16} />
                  <span>{provider.displayName}</span>
                </span>
                {provider.id === value
                  ? <Check size={15} />
                  : !selectable
                    ? <small>{unavailableLabel}</small>
                    : null}
              </button>
            );
          })}
        </div>
      </PopoverPortal>
    </div>
  );
}

function isDefaultAgentProvider(provider: AgentProviderDescriptor): provider is AgentProviderDescriptor & { id: AgentProviderId } {
  return provider.id === 'claude-code'
    || provider.id === 'grok-build'
    || provider.id === 'openai-codex'
    || provider.id === 'opencode';
}

function defaultAgentProviderName(providerId: AgentProviderId) {
  if (providerId === 'grok-build') {
    return 'Grok Build';
  }
  if (providerId === 'openai-codex') {
    return 'OpenAI Codex';
  }
  if (providerId === 'opencode') {
    return 'OpenCode';
  }
  return 'Claude Code';
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
  openCodeProbe,
  openCodeProbeState,
  openCodeProbeError,
  settingsDiagnostics,
  diagnosticsLoading,
  latestVersionLoading,
  onProbeGrok,
  onProbeCodex,
  onProbeOpenCode,
  onRefresh,
  diagnosticChecking,
  onRunNativeDiagnostic,
  lifecycleAction,
  onRunLifecycleAction,
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
  openCodeProbe: OpenCodeAcpProbeResult | null;
  openCodeProbeState: ProviderProbeState;
  openCodeProbeError: string;
  settingsDiagnostics: AgentSettingsDiagnostics | null;
  diagnosticsLoading: boolean;
  latestVersionLoading: boolean;
  onProbeGrok: () => Promise<void>;
  onProbeCodex: () => Promise<void>;
  onProbeOpenCode: () => Promise<void>;
  onRefresh: () => Promise<void>;
  diagnosticChecking: boolean;
  onRunNativeDiagnostic: () => Promise<void>;
  lifecycleAction: 'install' | 'update' | null;
  onRunLifecycleAction: (action: 'install' | 'update') => void;
}) {
  const status = resolveProviderStatus(provider, claudeCliInfo, grokProbe, codexProbe, openCodeProbe);
  const diagnostics = resolveProviderDiagnostics(provider, claudeCliInfo, grokProbe, codexProbe, openCodeProbe);
  const effectiveCliStatus = diagnostics.cli === '未检测' && settingsDiagnostics?.installed
    ? '已安装'
    : diagnostics.cli;
  const effectiveVersion = diagnostics.version === '未知' && settingsDiagnostics?.version
    ? settingsDiagnostics.version
    : diagnostics.version;
  const effectiveCommand = diagnostics.command || settingsDiagnostics?.command || '';
  const isInstalled = settingsDiagnostics?.installed ?? provider.available ?? Boolean(effectiveCommand);
  const currentVersion = formatAgentVersion(settingsDiagnostics?.version ?? effectiveVersion);
  const latestVersion = settingsDiagnostics?.latestVersion ?? null;
  const updateAvailable = settingsDiagnostics?.updateAvailable ?? false;
  const lifecycleStatus = diagnosticsLoading && !settingsDiagnostics
    ? { label: '检测中', tone: 'installed' }
    : !isInstalled
    ? { label: '未安装', tone: 'uninstalled' }
    : updateAvailable
      ? { label: '可更新', tone: 'update' }
      : latestVersion
        ? { label: '已是最新', tone: 'latest' }
        : { label: '已安装', tone: 'installed' };
  const capabilityGroups = getProviderCapabilityGroups(provider);
  const models = getProviderModels(provider.id, claudeModels, grokProbe);
  const grokStatusMessage = getGrokProbeStatusMessage(grokProbeState, grokProbe, grokProbeError);
  const codexStatusMessage = getCodexProbeStatusMessage(
    codexProbeState,
    codexProbe,
    codexProbeError,
  );
  const openCodeStatusMessage = getOpenCodeProbeStatusMessage(
    openCodeProbeState,
    openCodeProbe,
    openCodeProbeError,
  );
  const probeState = provider.id === 'grok-build'
    ? grokProbeState
    : provider.id === 'openai-codex'
      ? codexProbeState
      : provider.id === 'opencode'
        ? openCodeProbeState
      : 'idle';
  const probeResultAvailable = provider.id === 'grok-build'
    ? Boolean(grokProbe?.probe?.authenticated)
    : provider.id === 'openai-codex'
      ? Boolean(codexProbe?.probe?.authenticated)
      : provider.id === 'opencode'
        ? Boolean(openCodeProbe?.probe?.configured)
      : false;
  const installDocsUrl = provider.id === 'claude-code'
    ? claudeCliInfo?.setupUrl ?? getProviderInstallDocsUrl(provider.id as AgentProviderId)
    : getProviderInstallDocsUrl(provider.id as AgentProviderId);

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
          {installDocsUrl ? (
            <button
              type="button"
              className="settings-action-button"
              onClick={() => void openExternalUrl(installDocsUrl)}
            >
              <ExternalLink size={14} />
              <span>安装文档</span>
            </button>
          ) : null}
          {provider.id === 'grok-build' || provider.id === 'openai-codex' || provider.id === 'opencode' ? (
            <>
              <button
                type="button"
                className="settings-action-button"
                disabled={probeState === 'checking' || diagnosticChecking}
                onClick={() => void (
                  provider.id === 'grok-build'
                    ? onProbeGrok()
                    : provider.id === 'openai-codex'
                      ? onProbeCodex()
                      : onProbeOpenCode()
                )}
              >
                {probeState === 'checking' ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <RotateCw size={14} />
                )}
                <span>{probeState === 'checking' ? '检测中' : '检测连接'}</span>
              </button>
              <button
                type="button"
                className="settings-action-button"
                disabled={probeState === 'checking' || diagnosticChecking}
                onClick={() => void onRunNativeDiagnostic()}
              >
                {diagnosticChecking ? <LoaderCircle size={14} className="spin" /> : <SquareTerminal size={14} />}
                <span>{diagnosticChecking ? '诊断中' : '运行诊断'}</span>
              </button>
            </>
          ) : provider.id === 'claude-code' ? (
            <button type="button" className="settings-action-button" onClick={() => void onRefresh()}>
              <RefreshCw size={14} />
              <span>重新检测</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="agent-provider-lifecycle" aria-live="polite">
        <div className="agent-provider-lifecycle-main">
          <span className={`agent-provider-version-status ${lifecycleStatus.tone}`}>
            {lifecycleStatus.label}
          </span>
          <dl className="agent-provider-version-facts">
            <div>
              <dt>当前版本</dt>
              <dd title={currentVersion}>
                {diagnosticsLoading && !settingsDiagnostics ? (
                  <span className="agent-provider-version-loading">
                    <LoaderCircle size={12} className="spin" />
                    查询中
                  </span>
                ) : currentVersion}
              </dd>
            </div>
            <div>
              <dt>最新版本</dt>
              <dd title={latestVersion ?? settingsDiagnostics?.versionCheckError ?? ''}>
                {latestVersionLoading ? (
                  <span className="agent-provider-version-loading">
                    <LoaderCircle size={12} className="spin" />
                    查询中
                  </span>
                ) : latestVersion ?? '暂不可查询'}
              </dd>
            </div>
          </dl>
          {!isInstalled || updateAvailable ? (
            <button
              type="button"
              className="settings-action-button primary agent-provider-lifecycle-action"
              disabled={Boolean(lifecycleAction) || diagnosticChecking || probeState === 'checking'}
              onClick={() => onRunLifecycleAction(isInstalled ? 'update' : 'install')}
            >
              {lifecycleAction ? (
                <LoaderCircle size={14} className="spin" />
              ) : isInstalled ? (
                <RefreshCw size={14} />
              ) : (
                <Download size={14} />
              )}
              <span>
                {lifecycleAction
                  ? lifecycleAction === 'install' ? '安装中' : '更新中'
                  : isInstalled ? '更新' : '一键安装'}
              </span>
            </button>
          ) : null}
        </div>
        {settingsDiagnostics?.versionCheckError ? (
          <small className="agent-provider-version-error">
            {settingsDiagnostics.versionCheckError}
          </small>
        ) : null}
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
        <ProviderFact icon={SquareTerminal} label="CLI" value={effectiveCliStatus} />
        <ProviderFact icon={KeyRound} label="认证" value={diagnostics.auth} />
        <ProviderFact icon={Network} label="Driver" value={provider.driverId} code />
        {effectiveCommand ? (
          <ProviderFact icon={FileText} label="可执行文件" value={effectiveCommand} code wide />
        ) : null}
        {settingsDiagnostics ? (
          <>
            <ProviderFact icon={FileText} label="配置目录" value={settingsDiagnostics.configDirectory} code wide />
            <ProviderFact icon={SquareTerminal} label="安装命令" value={settingsDiagnostics.installCommand} code wide />
            <ProviderFact icon={RefreshCw} label="更新命令" value={settingsDiagnostics.updateCommand} code wide />
            <ProviderFact icon={SquareTerminal} label="诊断命令" value={settingsDiagnostics.diagnosticCommand} code wide />
            <ProviderFact
              icon={settingsDiagnostics.diagnostic.success === false ? AlertCircle : CheckCircle2}
              label="诊断状态"
              value={formatSettingsDiagnosticStatus(settingsDiagnostics)}
            />
          </>
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

      {provider.id === 'opencode' ? (
        <div className="agent-provider-live-status" aria-live="polite">
          {openCodeProbeState === 'checking' ? <LoaderCircle size={15} className="spin" /> : null}
          {openCodeProbeState === 'error' || (openCodeProbeState === 'ready' && !probeResultAvailable) ? (
            <AlertCircle size={15} />
          ) : null}
          {openCodeProbeState === 'ready' && probeResultAvailable ? <CheckCircle2 size={15} /> : null}
          <span>{openCodeStatusMessage}</span>
        </div>
      ) : null}

      {provider.id === 'grok-build' && grokProbe?.probe ? (
        <DetectedAcpCapabilities probe={grokProbe} />
      ) : null}

      {provider.id === 'opencode' && openCodeProbe?.probe ? (
        <DetectedAcpCapabilities probe={openCodeProbe} />
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
          <span>{models.length > 0
            ? `${models.length} 个`
            : provider.id === 'opencode' && openCodeProbe?.probe
              ? `${openCodeProbe.probe.modelCount} 个`
              : '尚未检测'}</span>
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
            {provider.lifecycle === 'planned'
              ? 'Driver 接入后显示运行时模型'
              : provider.id === 'opencode' && openCodeProbe?.probe
                ? '完整模型列表会在新建任务的模型菜单中按需读取'
                : '当前 Provider 未返回模型'}
          </div>
        )}
      </div>
    </section>
  );
}

function formatSettingsDiagnosticStatus(diagnostics: AgentSettingsDiagnostics) {
  if (!diagnostics.diagnostic.available) {
    return '命令不可用';
  }
  if (diagnostics.diagnostic.success === true) {
    return '检查通过';
  }
  if (diagnostics.diagnostic.success === false) {
    return diagnostics.diagnostic.exitCode == null
      ? '检查失败'
      : `检查失败（退出码 ${diagnostics.diagnostic.exitCode}）`;
  }
  return '可手动运行';
}

function formatAgentVersion(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return '未安装';
  }
  return normalized.match(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/)?.[1] ?? normalized;
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
  const [copied, setCopied] = useState(false);
  const canCopy = code && Boolean(value);
  async function copyValue() {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className={`agent-provider-fact${wide ? ' wide' : ''}`}>
      <dt><Icon size={14} />{label}</dt>
      <dd title={value}>
        {code ? <code>{value}</code> : value}
        {canCopy ? (
          <button
            type="button"
            className="agent-provider-fact-copy"
            onClick={() => void copyValue()}
            aria-label={copied ? `${label}已复制` : `复制${label}`}
            title={copied ? '已复制' : `复制${label}`}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        ) : null}
      </dd>
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

function DetectedAcpCapabilities({ probe }: { probe: GrokAcpProbeResult | OpenCodeAcpProbeResult }) {
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
