import { Box, CircleDot, Gauge, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_MODEL_VALUE } from '../../constants';
import type { ClaudeModelInfo, ClaudeModelOption, ModelCapability, ModelSettings } from '../../types';
import type { ModelSettingsUpdate } from '../../hooks/useAppSettings';
import { modelLabel } from '../../lib/ui-labels';
import { SettingsRow } from './SettingsControls';

type ModelSettingsSectionProps = {
  models: ModelSettings;
  claudeModels: ClaudeModelInfo;
  onUpdateModels: (update: ModelSettingsUpdate) => void | Promise<void>;
};

export function ModelSettingsSection({
  models,
  claudeModels,
  onUpdateModels,
}: ModelSettingsSectionProps) {
  const [modelId, setModelId] = useState('');
  const [capabilityModelId, setCapabilityModelId] = useState('');
  const [capabilityTokens, setCapabilityTokens] = useState('1000000');
  const [capability1mModel, setCapability1mModel] = useState('');
  const [capabilitySupports1m, setCapabilitySupports1m] = useState(true);
  const defaultModel = claudeModels.models.find((item) => item.id === DEFAULT_MODEL_VALUE);
  const currentCapability = defaultModel
    ? findMatchingCapability(defaultModel, models.modelCapabilities)
    : undefined;
  const currentCapabilitySummary = formatEffectiveCapability(defaultModel, currentCapability);
  const defaultChoices = [
    { id: DEFAULT_MODEL_VALUE, label: defaultModel?.description ? `默认 (${defaultModel.description.replace(/^使用当前 Claude Code 默认模型：/, '')})` : '默认' },
    ...claudeModels.models
      .filter((model) => model.id !== DEFAULT_MODEL_VALUE)
      .flatMap((model) => {
        const baseLabel = model.description ? `${modelLabel(model)} · ${model.description.split('·')[0].trim()}` : modelLabel(model);
        const choices = [{ id: model.id, label: baseLabel }];
        if (model.supportsContext1m && model.context1mModel) {
          choices.push({ id: model.context1mModel, label: `${modelLabel(model)} 1M · 长上下文` });
        }
        return choices;
      }),
    ...models.customModels.map((model) => ({ id: model.id, label: model.label || model.id })),
  ];

  function addModel() {
    const id = modelId.trim();
    if (!id) {
      return;
    }

    void onUpdateModels((current) => ({
      ...current,
      customModels: [...current.customModels, { id }],
    }));
    setModelId('');
  }

  function addCapability() {
    const nextModelId = capabilityModelId.trim();
    if (!nextModelId) {
      return;
    }

    const nextCapability: ModelCapability = {
      modelId: nextModelId,
      supportsContext1m: capabilitySupports1m,
    };
    const normalizedTokens = capabilityTokens.trim();
    const tokens = /^\d+$/.test(normalizedTokens) ? Number.parseInt(normalizedTokens, 10) : Number.NaN;
    const nextContext1mModel = capability1mModel.trim();
    if (Number.isInteger(tokens) && tokens > 0) {
      nextCapability.contextWindowTokens = tokens;
    }
    if (capabilitySupports1m && nextContext1mModel) {
      nextCapability.context1mModel = nextContext1mModel;
    }

    void onUpdateModels((current) => ({
      ...current,
      modelCapabilities: [
        ...current.modelCapabilities.filter((item) => item.modelId !== nextModelId),
        nextCapability,
      ],
    }));
    setCapabilityModelId('');
    setCapability1mModel('');
  }

  function removeModel(id: string) {
    void onUpdateModels((current) => ({
      ...current,
      customModels: current.customModels.filter((model) => model.id !== id),
      defaultModelId: current.defaultModelId === id ? DEFAULT_MODEL_VALUE : current.defaultModelId,
    }));
  }

  function removeCapability(modelId: string) {
    void onUpdateModels((current) => ({
      ...current,
      modelCapabilities: current.modelCapabilities.filter((item) => item.modelId !== modelId),
    }));
  }

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>模型设置</h1>
      </header>

      <div className="settings-panel">
        <SettingsRow icon={Box} title="当前 Claude 默认模型" description="来自 Claude Code 当前配置，供应商仍由外部配置管理">
          <span className="settings-inline-value">{defaultModel?.description?.replace(/^使用当前 Claude Code 默认模型：/, '') || '未配置'}</span>
        </SettingsRow>
        <SettingsRow icon={CircleDot} title="新聊天默认选择" description="仅影响 CodeM Composer 初始模型，不切换供应商">
          <select
            className="settings-select"
            value={models.defaultModelId}
            onChange={(event) => void onUpdateModels({ defaultModelId: event.target.value })}
          >
            {defaultChoices.map((choice) => (
              <option key={choice.id} value={choice.id}>{choice.label}</option>
            ))}
          </select>
        </SettingsRow>
        <div className="settings-row settings-row-stack">
          <div className="settings-row-label">
            <Gauge size={15} />
            <span>
              <strong>模型能力</strong>
              <small>当前默认：{currentCapabilitySummary}</small>
            </span>
          </div>
          <div className="settings-inline-form settings-model-capabilities-form">
            <input
              className="settings-input"
              value={capabilityModelId}
              onChange={(event) => setCapabilityModelId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addCapability();
                }
              }}
              placeholder="模型 ID，例如 GLM-5.2"
            />
            <input
              className="settings-input settings-model-capability-token-input"
              inputMode="numeric"
              value={capabilityTokens}
              onChange={(event) => setCapabilityTokens(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addCapability();
                }
              }}
              placeholder="上下文 tokens"
            />
            <input
              className="settings-input"
              value={capability1mModel}
              onChange={(event) => setCapability1mModel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addCapability();
                }
              }}
              placeholder="1M 别名，可选"
            />
            <label className="settings-model-capability-toggle">
              <span>显示 1M</span>
              <span className="settings-toggle">
                <input
                  type="checkbox"
                  checked={capabilitySupports1m}
                  onChange={(event) => setCapabilitySupports1m(event.target.checked)}
                />
                <span aria-hidden="true" />
              </span>
            </label>
            <button type="button" className="settings-action-button" onClick={addCapability}>
              <Plus size={14} />
              <span>添加</span>
            </button>
          </div>
          <div className="settings-list">
            {models.modelCapabilities.length === 0 ? (
              <div className="settings-list-empty">暂无模型能力配置</div>
            ) : (
              models.modelCapabilities.map((item) => (
                <div key={item.modelId} className="settings-list-row">
                  <div>
                    <strong>{item.modelId}</strong>
                    <small>{formatCapabilityDescription(item)}</small>
                  </div>
                  <button
                    type="button"
                    className="settings-icon-button"
                    title="删除"
                    aria-label={`删除 ${item.modelId}`}
                    onClick={() => removeCapability(item.modelId)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="settings-row settings-row-stack">
          <div className="settings-row-label">
            <Plus size={15} />
            <span>
              <strong>自定义模型</strong>
              <small>添加 Claude Code 可接受的模型 ID</small>
            </span>
          </div>
          <div className="settings-inline-form">
            <input
              className="settings-input"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addModel();
                }
              }}
              placeholder="provider/model-name"
            />
            <button type="button" className="settings-action-button" onClick={addModel}>
              <Plus size={14} />
              <span>添加</span>
            </button>
          </div>
          <div className="settings-list">
            {models.customModels.length === 0 ? (
              <div className="settings-list-empty">暂无自定义模型</div>
            ) : (
              models.customModels.map((item) => (
                <div key={item.id} className="settings-list-row">
                  <div>
                    <strong>{item.label || item.id}</strong>
                    <small>{item.description || item.id}</small>
                  </div>
                  <button
                    type="button"
                    className="settings-icon-button"
                    title="删除"
                    aria-label={`删除 ${item.id}`}
                    onClick={() => removeModel(item.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function findMatchingCapability(
  option: ClaudeModelOption,
  capabilities: ModelSettings['modelCapabilities'],
) {
  return capabilities.find((capability) => capability.modelId === option.id)
    ?? (option.model ? capabilities.find((capability) => capability.modelId === option.model) : undefined);
}

function formatEffectiveCapability(
  option: ClaudeModelOption | undefined,
  capability: ModelCapability | undefined,
) {
  const contextWindowTokens = capability?.contextWindowTokens ?? option?.contextWindowTokens;
  const supportsContext1m = capability?.supportsContext1m ?? option?.supportsContext1m;
  const context1mModel = capability?.context1mModel ?? option?.context1mModel;
  const pieces = [formatTokenWindow(contextWindowTokens)];

  if (supportsContext1m) {
    pieces.push(`1M：${context1mModel || '未配置别名'}`);
  } else {
    pieces.push('未显示 1M');
  }

  return pieces.filter(Boolean).join(' · ') || '默认 200K';
}

function formatCapabilityDescription(capability: ModelCapability) {
  const pieces = [formatTokenWindow(capability.contextWindowTokens)];
  if (capability.supportsContext1m === true) {
    pieces.push(`1M：${capability.context1mModel || '未配置别名'}`);
  } else if (capability.supportsContext1m === false) {
    pieces.push('1M：隐藏');
  }

  return pieces.filter(Boolean).join(' · ') || '未声明额外能力';
}

function formatTokenWindow(tokens: number | undefined) {
  if (typeof tokens !== 'number') {
    return '';
  }
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) {
    return `${tokens / 1_000_000}M tokens`;
  }
  if (tokens >= 1_000 && tokens % 1_000 === 0) {
    return `${tokens / 1_000}K tokens`;
  }

  return `${tokens.toLocaleString('en-US')} tokens`;
}
