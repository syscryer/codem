import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  readClaudeGlobalPrompt,
  saveClaudeGlobalPrompt,
} from './claude-global-prompt.js';

function withTemporaryDirectory<T>(callback: (directory: string) => T): T {
  const directory = mkdtempSync(path.join(tmpdir(), 'codem-claude-prompt-'));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('readClaudeGlobalPrompt returns empty content when CLAUDE.md is missing', () => {
  withTemporaryDirectory((homeDirectory) => {
    const result = readClaudeGlobalPrompt({ homeDirectory });

    assert.equal(result.content, '');
    assert.equal(result.exists, false);
    assert.equal(result.path, path.join(homeDirectory, '.claude', 'CLAUDE.md'));
  });
});

test('saveClaudeGlobalPrompt creates CLAUDE.md and preserves Markdown exactly', () => {
  withTemporaryDirectory((homeDirectory) => {
    const content = '\n# Global Prompt\n\nKeep exact whitespace.  \n';

    const saved = saveClaudeGlobalPrompt(content, { homeDirectory });
    const loaded = readClaudeGlobalPrompt({ homeDirectory });

    assert.equal(saved.exists, true);
    assert.equal(saved.content, content);
    assert.equal(loaded.content, content);
    assert.equal(readFileSync(path.join(homeDirectory, '.claude', 'CLAUDE.md'), 'utf8'), content);
  });
});

test('saveClaudeGlobalPrompt rejects oversized content', () => {
  withTemporaryDirectory((homeDirectory) => {
    assert.throws(
      () => saveClaudeGlobalPrompt('x'.repeat(200_001), { homeDirectory }),
      /全局提示词过大/,
    );
    assert.equal(existsSync(path.join(homeDirectory, '.claude', 'CLAUDE.md')), false);
  });
});

test('saveClaudeGlobalPrompt leaves no temporary files after successful rename', () => {
  withTemporaryDirectory((homeDirectory) => {
    saveClaudeGlobalPrompt('content', { homeDirectory });

    assert.deepEqual(
      readdirSync(path.join(homeDirectory, '.claude')).filter((fileName) => fileName.endsWith('.tmp')),
      [],
    );
  });
});
