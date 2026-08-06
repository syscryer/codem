import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  Clock3,
  FileDiff,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  Globe2,
  Layers3,
  MoreHorizontal,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CLAUDE_CODE_PROVIDER_ID, GROK_BUILD_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID, OPENCODE_PROVIDER_ID, PI_AGENT_PROVIDER_ID } from '../constants';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import type { AgentMuxRun } from '../lib/agent-mux-api';
import type { ConversationOutputFile } from '../lib/conversation-output-files';
import type { GitBranchSummary, ProjectSummary } from '../types';
import { AgentMuxAvatar } from './AgentMuxAvatar';
import { PopoverPortal } from './PopoverPortal';

type ContextDisplayMode = 'auto' | 'expanded' | 'collapsed';

const DISPLAY_MODE_KEY = 'codem.conversation-context-display-mode';
const DISPLAY_MODES: Array<{ value: ContextDisplayMode; label: string }> = [
  { value: 'auto', label: '自动展开' },
  { value: 'expanded', label: '始终展开' },
  { value: 'collapsed', label: '始终收起' },
];

export type ConversationContextPlan = {
  todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' | 'unknown' }>;
  counts: Record<'pending' | 'in_progress' | 'completed' | 'unknown', number>;
};

type ConversationContextIslandProps = {
  narrowOpen: boolean;
  onNarrowOpenChange: (open: boolean) => void;
  project: ProjectSummary | null;
  plan: ConversationContextPlan | null;
  agentRuns: AgentMuxRun[];
  outputFiles: ConversationOutputFile[];
  localUrls: string[];
  onLoadBranches: (projectId: string) => Promise<GitBranchSummary[]>;
  onSwitchBranch: (projectId: string, branchName: string) => Promise<void>;
  onOpenChanges: () => void;
  onOpenGitCommit: () => void;
  onCreateBranch: () => void;
  onOpenGitHistory: () => void;
  onOpenOutput: (file: ConversationOutputFile) => void;
  onOpenUrl: (url: string) => void;
  onOpenAgentRun: (run: AgentMuxRun) => void;
};

