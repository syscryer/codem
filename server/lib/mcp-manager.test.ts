import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  ensureMcpConfigFile,
  readMcpConfigSnapshot,
  writeClaudeJsonMcpConfig,
  writeMcpConfig,
} from './mcp-manager.js';

function withTemporaryDirectory<T>(callback: (directory: string) => T): T {
  const directory = mkdtempSync(path.join(tmpdir(), 'codem-mcp-manager-'));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('readMcpConfigSnapshot reads global, project, and claude json project configs', () => {
  withTemporaryDirectory((homeDirectory) => {
    const projectDirectory = path.join(homeDirectory, 'workspace', 'demo');
    mkdirSync(path.join(homeDirectory, '.claude'), { recursive: true });
    mkdirSync(projectDirectory, { recursive: true });

    writeFileSync(
      path.join(homeDirectory, '.claude', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          filesystem: {
            command: 'npx',
          },
        },
      }),
      'utf8',
    );
    writeFileSync(
      path.join(projectDirectory, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          project: {
            command: 'node',
            args: ['server.js'],
          },
        },
      }),
      'utf8',
    );
    writeFileSync(
      path.join(homeDirectory, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          root: {
            command: 'uvx',
          },
        },
        projects: {
          [projectDirectory.replace(/\\/g, '/')]: {
            mcpServers: {
              github: {
                type: 'http',
                url: 'https://example.com/mcp',
              },
            },
          },
        },
      }),
      'utf8',
    );

    const snapshot = readMcpConfigSnapshot({ homeDirectory, projectDirectory });

    assert.equal(snapshot.hasProject, true);
    assert.equal(snapshot.configs.global.mcpServers?.filesystem?.command, 'npx');
    assert.equal(snapshot.configs.project.mcpServers?.project?.command, 'node');
    assert.equal(snapshot.configs.claudeJsonGlobal.mcpServers?.root?.command, 'uvx');
    assert.equal(snapshot.configs.claudeJsonProject.mcpServers?.github?.url, 'https://example.com/mcp');
  });
});

test('writeClaudeJsonMcpConfig preserves existing root fields and writes project mcp servers', () => {
  withTemporaryDirectory((homeDirectory) => {
    const projectDirectory = path.join(homeDirectory, 'workspace', 'demo');
    mkdirSync(projectDirectory, { recursive: true });

    writeFileSync(
      path.join(homeDirectory, '.claude.json'),
      JSON.stringify({
        theme: 'dark',
        projects: {
          [projectDirectory.replace(/\\/g, '/')]: {
            note: 'keep',
          },
        },
      }),
      'utf8',
    );

    writeClaudeJsonMcpConfig(
      'project',
      {
        mcpServers: {
          fetch: {
            command: 'uvx',
            args: ['mcp-server-fetch'],
          },
        },
      },
      { homeDirectory, projectDirectory },
    );

    const stored = JSON.parse(readFileSync(path.join(homeDirectory, '.claude.json'), 'utf8')) as Record<string, any>;
    const projectEntry = stored.projects[projectDirectory.replace(/\\/g, '/')];

    assert.equal(stored.theme, 'dark');
    assert.equal(projectEntry.note, 'keep');
    assert.equal(projectEntry.mcpServers.fetch.command, 'uvx');
  });
});

test('ensureMcpConfigFile returns the project mcp path and keeps utf8 json content', () => {
  withTemporaryDirectory((homeDirectory) => {
    const projectDirectory = path.join(homeDirectory, 'workspace', 'demo');
    mkdirSync(projectDirectory, { recursive: true });

    writeMcpConfig(
      'project',
      {
        mcpServers: {
          browser: {
            command: 'npx',
            args: ['-y', '@playwright/mcp'],
          },
        },
      },
      { homeDirectory, projectDirectory },
    );

    const filePath = ensureMcpConfigFile('project', { homeDirectory, projectDirectory });
    const stored = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, any>;

    assert.equal(path.basename(filePath), '.mcp.json');
    assert.equal(stored.mcpServers.browser.command, 'npx');
  });
});
