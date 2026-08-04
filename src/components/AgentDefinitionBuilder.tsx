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
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  Boxes,
  Check,
  CircleAlert,
  CircleDot,
  Cpu,
  GripVertical,
  Link2,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Unlink,
  Wrench,
} from 'lucide-react';
import { AgentProviderIcon } from './AgentProviderIcon';
import type { AgentDefinition, SkillDefinition } from './AgentHubPrototype';

type BuilderNodeKind = 'agent' | 'capability' | 'skill' | 'runtime';
type ResourceNodeKind = Exclude<BuilderNodeKind, 'agent'>;
type RelationKind = 'owns' | 'calls' | 'executes';

type BuilderNodeData = {
  kind: BuilderNodeKind;
  resourceId: string;
  label: string;
  subtitle: string;
  description: string;
  providerId?: string;
  priority?: number;
};

type BuilderNode = Node<BuilderNodeData, 'definition'>;
type BuilderEdge = Edge<{ relation: RelationKind }>;

type PaletteResource = {
  key: string;
  kind: ResourceNodeKind;
  id: string;
  label: string;
  subtitle: string;
  description: string;
  providerId?: string;
};

type Selection =
  | { type: 'node'; id: string }
  | { type: 'edge'; id: string }
  | null;

type Feedback = {
  tone: 'neutral' | 'danger' | 'success';
  text: string;
};

const RESOURCE_MIME = 'application/codem-agent-definition-resource';

const relationLabels: Record<RelationKind, string> = {
  owns: '拥有',
  calls: '调用',
  executes: '执行',
};

const kindLabels: Record<BuilderNodeKind, string> = {
  agent: 'Agent',
  capability: '能力',
  skill: 'Skill',
  runtime: '运行配置',
};

const nodeTypes = {
  definition: DefinitionNode,
};

export function AgentDefinitionBuilder({
  agent,
  skills,
  onCancel,
  onSave,
}: {
  agent: AgentDefinition;
  skills: SkillDefinition[];
  onCancel: () => void;
  onSave: (agent: AgentDefinition) => void;
}) {
  return (
    <ReactFlowProvider>
      <AgentDefinitionBuilderCanvas agent={agent} skills={skills} onCancel={onCancel} onSave={onSave} />
    </ReactFlowProvider>
  );
}

