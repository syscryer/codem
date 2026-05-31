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

test('getThreadHistory returns latest Claude /context local command snapshot separately from turns', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-history-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const sessionId = 'session-context-1';
  const transcriptPath = path.join(
    root,
    '.claude',
    'projects',
    path.resolve(repo).replace(/[^a-zA-Z0-9]/g, '-'),
    `${sessionId}.jsonl`,
  );
  const contextStdout = [
    'Context Usage',
    '',
    'Model: claude-opus-4-8[1m]',
    '2.8k/1m tokens (0%)',
    '',
    'Estimated usage by category',
    'System prompt: 921 tokens',
    'Memory files: 157 tokens',
    'Skills: 1.7k tokens',
    'Messages: 5 tokens',
    'Free space: 997.2k',
  ].join('\n');

  try {
    mkdirSync(path.dirname(transcriptPath), { recursive: true });
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: 'user',
          sessionId,
          cwd: repo,
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
          },
          timestamp: '2026-05-05T00:00:00.000Z',
        }),
        JSON.stringify({
          type: 'assistant',
          sessionId,
          cwd: repo,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'world' }],
          },
          timestamp: '2026-05-05T00:00:01.000Z',
        }),
        JSON.stringify({
          type: 'system',
          subtype: 'local_command',
          sessionId,
          cwd: repo,
          content: [
            '<command-name>/context</command-name>',
            `<local-command-stdout>${contextStdout}</local-command-stdout>`,
          ].join('\n'),
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
          const { createProject, createThread, updateThreadMetadata, getThreadHistory } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});
          const threadId = createThread(projectId, 'history-context');
          updateThreadMetadata(threadId, {
            sessionId: ${JSON.stringify(sessionId)},
            workingDirectory: ${JSON.stringify(repo)},
          });
          const history = getThreadHistory(threadId);
          console.log(JSON.stringify({
            turnCount: history.turns.length,
            assistantText: history.turns[0]?.assistantText,
            context: history.claudeContext ? {
              usedTokens: history.claudeContext.summary.usedTokens,
              totalTokens: history.claudeContext.summary.totalTokens,
              freeTokens: history.claudeContext.summary.freeTokens,
              model: history.claudeContext.summary.model,
              hasSystemPrompt: history.claudeContext.summary.hasSystemPrompt,
            } : null,
          }));
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
    assert.deepEqual(JSON.parse(child.stdout.trim()), {
      turnCount: 1,
      assistantText: 'world',
      context: {
        usedTokens: 2_800,
        totalTokens: 1_000_000,
        freeTokens: 997_200,
        model: 'claude-opus-4-8[1m]',
        hasSystemPrompt: true,
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('getThreadHistory reparses stored histories polluted by Claude local command transcript blocks', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-history-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const sessionId = 'session-local-command-pollution-1';
  const transcriptPath = path.join(
    root,
    '.claude',
    'projects',
    path.resolve(repo).replace(/[^a-zA-Z0-9]/g, '-'),
    `${sessionId}.jsonl`,
  );
  const compactCommand = [
    '<command-name>/compact</command-name>',
    '<command-message>compact</command-message>',
    '<command-args></command-args>',
  ].join('\n');
  const compactStdout = '<local-command-stdout>Compacted </local-command-stdout>';
  const contextCommand = [
    '<command-name>/context</command-name>',
    '<command-message>context</command-message>',
    '<command-args></command-args>',
  ].join('\n');
  const contextStdout = '<local-command-stdout>Context Usage\n2.8k/1m tokens (0%)</local-command-stdout>';

  try {
    mkdirSync(path.dirname(transcriptPath), { recursive: true });
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: 'user',
          sessionId,
          cwd: repo,
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
          },
          timestamp: '2026-05-05T00:00:00.000Z',
        }),
        JSON.stringify({
          type: 'assistant',
          sessionId,
          cwd: repo,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'world' }],
          },
          timestamp: '2026-05-05T00:00:01.000Z',
        }),
        JSON.stringify({
          type: 'system',
          subtype: 'local_command',
          sessionId,
          cwd: repo,
          content: [compactCommand, compactStdout].join('\n'),
          timestamp: '2026-05-05T00:00:02.000Z',
        }),
        JSON.stringify({
          type: 'system',
          subtype: 'local_command',
          sessionId,
          cwd: repo,
          content: [contextCommand, contextStdout].join('\n'),
          timestamp: '2026-05-05T00:00:03.000Z',
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
          const threadId = createThread(projectId, 'history-local-command-pollution');
          saveThreadHistory(threadId, [
            {
              id: 'turn-clean',
              userText: 'hello',
              assistantText: 'world',
              status: 'done',
              items: [{ id: 'item-clean', type: 'text', text: 'world' }],
              tools: [],
            },
            {
              id: 'turn-dirty-compact-command',
              userText: '',
              assistantText: ${JSON.stringify(compactCommand)},
              status: 'stopped',
              items: [{ id: 'item-dirty-compact-command', type: 'text', text: ${JSON.stringify(compactCommand)} }],
              tools: [],
            },
            {
              id: 'turn-dirty-compact-stdout',
              userText: '',
              assistantText: ${JSON.stringify(compactStdout)},
              status: 'stopped',
              items: [{ id: 'item-dirty-compact-stdout', type: 'text', text: ${JSON.stringify(compactStdout)} }],
              tools: [],
            },
            {
              id: 'turn-dirty-context-command',
              userText: '',
              assistantText: ${JSON.stringify(contextCommand)},
              status: 'stopped',
              items: [{ id: 'item-dirty-context-command', type: 'text', text: ${JSON.stringify(contextCommand)} }],
              tools: [],
            },
          ]);
          updateThreadMetadata(threadId, {
            sessionId: ${JSON.stringify(sessionId)},
            workingDirectory: ${JSON.stringify(repo)},
          });
          const history = getThreadHistory(threadId);
          console.log(JSON.stringify({
            turns: history.turns.map((turn) => ({
              userText: turn.userText,
              assistantText: turn.assistantText,
              items: turn.items.map((item) => item.type === 'text' ? item.text : item.type),
            })),
            context: history.claudeContext ? {
              usedTokens: history.claudeContext.summary.usedTokens,
              totalTokens: history.claudeContext.summary.totalTokens,
            } : null,
          }));
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
    assert.deepEqual(JSON.parse(child.stdout.trim()), {
      turns: [
        {
          userText: 'hello',
          assistantText: 'world',
          items: ['world'],
        },
      ],
      context: {
        usedTokens: 2_800,
        totalTokens: 1_000_000,
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updateThreadMetadata clears a stored model when model is null', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-history-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');

  try {
    mkdirSync(repo, { recursive: true });

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { createProject, createThread, updateThreadMetadata, getWorkspaceBootstrap } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});
          const threadId = createThread(projectId, 'clear-model');
          updateThreadMetadata(threadId, { model: 'glm-5.1' });
          updateThreadMetadata(threadId, { model: null });
          const workspace = getWorkspaceBootstrap();
          const thread = workspace.projects[0].threads.find((item) => item.id === threadId);
          console.log(JSON.stringify({ model: thread?.model ?? null }));
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
    assert.deepEqual(JSON.parse(child.stdout.trim()), { model: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updateThreadMetadata clears a stored session when sessionId is null', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-history-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const sessionId = 'session-old-1';
  const transcriptPath = path.join(
    root,
    '.claude',
    'projects',
    path.resolve(repo).replace(/[^a-zA-Z0-9]/g, '-'),
    `${sessionId}.jsonl`,
  );

  try {
    mkdirSync(repo, { recursive: true });
    mkdirSync(path.dirname(transcriptPath), { recursive: true });
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: 'user',
          sessionId,
          cwd: repo,
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
          },
          timestamp: '2026-05-05T00:00:00.000Z',
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
          const { createProject, createThread, updateThreadMetadata, getWorkspaceBootstrap } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});
          const threadId = createThread(projectId, 'clear-session');
          updateThreadMetadata(threadId, { sessionId: ${JSON.stringify(sessionId)} });
          const beforeWorkspace = getWorkspaceBootstrap();
          const beforeThread = beforeWorkspace.projects[0].threads.find((item) => item.id === threadId);
          updateThreadMetadata(threadId, { sessionId: null });
          const afterWorkspace = getWorkspaceBootstrap();
          const afterThreads = afterWorkspace.projects[0].threads;
          const afterThread = afterThreads.find((item) => item.id === threadId);
          console.log(JSON.stringify({
            beforeSessionId: beforeThread?.sessionId ?? null,
            afterSessionId: afterThread?.sessionId ?? null,
            oldSessionThreads: afterThreads.filter((item) => item.sessionId === ${JSON.stringify(sessionId)}).length,
          }));
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
    assert.deepEqual(JSON.parse(child.stdout.trim()), {
      beforeSessionId: sessionId,
      afterSessionId: '',
      oldSessionThreads: 0,
    });
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

test('getThreadHistory hides Claude task notification user events from visible turns', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-history-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const sessionId = 'session-task-notification-1';
  const transcriptPath = path.join(
    root,
    '.claude',
    'projects',
    path.resolve(repo).replace(/[^a-zA-Z0-9]/g, '-'),
    `${sessionId}.jsonl`,
  );
  const taskNotification = [
    '<task-notification>',
    '<task-id>a9d6d9088adaffeb5</task-id>',
    '<tool-use-id>call_a07b3ff8454d456db63e970c</tool-use-id>',
    '<status>completed</status>',
    '<summary>Agent "Review assistant &amp; coordinator" completed</summary>',
    '<result>Here is a concise summary of the findings.</result>',
    '</task-notification>',
  ].join('\n');

  try {
    mkdirSync(path.dirname(transcriptPath), { recursive: true });
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: '还在等最后一个子代理。' }],
          },
          timestamp: '2026-05-05T00:00:00.000Z',
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '还在等最后一个（assistant & coordinator）子代理。' }],
          },
          timestamp: '2026-05-05T00:00:01.000Z',
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: '1245df' }],
          },
          timestamp: '2026-05-05T00:00:02.000Z',
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '收到，看起来像是随手输入。' }],
          },
          timestamp: '2026-05-05T00:00:03.000Z',
        }),
        JSON.stringify({
          type: 'queue-operation',
          operation: 'enqueue',
          content: taskNotification,
          timestamp: '2026-05-05T00:00:04.000Z',
        }),
        JSON.stringify({
          type: 'attachment',
          attachment: {
            type: 'queued_command',
            prompt: [{ type: 'text', text: taskNotification }],
            commandMode: 'prompt',
          },
          timestamp: '2026-05-05T00:00:04.500Z',
        }),
        JSON.stringify({
          type: 'user',
          origin: { kind: 'task-notification' },
          message: {
            role: 'user',
            content: taskNotification,
          },
          timestamp: '2026-05-05T00:00:05.000Z',
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
          const threadId = createThread(projectId, 'history-task-notification');
          updateThreadMetadata(threadId, {
            sessionId: ${JSON.stringify(sessionId)},
            workingDirectory: ${JSON.stringify(repo)},
          });
          const history = getThreadHistory(threadId);
          console.log(JSON.stringify(history.turns.map((turn) => ({
            userText: turn.userText,
            assistantText: turn.assistantText,
            itemSummaries: turn.items.map((item) => item.type === 'system-command' ? item.summary : item.type),
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
        userText: '还在等最后一个子代理。',
        assistantText: '还在等最后一个（assistant & coordinator）子代理。',
        itemSummaries: ['text'],
      },
      {
        userText: '1245df',
        assistantText: '收到，看起来像是随手输入。',
        itemSummaries: ['text'],
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('getThreadHistory reparses stored histories already polluted by Claude task notifications', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-history-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const sessionId = 'session-stored-task-notification-1';
  const transcriptPath = path.join(
    root,
    '.claude',
    'projects',
    path.resolve(repo).replace(/[^a-zA-Z0-9]/g, '-'),
    `${sessionId}.jsonl`,
  );
  const taskNotification = [
    '<task-notification>',
    '<task-id>stored-dirty-task</task-id>',
    '<tool-use-id>call_stored_dirty</tool-use-id>',
    '<status>completed</status>',
    '<summary>Agent "Stored dirty task" completed</summary>',
    '<result>Internal agent output.</result>',
    '</task-notification>',
  ].join('\n');

  try {
    mkdirSync(path.dirname(transcriptPath), { recursive: true });
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: '还在等最后一个子代理。' }],
          },
          timestamp: '2026-05-05T00:00:00.000Z',
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '还在等最后一个（assistant & coordinator）子代理。' }],
          },
          timestamp: '2026-05-05T00:00:01.000Z',
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: '1245df' }],
          },
          timestamp: '2026-05-05T00:00:02.000Z',
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '收到，看起来像是随手输入。' }],
          },
          timestamp: '2026-05-05T00:00:03.000Z',
        }),
        JSON.stringify({
          type: 'user',
          origin: { kind: 'task-notification' },
          message: {
            role: 'user',
            content: taskNotification,
          },
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
          const { createProject, createThread, saveThreadHistory, updateThreadMetadata, getThreadHistory } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});
          const threadId = createThread(projectId, 'history-stored-task-notification');
          saveThreadHistory(threadId, [
            {
              id: 'turn-clean-1',
              userText: '还在等最后一个子代理。',
              assistantText: '还在等最后一个（assistant & coordinator）子代理。',
              status: 'done',
              items: [{ id: 'item-clean-1', type: 'text', text: '还在等最后一个（assistant & coordinator）子代理。' }],
              tools: [],
            },
            {
              id: 'turn-dirty-guide',
              userText: '1245df',
              assistantText: '收到，看起来像是随手输入。',
              status: 'done',
              items: [
                { id: 'item-clean-2', type: 'text', text: '收到，看起来像是随手输入。' },
                {
                  id: 'item-dirty-guide',
                  type: 'system-command',
                  command: 'guide',
                  title: '已引导当前运行',
                  cardType: 'compact',
                  state: 'done',
                  summary: ${JSON.stringify(taskNotification)},
                },
              ],
              tools: [],
            },
            {
              id: 'turn-dirty-user',
              userText: ${JSON.stringify(taskNotification)},
              assistantText: '',
              status: 'stopped',
              items: [],
              tools: [],
            },
          ]);
          updateThreadMetadata(threadId, {
            sessionId: ${JSON.stringify(sessionId)},
            workingDirectory: ${JSON.stringify(repo)},
          });
          const history = getThreadHistory(threadId);
          console.log(JSON.stringify(history.turns.map((turn) => ({
            userText: turn.userText,
            assistantText: turn.assistantText,
            itemSummaries: turn.items.map((item) => item.type === 'system-command' ? item.summary : item.type),
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
        userText: '还在等最后一个子代理。',
        assistantText: '还在等最后一个（assistant & coordinator）子代理。',
        itemSummaries: ['text'],
      },
      {
        userText: '1245df',
        assistantText: '收到，看起来像是随手输入。',
        itemSummaries: ['text'],
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('getThreadHistory restores running guide attachments as guide cards instead of user turns', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-history-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const sessionId = 'session-guide-attachment-1';
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
            content: [{ type: 'text', text: '请等待 25 秒后回复' }],
          },
          timestamp: '2026-05-05T00:00:00.000Z',
        }),
        JSON.stringify({
          type: 'attachment',
          attachment: {
            type: 'queued_command',
            prompt: [{ type: 'text', text: '1245df' }],
            commandMode: 'prompt',
          },
          timestamp: '2026-05-05T00:00:01.000Z',
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '收到，引导内容是 1245df。' }],
          },
          timestamp: '2026-05-05T00:00:02.000Z',
        }),
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          duration_ms: 1200,
          timestamp: '2026-05-05T00:00:03.000Z',
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
          const threadId = createThread(projectId, 'history-guide-attachment');
          updateThreadMetadata(threadId, {
            sessionId: ${JSON.stringify(sessionId)},
            workingDirectory: ${JSON.stringify(repo)},
          });
          const first = getThreadHistory(threadId).turns;
          const second = getThreadHistory(threadId).turns;
          const summarize = (turns) => turns.map((turn) => ({
            userText: turn.userText,
            assistantText: turn.assistantText,
            items: turn.items.map((item) => item.type === 'system-command'
              ? {
                  type: item.type,
                  command: item.command,
                  title: item.title,
                  cardType: item.cardType,
                  state: item.state,
                  summary: item.summary,
                }
              : {
                  type: item.type,
                  text: item.text,
                }),
          }));
          console.log(JSON.stringify({ first: summarize(first), second: summarize(second) }));
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
    const expected = [
      {
        userText: '请等待 25 秒后回复',
        assistantText: '收到，引导内容是 1245df。',
        items: [
          {
            type: 'system-command',
            command: 'guide',
            title: '已引导当前运行',
            cardType: 'compact',
            state: 'done',
            summary: '1245df',
          },
          {
            type: 'text',
            text: '收到，引导内容是 1245df。',
          },
        ],
      },
    ];
    assert.deepEqual(JSON.parse(child.stdout.trim()), {
      first: expected,
      second: expected,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('saveThreadHistory stores only safe user content block summaries', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-history-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');

  try {
    mkdirSync(repo, { recursive: true });

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          const { createProject, createThread, saveThreadHistory, getThreadHistory } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});
          const threadId = createThread(projectId, 'history-content-blocks');
          saveThreadHistory(threadId, [{
            id: 'turn-1',
            userText: '请参考这些输入',
            userContentBlocks: [
              {
                type: 'text',
                text: '请参考这些输入',
              },
              {
                type: 'image',
                path: ${JSON.stringify(path.join(repo, '.codem-attachments', 'image.png'))},
                name: 'image.png',
                mimeType: 'image/png',
                size: 5,
                imageBytes: 5,
                data: 'SGVsbG8=',
              },
              {
                type: 'file_text',
                path: ${JSON.stringify(path.join(repo, 'src', 'note.ts'))},
                name: 'note.ts',
                size: 12,
                text: 'console.log("secret")',
                textBytes: 21,
              },
              {
                type: 'file_reference',
                path: ${JSON.stringify(path.join(repo, 'README.md'))},
                name: 'README.md',
                reason: 'too_large',
              },
              {
                type: 'attachment_metadata',
                name: 'archive.zip',
                reason: 'binary',
              },
            ],
            workspace: ${JSON.stringify(repo)},
            assistantText: '已收到',
            status: 'done',
            items: [],
            tools: [],
          }]);
          const history = getThreadHistory(threadId);
          console.log(JSON.stringify(history.turns[0]?.userContentBlocks ?? null));
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
        type: 'text',
        text: '请参考这些输入',
      },
      {
        type: 'image',
        path: path.join(repo, '.codem-attachments', 'image.png'),
        name: 'image.png',
        mimeType: 'image/png',
        size: 5,
        imageBytes: 5,
      },
      {
        type: 'file_text',
        path: path.join(repo, 'src', 'note.ts'),
        name: 'note.ts',
        size: 12,
        textBytes: 21,
      },
      {
        type: 'file_reference',
        path: path.join(repo, 'README.md'),
        name: 'README.md',
        reason: 'too_large',
      },
      {
        type: 'attachment_metadata',
        name: 'archive.zip',
        reason: 'binary',
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('getThreadHistory refreshes text-only content block histories from newer transcript', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-history-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const sessionId = 'session-text-block-refresh-1';
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
            content: [{ type: 'text', text: 'hello' }],
          },
          timestamp: '2026-05-05T00:00:00.000Z',
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'fresh assistant' }],
          },
          timestamp: '2026-05-05T00:00:01.000Z',
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
          const { utimesSync } = await import('node:fs');
          const { createProject, createThread, saveThreadHistory, updateThreadMetadata, getThreadHistory } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});
          const threadId = createThread(projectId, 'history-text-block-refresh');
          updateThreadMetadata(threadId, {
            sessionId: ${JSON.stringify(sessionId)},
            workingDirectory: ${JSON.stringify(repo)},
          });
          saveThreadHistory(threadId, [{
            id: 'turn-1',
            userText: 'hello',
            userContentBlocks: [{ type: 'text', text: 'hello' }],
            workspace: ${JSON.stringify(repo)},
            assistantText: 'stale assistant',
            status: 'done',
            items: [],
            tools: [],
          }]);
          const future = new Date(Date.now() + 5000);
          utimesSync(${JSON.stringify(transcriptPath)}, future, future);
          const history = getThreadHistory(threadId);
          console.log(JSON.stringify({
            userText: history.turns[0]?.userText,
            assistantText: history.turns[0]?.assistantText,
          }));
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
    assert.deepEqual(JSON.parse(child.stdout.trim()), {
      userText: 'hello',
      assistantText: 'fresh assistant',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('getThreadHistory keeps stored content block summaries when transcript is newer', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codem-workspace-history-'));
  const appData = path.join(root, 'appdata');
  const repo = path.join(root, 'repo');
  const sessionId = 'session-content-block-refresh-1';
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
            content: [{ type: 'text', text: '<input><file>README.md</file></input>' }],
          },
          timestamp: '2026-05-05T00:00:00.000Z',
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '收到。' }],
          },
          timestamp: '2026-05-05T00:00:01.000Z',
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
          const { utimesSync } = await import('node:fs');
          const { createProject, createThread, saveThreadHistory, updateThreadMetadata, getThreadHistory } = await import('./server/lib/workspace-store.ts');
          const projectId = createProject(${JSON.stringify(repo)});
          const threadId = createThread(projectId, 'history-content-block-refresh');
          updateThreadMetadata(threadId, {
            sessionId: ${JSON.stringify(sessionId)},
            workingDirectory: ${JSON.stringify(repo)},
          });
          saveThreadHistory(threadId, [{
            id: 'turn-1',
            userText: '请参考 README',
            userContentBlocks: [
              {
                type: 'file_reference',
                path: ${JSON.stringify(path.join(repo, 'README.md'))},
                name: 'README.md',
                reason: 'too_large',
                source: 'attachment',
              },
            ],
            workspace: ${JSON.stringify(repo)},
            assistantText: '收到。',
            status: 'done',
            items: [],
            tools: [],
          }]);
          const future = new Date(Date.now() + 5000);
          utimesSync(${JSON.stringify(transcriptPath)}, future, future);
          const history = getThreadHistory(threadId);
          console.log(JSON.stringify({
            userText: history.turns[0]?.userText,
            userContentBlocks: history.turns[0]?.userContentBlocks ?? null,
          }));
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
    assert.deepEqual(JSON.parse(child.stdout.trim()), {
      userText: '请参考 README',
      userContentBlocks: [
        {
          type: 'file_reference',
          path: path.join(repo, 'README.md'),
          name: 'README.md',
          reason: 'too_large',
          source: 'attachment',
        },
      ],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
