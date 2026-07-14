import {
  Check,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ServerCog,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  createAiModel,
  createAiProvider,
  deleteAiModel,
  deleteAiProvider,
  loadAiProviderTemplates,
  refreshAiProviderModels,
  testAiProvider,
  updateAiModel,
  updateAiProvider,
} from '../lib/ordinary-chat-api';
import type {
  AiChatModel,
  AiChatProtocol,
  AiChatProvider,
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
};

type AiProviderManagerDialogProps = {
  open: boolean;
  providers: AiChatProvider[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

const protocolOptions: Array<{ value: AiChatProtocol; label: string }> = [
  { value: 'openai_responses', label: 'OpenAI Responses' },
  { value: 'openai_chat', label: 'OpenAI Chat' },
  { value: 'anthropic_messages', label: 'Anthropic' },
  { value: 'gemini_generate_content', label: 'Gemini' },
];

export function AiProviderManagerDialog({
  open,
  providers,
  onClose,
  onChanged,
  showToast,
}: AiProviderManagerDialogProps) {
  const [templates, setTemplates] = useState<AiProviderTemplate[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [newModelId, setNewModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [modelQuery, setModelQuery] = useState('');
  const [confirmDeleteProvider, setConfirmDeleteProvider] = useState(false);
  const [confirmDeleteModelId, setConfirmDeleteModelId] = useState('');

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  );
  const visibleModels = useMemo(() => {
    const query = modelQuery.trim().toLocaleLowerCase();
    if (!selectedProvider || !query) return selectedProvider?.models ?? [];
    return selectedProvider.models.filter((model) =>
      `${model.displayName} ${model.modelId}`.toLocaleLowerCase().includes(query),
    );
  }, [modelQuery, selectedProvider]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void loadAiProviderTemplates(controller.signal)
      .then(setTemplates)
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : '供应商模板加载失败'));
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSelectedProviderId((current) => {
      if (providers.some((provider) => provider.id === current)) return current;
      return providers[0]?.id ?? '';
    });
  }, [open, providers]);

  useEffect(() => {
    if (!open) return;
    if (selectedProvider) {
      setDraft(providerToDraft(selectedProvider));
    } else if (!selectedProviderId) {
      setDraft(null);
    }
    setError('');
    setTestMessage('');
    setConfirmDeleteProvider(false);
    setConfirmDeleteModelId('');
    setNewModelId('');
    setNewModelName('');
    setModelQuery('');
  }, [open, selectedProvider, selectedProviderId]);

  if (!open) return null;

  function startTemplate(template: AiProviderTemplate) {
    setSelectedProviderId('');
    setDraft({
      presetId: template.id,
      name: template.name,
      protocol: template.protocol,
      baseUrl: template.baseUrl,
      apiKey: '',
      apiKeyTouched: false,
      enabled: true,
    });
    setError('');
    setTestMessage('');
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
      const provider = selectedProvider
        ? await updateAiProvider(selectedProvider.id, {
            presetId: draft.presetId,
            name: draft.name.trim(),
            protocol: draft.protocol,
            baseUrl: draft.baseUrl.trim(),
            enabled: draft.enabled,
            apiKey: draft.apiKey,
            apiKeyTouched: draft.apiKeyTouched,
          })
        : await createAiProvider({
            presetId: draft.presetId,
            name: draft.name.trim(),
            protocol: draft.protocol,
            baseUrl: draft.baseUrl.trim(),
            enabled: draft.enabled,
            apiKey: draft.apiKey.trim() || undefined,
          });
      setSelectedProviderId(provider.id);
      await onChanged();
      showToast(selectedProvider ? 'AI 供应商已更新' : 'AI 供应商已创建', 'success');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '保存 AI 供应商失败');
    } finally {
      setBusy('');
    }
  }

  async function runProviderAction(action: 'test' | 'refresh') {
    if (!selectedProvider || busy) return;
    setBusy(action);
    setError('');
    setTestMessage('');
    try {
      if (action === 'test') {
        const result = await testAiProvider(selectedProvider.id);
        setTestMessage(result.message);
      } else {
        await refreshAiProviderModels(selectedProvider.id);
        setTestMessage('模型列表已刷新');
      }
      await onChanged();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '供应商操作失败');
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
    if (!selectedProvider || !newModelId.trim() || busy) return;
    setBusy('add-model');
    setError('');
    try {
      await createAiModel(selectedProvider.id, {
        modelId: newModelId.trim(),
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

        <div className="ai-manager-layout">
          <aside className="ai-manager-sidebar">
            <div className="ai-manager-sidebar-title">
              <span>供应商</span>
              <button type="button" className="inline-copy-button" title="自定义供应商" onClick={startCustomProvider}>
                <Plus size={15} />
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
                  <ServerCog size={15} />
                  <span><strong>{provider.name}</strong><small>{provider.models.filter((model) => model.enabled).length} 个已启用模型</small></span>
                  {provider.apiKeySaved ? <KeyRound size={13} /> : null}
                </button>
              ))}
              {providers.length === 0 ? <div className="provider-menu-empty">尚未配置供应商</div> : null}
            </div>
            <div className="ai-manager-template-title">快速创建</div>
            <div className="ai-manager-template-list">
              {templates.map((template) => (
                <button key={template.id} type="button" onClick={() => startTemplate(template)}>
                  <span>{template.name}</span><Plus size={13} />
                </button>
              ))}
              <button type="button" onClick={startCustomProvider}><span>自定义</span><Plus size={13} /></button>
            </div>
          </aside>

          <div className="ai-manager-content">
            {draft ? (
              <>
                <section className="ai-manager-section">
                  <div className="ai-manager-section-head">
                    <div><h3>{selectedProvider ? '供应商配置' : '创建供应商'}</h3><p>API Key 只写入本地加密 vault，不进入数据库和聊天导出。</p></div>
                    <button
                      type="button"
                      className={`ai-manager-enable-button${draft.enabled ? ' active' : ''}`}
                      aria-pressed={draft.enabled}
                      onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
                    >
                      {draft.enabled ? <Check size={14} /> : null}{draft.enabled ? '已启用' : '已禁用'}
                    </button>
                  </div>
                  <div className="ai-manager-form-grid">
                    <label><span>名称</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
                    <label className="wide"><span>API 地址</span><input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
                    <label className="wide"><span>API Key</span><input type="password" value={draft.apiKey} placeholder={selectedProvider?.apiKeySaved ? '已保存；留空保持不变' : '输入 API Key'} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value, apiKeyTouched: true })} /></label>
                  </div>
                  <div className="ai-manager-protocols" role="radiogroup" aria-label="API 协议">
                    {protocolOptions.map((option) => (
                      <button key={option.value} type="button" role="radio" aria-checked={draft.protocol === option.value} className={draft.protocol === option.value ? 'active' : ''} onClick={() => setDraft({ ...draft, protocol: option.value })}>{option.label}</button>
                    ))}
                  </div>
                  <div className="ai-manager-actions">
                    {selectedProvider ? (
                      <>
                        <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void runProviderAction('test')}>{busy === 'test' ? <Loader2 size={14} className="spin-icon" /> : <Check size={14} />}测试连接</button>
                        <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void runProviderAction('refresh')}>{busy === 'refresh' ? <Loader2 size={14} className="spin-icon" /> : <RefreshCw size={14} />}获取模型</button>
                      </>
                    ) : null}
                    <button type="button" disabled={Boolean(busy)} onClick={() => void saveProvider()}>{busy === 'save' ? <Loader2 size={14} className="spin-icon" /> : null}{selectedProvider ? '保存配置' : '创建供应商'}</button>
                  </div>
                  {testMessage ? <div className="ai-manager-success">{testMessage}</div> : null}
                  {error ? <div className="assistant-runtime-error">{error}</div> : null}
                </section>

                {selectedProvider ? (
                  <section className="ai-manager-section ai-manager-model-section">
                    <div className="ai-manager-section-head"><div><h3>模型</h3><p>可启用多个模型，但每次聊天只选择一个回答。</p></div><span>{selectedProvider.models.length} 个</span></div>
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
                      {selectedProvider.models.length === 0 ? <div className="provider-menu-empty">暂无模型，可获取模型或手动添加。</div> : null}
                      {selectedProvider.models.length > 0 && visibleModels.length === 0 ? <div className="provider-menu-empty">没有匹配的模型</div> : null}
                    </div>
                    <div className="ai-manager-add-model">
                      <input value={newModelId} placeholder="模型 ID" onChange={(event) => setNewModelId(event.target.value)} />
                      <input value={newModelName} placeholder="显示名称（可选）" onChange={(event) => setNewModelName(event.target.value)} />
                      <button type="button" disabled={!newModelId.trim() || Boolean(busy)} onClick={() => void addModel()}><Plus size={14} />添加</button>
                    </div>
                    <div className="ai-manager-danger-zone">
                      {confirmDeleteProvider ? (
                        <><span>删除后聊天历史仍保留模型快照，但不能再用此配置发送。</span><button type="button" className="danger" disabled={Boolean(busy)} onClick={() => void removeProvider()}>确认删除</button><button type="button" className="secondary" onClick={() => setConfirmDeleteProvider(false)}>取消</button></>
                      ) : (
                        <button type="button" className="danger" onClick={() => setConfirmDeleteProvider(true)}><Trash2 size={14} />删除供应商</button>
                      )}
                    </div>
                  </section>
                ) : null}
              </>
            ) : (
              <div className="ai-manager-empty"><ServerCog size={30} /><h3>创建普通聊天供应商</h3><p>从左侧选择常见厂商模板，或创建 OpenAI 兼容的自定义配置。</p></div>
            )}
          </div>
        </div>
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
  };
}
