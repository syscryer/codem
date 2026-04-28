import { Box, CircleDot, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_MODEL_VALUE } from '../../constants';
import type { ClaudeModelInfo, ModelSettings } from '../../types';
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
  const defaultModel = claudeModels.models.find((item) => item.id === DEFAULT_MODEL_VALUE);
  const defaultChoices = [
    { id: DEFAULT_MODEL_VALUE, label: defaultModel?.description ? `默认 (${defaultModel.description.replace(/^使用当前 Claude Code 默认模型：/, '')})` : '默认' },
    ...claudeModels.models
      .filter((model) => model.id !== DEFAULT_MODEL_VALUE)
      .map((model) => ({ id: model.id, label: model.description ? `${modelLabel(model)} · ${model.description.split('·')[0].trim()}` : modelLabel(model) })),
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

  function removeModel(id: string) {
    void onUpdateModels((current) => ({
      ...current,
      customModels: current.customModels.filter((model) => model.id !== id),
      defaultModelId: current.defaultModelId === id ? DEFAULT_MODEL_VALUE : current.defaultModelId,
    }));
  }

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>模型设置</h1>
      </header>

      <div className="settings-panel">
        <SettingsRow icon={Box} title="当前 Claude 默认模型" description="来自 Claude Code 当前配置，供应商仍由 cc-switch 管理">
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
