import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_PANEL_STATE } from '../constants';
import { createThreadDetail, metricsFromTurn, normalizeTurnsForPersist, repairConversationTurn } from '../lib/conversation';
import type {
  ConfirmDialogState,
  ConversationTurn,
  DebugEvent,
  InputDialogState,
  PanelState,
  ProjectSummary,
  ThreadDetail,
  ThreadHistoryPayload,
  ThreadSummary,
  ToastState,
  WorkspaceBootstrap,
} from '../types';

type ThreadMetadataPatch = {
  sessionId?: string;
  workingDirectory?: string;
  model?: string;
  permissionMode?: string;
};

export function useWorkspaceState() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [panelState, setPanelState] = useState<PanelState>(EMPTY_PANEL_STATE);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threadDetails, setThreadDetails] = useState<Record<string, ThreadDetail>>({});
  const [debugOpen, setDebugOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [inputDialog, setInputDialog] = useState<InputDialogState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const threadDetailsRef = useRef<Record<string, ThreadDetail>>({});

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const activeThreadSummary = useMemo(
    () => projects.flatMap((project) => project.threads).find((thread) => thread.id === activeThreadId) ?? null,
    [projects, activeThreadId],
  );
  const activeThread = activeThreadSummary
    ? threadDetails[activeThreadSummary.id] ?? createThreadDetail(activeThreadSummary)
    : null;

  useEffect(() => {
    void loadWorkspace();
  }, []);

  useEffect(() => {
    if (activeThreadId) {
      void loadThreadHistory(activeThreadId);
    }
  }, [activeThreadId]);

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
      title: '移除项目',
      description: `移除项目“${project.name}”后，只会删除 CodeM 的索引与聊天记录，不会删除磁盘目录。`,
      confirmLabel: '移除项目',
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

    const currentDetail = threadDetailsRef.current[threadId];
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
            // prefer in-memory turn if it's still running, otherwise use repaired (has fresh metrics)
            return current && (current.status === 'running' || current.status === 'pending') ? current : turn;
          }),
          ...existing.turns.filter((turn) => !repairedTurnIds.has(turn.id)),
        ];

        return {
          ...current,
          [payload.threadId]: {
            ...existing,
            turns: mergedTurns,
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
      body: JSON.stringify({ turns: normalizeTurnsForPersist(turns) }),
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
    }, 80);
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

      return {
        ...current,
        [threadId]: updater(existing),
      };
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

  function appendDebug(threadId: string, event: Omit<DebugEvent, 'id'>) {
    startTransition(() => {
      setThreadDetails((current) => {
        const existing = current[threadId];
        if (!existing) {
          return current;
        }

        return {
          ...current,
          [threadId]: {
            ...existing,
            debugEvents: [...existing.debugEvents, { ...event, id: crypto.randomUUID() }].slice(-220),
          },
        };
      });
    });
  }

  function appendRawEvent(threadId: string, line: string) {
    startTransition(() => {
      setThreadDetails((current) => {
        const existing = current[threadId];
        if (!existing) {
          return current;
        }

        return {
          ...current,
          [threadId]: {
            ...existing,
            rawEvents: [...existing.rawEvents, line].slice(-220),
          },
        };
      });
    });
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

  async function createThread(projectId: string) {
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
    const createdThread =
      payload.workspace.projects
        .find((project) => project.id === projectId)
        ?.threads.find((thread) => thread.id === payload.threadId) ?? null;

    syncWorkspace(payload.workspace);
    setActiveProjectId(projectId);
    setActiveThreadId(payload.threadId);
    await persistSelection(projectId, payload.threadId);
    showToast('已新建聊天');
    return createdThread;
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
          initialPath: activeProject?.path || undefined,
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
      showToast('项目已移除');
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

  async function handleOpenProjectInEditor(project: ProjectSummary) {
    const response = await fetch(`/api/projects/${project.id}/open-editor`, {
      method: 'POST',
    });
    if (!response.ok) {
      showToast(await response.text(), 'error');
      return;
    }

    showToast('已请求编辑器打开项目');
  }

  async function refreshProjectGitSummary(projectId: string) {
    const response = await fetch(`/api/projects/${projectId}/git`, {
      method: 'GET',
    });
    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as Pick<ProjectSummary, 'gitBranch' | 'gitDiff' | 'isGitRepo'>;
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? {
              ...project,
              gitBranch: payload.gitBranch,
              gitDiff: payload.gitDiff,
              isGitRepo: payload.isGitRepo,
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
    await fetch('/api/workspace/panel', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(nextState),
    });
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
    threadDetails,
    debugOpen,
    searchOpen,
    searchQuery,
    collapsedProjects,
    inputDialog,
    confirmDialog,
    toast,
    activeProject,
    activeThreadSummary,
    activeThread,
    filteredProjects,
    setDebugOpen,
    setSearchOpen,
    setSearchQuery,
    setInputDialog,
    setConfirmDialog,
    setActiveProjectId,
    setActiveThreadId,
    showToast,
    syncWorkspace,
    loadWorkspace,
    createThread,
    handlePickProjectDirectory,
    submitInputDialog,
    confirmRemoveDialog,
    handleOpenProject,
    handleOpenProjectInEditor,
    refreshProjectGitSummary,
    handleCopySessionId,
    selectThread,
    selectProject,
    handlePanelStateChange,
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
