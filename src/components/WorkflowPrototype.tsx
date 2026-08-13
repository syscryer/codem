import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  CirclePlay,
  Clock3,
  Copy,
  Flag,
  GitBranch,
  GripVertical,
  History,
  ListTree,
  MessageCircleMore,
  MessageSquareText,
  Hand,
  Maximize2,
  MousePointer2,
  PencilLine,
  Play,
  Plus,
  PowerOff,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Unlink,
  UserRoundCheck,
  Workflow,
} from 'lucide-react';
import {
  WORKFLOW_AGENT_OPTIONS,
  WORKFLOW_NODE_LIBRARY,
  WORKFLOW_TEMPLATES,
  cloneWorkflowTemplate,
  createBlankWorkflow,
  createSavedWorkflowFromTemplate,
  isWorkflowConnectionAllowed,
  retryFailedWorkflowNode,
  advanceWorkflowRun,
  validateWorkflowGraph,
  type WorkflowEdgeCondition,
  type WorkflowMockRun,
  type WorkflowMockEdge,
  type WorkflowNodeData,
  type WorkflowNodeKind,
  type WorkflowRunNode,
  type WorkflowRunStatus,
  type WorkflowSavedStatus,
  type WorkflowSavedWorkflow,
} from '../lib/workflow-prototype';
import { createWorkflowDefinition, createWorkflowRun, deleteWorkflowDefinition, listWorkflowDefinitions, listWorkflowRunHistory, startAgentMuxProviderRun, updateWorkflowDefinition, updateWorkflowRun } from '../lib/agent-mux-api';
import type { AgentMuxRecord } from '../lib/agent-mux-api';
import type { AgentRunEvent } from '../types';
import { consumeAgentRunEventStream, isAgentRunBlockingEvent, isAgentRunTerminalEvent } from '../lib/agent-run-events';
import { OPENAI_CODEX_PROVIDER_ID, CLAUDE_CODE_PROVIDER_ID, PI_AGENT_PROVIDER_ID, GROK_BUILD_PROVIDER_ID, GEMINI_CLI_PROVIDER_ID, HERMES_AGENT_PROVIDER_ID, OPENCODE_PROVIDER_ID } from '../constants';
import type { AgentProviderId } from '../types';
import { PopoverPortal } from './PopoverPortal';
import { StandardSelect } from './StandardSelect';

type WorkflowCanvasNode = Node<WorkflowNodeData, 'workflow'>;
type WorkflowCanvasEdge = Edge<{ condition: WorkflowEdgeCondition }>;
type Selection = { type: 'node' | 'edge'; id: string } | null;
type Feedback = { tone: 'neutral' | 'success' | 'danger'; text: string };
type WorkflowFilter = 'all' | WorkflowSavedStatus;
type WorkflowHomeView = 'definitions' | 'runs';
type WorkflowCanvasTool = 'select' | 'pan';
type WorkflowDragPreview = { kind: WorkflowNodeKind; x: number; y: number } | null;
type WorkflowNodeContextMenu = { nodeId: string; x: number; y: number } | null;

const nodeTypes = { workflow: WorkflowNode };

const nodeLabels: Record<WorkflowNodeKind, string> = {
  start: '开始',
  agent: 'Agent 任务',
  discussion: '多轮讨论',
  approval: '人工确认',
  end: '结束',
};

const conditionLabels: Record<WorkflowEdgeCondition, string> = {
  next: '下一步',
  approved: '满足条件',
  'needs-work': '继续修订',
};

const conditionOptions = Object.entries(conditionLabels).map(([value, label]) => ({ value, label }));

const workflowStatusLabels: Record<WorkflowSavedStatus, string> = {
  draft: '草稿',
  active: '已启用',
};

