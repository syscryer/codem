import { Copy, ExternalLink, PanelRightOpen } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import type { WebLinkOpenTarget } from '../types';
import { PopoverPortal } from './PopoverPortal';

export type WebLinkMenuTarget = {
  url: string;
  x: number;
  y: number;
};

type WebLinkActionMenuProps = {
  target: WebLinkMenuTarget | null;
  onClose: () => void;
  onOpen: (url: string, target: WebLinkOpenTarget) => void | Promise<void>;
  onCopy: (url: string) => void | Promise<void>;
};

export function WebLinkActionMenu({
  target,
  onClose,
  onOpen,
  onCopy,
}: WebLinkActionMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const virtualAnchorRef = useRef<HTMLSpanElement | null>(null);

  useOutsideDismiss({
    refs: [{ ref: menuRef, onDismiss: onClose }],
  });

  useEffect(() => {
    if (!target) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, target]);

  async function run(action: () => void | Promise<void>) {
    try {
      await action();
    } finally {
      onClose();
    }
  }

  return (
    <PopoverPortal
      open={Boolean(target)}
      anchorRef={virtualAnchorRef}
      virtualAnchor={target ? { x: target.x, y: target.y } : null}
      placement="bottom-start"
      offset={0}
    >
      {target ? (
        <div ref={menuRef} className="workspace-menu web-link-action-menu" role="menu" aria-label="网页链接操作">
          <button type="button" className="workspace-menu-item" role="menuitem" onClick={() => void run(() => onOpen(target.url, 'workbench'))}>
            <PanelRightOpen size={14} />
            <span>在右侧浏览器打开</span>
          </button>
          <button type="button" className="workspace-menu-item" role="menuitem" onClick={() => void run(() => onOpen(target.url, 'external'))}>
            <ExternalLink size={14} />
            <span>在外部浏览器打开</span>
          </button>
          <div className="workspace-menu-divider" role="separator" />
          <button type="button" className="workspace-menu-item" role="menuitem" onClick={() => void run(() => onCopy(target.url))}>
            <Copy size={14} />
            <span>复制链接</span>
          </button>
        </div>
      ) : null}
    </PopoverPortal>
  );
}
