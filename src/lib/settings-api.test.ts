import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultAgentRuntimeSettings,
  defaultGeneralSettings,
  normalizeAgentRuntimeSettings,
  normalizeGeneralSettings,
} from './settings-api.js';

test('normalizeAgentRuntimeSettings defaults to Claude Code and preserves supported providers', () => {
  assert.equal(normalizeAgentRuntimeSettings({}).defaultProviderId, 'claude-code');
  assert.equal(defaultAgentRuntimeSettings.defaultProviderId, 'claude-code');
  assert.equal(normalizeAgentRuntimeSettings({ defaultProviderId: 'claude-code' }).defaultProviderId, 'claude-code');
  assert.equal(normalizeAgentRuntimeSettings({ defaultProviderId: 'grok-build' }).defaultProviderId, 'grok-build');
  assert.equal(normalizeAgentRuntimeSettings({ defaultProviderId: 'openai-codex' }).defaultProviderId, 'openai-codex');
  assert.equal(normalizeAgentRuntimeSettings({ defaultProviderId: 'opencode' }).defaultProviderId, 'opencode');
  assert.equal(normalizeAgentRuntimeSettings({ defaultProviderId: 'unknown-provider' }).defaultProviderId, 'claude-code');
  assert.deepEqual(
    normalizeAgentRuntimeSettings({ experimentalAgentRunEnabled: false, defaultProviderId: 'opencode' }),
    { defaultProviderId: 'opencode' },
  );
});

test('normalizeGeneralSettings enables thread system notifications by default for old settings', () => {
  assert.equal(
    normalizeGeneralSettings({}).enableThreadSystemNotifications,
    true,
  );
  assert.equal(defaultGeneralSettings.enableThreadSystemNotifications, true);
});

test('normalizeGeneralSettings preserves an explicit thread system notification choice', () => {
  assert.equal(
    normalizeGeneralSettings({ enableThreadSystemNotifications: false }).enableThreadSystemNotifications,
    false,
  );
  assert.equal(
    normalizeGeneralSettings({ enableThreadSystemNotifications: true }).enableThreadSystemNotifications,
    true,
  );
});

test('normalizeGeneralSettings disables automatic queued prompt guide by default', () => {
  assert.equal(normalizeGeneralSettings({}).autoGuideQueuedPrompts, false);
  assert.equal(defaultGeneralSettings.autoGuideQueuedPrompts, false);
});

test('normalizeGeneralSettings preserves automatic queued prompt guide choice', () => {
  assert.equal(normalizeGeneralSettings({ autoGuideQueuedPrompts: true }).autoGuideQueuedPrompts, true);
  assert.equal(normalizeGeneralSettings({ autoGuideQueuedPrompts: false }).autoGuideQueuedPrompts, false);
});

test('normalizeGeneralSettings enables automatic app update checks by default', () => {
  assert.equal(normalizeGeneralSettings({}).autoCheckAppUpdate, true);
  assert.equal(defaultGeneralSettings.autoCheckAppUpdate, true);
});

test('normalizeGeneralSettings preserves explicit automatic app update choice', () => {
  assert.equal(normalizeGeneralSettings({ autoCheckAppUpdate: false }).autoCheckAppUpdate, false);
  assert.equal(normalizeGeneralSettings({ autoCheckAppUpdate: true }).autoCheckAppUpdate, true);
});

test('normalizeGeneralSettings keeps intermediate process expansion off by default', () => {
  assert.equal(normalizeGeneralSettings({}).collapseIntermediateProcess, false);
  assert.equal(defaultGeneralSettings.collapseIntermediateProcess, false);
});

test('normalizeGeneralSettings preserves explicit intermediate process collapse choice', () => {
  assert.equal(normalizeGeneralSettings({ collapseIntermediateProcess: true }).collapseIntermediateProcess, true);
  assert.equal(normalizeGeneralSettings({ collapseIntermediateProcess: false }).collapseIntermediateProcess, false);
});
