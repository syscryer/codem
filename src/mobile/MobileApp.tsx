import { useEffect, useMemo, useState } from 'react';
import { Bell, FolderKanban, ListTodo, Plus, Settings, WifiOff } from 'lucide-react';
import { useMobileWorkspace } from './hooks/useMobileWorkspace';
import { ConnectPage } from './pages/ConnectPage';
import { NewTaskPage } from './pages/NewTaskPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import { TaskDetailPage } from './pages/TaskDetailPage';
import { TasksPage } from './pages/TasksPage';

type Route = { name: 'tasks' | 'projects' | 'notifications' | 'settings' | 'new' | 'detail'; threadId?: string };

function parseRoute(): Route {
  const path = window.location.pathname.replace(/\/+$/, '');
  const match = path.match(/^\/mobile\/tasks\/([^/]+)$/);
  if (match) return { name: 'detail', threadId: decodeURIComponent(match[1]) };
  if (path.endsWith('/projects')) return { name: 'projects' };
  if (path.endsWith('/notifications')) return { name: 'notifications' };
  if (path.endsWith('/settings')) return { name: 'settings' };
  if (path.endsWith('/new')) return { name: 'new' };
  return { name: 'tasks' };
}

export default function MobileApp() {
  const workspace = useMobileWorkspace();
  const [route, setRoute] = useState(parseRoute);
  const [updateReady, setUpdateReady] = useState(false);
  const navigate = (path: string) => { history.pushState(null, '', path); setRoute(parseRoute()); };
  const replaceRoute = (path: string) => { history.replaceState(null, '', path); setRoute(parseRoute()); };

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute());
    addEventListener('popstate', onPopState);
    return () => removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const theme = localStorage.getItem('codem-mobile-theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.mobileTheme = theme;
    if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    navigator.serviceWorker.register('/mobile-sw.js', { scope: '/mobile/', updateViaCache: 'none' }).then((registration) => {
      if (registration.waiting) setUpdateReady(true);
      registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', () => {
        if (registration.waiting) setUpdateReady(true);
      }));
      void registration.update();
    }).catch(() => undefined);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  if (workspace.loading) return <div className="mobile-native-loading"><img src="/icon.png" alt="" /><strong>正在连接 CodeM</strong><span>任务仍在电脑端安全运行</span></div>;
  if (!workspace.auth?.authenticated) return <ConnectPage status={workspace.auth} error={workspace.error} onAuthenticated={workspace.refresh} />;

  if (route.name === 'detail' && route.threadId) {
    return <TaskDetailPage threadId={route.threadId} bootstrap={workspace.data} onBack={() => replaceRoute('/mobile/tasks')} onChanged={workspace.refresh} />;
  }
  if (route.name === 'new') {
    return <NewTaskPage bootstrap={workspace.data} onBack={() => replaceRoute('/mobile/tasks')} onCreated={(id) => navigate(`/mobile/tasks/${id}`)} />;
  }

  const title = route.name === 'projects' ? '项目' : route.name === 'notifications' ? '通知' : route.name === 'settings' ? '设置' : '任务';
  const content = route.name === 'projects'
    ? <ProjectsPage projects={workspace.data?.projects ?? []} onOpen={(id) => navigate(`/mobile/tasks/${id}`)} onNew={() => navigate('/mobile/new')} />
    : route.name === 'notifications'
      ? <TasksPage mode="notifications" data={workspace.data} onOpen={(id) => navigate(`/mobile/tasks/${id}`)} onNew={() => navigate('/mobile/new')} />
      : route.name === 'settings'
        ? <SettingsPage data={workspace.data} />
        : <TasksPage data={workspace.data} onOpen={(id) => navigate(`/mobile/tasks/${id}`)} onNew={() => navigate('/mobile/new')} />;

  return <div className={`mobile-prototype mobile-live-shell mobile-page-${route.name} codex-desktop`}>
    {workspace.offline ? <div className="mobile-native-offline"><WifiOff size={15} />连接已中断，恢复后会自动同步</div> : null}
    {updateReady ? <button className="mobile-native-update" onClick={() => void activateMobileUpdate()}>新版本已就绪 · 刷新</button> : null}
    <div className="prototype-safe-shell">
      <header className="prototype-home-header">
        <div className="prototype-device-line"><span className="prototype-online-dot" /><span>{workspace.data?.computerName || '此电脑'} 在线</span></div>
        <div className="prototype-title-row"><h1>{title}</h1>{route.name === 'tasks' ? <button type="button" className="prototype-primary-icon" onClick={() => navigate('/mobile/new')} aria-label="新建任务"><Plus size={22} /></button> : null}</div>
      </header>
      <main className="prototype-home-content">{content}</main>
      <MobileTabBar active={route.name} unread={workspace.data?.unreadNotifications ?? 0} navigate={navigate} />
    </div>
  </div>;
}

async function activateMobileUpdate() {
  const registration = await navigator.serviceWorker.getRegistration('/mobile/');
  if (registration?.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    return;
  }
  window.location.reload();
}

function MobileTabBar({ active, unread, navigate }: { active: Route['name']; unread: number; navigate: (path: string) => void }) {
  const tabs = useMemo(() => [
    ['tasks', '/mobile/tasks', ListTodo, '任务'],
    ['projects', '/mobile/projects', FolderKanban, '项目'],
    ['notifications', '/mobile/notifications', Bell, '通知'],
    ['settings', '/mobile/settings', Settings, '设置'],
  ] as const, []);
  return <nav className="prototype-tab-bar" aria-label="移动端主导航">{tabs.map(([name, path, Icon, label]) => <button key={name} type="button" className={active === name ? 'active' : ''} onClick={() => navigate(path)}><Icon size={21} /><span>{label}</span>{name === 'notifications' && unread > 0 ? <i>{Math.min(unread, 9)}</i> : null}</button>)}</nav>;
}
