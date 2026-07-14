import test from 'node:test';
import assert from 'node:assert/strict';
import { chatDetailToTurns, normalizeAiUsageEvent } from '../hooks/useOrdinaryChat.js';
import type { AiChatDetail, AiChatMessage } from '../types.js';

function message(input: Partial<AiChatMessage> & Pick<AiChatMessage, 'id' | 'role' | 'content'>): AiChatMessage {
  return {
    chatId: 'chat-1',
    turnId: 'turn-1',
    itemSort: input.role === 'user' ? 0 : 1,
    reasoningContent: '',
    contentBlocks: [],
    status: 'done',
    citations: [],
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:01.000Z',
    ...input,
  };
}

function detail(reasoningContent: string): AiChatDetail {
  return {
    summary: {
      id: 'chat-1',
      title: '测试思考',
      selectedMcpIds: [],
      selectedSkillIds: [],
      selectedKnowledgeIds: [],
      messageCount: 2,
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:01.000Z',
    },
    messages: [
      message({ id: 'user-1', role: 'user', content: '为什么？' }),
      message({
        id: 'assistant-1',
        role: 'assistant',
        content: '因为这是最终答案。',
        reasoningContent,
        providerName: 'MiniMax',
        modelName: 'MiniMax M3',
      }),
    ],
    toolCalls: [],
  };
}

test('ordinary chat history restores provider reasoning before the final answer', () => {
  const [turn] = chatDetailToTurns(detail('先分析问题，再组织答案。'));

  assert.deepEqual(turn?.items.map((item) => item.type), ['thinking', 'text']);
  assert.equal(turn?.items[0]?.type === 'thinking' ? turn.items[0].text : '', '先分析问题，再组织答案。');
  assert.equal(turn?.assistantText, '因为这是最终答案。');
});

test('ordinary chat history omits empty reasoning blocks', () => {
  const [turn] = chatDetailToTurns(detail(''));

  assert.deepEqual(turn?.items.map((item) => item.type), ['text']);
});

test('ordinary chat ignores null usage frames from OpenAI-compatible providers', () => {
  assert.equal(normalizeAiUsageEvent('run-1', null), null);
});

test('ordinary chat normalizes usage aliases from supported provider protocols', () => {
  for (const usage of [
    { input_tokens: 12, output_tokens: 4 },
    { prompt_tokens: 12, completion_tokens: 4 },
    { promptTokenCount: 12, candidatesTokenCount: 4 },
  ]) {
    assert.deepEqual(normalizeAiUsageEvent('run-1', usage), {
      type: 'usage',
      runId: 'run-1',
      usageSource: 'result',
      inputTokens: 12,
      outputTokens: 4,
      cacheCreationInputTokens: undefined,
      cacheReadInputTokens: undefined,
    });
  }
});
