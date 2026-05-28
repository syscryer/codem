import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentTaskPreview, isAgentTaskToolName } from './agent-task-preview.js';
import type { ToolStep } from '../types.js';

test('isAgentTaskToolName identifies agent task tool names without parsing payloads', () => {
  assert.equal(isAgentTaskToolName('Agent'), true);
  assert.equal(isAgentTaskToolName('Task'), true);
  assert.equal(isAgentTaskToolName('task'), true);
  assert.equal(isAgentTaskToolName('tool_result'), false);
  assert.equal(isAgentTaskToolName('Read'), false);
});

test('buildAgentTaskPreview extracts subagent identity, metrics, and child tool facts', () => {
  const tool: ToolStep = {
    id: 'agent-tool-1',
    name: 'Task',
    title: 'Agent(检查布局)',
    status: 'done',
    toolUseId: 'toolu_agent_1',
    inputText: JSON.stringify({
      subagent_type: 'code-reviewer',
      description: '检查右侧工作台窄窗口遮挡问题，并给出修复建议',
      prompt: [
        '请先定位右侧工作台在窄窗口下被遮挡的真实原因。',
        '重点检查 grid 布局、右侧宽度夹取逻辑，以及收起按钮是否会被压出视口。',
        '最后给出一个尽量小的修复方案并补回测试。',
      ].join(' '),
      taskId: 'task-123',
    }),
    resultText: [
      '发现布局 grid minmax 导致右侧被挤出。',
      'src/App.tsx',
      '<usage>',
      'tool_uses: 8',
      'total_tokens: 12400',
      'duration_ms: 91000',
      '</usage>',
    ].join('\n'),
    subMessages: ['阶段一：定位布局入口。'],
    subtools: [
      {
        id: 'read-1',
        name: 'Read',
        title: 'Read(src/App.tsx)',
        status: 'done',
        resultText: '读取完成',
      },
      {
        id: 'edit-1',
        name: 'Edit',
        title: 'Edit(src/styles.css)',
        status: 'error',
        resultText: 'Error: no match',
      },
    ],
  };

  const preview = buildAgentTaskPreview(tool);

  assert.ok(preview);
  assert.equal(preview.agentType, 'code-reviewer');
  assert.equal(preview.taskDescription, '检查右侧工作台窄窗口遮挡问题，并给出修复建议');
  assert.equal(
    preview.promptText,
    '请先定位右侧工作台在窄窗口下被遮挡的真实原因。 重点检查 grid 布局、右侧宽度夹取逻辑，以及收起按钮是否会被压出视口。 最后给出一个尽量小的修复方案并补回测试。',
  );
  assert.equal(preview.statusLabel, '完成');
  assert.equal(preview.statusTone, 'completed');
  assert.deepEqual(preview.metrics, ['8 个工具', '12.4k tokens', '1m 31s']);
  assert.equal(preview.summary, '检查右侧工作台窄窗口遮挡问题，并给出修复建议 · 8 个工具 · 12.4k tokens · 1m 31s');
  assert.deepEqual(preview.identifiers, [
    { label: 'taskId', value: 'task-123' },
    { label: 'toolUseId', value: 'toolu_agent_1' },
  ]);
  assert.deepEqual(preview.files, ['src/App.tsx']);
  assert.equal(preview.resultText, '发现布局 grid minmax 导致右侧被挤出。\nsrc/App.tsx');
  assert.equal(preview.subtools.length, 2);
});

test('buildAgentTaskPreview keeps agent running until the final result arrives', () => {
  const preview = buildAgentTaskPreview({
    id: 'agent-tool-1',
    name: 'Task',
    title: 'Agent(检查布局)',
    status: 'done',
    toolUseId: 'toolu_agent_1',
    inputText: JSON.stringify({
      subagent_type: 'code-reviewer',
      description: '检查右侧工作台窄窗口遮挡问题',
      prompt: '请定位真实原因并给出修复方案。',
    }),
    subtools: [
      {
        id: 'read-1',
        name: 'Read',
        title: 'Read(src/App.tsx)',
        status: 'done',
        resultText: '读取完成',
      },
    ],
  });

  assert.ok(preview);
  assert.equal(preview.statusLabel, '运行中');
  assert.equal(preview.statusTone, 'running');
  assert.equal(preview.summary, '检查右侧工作台窄窗口遮挡问题 · 1 个工具');
});

test('buildAgentTaskPreview hides noisy successful orphan tool results from child timeline', () => {
  const preview = buildAgentTaskPreview({
    id: 'agent-tool-1',
    name: 'Task',
    title: 'Agent(修改小游戏)',
    status: 'done',
    toolUseId: 'toolu_agent_1',
    inputText: JSON.stringify({
      subagent_type: 'worker',
      description: '修改贪吃蛇小游戏',
      prompt: '直接编辑 index.html。',
    }),
    resultText: '已完成修改。',
    subtools: [
      {
        id: 'read-1',
        name: 'Read',
        title: 'Read(index.html)',
        status: 'done',
        resultText: '<!DOCTYPE html>',
      },
      {
        id: 'orphan-result-1',
        name: 'tool_result',
        title: '工具返回结果',
        status: 'done',
        resultText: 'The file index.html has been updated successfully.',
      },
      {
        id: 'orphan-result-1b',
        name: 'tool_result',
        title: '工具返回结果',
        status: 'done',
        resultText: '318 .touch-btn.up { grid-area: up; }',
      },
      {
        id: 'orphan-result-2',
        name: 'tool_result',
        title: '工具返回异常',
        status: 'error',
        resultText: '<tool_use_error>String to replace not found in file.',
        isError: true,
      },
    ],
  });

  assert.ok(preview);
  assert.equal(preview.hiddenSubtoolCount, 2);
  assert.deepEqual(preview.collapsedSubtools.map((subtool) => subtool.summary), [
    'The file index.html has been updated successfully.',
    '318 .touch-btn.up { grid-area: up; }',
  ]);
  assert.deepEqual(preview.collapsedSubtoolSummary, [
    'The file index.html has been updated successfully.',
    '318 .touch-btn.up { grid-area: up; }',
  ]);
  assert.deepEqual(
    preview.subtools.map((subtool) => subtool.title),
    ['Read(index.html)', '工具返回异常'],
  );
});

test('buildAgentTaskPreview ignores non-agent tools', () => {
  const preview = buildAgentTaskPreview({
    id: 'read-1',
    name: 'Read',
    title: 'Read(src/App.tsx)',
    status: 'done',
  });

  assert.equal(preview, null);
});
