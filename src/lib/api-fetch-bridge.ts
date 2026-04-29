const API_BASE_URL = 'http://127.0.0.1:3001';

declare global {
  interface Window {
    __codemApiFetchBridgeInstalled?: boolean;
  }
}

export function installApiFetchBridge() {
  if (typeof window === 'undefined' || window.__codemApiFetchBridgeInstalled) {
    return;
  }

  const nativeFetch = window.fetch.bind(window);
  window.__codemApiFetchBridgeInstalled = true;

  window.fetch = (input, init) => {
    const nextInput = rewriteApiRequest(input);
    return nativeFetch(nextInput, init);
  };
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
    return `${API_BASE_URL}${input}`;
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
  return `${API_BASE_URL}${url.pathname}${url.search}${url.hash}`;
}

function isApiPath(value: string) {
  return value === '/api' || value.startsWith('/api/') || value.startsWith('/api?');
}
