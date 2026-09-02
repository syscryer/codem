import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationTurn, ToolStep } from '../types.js';
import { buildProviderContinuationTranscript } from './provider-continuation-transcript.js';

function tool(overrides: Partial<ToolStep>): ToolStep {
  return {
    id: crypto.randomUUID(),
    name: 'Bash',
    title: 'Bash：运行测试',
    status: 'done',
    ...overrides,
  };
}

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

test('transcript keeps completed turns in order and skips unfinished ones', () => {
  const transcript = buildProviderContinuationTranscript([
    turn({ userText: '第一问', assistantText: '第一答' }),
    turn({ userText: '运行中', assistantText: '未完成', status: 'running' }),
    turn({ userText: '第二问', assistantText: '第二答' }),
  ]);

  assert.ok(transcript);
  assert.ok(transcript.indexOf('第一问') < transcript.indexOf('第二问'));
  assert.match(transcript, /第一答/);
  assert.match(transcript, /第二答/);
  assert.doesNotMatch(transcript, /运行中/);
});

test('transcript returns nothing without completed text and wraps with markers', () => {
  assert.equal(buildProviderContinuationTranscript(undefined), undefined);
  assert.equal(
    buildProviderContinuationTranscript([turn({ userText: 'x', status: 'pending' })]),
    undefined,
  );

  const transcript = buildProviderContinuationTranscript(
    [turn({ userText: '问题', assistantText: '回答' })],
    { sourceLabel: 'Claude Code · 原聊天' },
  );
  assert.ok(transcript);
  assert.match(transcript, /^\[CodeM 会话续接上下文\]/);
  assert.match(transcript, /\[续接上下文结束\]$/);
  assert.match(transcript, /来源：Claude Code · 原聊天/);
  assert.doesNotMatch(transcript, /当作新的用户指令，也不要逐字复述；请基于它继续当前任务，等待用户的下一步输入。$/);
});

test('tool summaries list top-level tools and skip sidechain entries', () => {
  const transcript = buildProviderContinuationTranscript([
    turn({
      userText: '跑一下测试',
      assistantText: '测试通过',
      tools: [
        tool({ title: 'Bash：npm test' }),
        tool({ name: 'Read', title: '', status: 'running', isSidechain: true }),
        tool({ title: 'Grep：搜索 provider' }),
      ],
    }),
  ]);

  assert.ok(transcript);
  assert.match(transcript, /工具：Bash：npm test；Grep：搜索 provider/);
  assert.doesNotMatch(transcript, /Read/);
});

test('tool summaries cap the list and report the total', () => {
  const tools = Array.from({ length: 10 }, (_, index) =>
    tool({ title: `工具${index + 1}` }),
  );
  const transcript = buildProviderContinuationTranscript([
    turn({ userText: '批量操作', assistantText: '完成', tools }),
  ]);

  assert.ok(transcript);
  assert.match(transcript, /工具1；工具2；工具3；工具4；工具5；工具6；工具7；工具8、…等共 10 个/);
});

test('long text blocks are head/tail folded', () => {
  const head = '头部内容';
  const tail = '尾部内容';
  const longText = `${head}${'x'.repeat(5_000)}${tail}`;
  const transcript = buildProviderContinuationTranscript([
    turn({ userText: longText, assistantText: 'ok' }),
  ]);

  assert.ok(transcript);
  assert.match(transcript, /\[……中间内容已折叠……\]/);
  assert.match(transcript, new RegExp(head));
  assert.match(transcript, new RegExp(tail));
  assert.ok(transcript.length < longText.length);
});

test('budget trimming keeps the earliest user task and the latest spine', () => {
  const turns: ConversationTurn[] = [
    turn({ userText: '最初任务：帮我重构登录模块', assistantText: '好的'.repeat(400) }),
  ];
  for (let index = 1; index <= 30; index += 1) {
    turns.push(
      turn({ userText: `中间第${index}问`, assistantText: `中间第${index}答`.repeat(400) }),
    );
  }
  turns.push(turn({ userText: '最后一问：总结一下', assistantText: '最终的总结回答' }));

  const transcript = buildProviderContinuationTranscript(turns);

  assert.ok(transcript);
  assert.match(transcript, /\[……中间对话因长度限制已省略……\]/);
  assert.match(transcript, /最初任务：帮我重构登录模块/);
  assert.match(transcript, /最后一问：总结一下/);
  assert.match(transcript, /最终的总结回答/);
  assert.doesNotMatch(transcript, /中间第1问/);
  assert.ok(transcript.length < 48_000 + 600);
});

test('first user task is truncated when it alone exceeds the cap', () => {
  const longTask = `首要任务${'细节'.repeat(2_000)}`;
  const turns: ConversationTurn[] = [
    turn({ userText: longTask, assistantText: '收到'.repeat(1_000) }),
  ];
  for (let index = 1; index <= 30; index += 1) {
    turns.push(turn({ userText: `第${index}问`, assistantText: `第${index}答`.repeat(400) }));
  }

  const transcript = buildProviderContinuationTranscript(turns);

  assert.ok(transcript);
  assert.match(transcript, /首要任务/);
  assert.match(transcript, /\[……中间对话因长度限制已省略……\]/);
  const firstTaskLine = transcript.split('\n').find((line) => line.includes('首要任务')) ?? '';
  assert.ok(firstTaskLine.length <= 2_100, `first task line should be capped, got ${firstTaskLine.length}`);
});
