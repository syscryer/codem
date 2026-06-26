import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildChangedFileReviewRequest,
  buildChangedFilesReviewRequests,
  buildConversationUndoChanges,
  findLatestChangedFilesTurnId,
} from './conversation-changed-files';
import type { ConversationTurn, ToolStep } from '../types';

test('buildChangedFilesReviewRequests opens each changed file as a conversation preview tab', () => {
  const requests = buildChangedFilesReviewRequests([
    {
      path: 'src/App.tsx',
      name: 'App.tsx',
      additions: 3,
      deletions: 1,
      previews: [
        {
          kind: 'edit',
          filePath: 'src/App.tsx',
          fileName: 'App.tsx',
          beforeText: 'old title',
          afterText: 'new title',
          additions: 1,
          deletions: 1,
          rows: [],
        },
      ],
    },
    {
      path: 'server/index.ts',
      name: 'index.ts',
      additions: 2,
      deletions: 0,
      previews: [
        {
          kind: 'write',
          filePath: 'server/index.ts',
          fileName: 'index.ts',
          beforeText: '',
          afterText: 'const ready = true;',
          additions: 1,
          deletions: 0,
          rows: [],
        },
      ],
    },
  ]);

  assert.deepEqual(
    requests.map((request) => ({
      key: request.key,
      path: request.path,
      name: request.name,
      source: request.source,
      reviewDiff: request.reviewDiff,
    })),
    [
      {
        key: 'conversation:src/App.tsx',
        path: 'src/App.tsx',
        name: 'App.tsx',
        source: 'conversation-card',
        reviewDiff: ['--- a/src/App.tsx', '+++ b/src/App.tsx', '-old title', '+new title'],
      },
      {
        key: 'conversation:server/index.ts',
        path: 'server/index.ts',
        name: 'index.ts',
        source: 'conversation-card',
        reviewDiff: ['--- a/server/index.ts', '+++ b/server/index.ts', '+const ready = true;'],
      },
    ],
  );
});

test('buildChangedFileReviewRequest builds a single conversation review tab request', () => {
  const request = buildChangedFileReviewRequest({
    path: 'src/App.tsx',
    name: 'App.tsx',
    additions: 3,
    deletions: 1,
    previews: [
      {
        kind: 'edit',
        filePath: 'src/App.tsx',
        fileName: 'App.tsx',
        beforeText: 'old title',
        afterText: 'new title',
        additions: 1,
        deletions: 1,
        rows: [],
      },
    ],
  });

  assert.deepEqual(request, {
    key: 'conversation:src/App.tsx',
    path: 'src/App.tsx',
    name: 'App.tsx',
    kind: 'code',
    source: 'conversation-card',
    reviewDiff: ['--- a/src/App.tsx', '+++ b/src/App.tsx', '-old title', '+new title'],
  });
});

test('buildConversationUndoChanges groups tool edits by file and preserves reverse-safe order', () => {
  const tools: ToolStep[] = [
    {
      id: 'tool-1',
      name: 'Edit',
      title: 'Edit src/App.tsx',
      status: 'done',
      inputText: JSON.stringify({
        file_path: 'src/App.tsx',
        old_string: 'old title',
        new_string: 'new title',
      }),
    },
    {
      id: 'tool-2',
      name: 'Edit',
      title: 'Edit src/App.tsx again',
      status: 'done',
      inputText: JSON.stringify({
        file_path: 'src/App.tsx',
        old_string: 'new title',
        new_string: 'latest title',
      }),
    },
    {
      id: 'tool-3',
      name: 'Write',
      title: 'Write src/lib/new-file.ts',
      status: 'done',
      inputText: JSON.stringify({
        file_path: 'src/lib/new-file.ts',
        content: 'export const created = true;\n',
      }),
    },
  ];

  const changes = buildConversationUndoChanges(tools);
  assert.deepEqual(changes, [
    {
      path: 'src/App.tsx',
      operations: [
        {
          kind: 'replace-snippet',
          beforeText: 'old title',
          afterText: 'new title',
        },
        {
          kind: 'replace-snippet',
          beforeText: 'new title',
          afterText: 'latest title',
        },
      ],
    },
    {
      path: 'src/lib/new-file.ts',
      operations: [
        {
          kind: 'delete-file',
          beforeText: '',
          afterText: 'export const created = true;\n',
        },
      ],
    },
  ]);
});

