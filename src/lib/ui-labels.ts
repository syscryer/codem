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

export function modelMenuPrimaryLabel(model: ClaudeModelOption) {
  return model.model || model.label || model.id;
}

export function modelTriggerLabel(modelId: string, models: ClaudeModelOption[]) {
  const selected = models.find((item) => item.id === modelId);
  if (selected) {
    return modelMenuPrimaryLabel(selected);
  }

  const context1mBase = models.find((item) => item.context1mModel === modelId);
  if (context1mBase) {
    return modelId;
  }

  return modelId === DEFAULT_MODEL_VALUE ? '默认' : modelId;
}

export function modelContext1mMenuActionLabel(active: boolean) {
  return active ? '关闭 1M' : '开启 1M';
}

export function modelMenuDescriptionLabel(model: ClaudeModelOption) {
  if (model.id === DEFAULT_MODEL_VALUE || model.kind === 'default') {
    return '跟随 Claude Code 默认';
  }

  if (model.kind === 'slot') {
    const summary = stripConfiguredModelPrefix(model.description || '');
    return [model.label || '', summary].filter(Boolean).join(' · ');
  }

  return model.description || '';
}

function stripConfiguredModelPrefix(description: string) {
  return description.replace(/^当前映射：[^·]+(?:\s*·\s*)?/, '').trim();
}
