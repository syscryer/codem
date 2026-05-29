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
