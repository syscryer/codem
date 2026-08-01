import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCodexQueuedPromptGuideContent,
  getQueuedPromptGuideSelection,
  getQueuedPromptGuideAvailability,
  getQueuedPromptContinuationState,
  resolveQueuedPromptRunOptions,
  resolveGuideSuccessActivity,
  shouldResumePausedQueueAfterUnknownRemoval,
  shouldContinueQueueAfterGuide,
} from './queued-prompts.js';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const useClaudeRunSource = readFileSync(new URL('../hooks/useClaudeRun.ts', import.meta.url), 'utf8');
const useAgentRunSource = readFileSync(new URL('../hooks/useAgentRun.ts', import.meta.url), 'utf8');
const composerSource = readFileSync(new URL('../components/Composer.tsx', import.meta.url), 'utf8');
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

test('getQueuedPromptGuideAvailability blocks guide delivery while the run is interrupting', () => {
  assert.deepEqual(
    getQueuedPromptGuideAvailability({
      isRunning: true,
      runId: 'run-1',
      isInterrupting: true,
      hasPendingHumanInput: false,
      queueLength: 1,
    }),
    {
      available: false,
      reason: '当前运行正在停止，暂不能引导。',
    },
  );
});

test('getCodexQueuedPromptGuideContent accepts only ready plain-text queue items', () => {
  assert.deepEqual(
    getCodexQueuedPromptGuideContent({
      prompt: '继续检查失败路径',
      queueStatus: 'ready',
    }),
    { available: true, text: '继续检查失败路径' },
  );
  assert.deepEqual(
    getCodexQueuedPromptGuideContent({
      prompt: '查看附件',
      queueStatus: 'ready',
      contentBlocks: [{ type: 'file_reference', path: 'D:/workspace/a.md', name: 'a.md' }],
    }),
    {
      available: false,
      reason: 'Codex 运行中引导暂只支持纯文本消息。',
    },
  );
  assert.deepEqual(
    getCodexQueuedPromptGuideContent({
      prompt: '不要重复发送',
      queueStatus: 'guide-unknown',
    }),
    {
      available: false,
      reason: '引导结果尚未确认，请召回后再决定是否重发。',
    },
  );
});

test('getQueuedPromptGuideSelection only allows the head and prevents concurrent guiding', () => {
  const readyQueue = [
    { id: 'prompt-a', queueStatus: 'ready' as const },
    { id: 'prompt-b', queueStatus: 'ready' as const },
  ];
  assert.deepEqual(
    getQueuedPromptGuideSelection(readyQueue, 'prompt-a'),
    { available: true },
  );
  assert.deepEqual(
    getQueuedPromptGuideSelection(readyQueue, 'prompt-b'),
    { available: false, reason: '只能引导队首排队消息。' },
  );

  const guidingQueue = [
    { id: 'prompt-a', queueStatus: 'ready' as const },
    { id: 'prompt-b', queueStatus: 'guiding' as const },
  ];
  assert.deepEqual(
    getQueuedPromptGuideSelection(guidingQueue, 'prompt-a'),
    { available: false, reason: '已有排队消息正在引导。' },
  );
});

test('getQueuedPromptContinuationState freezes the entire queue when any guide is unknown', () => {
  assert.equal(
    getQueuedPromptContinuationState([
      { queueStatus: 'ready' },
      { queueStatus: 'guide-unknown' },
      { queueStatus: 'ready' },
    ]),
    'paused',
  );
  assert.equal(
    getQueuedPromptContinuationState([{ queueStatus: 'ready' }]),
    'ready',
  );
});

test('removing or recalling the last unknown guide resumes a paused continuation', () => {
  const remainingReadyQueue = [{ queueStatus: 'ready' as const }];
  assert.equal(
    shouldResumePausedQueueAfterUnknownRemoval(
      'guide-unknown',
      remainingReadyQueue,
      true,
    ),
    true,
    'delete should resume the remaining queue',
  );
  assert.equal(
    shouldResumePausedQueueAfterUnknownRemoval(
      'guide-unknown',
      remainingReadyQueue,
      true,
    ),
    true,
    'recall should resume the remaining queue',
  );
  assert.equal(
    shouldResumePausedQueueAfterUnknownRemoval(
      'guide-unknown',
      [{ queueStatus: 'guide-unknown' }],
      true,
    ),
    false,
    'another unknown keeps the queue frozen',
  );
  assert.equal(
    shouldResumePausedQueueAfterUnknownRemoval('ready', remainingReadyQueue, true),
    false,
    'removing an ordinary item does not consume the paused continuation',
  );
});

test('resolveGuideSuccessActivity preserves terminal activity after a late HTTP success', () => {
  assert.equal(
    resolveGuideSuccessActivity(false, 'Codex 正在运行'),
    '已发送引导消息，等待 Codex 接收',
  );
  assert.equal(
    resolveGuideSuccessActivity(true, 'Codex 已完成'),
    'Codex 已完成',
  );
});