export function WorkflowPrototype({ agentRecords = [], workingDirectory = '' }: { agentRecords?: AgentMuxRecord[]; workingDirectory?: string }) {
  const [workflows, setWorkflows] = useState<WorkflowSavedWorkflow[]>([]);
  const [runs, setRuns] = useState<WorkflowMockRun[]>([]);
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowSavedWorkflow | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [homeView, setHomeView] = useState<WorkflowHomeView>('definitions');
  const [deactivationTarget, setDeactivationTarget] = useState<WorkflowSavedWorkflow | null>(null);
  const [deactivatingWorkflowId, setDeactivatingWorkflowId] = useState<string | null>(null);
  const [persistenceFeedback, setPersistenceFeedback] = useState<Feedback>({ tone: 'neutral', text: '正在加载本地工作流。' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [storedWorkflows, storedRuns] = await Promise.all([listWorkflowDefinitions(), listWorkflowRunHistory()]);
        if (cancelled) return;
        const nextWorkflows = storedWorkflows as WorkflowSavedWorkflow[];
        const nextRuns = storedRuns as WorkflowMockRun[];
        if (nextWorkflows.length === 0 && nextRuns.length === 0) {
          const legacyWorkflows = readLegacyWorkflowState<WorkflowSavedWorkflow[]>('workflows').filter((item) => !item.id.startsWith('saved-'));
          const legacyRuns = readLegacyWorkflowState<WorkflowMockRun[]>('runs').filter((item) => !item.id.startsWith('run-'));
          if (legacyWorkflows.length || legacyRuns.length) {
            await Promise.all([...legacyWorkflows.map(createWorkflowDefinition), ...legacyRuns.map(createWorkflowRun)]);
            if (cancelled) return;
            setWorkflows(legacyWorkflows);
            setRuns(legacyRuns);
          } else {
            setWorkflows([]);
            setRuns([]);
          }
          localStorage.removeItem('codem.workflow.workflows');
          localStorage.removeItem('codem.workflow.runs');
        } else {
          setWorkflows(nextWorkflows);
          setRuns(nextRuns);
          localStorage.removeItem('codem.workflow.workflows');
          localStorage.removeItem('codem.workflow.runs');
        }
        setPersistenceFeedback({ tone: 'success', text: '工作流和运行记录已保存在本地。' });
      } catch (error) {
        if (!cancelled) setPersistenceFeedback({ tone: 'danger', text: error instanceof Error ? `加载工作流失败：${error.message}` : '加载工作流失败。' });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setRuns((current) => current.map((run) => {
        if (run.status !== 'running' || !run.workflowId || run.executionMode === 'agent') return run;
        const workflow = workflows.find((item) => item.id === run.workflowId);
        const nextRun = workflow ? advanceWorkflowRun(workflow, run) : run;
        if (nextRun !== run) void persistRun(nextRun);
        return nextRun;
      }));
    }, 1800);
    return () => window.clearInterval(timer);
  }, [workflows]);

  function openWorkflow(id: string) {
    const workflow = workflows.find((item) => item.id === id);
    if (workflow) setEditingWorkflow(structuredClone(workflow));
  }

  function createWorkflow() {
    setEditingWorkflow(createBlankWorkflow(crypto.randomUUID(), {
      name: '未命名工作流',
      updatedAt: '尚未保存',
    }));
  }

  async function duplicateWorkflow(id: string) {
    const source = workflows.find((item) => item.id === id);
    if (!source) return;
    const duplicate = structuredClone(source);
    duplicate.id = crypto.randomUUID();
    duplicate.name = `${source.name} 副本`;
    duplicate.status = 'draft';
    duplicate.updatedAt = '刚刚更新';
    try {
      await createWorkflowDefinition(duplicate);
      setWorkflows((current) => [duplicate, ...current]);
      setPersistenceFeedback({ tone: 'success', text: '工作流副本已保存到本地。' });
    } catch (error) {
      setPersistenceFeedback({ tone: 'danger', text: error instanceof Error ? `复制失败：${error.message}` : '复制工作流失败。' });
    }
  }

  async function deleteWorkflow(id: string) {
    try {
      await deleteWorkflowDefinition(id);
      setWorkflows((current) => current.filter((workflow) => workflow.id !== id));
      setPersistenceFeedback({ tone: 'success', text: '工作流已从本地删除。' });
    } catch (error) {
      setPersistenceFeedback({ tone: 'danger', text: error instanceof Error ? `删除失败：${error.message}` : '删除工作流失败。' });
    }
  }

  async function deactivateWorkflow() {
    if (!deactivationTarget || deactivatingWorkflowId) return;
    const nextWorkflow = { ...structuredClone(deactivationTarget), status: 'draft' as const, updatedAt: '刚刚下线' };
    setDeactivatingWorkflowId(deactivationTarget.id);
    try {
      await updateWorkflowDefinition(nextWorkflow.id, nextWorkflow);
      setWorkflows((current) => current.map((workflow) => workflow.id === nextWorkflow.id ? nextWorkflow : workflow));
      setDeactivationTarget(null);
      setPersistenceFeedback({ tone: 'success', text: '工作流已下线并转为草稿。' });
    } catch (error) {
      setPersistenceFeedback({ tone: 'danger', text: error instanceof Error ? `下线失败：${error.message}` : '工作流下线失败。' });
    } finally {
      setDeactivatingWorkflowId(null);
    }
  }

  async function saveWorkflow(nextWorkflow: WorkflowSavedWorkflow) {
    const errors = validateWorkflowGraph(nextWorkflow);
    if (errors.length > 0) return false;
    try {
      const exists = workflows.some((item) => item.id === nextWorkflow.id);
      await (exists ? updateWorkflowDefinition(nextWorkflow.id, nextWorkflow) : createWorkflowDefinition(nextWorkflow));
      setWorkflows((current) => exists
        ? current.map((item) => item.id === nextWorkflow.id ? structuredClone(nextWorkflow) : item)
        : [structuredClone(nextWorkflow), ...current]);
      setEditingWorkflow(structuredClone(nextWorkflow));
      setPersistenceFeedback({ tone: 'success', text: nextWorkflow.status === 'active' ? '工作流已发布并启用。' : '工作流草稿已保存到本地。' });
      return true;
    } catch (error) {
      setPersistenceFeedback({ tone: 'danger', text: error instanceof Error ? `保存失败：${error.message}` : '保存工作流失败。' });
      return false;
    }
  }

  async function startWorkflow(id: string) {
    const workflow = workflows.find((item) => item.id === id);
    if (!workflow || workflow.status !== 'active') {
      setPersistenceFeedback({ tone: 'danger', text: '草稿不能直接运行，请先打开并发布工作流。' });
      return;
    }
    const agentExecution = agentRecords.length > 0 && Boolean(workingDirectory);
    const run: WorkflowMockRun = {
      id: crypto.randomUUID(),
      workflowId: workflow.id,
      templateId: workflow.templateId,
      source: 'saved',
      name: workflow.name,
      objective: workflow.summary,
      status: 'running',
      startedAt: '刚刚',
      duration: '0m 03s',
      executionMode: agentExecution ? 'agent' : 'preview',
      nodes: workflow.nodes.map((node, index) => ({
        id: `${node.id}-run`,
        label: node.data.label,
        agent: resolveNodeAgent(node.data),
        status: index === 0 ? 'running' : 'pending',
        summary: index === 0 ? '正在读取工作流输入和当前聊天上下文。' : '等待上游节点完成。',
        logs: index === 0 ? [{
          id: `${node.id}-start`,
          role: 'system',
          author: '工作流引擎',
          text: '用户已在主聊天中指定该工作流，开始执行冻结快照。',
          time: '刚刚',
        }] : [],
        currentRound: node.data.kind === 'discussion' ? 0 : undefined,
        maxRounds: node.data.kind === 'discussion' ? node.data.maxRounds : undefined,
      })),
    };
    try {
      await createWorkflowRun(run);
      setRuns((current) => [run, ...current]);
      setSelectedRunId(run.id);
      setPersistenceFeedback({ tone: 'success', text: '已创建本地运行记录。' });
    } catch (error) {
      setPersistenceFeedback({ tone: 'danger', text: error instanceof Error ? `启动失败：${error.message}` : '无法创建运行记录。' });
      return;
    }
    if (agentExecution) void executeWorkflowRun(workflow, run, agentRecords, workingDirectory, updateRun);
  }

  async function persistRun(nextRun: WorkflowMockRun) {
    try {
      await updateWorkflowRun(nextRun.id, nextRun);
    } catch (error) {
      setPersistenceFeedback({ tone: 'danger', text: error instanceof Error ? `运行记录保存失败：${error.message}` : '运行记录保存失败。' });
    }
  }

  function updateRun(nextRun: WorkflowMockRun) {
    setRuns((current) => current.map((run) => run.id === nextRun.id ? nextRun : run));
    void persistRun(nextRun);
  }

  function saveTemporaryRun(runId: string) {
    const run = runs.find((item) => item.id === runId);
    if (!run || run.source !== 'temporary' || run.savedAsWorkflowId) return;
    const workflowId = crypto.randomUUID();
    const workflow = createSavedWorkflowFromTemplate(run.templateId, workflowId, {
      name: run.name,
      summary: run.objective,
      status: 'draft',
      updatedAt: '刚刚由临时计划保存',
    });
    void (async () => {
      try {
        await createWorkflowDefinition(workflow);
        const nextRun = { ...run, savedAsWorkflowId: workflowId };
        await updateWorkflowRun(runId, nextRun);
        setWorkflows((current) => [workflow, ...current]);
        setRuns((current) => current.map((item) => item.id === runId ? nextRun : item));
        setPersistenceFeedback({ tone: 'success', text: '临时计划已保存为本地工作流。' });
      } catch (error) {
        setPersistenceFeedback({ tone: 'danger', text: error instanceof Error ? `保存失败：${error.message}` : '临时计划保存失败。' });
      }
    })();
  }

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;
  if (selectedRun) {
    return (
      <WorkflowRunDetail
        run={selectedRun}
        onBack={() => { setSelectedRunId(null); setHomeView('runs'); }}
        onChange={updateRun}
        onSaveTemporary={() => saveTemporaryRun(selectedRun.id)}
      />
    );
  }

  if (!editingWorkflow) {
    return (
      <>
        <WorkflowLibrary
          view={homeView}
          workflows={workflows}
          runs={runs}
          onChangeView={setHomeView}
          onCreate={createWorkflow}
          onDuplicate={duplicateWorkflow}
          onDelete={deleteWorkflow}
          onDeactivate={(id) => setDeactivationTarget(workflows.find((workflow) => workflow.id === id) ?? null)}
          deactivatingWorkflowId={deactivatingWorkflowId}
          onOpen={openWorkflow}
          onOpenRun={setSelectedRunId}
          onRun={startWorkflow}
          feedback={persistenceFeedback}
        />
        {deactivationTarget ? (
          <WorkflowDeactivateDialog
            workflow={deactivationTarget}
            pending={deactivatingWorkflowId === deactivationTarget.id}
            onClose={() => { if (!deactivatingWorkflowId) setDeactivationTarget(null); }}
            onConfirm={() => void deactivateWorkflow()}
          />
        ) : null}
      </>
    );
  }

  const isNew = !workflows.some((item) => item.id === editingWorkflow.id);
  return (
    <ReactFlowProvider>
      <WorkflowCanvas
        key={editingWorkflow.id}
        workflow={editingWorkflow}
        isNew={isNew}
        onBack={() => setEditingWorkflow(null)}
        onSave={saveWorkflow}
        agentRecords={agentRecords}
      />
    </ReactFlowProvider>
  );
}

function readLegacyWorkflowState<T>(key: string): T {
  try {
    const stored = localStorage.getItem(`codem.workflow.${key}`);
    return stored ? JSON.parse(stored) as T : ([] as T);
  } catch {
    return [] as T;
  }
}

