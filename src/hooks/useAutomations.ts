import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_MODEL_VALUE } from '../constants';
import {
  AutomationRequestError,
  claimScheduledAutomation,
  createAutomation,
  createManualAutomationRun,
  deleteAutomation,
  fetchAutomationBootstrap,
  updateAutomation,
  updateAutomationRun,
  type ClaimedAutomationRun,
} from '../lib/automation-api';
import { calculateNextAutomationRun } from '../lib/automation-schedule';
import { resolveChatRuntimeKind } from '../lib/agent-provider-registry';
import type { ThreadActivityNotice } from '../lib/thread-activity-notices';
import type {
  AutomationDefinition,
  AutomationRun,
  AutomationSaveInput,
  PermissionMode,
  ProjectSummary,
  ThreadSummary,
} from '../types';

const AUTOMATION_POLL_INTERVAL_MS = 30_000;
const AUTOMATION_INITIAL_POLL_DELAY_MS = 1_000;

type CreateAutomationThread = (
  projectId: string,
  title?: string,
  options?: {
    providerId?: string;
    permissionMode?: PermissionMode;
    model?: string;
    reasoningEffort?: string;
    channelId?: string;
    activate?: boolean;
  },
) => Promise<ThreadSummary | null>;

type SubmitAutomationPrompt = (
  thread: ThreadSummary,
  prompt: string,
  options: {
    permissionMode: PermissionMode;
    model?: string;
    reasoningEffort?: string;
  },
  ) => boolean | Promise<boolean>;

