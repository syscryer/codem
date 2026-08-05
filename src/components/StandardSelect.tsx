import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { PopoverPortal } from './PopoverPortal';

export type StandardSelectOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export function StandardSelect<T extends string>({
  value,
  options,
  ariaLabel,
  onChange,
  placeholder = '请选择',
  emptyLabel = '暂无可用选项',
  disabled = false,
  className = '',
  triggerClassName = '',
  menuClassName = '',
  optionClassName = '',
  offset = 8,
}: {
  value: T;
  options: ReadonlyArray<StandardSelectOption<T>>;
  ariaLabel: string;
  onChange: (value: T) => void;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  optionClassName?: string;
  offset?: number;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const selected = options.find((option) => option.value === value);

  useOutsideDismiss({
    selectors: [{
      selector: `[data-standard-select-menu="${menuId}"]`,
      onDismiss: () => setOpen(false),
      anchorRefs: [anchorRef],
    }],
  });

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className={`settings-select-anchor standard-select${className ? ` ${className}` : ''}`} ref={anchorRef}>
      <button
        type="button"
        className={`settings-select-trigger standard-select-trigger${triggerClassName ? ` ${triggerClassName}` : ''}${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected?.label ?? placeholder}</span>
        <ChevronDown size={15} className="settings-select-chevron" />
      </button>
      <PopoverPortal open={open && !disabled} anchorRef={anchorRef} placement="bottom-start" offset={offset} matchAnchorWidth>
        <div
          className={`settings-select-menu standard-select-menu${menuClassName ? ` ${menuClassName}` : ''}`}
          data-standard-select-menu={menuId}
          role="menu"
          aria-label={ariaLabel}
        >
          {options.map((option) => (
            <button
              key={option.value || '__empty__'}
              type="button"
              className={`settings-select-menu-item standard-select-option${optionClassName ? ` ${optionClassName}` : ''}${option.value === value ? ' current' : ''}`}
              role="menuitemradio"
              aria-checked={option.value === value}
              disabled={option.disabled}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check size={15} /> : null}
            </button>
          ))}
          {options.length === 0 ? <div className="standard-select-empty">{emptyLabel}</div> : null}
        </div>
      </PopoverPortal>
    </div>
  );
}
