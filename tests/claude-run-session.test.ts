import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { resolvePromptSubmissionSessionId } from '../src/lib/claude-run-session';

const serverSource = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');

test('resolvePromptSubmissionSessionId reuses the thread session by default', () => {
  assert.equal(resolvePromptSubmissionSessionId('session-123'), 'session-123');
});

test('resolvePromptSubmissionSessionId skips resume when reuseSession is false', () => {
  assert.equal(resolvePromptSubmissionSessionId('session-123', false), undefined);
});

test('resolvePromptSubmissionSessionId normalizes blank session ids to undefined', () => {
  assert.equal(resolvePromptSubmissionSessionId('   '), undefined);
});

test('run endpoint normalizes request contentBlocks before streaming and only rejects truly empty submissions', () => {
  assert.match(serverSource, /request\.body\?\.contentBlocks/);
  assert.match(serverSource, /let contentBlocks:/);
  assert.match(serverSource, /try\s*\{\s*contentBlocks = normalizeClaudeRunContentBlocks\(\{/s);
  assert.match(serverSource, /prompt,\s*[\r\n\s]*imageAttachments,\s*[\r\n\s]*contentBlocks:\s*request\.body\?\.contentBlocks,/);
  assert.match(serverSource, /response\.status\(400\)\.send\(error instanceof Error \? error\.message : '输入内容无效'\);/);
  assert.match(serverSource, /if \(!toolResult && contentBlocks\.length === 0\) \{/);
  assert.match(serverSource, /response\.status\(400\)\.send\('发送内容不能为空'\);/);
  assert.match(serverSource, /createClaudeStream\(\{[\s\S]*prompt,[\s\S]*contentBlocks,[\s\S]*toolResult,/);
});

test('guide endpoint normalizes request contentBlocks and calls submitRunGuidePrompt with 4 arguments', () => {
  assert.match(serverSource, /app\.post\('\/api\/claude\/run\/:runId\/guide'/);
  assert.match(serverSource, /const guideContentBlocks = normalizeClaudeRunContentBlocks\(\{/);
  assert.match(serverSource, /prompt,\s*[\r\n\s]*imageAttachments:\s*guideImageAttachments,\s*[\r\n\s]*contentBlocks:\s*request\.body\?\.contentBlocks,/);
  assert.match(
    serverSource,
    /submitRunGuidePrompt\(request\.params\.runId,\s*prompt,\s*guideImageAttachments,\s*guideContentBlocks\)/,
  );
});
