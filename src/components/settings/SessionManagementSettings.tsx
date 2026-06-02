import {
  ExternalLink,
  MessageSquareText,
  Pencil,
  Power,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  buildSessionProjectSummaries,
  buildSessionManagementRows,
  buildSessionManagementUsageByProject,
  filterSessionManagementRows,
  getSelectableSessionIds,
  resolveSessionProjectSelection,
  summarizeSessionManagementUsage,
  shortSessionId,
  type SessionProjectId,
  type SessionProjectSummary,
  type SessionManagementRow,
} from '../../lib/session-management';
import { fetchUsageStats } from '../../lib/settings-api';
import type {
  ProjectSummary,
  ThreadRuntimeStatus,
  ThreadSummary,
  ToastState,
  UsageStatsResponse,
  UsageThreadRow,
  UsageTotals,
  WorkspaceBootstrap,
} from '../../types';

type SessionManagementSettingsSectionProps = {
  activeProjectId: string | null;
  activeThreadId: string | null;
  projects: ProjectSummary[];
  runningThreadIds: string[];
  onOpenThread: (projectId: string, threadId: string) => void | Promise<void>;
  onRemoveProject: (project: ProjectSummary) => void;
  onRenameThread: (thread: ThreadSummary) => void;
  onRemoveThread: (thread: ThreadSummary) => void;
  onSyncWorkspace: (workspace: WorkspaceBootstrap) => void;
  showToast: (message: string, tone?: ToastState['tone']) => void;
};

