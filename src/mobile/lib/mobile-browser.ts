const LOCAL_HOST_PATTERN = /^(localhost|0\.0\.0\.0|\[::1?\]|127(?:\.\d{1,3}){3})$/i;

export function isBrowsableHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

export function currentMobileHostname(): string {
  return typeof window === 'undefined' ? '' : window.location.hostname;
}

// 会话里的本地预览地址（http://localhost:3000 等）在手机上指向手机自身，
// 重写为当前 PWA 主机后才能访问电脑上运行的服务
export function resolveMobileBrowsableUrl(
  rawUrl: string,
  currentHostname: string = currentMobileHostname(),
): string | null {
  if (!isBrowsableHttpUrl(rawUrl)) {
    return null;
  }
  const url = new URL(rawUrl);
  if (currentHostname && LOCAL_HOST_PATTERN.test(url.hostname) && url.hostname !== currentHostname) {
    url.hostname = currentHostname;
  }
  return url.toString();
}

const HOST_PORT_PATTERN = /^[a-zA-Z0-9._~!$&'()*+,;=%[\]-]+:\d+([/?#].*)?$/;
const SCHEME_PREFIX_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export function normalizeBrowserAddressInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return isBrowsableHttpUrl(trimmed) ? new URL(trimmed).toString() : null;
  }
  // 裸 host:port（如 localhost:3000、example.com:8080/x）：本地服务通常是 http，按主机类型补协议
  if (HOST_PORT_PATTERN.test(trimmed)) {
    const host = trimmed.split(':')[0];
    const scheme = LOCAL_HOST_PATTERN.test(host) ? 'http' : 'https';
    const candidate = `${scheme}://${trimmed}`;
    return isBrowsableHttpUrl(candidate) ? new URL(candidate).toString() : null;
  }
  // 其余带 scheme 前缀的输入（mailto:、ftp:// 等）只接受 http(s)
  if (SCHEME_PREFIX_PATTERN.test(trimmed)) {
    return null;
  }
  const candidate = `https://${trimmed}`;
  return isBrowsableHttpUrl(candidate) ? new URL(candidate).toString() : null;
}

export function pushBrowserHistoryEntry(
  entries: readonly string[],
  activeIndex: number,
  next: string,
): { entries: string[]; activeIndex: number } {
  const nextEntries = [...entries.slice(0, activeIndex + 1), next];
  return { entries: nextEntries, activeIndex: nextEntries.length - 1 };
}
