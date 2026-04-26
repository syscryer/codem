import type { ReactNode } from 'react';
import { Minus, Monitor, Plus } from 'lucide-react';

type SettingsRowProps = {
  icon: typeof Monitor;
  title: string;
  description: string;
  children: ReactNode;
};

export function SettingsRow({ icon: Icon, title, description, children }: SettingsRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <Icon size={15} />
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
  icon?: typeof Monitor;
};

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<SegmentedControlOption<T>>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="settings-segmented">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            className={option.value === value ? 'active' : ''}
            onClick={() => onChange(option.value)}
          >
            {Icon ? <Icon size={13} /> : null}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Stepper<T extends number>({
  value,
  values,
  onChange,
}: {
  value: T;
  values: readonly T[];
  onChange: (value: T) => void;
}) {
  const currentIndex = values.indexOf(value);
  const canDecrease = currentIndex > 0;
  const canIncrease = currentIndex >= 0 && currentIndex < values.length - 1;

  return (
    <div className="settings-stepper">
      <button
        type="button"
        disabled={!canDecrease}
        onClick={() => canDecrease && onChange(values[currentIndex - 1])}
        aria-label="减小"
      >
        <Minus size={12} />
      </button>
      <span>{value}</span>
      <button
        type="button"
        disabled={!canIncrease}
        onClick={() => canIncrease && onChange(values[currentIndex + 1])}
        aria-label="增大"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}
