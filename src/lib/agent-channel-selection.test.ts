import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentChannel } from '../types.js';
import {
  isAgentChannelSelectionAvailable,
  resolveRunAgentChannelSelection,
  SYSTEM_AGENT_CHANNEL_ID,
} from './agent-channel-selection.js';

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
