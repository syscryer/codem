import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aiChatModelPreference,
  ordinaryChatReasoningOptions,
  ordinaryChatSupportsWebSearch,
  updateAiChatModelPreference,
} from './ordinary-chat-capabilities.js';
import type { AiChatModel, AiChatProvider } from '../types.js';

function provider(protocol: AiChatProvider['protocol'], baseUrl: string): AiChatProvider {
  return {
    id: 'provider-1',
    name: '测试供应商',
    protocol,
    baseUrl,
    enabled: true,
    isDefault: true,
    apiKeySaved: true,
    models: [],
    createdAt: '',
    updatedAt: '',
  };
}

function model(modelId: string, capabilities: Record<string, unknown> = {}): AiChatModel {
  return {
    id: `row-${modelId}`,
    providerId: 'provider-1',
    modelId,
    displayName: modelId,
    enabled: true,
    isDefault: true,
    capabilities,
    createdAt: '',
    updatedAt: '',
  };
}

test('普通聊天模型偏好按模型独立保存并恢复', () => {
  const next = updateAiChatModelPreference({}, 'model-a', {
    thinkingEnabled: true,
    reasoningEffort: 'high',
  });
  assert.deepEqual(aiChatModelPreference(next, 'model-a'), {
    thinkingEnabled: true,
    reasoningEffort: 'high',
    webSearchEnabled: false,
  });
  assert.deepEqual(aiChatModelPreference(next, 'model-b'), {
    thinkingEnabled: false,
    reasoningEffort: 'medium',
    webSearchEnabled: false,
  });
});

test('思考等级按协议和模型能力收口，联网搜索只对原生支持的接口开放', () => {
  const openai = provider('openai_responses', 'https://api.openai.com/v1');
  assert.deepEqual(ordinaryChatReasoningOptions(openai, model('o3')), ['low', 'medium', 'high']);
  assert.equal(ordinaryChatSupportsWebSearch(openai, model('o3')), true);
  assert.deepEqual(
    ordinaryChatReasoningOptions(
      provider('anthropic_messages', 'https://api.deepseek.com/anthropic'),
      model('deepseek-v4-flash'),
    ),
    ['low', 'medium', 'high'],
  );
  assert.equal(
    ordinaryChatSupportsWebSearch(provider('openai_chat', 'https://api.openai.com/v1'), model('gpt-4o')),
    false,
  );
  assert.deepEqual(
    ordinaryChatReasoningOptions(provider('openai_chat', 'https://proxy.example/v1'), model('custom')),
    [],
  );
});

test('显式模型能力可以覆盖默认目录判断', () => {
  const customProvider = provider('openai_chat', 'https://proxy.example/v1');
  const customModel = model('custom', {
    supportedReasoningEfforts: ['low', 'high'],
    nativeWebSearch: true,
  });
  assert.deepEqual(ordinaryChatReasoningOptions(customProvider, customModel), ['low', 'high']);
  assert.equal(ordinaryChatSupportsWebSearch(customProvider, customModel), true);
});
