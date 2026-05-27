import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getQueuedPromptGuideAvailability,
  resolveQueuedPromptRunOptions,
} from './queued-prompts.js';

const useClaudeRunSource = readFileSync(new URL('../hooks/useClaudeRun.ts', import.meta.url), 'utf8');
const conversationTurnSource = readFileSync(new URL('../components/ConversationTurn.tsx', import.meta.url), 'utf8');

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

test('useClaudeRun preserves contentBlocks across queue, direct send, and guide payloads', () => {
  assert.match(useClaudeRunSource, /type QueuedPrompt = \{[\s\S]*contentBlocks\?: InputContentBlock\[\];/);
  assert.match(useClaudeRunSource, /type PromptSubmission = \{[\s\S]*contentBlocks\?: InputContentBlock\[\];/);
  assert.match(useClaudeRunSource, /contentBlocks: submission\.contentBlocks,/);
  assert.match(useClaudeRunSource, /contentBlocks: buildRunContentBlocks\(\{\s*prompt: targetPrompt\.prompt,\s*attachments: targetPrompt\.attachments,\s*contentBlocks: targetPrompt\.contentBlocks,\s*\}\),/);
  assert.match(useClaudeRunSource, /contentBlocks: nextPrompt\.contentBlocks,/);
  assert.match(useClaudeRunSource, /contentBlocks: submission\.contentBlocks,/);
});

test('useClaudeRun accepts contentBlocks-only submissions instead of requiring prompt text', () => {
  assert.match(
    useClaudeRunSource,
    /const submissionContentBlocks = buildRunContentBlocks\(\{\s*prompt: submission\.prompt,\s*attachments: submission\.attachments,\s*contentBlocks: submission\.contentBlocks,\s*\}\);/,
  );
  assert.match(useClaudeRunSource, /if \(submissionContentBlocks\.length === 0\) \{/);
  assert.match(useClaudeRunSource, /if \(requestContentBlocks\.length === 0 \|\| isThreadRunning\(thread\.id\)\) \{/);
});

test('useClaudeRun refreshes Claude model options before resolving the run request model', () => {
  assert.match(useClaudeRunSource, /const previousModels = models;/);
  assert.match(useClaudeRunSource, /const latestModels = options\?\.toolResult \? previousModels : \(await loadClaudeModels\(\)\) \?\? previousModels;/);
  assert.match(
    useClaudeRunSource,
    /resolveRunModelSelection\(\s*runModelCandidate,\s*latestModels,\s*appModelSettings\.defaultModelId,\s*previousModels,\s*\)/,
  );
  assert.match(useClaudeRunSource, /model: requestModel,/);
});

test('useClaudeRun clears stale provider metadata and starts without the old session', () => {
  assert.match(useClaudeRunSource, /staleProviderModel/);
  assert.match(useClaudeRunSource, /const runSessionId = staleProviderModel && !options\?\.toolResult \? undefined : rawRunSessionId;/);
  assert.match(useClaudeRunSource, /persistThreadMetadata\(thread\.id, \{\s*model: null,\s*sessionId: null,\s*\}\)/);
});

test('useClaudeRun stores safe user content block summaries and ConversationTurn renders them', () => {
  assert.match(useClaudeRunSource, /buildHistoryContentBlocks/);
  assert.match(
    useClaudeRunSource,
    /const turnContentBlocks = buildHistoryContentBlocks\(\{\s*prompt: trimmedPrompt,\s*attachments: options\?\.attachments,\s*contentBlocks: options\?\.contentBlocks,\s*\}\);/,
  );
  assert.match(useClaudeRunSource, /userContentBlocks: turnContentBlocks,/);

  assert.match(conversationTurnSource, /const hasUserContentBlocks = Boolean\(turn\.userContentBlocks\?\.length\);/);
  assert.match(conversationTurnSource, /<UserContentBlocks blocks=\{turn\.userContentBlocks \?\? \[\]\} onPreviewImage=\{setImagePreview\} \/>/);
  assert.doesNotMatch(conversationTurnSource, /user-message-attachment-kind/);
  // file_reference 块不渲染附件卡片，避免在用户消息里出现孤立的"路径气泡"
  assert.match(
    conversationTurnSource,
    /blocks\.filter\(\(block\) => block\.type !== 'text' && block\.type !== 'file_reference'\)/,
  );
});
