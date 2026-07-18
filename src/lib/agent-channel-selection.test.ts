import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentChannel, AiProviderTemplate } from '../types.js';
import {
  agentChannelTemplate,
  defaultAgentChannelId,
  isAgentChannelSelectionAvailable,
  resolveRunAgentChannelSelection,
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
      threadId: 'active-thread',
      activeThreadId: 'active-thread',
      persistedChannelId: null,
      selectedChannelId: 'enabled-channel',
    }),
    { channelId: 'enabled-channel', reuseSession: false },
  );
});

test('background queued runs keep the persisted thread channel', () => {
  assert.deepEqual(
    resolveRunAgentChannelSelection({
      threadId: 'background-thread',
      activeThreadId: 'active-thread',
      persistedChannelId: 'enabled-channel',
      selectedChannelId: SYSTEM_AGENT_CHANNEL_ID,
    }),
    { channelId: 'enabled-channel', reuseSession: true },
  );
});
