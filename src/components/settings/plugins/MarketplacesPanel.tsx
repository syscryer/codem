import type { Marketplace } from '../../../types';

type MarketplacesPanelProps = {
  items: Marketplace[];
  busy: boolean;
  onRefresh: (marketplace: Marketplace) => void;
  onRemove: (marketplace: Marketplace) => void;
};

export function MarketplacesPanel({ items, busy, onRefresh, onRemove }: MarketplacesPanelProps) {
  return (
    <div className="settings-list settings-list-spaced">
      {items.length === 0 ? <div className="settings-list-empty">暂无 marketplace</div> : null}
      {items.map((marketplace) => (
        <div key={marketplace.name} className="settings-list-row settings-list-row-tall">
          <div>
            <strong>{marketplace.name}</strong>
            <small>{marketplace.source ?? '未知来源'}</small>
            <small>{marketplace.plugins.length} 个插件</small>
            {marketplace.lastUpdated ? <small>更新于：{marketplace.lastUpdated}</small> : null}
          </div>
          <div className="settings-list-actions">
            <button
              type="button"
              className="settings-action-button"
              disabled={busy}
              onClick={() => onRefresh(marketplace)}
            >
              刷新
            </button>
            <button
              type="button"
              className="settings-action-button danger"
              disabled={busy}
              onClick={() => onRemove(marketplace)}
            >
              移除
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
