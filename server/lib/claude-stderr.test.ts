import assert from 'node:assert/strict';
import test from 'node:test';

import { parseClaudeApiRetryStatus, parseClaudeRetryStatus, splitClaudeStderrBuffer } from './claude-stderr.js';

test('parseClaudeRetryStatus detects Claude Code retry progress lines', () => {
  assert.deepEqual(parseClaudeRetryStatus('⎿  Retrying in 0s · attempt 1/10'), {
    attempt: 1,
    maxAttempts: 10,
    retryDelay: '0s',
    message: '连接重试中 1/10',
  });
});

test('parseClaudeRetryStatus tolerates ANSI codes and keeps non-zero retry delays', () => {
  assert.deepEqual(parseClaudeRetryStatus('\u001b[31mRetrying in 3s · attempt 2/10\u001b[0m'), {
    attempt: 2,
    maxAttempts: 10,
    retryDelay: '3s',
    message: '连接重试中 2/10，3s 后重试',
  });
});

test('parseClaudeRetryStatus ignores unrelated stderr lines', () => {
  assert.equal(parseClaudeRetryStatus('Debug mode enabled'), null);
});

test('parseClaudeApiRetryStatus detects stream-json retry progress events', () => {
  assert.deepEqual(parseClaudeApiRetryStatus({
    type: 'system',
    subtype: 'api_retry',
    attempt: 2,
    max_retries: 10,
    retry_delay_ms: 1120.08,
  }), {
    attempt: 2,
    maxAttempts: 10,
    retryDelay: '2s',
    message: '连接重试中 2/10，2s 后重试',
  });
});

test('parseClaudeApiRetryStatus ignores unrelated system events', () => {
  assert.equal(parseClaudeApiRetryStatus({ type: 'system', subtype: 'status' }), null);
});

test('splitClaudeStderrBuffer treats carriage returns as live status boundaries', () => {
  assert.deepEqual(splitClaudeStderrBuffer('Retrying in 0s · attempt 1/10\rRetrying in 1s'), {
    lines: ['Retrying in 0s · attempt 1/10'],
    rest: 'Retrying in 1s',
  });
});

test('splitClaudeStderrBuffer handles CRLF without producing empty duplicate lines', () => {
  assert.deepEqual(splitClaudeStderrBuffer('first\r\nsecond\nthird'), {
    lines: ['first', 'second'],
    rest: 'third',
  });
});
