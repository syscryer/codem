import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContextSlashCardResult } from './claude-slash-system-commands';
import type { ConversationTurn } from '../types';

function turn(overrides: Partial<ConversationTurn>): ConversationTurn {
  return {
    id: 'turn-1',
    userText: '',
    workspace: '',
    assistantText: '',
    tools: [],
    items: [],
    status: 'done',
    ...overrides,
  };
}

test('buildContextSlashCardResult prefers the latest context snapshot over cumulative turn usage', () => {
  const result = buildContextSlashCardResult({
    modelLabel: 'Opus 4.8 (1M context)',
    turns: [
      turn({
        id: 'turn-cumulative-result',
        inputTokens: 17_994,
        cacheReadInputTokens: 1_418_240,
        outputTokens: 4_353,
      }),
      turn({
        id: 'turn-context-snapshot',
        inputTokens: 800_000,
        cacheReadInputTokens: 200_000,
        outputTokens: 10_000,
        contextUsage: {
          inputTokens: 1_000,
          cacheCreationInputTokens: 1_800,
          cacheReadInputTokens: 42_100,
          outputTokens: 1_589,
          modelContextWindow: 1_000_000,
          usageSource: 'context',
        },
      }),
    ],
  });

  assert.match(result.summary, /当前上下文: 44\.9k\/1m tokens \(4\.5%\)/);
  assert.match(result.summary, /可用空间: 955\.1k tokens/);
  assert.doesNotMatch(result.summary, /输入\/消息|缓存写入|缓存读取|最近输出/);
  assert.equal(result.details.usedContextTokens, 44_900);
  assert.equal(result.details.cumulativeInputTokens, undefined);
  assert.equal(result.details.cumulativeCacheReadInputTokens, undefined);
  assert.equal(result.details.cumulativeTotalTokens, undefined);
});

test('buildContextSlashCardResult ignores implausible cumulative cache-read usage', () => {
  const result = buildContextSlashCardResult({
    turns: [
      turn({
        id: 'turn-cumulative-result',
        inputTokens: 17_994,
        cacheReadInputTokens: 1_418_240,
        outputTokens: 4_353,
      }),
    ],
  });

  assert.match(result.summary, /当前上下文: 0\/200k tokens \(0%\)/);
  assert.equal(result.details.usedContextTokens, 0);
  assert.equal(result.details.usageSource, 'empty');
});

test('buildContextSlashCardResult uses native stream-json context snapshot for MCP, memory, and skills summary', () => {
  const result = buildContextSlashCardResult({
    modelLabel: 'local fallback model',
    turns: [
      turn({
        id: 'turn-cumulative-result',
        inputTokens: 17_994,
        cacheReadInputTokens: 1_418_240,
        outputTokens: 4_353,
      }),
    ],
    nativeContext: {
      source: 'stream-json',
      requestedAtMs: 1,
      durationMs: 321,
      eventCount: 4,
      markdown: '### Memory Files\n\n| Type | Path | Tokens |\n|------|------|--------|\n| User | C:\\Users\\syscr\\.claude\\CLAUDE.md | 157 |',
      markdownTruncated: false,
      summary: {
        hasContextUsage: true,
        hasMcpTools: true,
        hasFreeSpace: true,
        hasSystemPrompt: true,
        hasMemory: true,
        hasSkills: true,
        model: 'claude-opus-4-8[1m]',
        usedTokens: 110_600,
        totalTokens: 1_000_000,
        freeTokens: 889_400,
        percent: 11.1,
        categories: {
          systemPrompt: 75_000,
          memoryFiles: 157,
          skills: 1_700,
          messages: 33_743,
          freeSpace: 889_400,
        },
        mcpToolCount: 18,
        memoryFileCount: 1,
        skillCount: 9,
        markdownChars: 2048,
      },
    },
  });

  assert.match(result.summary, /模型: claude-opus-4-8\[1m\]/);
  assert.match(result.summary, /当前上下文: 110\.6k\/1m tokens \(11\.1%\)/);
  assert.match(result.summary, /MCP tools: 18/);
  assert.match(result.summary, /Memory files: 1/);
  assert.match(result.summary, /Skills: 9/);
  assert.doesNotMatch(result.summary, /System prompt|Memory files: 157 tokens|Messages:/);
  assert.equal(result.details.usageSource, 'Claude stream-json /context');
  assert.equal(result.details.mcpToolCount, 18);
  assert.equal(result.details.memoryFileCount, 1);
  assert.equal(result.details.skillCount, 9);
  assert.equal(result.details.markdownChars, 2048);
  assert.equal(result.details.systemPromptTokens, undefined);
  assert.equal(result.details.memoryFilesTokens, undefined);
  assert.equal(result.details.skillsTokens, undefined);
  assert.equal(result.details.messagesTokens, undefined);
  assert.doesNotMatch(JSON.stringify(result), /C:\\\\Users\\\\syscr|CLAUDE\.md/);
});
