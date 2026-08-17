import { Bell, Check, ChevronRight, Laptop, Monitor, Moon, Palette, ShieldCheck, Sun, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type { MobileBootstrap } from '../types';

type MobileTheme = 'light' | 'system' | 'dark';

export function SettingsPage({ data }: { data: MobileBootstrap | null }) {
  const [notificationPermission, setNotificationPermission] = useState(() => 'Notification' in window ? Notification.permission : 'unsupported');
  const [theme, setThemeState] = useState<MobileTheme>(readMobileTheme);

  const setTheme = (nextTheme: MobileTheme) => {
    if (nextTheme === 'system') document.documentElement.removeAttribute('data-mobile-theme');
    else document.documentElement.dataset.mobileTheme = nextTheme;
    localStorage.setItem('codem-mobile-theme', nextTheme);
    setThemeState(nextTheme);
  };

  const requestNotifications = async () => {
    if (!('Notification' in window)) return;
    setNotificationPermission(await Notification.requestPermission());
  };

  return <div className="mobile-settings-page">
    <section className="mobile-settings-section prototype-first-section">
      <h2>连接</h2>
      <div className="mobile-settings-card">
        <SettingRow icon={Laptop} tone="blue" label="当前电脑" value={data?.computerName || 'CodeM'} />
        <SettingRow icon={ShieldCheck} tone="green" label="设备权限" value={data?.permissions.map(labelPermission).join('、') || '仅查看'} />
      </div>
    </section>

    <section className="mobile-settings-section">
      <h2>通知</h2>
      <div className="mobile-settings-card">
        <button type="button" className="mobile-setting-row mobile-setting-action" onClick={() => void requestNotifications()}>
          <span className="mobile-setting-leading"><span className="mobile-setting-icon tone-orange"><Bell size={18} /></span><strong>任务通知</strong></span>
          <span className="mobile-setting-trailing"><small>{notificationPermission === 'granted' ? '已开启' : notificationPermission === 'unsupported' ? '浏览器不支持' : '点击开启'}</small>{notificationPermission === 'granted' ? <Check size={17} /> : <ChevronRight size={17} />}</span>
        </button>
      </div>
    </section>

    <section className="mobile-settings-section">
      <h2>外观</h2>
      <div className="mobile-settings-card mobile-appearance-card">
        <div className="mobile-setting-row mobile-theme-heading">
          <span className="mobile-setting-leading"><span className="mobile-setting-icon tone-neutral"><Palette size={18} /></span><strong>显示模式</strong></span>
          <small>{themeLabel(theme)}</small>
        </div>
        <div className="mobile-theme-grid" role="group" aria-label="显示模式">
          <ThemeButton icon={Sun} label="浅色" value="light" selected={theme === 'light'} onSelect={setTheme} />
          <ThemeButton icon={Monitor} label="跟随系统" value="system" selected={theme === 'system'} onSelect={setTheme} />
          <ThemeButton icon={Moon} label="深色" value="dark" selected={theme === 'dark'} onSelect={setTheme} />
        </div>
      </div>
    </section>

    <div className="mobile-privacy-note"><ShieldCheck size={16} /><p>任务正文和设备凭据不会写入离线缓存；手机不会收到 API Key、环境变量、渠道地址或完整终端日志。</p></div>
  </div>;
}

function SettingRow({ icon: Icon, tone, label, value }: { icon: LucideIcon; tone: string; label: string; value: string }) {
  return <div className="mobile-setting-row"><span className="mobile-setting-leading"><span className={`mobile-setting-icon tone-${tone}`}><Icon size={18} /></span><strong>{label}</strong></span><small title={value}>{value}</small></div>;
}

function ThemeButton({ icon: Icon, label, value, selected, onSelect }: { icon: LucideIcon; label: string; value: MobileTheme; selected: boolean; onSelect: (theme: MobileTheme) => void }) {
  return <button type="button" className={selected ? 'active' : ''} aria-pressed={selected} onClick={() => onSelect(value)}><Icon size={17} /><span>{label}</span></button>;
}

function readMobileTheme(): MobileTheme {
  const value = localStorage.getItem('codem-mobile-theme');
  return value === 'light' || value === 'dark' ? value : 'system';
}

function themeLabel(theme: MobileTheme) { return theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统'; }
function labelPermission(value: string) { return ({ view: '查看', send: '发送', stop: '停止', approve: '审批' } as Record<string, string>)[value] || value; }