type UseAutomationsArgs = {
  projects: ProjectSummary[];
  createThread: CreateAutomationThread;
  submitClaudePrompt: SubmitAutomationPrompt;
  submitAgentPrompt: SubmitAutomationPrompt;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

export function useAutomations({
  projects,
  createThread,
  submitClaudePrompt,
  submitAgentPrompt,
  showToast,
}: UseAutomationsArgs) {
  const [automations, setAutomations] = useState<AutomationDefinition[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const automationsRef = useRef<AutomationDefinition[]>([]);
  const runsRef = useRef<AutomationRun[]>([]);
  const projectsRef = useRef(projects);
  const activeRunByThreadIdRef = useRef(new Map<string, string>());
  const claimInFlightRef = useRef(new Set<string>());
  const schedulerInFlightRef = useRef(false);
  const claimDueRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  const applyAutomations = useCallback((next: AutomationDefinition[]) => {
    automationsRef.current = next;
    setAutomations(next);
  }, []);

  const applyAutomation = useCallback((next: AutomationDefinition) => {
    applyAutomations([
      next,
      ...automationsRef.current.filter((automation) => automation.id !== next.id),
    ]);
  }, [applyAutomations]);

  const applyRun = useCallback((next: AutomationRun) => {
    runsRef.current = [
      next,
      ...runsRef.current.filter((run) => run.id !== next.id),
    ];
    setRuns((current) => [
      next,
      ...current.filter((run) => run.id !== next.id),
    ]);
    if (next.threadId && isActiveRunStatus(next.status)) {
      activeRunByThreadIdRef.current.set(next.threadId, next.id);
    } else if (next.threadId) {
      activeRunByThreadIdRef.current.delete(next.threadId);
    }
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const bootstrap = await fetchAutomationBootstrap(signal);
      if (signal?.aborted) {
        return null;
      }
      applyAutomations(bootstrap.automations);
      runsRef.current = bootstrap.runs;
      setRuns(bootstrap.runs);
      activeRunByThreadIdRef.current.clear();
      for (const run of bootstrap.runs) {
        if (run.threadId && isActiveRunStatus(run.status)) {
          activeRunByThreadIdRef.current.set(run.threadId, run.id);
        }
      }
      setError('');
      return bootstrap;
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') {
        return null;
      }
      setError(errorMessage(requestError, '读取自动化失败'));
      return null;
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [applyAutomations]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const markRun = useCallback(async (
    run: AutomationRun,
    status: 'running' | 'waiting' | 'completed' | 'failed' | 'stopped',
    options?: { threadId?: string; error?: string },
  ) => {
    const updated = await updateAutomationRun(run.id, {
      status,
      ...(options?.threadId ? { threadId: options.threadId } : {}),
      ...(options?.error ? { error: options.error } : {}),
      nowMs: Date.now(),
    });
    applyRun(updated);
    return updated;
  }, [applyRun]);

  const executeClaimedRun = useCallback(async ({ automation, run }: ClaimedAutomationRun) => {
    applyAutomation(automation);
    applyRun(run);
    let thread: ThreadSummary | null = null;
    try {
      const project = projectsRef.current.find((item) => item.id === automation.projectId);
      if (!project) {
        throw new Error('自动化关联的项目已不存在');
      }
      const runtimeKind = resolveChatRuntimeKind(automation.providerId);
      if (runtimeKind !== 'claude' && runtimeKind !== 'generic') {
        throw new Error('当前 Agent 尚未接入任务运行');
      }
      thread = await createThread(project.id, automation.name, {
        providerId: automation.providerId,
        permissionMode: automation.permissionMode,
        model: automation.model || DEFAULT_MODEL_VALUE,
        reasoningEffort: automation.reasoningEffort,
        channelId: automation.channelId,
        activate: false,
      });
      if (!thread) {
        throw new Error('创建自动化会话失败');
      }
      const runningRun = await markRun(run, 'running', { threadId: thread.id });
      activeRunByThreadIdRef.current.set(thread.id, runningRun.id);
      const submitted = await (runtimeKind === 'claude'
        ? submitClaudePrompt(thread, automation.prompt, {
            permissionMode: automation.permissionMode,
            model: automation.model,
            reasoningEffort: automation.reasoningEffort,
          })
        : submitAgentPrompt(thread, automation.prompt, {
            permissionMode: automation.permissionMode,
            model: automation.model,
            reasoningEffort: automation.reasoningEffort,
          }));
      if (!submitted) {
        throw new Error('Agent 未能启动自动化任务');
      }
      return runningRun;
    } catch (runError) {
      const message = errorMessage(runError, '自动化运行失败');
      try {
        await markRun(run, 'failed', {
          ...(thread ? { threadId: thread.id } : {}),
          error: message,
        });
      } catch (updateError) {
        setError(errorMessage(updateError, message));
      }
      throw runError;
    }
  }, [applyAutomation, applyRun, createThread, markRun, submitAgentPrompt, submitClaudePrompt]);

  const save = useCallback(async (input: AutomationSaveInput, automationId?: string) => {
    const busyId = automationId || '__new__';
    setSavingId(busyId);
    try {
      const nowMs = Date.now();
      const payload: AutomationSaveInput = {
        ...input,
        nextRunAtMs: input.enabled
          ? calculateNextAutomationRun(input.schedule, nowMs)
          : undefined,
      };
      const saved = automationId
        ? await updateAutomation(automationId, payload)
        : await createAutomation(payload);
      applyAutomation(saved);
      setError('');
      showToast(automationId ? '自动化已保存' : '自动化已创建', 'success');
      return saved;
    } catch (saveError) {
      const message = errorMessage(saveError, '保存自动化失败');
      setError(message);
      showToast(message, 'error');
      return null;
    } finally {
      setSavingId(null);
    }
  }, [applyAutomation, showToast]);

  const remove = useCallback(async (automationId: string) => {
    setDeletingId(automationId);
    try {
      await deleteAutomation(automationId);
      applyAutomations(automationsRef.current.filter((automation) => automation.id !== automationId));
      runsRef.current = runsRef.current.filter((run) => run.automationId !== automationId);
      setRuns(runsRef.current);
      setError('');
      showToast('自动化已删除', 'success');
      return true;
    } catch (deleteError) {
      const message = errorMessage(deleteError, '删除自动化失败');
      setError(message);
      showToast(message, 'error');
      return false;
    } finally {
      setDeletingId(null);
    }
  }, [applyAutomations, showToast]);

  const runNow = useCallback(async (automationId: string) => {
    if (claimInFlightRef.current.has(automationId)) {
      return null;
    }
    claimInFlightRef.current.add(automationId);
    setStartingId(automationId);
    try {
      const claimed = await createManualAutomationRun(automationId, Date.now());
      await executeClaimedRun(claimed);
      setError('');
      showToast('自动化已在后台启动', 'success');
      return claimed.run;
    } catch (runError) {
      const message = errorMessage(runError, '启动自动化失败');
      setError(message);
      showToast(message, 'error');
      return null;
    } finally {
      claimInFlightRef.current.delete(automationId);
      setStartingId(null);
    }
  }, [executeClaimedRun, showToast]);

  const claimDueAutomations = useCallback(async () => {
    if (schedulerInFlightRef.current) {
      return;
    }
    schedulerInFlightRef.current = true;
    try {
      const nowMs = Date.now();
      const dueAutomations = automationsRef.current.filter((automation) => (
        automation.enabled
        && typeof automation.nextRunAtMs === 'number'
        && automation.nextRunAtMs <= nowMs
        && !claimInFlightRef.current.has(automation.id)
      ));
      for (const automation of dueAutomations) {
        claimInFlightRef.current.add(automation.id);
        try {
          const nextRunAtMs = calculateNextAutomationRun(automation.schedule, nowMs);
          const claimed = await claimScheduledAutomation(automation.id, nowMs, nextRunAtMs);
          await executeClaimedRun(claimed);
        } catch (claimError) {
          if (!(claimError instanceof AutomationRequestError && claimError.status === 409)) {
            setError(errorMessage(claimError, '自动化调度失败'));
          }
        } finally {
          claimInFlightRef.current.delete(automation.id);
        }
      }
    } finally {
      schedulerInFlightRef.current = false;
    }
  }, [executeClaimedRun]);

  claimDueRef.current = claimDueAutomations;

  useEffect(() => {
    if (loading) {
      return;
    }
    let cancelled = false;
    let timerId: number | null = null;

    const scheduleNext = (delayMs: number) => {
      if (cancelled) {
        return;
      }
      timerId = window.setTimeout(async () => {
        timerId = null;
        await claimDueRef.current();
        scheduleNext(AUTOMATION_POLL_INTERVAL_MS);
      }, delayMs);
    };

    scheduleNext(AUTOMATION_INITIAL_POLL_DELAY_MS);
    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [loading]);

  const handleThreadActivityNotice = useCallback((notice: ThreadActivityNotice) => {
    const runId = activeRunByThreadIdRef.current.get(notice.threadId);
    if (!runId) {
      return;
    }
    const run = runsRef.current.find((item) => item.id === runId);
    if (!run) {
      return;
    }
    const status = notice.kind === 'approval'
      ? 'waiting'
      : notice.kind === 'completed'
        ? 'completed'
        : 'failed';
    void markRun(run, status, {
      threadId: notice.threadId,
      ...(notice.kind === 'failed' ? { error: notice.title } : {}),
    }).catch((noticeError) => {
      setError(errorMessage(noticeError, '更新自动化运行状态失败'));
    });
  }, [markRun]);

  return {
    automations,
    runs,
    loading,
    error,
    savingId,
    deletingId,
    startingId,
    refresh,
    save,
    remove,
    runNow,
    handleThreadActivityNotice,
  };
}

function isActiveRunStatus(status: AutomationRun['status']) {
  return status === 'claimed' || status === 'running' || status === 'waiting';
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}
