import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentMuxRun, AgentMuxRunEvent } from './agent-mux-api.js';
import { buildAgentMuxConversationTurn } from './agent-mux-events.js';
import type { AgentRunEvent } from '../types.js';

const run: AgentMuxRun = {
  id: 'mux-run-1',
  caller: 'CodeM',
  target: 'OpenAI Codex',
  profile: 'Codex / sol',
  skill: 'codem-agent-mux',
  status: 'completed',
  duration: '00:04',
  started: '刚刚',
  prompt: '检查当前改动',
  summary: '完成',
  workingDirectory: 'D:/workspace',
};

function stored(id: number, eventType: string, message: string, payload?: AgentRunEvent): AgentMuxRunEvent {
  return {
    id,
    runId: run.id,
    eventType,
    message,
    payload,
    createdAt: `2026-08-05T06:00:0${id}.000Z`,
  };
}

test('标准 AgentRunEvent 使用聊天 reducer 重建文本和工具顺序', () => {
  const transcript = buildAgentMuxConversationTurn(run, [
    stored(1, 'delta', '先读取。', { type: 'delta', runId: 'provider-run-1', text: '先读取。' }),
    stored(2, 'tool-start', '调用工具：Read', {
      type: 'tool-start',
      runId: 'provider-run-1',
      blockIndex: 0,
      toolUseId: 'tool-1',
      name: 'Read',
      input: { file_path: 'README.md' },
    }),
    stored(3, 'tool-result', '工具返回结果', {
      type: 'tool-result',
      runId: 'provider-run-1',
      toolUseId: 'tool-1',
      content: 'ok',
    }),
    stored(4, 'delta', '已完成。', { type: 'delta', runId: 'provider-run-1', text: '已完成。' }),
    stored(5, 'done', '运行完成', {
      type: 'done',
      runId: 'provider-run-1',
      result: '先读取。已完成。',
      stopReason: 'end_turn',
    }),
  ]);

  assert.equal(transcript.status, 'done');
  assert.equal(transcript.assistantText, '先读取。已完成。');
  assert.deepEqual(transcript.items.map((item) => item.type), ['text', 'tool', 'text']);
  assert.equal(transcript.tools[0]?.resultText, 'ok');
  assert.equal(transcript.workspace, 'D:/workspace');
});

test('旧版纯文本事件仍可迁移回聊天展示模型', () => {
  const transcript = buildAgentMuxConversationTurn({ ...run, status: 'cancelled' }, [
    stored(1, 'output', '## 审查结果\n\n'),
    stored(2, 'output', '- 第一项\n'),
    stored(3, 'tool', '调用工具：Bash'),
    stored(4, 'cancelled', '用户取消了运行'),
  ]);

  assert.equal(transcript.status, 'stopped');
  assert.equal(transcript.assistantText, '## 审查结果\n\n- 第一项\n');
  assert.deepEqual(transcript.items.map((item) => item.type), ['text', 'tool']);
  assert.equal(transcript.tools[0]?.name, 'Bash');
});
