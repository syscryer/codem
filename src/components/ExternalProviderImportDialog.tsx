import {
  AlertTriangle,
  Check,
  Download,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  importAgentExternalProviders,
  importChatExternalProviders,
  scanAgentExternalProviders,
  scanChatExternalProviders,
  syncExternalProvider,
} from '../lib/provider-import-api';
import type {
  AgentProviderId,
  ExternalProviderImportItem,
  ExternalProviderScanResponse,
  ExternalProviderTargetKind,
} from '../types';
import { AgentProviderIcon } from './AgentProviderIcon';
import { ProviderBrandIcon } from './ProviderBrandIcon';

type ExternalProviderImportDialogProps = {
  open: boolean;
  targetKind: ExternalProviderTargetKind;
  initialAgentProviderId?: AgentProviderId;
  onClose: () => void;
  onChanged: () => Promise<unknown> | unknown;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

type FilterMode = 'all' | 'available';

const agentTabs: Array<{ id: AgentProviderId; label: string }> = [
  { id: 'claude-code', label: 'Claude' },
  { id: 'openai-codex', label: 'OpenAI' },
  { id: 'opencode', label: 'OpenCode' },
];

const protocolLabels = {
  openai_responses: 'OpenAI Responses',
  openai_chat: 'OpenAI Chat',
  anthropic_messages: 'Anthropic Messages',
  gemini_generate_content: 'Gemini',
} as const;

export function ExternalProviderImportDialog({
  open,
  targetKind,
  initialAgentProviderId = 'claude-code',
  onClose,
  onChanged,
  showToast,
}: ExternalProviderImportDialogProps) {
  const [scan, setScan] = useState<ExternalProviderScanResponse | null>(null);
  const [agentProviderId, setAgentProviderId] = useState<AgentProviderId>(initialAgentProviderId);
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [busySourceId, setBusySourceId] = useState('');
  const [error, setError] = useState('');
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const requestIdRef = useRef(0);

  const scopedItems = useMemo(() => {
    const items = scan?.items ?? [];
    if (targetKind === 'ordinary_chat') return items;
    return items.filter((item) => item.targetScope === agentProviderId);
  }, [agentProviderId, scan?.items, targetKind]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return scopedItems.filter((item) => {
      if (filterMode === 'available' && (item.imported || !item.importable)) return false;
      if (!normalizedQuery) return true;
      return `${item.name} ${item.baseUrl} ${item.models.map((model) => model.modelId).join(' ')}`
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    });
  }, [filterMode, query, scopedItems]);

  const selectedItems = useMemo(() => {
    const items = scan?.items ?? [];
    return items.filter((item) => selectedIds.has(item.sourceId));
  }, [scan?.items, selectedIds]);
  const conflictItems = selectedItems.filter((item) => item.conflictTargetId);

  useEffect(() => {
    if (!open) return;
    setAgentProviderId(initialAgentProviderId);
    setSelectedIds(new Set());
    setQuery('');
    setFilterMode('all');
    setConfirmOverwrite(false);
    void loadScan();
  }, [open, targetKind]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busySourceId) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busySourceId, onClose, open]);

  if (!open) return null;

  async function loadScan() {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const result = targetKind === 'agent'
        ? await scanAgentExternalProviders()
        : await scanChatExternalProviders();
      if (requestId !== requestIdRef.current) return;
      setScan(result);
      setSelectedIds((current) => new Set(
        [...current].filter((sourceId) => result.items.some((item) => item.sourceId === sourceId && item.importable && !item.imported)),
      ));
    } catch (nextError) {
      if (requestId !== requestIdRef.current) return;
      setError(nextError instanceof Error ? nextError.message : '读取外部渠道失败');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  function toggleItem(item: ExternalProviderImportItem) {
    if (!item.importable || item.imported || busySourceId) return;
    setConfirmOverwrite(false);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(item.sourceId)) next.delete(item.sourceId);
      else next.add(item.sourceId);
      return next;
    });
  }

  function selectVisible() {
    setConfirmOverwrite(false);
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const item of visibleItems) {
        if (item.importable && !item.imported) next.add(item.sourceId);
      }
      return next;
    });
  }

  async function importSelected() {
    if (!selectedItems.length || busySourceId) return;
    if (conflictItems.length && !confirmOverwrite) {
      setConfirmOverwrite(true);
      return;
    }
    setBusySourceId('batch-import');
    setError('');
    try {
      const selections = selectedItems.map((item) => ({
        sourceId: item.sourceId,
        ...(item.conflictTargetId ? { overwriteTargetId: item.conflictTargetId } : {}),
      }));
      const result = targetKind === 'agent'
        ? await importAgentExternalProviders(selections)
        : await importChatExternalProviders(selections);
      await onChanged();
      setSelectedIds(new Set());
      setConfirmOverwrite(false);
      showToast(`已导入 ${result.results.length} 个渠道`, 'success');
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '导入外部渠道失败');
    } finally {
      setBusySourceId('');
    }
  }

  async function syncItem(item: ExternalProviderImportItem) {
    if (!item.imported || !item.targetExists || busySourceId) return;
    setBusySourceId(item.sourceId);
    setError('');
    try {
      await syncExternalProvider({
        targetKind,
        source: scan!.source,
        sourceId: item.sourceId,
      });
      await onChanged();
      await loadScan();
      showToast(`${item.name} 已同步`, 'success');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '同步外部渠道失败');
    } finally {
      setBusySourceId('');
    }
  }

  return (
    <div className="dialog-backdrop external-provider-import-backdrop" role="presentation" onMouseDown={() => !busySourceId && onClose()}>
      <section
        className="external-provider-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-provider-import-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="external-provider-import-head">
          <div>
            <h2 id="external-provider-import-title">导入渠道</h2>
            <p>
              {targetKind === 'agent'
                ? '从 CCSwitch 只读导入 Agent 渠道，不修改 CCSwitch 当前配置。'
                : '从 Cherry Studio 只读导入普通聊天供应商，不修改 Cherry Studio 数据。'}
            </p>
          </div>
          <button type="button" className="inline-copy-button" aria-label="关闭导入渠道" disabled={Boolean(busySourceId)} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {targetKind === 'agent' ? (
          <div className="external-provider-import-tabs" role="tablist" aria-label="选择 Agent 类型">
            {agentTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={agentProviderId === tab.id}
                className={agentProviderId === tab.id ? 'active' : ''}
                onClick={() => setAgentProviderId(tab.id)}
              >
                <AgentProviderIcon providerId={tab.id} size={16} />
                {tab.label}
                <span>{scan?.items.filter((item) => item.targetScope === tab.id).length ?? 0}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="external-provider-import-toolbar">
          <label className="external-provider-import-search">
            <Search size={15} />
            <span className="sr-only">搜索外部渠道</span>
            <input value={query} placeholder="搜索渠道、地址或模型" onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="external-provider-import-filters" aria-label="导入状态筛选">
            <button type="button" className={filterMode === 'all' ? 'active' : ''} onClick={() => setFilterMode('all')}>全部</button>
            <button type="button" className={filterMode === 'available' ? 'active' : ''} onClick={() => setFilterMode('available')}>未导入</button>
          </div>
          <button type="button" className="settings-action-button external-provider-import-refresh" disabled={loading || Boolean(busySourceId)} onClick={() => void loadScan()}>
            <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />刷新
          </button>
        </div>

        <div className="external-provider-import-source">
          <span className={scan?.detected ? 'online' : ''} />
          <strong>{scan?.message || (loading ? '正在读取外部配置' : '等待扫描')}</strong>
          {scan?.dataPath ? <small title={scan.dataPath}>{scan.dataPath}</small> : null}
        </div>

        <div className="external-provider-import-list" aria-busy={loading}>
          {loading && !scan ? (
            <div className="external-provider-import-empty"><Loader2 size={24} className="spin-icon" /><span>正在读取渠道配置</span></div>
          ) : visibleItems.map((item) => {
            const selected = selectedIds.has(item.sourceId);
            const disabled = item.imported || !item.importable;
            const itemBusy = busySourceId === item.sourceId;
            return (
              <div key={item.sourceId} className={`external-provider-import-row${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}`}>
                <button type="button" className="external-provider-import-select" disabled={disabled || Boolean(busySourceId)} onClick={() => toggleItem(item)} aria-pressed={selected}>
                  <span className="external-provider-import-check">{selected ? <Check size={14} /> : null}</span>
                  <ProviderBrandIcon icon={item.presetId} name={item.name} size={34} />
                  <span className="external-provider-import-copy">
                    <strong>{item.name}</strong>
                    <small>{protocolLabels[item.protocol]} · {item.models.length ? `${item.models.length} 个模型` : '未设置模型'}</small>
                    <em title={item.baseUrl}>{item.baseUrl || '未配置 API 地址'}</em>
                  </span>
                </button>
                <div className="external-provider-import-state">
                  {item.conflictTargetName && !item.imported ? <span className="conflict">将覆盖：{item.conflictTargetName}</span> : null}
                  {item.warning ? <span className="warning" title={item.warning}>{item.warning}</span> : null}
                  {item.imported ? (
                    item.updateAvailable && item.targetExists ? (
                      <button type="button" disabled={Boolean(busySourceId)} onClick={() => void syncItem(item)}>
                        {itemBusy ? <Loader2 size={13} className="spin-icon" /> : <RefreshCw size={13} />}同步更新
                      </button>
                    ) : <span className="imported">{item.reason || '已导入'}</span>
                  ) : !item.importable ? <span className="unavailable">{item.reason}</span> : null}
                </div>
              </div>
            );
          })}
          {!loading && !visibleItems.length ? (
            <div className="external-provider-import-empty">
              <Download size={24} />
              <span>{query || filterMode === 'available' ? '没有匹配的外部渠道' : '没有发现可显示的渠道'}</span>
            </div>
          ) : null}
        </div>

        {confirmOverwrite ? (
          <div className="external-provider-import-confirm" role="alert">
            <AlertTriangle size={16} />
            <span>已选择的渠道中有 {conflictItems.length} 个与 CodeM 目标同名。再次点击将覆盖配置，但保留目标 ID、默认状态和历史引用。</span>
          </div>
        ) : null}
        {error ? <div className="assistant-runtime-error external-provider-import-error">{error}</div> : null}

        <footer className="external-provider-import-footer">
          <div>
            <strong>已选择 {selectedItems.length} 个</strong>
            <button type="button" onClick={selectVisible} disabled={!visibleItems.some((item) => item.importable && !item.imported) || Boolean(busySourceId)}>选择当前可导入项</button>
            {selectedItems.length ? <button type="button" onClick={() => { setSelectedIds(new Set()); setConfirmOverwrite(false); }} disabled={Boolean(busySourceId)}>清空</button> : null}
          </div>
          <div>
            <button type="button" className="secondary" disabled={Boolean(busySourceId)} onClick={onClose}>取消</button>
            <button type="button" disabled={!selectedItems.length || Boolean(busySourceId)} onClick={() => void importSelected()}>
              {busySourceId === 'batch-import' ? <Loader2 size={14} className="spin-icon" /> : <Download size={14} />}
              {confirmOverwrite ? '确认覆盖并导入' : `导入 ${selectedItems.length || ''}`}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
