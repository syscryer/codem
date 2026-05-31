import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const composerSource = readFileSync(new URL('../src/components/Composer.tsx', import.meta.url), 'utf8');
const indicatorSource = readFileSync(
  new URL('../src/components/ComposerContextIndicator.tsx', import.meta.url),
  'utf8',
);
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const typesSource = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const workspaceStateSource = readFileSync(new URL('../src/hooks/useWorkspaceState.ts', import.meta.url), 'utf8');

test('composer context panel auto-refreshes stale native /context without a manual refresh control', () => {
  assert.match(typesSource, /export type ClaudeContextSnapshot/);
  assert.match(appSource, /claudeContextByThreadId/);
  assert.match(appSource, /fetch\(`\/api\/claude\/runtime\/\$\{encodeURIComponent\(threadId\)\}\/context`/);
  assert.match(indicatorSource, /会话详情/);
  assert.match(composerSource, /shouldRefreshNativeContextOnOpen/);
  assert.match(composerSource, /shouldRefreshClaudeContextOnOpen/);
  assert.match(composerSource, /onRefreshClaudeContext/);
  assert.match(indicatorSource, /shouldRefreshClaudeContextOnOpen/);
  assert.match(indicatorSource, /onRefreshClaudeContext/);
  assert.match(indicatorSource, /nextOpen && shouldRefreshClaudeContextOnOpen && nativeContextStatus !== 'loading'/);
  assert.doesNotMatch(indicatorSource, /composer-context-refresh-icon/);
  assert.doesNotMatch(indicatorSource, /composer-context-native-error/);
  assert.doesNotMatch(indicatorSource, /刷新上下文/);
  assert.doesNotMatch(indicatorSource, /当前会话暂时无法读取上下文/);
  assert.match(indicatorSource, /nativeSummary\.mcpToolCount/);
  assert.doesNotMatch(indicatorSource, /nativeContext\.markdown/);
  assert.doesNotMatch(indicatorSource, /composer-context-native-categories/);
  assert.doesNotMatch(indicatorSource, /nativeSummary\.categories/);
  assert.doesNotMatch(indicatorSource, /formatOptionalTokenNumber/);
  assert.match(indicatorSource, /composer-context-card-breakdown/);
  assert.match(indicatorSource, /缓存读取/);
  assert.match(indicatorSource, /缓存写入/);
  assert.doesNotMatch(indicatorSource, /composer-context-cache-row/);
});

test('slash /context card requests native stream-json context and passes only the snapshot summary to the card builder', () => {
  assert.match(appSource, /fetchClaudeRuntimeContext\(thread\.id/);
  assert.match(appSource, /nativeContext/);
  assert.match(appSource, /summary:\s*contextError\s*\?/);
  assert.match(appSource, /setClaudeContextByThreadId/);
  assert.doesNotMatch(appSource, /showToast\(contextError/);
  assert.doesNotMatch(indicatorSource, /showRefreshButton/);
  assert.doesNotMatch(indicatorSource, /Boolean\(nativeContext\) \|\|/);
});

test('thread history context snapshot is used as context panel data', () => {
  assert.match(typesSource, /claudeContext\?: ClaudeContextSnapshot/);
  assert.match(workspaceStateSource, /payload\.claudeContext \?\? existing\.claudeContext/);
  assert.match(appSource, /historyClaudeContextState/);
  assert.match(appSource, /activeThread\?\.claudeContext/);
  assert.match(appSource, /claudeContextByThreadId\[activeThreadId\] \?\? historyClaudeContextState/);
});

test('context errors are normalized into user-facing copy', () => {
  assert.match(appSource, /formatClaudeContextDisplayError/);
  assert.match(appSource, /当前线程还没有可读取的上下文，请先发送一轮消息。/);
  assert.match(appSource, /读取上下文超时，请稍后重试。/);
  assert.match(appSource, /当前会话还在处理中，稍后再查看上下文。/);
});
