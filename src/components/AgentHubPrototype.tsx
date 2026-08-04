import { lazy, Suspense, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bot,
  Braces,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  CirclePlay,
  CircleX,
  Clock3,
  FileDiff,
  Gauge,
  Network,
  PackageCheck,
  Play,
  Radio,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { AgentProviderIcon } from './AgentProviderIcon';

type HubView = 'agents' | 'skills' | 'runs';
export type AgentHealth = 'available' | 'busy' | 'degraded';
type RunStatus = 'running' | 'completed' | 'failed' | 'queued';
type RoutingMode = 'primary-fallback' | 'parallel' | 'manual';

export type AgentProfile = {
  id: string;
  providerId: string;
  providerName: string;
  channel: string;
  model: string;
  health: AgentHealth;
  latency: string;
};

export type AgentDefinition = {
  id: string;
  name: string;
  role: string;
  description: string;
  health: AgentHealth;
  capabilityCatalog: string[];
  capabilities: string[];
  skillIds: string[];
  profiles: AgentProfile[];
  activeProfileIds: string[];
  skillRuntimeBindings: Record<string, string[]>;
  activeRuns: number;
  successRate: string;
  lastRun: string;
};

type SkillExecutor = {
  id: string;
  agentName: string;
  providerId: string;
  providerName: string;
  role: '主执行' | '故障切换' | '并行补充';
  health: AgentHealth;
};

export type SkillDefinition = {
  id: string;
  name: string;
  summary: string;
  capability: string;
  status: 'published' | 'draft' | 'degraded';
  routing: RoutingMode;
  callers: string[];
  executors: SkillExecutor[];
  publishTargets: Array<{ providerId: string; name: string; state: 'synced' | 'outdated' }>;
  invocations: number;
  successRate: string;
};

type RunNode = {
  id: string;
  label: string;
  detail: string;
  providerId?: string;
  status: RunStatus;
  duration?: string;
};

type HubRun = {
  id: string;
  skillName: string;
  source: string;
  project: string;
  status: RunStatus;
  startedAt: string;
  duration: string;
  summary: string;
  tokens: string;
  cost: string;
  nodes: RunNode[];
  events: Array<{ time: string; source: string; text: string; tone?: 'muted' | 'success' | 'danger' }>;
  artifacts: Array<{ name: string; type: string; detail: string }>;
};

const agents: AgentDefinition[] = [
  {
    id: 'reviewer',
    name: '代码审查员',
    role: 'Reviewer',
    description: '审查代码变更，识别真实缺陷、回归风险和缺失测试。',
    health: 'busy',
    capabilityCatalog: ['代码审查', 'Diff 分析', '风险分级', '测试建议'],
    capabilities: ['代码审查', 'Diff 分析'],
    skillIds: ['review-code', 'verify-delivery'],
    profiles: [
      { id: 'reviewer-claude', providerId: 'claude-code', providerName: 'Claude Code', channel: '系统渠道', model: 'Claude Opus 4.1', health: 'busy', latency: '1.8s' },
      { id: 'reviewer-codex', providerId: 'openai-codex', providerName: 'OpenAI Codex', channel: 'OpenAI Team', model: 'GPT-5.6 Codex', health: 'available', latency: '1.2s' },
      { id: 'reviewer-grok', providerId: 'grok-build', providerName: 'Grok Build', channel: 'DeepSeek', model: 'DeepSeek V4', health: 'degraded', latency: '4.6s' },
    ],
    activeProfileIds: ['reviewer-claude', 'reviewer-codex'],
    skillRuntimeBindings: {
      'review-code': ['reviewer-claude'],
      'verify-delivery': ['reviewer-codex'],
    },
    activeRuns: 2,
    successRate: '98.4%',
    lastRun: '刚刚',
  },
  {
    id: 'architect',
    name: '方案设计师',
    role: 'Architect',
    description: '澄清需求边界，设计跨层契约、任务拆分和验收标准。',
    health: 'available',
    capabilityCatalog: ['需求分析', '架构设计', '任务拆分', '验收设计'],
    capabilities: ['需求分析', '架构设计'],
    skillIds: ['design-solution'],
    profiles: [
      { id: 'architect-codex', providerId: 'openai-codex', providerName: 'OpenAI Codex', channel: '系统渠道', model: 'GPT-5.6 Codex', health: 'available', latency: '1.4s' },
      { id: 'architect-claude', providerId: 'claude-code', providerName: 'Claude Code', channel: 'Anthropic', model: 'Claude Opus 4.1', health: 'available', latency: '2.1s' },
    ],
    activeProfileIds: ['architect-codex', 'architect-claude'],
    skillRuntimeBindings: {
      'design-solution': ['architect-codex', 'architect-claude'],
    },
    activeRuns: 0,
    successRate: '97.9%',
    lastRun: '18 分钟前',
  },
  {
    id: 'implementer',
    name: '实现工程师',
    role: 'Implementer',
    description: '依据已确认方案修改代码，并在隔离工作区内完成验证。',
    health: 'available',
    capabilityCatalog: ['代码实现', '局部重构', '测试修复', '工作树隔离'],
    capabilities: ['代码实现', '局部重构'],
    skillIds: ['implement-change'],
    profiles: [
      { id: 'implementer-codex', providerId: 'openai-codex', providerName: 'OpenAI Codex', channel: '系统渠道', model: 'GPT-5.6 Codex', health: 'available', latency: '1.3s' },
      { id: 'implementer-opencode', providerId: 'opencode', providerName: 'OpenCode', channel: 'MiniMax', model: 'MiniMax M3', health: 'available', latency: '2.7s' },
    ],
    activeProfileIds: ['implementer-codex', 'implementer-opencode'],
    skillRuntimeBindings: {
      'implement-change': ['implementer-codex', 'implementer-opencode'],
    },
    activeRuns: 1,
    successRate: '95.7%',
    lastRun: '6 分钟前',
  },
  {
    id: 'verifier',
    name: '验证工程师',
    role: 'Verifier',
    description: '执行测试、构建和交互验收，输出可复核的验证证据。',
    health: 'available',
    capabilityCatalog: ['自动化测试', '构建验证', '桌面验收', '证据归档'],
    capabilities: ['自动化测试', '构建验证'],
    skillIds: ['verify-delivery'],
    profiles: [
      { id: 'verifier-pi', providerId: 'pi-agent', providerName: 'Pi Agent', channel: '系统渠道', model: 'Gemini 2.5 Pro', health: 'available', latency: '1.9s' },
      { id: 'verifier-claude', providerId: 'claude-code', providerName: 'Claude Code', channel: '系统渠道', model: 'Claude Sonnet 4', health: 'available', latency: '1.5s' },
    ],
    activeProfileIds: ['verifier-pi', 'verifier-claude'],
    skillRuntimeBindings: {
      'verify-delivery': ['verifier-pi', 'verifier-claude'],
    },
    activeRuns: 0,
    successRate: '99.1%',
    lastRun: '32 分钟前',
  },
];

const initialSkills: SkillDefinition[] = [
  {
    id: 'review-code',
    name: 'review-code',
    summary: '审查当前 Git Diff，输出按严重级别排序的问题和测试缺口。',
    capability: '代码质量 / 审查',
    status: 'published',
    routing: 'primary-fallback',
    callers: ['CodeM', 'OpenAI Codex', 'Claude Code'],
    executors: [
      { id: 'reviewer-claude', agentName: '代码审查员', providerId: 'claude-code', providerName: 'Claude Code', role: '主执行', health: 'busy' },
      { id: 'reviewer-codex', agentName: '代码审查员', providerId: 'openai-codex', providerName: 'OpenAI Codex', role: '故障切换', health: 'available' },
      { id: 'verifier-pi', agentName: '验证工程师', providerId: 'pi-agent', providerName: 'Pi Agent', role: '并行补充', health: 'available' },
    ],
    publishTargets: [
      { providerId: 'openai-codex', name: 'Codex', state: 'synced' },
      { providerId: 'claude-code', name: 'Claude', state: 'synced' },
      { providerId: 'opencode', name: 'OpenCode', state: 'outdated' },
    ],
    invocations: 128,
    successRate: '98.4%',
  },
  {
    id: 'design-solution',
    name: 'design-solution',
    summary: '根据项目现状生成实现方案、边界说明和分阶段验收标准。',
    capability: '工程设计 / 规划',
    status: 'published',
    routing: 'manual',
    callers: ['CodeM', 'OpenAI Codex'],
    executors: [
      { id: 'architect-codex', agentName: '方案设计师', providerId: 'openai-codex', providerName: 'OpenAI Codex', role: '主执行', health: 'available' },
      { id: 'architect-claude', agentName: '方案设计师', providerId: 'claude-code', providerName: 'Claude Code', role: '故障切换', health: 'available' },
    ],
    publishTargets: [
      { providerId: 'openai-codex', name: 'Codex', state: 'synced' },
      { providerId: 'claude-code', name: 'Claude', state: 'synced' },
    ],
    invocations: 74,
    successRate: '97.9%',
  },
  {
    id: 'implement-change',
    name: 'implement-change',
    summary: '在授权工作区中实现已确认的代码变更并运行定向验证。',
    capability: '代码实现 / 修改',
    status: 'draft',
    routing: 'primary-fallback',
    callers: ['CodeM'],
    executors: [
      { id: 'implementer-codex', agentName: '实现工程师', providerId: 'openai-codex', providerName: 'OpenAI Codex', role: '主执行', health: 'available' },
      { id: 'implementer-opencode', agentName: '实现工程师', providerId: 'opencode', providerName: 'OpenCode', role: '故障切换', health: 'available' },
    ],
    publishTargets: [],
    invocations: 21,
    successRate: '95.7%',
  },
  {
    id: 'verify-delivery',
    name: 'verify-delivery',
    summary: '执行测试与界面验收，汇总构建、日志和产物证据。',
    capability: '测试 / 验收',
    status: 'degraded',
    routing: 'parallel',
    callers: ['CodeM', 'Claude Code'],
    executors: [
      { id: 'verifier-pi', agentName: '验证工程师', providerId: 'pi-agent', providerName: 'Pi Agent', role: '主执行', health: 'available' },
      { id: 'verifier-claude', agentName: '验证工程师', providerId: 'claude-code', providerName: 'Claude Code', role: '并行补充', health: 'available' },
    ],
    publishTargets: [
      { providerId: 'claude-code', name: 'Claude', state: 'outdated' },
    ],
    invocations: 56,
    successRate: '99.1%',
  },
];

const runs: HubRun[] = [
  {
    id: 'run-1042',
    skillName: 'review-code',
    source: '外部 · OpenAI Codex',
    project: 'D:\\ai_proj\\codem',
    status: 'running',
    startedAt: '16:12:08',
    duration: '2m 14s',
    summary: '审查 Agent Hub 原型相关变更，重点检查导航和窄窗口布局。',
    tokens: '18.6k',
    cost: '$0.42',
    nodes: [
      { id: 'skill', label: 'review-code', detail: 'Skill 路由', status: 'completed', duration: '0.1s' },
      { id: 'reviewer', label: '代码审查员', detail: 'Claude Code · 主执行', providerId: 'claude-code', status: 'completed', duration: '1m 26s' },
      { id: 'verifier', label: '验证工程师', detail: 'Pi Agent · 并行补充', providerId: 'pi-agent', status: 'running', duration: '48s' },
      { id: 'result', label: '汇总结果', detail: '等待并行节点', status: 'queued' },
    ],
    events: [
      { time: '16:12:08', source: 'Gateway', text: '收到来自 OpenAI Codex 的 Skill 调用。', tone: 'muted' },
      { time: '16:12:09', source: 'Router', text: '选择代码审查员 / Claude Code，并启动验证工程师并行补充。' },
      { time: '16:12:34', source: 'Reviewer', text: '已读取 5 个变更文件，开始检查导航状态和样式边界。' },
      { time: '16:13:35', source: 'Reviewer', text: '主审查完成：发现 1 个中风险问题，建议补充窄窗口回归检查。', tone: 'success' },
      { time: '16:14:02', source: 'Verifier', text: 'TypeScript 检查通过，正在执行 960px 布局验收。' },
    ],
    artifacts: [
      { name: 'review-findings.json', type: '结构化结果', detail: '3.8 KB' },
      { name: 'viewport-960.png', type: '界面证据', detail: '214 KB' },
    ],
  },
  {
    id: 'run-1041',
    skillName: 'design-solution',
    source: 'CodeM · 当前会话',
    project: 'D:\\ai_proj\\codem',
    status: 'completed',
    startedAt: '15:48:21',
    duration: '4m 08s',
    summary: '设计 Agent、Skill、Provider Profile 与 Invocation 的第一阶段模型。',
    tokens: '31.2k',
    cost: '$0.81',
    nodes: [
      { id: 'skill', label: 'design-solution', detail: 'Skill 路由', status: 'completed', duration: '0.1s' },
      { id: 'architect', label: '方案设计师', detail: 'OpenAI Codex · 手动选择', providerId: 'openai-codex', status: 'completed', duration: '3m 42s' },
      { id: 'result', label: '方案文档', detail: '已生成', status: 'completed', duration: '26s' },
    ],
    events: [
      { time: '15:48:21', source: 'CodeM', text: '当前会话调用 design-solution。', tone: 'muted' },
      { time: '15:48:22', source: 'Architect', text: '加载项目规范与现有 Agent Runtime 数据模型。' },
      { time: '15:52:29', source: 'Architect', text: '方案已完成并写入任务上下文。', tone: 'success' },
    ],
    artifacts: [
      { name: 'agent-hub-design.md', type: '方案文档', detail: '12.4 KB' },
    ],
  },
  {
    id: 'run-1040',
    skillName: 'verify-delivery',
    source: '外部 · Claude Code',
    project: 'D:\\ai_proj\\RunMux',
    status: 'failed',
    startedAt: '14:31:06',
    duration: '0m 37s',
    summary: '验证发布包和 Windows 启动流程。',
    tokens: '4.1k',
    cost: '$0.06',
    nodes: [
      { id: 'skill', label: 'verify-delivery', detail: 'Skill 路由', status: 'completed', duration: '0.1s' },
      { id: 'verifier', label: '验证工程师', detail: 'Pi Agent · 主执行', providerId: 'pi-agent', status: 'failed', duration: '37s' },
    ],
    events: [
      { time: '14:31:06', source: 'Gateway', text: '收到来自 Claude Code 的 Skill 调用。', tone: 'muted' },
      { time: '14:31:43', source: 'Verifier', text: '目标工作区当前被另一个写入任务占用。', tone: 'danger' },
    ],
    artifacts: [],
  },
];

const routingLabels: Record<RoutingMode, string> = {
  'primary-fallback': '主备切换',
  parallel: '并行执行',
  manual: '调用时选择',
};

const AgentDefinitionBuilder = lazy(() => import('./AgentDefinitionBuilder').then((module) => ({
  default: module.AgentDefinitionBuilder,
})));

export function AgentHubPrototype() {
  const [view, setView] = useState<HubView>('agents');
  const [query, setQuery] = useState('');
  const [agentDefinitions, setAgentDefinitions] = useState(() => agents);
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0].id);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [skills, setSkills] = useState(initialSkills);
  const [selectedSkillId, setSelectedSkillId] = useState(initialSkills[0].id);
  const [selectedRunId, setSelectedRunId] = useState(runs[0].id);
  const [simulationCount, setSimulationCount] = useState(0);

  const selectedAgent = agentDefinitions.find((agent) => agent.id === selectedAgentId) ?? agentDefinitions[0];
  const editingAgent = editingAgentId
    ? agentDefinitions.find((agent) => agent.id === editingAgentId) ?? null
    : null;
  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId) ?? skills[0];
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredAgents = useMemo(() => agentDefinitions.filter((agent) => !normalizedQuery || [
    agent.name,
    agent.role,
    agent.description,
    ...agent.capabilities,
  ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))), [agentDefinitions, normalizedQuery]);
  const filteredSkills = useMemo(() => skills.filter((skill) => !normalizedQuery || [
    skill.name,
    skill.summary,
    skill.capability,
  ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))), [normalizedQuery, skills]);
  const filteredRuns = useMemo(() => runs.filter((run) => !normalizedQuery || [
    run.id,
    run.skillName,
    run.source,
    run.project,
    run.summary,
  ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))), [normalizedQuery]);

  function updateSelectedSkill(update: Partial<SkillDefinition>) {
    setSkills((current) => current.map((skill) => (
      skill.id === selectedSkill.id ? { ...skill, ...update } : skill
    )));
  }

  function toggleExecutor(executorId: string) {
    const exists = selectedSkill.executors.some((executor) => executor.id === executorId);
    const fallback = initialSkills
      .find((skill) => skill.id === selectedSkill.id)
      ?.executors.find((executor) => executor.id === executorId);
    if (!exists && !fallback) return;
    updateSelectedSkill({
      executors: exists
        ? selectedSkill.executors.filter((executor) => executor.id !== executorId)
        : [...selectedSkill.executors, fallback!],
    });
  }

  function simulateInvocation() {
    setSimulationCount((current) => current + 1);
    setSelectedRunId('run-1042');
    setView('runs');
    setQuery('');
  }

  function saveAgentDefinition(nextAgent: AgentDefinition) {
    setAgentDefinitions((current) => current.map((agent) => (
      agent.id === nextAgent.id ? nextAgent : agent
    )));
    setSelectedAgentId(nextAgent.id);
    setEditingAgentId(null);
    setQuery('');
  }

  return (
    <section className="agent-hub-prototype">
      <header className="agent-hub-header">
        <div className="agent-hub-title-block">
          <div className="agent-hub-title-row">
            <h1>Agent Hub</h1>
            <span className="agent-hub-prototype-badge">原型数据</span>
          </div>
          <p>统一管理 Agent、Skill 路由以及来自 CodeM 和外部工具的调用。</p>
        </div>
        <div className="agent-hub-header-status" aria-label="Agent Hub 状态概览">
          <HubMetric label="运行中" value="3" tone="accent" />
          <HubMetric label="可用配置" value="8 / 9" />
          <HubMetric label="今日调用" value="42" />
          <HubMetric label="成功率" value="98.6%" tone="success" />
        </div>
        <button type="button" className="agent-hub-primary-button" onClick={simulateInvocation}>
          <Play size={14} />
          模拟调用
        </button>
      </header>

      {editingAgent ? (
        <Suspense fallback={<div className="agent-hub-builder-loading">正在加载编排画布...</div>}>
          <AgentDefinitionBuilder
            key={editingAgent.id}
            agent={editingAgent}
            skills={skills}
            onCancel={() => setEditingAgentId(null)}
            onSave={saveAgentDefinition}
          />
        </Suspense>
      ) : (
        <>
          <div className="agent-hub-toolbar">
            <div className="agent-hub-tabs" role="tablist" aria-label="Agent Hub 视图">
              <HubTab active={view === 'agents'} icon={Bot} label="Agents" count={agentDefinitions.length} onClick={() => setView('agents')} />
              <HubTab active={view === 'skills'} icon={Sparkles} label="Skills" count={skills.length} onClick={() => setView('skills')} />
              <HubTab active={view === 'runs'} icon={Activity} label="Runs" count={runs.length + simulationCount} onClick={() => setView('runs')} />
            </div>
            <label className="agent-hub-search">
              <Search size={14} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索 ${viewLabel(view)}`} />
            </label>
            <div className="agent-hub-live-indicator"><Radio size={12} />运行事件已连接</div>
          </div>

          {view === 'agents' ? (
            <AgentsView
              items={filteredAgents}
              selected={selectedAgent}
              skills={skills}
              onSelect={setSelectedAgentId}
              onEdit={() => setEditingAgentId(selectedAgent.id)}
            />
          ) : view === 'skills' ? (
            <SkillsView
              items={filteredSkills}
              selected={selectedSkill}
              onSelect={setSelectedSkillId}
              onRoutingChange={(routing) => updateSelectedSkill({ routing })}
              onToggleExecutor={toggleExecutor}
            />
          ) : (
            <RunsView items={filteredRuns} selected={selectedRun} onSelect={setSelectedRunId} simulationCount={simulationCount} />
          )}
        </>
      )}
    </section>
  );
}

function HubMetric({ label, value, tone }: { label: string; value: string; tone?: 'accent' | 'success' }) {
  return (
    <div className={`agent-hub-metric${tone ? ` ${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HubTab({
  active,
  icon: Icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: typeof Bot;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button type="button" role="tab" aria-selected={active} className={active ? 'active' : ''} onClick={onClick}>
      <Icon size={14} />
      <span>{label}</span>
      <small>{count}</small>
    </button>
  );
}

function AgentsView({
  items,
  selected,
  skills,
  onSelect,
  onEdit,
}: {
  items: AgentDefinition[];
  selected: AgentDefinition;
  skills: SkillDefinition[];
  onSelect: (id: string) => void;
  onEdit: () => void;
}) {
  const assignedSkills = skills.filter((skill) => selected.skillIds.includes(skill.id));
  const activeProfiles = selected.profiles.filter((profile) => selected.activeProfileIds.includes(profile.id));
  return (
    <div className="agent-hub-workspace agent-hub-agents-view">
      <div className="agent-hub-list-pane">
        <div className="agent-hub-list-heading">
          <span>Agent</span><span>运行配置</span><span>状态</span>
        </div>
        <div className="agent-hub-list-scroll">
          {items.map((agent) => (
            <button
              type="button"
              key={agent.id}
              className={`agent-hub-agent-row${selected.id === agent.id ? ' active' : ''}`}
              onClick={() => onSelect(agent.id)}
            >
              <span className="agent-hub-agent-identity">
                <span className="agent-hub-agent-mark"><Bot size={15} /></span>
                <span><strong>{agent.name}</strong><small>{agent.role}</small></span>
              </span>
              <span className="agent-hub-provider-stack">
                {agent.profiles.filter((profile) => agent.activeProfileIds.includes(profile.id)).map((profile) => (
                  <span key={profile.id} title={`${profile.providerName} · ${profile.model}`}>
                    <AgentProviderIcon providerId={profile.providerId} size={15} />
                  </span>
                ))}
              </span>
              <HealthBadge health={agent.health} label={agent.activeRuns ? `${agent.activeRuns} 运行中` : healthLabel(agent.health)} />
              <ChevronRight className="agent-hub-row-chevron" size={14} />
            </button>
          ))}
        </div>
      </div>

      <div className="agent-hub-detail-pane">
        <div className="agent-hub-detail-head">
          <div>
            <span className="agent-hub-detail-kicker">{selected.role}</span>
            <h2>{selected.name}</h2>
            <p>{selected.description}</p>
          </div>
          <button type="button" className="agent-hub-secondary-button" onClick={onEdit}><Braces size={14} />编辑定义</button>
        </div>

        <div className="agent-hub-summary-strip">
          <HubMetric label="运行配置" value={String(activeProfiles.length)} />
          <HubMetric label="活动运行" value={String(selected.activeRuns)} tone={selected.activeRuns ? 'accent' : undefined} />
          <HubMetric label="成功率" value={selected.successRate} tone="success" />
          <HubMetric label="最近运行" value={selected.lastRun} />
        </div>

        <DetailSection title="能力定位" description="Skill 路由会依据这些声明筛选可执行 Agent。">
          <div className="agent-hub-tag-list">
            {selected.capabilities.map((capability) => <span key={capability}>{capability}</span>)}
          </div>
        </DetailSection>

        <DetailSection title="可调用 Skill" description="编排器中的连线决定该 Agent 暴露和执行哪些能力。">
          <div className="agent-hub-tag-list agent-hub-skill-tag-list">
            {assignedSkills.length
              ? assignedSkills.map((skill) => <span key={skill.id}><Sparkles size={12} />{skill.name}</span>)
              : <span>尚未关联 Skill</span>}
          </div>
        </DetailSection>

        <DetailSection title="运行配置" description="同一 Agent 可以绑定不同供应商、渠道和模型。">
          <div className="agent-hub-profile-list">
            {activeProfiles.map((profile, index) => (
              <div className="agent-hub-profile-row" key={profile.id}>
                <span className="agent-hub-provider-icon"><AgentProviderIcon providerId={profile.providerId} size={17} /></span>
                <span className="agent-hub-profile-main">
                  <strong>{profile.providerName}</strong>
                  <small>{profile.channel} · {profile.model}</small>
                </span>
                <span className="agent-hub-profile-latency"><Gauge size={12} />{profile.latency}</span>
                <HealthBadge health={profile.health} />
                <span className="agent-hub-profile-order">{index === 0 ? '默认' : `备选 ${index}`}</span>
              </div>
            ))}
          </div>
        </DetailSection>
      </div>
    </div>
  );
}

function SkillsView({
  items,
  selected,
  onSelect,
  onRoutingChange,
  onToggleExecutor,
}: {
  items: SkillDefinition[];
  selected: SkillDefinition;
  onSelect: (id: string) => void;
  onRoutingChange: (mode: RoutingMode) => void;
  onToggleExecutor: (id: string) => void;
}) {
  const availableExecutors = initialSkills.find((skill) => skill.id === selected.id)?.executors ?? selected.executors;
  return (
    <div className="agent-hub-workspace agent-hub-skills-view">
      <div className="agent-hub-list-pane">
        <div className="agent-hub-list-heading"><span>Skill</span><span>调用</span><span>状态</span></div>
        <div className="agent-hub-list-scroll">
          {items.map((skill) => (
            <button
              type="button"
              key={skill.id}
              className={`agent-hub-skill-row${selected.id === skill.id ? ' active' : ''}`}
              onClick={() => onSelect(skill.id)}
            >
              <span className="agent-hub-skill-identity">
                <span className="agent-hub-skill-mark"><Sparkles size={14} /></span>
                <span><strong>{skill.name}</strong><small>{skill.capability}</small></span>
              </span>
              <span className="agent-hub-invocation-count">{skill.invocations}</span>
              <SkillStatus status={skill.status} />
              <ChevronRight className="agent-hub-row-chevron" size={14} />
            </button>
          ))}
        </div>
      </div>

      <div className="agent-hub-detail-pane">
        <div className="agent-hub-detail-head">
          <div>
            <span className="agent-hub-detail-kicker">{selected.capability}</span>
            <h2>{selected.name}</h2>
            <p>{selected.summary}</p>
          </div>
          <button type="button" className="agent-hub-primary-button"><PackageCheck size={14} />发布更新</button>
        </div>

        <DetailSection title="允许调用方" description="调用权限与实际执行 Agent 分开配置。">
          <div className="agent-hub-caller-list">
            {selected.callers.map((caller) => (
              <span key={caller}><ShieldCheck size={13} />{caller}<Check size={12} /></span>
            ))}
            <button type="button" title="配置允许调用方">+</button>
          </div>
        </DetailSection>

        <DetailSection title="路由策略" description="决定一次调用如何选择或组合执行配置。">
          <div className="agent-hub-routing-control" role="group" aria-label="Skill 路由策略">
            {(Object.keys(routingLabels) as RoutingMode[]).map((mode) => (
              <button type="button" key={mode} className={selected.routing === mode ? 'active' : ''} onClick={() => onRoutingChange(mode)}>
                {mode === 'primary-fallback' ? <Route size={14} /> : mode === 'parallel' ? <Network size={14} /> : <CircleDot size={14} />}
                {routingLabels[mode]}
              </button>
            ))}
          </div>
        </DetailSection>

        <DetailSection title="执行池" description={`${selected.executors.length} 个运行配置参与 ${routingLabels[selected.routing]}。`}>
          <div className="agent-hub-executor-list">
            {availableExecutors.map((executor) => {
              const enabled = selected.executors.some((item) => item.id === executor.id);
              return (
                <button type="button" key={executor.id} className={enabled ? 'enabled' : ''} onClick={() => onToggleExecutor(executor.id)}>
                  <span className="agent-hub-check-box">{enabled ? <Check size={12} /> : null}</span>
                  <AgentProviderIcon providerId={executor.providerId} size={17} />
                  <span><strong>{executor.agentName}</strong><small>{executor.providerName}</small></span>
                  <span className="agent-hub-executor-role">{executor.role}</span>
                  <HealthBadge health={executor.health} />
                </button>
              );
            })}
          </div>
        </DetailSection>

        <DetailSection title="已发布到" description="外部 Skill 只保存稳定入口，实际路由仍由 CodeM 管理。">
          <div className="agent-hub-publish-list">
            {selected.publishTargets.length ? selected.publishTargets.map((target) => (
              <div key={target.providerId}>
                <AgentProviderIcon providerId={target.providerId} size={16} />
                <span><strong>{target.name}</strong><small>全局 Skill</small></span>
                <span className={target.state}>{target.state === 'synced' ? '已同步' : '待更新'}</span>
              </div>
            )) : <div className="agent-hub-inline-empty">尚未发布到外部工具</div>}
          </div>
        </DetailSection>
      </div>
    </div>
  );
}

function RunsView({
  items,
  selected,
  onSelect,
  simulationCount,
}: {
  items: HubRun[];
  selected: HubRun;
  onSelect: (id: string) => void;
  simulationCount: number;
}) {
  return (
    <div className="agent-hub-workspace agent-hub-runs-view">
      <div className="agent-hub-list-pane">
        <div className="agent-hub-run-filter-row">
          <span className="active">全部 {runs.length + simulationCount}</span>
          <span>运行中 1</span>
          <span>异常 1</span>
        </div>
        <div className="agent-hub-list-scroll">
          {items.map((run) => (
            <button
              type="button"
              key={run.id}
              className={`agent-hub-run-row${selected.id === run.id ? ' active' : ''}`}
              onClick={() => onSelect(run.id)}
            >
              <RunStatusIcon status={run.status} />
              <span className="agent-hub-run-main">
                <span><strong>{run.skillName}</strong><small>{run.id}</small></span>
                <small>{run.source}</small>
                <small>{run.project}</small>
              </span>
              <span className="agent-hub-run-meta"><strong>{run.duration}</strong><small>{run.startedAt}</small></span>
            </button>
          ))}
        </div>
      </div>

      <div className="agent-hub-detail-pane agent-hub-run-detail">
        <div className="agent-hub-detail-head">
          <div>
            <span className="agent-hub-detail-kicker">{selected.id} · {selected.source}</span>
            <h2>{selected.skillName}</h2>
            <p>{selected.summary}</p>
          </div>
          {selected.status === 'running' ? <button type="button" className="agent-hub-secondary-button danger"><CircleX size={14} />取消运行</button> : <button type="button" className="agent-hub-secondary-button"><CirclePlay size={14} />再次运行</button>}
        </div>

        <div className="agent-hub-summary-strip">
          <HubMetric label="状态" value={runStatusLabel(selected.status)} tone={selected.status === 'running' ? 'accent' : selected.status === 'completed' ? 'success' : undefined} />
          <HubMetric label="耗时" value={selected.duration} />
          <HubMetric label="Token" value={selected.tokens} />
          <HubMetric label="费用" value={selected.cost} />
        </div>

        <DetailSection title="调用链" description="Skill、Agent 和实际供应商运行配置使用同一个追踪 ID。">
          <div className="agent-hub-run-topology">
            {selected.nodes.map((node, index) => (
              <div className="agent-hub-topology-step" key={node.id}>
                <div className={`agent-hub-topology-node ${node.status}`}>
                  <RunStatusIcon status={node.status} />
                  {node.providerId ? <AgentProviderIcon providerId={node.providerId} size={15} /> : null}
                  <span><strong>{node.label}</strong><small>{node.detail}</small></span>
                  {node.duration ? <time>{node.duration}</time> : null}
                </div>
                {index < selected.nodes.length - 1 ? <ArrowRight className="agent-hub-topology-arrow" size={15} /> : null}
              </div>
            ))}
          </div>
        </DetailSection>

        <div className="agent-hub-run-lower-grid">
          <DetailSection title="实时输出" description={selected.status === 'running' ? '新事件会自动追加' : '已保存的运行事件'} compact>
            <div className="agent-hub-event-stream">
              {selected.events.map((event, index) => (
                <div key={`${event.time}-${index}`} className={event.tone ?? ''}>
                  <time>{event.time}</time>
                  <strong>{event.source}</strong>
                  <span>{event.text}</span>
                </div>
              ))}
              {selected.status === 'running' ? <div className="agent-hub-stream-cursor"><span />等待下一条事件</div> : null}
            </div>
          </DetailSection>

          <DetailSection title="产物" description={`${selected.artifacts.length} 个`} compact>
            <div className="agent-hub-artifact-list">
              {selected.artifacts.length ? selected.artifacts.map((artifact) => (
                <button type="button" key={artifact.name}>
                  {artifact.type.includes('界面') ? <FileDiff size={15} /> : <Wrench size={15} />}
                  <span><strong>{artifact.name}</strong><small>{artifact.type} · {artifact.detail}</small></span>
                  <ChevronRight size={14} />
                </button>
              )) : <div className="agent-hub-inline-empty">本次运行没有产物</div>}
            </div>
          </DetailSection>
        </div>
      </div>
    </div>
  );
}

function DetailSection({
  title,
  description,
  compact = false,
  children,
}: {
  title: string;
  description: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`agent-hub-detail-section${compact ? ' compact' : ''}`}>
      <div className="agent-hub-section-head"><div><h3>{title}</h3><p>{description}</p></div></div>
      {children}
    </section>
  );
}

function HealthBadge({ health, label }: { health: AgentHealth; label?: string }) {
  return <span className={`agent-hub-health ${health}`}><span />{label ?? healthLabel(health)}</span>;
}

function SkillStatus({ status }: { status: SkillDefinition['status'] }) {
  const label = status === 'published' ? '已发布' : status === 'draft' ? '草稿' : '需更新';
  return <span className={`agent-hub-skill-status ${status}`}>{label}</span>;
}

function RunStatusIcon({ status }: { status: RunStatus }) {
  if (status === 'completed') return <CheckCircle2 className="agent-hub-run-status-icon completed" size={15} />;
  if (status === 'failed') return <CircleX className="agent-hub-run-status-icon failed" size={15} />;
  if (status === 'queued') return <Clock3 className="agent-hub-run-status-icon queued" size={15} />;
  return <Activity className="agent-hub-run-status-icon running" size={15} />;
}

function healthLabel(health: AgentHealth) {
  if (health === 'busy') return '运行中';
  if (health === 'degraded') return '性能下降';
  return '可用';
}

function runStatusLabel(status: RunStatus) {
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'queued') return '排队中';
  return '运行中';
}

function viewLabel(view: HubView) {
  if (view === 'skills') return 'Skills';
  if (view === 'runs') return 'Runs';
  return 'Agents';
}
