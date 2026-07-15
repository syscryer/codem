import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePromptSubmissionSessionId } from '../src/lib/claude-run-session';

test('resolvePromptSubmissionSessionId reuses the thread session by default', () => {
  assert.equal(resolvePromptSubmissionSessionId('session-123'), 'session-123');
});

test('resolvePromptSubmissionSessionId skips resume when reuseSession is false', () => {
  assert.equal(resolvePromptSubmissionSessionId('session-123', false), undefined);
});

test('resolvePromptSubmissionSessionId normalizes blank session ids to undefined', () => {
  assert.equal(resolvePromptSubmissionSessionId('   '), undefined);
});
