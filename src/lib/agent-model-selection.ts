import { DEFAULT_MODEL_VALUE } from '../constants.js';
import type { AgentModelCatalog, AgentModelOption } from '../types.js';

export type ResolvedAgentModelSelection = {
  modelId: string;
  reasoningEffort: string;
  selectedModel?: AgentModelOption;
  staleModelId?: string;
  staleReasoningEffort?: string;
};

export function getAgentModelForSelection(
  catalog: AgentModelCatalog,
  modelId: string,
): AgentModelOption | undefined {
  if (modelId !== DEFAULT_MODEL_VALUE) {
    return catalog.models.find((model) => model.id === modelId);
  }
  return catalog.models.find((model) => model.id === catalog.defaultModelId)
    ?? catalog.models.find((model) => model.isDefault);
}

export function defaultReasoningEffortForSelection(
  catalog: AgentModelCatalog,
  modelId: string,
) {
  const model = getAgentModelForSelection(catalog, modelId);
  if (!model) {
    return '';
  }
  const effortIds = new Set(model.supportedReasoningEfforts.map((effort) => effort.id));
  if (model.defaultReasoningEffort && effortIds.has(model.defaultReasoningEffort)) {
    return model.defaultReasoningEffort;
  }
  return model.supportedReasoningEfforts[0]?.id ?? '';
}

export function resolveAgentModelSelection(
  catalog: AgentModelCatalog,
  savedModelId?: string,
  savedReasoningEffort?: string,
): ResolvedAgentModelSelection {
  const normalizedModelId = savedModelId?.trim() || '';
  const explicitModel = normalizedModelId
    ? catalog.models.find((model) => model.id === normalizedModelId)
    : undefined;
  const staleModelId = normalizedModelId && !explicitModel ? normalizedModelId : undefined;
  const modelId = explicitModel?.id ?? DEFAULT_MODEL_VALUE;
  const selectedModel = explicitModel ?? getAgentModelForSelection(catalog, DEFAULT_MODEL_VALUE);
  const normalizedEffort = savedReasoningEffort?.trim() || '';
  const supportedEfforts = new Set(
    selectedModel?.supportedReasoningEfforts.map((effort) => effort.id) ?? [],
  );
  const reasoningEffort = normalizedEffort && supportedEfforts.has(normalizedEffort)
    ? normalizedEffort
    : defaultReasoningEffortForSelection(catalog, modelId);

  return {
    modelId,
    reasoningEffort,
    ...(selectedModel ? { selectedModel } : {}),
    ...(staleModelId ? { staleModelId } : {}),
    ...(normalizedEffort && !supportedEfforts.has(normalizedEffort)
      ? { staleReasoningEffort: normalizedEffort }
      : {}),
  };
}