async function executeWorkflowRun(
  workflow: WorkflowSavedWorkflow,
  initialRun: WorkflowMockRun,
  agentRecords: AgentMuxRecord[],
  workingDirectory: string,
  updateRun: (run: WorkflowMockRun) => void,
) {
  let run = structuredClone(initialRun);
  const graph = new Map(workflow.nodes.map((node) => [node.id, node]));
  const pending = new Set(workflow.nodes.filter((node) => node.data.kind !== 'start').map((node) => node.id));
  const done = new Set(workflow.nodes.filter((node) => node.data.kind === 'start').map((node) => node.id));
  const execution = { terminalStatus: 'running' as WorkflowRunStatus };
  for (const id of done) {
    const runNode = run.nodes.find((item) => item.id === `${id}-run`);
    if (runNode) runNode.status = 'completed';
  }
  while (pending.size > 0 && run.status === 'running') {
    const ready = [...pending].filter((id) => workflow.edges.filter((edge) => edge.target === id).every((edge) => done.has(edge.source)));
    if (!ready.length) break;
    await Promise.all(ready.map(async (id) => {
      const node = graph.get(id);
      if (!node) return;
      const runNode = run.nodes.find((item) => item.id === `${id}-run`);
      if (!runNode) return;
      if (node.data.kind === 'end') {
        runNode.status = 'completed';
        runNode.summary = '所有上游节点已完成';
        updateRun(structuredClone(run));
        return;
      }
      if (node.data.kind === 'approval') {
        runNode.status = 'waiting';
        run.status = 'waiting';
        execution.terminalStatus = 'waiting';
        runNode.summary = '等待用户确认后继续';
        updateRun(structuredClone(run));
        return;
      }
      const profile = resolveWorkflowProfile(node.data, agentRecords);
      if (!profile) {
        runNode.status = 'failed';
        run.status = 'failed';
        execution.terminalStatus = 'failed';
        runNode.summary = '没有找到可用的 Agent Mux 配置';
        updateRun(structuredClone(run));
        return;
      }
      runNode.status = 'running';
      updateRun(structuredClone(run));
      try {
        const basePrompt = `${node.data.description}\n\n工作流目标：${workflow.summary}\n请输出本节点的可交付结果，并引用必要的依据。`;
        let result = await runWorkflowAgent(profile, basePrompt, workingDirectory);
        if (node.data.kind === 'discussion' && result.status === 'completed') {
          const reviewer = resolveWorkflowProfile({ ...node.data, kind: 'agent', agentId: node.data.reviewerAgentId, profileId: node.data.reviewerProfileId }, agentRecords);
          if (!reviewer) throw new Error('多轮讨论没有找到可用的审查 Agent 配置');
          const rounds = Math.min(node.data.maxRounds ?? 3, 3);
          let satisfied = false;
          for (let round = 1; round <= rounds; round += 1) {
            const review = await runWorkflowAgent(reviewer, `审查以下方案，满意时明确回复“满意，可以定稿”；否则给出可执行修改意见。\n\n${result.text}`, workingDirectory);
            runNode.logs.push({ id: `${runNode.id}-review-${round}`, role: 'agent', author: reviewer.profile.nickname || reviewer.record.name, text: review.text, time: '刚刚' });
            if (review.status !== 'completed') { result = review; break; }
            if (/满意|可以定稿|通过/.test(review.text)) { satisfied = true; result = { status: 'completed', text: `${result.text}\n\n审查结论：${review.text}` }; break; }
            result = await runWorkflowAgent(profile, `根据审查意见修订方案。\n\n当前方案：${result.text}\n\n审查意见：${review.text}`, workingDirectory);
            if (result.status !== 'completed') break;
          }
          if (result.status === 'completed' && !satisfied) result = { status: 'waiting', text: `已达到 ${rounds} 轮讨论上限，审查方尚未明确满意，请用户决定继续讨论或接受当前版本。` };
        }
        if (result.status !== 'completed') {
          runNode.status = result.status;
          run.status = result.status;
          execution.terminalStatus = result.status;
          runNode.summary = result.text;
          updateRun(structuredClone(run));
          return;
        }
        runNode.status = 'completed';
        runNode.summary = (result.text.trim() || 'Agent 已完成节点任务').slice(0, 500);
        runNode.logs.push({ id: `${runNode.id}-agent-${Date.now()}`, role: 'agent', author: profile.profile.nickname || profile.record.name, text: runNode.summary, time: '刚刚' });
      } catch (error) {
        runNode.status = 'failed';
        run.status = 'failed';
        execution.terminalStatus = 'failed';
        runNode.summary = error instanceof Error ? error.message : 'Agent 执行失败';
      }
      updateRun(structuredClone(run));
    }));
    for (const id of ready) {
      pending.delete(id);
      const node = run.nodes.find((item) => item.id === `${id}-run`);
      if (node?.status === 'completed') done.add(id);
    }
    if (execution.terminalStatus === 'failed' || execution.terminalStatus === 'waiting') break;
  }
  if (run.status === 'running' && pending.size === 0) {
    run.status = 'completed';
    updateRun(run);
  }
}

type ResolvedWorkflowProfile = NonNullable<ReturnType<typeof resolveWorkflowProfile>>;
type WorkflowAgentResult = { status: 'completed' | 'waiting' | 'failed'; text: string };

async function runWorkflowAgent(profile: ResolvedWorkflowProfile, prompt: string, workingDirectory: string): Promise<WorkflowAgentResult> {
  const { response } = await startAgentMuxProviderRun({ providerId: profile.providerId, channelId: profile.profile.channelId, prompt, workingDirectory, model: profile.profile.model, reasoningEffort: profile.profile.reasoningEffort, permissionMode: 'default' });
  let text = '';
  let terminal: 'completed' | 'waiting' | 'failed' | null = null;
  await consumeAgentRunEventStream(response, async (event: AgentRunEvent) => {
    if (event.type === 'delta') text += event.text;
    if (isAgentRunBlockingEvent(event)) { terminal = 'waiting'; return false; }
    if (isAgentRunTerminalEvent(event)) terminal = event.type === 'error' || (event.type === 'done' && event.stopReason === 'error') ? 'failed' : 'completed';
    return true;
  });
  if (!terminal) return { status: 'failed', text: text.trim() || 'Agent 流未返回完成事件' };
  return { status: terminal, text: text.trim() || (terminal === 'waiting' ? 'Agent 等待用户处理' : terminal === 'failed' ? 'Agent 执行失败' : 'Agent 已完成节点任务') };
}

function resolveWorkflowProfile(data: WorkflowNodeData, records: AgentMuxRecord[]) {
  const wanted = data.kind === 'discussion' ? data.proposerAgentId : data.agentId;
  const wantedProfile = data.kind === 'discussion' ? data.proposerProfileId : data.profileId;
  if (wantedProfile) {
    for (const record of records) {
      const profile = record.profiles.find((item) => item.id === wantedProfile && item.status === 'available');
      const providerId = workflowProviderId(record.id);
      if (profile && providerId) return { record, providerId, profile };
    }
    return null;
  }
  const aliases: Record<string, string[]> = { architect: ['codex', 'openai-codex'], reviewer: ['claude', 'claude-code'], implementer: ['codex', 'openai-codex'], verifier: ['pi', 'pi-agent'] };
  const candidates = aliases[wanted ?? ''] ?? [wanted ?? ''];
  for (const record of records) {
    if (!candidates.some((candidate) => record.id.toLowerCase().includes(candidate))) continue;
    const profile = record.profiles.find((item) => item.status === 'available');
    const providerId = workflowProviderId(record.id);
    if (profile && providerId) return { record, providerId, profile };
  }
  return null;
}

function workflowProviderId(agentId: string): AgentProviderId | null {
  const id = agentId.toLowerCase();
  if (id === 'codex' || id === 'openai codex') return OPENAI_CODEX_PROVIDER_ID;
  if (id === 'claude' || id === 'claude code') return CLAUDE_CODE_PROVIDER_ID;
  if (id === 'pi' || id === 'pi agent') return PI_AGENT_PROVIDER_ID;
  if (id === 'grok' || id === 'grok build') return GROK_BUILD_PROVIDER_ID;
  if (id === 'gemini' || id === 'gemini cli') return GEMINI_CLI_PROVIDER_ID;
  if (id === 'hermes' || id === 'hermes agent') return HERMES_AGENT_PROVIDER_ID;
  if (id === 'opencode') return OPENCODE_PROVIDER_ID;
  return null;
}

function WorkflowLibrary({
  view,
  workflows,
  runs,
  onChangeView,
  onCreate,
  onDuplicate,
  onDelete,
  onDeactivate,
  deactivatingWorkflowId,
  onOpen,
  onOpenRun,
  onRun,
  feedback,
}: {
  view: WorkflowHomeView;
  workflows: WorkflowSavedWorkflow[];
  runs: WorkflowMockRun[];
  onChangeView: (view: WorkflowHomeView) => void;
  onCreate: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onDeactivate: (id: string) => void;
  deactivatingWorkflowId: string | null;
  onOpen: (id: string) => void;
  onOpenRun: (id: string) => void;
  onRun: (id: string) => void;
  feedback: Feedback;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<WorkflowFilter>('all');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleWorkflows = workflows.filter((workflow) => (
    (filter === 'all' || workflow.status === filter)
    && (!normalizedQuery || `${workflow.name} ${workflow.summary}`.toLocaleLowerCase().includes(normalizedQuery))
  ));

  return (
    <div className="workflow-library">
      <header className="workflow-library-header">
        <div className="workflow-library-title">
          <span className="workflow-title-icon"><Workflow size={16} /></span>
          <div><strong>工作流</strong><small>管理、编辑和运行 Agent 工作流</small></div>
          <span className="workflow-mock-badge">Beta</span>
        </div>
        <div className="workflow-library-actions">
          <label className="workflow-library-search">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={view === 'definitions' ? '搜索工作流' : '搜索运行记录'} aria-label={view === 'definitions' ? '搜索工作流' : '搜索运行记录'} />
          </label>
          {view === 'definitions' ? <button type="button" className="agent-mux-primary-button" onClick={onCreate}><Plus size={15} />新建工作流</button> : null}
        </div>
      </header>

      <div className="workflow-library-subnav">
        <div className="workflow-home-tabs" role="tablist" aria-label="工作流视图">
          <button type="button" className={view === 'definitions' ? 'active' : ''} role="tab" aria-selected={view === 'definitions'} onClick={() => onChangeView('definitions')}><ListTree size={13} />工作流</button>
          <button type="button" className={view === 'runs' ? 'active' : ''} role="tab" aria-selected={view === 'runs'} onClick={() => onChangeView('runs')}><History size={13} />运行记录 <span>{runs.length}</span></button>
        </div>
        {view === 'definitions' ? (
          <div className="workflow-filter" role="tablist" aria-label="工作流状态筛选">
            {([['all', '全部'], ['draft', '草稿'], ['active', '已启用']] as Array<[WorkflowFilter, string]>).map(([value, label]) => (
              <button key={value} type="button" className={filter === value ? 'active' : ''} role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}>{label}</button>
            ))}
          </div>
        ) : <span>{runs.length} 条运行记录</span>}
      </div>

      {feedback.tone === 'danger' ? <div className="workflow-persistence-feedback danger" role="alert"><CircleAlert size={14} /><span>{feedback.text}</span></div> : null}

      <main className="workflow-library-content">
        {view === 'definitions' ? <><div className="workflow-library-heading">
          <div><h2>我的工作流</h2><p>保存的草稿和已启用流程</p></div>
        </div>{visibleWorkflows.length > 0 ? (
          <div className="workflow-card-grid">
            {visibleWorkflows.map((workflow) => (
              <WorkflowCard key={workflow.id} workflow={workflow} onDuplicate={onDuplicate} onDelete={onDelete} onDeactivate={onDeactivate} deactivating={deactivatingWorkflowId === workflow.id} onOpen={onOpen} onRun={onRun} />
            ))}
          </div>
        ) : (
          <div className="workflow-library-empty"><Search size={18} /><strong>没有匹配的工作流</strong><span>调整搜索词或状态筛选。</span></div>
        )}</> : <WorkflowRunHistory runs={runs.filter((run) => !normalizedQuery || `${run.name} ${run.objective}`.toLocaleLowerCase().includes(normalizedQuery))} onOpen={onOpenRun} />}
      </main>
    </div>
  );
}

