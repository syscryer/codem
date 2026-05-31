import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractClaudeContextMarkdownFromPayload,
  summarizeClaudeContextMarkdown,
} from './claude-context.js';

const sampleContextMarkdown = `## Context Usage

**Model:** claude-opus-4-8[1m]  
**Tokens:** 2.7k / 1m (0%)

### Estimated usage by category

| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 875 | 0.1% |
| Memory files | 157 | 0.0% |
| Skills | 1.7k | 0.2% |
| Messages | 6 | 0.0% |
| Free space | 997.3k | 99.7% |

### MCP Tools

| Tool | Server | Tokens |
|------|--------|--------|
| mcp__fetch__fetch | fetch | 0 |
| mcp__memory__read_graph | memory | 0 |

### Memory Files

| Type | Path | Tokens |
|------|------|--------|
| User | C:\\Users\\syscr\\.claude\\CLAUDE.md | 157 |

### Skills

| Skill | Source | Tokens |
|-------|--------|--------|
| browser | User | ~100 |
| verify | Built-in | ~90 |
`;

test('summarizeClaudeContextMarkdown extracts usage, categories, and section counts without raw paths', () => {
  const summary = summarizeClaudeContextMarkdown(sampleContextMarkdown);

  assert.equal(summary.hasContextUsage, true);
  assert.equal(summary.hasMcpTools, true);
  assert.equal(summary.hasFreeSpace, true);
  assert.equal(summary.hasSystemPrompt, true);
  assert.equal(summary.hasMemory, true);
  assert.equal(summary.hasSkills, true);
  assert.equal(summary.model, 'claude-opus-4-8[1m]');
  assert.equal(summary.usedTokens, 2700);
  assert.equal(summary.totalTokens, 1_000_000);
  assert.equal(summary.freeTokens, 997_300);
  assert.equal(summary.mcpToolCount, 2);
  assert.equal(summary.memoryFileCount, 1);
  assert.equal(summary.skillCount, 2);
  assert.deepEqual(summary.categories, {
    systemPrompt: 875,
    memoryFiles: 157,
    skills: 1700,
    messages: 6,
    freeSpace: 997_300,
  });
  assert.doesNotMatch(JSON.stringify(summary), /C:\\\\Users\\\\syscr/);
});

test('extractClaudeContextMarkdownFromPayload reads assistant text and prefers result markdown', () => {
  assert.equal(
    extractClaudeContextMarkdownFromPayload({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'text',
            text: sampleContextMarkdown,
          },
        ],
      },
    }),
    sampleContextMarkdown,
  );

  assert.equal(
    extractClaudeContextMarkdownFromPayload({
      type: 'result',
      result: `${sampleContextMarkdown}\n`,
    }),
    `${sampleContextMarkdown}\n`,
  );

  assert.equal(
    extractClaudeContextMarkdownFromPayload({
      type: 'system',
      subtype: 'init',
      tools: ['Bash'],
    }),
    '',
  );
});

test('extractClaudeContextMarkdownFromPayload reads TUI /context local command stdout', () => {
  const tuiContext = [
    '\u001b[1mContext Usage\u001b[22m',
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

  assert.equal(
    extractClaudeContextMarkdownFromPayload({
      type: 'system',
      subtype: 'local_command',
      content: [
        '<command-name>/context</command-name>',
        `<local-command-stdout>${tuiContext}</local-command-stdout>`,
      ].join('\n'),
    }),
    tuiContext.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, ''),
  );
});

test('summarizeClaudeContextMarkdown extracts plain TUI context usage', () => {
  const summary = summarizeClaudeContextMarkdown([
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
    '',
    'MCP Tools',
    'mcp__fetch__fetch',
    'mcp__memory__read_graph',
  ].join('\n'));

  assert.equal(summary.hasContextUsage, true);
  assert.equal(summary.hasMcpTools, true);
  assert.equal(summary.hasFreeSpace, true);
  assert.equal(summary.hasSystemPrompt, true);
  assert.equal(summary.hasMemory, true);
  assert.equal(summary.hasSkills, true);
  assert.equal(summary.model, 'claude-opus-4-8[1m]');
  assert.equal(summary.usedTokens, 2_800);
  assert.equal(summary.totalTokens, 1_000_000);
  assert.equal(summary.freeTokens, 997_200);
  assert.equal(summary.percent, 0);
  assert.deepEqual(summary.categories, {
    systemPrompt: 921,
    memoryFiles: 157,
    skills: 1_700,
    messages: 5,
    freeSpace: 997_200,
  });
});
