import {
  CalendarClock,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CLAUDE_CODE_PROVIDER_ID,
  DEFAULT_MODEL_VALUE,
  GROK_BUILD_PROVIDER_ID,
  OPENAI_CODEX_PROVIDER_ID,
  OPENCODE_PROVIDER_ID,
  permissionMenuModes,
} from '../constants';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { fetchAgentModelCatalog } from '../lib/agent-provider-registry';
import { SYSTEM_AGENT_CHANNEL_ID } from '../lib/agent-channel-selection';
import {
  defaultAutomationSchedule,
  formatAutomationNextRun,
  formatAutomationSchedule,
} from '../lib/automation-schedule';
import { permissionLabel } from '../lib/ui-labels';
import type {
  AgentChannel,
  AgentModelOption,
  AgentProviderDescriptor,
  AutomationDefinition,
  AutomationRun,
  AutomationSaveInput,
  AutomationSchedule,
  ClaudeModelOption,
  PermissionMode,
  ProjectSummary,
} from '../types';
import { AgentProviderIcon } from './AgentProviderIcon';
import { PopoverPortal } from './PopoverPortal';

type AutomationCenterProps = {
  automations: AutomationDefinition[];
  runs: AutomationRun[];
  projects: ProjectSummary[];
  providers: AgentProviderDescriptor[];
  channels: AgentChannel[];
  claudeModels: ClaudeModelOption[];
  defaultProviderId: string;
  defaultPermissionMode: PermissionMode;
  loading: boolean;
  error: string;
  savingId: string | null;
  deletingId: string | null;
  startingId: string | null;
  onRefresh: () => void | Promise<unknown>;
  onSave: (input: AutomationSaveInput, automationId?: string) => Promise<AutomationDefinition | null>;
  onDelete: (automationId: string) => Promise<boolean>;
  onRunNow: (automationId: string) => void | Promise<unknown>;
  onOpenThread: (projectId: string, threadId: string) => void;
};

type AutomationFormDraft = {
  name: string;
  prompt: string;
  projectId: string;
  providerId: string;
  channelId: string;
  model: string;
  reasoningEffort: string;
  permissionMode: PermissionMode;
  schedule: AutomationSchedule;
  enabled: boolean;
};

type SelectOption = {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
};

const PROVIDER_FALLBACKS = [
  { id: CLAUDE_CODE_PROVIDER_ID, displayName: 'Claude Code' },
  { id: OPENAI_CODEX_PROVIDER_ID, displayName: 'OpenAI Codex' },
  { id: GROK_BUILD_PROVIDER_ID, displayName: 'Grok Build' },
  { id: OPENCODE_PROVIDER_ID, displayName: 'OpenCode' },
] as const;

const SCHEDULE_OPTIONS: Array<{ value: AutomationSchedule['kind']; label: string }> = [
  { value: 'interval', label: '间隔' },
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '工作日' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
];

const WEEKDAYS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' },
];

const FALLBACK_REASONING_OPTIONS: SelectOption[] = [
  { value: '', label: '跟随模型默认' },
  { value: 'low', label: 'Low', description: '更快完成简单任务' },
  { value: 'medium', label: 'Medium', description: '平衡速度和推理' },
  { value: 'high', label: 'High', description: '适合复杂任务' },
  { value: 'xhigh', label: 'XHigh', description: '进行更深入的推理' },
  { value: 'max', label: 'Max', description: '当前会话最高努力级别' },
  { value: 'ultracode', label: 'Ultracode', description: '更深入的自动化工作流' },
];

