import type { InstalledPlugin } from '../../../types';

type InstalledPluginsPanelProps = {
  items: InstalledPlugin[];
  busy: boolean;
  onUninstall: (plugin: InstalledPlugin) => void;
};

export function InstalledPluginsPanel({ items, busy, onUninstall }: InstalledPluginsPanelProps) {
  return (
    <div className="settings-list settings-list-spaced">
      {items.length === 0 ? <div className="settings-list-empty">暂无已安装插件</div> : null}
      {items.map((item) => (
        <div key={`${item.id}:${item.scope}:${item.projectPath ?? 'global'}`} className="settings-list-row settings-list-row-tall">
          <div>
            <strong>{item.name}</strong>
            <small>{item.marketplace}</small>
            <small>{item.description || '无描述'}</small>
            {item.version ? <small>版本：{item.version}</small> : null}
            {item.projectPath ? <small title={item.projectPath}>项目：{item.projectPath}</small> : null}
          </div>
          <div className="settings-list-actions">
            <span className="settings-badge">{formatScopeLabel(item.scope)}</span>
            <button
              type="button"
              className="settings-action-button danger"
              disabled={busy}
              onClick={() => onUninstall(item)}
            >
              卸载
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatScopeLabel(scope: string) {
  switch (scope) {
    case 'user':
      return '用户级';
    case 'project':
      return '项目级';
    case 'local':
      return '本地';
    default:
      return scope;
  }
}
