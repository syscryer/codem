import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';
type VirtualAnchor = { x: number; y: number };

const POPOVER_CONTEXT_ATTRIBUTES = [
  'data-theme-mode',
  'data-platform',
  'data-window-material',
  'data-density',
  'data-sidebar-width',
] as const;

function syncPopoverThemeContext(portal: HTMLDivElement, root: HTMLElement) {
  for (const attribute of POPOVER_CONTEXT_ATTRIBUTES) {
    const value = root.getAttribute(attribute);
    if (value === null) {
      portal.removeAttribute(attribute);
    } else {
      portal.setAttribute(attribute, value);
    }
  }

  const rootStyle = getComputedStyle(root);
  for (const property of Array.from(rootStyle)) {
    if (property.startsWith('--')) {
      portal.style.setProperty(property, rootStyle.getPropertyValue(property));
    }
  }
  portal.style.colorScheme = rootStyle.colorScheme;
  portal.style.fontFamily = rootStyle.fontFamily;
  portal.style.fontSize = rootStyle.fontSize;
}

type PopoverPortalProps = {
  children: ReactNode;
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  virtualAnchor?: VirtualAnchor | null;
  placement?: Placement;
  offset?: number;
  matchAnchorWidth?: boolean;
};

export function PopoverPortal({
  children,
  open,
  anchorRef,
  virtualAnchor,
  placement = 'bottom-end',
  offset = 8,
  matchAnchorWidth = false,
}: PopoverPortalProps) {
  const portalRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;

    const portal = portalRef.current;
    const root = document.querySelector<HTMLElement>('.codex-desktop');
    if (!portal || !root) return;

    const syncThemeContext = () => syncPopoverThemeContext(portal, root);
    syncThemeContext();

    const observer = new MutationObserver(syncThemeContext);
    observer.observe(root, { attributes: true });

    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
    colorScheme.addEventListener('change', syncThemeContext);

    return () => {
      observer.disconnect();
      colorScheme.removeEventListener('change', syncThemeContext);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;

    function applyPosition() {
      const portal = portalRef.current;
      if (!portal) return;

      if (virtualAnchor) {
        const { x, y } = virtualAnchor;
        const mw = portal.offsetWidth;
        const mh = portal.offsetHeight;
        const clampedX = Math.min(x, window.innerWidth - mw - 4);
        const clampedY = Math.min(y, window.innerHeight - mh - 4);
        portal.style.left = `${Math.max(4, clampedX)}px`;
        portal.style.top = `${Math.max(4, clampedY)}px`;
        portal.style.right = '';
        portal.style.bottom = '';
        return;
      }

      const anchor = anchorRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const style = portal.style;
      style.width = matchAnchorWidth ? `${rect.width}px` : '';
      const mw = portal.offsetWidth;
      const mh = portal.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      switch (placement) {
        case 'bottom-start':
          style.bottom = '';
          style.top = `${Math.min(rect.bottom + offset, vh - mh - 4)}px`;
          style.left = `${Math.min(rect.left, vw - mw - 4)}px`;
          style.right = '';
          break;
        case 'bottom-end':
          style.bottom = '';
          style.top = `${Math.min(rect.bottom + offset, vh - mh - 4)}px`;
          style.left = '';
          style.right = `${Math.max(4, vw - rect.right)}px`;
          break;
        case 'top-start':
          style.top = '';
          style.bottom = `${Math.min(vh - rect.top + offset, vh - mh - 4)}px`;
          style.left = `${Math.min(rect.left, vw - mw - 4)}px`;
          style.right = '';
          break;
        case 'top-end':
          style.top = '';
          style.bottom = `${Math.min(vh - rect.top + offset, vh - mh - 4)}px`;
          style.left = '';
          style.right = `${Math.max(4, vw - rect.right)}px`;
          break;
      }
    }

    applyPosition();

    const observer = new ResizeObserver(applyPosition);
    if (anchorRef.current) observer.observe(anchorRef.current);

    window.addEventListener('scroll', applyPosition, true);
    window.addEventListener('resize', applyPosition);

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', applyPosition, true);
      window.removeEventListener('resize', applyPosition);
    };
  }, [open, anchorRef, virtualAnchor, placement, offset, matchAnchorWidth]);

  if (!open) return null;

  return createPortal(
    <div
      ref={portalRef}
      className="popover-portal-host"
      data-popover-portal=""
      style={{ position: 'fixed', zIndex: 9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}
