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

test('getQueuedPromptGuideAvailability waits for the backend run id before enabling guide delivery', () => {
  assert.deepEqual(
    getQueuedPromptGuideAvailability({
      isRunning: true,
      runId: '',
      hasPendingHumanInput: false,
      queueLength: 1,
    }),
    {
      available: false,
      reason: '当前没有运行中的任务。',
    },
  );
});

test('guideQueuedPrompt sends the queued prompt to the active run without creating a new thread', () => {
  const guideQueuedPromptSource = extractFunctionBody(useClaudeRunSource, 'guideQueuedPrompt');

  assert.match(
    guideQueuedPromptSource,
    /const context = targetThreadId \? runContextsByThreadIdRef\.current\.get\(targetThreadId\) : undefined;/,
  );
  assert.match(guideQueuedPromptSource, /if \(!targetThreadId \|\| !context\?\.runId\) \{/);
  assert.match(
    guideQueuedPromptSource,
    /fetch\(`\/api\/claude\/run\/\$\{encodeURIComponent\(context\.runId\)\}\/guide`/,
  );
  assert.match(guideQueuedPromptSource, /contentBlocks: targetPrompt\.contentBlocks,/);
  assert.doesNotMatch(guideQueuedPromptSource, /attachments:\s*requestImageAttachments/);
  assert.doesNotMatch(guideQueuedPromptSource, /ensureActiveThread|createThread|startRun\(/);
});

test('guideQueuedPrompt waits for preparing queued prompts before sending guide payloads', () => {
  const guideQueuedPromptSource = extractFunctionBody(useClaudeRunSource, 'guideQueuedPrompt');

  assert.match(guideQueuedPromptSource, /targetPrompt\.queueStatus === 'preparing'/);
  assert.doesNotMatch(guideQueuedPromptSource, /fetch\(`\/api\/claude\/run\/\$\{encodeURIComponent\(context\.runId\)\}\/guide`[\s\S]*queueStatus === 'preparing'/);
});

test('submitPromptToThread updates an existing preparing queue item when final content is ready', () => {
  const submitPromptToThreadSource = extractFunctionBody(useClaudeRunSource, 'submitPromptToThread');

  assert.match(submitPromptToThreadSource, /submission\.queueId/);
  assert.match(submitPromptToThreadSource, /updateQueuedPrompt\(thread\.id,\s*submission\.queueId,/);
  assert.match(submitPromptToThreadSource, /queueStatus: 'ready'/);
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
  assert.match(useClaudeRunSource, /if \(submissionContentBlocks\.length === 0 && submission\.queueStatus !== 'preparing'\) \{/);
  assert.match(useClaudeRunSource, /if \(requestContentBlocks\.length === 0 \|\| isThreadRunning\(thread\.id\)\) \{/);
});

test('submitPromptToThread queues without toast and optionally guides immediately', () => {
  const submitPromptToThreadSource = extractFunctionBody(useClaudeRunSource, 'submitPromptToThread');

  assert.doesNotMatch(submitPromptToThreadSource, /已排队，当前运行完成后会继续发送/);
  assert.doesNotMatch(useClaudeRunSource, /已发送排队提示/);
  assert.match(submitPromptToThreadSource, /const queuedPrompt = enqueuePrompt\(thread, \{/);
  assert.match(
    submitPromptToThreadSource,
    /if \(autoGuideQueuedPrompts && queuedPrompt\.queueStatus !== 'preparing'\) \{\s*void guideQueuedPrompt\(queuedPrompt\.id, \{ silent: true \}\);\s*\}/,
  );
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
  // 文本块不渲染卡片；@文件（mention 来源）的 file_reference 仍隐藏，
  // 桌面端拖拽 / 文件框添加（attachment 来源）的 file_reference 需要显示成附件卡片。
  assert.match(conversationTurnSource, /if \(block\.type === 'text'\) \{\s*return false;\s*\}/);
  assert.match(
    conversationTurnSource,
    /if \(block\.type === 'file_reference'\) \{\s*return block\.source === 'attachment';\s*\}/,
  );
});

test('useClaudeRun renames untouched default empty threads from the first submitted message', () => {
  assert.match(useClaudeRunSource, /shouldAutoRenameThreadTitle/);
  assert.match(useClaudeRunSource, /renameThread: \(threadId: string, title: string, options\?: \{ showToast\?: boolean \}\) => Promise<ThreadSummary \| null>;/);
  assert.match(
    useClaudeRunSource,
    /const nextThreadTitle = submission \? buildNewChatTitleFromSubmission\(submission\) : '';/,
  );
  assert.match(
    useClaudeRunSource,
    /if \(shouldAutoRenameThreadTitle\(activeThreadSummary\.title, nextThreadTitle\)\) \{/,
  );
  assert.match(
    useClaudeRunSource,
    /return \(await renameThread\(activeThreadSummary\.id, nextThreadTitle, \{ showToast: false \}\)\) \?\? activeThreadSummary;/,
  );
});

test('ConversationTurn hides the internal guide command label from guided queue cards', () => {
  assert.match(conversationTurnSource, /function shouldShowSystemCommandCode\(item: SystemCommandItem\)/);
  assert.match(conversationTurnSource, /return item\.command !== 'guide';/);
  assert.match(conversationTurnSource, /\{shouldShowSystemCommandCode\(item\) \? <code>\{item\.command\}<\/code> : null\}/);
});

function extractFunctionBody(source: string, functionName: string) {
  const signature = `async function ${functionName}(`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing ${functionName}`);

  const bodyStart = source.indexOf(') {', start);
  assert.notEqual(bodyStart, -1, `missing ${functionName} body start`);

  const openBrace = bodyStart + 2;
  assert.notEqual(openBrace, -1, `missing ${functionName} body`);

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBrace + 1, index);
      }
    }
  }

  assert.fail(`unterminated ${functionName}`);
}
