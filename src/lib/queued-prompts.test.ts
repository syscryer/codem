import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getQueuedPromptGuideAvailability,
  resolveQueuedPromptRunOptions,
} from './queued-prompts.js';

test('resolveQueuedPromptRunOptions prefers the completed run session over stale thread metadata', () => {
  const options = resolveQueuedPromptRunOptions(
    {
      sessionId: 'old-session',
      workingDirectory: 'D:/project/old',
      permissionMode: 'default',
      model: 'sonnet',
      effort: 'low',
    },
    {
      latestSessionId: 'new-session',
      workingDirectory: 'D:/project/current',
      permissionMode: 'bypassPermissions',
      model: 'opus',
      effort: 'high',
    },
    true,
  );

  assert.deepEqual(options, {
    sessionId: 'new-session',
    workingDirectory: 'D:/project/current',
    permissionModeOverride: 'bypassPermissions',
    modelOverride: 'opus',
    effortOverride: 'high',
  });
});

test('resolveQueuedPromptRunOptions drops the session when reuse is disabled', () => {
  const options = resolveQueuedPromptRunOptions(
    {
      sessionId: 'old-session',
      workingDirectory: 'D:/project',
      permissionMode: 'default',
    },
    {
      latestSessionId: 'new-session',
      workingDirectory: 'D:/project',
      permissionMode: 'default',
    },
    false,
  );

  assert.equal(options.sessionId, undefined);
});

test('getQueuedPromptGuideAvailability blocks guide delivery during human input cards', () => {
  assert.deepEqual(
    getQueuedPromptGuideAvailability({
      isRunning: true,
      runId: 'run-1',
      hasPendingHumanInput: true,
      queueLength: 1,
    }),
    {
      available: false,
      reason: '当前运行正在等待问答或审批，暂不能引导。',
    },
  );
});

test('getQueuedPromptGuideAvailability allows guide delivery for normal running turns', () => {
  assert.deepEqual(
    getQueuedPromptGuideAvailability({
      isRunning: true,
      runId: 'run-1',
      hasPendingHumanInput: false,
      queueLength: 1,
    }),
    {
      available: true,
    },
  );
});
