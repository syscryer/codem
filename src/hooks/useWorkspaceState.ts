import { startTransition, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { EMPTY_PANEL_STATE } from '../constants';
import { createThreadDetail, metricsFromTurn, normalizeTurnsForPersist, repairConversationTurn } from '../lib/conversation';
import { pickDesktopDirectory } from '../lib/desktop-dialog';
import { resolveNewChatDraftProjectId } from '../lib/new-chat-draft';
import { buildWorkspaceSidebarSections } from '../lib/workspace-pinning';
import type {
  CloneTask,
  ConfirmDialogState,
  ConversationTurn,
  DebugEvent,
  GitBranchSummary,
  InputDialogState,
  PanelState,
  ProjectGitSummary,
  ProjectSummary,
  ThreadDetail,
  ThreadHistoryPayload,
  ThreadSummary,
  ToastOptions,
  ToastState,
  WorkspaceBootstrap,
} from '../types';

type ThreadMetadataPatch = {
  sessionId?: string | null;
  workingDirectory?: string;
  model?: string | null;
  permissionMode?: string;
};

type PendingWorkspaceLogBatch = {
  debugEvents: DebugEvent[];
  rawEvents: string[];
};

type CreateProjectOptions = {
  successMessage?: string | null;
};

type CreateThreadOptions = {
  showToast?: boolean;
};

const MAX_DEBUG_EVENTS = 220;
const MAX_RAW_EVENTS = 220;
const MAX_DEBUG_CONTENT_CHARS = 12_000;
const MAX_RAW_EVENT_CHARS = 16_000;
const WORKSPACE_LOG_FLUSH_MS = 100;
const LOG_TRUNCATION_MARKER = '\n...[已截断]...\n';
const PERSIST_HISTORY_DEBOUNCE_MS = 150;
const PERSIST_HISTORY_RETRY_DELAY_MS = 500;
const PERSIST_HISTORY_MAX_RETRIES = 2;

function isLiveTurn(turn: ConversationTurn) {
  return turn.status === 'pending' || turn.status === 'running';
}

function hasLiveTurns(turns: ConversationTurn[]) {
  return turns.some(isLiveTurn);
}

export function useWorkspaceState() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [panelState, setPanelState] = useState<PanelState>(EMPTY_PANEL_STATE);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isNewChatDraft, setIsNewChatDraft] = useState(false);
  const [threadDetails, setThreadDetails] = useState<Record<string, ThreadDetail>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [cloneTasks, setCloneTasks] = useState<CloneTask[]>([]);
  const [inputDialog, setInputDialog] = useState<InputDialogState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const threadDetailsRef = useRef<Record<string, ThreadDetail>>({});
  const activeProjectIdRef = useRef<string | null>(null);
  const newChatDraftRef = useRef(false);
  const directoryPickerPromiseRef = useRef<Promise<string | null> | null>(null);
  const persistHistoryStateRef = useRef<
    Map<
      string,
      {
        timerId: number | null;
        retryTimerId: number | null;
        inFlight: boolean;
        pending: boolean;
        retryCount: number;
      }
    >
  >(new Map());
  const pendingLogBatchesRef = useRef<Map<string, PendingWorkspaceLogBatch>>(new Map());
  const pendingLogFlushTimerRef = useRef<number | null>(null);

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const activeThreadSummary = useMemo(
    () => projects.flatMap((project) => project.threads).find((thread) => thread.id === activeThreadId) ?? null,
    [projects, activeThreadId],
  );
  const activeThread = activeThreadSummary
    ? threadDetails[activeThreadSummary.id] ?? createThreadDetail(activeThreadSummary)
    : null;

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspaceWithRetry() {
      const retryDelaysMs = [0, 300, 900];
      for (const delayMs of retryDelaysMs) {
        if (cancelled) {
          return;
        }
        if (delayMs > 0) {
          await wait(delayMs);
        }
        try {
          await loadWorkspace();
          return;
        } catch (error) {
          if (cancelled) {
            return;
          }
          if (delayMs === retryDelaysMs[retryDelaysMs.length - 1]) {
            console.error('加载工作区失败', error);
          }
        }
      }
    }

    void loadWorkspaceWithRetry();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }

    const existing = threadDetailsRef.current[activeThreadId];
    void loadThreadHistory(activeThreadId, {
      force: Boolean(existing?.historyLoaded && !hasLiveTurns(existing.turns)),
    });
  }, [activeThreadId]);

  useEffect(() => {
    threadDetailsRef.current = threadDetails;
  }, [threadDetails]);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    newChatDraftRef.current = isNewChatDraft;
  }, [isNewChatDraft]);

  useEffect(() => {
    return () => {
      if (pendingLogFlushTimerRef.current !== null) {
        window.clearTimeout(pendingLogFlushTimerRef.current);
        pendingLogFlushTimerRef.current = null;
      }
      pendingLogBatchesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!toast || toast.detailOpen) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, toast.durationMs ?? 2200);

    return () => window.clearTimeout(timer);
  }, [toast]);

  async function loadWorkspace() {
    const response = await fetch('/api/workspace/bootstrap');
    if (!response.ok) {
      throw new Error((await response.text()) || '加载工作区失败');
    }
    const payload = (await response.json()) as WorkspaceBootstrap;
    syncWorkspace(payload);
  }

  function wait(ms: number) {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function syncWorkspace(payload: WorkspaceBootstrap, options?: { preserveNewChatDraft?: boolean }) {
    const preserveNewChatDraft = options?.preserveNewChatDraft ?? newChatDraftRef.current;
    const nextActiveProjectId = preserveNewChatDraft
      ? resolveNewChatDraftProjectId({
          currentProjectId: activeProjectIdRef.current,
          payloadProjectId: payload.activeProjectId,
          projects: payload.projects,
        })
      : payload.activeProjectId;
    setProjects(payload.projects);
    setPanelState(payload.panelState);
    activeProjectIdRef.current = nextActiveProjectId;
    setActiveProjectId(nextActiveProjectId);
    setActiveThreadId(preserveNewChatDraft ? null : payload.activeThreadId);
    newChatDraftRef.current = preserveNewChatDraft;
    setIsNewChatDraft(preserveNewChatDraft);
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
            claudeContext: existing?.claudeContext,
            historyLoaded: existing?.historyLoaded ?? false,
            historyLoading: existing?.historyLoading ?? false,
          };
        }
      }
      return next;
    });
  }

  function showToast(message: string, tone: ToastState['tone'] = 'success', options?: number | ToastOptions) {
    const normalizedOptions = typeof options === 'number' ? { durationMs: options } : options;
    setToast({
      id: crypto.randomUUID(),
      message,
      tone,
      title: normalizedOptions?.title,
      detail: normalizedOptions?.detail,
      detailOpen: false,
      durationMs: normalizedOptions?.durationMs ?? (normalizedOptions?.detail ? 9000 : undefined),
    });
  }

  function dismissToast() {
    setToast(null);
  }

  function setToastDetailOpen(toastId: string, detailOpen: boolean) {
    setToast((current) => (current?.id === toastId ? { ...current, detailOpen } : current));
  }

  function openRenameProjectDialog(project: ProjectSummary) {
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
    setConfirmDialog({
      kind: 'remove-project',
      title: '删除项目',
      description: `删除项目“${project.name}”后，会删除 CodeM 的索引、聊天记录，以及关联的 Claude Code 原始 session 文件，不会删除磁盘目录。`,
      confirmLabel: '删除项目',
      projectId: project.id,
    });
  }

  function openRemoveThreadDialog(thread: ThreadSummary) {
    setConfirmDialog({
      kind: 'remove-thread',
      title: '删除聊天',
      description: `删除聊天“${thread.title}”后，会删除 CodeM 索引、消息记录，以及关联的 Claude Code 原始 session 文件。`,
      confirmLabel: '删除聊天',
      threadId: thread.id,
    });
  }

  async function loadThreadHistory(threadId: string, options?: { force?: boolean }) {
    const force = options?.force ?? false;
    setThreadDetails((current) => {
      const existing = current[threadId];
      if (!existing || existing.historyLoading || (existing.historyLoaded && !force)) {
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

    const currentDetail = threadDetailsRef.current[threadId];
    if (currentDetail?.historyLoading || (currentDetail?.historyLoaded && !force)) {
      return;
    }

    function stopThreadHistoryLoading(targetThreadId: string) {
      setThreadDetails((current) => {
        const existing = current[targetThreadId];
        if (!existing) {
          return current;
        }

        return {
          ...current,
          [targetThreadId]: {
            ...existing,
            historyLoading: false,
          },
        };
      });
    }

    try {
      const response = await fetch(`/api/threads/${threadId}/history`);
      if (!response.ok) {
        stopThreadHistoryLoading(threadId);
        return;
      }

      const payload = (await response.json()) as ThreadHistoryPayload;
      setThreadDetails((current) => {
        const existing = current[payload.threadId];
        if (!existing) {
          return current;
        }

        const repairedTurns = payload.turns.map((t) => {
          const repaired = repairConversationTurn(t);
          if (repaired.status === 'done' || repaired.status === 'error') {
            const metrics = metricsFromTurn(repaired);
            return metrics !== repaired.metrics ? { ...repaired, metrics } : repaired;
          }
          return repaired;
        });
        const repairedTurnIds = new Set(repairedTurns.map((turn) => turn.id));
        const currentTurnsById = new Map(existing.turns.map((turn) => [turn.id, turn]));
        const mergedTurns = [
          ...repairedTurns.map((turn) => {
            const current = currentTurnsById.get(turn.id);
            return current && isLiveTurn(current) ? current : turn;
          }),
          ...existing.turns.filter((turn) => !repairedTurnIds.has(turn.id) && (!force || isLiveTurn(turn))),
        ];

        return {
          ...current,
          [payload.threadId]: {
            ...existing,
            turns: mergedTurns,
            claudeContext: payload.claudeContext ?? existing.claudeContext,
            historyLoaded: true,
            historyLoading: false,
          },
        };
      });
    } catch {
      stopThreadHistoryLoading(threadId);
    }
  }

  async function persistThreadHistory(threadId: string, turns: ConversationTurn[]) {
    const response = await fetch(`/api/threads/${threadId}/history`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ turns: normalizeTurnsForPersist(turns) }),
    });

    if (!response.ok) {
      throw new Error(`persist history failed with HTTP ${response.status}`);
    }
  }

  function schedulePersistThreadHistory(threadId: string | null) {
    if (!threadId) {
      return;
    }

    const state = getPersistHistoryState(persistHistoryStateRef, threadId);
    state.pending = true;
    state.retryCount = 0;

    if (state.retryTimerId !== null) {
      window.clearTimeout(state.retryTimerId);
      state.retryTimerId = null;
    }

    if (state.timerId !== null) {
      window.clearTimeout(state.timerId);
    }

    state.timerId = window.setTimeout(() => {
      state.timerId = null;
      void flushPersistThreadHistory(threadId, threadDetailsRef, persistHistoryStateRef, persistThreadHistory);
    }, PERSIST_HISTORY_DEBOUNCE_MS);
  }

  function updateThreadDetail(
    threadId: string,
    updater: (thread: ThreadDetail) => ThreadDetail,
    fallbackSummary?: ThreadSummary,
  ) {
    setThreadDetails((current) => {
      const existing = current[threadId] ?? (fallbackSummary ? createThreadDetail(fallbackSummary) : null);
      if (!existing) {
        return current;
      }

      const nextThread = updater(existing);
      const next = {
        ...current,
        [threadId]: nextThread,
      };
      threadDetailsRef.current = next;
      if (hasPendingHumanRequests(nextThread)) {
        schedulePersistThreadHistory(threadId);
      }
      return next;
    });
  }

  function updateThreadTurn(
    threadId: string,
    turnId: string,
    updater: (turn: ConversationTurn) => ConversationTurn,
    fallbackSummary?: ThreadSummary,
  ) {
    updateThreadDetail(
      threadId,
      (thread) => ({
        ...thread,
        turns: thread.turns.map((turn) => (turn.id === turnId ? repairConversationTurn(updater(turn)) : turn)),
      }),
      fallbackSummary,
    );
  }

  function hasPendingHumanRequests(thread: ThreadDetail) {
    return thread.turns.some(
      (turn) => Boolean(turn.pendingUserInputRequests?.length) || Boolean(turn.pendingApprovalRequests?.length),
    );
  }

  function getPendingLogBatch(threadId: string) {
    let batch = pendingLogBatchesRef.current.get(threadId);
    if (!batch) {
      batch = { debugEvents: [], rawEvents: [] };
      pendingLogBatchesRef.current.set(threadId, batch);
    }
    return batch;
  }

  function scheduleThreadLogFlush() {
    if (pendingLogFlushTimerRef.current !== null) {
      return;
    }

    pendingLogFlushTimerRef.current = window.setTimeout(() => {
      pendingLogFlushTimerRef.current = null;
      flushPendingThreadLogs();
    }, WORKSPACE_LOG_FLUSH_MS);
  }

  function flushPendingThreadLogs() {
    const entries = Array.from(pendingLogBatchesRef.current.entries());
    pendingLogBatchesRef.current.clear();
    if (entries.length === 0) {
      return;
    }

    startTransition(() => {
      setThreadDetails((current) => {
        let next: Record<string, ThreadDetail> | null = null;

        for (const [threadId, batch] of entries) {
          const existing = (next ?? current)[threadId];
          if (!existing) {
            continue;
          }

          const nextDebugEvents = batch.debugEvents.length
            ? [...existing.debugEvents, ...batch.debugEvents].slice(-MAX_DEBUG_EVENTS)
            : existing.debugEvents;
          const nextRawEvents = batch.rawEvents.length
            ? [...existing.rawEvents, ...batch.rawEvents].slice(-MAX_RAW_EVENTS)
            : existing.rawEvents;

          next = next ?? { ...current };
          next[threadId] = {
            ...existing,
            debugEvents: nextDebugEvents,
            rawEvents: nextRawEvents,
          };
        }

        if (!next) {
          return current;
        }

        threadDetailsRef.current = next;
        return next;
      });
    });
  }

  function appendDebug(threadId: string, event: Omit<DebugEvent, 'id'>) {
    const normalizedEvent = {
      ...event,
      content: truncateWorkspaceLogText(event.content, MAX_DEBUG_CONTENT_CHARS),
    };
    const batch = getPendingLogBatch(threadId);
    batch.debugEvents.push({ ...normalizedEvent, id: crypto.randomUUID() });
    if (batch.debugEvents.length > MAX_DEBUG_EVENTS) {
      batch.debugEvents.splice(0, batch.debugEvents.length - MAX_DEBUG_EVENTS);
    }
    scheduleThreadLogFlush();
  }

  function appendRawEvent(threadId: string, line: string) {
    const normalizedLine = truncateWorkspaceLogText(line, MAX_RAW_EVENT_CHARS);
    const batch = getPendingLogBatch(threadId);
    batch.rawEvents.push(normalizedLine);
    if (batch.rawEvents.length > MAX_RAW_EVENTS) {
      batch.rawEvents.splice(0, batch.rawEvents.length - MAX_RAW_EVENTS);
    }
    scheduleThreadLogFlush();
  }

  async function persistThreadMetadata(threadId: string, payload: ThreadMetadataPatch) {
    updateThreadSummaryLocal(threadId, payload);

    const response = await fetch(`/api/threads/${threadId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const result = (await response.json()) as { workspace?: WorkspaceBootstrap };
      if (result.workspace) {
        syncWorkspace(result.workspace);
      }
    }
  }

  function updateThreadSummaryLocal(threadId: string, payload: ThreadMetadataPatch) {
    setProjects((current) =>
      current.map((project) => ({
        ...project,
        threads: project.threads.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                sessionId: hasOwn(payload, 'sessionId') ? payload.sessionId ?? '' : thread.sessionId,
                workingDirectory: payload.workingDirectory ?? thread.workingDirectory,
                model: hasOwn(payload, 'model') ? payload.model ?? undefined : thread.model,
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
          sessionId: hasOwn(payload, 'sessionId') ? payload.sessionId ?? '' : existing.sessionId,
          workingDirectory: payload.workingDirectory ?? existing.workingDirectory,
          model: hasOwn(payload, 'model') ? payload.model ?? undefined : existing.model,
          permissionMode: payload.permissionMode ?? existing.permissionMode,
        },
      };
    });
  }

  async function createThread(projectId: string, title?: string, _options?: CreateThreadOptions) {
    const response = await fetch(`/api/projects/${projectId}/threads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(title?.trim() ? { title: title.trim() } : {}),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const payload = (await response.json()) as { threadId: string; thread: ThreadSummary };
    const createdThread = payload.thread;

    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? {
              ...project,
              updatedAt: createdThread.updatedAt,
              threads: [
                createdThread,
                ...project.threads.filter((thread) => thread.id !== createdThread.id),
              ],
            }
          : project,
      ),
    );
    setThreadDetails((current) => ({
      ...current,
      [createdThread.id]: current[createdThread.id] ?? createThreadDetail(createdThread),
    }));
    activeProjectIdRef.current = projectId;
    setActiveProjectId(projectId);
    setActiveThreadId(payload.threadId);
    newChatDraftRef.current = false;
    setIsNewChatDraft(false);
    return createdThread;
  }

  async function renameThread(threadId: string, title: string, _options?: { showToast?: boolean }) {
    const nextTitle = title.trim();
    if (!nextTitle) {
      return null;
    }

    const response = await fetch(`/api/threads/${threadId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: nextTitle }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const payload = (await response.json()) as { workspace: WorkspaceBootstrap };
    syncWorkspace(payload.workspace);
    const renamedThread = payload.workspace.projects
      .flatMap((project) => project.threads)
      .find((thread) => thread.id === threadId) ?? null;
    return renamedThread;
  }

  function updateCloneTask(taskId: string, patch: Partial<CloneTask>) {
    setCloneTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
    );
  }

  function removeCloneTask(taskId: string) {
    setCloneTasks((current) => current.filter((task) => task.id !== taskId));
  }

  async function createProjectFromPath(projectPath: string, options?: CreateProjectOptions) {
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

    const payload = (await response.json()) as { projectId: string; workspace: WorkspaceBootstrap };
    syncWorkspace(payload.workspace);
    if (options?.successMessage !== null) {
      showToast(options?.successMessage ?? '项目已添加');
    }
    return payload;
  }

  async function openWorktreePath(worktreePath: string) {
    const payload = await createProjectFromPath(worktreePath, {
      successMessage: null,
    });
    const project = payload.workspace.projects.find((item) => item.id === payload.projectId) ?? null;
    if (!project) {
      showToast('工作树已加入项目，但切换失败。', 'error');
      return;
    }

    const firstThread = project.threads[0];
    if (firstThread) {
      activeProjectIdRef.current = project.id;
      setActiveProjectId(project.id);
      setActiveThreadId(firstThread.id);
      newChatDraftRef.current = false;
      setIsNewChatDraft(false);
      await persistSelection(project.id, firstThread.id);
      return;
    }

    await createThread(project.id, undefined, { showToast: false });
  }

  async function selectDirectoryPath(initialPath?: string) {
    if (directoryPickerPromiseRef.current) {
      return directoryPickerPromiseRef.current;
    }

    const pickerTask = (async () => {
      const desktopSelectedPath = await pickDesktopDirectory(initialPath);
      if (desktopSelectedPath !== undefined) {
        return desktopSelectedPath;
      }

      const response = await fetch('/api/system/select-directory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          initialPath: initialPath || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = (await response.json()) as { ok: true; path: string | null };
      return payload.path;
    })();

    directoryPickerPromiseRef.current = pickerTask;
    try {
      return await pickerTask;
    } finally {
      if (directoryPickerPromiseRef.current === pickerTask) {
        directoryPickerPromiseRef.current = null;
      }
    }
  }

  function cloneRepositoryAndAttach(payload: {
    repoUrl: string;
    baseDirectory: string;
    folderName: string;
  }) {
    const repoUrl = payload.repoUrl.trim();
    const baseDirectory = payload.baseDirectory.trim();
    const folderName = payload.folderName.trim();
    const targetPath = `${baseDirectory}${baseDirectory.endsWith('\\') || baseDirectory.endsWith('/') ? '' : '\\'}${folderName}`;
    const taskId = crypto.randomUUID();

    setCloneTasks((current) => [
      {
        id: taskId,
        repoUrl,
        projectName: folderName,
        baseDirectory,
        folderName,
        targetPath,
        status: 'cloning',
        phase: 'clone',
        detail: '正在克隆仓库...',
        rawLog: undefined,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]);

    void runCloneTask(taskId, {
      repoUrl,
      baseDirectory,
      folderName,
      targetPath,
    });
  }

  async function runCloneTask(
    taskId: string,
    payload: {
      repoUrl: string;
      baseDirectory: string;
      folderName: string;
      targetPath: string;
    },
  ) {
    updateCloneTask(taskId, {
      status: 'cloning',
      phase: 'clone',
      detail: '正在克隆仓库...',
      errorMessage: undefined,
      rawLog: undefined,
    });

    try {
      const response = await fetch('/api/git/clone', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repoUrl: payload.repoUrl,
          baseDirectory: payload.baseDirectory,
          folderName: payload.folderName,
        }),
      });

      if (!response.ok) {
        throw await readCloneError(response);
      }

      const clonePayload = (await response.json()) as { ok: true; projectPath: string };
      await attachClonedProject(taskId, clonePayload.projectPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : '克隆仓库失败';
      const rawLog = isCloneFailure(error) ? error.rawLog : undefined;
      updateCloneTask(taskId, {
        status: 'failed',
        phase: 'clone',
        detail: '克隆失败',
        errorMessage: message,
        rawLog,
      });
      showToast(message, 'error');
    }
  }

  async function attachClonedProject(taskId: string, projectPath: string) {
    updateCloneTask(taskId, {
      status: 'attaching',
      phase: 'attach',
      detail: '正在加入工作区...',
      errorMessage: undefined,
      rawLog: undefined,
      targetPath: projectPath,
    });

    try {
      const projectPayload = await createProjectFromPath(projectPath, {
        successMessage: null,
      });
      const project = projectPayload.workspace.projects.find((item) => item.id === projectPayload.projectId) ?? null;
      if (project && project.threads.length === 0) {
        await createThread(projectPayload.projectId, undefined, { showToast: false });
      }
      removeCloneTask(taskId);
      showToast('仓库已克隆并添加到工作区');
    } catch (error) {
      const message = error instanceof Error ? error.message : '加入工作区失败';
      updateCloneTask(taskId, {
        status: 'failed',
        phase: 'attach',
        detail: '加入工作区失败',
        errorMessage: message,
        rawLog: undefined,
      });
      showToast(`仓库已克隆，但加入工作区失败：${message}`, 'error');
    }
  }

  function retryCloneTask(taskId: string) {
    const task = cloneTasks.find((item) => item.id === taskId);
    if (!task) {
      return;
    }

    if (task.phase === 'attach') {
      void attachClonedProject(taskId, task.targetPath);
      return;
    }

    void runCloneTask(taskId, {
      repoUrl: task.repoUrl,
      baseDirectory: task.baseDirectory,
      folderName: task.folderName,
      targetPath: task.targetPath,
    });
  }

  async function handlePickProjectDirectory() {
    try {
      const selectedPath = await selectDirectoryPath(activeProject?.path);
      if (!selectedPath) {
        return;
      }

      await createProjectFromPath(selectedPath);
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
        return;
      }

      const thread = projects
        .flatMap((project) => project.threads)
        .find((item) => item.id === inputDialog.threadId);
      if (!thread || nextValue === thread.title) {
        setInputDialog(null);
        return;
      }

      await renameThread(inputDialog.threadId, nextValue, { showToast: false });
      setInputDialog(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error');
    }
  }

  async function confirmRemoveDialog() {
    if (!confirmDialog) {
      return;
    }

    if (confirmDialog.kind === 'remove-project') {
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
      showToast('项目已删除');
      return;
    }

    if (confirmDialog.kind !== 'remove-thread') {
      return;
    }

    const removedThreadId = confirmDialog.threadId;
    const response = await fetch(`/api/threads/${removedThreadId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      showToast(await response.text(), 'error');
      return;
    }

    const nextActiveThreadId = pickNextThreadAfterRemoval(projects, activeProjectId, activeThreadId, removedThreadId);
    setProjects((current) =>
      current.map((project) => ({
        ...project,
        threads: project.threads.filter((thread) => thread.id !== removedThreadId),
      })),
    );
    setActiveThreadId(nextActiveThreadId);
    await persistSelection(activeProjectId, nextActiveThreadId);
    setThreadDetails((current) => {
      const next = { ...current };
      delete next[removedThreadId];
      return next;
    });
    setConfirmDialog(null);
    showToast('聊天已删除');
  }

  async function handleOpenProject(project: ProjectSummary) {
    const response = await fetch(`/api/projects/${project.id}/open`, {
      method: 'POST',
    });
    if (!response.ok) {
      showToast(await response.text(), 'error');
      return;
    }
  }

  async function handleOpenProjectInEditor(project: ProjectSummary, targetId?: string) {
    const response = await fetch(`/api/projects/${project.id}/open-editor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetId }),
    });
    if (!response.ok) {
      showToast(await response.text(), 'error');
      return;
    }
  }

  async function refreshProjectGitSummary(projectId: string) {
    const response = await fetch(`/api/projects/${projectId}/git`, {
      method: 'GET',
    });
    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as ProjectGitSummary;
    applyProjectGitSummary(projectId, payload);
  }

  async function loadProjectGitBranches(projectId: string) {
    const response = await fetch(`/api/projects/${projectId}/git/branches`, {
      method: 'GET',
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }

    return (await response.json()) as GitBranchSummary[];
  }

  async function switchProjectGitBranch(projectId: string, branchName: string) {
    const response = await fetch(`/api/projects/${projectId}/git/switch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ branch: branchName }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const payload = (await response.json()) as ProjectGitSummary;
    applyProjectGitSummary(projectId, payload);
    showToast(`已切换到 ${payload.gitBranch ?? branchName}`);
  }

  function applyProjectGitSummary(projectId: string, payload: ProjectGitSummary) {
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? {
              ...project,
              gitBranch: payload.gitBranch,
              gitDiff: payload.gitDiff,
              isGitRepo: payload.isGitRepo,
              isGitWorktree: payload.isGitWorktree,
            }
          : project,
      ),
    );
  }

  async function handleCopySessionId(thread: ThreadSummary) {
    if (!thread.sessionId) {
      showToast('当前聊天还没有 session ID。', 'info');
      return;
    }

    try {
      await navigator.clipboard.writeText(thread.sessionId);
    } catch {
      showToast(`复制失败，请手动复制：${thread.sessionId}`, 'error');
    }
  }

  async function handleCopyProjectPath(project: ProjectSummary) {
    try {
      await navigator.clipboard.writeText(project.path);
    } catch {
      showToast(`复制失败，请手动复制：${project.path}`, 'error');
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
    activeProjectIdRef.current = projectId;
    setActiveProjectId(projectId);
    setActiveThreadId(threadId);
    newChatDraftRef.current = false;
    setIsNewChatDraft(false);
    await persistSelection(projectId, threadId);
  }

  async function selectProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    activeProjectIdRef.current = projectId;
    setActiveProjectId(projectId);
    setActiveThreadId(project?.threads[0]?.id ?? null);
    newChatDraftRef.current = false;
    setIsNewChatDraft(false);
    await persistSelection(projectId, project?.threads[0]?.id ?? null);
  }

  async function enterNewChatDraft(projectId: string | null) {
    activeProjectIdRef.current = projectId;
    setActiveProjectId(projectId);
    setActiveThreadId(null);
    newChatDraftRef.current = true;
    setIsNewChatDraft(true);
    await persistSelection(projectId, null);
  }

  function clearNewChatDraft() {
    newChatDraftRef.current = false;
    setIsNewChatDraft(false);
  }

  async function handlePanelStateChange(nextState: Partial<PanelState>) {
    const merged = {
      ...panelState,
      ...nextState,
    };
    setPanelState(merged);
    await fetch('/api/workspace/panel', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(nextState),
    });
  }

  const { filteredProjects, pinnedThreads, pinnedProjects, unpinnedProjects } = useMemo(
    () => buildWorkspaceSidebarSections(projects, searchQuery, panelState.sortBy),
    [panelState.sortBy, projects, searchQuery],
  );

  function toggleProjectCollapse(projectId: string) {
    setCollapsedProjects((current) => ({
      ...current,
      [projectId]: !current[projectId],
    }));
  }

  function toggleAllProjects() {
    const shouldCollapse = unpinnedProjects.some((project) => !collapsedProjects[project.id]);
    setCollapsedProjects((current) => {
      const next = { ...current };
      for (const project of unpinnedProjects) {
        next[project.id] = shouldCollapse;
      }
      return next;
    });
  }

  async function togglePinThread(threadId: string, pinned: boolean) {
    try {
      const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned }),
      });
      if (!response.ok) {
        showToast(await response.text(), 'error');
        return;
      }
      const payload = (await response.json()) as { workspace: WorkspaceBootstrap };
      syncWorkspace(payload.workspace);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '置顶失败', 'error');
    }
  }

  async function togglePinProject(projectId: string, pinned: boolean) {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned }),
      });
      if (!response.ok) {
        showToast(await response.text(), 'error');
        return;
      }
      const payload = (await response.json()) as { workspace: WorkspaceBootstrap };
      syncWorkspace(payload.workspace);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '置顶失败', 'error');
    }
  }

  function pickNextThreadAfterRemoval(
    currentProjects: ProjectSummary[],
    selectedProjectId: string | null,
    selectedThreadId: string | null,
    removedThreadId: string,
  ) {
    if (selectedThreadId !== removedThreadId) {
      return selectedThreadId;
    }

    const currentThreads = currentProjects.find((project) => project.id === selectedProjectId)?.threads ?? [];
    const removedIndex = currentThreads.findIndex((thread) => thread.id === removedThreadId);
    if (removedIndex === -1) {
      return null;
    }

    const remainingThreads = currentThreads.filter((thread) => thread.id !== removedThreadId);
    if (remainingThreads.length === 0) {
      return null;
    }

    return remainingThreads[removedIndex]?.id ?? remainingThreads[remainingThreads.length - 1]?.id ?? null;
  }

  return {
    projects,
    panelState,
    activeProjectId,
    activeThreadId,
    isNewChatDraft,
    threadDetails,
    searchOpen,
    searchQuery,
    collapsedProjects,
    cloneTasks,
    inputDialog,
    confirmDialog,
    toast,
    activeProject,
    activeThreadSummary,
    activeThread,
    filteredProjects,
    pinnedThreads,
    pinnedProjects,
    unpinnedProjects,
    setSearchOpen,
    setSearchQuery,
    setInputDialog,
    setConfirmDialog,
    setActiveProjectId,
    setActiveThreadId,
    clearNewChatDraft,
    showToast,
    dismissToast,
    setToastDetailOpen,
    syncWorkspace,
    loadWorkspace,
    createThread,
    renameThread,
    enterNewChatDraft,
    createProjectFromPath,
    openWorktreePath,
    selectDirectoryPath,
    cloneRepositoryAndAttach,
    retryCloneTask,
    removeCloneTask,
    handlePickProjectDirectory,
    submitInputDialog,
    confirmRemoveDialog,
    handleOpenProject,
    handleOpenProjectInEditor,
    handleCopyProjectPath,
    refreshProjectGitSummary,
    loadProjectGitBranches,
    switchProjectGitBranch,
    handleCopySessionId,
    selectThread,
    selectProject,
    handlePanelStateChange,
    togglePinThread,
    togglePinProject,
    toggleProjectCollapse,
    toggleAllProjects,
    openRenameProjectDialog,
    openRenameThreadDialog,
    openRemoveProjectDialog,
    openRemoveThreadDialog,
    persistThreadMetadata,
    updateThreadDetail,
    updateThreadTurn,
    appendDebug,
    appendRawEvent,
    schedulePersistThreadHistory,
  };
}

