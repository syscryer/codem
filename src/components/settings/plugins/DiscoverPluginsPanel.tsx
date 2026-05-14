import type { Marketplace } from '../../../types';

type DiscoverPluginItem = {
  plugin: Marketplace['plugins'][number];
  marketplace: string;
  installed: boolean;
};

type DiscoverPluginsPanelProps = {
  items: DiscoverPluginItem[];
  busy: boolean;
  onInstall: (item: DiscoverPluginItem) => void;
};

export function DiscoverPluginsPanel({ items, busy, onInstall }: DiscoverPluginsPanelProps) {
  return (
    <div className="settings-list settings-list-spaced">
      {items.length === 0 ? <div className="settings-list-empty">暂无可发现插件</div> : null}
      {items.map((item) => (
        <div key={`${item.marketplace}:${item.plugin.name}`} className="settings-list-row settings-list-row-tall">
          <div>
            <strong>{item.plugin.name}</strong>
            <small>{item.marketplace}</small>
            <small>{item.plugin.description || '无描述'}</small>
            {item.plugin.author ? <small>作者：{item.plugin.author}</small> : null}
          </div>
          <div className="settings-list-actions">
            {item.plugin.category ? <span className="settings-badge">{item.plugin.category}</span> : null}
            <button
              type="button"
              className="settings-action-button primary"
              disabled={busy || item.installed}
              onClick={() => onInstall(item)}
            >
              {item.installed ? '已安装' : '安装'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
