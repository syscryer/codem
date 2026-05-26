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

    return shouldFallBackToDefaultModel(normalized) ? DEFAULT_MODEL_VALUE : normalized;
  }

  const fallback = fallbackModelId?.trim() || DEFAULT_MODEL_VALUE;
  return models.some((option) => option.id === fallback || option.context1mModel === fallback)
    ? fallback
    : DEFAULT_MODEL_VALUE;
}

function isClaudeSlotModelId(modelId: string) {
  const normalized = modelId.toLowerCase();
  return normalized === 'opusplan' || normalized === 'opus-1m' || (CLAUDE_MODEL_SLOT_VALUES as readonly string[]).includes(normalized);
}

function shouldFallBackToDefaultModel(modelId: string) {
  return isClaudeSlotModelId(modelId) || /^claude-/i.test(modelId);
}