function WorkflowCard({
  workflow,
  onDuplicate,
  onDelete,
  onDeactivate,
  deactivating,
  onOpen,
  onRun,
}: {
  workflow: WorkflowSavedWorkflow;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onDeactivate: (id: string) => void;
  deactivating: boolean;
  onOpen: (id: string) => void;
  onRun: (id: string) => void;
}) {
  const agentCount = workflow.nodes.filter((node) => node.data.kind === 'agent' || node.data.kind === 'discussion').length;
  const discussion = workflow.nodes.find((node) => node.data.kind === 'discussion');
  return (
    <article className="workflow-card">
      <div className="workflow-card-header">
        <span className="workflow-card-icon"><GitBranch size={16} /></span>
        <span className={`workflow-status-badge ${workflow.status}`}>{workflowStatusLabels[workflow.status]}</span>
      </div>
      <div className="workflow-card-copy">
        <h3>{workflow.name}</h3>
        <p>{workflow.summary}</p>
      </div>
      <div className="workflow-card-flow" aria-hidden="true">
        {workflow.nodes.slice(0, 6).map((node, index) => (
          <span key={node.id} className={node.data.kind}>{index > 0 ? <i /> : null}<b /></span>
        ))}
      </div>
      <div className="workflow-card-metrics">
        <span><strong>{workflow.nodes.length}</strong> 节点</span>
        <span><strong>{agentCount}</strong> Agent</span>
        <span><strong>{discussion?.data.maxRounds ?? 0}</strong> 最大轮次</span>
      </div>
      <footer className="workflow-card-footer">
        <span><Clock3 size={12} />{workflow.updatedAt}</span>
        <div>
          <button type="button" className="agent-definition-icon-button" title="复制工作流" aria-label={`复制${workflow.name}`} onClick={() => onDuplicate(workflow.id)}><Copy size={14} /></button>
          <button type="button" className="agent-definition-icon-button" title="删除工作流" aria-label={`删除${workflow.name}`} onClick={() => onDelete(workflow.id)}><Trash2 size={14} /></button>
          {workflow.status === 'active' ? <button type="button" className="agent-definition-icon-button" title="下线工作流" aria-label={`下线${workflow.name}`} disabled={deactivating} onClick={() => onDeactivate(workflow.id)}><PowerOff size={14} /></button> : null}
          <button type="button" className="agent-definition-icon-button" title={workflow.status === 'active' ? '运行工作流' : '发布后可运行'} aria-label={`运行${workflow.name}`} disabled={workflow.status !== 'active'} onClick={() => onRun(workflow.id)}><Play size={14} /></button>
          <button type="button" className="workflow-card-open" onClick={() => onOpen(workflow.id)}><PencilLine size={13} />打开编辑</button>
        </div>
      </footer>
    </article>
  );
}

function WorkflowDeactivateDialog({ workflow, pending, onClose, onConfirm }: { workflow: WorkflowSavedWorkflow; pending: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="dialog-backdrop agent-mux-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <div className="dialog-card agent-mux-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="workflow-deactivate-title">
        <div className="dialog-head"><h3 id="workflow-deactivate-title">下线工作流</h3><p>“{workflow.name}”下线后将转为草稿，不能再从管理页或主聊天启动；已有运行记录会保留。</p></div>
        <div className="dialog-actions"><button type="button" className="dialog-button secondary" disabled={pending} onClick={onClose}>取消</button><button type="button" className="dialog-button danger" disabled={pending} onClick={onConfirm}>{pending ? '下线中' : '确认下线'}</button></div>
      </div>
    </div>
  );
}

function WorkflowRunHistory({ runs, onOpen }: { runs: WorkflowMockRun[]; onOpen: (id: string) => void }) {
  return (
    <div className="workflow-run-history">
      <div className="workflow-library-heading"><div><h2>运行记录</h2><p>正式工作流和临时执行计划都会保留在这里。</p></div></div>
      {runs.length > 0 ? <div className="workflow-run-list">{runs.map((run) => <button type="button" className="workflow-run-row" key={run.id} onClick={() => onOpen(run.id)}>
        <span className={`workflow-run-state ${run.status}`}><RunStatusIcon status={run.status} /></span>
        <span className="workflow-run-row-main"><strong>{run.name}</strong><small>{run.objective}</small></span>
        <span className="workflow-run-row-meta"><b className={run.source}>{run.source === 'temporary' ? '临时计划' : '已保存流程'}</b><small>{run.startedAt} · {run.duration}</small></span>
        <ChevronRight size={15} />
      </button>)}</div> : <div className="workflow-library-empty"><History size={18} /><strong>暂无运行记录</strong><span>从工作流卡片或主聊天启动一次流程。</span></div>}
    </div>
  );
}

