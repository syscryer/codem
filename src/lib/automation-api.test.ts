import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const apiSource = readFileSync(new URL('./automation-api.ts', import.meta.url), 'utf8');
const backendSource = readFileSync(new URL('../../src-tauri/src/automation.rs', import.meta.url), 'utf8');

test('automation API exposes CRUD, scheduled claim, manual run, and run updates', () => {
  assert.match(apiSource, /\/api\/automations\/bootstrap/);
  assert.match(apiSource, /\/api\/automations\/\$\{encodeURIComponent\(id\)\}\/claim/);
  assert.match(apiSource, /\/api\/automations\/\$\{encodeURIComponent\(id\)\}\/runs/);
  assert.match(apiSource, /\/api\/automation-runs\/\$\{encodeURIComponent\(runId\)\}/);
});
test('backend persists definitions and atomically advances scheduled claims', () => {
  assert.match(backendSource, /CREATE TABLE IF NOT EXISTS automations/);
  assert.match(backendSource, /CREATE TABLE IF NOT EXISTS automation_runs/);
  assert.match(backendSource, /AND enabled = 1 AND next_run_at_ms <= \?/);
  assert.match(backendSource, /自动化已被其他窗口领取/);
});
