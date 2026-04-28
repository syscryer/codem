import { DEFAULT_MODEL_VALUE } from '../constants';
import type { ClaudeModelOption, PermissionMode } from '../types';

export function permissionLabel(mode: PermissionMode) {
  const labels: Record<PermissionMode, string> = {
    default: '默认',
    plan: '计划模式',
    acceptEdits: '接受编辑',
    auto: '自动执行',
    dontAsk: '无需确认',
    bypassPermissions: '完全访问',
  };

  return labels[mode];
}

export function modelLabel(model: ClaudeModelOption | string) {
  if (typeof model === 'string') {
    return model === DEFAULT_MODEL_VALUE ? '默认' : model;
  }

  return model.label || model.model || model.id;
}

export function modelTriggerLabel(modelId: string, models: ClaudeModelOption[]) {
  const selected = models.find((item) => item.id === modelId);
  if (selected) {
    return modelLabel(selected);
  }

  return modelId === DEFAULT_MODEL_VALUE ? '默认' : modelId;
}