function WorkflowRunDetail({
  run,
  onBack,
  onChange,
  onSaveTemporary,
}: {
  run: WorkflowMockRun;
  onBack: () => void;
  onChange: (run: WorkflowMockRun) => void;
  onSaveTemporary: () => void;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState(run.nodes.find((node) => node.status === 'running' || node.status === 'failed')?.id ?? run.nodes[0]?.id ?? '');
  const selectedNode = run.nodes.find((node) => node.id === selectedNodeId) ?? run.nodes[0];
  const completedCount = run.nodes.filter((node) => node.status === 'completed').length;
  const canSave = run.source === 'temporary' && !run.savedAsWorkflowId;

  function retryNode() {
    if (!selectedNode || selectedNode.status !== 'failed') return;
    onChange(retryFailedWorkflowNode(run, selectedNode.id));
  }

  function sendGuidance() {
    if (!selectedNode) return;
    onChange({ ...structuredClone(run), status: 'running', nodes: run.nodes.map((node) => node.id === selectedNode.id ? {
      ...structuredClone(node), status: node.status === 'waiting' ? 'running' : node.status,
      logs: [...structuredClone(node.logs), { id: `${node.id}-guide`, role: 'user', author: '你', text: '请继续当前节点，并保留现有上下文。', time: '刚刚' }],
    } : structuredClone(node)) });
  }

  return <div className="workflow-run-detail">
    <header className="workflow-toolbar">
      <button type="button" className="workflow-back-button agent-definition-icon-button" title="返回运行记录" aria-label="返回运行记录" onClick={onBack}><ArrowLeft size={15} /></button>
      <div className="workflow-title"><span className={`workflow-run-state ${run.status}`}><RunStatusIcon status={run.status} /></span><div><strong>{run.name}</strong><small>{run.executionMode === 'agent' ? '真实 Agent 执行' : run.source === 'temporary' ? '临时本地预演' : '本地预演'} · {run.startedAt}</small></div></div>
      <div className="workflow-toolbar-actions">{canSave ? <button type="button" className="agent-mux-secondary-button" onClick={onSaveTemporary}><Save size={14} />保存为工作流</button> : null}<button type="button" className="agent-mux-secondary-button" onClick={() => onChange({ ...run, status: 'cancelled' })}><Square size={13} />取消运行</button></div>
    </header>
    <div className="workflow-run-summary"><div><span>目标</span><strong>{run.objective}</strong></div><div><span>进度</span><strong>{completedCount}/{run.nodes.length} 个节点完成</strong></div><div><span>耗时</span><strong>{run.duration}</strong></div></div>
    <div className="workflow-run-body">
      <aside className="workflow-run-node-list"><div className="workflow-run-section-title"><strong>执行节点</strong><span>{run.nodes.length}</span></div>{run.nodes.map((node, index) => <button type="button" key={node.id} className={`workflow-run-node-row${selectedNode?.id === node.id ? ' active' : ''}`} onClick={() => setSelectedNodeId(node.id)}><span className={`workflow-run-node-index ${node.status}`}><RunStatusIcon status={node.status} fallback={String(index + 1)} /></span><span><strong>{node.label}</strong><small>{node.agent}</small></span><ChevronRight size={14} /></button>)}</aside>
      <section className="workflow-run-chat"><div className="workflow-run-chat-header"><div><span>节点日志</span><strong>{selectedNode?.label}</strong></div><div className="workflow-run-chat-actions">{selectedNode?.status === 'failed' ? <button type="button" className="agent-mux-secondary-button" onClick={retryNode}><RefreshCw size={13} />重试节点</button> : null}<button type="button" className="agent-mux-primary-button" onClick={sendGuidance}><Send size={13} />补充指导</button></div></div><div className="workflow-run-chat-log">{selectedNode?.logs.length ? selectedNode.logs.map((log) => <div className={`workflow-log-entry ${log.role}`} key={log.id}><div className="workflow-log-meta"><strong>{log.author}</strong><span>{log.time}</span></div><p>{log.text}</p></div>) : <div className="workflow-log-empty"><MessageSquareText size={17} /><span>节点尚未产生聊天日志。</span></div>}<div className="workflow-run-node-summary"><CirclePlay size={14} /><span>{selectedNode?.summary}</span></div></div></section>
    </div>
  </div>;
}

function RunStatusIcon({ status, fallback }: { status: WorkflowRunStatus | WorkflowRunNode['status']; fallback?: string }) {
  if (status === 'completed') return <Check size={13} />;
  if (status === 'failed') return <CircleAlert size={13} />;
  if (status === 'cancelled') return <Square size={11} />;
  if (status === 'running') return <CirclePlay size={13} />;
  if (status === 'waiting') return <Clock3 size={13} />;
  return <span>{fallback ?? '·'}</span>;
}

function resolveNodeAgent(data: WorkflowNodeData) {
  if (data.kind === 'discussion') return `${data.proposerAgentId ?? 'A'} / ${data.reviewerAgentId ?? 'B'}`;
  return WORKFLOW_AGENT_OPTIONS.find((option) => option.value === data.agentId)?.label ?? '当前主 Agent';
}

function WorkflowCanvas({
  workflow,
  isNew,
  onBack,
  onSave,
  agentRecords,
}: {
  workflow: WorkflowSavedWorkflow;
  isNew: boolean;
  onBack: () => void;
  onSave: (workflow: WorkflowSavedWorkflow) => Promise<boolean>;
  agentRecords: AgentMuxRecord[];
}) {
  const [templateId, setTemplateId] = useState(workflow.templateId);
  const initialGraph = useMemo(() => buildCanvasGraphFromWorkflow(workflow), [workflow]);
  const [fitInitialGraph] = useState(initialGraph.nodes.length > 0);
  const [workflowName, setWorkflowName] = useState(workflow.name);
  const [workflowSummary, setWorkflowSummary] = useState(workflow.summary);
  const [nodes, setNodes] = useState<WorkflowCanvasNode[]>(initialGraph.nodes);
  const [edges, setEdges] = useState<WorkflowCanvasEdge[]>(initialGraph.edges);
  const [selection, setSelection] = useState<Selection>(() => {
    const discussion = initialGraph.nodes.find((node) => node.data.kind === 'discussion');
    return discussion ? { type: 'node', id: discussion.id } : null;
  });
  const [dirty, setDirty] = useState(isNew);
  const [dragActive, setDragActive] = useState(false);
  const [dragPreview, setDragPreview] = useState<WorkflowDragPreview>(null);
  const [nodeContextMenu, setNodeContextMenu] = useState<WorkflowNodeContextMenu>(null);
  const [canvasTool, setCanvasTool] = useState<WorkflowCanvasTool>('select');
  const [feedback, setFeedback] = useState<Feedback>({
    tone: 'neutral',
    text: '画布更改会保存到本地工作流。',
  });
  const nodeSequence = useRef(0);
  const canvasRef = useRef<HTMLElement | null>(null);
  const nodeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const { fitView, screenToFlowPosition } = useReactFlow<WorkflowCanvasNode, WorkflowCanvasEdge>();

  const currentTemplate = WORKFLOW_TEMPLATES.find((template) => template.id === templateId);
  const selectedNode = selection?.type === 'node' ? nodes.find((node) => node.id === selection.id) ?? null : null;
  const selectedEdge = selection?.type === 'edge' ? edges.find((edge) => edge.id === selection.id) ?? null : null;

  useEffect(() => {
    if (!nodeContextMenu) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (!nodeContextMenuRef.current?.contains(event.target as globalThis.Node)) setNodeContextMenu(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setNodeContextMenu(null);
    }
    window.addEventListener('mousedown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeNodeContextMenu);
    return () => {
      window.removeEventListener('mousedown', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeNodeContextMenu);
    };
  }, [nodeContextMenu]);

  function closeNodeContextMenu() {
    setNodeContextMenu(null);
  }

  const handleNodesChange = useCallback((changes: NodeChange<WorkflowCanvasNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
    if (changes.some((change) => change.type === 'position' || change.type === 'remove')) setDirty(true);
  }, []);

  const handleEdgesChange = useCallback((changes: EdgeChange<WorkflowCanvasEdge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
    if (changes.some((change) => change.type === 'remove')) setDirty(true);
  }, []);

  const isValidConnection = useCallback((connection: Connection | WorkflowCanvasEdge) => (
    isWorkflowConnectionAllowed(nodes, edges, connection.source, connection.target)
  ), [edges, nodes]);

  const handleConnect = useCallback((connection: Connection) => {
    if (!isWorkflowConnectionAllowed(nodes, edges, connection.source, connection.target)) {
      setFeedback({ tone: 'danger', text: '不能连接相同节点、重复路径、结束节点输出或开始节点输入。' });
      return;
    }
    const nextEdge = createCanvasEdge({
      id: `${connection.source}:${connection.target}`,
      source: connection.source!,
      target: connection.target!,
      condition: 'next',
    });
    setEdges((current) => addEdge(nextEdge, current));
    setDirty(true);
    setFeedback({ tone: 'success', text: '已添加执行路径。' });
  }, [edges, nodes]);

  function loadTemplate(nextTemplateId: string) {
    const graph = buildCanvasGraph(nextTemplateId);
    const discussion = graph.nodes.find((node) => node.data.kind === 'discussion');
    setTemplateId(nextTemplateId);
    if (isNew && (workflowName === '未命名工作流' || workflowName === `${currentTemplate?.name ?? ''} 草稿`)) {
      setWorkflowName(`${graph.template.name} 草稿`);
    }
    setWorkflowSummary(graph.template.summary);
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setSelection(discussion ? { type: 'node', id: discussion.id } : null);
    setDirty(true);
    setFeedback({ tone: 'success', text: `已载入“${graph.template.name}”模板到当前草稿。` });
    requestAnimationFrame(() => void fitView({ padding: 0.14, duration: 220 }));
  }

  function addNode(kind: WorkflowNodeKind, position?: { x: number; y: number }) {
    const libraryItem = WORKFLOW_NODE_LIBRARY.find((item) => item.kind === kind);
    if (!libraryItem) return;
    nodeSequence.current += 1;
    const id = `${kind}-${crypto.randomUUID()}`;
    const sameKindCount = nodes.filter((node) => node.data.kind === kind).length;
    const nextNode: WorkflowCanvasNode = {
      id,
      type: 'workflow',
      position: position ?? { x: 260 + sameKindCount * 36, y: 390 + sameKindCount * 34 },
      data: defaultNodeData(kind, libraryItem.label, libraryItem.description),
    };
    setNodes((current) => [...current, nextNode]);
    setSelection({ type: 'node', id });
    setDirty(true);
    setFeedback({ tone: 'neutral', text: `已添加“${libraryItem.label}”，请连接到流程。` });
  }

  function handlePaletteDrop(kind: WorkflowNodeKind, position: { x: number; y: number }) {
    setDragActive(false);
    setDragPreview(null);
    const canvas = canvasRef.current?.getBoundingClientRect();
    if (!canvas || position.x < canvas.left || position.x > canvas.right || position.y < canvas.top || position.y > canvas.bottom) {
      setFeedback({ tone: 'danger', text: '请将节点拖到画布区域后松开。' });
      return;
    }
    addNode(kind, screenToFlowPosition(position));
  }

  function updatePaletteDrag(kind: WorkflowNodeKind, position: { x: number; y: number }) {
    setDragActive(true);
    setDragPreview({ kind, ...position });
  }

  function cancelPaletteDrag() {
    setDragActive(false);
    setDragPreview(null);
  }

  function updateNode(id: string, update: Partial<WorkflowNodeData>, markDirty = true) {
    setNodes((current) => current.map((node) => (
      node.id === id ? { ...node, data: { ...node.data, ...update } } : node
    )));
    if (markDirty) setDirty(true);
  }

  function updateEdge(id: string, condition: WorkflowEdgeCondition) {
    setEdges((current) => current.map((edge) => edge.id === id ? {
      ...edge,
      label: conditionLabels[condition],
      className: `workflow-edge ${condition}`,
      data: { condition },
    } : edge));
    setDirty(true);
  }

  function duplicateNode(id: string) {
    const source = nodes.find((node) => node.id === id);
    if (!source) return;
    const duplicateId = `${source.data.kind}-${crypto.randomUUID()}`;
    const duplicate: WorkflowCanvasNode = {
      ...structuredClone(source),
      id: duplicateId,
      position: { x: source.position.x + 32, y: source.position.y + 32 },
      selected: false,
      data: { ...structuredClone(source.data), label: `${source.data.label} 副本` },
    };
    setNodes((current) => [...current, duplicate]);
    setSelection({ type: 'node', id: duplicateId });
    setNodeContextMenu(null);
    setDirty(true);
    setFeedback({ tone: 'success', text: `已复制“${source.data.label}”，请按需连接执行路径。` });
  }

  function removeNode(id: string) {
    const node = nodes.find((item) => item.id === id);
    if (!node) return;
    setNodes((current) => current.filter((item) => item.id !== id));
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
    setSelection(null);
    setNodeContextMenu(null);
    setDirty(true);
    setFeedback({ tone: 'neutral', text: `“${node.data.label}”已移出画布。` });
  }

  function removeSelection() {
    if (!selection) return;
    if (selection.type === 'edge') {
      setEdges((current) => current.filter((edge) => edge.id !== selection.id));
      setFeedback({ tone: 'neutral', text: '执行路径已删除。' });
    } else {
      removeNode(selection.id);
      return;
    }
    setSelection(null);
    setDirty(true);
  }

  async function saveEditor(status: WorkflowSavedStatus) {
    const name = workflowName.trim();
    if (!name) {
      setFeedback({ tone: 'danger', text: '请先填写工作流名称。' });
      return;
    }
    const error = validateWorkflow(nodes, edges);
    if (error) {
      setFeedback({ tone: 'danger', text: error });
      return;
    }
    if (status === 'active') {
      const profileError = validatePublishedWorkflowProfiles(nodes, agentRecords);
      if (profileError) {
        setFeedback({ tone: 'danger', text: profileError });
        return;
      }
    }
    const saved = await onSave({
      ...workflow,
      templateId,
      name,
      summary: workflowSummary,
      status,
      updatedAt: '刚刚更新',
      nodes: nodes.map((node) => ({
        id: node.id,
        position: { ...node.position },
        data: structuredClone(node.data),
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        condition: edge.data?.condition ?? 'next',
      })),
    });
    if (saved) {
      setDirty(false);
      setFeedback({ tone: 'success', text: status === 'active' ? '工作流已发布并启用。' : '草稿已保存到本地工作流，刷新后会恢复。' });
    } else {
      setFeedback({ tone: 'danger', text: status === 'active' ? '发布失败，请检查后台服务后重试。' : '保存失败，请检查后台服务后重试。' });
    }
  }

  function saveDraft() {
    void saveEditor('draft');
  }

  function publishWorkflow() {
    void saveEditor('active');
  }

  function handleBack() {
    if (dirty) {
      setFeedback({ tone: 'danger', text: '当前有未保存修改，请先保存草稿再返回管理页。' });
      return;
    }
    onBack();
  }

  function simulateRun() {
    const error = validateWorkflow(nodes, edges);
    if (error) {
      setFeedback({ tone: 'danger', text: error });
      return;
    }
    const discussion = nodes.find((node) => node.data.kind === 'discussion');
    if (!discussion) {
      setFeedback({ tone: 'success', text: '预演完成：流程已到达结束节点。' });
      return;
    }
    const currentRound = discussion.data.currentRound ?? 0;
    const maxRounds = discussion.data.maxRounds ?? 10;
    if (currentRound >= maxRounds) {
      updateNode(discussion.id, { status: 'waiting' }, false);
      setFeedback({ tone: 'danger', text: `已达到 ${maxRounds} 轮上限，流程暂停并等待用户处理。` });
      return;
    }
    const nextRound = currentRound + 1;
    updateNode(discussion.id, { currentRound: nextRound, status: 'running' }, false);
    setSelection({ type: 'node', id: discussion.id });
    setFeedback({ tone: 'success', text: `预演推进到第 ${nextRound} 轮：B 提意见后，A 将继续修订。` });
  }

  return (
    <div className="workflow-prototype">
      <div className="workflow-toolbar">
        <button type="button" className="workflow-back-button agent-definition-icon-button" title="返回工作流管理" aria-label="返回工作流管理" onClick={handleBack}><ArrowLeft size={15} /></button>
        <div className="workflow-title">
          <span className="workflow-title-icon"><GitBranch size={16} /></span>
          <div>
            <input
              className="workflow-name-input"
              value={workflowName}
              onChange={(event) => {
                setWorkflowName(event.target.value);
                setDirty(true);
              }}
              aria-label="工作流名称"
            />
            <small>{workflowSummary}</small>
          </div>
          <span className="workflow-mock-badge">Beta</span>
          <span className={`workflow-editor-status ${workflow.status}`}>{workflowStatusLabels[workflow.status]}</span>
        </div>
        <div className="workflow-template-control">
          <span>模板</span>
          <StandardSelect<string>
            value={templateId}
            options={WORKFLOW_TEMPLATES.map((template) => ({ value: template.id, label: template.name }))}
            ariaLabel="选择并载入工作流模板"
            placeholder="选择模板载入"
            className="workflow-template-select"
            triggerClassName="workflow-select-trigger"
            menuClassName="workflow-select-menu"
            onChange={loadTemplate}
          />
        </div>
        <div className="workflow-toolbar-actions">
          <button type="button" className="agent-definition-icon-button" title="恢复当前模板" aria-label="恢复当前模板" disabled={!templateId} onClick={() => loadTemplate(templateId)}><RotateCcw size={14} /></button>
          <button type="button" className="agent-mux-secondary-button" onClick={saveDraft} disabled={!dirty}><Save size={14} />{dirty ? '保存草稿' : '已保存'}</button>
          <button type="button" className="agent-mux-primary-button workflow-publish-button" onClick={publishWorkflow} disabled={workflow.status === 'active' && !dirty}><Upload size={14} />{workflow.status === 'active' ? '发布更新' : '发布'}</button>
          <button type="button" className="agent-mux-primary-button" onClick={simulateRun}><Play size={14} />预演流程</button>
        </div>
      </div>

      <div className="workflow-layout">
        <WorkflowPalette onAdd={addNode} onPointerDrop={handlePaletteDrop} onPointerDrag={updatePaletteDrag} onDragStateChange={cancelPaletteDrag} />

        <main
          ref={canvasRef}
          className={`workflow-canvas agent-definition-canvas tool-${canvasTool}${dragActive ? ' drag-active' : ''}`}
        >
          <ReactFlow<WorkflowCanvasNode, WorkflowCanvasEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onNodesDelete={() => { setSelection(null); setDirty(true); setFeedback({ tone: 'neutral', text: '已删除选中的节点及其连接。' }); }}
            onEdgesDelete={() => { setSelection(null); setDirty(true); setFeedback({ tone: 'neutral', text: '已删除选中的执行路径。' }); }}
            onConnect={handleConnect}
            isValidConnection={isValidConnection}
            onNodeClick={(_, node) => { setNodeContextMenu(null); setSelection({ type: 'node', id: node.id }); }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              setSelection({ type: 'node', id: node.id });
              setNodeContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
            }}
            onEdgeClick={(_, edge) => { setNodeContextMenu(null); setSelection({ type: 'edge', id: edge.id }); }}
            onPaneClick={() => { setNodeContextMenu(null); setSelection(null); }}
            fitView={fitInitialGraph}
            fitViewOptions={{ padding: 0.14 }}
            minZoom={0.38}
            maxZoom={1.65}
            deleteKeyCode={['Backspace', 'Delete']}
            selectionOnDrag={canvasTool === 'select'}
            panOnDrag={canvasTool === 'pan' ? [0, 1, 2] : [2]}
            nodesDraggable={canvasTool === 'select'}
            elementsSelectable={canvasTool === 'select'}
            edgesReconnectable={false}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } }}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={miniMapNodeColor} maskColor="color-mix(in srgb, var(--app-bg) 62%, transparent)" />
            <Panel position="top-left" className="workflow-canvas-tools">
              <button type="button" className={canvasTool === 'select' ? 'active' : ''} title="选择与框选" aria-label="选择与框选" onClick={() => setCanvasTool('select')}><MousePointer2 size={15} /></button>
              <button type="button" className={canvasTool === 'pan' ? 'active' : ''} title="拖动画布" aria-label="拖动画布" onClick={() => setCanvasTool('pan')}><Hand size={15} /></button>
              <span aria-hidden="true" />
              <button type="button" title="适配全部节点" aria-label="适配全部节点" onClick={() => void fitView({ padding: 0.14, duration: 220 })}><Maximize2 size={15} /></button>
            </Panel>
          </ReactFlow>

          <div className="workflow-canvas-legend agent-definition-canvas-legend" aria-label="工作流图例">
            <span><i className="workflow-next" />顺序执行</span>
            <span><i className="workflow-approved" />满足条件</span>
            <span><MessageCircleMore size={12} />讨论节点内循环</span>
          </div>

          <div className={`workflow-feedback agent-definition-feedback ${feedback.tone}`} role="status" aria-live="polite">
            {feedback.tone === 'danger' ? <CircleAlert size={14} /> : feedback.tone === 'success' ? <Check size={14} /> : <Sparkles size={14} />}
            {feedback.text}
          </div>
        </main>

        <WorkflowInspector
          nodes={nodes}
          edges={edges}
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          onUpdateNode={updateNode}
          onUpdateEdge={updateEdge}
          onRemove={removeSelection}
          agentRecords={agentRecords}
        />
        {dragPreview ? <WorkflowDragPreviewCard preview={dragPreview} canvas={canvasRef.current?.getBoundingClientRect() ?? null} /> : null}
        <PopoverPortal
          open={Boolean(nodeContextMenu)}
          anchorRef={canvasRef}
          virtualAnchor={nodeContextMenu ? { x: nodeContextMenu.x, y: nodeContextMenu.y } : null}
          placement="bottom-start"
          offset={0}
        >
          <div ref={nodeContextMenuRef} className="workspace-menu workflow-node-context-menu" role="menu" aria-label="节点菜单">
            <button type="button" className="workspace-menu-item" role="menuitem" onClick={() => nodeContextMenu && duplicateNode(nodeContextMenu.nodeId)}>
              <Copy size={14} /><span>复制节点</span>
            </button>
            <div className="workspace-menu-divider" role="separator" />
            <button type="button" className="workspace-menu-item danger" role="menuitem" onClick={() => nodeContextMenu && removeNode(nodeContextMenu.nodeId)}>
              <Trash2 size={14} /><span>删除节点</span>
            </button>
          </div>
        </PopoverPortal>
      </div>
    </div>
  );
}

