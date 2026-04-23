import { FormEvent, KeyboardEvent, startTransition, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignJustify,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Blocks,
  Check,
  Clock3,
  Code2,
  Folder,
  FolderPlus,
  GitBranch,
  Home,
  LayoutPanelLeft,
  Mic,
  Minus,
  MoreHorizontal,
  PanelLeft,
  Play,
  Plus,
  Search,
  Settings,
  Square,
  SquarePen,
  SquareSplitHorizontal,
  TerminalSquare,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type ClaudeContentBlock = {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};

type ClaudeEvent =
  | { type: 'status'; runId: string; message: string }
  | { type: 'session'; runId: string; sessionId: string }
  | { type: 'delta'; runId: string; text: string }
  | { type: 'phase'; runId: string; phase: TurnPhase; label: string }
  | ({ type: 'usage'; runId: string } & UsageSnapshot)
  | { type: 'claude-event'; runId: string; label: string; eventType?: string; subtype?: string; status?: string; raw: unknown }
  | { type: 'tool-start'; runId: string; blockIndex: number; toolUseId?: string; name: string; input?: unknown }
  | { type: 'tool-input-delta'; runId: string; blockIndex: number; text: string }
  | { type: 'tool-stop'; runId: string; blockIndex: number }
  | { type: 'tool-result'; runId: string; toolUseId?: string; content: string; isError?: boolean }
  | { type: 'assistant-snapshot'; runId: string; blocks: ClaudeContentBlock[] }
  | { type: 'raw'; runId: string; raw: unknown }
  | { type: 'stderr'; runId: string; text: string }
  | ({ type: 'done'; runId: string; sessionId?: string; result: string; totalCostUsd?: number; durationMs?: number } & UsageSnapshot)
  | { type: 'error'; runId: string; message: string };

type TurnPhase = 'requesting' | 'thinking' | 'computing' | 'tool';

type UsageSnapshot = {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

type ToolStep = {
  id: string;
  name: string;
  title: string;
  status: 'running' | 'done' | 'error';
  blockIndex?: number;
  toolUseId?: string;
  inputText?: string;
  resultText?: string;
  isError?: boolean;
};

type AssistantItem =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'tool'; tool: ToolStep };

type ConversationTurn = {
  id: string;
  backendRunId?: string;
  userText: string;
  workspace: string;
  assistantText: string;
  tools: ToolStep[];
  items: AssistantItem[];
  status: 'pending' | 'running' | 'done' | 'error' | 'stopped';
  activity?: string;
  metrics?: string;
  sessionId?: string;
  phase?: TurnPhase;
  startedAtMs?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  totalCostUsd?: number;
};

type DebugEvent = {
  id: string;
  title: string;
  content: string;
  tone?: 'neutral' | 'error';
};

type ThreadSummary = {
  id: string;
  projectId: string;
  title: string;
  sessionId: string;
  workingDirectory: string;
  updatedAt: string;
  updatedLabel: string;
  provider: string;
  model?: string;
  permissionMode?: string;
};

type ProjectSummary = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  gitBranch?: string;
  isGitRepo: boolean;
  threads: ThreadSummary[];
};

type PanelState = {
  organizeBy: 'project' | 'timeline' | 'chat-first';
  sortBy: 'created' | 'updated';
  visibility: 'all' | 'relevant';
};

type WorkspaceBootstrap = {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  activeThreadId: string | null;
  panelState: PanelState;
};

type ThreadHistoryPayload = {
  threadId: string;
  turns: ConversationTurn[];
};

type ThreadDetail = ThreadSummary & {
  turns: ConversationTurn[];
  debugEvents: DebugEvent[];
  rawEvents: string[];
  historyLoaded: boolean;
  historyLoading: boolean;
};

type ClaudeModelInfo = {
  available: boolean;
  models: string[];
  error?: string;
};

type InputDialogState =
  | {
      kind: 'rename-project';
      title: string;
      description: string;
      confirmLabel: string;
      value: string;
      projectId: string;
    }
  | {
      kind: 'rename-thread';
      title: string;
      description: string;
      confirmLabel: string;
      value: string;
      threadId: string;
    };

type ConfirmDialogState =
  | {
      kind: 'remove-project';
      title: string;
      description: string;
      confirmLabel: string;
      projectId: string;
    }
  | null;

type ToastState = {
  id: string;
  message: string;
  tone: 'success' | 'error' | 'info';
};

const DEFAULT_MODEL_VALUE = '__default';
const DEFAULT_WORKSPACE = 'D:\\cursor_project\\codem';

const permissionModes = [
  'default',
  'plan',
  'acceptEdits',
  'auto',
  'dontAsk',
  'bypassPermissions',
] as const;

const permissionMenuModes = permissionModes;

