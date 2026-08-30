import { DEFAULT_MODEL_VALUE } from '../constants.js';
import type { ThreadSummary } from '../types.js';

export type ThreadModelPreferences = Record<string, string>;

export function isModelSelectionChannelReady(
  currentChannelId: string,
  targetChannelId: string,
) {
  return currentChannelId === targetChannelId;
}

export function threadModelPreferenceKey(modelId?: string | null) {
  const normalized = modelId?.trim();
  return normalized && normalized !== DEFAULT_MODEL_VALUE ? normalized : DEFAULT_MODEL_VALUE;
}

export function collectThreadModelPreferences(
  thread?: Pick<ThreadSummary, 'model' | 'reasoningEffort' | 'modelPreferences'> | null,
): ThreadModelPreferences {
  const preferences: ThreadModelPreferences = {};
  for (const [modelId, effort] of Object.entries(thread?.modelPreferences ?? {})) {
    const normalizedModelId = modelId.trim();
    const normalizedEffort = normalizeStoredReasoningEffort(effort);
    if (normalizedModelId && normalizedEffort) {
      preferences[normalizedModelId] = normalizedEffort;
    }
  }

  const currentEffort = normalizeStoredReasoningEffort(thread?.reasoningEffort);
  const currentModelKey = threadModelPreferenceKey(thread?.model);
  // The current thread effort is the source of truth for the active model.
  // Stale per-model preferences must not override a newer saved selection.
  if (currentEffort) {
    preferences[currentModelKey] = currentEffort;
  }
  return preferences;
}

export function reasoningEffortForThreadModel(
  preferences: ThreadModelPreferences,
  modelId?: string | null,
) {
  return preferences[threadModelPreferenceKey(modelId)];
}

export function updateThreadModelReasoningEffort(
  preferences: ThreadModelPreferences,
  modelId: string | null | undefined,
  reasoningEffort: string | null | undefined,
): ThreadModelPreferences {
  const next = { ...preferences };
  const key = threadModelPreferenceKey(modelId);
  const normalizedEffort = normalizeStoredReasoningEffort(reasoningEffort);
  if (normalizedEffort) {
    next[key] = normalizedEffort;
  } else {
    delete next[key];
  }
  return next;
}

export type ThreadMetadataPreferencePatch = {
  model?: string | null;
  reasoningEffort?: string | null;
};

export function nextThreadModelPreferences(
  thread: Pick<ThreadSummary, 'model' | 'reasoningEffort' | 'modelPreferences'>,
  payload: ThreadMetadataPreferencePatch,
  options?: { channelChanged?: boolean },
): ThreadModelPreferences | undefined {
  if (options?.channelChanged) {
    return thread.modelPreferences;
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'model')
    && !Object.prototype.hasOwnProperty.call(payload, 'reasoningEffort')) {
    return thread.modelPreferences;
  }

  const preferences = collectThreadModelPreferences(thread);
  const nextModel = Object.prototype.hasOwnProperty.call(payload, 'model')
    ? payload.model
    : thread.model;
  const nextEffort = Object.prototype.hasOwnProperty.call(payload, 'reasoningEffort')
    ? payload.reasoningEffort
    : reasoningEffortForThreadModel(preferences, nextModel);
  const nextPreferences = updateThreadModelReasoningEffort(preferences, nextModel, nextEffort);
  return Object.keys(nextPreferences).length > 0 ? nextPreferences : undefined;
}

export function shouldKeepPendingReasoningEffort(
  pending: { model: string; reasoningEffort: string },
  restored: {
    resolvedEffort: string;
    threadEffort?: string | null;
    threadPreferences?: ThreadModelPreferences;
  },
) {
  if (pending.reasoningEffort !== restored.resolvedEffort) {
    return true;
  }
  if (restored.threadEffort === pending.reasoningEffort) {
    return false;
  }
  return reasoningEffortForThreadModel(
    restored.threadPreferences ?? {},
    pending.model,
  ) !== pending.reasoningEffort;
}

function normalizeStoredReasoningEffort(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized && normalized !== 'default' ? normalized : undefined;
}
