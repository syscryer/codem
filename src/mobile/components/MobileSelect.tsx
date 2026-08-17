import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { createPortal } from 'react-dom';

export type MobileSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export function MobileSelect({ label, value, options, onChange, disabled = false }: {
  label: string;
  value: string;
  options: MobileSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const historyEntryRef = useRef(false);
  const titleId = useId();
  const listboxId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  const closeSheet = () => {
    setOpen(false);
    if (historyEntryRef.current) {
      historyEntryRef.current = false;
      history.back();
    }
  };

  useEffect(() => {
    if (!open) return;
    history.pushState({ ...history.state, codemMobileSelect: titleId }, '', window.location.href);
    historyEntryRef.current = true;
    const frame = requestAnimationFrame(() => {
      const preferred = sheetRef.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]:not(:disabled)');
      const fallback = sheetRef.current?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)');
      (preferred ?? fallback)?.focus({ preventScroll: true });
    });
    const onKeyDown = (event: KeyboardEvent) => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSheet();
        return;
      }
      const optionButtons = Array.from(sheet.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)'));
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const current = optionButtons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? optionButtons.length - 1
            : event.key === 'ArrowDown'
              ? Math.min(current + 1, optionButtons.length - 1)
              : Math.max(current < 0 ? optionButtons.length - 1 : current - 1, 0);
        optionButtons[next]?.focus({ preventScroll: true });
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(sheet.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus({ preventScroll: true });
      }
    };
    const onPopState = () => {
      historyEntryRef.current = false;
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('popstate', onPopState);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('popstate', onPopState);
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [open]);

  const sheet = open && typeof document !== 'undefined' ? createPortal(
    <div className="mobile-select-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSheet(); }}>
      <section ref={sheetRef} className="mobile-select-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <span className="mobile-select-handle" aria-hidden="true" />
        <header className="mobile-select-sheet-header">
          <strong id={titleId}>{label}</strong>
          <button type="button" onClick={closeSheet}>取消</button>
        </header>
        <div id={listboxId} className="mobile-select-options" role="listbox" aria-label={label}>
          {options.map((option) => {
            const current = option.value === value;
            return <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={current}
              className={current ? 'selected' : ''}
              disabled={option.disabled}
              onClick={() => {
                onChange(option.value);
                closeSheet();
              }}
            >
              <span><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
            </button>;
          })}
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  return <>
    <button
      ref={triggerRef}
      type="button"
      className={`mobile-select-trigger${open ? ' open' : ''}`}
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listboxId}
      disabled={disabled || options.length === 0}
      onClick={() => setOpen(true)}
    >
      <span>{selected?.label || '请选择'}</span>
      <ChevronDown size={17} aria-hidden="true" />
    </button>
    {sheet}
  </>;
}
