export type WorkflowNodeKind = 'start' | 'agent' | 'discussion' | 'approval' | 'end';
export type WorkflowEdgeCondition = 'next' | 'approved' | 'needs-work';
export type WorkflowNodeStatus = 'idle' | 'running' | 'waiting' | 'completed';

export type WorkflowNodeData = {
  kind: WorkflowNodeKind;
  label: string;
  description: string;
  agentId?: string;
  profileId?: string;
  proposerAgentId?: string;
  proposerProfileId?: string;
  reviewerAgentId?: string;
  reviewerProfileId?: string;
  maxRounds?: number;
  currentRound?: number;
  satisfactionRule?: string;
  status?: WorkflowNodeStatus;
};

export type WorkflowMockNode = {
  id: string;
  position: { x: number; y: number };
  data: WorkflowNodeData;
};

export type WorkflowMockEdge = {
  id: string;
  source: string;
  target: string;
  condition: WorkflowEdgeCondition;
};

export type WorkflowTemplate = {
  id: string;
  name: string;
  summary: string;
  nodes: WorkflowMockNode[];
  edges: WorkflowMockEdge[];
};

export type WorkflowSavedStatus = 'draft' | 'active';

export type WorkflowRunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export type WorkflowRunNodeStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export type WorkflowRunSource = 'saved' | 'temporary';

export type WorkflowRunLog = {
  id: string;
  role: 'system' | 'agent' | 'user';
  author: string;
  text: string;
  time: string;
};

export type WorkflowRunNode = {
  id: string;
  label: string;
  agent: string;
  status: WorkflowRunNodeStatus;
  summary: string;
  logs: WorkflowRunLog[];
  currentRound?: number;
  maxRounds?: number;
};

export type WorkflowMockRun = {
  id: string;
  workflowId: string | null;
  templateId: string;
  source: WorkflowRunSource;
  name: string;
  objective: string;
  status: WorkflowRunStatus;
  startedAt: string;
  duration: string;
  nodes: WorkflowRunNode[];
  savedAsWorkflowId?: string;
  executionMode?: 'preview' | 'agent';
};

export type WorkflowSavedWorkflow = {
  id: string;
  templateId: string;
  name: string;
  summary: string;
  status: WorkflowSavedStatus;
  updatedAt: string;
  nodes: WorkflowMockNode[];
  edges: WorkflowMockEdge[];
};

export const WORKFLOW_AGENT_OPTIONS = [
  { value: 'architect', label: '方案设计师 · Codex' },
  { value: 'reviewer', label: '审查专家 · Claude Code' },
  { value: 'implementer', label: '实现工程师 · Codex' },
  { value: 'verifier', label: '验证工程师 · Pi Agent' },
] as const;

