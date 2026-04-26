import { BarChart3, Clock3, Coins, MessageSquareText, RefreshCw, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { fetchUsageStats } from '../../lib/settings-api';
import type { UsageProjectRow, UsageProviderRow, UsageStatsResponse, UsageTotals } from '../../types';

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

export function UsageSettingsSection() {
  const [stats, setStats] = useState<UsageStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
          <UsageCard icon={BarChart3} label="Token" value={formatNumber(totals.totalTokens)} hint={formatTokenBreakdown(totals)} />
          <UsageCard icon={Wrench} label="工具调用" value={formatNumber(totals.toolCalls)} hint={`${formatNumber(totals.projects)} 个项目`} />
          <UsageCard icon={Clock3} label="耗时" value={formatDuration(totals.durationMs)} hint="按完成轮次累计" />
          <UsageCard icon={Coins} label="费用" value={formatCost(totals.totalCostUsd)} hint="来自 Claude usage" />
        </div>

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
        <span>{formatNumber(row.totalTokens)} tokens</span>
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
  return `输入 ${formatNumber(totals.inputTokens)} / 输出 ${formatNumber(totals.outputTokens)}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(Math.round(value));
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function formatCost(value: number) {
  return value > 0 ? `$${value.toFixed(4)}` : '$0';
}
