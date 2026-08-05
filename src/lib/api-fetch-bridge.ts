import { isTauriRuntime } from './window-material';

const fallbackApiBaseUrl = 'http://127.0.0.1:3001';
const backendReadyTimeoutMs = 8000;
const backendReadyPollMs = 100;

let apiBaseUrl = fallbackApiBaseUrl;
let apiToken: string | null = null;

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
    return nativeFetch(nextInput, withApiAuthorization(nextInput, init));
  };
}

export async function initializeApiFetchBridge() {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const connection = await invoke<{ baseUrl: string; token?: string | null }>('get_backend_connection');
    if (typeof connection?.baseUrl === 'string' && /^https?:\/\//.test(connection.baseUrl)) {
      apiBaseUrl = connection.baseUrl.replace(/\/+$/, '');
      apiToken = typeof connection.token === 'string' && connection.token ? connection.token : null;
    }
    await waitForBackendReady(apiBaseUrl);
  } catch {
    apiBaseUrl = fallbackApiBaseUrl;
    apiToken = null;
  }
}

export function resolveApiUrl(input: string) {
  return isTauriRuntime() ? rewriteApiUrlString(input) : input;
}

function withApiAuthorization(input: RequestInfo | URL, init?: RequestInit): RequestInit | undefined {
  return withRuntimeApiAuthorization(input, init, apiToken, apiBaseUrl);
}

export function withRuntimeApiAuthorization(input: RequestInfo | URL, init: RequestInit | undefined, token: string | null, baseUrl: string): RequestInit | undefined {
  if (!token || !isResolvedApiRequest(input, baseUrl)) {
    return init;
  }
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  }
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}

function isResolvedApiRequest(input: RequestInfo | URL, baseUrl: string) {
  try {
    const url = input instanceof Request ? new URL(input.url) : input instanceof URL ? input : new URL(input, window.location.href);
    return url.origin === baseUrl && isApiPath(url.pathname);
  } catch {
    return false;
  }
}

export function getApiBaseUrl() {
  if (isTauriRuntime()) {
    return apiBaseUrl;
  }
  return typeof window === 'undefined' ? fallbackApiBaseUrl : window.location.origin;
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
      const headers = apiToken ? { Authorization: `Bearer ${apiToken}` } : undefined;
      const response = await fetch(`${baseUrl}/api/health`, { cache: 'no-store', headers });
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
