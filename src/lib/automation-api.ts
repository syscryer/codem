import { normalizeAutomationSchedule } from './automation-schedule.js';
import type {
  AutomationBootstrap,
  AutomationDefinition,
  AutomationRun,
  AutomationSaveInput,
} from '../types.js';

export type ClaimedAutomationRun = {
  automation: AutomationDefinition;
  run: AutomationRun;
};

export class AutomationRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AutomationRequestError';
    this.status = status;
  }
}

export async function fetchAutomationBootstrap(signal?: AbortSignal): Promise<AutomationBootstrap> {
  const payload = await requestJson<AutomationBootstrap>('/api/automations/bootstrap', { signal });
  return {
    automations: payload.automations.map(normalizeAutomation),
    runs: payload.runs,
  };
}

export async function createAutomation(input: AutomationSaveInput) {
  return normalizeAutomation(await requestJson<AutomationDefinition>('/api/automations', jsonRequest('POST', input)));
}

export async function updateAutomation(id: string, input: AutomationSaveInput) {
  return normalizeAutomation(await requestJson<AutomationDefinition>(
    `/api/automations/${encodeURIComponent(id)}`,
    jsonRequest('PUT', input),
  ));
}

export async function deleteAutomation(id: string) {
  const response = await fetch(`/api/automations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new AutomationRequestError(await readError(response, '删除自动化失败'), response.status);
  }
}

export async function claimScheduledAutomation(id: string, nowMs: number, nextRunAtMs: number) {
  const payload = await requestJson<ClaimedAutomationRun>(
    `/api/automations/${encodeURIComponent(id)}/claim`,
    jsonRequest('POST', { nowMs, nextRunAtMs }),
  );
  return { ...payload, automation: normalizeAutomation(payload.automation) };
}

export async function createManualAutomationRun(id: string, nowMs: number) {
  const payload = await requestJson<ClaimedAutomationRun>(
    `/api/automations/${encodeURIComponent(id)}/runs`,
    jsonRequest('POST', { nowMs }),
  );
  return { ...payload, automation: normalizeAutomation(payload.automation) };
}

export async function updateAutomationRun(
  runId: string,
  update: {
    status: 'running' | 'waiting' | 'completed' | 'failed' | 'stopped';
    threadId?: string;
    error?: string;
    nowMs?: number;
  },
) {
  return requestJson<AutomationRun>(
    `/api/automation-runs/${encodeURIComponent(runId)}`,
    jsonRequest('PATCH', update),
  );
}

function normalizeAutomation(automation: AutomationDefinition): AutomationDefinition {
  return {
    ...automation,
    schedule: normalizeAutomationSchedule(automation.schedule),
  };
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new AutomationRequestError(await readError(response, '自动化请求失败'), response.status);
  }
  return await response.json() as T;
}

async function readError(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error.trim();
    }
  } catch {}
  return fallback;
}
