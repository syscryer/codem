import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Star,
  Trash2,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useOutsideDismiss } from '../../hooks/useOutsideDismiss';
import {
  addAgentChannelModel,
  addAgentChannelModels,
  createAgentChannel,
  deleteAgentChannel,
  deleteAgentChannelModel,
  discoverAgentChannelModels,
  revealAgentChannelApiKey,
  setDefaultAgentChannel,
  testAgentChannel,
  updateAgentChannel,
  updateAgentChannelModel,
} from '../../lib/agent-channel-api';
import { openExternalUrl } from '../../lib/markdown-link';
import {
  agentChannelTemplate,
  shouldPreservePendingAgentChannelSelection,
  systemAgentChannelTemplate,
} from '../../lib/agent-channel-selection';
import {
  agentChannelProtocolHint,
  filterProviderVendors,
  groupProviderTemplateChannels,
  protocolsForAgent,
  templateSupportsAgent,
} from '../../lib/provider-template-search';
import type {
  AgentChannel,
  AgentChannelBootstrap,
  AgentChannelSettingsFocus,
  AgentChannelModel,
  AgentProviderId,
  AiChatProtocol,
  AiDiscoveredModel,
  AiProviderTemplate,
} from '../../types';
import { AiModelPickerDialog } from '../AiModelPickerDialog';
import { PopoverPortal } from '../PopoverPortal';
import { ProviderBrandIcon } from '../ProviderBrandIcon';
import { AgentSettingsProviderTabs } from './AgentSettingsProviderTabs';

