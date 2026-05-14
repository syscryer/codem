import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  installSkillFromPath,
  listInstalledPlugins,
  listMarketplaces,
  listSkills,
  runPluginCommand,
} from './plugins.js';

async function withTemporaryDirectory<T>(callback: (directory: string) => Promise<T> | T): Promise<T> {
  const directory = mkdtempSync(path.join(tmpdir(), 'codem-plugins-'));
  try {
    return await callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('plugin service reads installed plugins with marketplace metadata', async () => {
  await withPluginFixture(async ({ homeDirectory }) => {
    const installed = await listInstalledPlugins({ homeDirectory });

    assert.equal(installed.length, 2);
    assert.deepEqual(installed.map((item) => item.id), [
      'feature-dev@acme-market',
      'feature-dev@acme-market',
    ]);
    assert.equal(installed[0].description, 'Feature development workflow');
    assert.equal(installed[0].author, 'Acme');
    assert.equal(installed[0].scope, 'project');
    assert.equal(installed[1].scope, 'user');
    assert.equal(installed[1].installPath?.endsWith(path.join('plugins', 'feature-dev')), true);
  });
});

test('plugin service reads known marketplaces and available plugins', async () => {
  await withPluginFixture(async ({ homeDirectory }) => {
    const marketplaces = await listMarketplaces({ homeDirectory });

    assert.equal(marketplaces.length, 1);
    assert.equal(marketplaces[0].name, 'acme-market');
    assert.equal(marketplaces[0].source, 'acme/marketplace');
    assert.equal(marketplaces[0].plugins.length, 2);
    assert.deepEqual(
      marketplaces[0].plugins.map((item) => item.name),
      ['feature-dev', 'qa-helper'],
    );
  });
});

test('plugin service reads user, project, and plugin skills', async () => {
  await withPluginFixture(async ({ homeDirectory, projectDirectory }) => {
    const skills = await listSkills(projectDirectory, { homeDirectory });

    assert.deepEqual(
      skills.map((item) => ({
        name: item.name,
        source: item.source,
        disableModelInvocation: item.disableModelInvocation,
        userInvocable: item.userInvocable,
      })),
      [
        {
          name: 'feature-checklist',
          source: 'plugin:feature-dev@acme-market',
          disableModelInvocation: true,
          userInvocable: false,
        },
        {
          name: 'project-ship',
          source: 'project',
          disableModelInvocation: false,
          userInvocable: true,
        },
        {
          name: 'writer',
          source: 'user',
          disableModelInvocation: false,
          userInvocable: true,
        },
      ],
    );
  });
});

test('plugin service can import a skill directory into project scope', async () => {
  await withPluginFixture(async ({ homeDirectory, projectDirectory, rootDirectory }) => {
    const importDirectory = path.join(rootDirectory, 'imports', 'refactor-helper');
    mkdirSync(importDirectory, { recursive: true });
    writeFileSync(
      path.join(importDirectory, 'SKILL.md'),
      [
        '---',
        'name: refactor-helper',
        'description: Helps refactor code safely',
        '---',
        '# Refactor Helper',
        '',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(path.join(importDirectory, 'notes.txt'), 'keep me', 'utf8');

    const result = await installSkillFromPath(
      {
        path: importDirectory,
        scope: 'project',
        cwd: projectDirectory,
        overwrite: false,
      },
      { homeDirectory },
    );

    assert.deepEqual(result.installed.map((item) => item.name), ['refactor-helper']);

    const importedSkills = await listSkills(projectDirectory, { homeDirectory });
    assert.ok(importedSkills.some((item) => item.name === 'refactor-helper' && item.source === 'project'));
  });
});

test('plugin service builds claude plugin commands for marketplace and plugin actions', async () => {
  const marketplaceResult = await runPluginCommand(
    {
      action: 'add',
      kind: 'marketplace',
      target: 'acme/marketplace',
    },
    {
      commandRunner: async (command, args, options) => ({
        command,
        args,
        cwd: options.cwd ?? null,
        stdout: '',
        stderr: '',
        exitCode: 0,
      }),
    },
  );

  assert.deepEqual(marketplaceResult.command, 'claude');
  assert.deepEqual(marketplaceResult.args, ['plugin', 'marketplace', 'add', 'acme/marketplace']);

  const pluginResult = await runPluginCommand(
    {
      action: 'install',
      kind: 'plugin',
      target: 'feature-dev@acme-market',
      scope: 'project',
      cwd: 'D:/project/codem',
    },
    {
      commandRunner: async (command, args, options) => ({
        command,
        args,
        cwd: options.cwd ?? null,
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
      }),
    },
  );

  assert.deepEqual(pluginResult.args, [
    'plugin',
    'install',
    'feature-dev@acme-market',
    '--scope',
    'project',
  ]);
  assert.equal(pluginResult.cwd, 'D:/project/codem');
  assert.equal(pluginResult.exit_code, 0);
});

type FixtureContext = {
  rootDirectory: string;
  homeDirectory: string;
  projectDirectory: string;
};

async function withPluginFixture<T>(callback: (context: FixtureContext) => Promise<T> | T) {
  return await withTemporaryDirectory(async (rootDirectory) => {
    const homeDirectory = path.join(rootDirectory, 'home');
    const projectDirectory = path.join(rootDirectory, 'workspace');
    mkdirSync(homeDirectory, { recursive: true });
    mkdirSync(projectDirectory, { recursive: true });

    seedPluginFixture(homeDirectory, projectDirectory);

    return callback({ rootDirectory, homeDirectory, projectDirectory });
  });
}

function seedPluginFixture(homeDirectory: string, projectDirectory: string) {
  const claudeRoot = path.join(homeDirectory, '.claude');
  const pluginsRoot = path.join(claudeRoot, 'plugins');
  const marketRoot = path.join(pluginsRoot, 'marketplaces', 'acme-market', '.claude-plugin');
  const cacheSkillsRoot = path.join(
    pluginsRoot,
    'cache',
    'acme-market',
    'feature-dev',
    '1.2.3',
    'skills',
    'feature-checklist',
  );
  const userSkillRoot = path.join(claudeRoot, 'skills', 'writer');
  const projectSkillRoot = path.join(projectDirectory, '.claude', 'skills', 'project-ship');

  mkdirSync(marketRoot, { recursive: true });
  mkdirSync(cacheSkillsRoot, { recursive: true });
  mkdirSync(userSkillRoot, { recursive: true });
  mkdirSync(projectSkillRoot, { recursive: true });

  writeFileSync(
    path.join(pluginsRoot, 'installed_plugins.json'),
    JSON.stringify(
      {
        plugins: {
          'feature-dev@acme-market': [
            {
              scope: 'user',
              version: '1.2.3',
              installPath: path.join(homeDirectory, '.claude', 'plugins', 'feature-dev'),
              installedAt: '2026-05-13T10:00:00.000Z',
              lastUpdated: '2026-05-13T11:00:00.000Z',
            },
            {
              scope: 'project',
              version: '1.2.3',
              projectPath: projectDirectory,
              installedAt: '2026-05-13T10:30:00.000Z',
              lastUpdated: '2026-05-13T11:30:00.000Z',
            },
          ],
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  writeFileSync(
    path.join(pluginsRoot, 'known_marketplaces.json'),
    JSON.stringify(
      {
        'acme-market': {
          source: { repo: 'acme/marketplace' },
          installLocation: path.join(homeDirectory, '.claude', 'plugins', 'marketplaces', 'acme-market'),
          lastUpdated: '2026-05-13T09:00:00.000Z',
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  writeFileSync(
    path.join(marketRoot, 'marketplace.json'),
    JSON.stringify(
      {
        plugins: [
          {
            name: 'feature-dev',
            description: 'Feature development workflow',
            category: 'workflow',
            homepage: 'https://example.com/feature-dev',
            author: { name: 'Acme' },
          },
          {
            name: 'qa-helper',
            description: 'QA support plugin',
            category: 'quality',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  writeFileSync(
    path.join(cacheSkillsRoot, 'SKILL.md'),
    [
      '---',
      'name: feature-checklist',
      'description: Verifies feature launch readiness',
      'disable-model-invocation: true',
      'user-invocable: false',
      '---',
      '# Feature Checklist',
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    path.join(userSkillRoot, 'SKILL.md'),
    [
      '---',
      'name: writer',
      'description: Writes clearly',
      '---',
      '# Writer',
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    path.join(projectSkillRoot, 'SKILL.md'),
    [
      '---',
      'name: project-ship',
      'description: Ships the current workspace',
      '---',
      '# Project Ship',
      '',
    ].join('\n'),
    'utf8',
  );
}
