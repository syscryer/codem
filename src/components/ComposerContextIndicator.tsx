import { Activity, Clock3, CloudUpload, FileText, RefreshCw, Send, Sparkles } from 'lucide-react';
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
        aria-label={`上下文用量 ${percentLabel}`}
        title={`上下文用量 ${percentLabel}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="composer-context-ring" style={ringStyle}>
          <span className="composer-context-ring-core" />
        </span>
      </button>

      <PopoverPortal open={open} anchorRef={triggerRef} placement="top-end" offset={10}>
        <section className="composer-context-card" aria-label="上下文用量">
          <header className="composer-context-card-head">
            <strong>
              <Activity size={14} />
              上下文用量
            </strong>
            <span>{percentLabel}</span>
          </header>
          <div className="composer-context-card-summary">
            <span className="composer-context-card-summary-used">{formatCompactTokens(usage.usedTokens)}</span>
            <span className="composer-context-card-summary-divider">/</span>
            <span className="composer-context-card-summary-total">{formatCompactTokens(usage.totalTokens)}</span>
          </div>
          {usage.hasUsage ? null : <p className="composer-context-card-empty">当前线程还没有上下文数据</p>}
          <div
            className={`composer-context-card-compact${
              usage.compact.reachedThreshold ? ' is-critical' : usage.compact.nearThreshold ? ' is-near' : ''
            }`}
          >
            <div className="composer-context-card-compact-head">
              <strong>
                <Sparkles size={13} />
                自动压缩
              </strong>
              <span>
                {usage.compact.reachedThreshold ? '可压缩' : usage.compact.nearThreshold ? '接近阈值' : '状态健康'}
              </span>
            </div>
            <dl className="composer-context-card-compact-grid">
              <div>
                <dt>
                  <Activity size={12} />
                  阈值
                </dt>
                <dd>{formatTokenNumber(usage.compact.thresholdTokens)}</dd>
              </div>
              <div>
                <dt>
                  <Clock3 size={12} />
                  剩余
                </dt>
                <dd>{formatTokenNumber(usage.compact.remainingTokens)}</dd>
              </div>
            </dl>
          </div>
          <dl className="composer-context-card-breakdown">
            <div>
              <dt>
                <FileText size={13} />
                输入
              </dt>
              <dd>{formatTokenNumber(usage.breakdown.inputTokens)}</dd>
            </div>
            <div>
              <dt>
                <CloudUpload size={13} />
                缓存写入
              </dt>
              <dd>{formatTokenNumber(usage.breakdown.cacheCreationInputTokens)}</dd>
            </div>
            <div>
              <dt>
                <RefreshCw size={13} />
                缓存读取
              </dt>
              <dd>{formatTokenNumber(usage.breakdown.cacheReadInputTokens)}</dd>
            </div>
            <div>
              <dt>
                <Send size={13} />
                输出
              </dt>
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
