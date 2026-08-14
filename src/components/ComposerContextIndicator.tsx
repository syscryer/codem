import { Activity, Minimize2 } from 'lucide-react';
import { useRef, useState, type CSSProperties } from 'react';

import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { PopoverPortal } from './PopoverPortal';
import type { ComposerContextUsage } from '../lib/composer-context-usage';
import type { CompactAvailability } from '../lib/codex-compact';
import type { ClaudeContextRequestState, ClaudeContextSnapshot } from '../types';

type ComposerContextIndicatorProps = {
  usage: ComposerContextUsage;
  nativeContext?: ClaudeContextSnapshot;
  nativeContextStatus?: ClaudeContextRequestState['status'];
  onRefreshClaudeContext?: () => void | Promise<void>;
  shouldRefreshClaudeContextOnOpen?: boolean;
  compactAvailability?: CompactAvailability;
  onCompactContext?: () => boolean | Promise<boolean>;
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
  compactAvailability,
  onCompactContext,
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

  const visibleSweep = usage.hasUsage ? Math.max(14, usage.percent * 3.6) : 0;
  const ringStyle: CSSProperties & Record<'--composer-context-color' | '--composer-context-fill', string> = {
    '--composer-context-color': levelColors[usage.level],
    '--composer-context-fill': usage.hasUsage ? `${levelColors[usage.level]}18` : 'transparent',
    background: `conic-gradient(${levelColors[usage.level]} ${visibleSweep}deg, var(--app-border, #e7e9ee) ${visibleSweep}deg 360deg)`,
  };
  const usageBreakdownRows = buildUsageBreakdownRows(usage);
  const runtimeStatRows = buildRuntimeStatRows(usage);
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
  const compactActionLabel = compactAvailability
    ? compactAvailability.available
      ? '压缩上下文'
      : compactAvailability.reason
    : undefined;

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
          {runtimeStatRows.length > 0 ? (
            <dl className="composer-context-card-breakdown" aria-label="运行统计">
              {runtimeStatRows.map((item) => (
                <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>
              ))}
            </dl>
          ) : null}
          {usage.compact.nearThreshold ? (
            <p className={`composer-context-card-status${usage.compact.reachedThreshold ? ' is-critical' : ' is-near'}`}>
              {usage.compact.reachedThreshold ? '已到自动压缩区间' : '接近自动压缩区间'}
            </p>
          ) : null}
          {compactAvailability && onCompactContext ? (
            <button
              type="button"
              className="composer-context-compact-action"
              disabled={!compactAvailability.available}
              title={compactActionLabel}
              aria-label={compactActionLabel}
              onClick={() => {
                setOpen(false);
                void onCompactContext();
              }}
            >
              <Minimize2 size={14} />
              <span>{compactAvailability.busy ? '正在压缩' : '压缩上下文'}</span>
            </button>
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
  const contextRows = [
    { key: 'systemTokens', label: '系统提示词', title: '当前上下文中的系统提示词用量' },
    { key: 'toolsTokens', label: '工具', title: '当前上下文中的工具定义用量' },
    { key: 'messageTokens', label: '对话消息', title: '当前上下文中的对话消息用量' },
  ] as const;
  const availableContextRows = contextRows.filter((item) => usage.breakdown.available[item.key]);
  if (availableContextRows.length > 0) {
    return availableContextRows.map((item) => ({
      label: item.label,
      value: formatTokenDetail(usage.breakdown[item.key]),
      title: item.title,
    }));
  }

  const tokenRows = [
    { key: 'inputTokens', label: '输入', title: '本轮发送给模型的非缓存输入' },
    { key: 'cacheReadInputTokens', label: '缓存读取', title: '本轮命中的缓存输入' },
    { key: 'cacheCreationInputTokens', label: '缓存写入', title: '本轮新写入缓存的输入' },
    { key: 'outputTokens', label: '输出', title: '本轮模型输出' },
  ] as const;
  return tokenRows
    .filter((item) => usage.breakdown.available[item.key])
    .map((item) => ({
      label: item.label,
      value: formatTokenDetail(usage.breakdown[item.key]),
      title: item.title,
    }));
}

function buildRuntimeStatRows(usage: ComposerContextUsage) {
  const rows: Array<{ label: string; value: string }> = [];
  if (usage.stats.available.turns) rows.push({ label: '回合', value: `${usage.stats.turns}` });
  if (usage.stats.available.steps) rows.push({ label: '步骤', value: `${usage.stats.steps}` });
  if (usage.stats.available.llmMs) rows.push({ label: '模型耗时', value: formatDuration(usage.stats.llmMs) });
  if (usage.stats.available.toolMs) rows.push({ label: '工具耗时', value: formatDuration(usage.stats.toolMs) });
  if (usage.stats.available.firstTokenMs) {
    rows.push({
      label: '首 token',
      value: usage.stats.available.firstTokenSteps
        ? formatAverageDuration(usage.stats.firstTokenMs, usage.stats.firstTokenSteps)
        : formatDuration(usage.stats.firstTokenMs),
    });
  }
  if (usage.stats.available.decodeMs && usage.stats.available.decodeTokens) {
    rows.push({ label: '生成速度', value: formatDecodeSpeed(usage.stats.decodeTokens, usage.stats.decodeMs) });
  }
  return rows;
}

function formatAverageDuration(totalMs: number, count: number) {
  return count > 0 ? formatDuration(Math.round(totalMs / count)) : '—';
}

function formatDecodeSpeed(tokens: number, durationMs: number) {
  return tokens > 0 && durationMs > 0 ? `${Math.round(tokens / (durationMs / 1000))} tok/s` : '—';
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
