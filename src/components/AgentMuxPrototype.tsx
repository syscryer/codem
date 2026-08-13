import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { cancelAgentMuxProviderRun, createAgentMuxProfile, createAgentMuxRun, createAgentMuxRunEvent, deleteAgentMuxProfile, getAgentMuxOverview, getAgentMuxRuntimeInfo, getAgentMuxSkillSource, listAgentMuxRunEvents, probeAgentMuxAgent, startAgentMuxProviderRun, stopAgentMuxRuntime, syncAgentMuxSkillSource, updateAgentMuxProfile, updateAgentMuxProfileStatus, updateAgentMuxRun } from '../lib/agent-mux-api';
import { agentMuxConversationKey, groupAgentMuxRunsByConversation } from '../lib/agent-mux-api';
import type { AgentMuxMetrics, AgentMuxRun, AgentMuxRunEvent, AgentMuxRuntimeInfo, AgentMuxSkillSource, AgentMuxSkillTarget } from '../lib/agent-mux-api';
import { fetchAgentChannelBootstrap, testAgentChannel } from '../lib/agent-channel-api';
import { buildAgentChannelModelCatalog, buildAgentSystemChannelModelCatalog } from '../lib/agent-channel-selection';
import { fetchAgentModelCatalog, fetchAgentProviderRegistry } from '../lib/agent-provider-registry';
import { installSkillFromPath } from '../lib/plugins';
import { buildAgentMuxConversationTurn, formatAgentMuxExactTime, formatAgentMuxRelativeTime } from '../lib/agent-mux-events';
import { groupAgentMuxRunsByWorkspace } from '../lib/agent-mux-workspaces';
import {
  applyAgentRunEventToTurn,
  coalesceAgentRunTranscriptEvent,
  consumeAgentRunEventStream,
  isAgentRunBlockingEvent,
  isAgentRunTerminalEvent,
  isAgentRunTranscriptDeltaEvent,
  shouldPersistAgentRunTranscriptEvent,
} from '../lib/agent-run-events';
import { openExternalUrl } from '../lib/markdown-link';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import type { AgentChannel, AgentModelCatalog, AgentProviderId, AgentRunEvent, AgentSystemChannel, ProjectSummary } from '../types';
import { CLAUDE_CODE_PROVIDER_ID, GEMINI_CLI_PROVIDER_ID, GROK_BUILD_PROVIDER_ID, HERMES_AGENT_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID, OPENCODE_PROVIDER_ID, PI_AGENT_PROVIDER_ID } from '../constants';
import { AgentProviderIcon } from './AgentProviderIcon';
import { AgentMuxAvatar, AGENT_MUX_AVATAR_OPTIONS } from './AgentMuxAvatar';
import { ConversationTurnView } from './ConversationTurn';
import { PopoverPortal } from './PopoverPortal';
import { StandardSelect } from './StandardSelect';
import {
  Activity,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clipboard,
  Clock3,
  Copy,
  Download,
  FolderOpen,
  Gauge,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Square,
  Sparkles,
  Terminal,
  Workflow,
  X,
} from 'lucide-react';

type MuxView = 'overview' | 'agents' | 'workflows' | 'monitor' | 'skill';
type RunStatus = 'running' | 'completed' | 'failed' | 'queued' | 'waiting' | 'cancelled';
const ALL_AGENTS_ID = '__all__';

const AGENT_MUX_LEVEL_OPTIONS = [
  { value: '基础', label: '基础' },
  { value: '轻量', label: '轻量' },
  { value: '标准', label: '标准' },
  { value: '高级', label: '高级' },
  { value: '顶级', label: '顶级' },
] as const;
const AGENT_MUX_TENDENCY_OPTIONS = ['通用', '代码', '前端 / UI', '写作', '数学推理'] as const;
const AGENT_MUX_PURPOSE_OPTIONS = ['通用任务', '代码生成', '代码审查', 'Bug 排查', '前端实现', '测试验证', '文档写作', '信息分析', '数学推理'] as const;
type AgentMuxCapabilityLevel = (typeof AGENT_MUX_LEVEL_OPTIONS)[number]['value'];
type AgentMuxCapabilityTendency = (typeof AGENT_MUX_TENDENCY_OPTIONS)[number];
type AgentMuxPurpose = (typeof AGENT_MUX_PURPOSE_OPTIONS)[number];

type RuntimeProfile = {
  id: string;
  provider: string;
  model: string;
  nickname?: string | null;
  avatar?: string | null;
  reasoningEffort?: string | null;
  level: AgentMuxCapabilityLevel;
  tags: string[];
  role: AgentMuxPurpose;
  status: 'available' | 'busy' | 'offline' | 'disabled';
  channelId?: string | null;
};

type AgentRecord = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  profiles: RuntimeProfile[];
};


type RunRecord = AgentMuxRun;
type AgentMuxConversationTurn = ReturnType<typeof buildAgentMuxConversationTurn>;

const SKILL_TARGETS: Array<{ providerId: AgentProviderId; label: string }> = [
  { providerId: CLAUDE_CODE_PROVIDER_ID, label: 'Claude Code' },
  { providerId: OPENAI_CODEX_PROVIDER_ID, label: 'Codex' },
  { providerId: GROK_BUILD_PROVIDER_ID, label: 'Grok Build' },
  { providerId: PI_AGENT_PROVIDER_ID, label: 'Pi Agent' },
  { providerId: OPENCODE_PROVIDER_ID, label: 'OpenCode' },
  { providerId: GEMINI_CLI_PROVIDER_ID, label: 'Gemini CLI' },
  { providerId: HERMES_AGENT_PROVIDER_ID, label: 'Hermes Agent' },
];

type SkillInstallTarget = AgentMuxSkillTarget & {
  label: string;
  available: boolean;
};

const WorkflowPrototype = lazy(() => import('./WorkflowPrototype').then((module) => ({
  default: module.WorkflowPrototype,
})));

type Confirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  tone: 'primary' | 'danger';
  action: () => void | Promise<void>;
};

function buildSkillText(cliPath: string, appDataDir: string) {
  const escapedCliPath = cliPath.replaceAll("'", "''");
  const appDataArg = appDataDir ? ` --app-data '${appDataDir.replaceAll("'", "''")}'` : '';
  return `---
name: codem-agent-mux
description: 发现并调用 CodeM Agent Mux 中已检测可用的执行 Agent 和已启用工作流
---

# CodeM Agent Mux

通过 CodeM Agent Mux CLI 发现并调用本机 Agent。CLI 会按需启动后台 Runtime，关闭 CodeM 界面后仍可继续使用。不得读取、复制或输出 Runtime token、渠道 API Key 或隐藏思维链。

## CLI

\`\`\`powershell
$agentMux = '${escapedCliPath}'
& $agentMux agents --json${appDataArg}
& $agentMux workflows --json${appDataArg}
\`\`\`

## 工作流协议

用户明确要求“使用 / 启动 / 调用工作流”或点名某个工作流时：

1. 先执行 \`& $agentMux workflows --json${appDataArg}\` 获取最新已启用工作流；只允许使用返回目录中的工作流，草稿和已下线工作流不可调用。
2. 按用户点名的名称或 id 精确选择工作流。没有匹配时说明未找到；多个候选时让用户确认，不得自行猜测。
3. 将本次用户消息作为工作流目标。按 \`nodes\` 和 \`edges\` 的 DAG 依赖执行：依赖已满足的节点可以并行，不要把并行步骤压成一次普通调用。
4. \`start\` 读取目标和当前上下文；\`agent\` 优先使用节点的 \`profileId\`，没有显式绑定时按 \`agentId\` 角色从最新 Agent 目录选择可用配置（architect / implementer 对应 Codex，reviewer 对应 Claude Code，verifier 对应 Pi Agent）；\`discussion\` 对 proposer 和 reviewer 应用同样规则，持续提案、审查、修订，直到满足 \`satisfactionRule\` 或达到 \`maxRounds\`；\`approval\` 必须停下等待用户确认；\`end\` 汇总所有上游公开结果。
5. 调用节点时使用下方 \`invoke\` 协议，并在 prompt 中包含工作流目标、当前节点说明和必要的上游公开结果。显式绑定的配置不可用或角色没有可用配置时必须报告真实失败，不得换成无关 Agent 或伪装执行。
6. 向用户明确说明已启动的工作流名称，并在结束时汇总节点结果；任何非零退出码、等待或失败状态都必须原样反映。

## 调用协议

1. 每次调用前执行 \`& $agentMux agents --json${appDataArg}\` 获取最新可调用配置；这是 Agent/Profile 状态的唯一可信来源，不得缓存或依赖安装时快照。
2. 按 Profile 元数据选择 status=available 的 profileId：\`level\` 是五级能力等级，\`tags[0]\` 是能力偏向，\`role\` 是具体任务用途；\`role\` 不是主执行、备用或故障切换等工作流角色。
3. 执行 \`& $agentMux invoke --profile '<profileId>' --caller '<当前主 Agent 名称>' --working-directory '<absolute-path>' --permission default --prompt '<task>'${appDataArg}\`。需要覆盖 Profile 默认思考等级时，增加 \`--reasoning-effort '<level>'\`；显式值优先，省略时继续使用 Profile 配置。调用方只填写 Agent 名称（如 OpenAI Codex、Claude Code、OpenCode），不要填写或推测会话名称。同一 CodeM 主会话再次调用相同 profileId 和工作区时，CLI 会自动续用该子 Agent 的会话，适合追问和返工；切换主会话、配置或工作区会新建会话。若外层 CodeM 会话是“完全访问”，CLI 会自动让子 Agent 继承最高权限；其他权限模式保持原样。
4. 思考等级按 Agent 和模型区分：Claude Code 支持 \`low/medium/high/xhigh/max\` 及 CodeM 的 \`ultracode\`；OpenAI Codex 和 Pi 使用各自动态模型目录，仅在调用方已知可用值时传入；Grok Build 和 OpenCode 当前不支持。无法确认时省略该参数。
5. CLI stdout 是 Agent 公开输出；非零退出码表示真实失败，不得伪装成功。
6. 查询运行使用 \`& $agentMux status --json${appDataArg}\`，取消运行使用 \`& $agentMux cancel --run '<runId>'${appDataArg}\`。
7. 不得直接读取 discovery 文件；Runtime token 由 CLI 内部管理。

\`agents --json\` 只返回当前 Runtime 已支持且状态为 available 的配置。接口失败时必须返回真实错误，不得伪装成功。
`;
}