export const WORKFLOW_NODE_LIBRARY: Array<{
  kind: WorkflowNodeKind;
  label: string;
  description: string;
}> = [
  { kind: 'start', label: '开始', description: '定义工作流入口和初始输入。' },
  { kind: 'agent', label: 'Agent 任务', description: '让指定 Agent 完成一次明确任务。' },
  { kind: 'discussion', label: '多轮讨论', description: '两个 Agent 持续提案、审查和修订，直到满意或达到轮数上限。' },
  { kind: 'approval', label: '人工确认', description: '暂停流程并等待用户确认后继续。' },
  { kind: 'end', label: '结束', description: '汇总结果并结束工作流。' },
];

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'solution-review',
    name: '方案评审',
    summary: 'A 提方案，B 持续审查，A 根据意见修订，满意后由 B 总结。',
    nodes: [
      node('solution-start', 'start', 20, 80, '接收需求', '读取用户目标、约束和验收预期。', { status: 'completed' }),
      node('solution-proposal', 'agent', 250, 80, 'A · 提出初始方案', '梳理边界并给出可执行方案。', { agentId: 'architect', status: 'completed' }),
      node('solution-discussion', 'discussion', 480, 80, 'A / B · 多轮评审', 'B 提意见，A 修订后继续交给 B 审查。', {
        proposerAgentId: 'architect',
        reviewerAgentId: 'reviewer',
        maxRounds: 10,
        currentRound: 3,
        satisfactionRule: '审查 Agent 明确给出“满意，可以定稿”',
        status: 'running',
      }),
      node('solution-summary', 'agent', 20, 300, 'B · 总结定稿', '整理最终方案、分歧记录和验收清单。', { agentId: 'reviewer' }),
      node('solution-approval', 'approval', 250, 300, '用户确认', '用户确认最终方案或要求继续讨论。', { status: 'waiting' }),
      node('solution-end', 'end', 480, 300, '方案完成', '输出确认后的最终方案。'),
    ],
    edges: [
      edge('solution-start', 'solution-proposal'),
      edge('solution-proposal', 'solution-discussion'),
      edge('solution-discussion', 'solution-summary', 'approved'),
      edge('solution-summary', 'solution-approval'),
      edge('solution-approval', 'solution-end', 'approved'),
    ],
  },
  {
    id: 'code-delivery',
    name: '代码交付',
    summary: '实现、审查、返工和验证组成一个可重复的交付闭环。',
    nodes: [
      node('delivery-start', 'start', 20, 80, '读取任务', '读取已确认的需求与仓库上下文。', { status: 'completed' }),
      node('delivery-build', 'agent', 250, 80, '实现变更', '按范围修改代码并运行最小检查。', { agentId: 'implementer', status: 'completed' }),
      node('delivery-review', 'discussion', 480, 80, '实现 / 审查闭环', '审查发现问题后返回实现 Agent 修订。', {
        proposerAgentId: 'implementer',
        reviewerAgentId: 'reviewer',
        maxRounds: 6,
        currentRound: 2,
        satisfactionRule: '没有阻断交付的高置信问题',
        status: 'running',
      }),
      node('delivery-verify', 'agent', 20, 300, '独立验证', '执行测试、构建和关键交互验收。', { agentId: 'verifier' }),
      node('delivery-approval', 'approval', 250, 300, '交付确认', '用户确认结果并决定是否提交。'),
      node('delivery-end', 'end', 480, 300, '完成交付', '归档结果与验证证据。'),
    ],
    edges: [
      edge('delivery-start', 'delivery-build'),
      edge('delivery-build', 'delivery-review'),
      edge('delivery-review', 'delivery-verify', 'approved'),
      edge('delivery-verify', 'delivery-approval'),
      edge('delivery-approval', 'delivery-end', 'approved'),
    ],
  },
  {
    id: 'root-cause',
    name: '问题诊断',
    summary: '先收集证据，再由两个 Agent 交叉验证根因，最后由用户确认处置。',
    nodes: [
      node('diagnosis-start', 'start', 20, 80, '收到异常', '记录现象、真实错误和复现条件。', { status: 'completed' }),
      node('diagnosis-evidence', 'agent', 250, 80, '收集证据', '追踪事件、退出码、日志和状态流转。', { agentId: 'verifier', status: 'completed' }),
      node('diagnosis-review', 'discussion', 480, 80, '根因交叉验证', 'A 给出根因假设，B 用证据反驳或确认。', {
        proposerAgentId: 'architect',
        reviewerAgentId: 'reviewer',
        maxRounds: 8,
        currentRound: 1,
        satisfactionRule: '双方对根因、影响范围和验证方法达成一致',
        status: 'running',
      }),
      node('diagnosis-plan', 'agent', 20, 300, '形成修复方案', '输出根因修复和回归验证步骤。', { agentId: 'architect' }),
      node('diagnosis-approval', 'approval', 250, 300, '用户决策', '确认修复范围或要求继续调查。'),
      node('diagnosis-end', 'end', 480, 300, '诊断完成', '输出可复核的诊断结论。'),
    ],
    edges: [
      edge('diagnosis-start', 'diagnosis-evidence'),
      edge('diagnosis-evidence', 'diagnosis-review'),
      edge('diagnosis-review', 'diagnosis-plan', 'approved'),
      edge('diagnosis-plan', 'diagnosis-approval'),
      edge('diagnosis-approval', 'diagnosis-end', 'approved'),
    ],
  },
];

