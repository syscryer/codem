import {
  Activity,
  AlertCircle,
  Brain,
  Check,
  CircleCheck,
  CircleDashed,
  Database,
  Eye,
  ExternalLink,
  FileText,
  Gauge,
  LoaderCircle,
  Network,
  Play,
  Power,
  RefreshCw,
  RotateCw,
  Save,
  Server,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  Terminal,
  X,
  Wrench,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  fetchHermesBootstrap,
  createHermesMcp,
  deleteHermesLearningNode,
  deleteHermesMcp,
  fetchHermesLearningNode,
  fetchHermesProfileSoul,
  fetchHermesResource,
  fetchHermesSkillContent,
  hermesAction,
  saveHermesLearningNode,
  saveHermesProfileSoul,
  selectHermesProfile,
  testHermesMcp,
  toggleHermesMcp,
  toggleHermesSkill,
  type HermesValue,
} from '../../lib/hermes-api';
import { AgentProviderIcon } from '../AgentProviderIcon';
import { HERMES_AGENT_PROVIDER_ID } from '../../constants';
import { openExternalUrl } from '../../lib/markdown-link';

type HermesTab = 'overview' | 'profiles' | 'memory' | 'skills' | 'mcp' | 'gateway' | 'runtime';
type HermesStatusTone = 'positive' | 'negative' | 'warning' | 'neutral' | 'muted';

type HermesSettingsPanelProps = {
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
  runtimeContent: ReactNode;
  runtimeStatus: {
    label: string;
    tone: HermesStatusTone;
  };
  enabled: boolean;
  selectable: boolean;
};

const tabs: Array<{ id: HermesTab; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: '概览', icon: Activity },
  { id: 'profiles', label: '档案', icon: FileText },
  { id: 'memory', label: '记忆', icon: Brain },
  { id: 'skills', label: '技能', icon: Wrench },
  { id: 'mcp', label: 'MCP', icon: Network },
  { id: 'gateway', label: '网关', icon: Gauge },
  { id: 'runtime', label: '运行信息', icon: Settings2 },
];

