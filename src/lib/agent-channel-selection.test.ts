import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLAUDE_CODE_PROVIDER_ID,
  GROK_BUILD_PROVIDER_ID,
  OPENAI_CODEX_PROVIDER_ID,
} from '../constants.js';
import type { AgentChannel, AiProviderTemplate } from '../types.js';
import {
  agentChannelTemplate,
  defaultAgentChannelId,
  isAgentChannelSelectionAvailable,
  resolveRunAgentChannelSelection,
  buildAgentChannelModelCatalog,
  buildAgentSystemChannelModelCatalog,
  shouldPreservePendingAgentChannelSelection,
  SYSTEM_AGENT_CHANNEL_ID,
  threadAgentChannelId,
} from './agent-channel-selection.js';

const templates = [{
  id: 'deepseek',
  name: 'DeepSeek',
  vendorId: 'deepseek',
  vendorName: 'DeepSeek',
  channelId: 'standard',
  channelName: '标准 API',
  protocol: 'anthropic_messages',
  baseUrl: 'https://api.deepseek.com/anthropic',
  apiKeyUrl: 'https://platform.deepseek.com',
  docsUrl: 'https://api-docs.deepseek.com',
  icon: 'deepseek',
  category: 'china',
}] satisfies AiProviderTemplate[];

const channels = [
  {
    id: 'enabled-channel',
    providerId: 'claude-code',
    name: 'Enabled',
    protocol: 'anthropic_messages',
    baseUrl: 'https://api.example.com',
    enabled: true,
    isDefault: true,
    apiKeySaved: true,
    models: [],
    createdAt: '2026-07-16T00:00:00Z',
    updatedAt: '2026-07-16T00:00:00Z',
  },
  {
    id: 'disabled-channel',
    providerId: 'claude-code',
    name: 'Disabled',
    protocol: 'anthropic_messages',
    baseUrl: 'https://api.example.com',
    enabled: false,
    isDefault: false,
    apiKeySaved: true,
    models: [],
    createdAt: '2026-07-16T00:00:00Z',
    updatedAt: '2026-07-16T00:00:00Z',
  },
] satisfies AgentChannel[];

test('system channel is always available', () => {
  assert.equal(
    isAgentChannelSelectionAvailable([], 'claude-code', SYSTEM_AGENT_CHANNEL_ID),
    true,
  );
});

test('CodeM channel must exist, match the Agent, and be enabled', () => {
  assert.equal(
    isAgentChannelSelectionAvailable(channels, 'claude-code', 'enabled-channel'),
    true,
  );
  assert.equal(
    isAgentChannelSelectionAvailable(channels, 'claude-code', 'disabled-channel'),
    false,
  );
  assert.equal(
    isAgentChannelSelectionAvailable(channels, 'openai-codex', 'enabled-channel'),
    false,
  );
  assert.equal(
    isAgentChannelSelectionAvailable(channels, 'claude-code', 'missing-channel'),
    false,
  );
});

test('Provider default resolves to an enabled CodeM channel or system', () => {
  assert.equal(defaultAgentChannelId(channels, 'claude-code'), 'enabled-channel');
  assert.equal(
    defaultAgentChannelId(channels, 'claude-code', 'enabled-channel'),
    'enabled-channel',
  );
  assert.equal(
    defaultAgentChannelId(channels, 'claude-code', 'disabled-channel'),
    SYSTEM_AGENT_CHANNEL_ID,
  );
  assert.equal(defaultAgentChannelId([], 'claude-code'), SYSTEM_AGENT_CHANNEL_ID);
});

test('persisted empty thread channels remain system channels', () => {
  assert.equal(threadAgentChannelId(null), SYSTEM_AGENT_CHANNEL_ID);
});

test('newly saved channel stays selected while bootstrap refresh is still stale', () => {
  assert.equal(
    shouldPreservePendingAgentChannelSelection({
      selectedChannelId: 'new-channel',
      pendingChannelId: 'new-channel',
      hasSelectedChannel: false,
    }),
    true,
  );
  assert.equal(
    shouldPreservePendingAgentChannelSelection({
      selectedChannelId: 'new-channel',
      pendingChannelId: 'new-channel',
      hasSelectedChannel: true,
    }),
    false,
  );
  assert.equal(
    shouldPreservePendingAgentChannelSelection({
      selectedChannelId: 'other-channel',
      pendingChannelId: 'new-channel',
      hasSelectedChannel: false,
    }),
    false,
  );
});

test('persisted channel template id keeps the configured vendor icon stable', () => {
  assert.equal(agentChannelTemplate({
    ...channels[0],
    templateId: 'deepseek',
    baseUrl: 'https://proxy.example.com',
  }, templates)?.icon, 'deepseek');
});

test('active thread runs use the current UI channel before persistence finishes', () => {
  assert.deepEqual(
    resolveRunAgentChannelSelection({
      providerId: CLAUDE_CODE_PROVIDER_ID,
      threadId: 'active-thread',
      activeThreadId: 'active-thread',
      persistedChannelId: null,
      selectedChannelId: 'enabled-channel',
    }),
    { channelId: 'enabled-channel', channelChanged: true, reuseSession: true },
  );
});

test('switching channels within one Agent Provider keeps the resumable session', () => {
  assert.deepEqual(
    resolveRunAgentChannelSelection({
      providerId: CLAUDE_CODE_PROVIDER_ID,
      threadId: 'active-thread',
      activeThreadId: 'active-thread',
      persistedChannelId: 'enabled-channel',
      selectedChannelId: SYSTEM_AGENT_CHANNEL_ID,
    }),
    { channelId: undefined, channelChanged: true, reuseSession: true },
  );
});

