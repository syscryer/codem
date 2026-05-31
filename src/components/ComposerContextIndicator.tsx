import { Activity } from 'lucide-react';
import { useRef, useState, type CSSProperties } from 'react';

import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { PopoverPortal } from './PopoverPortal';
import type { ComposerContextUsage } from '../lib/composer-context-usage';
import type { ClaudeContextRequestState, ClaudeContextSnapshot } from '../types';

type ComposerContextIndicatorProps = {
  usage: ComposerContextUsage;
  nativeContext?: ClaudeContextSnapshot;
  nativeContextStatus?: ClaudeContextRequestState['status'];
  onRefreshClaudeContext?: () => void | Promise<void>;
  shouldRefreshClaudeContextOnOpen?: boolean;
};

const levelColors: Record<ComposerContextUsage['level'], string> = {
  empty: '#c4c7cf',
  low: '#16a34a',
  medium: '#d4a017',
  high: '#ea580c',
  critical: '#dc2626',
};

export function ComposerContextIndicator({
  usage,
  nativeContext,
  nativeContextStatus = 'idle',
  onRefreshClaudeContext,
  shouldRefreshClaudeContextOnOpen = false,
}: ComposerContextIndicatorProps) {
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
  const nativeSummary = nativeContext?.summary;
  function handleTriggerClick() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && shouldRefreshClaudeContextOnOpen && nativeContextStatus !== 'loading') {
      void onRefreshClaudeContext?.();
    }
  }

  const ringStyle = {
    background: `conic-gradient(${levelColors[usage.level]} ${usage.percent * 3.6}deg, #e7e9ee ${usage.percent * 3.6}deg 360deg)`,
  } satisfies CSSProperties;
  const usageBreakdownRows = buildUsageBreakdownRows(usage);
  const nativeMetaItems = nativeSummary
    ? [
        {
          label: '模型',
          value: nativeSummary.model ?? '未知',
        },
        ...(typeof nativeSummary.freeTokens === 'number'
          ? [
              {
                label: '剩余',
                value: formatCompactTokens(nativeSummary.freeTokens),
              },
            ]
          : []),
        ...(nativeSummary.mcpToolCount > 0
          ? [
              {
                label: '工具',
                value: `${nativeSummary.mcpToolCount}`,
              },
            ]
          : []),
        ...(nativeSummary.memoryFileCount > 0
          ? [
              {
                label: '记忆',
                value: `${nativeSummary.memoryFileCount}`,
              },
            ]
          : []),
        ...(nativeSummary.skillCount > 0
          ? [
              {
                label: '技能',
                value: `${nativeSummary.skillCount}`,
              },
            ]
          : []),
      ]
    : [];
  const showNativeSection = Boolean(nativeSummary) || nativeContextStatus === 'loading';

  return (
    <div className="composer-context-indicator">
      <button
        ref={triggerRef}
        type="button"
        className={`composer-context-trigger${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-label={`上下文用量 ${percentLabel}`}
        title={`上下文用量 ${percentLabel}`}
        onClick={handleTriggerClick}
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
          <div className="composer-context-meter" aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(100, usage.percent))}%`, backgroundColor: levelColors[usage.level] }} />
          </div>
          {usageBreakdownRows.length > 0 ? (
            <dl className="composer-context-card-breakdown" aria-label="用量明细">
              {usageBreakdownRows.map((item) => (
                <div key={item.label} title={item.title}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {usage.compact.nearThreshold ? (
            <p className={`composer-context-card-status${usage.compact.reachedThreshold ? ' is-critical' : ' is-near'}`}>
              {usage.compact.reachedThreshold ? '已到自动压缩区间' : '接近自动压缩区间'}
            </p>
          ) : null}
          {showNativeSection ? (
            <section className="composer-context-native" aria-label="当前会话详情">
              <div className="composer-context-native-head">
                <strong>会话详情</strong>
                {nativeContext && nativeContext.durationMs > 0 ? <span>{formatDuration(nativeContext.durationMs)}</span> : null}
              </div>
              {nativeSummary ? (
                <dl className="composer-context-native-grid">
                  {nativeMetaItems.map((item) => (
                    <div key={item.label}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : nativeContextStatus === 'loading' ? (
                <p className="composer-context-native-empty">正在读取当前会话的上下文...</p>
              ) : null}
            </section>
          ) : null}
        </section>
      </PopoverPortal>
    </div>
  );
}

function formatCompactTokens(value: number) {
  if (value >= 1_000_000) {
    return `${formatCompactDecimal(value / 1_000_000)}m`;
  }
  if (value >= 1_000) {
    return `${formatCompactDecimal(value / 1_000)}k`;
  }
  return `${value}`;
}

function formatCompactDecimal(value: number) {
  const formatted = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted;
}

function buildUsageBreakdownRows(usage: ComposerContextUsage) {
  const hasRuntimeUsage =
    usage.breakdown.inputTokens > 0 ||
    usage.breakdown.outputTokens > 0 ||
    usage.breakdown.cacheReadInputTokens > 0 ||
    usage.breakdown.cacheCreationInputTokens > 0;
  if (!hasRuntimeUsage) {
    return [];
  }

  return [
    {
      label: '输入',
      value: formatTokenDetail(usage.breakdown.inputTokens),
      title: '本轮发送给模型的非缓存输入',
    },
    {
      label: '缓存读取',
      value: formatTokenDetail(usage.breakdown.cacheReadInputTokens),
      title: '本轮命中的缓存输入',
    },
    {
      label: '缓存写入',
      value: formatTokenDetail(usage.breakdown.cacheCreationInputTokens),
      title: '本轮新写入缓存的输入',
    },
    {
      label: '输出',
      value: formatTokenDetail(usage.breakdown.outputTokens),
      title: '本轮模型输出',
    },
  ];
}

function formatTokenDetail(value: number) {
  return `${Math.max(0, value).toLocaleString('en-US')} tokens`;
}

function formatDuration(value: number) {
  if (value < 1000) {
    return `${value}ms`;
  }

  return `${(value / 1000).toFixed(1)}s`;
}
