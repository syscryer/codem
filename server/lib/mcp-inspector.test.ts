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
