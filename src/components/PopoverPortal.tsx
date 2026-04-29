import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

type PopoverPortalProps = {
  children: ReactNode;
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  placement?: Placement;
  offset?: number;
};

export function PopoverPortal({ children, open, anchorRef, placement = 'bottom-end', offset = 8 }: PopoverPortalProps) {
  const portalRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;

    function applyPosition() {
      const anchor = anchorRef.current;
      const portal = portalRef.current;
      if (!anchor || !portal) return;

      const rect = anchor.getBoundingClientRect();
      const style = portal.style;

      switch (placement) {
        case 'bottom-start':
          style.top = `${rect.bottom + offset}px`;
          style.left = `${rect.left}px`;
          style.right = '';
          style.bottom = '';
          break;
        case 'bottom-end':
          style.top = `${rect.bottom + offset}px`;
          style.left = '';
          style.right = `${window.innerWidth - rect.right}px`;
          style.bottom = '';
          break;
        case 'top-start':
          style.bottom = `${window.innerHeight - rect.top + offset}px`;
          style.left = `${rect.left}px`;
          style.right = '';
          style.top = '';
          break;
        case 'top-end':
          style.bottom = `${window.innerHeight - rect.top + offset}px`;
          style.left = '';
          style.right = `${window.innerWidth - rect.right}px`;
          style.top = '';
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
  }, [open, anchorRef, placement, offset]);

  if (!open) return null;

  return createPortal(
    <div ref={portalRef} data-popover-portal="" style={{ position: 'fixed', zIndex: 9999 }}>
      {children}
    </div>,
    document.body,
  );
}