const EMPTY_PANEL_STATE: PanelState = {
  organizeBy: 'project',
  sortBy: 'updated',
  visibility: 'all',
};

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [workspace, setWorkspace] = useState(DEFAULT_WORKSPACE);
  const [permissionMode, setPermissionMode] =
    useState<(typeof permissionModes)[number]>('default');
  const [model, setModel] = useState(DEFAULT_MODEL_VALUE);
  const [models, setModels] = useState<string[]>([]);
  const [, setHealth] = useState<{ available: boolean; command?: string; error?: string }>({
    available: false,
  });
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [panelState, setPanelState] = useState<PanelState>(EMPTY_PANEL_STATE);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threadDetails, setThreadDetails] = useState<Record<string, ThreadDetail>>({});
  const [backendRunId, setBackendRunId] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [clockNowMs, setClockNowMs] = useState(Date.now());
  const [debugOpen, setDebugOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [panelMenuOpen, setPanelMenuOpen] = useState(false);
  const [projectMenuProjectId, setProjectMenuProjectId] = useState<string | null>(null);
  const [threadMenuThreadId, setThreadMenuThreadId] = useState<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [inputDialog, setInputDialog] = useState<InputDialogState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeTurnIdRef = useRef('');
  const runThreadIdRef = useRef<string | null>(null);
  const threadDetailsRef = useRef<Record<string, ThreadDetail>>({});
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const conversationBottomRef = useRef<HTMLDivElement | null>(null);
  const permissionMenuRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const panelMenuRef = useRef<HTMLDivElement | null>(null);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const activeThreadSummary = useMemo(
    () => projects.flatMap((project) => project.threads).find((thread) => thread.id === activeThreadId) ?? null,
    [projects, activeThreadId],
  );
  const activeThread = activeThreadSummary ? threadDetails[activeThreadSummary.id] ?? createThreadDetail(activeThreadSummary) : null;

  useEffect(() => {
    void loadHealth();
    void loadClaudeModels();
    void loadWorkspace();
  }, []);

  useEffect(() => {
    const nextWorkspace = activeThreadSummary?.workingDirectory || activeProject?.path || DEFAULT_WORKSPACE;
    setWorkspace(nextWorkspace);
  }, [activeProject?.path, activeThreadSummary?.workingDirectory]);

  useEffect(() => {
    setPermissionMode(isPermissionMode(activeThreadSummary?.permissionMode) ? activeThreadSummary.permissionMode : 'default');
  }, [activeThreadSummary?.id, activeThreadSummary?.permissionMode]);

  useEffect(() => {
    if (activeThreadId) {
      void loadThreadHistory(activeThreadId);
    }
  }, [activeThreadId]);

  useEffect(() => {
    if (!isRunning) {
      return undefined;
    }

    setClockNowMs(Date.now());
    const timer = window.setInterval(() => {
      setClockNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isRunning]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      conversationBottomRef.current?.scrollIntoView({ block: 'end' });
    });

    return () => cancelAnimationFrame(frame);
  }, [activeThread?.turns]);

  useEffect(() => {
    threadDetailsRef.current = threadDetails;
  }, [threadDetails]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 2200);

    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (!permissionMenuRef.current?.contains(target)) {
        setPermissionMenuOpen(false);
      }
      if (!modelMenuRef.current?.contains(target)) {
        setModelMenuOpen(false);
      }
      if (!panelMenuRef.current?.contains(target)) {
        setPanelMenuOpen(false);
      }

      const projectMenuElement = document.querySelector('.project-menu-popover');
      if (projectMenuElement && !projectMenuElement.contains(target)) {
        setProjectMenuProjectId(null);
      }

      const threadMenuElement = document.querySelector('.thread-menu-popover');
      if (threadMenuElement && !threadMenuElement.contains(target)) {
        setThreadMenuThreadId(null);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  async function loadHealth() {
    try {
      const response = await fetch('/api/health');
      const payload = (await response.json()) as { available: boolean; command?: string; error?: string };
      setHealth(payload);
    } catch (error) {
      setHealth({
        available: false,
        error: error instanceof Error ? error.message : '无法连接本地桥接服务',
      });
    }
  }

  async function loadClaudeModels() {
    try {
      const response = await fetch('/api/claude/models');
      const payload = (await response.json()) as ClaudeModelInfo;
      const nextModels = Array.isArray(payload.models) ? payload.models.filter(Boolean) : [];
      setModels(nextModels);
      setModel((current) => current || nextModels[0] || DEFAULT_MODEL_VALUE);
    } catch (error) {
      appendDebug({
        title: '模型列表读取失败',
        content: error instanceof Error ? error.message : '无法读取 Claude Code 模型列表',
        tone: 'error',
      });
    }
  }

  async function loadWorkspace() {
    const response = await fetch('/api/workspace/bootstrap');
    const payload = (await response.json()) as WorkspaceBootstrap;
    syncWorkspace(payload);
  }

  function syncWorkspace(payload: WorkspaceBootstrap) {
    setProjects(payload.projects);
    setPanelState(payload.panelState);
    setActiveProjectId(payload.activeProjectId);
    setActiveThreadId(payload.activeThreadId);
    setCollapsedProjects((current) => {
      const next = { ...current };
      for (const project of payload.projects) {
        if (!(project.id in next)) {
          next[project.id] = false;
        }
      }
      return next;
    });
    setThreadDetails((current) => {
      const next: Record<string, ThreadDetail> = {};
      for (const project of payload.projects) {
        for (const thread of project.threads) {
          const existing = current[thread.id];
          next[thread.id] = {
            ...(existing ?? createThreadDetail(thread)),
            ...thread,
            turns: existing?.turns ?? [],
            debugEvents: existing?.debugEvents ?? [],
            rawEvents: existing?.rawEvents ?? [],
            historyLoaded: existing?.historyLoaded ?? false,
            historyLoading: existing?.historyLoading ?? false,
          };
        }
      }
      return next;
    });
  }

  function showToast(message: string, tone: ToastState['tone'] = 'success') {
    setToast({
      id: crypto.randomUUID(),
      message,
      tone,
    });
  }

  function openRenameProjectDialog(project: ProjectSummary) {
    setProjectMenuProjectId(null);
    setInputDialog({
      kind: 'rename-project',
      title: '修改项目名称',
      description: '只修改 CodeM 中的显示名，不会修改磁盘目录。',
      confirmLabel: '保存',
      value: project.name,
      projectId: project.id,
    });
  }

  function openRenameThreadDialog(thread: ThreadSummary) {
    setThreadMenuThreadId(null);
    setInputDialog({
      kind: 'rename-thread',
      title: '重命名聊天',
      description: '只修改 CodeM 中的聊天标题，不会反写 Claude Code 会话名。',
      confirmLabel: '保存',
      value: thread.title,
      threadId: thread.id,
    });
  }

  function openRemoveProjectDialog(project: ProjectSummary) {
    setProjectMenuProjectId(null);
    setConfirmDialog({
      kind: 'remove-project',
      title: '移除项目',
      description: `移除项目“${project.name}”后，只会删除 CodeM 的索引与聊天记录，不会删除磁盘目录。`,
      confirmLabel: '移除项目',
      projectId: project.id,
    });
  }

  async function loadThreadHistory(threadId: string) {
    setThreadDetails((current) => {
      const existing = current[threadId];
      if (!existing || existing.historyLoaded || existing.historyLoading) {
        return current;
      }

      return {
        ...current,
        [threadId]: {
          ...existing,
          historyLoading: true,
        },
      };
    });

    const currentDetail = threadDetails[threadId];
    if (currentDetail?.historyLoaded || currentDetail?.historyLoading) {
      return;
    }

    try {
      const response = await fetch(`/api/threads/${threadId}/history`);
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as ThreadHistoryPayload;
      setThreadDetails((current) => {
        const existing = current[payload.threadId];
        if (!existing) {
          return current;
        }

        return {
          ...current,
          [payload.threadId]: {
            ...existing,
            turns: payload.turns,
            historyLoaded: true,
            historyLoading: false,
          },
        };
      });
    } catch {
      setThreadDetails((current) => {
        const existing = current[threadId];
        if (!existing) {
          return current;
        }

        return {
          ...current,
          [threadId]: {
            ...existing,
            historyLoading: false,
          },
        };
      });
    }
  }

  async function persistThreadHistory(threadId: string, turns: ConversationTurn[]) {
    await fetch(`/api/threads/${threadId}/history`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ turns }),
    });
  }

  function schedulePersistThreadHistory(threadId: string | null) {
    if (!threadId) {
      return;
    }

    window.setTimeout(() => {
      const thread = threadDetailsRef.current[threadId];
      if (!thread) {
        return;
      }

      void persistThreadHistory(threadId, thread.turns);
    }, 0);
  }

  function updateActiveThread(updater: (thread: ThreadDetail) => ThreadDetail) {
    const targetThreadId = runThreadIdRef.current || activeThreadId;
    if (!targetThreadId) {
      return;
    }

    setThreadDetails((current) => {
      const existing = current[targetThreadId];
      if (!existing) {
        return current;
      }

      return {
        ...current,
        [targetThreadId]: updater(existing),
      };
    });
  }

  function updateActiveTurn(updater: (turn: ConversationTurn) => ConversationTurn) {
    const activeTurnId = activeTurnIdRef.current;
    if (!activeTurnId) {
      return;
    }

    updateActiveThread((thread) => ({
      ...thread,
      turns: thread.turns.map((turn) => (turn.id === activeTurnId ? updater(turn) : turn)),
    }));
  }

  function appendDebug(event: Omit<DebugEvent, 'id'>) {
    const targetThreadId = runThreadIdRef.current || activeThreadId;
    if (!targetThreadId) {
      return;
    }

    startTransition(() => {
      setThreadDetails((current) => {
        const existing = current[targetThreadId];
        if (!existing) {
          return current;
        }

        return {
          ...current,
          [targetThreadId]: {
            ...existing,
            debugEvents: [...existing.debugEvents, { ...event, id: crypto.randomUUID() }].slice(-220),
          },
        };
      });
    });
  }

  function appendRawEvent(line: string) {
    const targetThreadId = runThreadIdRef.current || activeThreadId;
    if (!targetThreadId) {
      return;
    }

    startTransition(() => {
      setThreadDetails((current) => {
        const existing = current[targetThreadId];
        if (!existing) {
          return current;
        }

        return {
          ...current,
          [targetThreadId]: {
            ...existing,
            rawEvents: [...existing.rawEvents, line].slice(-220),
          },
        };
      });
    });
  }

  async function ensureActiveThread() {
    if (activeThreadSummary) {
      return activeThreadSummary;
    }

    if (!activeProjectId) {
      await handlePickProjectDirectory();
      showToast('先添加一个项目目录，再开始新聊天。', 'info');
      return null;
    }

    const threadId = await createThread(activeProjectId);
    const project = projects.find((item) => item.id === activeProjectId);
    return project?.threads.find((thread) => thread.id === threadId) ?? null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || isRunning) {
      return;
    }

    const thread = await ensureActiveThread();
    if (!thread) {
      return;
    }

    const turnId = crypto.randomUUID();
    activeTurnIdRef.current = turnId;
    runThreadIdRef.current = thread.id;
    setBackendRunId('');
    setPrompt('');
    setIsRunning(true);
    setThreadDetails((current) => {
      const existing = current[thread.id] ?? createThreadDetail(thread);
      return {
        ...current,
        [thread.id]: {
          ...existing,
          turns: [
            ...existing.turns,
            {
              id: turnId,
              userText: trimmedPrompt,
              workspace: workspace.trim() || thread.workingDirectory,
              assistantText: '',
              tools: [],
              items: [],
              status: 'pending',
              activity: '等待 Claude 响应',
              phase: 'requesting',
              startedAtMs: Date.now(),
            },
          ],
        },
      };
    });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/claude/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          workingDirectory: workspace.trim() || thread.workingDirectory,
          permissionMode,
          model: model === DEFAULT_MODEL_VALUE ? undefined : model,
          sessionId: thread.sessionId.trim() ? thread.sessionId.trim() : undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const message = await response.text();
        const targetThreadId = runThreadIdRef.current || activeThreadId;
        updateActiveTurn((turn) => ({
          ...turn,
          status: 'error',
          durationMs: turn.durationMs ?? getElapsedDuration(turn),
          activity: message || '后端没有返回可读流。',
        }));
        schedulePersistThreadHistory(targetThreadId);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          handleStreamLine(line);
        }
      }

      if (buffer.trim()) {
        handleStreamLine(buffer);
      }
    } catch (error) {
      const targetThreadId = runThreadIdRef.current || activeThreadId;
      updateActiveTurn((turn) => ({
        ...turn,
        ...settleRunningToolSteps(turn, error instanceof DOMException && error.name === 'AbortError' ? 'done' : 'error'),
        status: error instanceof DOMException && error.name === 'AbortError' ? 'stopped' : 'error',
        durationMs: turn.durationMs ?? getElapsedDuration(turn),
        activity:
          error instanceof DOMException && error.name === 'AbortError'
            ? '已停止当前运行'
            : error instanceof Error
              ? error.message
              : '未知错误',
      }));
      schedulePersistThreadHistory(targetThreadId);
    } finally {
      abortRef.current = null;
      setIsRunning(false);
      setBackendRunId('');
      runThreadIdRef.current = null;
    }
  }

  function handleStreamLine(line: string) {
    if (!line.trim()) {
      return;
    }

    appendRawEvent(line);

    try {
      const eventPayload = JSON.parse(line) as ClaudeEvent;
      handleClaudeEvent(eventPayload);
    } catch (error) {
      appendDebug({
        title: '事件解析失败',
        content: error instanceof Error ? error.message : '无法解析后端事件',
        tone: 'error',
      });
    }
  }

  function handleClaudeEvent(event: ClaudeEvent) {
    if ('runId' in event && event.runId) {
      setBackendRunId(event.runId);
      updateActiveTurn((turn) => ({
        ...turn,
        backendRunId: event.runId,
        status: turn.status === 'pending' ? 'running' : turn.status,
      }));
    }

    if (event.type === 'raw') {
      appendDebug({
        title: 'Raw Event',
        content: formatJson(event.raw),
      });
      return;
    }

    if (event.type === 'status') {
      updateActiveTurn((turn) => ({
        ...turn,
        status: 'running',
        activity: 'Claude Code 已启动',
        phase: 'requesting',
      }));
      appendDebug({
        title: '启动运行',
        content: event.message,
      });
      return;
    }

    if (event.type === 'phase') {
      updateActiveTurn((turn) => ({
        ...turn,
        status: turn.status === 'pending' ? 'running' : turn.status,
        phase: event.phase,
        activity: event.label,
      }));
      return;
    }

    if (event.type === 'usage') {
      updateActiveTurn((turn) => ({
        ...turn,
        ...mergeUsageSnapshot(turn, event),
      }));
      return;
    }

    if (event.type === 'session') {
      updateActiveTurn((turn) => ({
        ...turn,
        sessionId: event.sessionId,
      }));
      void persistActiveThreadMetadata({ sessionId: event.sessionId });
      appendDebug({
        title: 'Session 已绑定',
        content: event.sessionId,
      });
      return;
    }

    if (event.type === 'claude-event') {
      if (event.status === 'requesting') {
        updateActiveTurn((turn) => ({
          ...turn,
          activity: '等待 Claude 响应',
        }));
      }

      appendDebug({
        title: event.label,
        content: formatJson(event.raw),
      });
      return;
    }

    if (event.type === 'delta') {
      updateActiveTurn((turn) => ({
        ...turn,
        status: 'running',
        assistantText: `${turn.assistantText}${event.text}`,
        items: appendTextItem(turn.items, event.text),
        activity: 'Computing...',
        phase: 'computing',
      }));
      return;
    }

    if (event.type === 'tool-start') {
      updateActiveTurn((turn) => {
        const step = createToolStep(event);
        const tools = upsertToolStep(turn.tools, step);
        return {
          ...turn,
          status: 'running',
          activity: step.title,
          phase: 'tool',
          tools,
          items: syncToolItem(turn.items, step),
        };
      });
      return;
    }

    if (event.type === 'tool-input-delta') {
      updateActiveTurn((turn) => {
        const tools = upsertToolDelta(turn.tools, event);
        const tool = tools.find((item) => matchesToolBlock(item, event.blockIndex));
        return {
          ...turn,
          phase: 'tool',
          tools,
          items: tool ? syncToolItem(turn.items, tool) : turn.items,
        };
      });
      return;
    }

    if (event.type === 'tool-stop') {
      updateActiveTurn((turn) => {
        const tools = turn.tools.map((tool) =>
          matchesToolBlock(tool, event.blockIndex) && tool.status === 'running'
            ? { ...tool, status: 'done' as const }
            : tool,
        );
        const tool = tools.find((item) => matchesToolBlock(item, event.blockIndex));
        return {
          ...turn,
          tools,
          items: tool ? syncToolItem(turn.items, tool) : turn.items,
        };
      });
      return;
    }

    if (event.type === 'tool-result') {
      updateActiveTurn((turn) => {
        const tools = attachToolResult(turn.tools, event);
        const tool = tools.find((item) => item.toolUseId && item.toolUseId === event.toolUseId);
        return {
          ...turn,
          activity: summarizeToolResult(event),
          phase: event.isError ? turn.phase : 'computing',
          tools,
          items: tool ? syncToolItem(turn.items, tool) : turn.items,
        };
      });
      return;
    }

    if (event.type === 'assistant-snapshot') {
      appendDebug({
        title: `Assistant Message Snapshot (${event.blocks.length} blocks)`,
        content: formatJson(event.blocks),
      });
      return;
    }

    if (event.type === 'stderr') {
      appendDebug({
        title: 'stderr',
        content: event.text,
        tone: 'error',
      });
      return;
    }

    if (event.type === 'error') {
      const targetThreadId = runThreadIdRef.current || activeThreadId;
      updateActiveTurn((turn) => ({
        ...turn,
        ...settleRunningToolSteps(turn, 'error'),
        status: 'error',
        durationMs: turn.durationMs ?? getElapsedDuration(turn),
        activity: event.message,
      }));
      appendDebug({
        title: 'Claude 运行异常',
        content: event.message,
        tone: 'error',
      });
      schedulePersistThreadHistory(targetThreadId);
      return;
    }

    if (event.type === 'done') {
      const targetThreadId = runThreadIdRef.current || activeThreadId;
      updateActiveTurn((turn) => ({
        ...turn,
        ...settleRunningToolSteps(turn, 'done'),
        status: 'done',
        assistantText: turn.assistantText.trim() ? turn.assistantText : event.result,
        items: turn.items.length > 0 ? turn.items : appendTextItem(turn.items, event.result),
        activity: '运行完成',
        phase: undefined,
        metrics: formatMetrics(event),
        sessionId: event.sessionId ?? turn.sessionId,
        durationMs: event.durationMs ?? turn.durationMs ?? getElapsedDuration(turn),
        totalCostUsd: event.totalCostUsd ?? turn.totalCostUsd,
        ...mergeUsageSnapshot(turn, event),
      }));
      void persistActiveThreadMetadata({
        sessionId: event.sessionId,
        model: model === DEFAULT_MODEL_VALUE ? undefined : model,
        permissionMode,
        workingDirectory: workspace.trim() || activeThreadSummary?.workingDirectory,
      });
      schedulePersistThreadHistory(targetThreadId);
    }
  }

  async function persistActiveThreadMetadata(payload: {
    sessionId?: string;
    workingDirectory?: string;
    model?: string;
    permissionMode?: string;
  }) {
    const targetThreadId = runThreadIdRef.current || activeThreadId;
    if (!targetThreadId) {
      return;
    }

    updateThreadSummaryLocal(targetThreadId, payload);

    const response = await fetch(`/api/threads/${targetThreadId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const result = (await response.json()) as { workspace: WorkspaceBootstrap };
      syncWorkspace(result.workspace);
    }
  }

  function handlePermissionModeSelect(mode: (typeof permissionModes)[number]) {
    setPermissionMode(mode);
    setPermissionMenuOpen(false);

    if (activeThreadId) {
      void persistActiveThreadMetadata({ permissionMode: mode });
    }
  }

  function updateThreadSummaryLocal(
    threadId: string,
    payload: {
      sessionId?: string;
      workingDirectory?: string;
      model?: string;
      permissionMode?: string;
    },
  ) {
    setProjects((current) =>
      current.map((project) => ({
        ...project,
        threads: project.threads.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                sessionId: payload.sessionId ?? thread.sessionId,
                workingDirectory: payload.workingDirectory ?? thread.workingDirectory,
                model: payload.model ?? thread.model,
                permissionMode: payload.permissionMode ?? thread.permissionMode,
                updatedAt: new Date().toISOString(),
                updatedLabel: '现在',
              }
            : thread,
        ),
      })),
    );
    setThreadDetails((current) => {
      const existing = current[threadId];
      if (!existing) {
        return current;
      }

      return {
        ...current,
        [threadId]: {
          ...existing,
          sessionId: payload.sessionId ?? existing.sessionId,
          workingDirectory: payload.workingDirectory ?? existing.workingDirectory,
          model: payload.model ?? existing.model,
          permissionMode: payload.permissionMode ?? existing.permissionMode,
        },
      };
    });
  }

  async function stopRun() {
    abortRef.current?.abort();

    if (!backendRunId) {
      return;
    }

    try {
      await fetch(`/api/claude/run/${backendRunId}`, {
        method: 'DELETE',
      });
    } catch {
      appendDebug({
        title: '取消请求未确认',
        content: '前端已停止等待，但后端取消请求未确认完成。',
        tone: 'error',
      });
    }
  }

  async function createThread(projectId: string) {
    setProjectMenuProjectId(null);
    setThreadMenuThreadId(null);
    const response = await fetch(`/api/projects/${projectId}/threads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const payload = (await response.json()) as { threadId: string; workspace: WorkspaceBootstrap };
    syncWorkspace(payload.workspace);
    setActiveProjectId(projectId);
    setActiveThreadId(payload.threadId);
    await persistSelection(projectId, payload.threadId);
    showToast('已新建聊天');
    return payload.threadId;
  }

  async function createProjectFromPath(projectPath: string) {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: projectPath }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const payload = (await response.json()) as { workspace: WorkspaceBootstrap };
    syncWorkspace(payload.workspace);
    showToast('项目已添加');
  }

  async function handlePickProjectDirectory() {
    try {
      const response = await fetch('/api/system/select-directory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          initialPath: activeProject?.path ?? DEFAULT_WORKSPACE,
        }),
      });

      if (!response.ok) {
        showToast(await response.text(), 'error');
        return;
      }

      const payload = (await response.json()) as { ok: true; path: string | null };
      if (!payload.path) {
        return;
      }

      await createProjectFromPath(payload.path);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '新增项目失败', 'error');
    }
  }

  async function submitInputDialog() {
    if (!inputDialog) {
      return;
    }

    const nextValue = inputDialog.value.trim();
    if (!nextValue) {
      showToast('输入内容不能为空。', 'error');
      return;
    }

    try {
      if (inputDialog.kind === 'rename-project') {
        const project = projects.find((item) => item.id === inputDialog.projectId);
        if (!project || nextValue === project.name) {
          setInputDialog(null);
          return;
        }

        const response = await fetch(`/api/projects/${inputDialog.projectId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: nextValue }),
        });

        if (!response.ok) {
          showToast(await response.text(), 'error');
          return;
        }

        const payload = (await response.json()) as { workspace: WorkspaceBootstrap };
        syncWorkspace(payload.workspace);
        setInputDialog(null);
        showToast('项目名称已更新');
        return;
      }

      const thread = projects
        .flatMap((project) => project.threads)
        .find((item) => item.id === inputDialog.threadId);
      if (!thread || nextValue === thread.title) {
        setInputDialog(null);
        return;
      }

      const response = await fetch(`/api/threads/${inputDialog.threadId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: nextValue }),
      });

      if (!response.ok) {
        showToast(await response.text(), 'error');
        return;
      }

      const payload = (await response.json()) as { workspace: WorkspaceBootstrap };
      syncWorkspace(payload.workspace);
      setInputDialog(null);
      showToast('聊天名称已更新');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error');
    }
  }

  async function confirmRemoveProject() {
    if (!confirmDialog || confirmDialog.kind !== 'remove-project') {
      return;
    }

    const response = await fetch(`/api/projects/${confirmDialog.projectId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      showToast(await response.text(), 'error');
      return;
    }

    const payload = (await response.json()) as { workspace: WorkspaceBootstrap };
    syncWorkspace(payload.workspace);
    setConfirmDialog(null);
    showToast('项目已移除');
  }

  async function handleOpenProject(project: ProjectSummary) {
    const response = await fetch(`/api/projects/${project.id}/open`, {
      method: 'POST',
    });
    if (!response.ok) {
      showToast(await response.text(), 'error');
      return;
    }

    setProjectMenuProjectId(null);
  }

  async function handleCopySessionId(thread: ThreadSummary) {
    if (!thread.sessionId) {
      showToast('当前聊天还没有 session ID。', 'info');
      return;
    }

    try {
      await navigator.clipboard.writeText(thread.sessionId);
      setThreadMenuThreadId(null);
      showToast('会话 ID 已复制');
    } catch {
      showToast(`复制失败，请手动复制：${thread.sessionId}`, 'error');
    }
  }

  async function persistSelection(projectId: string | null, threadId: string | null) {
    await fetch('/api/workspace/selection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId,
        threadId,
      }),
    });
  }

  async function selectThread(projectId: string, threadId: string) {
    setActiveProjectId(projectId);
    setActiveThreadId(threadId);
    activeTurnIdRef.current = '';
    await persistSelection(projectId, threadId);
  }

  async function selectProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    setActiveProjectId(projectId);
    setActiveThreadId(project?.threads[0]?.id ?? null);
    await persistSelection(projectId, project?.threads[0]?.id ?? null);
  }

  async function handlePanelStateChange(nextState: Partial<PanelState>) {
    const merged = {
      ...panelState,
      ...nextState,
    };
    setPanelState(merged);
    setPanelMenuOpen(false);
    await fetch('/api/workspace/panel', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(nextState),
    });
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  const filteredProjects = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const baseProjects = [...projects].sort((left, right) => {
      const leftValue = panelState.sortBy === 'created' ? left.createdAt : left.updatedAt;
      const rightValue = panelState.sortBy === 'created' ? right.createdAt : right.updatedAt;
      return rightValue.localeCompare(leftValue);
    });

    if (!normalizedQuery) {
      return baseProjects;
    }

    return baseProjects
      .map((project) => {
        const matchesProject =
          project.name.toLowerCase().includes(normalizedQuery) ||
          project.path.toLowerCase().includes(normalizedQuery) ||
          (project.gitBranch ?? '').toLowerCase().includes(normalizedQuery);
        if (matchesProject) {
          return project;
        }

        const threads = project.threads.filter((thread) => thread.title.toLowerCase().includes(normalizedQuery));
        if (threads.length === 0) {
          return null;
        }

        return {
          ...project,
          threads,
        };
      })
      .filter(Boolean) as ProjectSummary[];
  }, [panelState.sortBy, projects, searchQuery]);

  function toggleProjectCollapse(projectId: string) {
    setCollapsedProjects((current) => ({
      ...current,
      [projectId]: !current[projectId],
    }));
  }

  function toggleAllProjects() {
    const shouldCollapse = filteredProjects.some((project) => !collapsedProjects[project.id]);
    setCollapsedProjects((current) => {
      const next = { ...current };
      for (const project of filteredProjects) {
        next[project.id] = shouldCollapse;
      }
      return next;
    });
  }

  return (
    <div className="codex-desktop">
      <header className="desktop-menubar">
        <div className="window-nav">
          <button type="button" aria-label="侧边栏"><PanelLeft size={13} /></button>
          <button type="button" aria-label="后退"><ArrowLeft size={13} /></button>
          <button type="button" aria-label="前进"><ArrowRight size={13} /></button>
        </div>
        <nav className="desktop-menu">
          <span>文件</span>
          <span>编辑</span>
          <span>查看</span>
          <span>窗口</span>
          <span>帮助</span>
        </nav>
        <div className="window-controls">
          <span><Minus size={12} /></span>
          <span><Square size={11} /></span>
          <span><X size={12} /></span>
        </div>
      </header>

      <div className="codex-shell">
        <aside className="app-sidebar">
          <nav className="sidebar-primary">
            <button type="button" onClick={() => activeProjectId ? void createThread(activeProjectId) : void handlePickProjectDirectory()}>
              <span><Plus size={14} /></span> 新建聊天
            </button>
            <button type="button" onClick={() => setSearchOpen((value) => !value)}>
              <span><Search size={14} /></span> 搜索
              <kbd>Ctrl+G</kbd>
            </button>
            <button type="button"><span><Blocks size={14} /></span> 插件</button>
            <button type="button"><span><Clock3 size={14} /></span> 自动化</button>
          </nav>

          <section className="sidebar-projects">
            <div className="sidebar-section-head sidebar-section-toolbar">
              <span>项目</span>
              <div className="sidebar-section-actions">
                <button type="button" className="sidebar-toolbar-icon" title="展开或折叠项目" onClick={toggleAllProjects}>
                  <SquareSplitHorizontal size={13} />
                </button>
                <div className="panel-menu-anchor" ref={panelMenuRef}>
                  <button
                    type="button"
                    className="sidebar-toolbar-icon"
                    title="整理和排序"
                    onClick={() => setPanelMenuOpen((value) => !value)}
                  >
                    <AlignJustify size={13} />
                  </button>
                  {panelMenuOpen ? (
                    <div className="workspace-menu panel-menu-popover">
                      <div className="workspace-menu-group-title">整理</div>
                      <button type="button" className="workspace-menu-item" onClick={() => void handlePanelStateChange({ organizeBy: 'project' })}>
                        <span>按项目</span>
                        {panelState.organizeBy === 'project' ? <Check size={14} /> : null}
                      </button>
                      <button type="button" className="workspace-menu-item" onClick={() => void handlePanelStateChange({ organizeBy: 'timeline' })}>
                        <span>时间顺序列表</span>
                        {panelState.organizeBy === 'timeline' ? <Check size={14} /> : null}
                      </button>
                      <button type="button" className="workspace-menu-item" onClick={() => void handlePanelStateChange({ organizeBy: 'chat-first' })}>
                        <span>聊天优先</span>
                        {panelState.organizeBy === 'chat-first' ? <Check size={14} /> : null}
                      </button>
                      <div className="workspace-menu-divider" />
                      <div className="workspace-menu-group-title">排序条件</div>
                      <button type="button" className="workspace-menu-item" onClick={() => void handlePanelStateChange({ sortBy: 'created' })}>
                        <span>已创建</span>
                        {panelState.sortBy === 'created' ? <Check size={14} /> : null}
                      </button>
                      <button type="button" className="workspace-menu-item" onClick={() => void handlePanelStateChange({ sortBy: 'updated' })}>
                        <span>已更新</span>
                        {panelState.sortBy === 'updated' ? <Check size={14} /> : null}
                      </button>
                      <div className="workspace-menu-divider" />
                      <div className="workspace-menu-group-title">显示</div>
                      <button type="button" className="workspace-menu-item" onClick={() => void handlePanelStateChange({ visibility: 'all' })}>
                        <span>所有聊天</span>
                        {panelState.visibility === 'all' ? <Check size={14} /> : null}
                      </button>
                      <button type="button" className="workspace-menu-item" onClick={() => void handlePanelStateChange({ visibility: 'relevant' })}>
                        <span>相关</span>
                        {panelState.visibility === 'relevant' ? <Check size={14} /> : null}
                      </button>
                    </div>
                  ) : null}
                </div>
                <button type="button" className="sidebar-toolbar-icon" title="新增项目" onClick={() => void handlePickProjectDirectory()}>
                  <FolderPlus size={13} />
                </button>
              </div>
            </div>

            {searchOpen ? (
              <div className="sidebar-search">
                <Search size={13} />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="搜索项目和聊天"
                />
              </div>
            ) : null}

            {filteredProjects.length === 0 ? (
              <div className="sidebar-empty">
                <p>当前还没有项目。</p>
                <p>点击右上角新增项目，或从 Claude Code 本地 session 自动导入。</p>
              </div>
            ) : (
              filteredProjects.map((project) => (
                <div key={project.id} className={`sidebar-project ${project.id === activeProjectId ? 'active' : ''}`}>
                  <div className="sidebar-project-row">
                    <button type="button" className="sidebar-project-title" onClick={() => void selectProject(project.id)}>
                      <span><Folder size={14} /></span>
                      <strong>{project.name}</strong>
                      {project.gitBranch ? (
                        <small className="sidebar-branch">
                          <GitBranch size={11} />
                          {project.gitBranch}
                        </small>
                      ) : null}
                    </button>
                    <div className="sidebar-project-actions">
                      <button
                        type="button"
                        className="sidebar-row-action"
                        title="项目菜单"
                        onClick={() => setProjectMenuProjectId((value) => value === project.id ? null : project.id)}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                      <button
                        type="button"
                        className="sidebar-row-action"
                        title="新建该项目聊天"
                        onClick={() => void createThread(project.id)}
                      >
                        <SquarePen size={14} />
                      </button>
                      {projectMenuProjectId === project.id ? (
                        <div className="workspace-menu project-menu-popover">
                          <button type="button" className="workspace-menu-item" onClick={() => void handleOpenProject(project)}>
                            <span>在资源管理器中打开</span>
                          </button>
                          <button type="button" className="workspace-menu-item" onClick={() => openRenameProjectDialog(project)}>
                            <span>修改项目名称</span>
                          </button>
                          <button type="button" className="workspace-menu-item danger" onClick={() => openRemoveProjectDialog(project)}>
                            <span>移除</span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {!collapsedProjects[project.id] ? (
                    <div className="sidebar-thread-list">
                      {project.threads.map((thread) => (
                        <div key={thread.id} className={`sidebar-thread-row ${thread.id === activeThreadId ? 'active' : ''}`}>
                          <button type="button" className="sidebar-thread" onClick={() => void selectThread(project.id, thread.id)}>
                            <span>{thread.title}</span>
                            <small>{thread.updatedLabel}</small>
                          </button>
                          <button
                            type="button"
                            className="sidebar-row-action thread-row-action"
                            title="聊天菜单"
                            onClick={() => setThreadMenuThreadId((value) => value === thread.id ? null : thread.id)}
                          >
                            <MoreHorizontal size={13} />
                          </button>
                          {threadMenuThreadId === thread.id ? (
                            <div className="workspace-menu thread-menu-popover">
                              <button type="button" className="workspace-menu-item" onClick={() => openRenameThreadDialog(thread)}>
                                <span>重命名聊天</span>
                              </button>
                              <button type="button" className="workspace-menu-item" onClick={() => void handleCopySessionId(thread)}>
                                <span>复制会话 ID</span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <button type="button" className="sidebar-collapse-toggle" onClick={() => toggleProjectCollapse(project.id)}>
                    {collapsedProjects[project.id] ? '展开项目' : '折叠项目'}
                  </button>
                </div>
              ))
            )}
          </section>

          <div className="sidebar-footer">
            <button type="button"><span><Settings size={14} /></span> 设置</button>
          </div>
        </aside>

        <main className="chat-shell">
          <header className="chat-header">
            <div className="thread-title">
              <h2>{activeThread?.title ?? '选择一个聊天'}</h2>
              <span className="thread-project">{activeProject?.name ?? '未选择项目'}</span>
              <button type="button" className="more-button thread-more-button" aria-label="更多">
                <MoreHorizontal size={15} />
              </button>
            </div>
            <div className="header-actions">
              <button type="button" className="icon-button" title="运行">
                <Play size={14} />
              </button>
              <button type="button" className="editor-button" title="用编辑器打开">
                <Code2 className="editor-mark" size={16} />
                <span className="header-chevron" aria-hidden="true" />
              </button>
              <button type="button" className="pill-button">
                提交
                <span className="header-chevron" aria-hidden="true" />
              </button>
              <button type="button" className="icon-button" onClick={() => setDebugOpen((value) => !value)}>
                <TerminalSquare size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                title="使用当前项目目录"
                onClick={() => setWorkspace(activeProject?.path ?? DEFAULT_WORKSPACE)}
              >
                <Home size={14} />
              </button>
              <button type="button" className="diff-chip">
                <span className="add">+407</span>
                <span className="del">-66</span>
              </button>
              <button type="button" className="icon-button" title="布局">
                <SquareSplitHorizontal size={14} />
              </button>
            </div>
          </header>

          <section className="conversation" ref={transcriptRef}>
            {!activeThread ? (
              <div className="empty-state">
                <h3>从左侧选择一个项目或聊天</h3>
                <p>CodeM 会导入 Claude Code 本地 session，并把它们组织到项目工作区下面。</p>
              </div>
            ) : activeThread.turns.length === 0 ? (
              <div className="empty-state">
                <h3>开始一次 Claude Code 会话</h3>
                <p>输入需求后，Claude 的正文会连续显示，工具调用会以轻量步骤内嵌在回答中。</p>
              </div>
            ) : (
              activeThread.turns.map((turn) => <ConversationTurnView key={turn.id} turn={turn} nowMs={clockNowMs} />)
            )}
            <div ref={conversationBottomRef} />
          </section>

          <form className="composer" onSubmit={handleSubmit}>
            <div className="composer-card">
              <textarea
                className="composer-input"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="要求后续变更"
              />
              <div className="composer-toolbar">
                <div className="composer-left-tools">
                  <button type="button" className="plain-icon"><Plus size={16} /></button>
                  <div className="permission-picker" ref={permissionMenuRef}>
                    {permissionMenuOpen ? (
                      <div className="permission-menu" role="menu">
                        {permissionMenuModes.map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            className="permission-menu-item"
                            role="menuitemradio"
                            aria-checked={permissionMode === mode}
                            onClick={() => handlePermissionModeSelect(mode)}
                          >
                            <span className={`permission-icon permission-icon-${mode}`} aria-hidden="true" />
                            <span>{permissionLabel(mode)}</span>
                            {permissionMode === mode ? <Check className="permission-check" size={14} /> : null}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      className="permission-trigger"
                      aria-expanded={permissionMenuOpen}
                      onClick={() => setPermissionMenuOpen((value) => !value)}
                    >
                      <span className="permission-trigger-icon" aria-hidden="true" />
                      <span>{permissionLabel(permissionMode)}</span>
                      <span className="permission-trigger-chevron" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="composer-right-tools">
                  <div className="model-picker" ref={modelMenuRef}>
                    {modelMenuOpen ? (
                      <div className="model-menu" role="menu">
                        <div className="model-menu-title">模型</div>
                        {models.map((item) => (
                          <button
                            key={item}
                            type="button"
                            className="model-menu-item"
                            role="menuitemradio"
                            aria-checked={model === item}
                            onClick={() => {
                              setModel(item);
                              setModelMenuOpen(false);
                            }}
                          >
                            <span>{modelLabel(item)}</span>
                            {model === item ? <Check className="model-check" size={15} /> : null}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      className="model-trigger"
                      aria-expanded={modelMenuOpen}
                      disabled={models.length === 0 || isRunning}
                      title="Claude Code model"
                      onClick={() => setModelMenuOpen((value) => !value)}
                    >
                      <span>{modelTriggerLabel(model, models)}</span>
                      <span className="model-trigger-chevron" aria-hidden="true" />
                    </button>
                  </div>
                  <button type="button" className="plain-icon"><Mic size={15} /></button>
                  {isRunning ? (
                    <button type="button" className="send-button stop" onClick={stopRun} title="停止">
                      <Square size={13} fill="currentColor" />
                    </button>
                  ) : (
                    <button type="submit" className="send-button" disabled={!prompt.trim()} title="发送">
                      <ArrowUp size={18} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </form>

          <footer className="workspace-status">
            <span className="status-item status-workspace">
              <LayoutPanelLeft size={12} />
              <span>本地工作</span>
            </span>
            <span className="status-item status-branch">
              <GitBranch size={12} />
              <span>{activeProject?.gitBranch ?? '未检测到 Git'}</span>
              {activeProject?.gitBranch ? <span className="footer-chevron" aria-hidden="true" /> : null}
            </span>
            <span className="status-spacer" />
            <span>{activeThread?.sessionId ? 'session 已连接' : '新会话'}</span>
          </footer>
        </main>
      </div>

      {inputDialog ? (
        <div className="dialog-backdrop" role="presentation" onClick={() => setInputDialog(null)}>
          <div className="dialog-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-head">
              <h3>{inputDialog.title}</h3>
              <p>{inputDialog.description}</p>
            </div>
            <form
              className="dialog-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitInputDialog();
              }}
            >
              <input
                autoFocus
                className="dialog-input"
                value={inputDialog.value}
                onChange={(event) => setInputDialog((current) => current ? { ...current, value: event.target.value } : current)}
              />
              <div className="dialog-actions">
                <button type="button" className="dialog-button secondary" onClick={() => setInputDialog(null)}>
                  取消
                </button>
                <button type="submit" className="dialog-button primary">
                  {inputDialog.confirmLabel}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {confirmDialog ? (
        <div className="dialog-backdrop" role="presentation" onClick={() => setConfirmDialog(null)}>
          <div className="dialog-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-head">
              <h3>{confirmDialog.title}</h3>
              <p>{confirmDialog.description}</p>
            </div>
            <div className="dialog-actions">
              <button type="button" className="dialog-button secondary" onClick={() => setConfirmDialog(null)}>
                取消
              </button>
              <button type="button" className="dialog-button danger" onClick={() => void confirmRemoveProject()}>
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? <div className={`app-toast ${toast.tone}`}>{toast.message}</div> : null}

      {debugOpen && activeThread ? (
        <aside className="debug-drawer">
          <div className="debug-head">
            <div>
              <p className="eyebrow">Debug</p>
              <h2>运行细节</h2>
            </div>
            <button type="button" className="ghost-button" onClick={() => setDebugOpen(false)}>
              关闭
            </button>
          </div>

          <details className="debug-section" open>
            <summary>事件摘要</summary>
            {activeThread.debugEvents.length === 0 ? (
              <p className="muted">暂无调试事件</p>
            ) : (
              activeThread.debugEvents.map((event) => (
                <article key={event.id} className={`debug-item ${event.tone === 'error' ? 'debug-error' : ''}`}>
                  <h3>{event.title}</h3>
                  <pre>{event.content}</pre>
                </article>
              ))
            )}
          </details>

          <details className="debug-section">
            <summary>Raw Events ({activeThread.rawEvents.length})</summary>
            <pre className="raw-pre">{activeThread.rawEvents.join('\n') || '暂无原始事件'}</pre>
          </details>
        </aside>
      ) : null}
    </div>
  );
}

function createThreadDetail(summary: ThreadSummary): ThreadDetail {
  return {
    ...summary,
    turns: [],
    debugEvents: [],
    rawEvents: [],
    historyLoaded: false,
    historyLoading: false,
  };
}

function isPermissionMode(value: unknown): value is (typeof permissionModes)[number] {
  return typeof value === 'string' && permissionModes.includes(value as (typeof permissionModes)[number]);
}

function ConversationTurnView({ turn, nowMs }: { turn: ConversationTurn; nowMs: number }) {
  const visibleItems = turn.items.filter((item) => item.type === 'text' || !shouldHideToolStep(item.tool));
  const showProgressLine =
    turn.status === 'pending' ||
    turn.status === 'running' ||
    Boolean(turn.durationMs || turn.outputTokens || turn.inputTokens);

  return (
    <article className="turn">
      <section className="message user-message">
        <div className="message-label">You</div>
        <div className="message-body preserve-format">{turn.userText}</div>
      </section>

      <section className="message assistant-message">
        <div className="message-label">Claude</div>
        <div className="assistant-content">
          {visibleItems.length > 0 ? (
            visibleItems.map((item) =>
              item.type === 'text' ? (
                <MarkdownMessage key={item.id} content={item.text} />
              ) : (
                <ToolStepRow key={item.id} tool={item.tool} />
              ),
            )
          ) : (
            turn.status === 'pending' || turn.status === 'running' ? (
              <TurnProgressLine turn={turn} nowMs={nowMs} />
            ) : null
          )}

          {visibleItems.length > 0 && turn.status === 'running' ? (
            <TurnProgressLine turn={turn} nowMs={nowMs} compact />
          ) : null}

          {showProgressLine && turn.status !== 'running' && turn.status !== 'pending' ? (
            <TurnProgressLine turn={turn} nowMs={nowMs} compact />
          ) : null}
          {!showProgressLine && turn.metrics ? <div className="turn-metrics">{turn.metrics}</div> : null}
          {turn.status === 'error' || turn.status === 'stopped' ? (
            <div className={`turn-status ${turn.status}`}>{turn.activity}</div>
          ) : null}
        </div>
      </section>
    </article>
  );
}

function TurnProgressLine({
  turn,
  nowMs,
  compact = false,
}: {
  turn: ConversationTurn;
  nowMs: number;
  compact?: boolean;
}) {
  const running = turn.status === 'pending' || turn.status === 'running';
  const text = formatTurnProgress(turn, running ? nowMs : undefined);

  return (
    <div className={`working-line tui-progress ${compact ? 'compact' : ''}`}>
      <span className={`activity-dot ${running ? 'pulse' : ''}`} />
      <span>{text}</span>
    </div>
  );
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="message-body markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function ToolStepRow({ tool }: { tool: ToolStep }) {
  const hasDetails = Boolean(tool.inputText?.trim() || tool.resultText?.trim());
  const summary = summarizeToolRow(tool);

  return (
    <div className={`tool-step tool-${tool.status}`}>
      <div className="tool-step-main">
        <span className="tool-status-dot" />
        <div>
          <div className="tool-title">{tool.title}</div>
          {summary ? <div className="tool-subtitle">{summary}</div> : null}
        </div>
      </div>

      {hasDetails ? (
        <details className="tool-details">
          <summary>查看详情</summary>
          {tool.inputText?.trim() ? (
            <>
              <h4>参数</h4>
              <pre>{tool.inputText}</pre>
            </>
          ) : null}
          {tool.resultText?.trim() ? (
            <>
              <h4>结果</h4>
              <pre>{tool.resultText}</pre>
            </>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

function createToolStep(event: Extract<ClaudeEvent, { type: 'tool-start' }>): ToolStep {
  const inputText = formatInitialToolInput(event.input);
  const id = event.toolUseId ?? `${event.runId}-${event.blockIndex}`;

  return {
    id,
    name: event.name,
    title: describeToolCall(event.name, inputText),
    status: 'running',
    blockIndex: event.blockIndex,
    toolUseId: event.toolUseId,
    inputText,
  };
}

function upsertToolStep(steps: ToolStep[], step: ToolStep) {
  const index = steps.findIndex((item) => item.id === step.id);
  if (index === -1) {
    return [...steps, step];
  }

  const next = [...steps];
  next[index] = { ...next[index], ...step };
  return next;
}

function appendTextItem(items: AssistantItem[], text: string): AssistantItem[] {
  const last = items.at(-1);
  if (last?.type === 'text') {
    return [
      ...items.slice(0, -1),
      {
        ...last,
        text: `${last.text}${text}`,
      },
    ];
  }

  return [...items, { id: crypto.randomUUID(), type: 'text', text }];
}

function syncToolItem(items: AssistantItem[], step: ToolStep): AssistantItem[] {
  const index = items.findIndex((item) => item.type === 'tool' && item.tool.id === step.id);
  if (index === -1) {
    return [...items, { id: step.id, type: 'tool', tool: step }];
  }

  const next = [...items];
  next[index] = { id: step.id, type: 'tool', tool: step };
  return next;
}

function upsertToolDelta(steps: ToolStep[], event: Extract<ClaudeEvent, { type: 'tool-input-delta' }>) {
  const index = steps.findIndex((item) => matchesToolBlock(item, event.blockIndex));
  if (index === -1) {
    return [
      ...steps,
      {
        id: `${event.runId}-${event.blockIndex}`,
        name: 'tool',
        title: '工具参数流',
        status: 'running' as const,
        blockIndex: event.blockIndex,
        inputText: event.text,
      },
    ];
  }

  const next = [...steps];
  const item = next[index];
  const inputText = `${item.inputText ?? ''}${event.text}`;
  next[index] = {
    ...item,
    inputText,
    title: describeToolCall(item.name, inputText),
  };
  return next;
}

function attachToolResult(steps: ToolStep[], event: Extract<ClaudeEvent, { type: 'tool-result' }>) {
  const index = steps.findIndex((item) => item.toolUseId && item.toolUseId === event.toolUseId);
  if (index === -1) {
    return [
      ...steps,
      {
        id: event.toolUseId ?? crypto.randomUUID(),
        name: 'tool_result',
        title: event.isError ? '工具返回异常' : '工具返回结果',
        status: event.isError ? ('error' as const) : ('done' as const),
        toolUseId: event.toolUseId,
        resultText: event.content,
        isError: event.isError,
      },
    ];
  }

  const next = [...steps];
  next[index] = {
    ...next[index],
    status: event.isError ? 'error' : 'done',
    resultText: event.content,
    isError: event.isError,
  };
  return next;
}

function settleRunningToolSteps(
  turn: ConversationTurn,
  nextStatus: Exclude<ToolStep['status'], 'running'>,
) {
  const tools = turn.tools.map((tool) =>
    tool.status === 'running'
      ? {
          ...tool,
          status: nextStatus,
        }
      : tool,
  );

  const items = turn.items.map((item) =>
    item.type === 'tool' && item.tool.status === 'running'
      ? {
          ...item,
          tool: {
            ...item.tool,
            status: nextStatus,
          },
        }
      : item,
  );

  return {
    tools,
    items,
  };
}

function mergeUsageSnapshot(turn: ConversationTurn, snapshot: UsageSnapshot): Partial<ConversationTurn> {
  return {
    inputTokens: snapshot.inputTokens ?? turn.inputTokens,
    outputTokens: snapshot.outputTokens ?? turn.outputTokens,
    cacheCreationInputTokens: snapshot.cacheCreationInputTokens ?? turn.cacheCreationInputTokens,
    cacheReadInputTokens: snapshot.cacheReadInputTokens ?? turn.cacheReadInputTokens,
  };
}

function getElapsedDuration(turn: ConversationTurn) {
  if (!turn.startedAtMs) {
    return undefined;
  }

  return Math.max(0, Date.now() - turn.startedAtMs);
}

function matchesToolBlock(tool: ToolStep, blockIndex: number) {
  return tool.blockIndex === blockIndex;
}

function describeToolCall(name: string, inputText?: string) {
  const input = parseLooseJson(inputText);
  const filePath = getString(input, ['file_path', 'path', 'notebook_path']);
  const pattern = getString(input, ['pattern', 'query']);
  const command = getString(input, ['command', 'cmd', 'cmdString']);

  if (name === 'Read' && filePath) {
    return `Read(${compactToolArgument(filePath)})`;
  }

  if (name === 'Grep' && pattern) {
    return `Grep(${compactToolArgument(pattern)})`;
  }

  if (name === 'Glob' && pattern) {
    return `Glob(${compactToolArgument(pattern)})`;
  }

  if (name === 'Bash' && command) {
    return `Bash(${compactToolArgument(command)})`;
  }

  if ((name === 'Edit' || name === 'Write' || name === 'NotebookEdit') && filePath) {
    return `${name}(${compactToolArgument(filePath)})`;
  }

  if (name.startsWith('mcp__')) {
    return `MCP(${getReadableToolName(name)})`;
  }

  return getReadableToolName(name);
}

function shouldHideToolStep(tool: ToolStep) {
  const hasDetails = Boolean(tool.inputText?.trim() || tool.resultText?.trim());
  if (hasDetails) {
    return false;
  }

  return tool.title === getReadableToolName(tool.name);
}

function getReadableToolName(name: string) {
  if (name.startsWith('mcp__')) {
    const segments = name.split('__').filter(Boolean);
    return segments.at(-1) ?? name;
  }

  return name;
}

function summarizeToolResult(event: Extract<ClaudeEvent, { type: 'tool-result' }>) {
  return event.isError ? 'Error' : 'Done';
}

function summarizeText(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) {
    return '无输出';
  }

  return clean.length > 80 ? `${clean.slice(0, 80)}...` : clean;
}

function summarizeToolRow(tool: ToolStep) {
  if (tool.resultText?.trim()) {
    const firstLine = extractToolResultSummary(tool.resultText);
    return tool.isError ? `Error: ${firstLine}` : firstLine;
  }

  if (tool.status === 'running') {
    return 'Running';
  }

  return tool.status === 'error' ? 'Error' : 'Done';
}

function extractToolResultSummary(text: string) {
  const clean = text.replace(/\r/g, '').trim();
  const exitMatch = clean.match(/Error:\s*Exit code\s*(\d+)/i);
  if (exitMatch) {
    return `Exit code ${exitMatch[1]}`;
  }

  const lines = clean
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const line = lines.find((item) => !item.startsWith('```')) ?? lines[0] ?? clean;
  return summarizeText(line);
}

function compactToolArgument(value: string) {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= 96) {
    return clean;
  }

  return `${clean.slice(0, 93)}...`;
}

