import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultGeneralSettings, normalizeGeneralSettings } from './settings-api.js';

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
