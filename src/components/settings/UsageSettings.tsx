import { BarChart3, Clock3, Coins, MessageSquareText, RefreshCw, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { fetchUsageStats } from '../../lib/settings-api';
import { buildUsageTrendBuckets, type UsageTrendBucketUnit, type UsageTrendRange } from '../../lib/usage-trend';
import type { UsageProjectRow, UsageProviderRow, UsageStatsResponse, UsageTotals, UsageTrendPoint } from '../../types';

const emptyTotals: UsageTotals = {
  projects: 0,
  threads: 0,
  messages: 0,
  toolCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  totalTokens: 0,
  durationMs: 0,
  totalCostUsd: 0,
};

type TrendMetric = 'tokens' | 'cost' | 'duration';
type UsageSummaryRange = UsageTrendRange;

export function UsageSettingsSection() {
  const [stats, setStats] = useState<UsageStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summaryRange, setSummaryRange] = useState<UsageSummaryRange>(30);
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('tokens');

  async function loadUsage(range: UsageSummaryRange) {
    setLoading(true);
    setError('');
    try {
      setStats(await fetchUsageStats(range));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取使用情况失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsage(summaryRange);
  }, [summaryRange]);

  const totals = stats?.totals ?? emptyTotals;
  const maxProviderTokens = useMemo(
    () => Math.max(1, ...(stats?.byProvider ?? []).map((row) => row.totalTokens)),
    [stats],
  );
  const maxProjectTokens = useMemo(
    () => Math.max(1, ...(stats?.byProject ?? []).map((row) => row.totalTokens)),
    [stats],
  );
  const trendBuckets = useMemo(
    () => buildUsageTrendBuckets(stats?.byDay ?? [], summaryRange),
    [stats, summaryRange],
  );
  const trendPoints = trendBuckets.points;
  const trendMaxValue = useMemo(
    () => Math.max(1, ...trendPoints.map((point) => getTrendMetricValue(point, trendMetric))),
    [trendMetric, trendPoints],
  );
  const trendTotalValue = useMemo(
    () => trendPoints.reduce((total, point) => total + getTrendMetricValue(point, trendMetric), 0),
    [trendMetric, trendPoints],
  );

  return (
    <section className="settings-page-section">
      <header className="settings-section-head settings-section-head-row">
        <h1>使用情况</h1>
        <div className="settings-usage-head-actions">
          <div className="settings-usage-range-control" aria-label="统计范围">
            <span>统计范围</span>
            <div className="settings-segmented">
              {([7, 30, 90, 'all'] as UsageSummaryRange[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={summaryRange === value ? 'active' : ''}
                  onClick={() => setSummaryRange(value)}
                >
                  {value === 'all' ? '全部' : `${value}天`}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="settings-action-button settings-usage-refresh-button" disabled={loading} onClick={() => void loadUsage(summaryRange)}>
            <RefreshCw className={loading ? 'spin' : undefined} size={14} />
            <span>刷新</span>
          </button>
        </div>
      </header>

      <div className="settings-usage-panel">
        <div className="settings-usage-scope">当前统计范围：{formatUsageSummaryRange(summaryRange)}</div>
        <div className="settings-usage-summary">
          <UsageCard icon={MessageSquareText} label="会话" value={formatNumber(totals.threads)} hint={`${formatNumber(totals.messages)} 条消息`} />
          <UsageCard icon={BarChart3} label="Token" value={formatTokenValue(totals.totalTokens)} hint={formatTokenBreakdown(totals)} />
          <UsageCard icon={Wrench} label="工具调用" value={formatNumber(totals.toolCalls)} hint={`${formatNumber(totals.projects)} 个项目`} />
          <UsageCard icon={Clock3} label="耗时" value={formatDuration(totals.durationMs)} hint={`${formatUsageSummaryRange(summaryRange)}内按完成轮次累计`} />
          <UsageCard icon={Coins} label="费用" value={formatCost(totals.totalCostUsd)} hint={`来自 Claude usage · ${formatUsageSummaryRange(summaryRange)}`} />
        </div>

        <UsageTrendCard
          metric={trendMetric}
          range={summaryRange}
          bucketUnit={trendBuckets.unit}
          points={trendPoints}
          maxValue={trendMaxValue}
          totalValue={trendTotalValue}
          onMetricChange={setTrendMetric}
        />

        {error ? <div className="settings-list-empty">{error}</div> : null}
        {loading && !stats ? <div className="settings-list-empty">正在读取使用情况</div> : null}

        <div className="settings-usage-grid">
          <UsageGroup title="按提供商 / 模型" emptyText="暂无提供商使用记录">
            {(stats?.byProvider ?? []).map((row) => (
              <ProviderUsageRow key={`${row.providerKey}:${row.host ?? row.provider}`} row={row} maxTokens={maxProviderTokens} />
            ))}
          </UsageGroup>

          <UsageGroup title="按项目" emptyText="暂无项目使用记录">
            {(stats?.byProject ?? []).map((row) => (
              <ProjectUsageRow key={row.projectId} row={row} maxTokens={maxProjectTokens} />
            ))}
          </UsageGroup>
        </div>
      </div>
    </section>
  );
}

function UsageTrendCard({
  metric,
  range,
  bucketUnit,
  points,
  maxValue,
  totalValue,
  onMetricChange,
}: {
  metric: TrendMetric;
  range: UsageSummaryRange;
  bucketUnit: UsageTrendBucketUnit;
  points: UsageTrendPoint[];
  maxValue: number;
  totalValue: number;
  onMetricChange: (metric: TrendMetric) => void;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const safeHoveredIndex = hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < points.length ? hoveredIndex : null;
  const activeIndex = safeHoveredIndex ?? findLatestTrendIndex(points);
  const activePoint = activeIndex >= 0 ? points[activeIndex] : null;
  const yAxisTicks = useMemo(() => buildYAxisTicks(maxValue), [maxValue]);
  const tooltipLeft = points.length > 1 && activeIndex >= 0 ? (activeIndex / (points.length - 1)) * 100 : 50;

  return (
    <div className="settings-usage-trend">
      <div className="settings-usage-trend-head">
        <div className="settings-usage-trend-title">
          <strong>使用趋势</strong>
          <small>随统计范围自动切换日、周或月粒度</small>
        </div>
        <div className="settings-usage-trend-controls">
          <div className="settings-segmented">
            {([
              ['tokens', 'Tokens'],
              ['cost', '费用'],
              ['duration', '耗时'],
            ] as Array<[TrendMetric, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={metric === value ? 'active' : ''}
                onClick={() => onMetricChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-usage-trend-summary">
        <strong>{formatTrendMetric(metric, totalValue)}</strong>
        <small>{formatUsageTrendScope(range, bucketUnit)}</small>
      </div>

      <div className="settings-usage-chart-shell">
        <div className="settings-usage-y-axis" aria-hidden="true">
          {yAxisTicks.map((tick) => (
            <span key={tick}>{formatTrendAxisValue(metric, tick)}</span>
          ))}
        </div>
        <div className="settings-usage-chart-area">
          {activePoint ? (
            <div
              className="settings-usage-floating-tooltip"
              style={{ left: `clamp(116px, ${tooltipLeft}%, calc(100% - 116px))` }}
            >
              <div className="settings-usage-floating-tooltip-head">
                <strong>{formatTrendTooltipDate(activePoint.date, bucketUnit)}</strong>
                <span>{formatTrendMetric(metric, getTrendMetricValue(activePoint, metric))}</span>
              </div>
              <div className="settings-usage-floating-tooltip-grid">
                <span>Tokens</span>
                <strong>{formatTokenValue(activePoint.totalTokens)}</strong>
                <span>费用</span>
                <strong>{formatCost(activePoint.totalCostUsd)}</strong>
                <span>耗时</span>
                <strong>{formatDuration(activePoint.durationMs)}</strong>
                <span>会话</span>
                <strong>{formatNumber(activePoint.threads)}</strong>
              </div>
            </div>
          ) : null}
          <div className="settings-usage-grid-lines" aria-hidden="true">
            {yAxisTicks.map((tick) => (
              <span key={tick} />
            ))}
          </div>
          <div className="settings-usage-chart" role="img" aria-label={`${formatUsageTrendScope(range, bucketUnit)}${getTrendMetricLabel(metric)}趋势图`}>
            {points.map((point, index) => {
              const value = getTrendMetricValue(point, metric);
              const heightPercent = maxValue > 0 ? Math.max(0, Math.round((value / maxValue) * 100)) : 0;
              const labelVisible = shouldShowTrendLabel(index, points.length, range, bucketUnit);
              return (
                <div
                  key={point.date}
                  className={`settings-usage-chart-column${activeIndex === index ? ' active' : ''}`}
                  tabIndex={0}
                  onClick={() => setHoveredIndex(index)}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseMove={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onFocus={() => setHoveredIndex(index)}
                  onBlur={() => setHoveredIndex(null)}
                >
                  <div className="settings-usage-chart-bar-wrap">
                    <span
                      className="settings-usage-chart-bar"
                      style={{ height: `${Math.max(value > 0 ? 2 : 0, heightPercent)}%` }}
                    />
                  </div>
                  <small>{labelVisible ? formatTrendAxisLabel(point.date, range, bucketUnit) : ''}</small>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function UsageCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof BarChart3;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="settings-usage-card">
      <Icon size={16} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function UsageGroup({ title, emptyText, children }: { title: string; emptyText: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <div className="settings-usage-group">
      <h2>{title}</h2>
      <div className="settings-usage-list">
        {items.length > 0 ? items : <div className="settings-list-empty">{emptyText}</div>}
      </div>
    </div>
  );
}

function ProviderUsageRow({ row, maxTokens }: { row: UsageProviderRow; maxTokens: number }) {
  const maxModelTokens = Math.max(1, ...row.models.map((model) => model.totalTokens));
  const providerSubtitle = [row.host, row.inferred ? '推断' : '记录'].filter(Boolean).join(' · ');

  return (
    <div className="settings-usage-row settings-usage-provider-row">
      <div className="settings-usage-row-head">
        <div>
          <strong>{row.provider}</strong>
          <small>{providerSubtitle || row.providerKey}</small>
        </div>
        <span>{formatTokenValue(row.totalTokens)} tokens</span>
      </div>
      <div className="settings-usage-track" aria-hidden="true">
        <span style={{ width: `${Math.max(4, Math.round((row.totalTokens / maxTokens) * 100))}%` }} />
      </div>
      <div className="settings-usage-row-meta">
        <span>{formatNumber(row.threads)} 会话</span>
        <span>{formatNumber(row.toolCalls)} 工具</span>
        <span>{formatDuration(row.durationMs)}</span>
        <span>{formatCost(row.totalCostUsd)}</span>
      </div>
      <div className="settings-usage-model-list">
        {row.models.map((model) => (
          <div className="settings-usage-model-row" key={model.model}>
            <div>
              <span>{model.model}</span>
              <strong>{formatTokenValue(model.totalTokens)}</strong>
            </div>
            <div className="settings-usage-track" aria-hidden="true">
              <span style={{ width: `${Math.max(4, Math.round((model.totalTokens / maxModelTokens) * 100))}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectUsageRow({ row, maxTokens }: { row: UsageProjectRow; maxTokens: number }) {
  return (
    <UsageBarRow
      title={row.projectName}
      subtitle={row.projectPath}
      row={row}
      maxTokens={maxTokens}
    />
  );
}

function UsageBarRow({
  title,
  subtitle,
  row,
  maxTokens,
}: {
  title: string;
  subtitle: string;
  row: UsageTotals;
  maxTokens: number;
}) {
  return (
    <div className="settings-usage-row">
      <div className="settings-usage-row-head">
        <div>
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </div>
        <span>{formatTokenValue(row.totalTokens)} tokens</span>
      </div>
      <div className="settings-usage-track" aria-hidden="true">
        <span style={{ width: `${Math.max(4, Math.round((row.totalTokens / maxTokens) * 100))}%` }} />
      </div>
      <div className="settings-usage-row-meta">
        <span>{formatNumber(row.threads)} 会话</span>
        <span>{formatNumber(row.toolCalls)} 工具</span>
        <span>{formatDuration(row.durationMs)}</span>
        <span>{formatCost(row.totalCostUsd)}</span>
      </div>
    </div>
  );
}

function formatTokenBreakdown(totals: UsageTotals) {
  return `输入 ${formatTokenValue(totals.inputTokens)} / 输出 ${formatTokenValue(totals.outputTokens)}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(Math.round(value));
}

function formatTokenValue(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (safeValue >= 1_000_000_000) {
    return `${trimTrailingZero((safeValue / 1_000_000_000).toFixed(1))}B`;
  }
  if (safeValue >= 1_000_000) {
    return `${trimTrailingZero((safeValue / 1_000_000).toFixed(1))}M`;
  }
  if (safeValue >= 1_000) {
    return `${trimTrailingZero((safeValue / 1_000).toFixed(1))}K`;
  }
  return `${Math.round(safeValue)}`;
}

function formatDuration(durationMs: number) {
  const safeValue = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  if (safeValue < 1000) {
    return safeValue > 0 ? '<1s' : '0s';
  }

  const seconds = Math.round(safeValue / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  if (hours < 24) {
    return `${hours}h ${remainMinutes}m`;
  }

  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  if (remainHours === 0) {
    return `${days}d`;
  }

  return `${days}d ${remainHours}h`;
}

function formatCost(value: number) {
  return value > 0 ? `$${value.toFixed(4)}` : '$0';
}

function trimTrailingZero(value: string) {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function getTrendMetricLabel(metric: TrendMetric) {
  switch (metric) {
    case 'cost':
      return '费用';
    case 'duration':
      return '耗时';
    default:
      return 'Tokens';
  }
}

function getTrendMetricValue(point: UsageTrendPoint, metric: TrendMetric) {
  switch (metric) {
    case 'cost':
      return point.totalCostUsd;
    case 'duration':
      return point.durationMs;
    default:
      return point.totalTokens;
  }
}

function formatTrendMetric(metric: TrendMetric, value: number) {
  switch (metric) {
    case 'cost':
      return formatCost(value);
    case 'duration':
      return formatDuration(value);
    default:
      return `${formatTokenValue(value)} tokens`;
  }
}

function formatTrendAxisValue(metric: TrendMetric, value: number) {
  switch (metric) {
    case 'cost':
      return formatCost(value);
    case 'duration':
      return formatDuration(value);
    default:
      return formatTokenValue(value);
  }
}

function buildYAxisTicks(maxValue: number) {
  const safeMax = Number.isFinite(maxValue) ? Math.max(0, maxValue) : 0;
  if (safeMax <= 0) {
    return [0];
  }

  return [safeMax, safeMax / 2, 0];
}

function shouldShowTrendLabel(index: number, total: number, range: UsageSummaryRange, bucketUnit: UsageTrendBucketUnit) {
  if (index === 0 || index === total - 1) {
    return true;
  }

  if (range !== 'all' && range <= 7) {
    return true;
  }

  if (bucketUnit === 'month') {
    return true;
  }

  if (bucketUnit === 'week') {
    return index % Math.max(1, Math.ceil(total / 6)) === 0;
  }

  if (range === 'all' || range <= 30) {
    return index % 5 === 0;
  }

  return index % 15 === 0;
}

function formatTrendAxisLabel(dateText: string, range: UsageSummaryRange, bucketUnit: UsageTrendBucketUnit) {
  const date = parseUsageDate(dateText);
  if (!date) {
    return dateText;
  }

  if (bucketUnit === 'month') {
    return `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}`;
  }

  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  if (range === 'all' && bucketUnit === 'week') {
    return `${month}/${day}`;
  }

  return `${month}/${day}`;
}

function formatTrendTooltipDate(dateText: string, bucketUnit: UsageTrendBucketUnit) {
  const date = parseUsageDate(dateText);
  if (!date) {
    return dateText;
  }

  if (bucketUnit === 'month') {
    return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月`;
  }

  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  if (bucketUnit === 'week') {
    const end = addDays(date, 6);
    return `${month}月${day}日 - ${end.getUTCMonth() + 1}月${end.getUTCDate()}日`;
  }

  return `${month}月${day}日`;
}

function parseUsageDate(dateText: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match) {
    return null;
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatUsageSummaryRange(range: UsageSummaryRange) {
  return range === 'all' ? '全部历史' : `最近 ${range} 天`;
}

function formatUsageTrendScope(range: UsageSummaryRange, bucketUnit: UsageTrendBucketUnit) {
  const bucketLabel = bucketUnit === 'month' ? '按月聚合' : bucketUnit === 'week' ? '按周聚合' : '按日统计';
  return `${formatUsageSummaryRange(range)}累计 · ${bucketLabel}`;
}

function findLatestTrendIndex(points: UsageTrendPoint[]) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point.totalTokens > 0 || point.totalCostUsd > 0 || point.durationMs > 0 || point.threads > 0) {
      return index;
    }
  }

  return points.length - 1;
}