export function SessionManagementSettingsSection({
  activeProjectId,
  activeThreadId,
  projects,
  runningThreadIds,
  onOpenThread,
  onRemoveProject,
  onRenameThread,
  onRemoveThread,
  onSyncWorkspace,
  showToast,
}: SessionManagementSettingsSectionProps) {
  const [query, setQuery] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<SessionProjectId>(activeProjectId ?? 'all');
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [closingThreadId, setClosingThreadId] = useState('');
  const [runtimeStatuses, setRuntimeStatuses] = useState<Record<string, ThreadRuntimeStatus>>({});
  const [usageStats, setUsageStats] = useState<UsageStatsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const statuses = await fetchThreadRuntimeStatuses();
      if (!cancelled) {
        setRuntimeStatuses(statuses);
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshUsage() {
      try {
        const stats = await fetchUsageStats();
        if (!cancelled) {
          setUsageStats(stats);
        }
      } catch {
        if (!cancelled) {
          setUsageStats(null);
        }
      }
    }

    void refreshUsage();
    const timer = window.setInterval(() => void refreshUsage(), 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const rows = useMemo(
    () =>
      buildSessionManagementRows(projects, {
        activeProjectId,
        activeThreadId,
        runningThreadIds,
        runtimeStatuses,
      }),
    [activeProjectId, activeThreadId, projects, runningThreadIds, runtimeStatuses],
  );
  const projectSummaries = useMemo(() => buildSessionProjectSummaries(rows, projects), [projects, rows]);
  const effectiveSelectedProjectId = useMemo(
    () => resolveSessionProjectSelection(projectSummaries, selectedProjectId),
    [projectSummaries, selectedProjectId],
  );
  const filteredRows = useMemo(
    () => filterSessionManagementRows(rows, { query, projectId: effectiveSelectedProjectId }),
    [effectiveSelectedProjectId, query, rows],
  );
  const selectableThreadIds = useMemo(() => getSelectableSessionIds(filteredRows), [filteredRows]);
  const visibleSelectedCount = selectedThreadIds.filter((threadId) => selectableThreadIds.includes(threadId)).length;
  const allVisibleSelected = selectableThreadIds.length > 0 && visibleSelectedCount === selectableThreadIds.length;
  const selectedRows = rows.filter((row) => selectedThreadIds.includes(row.thread.id));
  const selectedRunningCount = selectedRows.filter((row) => row.running).length;
  const deletableThreadIds = selectedRows
    .filter((row) => !row.running)
    .map((row) => row.thread.id);
  const selectedProject = projectSummaries.find((project) => project.id === effectiveSelectedProjectId) ?? projectSummaries[0];
  const projectById = useMemo(() => {
    const byId = new Map<string, ProjectSummary>();
    projects.forEach((project) => byId.set(project.id, project));
    return byId;
  }, [projects]);
  const usageByThreadId = useMemo(() => {
    const byThreadId = new Map<string, UsageThreadRow>();
    usageStats?.byThread.forEach((row) => {
      if (row.threadId) {
        byThreadId.set(row.threadId, row);
      }
    });
    return byThreadId;
  }, [usageStats]);
  const usageByProjectId = useMemo(
    () => buildSessionManagementUsageByProject(rows, usageStats?.byThread ?? []),
    [rows, usageStats],
  );
  const selectedProjectUsage = useMemo(
    () => summarizeSessionManagementUsage(filteredRows, usageStats?.byThread ?? []),
    [filteredRows, usageStats],
  );

  function selectProject(projectId: SessionProjectId) {
    setSelectedProjectId(projectId);
    setSelectedThreadIds([]);
    setConfirmingDelete(false);
  }

  function toggleThreadSelection(threadId: string, checked: boolean) {
    setConfirmingDelete(false);
    setSelectedThreadIds((current) => {
      if (checked) {
        return current.includes(threadId) ? current : [...current, threadId];
      }

      return current.filter((id) => id !== threadId);
    });
  }

  function toggleAllVisible(checked: boolean) {
    setConfirmingDelete(false);
    setSelectedThreadIds((current) => {
      const rest = current.filter((threadId) => !selectableThreadIds.includes(threadId));
      return checked ? [...rest, ...selectableThreadIds] : rest;
    });
  }

  async function deleteSelectedSessions() {
    if (deletableThreadIds.length === 0 || deleting) {
      return;
    }

    if (!confirmingDelete) {
      setConfirmingDelete(true);
      showToast(`再次点击“删除所选”将删除 ${deletableThreadIds.length} 个会话。`, 'info');
      return;
    }

    setDeleting(true);
    try {
      for (const threadId of deletableThreadIds) {
        const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}`, {
          method: 'DELETE',
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
      }

      const workspaceResponse = await fetch('/api/workspace/bootstrap');
      if (!workspaceResponse.ok) {
        throw new Error(await workspaceResponse.text());
      }

      onSyncWorkspace((await workspaceResponse.json()) as WorkspaceBootstrap);
      setSelectedThreadIds([]);
      setConfirmingDelete(false);
      showToast(`已删除 ${deletableThreadIds.length} 个会话。`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '批量删除会话失败', 'error');
    } finally {
      setDeleting(false);
    }
  }

  async function closeRuntime(row: SessionManagementRow) {
    if (row.running || closingThreadId) {
      return;
    }

    setClosingThreadId(row.thread.id);
    try {
      const response = await fetch(`/api/claude/runtime/${encodeURIComponent(row.thread.id)}/close`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const result = (await response.json()) as { closed?: boolean };
      showToast(result.closed ? '会话连接已重置' : '当前没有可重置的会话连接', result.closed ? 'success' : 'info');
      setRuntimeStatuses(await fetchThreadRuntimeStatuses());
    } catch (error) {
      showToast(error instanceof Error ? error.message : '重置会话连接失败', 'error');
    } finally {
      setClosingThreadId('');
    }
  }

  const selectedDeleteLabel = confirmingDelete ? '确认删除所选' : '删除所选';
  const selectedDeleteHint = selectedRunningCount > 0
    ? `已跳过 ${selectedRunningCount} 个运行中的会话`
    : `${deletableThreadIds.length} 个可删除`;

  return (
    <section className="settings-page-section settings-page-wide">
      <header className="settings-section-head settings-section-head-row">
        <h1>会话管理</h1>
      </header>

      <div className="settings-panel settings-editor-panel session-suite-panel">
        <div className="settings-editor-head session-head">
          <div className="settings-editor-title">
            <MessageSquareText size={15} />
            <span>
              <strong>聊天会话</strong>
              <small>{rows.length} 个会话，{rows.filter((row) => row.running).length} 个正在运行</small>
            </span>
          </div>
          <label className="settings-search session-search" aria-label="搜索会话">
            <Search size={14} />
            <input
              value={query}
              placeholder="搜索标题、路径或 session"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
        </div>

        <div className="session-management-grid">
          <aside className="session-project-list" aria-label="项目列表">
            {projectSummaries.map((project) => (
              <ProjectNavItem
                key={project.id}
                project={project}
                active={effectiveSelectedProjectId === project.id}
                usage={usageByProjectId.get(project.id)}
                onSelect={() => selectProject(project.id)}
                onRemove={project.id !== 'all' && projectById.has(project.id)
                  ? () => onRemoveProject(projectById.get(project.id) as ProjectSummary)
                  : undefined}
              />
            ))}
          </aside>

          <div className="session-detail-panel">
            <div className="session-detail-toolbar">
              <div className="session-detail-title">
                <strong>{selectedProject?.name ?? '全部项目'}</strong>
                <span>
                  {filteredRows.length} 个会话 · {formatCompactTokenCount(selectedProjectUsage.totalTokens)} tokens · 运行耗时 {formatDurationCompact(selectedProjectUsage.durationMs)} · {formatUsageCost(selectedProjectUsage.totalCostUsd)}
                </span>
              </div>
              <div className="session-bulk-actions">
                <label className="session-select-all">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    disabled={selectableThreadIds.length === 0}
                    onChange={(event) => toggleAllVisible(event.currentTarget.checked)}
                  />
                  <span>全选</span>
                </label>
                <button
                  type="button"
                  className="settings-action-button danger"
                  disabled={deletableThreadIds.length === 0 || deleting}
                  onClick={() => void deleteSelectedSessions()}
                >
                  <Trash2 size={14} />
                  <span>{deleting ? '删除中' : selectedDeleteLabel}</span>
                </button>
                {selectedThreadIds.length > 0 ? <small>{selectedDeleteHint}</small> : null}
              </div>
            </div>

            <div className="settings-list session-list">
              {filteredRows.length === 0 ? (
                <div className="settings-list-empty">没有匹配的会话。</div>
              ) : null}
              {filteredRows.map((row) => (
                <SessionRow
                  key={row.thread.id}
                  row={row}
                  selected={selectedThreadIds.includes(row.thread.id)}
                  closing={closingThreadId === row.thread.id}
                  onSelect={(checked) => toggleThreadSelection(row.thread.id, checked)}
                  onOpen={() => void onOpenThread(row.project.id, row.thread.id)}
                  onRename={() => onRenameThread(row.thread)}
                  onRemove={() => onRemoveThread(row.thread)}
                  onCloseRuntime={row.runtimeAlive ? () => void closeRuntime(row) : undefined}
                  usage={usageByThreadId.get(row.thread.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SessionRow({
  row,
  selected,
  closing,
  onSelect,
  onOpen,
  onRename,
  onRemove,
  onCloseRuntime,
  usage,
}: {
  row: SessionManagementRow;
  selected: boolean;
  closing: boolean;
  onSelect: (checked: boolean) => void;
  onOpen: () => void;
  onRename: () => void;
  onRemove: () => void;
  onCloseRuntime?: () => void;
  usage?: UsageThreadRow;
}) {
  const hasUsage = Boolean(usage && (usage.totalTokens > 0 || usage.totalCostUsd > 0 || usage.messages > 0));
  const usageModel = formatModel(usage?.model || row.thread.model);

  return (
    <div className="settings-list-row settings-list-row-tall session-list-row">
      <label className="session-row-check" aria-label={`选择 ${row.thread.title}`}>
        <input
          type="checkbox"
          checked={selected}
          disabled={row.running}
          onChange={(event) => onSelect(event.currentTarget.checked)}
        />
      </label>
      <div className="session-row-main">
        <div className="session-row-title">
          <strong>{row.thread.title}</strong>
          {row.active ? <span className="settings-badge available">当前</span> : null}
          {row.running ? <span className="settings-badge available">运行中</span> : null}
          {!row.hasSession ? <span className="settings-badge error">无 Session</span> : null}
        </div>
        <small className="session-row-path" title={row.thread.workingDirectory}>
          {row.project.name} · {row.thread.workingDirectory}
        </small>
        <div className="session-row-meta">
          <span title={row.thread.sessionId}>Session: <code>{shortSessionId(row.thread.sessionId)}</code></span>
          <span>模型: {formatModel(row.thread.model)}</span>
          <span>权限: {formatPermission(row.thread.permissionMode)}</span>
          <span>{row.thread.updatedLabel}</span>
        </div>
      </div>
      <div className={`session-row-usage${hasUsage ? ' has-value' : ' is-empty'}`} title={buildUsageTooltip(usage)}>
        <strong>{hasUsage ? formatUsageCost(usage?.totalCostUsd ?? 0) : '--'}</strong>
        <small>
          {hasUsage ? (
            <>
              <span title={usageModel}>{usageModel}</span>
              <span>{formatCompactTokenCount(usage?.totalTokens ?? 0)} tokens</span>
              <span>运行耗时 {formatDurationCompact(usage?.durationMs ?? 0)}</span>
            </>
          ) : '暂无使用量'}
        </small>
      </div>
      <div className="settings-list-actions session-list-actions">
        <button
          type="button"
          className="settings-icon-button"
          onClick={onOpen}
          title="打开会话"
          aria-label="打开会话"
        >
          <ExternalLink size={14} />
        </button>
        <button
          type="button"
          className="settings-icon-button"
          onClick={onRename}
          title="重命名会话"
          aria-label="重命名会话"
        >
          <Pencil size={14} />
        </button>
        {onCloseRuntime ? (
          <button
            type="button"
            className="settings-icon-button"
            onClick={onCloseRuntime}
            disabled={row.running || closing}
            title={row.running ? '运行中的会话请先停止当前任务' : closing ? '正在重置连接' : `重置连接 · PID ${row.runtimePid ?? '未知'}`}
            aria-label="重置连接"
          >
            <Power size={14} />
          </button>
        ) : null}
        <button
          type="button"
          className="settings-icon-button danger"
          onClick={onRemove}
          disabled={row.running}
          title={row.running ? '运行中的会话无法删除' : '删除会话'}
          aria-label="删除会话"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function ProjectNavItem({
  project,
  active,
  usage,
  onSelect,
  onRemove,
}: {
  project: SessionProjectSummary;
  active: boolean;
  usage?: UsageTotals;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  const removeDisabled = project.running > 0;

  return (
    <div className={`session-project-item${active ? ' active' : ''}`}>
      <button
        type="button"
        className="session-project-open"
        onClick={onSelect}
      >
        <span className="session-project-card">
          <span>
            <strong>{project.name}</strong>
            {project.path ? <small>{project.path}</small> : <small>所有项目中的会话</small>}
          </span>
          <em>{project.total}</em>
          <span className="session-project-usage">
            {formatCompactTokenCount(usage?.totalTokens ?? 0)} tokens · 运行耗时 {formatDurationCompact(usage?.durationMs ?? 0)}
          </span>
          {project.running > 0 || project.missingSession > 0 ? (
            <span className="session-project-flags">
              {project.running > 0 ? <span className="session-project-flag running">{project.running} 运行中</span> : null}
              {project.missingSession > 0 ? <span className="session-project-flag warning">{project.missingSession} 未开始</span> : null}
            </span>
          ) : null}
        </span>
      </button>
      {onRemove ? (
        <button
          type="button"
          className="settings-icon-button danger session-project-delete"
          disabled={removeDisabled}
          onClick={onRemove}
          title={removeDisabled ? '运行中的项目请先停止当前任务' : '删除项目'}
          aria-label={`删除项目 ${project.name}`}
        >
          <Trash2 size={14} />
        </button>
      ) : null}
    </div>
  );
}

function formatModel(value: string | undefined) {
  return value?.trim() || '默认';
}

function formatPermission(value: string | undefined) {
  const labels: Record<string, string> = {
    default: '默认',
    plan: '计划模式',
    acceptEdits: '接受编辑',
    auto: '自动执行',
    dontAsk: '无需确认',
    bypassPermissions: '完全访问',
  };

  const trimmed = value?.trim();
  return trimmed ? labels[trimmed] ?? trimmed : '默认';
}

function buildUsageTooltip(usage?: UsageThreadRow) {
  if (!usage || (usage.totalTokens <= 0 && usage.totalCostUsd <= 0 && usage.messages <= 0)) {
    return '暂无使用量';
  }

  return [
    `模型：${formatModel(usage.model)}`,
    `输入：${formatTokenCount(usage.inputTokens)} tokens`,
    `输出：${formatTokenCount(usage.outputTokens)} tokens`,
    `缓存写入：${formatTokenCount(usage.cacheCreationInputTokens)} tokens`,
    `缓存读取：${formatTokenCount(usage.cacheReadInputTokens)} tokens`,
    `总计：${formatTokenCount(usage.totalTokens)} tokens`,
    `运行耗时：${formatDurationVerbose(usage.durationMs)}`,
    `费用：${formatUsageCost(usage.totalCostUsd)}`,
  ].join('\n');
}

function formatCompactTokenCount(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (safeValue >= 1_000_000) {
    return `${trimTrailingZero((safeValue / 1_000_000).toFixed(1))}M`;
  }
  if (safeValue >= 1_000) {
    return `${trimTrailingZero((safeValue / 1_000).toFixed(1))}K`;
  }
  return `${Math.round(safeValue)}`;
}

function formatTokenCount(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return Math.round(safeValue).toLocaleString('zh-CN');
}

function formatUsageCost(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (safeValue === 0) {
    return '$0';
  }
  if (safeValue < 0.01) {
    return `$${trimTrailingZero(safeValue.toFixed(4))}`;
  }
  return `$${trimTrailingZero(safeValue.toFixed(2))}`;
}

function trimTrailingZero(value: string) {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatDurationCompact(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (safeValue < 1000) {
    return '<1s';
  }

  const totalSeconds = Math.round(safeValue / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatDurationVerbose(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (safeValue < 1000) {
    return '小于 1 秒';
  }

  const totalSeconds = Math.round(safeValue / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours} 小时`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} 分钟`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds} 秒`);
  }

  return parts.join(' ');
}

async function fetchThreadRuntimeStatuses() {
  try {
    const response = await fetch('/api/claude/runtimes');
    if (!response.ok) {
      return {};
    }

    return (await response.json()) as Record<string, ThreadRuntimeStatus>;
  } catch {
    return {};
  }
}