export function cloneWorkflowTemplate(templateId: string) {
  const template = WORKFLOW_TEMPLATES.find((item) => item.id === templateId) ?? WORKFLOW_TEMPLATES[0];
  return structuredClone(template);
}

export function retryFailedWorkflowNode(run: WorkflowMockRun, nodeId: string): WorkflowMockRun {
  const target = run.nodes.find((node) => node.id === nodeId);
  if (!target || target.status !== 'failed') return structuredClone(run);
  return {
    ...structuredClone(run),
    status: 'running',
    duration: '刚刚重试',
    nodes: run.nodes.map((node) => node.id === nodeId ? {
      ...structuredClone(node),
      status: 'running',
      summary: '已保留原日志，正在重新执行当前节点。',
      logs: [...structuredClone(node.logs), runLog(`${node.id}-retry`, 'system', '工作流引擎', '用户已重试当前失败节点。', '刚刚')],
    } : structuredClone(node)),
  };
}

export function validateWorkflowGraph(workflow: Pick<WorkflowSavedWorkflow, 'nodes' | 'edges'>): string[] {
  const errors: string[] = [];
  const starts = workflow.nodes.filter((node) => node.data.kind === 'start');
  const ends = workflow.nodes.filter((node) => node.data.kind === 'end');
  if (starts.length !== 1) errors.push('工作流必须且只能有一个开始节点');
  if (ends.length !== 1) errors.push('工作流必须且只能有一个结束节点');
  const ids = new Set(workflow.nodes.map((node) => node.id));
  for (const edge of workflow.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) errors.push(`连线引用了不存在的节点：${edge.id}`);
    if (edge.source === edge.target) errors.push(`节点不能连接自身：${edge.id}`);
  }
  const outgoing = new Map<string, string[]>();
  for (const edge of workflow.edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) { errors.push('工作流不能包含循环'); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of outgoing.get(id) ?? []) visit(target);
    visiting.delete(id);
    visited.add(id);
  };
  if (starts[0]) visit(starts[0].id);
  if (ends[0] && !workflow.edges.some((edge) => edge.target === ends[0].id)) errors.push('结束节点尚未接入流程');
  return [...new Set(errors)];
}

export function advanceWorkflowRun(
  workflow: Pick<WorkflowSavedWorkflow, 'nodes' | 'edges'>,
  run: WorkflowMockRun,
): WorkflowMockRun {
  if (run.status !== 'running') return structuredClone(run);
  const next = structuredClone(run);
  const byWorkflowId = new Map(workflow.nodes.map((node) => [`${node.id}-run`, node.id]));
  const completed = new Set(next.nodes.filter((node) => node.status === 'completed').map((node) => byWorkflowId.get(node.id)).filter(Boolean));
  let progressed = false;
  next.nodes = next.nodes.map((node) => {
    if (node.status !== 'running') return node;
    const workflowNode = workflow.nodes.find((item) => `${item.id}-run` === node.id);
    if (workflowNode?.data.kind === 'discussion') {
      const currentRound = (node.currentRound ?? 0) + 1;
      const targetRounds = Math.min(node.maxRounds ?? workflowNode.data.maxRounds ?? 3, 3);
      if (currentRound < targetRounds) {
        progressed = true;
        return { ...node, currentRound, summary: `第 ${currentRound}/${targetRounds} 轮讨论完成，继续修订`, logs: [...node.logs, {
          id: `${node.id}-round-${currentRound}-${Date.now()}`, role: 'agent', author: '讨论节点', text: `第 ${currentRound} 轮已完成：审查方提出意见，提案方完成修订。`, time: '刚刚',
        }] };
      }
    }
    progressed = true;
    return { ...node, status: 'completed', summary: '节点已完成，输出已交给下游节点', logs: [...node.logs, {
      id: `${node.id}-complete-${Date.now()}`, role: 'system', author: '工作流引擎', text: '节点执行完成，开始检查下游依赖。', time: '刚刚',
    }] };
  });
  for (const node of next.nodes) if (node.status === 'completed') completed.add(byWorkflowId.get(node.id) ?? '');
  const ready = workflow.nodes.filter((node) => {
    const runNode = next.nodes.find((item) => item.id === `${node.id}-run`);
    if (!runNode || runNode.status !== 'pending') return false;
    const incoming = workflow.edges.filter((edge) => edge.target === node.id);
    return incoming.length === 0 || incoming.every((edge) => completed.has(edge.source));
  });
  for (const node of ready) {
    const runNode = next.nodes.find((item) => item.id === `${node.id}-run`);
    if (!runNode) continue;
    runNode.status = node.data.kind === 'approval' ? 'waiting' : 'running';
    runNode.summary = node.data.kind === 'approval' ? '等待用户确认后继续' : '正在执行节点任务';
    runNode.currentRound = node.data.kind === 'discussion' ? 0 : undefined;
    runNode.maxRounds = node.data.kind === 'discussion' ? node.data.maxRounds : undefined;
    runNode.logs.push({ id: `${runNode.id}-start-${Date.now()}`, role: 'system', author: '工作流引擎', text: '节点已满足依赖，开始执行。', time: '刚刚' });
    progressed = true;
  }
  if (next.nodes.length > 0 && next.nodes.every((node) => node.status === 'completed')) next.status = 'completed';
  else if (next.nodes.some((node) => node.status === 'waiting')) next.status = 'waiting';
  else if (!progressed && next.nodes.some((node) => node.status === 'pending')) next.status = 'failed';
  return next;
}

