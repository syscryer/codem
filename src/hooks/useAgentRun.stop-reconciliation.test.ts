import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./useAgentRun.ts', import.meta.url), 'utf8');

test('cancel fallback only releases the frontend run after backend runtime reconciliation', () => {
  const stopStart = source.indexOf('async function stopRun(');
  const nextFunction = source.indexOf('async function submitRequestUserInput(', stopStart);
  const stopFlow = source.slice(stopStart, nextFunction);

  assert.match(stopFlow, /void reconcileCancelledRun\(context\)/);
  assert.match(stopFlow, /fetch\(`\/api\/agents\/runtime\/\$\{encodeURIComponent\(context\.threadId\)\}`\)/);
  assert.match(stopFlow, /status\.phase === 'absent'/);
  assert.match(stopFlow, /status\.currentRunId !== context\.runId && status\.phase !== 'running'/);
  assert.match(stopFlow, /if \(oldRunReleased\) \{[\s\S]*settleRunWithoutTerminal\(context, '已停止'\)/);
  assert.doesNotMatch(
    stopFlow,
    /cancelFallbackTimer = window\.setTimeout\([\s\S]*?settleRunWithoutTerminal\(context, '已停止'\)[\s\S]*?AGENT_CANCEL_FALLBACK_MS/,
  );
});

test('cancel before run id assignment settles when no backend runtime exists', () => {
  assert.match(source, /runId: ''/);
  assert.match(source, /const oldRunReleased = status\.phase === 'absent' \|\|/);
});

test('an unconfirmed cancel can be retried instead of silently becoming stopped', () => {
  const reconcileStart = source.indexOf('async function reconcileCancelledRun(');
  const nextFunction = source.indexOf('async function submitRequestUserInput(', reconcileStart);
  const reconcile = source.slice(reconcileStart, nextFunction);

  assert.match(reconcile, /context\.cancelRequestSent = false/);
  assert.match(reconcile, /setRunInterrupting\(context, false\)/);
  assert.match(reconcile, /仍在停止，可重试停止/);
  assert.match(reconcile, /停止状态未确认，可重试停止/);
});
