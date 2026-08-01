import { Globe2, MoreHorizontal } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import type { WebLinkOpenTarget } from '../types';
import { WebLinkActionMenu, type WebLinkMenuTarget } from './WebLinkActionMenu';

type ConversationWebPreviewCardProps = {
  urls: string[];
  onOpen: (url: string, target?: WebLinkOpenTarget) => void | Promise<void>;
  onCopy: (url: string) => void | Promise<void>;
};

export function ConversationWebPreviewCard({
  urls,
  onOpen,
  onCopy,
}: ConversationWebPreviewCardProps) {
  const [menuTarget, setMenuTarget] = useState<WebLinkMenuTarget | null>(null);

  function openMenu(event: MouseEvent<HTMLButtonElement>, url: string) {
    const bounds = event.currentTarget.getBoundingClientRect();
    setMenuTarget({ url, x: bounds.right, y: bounds.bottom });
  }

  return (
    <section className="conversation-web-previews" aria-label="本地网页预览">
      {urls.map((url) => {
        const parsed = new URL(url);
        return (
          <article className="conversation-web-preview-card" key={url}>
            <button
              type="button"
              className="conversation-web-preview-primary"
              title={`打开 ${url}`}
              onClick={() => void onOpen(url)}
            >
              <span className="conversation-web-preview-icon" aria-hidden="true">
                <Globe2 size={19} />
              </span>
              <span className="conversation-web-preview-copy">
                <strong>网页预览</strong>
                <span className="conversation-web-preview-host">{parsed.host}</span>
                <span className="conversation-web-preview-url" title={url}>{url}</span>
              </span>
            </button>
            <button
              type="button"
              className="conversation-web-preview-menu-button"
              title="更多网页操作"
              aria-label="更多网页操作"
              aria-haspopup="menu"
              aria-expanded={menuTarget?.url === url}
              onClick={(event) => openMenu(event, url)}
            >
              <MoreHorizontal size={17} />
            </button>
          </article>
        );
      })}
      <WebLinkActionMenu
        target={menuTarget}
        onClose={() => setMenuTarget(null)}
        onOpen={onOpen}
        onCopy={onCopy}
      />
    </section>
  );
}