export function createSavedWorkflowFromTemplate(
  templateId: string,
  id: string,
  overrides: Partial<Pick<WorkflowSavedWorkflow, 'name' | 'summary' | 'status' | 'updatedAt'>> = {},
): WorkflowSavedWorkflow {
  const template = cloneWorkflowTemplate(templateId);
  return {
    id,
    templateId: template.id,
    name: overrides.name ?? `${template.name} 草稿`,
    summary: overrides.summary ?? template.summary,
    status: overrides.status ?? 'draft',
    updatedAt: overrides.updatedAt ?? '刚刚更新',
    nodes: template.nodes,
    edges: template.edges,
  };
}

export function createBlankWorkflow(id: string, overrides: Partial<Pick<WorkflowSavedWorkflow, 'name' | 'summary' | 'status' | 'updatedAt'>> = {}): WorkflowSavedWorkflow {
  return {
    id,
    templateId: '',
    name: overrides.name ?? '未命名工作流',
    summary: overrides.summary ?? '从画布添加节点并连接执行路径。',
    status: overrides.status ?? 'draft',
    updatedAt: overrides.updatedAt ?? '尚未保存',
    nodes: [],
    edges: [],
  };
}

export function isWorkflowConnectionAllowed(
  nodes: Array<Pick<WorkflowMockNode, 'id' | 'data'>>,
  edges: Array<Pick<WorkflowMockEdge, 'source' | 'target'>>,
  sourceId: string | null | undefined,
  targetId: string | null | undefined,
) {
  if (!sourceId || !targetId || sourceId === targetId) return false;
  const source = nodes.find((item) => item.id === sourceId);
  const target = nodes.find((item) => item.id === targetId);
  if (!source || !target || source.data.kind === 'end' || target.data.kind === 'start') return false;
  return !edges.some((item) => item.source === sourceId && item.target === targetId);
}

function node(
  id: string,
  kind: WorkflowNodeKind,
  x: number,
  y: number,
  label: string,
  description: string,
  extra: Partial<WorkflowNodeData> = {},
): WorkflowMockNode {
  return { id, position: { x, y }, data: { kind, label, description, status: 'idle', ...extra } };
}

function edge(source: string, target: string, condition: WorkflowEdgeCondition = 'next'): WorkflowMockEdge {
  return { id: `${source}:${target}`, source, target, condition };
}

function runLog(id: string, role: WorkflowRunLog['role'], author: string, text: string, time: string): WorkflowRunLog {
  return { id, role, author, text, time };
}
