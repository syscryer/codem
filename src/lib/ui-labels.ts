import { DEFAULT_MODEL_VALUE } from '../constants';
import type { PermissionMode } from '../types';

export function permissionLabel(mode: PermissionMode) {
  const labels: Record<PermissionMode, string> = {
    default: '默认权限',
    plan: '计划模式',
    acceptEdits: '接受编辑',
    auto: '自动执行',
    dontAsk: '无需确认',
    bypassPermissions: '完全访问权限',
  };

  return labels[mode];
}

export function modelLabel(model: string) {
  return model === DEFAULT_MODEL_VALUE ? '默认' : model;
}

export function modelTriggerLabel(model: string, models: string[]) {
  if (model !== DEFAULT_MODEL_VALUE) {
    return modelLabel(model);
  }

  return models.find((item) => item !== DEFAULT_MODEL_VALUE) ?? '默认';
}
