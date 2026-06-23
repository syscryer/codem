import { isTauriRuntime } from './window-material';

const fallbackApiBaseUrl = 'http://127.0.0.1:3001';
const backendReadyTimeoutMs = 8000;
const backendReadyPollMs = 100;

let apiBaseUrl = fallbackApiBaseUrl;

declare global {
  interface Window {
    __codemApiFetchBridgeInstalled?: boolean;
  }
}

export function installApiFetchBridge() {
  if (typeof window === 'undefined' || !isTauriRuntime() || window.__codemApiFetchBridgeInstalled) {
    return;
  }

  const nativeFetch = window.fetch.bind(window);
  window.__codemApiFetchBridgeInstalled = true;

  window.fetch = (input, init) => {
    const nextInput = rewriteApiRequest(input);
    return nativeFetch(nextInput, init);
  };
}

export async function initializeApiFetchBridge() {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const nextBaseUrl = await invoke<string>('get_backend_base_url');
    if (typeof nextBaseUrl === 'string' && /^https?:\/\//.test(nextBaseUrl)) {
      apiBaseUrl = nextBaseUrl.replace(/\/+$/, '');
    }
    await waitForBackendReady(apiBaseUrl);
  } catch {
    apiBaseUrl = fallbackApiBaseUrl;
  }
}

export function resolveApiUrl(input: string) {
  return isTauriRuntime() ? rewriteApiUrlString(input) : input;
}

function rewriteApiRequest(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === 'string') {
    return rewriteApiUrlString(input);
  }

  if (input instanceof URL) {
    return isApiPath(input.pathname) ? new URL(toApiBaseUrl(input)) : input;
  }

  if (input instanceof Request) {
    const url = new URL(input.url);
    if (!isApiPath(url.pathname)) {
      return input;
    }

    return new Request(toApiBaseUrl(url), input);
  }

  return input;
}

function rewriteApiUrlString(input: string) {
  if (isApiPath(input)) {
    return `${apiBaseUrl}${input}`;
  }

  try {
    const url = new URL(input, window.location.href);
    if (url.origin === window.location.origin && isApiPath(url.pathname)) {
      return toApiBaseUrl(url);
    }
  } catch {
    return input;
  }

  return input;
}

function toApiBaseUrl(url: URL) {
  return `${apiBaseUrl}${url.pathname}${url.search}${url.hash}`;
}

function isApiPath(value: string) {
  return value === '/api' || value.startsWith('/api/') || value.startsWith('/api?');
}

async function waitForBackendReady(baseUrl: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < backendReadyTimeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { cache: 'no-store' });
      if (response.ok) {
        return;
      }
    } catch {
      // The desktop shell may still be launching the bundled backend.
    }
    await sleep(backendReadyPollMs);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
