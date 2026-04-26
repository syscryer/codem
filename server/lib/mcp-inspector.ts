import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type McpServerSummary = {
  id: string;
  name: string;
  source: string;
  status: 'available' | 'unknown' | 'error';
  tools: Array<{ name: string; description?: string }>;
  command?: string;
  args?: string[];
  error?: string;
};

export type McpSourceError = {
  source: string;
  path: string;
  message: string;
};

export type McpServersResponse = {
  servers: McpServerSummary[];
  errors: McpSourceError[];
};

type McpInspectorOptions = {
  homeDirectory?: string;
};

export function listMcpServers(options: McpInspectorOptions = {}): McpServersResponse {
  const homeDirectory = options.homeDirectory || process.env.USERPROFILE || process.env.HOME || homedir();
  const servers: McpServerSummary[] = [];
  const errors: McpSourceError[] = [];

  readClaudeSettings(path.join(homeDirectory, '.claude', 'settings.json'), servers, errors);

  return { servers, errors };
}

function readClaudeSettings(
  settingsPath: string,
  servers: McpServerSummary[],
  errors: McpSourceError[],
) {
  if (!existsSync(settingsPath)) {
    return;
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
      return;
    }

    for (const [name, rawServer] of Object.entries(parsed.mcpServers)) {
      if (!isRecord(rawServer)) {
        continue;
      }

      const command = typeof rawServer.command === 'string' ? rawServer.command : undefined;
      const args = Array.isArray(rawServer.args)
        ? rawServer.args.filter((item): item is string => typeof item === 'string')
        : undefined;

      servers.push({
        id: `claude:${name}`,
        name,
        source: settingsPath,
        status: 'unknown',
        tools: [],
        command,
        args,
      });
    }
  } catch (error) {
    errors.push({
      source: 'Claude Code',
      path: settingsPath,
      message: `解析 MCP 配置失败：${error instanceof Error ? error.message : '未知错误'}`,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
