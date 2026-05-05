import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { listSlashCommands } from './slash-commands.js';

function withTemporaryDirectory<T>(callback: (directory: string) => T): T {
  const directory = mkdtempSync(path.join(tmpdir(), 'codem-slash-commands-'));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('listSlashCommands always returns built-in and app commands', () => {
  withTemporaryDirectory((homeDirectory) => {
    const commands = listSlashCommands({ homeDirectory });

    assert.ok(commands.some((command) => command.slash === '/status' && command.source === 'builtin'));
    assert.ok(commands.some((command) => command.slash === '/clear' && command.source === 'app'));
    assert.ok(commands.some((command) => command.slash === '/context' && command.source === 'builtin'));
    assert.ok(commands.some((command) => command.slash === '/cost' && command.source === 'builtin'));
    assert.ok(commands.some((command) => command.slash === '/compact' && command.source === 'builtin'));
  });
});

test('listSlashCommands does not expose unimplemented builtin commands', () => {
  withTemporaryDirectory((homeDirectory) => {
    const commands = listSlashCommands({ homeDirectory });

    assert.equal(
      commands.some(
        (command) => command.source === 'builtin' && command.action === 'local-action' && command.localActionId === 'not-implemented',
      ),
      false,
    );
    assert.equal(commands.some((command) => command.slash === '/review'), false);
    assert.equal(commands.some((command) => command.slash === '/help'), false);
  });
});

test('listSlashCommands annotates all visible commands with explicit agent scope', () => {
  withTemporaryDirectory((homeDirectory) => {
    const commands = listSlashCommands({ homeDirectory });

    assert.equal(commands.every((command) => Array.isArray(command.agentScope) && command.agentScope.length > 0), true);
    assert.equal(
      commands
        .filter((command) => ['/status', '/compact', '/context', '/cost', '/clear'].includes(command.slash))
        .every((command) => command.agentScope.includes('claude')),
      true,
    );
  });
});

test('listSlashCommands normalizes project, user, and plugin markdown commands', () => {
  withTemporaryDirectory((homeDirectory) => {
    const projectDirectory = path.join(homeDirectory, 'workspace');
    mkdirSync(path.join(homeDirectory, '.claude', 'commands'), { recursive: true });
    mkdirSync(path.join(projectDirectory, '.claude', 'commands', 'release'), { recursive: true });
    mkdirSync(
      path.join(
        homeDirectory,
        '.claude',
        'plugins',
        'marketplaces',
        'acme',
        'plugins',
        'feature-dev',
        'commands',
      ),
      { recursive: true },
    );

    writeFileSync(
      path.join(homeDirectory, '.claude', 'commands', 'deploy.md'),
      '---\ndescription: Deploy the app\n---\n# Deploy\n',
      'utf8',
    );
    writeFileSync(
      path.join(projectDirectory, '.claude', 'commands', 'release', '$ARGUMENTS.md'),
      '---\ndescription: Release a build\nargument-hint: Version tag\n---\n# Release\n',
      'utf8',
    );
    writeFileSync(
      path.join(
        homeDirectory,
        '.claude',
        'plugins',
        'marketplaces',
        'acme',
        'plugins',
        'feature-dev',
        'commands',
        'feature-dev.md',
      ),
      '---\ndescription: Guided feature development\n---\n# Feature Development\n',
      'utf8',
    );

    const commands = listSlashCommands({ homeDirectory, projectDirectory });

    assert.ok(commands.some((command) => command.slash === '/deploy' && command.source === 'user'));
    assert.ok(
      commands.some(
        (command) =>
          command.slash === '/release' &&
          command.source === 'project' &&
          command.argumentHint === 'Version tag',
      ),
    );
    assert.ok(commands.some((command) => command.slash === '/feature-dev:feature-dev' && command.source === 'plugin'));
  });
});

test('listSlashCommands turns skills into insert-template commands', () => {
  withTemporaryDirectory((homeDirectory) => {
    mkdirSync(path.join(homeDirectory, '.codex', 'skills', 'brainstorming'), { recursive: true });
    writeFileSync(
      path.join(homeDirectory, '.codex', 'skills', 'brainstorming', 'SKILL.md'),
      '---\nname: brainstorming\ndescription: Structured design exploration\n---\n# Brainstorming\n',
      'utf8',
    );

    const commands = listSlashCommands({ homeDirectory });
    const brainstorming = commands.find((command) => command.slash === '/brainstorming');

    assert.ok(brainstorming);
    assert.equal(brainstorming?.source, 'skill');
    assert.equal(brainstorming?.action, 'insert-template');
    assert.match(brainstorming?.template ?? '', /结构化 brainstorming|structured/i);
  });
});

test('listSlashCommands exposes MCP passthrough prefixes', () => {
  withTemporaryDirectory((homeDirectory) => {
    mkdirSync(path.join(homeDirectory, '.claude'), { recursive: true });
    writeFileSync(
      path.join(homeDirectory, '.claude', 'settings.json'),
      JSON.stringify({
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
          },
        },
      }),
      'utf8',
    );

    const commands = listSlashCommands({ homeDirectory });
    const githubMcp = commands.find((command) => command.slash === '/mcp__github__');

    assert.ok(githubMcp);
    assert.equal(githubMcp?.source, 'mcp');
    assert.equal(githubMcp?.action, 'passthrough');
  });
});

