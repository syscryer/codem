import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./useWorkspaceState.ts', import.meta.url), 'utf8');

test('workspace debug and raw events are batched before updating thread details', () => {
  assert.match(source, /const WORKSPACE_LOG_FLUSH_MS = 100;/);
  assert.match(source, /const pendingLogBatchesRef = useRef<Map<string, PendingWorkspaceLogBatch>>\(new Map\(\)\);/);
  assert.match(source, /function flushPendingThreadLogs\(\)/);

  const appendDebugIndex = source.indexOf('function appendDebug');
  const appendRawEventIndex = source.indexOf('function appendRawEvent', appendDebugIndex);
  const persistMetadataIndex = source.indexOf('async function persistThreadMetadata', appendRawEventIndex);
  assert.notEqual(appendDebugIndex, -1);
  assert.notEqual(appendRawEventIndex, -1);
  assert.notEqual(persistMetadataIndex, -1);

  const appendDebugBody = source.slice(appendDebugIndex, appendRawEventIndex);
  const appendRawEventBody = source.slice(appendRawEventIndex, persistMetadataIndex);
  assert.doesNotMatch(appendDebugBody, /setThreadDetails/);
  assert.doesNotMatch(appendRawEventBody, /setThreadDetails/);
  assert.match(appendDebugBody, /scheduleThreadLogFlush\(\)/);
  assert.match(appendRawEventBody, /scheduleThreadLogFlush\(\)/);
});