test('buildConversationUndoChanges normalizes absolute tool paths into project-relative undo paths', () => {
  const tools: ToolStep[] = [
    {
      id: 'tool-absolute-edit',
      name: 'Edit',
      title: 'Edit absolute file',
      status: 'done',
      inputText: JSON.stringify({
        file_path: 'D:\\ai_proj\\test\\snake-game\\index.html',
        old_string: '<title>Old</title>',
        new_string: '<title>New</title>',
      }),
    },
    {
      id: 'tool-absolute-write',
      name: 'Write',
      title: 'Write absolute file',
      status: 'done',
      inputText: JSON.stringify({
        file_path: 'D:\\ai_proj\\test\\snake-game\\style.css',
        content: 'body { color: red; }\n',
      }),
    },
  ];

  const changes = buildConversationUndoChanges(tools, 'D:\\ai_proj');
  assert.deepEqual(changes, [
    {
      path: 'test/snake-game/index.html',
      operations: [
        {
          kind: 'replace-snippet',
          beforeText: '<title>Old</title>',
          afterText: '<title>New</title>',
        },
      ],
    },
    {
      path: 'test/snake-game/style.css',
      operations: [
        {
          kind: 'delete-file',
          beforeText: '',
          afterText: 'body { color: red; }\n',
        },
      ],
    },
  ]);
});

test('buildConversationUndoChanges skips failed file tools and preserves replace_all edits', () => {
  const tools: ToolStep[] = [
    {
      id: 'tool-success-replace-all',
      name: 'Edit',
      title: 'Edit repeated snippet',
      status: 'done',
      inputText: JSON.stringify({
        file_path: 'src/game.js',
        old_string: 'this.snakeLength = 3;',
        new_string: 'this.snakeLength = 5;',
        replace_all: true,
      }),
    },
    {
      id: 'tool-failed-edit',
      name: 'Edit',
      title: 'Failed edit',
      status: 'error',
      inputText: JSON.stringify({
        file_path: 'src/game.js',
        old_string: 'this.score += 10;',
        new_string: 'this.score += 20;',
      }),
    },
  ];

  const changes = buildConversationUndoChanges(tools);
  assert.deepEqual(changes, [
    {
      path: 'src/game.js',
      operations: [
        {
          kind: 'replace-snippet',
          beforeText: 'this.snakeLength = 3;',
          afterText: 'this.snakeLength = 5;',
          replaceAll: true,
        },
      ],
    },
  ]);
});

test('buildConversationUndoChanges restores files deleted by simple Bash rm when prior content is known', () => {
  const priorTurn: ConversationTurn = {
    id: 'turn-create',
    userText: 'create game',
    workspace: 'D:/ai_proj/test',
    assistantText: 'created',
    tools: [
      {
        id: 'tool-write-style',
        name: 'Write',
        title: 'Write style',
        status: 'done',
        inputText: JSON.stringify({
          file_path: 'D:\\ai_proj\\test\\snake-game\\style.css',
          content: 'body { color: green; }\n',
        }),
      },
    ],
    items: [],
    status: 'done',
  };
  const currentTools: ToolStep[] = [
    {
      id: 'tool-rm-style',
      name: 'Bash',
      title: 'Bash(rm D:/ai_proj/test/snake-game/style.css)',
      status: 'done',
      inputText: JSON.stringify({
        command: 'rm D:/ai_proj/test/snake-game/style.css',
      }),
    },
  ];

  const changes = buildConversationUndoChanges(currentTools, 'D:\\ai_proj\\test', [priorTurn]);
  assert.deepEqual(changes, [
    {
      path: 'snake-game/style.css',
      operations: [
        {
          kind: 'restore-file',
          beforeText: 'body { color: green; }\n',
          afterText: '',
        },
      ],
    },
  ]);
});

test('buildConversationUndoChanges ignores Bash rm when no prior content is known', () => {
  const tools: ToolStep[] = [
    {
      id: 'tool-rm-unknown',
      name: 'Bash',
      title: 'Bash(rm snake-game/unknown.css)',
      status: 'done',
      inputText: JSON.stringify({
        command: 'rm snake-game/unknown.css',
      }),
    },
  ];

  assert.deepEqual(buildConversationUndoChanges(tools, 'D:\\ai_proj\\test', []), []);
});

test('findLatestChangedFilesTurnId only returns the most recent turn with changed files', () => {
  const turns: ConversationTurn[] = [
    {
      id: 'turn-1',
      userText: 'one',
      workspace: 'D:/project/codem',
      assistantText: 'first',
      tools: [],
      items: [],
      status: 'done',
    },
    {
      id: 'turn-2',
      userText: 'two',
      workspace: 'D:/project/codem',
      assistantText: 'second',
      tools: [
        {
          id: 'tool-a',
          name: 'Edit',
          title: 'Edit src/App.tsx',
          status: 'done',
          inputText: JSON.stringify({
            file_path: 'src/App.tsx',
            old_string: 'before',
            new_string: 'after',
          }),
        },
      ],
      items: [],
      status: 'done',
    },
    {
      id: 'turn-3',
      userText: 'three',
      workspace: 'D:/project/codem',
      assistantText: 'third',
      tools: [
        {
          id: 'tool-b',
          name: 'Write',
          title: 'Write src/lib/new-file.ts',
          status: 'done',
          inputText: JSON.stringify({
            file_path: 'src/lib/new-file.ts',
            content: 'hello\n',
          }),
        },
      ],
      items: [],
      status: 'done',
    },
  ];

  assert.equal(findLatestChangedFilesTurnId(turns), 'turn-3');
});
