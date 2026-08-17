import { useCallback, useEffect, useRef, useState } from 'react';
import { mobileApi, MobileApiError } from '../lib/mobile-api';
import type { MobileAuthStatus, MobileBootstrap } from '../types';

export function useMobileWorkspace() {
  const [auth, setAuth] = useState<MobileAuthStatus | null>(null);
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [error, setError] = useState<string>();
  const previousPhases = useRef(new Map<string, string>());
  const offlineNotified = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const status = await mobileApi.authStatus();
      setAuth(status);
      if (status.authenticated) {
        const nextData = await mobileApi.bootstrap();
        void notifyTaskChanges(nextData, previousPhases.current);
        previousPhases.current = new Map(nextData.tasks.map(task => [task.threadId, task.phase]));
        setData(nextData);
      }
      else setData(null);
      setError(undefined);
      setOffline(false);
      offlineNotified.current = false;
    } catch (reason) {
      if (reason instanceof MobileApiError && reason.status === 401) {
        setAuth({ enabled: true, authenticated: false });
        setData(null);
      } else {
        setError(reason instanceof Error ? reason.message : '无法连接电脑');
        setOffline(true);
        if (!offlineNotified.current) { offlineNotified.current = true; void showMobileNotification('电脑连接已中断', 'CodeM 正在等待网络恢复。', '/mobile/tasks'); }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onOnline = () => void refresh();
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refresh]);

  useEffect(() => {
    if (!auth?.authenticated) return;
    const events = new EventSource('/api/mobile/events', { withCredentials: true });
    events.onopen = () => setOffline(false);
    events.addEventListener('sync', () => {
      void refresh();
    });
    events.onerror = () => setOffline(true);
    return () => events.close();
  }, [auth?.authenticated, refresh]);

  return { auth, data, loading, offline, error, refresh };
}

async function notifyTaskChanges(data: MobileBootstrap, previous: Map<string, string>) {
  for (const task of data.tasks) {
    const before = previous.get(task.threadId);
    if (!before || before === task.phase) continue;
    if (task.phase === 'done') await showMobileNotification('任务已完成', `${task.projectName} 中的 Agent 任务已完成。`, `/mobile/tasks/${encodeURIComponent(task.threadId)}`);
    if (task.phase === 'error') await showMobileNotification('任务运行失败', `${task.projectName} 中的任务需要查看。`, `/mobile/tasks/${encodeURIComponent(task.threadId)}`);
    if (task.phase === 'waiting') await showMobileNotification('任务等待处理', `${task.projectName} 中有审批或问题等待处理。`, `/mobile/tasks/${encodeURIComponent(task.threadId)}`);
  }
}

async function showMobileNotification(title: string, body: string, url: string) {
  if (!window.isSecureContext || !('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(title, { body, icon: '/icon.png', badge: '/icon.png', tag: `codem-${url}`, data: { url } });
}
