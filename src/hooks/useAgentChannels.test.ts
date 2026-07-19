import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./useAgentChannels.ts', import.meta.url), 'utf8');

test('agent channel bootstrap refreshes external CCSwitch state on window re-entry', () => {
  assert.match(source, /window\.addEventListener\('focus', refreshFromExternalConfig\)/);
  assert.match(source, /document\.addEventListener\('visibilitychange', refreshFromExternalConfig\)/);
  assert.match(source, /EXTERNAL_CONFIG_REFRESH_THROTTLE_MS/);
  assert.match(source, /refreshControllerRef\.current\?\.abort\(\)/);
});
