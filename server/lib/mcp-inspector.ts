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
  appDataDirectory?: string;
  projectDirectory?: string;
};

export function listMcpServers(options: McpInspectorOptions = {}): McpServersResponse {
  const homeDirectory = options.homeDirectory || process.env.USERPROFILE || process.env.HOME || homedir();
  const appDataDirectory = options.appDataDirectory || (options.homeDirectory ? path.join(homeDirectory, 'AppData', 'Roaming') : process.env.APPDATA);
  const projectDirectory = options.projectDirectory || process.cwd();
  const servers: McpServerSummary[] = [];
  const errors: McpSourceError[] = [];

  readJsonMcpServers('Claude Code settings', path.join(homeDirectory, '.claude', 'settings.json'), servers, errors);
  readJsonMcpServers('Claude Code global', path.join(homeDirectory, '.claude.json'), servers, errors);
  if (appDataDirectory) {
    readJsonMcpServers('Claude Desktop', path.join(appDataDirectory, 'Claude', 'claude_desktop_config.json'), servers, errors);
  }
  readCodexToml(path.join(homeDirectory, '.codex', 'config.toml'), servers, errors);
  readJsonMcpServers('Project MCP', path.join(projectDirectory, '.mcp.json'), servers, errors);
  readJsonMcpServers('Cursor MCP', path.join(projectDirectory, '.cursor', 'mcp.json'), servers, errors);

  return { servers, errors };
}

function readJsonMcpServers(
  sourceName: string,
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
        id: `${sourceName}:${name}`,
        name,
        source: settingsPath,
        status: 'unknown',
        tools: [],
        command,
        args: redactArgs(args),
      });
    }
  } catch (error) {
    errors.push({
      source: sourceName,
      path: settingsPath,
      message: `解析 MCP 配置失败：${error instanceof Error ? error.message : '未知错误'}`,
    });
  }
}

function readCodexToml(settingsPath: string, servers: McpServerSummary[], errors: McpSourceError[]) {
  if (!existsSync(settingsPath)) {
    return;
  }

  try {
    const content = readFileSync(settingsPath, 'utf8');
    const parsedServers = parseCodexMcpServers(content);
    for (const server of parsedServers) {
      servers.push({
        id: `Codex:${server.name}`,
        name: server.name,
        source: settingsPath,
        status: 'unknown',
        tools: [],
        command: server.command,
        args: redactArgs(server.args),
      });
    }
  } catch (error) {
    errors.push({
      source: 'Codex',
      path: settingsPath,
      message: `解析 MCP 配置失败：${error instanceof Error ? error.message : '未知错误'}`,
    });
  }
}

function parseCodexMcpServers(content: string) {
  const servers = new Map<string, { name: string; command?: string; args?: string[] }>();
  let activeName = '';

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) {
      continue;
    }

    const tableMatch = line.match(/^\[([^\]]+)\]$/);
    if (tableMatch) {
      activeName = parseMcpServerTableName(tableMatch[1]);
      if (activeName && !servers.has(activeName)) {
        servers.set(activeName, { name: activeName });
      }
      continue;
    }

    if (!activeName) {
      continue;
    }

    const assignmentMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignmentMatch) {
      continue;
    }

    const server = servers.get(activeName);
    if (!server) {
      continue;
    }

    const key = assignmentMatch[1];
    const value = assignmentMatch[2].trim();
    if (key === 'command') {
      server.command = parseTomlString(value);
    }
    if (key === 'args') {
      server.args = parseTomlStringArray(value);
    }
  }

  return [...servers.values()];
}

function parseMcpServerTableName(tableName: string) {
  const normalized = tableName.trim();
  if (!normalized.startsWith('mcp_servers.')) {
    return '';
  }

  const rest = normalized.slice('mcp_servers.'.length);
  if (!rest || rest.includes('.')) {
    return '';
  }

  return unquoteTomlString(rest);
}

function stripTomlComment(line: string) {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if ((character === '"' || character === "'") && line[index - 1] !== '\\') {
      quote = quote === character ? null : quote || character;
      continue;
    }
    if (character === '#' && !quote) {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseTomlString(value: string) {
  return unquoteTomlString(value.trim());
}

function parseTomlStringArray(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return undefined;
  }

  const items: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let index = 1; index < trimmed.length - 1; index += 1) {
    const character = trimmed[index];
    if ((character === '"' || character === "'") && trimmed[index - 1] !== '\\') {
      quote = quote === character ? null : quote || character;
      current += character;
      continue;
    }
    if (character === ',' && !quote) {
      const parsed = parseTomlString(current);
      if (parsed) {
        items.push(parsed);
      }
      current = '';
      continue;
    }
    current += character;
  }

  const parsed = parseTomlString(current);
  if (parsed) {
    items.push(parsed);
  }
  return items;
}

function unquoteTomlString(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function redactArgs(args: string[] | undefined) {
  if (!args) {
    return undefined;
  }

  return args.map((arg, index) => {
    if (index > 0 && isSensitiveArgName(args[index - 1])) {
      return '<redacted>';
    }

    const equalIndex = arg.indexOf('=');
    if (equalIndex > 0 && isSensitiveArgName(arg.slice(0, equalIndex))) {
      return `${arg.slice(0, equalIndex + 1)}<redacted>`;
    }

    return arg;
  });
}

function isSensitiveArgName(value: string) {
  return /(?:api[-_]?key|token|secret|password|passwd|credential|access[-_]?key|auth)/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
