import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachToolResult,
  createToolStep,
  normalizeSubagentMessages,
  upsertSubagentText,
  upsertToolDelta,
} from './conversation.js';

test('normalizeSubagentMessages keeps recent bounded content', () => {
  const messages = normalizeSubagentMessages([
    'first',
    'x'.repeat(10_000),
    'last',
  ]);

  assert.ok(messages);
  assert.equal(messages?.at(-1), 'last');
  assert.ok((messages?.join('')?.length ?? 0) <= 24_000);
  assert.ok((messages?.some((message) => message.includes('[已截断]')) ?? false));
});

test('upsertSubagentText bounds repeated sidechain deltas', () => {
  const steps = [
    {
      id: 'agent-1',
      name: 'Agent',
      title: 'Agent',
      status: 'running' as const,
      toolUseId: 'agent-1',
      subMessages: ['hello'],
    },
  ];

  const next = upsertSubagentText(steps, 'agent-1', 'x'.repeat(8_000));
  const subMessages = next[0]?.subMessages ?? [];

  assert.equal(subMessages.length, 1);
  assert.ok(subMessages[0].length <= 4_000);
  assert.match(subMessages[0], /\[已截断\]/);
});

test('sidechain tool payloads are truncated while normal tool payloads stay intact', () => {
  const sidechainStep = createToolStep({
    type: 'tool-start',
    runId: 'run-1',
    blockIndex: 0,
    toolUseId: 'tool-1',
    parentToolUseId: 'agent-1',
    isSidechain: true,
    name: 'Write',
    input: { file_path: 'demo.ts', content: 'x'.repeat(12_000) },
  });
  assert.ok((sidechainStep.inputText?.length ?? 0) <= 6_000);
  assert.match(sidechainStep.inputText ?? '', /\[已截断\]/);

  const normalStep = createToolStep({
    type: 'tool-start',
    runId: 'run-1',
    blockIndex: 1,
    toolUseId: 'tool-2',
    isSidechain: false,
    name: 'Write',
    input: { file_path: 'demo.ts', content: 'x'.repeat(7_000) },
  });
  assert.ok((normalStep.inputText?.length ?? 0) > 6_000);

  const updated = upsertToolDelta(
    [sidechainStep],
    {
      type: 'tool-input-delta',
      runId: 'run-1',
      blockIndex: 0,
      toolUseId: 'tool-1',
      parentToolUseId: 'agent-1',
      isSidechain: true,
      text: 'y'.repeat(3_000),
    },
  );
  assert.ok((updated[0]?.inputText?.length ?? 0) <= 6_000);

  const withResult = attachToolResult(updated, {
    type: 'tool-result',
    runId: 'run-1',
    toolUseId: 'tool-1',
    parentToolUseId: 'agent-1',
    isSidechain: true,
    content: 'z'.repeat(12_000),
    isError: false,
  });
  assert.ok((withResult[0]?.resultText?.length ?? 0) <= 6_000);
  assert.match(withResult[0]?.resultText ?? '', /\[已截断\]/);
});