export function AgentMuxPrototype({ projects, activeProjectId }: { projects: ProjectSummary[]; activeProjectId: string | null }) {
  const [view, setView] = useState<MuxView>('overview');
  const [agentRecords, setAgentRecords] = useState<AgentRecord[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState(ALL_AGENTS_ID);
  const [runRecords, setRunRecords] = useState<RunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [metrics, setMetrics] = useState<AgentMuxMetrics>({ running: 0, availableAgents: 0, todayCalls: 0, successRate: null });
  const [backendStatus, setBackendStatus] = useState<'connecting' | 'connected' | 'offline'>('connecting');
  const [copied, setCopied] = useState(false);
  const [profileDialog, setProfileDialog] = useState<{ agentId: string; profile?: RuntimeProfile; allowAgentSelection?: boolean } | null>(null);
  const [testingProfileId, setTestingProfileId] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [agentChannels, setAgentChannels] = useState<AgentChannel[]>([]);
  const [agentSystemChannels, setAgentSystemChannels] = useState<AgentSystemChannel[]>([]);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [runEventsById, setRunEventsById] = useState<Record<string, AgentMuxRunEvent[]>>({});
  const [liveRunTurns, setLiveRunTurns] = useState<Record<string, AgentMuxConversationTurn>>({});
  const [startingRun, setStartingRun] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState<AgentMuxRuntimeInfo>({ cliPath: 'codem-agent-mux', appDataDir: '', runtimeManaged: false });
  const [skillSource, setSkillSource] = useState<AgentMuxSkillSource | null>(null);
  const [skillProviderAvailability, setSkillProviderAvailability] = useState<Record<string, boolean>>({});
  const [skillInstallPending, setSkillInstallPending] = useState<string[]>([]);
  const [skillInstallMessage, setSkillInstallMessage] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [copiedSkillPath, setCopiedSkillPath] = useState(false);
  const [copiedInstallInstruction, setCopiedInstallInstruction] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const selectedRunIdRef = useRef(selectedRunId);
  const selectedAgent = selectedAgentId === ALL_AGENTS_ID ? null : agentRecords.find((agent) => agent.id === selectedAgentId) ?? null;
  const selectedRun = runRecords.find((run) => run.id === selectedRunId);
  const selectedConversationRuns = useMemo(() => {
    if (!selectedRun) return [];
    const key = agentMuxConversationKey(selectedRun);
    if (!key) return [selectedRun];
    return runRecords.filter((run) => agentMuxConversationKey(run) === key).sort((a, b) => runRecords.indexOf(b) - runRecords.indexOf(a));
  }, [runRecords, selectedRun]);
  const skillText = useMemo(() => buildSkillText(runtimeInfo.cliPath, runtimeInfo.appDataDir), [runtimeInfo.appDataDir, runtimeInfo.cliPath]);
  const availableProfiles = useMemo(() => agentRecords.flatMap((agent) => agent.profiles).filter((profile) => profile.status === 'available'), [agentRecords]);
  const skillInstallTargets = useMemo<SkillInstallTarget[]>(() => SKILL_TARGETS.map((target) => ({
    ...target,
    path: skillSource?.targets.find((item) => item.providerId === target.providerId)?.path ?? '',
    state: skillSource?.targets.find((item) => item.providerId === target.providerId)?.state ?? 'not-installed',
    available: skillProviderAvailability[target.providerId] === true,
  })), [skillProviderAvailability, skillSource]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    setSelectedRunId((current) => {
      if (current && runRecords.some((run) => run.id === current)) return current;
      const firstRunId = groupAgentMuxRunsByConversation(runRecords)[0]?.[0]?.id ?? '';
      selectedRunIdRef.current = firstRunId;
      return firstRunId;
    });
  }, [runRecords]);

  useEffect(() => {
    let disposed = false;
    const refresh = () => void getAgentMuxOverview().then((overview) => {
      if (disposed) return;
      setAgentRecords(overview.agents);
      setRunRecords(overview.runs);
      setMetrics(overview.metrics);
      setSelectedAgentId((current) => current === ALL_AGENTS_ID || overview.agents.some((agent) => agent.id === current) ? current : ALL_AGENTS_ID);
      setBackendStatus('connected');
    }).catch((error) => {
      if (disposed) return;
      setBackendStatus('offline');
      setTestMessage(error instanceof Error ? error.message : '读取 Agent Mux 概览失败');
    });
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    void getAgentMuxRuntimeInfo().then(setRuntimeInfo).catch(() => undefined);
  }, []);

  useEffect(() => {
    let disposed = false;
    void syncAgentMuxSkillSource(skillText).then((source) => {
      if (disposed) return;
      setSkillSource(source);
      setSkillInstallMessage(null);
    }).catch((error) => {
      if (disposed) return;
      setSkillInstallMessage({ tone: 'error', text: error instanceof Error ? error.message : '同步 Agent Mux Skill 失败' });
    });
    void fetchAgentProviderRegistry().then((registry) => {
      if (disposed) return;
      setSkillProviderAvailability(Object.fromEntries(registry.providers.map((provider) => [provider.id, provider.available === true])));
    }).catch(() => {
      if (disposed) return;
      setSkillProviderAvailability({});
    });
    return () => { disposed = true; };
  }, [skillText]);

  useEffect(() => {
    if (view !== 'monitor' || !selectedConversationRuns.length) {
      setRunEventsById({});
      return;
    }
    let disposed = false;
    const refresh = () => void Promise.all(selectedConversationRuns.map(async (run) => [run.id, await listAgentMuxRunEvents(run.id)] as const))
      .then((entries) => { if (!disposed) setRunEventsById(Object.fromEntries(entries)); })
      .catch(() => { if (!disposed) setRunEventsById({}); });
    refresh();
    const timer = window.setInterval(refresh, 1200);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [selectedConversationRuns, view]);

  useEffect(() => {
    void fetchAgentChannelBootstrap().then((bootstrap) => {
      setAgentChannels(bootstrap.channels);
      setAgentSystemChannels(bootstrap.systemChannels);
    }).catch(() => {
      setAgentChannels([]);
      setAgentSystemChannels([]);
    });
  }, []);

  const copySkill = async () => {
    try {
      await navigator.clipboard.writeText(skillText);
    } catch {
      // Clipboard permission is unavailable in some preview shells; keep the visual confirmation usable.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const exportSkill = () => {
    const url = URL.createObjectURL(new Blob([skillText], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'SKILL.md';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const installSkillTarget = async (target: SkillInstallTarget, confirmed = false) => {
    if (!skillSource || !target.available || target.state === 'installed' || skillInstallPending.length > 0) return;
    if (target.state === 'update-available' && !confirmed) {
      setConfirmation({ title: `更新 ${target.label} Skill`, description: '现有 codem-agent-mux 内容将替换为 CodeM 当前生成的版本。', confirmLabel: '更新', tone: 'primary', action: () => installSkillTarget(target, true) });
      return;
    }
    setSkillInstallPending([target.providerId]);
    setSkillInstallMessage({ tone: 'info', text: `正在${target.state === 'update-available' ? '更新' : '安装'}到 ${target.label}…` });
    try {
      await installSkillFromPath({
        providerId: target.providerId as AgentProviderId,
        path: skillSource.sourceDirectory,
        scope: 'user',
        overwrite: target.state === 'update-available',
      });
      setSkillSource(await getAgentMuxSkillSource());
      setSkillInstallMessage({ tone: 'success', text: `${target.label} ${target.state === 'update-available' ? '更新' : '安装'}完成` });
    } catch (error) {
      setSkillInstallMessage({ tone: 'error', text: error instanceof Error ? error.message : `${target.label} 安装失败` });
    } finally {
      setSkillInstallPending([]);
    }
  };

  const installSkillToAll = async (confirmed = false) => {
    if (!skillSource || skillInstallPending.length > 0) return;
    const pendingTargets = skillInstallTargets.filter((target) => target.available && target.state !== 'installed');
    if (pendingTargets.length === 0) {
      setSkillInstallMessage({ tone: 'success', text: '所有已识别 Agent 均已安装' });
      return;
    }
    const updates = pendingTargets.filter((target) => target.state === 'update-available');
    if (updates.length > 0 && !confirmed) {
      setConfirmation({ title: `安装到 ${pendingTargets.length} 个 Agent`, description: `其中 ${updates.length} 个已有不同内容，将替换为 CodeM 当前生成的版本。`, confirmLabel: '继续安装', tone: 'primary', action: () => installSkillToAll(true) });
      return;
    }
    setSkillInstallPending(pendingTargets.map((target) => target.providerId));
    setSkillInstallMessage({ tone: 'info', text: `正在安装到 ${pendingTargets.length} 个 Agent…` });
    const failures: string[] = [];
    let successCount = 0;
    for (const target of pendingTargets) {
      try {
        await installSkillFromPath({
          providerId: target.providerId as AgentProviderId,
          path: skillSource.sourceDirectory,
          scope: 'user',
          overwrite: target.state === 'update-available',
        });
        successCount += 1;
      } catch (error) {
        failures.push(`${target.label}: ${error instanceof Error ? error.message : '安装失败'}`);
      }
    }
    try {
      setSkillSource(await getAgentMuxSkillSource());
    } catch (error) {
      failures.push(error instanceof Error ? error.message : '刷新安装状态失败');
    }
    setSkillInstallPending([]);
    setSkillInstallMessage(failures.length > 0
      ? { tone: 'error', text: `${successCount} 个安装成功；${failures[0]}` }
      : { tone: 'success', text: `已安装到 ${pendingTargets.length} 个 Agent` });
  };

  const copySkillPath = async () => {
    if (!skillSource) return;
    await navigator.clipboard.writeText(skillSource.sourceDirectory).catch(() => undefined);
    setCopiedSkillPath(true);
    window.setTimeout(() => setCopiedSkillPath(false), 1800);
  };

  const copyInstallInstruction = async () => {
    if (!skillSource) return;
    await navigator.clipboard.writeText(`请将本地 Skill 目录“${skillSource.sourceDirectory}”安装到当前 Agent 的用户级 Skills 目录；不要修改 CodeM 的源目录。`).catch(() => undefined);
    setCopiedInstallInstruction(true);
    window.setTimeout(() => setCopiedInstallInstruction(false), 1800);
  };

  const probeProfile = (agentId: string, profile: RuntimeProfile) => profile.channelId
    ? testAgentChannel(profile.channelId).then((value) => ({ available: value.ok, message: value.message }))
    : probeAgentMuxAgent(agentId);

  const updateProfileInState = (agentId: string, profile: RuntimeProfile) => {
    setAgentRecords((current) => current.map((agent) => {
      if (agent.id !== agentId) return agent;
      const exists = agent.profiles.some((item) => item.id === profile.id);
      return { ...agent, profiles: exists ? agent.profiles.map((item) => item.id === profile.id ? profile : item) : [...agent.profiles, profile] };
    }));
  };

  const saveProfile = async (profile: RuntimeProfile, connectionVerified: boolean) => {
    const agentId = profileDialog?.agentId;
    if (!agentId) return;
    const original = profileDialog.profile;
    const connectionChanged = !original || (original.channelId ?? null) !== (profile.channelId ?? null) || original.model !== profile.model;
    const savedProfile = { ...profile, status: connectionChanged ? (connectionVerified ? 'available' : 'busy') : original.status } as RuntimeProfile;
    try {
      if (original) await updateAgentMuxProfile(savedProfile);
      else await createAgentMuxProfile(agentId, savedProfile);
    } catch (error) {
      setTestMessage(error instanceof Error ? error.message : '保存 Agent Mux 配置失败');
      return;
    }
    updateProfileInState(agentId, savedProfile);
    setProfileDialog(null);
    if (!connectionChanged || connectionVerified) {
      setTestMessage(connectionVerified ? `${savedProfile.provider} / ${savedProfile.model} 已连接并启用` : '运行配置已保存');
      return;
    }
    setTestingProfileId(savedProfile.id);
    setTestMessage(`正在检查 ${savedProfile.provider} / ${savedProfile.model} 对应的 Agent 工具...`);
    try {
      const result = await probeProfile(agentId, savedProfile);
      const status = result.available ? 'available' : 'offline';
      await updateAgentMuxProfileStatus(savedProfile.id, status);
      updateProfileInState(agentId, { ...savedProfile, status });
      setTestMessage(result.message);
    } catch (error) {
      await updateAgentMuxProfileStatus(savedProfile.id, 'offline').catch(() => undefined);
      updateProfileInState(agentId, { ...savedProfile, status: 'offline' });
      setTestMessage(error instanceof Error ? error.message : '连接测试失败');
    } finally {
      setTestingProfileId(null);
    }
  };

  const deleteProfile = async (agentId: string, profile: RuntimeProfile, confirmed = false) => {
    if (!confirmed) {
      setConfirmation({ title: '删除运行配置', description: `${profile.provider} / ${profile.model} 将从 Agent Mux 中移除。`, confirmLabel: '删除', tone: 'danger', action: () => deleteProfile(agentId, profile, true) });
      return;
    }
    try {
      await deleteAgentMuxProfile(profile.id);
    } catch (error) {
      setTestMessage(error instanceof Error ? error.message : '删除 Agent Mux 配置失败');
      return;
    }
    setAgentRecords((current) => current.map((agent) => agent.id === agentId ? { ...agent, profiles: agent.profiles.filter((item) => item.id !== profile.id) } : agent));
  };

  const toggleProfile = async (agentId: string, profile: RuntimeProfile) => {
    if (profile.status === 'disabled') {
      await testProfile(agentId, profile);
      return;
    }
    const status: RuntimeProfile['status'] = 'disabled';
    try {
      await updateAgentMuxProfileStatus(profile.id, status);
    } catch (error) {
      setTestMessage(error instanceof Error ? error.message : '更新 Agent Mux 状态失败');
      return;
    }
    setAgentRecords((current) => current.map((agent) => agent.id === agentId ? { ...agent, profiles: agent.profiles.map((item) => item.id === profile.id ? { ...item, status } : item) } : agent));
  };

  const testProfile = async (agentId: string, profile: RuntimeProfile) => {
    if (testingProfileId) return;
    setTestingProfileId(profile.id);
    setTestMessage(`正在检查 ${profile.provider} / ${profile.model} 对应的 Agent 工具...`);
    try {
      await updateAgentMuxProfileStatus(profile.id, 'busy');
      setAgentRecords((current) => current.map((agent) => agent.id === agentId ? { ...agent, profiles: agent.profiles.map((item) => item.id === profile.id ? { ...item, status: 'busy' } : item) } : agent));
      const result = await probeProfile(agentId, profile);
      const status = result.available ? 'available' : 'offline';
      await updateAgentMuxProfileStatus(profile.id, status);
      setAgentRecords((current) => current.map((agent) => agent.id === agentId ? { ...agent, profiles: agent.profiles.map((item) => item.id === profile.id ? { ...item, status } : item) } : agent));
      setTestMessage(result.message);
    } catch (error) {
      await updateAgentMuxProfileStatus(profile.id, 'offline').catch(() => undefined);
      updateProfileInState(agentId, { ...profile, status: 'offline' });
      setTestMessage(error instanceof Error ? error.message : '连接测试失败');
    } finally {
      setTestingProfileId(null);
    }
  };

  const startRun = async (input: { agentId: string; profile: RuntimeProfile; prompt: string; workingDirectory: string; permissionMode: string }) => {
    if (startingRun) return;
    const agent = agentRecords.find((item) => item.id === input.agentId);
    if (!agent) return;
    const providerId = agentProviderId(input.agentId);
    if (!providerId || providerId === CLAUDE_CODE_PROVIDER_ID || providerId === PI_AGENT_PROVIDER_ID || providerId === OPENCODE_PROVIDER_ID) {
      setTestMessage(`${agent.name} 暂不支持从 Agent Mux 独立启动；当前可运行 Codex、Grok Build、Gemini CLI 和 Hermes Agent。`);
      return;
    }
    setStartingRun(true);
    const startedAt = Date.now();
    let muxRun: RunRecord | null = null;
    try {
      muxRun = await createAgentMuxRun({
        caller: 'CodeM',
        target: agent.name,
        profile: `${input.profile.provider} / ${input.profile.model}`,
        nickname: input.profile.nickname,
        avatar: input.profile.avatar,
        profileId: input.profile.id,
        workingDirectory: input.workingDirectory,
        skill: 'codem-agent-mux',
        status: 'queued',
        duration: '--',
        started: '刚刚',
        prompt: input.prompt,
        summary: '',
      });
      setRunDialogOpen(false);
      setView('monitor');
      selectedRunIdRef.current = muxRun.id;
      setSelectedRunId(muxRun.id);
      setRunRecords((current) => [muxRun!, ...current]);
      const running = await updateAgentMuxRun(muxRun.id, { status: 'running' });
      muxRun = running;
      setRunRecords((current) => current.map((run) => run.id === running.id ? running : run));
      setMetrics((current) => ({ ...current, running: current.running + 1, todayCalls: current.todayCalls + 1 }));
      const { response, providerRunId } = await startAgentMuxProviderRun({
        providerId,
        channelId: input.profile.channelId,
        prompt: input.prompt,
        workingDirectory: input.workingDirectory,
        model: input.profile.model,
        reasoningEffort: input.profile.reasoningEffort,
        permissionMode: input.permissionMode,
      });
      if (providerRunId) {
        const identified = await updateAgentMuxRun(muxRun.id, { providerRunId });
        muxRun = identified;
        setRunRecords((current) => current.map((run) => run.id === identified.id ? identified : run));
      }
      let transcriptTurn = buildAgentMuxConversationTurn(muxRun, []);
      setLiveRunTurns((current) => ({ ...current, [muxRun!.id]: transcriptTurn }));
      let pendingEvent: AgentRunEvent | null = null;
      const terminal = { status: null as RunStatus | null };
      const persistEvent = async (agentEvent: AgentRunEvent) => {
        const storedEvent = await createAgentMuxRunEvent(muxRun!.id, agentEvent);
        if (selectedRunIdRef.current === muxRun!.id) setRunEventsById((current) => ({ ...current, [muxRun!.id]: [...(current[muxRun!.id] ?? []), storedEvent] }));
      };
      const flushPendingEvent = async () => {
        if (!pendingEvent) return;
        const event = pendingEvent;
        pendingEvent = null;
        await persistEvent(event);
      };
      await consumeAgentRunEventStream(response, async (event) => {
        transcriptTurn = applyAgentRunEventToTurn(transcriptTurn, event);
        const liveTurn = transcriptTurn;
        setLiveRunTurns((current) => ({ ...current, [muxRun!.id]: liveTurn }));
        if (shouldPersistAgentRunTranscriptEvent(event)) {
          if (isAgentRunTranscriptDeltaEvent(event)) {
            const coalesced = coalesceAgentRunTranscriptEvent(pendingEvent, event);
            if (coalesced) {
              pendingEvent = coalesced;
            } else {
              await flushPendingEvent();
              pendingEvent = event;
            }
            if (JSON.stringify(pendingEvent).length >= 8_000) {
              await flushPendingEvent();
            }
          } else {
            await flushPendingEvent();
            await persistEvent(event);
          }
        }

        if (isAgentRunBlockingEvent(event)) {
          terminal.status = 'waiting';
          return false;
        }

        if (isAgentRunTerminalEvent(event)) {
          terminal.status = transcriptTurn.status === 'error'
            ? 'failed'
            : transcriptTurn.status === 'stopped'
              ? 'cancelled'
              : 'completed';
        }
        return true;
      });
      await flushPendingEvent();
      const status: RunStatus = terminal.status ?? 'failed';
      const duration = formatRunDuration(Date.now() - startedAt);
      const summary = (transcriptTurn.assistantText.trim() || transcriptTurn.activity || (status === 'waiting' ? '等待用户处理' : status === 'completed' ? '任务已完成' : status === 'cancelled' ? '任务已取消' : 'Agent 流未返回完成事件')).slice(0, 500);
      const updated = await updateAgentMuxRun(muxRun.id, { status, duration, summary });
      setRunRecords((current) => current.map((run) => run.id === updated.id ? updated : run));
      setMetrics((await getAgentMuxOverview()).metrics);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent Mux 运行失败';
      if (muxRun) {
        const storedError = await createAgentMuxRunEvent(muxRun.id, { type: 'error', runId: muxRun.providerRunId ?? muxRun.id, message }).catch(() => null);
        if (storedError && selectedRunIdRef.current === muxRun.id) setRunEventsById((current) => ({ ...current, [muxRun!.id]: [...(current[muxRun!.id] ?? []), storedError] }));
        const failed = await updateAgentMuxRun(muxRun.id, { status: 'failed', duration: formatRunDuration(Date.now() - startedAt), summary: message }).catch(() => null);
        if (failed) setRunRecords((current) => current.map((run) => run.id === failed.id ? failed : run));
      }
      setTestMessage(message);
    } finally {
      if (muxRun) {
        setLiveRunTurns((current) => {
          const next = { ...current };
          delete next[muxRun!.id];
          return next;
        });
      }
      setStartingRun(false);
    }
  };

  const cancelRun = async (run: RunRecord) => {
    if (run.status !== 'running' || !run.providerRunId) return;
    try {
      await cancelAgentMuxProviderRun(run.providerRunId);
      await createAgentMuxRunEvent(run.id, { type: 'done', runId: run.providerRunId, result: '', stopReason: 'cancelled' });
      const updated = await updateAgentMuxRun(run.id, { status: 'cancelled', summary: '任务已取消' });
      setRunRecords((current) => current.map((item) => item.id === updated.id ? updated : item));
      setLiveRunTurns((current) => {
        const next = { ...current };
        delete next[run.id];
        return next;
      });
      setMetrics((await getAgentMuxOverview()).metrics);
    } catch (error) {
      setTestMessage(error instanceof Error ? error.message : '取消 Agent 运行失败');
    }
  };

  const stopRuntime = async (confirmed = false) => {
    if (!runtimeInfo.runtimeManaged) return;
    if (!confirmed) {
      setConfirmation({ title: '停止 Agent Mux Runtime', description: '停止后，下一次外部调用会重新按需启动。', confirmLabel: '停止 Runtime', tone: 'danger', action: () => stopRuntime(true) });
      return;
    }
    try {
      await stopAgentMuxRuntime();
      setRuntimeInfo((current) => ({ ...current, runtimeManaged: false }));
      setBackendStatus('offline');
    } catch (error) {
      setTestMessage(error instanceof Error ? error.message : '停止 Agent Mux Runtime 失败');
    }
  };

  return (
    <section className="agent-mux-prototype">
      <header className="agent-mux-header">
        <div className="agent-mux-title-block">
          <h1>Agent Hub</h1>
          <p>配置可调用 Agent，编排工作流，并集中监控运行状态。</p>
        </div>
        <div className="agent-mux-header-metrics">
          <Metric label="运行中" value={String(metrics.running)} accent />
          <Metric label="可用 Agent" value={String(metrics.availableAgents)} />
          <Metric label="今日调用" value={String(metrics.todayCalls)} />
          <Metric label="成功率" value={metrics.successRate == null ? '--' : `${metrics.successRate.toFixed(1)}%`} success={metrics.successRate != null} />
        </div>
        <div className="agent-mux-header-actions"><button type="button" className="agent-mux-secondary-button" onClick={() => setRunDialogOpen(true)} disabled={availableProfiles.length === 0 || startingRun}><Send size={15} />运行任务</button><button type="button" className="agent-mux-primary-button" onClick={() => { const agent = selectedAgent ?? agentRecords[0]; if (!agent) return; setView('agents'); setProfileDialog({ agentId: agent.id, allowAgentSelection: true }); }} disabled={agentRecords.length === 0}><Plus size={15} />添加配置</button></div>
      </header>

      <div className="agent-mux-toolbar">
        <nav className="agent-mux-tabs" aria-label="Agent Hub 页面">
          <Tab active={view === 'overview'} icon={Activity} label="概览" onClick={() => setView('overview')} />
          <Tab active={view === 'agents'} icon={Bot} label="Agent Mux" onClick={() => setView('agents')} />
          <Tab active={view === 'workflows'} icon={Workflow} label="工作流" onClick={() => setView('workflows')} />
          <Tab active={view === 'monitor'} icon={Radio} label="运行监控" onClick={() => setView('monitor')} />
          <Tab active={view === 'skill'} icon={Sparkles} label="Agent Mux Skill" onClick={() => setView('skill')} />
        </nav>
        <div className="agent-mux-toolbar-actions">
          <span className={`agent-mux-live${backendStatus === 'offline' ? ' offline' : ''}`}><span />{backendStatus === 'connected' ? '后台服务已连接' : backendStatus === 'connecting' ? '正在连接后台服务' : '后台服务未连接'}</span>
          <button type="button" title="Hub 设置" onClick={() => setView('skill')}><Settings2 size={15} /></button>
        </div>
      </div>

      {view === 'overview' ? <OverviewView agents={agentRecords} runs={runRecords} metrics={metrics} onOpenRuns={() => setView('monitor')} onOpenRun={(runId) => { selectedRunIdRef.current = runId; setSelectedRunId(runId); setView('monitor'); }} onOpenAgents={() => setView('agents')} onOpenSkill={() => setView('skill')} /> : null}
      {view === 'agents' ? (agentRecords.length > 0 ? <AgentsView agents={agentRecords} selected={selectedAgent} selectedId={selectedAgentId} profiles={agentRecords.reduce((count, agent) => count + agent.profiles.length, 0)} onSelect={setSelectedAgentId} onAddProfile={(agentId) => setProfileDialog({ agentId: agentId ?? selectedAgent?.id ?? agentRecords[0].id, allowAgentSelection: !agentId })} onEditProfile={(agentId, profile) => setProfileDialog({ agentId, profile })} onDeleteProfile={deleteProfile} onToggleProfile={toggleProfile} onTestProfile={testProfile} testingProfileId={testingProfileId} testMessage={testMessage} /> : <EmptyState title="暂无 Agent 配置" detail="后端未返回可管理的 Agent 配置。" />) : null}
      {view === 'workflows' ? <Suspense fallback={<div className="workflow-loading">正在加载工作流画布...</div>}><WorkflowPrototype agentRecords={agentRecords} workingDirectory={projects.find((project) => project.id === activeProjectId)?.path ?? ''} /></Suspense> : null}
      {view === 'monitor' ? <MonitorView agents={agentRecords} runs={runRecords} projects={projects} selected={selectedRun} conversationRuns={selectedConversationRuns} eventsByRunId={runEventsById} liveTurns={liveRunTurns} onSelect={(runId) => { selectedRunIdRef.current = runId; setSelectedRunId(runId); }} onCancel={cancelRun} /> : null}
      {view === 'skill' ? <SkillView agents={agentRecords} skillText={skillText} copied={copied} source={skillSource} targets={skillInstallTargets} installPending={skillInstallPending} installMessage={skillInstallMessage} copiedPath={copiedSkillPath} copiedInstruction={copiedInstallInstruction} cliPath={runtimeInfo.cliPath} runtimeManaged={runtimeInfo.runtimeManaged} onCopy={copySkill} onCopyPath={copySkillPath} onCopyInstruction={copyInstallInstruction} onInstall={installSkillTarget} onInstallAll={installSkillToAll} onExport={exportSkill} onStopRuntime={stopRuntime} /> : null}
      {profileDialog ? <AddRuntimeProfileDialog key={`${profileDialog.agentId}:${profileDialog.profile?.id ?? 'new'}`} agent={agentRecords.find((agent) => agent.id === profileDialog.agentId) ?? agentRecords[0]} agents={agentRecords} profile={profileDialog.profile} allowAgentSelection={profileDialog.allowAgentSelection === true} channels={agentChannels} systemChannels={agentSystemChannels} providerAvailability={skillProviderAvailability} onAgentChange={(agentId) => setProfileDialog((current) => current ? { ...current, agentId } : current)} onClose={() => setProfileDialog(null)} onTest={probeProfile} onSave={saveProfile} /> : null}
      {runDialogOpen ? <RunTaskDialog agents={agentRecords} projects={projects} activeProjectId={activeProjectId} starting={startingRun} onClose={() => setRunDialogOpen(false)} onStart={startRun} /> : null}
      {confirmation ? <AgentMuxConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)} onConfirm={() => { const action = confirmation.action; setConfirmation(null); void action(); }} /> : null}
    </section>
  );
}

function OverviewView({ agents: agentItems, runs: items, metrics, onOpenRuns, onOpenRun, onOpenAgents, onOpenSkill }: { agents: AgentRecord[]; runs: RunRecord[]; metrics: AgentMuxMetrics; onOpenRuns: () => void; onOpenRun: (runId: string) => void; onOpenAgents: () => void; onOpenSkill: () => void }) {
  return (
    <div className="agent-mux-page agent-mux-overview-page">
      <div className="agent-mux-overview-hero">
        <div>
          <span className="agent-mux-eyebrow">AGENT MUX</span>
          <h2>让主 Agent 按需调用合适的执行 Agent</h2>
          <p>配置一次 Agent 组合，一键安装 Skill 到本机 Agent，CodeM 负责路由、执行和监控。</p>
        </div>
        <div className="agent-mux-hero-actions">
          <button type="button" className="agent-mux-primary-button" onClick={onOpenSkill}><Download size={15} />安装 Agent Mux Skill</button>
          <button type="button" className="agent-mux-secondary-button" onClick={onOpenAgents}><Settings2 size={15} />配置 Agent</button>
        </div>
      </div>
      <div className="agent-mux-overview-grid">
        <section className="agent-mux-panel agent-mux-call-panel">
          <PanelHeading title="主 Agent 调用" meta="实时" icon={Activity} action={<button type="button" onClick={onOpenRuns}>查看全部 <ChevronRight size={13} /></button>} />
          <div className="agent-mux-call-list">
            {items.length > 0 ? items.slice(0, 3).map((run) => <CallRow key={run.id} run={run} onOpen={() => onOpenRun(run.id)} />) : <EmptyState title="暂无调用记录" detail="接入真实 Agent 调用后，运行记录会显示在这里。" />}
          </div>
        </section>
        <section className="agent-mux-panel agent-mux-health-panel">
          <PanelHeading title="Agent 健康状态" meta={`${metrics.availableAgents} / ${agentItems.length} 可用`} icon={Gauge} action={<button type="button" onClick={onOpenAgents}>管理配置 <ChevronRight size={13} /></button>} />
          <div className="agent-mux-health-list">
            {agentItems.map((agent) => <HealthRow key={agent.id} agent={agent} />)}
          </div>
        </section>
      </div>
    </div>
  );
}

function AgentsView({ agents: agentItems, selected, selectedId, onSelect, profiles, onAddProfile, onEditProfile, onDeleteProfile, onToggleProfile, onTestProfile, testingProfileId, testMessage }: { agents: AgentRecord[]; selected: AgentRecord | null; selectedId: string; onSelect: (id: string) => void; profiles: number; onAddProfile: (agentId?: string) => void; onEditProfile: (agentId: string, profile: RuntimeProfile) => void; onDeleteProfile: (agentId: string, profile: RuntimeProfile) => void; onToggleProfile: (agentId: string, profile: RuntimeProfile) => void; onTestProfile: (agentId: string, profile: RuntimeProfile) => void; testingProfileId: string | null; testMessage: string | null }) {
  const isAll = selectedId === ALL_AGENTS_ID;
  const displayedProfiles = isAll
    ? agentItems.flatMap((agent) => agent.profiles.map((profile) => ({ agent, profile })))
    : selected?.profiles.map((profile) => ({ agent: selected, profile })) ?? [];
  return (
    <div className="agent-mux-page agent-mux-split-page">
      <div className="agent-mux-list-panel">
        <div className="agent-mux-list-header"><div><h2>Agent 配置</h2><p>具体 Agent 工具及其供应商、模型组合。</p></div><button type="button" className="agent-mux-icon-button" title="添加运行配置" onClick={() => onAddProfile()}><Plus size={16} /></button></div>
        <label className="agent-mux-search"><Search size={14} /><input placeholder="搜索 Agent" /></label>
        <div className="agent-mux-agent-list">
          <button type="button" className={`agent-mux-agent-item${isAll ? ' selected' : ''}`} onClick={() => onSelect(ALL_AGENTS_ID)}><span className="agent-mux-agent-mark"><Terminal size={17} /></span><span className="agent-mux-agent-copy"><strong>全部配置</strong><small>{agentItems.length} 个 Agent · {profiles} 个运行配置</small></span><ChevronRight size={15} /></button>
          {agentItems.map((agent) => <button type="button" key={agent.id} className={`agent-mux-agent-item${selectedId === agent.id ? ' selected' : ''}`} onClick={() => onSelect(agent.id)}><span className="agent-mux-agent-mark" data-provider={agent.id}><AgentProviderIcon providerId={agentProviderId(agent.id) ?? agent.id} size={17} /></span><span className="agent-mux-agent-copy"><strong>{agent.name}</strong><small>{agent.profiles.length} 个运行配置 · {agent.tags.slice(0, 2).join(' · ')}</small></span><span className="agent-mux-status-dot" data-status={agent.profiles.some((profile) => profile.status === 'available') ? 'available' : 'offline'} /><ChevronRight size={15} /></button>)}
        </div>
        <div className="agent-mux-list-footer"><span><Bot size={13} />{agentItems.length} 个 Agent</span><span><Terminal size={13} />{profiles} 个配置</span></div>
      </div>
      <div className="agent-mux-detail-panel">
        <div className="agent-mux-detail-heading"><div><span className="agent-mux-detail-kicker">{isAll ? 'ALL CONFIGURATIONS' : 'AGENT TYPE'}</span><h2>{isAll ? '全部配置' : selected?.name}</h2><p>{isAll ? `${agentItems.length} 个 Agent · ${profiles} 个运行配置` : selected?.description}</p></div></div>
        {!isAll && selected ? <div className="agent-mux-tag-row">{selected.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
        <section className="agent-mux-detail-section"><div className="agent-mux-section-title"><div><h3>运行配置</h3><p>{isAll ? '集中维护所有 Agent 的供应商和模型组合。' : '同一个 Agent 可以连接多个供应商和模型。'}</p></div><button type="button" className="agent-mux-secondary-button" onClick={() => onAddProfile(isAll ? undefined : selected?.id)}><Plus size={14} />添加配置</button></div>{testMessage ? <div className="agent-mux-inline-message"><CheckCircle2 size={14} />{testMessage}</div> : null}<div className="agent-mux-profile-table"><div className="agent-mux-table-head"><span>供应商 / 模型</span><span>等级</span><span>用途</span><span>状态</span><span>操作</span></div>{displayedProfiles.map(({ agent, profile }) => <ProfileRow key={`${agent.id}:${profile.id}`} agentId={agent.id} agentName={isAll ? agent.name : undefined} profile={profile} onEdit={() => onEditProfile(agent.id, profile)} onDelete={() => onDeleteProfile(agent.id, profile)} onToggle={() => onToggleProfile(agent.id, profile)} onTest={() => onTestProfile(agent.id, profile)} testing={testingProfileId === profile.id} />)}</div></section>
      </div>
    </div>
  );
}

function MonitorView({ agents, runs: items, projects, selected, conversationRuns, eventsByRunId, liveTurns, onSelect, onCancel }: { agents: AgentRecord[]; runs: RunRecord[]; projects: ProjectSummary[]; selected?: RunRecord; conversationRuns: RunRecord[]; eventsByRunId: Record<string, AgentMuxRunEvent[]>; liveTurns: Record<string, AgentMuxConversationTurn>; onSelect: (id: string) => void; onCancel: (run: RunRecord) => Promise<void> }) {
  const [collapsedWorkspaceKeys, setCollapsedWorkspaceKeys] = useState<Set<string>>(() => new Set());
  const conversationItems = useMemo(() => groupAgentMuxRunsByConversation(items).map((runs) => runs[0]), [items]);
  const runningCount = conversationItems.filter((run) => run.status === 'running').length;
  const failedCount = conversationItems.filter((run) => run.status === 'failed').length;
  const workspaceGroups = useMemo(() => groupAgentMuxRunsByWorkspace(conversationItems, projects), [conversationItems, projects]);
  const selectedConversationKey = selected ? agentMuxConversationKey(selected) : null;
  const toggleWorkspaceGroup = (key: string) => setCollapsedWorkspaceKeys((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const selectedAgentId = selected ? agentIdForRun(selected, agents) : '';
  return <div className="agent-mux-page agent-mux-split-page agent-mux-monitor-page"><div className="agent-mux-list-panel"><div className="agent-mux-list-header"><div><h2>运行监控</h2><p>按工作区查看所有 Agent Mux 调用。</p></div><button type="button" className="agent-mux-icon-button" title="刷新" onClick={() => selected && onSelect(selected.id)}><RefreshCw size={15} /></button></div><div className="agent-mux-filter-bar"><span className="active">全部 {conversationItems.length}</span><span>运行中 {runningCount}</span><span>失败 {failedCount}</span></div><div className="agent-mux-run-list">{workspaceGroups.length > 0 ? workspaceGroups.map((group) => { const expanded = !collapsedWorkspaceKeys.has(group.key); return <section className="agent-mux-workspace-group" key={group.key}><button type="button" className="agent-mux-workspace-group-head" aria-expanded={expanded} onClick={() => toggleWorkspaceGroup(group.key)}><ChevronRight className={`agent-mux-workspace-chevron${expanded ? ' is-expanded' : ''}`} size={13} /><FolderOpen size={14} /><span><strong>{group.name}</strong><small title={group.path}>{group.path}</small></span><b>{group.runs.length}</b></button>{expanded ? group.runs.map((run) => { const agentId = agentIdForRun(run, agents); const providerId = agentProviderId(agentId) ?? agentId; const selectedConversation = selected?.id === run.id || Boolean(selectedConversationKey && agentMuxConversationKey(run) === selectedConversationKey); return <button type="button" key={run.id} className={`agent-mux-run-item${selectedConversation ? ' selected' : ''}`} onClick={() => onSelect(run.id)} title={`${run.target} · ${run.profile}`}><RunIcon status={run.status} /><AgentMuxAvatar avatar={run.avatar} providerId={providerId} size="small" /><span><strong>{runDisplayName(run)}</strong><small>{run.target} · {run.profile}</small></span><RunStartedTime run={run} /></button>; }) : null}</section>; }) : <EmptyState title="暂无运行记录" detail="真实 Agent 调用产生记录后，会在这里显示状态和输出。" />}</div></div><div className="agent-mux-detail-panel">{selected ? <AgentMuxRunDetail runs={conversationRuns} eventsByRunId={eventsByRunId} liveTurns={liveTurns} providerId={agentProviderId(selectedAgentId) ?? selectedAgentId} onCancel={() => onCancel(selected)} /> : items.length === 0 ? <EmptyState icon={Activity} title="暂无运行记录" detail="运行 Agent 任务后，这里会显示提示词、执行过程和结果。" /> : null}</div></div>;
}

export function AgentMuxRunDetail({ runs, eventsByRunId, liveTurns, run, events, liveTurn, providerId, onCancel, onBack }: { runs?: RunRecord[]; eventsByRunId?: Record<string, AgentMuxRunEvent[]>; liveTurns?: Record<string, AgentMuxConversationTurn>; run?: RunRecord; events?: AgentMuxRunEvent[]; liveTurn?: AgentMuxConversationTurn; providerId: string; onCancel?: () => void | Promise<void>; onBack?: () => void }) {
  const timelineRuns = runs?.length ? runs : run ? [run] : [];
  const latest = timelineRuns[timelineRuns.length - 1];
  if (!latest) return null;
  const timelineEvents = eventsByRunId ?? (run ? { [run.id]: events ?? [] } : {});
  const timelineTurns = liveTurns ?? (run && liveTurn ? { [run.id]: liveTurn } : {});
  return <>{onBack ? <button type="button" className="agent-mux-workbench-back" onClick={onBack}><ArrowLeft size={15} />返回</button> : null}<div className="agent-mux-detail-heading"><div className="agent-mux-detail-title"><AgentMuxAvatar avatar={latest.avatar} providerId={providerId} size="large" /><div><div className="agent-mux-detail-name-row"><h2>{runDisplayName(latest)}</h2><span className="agent-mux-detail-status" data-status={latest.status}>{runLabel(latest.status)}</span></div><div className="agent-mux-detail-meta"><span title={latest.profile}>{latest.profile}</span><span>调用方 {latest.caller}</span><span>{timelineRuns.length} 轮</span><span className="agent-mux-detail-run-id" title={`${latest.id} · ${latest.skill}`}>{latest.id} · {latest.skill}</span></div></div></div>{latest.status === 'running' && latest.providerRunId && onCancel ? <button type="button" className="agent-mux-stop-button" title="取消运行" aria-label="取消运行" onClick={() => void onCancel()}><Square size={13} fill="currentColor" /></button> : null}</div><div className="conversation agent-mux-conversation-log">{timelineRuns.map((item) => <AgentMuxRunLog key={item.id} run={item} events={timelineEvents[item.id] ?? []} liveTurn={timelineTurns[item.id]} />)}</div></>;
}

export function AgentMuxRunLog({ run, events, liveTurn }: { run: RunRecord; events: AgentMuxRunEvent[]; liveTurn?: AgentMuxConversationTurn }) {
  const storedTurn = useMemo(() => buildAgentMuxConversationTurn(run, events), [events, run]);
  const turn = liveTurn ?? storedTurn;
  return (
    <ConversationTurnView
        turn={turn}
        nowMs={Date.now()}
        isLiveRunning={run.status === 'running'}
        isLatest={false}
        previousTurns={[]}
        canUndoChangedFiles={false}
        activeProject={null}
        attachmentPreviewScope="desktop"
        collapseIntermediateProcess={false}
        thinkingLabel="Thinking"
        onOpenWorkbenchPreview={() => undefined}
        onOpenOutputPath={async () => undefined}
        onRevealOutputPath={async () => undefined}
        onOpenWebLink={async (url) => { await openExternalUrl(url); }}
        onCopyWebLink={async (url) => { await navigator.clipboard.writeText(url); }}
        onUndoChangedFiles={() => undefined}
        onSubmitRequestUserInput={async () => false}
        onSubmitRuntimeRecoveryAction={async () => false}
        onSubmitApprovalDecision={async () => false}
    />
  );
}

type SkillViewProps = {
  agents: AgentRecord[];
  skillText: string;
  copied: boolean;
  source: AgentMuxSkillSource | null;
  targets: SkillInstallTarget[];
  installPending: string[];
  installMessage: { tone: 'success' | 'error' | 'info'; text: string } | null;
  copiedPath: boolean;
  copiedInstruction: boolean;
  cliPath: string;
  runtimeManaged: boolean;
  onCopy: () => void;
  onCopyPath: () => void;
  onCopyInstruction: () => void;
  onInstall: (target: SkillInstallTarget) => Promise<void>;
  onInstallAll: () => Promise<void>;
  onExport: () => void;
  onStopRuntime: () => Promise<void>;
};

function SkillView({ agents, skillText, copied, source, targets, installPending, installMessage, copiedPath, copiedInstruction, cliPath, runtimeManaged, onCopy, onCopyPath, onCopyInstruction, onInstall, onInstallAll, onExport, onStopRuntime }: SkillViewProps) {
  const profileCount = agents.reduce((total, agent) => total + agent.profiles.length, 0);
  const availableTargets = targets.filter((target) => target.available);
  const installedCount = targets.filter((target) => target.available && target.state === 'installed').length;
  const pending = installPending.length > 0;
  return (
    <div className="agent-mux-page agent-mux-split-page agent-mux-skill-page">
      <div className="agent-mux-skill-summary">
        <div className="agent-mux-skill-hero">
          <div className="agent-mux-icon-box purple"><Sparkles size={20} /></div>
          <div><span className="agent-mux-detail-kicker">唯一对外 Skill</span><h2>codem-agent-mux</h2><p>让其他 Agent 发现并调用 CodeM 中配置的所有 Agent。</p></div>
          <span className="agent-mux-published"><CheckCircle2 size={13} />已生成</span>
        </div>
        <div className="agent-mux-skill-stat-grid">
          <Metric label="已识别 Agent" value={String(availableTargets.length)} />
          <Metric label="已安装" value={String(installedCount)} success={installedCount > 0} />
          <Metric label="可调用配置" value={String(profileCount)} />
          <Metric label="Skill 源" value={source ? '已同步' : '同步中'} accent={!source} />
        </div>
        <section className="agent-mux-skill-installer" aria-labelledby="agent-mux-skill-install-title">
          <div className="agent-mux-skill-installer-head">
            <div><h3 id="agent-mux-skill-install-title">安装到本机 Agent</h3><p>{installedCount > 0 ? `已安装到 ${installedCount} 个 Agent` : '选择已识别的 Agent 直接安装'}</p></div>
            <button type="button" className="agent-mux-primary-button" disabled={!source || availableTargets.length === 0 || pending} onClick={() => void onInstallAll()}>{pending ? <RefreshCw className="agent-mux-spin" size={14} /> : <Download size={14} />}安装到全部</button>
          </div>
          <div className="agent-mux-skill-targets" aria-label="Skill 安装目标">
            {targets.map((target) => {
              const isPending = installPending.includes(target.providerId);
              const disabled = !source || !target.available || target.state === 'installed' || pending;
              const title = !target.available
                ? `${target.label} 未检测到`
                : target.state === 'installed'
                  ? `${target.label} 已安装`
                  : target.state === 'update-available'
                    ? `${target.label} 可更新，点击更新`
                    : `${target.label} 未安装，点击安装`;
              return (
                <button key={target.providerId} type="button" className="agent-mux-skill-target" data-provider={target.providerId} data-state={!target.available ? 'unavailable' : target.state} disabled={disabled} title={title} aria-label={title} onClick={() => void onInstall(target)}>
                  <span className="agent-mux-skill-target-icon">{isPending ? <RefreshCw className="agent-mux-spin" size={17} /> : <AgentProviderIcon providerId={target.providerId} size={17} />}</span>
                  <span>{target.label}</span>
                  {target.state === 'installed' ? <CheckCircle2 className="agent-mux-skill-target-check" size={12} /> : target.state === 'update-available' && target.available ? <span className="agent-mux-skill-update-dot" /> : null}
                </button>
              );
            })}
          </div>
          {installMessage ? <div className="agent-mux-skill-install-message" data-tone={installMessage.tone} role={installMessage.tone === 'error' ? 'alert' : 'status'} aria-live="polite">{installMessage.tone === 'error' ? <CircleAlert size={14} /> : installMessage.tone === 'success' ? <CheckCircle2 size={14} /> : <RefreshCw className={pending ? 'agent-mux-spin' : ''} size={14} />}<span>{installMessage.text}</span></div> : null}
        </section>
        <div className="agent-mux-runtime-status"><span className={`agent-mux-status-dot${runtimeManaged ? ' is-active' : ''}`} /><div><strong>{runtimeManaged ? 'Runtime 运行中' : 'Runtime 未由桌面管理'}</strong><small title={cliPath}>{cliPath}</small></div>{runtimeManaged ? <button type="button" className="agent-mux-stop-button agent-mux-runtime-stop-button" title="停止 Runtime" aria-label="停止 Runtime" onClick={() => void onStopRuntime()}><Square size={10} fill="currentColor" /></button> : null}</div>
        <div className="agent-mux-skill-source-row">
          <FolderOpen size={15} />
          <div className="agent-mux-path-content"><strong>Skill 源目录</strong><small title={source?.sourceFile}>{source?.sourceDirectory ?? '正在生成…'}</small></div>
          <div className="agent-mux-skill-source-actions">
            <button type="button" className="agent-mux-secondary-button agent-mux-skill-copy-button" disabled={!source} onClick={onCopyPath}>{copiedPath ? <Check size={14} /> : <Copy size={14} />}{copiedPath ? '已复制路径' : '复制路径'}</button>
            <button type="button" className="agent-mux-secondary-button agent-mux-skill-copy-button" disabled={!source} onClick={onCopyInstruction}>{copiedInstruction ? <Check size={14} /> : <Clipboard size={14} />}{copiedInstruction ? '已复制指令' : '复制安装指令'}</button>
          </div>
        </div>
      </div>
      <div className="agent-mux-skill-preview">
        <div className="agent-mux-preview-head"><span>SKILL.md 预览</span><div><button type="button" title="导出 SKILL.md" aria-label="导出 SKILL.md" onClick={onExport}><Download size={14} /></button><button type="button" title="复制完整内容" aria-label="复制完整内容" onClick={onCopy}>{copied ? <Check size={14} /> : <Copy size={14} />}</button></div></div>
        <pre>{skillText}</pre>
      </div>
    </div>
  );
}

function RunTaskDialog({ agents, projects, activeProjectId, starting, onClose, onStart }: { agents: AgentRecord[]; projects: ProjectSummary[]; activeProjectId: string | null; starting: boolean; onClose: () => void; onStart: (input: { agentId: string; profile: RuntimeProfile; prompt: string; workingDirectory: string; permissionMode: string }) => Promise<void> }) {
  const choices = agents.flatMap((agent) => agent.profiles.filter((profile) => profile.status === 'available' && ['codex', 'grok', 'opencode', 'gemini', 'hermes'].includes(agent.id)).map((profile) => ({ agent, profile })));
  const [choiceId, setChoiceId] = useState(choices[0] ? `${choices[0].agent.id}:${choices[0].profile.id}` : '');
  const [workspaceId, setWorkspaceId] = useState(activeProjectId && projects.some((project) => project.id === activeProjectId) ? activeProjectId : projects[0]?.id ?? '');
  const [permissionMode, setPermissionMode] = useState('default');
  const [prompt, setPrompt] = useState('');
  const choice = choices.find((item) => `${item.agent.id}:${item.profile.id}` === choiceId);
  const workspace = projects.find((project) => project.id === workspaceId);
  return <div className="agent-mux-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !starting) onClose(); }}><aside className="agent-mux-config-drawer" role="dialog" aria-modal="true" aria-labelledby="agent-mux-run-title"><div className="agent-mux-drawer-header"><div><span className="agent-mux-detail-kicker">REAL AGENT RUN</span><h2 id="agent-mux-run-title">运行 Agent 任务</h2><p>使用已检测可用的运行配置，并把公开输出写入监控。</p></div><button type="button" className="agent-mux-icon-button" title="关闭" onClick={onClose} disabled={starting}><X size={16} /></button></div><div className="agent-mux-drawer-body"><label className="agent-mux-form-field"><span>运行配置</span><StandardSelect ariaLabel="选择运行配置" value={choiceId} placeholder="选择可用配置" className="agent-mux-select" triggerClassName="agent-mux-select-trigger" menuClassName="agent-mux-select-menu" optionClassName="agent-mux-select-option" offset={7} options={choices.map(({ agent, profile }) => ({ value: `${agent.id}:${profile.id}`, label: `${profileDisplayName(profile)} · ${agent.name} · ${profile.provider} / ${profile.model}` }))} onChange={setChoiceId} /></label><label className="agent-mux-form-field"><span>工作区</span><StandardSelect ariaLabel="选择工作区" value={workspaceId} placeholder={projects.length > 0 ? '选择工作区' : '暂无工作区'} disabled={projects.length === 0} className="agent-mux-select" triggerClassName="agent-mux-select-trigger" menuClassName="agent-mux-select-menu" optionClassName="agent-mux-select-option" offset={7} options={projects.map((project) => ({ value: project.id, label: `${project.name} · ${project.path}` }))} onChange={setWorkspaceId} />{workspace ? <small className="agent-mux-selected-workspace-path" title={workspace.path}>{workspace.path}</small> : null}</label><label className="agent-mux-form-field"><span>权限模式</span><StandardSelect ariaLabel="选择权限模式" value={permissionMode} className="agent-mux-select" triggerClassName="agent-mux-select-trigger" menuClassName="agent-mux-select-menu" optionClassName="agent-mux-select-option" offset={7} options={[{ value: 'default', label: '默认' }, { value: 'auto', label: '自动执行' }, { value: 'bypassPermissions', label: '完全访问' }]} onChange={setPermissionMode} /></label><label className="agent-mux-form-field"><span>任务内容</span><textarea className="agent-mux-task-input" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述要交给 Agent 完成的任务" /></label><div className="agent-mux-form-note"><ShieldCheck size={15} /><span>运行使用 Agent 设置中的渠道凭据；Agent Mux 不复制或保存 API Key。</span></div></div><div className="agent-mux-drawer-footer"><button type="button" className="agent-mux-secondary-button" onClick={onClose} disabled={starting}>取消</button><button type="button" className="agent-mux-primary-button" disabled={!choice || !prompt.trim() || !workspace || starting} onClick={() => choice && workspace && void onStart({ agentId: choice.agent.id, profile: choice.profile, prompt: prompt.trim(), workingDirectory: workspace.path, permissionMode })}><Send size={14} />{starting ? '启动中' : '开始运行'}</button></div></aside></div>;
}

function AgentMuxConfirmDialog({ confirmation, onClose, onConfirm }: { confirmation: Confirmation; onClose: () => void; onConfirm: () => void }) {
  return <div className="dialog-backdrop agent-mux-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="dialog-card agent-mux-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-mux-confirm-title"><div className="dialog-head"><h3 id="agent-mux-confirm-title">{confirmation.title}</h3><p>{confirmation.description}</p></div><div className="dialog-actions"><button type="button" className="dialog-button secondary" onClick={onClose}>取消</button><button type="button" className={`dialog-button ${confirmation.tone}`} onClick={onConfirm}>{confirmation.confirmLabel}</button></div></div></div>;
}

function AddRuntimeProfileDialog({ agent, agents, profile, allowAgentSelection, channels, systemChannels, providerAvailability, onAgentChange, onClose, onTest, onSave }: { agent: AgentRecord; agents: AgentRecord[]; profile?: RuntimeProfile; allowAgentSelection: boolean; channels: AgentChannel[]; systemChannels: AgentSystemChannel[]; providerAvailability: Record<string, boolean>; onAgentChange: (agentId: string) => void; onClose: () => void; onTest: (agentId: string, profile: RuntimeProfile) => Promise<{ available: boolean; message: string }>; onSave: (profile: RuntimeProfile, connectionVerified: boolean) => void }) {
  const providerId = agentProviderId(agent.id);
  const availableChannels = providerId ? channels.filter((channel) => channel.providerId === providerId && channel.enabled) : [];
  const availableSystemChannels = providerId ? systemChannels.filter((channel) => channel.providerId === providerId && channel.configured) : [];
  const channelOptions = [...availableSystemChannels.map((channel) => ({ id: 'system', name: channel.name || '系统渠道', provider: channel.ccSwitchProviderName?.trim() || providerLabel(providerId ?? '') })), ...availableChannels.map((channel) => ({ id: channel.id, name: channel.name, provider: providerLabel(channel.providerId) }))];
  const initialChannel = channelOptions.find((channel) => channel.id === (profile?.channelId ?? 'system')) ?? channelOptions[0];
  const [channelId, setChannelId] = useState(profile?.channelId ?? initialChannel?.id ?? '');
  const selectedChannel = channelOptions.find((channel) => channel.id === channelId) ?? initialChannel;
  const selectedSystemChannel = channelId === 'system' ? availableSystemChannels[0] : undefined;
  const selectedAgentChannel = channelId === 'system' ? undefined : availableChannels.find((channel) => channel.id === channelId);
  const [nativeModelCatalog, setNativeModelCatalog] = useState<AgentModelCatalog | null | undefined>(undefined);
  useEffect(() => {
    if (!providerId || providerAvailability[providerId] !== true) {
      setNativeModelCatalog(null);
      return;
    }
    if (providerId === CLAUDE_CODE_PROVIDER_ID) {
      setNativeModelCatalog(null);
      return;
    }
    const controller = new AbortController();
    setNativeModelCatalog(undefined);
    void fetchAgentModelCatalog(providerId, { signal: controller.signal }).then(setNativeModelCatalog).catch(() => setNativeModelCatalog(null));
    return () => controller.abort();
  }, [providerAvailability, providerId]);
  const selectedCatalog = providerId
    ? channelId === 'system'
      ? buildAgentSystemChannelModelCatalog(providerId, selectedSystemChannel, nativeModelCatalog ?? null)
      : buildAgentChannelModelCatalog(providerId, selectedAgentChannel, nativeModelCatalog ?? null)
    : null;
  const selectedModels = selectedCatalog?.models ?? [];
  const provider = selectedChannel?.provider ?? profile?.provider ?? '';
  const [model, setModel] = useState(profile?.model ?? '');
  const [reasoningEffort, setReasoningEffort] = useState(profile?.reasoningEffort ?? '');
  const [level, setLevel] = useState<RuntimeProfile['level']>(profile?.level ?? '标准');
  const [purpose, setPurpose] = useState<AgentMuxPurpose>(profile?.role ?? '通用任务');
  const [nickname, setNickname] = useState(profile?.nickname ?? '');
  const [avatar, setAvatar] = useState(profile?.avatar ?? '');
  const [tendency, setTendency] = useState<AgentMuxCapabilityTendency>((profile?.tags[0] as AgentMuxCapabilityTendency | undefined) ?? '通用');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ fingerprint: string; available: boolean; message: string } | null>(null);
  const modelCatalogReady = channelId !== 'system' || Boolean(selectedSystemChannel?.model?.trim()) || nativeModelCatalog !== undefined;
  const defaultModelId = selectedCatalog?.defaultModelId
    ?? selectedModels.find((item) => item.isDefault)?.id
    ?? selectedModels[0]?.id
    ?? '';
  const selectedModelIds = selectedModels.map((item) => item.id).join('\0');
  useEffect(() => {
    if (modelCatalogReady && !selectedModels.some((item) => item.id === model)) {
      setModel(defaultModelId);
      setReasoningEffort('');
    }
  }, [defaultModelId, model, modelCatalogReady, selectedModelIds]);
  const selectedModel = selectedModels.find((item) => item.id === model);
  const fingerprint = `${agent.id}:${channelId}:${model}`;
  useEffect(() => { setTestResult(null); }, [agent.id, channelId, model]);
  const reasoningOptions = [
    { value: '', label: selectedModel?.defaultReasoningEffort ? `跟随模型默认（${formatReasoningLabel(selectedModel.defaultReasoningEffort)}）` : '跟随模型默认' },
    ...(selectedModel?.supportedReasoningEfforts ?? []).map((effort) => ({ value: effort.id, label: formatReasoningLabel(effort.id), description: 'description' in effort ? effort.description : undefined })),
  ];

  const buildProfile = (status: RuntimeProfile['status']): RuntimeProfile | null => {
    const normalizedModel = model.trim();
    if (!channelId || !normalizedModel) return null;
    return {
      id: profile?.id ?? `${agent.id}-${provider.toLowerCase()}-${normalizedModel.toLowerCase()}-${Date.now()}`,
      provider,
      model: normalizedModel,
      nickname: nickname.trim() || null,
      avatar: avatar || null,
      reasoningEffort: reasoningEffort || null,
      level,
      role: purpose,
      tags: [tendency],
      status,
      channelId: channelId === 'system' ? null : channelId,
    };
  };
  const save = () => {
    const verified = testResult?.fingerprint === fingerprint && testResult.available;
    const next = buildProfile(verified ? 'available' : profile?.status ?? 'busy');
    if (next) onSave(next, Boolean(verified));
  };
  const test = async () => {
    const next = buildProfile('busy');
    if (!next || testing) return;
    setTesting(true);
    try {
      const result = await onTest(agent.id, next);
      setTestResult({ fingerprint, ...result });
    } catch (error) {
      setTestResult({ fingerprint, available: false, message: error instanceof Error ? error.message : '连接测试失败' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="agent-mux-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="agent-mux-config-drawer" role="dialog" aria-modal="true" aria-labelledby="agent-mux-config-title">
        <div className="agent-mux-drawer-header"><div><span className="agent-mux-detail-kicker">{agent.name}</span><h2 id="agent-mux-config-title">{profile ? '编辑运行配置' : '添加运行配置'}</h2><p>为这个具体 Agent 配置供应商和模型组合。</p></div><button type="button" className="agent-mux-icon-button" title="关闭" onClick={onClose}><X size={16} /></button></div>
        <div className="agent-mux-drawer-body">
          <label className="agent-mux-form-field"><span>Agent 类型</span>{allowAgentSelection ? <StandardSelect ariaLabel="选择 Agent 类型" value={agent.id} className="agent-mux-select" triggerClassName="agent-mux-select-trigger" menuClassName="agent-mux-select-menu" optionClassName="agent-mux-select-option" offset={7} options={agents.map((item) => ({ value: item.id, label: item.name, icon: <AgentProviderIcon providerId={agentProviderId(item.id) ?? item.id} size={15} /> }))} onChange={onAgentChange} /> : <div className="agent-mux-readonly-field"><AgentProviderIcon providerId={agentProviderId(agent.id) ?? agent.id} size={15} />{agent.name}</div>}</label>
          <label className="agent-mux-form-field"><span>昵称 <em>可选，最多 32 个字符</em></span><input value={nickname} maxLength={32} placeholder="例如：审查员、小深" onChange={(event) => setNickname(event.target.value)} /></label>
          <div className="agent-mux-form-field"><span>图标 <em>可选</em></span><AgentMuxAvatarSelect value={avatar} providerId={providerId ?? agent.id} onChange={setAvatar} /></div>
          <label className="agent-mux-form-field"><span>渠道 <em>来自 Agent 设置，密钥不复制</em></span><StandardSelect ariaLabel="选择渠道" value={channelId} placeholder="选择已配置渠道" className="agent-mux-select" triggerClassName="agent-mux-select-trigger" menuClassName="agent-mux-select-menu" optionClassName="agent-mux-select-option" offset={7} options={channelOptions.map((channel) => ({ value: channel.id, label: channel.name }))} onChange={(next) => { setChannelId(next); setModel(''); setReasoningEffort(''); }} /></label>
          <div className="agent-mux-form-grid">
            <label className="agent-mux-form-field"><span>供应商</span><div className="agent-mux-readonly-field">{provider || '请先选择渠道'}</div></label>
            <label className="agent-mux-form-field"><span>模型</span>{channelId === 'system' ? <div className="agent-mux-readonly-field">{modelCatalogReady ? selectedModel?.label || '未检测到默认模型' : '读取中...'}</div> : <StandardSelect ariaLabel="选择模型" value={model} placeholder={modelCatalogReady && selectedModels.length === 0 ? '该渠道没有可用模型' : '选择模型'} disabled={!selectedChannel || !modelCatalogReady || selectedModels.length === 0} className="agent-mux-select" triggerClassName="agent-mux-select-trigger" menuClassName="agent-mux-select-menu" optionClassName="agent-mux-select-option" offset={7} options={selectedModels.map((item) => ({ value: item.id, label: item.label }))} onChange={(next) => { setModel(next); setReasoningEffort(''); }} />}</label>
          </div>
          <label className="agent-mux-form-field"><span>思考等级 <em>默认跟随模型</em></span><StandardSelect ariaLabel="选择思考等级" value={reasoningEffort} className="agent-mux-select" triggerClassName="agent-mux-select-trigger" menuClassName="agent-mux-select-menu" optionClassName="agent-mux-select-option" offset={7} options={reasoningOptions} onChange={setReasoningEffort} /></label>
          <div className="agent-mux-form-grid">
            <label className="agent-mux-form-field"><span>能力等级</span><StandardSelect<AgentMuxCapabilityLevel> ariaLabel="选择能力等级" value={level} className="agent-mux-select" triggerClassName="agent-mux-select-trigger" menuClassName="agent-mux-select-menu" optionClassName="agent-mux-select-option" offset={7} options={AGENT_MUX_LEVEL_OPTIONS.map((option) => ({ ...option, icon: <span className="agent-mux-level-dot" data-level={option.value} aria-hidden="true" /> }))} onChange={setLevel} /></label>
            <label className="agent-mux-form-field"><span>能力偏向</span><StandardSelect<AgentMuxCapabilityTendency> ariaLabel="选择能力偏向" value={tendency} className="agent-mux-select" triggerClassName="agent-mux-select-trigger" menuClassName="agent-mux-select-menu" optionClassName="agent-mux-select-option" offset={7} options={AGENT_MUX_TENDENCY_OPTIONS.map((value) => ({ value, label: value }))} onChange={setTendency} /></label>
          </div>
          <label className="agent-mux-form-field"><span>用途</span><StandardSelect<AgentMuxPurpose> ariaLabel="选择用途" value={purpose} className="agent-mux-select" triggerClassName="agent-mux-select-trigger" menuClassName="agent-mux-select-menu" optionClassName="agent-mux-select-option" offset={7} options={AGENT_MUX_PURPOSE_OPTIONS.map((value) => ({ value, label: value }))} onChange={setPurpose} /></label>
          <div className="agent-mux-form-note"><ShieldCheck size={15} /><span>保存后会加入 {agent.name} 的运行配置，并可被 codem-agent-mux Skill 发现。</span></div>
          {testResult ? <div className={`agent-mux-inline-message${testResult.available ? '' : ' error'}`}>{testResult.available ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}{testResult.message}</div> : null}
        </div>
        <div className="agent-mux-drawer-footer"><button type="button" className="agent-mux-secondary-button" onClick={onClose}>取消</button><button type="button" className="agent-mux-secondary-button" onClick={() => void test()} disabled={!channelId || !model || testing}><RefreshCw size={14} />{testing ? '测试中…' : '测试连接'}</button><button type="button" className="agent-mux-primary-button" onClick={save} disabled={!channelId || !model}><Check size={14} />保存并启用</button></div>
      </aside>
    </div>
  );
}

function Metric({ label, value, accent, success }: { label: string; value: string; accent?: boolean; success?: boolean }) { return <div className={`agent-mux-metric${accent ? ' accent' : ''}${success ? ' success' : ''}`}><span>{label}</span><strong>{value}</strong></div>; }
function AgentMuxAvatarSelect({ value, providerId, onChange }: { value: string; providerId: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const selectedLabel = AGENT_MUX_AVATAR_OPTIONS.find(([id]) => id === value)?.[1] ?? '默认图标';
  useOutsideDismiss({ selectors: [{ selector: '.agent-mux-avatar-menu', onDismiss: () => setOpen(false), anchorRefs: [anchorRef] }] });
  const choose = (next: string) => { onChange(next); setOpen(false); };
  return <div className="settings-select-anchor agent-mux-avatar-select" ref={anchorRef}><button type="button" className={`settings-select-trigger agent-mux-avatar-trigger${open ? ' open' : ''}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span><AgentMuxAvatar avatar={value} providerId={providerId} size="small" showProviderBadge={false} />{selectedLabel}</span><ChevronDown size={15} className="settings-select-chevron" /></button><PopoverPortal open={open} anchorRef={anchorRef} placement="bottom-start" offset={7}><div className="settings-select-menu agent-mux-avatar-menu" role="listbox" aria-label="内置 Agent 图标"><div className="agent-mux-avatar-grid"><button type="button" className={`agent-mux-avatar-option${!value ? ' current' : ''}`} role="option" aria-selected={!value} aria-label="默认图标" title="默认图标" onClick={() => choose('')}><AgentMuxAvatar providerId={providerId} size="large" showProviderBadge={false} />{!value ? <Check size={12} /> : null}</button>{AGENT_MUX_AVATAR_OPTIONS.map(([id, label]) => <button type="button" key={id} className={`agent-mux-avatar-option${value === id ? ' current' : ''}`} role="option" aria-selected={value === id} aria-label={label} title={label} onClick={() => choose(id)}><AgentMuxAvatar avatar={id} providerId={providerId} size="large" showProviderBadge={false} />{value === id ? <Check size={12} /> : null}</button>)}</div></div></PopoverPortal></div>;
}
function EmptyState({ title, detail, icon: Icon }: { title: string; detail: string; icon?: typeof Activity }) { return <div className="agent-mux-empty-state">{Icon ? <Icon size={22} aria-hidden="true" /> : null}<strong>{title}</strong><span>{detail}</span></div>; }
function Tab({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof Activity; label: string; onClick: () => void }) { return <button type="button" className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={onClick}><Icon size={15} /><span>{label}</span></button>; }
function PanelHeading({ title, meta, icon: Icon, action }: { title: string; meta: string; icon: typeof Activity; action: React.ReactNode }) { return <div className="agent-mux-panel-heading"><div><Icon size={15} /><h3>{title}</h3><span>{meta}</span></div>{action}</div>; }
function CallRow({ run, onOpen }: { run: RunRecord; onOpen: () => void }) { return <button type="button" className="agent-mux-call-row" onClick={onOpen} aria-label={`查看 ${runDisplayName(run)} 运行详情`} title={`${run.target} · ${run.profile}`}><RunIcon status={run.status} /><AgentMuxAvatar avatar={run.avatar} providerId={agentProviderId(run.target) ?? run.target} size="small" /><span className="agent-mux-call-copy"><strong>{runDisplayName(run)}</strong><small>{run.caller} 调用 · {run.target} · {run.profile}</small></span><span className="agent-mux-call-state">{runLabel(run.status)}</span><ChevronRight size={14} /></button>; }
function HealthRow({ agent }: { agent: AgentRecord }) { const status = agent.profiles.some((profile) => profile.status === 'available') ? 'available' : agent.profiles.some((profile) => profile.status === 'busy') ? 'busy' : 'offline'; return <div className="agent-mux-health-row"><span className="agent-mux-agent-mark small" data-provider={agent.id}><AgentProviderIcon providerId={agentProviderId(agent.id) ?? agent.id} size={15} /></span><span><strong>{agent.name}</strong><small>{agent.profiles.length} 个运行配置</small></span><span className="agent-mux-status-dot" data-status={status} /><span>{status === 'available' ? '可用' : status === 'busy' ? '检测中' : '未连接'}</span></div>; }
function ProfileRow({ agentId, agentName, profile, onEdit, onDelete, onToggle, onTest, testing }: { agentId: string; agentName?: string; profile: RuntimeProfile; onEdit: () => void; onDelete: () => void; onToggle: () => void; onTest: () => void; testing: boolean }) { const profileName = profileDisplayName(profile); const profileMeta = `${agentName ? `${agentName} · ` : ''}${profile.provider} / ${profile.model} · 思考 ${profile.reasoningEffort ? formatReasoningLabel(profile.reasoningEffort) : '跟随模型'} · 偏向 ${profile.tags[0]}`; return <div className="agent-mux-profile-row"><span className="agent-mux-profile-name"><AgentMuxAvatar avatar={profile.avatar} providerId={agentProviderId(agentId) ?? agentId} size="small" /><span><strong title={profileName}>{profileName}</strong><small title={profileMeta}>{profileMeta}</small></span></span><span className="agent-mux-level" data-level={profile.level}><span className="agent-mux-level-dot" data-level={profile.level} aria-hidden="true" />{profile.level}</span><span className="agent-mux-profile-role" title={profile.role}>{profile.role}</span><span className={`agent-mux-profile-status ${profile.status}`}>{testing ? '检测中' : profile.status === 'available' ? '可用' : profile.status === 'busy' ? '检测中' : profile.status === 'offline' ? '连接失败' : '已停用'}</span><span className="agent-mux-profile-actions"><button type="button" title="测试连接" onClick={onTest} disabled={testing}><RefreshCw size={13} /></button><button type="button" title="编辑" onClick={onEdit}><Settings2 size={13} /></button><button type="button" title={profile.status === 'disabled' ? '检测并启用' : '停用'} onClick={onToggle}><Radio size={13} /></button><button type="button" title="删除" onClick={onDelete}><X size={13} /></button></span></div>; }
function RunIcon({ status }: { status: RunStatus }) { if (status === 'completed') return <CheckCircle2 className="agent-mux-run-icon completed" size={16} />; if (status === 'failed') return <CircleAlert className="agent-mux-run-icon failed" size={16} />; if (status === 'queued' || status === 'waiting' || status === 'cancelled') return <Clock3 className="agent-mux-run-icon queued" size={16} />; return <Activity className="agent-mux-run-icon running" size={16} />; }
function RunStartedTime({ run }: { run: RunRecord }) { return <time title={formatAgentMuxExactTime(run.createdAt)}>{formatAgentMuxRelativeTime(run.createdAt, run.started)}</time>; }
function runLabel(status: RunStatus) { return status === 'running' ? '运行中' : status === 'completed' ? '已完成' : status === 'failed' ? '失败' : status === 'waiting' ? '等待处理' : status === 'cancelled' ? '已取消' : '排队中'; }
function providerLabel(providerId: string) { return providerId === OPENAI_CODEX_PROVIDER_ID ? 'OpenAI Codex' : providerId === CLAUDE_CODE_PROVIDER_ID ? 'Claude Code' : providerId === GROK_BUILD_PROVIDER_ID ? 'Grok Build' : providerId === PI_AGENT_PROVIDER_ID ? 'Pi Agent' : providerId === OPENCODE_PROVIDER_ID ? 'OpenCode' : providerId === GEMINI_CLI_PROVIDER_ID ? 'Gemini CLI' : providerId === HERMES_AGENT_PROVIDER_ID ? 'Hermes Agent' : providerId; }
function formatReasoningLabel(value: string) { return value.toLowerCase() === 'xhigh' ? 'XHigh' : value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : '跟随模型默认'; }
function agentProviderId(agentId: string): AgentProviderId | null { const id = agentId.toLowerCase(); return id === 'codex' || id === 'openai codex' ? OPENAI_CODEX_PROVIDER_ID : id === 'claude' || id === 'claude code' ? CLAUDE_CODE_PROVIDER_ID : id === 'grok' || id === 'grok build' ? GROK_BUILD_PROVIDER_ID : id === 'pi' || id === 'pi agent' ? PI_AGENT_PROVIDER_ID : id === 'opencode' ? OPENCODE_PROVIDER_ID : id === 'gemini' || id === 'gemini cli' ? GEMINI_CLI_PROVIDER_ID : id === 'hermes' || id === 'hermes agent' ? HERMES_AGENT_PROVIDER_ID : null; }
function agentIdForRun(run: RunRecord, agents: AgentRecord[]) { return agents.find((agent) => agent.name === run.target)?.id ?? run.target; }
function profileDisplayName(profile: RuntimeProfile) { return profile.nickname?.trim() || `${profile.provider} / ${profile.model}`; }
function runDisplayName(run: RunRecord) { return run.nickname?.trim() || run.target; }
function formatRunDuration(durationMs: number) { const seconds = Math.max(0, Math.round(durationMs / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
