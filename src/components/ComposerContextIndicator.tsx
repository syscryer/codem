import { useRef, useState, type CSSProperties } from 'react';

import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { PopoverPortal } from './PopoverPortal';
import type { ComposerContextUsage } from '../lib/composer-context-usage';

type ComposerContextIndicatorProps = {
  usage: ComposerContextUsage;
};

const levelColors: Record<ComposerContextUsage['level'], string> = {
  empty: '#c4c7cf',
  low: '#16a34a',
  medium: '#d4a017',
  high: '#ea580c',
  critical: '#dc2626',
};

export function ComposerContextIndicator({ usage }: ComposerContextIndicatorProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useOutsideDismiss({
    selectors: open
      ? [
          {
            selector: '.composer-context-card',
            onDismiss: () => setOpen(false),
            anchorRefs: [triggerRef],
          },
        ]
      : [],
  });

  if (!usage.visible) {
    return null;
  }

  const percentLabel = `${usage.percent.toFixed(usage.percent % 1 === 0 ? 0 : 1)}%`;
  const ringStyle = {
    background: `conic-gradient(${levelColors[usage.level]} ${usage.percent * 3.6}deg, #e7e9ee ${usage.percent * 3.6}deg 360deg)`,
  } satisfies CSSProperties;

  return (
    <div className="composer-context-indicator">
      <button
        ref={triggerRef}
        type="button"
        className={`composer-context-trigger${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-label={`Context Usage ${percentLabel}`}
        title={`Context Usage ${percentLabel}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="composer-context-ring" style={ringStyle}>
          <span className="composer-context-ring-core" />
        </span>
      </button>

      <PopoverPortal open={open} anchorRef={triggerRef} placement="top-end" offset={10}>
        <section className="composer-context-card" aria-label="Context Usage">
          <header className="composer-context-card-head">
            <strong>Context Usage</strong>
            <span>{percentLabel}</span>
          </header>
          <div className="composer-context-card-summary">
            <span>{formatCompactTokens(usage.usedTokens)}</span>
            <span>/</span>
            <span>{formatCompactTokens(usage.totalTokens)}</span>
          </div>
          {usage.hasUsage ? null : <p className="composer-context-card-empty">当前线程还没有上下文数据</p>}
          <div
            className={`composer-context-card-compact${
              usage.compact.reachedThreshold ? ' is-critical' : usage.compact.nearThreshold ? ' is-near' : ''
            }`}
          >
            <div className="composer-context-card-compact-head">
              <strong>Auto-compact</strong>
              <span>
                {usage.compact.reachedThreshold ? 'Ready to compact' : usage.compact.nearThreshold ? 'Near compact' : 'Healthy'}
              </span>
            </div>
            <dl className="composer-context-card-compact-grid">
              <div>
                <dt>Threshold</dt>
                <dd>{formatTokenNumber(usage.compact.thresholdTokens)}</dd>
              </div>
              <div>
                <dt>Remaining</dt>
                <dd>{formatTokenNumber(usage.compact.remainingTokens)}</dd>
              </div>
            </dl>
          </div>
          <dl className="composer-context-card-breakdown">
            <div>
              <dt>Input</dt>
              <dd>{formatTokenNumber(usage.breakdown.inputTokens)}</dd>
            </div>
            <div>
              <dt>Cache Write</dt>
              <dd>{formatTokenNumber(usage.breakdown.cacheCreationInputTokens)}</dd>
            </div>
            <div>
              <dt>Cache Read</dt>
              <dd>{formatTokenNumber(usage.breakdown.cacheReadInputTokens)}</dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd>{formatTokenNumber(usage.breakdown.outputTokens)}</dd>
            </div>
          </dl>
        </section>
      </PopoverPortal>
    </div>
  );
}

function formatCompactTokens(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  }
  return `${value}`;
}

function formatTokenNumber(value: number) {
  return value.toLocaleString();
}
