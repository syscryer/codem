import type { Webview } from '@tauri-apps/api/webview';
import { isTauriRuntime } from './window-material';
import { normalizeWorkbenchBrowserInput } from './workbench-browser';

export type WorkbenchBrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function workbenchBrowserWebviewLabel(tabId: string) {
  const safeId = tabId.replace(/[^a-zA-Z\d-]/g, '-').slice(0, 80);
  return `codem-browser-${safeId}`;
}

export async function ensureWorkbenchBrowserWebview(
  tabId: string,
  url: string,
  bounds: WorkbenchBrowserBounds,
) {
  if (!isTauriRuntime()) {
    return null;
  }
  const [{ Webview }, { getCurrentWindow }] = await Promise.all([
    import('@tauri-apps/api/webview'),
    import('@tauri-apps/api/window'),
  ]);
  const label = workbenchBrowserWebviewLabel(tabId);
  const existing = await Webview.getByLabel(label);
  if (existing) {
    await syncWorkbenchBrowserWebviewBounds(existing, bounds);
    await existing.show();
    await existing.setFocus();
    return existing;
  }

  const webview = new Webview(getCurrentWindow(), label, {
    url: normalizeWorkbenchBrowserInput(url),
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    focus: true,
    dragDropEnabled: true,
    zoomHotkeysEnabled: true,
  });
  await waitForWebviewCreated(webview);
  return webview;
}

export async function syncWorkbenchBrowserWebviewBounds(
  webview: Webview,
  bounds: WorkbenchBrowserBounds,
) {
  const [{ LogicalPosition, LogicalSize }] = await Promise.all([
    import('@tauri-apps/api/dpi'),
  ]);
  await Promise.all([
    webview.setPosition(new LogicalPosition(bounds.x, bounds.y)),
    webview.setSize(new LogicalSize(bounds.width, bounds.height)),
  ]);
}

export async function findWorkbenchBrowserWebview(tabId: string) {
  if (!isTauriRuntime()) {
    return null;
  }
  const { Webview } = await import('@tauri-apps/api/webview');
  return Webview.getByLabel(workbenchBrowserWebviewLabel(tabId));
}

export async function hideWorkbenchBrowserWebview(tabId: string) {
  const webview = await findWorkbenchBrowserWebview(tabId);
  await webview?.hide();
}

export async function closeWorkbenchBrowserWebview(tabId: string) {
  const webview = await findWorkbenchBrowserWebview(tabId);
  await webview?.close();
}

export async function navigateWorkbenchBrowserWebview(tabId: string, url: string) {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('browser_webview_navigate', {
    label: workbenchBrowserWebviewLabel(tabId),
    url: normalizeWorkbenchBrowserInput(url),
  });
}

export async function controlWorkbenchBrowserWebview(
  tabId: string,
  action: 'back' | 'forward' | 'reload',
) {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('browser_webview_control', {
    label: workbenchBrowserWebviewLabel(tabId),
    action,
  });
}

export async function readWorkbenchBrowserWebviewUrl(tabId: string) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('browser_webview_url', {
    label: workbenchBrowserWebviewLabel(tabId),
  });
}

function waitForWebviewCreated(webview: Webview) {
  return new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error('创建浏览器视图超时')), 12_000);
    void webview.once('tauri://created', () => {
      window.clearTimeout(timeoutId);
      resolve();
    });
    void webview.once<unknown>('tauri://error', (event) => {
      window.clearTimeout(timeoutId);
      reject(new Error(`创建浏览器视图失败: ${String(event.payload)}`));
    });
  });
}