function AgentDefinitionBuilderCanvas({
  agent,
  skills,
  onCancel,
  onSave,
}: {
  agent: AgentDefinition;
  skills: SkillDefinition[];
  onCancel: () => void;
  onSave: (agent: AgentDefinition) => void;
}) {
  const resources = useMemo(() => buildResources(agent, skills), [agent, skills]);
  const initialGraph = useMemo(() => buildInitialGraph(agent, skills), [agent, skills]);
  const [nodes, setNodes] = useState<BuilderNode[]>(initialGraph.nodes);
  const [edges, setEdges] = useState<BuilderEdge[]>(initialGraph.edges);
  const [selection, setSelection] = useState<Selection>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [dirty, setDirty] = useState(false);
  const [resourceDragActive, setResourceDragActive] = useState(false);
  const canvasRef = useRef<HTMLElement | null>(null);
  const { fitView, screenToFlowPosition } = useReactFlow<BuilderNode, BuilderEdge>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void fitView({ padding: 0.16, duration: 180 }));
    });
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fitView]);

  const usedResourceKeys = useMemo(() => new Set(nodes
    .filter((node) => node.data.kind !== 'agent')
    .map((node) => resourceKey(node.data.kind as ResourceNodeKind, node.data.resourceId))), [nodes]);
  const selectedNode = selection?.type === 'node'
    ? nodes.find((node) => node.id === selection.id) ?? null
    : null;
  const selectedEdge = selection?.type === 'edge'
    ? edges.find((edge) => edge.id === selection.id) ?? null
    : null;

  const handleNodesChange = useCallback((changes: NodeChange<BuilderNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
    if (changes.some((change) => change.type === 'remove' || change.type === 'position')) {
      setDirty(true);
    }
  }, []);

  const handleEdgesChange = useCallback((changes: EdgeChange<BuilderEdge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
    if (changes.some((change) => change.type === 'remove')) {
      setDirty(true);
    }
  }, []);

  const getRelation = useCallback((connection: Pick<Connection, 'source' | 'target'>) => {
    const source = nodes.find((node) => node.id === connection.source);
    const target = nodes.find((node) => node.id === connection.target);
    if (!source || !target || source.id === target.id) return null;
    if (source.data.kind === 'agent' && target.data.kind === 'capability') return 'owns' as const;
    if (source.data.kind === 'agent' && target.data.kind === 'skill') return 'calls' as const;
    if (source.data.kind === 'skill' && target.data.kind === 'runtime') return 'executes' as const;
    return null;
  }, [nodes]);

  const isValidConnection = useCallback((connection: Connection | BuilderEdge) => {
    if (!getRelation(connection)) return false;
    return !edges.some((edge) => edge.source === connection.source && edge.target === connection.target);
  }, [edges, getRelation]);

  const handleConnect = useCallback((connection: Connection) => {
    const relation = getRelation(connection);
    if (!relation) {
      setFeedback({ tone: 'danger', text: '这两个节点之间没有可用的业务关系。' });
      return;
    }
    if (edges.some((edge) => edge.source === connection.source && edge.target === connection.target)) {
      setFeedback({ tone: 'danger', text: '这条关系已经存在。' });
      return;
    }
    setEdges((current) => addEdge(createEdge(connection.source, connection.target, relation), current));
    setDirty(true);
    setFeedback({ tone: 'success', text: `已建立“${relationLabels[relation]}”关系。` });
  }, [edges, getRelation]);

  const addResource = useCallback((resource: PaletteResource, position?: { x: number; y: number }) => {
    const key = resourceKey(resource.kind, resource.id);
    if (usedResourceKeys.has(key)) {
      setFeedback({ tone: 'danger', text: `${resource.label} 已经在画布中。` });
      return;
    }
    const sameKindCount = nodes.filter((node) => node.data.kind === resource.kind).length;
    const fallbackPosition = defaultResourcePosition(resource.kind, sameKindCount);
    setNodes((current) => [...current, createResourceNode(resource, position ?? fallbackPosition)]);
    setSelection({ type: 'node', id: nodeId(resource.kind, resource.id) });
    setDirty(true);
    setFeedback({ tone: 'neutral', text: `已添加 ${resource.label}，连接后才会纳入定义。` });
  }, [nodes, usedResourceKeys]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setResourceDragActive(false);
    const serialized = event.dataTransfer.getData(RESOURCE_MIME);
    if (!serialized) return;
    const resource = JSON.parse(serialized) as PaletteResource;
    const position = screenToFlowPosition({ x: event.clientX - 92, y: event.clientY - 34 });
    addResource(resource, position);
  }, [addResource, screenToFlowPosition]);

  function updateNodeData(nodeIdValue: string, update: Partial<BuilderNodeData>) {
    setNodes((current) => current.map((node) => (
      node.id === nodeIdValue ? { ...node, data: { ...node.data, ...update } } : node
    )));
    setDirty(true);
  }

  function removeSelection() {
    if (!selection) return;
    if (selection.type === 'edge') {
      setEdges((current) => current.filter((edge) => edge.id !== selection.id));
      setFeedback({ tone: 'neutral', text: '关系已删除。' });
    } else {
      const node = nodes.find((item) => item.id === selection.id);
      if (!node || node.data.kind === 'agent') return;
      setNodes((current) => current.filter((item) => item.id !== selection.id));
      setEdges((current) => current.filter((edge) => edge.source !== selection.id && edge.target !== selection.id));
      setFeedback({ tone: 'neutral', text: `${node.data.label} 已移回资源池。` });
    }
    setSelection(null);
    setDirty(true);
  }

  function resetGraph() {
    setNodes(initialGraph.nodes);
    setEdges(initialGraph.edges);
    setSelection(null);
    setDirty(false);
    setFeedback({ tone: 'neutral', text: '已恢复进入编辑时的定义。' });
    requestAnimationFrame(() => void fitView({ padding: 0.16, duration: 240 }));
  }

  function moveRuntime(nodeIdValue: string, direction: -1 | 1) {
    setNodes((current) => {
      const runtimeNodes = current
        .filter((node) => node.data.kind === 'runtime')
        .sort(compareRuntimeNodes);
      const index = runtimeNodes.findIndex((node) => node.id === nodeIdValue);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= runtimeNodes.length) return current;
      const sourceNode = runtimeNodes[index];
      const targetNode = runtimeNodes[targetIndex];
      return current.map((node) => {
        if (node.id === sourceNode.id) {
          return { ...node, position: { ...node.position, y: targetNode.position.y }, data: { ...node.data, priority: targetIndex } };
        }
        if (node.id === targetNode.id) {
          return { ...node, position: { ...node.position, y: sourceNode.position.y }, data: { ...node.data, priority: index } };
        }
        return node;
      });
    });
    setDirty(true);
  }

  function normalizeRuntimePriority() {
    setNodes((current) => {
      const priorityById = new Map(current
        .filter((node) => node.data.kind === 'runtime')
        .sort((left, right) => left.position.y - right.position.y)
        .map((node, index) => [node.id, index]));
      return current.map((node) => priorityById.has(node.id)
        ? { ...node, data: { ...node.data, priority: priorityById.get(node.id) } }
        : node);
    });
    setDirty(true);
  }

  function saveDefinition() {
    const validationError = validateGraph(nodes, edges);
    if (validationError) {
      setFeedback({ tone: 'danger', text: validationError });
      return;
    }
    const root = nodes.find((node) => node.data.kind === 'agent');
    if (!root) return;
    const connectedTargets = new Set(edges
      .filter((edge) => edge.source === root.id)
      .map((edge) => edge.target));
    const capabilityNodes = nodes
      .filter((node) => node.data.kind === 'capability' && connectedTargets.has(node.id))
      .sort(compareCanvasNodes);
    const skillNodes = nodes
      .filter((node) => node.data.kind === 'skill' && connectedTargets.has(node.id))
      .sort(compareCanvasNodes);
    const runtimeNodes = nodes
      .filter((node) => node.data.kind === 'runtime')
      .sort(compareRuntimeNodes);
    const activeProfileIds = runtimeNodes.map((node) => node.data.resourceId);
    const skillRuntimeBindings = Object.fromEntries(skillNodes.map((skillNode) => [
      skillNode.data.resourceId,
      edges
        .filter((edge) => edge.source === skillNode.id)
        .map((edge) => nodes.find((node) => node.id === edge.target))
        .filter((node): node is BuilderNode => node?.data.kind === 'runtime')
        .map((node) => node.data.resourceId),
    ]));
    onSave({
      ...agent,
      name: root.data.label.trim() || agent.name,
      role: root.data.subtitle.trim() || agent.role,
      description: root.data.description.trim() || agent.description,
      capabilities: capabilityNodes.map((node) => node.data.label.trim()).filter(Boolean),
      skillIds: skillNodes.map((node) => node.data.resourceId),
      activeProfileIds,
      skillRuntimeBindings,
    });
  }

  return (
    <div className="agent-definition-builder">
      <div className="agent-definition-toolbar">
        <button type="button" className="agent-definition-back" onClick={onCancel}>
          <ArrowLeft size={14} />返回详情
        </button>
        <div className="agent-definition-toolbar-title">
          <strong>编辑 {agent.name}</strong>
          <span className={dirty ? 'dirty' : ''}>{dirty ? '有未保存修改' : '定义已同步'}</span>
        </div>
        <div className="agent-definition-toolbar-actions">
          <button type="button" className="agent-definition-icon-button" title="恢复初始定义" onClick={resetGraph}>
            <RotateCcw size={14} />
          </button>
          <button type="button" className="agent-hub-secondary-button" onClick={onCancel}>取消</button>
          <button type="button" className="agent-hub-primary-button" onClick={saveDefinition}><Save size={14} />保存定义</button>
        </div>
      </div>

      <div className="agent-definition-layout">
        <ResourcePalette
          resources={resources}
          usedResourceKeys={usedResourceKeys}
          onAdd={addResource}
          onDragStart={() => setResourceDragActive(true)}
          onDragEnd={() => setResourceDragActive(false)}
        />

        <main
          ref={canvasRef}
          className={`agent-definition-canvas${resourceDragActive ? ' drag-active' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={handleDrop}
        >
          <ReactFlow<BuilderNode, BuilderEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            isValidConnection={isValidConnection}
            onNodeClick={(_, node) => setSelection({ type: 'node', id: node.id })}
            onEdgeClick={(_, edge) => setSelection({ type: 'edge', id: edge.id })}
            onPaneClick={() => setSelection(null)}
            onNodeDragStop={(_, node) => {
              if (node.data.kind === 'runtime') normalizeRuntimePriority();
            }}
            fitView
            fitViewOptions={{ padding: 0.16 }}
            minZoom={0.4}
            maxZoom={1.7}
            deleteKeyCode={null}
            edgesReconnectable={false}
            nodesConnectable
            nodesDraggable
            elementsSelectable
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              type: 'smoothstep',
              markerEnd: { type: MarkerType.ArrowClosed },
            }}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={miniMapNodeColor} maskColor="color-mix(in srgb, var(--app-bg) 62%, transparent)" />
          </ReactFlow>

          <div className="agent-definition-canvas-legend" aria-label="关系图例">
            <span><i className="owns" />拥有能力</span>
            <span><i className="calls" />调用 Skill</span>
            <span><i className="executes" />执行配置</span>
          </div>

          {feedback ? (
            <div className={`agent-definition-feedback ${feedback.tone}`} role="status">
              {feedback.tone === 'danger' ? <CircleAlert size={14} /> : feedback.tone === 'success' ? <Check size={14} /> : <CircleDot size={14} />}
              {feedback.text}
            </div>
          ) : null}
        </main>

        <DefinitionInspector
          nodes={nodes}
          edges={edges}
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          onUpdateNode={updateNodeData}
          onRemove={removeSelection}
          onMoveRuntime={moveRuntime}
        />
      </div>
    </div>
  );
}

function ResourcePalette({
  resources,
  usedResourceKeys,
  onAdd,
  onDragStart,
  onDragEnd,
}: {
  resources: PaletteResource[];
  usedResourceKeys: Set<string>;
  onAdd: (resource: PaletteResource) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <aside className="agent-definition-palette">
      <div className="agent-definition-panel-head">
        <span>资源池</span>
        <small>{resources.length} 项</small>
      </div>
      <div className="agent-definition-palette-scroll">
        {(['capability', 'skill', 'runtime'] as ResourceNodeKind[]).map((kind) => {
          const items = resources.filter((resource) => resource.kind === kind);
          return (
            <section className="agent-definition-resource-section" key={kind}>
              <div className="agent-definition-resource-heading">
                <span>{kindLabels[kind]}</span>
                <small>{items.filter((item) => !usedResourceKeys.has(item.key)).length} 可用</small>
              </div>
              <div className="agent-definition-resource-list">
                {items.map((resource) => {
                  const used = usedResourceKeys.has(resource.key);
                  return (
                    <button
                      type="button"
                      className={used ? 'used' : ''}
                      key={resource.key}
                      draggable={!used}
                      disabled={used}
                      onClick={() => onAdd(resource)}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(RESOURCE_MIME, JSON.stringify(resource));
                        event.dataTransfer.effectAllowed = 'copy';
                        onDragStart();
                      }}
                      onDragEnd={onDragEnd}
                      title={used ? '已在画布中' : '添加到画布'}
                    >
                      <GripVertical size={13} />
                      <ResourceIcon resource={resource} />
                      <span><strong>{resource.label}</strong><small>{resource.subtitle}</small></span>
                      {used ? <Check size={13} /> : <Plus size={13} />}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function DefinitionInspector({
  nodes,
  edges,
  selectedNode,
  selectedEdge,
  onUpdateNode,
  onRemove,
  onMoveRuntime,
}: {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  selectedNode: BuilderNode | null;
  selectedEdge: BuilderEdge | null;
  onUpdateNode: (id: string, update: Partial<BuilderNodeData>) => void;
  onRemove: () => void;
  onMoveRuntime: (id: string, direction: -1 | 1) => void;
}) {
  const runtimeCount = nodes.filter((node) => node.data.kind === 'runtime').length;
  const sourceNode = selectedEdge ? nodes.find((node) => node.id === selectedEdge.source) : null;
  const targetNode = selectedEdge ? nodes.find((node) => node.id === selectedEdge.target) : null;

  return (
    <aside className="agent-definition-inspector">
      <div className="agent-definition-panel-head">
        <span>检查器</span>
        <small>{selectedNode ? kindLabels[selectedNode.data.kind] : selectedEdge ? '关系' : '概览'}</small>
      </div>
      <div className="agent-definition-inspector-scroll">
        {selectedNode ? (
          <>
            <div className="agent-definition-inspector-title">
              <NodeKindIcon kind={selectedNode.data.kind} providerId={selectedNode.data.providerId} />
              <div><strong>{selectedNode.data.label}</strong><small>{selectedNode.data.subtitle}</small></div>
            </div>

            {selectedNode.data.kind === 'agent' || selectedNode.data.kind === 'capability' ? (
              <>
                <label className="agent-definition-field">
                  <span>{selectedNode.data.kind === 'agent' ? '名称' : '能力名称'}</span>
                  <input value={selectedNode.data.label} onChange={(event) => onUpdateNode(selectedNode.id, { label: event.target.value })} />
                </label>
                {selectedNode.data.kind === 'agent' ? (
                  <label className="agent-definition-field">
                    <span>角色标识</span>
                    <input value={selectedNode.data.subtitle} onChange={(event) => onUpdateNode(selectedNode.id, { subtitle: event.target.value })} />
                  </label>
                ) : null}
                <label className="agent-definition-field">
                  <span>说明</span>
                  <textarea rows={4} value={selectedNode.data.description} onChange={(event) => onUpdateNode(selectedNode.id, { description: event.target.value })} />
                </label>
              </>
            ) : (
              <div className="agent-definition-readonly-block">
                <span>来源</span>
                <strong>{selectedNode.data.kind === 'skill' ? '全局 Skill 定义' : 'Agent Provider Registry'}</strong>
                <p>{selectedNode.data.description}</p>
              </div>
            )}

            {selectedNode.data.kind === 'runtime' ? (
              <div className="agent-definition-priority-control">
                <div><span>故障切换顺序</span><strong>{runtimePriorityLabel(selectedNode.data.priority ?? 0)}</strong></div>
                <div>
                  <button type="button" title="提高优先级" disabled={(selectedNode.data.priority ?? 0) === 0} onClick={() => onMoveRuntime(selectedNode.id, -1)}><ArrowUp size={13} /></button>
                  <button type="button" title="降低优先级" disabled={(selectedNode.data.priority ?? 0) >= runtimeCount - 1} onClick={() => onMoveRuntime(selectedNode.id, 1)}><ArrowDown size={13} /></button>
                </div>
              </div>
            ) : null}

            {selectedNode.data.kind !== 'agent' ? (
              <button type="button" className="agent-definition-remove-button" onClick={onRemove}><Trash2 size={14} />移回资源池</button>
            ) : null}
          </>
        ) : selectedEdge ? (
          <>
            <div className="agent-definition-inspector-title relation">
              <Link2 size={17} />
              <div><strong>{relationLabels[selectedEdge.data?.relation ?? 'calls']}关系</strong><small>{selectedEdge.id}</small></div>
            </div>
            <div className="agent-definition-relation-summary">
              <div><span>来源节点</span><strong>{sourceNode?.data.label ?? selectedEdge.source}</strong></div>
              <Link2 size={14} />
              <div><span>目标节点</span><strong>{targetNode?.data.label ?? selectedEdge.target}</strong></div>
            </div>
            <div className="agent-definition-readonly-block">
              <span>业务语义</span>
              <p>{relationDescription(selectedEdge.data?.relation ?? 'calls')}</p>
            </div>
            <button type="button" className="agent-definition-remove-button" onClick={onRemove}><Unlink size={14} />删除关系</button>
          </>
        ) : (
          <div className="agent-definition-overview">
            <div><span>节点</span><strong>{nodes.length}</strong></div>
            <div><span>关系</span><strong>{edges.length}</strong></div>
            <div><span>能力</span><strong>{nodes.filter((node) => node.data.kind === 'capability').length}</strong></div>
            <div><span>运行配置</span><strong>{runtimeCount}</strong></div>
            <p>选择节点可编辑属性；选择连线可查看或删除关系。</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function DefinitionNode({ data, selected }: NodeProps<BuilderNode>) {
  const hasTarget = data.kind !== 'agent';
  const hasSource = data.kind === 'agent' || data.kind === 'skill';
  return (
    <div className={`agent-definition-node ${data.kind}${selected ? ' selected' : ''}`}>
      {hasTarget ? <Handle type="target" position={Position.Left} /> : null}
      <div className="agent-definition-node-icon"><NodeKindIcon kind={data.kind} providerId={data.providerId} /></div>
      <div className="agent-definition-node-copy">
        <span>{kindLabels[data.kind]}{data.kind === 'runtime' ? ` · ${runtimePriorityLabel(data.priority ?? 0)}` : ''}</span>
        <strong>{data.label}</strong>
        <small>{data.subtitle}</small>
      </div>
      <GripVertical className="agent-definition-node-grip" size={13} />
      {hasSource ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  );
}

function NodeKindIcon({ kind, providerId }: { kind: BuilderNodeKind; providerId?: string }) {
  if (kind === 'agent') return <Bot size={16} />;
  if (kind === 'capability') return <Wrench size={15} />;
  if (kind === 'skill') return <Sparkles size={15} />;
  if (providerId) return <AgentProviderIcon providerId={providerId} size={16} />;
  return <Cpu size={15} />;
}

function ResourceIcon({ resource }: { resource: PaletteResource }) {
  if (resource.kind === 'capability') return <Wrench size={14} />;
  if (resource.kind === 'skill') return <Sparkles size={14} />;
  if (resource.providerId) return <AgentProviderIcon providerId={resource.providerId} size={15} />;
  return <Boxes size={14} />;
}

function buildResources(agent: AgentDefinition, skills: SkillDefinition[]): PaletteResource[] {
  const capabilities = agent.capabilityCatalog.map((capability, index) => ({
    key: resourceKey('capability', `capability-${index}`),
    kind: 'capability' as const,
    id: `capability-${index}`,
    label: capability,
    subtitle: '能力声明',
    description: `${agent.name} 对外声明的 ${capability} 能力。`,
  }));
  const skillResources = skills.map((skill) => ({
    key: resourceKey('skill', skill.id),
    kind: 'skill' as const,
    id: skill.id,
    label: skill.name,
    subtitle: skill.capability,
    description: skill.summary,
  }));
  const runtimeResources = agent.profiles.map((profile) => ({
    key: resourceKey('runtime', profile.id),
    kind: 'runtime' as const,
    id: profile.id,
    label: profile.providerName,
    subtitle: `${profile.channel} · ${profile.model}`,
    description: `${profile.providerName} / ${profile.model}，当前延迟 ${profile.latency}。`,
    providerId: profile.providerId,
  }));
  return [...capabilities, ...skillResources, ...runtimeResources];
}

function buildInitialGraph(agent: AgentDefinition, skills: SkillDefinition[]) {
  const resources = buildResources(agent, skills);
  const capabilityResources = resources.filter((resource) => (
    resource.kind === 'capability' && agent.capabilities.includes(resource.label)
  ));
  const skillResources = resources.filter((resource) => resource.kind === 'skill' && agent.skillIds.includes(resource.id));
  const runtimeResources = resources.filter((resource) => (
    resource.kind === 'runtime' && agent.activeProfileIds.includes(resource.id)
  ));
  const rootId = nodeId('agent', agent.id);
  const nodes: BuilderNode[] = [
    {
      id: rootId,
      type: 'definition',
      position: { x: 40, y: 215 },
      deletable: false,
      data: {
        kind: 'agent',
        resourceId: agent.id,
        label: agent.name,
        subtitle: agent.role,
        description: agent.description,
      },
    },
    ...capabilityResources.map((resource, index) => createResourceNode(resource, { x: 340, y: 50 + index * 105 })),
    ...skillResources.map((resource, index) => createResourceNode(resource, { x: 340, y: 285 + index * 105 })),
    ...runtimeResources.map((resource, index) => createResourceNode(resource, { x: 650, y: 250 + index * 120 }, index)),
  ];
  const runtimeResourceById = new Map(runtimeResources.map((resource) => [resource.id, resource]));
  const executionEdges = skillResources.flatMap((skillResource) => (
    (agent.skillRuntimeBindings[skillResource.id] ?? [])
      .map((runtimeId) => runtimeResourceById.get(runtimeId))
      .filter((resource): resource is PaletteResource => Boolean(resource))
      .map((runtimeResource) => createEdge(
        nodeId('skill', skillResource.id),
        nodeId('runtime', runtimeResource.id),
        'executes',
      ))
  ));
  const linkedRuntimeIds = new Set(executionEdges.map((edge) => edge.target));
  const fallbackExecutionEdges = runtimeResources
    .filter((resource) => !linkedRuntimeIds.has(nodeId('runtime', resource.id)))
    .map((resource, index) => {
      const source = skillResources[index % Math.max(skillResources.length, 1)];
      return source
        ? createEdge(nodeId('skill', source.id), nodeId('runtime', resource.id), 'executes')
        : null;
    })
    .filter((edge): edge is BuilderEdge => Boolean(edge));
  const edges: BuilderEdge[] = [
    ...capabilityResources.map((resource) => createEdge(rootId, nodeId(resource.kind, resource.id), 'owns')),
    ...skillResources.map((resource) => createEdge(rootId, nodeId(resource.kind, resource.id), 'calls')),
    ...executionEdges,
    ...fallbackExecutionEdges,
  ];
  return { nodes, edges };
}

function createResourceNode(resource: PaletteResource, position: { x: number; y: number }, priority?: number): BuilderNode {
  return {
    id: nodeId(resource.kind, resource.id),
    type: 'definition',
    position,
    data: {
      kind: resource.kind,
      resourceId: resource.id,
      label: resource.label,
      subtitle: resource.subtitle,
      description: resource.description,
      providerId: resource.providerId,
      priority,
    },
  };
}

function createEdge(source: string, target: string, relation: RelationKind): BuilderEdge {
  return {
    id: `relation:${source}:${target}`,
    source,
    target,
    type: 'smoothstep',
    label: relationLabels[relation],
    className: `agent-definition-edge ${relation}`,
    markerEnd: { type: MarkerType.ArrowClosed },
    data: { relation },
  };
}

function validateGraph(nodes: BuilderNode[], edges: BuilderEdge[]) {
  const root = nodes.find((node) => node.data.kind === 'agent');
  if (!root) return '定义缺少 Agent 根节点。';
  const capabilities = nodes.filter((node) => node.data.kind === 'capability');
  const skills = nodes.filter((node) => node.data.kind === 'skill');
  const runtimes = nodes.filter((node) => node.data.kind === 'runtime');
  if (!skills.length) return '至少需要添加一个 Skill。';
  if (!runtimes.length) return '至少需要添加一个运行配置。';
  const unlinkedCapability = capabilities.find((node) => !edges.some((edge) => edge.source === root.id && edge.target === node.id));
  if (unlinkedCapability) return `能力“${unlinkedCapability.data.label}”尚未连接到 Agent。`;
  const unlinkedSkill = skills.find((node) => !edges.some((edge) => edge.source === root.id && edge.target === node.id));
  if (unlinkedSkill) return `Skill“${unlinkedSkill.data.label}”尚未连接到 Agent。`;
  const unboundSkill = skills.find((node) => !edges.some((edge) => (
    edge.source === node.id
    && nodes.find((target) => target.id === edge.target)?.data.kind === 'runtime'
  )));
  if (unboundSkill) return `Skill“${unboundSkill.data.label}”尚未连接运行配置。`;
  const unlinkedRuntime = runtimes.find((node) => !edges.some((edge) => edge.target === node.id && nodes.find((source) => source.id === edge.source)?.data.kind === 'skill'));
  if (unlinkedRuntime) return `运行配置“${unlinkedRuntime.data.label}”尚未连接到 Skill。`;
  return null;
}

function defaultResourcePosition(kind: ResourceNodeKind, count: number) {
  if (kind === 'runtime') return { x: 650, y: 250 + count * 110 };
  if (kind === 'skill') return { x: 340, y: 285 + count * 100 };
  return { x: 340, y: 50 + count * 100 };
}

function resourceKey(kind: ResourceNodeKind, id: string) {
  return `${kind}:${id}`;
}

function nodeId(kind: BuilderNodeKind, id: string) {
  return `${kind}:${id}`;
}

function compareCanvasNodes(left: BuilderNode, right: BuilderNode) {
  return left.position.y - right.position.y || left.position.x - right.position.x;
}

function compareRuntimeNodes(left: BuilderNode, right: BuilderNode) {
  return (left.data.priority ?? Number.MAX_SAFE_INTEGER) - (right.data.priority ?? Number.MAX_SAFE_INTEGER)
    || left.position.y - right.position.y;
}

function runtimePriorityLabel(priority: number) {
  return priority === 0 ? '默认' : `备选 ${priority}`;
}

function relationDescription(relation: RelationKind) {
  if (relation === 'owns') return '该能力属于当前 Agent 的能力声明，可参与 Skill 路由匹配。';
  if (relation === 'executes') return '该 Skill 可以使用目标运行配置执行，优先级由运行配置顺序决定。';
  return '当前 Agent 可以响应并执行该 Skill。';
}

function miniMapNodeColor(node: BuilderNode) {
  if (node.data.kind === 'agent') return '#2f7dd1';
  if (node.data.kind === 'skill') return '#8b5cf6';
  if (node.data.kind === 'runtime') return '#1f9d68';
  return '#c58a22';
}