type AgentChannelSettingsProps = {
  bootstrap: AgentChannelBootstrap;
  loading: boolean;
  error: string;
  focusRequest?: AgentChannelSettingsFocus | null;
  onChanged: () => Promise<unknown> | unknown;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

type ChannelDraft = {
  name: string;
  protocol: AiChatProtocol;
  baseUrl: string;
  apiKey: string;
  apiKeyTouched: boolean;
  enabled: boolean;
  isDefault: boolean;
};

type BusyAction =
  | 'save'
  | 'test'
  | 'reveal-api-key'
  | 'discover-models'
  | 'model'
  | 'delete'
  | 'default'
  | '';

const providerLabels: Record<AgentProviderId, string> = {
  'claude-code': 'Claude Code',
  'openai-codex': 'OpenAI Codex',
  'grok-build': 'Grok Build',
  opencode: 'OpenCode',
};

const protocolLabels: Record<AiChatProtocol, string> = {
  openai_responses: 'OpenAI Responses',
  openai_chat: 'OpenAI Chat',
  anthropic_messages: 'Anthropic Messages',
  gemini_generate_content: 'Gemini',
};

export function AgentChannelSettings({
  bootstrap,
  loading,
  error: bootstrapError,
  focusRequest,
  onChanged,
  showToast,
}: AgentChannelSettingsProps) {
  const [providerId, setProviderId] = useState<AgentProviderId>('claude-code');
  const [selectedChannelId, setSelectedChannelId] = useState(
    () => bootstrap.defaultChannelIds['claude-code'] || 'system',
  );
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ChannelDraft>(() => emptyDraft('claude-code'));
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [busy, setBusy] = useState<BusyAction>('');
  const [localError, setLocalError] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [revealedSavedApiKey, setRevealedSavedApiKey] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const [newModelId, setNewModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [discoveredModels, setDiscoveredModels] = useState<AiDiscoveredModel[] | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [confirmDeleteChannelId, setConfirmDeleteChannelId] = useState('');
  const [confirmDeleteModelId, setConfirmDeleteModelId] = useState('');
  const pendingSelectedChannelIdRef = useRef<string | null>(null);

  const channels = useMemo(
    () => bootstrap.channels.filter((channel) => channel.providerId === providerId),
    [bootstrap.channels, providerId],
  );
  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId) ?? null;
  const systemChannel = bootstrap.systemChannels.find((channel) => channel.providerId === providerId) ?? null;
  const templates = useMemo(
    () => bootstrap.templates.filter((template) => templateSupportsAgent(template, providerId)),
    [bootstrap.templates, providerId],
  );
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId)
    ?? matchTemplate(templates, draft)
    ?? null;
  const selectedVendorTemplates = useMemo(
    () => selectedTemplate
      ? templates.filter((template) => template.vendorId === selectedTemplate.vendorId)
      : [],
    [selectedTemplate, templates],
  );
  const selectedVendorChannels = useMemo(
    () => groupProviderTemplateChannels(selectedVendorTemplates),
    [selectedVendorTemplates],
  );
  const selectedChannelTemplates = useMemo(
    () => selectedTemplate
      ? selectedVendorTemplates.filter((template) => template.channelId === selectedTemplate.channelId)
      : [],
    [selectedTemplate, selectedVendorTemplates],
  );
  const visibleModels = useMemo(() => {
    const query = modelQuery.trim().toLocaleLowerCase();
    if (!query) return selectedChannel?.models ?? [];
    return (selectedChannel?.models ?? []).filter((model) =>
      `${model.displayName} ${model.modelId}`.toLocaleLowerCase().includes(query),
    );
  }, [modelQuery, selectedChannel?.models]);
  const protocolHint = agentChannelProtocolHint(providerId, draft.protocol);
  const defaultChannelId = bootstrap.defaultChannelIds[providerId] || 'system';
  const systemTemplate = systemAgentChannelTemplate(systemChannel, templates) ?? null;

  useEffect(() => {
    if (!focusRequest) return;
    const nextProviderId = focusRequest.providerId;
    pendingSelectedChannelIdRef.current = null;
    setProviderId(nextProviderId);
    setSelectedChannelId(bootstrap.defaultChannelIds[nextProviderId] || 'system');
    setCreating(false);
    setDraft(emptyDraft(nextProviderId));
    setSelectedTemplateId('');
    setApiKeyVisible(false);
    setRevealedSavedApiKey(false);
    resetMessages();
  }, [focusRequest?.requestId]);

  useEffect(() => {
    if (creating) return;
    if (selectedChannelId === 'system') {
      return;
    }
    const nextChannel = channels.find((channel) => channel.id === selectedChannelId);
    if (!nextChannel) {
      if (shouldPreservePendingAgentChannelSelection({
        selectedChannelId,
        pendingChannelId: pendingSelectedChannelIdRef.current,
        hasSelectedChannel: false,
      })) {
        return;
      }
      const fallbackId = bootstrap.defaultChannelIds[providerId] || 'system';
      setSelectedChannelId(
        fallbackId === 'system' || channels.some((channel) => channel.id === fallbackId)
          ? fallbackId
          : 'system',
      );
      setDraft(emptyDraft(providerId));
      return;
    }
    if (pendingSelectedChannelIdRef.current === selectedChannelId) {
      pendingSelectedChannelIdRef.current = null;
    }
    setDraft(channelToDraft(nextChannel));
    setSelectedTemplateId(
      nextChannel.templateId
      ?? matchTemplate(templates, channelToDraft(nextChannel))?.id
      ?? '',
    );
  }, [bootstrap.defaultChannelIds, channels, creating, providerId, selectedChannelId, templates]);

  function resetMessages() {
    setLocalError('');
    setTestMessage('');
    setConfirmDeleteChannelId('');
    setConfirmDeleteModelId('');
  }

  function selectProvider(nextProviderId: AgentProviderId) {
    pendingSelectedChannelIdRef.current = null;
    setProviderId(nextProviderId);
    setSelectedChannelId(bootstrap.defaultChannelIds[nextProviderId] || 'system');
    setCreating(false);
    setDraft(emptyDraft(nextProviderId));
    setSelectedTemplateId('');
    setApiKeyVisible(false);
    setRevealedSavedApiKey(false);
    resetMessages();
  }

  function selectChannel(channel: AgentChannel) {
    pendingSelectedChannelIdRef.current = null;
    setSelectedChannelId(channel.id);
    setCreating(false);
    setDraft(channelToDraft(channel));
    setSelectedTemplateId(
      channel.templateId ?? matchTemplate(templates, channelToDraft(channel))?.id ?? '',
    );
    setApiKeyVisible(false);
    setRevealedSavedApiKey(false);
    resetMessages();
  }

  function selectSystemChannel() {
    pendingSelectedChannelIdRef.current = null;
    setSelectedChannelId('system');
    setCreating(false);
    setDraft(emptyDraft(providerId));
    setSelectedTemplateId('');
    setApiKeyVisible(false);
    setRevealedSavedApiKey(false);
    resetMessages();
  }

  function startNewChannel() {
    pendingSelectedChannelIdRef.current = null;
    setCreating(true);
    setSelectedChannelId('');
    setDraft(emptyDraft(providerId));
    setSelectedTemplateId('');
    setApiKeyVisible(false);
    setRevealedSavedApiKey(false);
    resetMessages();
  }

  function applyTemplate(template: AiProviderTemplate | null) {
    setSelectedTemplateId(template?.id ?? '');
    if (!template) return;
    setDraft((current) => ({
      ...current,
      name: current.name.trim() && !creating ? current.name : template.vendorName,
      protocol: template.protocol,
      baseUrl: template.baseUrl,
    }));
  }

  function applyProtocol(protocol: AiChatProtocol) {
    const matchingTemplate = selectedTemplate
      ? templates.find((template) =>
          template.vendorId === selectedTemplate.vendorId
          && template.channelId === selectedTemplate.channelId
          && template.protocol === protocol,
        )
      : null;
    if (matchingTemplate) {
      applyTemplate(matchingTemplate);
      return;
    }
    setSelectedTemplateId('');
    setDraft((current) => ({ ...current, protocol }));
  }

  function applyChannel(channelId: string) {
    const matchingTemplates = selectedVendorTemplates.filter((template) => template.channelId === channelId);
    const matchingTemplate = matchingTemplates.find((template) => template.protocol === draft.protocol)
      ?? matchingTemplates[0];
    if (matchingTemplate) applyTemplate(matchingTemplate);
  }

  async function saveChannel(options?: { silent?: boolean }) {
    const name = draft.name.trim();
    const baseUrl = draft.baseUrl.trim();
    if (!name || !baseUrl) {
      setLocalError('渠道名称和 API 地址不能为空。');
      return null;
    }
    setBusy('save');
    setLocalError('');
    try {
      let channel: AgentChannel;
      if (selectedChannel && !creating) {
        const result = await updateAgentChannel(selectedChannel.id, {
          name,
          protocol: draft.protocol,
          baseUrl,
          templateId: selectedTemplateId,
          enabled: draft.enabled,
          isDefault: draft.isDefault,
          apiKey: draft.apiKey,
          apiKeyTouched: draft.apiKeyTouched,
        });
        channel = result.channel;
      } else {
        const result = await createAgentChannel({
          providerId,
          name,
          protocol: draft.protocol,
          baseUrl,
          templateId: selectedTemplateId,
          enabled: draft.enabled,
          isDefault: draft.isDefault,
          apiKey: draft.apiKey.trim() || undefined,
        });
        channel = result.channel;
      }
      pendingSelectedChannelIdRef.current = channel.id;
      setSelectedChannelId(channel.id);
      setCreating(false);
      setDraft(channelToDraft(channel));
      setApiKeyVisible(false);
      setRevealedSavedApiKey(false);
      await onChanged();
      if (!options?.silent) showToast('Agent 渠道已保存', 'success');
      return channel.id;
    } catch (saveError) {
      setLocalError(saveError instanceof Error ? saveError.message : '保存 Agent 渠道失败');
      return null;
    } finally {
      setBusy('');
    }
  }

  async function saveThenTest() {
    const channelId = await saveChannel({ silent: true });
    if (!channelId) return;
    setBusy('test');
    setLocalError('');
    setTestMessage('');
    try {
      const result = await testAgentChannel(channelId);
      setTestMessage(result.message || '连接成功');
    } catch (testError) {
      setLocalError(testError instanceof Error ? testError.message : '测试 Agent 渠道失败');
    } finally {
      setBusy('');
    }
  }

  async function toggleApiKeyVisibility() {
    if (apiKeyVisible) {
      setApiKeyVisible(false);
      return;
    }
    if (draft.apiKey || !selectedChannel?.apiKeySaved || draft.apiKeyTouched) {
      setApiKeyVisible(true);
      return;
    }
    setBusy('reveal-api-key');
    try {
      const result = await revealAgentChannelApiKey(selectedChannel.id);
      setDraft((current) => ({ ...current, apiKey: result.apiKey, apiKeyTouched: false }));
      setRevealedSavedApiKey(true);
      setApiKeyVisible(true);
    } catch (revealError) {
      setLocalError(revealError instanceof Error ? revealError.message : '读取 API Key 失败');
    } finally {
      setBusy('');
    }
  }

  async function openModelPicker() {
    const channelId = await saveChannel({ silent: true });
    if (!channelId) return;
    setBusy('discover-models');
    setLocalError('');
    try {
      const result = await discoverAgentChannelModels(channelId);
      setDiscoveredModels(result.models);
      setModelPickerOpen(true);
    } catch (discoverError) {
      setLocalError(discoverError instanceof Error ? discoverError.message : '获取模型失败');
    } finally {
      setBusy('');
    }
  }

  async function confirmModelSelection(models: AiDiscoveredModel[]) {
    if (!selectedChannelId) return;
    setBusy('model');
    try {
      await addAgentChannelModels(
        selectedChannelId,
        models.map((model) => ({ modelId: model.modelId, displayName: model.displayName })),
      );
      setModelPickerOpen(false);
      setDiscoveredModels(null);
      await onChanged();
      showToast(`已添加 ${models.length} 个模型`, 'success');
    } catch (modelError) {
      setLocalError(modelError instanceof Error ? modelError.message : '添加模型失败');
    } finally {
      setBusy('');
    }
  }

  async function addModel() {
    const channelId = selectedChannelId || await saveChannel({ silent: true });
    const modelId = newModelId.trim();
    if (!channelId || !modelId) return;
    setBusy('model');
    try {
      await addAgentChannelModel(channelId, {
        modelId,
        displayName: newModelName.trim() || modelId,
      });
      setNewModelId('');
      setNewModelName('');
      await onChanged();
    } catch (modelError) {
      setLocalError(modelError instanceof Error ? modelError.message : '添加模型失败');
    } finally {
      setBusy('');
    }
  }

  async function patchModel(model: AgentChannelModel, update: { enabled?: boolean; isDefault?: boolean }) {
    setBusy('model');
    try {
      await updateAgentChannelModel(model.id, update);
      await onChanged();
    } catch (modelError) {
      setLocalError(modelError instanceof Error ? modelError.message : '更新模型失败');
    } finally {
      setBusy('');
    }
  }

  async function removeModel(model: AgentChannelModel) {
    setBusy('model');
    try {
      await deleteAgentChannelModel(model.id);
      setConfirmDeleteModelId('');
      await onChanged();
    } catch (modelError) {
      setLocalError(modelError instanceof Error ? modelError.message : '删除模型失败');
    } finally {
      setBusy('');
    }
  }

  async function removeChannel(channel: AgentChannel) {
    setBusy('delete');
    try {
      await deleteAgentChannel(channel.id);
      if (selectedChannelId === channel.id) {
        setSelectedChannelId('system');
      }
      setConfirmDeleteChannelId('');
      await onChanged();
      showToast('Agent 渠道已删除', 'success');
    } catch (deleteError) {
      setLocalError(deleteError instanceof Error ? deleteError.message : '删除 Agent 渠道失败');
    } finally {
      setBusy('');
    }
  }


  async function makeDefault(channelId: string) {
    setBusy('default');
    setLocalError('');
    try {
      await setDefaultAgentChannel(providerId, channelId);
      await onChanged();
      showToast(channelId === 'system' ? '已将系统渠道设为默认' : '已设置默认渠道', 'success');
    } catch (defaultError) {
      setLocalError(defaultError instanceof Error ? defaultError.message : '设置默认渠道失败');
    } finally {
      setBusy('');
    }
  }

  const displayedError = localError || bootstrapError;

  return (
    <div className="agent-channel-settings">
      <div className="agent-channel-provider-bar">
        <AgentSettingsProviderTabs value={providerId} onChange={selectProvider} disabled={Boolean(busy)} />
        <button type="button" className="secondary agent-channel-refresh" disabled={loading || Boolean(busy)} onClick={() => void onChanged()}>
          <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
          刷新状态
        </button>
      </div>

      <div className="ai-manager-layout agent-channel-layout">
        <aside className="ai-manager-sidebar agent-channel-sidebar">
          <div className="ai-manager-sidebar-title">
            <div><span>渠道</span><small>{channels.length + 1} 个配置</small></div>
            <button type="button" className="ai-manager-add-provider-button" aria-label="新增 Agent 渠道" title="新增 Agent 渠道" onClick={startNewChannel}>
              <Plus size={17} />
            </button>
          </div>
          <div className="ai-manager-provider-list">
            <div className={`ai-manager-provider-row agent-channel-list-row${!creating && selectedChannelId === 'system' ? ' active' : ''}`}>
              <button type="button" className="agent-channel-list-main" onClick={selectSystemChannel}>
                {systemTemplate
                  ? <ProviderBrandIcon icon={systemTemplate.icon} name={systemTemplate.vendorName} size={30} />
                  : <Route size={22} />}
                <span className="agent-channel-list-copy">
                  <strong>系统渠道</strong>
                  <small>{systemChannel?.ccSwitchProviderName || '跟随 Agent 当前配置'}</small>
                  <em title={systemChannel?.baseUrl}>{systemChannel?.baseUrl || '由 Agent 管理 API 地址'}</em>
                  <b title={systemChannel?.model}>{systemChannel?.model ? `默认模型：${systemChannel.model}` : '默认模型：跟随 Agent'}</b>
                </span>
              </button>
              <span className="agent-channel-list-status">
                {defaultChannelId === 'system' ? <Star size={13} fill="currentColor" aria-label="默认渠道" /> : null}
                <i className={systemChannel?.configured ? 'online' : ''} aria-label={systemChannel?.configured ? '已配置' : '使用 Agent 默认值'} />
              </span>
            </div>
            {channels.map((channel) => {
              const channelTemplate = agentChannelTemplate(channel, templates);
              const defaultModel = channel.models.find((model) => model.enabled && model.isDefault)
                ?? channel.models.find((model) => model.enabled);
              return (
                <div
                  key={channel.id}
                  className={`ai-manager-provider-row agent-channel-list-row${!creating && channel.id === selectedChannelId ? ' active' : ''}`}
                >
                  <button type="button" className="agent-channel-list-main" onClick={() => selectChannel(channel)}>
                    {channelTemplate
                      ? <ProviderBrandIcon icon={channelTemplate.icon} name={channelTemplate.vendorName} size={30} />
                      : <Route size={22} />}
                    <span className="agent-channel-list-copy">
                      <strong>{channel.name}</strong>
                      <small>{protocolLabels[channel.protocol]}</small>
                      <em title={channel.baseUrl}>{channel.baseUrl}</em>
                      <b title={defaultModel?.displayName || defaultModel?.modelId}>默认模型：{defaultModel?.displayName || defaultModel?.modelId || '未设置'}</b>
                    </span>
                  </button>
                  <span className="agent-channel-list-status">
                    {channel.isDefault ? <Star size={13} fill="currentColor" /> : null}
                    <i className={channel.enabled ? 'online' : ''} aria-label={channel.enabled ? '已启用' : '已停用'} />
                  </span>
                  <button
                    type="button"
                    className={`agent-channel-list-delete${confirmDeleteChannelId === channel.id ? ' confirming' : ''}`}
                    disabled={Boolean(busy)}
                    aria-label={confirmDeleteChannelId === channel.id ? `确认删除 ${channel.name}` : `删除 ${channel.name}`}
                    title={confirmDeleteChannelId === channel.id ? '再次点击确认删除' : '删除渠道'}
                    onClick={() => {
                      if (confirmDeleteChannelId === channel.id) {
                        void removeChannel(channel);
                      } else {
                        setConfirmDeleteChannelId(channel.id);
                      }
                    }}
                  >
                    {confirmDeleteChannelId === channel.id ? '确认' : <Trash2 size={14} />}
                  </button>
                </div>
              );
            })}
            {channels.length === 0 && !loading ? <div className="provider-menu-empty">还没有 CodeM 渠道，可继续使用系统渠道</div> : null}
          </div>
        </aside>

        <div className="ai-manager-content agent-channel-content">
          {!creating && selectedChannelId === 'system' ? (
            <SystemChannelDetails
              systemChannel={systemChannel}
              template={systemTemplate}
              ccSwitchDetected={bootstrap.ccSwitch.detected}
              isDefault={defaultChannelId === 'system'}
              busy={Boolean(busy)}
              error={displayedError}
              onMakeDefault={() => void makeDefault('system')}
            />
          ) : (selectedChannel || creating) ? (
            <>
              <section className="ai-manager-section agent-channel-editor">
                <div className="ai-manager-section-head">
                  <div>
                    <h3>{creating ? `新增 ${providerLabels[providerId]} 渠道` : '渠道配置'}</h3>
                    <p>此配置只注入 CodeM 启动的 Agent 子进程，不修改系统或 CC Switch。</p>
                  </div>
                  <div className="ai-manager-section-head-actions">
                    <button
                      type="button"
                      className={`ai-manager-default-provider-button${(creating ? draft.isDefault : selectedChannel?.isDefault) ? ' active' : ''}`}
                      disabled={Boolean(busy) || (!creating && selectedChannel?.isDefault)}
                      onClick={() => creating
                        ? setDraft({ ...draft, isDefault: !draft.isDefault })
                        : selectedChannel && void makeDefault(selectedChannel.id)}
                    >
                      <Star size={14} fill={(creating ? draft.isDefault : selectedChannel?.isDefault) ? 'currentColor' : 'none'} />
                      {(creating ? draft.isDefault : selectedChannel?.isDefault) ? '默认渠道' : '设为默认'}
                    </button>
                    <button type="button" className={`ai-manager-enable-button${draft.enabled ? ' active' : ''}`} onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}>
                      <span />{draft.enabled ? '已启用' : '已停用'}
                    </button>
                    <button type="button" className="ai-manager-save-button" disabled={Boolean(busy)} onClick={() => void saveChannel()}>
                      {busy === 'save' ? <Loader2 size={14} className="spin-icon" /> : <Check size={14} />}保存配置
                    </button>
                  </div>
                </div>

                <div className="ai-manager-form-grid">
                  <label><span>渠道名称</span><input value={draft.name} placeholder="例如：MiniMax Coding Plan" onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
                  <label>
                    <span>厂商预设</span>
                    <AgentTemplateDropdown templates={templates} selected={selectedTemplate} protocol={draft.protocol} onChange={applyTemplate} />
                  </label>
                  <div className="ai-manager-template-config wide">
                    {selectedTemplate ? (
                      <div className="ai-manager-template-field">
                        <span>渠道</span>
                        <div className="ai-manager-option-list ai-manager-channel-options" role="radiogroup" aria-label="Agent 渠道">
                          {selectedVendorChannels.map((channel) => (
                            <button
                              key={channel.id}
                              type="button"
                              role="radio"
                              aria-checked={selectedTemplate.channelId === channel.id}
                              className={selectedTemplate.channelId === channel.id ? 'active' : ''}
                              onClick={() => applyChannel(channel.id)}
                            >
                              {channel.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="ai-manager-template-field">
                      <span>接口类型</span>
                      <div className="ai-manager-option-list ai-manager-protocol-options" role="radiogroup" aria-label="Agent 渠道接口类型">
                        {selectedTemplate
                          ? selectedChannelTemplates.map((template) => (
                              <button key={template.id} type="button" role="radio" aria-checked={selectedTemplate.id === template.id} className={selectedTemplate.id === template.id ? 'active' : ''} onClick={() => applyTemplate(template)}>
                                {protocolLabels[template.protocol]}
                              </button>
                            ))
                          : protocolsForAgent(providerId).map((protocol) => (
                              <button key={protocol} type="button" role="radio" aria-checked={draft.protocol === protocol} className={draft.protocol === protocol ? 'active' : ''} onClick={() => applyProtocol(protocol)}>
                                {protocolLabels[protocol]}
                              </button>
                            ))}
                      </div>
                      {protocolHint ? <small className="agent-channel-protocol-note">{protocolHint}</small> : null}
                    </div>
                  </div>
                  <label className="wide"><span>API 地址</span><input value={draft.baseUrl} placeholder="https://api.example.com" onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
                  <label className="wide">
                    <span>API Key</span>
                    <div className="ai-manager-secret-input">
                      <input
                        type={apiKeyVisible ? 'text' : 'password'}
                        value={draft.apiKey}
                        placeholder={selectedChannel?.apiKeySaved ? '已安全保存；留空保持不变' : '输入 API Key'}
                        autoComplete="off"
                        onChange={(event) => {
                          setRevealedSavedApiKey(false);
                          setDraft({ ...draft, apiKey: event.target.value, apiKeyTouched: true });
                        }}
                      />
                      <button type="button" className="ai-manager-secret-toggle" aria-label={apiKeyVisible ? '隐藏 API Key' : '查看 API Key'} disabled={Boolean(busy) || (!draft.apiKey && !selectedChannel?.apiKeySaved)} onClick={() => void toggleApiKeyVisibility()}>
                        {busy === 'reveal-api-key' ? <Loader2 size={15} className="spin-icon" /> : apiKeyVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    {revealedSavedApiKey ? <small className="agent-channel-secret-note">密钥仅在当前输入框临时显示，页面刷新后会清除。</small> : null}
                  </label>
                </div>

                <div className="ai-manager-connection-footer agent-channel-connection-footer">
                  <div className="ai-manager-template-links">
                    {selectedTemplate?.apiKeyUrl ? <button type="button" onClick={() => void openExternalUrl(selectedTemplate.apiKeyUrl)}><KeyRound size={13} />获取 API Key<ExternalLink size={12} /></button> : null}
                    {selectedTemplate?.docsUrl ? <button type="button" onClick={() => void openExternalUrl(selectedTemplate.docsUrl)}>查看接口文档<ExternalLink size={12} /></button> : null}
                  </div>
                  <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void saveThenTest()}>
                    {busy === 'test' ? <Loader2 size={14} className="spin-icon" /> : <ShieldCheck size={14} />}测试连接
                  </button>
                </div>
                {testMessage ? <div className="ai-manager-success">{testMessage}</div> : null}
                {displayedError ? <div className="assistant-runtime-error">{displayedError}</div> : null}
              </section>

              <section className="ai-manager-section ai-manager-model-section">
                <div className="ai-manager-section-head">
                  <div><h3>渠道模型</h3><p>模型只属于当前渠道，可远程多选获取，也可手工维护。</p></div>
                  <div className="ai-manager-model-head-actions">
                    <span>{selectedChannel?.models.length ?? 0} 个</span>
                    <button type="button" className="ai-manager-model-discover-button" disabled={Boolean(busy)} onClick={() => void openModelPicker()}>
                      {busy === 'discover-models' ? <Loader2 size={14} className="spin-icon" /> : <RefreshCw size={14} />}<span>获取模型</span>
                    </button>
                  </div>
                </div>
                <label className="ai-manager-model-search"><span className="sr-only">搜索模型</span><input value={modelQuery} placeholder="搜索模型名称或 ID" onChange={(event) => setModelQuery(event.target.value)} /></label>
                <div className="ai-manager-model-list">
                  {visibleModels.map((model) => (
                    <div key={model.id} className={`ai-manager-model-row${model.enabled ? '' : ' disabled'}`}>
                      <div><strong>{model.displayName}</strong><small>{model.modelId}</small></div>
                      <div className="ai-manager-model-actions">
                        <button type="button" className={model.isDefault ? 'active' : ''} disabled={Boolean(busy)} onClick={() => void patchModel(model, { isDefault: true, enabled: true })}>{model.isDefault ? '默认' : '设为默认'}</button>
                        <button type="button" disabled={Boolean(busy)} onClick={() => void patchModel(model, { enabled: !model.enabled })}>{model.enabled ? '禁用' : '启用'}</button>
                        <button type="button" className="danger" disabled={Boolean(busy)} aria-label={`删除 ${model.displayName}`} onClick={() => confirmDeleteModelId === model.id ? void removeModel(model) : setConfirmDeleteModelId(model.id)}>
                          {confirmDeleteModelId === model.id ? '确认' : <Trash2 size={14} />}
                        </button>
                      </div>
                    </div>
                  ))}
                  {!selectedChannel?.models.length ? <div className="provider-menu-empty">保存渠道后即可获取或添加模型</div> : null}
                  {Boolean(selectedChannel?.models.length) && visibleModels.length === 0 ? <div className="provider-menu-empty">没有匹配的模型</div> : null}
                </div>
                <div className="ai-manager-add-model">
                  <input value={newModelId} placeholder="模型 ID" onChange={(event) => setNewModelId(event.target.value)} />
                  <input value={newModelName} placeholder="显示名称（可选）" onChange={(event) => setNewModelName(event.target.value)} />
                  <button type="button" disabled={!newModelId.trim() || Boolean(busy)} onClick={() => void addModel()}><Plus size={14} />添加</button>
                </div>
              </section>
            </>
          ) : (
            <div className="ai-manager-empty agent-channel-empty"><Route size={30} /><h3>为 {providerLabels[providerId]} 新增渠道</h3><p>系统渠道始终可用；只有需要在 CodeM 内切换独立渠道时才需要新增。</p><button type="button" onClick={startNewChannel}><Plus size={14} />新增渠道</button></div>
          )}
        </div>
      </div>

      {modelPickerOpen && discoveredModels ? (
        <AiModelPickerDialog
          open
          providerName={draft.name || providerLabels[providerId]}
          models={discoveredModels}
          existingModelIds={new Set((selectedChannel?.models ?? []).map((model) => model.modelId.toLocaleLowerCase()))}
          onClose={() => { setModelPickerOpen(false); setDiscoveredModels(null); }}
          onConfirm={(models) => void confirmModelSelection(models)}
        />
      ) : null}
    </div>
  );
}

function SystemChannelDetails({
  systemChannel,
  template,
  ccSwitchDetected,
  isDefault,
  busy,
  error,
  onMakeDefault,
}: {
  systemChannel: AgentChannelBootstrap['systemChannels'][number] | null;
  template: AiProviderTemplate | null;
  ccSwitchDetected: boolean;
  isDefault: boolean;
  busy: boolean;
  error: string;
  onMakeDefault: () => void;
}) {
  return (
    <section className="ai-manager-section agent-system-channel-details">
      <div className="ai-manager-section-head">
        <div className="agent-system-channel-heading">
          <span className="agent-system-channel-icon">
            {template
              ? <ProviderBrandIcon icon={template.icon} name={template.vendorName} size={38} />
              : <Route size={24} />}
          </span>
          <div>
            <h3>系统渠道</h3>
            <p>{systemChannel?.detail ?? '正在读取当前 Agent 配置。'}</p>
          </div>
        </div>
        <div className="ai-manager-section-head-actions">
          <span className="agent-system-channel-readonly">只读</span>
          <button
            type="button"
            className={`ai-manager-default-provider-button${isDefault ? ' active' : ''}`}
            disabled={busy || isDefault}
            onClick={onMakeDefault}
          >
            <Star size={14} fill={isDefault ? 'currentColor' : 'none'} />
            {isDefault ? '默认渠道' : '设为默认'}
          </button>
        </div>
      </div>
      <div className="agent-system-channel-readonly-grid">
        <SystemChannelField label="配置来源" value={systemChannel?.ccSwitchProviderName ? `CC Switch · ${systemChannel.ccSwitchProviderName}` : 'Agent 系统配置'} />
        <SystemChannelField label="接口类型" value={systemChannel?.protocol ? protocolLabels[systemChannel.protocol] : '由 Agent 决定'} />
        <SystemChannelField label="API 地址" value={systemChannel?.baseUrl || '由 Agent 当前配置决定'} wide />
        <SystemChannelField label="当前默认模型" value={systemChannel?.model || '跟随 Agent 默认模型'} />
        <SystemChannelField label="配置状态" value={systemChannel?.configured ? '已检测到配置' : '使用 Agent 默认值'} />
        <SystemChannelField label="配置路径" value={systemChannel?.configPath || '未检测到独立配置文件'} wide />
      </div>
      {ccSwitchDetected && !systemChannel?.ccSwitchProviderName ? (
        <p className="agent-system-channel-note">已检测到 CC Switch，但当前 Agent 没有标记活动渠道。</p>
      ) : null}
      {error ? <div className="assistant-runtime-error">{error}</div> : null}
    </section>
  );
}

function SystemChannelField({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`agent-system-channel-field${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function AgentTemplateDropdown({
  templates,
  selected,
  protocol,
  onChange,
}: {
  templates: AiProviderTemplate[];
  selected: AiProviderTemplate | null;
  protocol: AiChatProtocol;
  onChange: (template: AiProviderTemplate | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleVendors = useMemo(() => filterProviderVendors(templates, query), [query, templates]);
  const customVisible = !normalizedQuery || '自定义渠道'.includes(normalizedQuery);
  const options = useMemo(() => [
    ...visibleVendors.flatMap((vendor) => {
      const template = vendor.templates.find((item) => item.protocol === protocol) ?? vendor.templates[0];
      return template ? [{ id: vendor.id, name: vendor.name, icon: vendor.icon, template }] : [];
    }),
    ...(customVisible ? [{ id: 'custom', name: '自定义渠道', icon: '', template: null }] : []),
  ], [customVisible, protocol, visibleVendors]);
  const selectedVendorId = selected?.vendorId ?? 'custom';
  const selectedName = selected?.vendorName ?? '自定义渠道';
  const selectedIcon = selected?.icon;
  useOutsideDismiss({
    selectors: open
      ? [{ selector: '.agent-channel-template-menu', onDismiss: () => setOpen(false), anchorRefs: [anchorRef] }]
      : [],
  });
  useEffect(() => {
    if (!open) return;
    setHighlightedIndex(0);
    requestAnimationFrame(() => searchRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      setQuery('');
      anchorRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }

    function handleResize() {
      setOpen(false);
      setQuery('');
    }

    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [open]);

  useEffect(() => {
    setHighlightedIndex((current) => Math.min(current, Math.max(0, options.length - 1)));
  }, [options.length]);

  function chooseVendor(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.template);
    setOpen(false);
    setQuery('');
    requestAnimationFrame(() => anchorRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((current) => Math.min(current + 1, options.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      chooseVendor(highlightedIndex);
    }
  }

  return (
    <div className="settings-select-anchor ai-manager-vendor-select" ref={anchorRef}>
      <button
        type="button"
        className={`settings-select-trigger ai-manager-vendor-trigger${open ? ' open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="选择厂商"
        onClick={() => {
          setQuery('');
          setOpen((current) => !current);
        }}
      >
        <span className="ai-manager-vendor-trigger-main">
          {selected ? <ProviderBrandIcon icon={selectedIcon} name={selectedName} size={22} /> : <Route size={19} />}
          <span>{selectedName}</span>
        </span>
        <ChevronDown size={15} className="settings-select-chevron" />
      </button>
      <PopoverPortal open={open} anchorRef={anchorRef} placement="bottom-start">
        <div className="settings-select-menu ai-manager-vendor-menu agent-channel-template-menu">
          <label className="ai-manager-vendor-search">
            <Search size={14} />
            <span className="sr-only">搜索厂商</span>
            <input
              ref={searchRef}
              value={query}
              role="combobox"
              aria-label="搜索厂商"
              aria-controls={listboxId}
              aria-expanded="true"
              aria-autocomplete="list"
              aria-activedescendant={options[highlightedIndex] ? `${listboxId}-${highlightedIndex}` : undefined}
              placeholder="搜索厂商"
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
            />
          </label>
          <div id={listboxId} className="ai-manager-vendor-options" role="listbox" aria-label="Agent 渠道厂商预设">
            {options.map((option, index) => (
              <button
                id={`${listboxId}-${index}`}
                key={option.id}
                type="button"
                role="option"
                aria-selected={option.id === selectedVendorId}
                className={`ai-manager-vendor-option${option.id === selectedVendorId ? ' current' : ''}${index === highlightedIndex ? ' highlighted' : ''}`}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => chooseVendor(index)}
              >
                {option.template ? <ProviderBrandIcon icon={option.icon} name={option.name} size={24} /> : <Route size={20} />}
                <span>{option.name}</span>
                {option.id === selectedVendorId ? <Check size={14} /> : null}
              </button>
            ))}
            {options.length === 0 ? <div className="provider-menu-empty">没有匹配的厂商</div> : null}
          </div>
        </div>
      </PopoverPortal>
    </div>
  );
}

function emptyDraft(providerId: AgentProviderId): ChannelDraft {
  return {
    name: '',
    protocol: protocolsForAgent(providerId)[0],
    baseUrl: '',
    apiKey: '',
    apiKeyTouched: false,
    enabled: true,
    isDefault: false,
  };
}

function channelToDraft(channel: AgentChannel): ChannelDraft {
  return {
    name: channel.name,
    protocol: channel.protocol,
    baseUrl: channel.baseUrl,
    apiKey: '',
    apiKeyTouched: false,
    enabled: channel.enabled,
    isDefault: channel.isDefault,
  };
}

function matchTemplate(templates: AiProviderTemplate[], draft: Pick<ChannelDraft, 'protocol' | 'baseUrl'>) {
  const baseUrl = draft.baseUrl.trim().replace(/\/+$/, '');
  return templates.find((template) =>
    template.protocol === draft.protocol && template.baseUrl.replace(/\/+$/, '') === baseUrl,
  ) ?? null;
}
