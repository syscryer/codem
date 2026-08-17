import { useCallback, useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';

export type MobileActionSheetItem = {
  id: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
};

export function MobileActionSheet({
  open,
  title,
  items,
  children,
  triggerRef,
  onClose,
}: {
  open: boolean;
  title: string;
  items: MobileActionSheetItem[];
  children?: ReactNode;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  const historyEntryRef = useRef(false);
  const titleId = useId();

  const closeSheet = useCallback(() => {
    onClose();
    if (historyEntryRef.current) {
      historyEntryRef.current = false;
      history.back();
    }
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    history.pushState({ ...history.state, codemMobileActionSheet: titleId }, '', window.location.href);
    historyEntryRef.current = true;
    const frame = requestAnimationFrame(() => {
      sheetRef.current?.focus({ preventScroll: true });
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('.mobile-select-backdrop:not(.mobile-action-sheet-backdrop)')) return;
      const sheet = sheetRef.current;
      if (!sheet) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSheet();
        return;
      }
      const buttons = Array.from(sheet.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : event.key === 'ArrowDown'
              ? Math.min(current + 1, buttons.length - 1)
              : Math.max(current < 0 ? buttons.length - 1 : current - 1, 0);
        buttons[next]?.focus({ preventScroll: true });
        return;
      }
      if (event.key !== 'Tab') return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (document.activeElement === sheet) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus({ preventScroll: true });
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus({ preventScroll: true });
      }
    };
    const onPopState = () => {
      if (document.querySelector('.mobile-select-backdrop:not(.mobile-action-sheet-backdrop)')) return;
      if (window.history.state?.codemMobileActionSheet) return;
      historyEntryRef.current = false;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('popstate', onPopState);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('popstate', onPopState);
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [closeSheet, onClose, open, titleId, triggerRef]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="mobile-select-backdrop mobile-action-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSheet(); }}>
      <section ref={sheetRef} className="mobile-select-sheet mobile-action-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <span className="mobile-select-handle" aria-hidden="true" />
        <header className="mobile-select-sheet-header">
          <strong id={titleId}>{title}</strong>
          <button type="button" onClick={closeSheet}>取消</button>
        </header>
        {children ? <div className="mobile-action-sheet-content">{children}</div> : null}
        <div className="mobile-action-sheet-options" role="menu" aria-label={title}>
          {items.map((item) => {
            const Icon = item.icon;
            return <button
              key={item.id}
              type="button"
              className="mobile-action-sheet-item"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                void Promise.resolve(item.onSelect()).finally(closeSheet);
              }}
            >
              <span className="mobile-action-sheet-icon"><Icon size={19} /></span>
              <span><strong>{item.label}</strong>{item.description ? <small>{item.description}</small> : null}</span>
            </button>;
          })}
        </div>
      </section>
    </div>,
    document.body,
  );
}
