import assert from 'node:assert/strict';
import test from 'node:test';
import {
  channelModelCatalog,
  defaultMobileReasoningEffort,
  mobilePermissionOptions,
  mobileReasoningEffortRequest,
  mobileReasoningOptions,
  supportsDynamicModelCatalog,
} from './lib/mobile-agent-options.js';
import type { MobileModelCatalog } from './types.js';

test('Claude Code uses the exact desktop effort menu', () => {
  const options = mobileReasoningOptions('claude-code', undefined, '');
  assert.deepEqual(
    options.map((option) => option.value),
    ['default', 'low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
  );
  assert.equal(defaultMobileReasoningEffort('claude-code', undefined, ''), 'default');
  assert.equal(mobileReasoningEffortRequest('claude-code', 'default'), undefined);
  assert.equal(mobileReasoningEffortRequest('claude-code', 'max'), 'max');
  assert.equal(supportsDynamicModelCatalog('claude-code'), true);
});

test('Codex only exposes efforts declared by the selected model', () => {
  const catalog: MobileModelCatalog = {
    providerId: 'openai-codex',
    defaultModelId: 'gpt-codex',
    models: [{
      id: 'gpt-codex',
      label: 'GPT Codex',
      isDefault: true,
      defaultReasoningEffort: 'high',
      supportedReasoningEfforts: [{ id: 'medium' }, { id: 'high' }, { id: 'xhigh' }],
    }],
  };
  assert.deepEqual(
    mobileReasoningOptions('openai-codex', catalog, '').map((option) => option.value),
    ['medium', 'high', 'xhigh'],
  );
  assert.equal(defaultMobileReasoningEffort('openai-codex', catalog, ''), 'high');
  assert.deepEqual(mobileReasoningOptions('opencode', catalog, ''), []);
});

test('DSH channel models inherit native reasoning capabilities', () => {
  const nativeCatalog: MobileModelCatalog = {
    providerId: 'deepseek-dsh',
    defaultModelId: 'deepseek-official/deepseek-v4-flash',
    models: [{
      id: 'deepseek-official/deepseek-v4-flash',
      label: 'DeepSeek-V4-Flash',
      isDefault: true,
      defaultReasoningEffort: 'high',
      supportedReasoningEfforts: [{ id: 'off' }, { id: 'high' }, { id: 'max' }],
    }],
  };
  const catalog = channelModelCatalog('deepseek-dsh', [{
    id: 'channel-model',
    modelId: 'deepseek-v4-flash',
    displayName: 'deepseek-v4-flash',
    isDefault: true,
    capabilities: {},
  }], nativeCatalog);

  assert.deepEqual(
    mobileReasoningOptions('deepseek-dsh', catalog, '').map((option) => option.value),
    ['off', 'high', 'max'],
  );
  assert.equal(defaultMobileReasoningEffort('deepseek-dsh', catalog, ''), 'high');
  assert.equal(supportsDynamicModelCatalog('deepseek-dsh'), true);
});

test('mobile permission choices match the desktop visible menu', () => {
  assert.deepEqual(
    mobilePermissionOptions.map((option) => option.value),
    ['default', 'auto', 'bypassPermissions'],
  );
});
