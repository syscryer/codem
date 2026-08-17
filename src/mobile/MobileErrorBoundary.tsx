import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';

export class MobileErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('CodeM mobile render failed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="mobile-fatal-error">
        <div className="mobile-fatal-error-icon"><TriangleAlert size={26} /></div>
        <h1>页面显示异常</h1>
        <p>{this.state.error.message || '移动页面遇到了无法恢复的错误。'}</p>
        <button type="button" onClick={() => void recoverMobilePage()}><RefreshCw size={17} />清理缓存并重试</button>
      </main>
    );
  }
}

async function recoverMobilePage() {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if ('caches' in window) {
    const keys = await caches.keys().catch(() => []);
    await Promise.all(keys.filter((key) => key.startsWith('codem-mobile-')).map((key) => caches.delete(key)));
  }
  const url = new URL(window.location.href);
  url.searchParams.set('codem-recover', Date.now().toString());
  window.location.replace(url.toString());
}
