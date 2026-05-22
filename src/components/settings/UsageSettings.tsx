import { BarChart3, Clock3, Coins, MessageSquareText, RefreshCw, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { fetchUsageStats } from '../../lib/settings-api';
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
type TrendRangeDays = 7 | 30 | 90;

export function UsageSettingsSection() {
  const [stats, setStats] = useState<UsageStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('tokens');
  const [trendRangeDays, setTrendRangeDays] = useState<TrendRangeDays>(30);

  async function loadUsage() {
    setLoading(true);
    setError('');
    try {
      setStats(await fetchUsageStats());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取使用情况失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsage();
  }, []);

  const totals = stats?.totals ?? emptyTotals;
  const maxProviderTokens = useMemo(
    () => Math.max(1, ...(stats?.byProvider ?? []).map((row) => row.totalTokens)),
    [stats],
  );
  const maxProjectTokens = useMemo(
    () => Math.max(1, ...(stats?.byProject ?? []).map((row) => row.totalTokens)),
    [stats],
  );
  const trendPoints = useMemo(
    () => buildTrendWindow(stats?.byDay ?? [], trendRangeDays),
    [stats, trendRangeDays],
  );
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
        <button type="button" className="settings-action-button" disabled={loading} onClick={() => void loadUsage()}>
          <RefreshCw size={14} />
          <span>{loading ? '刷新中' : '刷新'}</span>
        </button>
      </header>

      <div className="settings-usage-panel">
        <div className="settings-usage-summary">
          <UsageCard icon={MessageSquareText} label="会话" value={formatNumber(totals.threads)} hint={`${formatNumber(totals.messages)} 条消息`} />
          <UsageCard icon={BarChart3} label="Token" value={formatTokenValue(totals.totalTokens)} hint={formatTokenBreakdown(totals)} />
          <UsageCard icon={Wrench} label="工具调用" value={formatNumber(totals.toolCalls)} hint={`${formatNumber(totals.projects)} 个项目`} />
          <UsageCard icon={Clock3} label="耗时" value={formatDuration(totals.durationMs)} hint="按完成轮次累计" />
          <UsageCard icon={Coins} label="费用" value={formatCost(totals.totalCostUsd)} hint="来自 Claude usage" />
        </div>

        <UsageTrendCard
          metric={trendMetric}
          rangeDays={trendRangeDays}
          points={trendPoints}
          maxValue={trendMaxValue}
          totalValue={trendTotalValue}
          onMetricChange={setTrendMetric}
          onRangeChange={setTrendRangeDays}
        />

        {error ? <div className="settings-list-empty">{error}</div> : null}
        {loading && !stats ? <div className="settings-list-empty">正在读取使用情况</div> : null}

        <div className="settings-usage-grid">
          <UsageGroup title="按提供商 / 模型" emptyText="暂无提供商使用记录">
            {(stats?.byProvider ?? []).map((row) => (
              <ProviderUsageRow key={`${row.provider}:${row.model}`} row={row} maxTokens={maxProviderTokens} />
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
  rangeDays,
  points,
  maxValue,
  totalValue,
  onMetricChange,
  onRangeChange,
}: {
  metric: TrendMetric;
  rangeDays: TrendRangeDays;
  points: UsageTrendPoint[];
  maxValue: number;
  totalValue: number;
  onMetricChange: (metric: TrendMetric) => void;
  onRangeChange: (days: TrendRangeDays) => void;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const safeHoveredIndex = hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < points.length ? hoveredIndex : null;
  const activeIndex = safeHoveredIndex ?? findLatestTrendIndex(points);
  const activePoint = activeIndex >= 0 ? points[activeIndex] : null;

  return (
    <div className="settings-usage-trend">
      <div className="settings-usage-trend-head">
        <div className="settings-usage-trend-title">
          <strong>使用趋势</strong>
          <small>按天统计最近一段时间的使用变化</small>
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
          <div className="settings-segmented">
            {([7, 30, 90] as TrendRangeDays[]).map((value) => (
              <button
                key={value}
                type="button"
                className={rangeDays === value ? 'active' : ''}
                onClick={() => onRangeChange(value)}
              >
                {value}天
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-usage-trend-summary">
        <strong>{formatTrendMetric(metric, totalValue)}</strong>
        <small>最近 {rangeDays} 天累计</small>
      </div>

      {activePoint ? (
        <div className="settings-usage-trend-tooltip">
          <div className="settings-usage-trend-tooltip-head">
            <strong>{formatTrendTooltipDate(activePoint.date)}</strong>
            <span>{formatTrendMetric(metric, getTrendMetricValue(activePoint, metric))}</span>
          </div>
          <div className="settings-usage-trend-tooltip-grid">
            <span>Tokens：{formatTokenValue(activePoint.totalTokens)}</span>
            <span>费用：{formatCost(activePoint.totalCostUsd)}</span>
            <span>耗时：{formatDuration(activePoint.durationMs)}</span>
            <span>会话：{formatNumber(activePoint.threads)}</span>
          </div>
        </div>
      ) : null}

      <div className="settings-usage-chart" role="img" aria-label={`最近 ${rangeDays} 天${getTrendMetricLabel(metric)}趋势图`}>
        {points.map((point, index) => {
          const value = getTrendMetricValue(point, metric);
          const heightPercent = maxValue > 0 ? Math.max(0, Math.round((value / maxValue) * 100)) : 0;
          const labelVisible = shouldShowTrendLabel(index, points.length, rangeDays);
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
              <small>{labelVisible ? formatTrendAxisLabel(point.date, rangeDays) : ''}</small>
            </div>
          );
        })}
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
  return (
    <UsageBarRow
      title={row.provider}
      subtitle={row.model}
      row={row}
      maxTokens={maxTokens}
    />
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

function buildTrendWindow(points: UsageTrendPoint[], rangeDays: TrendRangeDays) {
  const pointMap = new Map(points.map((point) => [point.date, point]));
  const result: UsageTrendPoint[] = [];

  for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const key = toIsoDate(date);
    result.push(pointMap.get(key) ?? {
      date: key,
      ...emptyTotals,
    });
  }

  return result;
}

function shouldShowTrendLabel(index: number, total: number, rangeDays: TrendRangeDays) {
  if (index === 0 || index === total - 1) {
    return true;
  }
  if (rangeDays <= 7) {
    return true;
  }
  if (rangeDays <= 30) {
    return index % 5 === 0;
  }
  return index % 15 === 0;
}

function formatTrendAxisLabel(dateText: string, rangeDays: TrendRangeDays) {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateText;
  }

  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (rangeDays <= 7) {
    return `${month}/${day}`;
  }
  return `${month}/${day}`;
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTrendTooltipDate(dateText: string) {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateText;
  }

  return `${date.getMonth() + 1}月${date.getDate()}日`;
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
