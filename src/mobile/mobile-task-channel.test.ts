import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultAgentChannelId } from '../lib/agent-channel-selection.js';
import { mobileTaskChannelLabel } from './lib/mobile-task-channel.js';
import type { MobileChannelBootstrap } from './types.js';

const channels: MobileChannelBootstrap = {
  channels: [{
    id: 'channel-team',
    providerId: 'claude-code',
    name: 'Anthropic Team',
    enabled: true,
    isDefault: false,
    apiKeySaved: true,
    models: [],
  }],
  systemChannels: [{
    id: 'system',
    providerId: 'claude-code',
    name: '系统渠道',
    configured: true,
  }],
  defaultChannelIds: {},
};

test('mobile task channel uses the same channel catalog as desktop', () => {
  assert.equal(
    mobileTaskChannelLabel({ providerId: 'claude-code', channelId: 'channel-team' }, channels),
    'Anthropic Team',
  );
  assert.equal(
    mobileTaskChannelLabel({ providerId: 'claude-code', channelId: 'system' }, channels),
    '系统渠道',
  );
  assert.equal(
    mobileTaskChannelLabel({ providerId: 'claude-code' }, channels),
    '系统渠道',
  );
});

test('mobile task channel does not expose stale or cross-provider channel ids', () => {
  assert.equal(
    mobileTaskChannelLabel({ providerId: 'openai-codex', channelId: 'channel-team' }, channels),
    '',
  );
  assert.equal(
    mobileTaskChannelLabel({ providerId: 'claude-code', channelId: 'removed-channel' }, channels),
    '',
  );
});

test('mobile new task follows the selected provider default channel', () => {
  assert.equal(
    defaultAgentChannelId([
      { id: 'deepseek-team', providerId: 'deepseek-dsh', enabled: true, isDefault: true },
    ], 'deepseek-dsh'),
    'deepseek-team',
  );
  assert.equal(
    defaultAgentChannelId([
      { id: 'claude-team', providerId: 'claude-code', enabled: true, isDefault: true },
    ], 'deepseek-dsh'),
    'system',
  );
});
