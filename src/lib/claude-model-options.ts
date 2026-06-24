import { DEFAULT_MODEL_VALUE } from '../constants';
import type { ClaudeModelOption, ModelSettings } from '../types';

type ModelCapability = ModelSettings['modelCapabilities'][number];

export function mergeModelOptions(
  configuredModels: ClaudeModelOption[],
  customModels: ModelSettings['customModels'],
  modelCapabilities: ModelSettings['modelCapabilities'] = [],
) {
  const result: ClaudeModelOption[] = [];
  const seenIds = new Set<string>();
  const capabilityByModelId = new Map(modelCapabilities.map((capability) => [capability.modelId, capability]));
  const push = (option: ClaudeModelOption) => {
    const id = option.id.trim();
    if (!id || seenIds.has(id)) {
      return;
    }

    seenIds.add(id);
    result.push(applyModelCapability({ ...option, id }, capabilityByModelId));
  };

  if (!configuredModels.some((option) => option.id === DEFAULT_MODEL_VALUE)) {
    push({
      id: DEFAULT_MODEL_VALUE,
      label: '默认',
      description: '使用当前 Claude Code 默认模型，不传 --model',
      kind: 'default',
    });
  }

  configuredModels.forEach(push);
  customModels.forEach((item) => {
    push({
      id: item.id,
      label: item.label || item.id,
      description: item.description || '自定义模型',
      model: item.id,
      kind: 'custom',
    });
  });

  return result;
}

function applyModelCapability(
  option: ClaudeModelOption,
  capabilityByModelId: Map<string, ModelCapability>,
): ClaudeModelOption {
  const capability = capabilityByModelId.get(option.id) ?? (option.model ? capabilityByModelId.get(option.model) : undefined);
  if (!capability) {
    return option;
  }

  const next: ClaudeModelOption = {
    ...option,
    ...(capability.contextWindowTokens !== undefined ? { contextWindowTokens: capability.contextWindowTokens } : {}),
  };

  if (capability.supportsContext1m === true) {
    if (capability.context1mModel) {
      next.supportsContext1m = true;
      next.context1mModel = capability.context1mModel;
    } else {
      next.supportsContext1m = false;
      delete next.context1mModel;
    }
  } else if (capability.supportsContext1m === false) {
    next.supportsContext1m = false;
    delete next.context1mModel;
  }

  return next;
}
