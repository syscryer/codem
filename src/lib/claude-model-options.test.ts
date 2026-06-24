import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MODEL_VALUE } from '../constants';
import { mergeModelOptions } from './claude-model-options.js';
import type { ClaudeModelOption, ModelSettings } from '../types';

test('mergeModelOptions applies manual capabilities to configured and custom models', () => {
  const configuredModels: ClaudeModelOption[] = [
    {
      id: DEFAULT_MODEL_VALUE,
      label: 'GLM-5.2',
      description: '使用当前 Claude Code 默认模型：GLM-5.2',
      model: 'GLM-5.2',
      kind: 'default',
    },
    {
      id: 'sonnet',
      label: 'Sonnet',
      model: 'GLM-5.2',
      kind: 'slot',
    },
  ];
  const customModels: ModelSettings['customModels'] = [
    { id: 'custom/glm' },
  ];
  const modelCapabilities: ModelSettings['modelCapabilities'] = [
    {
      modelId: 'GLM-5.2',
      contextWindowTokens: 1_000_000,
      supportsContext1m: true,
      context1mModel: 'GLM-5.2[1m]',
    },
    {
      modelId: 'custom/glm',
      contextWindowTokens: 1_000_000,
      supportsContext1m: true,
    },
  ];

  const options = mergeModelOptions(configuredModels, customModels, modelCapabilities);

  assert.deepEqual(
    options.map((option) => [option.id, option.model, option.supportsContext1m, option.context1mModel, option.contextWindowTokens]),
    [
      [DEFAULT_MODEL_VALUE, 'GLM-5.2', true, 'GLM-5.2[1m]', 1_000_000],
      ['sonnet', 'GLM-5.2', true, 'GLM-5.2[1m]', 1_000_000],
      ['custom/glm', 'custom/glm', false, undefined, 1_000_000],
    ],
  );
});

test('mergeModelOptions lets manual capabilities hide a built-in 1M switch', () => {
  const options = mergeModelOptions(
    [
      {
        id: 'sonnet',
        label: 'Sonnet',
        model: 'sonnet',
        kind: 'slot',
        supportsContext1m: true,
        context1mModel: 'sonnet[1m]',
      },
    ],
    [],
    [
      {
        modelId: 'sonnet',
        contextWindowTokens: 180_000,
        supportsContext1m: false,
      },
    ],
  );

  const sonnet = options.find((option) => option.id === 'sonnet');
  assert.equal(sonnet?.supportsContext1m, false);
  assert.equal(sonnet?.context1mModel, undefined);
  assert.equal(sonnet?.contextWindowTokens, 180_000);
});
