import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ConversationPane.tsx', import.meta.url), 'utf8');

test('ConversationPane passes stable callbacks to memoized turns', () => {
  assert.match(source, /function useLatestCallback/);

  const stableCallbacks = [
    'stableOpenWorkbenchPreview',
    'stableOpenOutputPath',
    'stableRevealOutputPath',
    'stableUndoChangedFiles',
    'stableSubmitRequestUserInput',
    'stableSubmitRuntimeRecoveryAction',
    'stableSubmitApprovalDecision',
  ];

  for (const callbackName of stableCallbacks) {
    assert.match(source, new RegExp(`const ${callbackName} = useLatestCallback\\(`));
    assert.match(source, new RegExp(`\\{${callbackName}\\}`));
  }
});

test('ConversationPane only ticks nowMs for the live running turn', () => {
  assert.match(source, /nowMs=\{isRunning && turn\.id === activeTurnId \? clockNowMs : 0\}/);
  assert.doesNotMatch(source, /nowMs=\{clockNowMs\}/);
});
