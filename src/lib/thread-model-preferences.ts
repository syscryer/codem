import { DEFAULT_MODEL_VALUE } from '../constants.js';
import type { ThreadSummary } from '../types.js';

export type ThreadModelPreferences = Record<string, string>;

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
  if (currentEffort && !preferences[currentModelKey]) {
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

function normalizeStoredReasoningEffort(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized && normalized !== 'default' ? normalized : undefined;
}
