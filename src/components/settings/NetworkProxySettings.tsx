import { Globe2, KeyRound, Network, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AgentNetworkProxyProtocol, AgentNetworkProxySettings, ToastState } from '../../types';
import type { AgentNetworkProxySettingsUpdate } from '../../hooks/useAppSettings';
import { SegmentedControl, SettingsGroup, SettingsRow } from './SettingsControls';

type Props = {
  settings: AgentNetworkProxySettings;
  onUpdate: (update: AgentNetworkProxySettingsUpdate) => void | Promise<void>;
  showToast: (message: string, tone?: ToastState['tone']) => void;
};

export function NetworkProxySettingsSection({ settings, onUpdate, showToast }: Props) {
  const [draft, setDraft] = useState(settings);
  const [testing, setTesting] = useState(false);

  useEffect(() => setDraft(settings), [settings]);

  function update<K extends keyof AgentNetworkProxySettings>(key: K, value: AgentNetworkProxySettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    await onUpdate(draft);
    showToast('网络代理设置已保存');
  }

  async function testConnection() {
    await save();
    setTesting(true);
    try {
      const response = await fetch('/api/agents/network-proxy/test', { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success !== true) throw new Error(payload.error || '代理连接失败');
      showToast(`代理连接成功（${payload.latencyMs ?? 0} ms）`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '代理连接失败', 'error');
    } finally {
      setTesting(false);
    }
  }

  const configured = draft.enabled && draft.host.trim() && draft.port > 0;
  const preview = configured
    ? `${draft.protocol}://${draft.username ? `${draft.username}@` : ''}${draft.host}:${draft.port}`
    : '未启用 CodeM 代理，将按系统代理处理';

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>网络代理</h1>
        <p>国内网络可能无法直接访问部分 Agent 官方下载源；仅用于 Agent 安装、更新、版本检查和诊断，不会改变普通聊天请求或系统代理。</p>
      </header>
      <SettingsGroup title="CodeM 代理">
        <SettingsRow icon={ShieldCheck} title="启用代理" description="直连失败后优先使用此代理">
          <label className="settings-toggle" aria-label="启用 CodeM 代理">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => update('enabled', event.currentTarget.checked)}
            />
            <span aria-hidden="true" />
          </label>
        </SettingsRow>
        <SettingsRow icon={Network} title="协议" description="支持 HTTP、HTTPS 和 SOCKS5">
          <SegmentedControl<AgentNetworkProxyProtocol> value={draft.protocol} options={[{ value: 'http', label: 'HTTP' }, { value: 'https', label: 'HTTPS' }, { value: 'socks5', label: 'SOCKS5' }]} onChange={(value) => update('protocol', value)} />
        </SettingsRow>
        <SettingsRow icon={Globe2} title="服务器" description="代理主机地址"><input className="settings-text-input" value={draft.host} placeholder="127.0.0.1" onChange={(event) => update('host', event.target.value)} /></SettingsRow>
        <SettingsRow icon={Globe2} title="端口" description="常见端口：7890、1080"><input className="settings-number-input" type="number" min={1} max={65535} value={draft.port} onChange={(event) => update('port', Number(event.target.value))} /></SettingsRow>
        <SettingsRow icon={KeyRound} title="认证（可选）" description="仅在代理服务要求认证时填写" stack><div className="settings-proxy-credentials"><input className="settings-text-input" value={draft.username} placeholder="用户名" onChange={(event) => update('username', event.target.value)} /><input className="settings-text-input" type="password" value={draft.password} placeholder="密码" onChange={(event) => update('password', event.target.value)} /></div></SettingsRow>
        <SettingsRow icon={Globe2} title="NO_PROXY" description="不经过代理的地址，使用逗号分隔" stack><input className="settings-text-input" value={draft.noProxy} placeholder="localhost,127.0.0.1" onChange={(event) => update('noProxy', event.target.value)} /></SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="连接策略">
        <SettingsRow icon={Network} title="当前配置" description={preview} />
        <SettingsRow icon={RefreshCw} title="网络路径" description="直连优先，失败后依次使用 CodeM 代理、系统代理和 npm 国内镜像" />
      </SettingsGroup>
      <div className="settings-actions">
        <button type="button" className="settings-action-button" onClick={() => setDraft(settings)}>清除未保存修改</button>
        <button type="button" className="settings-action-button primary" onClick={() => void save()}><Save size={14} />保存设置</button>
        <button type="button" className="settings-action-button" disabled={testing} onClick={() => void testConnection()}><RefreshCw size={14} className={testing ? 'spin' : ''} />测试连接</button>
      </div>
    </section>
  );
}
