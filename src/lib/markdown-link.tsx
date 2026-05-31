import { createElement, type AnchorHTMLAttributes, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { isTauriRuntime } from './window-material';

type MarkdownLinkProps = Pick<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'title'> & {
  children?: ReactNode;
};

export function renderMarkdownLink({ href, title, children }: MarkdownLinkProps): ReactElement {
  const external = isExternalHttpUrl(href);

  return createElement(
    'a',
    {
      href,
      title,
      target: external ? '_blank' : undefined,
      rel: external ? 'noopener noreferrer' : undefined,
      onClick: external ? (event: MouseEvent<HTMLAnchorElement>) => handleExternalLinkClick(event, href) : undefined,
    },
    children,
  );
}

export function isExternalHttpUrl(value: string | undefined): value is string {
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
    return;
  }

  if (isTauriRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_external_url', { url });
    } catch (error) {
      console.warn('打开外部链接失败', error);
    }
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

function handleExternalLinkClick(event: MouseEvent<HTMLAnchorElement>, url: string) {
  event.preventDefault();
  void openExternalUrl(url);
}