test('Grok keeps its ACP session when its channel changes', () => {
  assert.deepEqual(
    resolveRunAgentChannelSelection({
      providerId: GROK_BUILD_PROVIDER_ID,
      threadId: 'active-thread',
      activeThreadId: 'active-thread',
      persistedChannelId: 'grok-a',
      selectedChannelId: 'grok-b',
    }),
    { channelId: 'grok-b', channelChanged: true, reuseSession: true },
  );
});

test('Codex keeps its session when its channel changes', () => {
  assert.deepEqual(
    resolveRunAgentChannelSelection({
      providerId: OPENAI_CODEX_PROVIDER_ID,
      threadId: 'active-thread',
      activeThreadId: 'active-thread',
      persistedChannelId: 'codex-a',
      selectedChannelId: 'codex-b',
    }),
    { channelId: 'codex-b', channelChanged: true, reuseSession: true },
  );
});

test('channel model capabilities expose DeepSeek reasoning levels to Codex', () => {
  const catalog = buildAgentChannelModelCatalog(OPENAI_CODEX_PROVIDER_ID, {
    ...channels[0],
    providerId: OPENAI_CODEX_PROVIDER_ID,
    protocol: 'openai_responses',
    baseUrl: 'https://api.deepseek.com',
    models: [{
      id: 'deepseek-model',
      channelId: 'enabled-channel',
      modelId: 'deepseek-v4-flash',
      displayName: 'DeepSeek V4 Flash',
      enabled: true,
      isDefault: true,
      capabilities: {
        defaultReasoningEffort: 'high',
        reasoningEfforts: [
          { id: 'low', label: '低' },
          { id: 'high', label: '高' },
          { id: 'max', label: '最大' },
        ],
      },
      createdAt: '2026-08-04T00:00:00Z',
      updatedAt: '2026-08-04T00:00:00Z',
    }],
  }, null);
  assert.equal(catalog?.models[0]?.defaultReasoningEffort, 'high');
  assert.deepEqual(
    catalog?.models[0]?.supportedReasoningEfforts.map((effort) => effort.id),
    ['low', 'high', 'max'],
  );
});

test('system Codex catalog fills official DeepSeek reasoning levels when missing', () => {
  const catalog = buildAgentChannelModelCatalog(OPENAI_CODEX_PROVIDER_ID, undefined, {
    providerId: OPENAI_CODEX_PROVIDER_ID,
    defaultModelId: 'deepseek-v4-flash',
    models: [{
      id: 'deepseek-v4-flash',
      label: 'DeepSeek V4 Flash',
      isDefault: true,
      supportedReasoningEfforts: [],
    }],
  });
  assert.equal(catalog?.models[0]?.defaultReasoningEffort, 'high');
  assert.deepEqual(
    catalog?.models[0]?.supportedReasoningEfforts.map((effort) => effort.id),
    ['low', 'high', 'max'],
  );
});

test('system Agent channel keeps the complete native model catalog', () => {
  const catalog = buildAgentChannelModelCatalog(OPENAI_CODEX_PROVIDER_ID, undefined, {
    providerId: OPENAI_CODEX_PROVIDER_ID,
    defaultModelId: 'gpt-5.6-sol',
    models: [
      { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', isDefault: true, supportedReasoningEfforts: [] },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra', isDefault: false, supportedReasoningEfforts: [] },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6-Luna', isDefault: false, supportedReasoningEfforts: [] },
    ],
  });

  assert.equal(catalog?.defaultModelId, 'gpt-5.6-sol');
  assert.deepEqual(catalog?.models.map((model) => model.id), [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
  ]);
});

test('system Claude channel exposes the detected provider and model as one configured choice', () => {
  const catalog = buildAgentSystemChannelModelCatalog(CLAUDE_CODE_PROVIDER_ID, {
    id: 'system',
    providerId: CLAUDE_CODE_PROVIDER_ID,
    name: '系统渠道',
    source: 'cc-switch',
    configured: true,
    model: 'glm-5.2',
    ccSwitchProviderName: 'Zhipu GLM',
    detail: '当前由 CC Switch 管理',
  }, null);

  assert.equal(catalog?.defaultModelId, 'glm-5.2');
  assert.deepEqual(catalog?.models.map((model) => model.id), ['glm-5.2']);
  assert.deepEqual(
    catalog?.models[0]?.supportedReasoningEfforts.map((effort) => effort.id),
    ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
  );
});

test('custom Claude channel falls back to Claude Code reasoning levels', () => {
  const catalog = buildAgentChannelModelCatalog(CLAUDE_CODE_PROVIDER_ID, {
    ...channels[0],
    models: [{
      id: 'glm-model',
      channelId: channels[0].id,
      modelId: 'GLM-5.2',
      displayName: 'GLM-5.2',
      enabled: true,
      isDefault: true,
      capabilities: {},
      createdAt: '2026-08-07T00:00:00Z',
      updatedAt: '2026-08-07T00:00:00Z',
    }],
  }, null);

  assert.deepEqual(
    catalog?.models[0]?.supportedReasoningEfforts.map((effort) => effort.id),
    ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
  );
});

test('background queued runs keep the persisted thread channel', () => {
  assert.deepEqual(
    resolveRunAgentChannelSelection({
      providerId: CLAUDE_CODE_PROVIDER_ID,
      threadId: 'background-thread',
      activeThreadId: 'active-thread',
      persistedChannelId: 'enabled-channel',
      selectedChannelId: SYSTEM_AGENT_CHANNEL_ID,
    }),
    { channelId: 'enabled-channel', channelChanged: false, reuseSession: true },
  );
});
