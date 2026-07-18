export const MAX_WORKBENCH_BROWSER_TABS = 8;
export const WORKBENCH_BROWSER_STORAGE_KEY = 'codem.workbench-browser.v1';

export type WorkbenchBrowserTab = {
  id: string;
  title: string;
  url: string;
};

export type WorkbenchBrowserState = {
  tabs: WorkbenchBrowserTab[];
  activeTabId: string;
};

export function createWorkbenchBrowserTab(url = ''): WorkbenchBrowserTab {
  return {
    id: crypto.randomUUID(),
    title: url ? browserTitleFromUrl(url) : '新标签页',
    url,
  };
}

export function createDefaultWorkbenchBrowserState(): WorkbenchBrowserState {
  const tab = createWorkbenchBrowserTab();
  return { tabs: [tab], activeTabId: tab.id };
}

export function normalizeWorkbenchBrowserInput(value: string) {
  const input = value.trim();
  if (!input) {
    throw new Error('请输入网址或搜索内容');
  }
  const localAddress = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/i.test(input);
  if (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^https?:/i.test(input) && !localAddress) {
    throw new Error('内置浏览器仅支持 HTTP 和 HTTPS 地址');
  }

  const candidate = resolveBrowserInputCandidate(input);
  const url = new URL(candidate);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('内置浏览器仅支持 HTTP 和 HTTPS 地址');
  }
  if (url.username || url.password) {
    throw new Error('请勿在网址中直接包含账号或密码');
  }
  return url.toString();
}

export function browserTitleFromUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./i, '') || '新标签页';
  } catch {
    return '新标签页';
  }
}

export function normalizeWorkbenchBrowserState(value: unknown): WorkbenchBrowserState {
  if (!value || typeof value !== 'object') {
    return createDefaultWorkbenchBrowserState();
  }
  const record = value as Record<string, unknown>;
  const tabs = Array.isArray(record.tabs)
    ? record.tabs
        .map(normalizeStoredTab)
        .filter((tab): tab is WorkbenchBrowserTab => Boolean(tab))
        .slice(0, MAX_WORKBENCH_BROWSER_TABS)
    : [];
  if (tabs.length === 0) {
    return createDefaultWorkbenchBrowserState();
  }
  const activeTabId = typeof record.activeTabId === 'string'
    && tabs.some((tab) => tab.id === record.activeTabId)
    ? record.activeTabId
    : tabs[0].id;
  return { tabs, activeTabId };
}

function resolveBrowserInputCandidate(input: string) {
  if (/^https?:\/\//i.test(input)) {
    return input;
  }
  if (/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/i.test(input)) {
    return `http://${input}`;
  }
  if (!/\s/.test(input) && (input.includes('.') || input.includes(':'))) {
    return `https://${input}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

function normalizeStoredTab(value: unknown): WorkbenchBrowserTab | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !/^[a-zA-Z\d-]{8,80}$/.test(record.id)) {
    return null;
  }
  const rawUrl = typeof record.url === 'string' ? record.url.trim() : '';
  let url = '';
  if (rawUrl) {
    try {
      url = normalizeWorkbenchBrowserInput(rawUrl);
    } catch {
      return null;
    }
  }
  const title = typeof record.title === 'string' && record.title.trim()
    ? record.title.trim().slice(0, 120)
    : browserTitleFromUrl(url);
  return { id: record.id, title, url };
}
