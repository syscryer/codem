import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCompactSlashCommandSubmission,
  buildCostSlashCardResult,
  buildStatusSlashCardResult,
} from '../src/lib/claude-slash-system-commands';
import type { ConversationTurn } from '../src/types';

const sampleTurns: ConversationTurn[] = [
  {
    id: 'turn-1',
    userText: 'hello',
    workspace: 'D:\\project\\codem',
    assistantText: 'hi',
    tools: [],
    items: [],
    status: 'done',
    startedAtMs: 1,
    durationMs: 1200,
    inputTokens: 100,
    outputTokens: 200,
    totalCostUsd: 0.0123,
  },
  {
    id: 'turn-2',
    userText: '/compact',
    workspace: 'D:\\project\\codem',
    assistantText: '',
    tools: [],
    items: [],
    status: 'running',
    startedAtMs: 2,
    inputTokens: 40,
    outputTokens: 10,
    cacheReadInputTokens: 20,
  },
];

test('buildStatusSlashCardResult includes the core Claude runtime fields in the summary', () => {
  const result = buildStatusSlashCardResult({
    projectName: 'codem',
    threadTitle: 'slash commands',
    workspace: 'D:\\project\\codem',
    modelLabel: 'Sonnet 4',
    permissionLabel: 'Auto',
    sessionId: 'session-123',
    isRunning: true,
    cliHealth: {
      available: true,
      command: 'claude',
    },
    turns: sampleTurns,
  });

  assert.equal(result.cardType, 'status');
  assert.match(result.summary, /项目: codem/);
  assert.match(result.summary, /线程: slash commands/);
  assert.match(result.summary, /模型: Sonnet 4/);
  assert.match(result.summary, /权限: Auto/);
  assert.match(result.summary, /运行中: 是/);
  assert.deepEqual(result.details, {
    workspace: 'D:\\project\\codem',
    sessionId: 'session-123',
    cli: '就绪 (claude)',
    turnCount: 2,
  });
});

test('buildCostSlashCardResult aggregates token and cost totals from thread history', () => {
  const result = buildCostSlashCardResult({
    turns: sampleTurns,
  });

  assert.equal(result.cardType, 'cost');
  assert.match(result.summary, /输入: 140 tokens/);
  assert.match(result.summary, /输出: 210 tokens/);
  assert.match(result.summary, /缓存读取: 20 tokens/);
  assert.match(result.summary, /\$0.0123/);
  assert.deepEqual(result.details, {
    turnCount: 2,
    inputTokens: 140,
    outputTokens: 210,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 20,
    totalTokens: 370,
    totalCostUsd: 0.0123,
  });
});

test('buildCompactSlashCommandSubmission starts a compact card without resuming a stale session', () => {
  const result = buildCompactSlashCommandSubmission('/compact');

  assert.equal(result.prompt, '/compact');
  assert.equal(result.displayText, '/compact');
  assert.equal(result.initialActivity, '准备压缩上下文');
  assert.equal(result.reuseSession, false);
  assert.equal(result.initialAssistantItems.length, 1);
  assert.equal(result.initialAssistantItems[0]?.type, 'system-command');
  assert.equal(result.initialAssistantItems[0]?.cardType, 'compact');
});