function WorkflowPalette({
  onAdd,
  onPointerDrop,
  onPointerDrag,
  onDragStateChange,
}: {
  onAdd: (kind: WorkflowNodeKind) => void;
  onPointerDrop: (kind: WorkflowNodeKind, position: { x: number; y: number }) => void;
  onPointerDrag: (kind: WorkflowNodeKind, position: { x: number; y: number }) => void;
  onDragStateChange: () => void;
}) {
  const pointerDrag = useRef<{ kind: WorkflowNodeKind; x: number; y: number; moved: boolean } | null>(null);
  const ignoreNextClick = useRef(false);

  function startPointerDrag(event: React.PointerEvent<HTMLButtonElement>, kind: WorkflowNodeKind) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerDrag.current = { kind, x: event.clientX, y: event.clientY, moved: false };
  }

  function movePointerDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = pointerDrag.current;
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) {
      drag.moved = true;
    }
    if (drag.moved) onPointerDrag(drag.kind, { x: event.clientX, y: event.clientY });
  }

  function finishPointerDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = pointerDrag.current;
    pointerDrag.current = null;
    if (!drag?.moved) return;
    ignoreNextClick.current = true;
    onPointerDrop(drag.kind, { x: event.clientX, y: event.clientY });
  }

  return (
    <aside className="workflow-palette agent-definition-palette">
      <div className="agent-definition-panel-head"><span>节点库</span><small>拖入画布</small></div>
      <div className="agent-definition-palette-scroll">
        <section className="agent-definition-resource-section">
          <div className="agent-definition-resource-heading"><span>基础节点</span><small>{WORKFLOW_NODE_LIBRARY.length} 项</small></div>
          <div className="agent-definition-resource-list">
            {WORKFLOW_NODE_LIBRARY.map((item) => (
              <button
                key={item.kind}
                type="button"
                title={`添加${item.label}`}
                onClick={() => {
                  if (ignoreNextClick.current) {
                    ignoreNextClick.current = false;
                    return;
                  }
                  onAdd(item.kind);
                }}
                onPointerDown={(event) => startPointerDrag(event, item.kind)}
                onPointerMove={movePointerDrag}
                onPointerUp={finishPointerDrag}
                onPointerCancel={() => {
                  pointerDrag.current = null;
                  onDragStateChange();
                }}
              >
                <GripVertical size={13} />
                <NodeKindIcon kind={item.kind} />
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
                <Plus size={13} />
              </button>
            ))}
          </div>
        </section>
        <section className="workflow-palette-note">
          <MessageCircleMore size={15} />
          <div><strong>多轮讨论</strong><p>节点内部持续执行“提案 → 审查 → 修订”，满意时继续，否则最多运行到设定轮数。</p></div>
        </section>
      </div>
    </aside>
  );
}