function formatTurnProgress(turn: ConversationTurn, nowMs?: number) {
  if (turn.status === 'stopped') {
    return 'Stopped';
  }

  if (turn.status === 'error') {
    return 'Error';
  }

  const parts: string[] = [];
  const durationMs = turn.durationMs ?? (nowMs && turn.startedAtMs ? Math.max(0, nowMs - turn.startedAtMs) : undefined);
  if (typeof durationMs === 'number') {
    parts.push(formatDuration(durationMs));
  }
  if (typeof turn.outputTokens === 'number' && turn.outputTokens > 0) {
    parts.push(`↓ ${turn.outputTokens} tokens`);
  }
  if (typeof turn.totalCostUsd === 'number') {
    parts.push(`$${turn.totalCostUsd.toFixed(4)}`);
  }

  const prefix =
    turn.status === 'done'
      ? 'Done'
      : turn.phase === 'thinking' || turn.phase === 'requesting'
        ? 'Thinking...'
        : 'Computing...';

  return parts.length > 0 ? `${prefix} (${parts.join(' · ')})` : prefix;
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${seconds}s`;
}

function formatMetrics(event: Extract<ClaudeEvent, { type: 'done' }>) {
  const metrics: string[] = [];
  if (typeof event.totalCostUsd === 'number') {
    metrics.push(`花费 $${event.totalCostUsd.toFixed(4)}`);
  }
  if (typeof event.durationMs === 'number') {
    metrics.push(`耗时 ${(event.durationMs / 1000).toFixed(1)}s`);
  }
  if (typeof event.outputTokens === 'number') {
    metrics.push(`输出 ${event.outputTokens} tokens`);
  }

  return metrics.join('，');
}

function formatJson(value: unknown) {
  if (value == null || value === '') {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function formatInitialToolInput(value: unknown) {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  ) {
    return '';
  }

  return formatJson(value);
}

function parseLooseJson(value?: string) {
  if (!value?.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function getString(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

function permissionLabel(mode: (typeof permissionModes)[number]) {
  const labels: Record<(typeof permissionModes)[number], string> = {
    default: '默认权限',
    plan: '计划模式',
    acceptEdits: '接受编辑',
    auto: '自动执行',
    dontAsk: '无需确认',
    bypassPermissions: '完全访问权限',
  };

  return labels[mode];
}

function modelLabel(model: string) {
  return model === DEFAULT_MODEL_VALUE ? '默认' : model;
}

function modelTriggerLabel(model: string, models: string[]) {
  if (model !== DEFAULT_MODEL_VALUE) {
    return modelLabel(model);
  }

  return models.find((item) => item !== DEFAULT_MODEL_VALUE) ?? '默认';
}
