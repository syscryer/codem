import {
  CloudDownload,
  CloudUpload,
  Database,
  Eye,
  EyeOff,
  FolderTree,
  Globe2,
  KeyRound,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  User,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  ToastState,
  WebDavRemoteInfo,
  WebDavSettingsInput,
  WebDavSyncResult,
  WebDavSyncSettings,
  WebDavTestResult,
} from '../../types';
import { SettingsGroup, SettingsRow } from './SettingsControls';

type Props = {
  showToast: (message: string, tone?: ToastState['tone']) => void;
  onRefreshAgentChannels: () => Promise<unknown> | unknown;
};

type BusyAction = 'load' | 'save' | 'test' | 'remote' | 'upload' | 'download';
type ConfirmAction = 'upload' | 'download';

type DraftState = {
  enabled: boolean;
  baseUrl: string;
  username: string;
  password: string;
  passwordTouched: boolean;
  remoteRoot: string;
  profile: string;
};

const emptyDraft: DraftState = {
  enabled: false,
  baseUrl: '',
  username: '',
  password: '',
  passwordTouched: false,
  remoteRoot: 'codem-sync',
  profile: 'default',
};

function formatSize(bytes: number | null): string {
  if (bytes === null) {
    return '—';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTime(value: string | null): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null);
  if (payload && typeof payload.error === 'string' && payload.error) {
    return payload.error;
  }
  return fallback;
}

