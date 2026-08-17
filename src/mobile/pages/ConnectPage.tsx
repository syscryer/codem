import { useState } from 'react';
import { ArrowRight, Laptop, ShieldCheck } from 'lucide-react';
import { mobileApi } from '../lib/mobile-api';
import type { MobileAuthStatus } from '../types';

export function ConnectPage({ status, error, onAuthenticated }: { status: MobileAuthStatus | null; error?: string; onAuthenticated: () => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(error);
  async function login() {
    setBusy(true); setMessage(undefined);
    try { await mobileApi.login(status?.username || 'codem', password, deviceName()); await onAuthenticated(); history.replaceState(null, '', '/mobile/tasks'); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : '登录失败'); }
    finally { setBusy(false); }
  }
  return <div className="mobile-native-connect"><div className="mobile-connect-brand"><img src="/icon.png" alt="" /><span>CodeM Mobile</span></div><section className="mobile-connect-card"><div className="mobile-connect-icon"><ShieldCheck size={30} /></div><h1>登录你的 CodeM</h1><p>{status?.passwordConfigured === false ? '请先在电脑端“设置 → 基础设置 → 移动伴侣”设置访问密码。' : '通过 Tailscale 安全连接到电脑端 CodeM。'}</p><label><span>账号</span><input className="mobile-username" value={status?.username || 'codem'} readOnly /></label><label><span>密码</span><input className="mobile-password" type="password" autoComplete="current-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="输入访问密码" onKeyDown={(event) => { if (event.key === 'Enter' && password.length >= 8) void login(); }} /></label>{message ? <div className="mobile-connect-error">{message}</div> : null}<button disabled={busy || password.length < 8 || status?.passwordConfigured === false} onClick={() => void login()}>{busy ? '正在登录…' : '登录'}<ArrowRight size={18} /></button></section><div className="mobile-connect-facts"><span><Laptop size={17} />Agent 始终在电脑运行</span><span><ShieldCheck size={17} />由 Tailscale 加密传输</span></div>{status?.enabled === false ? <p className="mobile-connect-warning">电脑端移动伴侣尚未开启。</p> : null}</div>;
}
function deviceName() { if (/iPhone/i.test(navigator.userAgent)) return 'iPhone'; if (/Android/i.test(navigator.userAgent)) return 'Android 设备'; return '移动浏览器'; }
