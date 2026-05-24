import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_MODEL_VALUE } from '../constants';
import type { ClaudeModelOption } from '../types';
import { modelContext1mMenuActionLabel, modelMenuDescriptionLabel, modelMenuPrimaryLabel, modelTriggerLabel } from './ui-labels';

test('modelContext1mMenuActionLabel describes the 1M menu action clearly', () => {
  assert.equal(modelContext1mMenuActionLabel(false), '开启 1M');
  assert.equal(modelContext1mMenuActionLabel(true), '关闭 1M');
});

test('modelTriggerLabel shows the configured default model when it is available', () => {
  const models: ClaudeModelOption[] = [
    {
      id: DEFAULT_MODEL_VALUE,
      label: 'glm-5.1',
      description: '使用当前 Claude Code 默认模型：glm-5.1',
      model: 'glm-5.1',
      kind: 'default',
    },
  ];

  assert.equal(modelTriggerLabel(DEFAULT_MODEL_VALUE, models), 'glm-5.1');
});

test('model menu labels configured slots by actual model and keeps the slot name in the description', () => {
  const model: ClaudeModelOption = {
    id: 'sonnet',
    label: 'Sonnet',
    description: '当前映射：deepseek-v4-pro · 默认推荐模型',
    model: 'deepseek-v4-pro',
    kind: 'slot',
  };

  assert.equal(modelMenuPrimaryLabel(model), 'deepseek-v4-pro');
  assert.equal(modelMenuDescriptionLabel(model), 'Sonnet · 默认推荐模型');
});

test('modelTriggerLabel shows the actual model for configured slots', () => {
  const models: ClaudeModelOption[] = [
    {
      id: 'sonnet',
      label: 'Sonnet',
      description: '当前映射：deepseek-v4-pro · 默认推荐模型',
      model: 'deepseek-v4-pro',
      kind: 'slot',
    },
  ];

  assert.equal(modelTriggerLabel('sonnet', models), 'deepseek-v4-pro');
});