test('listSlashCommands keeps implemented builtin names reserved against custom collisions', () => {
  withTemporaryDirectory((homeDirectory) => {
    mkdirSync(path.join(homeDirectory, '.claude', 'commands'), { recursive: true });
    writeFileSync(
      path.join(homeDirectory, '.claude', 'commands', 'compact.md'),
      '---\ndescription: Custom compact\n---\n# Compact\n',
      'utf8',
    );

    const commands = listSlashCommands({ homeDirectory });
    const compact = commands.find((command) => command.slash === '/compact');

    assert.ok(compact);
    assert.equal(compact?.source, 'builtin');
    assert.equal(compact?.localActionId, 'compact-thread');
  });
});

test('listSlashCommands turns deprecated superpowers plugin commands into skill template aliases', () => {
  withTemporaryDirectory((homeDirectory) => {
    mkdirSync(
      path.join(
        homeDirectory,
        '.claude',
        'plugins',
        'marketplaces',
        'acme',
        'plugins',
        'superpowers',
        'commands',
      ),
      { recursive: true },
    );

    writeFileSync(
      path.join(
        homeDirectory,
        '.claude',
        'plugins',
        'marketplaces',
        'acme',
        'plugins',
        'superpowers',
        'commands',
        'brainstorm.md',
      ),
      '---\ndescription: Deprecated - use the superpowers:brainstorming skill instead\n---\n# Brainstorm\n',
      'utf8',
    );

    const commands = listSlashCommands({ homeDirectory });
    const brainstorm = commands.find((command) => command.slash === '/superpowers:brainstorm');

    assert.ok(brainstorm);
    assert.equal(brainstorm?.source, 'plugin');
    assert.equal(brainstorm?.action, 'insert-template');
    assert.match(brainstorm?.template ?? '', /结构化 brainstorming|design|方案/i);
    assert.equal(brainstorm?.slash, '/superpowers:brainstorm');
  });
});

test('listSlashCommands skips plugin markdown commands that disable model invocation', () => {
  withTemporaryDirectory((homeDirectory) => {
    mkdirSync(
      path.join(
        homeDirectory,
        '.claude',
        'plugins',
        'marketplaces',
        'acme',
        'plugins',
        'codex',
        'commands',
      ),
      { recursive: true },
    );

    writeFileSync(
      path.join(
        homeDirectory,
        '.claude',
        'plugins',
        'marketplaces',
        'acme',
        'plugins',
        'codex',
        'commands',
        'status.md',
      ),
      '---\ndescription: Show Codex job status\ndisable-model-invocation: true\n---\n# Status\n',
      'utf8',
    );

    const commands = listSlashCommands({ homeDirectory });

    // builtin /status 始终存在,这里只验证 plugin 来源的 status.md 因 disable-model-invocation 被剔除
    assert.equal(
      commands.some((command) => command.slash === '/status' && command.source === 'plugin'),
      false,
    );
  });
});

test('listSlashCommands namespaces plugin markdown commands to avoid builtin collisions', () => {
  withTemporaryDirectory((homeDirectory) => {
    mkdirSync(
      path.join(
        homeDirectory,
        '.claude',
        'plugins',
        'marketplaces',
        'acme',
        'plugins',
        'codex',
        'commands',
      ),
      { recursive: true },
    );

    writeFileSync(
      path.join(
        homeDirectory,
        '.claude',
        'plugins',
        'marketplaces',
        'acme',
        'plugins',
        'codex',
        'commands',
        'status.md',
      ),
      '---\ndescription: Show Codex job status\n---\n# Status\n',
      'utf8',
    );

    const commands = listSlashCommands({ homeDirectory });
    const status = commands.find(
      (command) => command.source === 'plugin' && command.name.includes('status'),
    );

    assert.ok(status);
    assert.equal(status?.source, 'plugin');
    assert.ok(status?.slash.startsWith('/codex:'));
  });
});