function WorkflowDragPreviewCard({ preview, canvas }: { preview: Exclude<WorkflowDragPreview, null>; canvas: DOMRect | null }) {
  const item = WORKFLOW_NODE_LIBRARY.find((candidate) => candidate.kind === preview.kind);
  if (!item) return null;
  const canDrop = Boolean(canvas && preview.x >= canvas.left && preview.x <= canvas.right && preview.y >= canvas.top && preview.y <= canvas.bottom);
  return (
    <div
      className={`workflow-drag-preview ${canDrop ? 'can-drop' : ''}`}
      style={{ left: preview.x + 14, top: preview.y + 14 }}
      aria-hidden="true"
    >
      <NodeKindIcon kind={item.kind} />
      <span><strong>{item.label}</strong><small>{canDrop ? '松开以添加到画布' : '拖到画布内'}</small></span>
    </div>
  );
}

function WorkflowInspector({
  nodes,
  edges,
  selectedNode,
  selectedEdge,
  onUpdateNode,
  onUpdateEdge,
  onRemove,
  agentRecords,
}: {
  nodes: WorkflowCanvasNode[];
  edges: WorkflowCanvasEdge[];
  selectedNode: WorkflowCanvasNode | null;
  selectedEdge: WorkflowCanvasEdge | null;
  onUpdateNode: (id: string, update: Partial<WorkflowNodeData>) => void;
  onUpdateEdge: (id: string, condition: WorkflowEdgeCondition) => void;
  onRemove: () => void;
  agentRecords: AgentMuxRecord[];
}) {
  const source = selectedEdge ? nodes.find((node) => node.id === selectedEdge.source) : null;
  const target = selectedEdge ? nodes.find((node) => node.id === selectedEdge.target) : null;
  const discussion = nodes.find((node) => node.data.kind === 'discussion');
  const profileOptions = buildWorkflowProfileOptions(agentRecords);

  return (
    <aside className="workflow-inspector agent-definition-inspector">
      <div className="agent-definition-panel-head"><span>配置</span><small>{selectedNode ? nodeLabels[selectedNode.data.kind] : selectedEdge ? '执行路径' : '流程概览'}</small></div>
      <div className="agent-definition-inspector-scroll">
        {selectedNode ? (
          <>
            <div className={`workflow-inspector-title agent-definition-inspector-title ${selectedNode.data.kind}`}>
              <NodeKindIcon kind={selectedNode.data.kind} />
              <div><strong>{selectedNode.data.label}</strong><small>{nodeLabels[selectedNode.data.kind]}</small></div>
            </div>
            <label className="agent-definition-field">
              <span>节点名称</span>
              <input value={selectedNode.data.label} onChange={(event) => onUpdateNode(selectedNode.id, { label: event.target.value })} />
            </label>
            <label className="agent-definition-field">
              <span>任务说明</span>
              <textarea rows={4} value={selectedNode.data.description} onChange={(event) => onUpdateNode(selectedNode.id, { description: event.target.value })} />
            </label>

            {selectedNode.data.kind === 'agent' ? (
              <InspectorSelect
                label="执行配置"
                ariaLabel="选择执行 Agent 配置"
                value={selectedNode.data.profileId ?? ''}
                options={profileOptions}
                placeholder="自动匹配角色"
                onChange={(profileId) => {
                  const binding = findWorkflowProfileBinding(profileId, agentRecords);
                  if (binding) onUpdateNode(selectedNode.id, { agentId: binding.agentId, profileId });
                }}
              />
            ) : null}

            {selectedNode.data.kind === 'discussion' ? (
              <>
                <InspectorSelect
                  label="A · 提案配置"
                  ariaLabel="选择提案 Agent"
                  value={selectedNode.data.proposerProfileId ?? ''}
                  options={profileOptions}
                  placeholder="自动匹配提案角色"
                  onChange={(proposerProfileId) => {
                    const binding = findWorkflowProfileBinding(proposerProfileId, agentRecords);
                    if (binding) onUpdateNode(selectedNode.id, { proposerAgentId: binding.agentId, proposerProfileId });
                  }}
                />
                <InspectorSelect
                  label="B · 审查配置"
                  ariaLabel="选择审查 Agent"
                  value={selectedNode.data.reviewerProfileId ?? ''}
                  options={profileOptions}
                  placeholder="自动匹配审查角色"
                  onChange={(reviewerProfileId) => {
                    const binding = findWorkflowProfileBinding(reviewerProfileId, agentRecords);
                    if (binding) onUpdateNode(selectedNode.id, { reviewerAgentId: binding.agentId, reviewerProfileId });
                  }}
                />
                <label className="agent-definition-field">
                  <span>最大讨论轮数</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={selectedNode.data.maxRounds ?? 10}
                    onChange={(event) => onUpdateNode(selectedNode.id, { maxRounds: clampRounds(event.target.value) })}
                  />
                </label>
                <label className="agent-definition-field">
                  <span>满意条件</span>
                  <textarea rows={3} value={selectedNode.data.satisfactionRule ?? ''} onChange={(event) => onUpdateNode(selectedNode.id, { satisfactionRule: event.target.value })} />
                </label>
                <div className="workflow-discussion-state">
                  <div><span>当前轮次</span><strong>{selectedNode.data.currentRound ?? 0} / {selectedNode.data.maxRounds ?? 10}</strong></div>
                  <ol>
                    <li>A 输出方案或修订稿</li>
                    <li>B 审查并给出意见</li>
                    <li>B 满意则结束，否则回到 A</li>
                  </ol>
                </div>
              </>
            ) : null}

            <button type="button" className="agent-definition-remove-button" onClick={onRemove}><Trash2 size={14} />删除节点</button>
          </>
        ) : selectedEdge ? (
          <>
            <div className="workflow-inspector-title agent-definition-inspector-title relation">
              <GitBranch size={17} />
              <div><strong>{source?.data.label} → {target?.data.label}</strong><small>执行路径</small></div>
            </div>
            <InspectorSelect
              label="路径条件"
              ariaLabel="选择路径条件"
              value={selectedEdge.data?.condition ?? 'next'}
              options={conditionOptions}
              onChange={(condition) => onUpdateEdge(selectedEdge.id, condition as WorkflowEdgeCondition)}
            />
            <div className="agent-definition-readonly-block">
              <span>说明</span>
              <p>“继续修订”用于普通返工分支；多轮讨论节点本身已经包含 A/B 循环，不需要手工画回环线。</p>
            </div>
            <button type="button" className="agent-definition-remove-button" onClick={onRemove}><Unlink size={14} />删除路径</button>
          </>
        ) : (
          <div className="workflow-overview agent-definition-overview">
            <div><span>节点</span><strong>{nodes.length}</strong></div>
            <div><span>路径</span><strong>{edges.length}</strong></div>
            <div><span>Agent 任务</span><strong>{nodes.filter((node) => node.data.kind === 'agent').length}</strong></div>
            <div><span>讨论轮次</span><strong>{discussion?.data.currentRound ?? 0}/{discussion?.data.maxRounds ?? 0}</strong></div>
            <p>选择节点可编辑配置，选择连线可设置执行条件。所有修改仅保存在当前 Mock 页面。</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function InspectorSelect({
  label,
  ariaLabel,
  value,
  options,
  onChange,
  placeholder,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="workflow-inspector-select agent-definition-field">
      <span>{label}</span>
      <StandardSelect<string>
        value={value}
        options={options}
        ariaLabel={ariaLabel}
        className="workflow-node-select"
        triggerClassName="workflow-select-trigger"
        menuClassName="workflow-select-menu"
        onChange={onChange}
        placeholder={placeholder}
      />
    </div>
  );
}

function buildWorkflowProfileOptions(records: AgentMuxRecord[]) {
  return records.flatMap((record) => record.profiles
    .filter((profile) => profile.status === 'available')
    .map((profile) => ({ value: profile.id, label: `${profile.nickname || record.name} · ${profile.model}` })));
}

function findWorkflowProfileBinding(profileId: string, records: AgentMuxRecord[]) {
  for (const record of records) {
    if (record.profiles.some((profile) => profile.id === profileId && profile.status === 'available')) return { agentId: record.id };
  }
  return null;
}

function WorkflowNode({ data, selected }: NodeProps<WorkflowCanvasNode>) {
  const canReceive = data.kind !== 'start';
  const canContinue = data.kind !== 'end';
  const agentDetail = data.kind === 'agent'
    ? agentLabel(data.agentId)
    : data.kind === 'discussion'
      ? `${agentLabel(data.proposerAgentId, true)} ↔ ${agentLabel(data.reviewerAgentId, true)}`
      : data.description;
  return (
    <div className={`workflow-node agent-definition-node ${data.kind}${selected ? ' selected' : ''}`}>
      {canReceive ? <Handle type="target" position={Position.Left} /> : null}
      <div className="agent-definition-node-icon"><NodeKindIcon kind={data.kind} /></div>
      <div className="agent-definition-node-copy">
        <span>{nodeLabels[data.kind]}</span>
        <strong>{data.label}</strong>
        <small>{agentDetail}</small>
        {data.kind === 'discussion' ? (
          <div className="workflow-node-loop">
            <span>第 {data.currentRound ?? 0}/{data.maxRounds ?? 10} 轮</span>
            <span>满意则结束，否则继续</span>
          </div>
        ) : null}
      </div>
      <span className={`workflow-node-status ${data.status ?? 'idle'}`} title={statusLabel(data.status)} />
      {canContinue ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  );
}

function NodeKindIcon({ kind }: { kind: WorkflowNodeKind }) {
  if (kind === 'start') return <CirclePlay size={16} />;
  if (kind === 'agent') return <Bot size={16} />;
  if (kind === 'discussion') return <MessageCircleMore size={16} />;
  if (kind === 'approval') return <UserRoundCheck size={16} />;
  return <Flag size={16} />;
}

function buildCanvasGraph(templateId: string) {
  const template = cloneWorkflowTemplate(templateId);
  return {
    template,
    nodes: template.nodes.map<WorkflowCanvasNode>((node) => ({ ...node, type: 'workflow' })),
    edges: template.edges.map(createCanvasEdge),
  };
}

function buildCanvasGraphFromWorkflow(workflow: WorkflowSavedWorkflow) {
  return {
    nodes: structuredClone(workflow.nodes).map<WorkflowCanvasNode>((node) => ({ ...node, type: 'workflow' })),
    edges: structuredClone(workflow.edges).map(createCanvasEdge),
  };
}

function createCanvasEdge(edge: WorkflowMockEdge): WorkflowCanvasEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'smoothstep',
    label: conditionLabels[edge.condition],
    className: `workflow-edge ${edge.condition}`,
    markerEnd: { type: MarkerType.ArrowClosed },
    data: { condition: edge.condition },
  };
}

function defaultNodeData(kind: WorkflowNodeKind, label: string, description: string): WorkflowNodeData {
  if (kind === 'agent') return { kind, label, description, agentId: 'implementer', status: 'idle' };
  if (kind === 'discussion') return {
    kind,
    label,
    description,
    proposerAgentId: 'architect',
    reviewerAgentId: 'reviewer',
    maxRounds: 10,
    currentRound: 0,
    satisfactionRule: '审查 Agent 明确表示满意',
    status: 'idle',
  };
  return { kind, label, description, status: kind === 'approval' ? 'waiting' : 'idle' };
}

function validateWorkflow(nodes: WorkflowCanvasNode[], edges: WorkflowCanvasEdge[]) {
  const start = nodes.find((node) => node.data.kind === 'start');
  const end = nodes.find((node) => node.data.kind === 'end');
  if (!start) return '流程至少需要一个开始节点。';
  if (!end) return '流程至少需要一个结束节点。';
  if (!edges.some((edge) => edge.source === start.id)) return '开始节点尚未连接后续步骤。';
  if (!edges.some((edge) => edge.target === end.id)) return '结束节点尚未接入流程。';
  const discussion = nodes.find((node) => node.data.kind === 'discussion');
  if (discussion && (!discussion.data.proposerAgentId || !discussion.data.reviewerAgentId)) return '多轮讨论需要同时配置提案 Agent 和审查 Agent。';
  return null;
}

function validatePublishedWorkflowProfiles(nodes: WorkflowCanvasNode[], records: AgentMuxRecord[]) {
  const availableProfiles = new Set(records.flatMap((record) => record.profiles.filter((profile) => profile.status === 'available').map((profile) => profile.id)));
  for (const node of nodes) {
    const bindings = node.data.kind === 'discussion'
      ? [node.data.proposerProfileId, node.data.reviewerProfileId]
      : [node.data.profileId];
    if (bindings.some((profileId) => profileId && !availableProfiles.has(profileId))) return `“${node.data.label}”绑定的 Agent 配置当前不可用。`;
  }
  return null;
}

function agentLabel(agentId?: string, short = false) {
  const label = WORKFLOW_AGENT_OPTIONS.find((option) => option.value === agentId)?.label ?? '未选择 Agent';
  return short ? label.split(' · ')[0] : label;
}

function clampRounds(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Math.min(20, Math.max(1, Number.isFinite(parsed) ? parsed : 10));
}

function statusLabel(status?: WorkflowNodeData['status']) {
  if (status === 'running') return '运行中';
  if (status === 'waiting') return '等待处理';
  if (status === 'completed') return '已完成';
  return '未运行';
}

function miniMapNodeColor(node: WorkflowCanvasNode) {
  if (node.data.kind === 'start' || node.data.kind === 'end') return '#1f9d68';
  if (node.data.kind === 'discussion') return '#7c5ac7';
  if (node.data.kind === 'approval') return '#c58a22';
  return '#2f7dd1';
}