function getPersistHistoryState(
  persistHistoryStateRef: MutableRefObject<
    Map<
      string,
      {
        timerId: number | null;
        retryTimerId: number | null;
        inFlight: boolean;
        pending: boolean;
        retryCount: number;
      }
    >
  >,
  threadId: string,
) {
  const current = persistHistoryStateRef.current.get(threadId);
  if (current) {
    return current;
  }

  const next = {
    timerId: null,
    retryTimerId: null,
    inFlight: false,
    pending: false,
    retryCount: 0,
  };
  persistHistoryStateRef.current.set(threadId, next);
  return next;
}

function isTransientPersistError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return /failed to fetch|networkerror|fetch failed|HTTP (408|429|5\d\d)/i.test(error.message);
}

function flushPersistThreadHistory(
  threadId: string,
  threadDetailsRef: MutableRefObject<Record<string, ThreadDetail>>,
  persistHistoryStateRef: MutableRefObject<
    Map<
      string,
      {
        timerId: number | null;
        retryTimerId: number | null;
        inFlight: boolean;
        pending: boolean;
        retryCount: number;
      }
    >
  >,
  persistThreadHistory: (threadId: string, turns: ConversationTurn[]) => Promise<void>,
) {
  const state = getPersistHistoryState(persistHistoryStateRef, threadId);
  if (state.inFlight) {
    return;
  }

  const thread = threadDetailsRef.current[threadId];
  if (!thread) {
    state.pending = false;
    return;
  }

  state.inFlight = true;
  state.pending = false;

  void persistThreadHistory(threadId, thread.turns)
    .then(() => {
      state.retryCount = 0;
    })
    .catch((error) => {
      if (isTransientPersistError(error) && state.retryCount < PERSIST_HISTORY_MAX_RETRIES) {
        state.pending = true;
        state.retryCount += 1;
        if (state.retryTimerId !== null) {
          window.clearTimeout(state.retryTimerId);
        }
        state.retryTimerId = window.setTimeout(() => {
          state.retryTimerId = null;
          void flushPersistThreadHistory(threadId, threadDetailsRef, persistHistoryStateRef, persistThreadHistory);
        }, PERSIST_HISTORY_RETRY_DELAY_MS);
        return;
      }

      console.warn('[codem:persist-history] failed', {
        threadId,
        message: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      state.inFlight = false;
      if (state.pending && state.retryTimerId === null) {
        const scheduledState = getPersistHistoryState(persistHistoryStateRef, threadId);
        if (scheduledState.timerId !== null) {
          window.clearTimeout(scheduledState.timerId);
        }

        scheduledState.timerId = window.setTimeout(() => {
          scheduledState.timerId = null;
          void flushPersistThreadHistory(
            threadId,
            threadDetailsRef,
            persistHistoryStateRef,
            persistThreadHistory,
          );
        }, PERSIST_HISTORY_DEBOUNCE_MS);
      }
    });
}

type CloneFailure = Error & { rawLog?: string };

async function readCloneError(response: Response): Promise<CloneFailure> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const payload = (await response.json()) as { error?: string; rawLog?: string };
    const error = new Error(payload.error || '克隆仓库失败') as CloneFailure;
    error.rawLog = typeof payload.rawLog === 'string' && payload.rawLog.trim() ? payload.rawLog.trim() : undefined;
    return error;
  }

  return new Error(await response.text()) as CloneFailure;
}

function isCloneFailure(error: unknown): error is CloneFailure {
  return error instanceof Error;
}

function truncateWorkspaceLogText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  const markerLength = LOG_TRUNCATION_MARKER.length;
  if (maxChars <= markerLength + 32) {
    return `${LOG_TRUNCATION_MARKER.trim()}${value.slice(-(maxChars - markerLength))}`;
  }

  const headLength = Math.floor((maxChars - markerLength) * 0.5);
  const tailLength = Math.max(0, maxChars - markerLength - headLength);
  return `${value.slice(0, headLength)}${LOG_TRUNCATION_MARKER}${value.slice(-tailLength)}`;
}

function hasOwn<T extends object>(value: T, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
