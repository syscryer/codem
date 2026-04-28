import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { listMcpServers } from './mcp-inspector.js';

function withTemporaryDirectory<T>(callback: (directory: string) => T): T {
  const directory = mkdtempSync(path.join(tmpdir(), 'codem-mcp-'));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('listMcpServers parses Claude mcpServers without exposing env secrets', () => {
  withTemporaryDirectory((homeDirectory) => {
    const claudeDirectory = path.join(homeDirectory, '.claude');
    mkdirSync(claudeDirectory, { recursive: true });
    writeFileSync(
      path.join(claudeDirectory, 'settings.json'),
      JSON.stringify({
        mcpServers: {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem'],
            env: { API_KEY: 'secret' },
          },
        },
      }),
      'utf8',
    );

    const result = listMcpServers({ homeDirectory });

    assert.equal(result.servers.length, 1);
    assert.equal(result.servers[0].name, 'filesystem');
    assert.equal(result.servers[0].status, 'unknown');
    assert.equal(result.servers[0].command, 'npx');
    assert.deepEqual(result.servers[0].args, ['-y', '@modelcontextprotocol/server-filesystem']);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  });
});

test('listMcpServers returns per-source errors for malformed config', () => {
  withTemporaryDirectory((homeDirectory) => {
    const claudeDirectory = path.join(homeDirectory, '.claude');
    mkdirSync(claudeDirectory, { recursive: true });
    writeFileSync(path.join(claudeDirectory, 'settings.json'), '{ broken json', 'utf8');

    const result = listMcpServers({ homeDirectory });

    assert.equal(result.servers.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /解析 MCP 配置失败/);
  });
});

test('listMcpServers reads Claude global, Desktop, Codex, and project configs', () => {
  withTemporaryDirectory((homeDirectory) => {
    const appDataDirectory = path.join(homeDirectory, 'AppData', 'Roaming');
    const projectDirectory = path.join(homeDirectory, 'project');
    mkdirSync(path.join(appDataDirectory, 'Claude'), { recursive: true });
    mkdirSync(path.join(homeDirectory, '.codex'), { recursive: true });
    mkdirSync(projectDirectory, { recursive: true });

    writeFileSync(
      path.join(homeDirectory, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          database: {
            command: 'python',
            args: ['server.py'],
          },
        },
      }),
      'utf8',
    );
    writeFileSync(
      path.join(appDataDirectory, 'Claude', 'claude_desktop_config.json'),
      JSON.stringify({
        mcpServers: {
          brave: {
            command: 'npx',
            args: ['-y', '@brave/brave-search-mcp-server', '--brave-api-key', 'secret-key'],
          },
        },
      }),
      'utf8',
    );
    writeFileSync(
      path.join(homeDirectory, '.codex', 'config.toml'),
      [
        '[mcp_servers.fetch]',
        'command = "uvx"',
        'args = ["mcp-server-fetch"]',
        '[mcp_servers.fetch.env]',
        'TOKEN = "hidden"',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      path.join(projectDirectory, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          project: {
            command: 'node',
            args: ['server.js', '--token=hidden'],
          },
        },
      }),
      'utf8',
    );

    const result = listMcpServers({ homeDirectory, appDataDirectory, projectDirectory });

    assert.deepEqual(
      result.servers.map((server) => server.name).sort(),
      ['brave', 'database', 'fetch', 'project'],
    );
    assert.equal(JSON.stringify(result).includes('secret-key'), false);
    assert.equal(JSON.stringify(result).includes('TOKEN'), false);
    assert.equal(JSON.stringify(result).includes('--token=hidden'), false);
    assert.equal(result.servers.find((server) => server.name === 'brave')?.args?.at(-1), '<redacted>');
    assert.equal(result.servers.find((server) => server.name === 'project')?.args?.at(-1), '--token=<redacted>');
  });
});
