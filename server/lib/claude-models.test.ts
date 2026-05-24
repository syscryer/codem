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

test('getConfiguredModelOptions keeps the primary model menu focused on common choices', () => {
  withIsolatedClaudeSettings({}, () => {
    const options = getConfiguredModelOptions();

    assert.deepEqual(
      options.map((option) => option.id),
      ['__default', 'sonnet', 'opus', 'haiku'],
    );
    assert.equal(options.some((option) => option.id === 'opusplan'), false);
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

test('getConfiguredModelOptions labels the default option with the configured Claude model', () => {
  withIsolatedClaudeSettings(
    {
      env: {
        ANTHROPIC_MODEL: 'claude-sonnet-4-5',
      },
    },
    () => {
      const options = getConfiguredModelOptions();

      assert.deepEqual(options[0], {
        id: '__default',
        label: 'claude-sonnet-4-5',
        description: '使用当前 Claude Code 默认模型：claude-sonnet-4-5',
        model: 'claude-sonnet-4-5',
        kind: 'default',
      });
    },
  );
});

test('getConfiguredModelOptions keeps 1M switches visible for Anthropic-compatible gateways', () => {
  withIsolatedClaudeSettings(
    {
      env: {
        ANTHROPIC_BASE_URL: 'https://example.com/anthropic-compatible',
      },
    },
    () => {
      const options = getConfiguredModelOptions();

      assert.deepEqual(
        options
          .filter((option) => option.supportsContext1m)
          .map((option) => [option.id, option.context1mModel]),
        [
          ['sonnet', 'sonnet[1m]'],
          ['opus', 'opus[1m]'],
        ],
      );
    },
  );
});

test('getConfiguredModelOptions keeps configured non-Claude gateway slots without 1M switches', () => {
  withIsolatedClaudeSettings(
    {
      env: {
        ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
        ANTHROPIC_MODEL: 'glm-5.1',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.1',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.1',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-5.1',
      },
    },
    () => {
      const options = getConfiguredModelOptions();

      assert.deepEqual(
        options.map((option) => [option.id, option.label, option.model, option.supportsContext1m, option.context1mModel]),
        [
          ['__default', 'glm-5.1', 'glm-5.1', undefined, undefined],
          ['sonnet', 'Sonnet', 'glm-5.1', undefined, undefined],
          ['opus', 'Opus', 'glm-5.1', undefined, undefined],
          ['haiku', 'Haiku', 'glm-5.1', undefined, undefined],
        ],
      );
    },
  );
});
