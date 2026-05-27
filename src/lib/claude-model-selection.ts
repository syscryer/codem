import { CLAUDE_MODEL_SLOT_VALUES, DEFAULT_MODEL_VALUE } from '../constants';
import type { ClaudeModelOption } from '../types';

export function hasClaudeContext1mOptions(models: ClaudeModelOption[]) {
  return models.some((option) => option.supportsContext1m === true && Boolean(option.context1mModel?.trim()));
}

export function resolveInitialClaudeModelId(
  savedModel: string | undefined,
  models: ClaudeModelOption[],
  fallbackModelId: string,
) {
  const normalized = savedModel?.trim();
  if (normalized) {
    const exact = models.find((option) => option.id === normalized);
    if (exact) {
      return exact.id;
    }

    const byModel = models.filter((option) => option.model === normalized);
    if (byModel.length === 1) {
      return byModel[0].id;
    }

    if (byModel.length > 1) {
      return DEFAULT_MODEL_VALUE;
    }

    const byContext1mModel = models.find((option) => option.context1mModel === normalized);
    if (byContext1mModel) {
      return normalized;
    }

    return shouldFallBackToDefaultModel(normalized) || isBareProviderModelId(normalized)
      ? DEFAULT_MODEL_VALUE
      : normalized;
  }

  const fallback = fallbackModelId?.trim() || DEFAULT_MODEL_VALUE;
  return models.some((option) => option.id === fallback || option.context1mModel === fallback)
    ? fallback
    : DEFAULT_MODEL_VALUE;
}

export type RunModelSelection = {
  selectedModelId: string;
  requestModel?: string;
  staleProviderModel: boolean;
};

export function resolveRunModelSelection(
  requestedModelId: string | undefined,
  latestModels: ClaudeModelOption[],
  fallbackModelId: string,
  previousModels: ClaudeModelOption[] = [],
): RunModelSelection {
  const normalized = requestedModelId?.trim() || fallbackModelId || DEFAULT_MODEL_VALUE;
  let selectedModelId = resolveInitialClaudeModelId(normalized, latestModels, fallbackModelId);
  let staleProviderModel = false;

  if (selectedModelId === normalized && shouldTreatAsStaleProviderModel(normalized, latestModels, previousModels)) {
    selectedModelId = DEFAULT_MODEL_VALUE;
    staleProviderModel = true;
  } else if (normalized !== DEFAULT_MODEL_VALUE && selectedModelId === DEFAULT_MODEL_VALUE) {
    staleProviderModel = !modelExistsInOptions(normalized, latestModels);
  }

  return {
    selectedModelId,
    requestModel: resolveRequestClaudeModel(findClaudeModelOption(latestModels, selectedModelId), selectedModelId),
    staleProviderModel,
  };
}

export function resolveRequestClaudeModel(option: ClaudeModelOption | undefined, modelId: string) {
  if (!option) {
    return modelId === DEFAULT_MODEL_VALUE ? undefined : modelId;
  }

  if (option.id === DEFAULT_MODEL_VALUE || option.kind === 'default') {
    return undefined;
  }

  return option.model || option.id;
}

function findClaudeModelOption(models: ClaudeModelOption[], modelId: string) {
  return models.find((option) => option.id === modelId);
}

function shouldTreatAsStaleProviderModel(
  modelId: string,
  latestModels: ClaudeModelOption[],
  previousModels: ClaudeModelOption[],
) {
  if (modelId === DEFAULT_MODEL_VALUE || modelExistsInOptions(modelId, latestModels)) {
    return false;
  }

  if (previousModels.some((option) => option.kind === 'custom' && (option.id === modelId || option.model === modelId))) {
    return false;
  }

  const previousMatches = previousModels.filter((option) => option.model === modelId || option.context1mModel === modelId);
  return previousMatches.some((option) => option.kind === 'default') || previousMatches.length > 1;
}

function modelExistsInOptions(modelId: string, models: ClaudeModelOption[]) {
  return models.some((option) => option.id === modelId || option.model === modelId || option.context1mModel === modelId);
}

function isBareProviderModelId(modelId: string) {
  return !/[/:]/.test(modelId);
}

function isClaudeSlotModelId(modelId: string) {
  const normalized = modelId.toLowerCase();
  return normalized === 'opusplan' || normalized === 'opus-1m' || (CLAUDE_MODEL_SLOT_VALUES as readonly string[]).includes(normalized);
}

function shouldFallBackToDefaultModel(modelId: string) {
  return isClaudeSlotModelId(modelId) || /^claude-/i.test(modelId);
}