export function HermesSettingsPanel({
  showToast,
  runtimeContent,
  runtimeStatus,
  enabled,
  selectable,
}: HermesSettingsPanelProps) {
  const [tab, setTab] = useState<HermesTab>('overview');
  const [bootstrap, setBootstrap] = useState<HermesValue | null>(null);
  const [resource, setResource] = useState<HermesValue | null>(null);
  const [learning, setLearning] = useState<HermesValue | null>(null);
  const [profile, setProfile] = useState('default');
  const [soul, setSoul] = useState('');
  const [selectedSkill, setSelectedSkill] = useState('');
  const [skillContent, setSkillContent] = useState('');
  const [selectedNode, setSelectedNode] = useState('');
  const [nodeContent, setNodeContent] = useState('');
  const [deleteNodePending, setDeleteNodePending] = useState(false);
  const [memoryResetPending, setMemoryResetPending] = useState(false);
  const [mcpName, setMcpName] = useState('');
  const [mcpTarget, setMcpTarget] = useState('');
  const [mcpArgs, setMcpArgs] = useState('');
  const [actionResult, setActionResult] = useState<HermesValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [error, setError] = useState('');
  const resourceRequestRef = useRef(0);

  async function loadBootstrap() {
    setBootstrapLoading(true);
    try {
      const next = await fetchHermesBootstrap();
      setBootstrap(next);
      setProfile(typeof next.selectedProfile === 'string' ? next.selectedProfile : 'default');
      setError('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Hermes 信息读取失败');
    } finally {
      setBootstrapLoading(false);
    }
  }

  async function loadResource(nextTab: HermesTab) {
    if (nextTab === 'overview' || nextTab === 'profiles' || nextTab === 'runtime') return;
    const resourceName = nextTab === 'mcp' ? 'mcp/servers' : nextTab === 'gateway' ? 'gateway/logs' : nextTab;
    const requestId = resourceRequestRef.current + 1;
    resourceRequestRef.current = requestId;
    setResourceLoading(true);
    setResource(null);
    if (nextTab === 'memory') setLearning(null);
    try {
      if (nextTab === 'memory') {
        const [memoryValue, learningValue] = await Promise.all([
          fetchHermesResource('memory'),
          fetchHermesResource('learning'),
        ]);
        if (resourceRequestRef.current !== requestId) return;
        setResource(memoryValue);
        setLearning(learningValue);
      } else {
        const nextResource = await fetchHermesResource(resourceName as 'skills' | 'mcp/servers' | 'gateway/logs');
        if (resourceRequestRef.current !== requestId) return;
        setResource(nextResource);
      }
      setError('');
    } catch (requestError) {
      if (resourceRequestRef.current !== requestId) return;
      setError(requestError instanceof Error ? requestError.message : 'Hermes 数据读取失败');
    } finally {
      if (resourceRequestRef.current === requestId) setResourceLoading(false);
    }
  }

  useEffect(() => {
    void loadBootstrap();
  }, []);

  useEffect(() => {
    if (tab === 'profiles') {
      void loadSoul(profile);
      return;
    }
    void loadResource(tab);
  }, [tab, profile]);

  async function runAction(action: Parameters<typeof hermesAction>[0], success: string) {
    setBusy(true);
    let result: HermesValue;
    try {
      result = await hermesAction(action);
      setActionResult(result);
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : 'Hermes 操作失败', 'error');
      setBusy(false);
      return;
    }

    setBusy(false);
    if (action === 'runtime/dashboard') {
      const dashboardUrl = typeof result.url === 'string' ? result.url : '';
      if (!dashboardUrl || !(await openExternalUrl(dashboardUrl))) {
        showToast(dashboardUrl ? `Web UI 已启动，请手动打开 ${dashboardUrl}` : 'Web UI 已启动，但未返回访问地址', 'info');
      } else {
        showToast(success, 'success');
      }
    } else {
      showToast(success, 'success');
    }

    // The action already succeeded; a refresh failure must not turn it into an error toast.
    await loadBootstrap();
    if (tab !== 'overview' && tab !== 'profiles' && tab !== 'runtime') await loadResource(tab);
  }

  async function selectProfile(nextProfile: string) {
    setBusy(true);
    try {
      await selectHermesProfile(nextProfile);
      setProfile(nextProfile);
      showToast(`已切换 Hermes 档案：${nextProfile}`, 'success');
      await loadBootstrap();
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : '档案切换失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function loadSoul(nextProfile = profile) {
    try {
      const value = await fetchHermesProfileSoul(nextProfile);
      setSoul(typeof value.content === 'string' ? value.content : typeof value.soul === 'string' ? value.soul : '');
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : 'SOUL 读取失败', 'error');
    }
  }

  async function saveSoul() {
    setBusy(true);
    try {
      await saveHermesProfileSoul(profile, { content: soul });
      showToast('SOUL 已保存', 'success');
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : 'SOUL 保存失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function inspectSkill(name: string) {
    try {
      const value = await fetchHermesSkillContent(name);
      setSelectedSkill(name);
      setSkillContent(typeof value.content === 'string' ? value.content : '');
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : 'Skill 内容读取失败', 'error');
    }
  }

  async function inspectNode(id: string) {
    try {
      const value = await fetchHermesLearningNode(id);
      setSelectedNode(id);
      setNodeContent(typeof value.content === 'string' ? value.content : '');
      setDeleteNodePending(false);
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : '学习节点读取失败', 'error');
    }
  }

  async function saveNode() {
    if (!selectedNode.trim()) return;
    setBusy(true);
    try {
      await saveHermesLearningNode({ id: selectedNode, content: nodeContent });
      showToast('学习节点已保存', 'success');
      await loadResource('memory');
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : '学习节点保存失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeNode() {
    if (!selectedNode.trim()) return;
    setBusy(true);
    try {
      await deleteHermesLearningNode({ id: selectedNode });
      setSelectedNode('');
      setNodeContent('');
      setDeleteNodePending(false);
      showToast('学习节点已删除', 'success');
      await loadResource('memory');
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : '学习节点删除失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveMcp() {
    if (!mcpName.trim() || !mcpTarget.trim()) return;
    setBusy(true);
    try {
      const isUrl = /^https?:\/\//i.test(mcpTarget.trim());
      await createHermesMcp({
        name: mcpName.trim(),
        ...(isUrl ? { url: mcpTarget.trim() } : { command: mcpTarget.trim(), args: mcpArgs.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) }),
      });
      setMcpName('');
      setMcpTarget('');
      setMcpArgs('');
      showToast('MCP Server 已保存', 'success');
      await loadResource('mcp');
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : 'MCP Server 保存失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeMcp(name: string) {
    setBusy(true);
    try {
      await deleteHermesMcp(name);
      showToast('MCP Server 已删除', 'success');
      await loadResource('mcp');
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : 'MCP Server 删除失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function setSkillEnabled(item: HermesValue) {
    setBusy(true);
    try {
      await toggleHermesSkill({ name: item.name, enabled: item.enabled !== true });
      showToast(`Skill ${item.enabled === true ? '已停用' : '已启用'}`, 'success');
      await loadResource('skills');
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : 'Skill 状态更新失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function setMcpEnabled(item: HermesValue) {
    const name = String(item.name ?? '');
    if (!name) return;
    setBusy(true);
    try {
      await toggleHermesMcp(name, item.enabled !== true);
      showToast(`MCP Server ${item.enabled === true ? '已停用' : '已启用'}`, 'success');
      await loadResource('mcp');
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : 'MCP Server 状态更新失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function testMcp(item: HermesValue) {
    const name = String(item.name ?? '');
    if (!name) return;
    setBusy(true);
    try {
      const result = await testHermesMcp(name);
      setActionResult(result);
      showToast(`${name} 测试完成`, 'success');
      await loadResource('mcp');
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : 'MCP 测试失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  const profileItems = useMemo(() => {
    const value = bootstrap?.profiles;
    if (Array.isArray(value)) return value as Array<HermesValue | string>;
    if (value && typeof value === 'object' && Array.isArray((value as HermesValue).profiles)) {
      return (value as HermesValue).profiles as Array<HermesValue | string>;
    }
    return [];
  }, [bootstrap]);

  const listItems = useMemo(() => {
    const value = resource?.skills ?? resource?.servers ?? resource?.nodes ?? resource?.items ?? resource;
    return Array.isArray(value) ? value as HermesValue[] : [];
  }, [resource]);
  const learningItems = useMemo(() => {
    const value = learning?.nodes ?? learning?.items ?? learning;
    return Array.isArray(value) ? value as HermesValue[] : [];
  }, [learning]);
  const memoryProviderItems = useMemo(() => {
    return Array.isArray(resource?.providers) ? resource.providers as HermesValue[] : [];
  }, [resource]);
  const hermesLogLines = useMemo(() => {
    if (Array.isArray(resource?.lines)) {
      return resource.lines.filter((line): line is string => typeof line === 'string');
    }
    const hermesLogs = resource?.hermes;
    if (!hermesLogs || typeof hermesLogs !== 'object') return [];
    const lines = (hermesLogs as HermesValue).lines;
    return Array.isArray(lines) ? lines.filter((line): line is string => typeof line === 'string') : [];
  }, [resource]);

  const backend = bootstrap?.backend as HermesValue | undefined;
  const status = bootstrap?.status as HermesValue | undefined;
  const backendRunning = typeof backend?.running === 'boolean' ? backend.running : null;
  const gatewayRunning = typeof status?.gateway_running === 'boolean' ? status.gateway_running : null;
  const commandAvailable = typeof bootstrap?.commandAvailable === 'boolean' ? bootstrap.commandAvailable : null;
  const gatewayPlatforms = status?.gateway_platforms && typeof status.gateway_platforms === 'object'
    ? Object.keys(status.gateway_platforms as HermesValue).length
    : 0;
  function changeTab(nextTab: HermesTab) {
    setActionResult(null);
    setError('');
    setTab(nextTab);
  }

  return (
    <section className="agent-provider-section hermes-settings-panel">
      <header className="hermes-settings-header">
        <div className="hermes-settings-title">
          <span className="hermes-settings-title-icon" aria-hidden="true"><AgentProviderIcon providerId={HERMES_AGENT_PROVIDER_ID} size={18} /></span>
          <div>
            <h3>Hermes 设置</h3>
            <p>档案、记忆与 Agent 扩展</p>
          </div>
        </div>
        <div className="hermes-settings-header-actions">
          <div className="hermes-status-list" aria-label="Hermes 状态">
            <HermesStatusPill tone={enabled ? 'positive' : 'neutral'} label={enabled ? '已启用' : '未启用'} />
            <HermesStatusPill tone={selectable ? 'positive' : 'neutral'} label={selectable ? '聊天可用' : '不可选择'} />
            <HermesStatusPill tone={runtimeStatus.tone} label={runtimeStatus.label} />
          </div>
          <button
            type="button"
            className="settings-icon-button hermes-refresh-button"
            title="刷新 Hermes"
            aria-label="刷新 Hermes"
            onClick={() => void loadBootstrap()}
            disabled={busy || bootstrapLoading}
          >
            <RefreshCw size={14} className={bootstrapLoading ? 'spin' : ''} />
          </button>
        </div>
      </header>
      <div className="hermes-settings-tabs" role="tablist" aria-label="Hermes 设置">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            id={`hermes-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`hermes-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? 'active' : ''}
            onClick={() => changeTab(id)}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div
        id={`hermes-panel-${tab}`}
        className="hermes-tab-panel"
        role="tabpanel"
        aria-labelledby={`hermes-tab-${tab}`}
        aria-busy={busy || resourceLoading}
      >
        {error ? (
          <div className="agent-provider-live-status error" role="alert">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        ) : null}

        {tab === 'overview' ? (
          <div className="hermes-settings-stack">
            <dl className="hermes-settings-grid hermes-overview-grid">
              <HermesFact icon={FileText} label="当前档案" value={bootstrapLoading ? '读取中' : profile} />
              <HermesFact
                icon={Terminal}
                label="Hermes CLI"
                value={bootstrapLoading ? '检测中' : commandAvailable === true ? '已检测' : commandAvailable === false ? '未检测到' : '状态未知'}
                tone={commandAvailable === true ? 'positive' : commandAvailable === false ? 'negative' : 'neutral'}
              />
              <HermesFact
                icon={Server}
                label="Agent 后端"
                value={bootstrapLoading ? '检测中' : backendRunning === true ? '运行中' : backendRunning === false ? '已停止' : '状态未知'}
                tone={backendRunning === true ? 'positive' : 'neutral'}
              />
              <HermesFact
                icon={Gauge}
                label="消息网关"
                value={bootstrapLoading ? '检测中' : gatewayRunning === true ? '运行中' : gatewayRunning === false ? '已停止' : '状态未知'}
                tone={gatewayRunning === true ? 'positive' : 'neutral'}
              />
            </dl>

            <div className="hermes-control-list">
              <section className="hermes-control-row">
                <div className="hermes-control-copy">
                  <span className="hermes-control-icon" aria-hidden="true"><Power size={16} /></span>
                  <div>
                    <h4>Agent 后端</h4>
                    <p title={String(backend?.baseUrl ?? '')}>
                      {backend?.baseUrl ? <code>{String(backend.baseUrl)}</code> : String(backendRunning === true ? '地址未返回' : '当前未运行')}
                    </p>
                  </div>
                </div>
                <div className="settings-list-actions hermes-settings-actions">
                  <button type="button" className="settings-action-button" disabled={busy || backendRunning !== true} onClick={() => void runAction('runtime/dashboard', '已打开 Hermes Web UI')}><ExternalLink size={14} />打开 Web UI</button>
                  <button type="button" className="settings-action-button" disabled={busy || backendRunning === true} onClick={() => void runAction('runtime/start', 'Hermes 已启动')}><Play size={14} />启动</button>
                  <button type="button" className="settings-action-button" disabled={busy || backendRunning !== true} onClick={() => void runAction('runtime/stop', 'Hermes 已停止')}><Square size={14} />停止</button>
                  <button type="button" className="settings-action-button" disabled={busy} onClick={() => void runAction('runtime/restart', 'Hermes 已重启')}><RotateCw size={14} />重启</button>
                </div>
              </section>
              <section className="hermes-control-row">
                <div className="hermes-control-copy">
                  <span className="hermes-control-icon" aria-hidden="true"><ShieldCheck size={16} /></span>
                  <div><h4>维护检查</h4><p>{busy ? '操作进行中' : '诊断与安全审计'}</p></div>
                </div>
                <div className="settings-list-actions hermes-settings-actions">
                  <button type="button" className="settings-action-button" disabled={busy} onClick={() => void runAction('diagnostics/doctor', '诊断已完成')}>{busy ? <LoaderCircle size={14} className="spin" /> : <Terminal size={14} />}诊断</button>
                  <button type="button" className="settings-action-button" disabled={busy} onClick={() => void runAction('diagnostics/security-audit', '安全审计已完成')}><ShieldCheck size={14} />安全审计</button>
                </div>
              </section>
            </div>
            <HermesActionResult value={actionResult} />
          </div>
        ) : null}

        {tab === 'profiles' ? (
          <div className="hermes-profile-layout">
            <aside className="hermes-profile-pane" aria-label="Hermes 档案">
              <div className="hermes-subsection-head">
                <div><h4>档案</h4><span>{profileItems.length || 1} 个</span></div>
              </div>
              <div className="hermes-profile-list">
                {(profileItems.length ? profileItems : [profile]).map((item) => {
                  const name = typeof item === 'string' ? item : String(item.name ?? item.id ?? 'default');
                  return (
                    <button key={name} type="button" className={name === profile ? 'active' : ''} disabled={busy} onClick={() => void selectProfile(name)}>
                      <FileText size={14} />
                      <span>{name}</span>
                      {name === profile ? <Check size={14} /> : null}
                    </button>
                  );
                })}
              </div>
            </aside>
            <section className="hermes-editor-pane hermes-soul-editor">
              <div className="hermes-subsection-head settings-field-head">
                <div><h4>SOUL</h4><span>{profile}</span></div>
                <button type="button" className="settings-icon-button" title="重新读取 SOUL" aria-label="重新读取 SOUL" onClick={() => void loadSoul()} disabled={busy}><RefreshCw size={14} /></button>
              </div>
              <label className="sr-only" htmlFor="hermes-soul">{profile} 的 SOUL</label>
              <textarea id="hermes-soul" value={soul} onChange={(event) => setSoul(event.target.value)} placeholder="当前档案没有 SOUL 内容" rows={12} />
              <div className="settings-list-actions hermes-editor-actions">
                <button type="button" className="settings-action-button primary" disabled={busy} onClick={() => void saveSoul()}><Save size={14} />保存 SOUL</button>
              </div>
            </section>
          </div>
        ) : null}

        {tab === 'memory' ? resourceLoading ? <HermesLoading label="正在读取记忆" /> : (
          <div className="hermes-settings-stack">
            <dl className="hermes-settings-grid">
              <HermesFact icon={Database} label="当前 Provider" value={typeof resource?.active === 'string' && resource.active ? resource.active : '未选择'} />
              <HermesFact icon={Network} label="记忆提供方" value={String(memoryProviderItems.length)} />
              <HermesFact icon={Brain} label="学习节点" value={String(learningItems.length)} />
              <HermesFact icon={FileText} label="内置记忆文件" value={String((resource?.builtin_files as HermesValue | undefined)?.memory ?? 0)} />
            </dl>
            <section className="hermes-subsection">
              <div className="hermes-subsection-head"><div><h4>记忆提供方</h4><span>{memoryProviderItems.length} 个</span></div></div>
              <HermesResourceList items={memoryProviderItems} empty="暂无 Hermes 记忆提供方" busy={busy} />
            </section>
            <section className="hermes-subsection">
              <div className="hermes-subsection-head">
                <div><h4>学习节点</h4><span>{learningItems.length} 个</span></div>
                <div className="settings-list-actions">
                  {memoryResetPending ? (
                    <><button type="button" className="settings-action-button" onClick={() => setMemoryResetPending(false)}>取消</button><button type="button" className="settings-action-button danger" disabled={busy} onClick={() => { setMemoryResetPending(false); void runAction('memory/reset', '记忆已重置'); }}>确认重置</button></>
                  ) : (
                    <button type="button" className="settings-action-button" disabled={busy} onClick={() => setMemoryResetPending(true)}><RefreshCw size={14} />重置记忆</button>
                  )}
                </div>
              </div>
              <HermesResourceList items={learningItems} empty="暂无 Hermes 学习节点" busy={busy} onInspect={(item) => void inspectNode(String(item.id ?? item.name ?? ''))} />
            </section>
            {selectedNode ? (
              <section className="hermes-editor-pane hermes-soul-editor">
                <div className="hermes-subsection-head settings-field-head">
                  <div><h4>学习节点</h4><span>{selectedNode}</span></div>
                  <div className="settings-list-actions"><button type="button" className="settings-icon-button" title="关闭" aria-label="关闭学习节点" onClick={() => { setSelectedNode(''); setNodeContent(''); }}><X size={14} /></button><button type="button" className="settings-icon-button danger" title="删除节点" aria-label="删除节点" onClick={() => setDeleteNodePending(true)}><Trash2 size={14} /></button></div>
                </div>
                <label className="sr-only" htmlFor="hermes-learning-node">学习节点 {selectedNode}</label>
                <textarea id="hermes-learning-node" value={nodeContent} onChange={(event) => setNodeContent(event.target.value)} rows={10} />
                <div className="settings-list-actions hermes-editor-actions">{deleteNodePending ? <><button type="button" className="settings-action-button" onClick={() => setDeleteNodePending(false)}>取消</button><button type="button" className="settings-action-button danger" disabled={busy} onClick={() => void removeNode()}>确认删除</button></> : <button type="button" className="settings-action-button primary" disabled={busy} onClick={() => void saveNode()}><Save size={14} />保存节点</button>}</div>
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === 'skills' ? resourceLoading ? <HermesLoading label="正在读取 Skills" /> : (
          <div className="hermes-settings-stack">
            <section className="hermes-subsection">
              <div className="hermes-subsection-head"><div><h4>Skills</h4><span>{listItems.length} 个</span></div></div>
              <HermesResourceList items={listItems} empty="暂无 Hermes Skills" busy={busy} onInspect={(item) => void inspectSkill(String(item.name ?? ''))} onToggle={(item) => void setSkillEnabled(item)} />
            </section>
            {selectedSkill ? (
              <section className="hermes-editor-pane hermes-soul-editor">
                <div className="hermes-subsection-head settings-field-head"><div><h4>Skill 内容</h4><span>{selectedSkill}</span></div><button type="button" className="settings-icon-button" title="关闭" aria-label="关闭 Skill 内容" onClick={() => setSelectedSkill('')}><X size={14} /></button></div>
                <label className="sr-only" htmlFor="hermes-skill-content">Skill {selectedSkill}</label>
                <textarea id="hermes-skill-content" value={skillContent} readOnly rows={12} />
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === 'mcp' ? resourceLoading ? <HermesLoading label="正在读取 MCP Server" /> : (
          <div className="hermes-settings-stack">
            <section className="hermes-subsection">
              <div className="hermes-subsection-head"><div><h4>MCP Server</h4><span>{listItems.length} 个</span></div></div>
              <HermesResourceList items={listItems} empty="暂无 Hermes MCP Server" busy={busy} onToggle={(item) => void setMcpEnabled(item)} onTest={(item) => testMcp(item)} onDelete={(item) => void removeMcp(String(item.name))} />
            </section>
            <section className="hermes-mcp-editor">
              <div className="hermes-subsection-head"><div><h4>新增 MCP Server</h4><span>URL 或本地命令</span></div></div>
              <div className="hermes-mcp-form">
                <label><span>名称</span><input value={mcpName} onChange={(event) => setMcpName(event.target.value)} placeholder="例如 filesystem" /></label>
                <label><span>URL 或命令</span><input value={mcpTarget} onChange={(event) => setMcpTarget(event.target.value)} placeholder="https://... 或可执行命令" /></label>
                <label className="wide"><span>命令参数</span><textarea value={mcpArgs} onChange={(event) => setMcpArgs(event.target.value)} placeholder="每行一项" rows={3} /></label>
              </div>
              <div className="settings-list-actions hermes-editor-actions"><button type="button" className="settings-action-button primary" disabled={busy || !mcpName.trim() || !mcpTarget.trim()} onClick={() => void saveMcp()}><Save size={14} />保存 Server</button></div>
            </section>
            <HermesActionResult value={actionResult} />
          </div>
        ) : null}

        {tab === 'gateway' ? resourceLoading ? <HermesLoading label="正在读取网关" /> : (
          <div className="hermes-settings-stack">
            <dl className="hermes-settings-grid">
              <HermesFact icon={Gauge} label="消息网关" value={gatewayRunning === true ? '运行中' : gatewayRunning === false ? '已停止' : '状态未知'} tone={gatewayRunning === true ? 'positive' : 'neutral'} />
              <HermesFact icon={Network} label="已配置平台" value={String(gatewayPlatforms)} />
              <HermesFact icon={FileText} label="日志行" value={String(hermesLogLines.length)} />
              <HermesFact icon={Activity} label="Hermes 健康" value={typeof status?.overall === 'string' ? status.overall : '状态未知'} />
            </dl>
            <div className="hermes-control-list">
              <section className="hermes-control-row">
                <div className="hermes-control-copy"><span className="hermes-control-icon" aria-hidden="true"><Gauge size={16} /></span><div><h4>消息网关</h4><p>{gatewayPlatforms} 个平台已配置</p></div></div>
                <div className="settings-list-actions hermes-settings-actions"><button type="button" className="settings-action-button" disabled={busy || gatewayRunning === true} onClick={() => void runAction('gateway/start', '消息网关已启动')}><Play size={14} />启动</button><button type="button" className="settings-action-button" disabled={busy || gatewayRunning !== true} onClick={() => void runAction('gateway/stop', '消息网关已停止')}><Square size={14} />停止</button><button type="button" className="settings-action-button" disabled={busy} onClick={() => void runAction('gateway/restart', '消息网关已重启')}><RotateCw size={14} />重启</button></div>
              </section>
            </div>
            <section className="hermes-log-panel">
              <div className="hermes-subsection-head"><div><h4>网关日志</h4><span>{hermesLogLines.length} 行</span></div></div>
              <pre className="hermes-settings-log">{hermesLogLines.length > 0 ? hermesLogLines.join('') : '暂无消息网关日志'}</pre>
            </section>
            <HermesActionResult value={actionResult} />
          </div>
        ) : null}

        {tab === 'runtime' ? <div className="hermes-runtime-content">{runtimeContent}</div> : null}
      </div>
    </section>
  );
}

function HermesStatusPill({ tone, label }: { tone: HermesStatusTone; label: string }) {
  const Icon = tone === 'positive' ? CircleCheck : tone === 'negative' ? AlertCircle : CircleDashed;
  return <span className={`hermes-status-pill tone-${tone}`}><Icon size={12} /><span>{label}</span></span>;
}

function HermesFact({ icon: Icon, label, value, tone = 'neutral' }: { icon: typeof Activity; label: string; value: string; tone?: HermesStatusTone }) {
  return <div className={`hermes-settings-fact tone-${tone}`}><dt><Icon size={14} /><span>{label}</span></dt><dd title={value}>{value}</dd></div>;
}

function HermesLoading({ label }: { label: string }) {
  return <div className="hermes-loading" role="status"><LoaderCircle size={16} className="spin" /><span>{label}</span></div>;
}

function HermesActionResult({ value }: { value: HermesValue | null }) {
  if (!value) return null;
  return (
    <section className="hermes-result-panel">
      <div className="hermes-subsection-head"><div><h4>操作结果</h4><span>最新一次</span></div></div>
      <pre className="hermes-settings-result">{JSON.stringify(value, null, 2).slice(0, 20000)}</pre>
    </section>
  );
}

function HermesResourceList({
  items,
  empty,
  busy,
  onInspect,
  onToggle,
  onTest,
  onDelete,
}: {
  items: HermesValue[];
  empty: string;
  busy: boolean;
  onInspect?: (item: HermesValue) => void;
  onToggle?: (item: HermesValue) => void;
  onTest?: (item: HermesValue) => void | Promise<void>;
  onDelete?: (item: HermesValue) => void;
}) {
  if (items.length === 0) {
    return <div className="hermes-empty-state"><CircleDashed size={17} /><span>{empty}</span></div>;
  }
  return (
    <div className="hermes-resource-list">
      {items.map((item, index) => {
        const name = String(item.name ?? item.title ?? item.id ?? `item-${index}`);
        const description = String(item.description ?? item.path ?? '');
        const status = typeof item.status === 'string' ? item.status : '';
        const detail = status && description ? `${status} - ${description}` : status || description;
        return (
          <div className="settings-list-row" key={`${name}-${index}`}>
            <div><strong>{name}</strong>{detail ? <small>{detail}</small> : null}</div>
            <div className="settings-list-actions">
              {onInspect ? <button type="button" className="settings-icon-button" disabled={busy} title={`查看 ${name}`} aria-label={`查看 ${name}`} onClick={() => onInspect(item)}><Eye size={13} /></button> : null}
              {onTest ? <button type="button" className="settings-action-button" disabled={busy} onClick={() => void onTest(item)}><Activity size={13} />测试</button> : null}
              {onToggle ? <button type="button" className="settings-action-button" disabled={busy} onClick={() => onToggle(item)}>{item.enabled === true ? '停用' : '启用'}</button> : null}
              {onDelete ? <button type="button" className="settings-icon-button danger" disabled={busy} title={`删除 ${name}`} aria-label={`删除 ${name}`} onClick={() => onDelete(item)}><Trash2 size={13} /></button> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
