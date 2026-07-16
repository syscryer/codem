import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  attachToolResult,
  createToolStep,
  mergeUsageSnapshot,
  normalizeSubagentMessages,
  repairConversationTurn,
  upsertSubagentText,
  upsertToolDelta,
} from './conversation.js';
import {
  buildRequestUserInputAnswers,
  getRequestUserInputDraft,
  shouldShowRequestUserInputTextarea,
  updateRequestUserInputNote,
  updateRequestUserInputSelection,
} from '../components/ConversationTurn.js';
import { CLAUDE_CODE_PROVIDER_ID, OPENCODE_PROVIDER_ID } from '../constants.js';
import type { ConversationTurn } from '../types.js';

const conversationTurnSource = readFileSync(
  new URL('../components/ConversationTurn.tsx', import.meta.url),
  'utf8',
);

function inlineThinkingTurn(content: string): ConversationTurn {
  return {
    id: 'turn-inline-thinking',
    userText: 'hi',
    workspace: 'D:\\project\\codem',
    assistantText: content,
    tools: [],
    items: [{ id: 'text-1', type: 'text', text: content }],
    status: 'done',
  };
}

test('OpenCode think tags become a collapsible Thinking item instead of visible answer text', () => {
  const repaired = repairConversationTurn(
    inlineThinkingTurn('<think>先判断用户意图。</think>你好，有什么可以帮你的吗？'),
  );

  assert.deepEqual(repaired.items.map((item) => item.type), ['thinking', 'text']);
  assert.equal(repaired.items[0]?.type === 'thinking' ? repaired.items[0].text : '', '先判断用户意图。');
  assert.equal(
    repaired.items[1]?.type === 'text' ? repaired.items[1].text : '',
    '你好，有什么可以帮你的吗？',
  );
  assert.equal(repaired.assistantText, '你好，有什么可以帮你的吗？');
});

test('inline thinking normalization keeps legacy thinking tags and incomplete stream fragments', () => {
  const legacy = repairConversationTurn(
    inlineThinkingTurn('<thinking>分析中</thinking>最终回答'),
  );
  assert.deepEqual(legacy.items.map((item) => item.type), ['thinking', 'text']);
  assert.equal(legacy.assistantText, '最终回答');

  const incomplete = repairConversationTurn(inlineThinkingTurn('<think>仍在流式输出'));
  assert.deepEqual(incomplete.items.map((item) => item.type), ['text']);
  assert.equal(incomplete.assistantText, '<think>仍在流式输出');
});

test('OpenCode DCP message ids are hidden from completed and restored answer text', () => {
  const repaired = repairConversationTurn(
    inlineThinkingTurn(
      '我是 MiniMax-M3，由 MiniMax 开发。\n\n<dcp-message-id>m0004</dcp-message-id>',
    ),
  );

  assert.deepEqual(repaired.items.map((item) => item.type), ['text']);
  assert.equal(
    repaired.items[0]?.type === 'text' ? repaired.items[0].text : '',
    '我是 MiniMax-M3，由 MiniMax 开发。\n',
  );
  assert.equal(repaired.assistantText, '我是 MiniMax-M3，由 MiniMax 开发。\n');
});

test('DCP tag examples inside an answer remain visible while only the trailing marker is hidden', () => {
  const example = '<dcp-message-id>m0004</dcp-message-id>';
  const repaired = repairConversationTurn(
    inlineThinkingTurn(`这个标签 ${example} 是内部消息编号。\n\n${example}`),
  );

  assert.equal(
    repaired.items[0]?.type === 'text' ? repaired.items[0].text : '',
    `这个标签 ${example} 是内部消息编号。\n`,
  );
  assert.equal(repaired.assistantText, `这个标签 ${example} 是内部消息编号。\n`);
});

test('Thinking items reuse the completed-turn details control in its collapsed state', () => {
  assert.match(conversationTurnSource, /<details className="thinking-message">/);
  assert.doesNotMatch(conversationTurnSource, /<details className="thinking-message"\s+open/);
});

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

test('mergeUsageSnapshot keeps the previous context usage when a stream frame reports only zeros', () => {
  const turn: ConversationTurn = {
    id: 'turn-usage',
    userText: '',
    workspace: 'D:\\project\\codem',
    assistantText: '',
    tools: [],
    items: [],
    status: 'running',
    inputTokens: 75,
    outputTokens: 211,
    cacheCreationInputTokens: 43_113,
    cacheReadInputTokens: 0,
    contextUsage: {
      inputTokens: 75,
      outputTokens: 211,
      cacheCreationInputTokens: 43_113,
      cacheReadInputTokens: 0,
      modelContextWindow: 1_000_000,
      usageSource: 'message',
    },
  };

  const patch = mergeUsageSnapshot(turn, {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    modelContextWindow: 1_000_000,
    usageSource: 'context',
  });

  assert.deepEqual(patch.contextUsage, turn.contextUsage);
  assert.equal(patch.inputTokens, 75);
  assert.equal(patch.outputTokens, 211);
  assert.equal(patch.cacheCreationInputTokens, 43_113);
  assert.equal(patch.cacheReadInputTokens, 0);
});

test('single-select custom answers and preset options stay mutually exclusive', () => {
  const initial = {
    selectedOptions: { framework: [0] },
    notes: { framework: '' },
  };

  const custom = updateRequestUserInputNote(initial, 'framework', 'Svelte', false);
  assert.deepEqual(custom, {
    selectedOptions: { framework: [] },
    notes: { framework: 'Svelte' },
  });

  const selected = updateRequestUserInputSelection(custom, 'framework', 1, false);
  assert.deepEqual(selected, {
    selectedOptions: { framework: [1] },
    notes: { framework: '' },
  });
});

test('multi-select answers combine preset options with custom text', () => {
  const request = {
    questions: [
      {
        id: 'framework',
        question: '选择框架',
        options: [{ label: 'React' }, { label: 'Vue' }],
        multiSelect: true,
      },
    ],
  };
  const draft = updateRequestUserInputNote(
    {
      selectedOptions: { framework: [0, 1] },
      notes: { framework: '' },
    },
    'framework',
    'Svelte',
    true,
  );

  assert.deepEqual(draft.selectedOptions.framework, [0, 1]);
  assert.deepEqual(buildRequestUserInputAnswers(request, draft.selectedOptions, draft.notes), {
    framework: 'React\nVue\nSvelte',
  });
});

test('submitted custom answers restore alongside selected options', () => {
  const draft = getRequestUserInputDraft({
    questions: [
      {
        id: 'framework',
        question: '选择框架',
        options: [{ label: 'React' }, { label: 'Vue' }],
        multiSelect: true,
      },
    ],
    submittedAnswers: {
      framework: 'React\nSvelte',
    },
  });

  assert.deepEqual(draft, {
    selectedOptions: { framework: [0] },
    notes: { framework: 'Svelte' },
  });
});

test('custom answer visibility follows the provider capability boundary', () => {
  const optionsQuestion = {
    question: '选择方案',
    options: [{ label: '方案 A' }, { label: '方案 B' }],
  };

  assert.equal(shouldShowRequestUserInputTextarea(optionsQuestion, CLAUDE_CODE_PROVIDER_ID), true);
  assert.equal(shouldShowRequestUserInputTextarea(optionsQuestion, OPENCODE_PROVIDER_ID), false);
  assert.equal(shouldShowRequestUserInputTextarea({ ...optionsQuestion, isOther: true }, OPENCODE_PROVIDER_ID), true);
  assert.equal(shouldShowRequestUserInputTextarea({ question: '补充说明' }, OPENCODE_PROVIDER_ID), true);
});
