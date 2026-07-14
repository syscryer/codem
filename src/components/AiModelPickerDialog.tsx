import { Check, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AiDiscoveredModel } from '../types';

type AiModelPickerDialogProps = {
  open: boolean;
  providerName: string;
  models: AiDiscoveredModel[];
  existingModelIds: Set<string>;
  onClose: () => void;
  onConfirm: (models: AiDiscoveredModel[]) => void;
};

export function AiModelPickerDialog({
  open,
  providerName,
  models,
  existingModelIds,
  onClose,
  onConfirm,
}: AiModelPickerDialogProps) {
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const visibleModels = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return models;
    return models.filter((model) =>
      `${model.displayName} ${model.modelId}`.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [models, query]);

  if (!open) return null;

  const selectableVisibleModels = visibleModels.filter(
    (model) => !existingModelIds.has(model.modelId.toLocaleLowerCase()),
  );

  function toggleModel(modelId: string) {
    if (existingModelIds.has(modelId.toLocaleLowerCase())) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  }

  function selectVisibleModels() {
    setSelectedIds((current) => {
      const next = new Set(current);
      selectableVisibleModels.forEach((model) => next.add(model.modelId));
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function confirmSelection() {
    onConfirm(models.filter((model) => selectedIds.has(model.modelId)));
  }

  return (
    <div className="dialog-backdrop ai-model-picker-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="ai-model-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-model-picker-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ai-model-picker-head">
          <div>
            <h2 id="ai-model-picker-title">选择 {providerName} 模型</h2>
            <p>从供应商返回的模型列表中多选添加，已添加模型不会重复写入。</p>
          </div>
          <button type="button" className="inline-copy-button" aria-label="关闭模型选择器" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="ai-model-picker-toolbar">
          <label className="ai-model-picker-search">
            <Search size={15} />
            <span className="sr-only">搜索模型 ID 或名称</span>
            <input
              value={query}
              placeholder="搜索模型 ID 或名称"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="ai-model-picker-selection-actions">
            <button type="button" className="secondary" onClick={selectVisibleModels} disabled={!selectableVisibleModels.length}>
              全选当前
            </button>
            <button type="button" className="secondary" onClick={clearSelection} disabled={!selectedIds.size}>
              清空选择
            </button>
          </div>
        </div>
        <div className="ai-model-picker-summary">
          <span>共 {models.length} 个模型</span>
          <strong>已选择 {selectedIds.size} 个</strong>
        </div>
        <div className="ai-model-picker-list">
          {visibleModels.map((model) => {
            const existing = existingModelIds.has(model.modelId.toLocaleLowerCase());
            const selected = selectedIds.has(model.modelId);
            return (
              <label key={model.modelId} className={`ai-model-picker-row${existing ? ' existing' : ''}${selected ? ' selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected || existing}
                  disabled={existing}
                  onChange={() => toggleModel(model.modelId)}
                />
                <span className="ai-model-picker-check" aria-hidden="true">{selected || existing ? <Check size={14} /> : null}</span>
                <span className="ai-model-picker-model-name">
                  <strong>{model.displayName}</strong>
                  <small>{model.modelId}</small>
                </span>
                {existing ? <em>已添加</em> : null}
              </label>
            );
          })}
          {!visibleModels.length ? <div className="provider-menu-empty">没有匹配的模型</div> : null}
        </div>
        <footer className="ai-model-picker-footer">
          <button type="button" className="secondary" onClick={onClose}>取消</button>
          <button type="button" onClick={confirmSelection} disabled={!selectedIds.size}>
            添加已选择模型
          </button>
        </footer>
      </section>
    </div>
  );
}
