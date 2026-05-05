import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('getThreadHistory keeps stored cost metrics when transcript lacks total_cost_usd', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-history-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const transcriptPath = path.join(root, 'transcript.jsonl');

  try {
    mkdirSync(repo, { recursive: true });
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
          },
          timestamp: '2026-05-05T00:00:00.000Z',
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'world' }],
            usage: {
              input_tokens: 10,
              output_tokens: 20,
            },
          },
          timestamp: '2026-05-05T00:00:01.000Z',
        }),
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          duration_ms: 1200,
          usage: {
            input_tokens: 10,
            output_tokens: 20,
          },
          timestamp: '2026-05-05T00:00:02.000Z',
        }),
      ].join('\n'),
      'utf8',
    );

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { createProject, createThread, saveThreadHistory, updateThreadMetadata, getThreadHistory } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});
          const threadId = createThread(projectId, 'history-cost');
          saveThreadHistory(threadId, [{
            id: 'turn-1',
            userText: 'hello',
            assistantText: 'world',
            workspace: ${JSON.stringify(repo)},
            status: 'done',
            items: [],
            tools: [],
            inputTokens: 10,
            outputTokens: 20,
            totalCostUsd: 0.25,
          }]);
          updateThreadMetadata(threadId, {
            sessionId: 'session-123',
            workingDirectory: ${JSON.stringify(repo)},
          });
          const history = getThreadHistory(threadId);
          console.log(JSON.stringify(history.turns.map((turn) => ({
            id: turn.id,
            inputTokens: turn.inputTokens,
            outputTokens: turn.outputTokens,
            totalCostUsd: turn.totalCostUsd,
          }))));
        `,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          LOCALAPPDATA: appData,
          APPDATA: '',
          USERPROFILE: root,
        },
      },
    );

    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.deepEqual(JSON.parse(child.stdout.trim()), [
      {
        id: 'turn-1',
        inputTokens: 10,
        outputTokens: 20,
        totalCostUsd: 0.25,
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('getThreadHistory restores AskUserQuestion answers from updatedInput-style tool results', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-history-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const sessionId = 'session-ask-1';
  const transcriptPath = path.join(
    root,
    '.claude',
    'projects',
    path.resolve(repo).replace(/[^a-zA-Z0-9]/g, '-'),
    `${sessionId}.jsonl`,
  );

  try {
    mkdirSync(path.dirname(transcriptPath), { recursive: true });
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'build me a snake game' }],
          },
          timestamp: '2026-05-05T00:00:00.000Z',
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_question_1',
                name: 'AskUserQuestion',
                input: {
                  title: '需要你的选择',
                  questions: [
                    {
                      id: 'tech_stack',
                      question: '你想用什么技术栈做这个坦克大战?',
                      options: [
                        { label: 'Python + Pygame' },
                        { label: 'HTML5 Canvas + JS' },
                      ],
                    },
                  ],
                },
              },
            ],
          },
          timestamp: '2026-05-05T00:00:01.000Z',
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_question_1',
                content: JSON.stringify({
                  questions: [
                    {
                      id: 'tech_stack',
                      question: '你想用什么技术栈做这个坦克大战?',
                      options: [
                        { label: 'Python + Pygame' },
                        { label: 'HTML5 Canvas + JS' },
                      ],
                    },
                  ],
                  answers: {
                    '你想用什么技术栈做这个坦克大战?': 'HTML5 Canvas + JS',
                  },
                }),
              },
            ],
          },
          timestamp: '2026-05-05T00:00:02.000Z',
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '收到，使用 Canvas。' }],
          },
          timestamp: '2026-05-05T00:00:03.000Z',
        }),
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          duration_ms: 1200,
          timestamp: '2026-05-05T00:00:04.000Z',
        }),
      ].join('\n'),
      'utf8',
    );

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { createProject, createThread, updateThreadMetadata, getThreadHistory } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});
          const threadId = createThread(projectId, 'history-request-user-input');
          updateThreadMetadata(threadId, {
            sessionId: ${JSON.stringify(sessionId)},
            workingDirectory: ${JSON.stringify(repo)},
          });
          const history = getThreadHistory(threadId);
          console.log(JSON.stringify(history.turns[0]?.pendingUserInputRequests ?? []));
        `,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          LOCALAPPDATA: appData,
          APPDATA: '',
          USERPROFILE: root,
        },
      },
    );

    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.deepEqual(JSON.parse(child.stdout.trim()), [
      {
        requestId: 'toolu_question_1',
        title: '需要你的选择',
        questions: [
          {
            id: 'tech_stack',
            question: '你想用什么技术栈做这个坦克大战?',
            options: [
              { label: 'Python + Pygame' },
              { label: 'HTML5 Canvas + JS' },
            ],
            multiSelect: false,
            required: false,
            secret: false,
            isOther: false,
          },
        ],
        submittedAnswers: {
          tech_stack: 'HTML5 Canvas + JS',
        },
        submittedAtMs: 1,
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
