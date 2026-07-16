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
    'stableEditUserMessage',
    'stableDeleteTurn',
    'stableRegenerateTurn',
  ];

  for (const callbackName of stableCallbacks) {
    assert.match(source, new RegExp(`const ${callbackName} = useLatestCallback\\(`));
    assert.match(source, new RegExp(callbackName));
  }
});

test('ConversationPane automatically pages older turns near the top and preserves the viewport', () => {
  assert.match(source, /const INITIAL_VISIBLE_TURN_COUNT = 20;/);
  assert.match(source, /const VISIBLE_TURN_PAGE_SIZE = 20;/);
  assert.match(source, /const HISTORY_AUTO_LOAD_THRESHOLD_PX = 240;/);
  assert.match(source, /const visibleTurns = allTurns\.slice\(firstVisibleTurnIndex\);/);
  assert.match(source, /transcript\.scrollTop > HISTORY_AUTO_LOAD_THRESHOLD_PX/);
  assert.match(source, /scrollHeight: transcript\.scrollHeight/);
  assert.match(source, /transcript\.scrollTop = anchor\.scrollTop \+ Math\.max\(0, addedHeight\)/);
  assert.doesNotMatch(source, /显示更早消息/);
  assert.doesNotMatch(source, /activeThread\.turns\.map\(\(turn, index\)/);
});

test('ConversationPane only ticks nowMs for the live running turn', () => {
  assert.match(source, /nowMs=\{isRunning && turn\.id === activeTurnId \? clockNowMs : 0\}/);
  assert.doesNotMatch(source, /nowMs=\{clockNowMs\}/);
});

test('ConversationPane only builds previous turn history for the undoable change turn', () => {
  assert.match(source, /const EMPTY_PREVIOUS_TURNS: ConversationTurn\[\] = \[\];/);
  assert.match(
    source,
    /const canUndoChangedFiles = turn\.id === latestChangedFilesTurnId && undoneTurnIds\[turn\.id\] !== true;/,
  );
  assert.match(
    source,
    /const previousTurns = canUndoChangedFiles\s*\?\s*activeThread\.turns\.slice\(0, index\)\s*:\s*EMPTY_PREVIOUS_TURNS;/,
  );
  assert.doesNotMatch(source, /previousTurns=\{activeThread\.turns\.slice\(0, index\)\}/);
});
