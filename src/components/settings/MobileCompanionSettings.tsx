import {
  CheckCircle2,
  Copy,
  KeyRound,
  Link2,
  LoaderCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SettingsGroup, SettingsRow } from './SettingsControls';

type Device = {
  id: string;
  name: string;
  permissions: string[];
  lastSeenAt: number;
  revoked: boolean;
};

type AccessAddress = {
  address: string;
  kind: 'lan' | 'tailscale';
};

type Status = {
  enabled: boolean;
  port: number;
  address?: string;
  addresses?: AccessAddress[];
  tailnetAvailable: boolean;
  passwordConfigured: boolean;
  username: string;
  firewall?: 'configured' | 'manual' | 'not-required';
  devices: Device[];
};

type PasswordFeedback = { kind: 'success' | 'error'; message: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/mobile-companion${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.text();
    try {
      const parsed = JSON.parse(body) as { error?: string; message?: string };
      throw new Error(parsed.error || parsed.message || '请求失败');
    } catch (reason) {
      if (reason instanceof SyntaxError) throw new Error(body || '请求失败');
      throw reason;
    }
  }
  return response.json() as Promise<T>;
}

export function MobileCompanionSettings() {
  const [status, setStatus] = useState<Status>();
  const [passwordValue, setPasswordValue] = useState('');
  const [busyAction, setBusyAction] = useState<'toggle' | 'password'>();
  const [statusError, setStatusError] = useState<string>();
  const [passwordFeedback, setPasswordFeedback] = useState<PasswordFeedback>();
  const [copiedAddress, setCopiedAddress] = useState<string>();
  const refreshRequestRef = useRef(0);

  const accessAddresses = useMemo(() => {
    if (status?.addresses?.length) return status.addresses;
    if (!status?.address) return [];
    return [{ address: status.address, kind: status.tailnetAvailable ? 'tailscale' : 'lan' } satisfies AccessAddress];
  }, [status]);

  const refresh = async () => {
    const requestId = ++refreshRequestRef.current;
    let lastReason: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const nextStatus = await api<Status>('/status');
        if (requestId !== refreshRequestRef.current) return;
        setStatus(nextStatus);
        setStatusError(undefined);
        return;
      } catch (reason) {
        lastReason = reason;
        if (!(reason instanceof TypeError) || attempt === 2) break;
        await new Promise(resolve => window.setTimeout(resolve, 180 * (attempt + 1)));
      }
    }
    if (requestId === refreshRequestRef.current) {
      setStatusError(lastReason instanceof Error ? lastReason.message : '读取失败');
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const toggle = async () => {
    if (!status) return;
    setBusyAction('toggle');
    setStatusError(undefined);
    try {
      setStatus(await api<Status>('/enable', {
        method: 'POST',
        body: JSON.stringify({ enabled: !status.enabled, port: status.port }),
      }));
    } catch (reason) {
      setStatusError(reason instanceof Error ? reason.message : '更新移动访问状态失败');
    } finally {
      setBusyAction(undefined);
    }
  };

  const savePassword = async () => {
    if (!status || passwordValue.trim().length < 8) {
      setPasswordFeedback({ kind: 'error', message: '密码至少需要 8 个字符' });
      return;
    }
    setBusyAction('password');
    setPasswordFeedback(undefined);
    try {
      setStatus(await api<Status>('/password', {
        method: 'POST',
        body: JSON.stringify({ password: passwordValue }),
      }));
      setPasswordValue('');
      setPasswordFeedback({ kind: 'success', message: '密码已保存，移动设备可使用新密码登录' });
    } catch (reason) {
      setPasswordFeedback({
        kind: 'error',
        message: reason instanceof Error ? reason.message : '保存密码失败',
      });
    } finally {
      setBusyAction(undefined);
    }
  };

  const copyAddress = async (address: string) => {
    const mobileAddress = `${address}/mobile`;
    try {
      await navigator.clipboard.writeText(mobileAddress);
      setCopiedAddress(address);
      window.setTimeout(() => setCopiedAddress(current => current === address ? undefined : current), 1600);
    } catch {
      setStatusError('复制失败，请手动选择访问地址');
    }
  };

  return <SettingsGroup title="移动伴侣" insetTitle>
    <SettingsRow
      icon={Smartphone}
      title="移动访问"
      description="手机可通过同一局域网或 Tailscale 查看和控制任务；Agent、项目文件和凭据始终留在电脑端"
    >
      <label className="settings-toggle" aria-label="开启移动伴侣">
        <input
          type="checkbox"
          checked={status?.enabled ?? false}
          disabled={!status || busyAction !== undefined}
          onChange={() => void toggle()}
        />
        <span aria-hidden="true" />
      </label>
    </SettingsRow>

    {status?.enabled && accessAddresses.map(entry => {
      const label = entry.kind === 'tailscale' ? 'Tailscale' : '局域网';
      return <SettingsRow
        key={entry.address}
        icon={Link2}
        title={`${label}地址`}
        description={status.firewall === 'manual'
          ? 'Windows 防火墙尚未确认放行；请允许 CodeM 的移动访问后再用手机打开'
          : `手机接入同一${entry.kind === 'tailscale' ? ' Tailscale 网络' : '局域网'}后打开此地址`}
      >
        <div className="settings-runtime-actions">
          <code className="settings-runtime-command">{entry.address}/mobile</code>
          <button className="settings-action-button" onClick={() => void copyAddress(entry.address)}>
            {copiedAddress === entry.address ? <CheckCircle2 size={14} /> : <Copy size={14} />}
            {copiedAddress === entry.address ? '已复制' : '复制'}
          </button>
        </div>
      </SettingsRow>;
    })}

    {status?.enabled && accessAddresses.length === 0 && <SettingsRow
      icon={ShieldCheck}
      title="未检测到可用访问地址"
      description="请确认电脑已连接局域网或 Tailscale，然后刷新状态。"
    />}

    {status?.enabled && <SettingsRow
      icon={KeyRound}
      title="固定访问密码"
      description={`手机登录账号为 ${status.username}；设置新密码后，已有移动设备会被要求重新登录。`}
      stack
    >
      <div className="mobile-password-editor">
        <div className="settings-runtime-actions">
          <code className="settings-runtime-command">{status.username}</code>
          <input
            className="mobile-password-input"
            type="password"
            minLength={8}
            autoComplete="new-password"
            value={passwordValue}
            aria-describedby="mobile-password-feedback"
            onChange={(event) => {
              setPasswordValue(event.target.value);
              setPasswordFeedback(undefined);
            }}
            onBlur={() => {
              if (passwordValue.length > 0 && passwordValue.trim().length < 8) {
                setPasswordFeedback({ kind: 'error', message: '密码至少需要 8 个字符' });
              }
            }}
            placeholder={status.passwordConfigured ? '输入新密码' : '设置至少 8 位密码'}
          />
          <button
            className="settings-action-button primary"
            disabled={busyAction !== undefined || passwordValue.trim().length < 8}
            onClick={() => void savePassword()}
          >
            {busyAction === 'password' ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}
            {busyAction === 'password' ? '保存中' : '保存密码'}
          </button>
        </div>
        {passwordFeedback && <div
          id="mobile-password-feedback"
          className={`mobile-password-feedback ${passwordFeedback.kind}`}
          role={passwordFeedback.kind === 'error' ? 'alert' : 'status'}
        >
          {passwordFeedback.kind === 'success' && <CheckCircle2 size={14} aria-hidden="true" />}
          {passwordFeedback.message}
        </div>}
      </div>
    </SettingsRow>}

    {status?.devices.filter(device => !device.revoked).map(device => <SettingsRow
      key={device.id}
      icon={Smartphone}
      title={device.name}
      description={`最后访问：${new Date(device.lastSeenAt).toLocaleString()}`}
      stack
    >
      <div className="mobile-device-controls">
        <div className="mobile-device-permissions">
          {([['view', '查看'], ['send', '发送任务'], ['stop', '停止任务'], ['approve', '审批']] as const).map(([permission, label]) => <label key={permission}>
            <input
              type="checkbox"
              checked={device.permissions.includes(permission)}
              onChange={async event => {
                const next = event.currentTarget.checked
                  ? [...device.permissions, permission]
                  : device.permissions.filter(value => value !== permission);
                await api(`/devices/${device.id}`, { method: 'PATCH', body: JSON.stringify({ permissions: next }) });
                await refresh();
              }}
            />
            <span>{label}</span>
          </label>)}
        </div>
        <button className="settings-action-button" onClick={async () => {
          await api(`/devices/${device.id}`, { method: 'DELETE' });
          await refresh();
        }}>
          <Trash2 size={14} />撤销设备
        </button>
      </div>
    </SettingsRow>)}

    {statusError && <SettingsRow icon={RefreshCw} title="移动伴侣操作失败" description={statusError}>
      <button className="settings-action-button" onClick={() => void refresh()}>重试</button>
    </SettingsRow>}
  </SettingsGroup>;
}
