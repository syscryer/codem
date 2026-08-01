import { createElement, type AnchorHTMLAttributes, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { isTauriRuntime } from './window-material';

export type MarkdownLocalFileMenuTarget = {
  path: string;
  x: number;
  y: number;
};

type MarkdownLinkProps = Pick<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'title'> & {
  children?: ReactNode;
  onOpenLocalFile?: (path: string) => void;
  onOpenLocalFileContextMenu?: (target: MarkdownLocalFileMenuTarget) => void;
  onOpenWebUrl?: (url: string) => void;
  onOpenWebContextMenu?: (target: { url: string; x: number; y: number }) => void;
};

export function renderMarkdownLink({
  href,
  title,
  children,
  onOpenLocalFile,
  onOpenLocalFileContextMenu,
  onOpenWebUrl,
  onOpenWebContextMenu,
}: MarkdownLinkProps): ReactElement {
  const target = classifyMarkdownLink(href);
  const external = target.kind === 'external';

  return createElement(
    'a',
    {
      href,
      title,
      target: external ? '_blank' : undefined,
      rel: external ? 'noopener noreferrer' : undefined,
      onClick: target.kind === 'anchor'
        ? undefined
        : (event: MouseEvent<HTMLAnchorElement>) => {
            event.preventDefault();
            if (target.kind === 'external') {
              if (onOpenWebUrl) {
                onOpenWebUrl(target.url);
              } else {
                void openExternalUrl(target.url);
              }
            } else if (target.kind === 'local-file') {
              onOpenLocalFile?.(target.path);
            }
          },
      onContextMenu: target.kind === 'external' && onOpenWebContextMenu
        ? (event: MouseEvent<HTMLAnchorElement>) => {
            event.preventDefault();
            onOpenWebContextMenu({
              url: target.url,
              x: event.clientX,
              y: event.clientY,
            });
          }
        : target.kind === 'local-file' && onOpenLocalFileContextMenu
          ? (event: MouseEvent<HTMLAnchorElement>) => {
              event.preventDefault();
              onOpenLocalFileContextMenu({
                path: target.path,
                x: event.clientX,
                y: event.clientY,
              });
            }
          : undefined,
    },
    children,
  );
}

export function classifyMarkdownLink(value: string | undefined):
  | { kind: 'external'; url: string }
  | { kind: 'anchor' }
  | { kind: 'local-file'; path: string }
  | { kind: 'unsupported' } {
  const href = value?.trim();
  if (!href) {
    return { kind: 'unsupported' };
  }
  if (href.startsWith('#')) {
    return { kind: 'anchor' };
  }
  if (isExternalHttpUrl(href)) {
    return { kind: 'external', url: href };
  }
  if (/^[a-zA-Z]:[\\/]/.test(href) || !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href)) {
    const encodedPath = href.split(/[?#]/, 1)[0];
    let path = encodedPath;
    try {
      path = decodeURIComponent(encodedPath);
    } catch {
      // Keep malformed percent-encoding unchanged so rendering never throws.
    }
    return path ? { kind: 'local-file', path } : { kind: 'unsupported' };
  }
  return { kind: 'unsupported' };
}

export function isExternalHttpUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function openExternalUrl(url: string) {
  if (!isExternalHttpUrl(url)) {
    return false;
  }

  if (isTauriRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_external_url', { url });
      return true;
    } catch (error) {
      console.warn('打开外部链接失败', error);
      return false;
    }
  }

  if (typeof window === 'undefined') {
    return false;
  }
  return window.open(url, '_blank', 'noopener,noreferrer') !== null;
}