export function WebDavSyncSettingsSection({ showToast, onRefreshAgentChannels }: Props) {
  const [settings, setSettings] = useState<WebDavSyncSettings | null>(null);
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [remoteInfo, setRemoteInfo] = useState<WebDavRemoteInfo | null>(null);
  const [masterPassword, setMasterPassword] = useState('');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    if (!confirmAction) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      setConfirmAction(null);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [confirmAction]);

  async function loadSettings() {
    setBusy('load');
    try {
      const response = await fetch('/api/sync/webdav/settings');
      if (!response.ok) {
        throw new Error(await readError(response, '读取 WebDAV 同步设置失败'));
      }
      const payload = (await response.json()) as WebDavSyncSettings;
      setSettings(payload);
      setDraft({
        enabled: payload.enabled,
        baseUrl: payload.baseUrl,
        username: payload.username,
        password: '',
        passwordTouched: false,
        remoteRoot: payload.remoteRoot || 'codem-sync',
        profile: payload.profile || 'default',
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : '读取 WebDAV 同步设置失败', 'error');
    } finally {
      setBusy(null);
    }
  }

  function update<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function buildInput(): WebDavSettingsInput {
    return {
      enabled: draft.enabled,
      baseUrl: draft.baseUrl,
      username: draft.username,
      password: draft.passwordTouched ? draft.password : null,
      passwordTouched: draft.passwordTouched,
      remoteRoot: draft.remoteRoot,
      profile: draft.profile,
    };
  }

  async function saveSettings() {
    setBusy('save');
    try {
      const response = await fetch('/api/sync/webdav/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildInput()),
      });
      if (!response.ok) {
        throw new Error(await readError(response, '保存 WebDAV 同步设置失败'));
      }
      const payload = (await response.json()) as WebDavSyncSettings;
      setSettings(payload);
      setDraft((current) => ({ ...current, password: '', passwordTouched: false }));
      setRemoteInfo(null);
      showToast('WebDAV 同步设置已保存');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存 WebDAV 同步设置失败', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    setBusy('test');
    try {
      const response = await fetch('/api/sync/webdav/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildInput()),
      });
      const payload = (await response.json().catch(() => null)) as (WebDavTestResult & { error?: string }) | null;
      if (!response.ok) {
        throw new Error(payload?.error || 'WebDAV 连接测试失败');
      }
      if (!payload) {
        throw new Error('WebDAV 连接测试失败');
      }
      if (payload.ok) {
        showToast(`WebDAV 连接成功（${payload.latencyMs} ms）`);
      } else {
        showToast(payload.message, 'error');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'WebDAV 连接测试失败', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function fetchRemoteInfo() {
    setBusy('remote');
    try {
      const response = await fetch('/api/sync/webdav/remote-info');
      if (!response.ok) {
        throw new Error(await readError(response, '读取远端快照失败'));
      }
      setRemoteInfo((await response.json()) as WebDavRemoteInfo);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '读取远端快照失败', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function runSync(action: ConfirmAction) {
    setConfirmAction(null);
    setBusy(action);
    try {
      const response = await fetch(`/api/sync/webdav/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncPassword: masterPassword }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, action === 'upload' ? '上传渠道快照失败' : '下载渠道快照失败'));
      }
      const payload = (await response.json()) as WebDavSyncResult;
      setMasterPassword('');
      await loadSettings();
      setRemoteInfo(null);
      if (action === 'download') {
        await onRefreshAgentChannels();
      }
      const summary = `${payload.channelCount} 个渠道、${payload.modelCount} 个模型、${payload.secretCount} 个密钥`;
      showToast(
        action === 'upload'
          ? `已上传渠道快照（${summary}）`
          : `已下载并导入渠道快照（${summary}），已自动备份原数据`,
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : '同步失败', 'error');
      await loadSettings();
    } finally {
      setBusy(null);
    }
  }

  const passwordBadge = !draft.passwordTouched
    ? settings?.passwordSaved
      ? '已保存密码'
      : '未保存密码'
    : draft.password
      ? '将更新密码'
      : '将清空密码';

  const syncing = busy === 'upload' || busy === 'download';

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>同步</h1>
        <p>
          通过你自己的 WebDAV 服务（如坚果云、Nextcloud）手动上传/下载 Agent
          渠道与渠道 API Key。只在你点击上传或下载时才会访问远端，CodeM 不会自动同步。
        </p>
      </header>

      <SettingsGroup title="WebDAV 服务">
        <SettingsRow
          icon={ShieldCheck}
          title="启用同步"
          description="关闭后上传和下载不可用，已保存的服务配置会保留"
        >
          <label className="settings-toggle" aria-label="启用 WebDAV 同步">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => update('enabled', event.currentTarget.checked)}
            />
            <span aria-hidden="true" />
          </label>
        </SettingsRow>
        <SettingsRow icon={Globe2} title="服务地址" description="例如 https://dav.jianguoyun.com/dav/">
          <input
            className="settings-text-input"
            value={draft.baseUrl}
            placeholder="https://dav.example.com/dav/"
            onChange={(event) => update('baseUrl', event.target.value)}
          />
        </SettingsRow>
        <SettingsRow icon={User} title="用户名" description="WebDAV 账号">
          <input
            className="settings-text-input"
            value={draft.username}
            placeholder="user@example.com"
            onChange={(event) => update('username', event.target.value)}
          />
        </SettingsRow>
        <SettingsRow icon={KeyRound} title="密码" description={`WebDAV 服务密码（${passwordBadge}）`}>
          <div className="webdav-password-field">
            <input
              className="settings-text-input"
              type={showPassword ? 'text' : 'password'}
              value={draft.password}
              placeholder={settings?.passwordSaved ? '留空保持已保存密码' : '应用密码或登录密码'}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  password: event.target.value,
                  passwordTouched: true,
                }))
              }
            />
            <button
              type="button"
              className="webdav-password-toggle"
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              onClick={() => setShowPassword((current) => !current)}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </SettingsRow>
        <SettingsRow icon={FolderTree} title="远端目录" description="同步快照存放的根目录，默认 codem-sync">
          <input
            className="settings-text-input"
            value={draft.remoteRoot}
            placeholder="codem-sync"
            onChange={(event) => update('remoteRoot', event.target.value)}
          />
        </SettingsRow>
        <SettingsRow icon={Server} title="Profile" description="同一服务下隔离不同设备的配置档案，默认 default">
          <input
            className="settings-text-input"
            value={draft.profile}
            placeholder="default"
            onChange={(event) => update('profile', event.target.value)}
          />
        </SettingsRow>
      </SettingsGroup>

      <div className="settings-actions">
        <button
          type="button"
          className="settings-action-button"
          disabled={busy !== null}
          onClick={() => void testConnection()}
        >
          <RefreshCw size={14} className={busy === 'test' ? 'spin' : ''} />
          测试连接
        </button>
        <button
          type="button"
          className="settings-action-button primary"
          disabled={busy !== null}
          onClick={() => void saveSettings()}
        >
          <Save size={14} />
          保存设置
        </button>
      </div>

      <SettingsGroup title="远端快照">
        <SettingsRow
          icon={Database}
          title="远端状态"
          description={
            remoteInfo
              ? remoteInfo.exists
                ? remoteInfo.compatible
                  ? `${remoteInfo.deviceName ?? '未知设备'} · ${formatTime(remoteInfo.createdAt)} · ${remoteInfo.channelCount ?? 0} 个渠道${remoteInfo.hasSecrets ? ' · 含加密密钥' : ''} · ${formatSize(remoteInfo.dataSize)}`
                  : (remoteInfo.reason ?? '远端快照不兼容')
                : '远端目录为空，还没有上传过快照'
              : '读取远端 manifest.json 查看快照来源与兼容性'
          }
        >
          <button
            type="button"
            className="settings-action-button"
            disabled={busy !== null}
            onClick={() => void fetchRemoteInfo()}
          >
            <RefreshCw size={14} className={busy === 'remote' ? 'spin' : ''} />
            读取远端
          </button>
        </SettingsRow>
        <SettingsRow
          icon={RefreshCw}
          title="最近同步"
          description={
            settings?.lastError
              ? `上次失败：${settings.lastError}`
              : settings?.lastSyncAt
                ? `${formatTime(settings.lastSyncAt)}${settings.lastRemoteDevice ? ` · 来自 ${settings.lastRemoteDevice} 上传` : ''}`
                : '尚未同步过'
          }
        />
      </SettingsGroup>

      <SettingsGroup title="手动同步">
        <SettingsRow
          icon={KeyRound}
          stack
          description="加密渠道 API Key 用，两台设备输入同一个主密码"
          title="同步主密码"
        >
          <input
            className="settings-text-input"
            type="password"
            value={masterPassword}
            placeholder="至少 8 个字符"
            autoComplete="new-password"
            onChange={(event) => setMasterPassword(event.target.value)}
          />
        </SettingsRow>
      </SettingsGroup>

      <div className="settings-actions">
        <button
          type="button"
          className="settings-action-button"
          disabled={busy !== null}
          onClick={() => setConfirmAction('upload')}
        >
          <CloudUpload size={14} className={busy === 'upload' ? 'spin' : ''} />
          上传本机渠道
        </button>
        <button
          type="button"
          className="settings-action-button danger"
          disabled={busy !== null}
          onClick={() => setConfirmAction('download')}
        >
          <CloudDownload size={14} className={busy === 'download' ? 'spin' : ''} />
          下载远端渠道
        </button>
      </div>
      <p className="webdav-sync-hint" role="status">
        {syncing
          ? busy === 'upload'
            ? '正在上传渠道快照…'
            : '正在下载并导入渠道快照…'
          : '同步主密码只在本机与本次操作内存中使用，不会保存。上传会覆盖远端快照；下载会用远端快照整体替换本机渠道与密钥，导入前会自动备份当前数据。'}
      </p>

      {confirmAction ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onClick={() => {
            if (!syncing) {
              setConfirmAction(null);
            }
          }}
        >
          <div
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="webdav-sync-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-head">
              <h3 id="webdav-sync-confirm-title">
                {confirmAction === 'upload' ? '上传本机渠道到远端？' : '下载远端渠道到本机？'}
              </h3>
              <p>
                {confirmAction === 'upload'
                  ? '将把本机全部 Agent 渠道（含模型目录和已保存的 API Key）上传并覆盖远端快照；上传过程中远端只会看到完整的新快照。'
                  : '将用远端快照整体替换本机全部 Agent 渠道、模型目录和渠道密钥；本机当前渠道会先自动备份到 backups/channel-sync/latest，随后被覆盖。'}
              </p>
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="dialog-button secondary"
                onClick={() => setConfirmAction(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={`dialog-button${confirmAction === 'download' ? ' danger' : ''}`}
                onClick={() => void runSync(confirmAction)}
              >
                {confirmAction === 'upload' ? '确认上传' : '确认下载'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
