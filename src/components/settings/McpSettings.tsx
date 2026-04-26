import { RotateCcw, Server } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { McpServersResponse } from '../../types';

export function McpSettingsSection() {
  const [payload, setPayload] = useState<McpServersResponse>({ servers: [], errors: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadServers();
  }, []);

  async function loadServers() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/mcp/servers');
      if (!response.ok) {
        throw new Error('读取 MCP 失败');
      }
      setPayload((await response.json()) as McpServersResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取 MCP 失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>MCP 管理</h1>
      </header>

      <div className="settings-panel settings-editor-panel">
        <div className="settings-editor-head">
          <div className="settings-row-label">
            <Server size={15} />
            <span>
              <strong>只读 MCP 概览</strong>
              <small>读取本机配置，不修改 MCP 文件</small>
            </span>
          </div>
          <button type="button" className="settings-action-button" onClick={() => void loadServers()}>
            <RotateCcw size={14} />
            <span>刷新</span>
          </button>
        </div>

        <div className="settings-list settings-list-spaced">
          {loading ? <div className="settings-list-empty">正在读取 MCP 配置</div> : null}
          {!loading && error ? <div className="settings-list-empty">{error}</div> : null}
          {!loading && !error && payload.servers.length === 0 ? (
            <div className="settings-list-empty">未发现可展示的 MCP 服务器</div>
          ) : null}
          {payload.servers.map((server) => (
            <div key={server.id} className="settings-list-row settings-list-row-tall">
              <div>
                <strong>{server.name}</strong>
                <small title={server.source}>{server.source}</small>
                {server.command ? (
                  <small>{[server.command, ...(server.args ?? [])].join(' ')}</small>
                ) : null}
              </div>
              <span className={`settings-badge ${server.status}`}>{server.status}</span>
            </div>
          ))}
          {payload.errors.map((item) => (
            <div key={`${item.source}:${item.path}`} className="settings-list-row settings-list-row-tall">
              <div>
                <strong>{item.source}</strong>
                <small title={item.path}>{item.path}</small>
                <small>{item.message}</small>
              </div>
              <span className="settings-badge error">error</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
