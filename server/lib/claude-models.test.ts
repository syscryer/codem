import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getConfiguredModelOptions } from './claude-models.js';

function withIsolatedClaudeSettings<T>(
  settings: Record<string, unknown>,
  callback: () => T,
): T {
  const directory = mkdtempSync(path.join(tmpdir(), 'codem-claude-models-'));
  const home = path.join(directory, 'home');
  const claudeDirectory = path.join(home, '.claude');
  const previousUserProfile = process.env.USERPROFILE;
  const previousHome = process.env.HOME;

  try {
    mkdirSync(claudeDirectory, { recursive: true });
    writeFileSync(path.join(claudeDirectory, 'settings.json'), JSON.stringify(settings), 'utf8');
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    return callback();
  } finally {
    if (previousUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = previousUserProfile;
    }
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

test('getConfiguredModelOptions exposes official 1M aliases and opus plan for Anthropic Claude Code', () => {
  withIsolatedClaudeSettings({}, () => {
    const options = getConfiguredModelOptions();

    assert.deepEqual(
      options.map((option) => option.id),
      ['__default', 'sonnet', 'opus', 'opusplan', 'haiku'],
    );
    assert.deepEqual(
      options
        .filter((option) => option.supportsContext1m)
        .map((option) => [option.id, option.context1mModel]),
      [
        ['sonnet', 'sonnet[1m]'],
        ['opus', 'opus[1m]'],
      ],
    );
  });
});

test('getConfiguredModelOptions hides automatic 1M switches when Claude Code disables 1M context', () => {
  withIsolatedClaudeSettings(
    {
      env: {
        CLAUDE_CODE_DISABLE_1M_CONTEXT: '1',
      },
    },
    () => {
      const options = getConfiguredModelOptions();

      assert.deepEqual(
        options.filter((option) => option.supportsContext1m),
        [],
      );
    },
  );
});

test('getConfiguredModelOptions hides automatic 1M switches for third-party gateways', () => {
  withIsolatedClaudeSettings(
    {
      env: {
        ANTHROPIC_BASE_URL: 'https://example.com/anthropic-compatible',
      },
    },
    () => {
      const options = getConfiguredModelOptions();

      assert.deepEqual(
        options.filter((option) => option.supportsContext1m),
        [],
      );
    },
  );
});