test('confirmed guide outcomes resume a queue that was blocked by terminal event ordering', () => {
  assert.equal(shouldContinueQueueAfterGuide(true, 'prompt-b', 'prompt-b', 'submitted'), true);
  assert.equal(shouldContinueQueueAfterGuide(true, 'prompt-b', 'prompt-b', 'rejected'), true);
  assert.equal(shouldContinueQueueAfterGuide(true, 'prompt-b', 'prompt-b', 'uncertain'), false);
  assert.equal(shouldContinueQueueAfterGuide(true, 'prompt-a', 'prompt-b', 'submitted'), false);
  assert.equal(shouldContinueQueueAfterGuide(false, 'prompt-b', 'prompt-b', 'submitted'), false);
});

test('maybeStartQueuedPrompt clears a resumed continuation before waiting for preparation', () => {
  const maybeStartQueuedPromptSource = extractFunctionBody(
    useAgentRunSource,
    'maybeStartQueuedPrompt',
  );

  assert.match(
    maybeStartQueuedPromptSource,
    /if \(continuationState !== 'paused'\) \{\s*pausedQueueContinuationsByThreadIdRef\.current\.delete\(context\.threadId\);\s*\}\s*if \(continuationState === 'preparing'\)/,
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

test('generic Agent guideQueuedPrompt steers Codex text and preserves uncertain requests', () => {
  const guideQueuedPromptSource = extractFunctionBody(useAgentRunSource, 'guideQueuedPrompt');

  assert.match(guideQueuedPromptSource, /context\.providerId !== OPENAI_CODEX_PROVIDER_ID/);
  assert.match(guideQueuedPromptSource, /getCodexQueuedPromptGuideContent\(targetPrompt\)/);
  assert.match(
    guideQueuedPromptSource,
    /fetch\(\s*`\/api\/agents\/run\/\$\{encodeURIComponent\(context\.runId\)\}\/guide`/,
  );
  assert.match(
    guideQueuedPromptSource,
    /updateQueuedPromptStatus\(targetThreadId, promptId, 'guiding'\)/,
  );
  assert.match(guideQueuedPromptSource, /resultUncertain \? 'guide-unknown' : 'ready'/);
  assert.match(
    guideQueuedPromptSource,
    /payload\?\.uncertain === true \|\| response\.status >= 500 \|\| response\.ok/,
  );
  assert.match(guideQueuedPromptSource, /createAgentGuideSystemItem/);
  assert.match(guideQueuedPromptSource, /removeQueuedPromptFromThread\(targetThreadId, promptId\)/);
  assert.match(guideQueuedPromptSource, /shouldContinueQueueAfterGuide/);
  assert.doesNotMatch(guideQueuedPromptSource, /startAgentRun\(|createThread\(/);
});

test('App enables the existing guide affordance for Codex but not other generic Agents', () => {
  assert.match(
    appSource,
    /activeUsesGenericAgent\s*&&\s*activeThread\?\.provider\s*===\s*OPENAI_CODEX_PROVIDER_ID/,
  );
  assert.match(appSource, /getQueuedPromptGuideAvailability\(\{/);
  assert.match(appSource, /isInterrupting:/);
  assert.match(appSource, /当前 Provider 不支持运行中引导/);
});

test('Composer disables guiding and unknown queue items with explicit status text', () => {
  assert.match(composerSource, /prompt\.queueStatus === 'guiding'/);
  assert.match(composerSource, /prompt\.queueStatus === 'guide-unknown'/);
  assert.match(composerSource, /prompt\.guideUnavailableReason/);
  assert.match(composerSource, /正在引导当前运行/);
  assert.match(composerSource, /引导状态未知/);
  assert.match(composerSource, /排队已暂停，等待你处理引导状态/);
  assert.match(composerSource, /disabled=\{isGuiding\}/);
  assert.match(useAgentRunSource, /selectedProviderId === OPENAI_CODEX_PROVIDER_ID/);
});

test('guideQueuedPrompt waits for preparing queued prompts before sending guide payloads', () => {
  const guideQueuedPromptSource = extractFunctionBody(useClaudeRunSource, 'guideQueuedPrompt');

  assert.match(guideQueuedPromptSource, /targetPrompt\.queueStatus === 'preparing'/);
  assert.doesNotMatch(guideQueuedPromptSource, /fetch\(`\/api\/claude\/run\/\$\{encodeURIComponent\(context\.runId\)\}\/guide`[\s\S]*queueStatus === 'preparing'/);
});

test('guideQueuedPrompt stays silent on successful guide delivery', () => {
  const guideQueuedPromptSource = extractFunctionBody(useClaudeRunSource, 'guideQueuedPrompt');

  assert.doesNotMatch(guideQueuedPromptSource, /showToast\('已发送引导消息。', 'success'\)/);
  assert.match(guideQueuedPromptSource, /showToast\(error instanceof Error \? error\.message : '发送引导消息失败', 'error'\)/);
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

test('useAgentRun preserves contentBlocks across preparing, ready, and automatic queue delivery', () => {
  assert.match(useAgentRunSource, /type AgentPromptSubmission = \{[\s\S]*contentBlocks\?: InputContentBlock\[\];/);
  assert.match(useAgentRunSource, /type QueuedAgentPrompt = Omit<AgentPromptSubmission, 'queueStatus'>/);
  assert.match(useAgentRunSource, /updateQueuedPrompt\(thread\.id, submission\.queueId, submission\)/);
  assert.match(useAgentRunSource, /submission\.queueStatus === 'preparing'/);
  assert.match(useAgentRunSource, /contentBlocks: requestContentBlocks/);
  assert.match(useAgentRunSource, /maybeStartQueuedPrompt\(context\)/);
  assert.match(useAgentRunSource, /event\.type === 'done' && !context\.cancelRequested/);
});

test('useAgentRun retains queued prompts after errors and strips transient history payloads', () => {
  assert.match(useAgentRunSource, /notifyQueuedPromptsRetained\(context\.threadId\)/);
  assert.match(useAgentRunSource, /autoStartAfterPreparationThreadIdsRef\.current\.delete\(threadId\)/);
  assert.match(useAgentRunSource, /userAttachments: stripTransientAttachmentData\(submission\.attachments\)/);
  assert.match(useAgentRunSource, /userContentBlocks: buildHistoryContentBlocks\(\{/);
  assert.doesNotMatch(useAgentRunSource, /userContentBlocks: requestContentBlocks/);
});

test('useClaudeRun avoids duplicating image base64 in run requests once contentBlocks are built', () => {
  const startRunSource = extractFunctionBody(useClaudeRunSource, 'startRun');

  assert.match(startRunSource, /contentBlocks: requestContentBlocks,/);
  assert.doesNotMatch(startRunSource, /buildRunImageAttachments/);
  assert.doesNotMatch(startRunSource, /attachments: requestImageAttachments/);
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

test('useClaudeRun starts the run request before refreshing Claude model options', () => {
  assert.match(useClaudeRunSource, /const runChannel = context\.channelId/);
  assert.match(useClaudeRunSource, /const latestModels = context\.channelId/);
  assert.match(useClaudeRunSource, /const previousModels = latestModels;/);
  assert.match(
    useClaudeRunSource,
    /resolveRunModelSelection\(\s*runModelCandidate,\s*latestModels,\s*fallbackModelId,\s*previousModels,\s*\)/,
  );
  assert.match(useClaudeRunSource, /model: requestModel,/);
  const startRunSource = extractFunctionBody(useClaudeRunSource, 'startRun');
  const fetchRunIndex = startRunSource.indexOf("fetch('/api/claude/run'");
  const refreshModelsIndex = startRunSource.indexOf('void loadClaudeModels()');
  assert.ok(fetchRunIndex > -1);
  assert.ok(refreshModelsIndex > -1);
  assert.ok(fetchRunIndex < refreshModelsIndex);
  assert.doesNotMatch(startRunSource, /await loadClaudeModels\(\)/);
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
  assert.match(conversationTurnSource, /<UserContentBlocks[\s\S]*?blocks=\{turn\.userContentBlocks \?\? \[\]\}[\s\S]*?onPreviewImage=\{setImagePreview\}[\s\S]*?\/>/);
  assert.doesNotMatch(conversationTurnSource, /user-message-attachment-kind/);
  // 文本块不渲染卡片；@文件（mention 来源）的 file_reference 仍隐藏，
  // 桌面端拖拽 / 文件框添加（attachment 来源）的 file_reference 需要显示成附件卡片。
  assert.match(conversationTurnSource, /if \(block\.type === 'text'\) \{\s*return false;\s*\}/);
  assert.match(
    conversationTurnSource,
    /if \(block\.type === 'file_reference'\) \{\s*return block\.source === 'attachment';\s*\}/,
  );
});

test('useClaudeRun restores active run content block summaries when reconnecting', () => {
  assert.match(useClaudeRunSource, /type ActiveRunInfo = \{[\s\S]*userContentBlocks\?: InputContentBlockSummary\[\];/);
  assert.match(useClaudeRunSource, /userContentBlocks:\s*activeRun\.userContentBlocks,/);
});

test('useClaudeRun renames untouched default empty threads without blocking the first message', () => {
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
    /void renameThread\(activeThreadSummary\.id, nextThreadTitle, \{ showToast: false \}\)/,
  );
  assert.doesNotMatch(useClaudeRunSource, /return \(await renameThread\(activeThreadSummary\.id, nextThreadTitle, \{ showToast: false \}\)\) \?\? activeThreadSummary;/);
});

test('ConversationTurn hides the internal guide command label from guided queue cards', () => {
  assert.match(conversationTurnSource, /function shouldShowSystemCommandCode\(item: SystemCommandItem\)/);
  assert.match(conversationTurnSource, /return item\.command !== 'guide';/);
  assert.match(conversationTurnSource, /\{shouldShowSystemCommandCode\(item\) \? <code>\{item\.command\}<\/code> : null\}/);
});

function extractFunctionBody(source: string, functionName: string) {
  const asyncSignature = `async function ${functionName}(`;
  const syncSignature = `function ${functionName}(`;
  const start = source.indexOf(asyncSignature) !== -1
    ? source.indexOf(asyncSignature)
    : source.indexOf(syncSignature);
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
