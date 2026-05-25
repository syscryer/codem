import assert from 'node:assert/strict';
import test from 'node:test';

import { runConversationOutputFileMenuAction } from './conversation-output-file-interactions';

test('runConversationOutputFileMenuAction stops propagation before running menu action', () => {
  const calls: string[] = [];

  runConversationOutputFileMenuAction(
    {
      stopPropagation() {
        calls.push('stopPropagation');
      },
    },
    () => {
      calls.push('action');
    },
  );

  assert.deepEqual(calls, ['stopPropagation', 'action']);
});