export function AutomationCenter({
  automations,
  runs,
  projects,
  providers,
  channels,
  claudeModels = [],
  defaultProviderId,
  defaultPermissionMode,
  loading,
  error,
  savingId,
  deletingId,
  startingId,
  onRefresh,
  onSave,
  onDelete,
  onRunNow,
  onOpenThread,
}: AutomationCenterProps) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState<AutomationFormDraft>(() => createEmptyDraft(
    projects,
    defaultProviderId,
    defaultPermissionMode,
  ));
  const [modelOptions, setModelOptions] = useState<AgentModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [intervalUnit, setIntervalUnit] = useState<'minutes' | 'hours'>('hours');

  const providerOptions = useMemo<SelectOption[]>(() => {
    const registryProviders = providers
      .filter((provider) => provider.selectable)
      .map((provider) => ({
        value: provider.id,
        label: provider.displayName,
        description: provider.available === false ? '当前未安装' : undefined,
        icon: <AgentProviderIcon providerId={provider.id} size={17} />,
      }));
    if (registryProviders.length > 0) {
      return registryProviders;
    }
    return PROVIDER_FALLBACKS.map((provider) => ({
      value: provider.id,
      label: provider.displayName,
      icon: <AgentProviderIcon providerId={provider.id} size={17} />,
    }));
  }, [providers]);

  const filteredAutomations = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      return automations;
    }
    return automations.filter((automation) => (
      automation.name.toLocaleLowerCase().includes(normalized)
      || automation.prompt.toLocaleLowerCase().includes(normalized)
    ));
  }, [automations, query]);

  const selectedAutomation = selectedId
    ? automations.find((automation) => automation.id === selectedId) ?? null
    : null;
  const selectedRuns = useMemo(
    () => selectedId ? runs.filter((run) => run.automationId === selectedId) : [],
    [runs, selectedId],
  );
  const selectedChannel = draft.channelId === SYSTEM_AGENT_CHANNEL_ID
    ? null
    : channels.find((channel) => channel.id === draft.channelId) ?? null;
  const channelOptions = useMemo<SelectOption[]>(() => [
    {
      value: SYSTEM_AGENT_CHANNEL_ID,
      label: '跟随 Agent 默认配置',
      description: '使用 Agent 当前生效的系统或 CC Switch 配置',
    },
    ...channels
      .filter((channel) => channel.enabled && channel.providerId === draft.providerId)
      .map((channel) => ({
        value: channel.id,
        label: channel.name,
        description: 'CodeM 渠道',
      })),
  ], [channels, draft.providerId]);

  const availableModelOptions = selectedChannel
    ? selectedChannel.models
        .filter((model) => model.enabled)
        .map<SelectOption>((model) => ({ value: model.modelId, label: model.displayName || model.modelId }))
    : modelOptions.map<SelectOption>((model) => ({
        value: model.id,
        label: model.label || model.id,
        description: model.description,
      }));
  const modelSelectOptions: SelectOption[] = [
    { value: DEFAULT_MODEL_VALUE, label: '跟随渠道默认模型' },
    ...availableModelOptions,
  ];
  const selectedModel = modelOptions.find((model) => model.id === draft.model);
  const reasoningOptions = selectedModel?.supportedReasoningEfforts.length
    ? [
        { value: '', label: '跟随模型默认' },
        ...selectedModel.supportedReasoningEfforts.map((effort) => ({
          value: effort.id,
          label: formatReasoningLabel(effort.id),
          description: effort.description,
        })),
      ]
    : FALLBACK_REASONING_OPTIONS;

  useEffect(() => {
    if (selectedId !== undefined || loading) {
      return;
    }
    const first = automations[0];
    if (first) {
      setSelectedId(first.id);
      setDraft(draftFromAutomation(first));
      setIntervalUnit(intervalUnitFor(first.schedule));
    } else {
      setSelectedId(null);
      setDraft(createEmptyDraft(projects, defaultProviderId, defaultPermissionMode));
    }
  }, [automations, defaultPermissionMode, defaultProviderId, loading, projects, selectedId]);

  useEffect(() => {
    if (selectedId && !automations.some((automation) => automation.id === selectedId)) {
      const next = automations[0];
      setSelectedId(next?.id ?? null);
      setDraft(next
        ? draftFromAutomation(next)
        : createEmptyDraft(projects, defaultProviderId, defaultPermissionMode));
    }
  }, [automations, defaultPermissionMode, defaultProviderId, projects, selectedId]);

  useEffect(() => {
    if (!draft.projectId && projects[0]) {
      setDraft((current) => current.projectId ? current : { ...current, projectId: projects[0].id });
    }
  }, [draft.projectId, projects]);

  useEffect(() => {
    if (draft.channelId !== SYSTEM_AGENT_CHANNEL_ID) {
      setModelsLoading(false);
      setModelsError('');
      setModelOptions([]);
      return;
    }
    if (draft.providerId === CLAUDE_CODE_PROVIDER_ID) {
      setModelOptions(claudeModels.map((model) => ({
        id: model.id,
        label: model.label,
        description: model.description,
        contextWindowTokens: model.contextWindowTokens,
        isDefault: model.kind === 'default',
        supportedReasoningEfforts: FALLBACK_REASONING_OPTIONS
          .filter((option) => option.value)
          .map((option) => ({ id: option.value, description: option.description })),
      })));
      setModelsLoading(false);
      setModelsError('');
      return;
    }
    const controller = new AbortController();
    setModelsLoading(true);
    setModelsError('');
    void fetchAgentModelCatalog(draft.providerId, { signal: controller.signal })
      .then((catalog) => setModelOptions(catalog.models))
      .catch((requestError) => {
        if (!(requestError instanceof DOMException && requestError.name === 'AbortError')) {
          setModelsError(requestError instanceof Error ? requestError.message : '读取模型列表失败');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setModelsLoading(false);
        }
      });
    return () => controller.abort();
  }, [claudeModels, draft.channelId, draft.providerId]);

  function selectAutomation(automation: AutomationDefinition) {
    setSelectedId(automation.id);
    setDraft(draftFromAutomation(automation));
    setIntervalUnit(intervalUnitFor(automation.schedule));
  }

  function createNewAutomation() {
    setSelectedId(null);
    setDraft(createEmptyDraft(projects, defaultProviderId, defaultPermissionMode));
    setIntervalUnit('hours');
  }

  function updateDraft(patch: Partial<AutomationFormDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateSchedule(schedule: AutomationSchedule) {
    setDraft((current) => ({ ...current, schedule }));
  }

  function changeScheduleKind(kind: AutomationSchedule['kind']) {
    const timezone = draft.schedule.timezone;
    if (kind === 'interval') {
      updateSchedule({ kind, intervalMinutes: 60, timezone });
      setIntervalUnit('hours');
      return;
    }
    if (kind === 'weekly') {
      updateSchedule({ kind, time: '09:00', weekdays: [1], timezone });
      return;
    }
    if (kind === 'monthly') {
      updateSchedule({ kind, time: '09:00', monthDay: 1, timezone });
      return;
    }
    updateSchedule({ kind, time: '09:00', timezone });
  }

  async function saveDraft() {
    const saved = await onSave({
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),
      projectId: draft.projectId,
      providerId: draft.providerId as AutomationSaveInput['providerId'],
      channelId: draft.channelId || SYSTEM_AGENT_CHANNEL_ID,
      model: draft.model === DEFAULT_MODEL_VALUE ? undefined : draft.model,
      reasoningEffort: draft.reasoningEffort || undefined,
      permissionMode: draft.permissionMode,
      schedule: draft.schedule,
      nextRunAtMs: undefined,
      enabled: draft.enabled,
      executionEnvironment: 'local',
    }, selectedAutomation?.id);
    if (saved) {
      setSelectedId(saved.id);
      setDraft(draftFromAutomation(saved));
    }
  }

  async function deleteSelected() {
    if (!selectedAutomation) {
      return;
    }
    if (!window.confirm(`确定删除自动化“${selectedAutomation.name}”吗？运行会话仍会保留。`)) {
      return;
    }
    await onDelete(selectedAutomation.id);
  }

  const selectedNextRun = selectedAutomation?.nextRunAtMs;
  const formValid = Boolean(draft.name.trim() && draft.prompt.trim() && draft.projectId && draft.providerId);
  const saveBusy = savingId === (selectedAutomation?.id ?? '__new__');

  return (
    <main className="automation-center">
      <header className="automation-header">
        <div>
          <h1>自动化</h1>
          <p>按计划在后台创建 Agent 任务，运行结果会保留为普通会话。</p>
        </div>
        <div className="automation-header-actions">
          <button type="button" className="automation-icon-button" aria-label="刷新自动化" onClick={() => void onRefresh()}>
            <RefreshCw size={16} />
          </button>
          <button type="button" className="automation-primary-button" onClick={createNewAutomation}>
            <Plus size={16} />
            新建自动化
          </button>
          <button
            type="button"
            className="automation-primary-button"
            disabled={!formValid || saveBusy}
            onClick={() => void saveDraft()}
          >
            {saveBusy ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
            保存配置
          </button>
        </div>
      </header>

      <div className="automation-layout">
        <aside className="automation-list-pane">
          <label className="automation-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="搜索自动化"
              aria-label="搜索自动化"
            />
          </label>
          <div className="automation-list">
            {loading ? (
              <div className="automation-list-empty"><LoaderCircle className="spin" size={17} /> 正在读取...</div>
            ) : filteredAutomations.length === 0 ? (
              <div className="automation-list-empty">
                <Clock3 size={19} />
                <span>{query ? '没有匹配的自动化' : '还没有自动化'}</span>
              </div>
            ) : filteredAutomations.map((automation) => {
              const latestRun = runs.find((run) => run.automationId === automation.id);
              return (
                <button
                  key={automation.id}
                  type="button"
                  className={`automation-list-item${automation.id === selectedId ? ' active' : ''}`}
                  onClick={() => selectAutomation(automation)}
                >
                  <span className="automation-list-icon">
                    <AgentProviderIcon providerId={automation.providerId} size={18} />
                  </span>
                  <span className="automation-list-copy">
                    <strong>{automation.name}</strong>
                    <small>{formatAutomationSchedule(automation.schedule)}</small>
                  </span>
                  <span className={`automation-state-dot${automation.enabled ? ' enabled' : ''}`} aria-label={automation.enabled ? '已启用' : '已停用'} />
                  {latestRun && isActiveRun(latestRun) ? (
                    <span className="automation-running-badge">运行中</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="automation-editor">
          <div className="automation-editor-scroll">
            <div className="automation-editor-title-row">
              <div>
                <span>{selectedAutomation ? '编辑自动化' : '新建自动化'}</span>
                <h2>{draft.name.trim() || '未命名自动化'}</h2>
              </div>
              <label className="automation-enabled-toggle">
                <span>{draft.enabled ? '已启用' : '已停用'}</span>
                <span className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(event) => updateDraft({ enabled: event.currentTarget.checked })}
                  />
                  <span aria-hidden="true" />
                </span>
              </label>
            </div>

            {error ? <div className="automation-notice error">{error}</div> : null}

            <div className="automation-form-section">
              <div className="automation-section-heading">
                <h3>任务内容</h3>
                <p>每次触发都会创建一个新的后台 Agent 会话。</p>
              </div>
              <label className="automation-field">
                <span>名称</span>
                <input
                  className="automation-input"
                  value={draft.name}
                  maxLength={120}
                  onChange={(event) => updateDraft({ name: event.currentTarget.value })}
                  placeholder="例如：每天检查依赖更新"
                />
              </label>
              <label className="automation-field">
                <span>提示词</span>
                <textarea
                  className="automation-textarea"
                  value={draft.prompt}
                  onChange={(event) => updateDraft({ prompt: event.currentTarget.value })}
                  placeholder="清楚描述 Agent 每次需要完成的任务、边界和输出要求"
                  rows={7}
                />
              </label>
            </div>

            <div className="automation-form-section">
              <div className="automation-section-heading">
                <h3>运行环境</h3>
                <p>首版在所选项目当前目录运行，不会自动创建 worktree。</p>
              </div>
              <div className="automation-field-grid">
                <AutomationDropdown
                  label="项目"
                  value={draft.projectId}
                  options={projects.map((project) => ({
                    value: project.id,
                    label: project.name,
                    description: project.path,
                  }))}
                  placeholder="选择项目"
                  onChange={(projectId) => updateDraft({ projectId })}
                />
                <AutomationDropdown
                  label="Agent"
                  value={draft.providerId}
                  options={providerOptions}
                  onChange={(providerId) => updateDraft({
                    providerId,
                    channelId: SYSTEM_AGENT_CHANNEL_ID,
                    model: DEFAULT_MODEL_VALUE,
                    reasoningEffort: '',
                  })}
                />
                <AutomationDropdown
                  label="渠道"
                  value={draft.channelId}
                  options={channelOptions}
                  onChange={(channelId) => updateDraft({
                    channelId,
                    model: DEFAULT_MODEL_VALUE,
                    reasoningEffort: '',
                  })}
                />
                <AutomationDropdown
                  label="模型"
                  value={draft.model}
                  options={modelSelectOptions}
                  loading={modelsLoading}
                  hint={modelsError}
                  onChange={(model) => updateDraft({ model, reasoningEffort: '' })}
                />
                <AutomationDropdown
                  label="思考"
                  value={draft.reasoningEffort}
                  options={reasoningOptions}
                  onChange={(reasoningEffort) => updateDraft({ reasoningEffort })}
                />
                <AutomationDropdown
                  label="权限"
                  value={draft.permissionMode}
                  options={permissionMenuModes.map((mode) => ({ value: mode, label: permissionLabel(mode) }))}
                  onChange={(permissionMode) => updateDraft({ permissionMode: permissionMode as PermissionMode })}
                />
              </div>
            </div>

            <div className="automation-form-section">
              <div className="automation-section-heading automation-schedule-heading">
                <div>
                  <h3>执行计划</h3>
                  <p>{draft.enabled ? `保存后下次运行：${selectedNextRun ? formatAutomationNextRun(selectedNextRun) : '自动计算'}` : '停用期间不会自动执行，仍可立即运行。'}</p>
                </div>
                <CalendarClock size={19} />
              </div>
              <div className="automation-schedule-tabs" role="tablist" aria-label="执行频率">
                {SCHEDULE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={draft.schedule.kind === option.value ? 'active' : ''}
                    onClick={() => changeScheduleKind(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <ScheduleEditor
                schedule={draft.schedule}
                intervalUnit={intervalUnit}
                onIntervalUnitChange={setIntervalUnit}
                onChange={updateSchedule}
              />
              <small className="automation-timezone">按本机时区 {draft.schedule.timezone} 运行；应用退出期间不会唤醒执行。</small>
            </div>

            {selectedAutomation ? (
              <div className="automation-form-section automation-history-section">
                <div className="automation-section-heading">
                  <h3>最近运行</h3>
                  <p>运行内容保存在对应会话中，可随时打开查看。</p>
                </div>
                <div className="automation-run-list">
                  {selectedRuns.length === 0 ? (
                    <div className="automation-run-empty">还没有运行记录</div>
                  ) : selectedRuns.slice(0, 20).map((run) => (
                    <div key={run.id} className="automation-run-row">
                      <span className={`automation-run-status ${run.status}`}>
                        {isActiveRun(run) ? <LoaderCircle className="spin" size={14} /> : run.status === 'stopped' ? <Pause size={14} /> : <span />}
                        {runStatusLabel(run.status)}
                      </span>
                      <span className="automation-run-time">{formatRunTime(run.createdAt)}</span>
                      {run.error ? <span className="automation-run-error" title={run.error}>{run.error}</span> : <span className="automation-run-spacer" />}
                      {run.threadId ? (
                        <button
                          type="button"
                          className="automation-link-button"
                          onClick={() => onOpenThread(selectedAutomation.projectId, run.threadId!)}
                        >
                          打开会话 <ExternalLink size={13} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {selectedAutomation ? (
            <footer className="automation-editor-footer">
              <div>
                <button
                  type="button"
                  className="automation-danger-button"
                  disabled={deletingId === selectedAutomation.id}
                  onClick={() => void deleteSelected()}
                >
                  {deletingId === selectedAutomation.id ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
                  删除
                </button>
              </div>
              <div className="automation-footer-actions">
                <button
                  type="button"
                  className="automation-secondary-button"
                  disabled={startingId === selectedAutomation.id}
                  onClick={() => void onRunNow(selectedAutomation.id)}
                >
                  {startingId === selectedAutomation.id ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}
                  立即运行
                </button>
              </div>
            </footer>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function AutomationDropdown({
  label,
  value,
  options,
  placeholder = '请选择',
  loading = false,
  hint = '',
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  placeholder?: string;
  loading?: boolean;
  hint?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  useOutsideDismiss({
    selectors: [
      { selector: '.automation-select-menu', onDismiss: () => setOpen(false), anchorRefs: [anchorRef] },
    ],
  });

  return (
    <div className="automation-field automation-dropdown-field">
      <span>{label}</span>
      <div className="settings-select-anchor" ref={anchorRef}>
        <button
          type="button"
          className={`settings-select-trigger automation-select-trigger${open ? ' open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="automation-select-value">
            {selected?.icon}
            <span>{loading ? '正在读取...' : selected?.label ?? placeholder}</span>
          </span>
          {loading ? <LoaderCircle className="spin" size={14} /> : <ChevronDown size={15} className="settings-select-chevron" />}
        </button>
        <PopoverPortal open={open} anchorRef={anchorRef} placement="bottom-start" offset={7} matchAnchorWidth>
          <div className="settings-select-menu automation-select-menu" role="menu" aria-label={label}>
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`settings-select-menu-item automation-select-option${option.value === value ? ' current' : ''}`}
                role="menuitemradio"
                aria-checked={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="automation-select-option-copy">
                  {option.icon}
                  <span>
                    <strong>{option.label}</strong>
                    {option.description ? <small>{option.description}</small> : null}
                  </span>
                </span>
                {option.value === value ? <Check size={15} /> : null}
              </button>
            ))}
            {options.length === 0 ? <div className="automation-select-empty">暂无可用选项</div> : null}
          </div>
        </PopoverPortal>
      </div>
      {hint ? <small className="automation-field-hint error">{hint}</small> : null}
    </div>
  );
}

function ScheduleEditor({
  schedule,
  intervalUnit,
  onIntervalUnitChange,
  onChange,
}: {
  schedule: AutomationSchedule;
  intervalUnit: 'minutes' | 'hours';
  onIntervalUnitChange: (unit: 'minutes' | 'hours') => void;
  onChange: (schedule: AutomationSchedule) => void;
}) {
  if (schedule.kind === 'interval') {
    const value = intervalUnit === 'hours'
      ? Math.max(1, Math.round(schedule.intervalMinutes / 60))
      : schedule.intervalMinutes;
    return (
      <div className="automation-schedule-row">
        <label className="automation-inline-field">
          <span>每隔</span>
          <input
            type="number"
            min={intervalUnit === 'hours' ? 1 : 15}
            max={intervalUnit === 'hours' ? 168 : 10080}
            value={value}
            onChange={(event) => {
              const nextValue = Math.max(1, Number(event.currentTarget.value) || 1);
              onChange({
                ...schedule,
                intervalMinutes: intervalUnit === 'hours' ? nextValue * 60 : Math.max(15, nextValue),
              });
            }}
          />
        </label>
        <div className="automation-unit-switch" role="group" aria-label="间隔单位">
          <button
            type="button"
            className={intervalUnit === 'minutes' ? 'active' : ''}
            onClick={() => onIntervalUnitChange('minutes')}
          >分钟</button>
          <button
            type="button"
            className={intervalUnit === 'hours' ? 'active' : ''}
            onClick={() => onIntervalUnitChange('hours')}
          >小时</button>
        </div>
      </div>
    );
  }

  if (schedule.kind === 'weekly') {
    return (
      <div className="automation-schedule-stack">
        <div className="automation-weekday-picker" role="group" aria-label="选择星期">
          {WEEKDAYS.map((weekday) => {
            const active = schedule.weekdays.includes(weekday.value);
            return (
              <button
                key={weekday.value}
                type="button"
                className={active ? 'active' : ''}
                onClick={() => {
                  const weekdays = active
                    ? schedule.weekdays.filter((value) => value !== weekday.value)
                    : [...schedule.weekdays, weekday.value];
                  onChange({ ...schedule, weekdays: weekdays.length ? weekdays : [weekday.value] });
                }}
              >{weekday.label}</button>
            );
          })}
        </div>
        <TimeField value={schedule.time} onChange={(time) => onChange({ ...schedule, time })} />
      </div>
    );
  }

  if (schedule.kind === 'monthly') {
    return (
      <div className="automation-schedule-row">
        <label className="automation-inline-field">
          <span>每月</span>
          <input
            type="number"
            min={1}
            max={31}
            value={schedule.monthDay}
            onChange={(event) => onChange({
              ...schedule,
              monthDay: Math.min(31, Math.max(1, Number(event.currentTarget.value) || 1)),
            })}
          />
          <span>日</span>
        </label>
        <TimeField value={schedule.time} onChange={(time) => onChange({ ...schedule, time })} />
      </div>
    );
  }

  return <TimeField value={schedule.time} onChange={(time) => onChange({ ...schedule, time })} />;
}

function TimeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="automation-inline-field">
      <span>执行时间</span>
      <input type="time" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}

function createEmptyDraft(
  projects: ProjectSummary[],
  defaultProviderId: string,
  defaultPermissionMode: PermissionMode,
): AutomationFormDraft {
  return {
    name: '',
    prompt: '',
    projectId: projects[0]?.id ?? '',
    providerId: defaultProviderId || CLAUDE_CODE_PROVIDER_ID,
    channelId: SYSTEM_AGENT_CHANNEL_ID,
    model: DEFAULT_MODEL_VALUE,
    reasoningEffort: '',
    permissionMode: defaultPermissionMode,
    schedule: defaultAutomationSchedule(),
    enabled: true,
  };
}

function draftFromAutomation(automation: AutomationDefinition): AutomationFormDraft {
  return {
    name: automation.name,
    prompt: automation.prompt,
    projectId: automation.projectId,
    providerId: automation.providerId,
    channelId: automation.channelId || SYSTEM_AGENT_CHANNEL_ID,
    model: automation.model || DEFAULT_MODEL_VALUE,
    reasoningEffort: automation.reasoningEffort || '',
    permissionMode: automation.permissionMode,
    schedule: automation.schedule,
    enabled: automation.enabled,
  };
}

function intervalUnitFor(schedule: AutomationSchedule): 'minutes' | 'hours' {
  return schedule.kind === 'interval' && schedule.intervalMinutes % 60 !== 0 ? 'minutes' : 'hours';
}

function isActiveRun(run: AutomationRun) {
  return run.status === 'claimed' || run.status === 'running' || run.status === 'waiting';
}

function runStatusLabel(status: AutomationRun['status']) {
  if (status === 'claimed') return '准备中';
  if (status === 'running') return '运行中';
  if (status === 'waiting') return '等待处理';
  if (status === 'completed') return '已完成';
  if (status === 'stopped') return '已停止';
  return '失败';
}

function formatRunTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatReasoningLabel(value: string) {
  if (value.toLowerCase() === 'xhigh') return 'XHigh';
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : '跟随模型默认';
}
