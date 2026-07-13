import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const composerSource = readFileSync(new URL('../components/Composer.tsx', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../hooks/useWorkspaceState.ts', import.meta.url), 'utf8');
const agentRunSource = readFileSync(new URL('../hooks/useAgentRun.ts', import.meta.url), 'utf8');

test('new chat persists provider ownership and locks the selector after creation', () => {
  assert.match(workspaceSource, /providerId\?: string/);
  assert.match(workspaceSource, /\{ providerId: options\.providerId \}/);
  assert.match(appSource, /providerId=\{activeProviderId\}/);
  assert.match(appSource, /canSelectProvider=\{!activeThreadSummary\}/);
  assert.match(composerSource, /Provider 在聊天创建后锁定/);
});

test('App routes Grok and Codex through the generic hook without changing the Claude hook', () => {
  assert.match(appSource, /resolveChatRuntimeKind\(activeProviderId\)/);
  assert.match(appSource, /activeThreadRuntimeKind === 'generic' \? activeThreadId : null/);
  assert.match(appSource, /activeProviderId === OPENAI_CODEX_PROVIDER_ID/);
  assert.match(appSource, /return submitClaudePrompt\(submission\)/);
  assert.match(appSource, /return submitGenericAgentPrompt\(submission\)/);
  assert.match(agentRunSource, /fetch\('\/api\/agents\/run'/);
  assert.match(agentRunSource, /contentBlocks: requestContentBlocks/);
  assert.doesNotMatch(agentRunSource, /\/api\/claude\/run/);
});

test('generic Agent composer follows provider attachment capabilities and supports queued turns', () => {
  assert.match(appSource, /activeProviderCapabilities\.input\.images === 'supported'/);
  assert.match(appSource, /activeProviderCapabilities\.input\.fileReferences === 'supported'/);
  assert.match(appSource, /allowAttachments=\{allowAgentAttachments\}/);
  assert.match(appSource, /supportsQueue=\{activeUsesClaude \|\| activeUsesGenericAgent\}/);
  assert.match(composerSource, /agent === 'claude' \? \(/);
  assert.match(composerSource, /agentModelCatalog\?\.models\.map/);
  assert.match(composerSource, /agent === 'codex' && agentReasoningEffortOptions\.length > 0/);
  assert.match(composerSource, /onRetryAgentModels/);
  assert.match(composerSource, /textOnlyInputMessage = `\$\{providerName\} 当前不支持附件输入/);
  assert.match(composerSource, /providerId === OPENAI_CODEX_PROVIDER_ID/);
  assert.match(composerSource, /isRunning && !supportsQueue/);
  assert.match(agentRunSource, /type QueuedAgentPrompt = AgentPromptSubmission/);
  assert.match(agentRunSource, /maybeStartQueuedPrompt\(context\)/);
});

test('generic Agent history stores attachment metadata without transient payloads', () => {
  assert.match(agentRunSource, /buildRunContentBlocks/);
  assert.match(agentRunSource, /userAttachments: stripTransientAttachmentData\(submission\.attachments\)/);
  assert.match(agentRunSource, /userContentBlocks: buildHistoryContentBlocks\(\{/);
  assert.doesNotMatch(agentRunSource, /userContentBlocks: requestContentBlocks/);
});

test('generic model and reasoning choices flow through create, metadata, and run requests', () => {
  assert.match(workspaceSource, /reasoningEffort\?: string \| null/);
  assert.match(workspaceSource, /\{ reasoningEffort: options\.reasoningEffort \}/);
  assert.match(agentRunSource, /model: context\.model/);
  assert.match(agentRunSource, /reasoningEffort: context\.reasoningEffort/);
  assert.match(agentRunSource, /model: nextModel === DEFAULT_MODEL_VALUE \? null : nextModel/);
});

test('generic hook does not persist raw events or submitted secret answers', () => {
  assert.doesNotMatch(agentRunSource, /appendRawEvent/);
  assert.doesNotMatch(agentRunSource, /submittedAnswers/);
  assert.match(agentRunSource, /原始内容未写入日志/);
  assert.match(agentRunSource, /pendingUserInputRequests: .*\.filter\(/s);
});