export function ConversationContextIsland({
  narrowOpen,
  onNarrowOpenChange,
  project,
  plan,
  agentRuns,
  outputFiles,
  localUrls,
  onLoadBranches,
  onSwitchBranch,
  onOpenChanges,
  onOpenGitCommit,
  onCreateBranch,
  onOpenGitHistory,
  onOpenOutput,
  onOpenUrl,
  onOpenAgentRun,
}: ConversationContextIslandProps) {
  const [displayMode, setDisplayMode] = useState<ContextDisplayMode>(() => {
    const saved = localStorage.getItem(DISPLAY_MODE_KEY);
    return DISPLAY_MODES.some((mode) => mode.value === saved) ? saved as ContextDisplayMode : 'auto';
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranchSummary[]>([]);
  const [branchQuery, setBranchQuery] = useState('');
  const [branchLoading, setBranchLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const branchRef = useRef<HTMLDivElement | null>(null);
  const runningCount = agentRuns.filter((run) => run.status === 'running' || run.status === 'queued').length;
  const visibleRuns = agentRuns.slice(0, 3);
  const filteredBranches = useMemo(() => {
    const query = branchQuery.trim().toLowerCase();
    return branches.filter((branch) => !query || branch.name.toLowerCase().includes(query));
  }, [branchQuery, branches]);

  useOutsideDismiss({
    selectors: [
      { selector: '.conversation-context-mode-menu', onDismiss: () => setMenuOpen(false), anchorRefs: [menuRef] },
      { selector: '.conversation-context-branch-menu', onDismiss: () => setBranchOpen(false), anchorRefs: [branchRef] },
    ],
  });

  useEffect(() => {
    setBranches([]);
    setBranchQuery('');
    setBranchOpen(false);
  }, [project?.id]);

  function selectDisplayMode(mode: ContextDisplayMode) {
    setDisplayMode(mode);
    localStorage.setItem(DISPLAY_MODE_KEY, mode);
    setMenuOpen(false);
    if (mode === 'collapsed') onNarrowOpenChange(false);
  }

  async function toggleBranches() {
    const nextOpen = !branchOpen;
    setBranchOpen(nextOpen);
    if (!nextOpen || !project || branches.length) return;
    setBranchLoading(true);
    try {
      setBranches(await onLoadBranches(project.id));
    } catch {
      setBranches([]);
    } finally {
      setBranchLoading(false);
    }
  }

  if (!project && !plan && !agentRuns.length && !outputFiles.length && !localUrls.length) return null;

  const agentSummary = runningCount
    ? `${runningCount} 个 Agent Mux 正在运行`
    : agentRuns.length
      ? `${agentRuns.length} 个 Agent Mux 调用`
      : project?.name ?? '当前会话';

  return (
    <aside className={`conversation-context-island${narrowOpen ? ' is-narrow-open' : ''}`} data-display-mode={displayMode} aria-label="会话上下文">
      <button type="button" className="conversation-context-capsule" aria-expanded="false" onClick={() => selectDisplayMode('expanded')}>
        {runningCount ? <span className="conversation-context-live-dot" /> : null}
        <span>{agentRuns.length ? `${agentRuns.length} 个 Agent` : '会话上下文'}</span>
        {project?.gitBranch ? <><span className="conversation-context-capsule-divider" /><GitBranch size={13} /><span>{project.gitBranch}</span></> : null}
        <ChevronDown size={13} />
      </button>

      <div className="conversation-context-panel">
        <div className="conversation-context-head">
          <span className="conversation-context-heading-icon"><Layers3 size={15} /></span>
          <span className="conversation-context-heading-copy"><strong>会话上下文</strong><small>{runningCount ? <span className="conversation-context-live-dot" /> : null}{agentSummary}</small></span>
          <div className="conversation-context-mode" ref={menuRef}>
            <button type="button" className="conversation-context-icon-button" title="显示方式" aria-label="设置上下文岛显示方式" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={15} /></button>
            <PopoverPortal open={menuOpen} anchorRef={menuRef} placement="bottom-end" offset={6}>
              <div className="conversation-context-mode-menu" role="menu" aria-label="上下文岛显示方式">
                {DISPLAY_MODES.map((mode) => <button key={mode.value} type="button" role="menuitemradio" aria-checked={displayMode === mode.value} onClick={() => selectDisplayMode(mode.value)}><span>{mode.label}</span>{displayMode === mode.value ? <Check size={14} /> : null}</button>)}
              </div>
            </PopoverPortal>
          </div>
          <button type="button" className="conversation-context-icon-button conversation-context-narrow-close" title="收起" aria-label="收起会话上下文" onClick={() => onNarrowOpenChange(false)}><X size={14} /></button>
        </div>

        {project?.isGitRepo ? (
          <div className="conversation-context-section">
            <div className="conversation-context-group-label">Git 工具</div>
            <div className="conversation-context-git-tools">
              <button type="button" className="conversation-context-tool-row" onClick={onOpenChanges}>
                <FileDiff size={14} /><span><strong>更改</strong><small>{project.gitDiff.filesChanged} 个文件有修改</small></span><span className="conversation-context-diff"><b>+{project.gitDiff.additions}</b><i>-{project.gitDiff.deletions}</i></span>
              </button>
              <div ref={branchRef}>
                <button type="button" className="conversation-context-tool-row" aria-haspopup="dialog" aria-expanded={branchOpen} onClick={() => void toggleBranches()}><GitBranch size={14} /><span><strong>{project.gitBranch ?? '未识别分支'}</strong><small>当前分支</small></span><ChevronDown size={13} /></button>
                <PopoverPortal open={branchOpen} anchorRef={branchRef} placement="bottom-end" offset={6}>
                  <div className="conversation-context-branch-menu" role="dialog" aria-label="选择 Git 分支">
                    <label className="conversation-context-branch-search"><Search size={14} /><input type="search" value={branchQuery} onChange={(event) => setBranchQuery(event.target.value)} placeholder="搜索分支" aria-label="搜索分支" /></label>
                    <div className="conversation-context-branch-list">
                      <span className="conversation-context-branch-heading">{branchLoading ? '正在读取...' : '分支'}</span>
                      {filteredBranches.map((branch) => <button type="button" className={branch.current ? 'is-active' : ''} key={branch.name} onClick={() => void onSwitchBranch(project.id, branch.name).then(() => setBranchOpen(false))}><GitBranch size={14} /><span><strong>{branch.name}</strong>{branch.current ? <small>当前分支</small> : null}</span>{branch.current ? <Check size={14} /> : null}</button>)}
                    </div>
                    <button type="button" className="conversation-context-branch-action" onClick={() => { setBranchOpen(false); onCreateBranch(); }}><Plus size={14} />创建并检出新分支...</button>
                    <button type="button" className="conversation-context-branch-action" onClick={() => { setBranchOpen(false); onOpenGitHistory(); }}><GitFork size={14} />Git 图谱</button>
                  </div>
                </PopoverPortal>
              </div>
              <button type="button" className="conversation-context-tool-row" onClick={onOpenGitCommit}><GitCommitHorizontal size={14} /><span><strong>提交或推送</strong><small>打开 Git 工作台</small></span></button>
            </div>
          </div>
        ) : null}

        {plan ? (
          <div className="conversation-context-section conversation-context-progress">
            <div className="conversation-context-group-label"><span>进程</span><span>{plan.counts.completed}/{plan.todos.length}</span></div>
            <div className="conversation-context-progress-list">
              {plan.todos.slice(0, 6).map((step, index) => <div className={step.status === 'completed' ? 'is-complete' : step.status === 'in_progress' ? 'is-current' : ''} key={`${step.content}-${index}`}>{step.status === 'completed' ? <CircleCheck size={13} /> : step.status === 'in_progress' ? <ArrowRight size={13} /> : <Clock3 size={13} />}<span>{step.content}</span></div>)}
            </div>
          </div>
        ) : null}

        {visibleRuns.length ? (
          <div className="conversation-context-section conversation-context-agents">
            <div className="conversation-context-group-label">Agent Mux</div>
            {visibleRuns.map((run) => <ContextAgentRow key={run.id} run={run} onOpen={() => onOpenAgentRun(run)} />)}
          </div>
        ) : null}

        {outputFiles.length || localUrls.length ? (
          <div className="conversation-context-links">
            {outputFiles.length ? <div className="conversation-context-link-group"><div className="conversation-context-group-label">输出</div>{outputFiles.slice(0, 3).map((file) => <button type="button" title={file.path} key={file.path} onClick={() => onOpenOutput(file)}><FileText size={14} /><span><strong>{file.name}</strong></span></button>)}</div> : null}
            {localUrls.length ? <div className="conversation-context-link-group"><div className="conversation-context-group-label">浏览器</div>{localUrls.slice(0, 3).map((url) => <button type="button" title={url} key={url} onClick={() => onOpenUrl(url)}><Globe2 size={14} /><span><strong>{formatUrl(url)}</strong></span></button>)}</div> : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export function AgentInvocationGroup({ runs, onOpenRun }: { runs: AgentMuxRun[]; onOpenRun: (run: AgentMuxRun) => void }) {
  const [expanded, setExpanded] = useState(true);
  if (!runs.length) return null;
  const runningCount = runs.filter((run) => run.status === 'running' || run.status === 'queued').length;
  const completedCount = runs.filter((run) => run.status === 'completed').length;

  return (
    <section className="agent-invocation-prototype" aria-label="Agent Mux 调用">
      <button type="button" className="agent-invocation-summary" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
        <span className="agent-invocation-avatar-stack" aria-hidden="true">{runs.slice(0, 3).map((run) => <AgentMuxAvatar key={run.id} avatar={run.avatar} providerId={agentProvider(run)} size="small" />)}</span>
        <span className="agent-invocation-summary-copy"><strong>调用 {runs.length} 个 Agent</strong><small>{runningCount ? `${runningCount} 个运行中` : `${completedCount} 个已完成`}</small></span>
        {runs[0]?.duration && runs[0].duration !== '--' ? <span className="agent-invocation-time"><Clock3 size={13} />{runs[0].duration}</span> : null}
        <ChevronDown className={expanded ? 'is-expanded' : ''} size={15} />
      </button>
      {expanded ? <div className="agent-invocation-list">{runs.map((run) => <InvocationRow key={run.id} run={run} onOpen={() => onOpenRun(run)} />)}</div> : null}
    </section>
  );
}

function ContextAgentRow({ run, onOpen }: { run: AgentMuxRun; onOpen: () => void }) {
  const running = run.status === 'running' || run.status === 'queued';
  const detail = `${run.target} · ${run.profile}`;
  return <button type="button" className="conversation-context-agent-row" onClick={onOpen} aria-label={`查看 ${run.nickname || detail} 详情`}><AgentMuxAvatar avatar={run.avatar} providerId={agentProvider(run)} size="large" /><span className="conversation-context-agent-copy"><strong title={detail}>{run.nickname || detail}</strong><small><span>{run.prompt || run.summary || 'Agent Mux 调用'}</span><em>Agent Mux</em></small></span>{running ? <span className="conversation-context-running"><span />运行中</span> : run.status === 'completed' ? <CircleCheck size={14} /> : <CircleX size={14} />}</button>;
}

function InvocationRow({ run, onOpen }: { run: AgentMuxRun; onOpen: () => void }) {
  const running = run.status === 'running' || run.status === 'queued';
  const title = `${run.target} · ${run.profile}`;
  const detail = run.prompt || run.summary || 'Agent Mux 调用';
  return <button type="button" className="agent-invocation-row is-mux" onClick={onOpen} aria-label={`查看 ${run.nickname || title} 详情`}><AgentMuxAvatar avatar={run.avatar} providerId={agentProvider(run)} size="large" /><span className="agent-invocation-copy"><span><strong title={title}>{run.nickname || title}</strong><em>Agent Mux</em></span><small title={detail}>{detail}</small></span>{running ? <span className="agent-invocation-status is-running"><span />运行中</span> : <span className="agent-invocation-status">{run.status === 'completed' ? <CircleCheck size={14} /> : <CircleX size={14} />}{run.status === 'completed' ? '已完成' : run.status === 'waiting' ? '等待处理' : run.status === 'cancelled' ? '已取消' : '失败'}</span>}</button>;
}

export function agentProvider(run: AgentMuxRun) {
  const value = `${run.target} ${run.profile}`.toLowerCase();
  if (value.includes('claude')) return CLAUDE_CODE_PROVIDER_ID;
  if (value.includes('grok')) return GROK_BUILD_PROVIDER_ID;
  if (value.includes('opencode')) return OPENCODE_PROVIDER_ID;
  if (value.includes('pi')) return PI_AGENT_PROVIDER_ID;
  return OPENAI_CODEX_PROVIDER_ID;
}

function formatUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return value;
  }
}
