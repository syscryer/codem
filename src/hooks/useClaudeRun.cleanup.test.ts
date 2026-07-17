import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./useClaudeRun.ts', import.meta.url), 'utf8');

test('Claude run cleanup releases every RunContext resource without flushing queued updates', () => {
  const cleanupStart = source.indexOf('unmountedRef.current = true;');
  const cleanupEnd = source.indexOf('  }, []);', cleanupStart);
  const cleanup = source.slice(cleanupStart, cleanupEnd);

  assert.notEqual(cleanupStart, -1);
  assert.match(cleanup, /context\.abortController\?\.abort\(\)/);
  assert.match(cleanup, /context\.reconnectAbortController\?\.abort\(\)/);
  assert.match(cleanup, /cancelAnimationFrame\(context\.assistantTextFrame\)/);
  assert.match(cleanup, /cancelAnimationFrame\(context\.incrementalTurnFrame\)/);
  assert.match(cleanup, /clearTimeout\(context\.interruptFallbackTimer\)/);
  assert.match(cleanup, /runContextsByThreadIdRef\.current\.clear\(\)/);
  assert.match(cleanup, /runContextsByRunIdRef\.current\.clear\(\)/);
  assert.match(cleanup, /reconnectAbortControllersRef\.current\.clear\(\)/);
  assert.doesNotMatch(cleanup, /flushQueued/);
});

test('aborted runs do not write state after the Claude hook unmounts', () => {
  assert.match(source, /unmountedRef\.current = false;\s*return \(\) => \{\s*unmountedRef\.current = true;/);
  assert.match(source, /catch \(error\) \{\s*if \(unmountedRef\.current\) \{\s*return;/);
  assert.match(source, /if \(!unmountedRef\.current\) \{\s*removeRunContext\(context\);/);
});

test('active-run reconnect requests are cancellable during unmount and hard stop', () => {
  assert.match(source, /reconnectAbortControllersRef\.current\.set\(thread\.id, reconnectController\);/);
  assert.match(source, /signal: reconnectController\.signal/);
  assert.match(source, /context\.reconnectAbortController\?\.abort\(\);/);
});
