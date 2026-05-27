import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getClaudeProviderSnapshot, getConfiguredModelOptions } from './claude-models.js';

const providerEnvKeys = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_DISABLE_1M_CONTEXT',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'HTTPS_PROXY',
  'HTTP_PROXY',
] as const;

function withIsolatedClaudeSettings<T>(
  settings: Record<string, unknown>,
  callback: () => T,
): T {
  const directory = mkdtempSync(path.join(tmpdir(), 'codem-claude-models-'));
  const home = path.join(directory, 'home');
  const claudeDirectory = path.join(home, '.claude');
  const previousUserProfile = process.env.USERPROFILE;
  const previousHome = process.env.HOME;
  const previousProviderEnv = new Map<string, string | undefined>();

  try {
    mkdirSync(claudeDirectory, { recursive: true });
    writeFileSync(path.join(claudeDirectory, 'settings.json'), JSON.stringify(settings), 'utf8');
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    providerEnvKeys.forEach((key) => {
      previousProviderEnv.set(key, process.env[key]);
      delete process.env[key];
    });
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
    providerEnvKeys.forEach((key) => {
      const previous = previousProviderEnv.get(key);
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    });
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

test('getClaudeProviderSnapshot changes fingerprint for provider-affecting config', () => {
  const first = withIsolatedClaudeSettings(
    {
      env: {
        ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
        ANTHROPIC_MODEL: 'glm-5.1',
        ANTHROPIC_AUTH_TOKEN: 'secret-token-a',
      },
    },
    () => getClaudeProviderSnapshot(),
  );
  const second = withIsolatedClaudeSettings(
    {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.minimaxi.com/anthropic',
        ANTHROPIC_MODEL: 'MiniMax-M2',
        ANTHROPIC_AUTH_TOKEN: 'secret-token-b',
      },
    },
    () => getClaudeProviderSnapshot(),
  );

  assert.notEqual(first.fingerprint, second.fingerprint);
  assert.equal(first.defaultModel, 'glm-5.1');
  assert.equal(second.defaultModel, 'MiniMax-M2');
});

test('getClaudeProviderSnapshot does not expose secrets or credentialed URLs', () => {
  const snapshot = withIsolatedClaudeSettings(
    {
      env: {
        ANTHROPIC_BASE_URL: 'https://user:password@example.com/anthropic',
        ANTHROPIC_MODEL: 'glm-5.1',
        ANTHROPIC_AUTH_TOKEN: 'secret-token',
        ANTHROPIC_API_KEY: 'secret-key',
      },
    },
    () => getClaudeProviderSnapshot(),
  );
  const serialized = JSON.stringify(snapshot);

  assert.equal(snapshot.baseUrlHost, 'example.com');
  assert.doesNotMatch(serialized, /secret-token|secret-key|user:password/);
  assert.match(snapshot.fingerprint, /^[a-f0-9]{64}$/);
});
