import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationTurn } from '../types.js';
import { buildAgentChannelContinuityContext } from './agent-channel-continuity.js';

function turn(overrides: Partial<ConversationTurn>): ConversationTurn {
  return {
    id: crypto.randomUUID(),
    userText: '',
    workspace: 'D:/workspace',
    assistantText: '',
    tools: [],
    items: [],
    status: 'done',
    ...overrides,
  };
}

test('channel continuity keeps completed user and assistant text in chronological order', () => {
  const context = buildAgentChannelContinuityContext([
    turn({ userText: '第一问', assistantText: '第一答' }),
    turn({ userText: '运行中，不应注入', assistantText: '未完成', status: 'running' }),
    turn({ userText: '第二问', assistantText: '第二答' }),
  ]);

  assert.ok(context);
  assert.ok(context.indexOf('第一问') < context.indexOf('第二问'));
  assert.match(context, /第一答/);
  assert.match(context, /第二答/);
  assert.doesNotMatch(context, /运行中，不应注入/);
});

test('channel continuity is bounded and returns nothing without completed text', () => {
  const empty = buildAgentChannelContinuityContext([
    turn({ userText: 'pending', assistantText: '', status: 'pending' }),
  ]);
  assert.equal(empty, undefined);

  const context = buildAgentChannelContinuityContext([
    turn({ userText: 'x'.repeat(20_000), assistantText: 'y'.repeat(20_000) }),
  ]);
  assert.ok(context);
  assert.ok(context.length <= 24_100);
  assert.match(context, /较早内容已截断/);
});
