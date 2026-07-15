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
  Search,
  ServerCog,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import {
  createAiModel,
  createAiModelsBatch,
  createAiProvider,
  discoverAiProviderDraftModels,
  discoverAiProviderModels,
  deleteAiModel,
  deleteAiProvider,
  loadAiProviderTemplates,
  probeAiProvider,
  revealAiProviderApiKey,
  testAiProvider,
  updateAiModel,
  updateAiProvider,
} from '../lib/ordinary-chat-api';
import { openExternalUrl } from '../lib/markdown-link';
import { filterProviderVendors } from '../lib/provider-template-search';
import { ProviderBrandIcon } from './ProviderBrandIcon';
import { AiModelPickerDialog } from './AiModelPickerDialog';
import { PopoverPortal } from './PopoverPortal';
import type {
  AiChatModel,
  AiChatProtocol,
  AiChatProvider,
  AiDiscoveredModel,
  AiProviderTemplate,
} from '../types';

type ProviderDraft = {
  presetId?: string;
  name: string;
  protocol: AiChatProtocol;
  baseUrl: string;
  apiKey: string;
  apiKeyTouched: boolean;
  enabled: boolean;
  isDefault: boolean;
  models: AiChatModel[];
};

type AiProviderManagerDialogProps = {
  open: boolean;
  providers: AiChatProvider[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

type AiProviderSettingsPanelProps = {
  active?: boolean;
  providers: AiChatProvider[];
  onChanged: () => Promise<void> | void;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

const protocolOptions: Array<{ value: AiChatProtocol; label: string }> = [
  { value: 'openai_responses', label: 'OpenAI Responses' },
  { value: 'openai_chat', label: 'OpenAI Chat' },
  { value: 'anthropic_messages', label: 'Anthropic' },
  { value: 'gemini_generate_content', label: 'Gemini' },
];

export function AiProviderSettingsPanel({
  active = true,
  providers,
  onChanged,
  showToast,
}: AiProviderSettingsPanelProps) {
  const [templates, setTemplates] = useState<AiProviderTemplate[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [newModelId, setNewModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [modelQuery, setModelQuery] = useState('');
  const [discoveredModels, setDiscoveredModels] = useState<AiDiscoveredModel[] | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [revealedSavedApiKey, setRevealedSavedApiKey] = useState(false);
  const [confirmDeleteProvider, setConfirmDeleteProvider] = useState(false);
  const [confirmDeleteModelId, setConfirmDeleteModelId] = useState('');

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  );
  const visibleModels = useMemo(() => {
    const query = modelQuery.trim().toLocaleLowerCase();
    const models = draft?.models ?? [];
    if (!query) return models;
    return models.filter((model) =>
      `${model.displayName} ${model.modelId}`.toLocaleLowerCase().includes(query),
    );
  }, [draft?.models, modelQuery]);
  const activeTemplate = useMemo(
    () => templates.find((template) => template.id === draft?.presetId) ?? null,
    [draft?.presetId, templates],
  );
  const activeVendorTemplates = useMemo(
    () => activeTemplate
      ? templates.filter((template) => template.vendorId === activeTemplate.vendorId)
      : [],
    [activeTemplate, templates],
  );
  const activeChannels = useMemo(
    () => uniqueTemplateChannels(activeVendorTemplates),
    [activeVendorTemplates],
  );
  const activeChannelTemplates = useMemo(
    () => activeTemplate
      ? activeVendorTemplates.filter((template) => template.channelId === activeTemplate.channelId)
      : [],
    [activeTemplate, activeVendorTemplates],
  );
  const customVendorSelected = Boolean(!activeTemplate && (selectedProvider || draft?.name || draft?.baseUrl));

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void loadAiProviderTemplates(controller.signal)
      .then(setTemplates)
      .catch((nextError) => {
        if (isAbortError(nextError)) return;
        setError(nextError instanceof Error ? nextError.message : '供应商模板加载失败');
      });
    return () => controller.abort();
  }, [active]);

  useEffect(() => {
    if (!active) return;
    setSelectedProviderId((current) => {
      if (providers.some((provider) => provider.id === current)) return current;
      return providers[0]?.id ?? '';
    });
  }, [active, providers]);

  useEffect(() => {
    if (!active) return;
    if (selectedProvider) {
      setDraft(providerToDraft(selectedProvider));
    } else if (selectedProviderId) {
      setDraft(null);
    }
    setError('');
    setTestMessage('');
    setConfirmDeleteProvider(false);
    setConfirmDeleteModelId('');
    setNewModelId('');
    setNewModelName('');
    setModelQuery('');
    setDiscoveredModels(null);
    setModelPickerOpen(false);
    setApiKeyVisible(false);
    setRevealedSavedApiKey(false);
  }, [active, selectedProvider, selectedProviderId]);

  if (!active) return null;

  function startNewProvider() {
    setSelectedProviderId('');
    setDraft({
      name: '',
      protocol: 'openai_chat',
      baseUrl: '',
      apiKey: '',
      apiKeyTouched: false,
      enabled: true,
      isDefault: false,
      models: [],
    });
    setError('');
    setTestMessage('');
  }

  function startTemplate(template: AiProviderTemplate) {
    const matchingVendorCount = providers.filter((provider) =>
      templates.some((item) => item.id === provider.presetId && item.vendorId === template.vendorId),
    ).length;
    setSelectedProviderId('');
    setDraft({
      presetId: template.id,
      name: matchingVendorCount > 0 ? `${template.vendorName} ${matchingVendorCount + 1}` : template.name,
      protocol: template.protocol,
      baseUrl: template.baseUrl,
      apiKey: '',
      apiKeyTouched: false,
      enabled: true,
      isDefault: false,
      models: [],
    });
    setError('');
    setTestMessage('');
  }

  function switchTemplate(template: AiProviderTemplate) {
    setDraft((current) => {
      if (!current) return current;
      const previousTemplate = templates.find((item) => item.id === current.presetId);
      const shouldUpdateName = !current.name.trim()
        || current.name === previousTemplate?.name
        || current.name === '自定义供应商';
      return {
        ...current,
        presetId: template.id,
        name: shouldUpdateName ? template.name : current.name,
        protocol: template.protocol,
        baseUrl: template.baseUrl,
      };
    });
    setError('');
    setTestMessage('');
  }

  function switchChannel(channelId: string) {
    if (!activeTemplate) return;
    const candidates = activeVendorTemplates.filter((template) => template.channelId === channelId);
    const nextTemplate = candidates.find((template) => template.protocol === activeTemplate.protocol)
      ?? candidates[0];
    if (nextTemplate) switchTemplate(nextTemplate);
  }

  function selectVendor(template: AiProviderTemplate | null) {
    if (template) {
      if (activeTemplate?.vendorId !== template.vendorId) {
        startTemplate(template);
      }
      return;
    }
    if (!customVendorSelected) {
      startCustomProvider();
    }
  }

  function startCustomProvider() {
    setSelectedProviderId('');
    setDraft({
      name: '自定义供应商',
      protocol: 'openai_chat',
      baseUrl: 'https://',
      apiKey: '',
      apiKeyTouched: false,
      enabled: true,
      isDefault: false,
      models: [],
    });
  }

  async function saveProvider() {
    if (!draft || busy) return;
    if (!draft.name.trim() || !draft.baseUrl.trim()) {
      setError('供应商名称和 API 地址不能为空');
      return;
    }
    setBusy('save');
    setError('');
    try {
      const creating = !selectedProvider;
      const provider = selectedProvider
        ? await updateAiProvider(selectedProvider.id, {
            presetId: draft.presetId,
            name: draft.name.trim(),
            protocol: draft.protocol,
            baseUrl: draft.baseUrl.trim(),
            enabled: draft.enabled,
            isDefault: draft.isDefault,
            apiKey: draft.apiKey,
            apiKeyTouched: draft.apiKeyTouched,
          })
        : await createAiProvider({
            presetId: draft.presetId,
            name: draft.name.trim(),
            protocol: draft.protocol,
            baseUrl: draft.baseUrl.trim(),
            enabled: draft.enabled,
            isDefault: draft.isDefault,
            apiKey: draft.apiKey.trim() || undefined,
            models: draft.models.map((model) => ({
              modelId: model.modelId,
              displayName: model.displayName,
              enabled: model.enabled,
              isDefault: model.isDefault,
              capabilities: model.capabilities,
            })),
          });
      setSelectedProviderId(provider.id);
      await onChanged();
      if (creating && draft.models.length) {
        setTestMessage(`供应商已创建，已添加 ${draft.models.length} 个模型`);
      }
      showToast(selectedProvider ? 'AI 供应商已更新' : 'AI 供应商已创建', 'success');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '保存 AI 供应商失败');
    } finally {
      setBusy('');
    }
  }

  async function testCurrentProvider() {
    if (!draft || busy) return;
    setBusy('test');
    setError('');
    setTestMessage('');
    try {
      const result = shouldProbeDraft(selectedProvider, draft)
        ? await probeAiProvider(providerProbeInput(draft))
        : await testAiProvider(selectedProvider!.id);
      setTestMessage(result.message);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '供应商连接测试失败');
    } finally {
      setBusy('');
    }
  }

  async function openModelPicker() {
    if (!draft || busy) return;
    setBusy('discover-models');
    setError('');
    setTestMessage('');
    try {
      const models = shouldProbeDraft(selectedProvider, draft)
        ? await discoverAiProviderDraftModels(providerProbeInput(draft, false))
        : await discoverAiProviderModels(selectedProvider!.id);
      setDiscoveredModels(models);
      setModelPickerOpen(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '获取模型列表失败');
    } finally {
      setBusy('');
    }
  }

  async function toggleApiKeyVisibility() {
    if (!draft || busy) return;
    if (apiKeyVisible) {
      setApiKeyVisible(false);
      if (revealedSavedApiKey) {
        setDraft({ ...draft, apiKey: '', apiKeyTouched: false });
        setRevealedSavedApiKey(false);
      }
      return;
    }
    if (draft.apiKey || !selectedProvider?.apiKeySaved) {
      setApiKeyVisible(true);
      return;
    }
    setBusy('reveal-api-key');
    setError('');
    try {
      const apiKey = await revealAiProviderApiKey(selectedProvider.id);
      setDraft({ ...draft, apiKey, apiKeyTouched: false });
      setRevealedSavedApiKey(true);
      setApiKeyVisible(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取 API Key 失败');
    } finally {
      setBusy('');
    }
  }

  async function confirmModelSelection(models: AiDiscoveredModel[]) {
    if (!draft || !models.length || busy) return;
    if (!selectedProvider) {
      const nextModels = mergeDraftModels(draft.models, models);
      setDraft({ ...draft, models: nextModels });
      setModelPickerOpen(false);
      setDiscoveredModels(null);
      setTestMessage(`已选择 ${models.length} 个模型，将在创建供应商时保存`);
      return;
    }

    setBusy('add-models');
    setError('');
    try {
      await createAiModelsBatch(
        selectedProvider.id,
        models.map((model, index) => ({
          modelId: model.modelId,
          displayName: model.displayName,
          enabled: true,
          isDefault: selectedProvider.models.length === 0 && index === 0,
        })),
      );
      setModelPickerOpen(false);
      setDiscoveredModels(null);
      await onChanged();
      setTestMessage(`已添加 ${models.length} 个模型`);
      showToast(`已添加 ${models.length} 个模型`, 'success');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '批量添加模型失败');
    } finally {
      setBusy('');
    }
  }

  async function removeProvider() {
    if (!selectedProvider || busy) return;
    setBusy('delete-provider');
    try {
      await deleteAiProvider(selectedProvider.id);
      setSelectedProviderId('');
      setDraft(null);
      await onChanged();
      showToast('AI 供应商已删除', 'success');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '删除 AI 供应商失败');
    } finally {
      setBusy('');
      setConfirmDeleteProvider(false);
    }
  }

  async function addModel() {
    if (!draft || !newModelId.trim() || busy) return;
    const modelId = newModelId.trim();
    if (draft.models.some((model) => model.modelId.toLocaleLowerCase() === modelId.toLocaleLowerCase())) {
      setError('该模型已经添加');
      return;
    }
    if (!selectedProvider) {
      setDraft({
        ...draft,
        models: mergeDraftModels(draft.models, [{ modelId, displayName: newModelName.trim() || modelId }]),
      });
      setNewModelId('');
      setNewModelName('');
      setError('');
      return;
    }
    setBusy('add-model');
    setError('');
    try {
      await createAiModel(selectedProvider.id, {
        modelId,
        displayName: newModelName.trim() || undefined,
        enabled: true,
        isDefault: selectedProvider.models.length === 0,
      });
      setNewModelId('');
      setNewModelName('');
      await onChanged();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '添加模型失败');
    } finally {
      setBusy('');
    }
  }

  async function updateModel(model: AiChatModel, input: Parameters<typeof updateAiModel>[1]) {
    if (busy) return;
    if (!selectedProvider && draft) {
      setDraft({ ...draft, models: updateDraftModel(draft.models, model.id, input) });
      return;
    }
    setBusy(`model-${model.id}`);
    setError('');
    try {
      await updateAiModel(model.id, input);
      await onChanged();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '更新模型失败');
    } finally {
      setBusy('');
    }
  }

  async function removeModel(model: AiChatModel) {
    if (busy) return;
    if (!selectedProvider && draft) {
      setDraft({ ...draft, models: normalizeDraftModels(draft.models.filter((item) => item.id !== model.id)) });
      setConfirmDeleteModelId('');
      return;
    }
    setBusy(`model-${model.id}`);
    try {
      await deleteAiModel(model.id);
      setConfirmDeleteModelId('');
      await onChanged();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '删除模型失败');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="ai-provider-settings-panel">
      <div className="ai-manager-layout">
          <aside className="ai-manager-sidebar">
            <div className="ai-manager-sidebar-title">
              <span>供应商</span>
              <button type="button" className="ai-manager-add-provider-button" aria-label="新增配置" title="新增配置" onClick={startNewProvider}>
                <Plus size={14} /><span>新增配置</span>
              </button>
            </div>
            <div className="ai-manager-provider-list">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  className={`ai-manager-provider-row${provider.id === selectedProviderId ? ' active' : ''}`}
                  onClick={() => setSelectedProviderId(provider.id)}
                >
                  <ProviderBrandIcon icon={provider.presetId} name={provider.name} size={34} />
                  <span><strong>{provider.name}</strong><small>{provider.models.filter((model) => model.enabled).length} 个已启用模型</small></span>
                  <span className="ai-manager-provider-status">
                    {provider.isDefault ? <Star size={13} fill="currentColor" aria-label="默认供应商" /> : null}
                    {provider.apiKeySaved ? <KeyRound size={13} aria-label="已保存 API Key" /> : null}
                  </span>
                </button>
              ))}
              {providers.length === 0 ? <div className="provider-menu-empty">尚未配置供应商</div> : null}
            </div>
          </aside>

          <div className="ai-manager-content">
            {draft ? (
              <>
                <section className="ai-manager-section">
                  <div className="ai-manager-section-head">
                    <div><h3>{selectedProvider ? '供应商配置' : '创建供应商'}</h3><p>API Key 只写入本地加密 vault，不进入数据库和聊天导出。</p></div>
                    <div className="ai-manager-section-head-actions">
                      <button
                        type="button"
                        className={`ai-manager-default-provider-button${draft.isDefault ? ' active' : ''}`}
                        disabled={!draft.enabled || draft.isDefault || Boolean(busy)}
                        onClick={() => setDraft({ ...draft, isDefault: true })}
                      >
                        <Star size={14} fill={draft.isDefault ? 'currentColor' : 'none'} />
                        {draft.isDefault ? '默认供应商' : '设为默认'}
                      </button>
                      <button
                        type="button"
                        className={`ai-manager-enable-button${draft.enabled ? ' active' : ''}`}
                        aria-pressed={draft.enabled}
                        onClick={() => setDraft({
                          ...draft,
                          enabled: !draft.enabled,
                          isDefault: draft.enabled ? false : draft.isDefault,
                        })}
                      >
                        {draft.enabled ? <Check size={14} /> : null}{draft.enabled ? '已启用' : '已禁用'}
                      </button>
                      <button type="button" className="ai-manager-save-button" disabled={Boolean(busy)} onClick={() => void saveProvider()}>
                        {busy === 'save' ? <Loader2 size={14} className="spin-icon" /> : null}
                        {selectedProvider ? '保存配置' : '创建供应商'}
                      </button>
                    </div>
                  </div>
                  <div className="ai-manager-form-grid">
                    <label>
                      <span>厂商</span>
                      <ProviderVendorDropdown
                        templates={templates}
                        selectedTemplate={activeTemplate}
                        customSelected={customVendorSelected}
                        onChange={selectVendor}
                      />
                    </label>
                    <label><span>名称</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
                    {activeTemplate ? (
                      <div className="ai-manager-template-config wide">
                        <div className="ai-manager-template-field">
                          <span>渠道</span>
                          <div className="ai-manager-option-list ai-manager-channel-options" role="radiogroup" aria-label="渠道">
                            {activeChannels.map((channel) => (
                              <button
                                key={channel.id}
                                type="button"
                                role="radio"
                                aria-checked={activeTemplate.channelId === channel.id}
                                className={activeTemplate.channelId === channel.id ? 'active' : ''}
                                onClick={() => switchChannel(channel.id)}
                              >
                                {channel.name}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="ai-manager-template-field">
                          <span>接口类型</span>
                          <div className="ai-manager-option-list ai-manager-protocol-options" role="radiogroup" aria-label="接口类型">
                            {activeChannelTemplates.map((template) => (
                              <button
                                key={template.id}
                                type="button"
                                role="radio"
                                aria-checked={activeTemplate.id === template.id}
                                className={activeTemplate.id === template.id ? 'active' : ''}
                                onClick={() => switchTemplate(template)}
                              >
                                {protocolLabel(template.protocol)}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <label className="wide"><span>API 地址</span><input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
                    <label className="wide">
                      <span>API Key</span>
                      <div className="ai-manager-secret-input">
                        <input
                          type={apiKeyVisible ? 'text' : 'password'}
                          value={draft.apiKey}
                          placeholder={selectedProvider?.apiKeySaved ? '已保存；留空保持不变' : '输入 API Key'}
                          autoComplete="off"
                          onChange={(event) => {
                            setRevealedSavedApiKey(false);
                            setDraft({ ...draft, apiKey: event.target.value, apiKeyTouched: true });
                          }}
                        />
                        <button
                          type="button"
                          className="ai-manager-secret-toggle"
                          aria-label={apiKeyVisible ? '隐藏 API Key' : '查看 API Key'}
                          aria-pressed={apiKeyVisible}
                          title={apiKeyVisible ? '隐藏 API Key' : '查看 API Key'}
                          disabled={Boolean(busy) || (!draft.apiKey && !selectedProvider?.apiKeySaved)}
                          onClick={() => void toggleApiKeyVisibility()}
                        >
                          {busy === 'reveal-api-key' ? <Loader2 size={15} className="spin-icon" /> : apiKeyVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </label>
                  </div>
                  <div className={activeTemplate ? 'ai-manager-connection-footer' : undefined}>
                    {activeTemplate ? (
                      <div className="ai-manager-template-links">
                        <button type="button" onClick={() => void openExternalUrl(activeTemplate.apiKeyUrl)}>
                          <KeyRound size={13} />获取 API Key<ExternalLink size={12} />
                        </button>
                        <button type="button" onClick={() => void openExternalUrl(activeTemplate.docsUrl)}>
                          查看接口文档<ExternalLink size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="ai-manager-protocols" role="radiogroup" aria-label="API 协议">
                        {protocolOptions.map((option) => (
                          <button key={option.value} type="button" role="radio" aria-checked={draft.protocol === option.value} className={draft.protocol === option.value ? 'active' : ''} onClick={() => setDraft({ ...draft, protocol: option.value })}>{option.label}</button>
                        ))}
                      </div>
                    )}
                    <div className="ai-manager-actions">
                      <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void testCurrentProvider()}>{busy === 'test' ? <Loader2 size={14} className="spin-icon" /> : <Check size={14} />}测试连接</button>
                    </div>
                  </div>
                  {testMessage ? <div className="ai-manager-success">{testMessage}</div> : null}
                  {error ? <div className="assistant-runtime-error">{error}</div> : null}
                </section>

                <section className="ai-manager-section ai-manager-model-section">
                    <div className="ai-manager-section-head">
                      <div><h3>模型</h3><p>从供应商列表多选添加，也可以手动输入模型 ID。</p></div>
                      <div className="ai-manager-model-head-actions">
                        <span>{draft.models.length} 个</span>
                        <button
                          type="button"
                          className="ai-manager-model-discover-button"
                          aria-label="获取模型"
                          title="获取模型"
                          disabled={Boolean(busy)}
                          onClick={() => void openModelPicker()}
                        >
                          {busy === 'discover-models' ? <Loader2 size={14} className="spin-icon" /> : <RefreshCw size={14} />}
                          <span>获取模型</span>
                        </button>
                      </div>
                    </div>
                    <label className="ai-manager-model-search">
                      <span className="sr-only">搜索模型</span>
                      <input value={modelQuery} placeholder="搜索模型名称或 ID" onChange={(event) => setModelQuery(event.target.value)} />
                    </label>
                    <div className="ai-manager-model-list">
                      {visibleModels.map((model) => (
                        <div key={model.id} className={`ai-manager-model-row${model.enabled ? '' : ' disabled'}`}>
                          <div><strong>{model.displayName}</strong><small>{model.modelId}</small></div>
                          <div className="ai-manager-model-actions">
                            <button type="button" className={model.isDefault ? 'active' : ''} disabled={Boolean(busy)} onClick={() => void updateModel(model, { isDefault: true, enabled: true })}>{model.isDefault ? '默认' : '设为默认'}</button>
                            <button type="button" disabled={Boolean(busy)} onClick={() => void updateModel(model, { enabled: !model.enabled })}>{model.enabled ? '禁用' : '启用'}</button>
                            <button
                              type="button"
                              className="danger"
                              disabled={Boolean(busy)}
                              aria-label={`删除 ${model.displayName}`}
                              onClick={() => {
                                if (confirmDeleteModelId === model.id) {
                                  void removeModel(model);
                                } else {
                                  setConfirmDeleteModelId(model.id);
                                }
                              }}
                            >
                              {confirmDeleteModelId === model.id ? '确认' : <Trash2 size={14} />}
                            </button>
                          </div>
                        </div>
                      ))}
                      {draft.models.length === 0 ? <div className="provider-menu-empty">暂无模型，可获取模型列表后多选添加，或手动输入。</div> : null}
                      {draft.models.length > 0 && visibleModels.length === 0 ? <div className="provider-menu-empty">没有匹配的模型</div> : null}
                    </div>
                    <div className="ai-manager-add-model">
                      <input value={newModelId} placeholder="模型 ID" onChange={(event) => setNewModelId(event.target.value)} />
                      <input value={newModelName} placeholder="显示名称（可选）" onChange={(event) => setNewModelName(event.target.value)} />
                      <button type="button" disabled={!newModelId.trim() || Boolean(busy)} onClick={() => void addModel()}><Plus size={14} />添加</button>
                    </div>
                    {selectedProvider ? (
                      <div className="ai-manager-danger-zone">
                        {confirmDeleteProvider ? (
                          <><span>删除后聊天历史仍保留模型快照，但不能再用此配置发送。</span><button type="button" className="danger" disabled={Boolean(busy)} onClick={() => void removeProvider()}>确认删除</button><button type="button" className="secondary" onClick={() => setConfirmDeleteProvider(false)}>取消</button></>
                        ) : (
                          <button type="button" className="danger" onClick={() => setConfirmDeleteProvider(true)}><Trash2 size={14} />删除供应商</button>
                        )}
                      </div>
                    ) : null}
                  </section>
              </>
            ) : (
              <div className="ai-manager-empty"><ServerCog size={30} /><h3>创建普通聊天供应商</h3><p>点击左侧添加按钮，再在右侧选择厂商或配置自定义接口。</p></div>
            )}
          </div>
      </div>
      {modelPickerOpen && discoveredModels ? (
        <AiModelPickerDialog
          open
          providerName={draft?.name || selectedProvider?.name || '供应商'}
          models={discoveredModels}
          existingModelIds={new Set((draft?.models ?? []).map((model) => model.modelId.toLocaleLowerCase()))}
          onClose={() => {
            setModelPickerOpen(false);
            setDiscoveredModels(null);
          }}
          onConfirm={(models) => void confirmModelSelection(models)}
        />
      ) : null}
    </div>
  );
}

function ProviderVendorDropdown({
  templates,
  selectedTemplate,
  customSelected,
  onChange,
}: {
  templates: AiProviderTemplate[];
  selectedTemplate: AiProviderTemplate | null;
  customSelected: boolean;
  onChange: (template: AiProviderTemplate | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleVendors = useMemo(
    () => filterProviderVendors(templates, query),
    [query, templates],
  );
  const customVisible = !normalizedQuery || '自定义'.includes(normalizedQuery);
  const options = useMemo(() => [
    ...visibleVendors.flatMap((vendor) => {
      const template = vendor.templates[0];
      return template ? [{ id: vendor.id, name: vendor.name, icon: vendor.icon, template }] : [];
    }),
    ...(customVisible ? [{ id: 'custom', name: '自定义', icon: '', template: null }] : []),
  ], [customVisible, visibleVendors]);
  const selectedVendorId = selectedTemplate?.vendorId ?? (customSelected ? 'custom' : '');
  const selectedName = selectedTemplate?.vendorName ?? (customSelected ? '自定义' : '选择厂商');
  const selectedIcon = selectedTemplate?.icon;

  useOutsideDismiss({
    selectors: [
      { selector: '.ai-manager-vendor-menu', onDismiss: () => setOpen(false), anchorRefs: [anchorRef] },
    ],
  });

  useEffect(() => {
    if (!open) return;
    setHighlightedIndex(0);
    requestAnimationFrame(() => searchRef.current?.focus());
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
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      setQuery('');
      anchorRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
      return;
    }
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
          <ProviderBrandIcon icon={selectedIcon} name={selectedName} size={22} />
          <span>{selectedName}</span>
        </span>
        <ChevronDown size={15} className="settings-select-chevron" />
      </button>
      <PopoverPortal open={open} anchorRef={anchorRef} placement="bottom-start" offset={7}>
        <div className="settings-select-menu ai-manager-vendor-menu">
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
          <div id={listboxId} className="ai-manager-vendor-options" role="listbox" aria-label="厂商列表">
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
                <ProviderBrandIcon icon={option.icon} name={option.name} size={24} />
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

export function AiProviderManagerDialog({
  open,
  providers,
  onClose,
  onChanged,
  showToast,
}: AiProviderManagerDialogProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop ai-provider-manager-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog-card ai-provider-manager-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-provider-manager-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ai-manager-head">
          <div>
            <h2 id="ai-provider-manager-title">普通聊天 AI 配置</h2>
            <p>供应商和模型仅用于普通聊天，与 Agent Provider 相互独立。</p>
          </div>
          <button type="button" className="inline-copy-button" aria-label="关闭" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <AiProviderSettingsPanel
          providers={providers}
          onChanged={onChanged}
          showToast={showToast}
        />
      </section>
    </div>
  );
}

function providerToDraft(provider: AiChatProvider): ProviderDraft {
  return {
    presetId: provider.presetId,
    name: provider.name,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    apiKey: '',
    apiKeyTouched: false,
    enabled: provider.enabled,
    isDefault: provider.isDefault,
    models: provider.models.map((model) => ({ ...model, capabilities: { ...model.capabilities } })),
  };
}

function uniqueTemplateChannels(templates: AiProviderTemplate[]) {
  const channels = new Map<string, string>();
  for (const template of templates) {
    if (!channels.has(template.channelId)) {
      channels.set(template.channelId, template.channelName);
    }
  }
  return [...channels].map(([id, name]) => ({ id, name }));
}

function protocolLabel(protocol: AiChatProtocol) {
  return protocolOptions.find((option) => option.value === protocol)?.label ?? protocol;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && /aborted|abort/i.test(error.message);
}

function shouldProbeDraft(provider: AiChatProvider | null, draft: ProviderDraft) {
  if (!provider) return true;
  return draft.apiKeyTouched
    || draft.protocol !== provider.protocol
    || draft.baseUrl.trim().replace(/\/+$/, '') !== provider.baseUrl.replace(/\/+$/, '');
}

function providerProbeInput(draft: ProviderDraft, requireApiKey = true) {
  const apiKey = draft.apiKey.trim();
  if (requireApiKey && !apiKey) {
    throw new Error('请先填写 API Key，再测试连接');
  }
  return {
    protocol: draft.protocol,
    baseUrl: draft.baseUrl.trim(),
    apiKey,
  };
}

function mergeDraftModels(current: AiChatModel[], additions: AiDiscoveredModel[]) {
  const existingIds = new Set(current.map((model) => model.modelId.toLocaleLowerCase()));
  const next = [...current];
  additions.forEach((model) => {
    if (existingIds.has(model.modelId.toLocaleLowerCase())) return;
    existingIds.add(model.modelId.toLocaleLowerCase());
    next.push(createDraftModel(model.modelId, model.displayName));
  });
  return normalizeDraftModels(next);
}

function createDraftModel(modelId: string, displayName: string): AiChatModel {
  return {
    id: `draft:${modelId}`,
    providerId: '',
    modelId,
    displayName,
    enabled: true,
    isDefault: false,
    capabilities: {},
    createdAt: '',
    updatedAt: '',
  };
}

function updateDraftModel(
  models: AiChatModel[],
  modelRowId: string,
  input: Parameters<typeof updateAiModel>[1],
) {
  const next = models.map((model) => {
    if (model.id !== modelRowId) {
      return input.isDefault ? { ...model, isDefault: false } : model;
    }
    return {
      ...model,
      displayName: input.displayName ?? model.displayName,
      enabled: input.isDefault ? true : input.enabled ?? model.enabled,
      isDefault: input.isDefault ?? model.isDefault,
      capabilities: input.capabilities ?? model.capabilities,
    };
  });
  return normalizeDraftModels(next);
}

function normalizeDraftModels(models: AiChatModel[]) {
  const preferred = models.find((model) => model.enabled && model.isDefault)
    ?? models.find((model) => model.enabled);
  return models.map((model) => ({
    ...model,
    isDefault: Boolean(preferred && model.id === preferred.id),
  }));
}
