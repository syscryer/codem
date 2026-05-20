import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type McpScope = 'global' | 'project';
export type McpManagedScope = McpScope | 'claude-json-global' | 'claude-json-project';

export type McpServerConfig = {
  type?: 'stdio' | 'http' | string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  envPassthrough?: string[];
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  auth?: 'none' | 'bearer' | 'oauth' | string;
  disabled?: boolean;
  [key: string]: unknown;
};

export type McpConfigFile = {
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
};

export type McpConfigSnapshot = {
  paths: {
    global: string;
    project: string;
    claudeJson: string;
  };
  configs: {
    global: McpConfigFile;
    project: McpConfigFile;
    claudeJsonGlobal: McpConfigFile;
    claudeJsonProject: McpConfigFile;
  };
  hasProject: boolean;
};

type McpManagerOptions = {
  homeDirectory?: string;
  projectDirectory?: string;
};

export function readMcpConfigSnapshot(options: McpManagerOptions = {}): McpConfigSnapshot {
  const homeDirectory = resolveHomeDirectory(options.homeDirectory);
  const projectDirectory = resolveProjectDirectory(options.projectDirectory);
  const globalPath = resolveMcpConfigPath('global', homeDirectory);
  const projectPath = projectDirectory ? resolveMcpConfigPath('project', homeDirectory, projectDirectory) : '';
  const claudeJsonPath = resolveClaudeJsonPath(homeDirectory);
  const claudeJsonValue = readJsonFileIfExists(claudeJsonPath);

  return {
    paths: {
      global: globalPath,
      project: projectPath,
      claudeJson: claudeJsonPath,
    },
    configs: {
      global: normalizeMcpConfig(readJsonFileIfExists(globalPath)),
      project: normalizeMcpConfig(projectPath ? readJsonFileIfExists(projectPath) : null),
      claudeJsonGlobal: normalizeMcpConfig(extractClaudeJsonMcpConfig(claudeJsonValue)),
      claudeJsonProject: normalizeMcpConfig(
        projectDirectory ? extractClaudeJsonProjectMcpConfig(claudeJsonValue, projectDirectory) : null,
      ),
    },
    hasProject: Boolean(projectDirectory),
  };
}

export function writeMcpConfig(scope: McpScope, data: unknown, options: McpManagerOptions = {}): McpConfigFile {
  const homeDirectory = resolveHomeDirectory(options.homeDirectory);
  const projectDirectory = resolveRequiredProjectDirectory(scope, options.projectDirectory);
  const config = normalizeMcpConfig(data);
  const targetPath = resolveMcpConfigPath(scope, homeDirectory, projectDirectory);
  writeJsonFile(targetPath, config);
  return config;
}

export function writeClaudeJsonMcpConfig(
  scope: McpScope,
  data: unknown,
  options: McpManagerOptions = {},
): McpConfigFile {
  const homeDirectory = resolveHomeDirectory(options.homeDirectory);
  const projectDirectory = resolveRequiredProjectDirectory(scope, options.projectDirectory);
  const config = normalizeMcpConfig(data);
  const targetPath = resolveClaudeJsonPath(homeDirectory);
  const nextRoot = applyClaudeJsonMcpConfig(readJsonFileIfExists(targetPath), scope, config, projectDirectory);
  writeJsonFile(targetPath, nextRoot);
  return config;
}

export function ensureMcpConfigFile(scope: McpManagedScope, options: McpManagerOptions = {}) {
  const snapshot = readMcpConfigSnapshot(options);
  if (scope === 'global') {
    if (!existsSync(snapshot.paths.global)) {
      writeJsonFile(snapshot.paths.global, snapshot.configs.global);
    }
    return snapshot.paths.global;
  }

  if (scope === 'project') {
    const projectPath = snapshot.paths.project;
    if (!projectPath) {
      throw new Error('当前没有项目目录，不能打开项目级 MCP 配置');
    }
    if (!existsSync(projectPath)) {
      writeJsonFile(projectPath, snapshot.configs.project);
    }
    return projectPath;
  }

  if (!existsSync(snapshot.paths.claudeJson)) {
    const claudeJsonScope = scope === 'claude-json-project' ? 'project' : 'global';
    const config =
      scope === 'claude-json-project' ? snapshot.configs.claudeJsonProject : snapshot.configs.claudeJsonGlobal;
    const root = applyClaudeJsonMcpConfig({}, claudeJsonScope, config, options.projectDirectory);
    writeJsonFile(snapshot.paths.claudeJson, root);
  }

  return snapshot.paths.claudeJson;
}

export function normalizeMcpConfig(value: unknown): McpConfigFile {
  if (!isRecord(value)) {
    return { mcpServers: {} };
  }

  const servers = isRecord(value.mcpServers)
    ? Object.fromEntries(
        Object.entries(value.mcpServers)
          .filter(([name, config]) => Boolean(name.trim()) && isRecord(config))
          .map(([name, config]) => [name, { ...config }]),
      )
    : {};

  return {
    ...value,
    mcpServers: servers,
  };
}

function resolveHomeDirectory(homeDirectory?: string) {
  const resolved = homeDirectory?.trim() || process.env.USERPROFILE || process.env.HOME || homedir();
  return path.resolve(resolved);
}

function resolveProjectDirectory(projectDirectory?: string) {
  return projectDirectory?.trim() ? path.resolve(projectDirectory.trim()) : '';
}

function resolveRequiredProjectDirectory(scope: McpScope, projectDirectory?: string) {
  if (scope !== 'project') {
    return resolveProjectDirectory(projectDirectory);
  }

  const resolved = resolveProjectDirectory(projectDirectory);
  if (!resolved) {
    throw new Error('项目级 MCP 配置需要项目目录');
  }
  return resolved;
}

function resolveMcpConfigPath(scope: McpScope, homeDirectory: string, projectDirectory = '') {
  if (scope === 'global') {
    return path.join(homeDirectory, '.claude', 'mcp.json');
  }

  if (!projectDirectory) {
    throw new Error('项目级 MCP 配置需要项目目录');
  }

  return path.join(projectDirectory, '.mcp.json');
}

function resolveClaudeJsonPath(homeDirectory: string) {
  return path.join(homeDirectory, '.claude.json');
}

function readJsonFileIfExists(filePath: string) {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }

  const content = readFileSync(filePath, 'utf8');
  return JSON.parse(content) as unknown;
}

function writeJsonFile(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function extractClaudeJsonMcpConfig(value: unknown) {
  if (!isRecord(value) || !isRecord(value.mcpServers)) {
    return null;
  }

  return { mcpServers: value.mcpServers };
}

function extractClaudeJsonProjectMcpConfig(value: unknown, projectDirectory: string) {
  if (!isRecord(value) || !isRecord(value.projects)) {
    return null;
  }

  const candidates = buildClaudeProjectKeyCandidates(projectDirectory);
  for (const candidate of candidates) {
    const projectValue = value.projects[candidate];
    const config = extractClaudeJsonMcpConfig(projectValue);
    if (config) {
      return config;
    }
  }

  const normalizedTarget = normalizeClaudeProjectKey(projectDirectory);
  for (const [projectKey, projectValue] of Object.entries(value.projects)) {
    if (normalizeClaudeProjectKey(projectKey).toLowerCase() !== normalizedTarget.toLowerCase()) {
      continue;
    }

    const config = extractClaudeJsonMcpConfig(projectValue);
    if (config) {
      return config;
    }
  }

  return null;
}

function applyClaudeJsonMcpConfig(
  value: unknown,
  scope: McpScope,
  config: McpConfigFile,
  projectDirectory?: string,
) {
  const root = isRecord(value) ? { ...value } : {};
  const mcpServers = { ...(config.mcpServers ?? {}) };

  if (scope === 'global') {
    root.mcpServers = mcpServers;
    return root;
  }

  const resolvedProjectDirectory = resolveRequiredProjectDirectory(scope, projectDirectory);
  const projects = isRecord(root.projects) ? { ...root.projects } : {};
  const projectKey = findClaudeProjectWriteKey(projects, resolvedProjectDirectory);
  const projectValue = isRecord(projects[projectKey]) ? { ...projects[projectKey] } : {};
  projectValue.mcpServers = mcpServers;
  projects[projectKey] = projectValue;
  root.projects = projects;
  return root;
}

function buildClaudeProjectKeyCandidates(projectDirectory: string) {
  const values: string[] = [];
  pushClaudeProjectKey(values, projectDirectory);
  try {
    pushClaudeProjectKey(values, path.resolve(projectDirectory));
  } catch {
    // ignore
  }
  return values;
}

function pushClaudeProjectKey(values: string[], rawPath: string) {
  const normalized = normalizeClaudeProjectKey(rawPath);
  if (normalized && !values.includes(normalized)) {
    values.push(normalized);
  }
}

function normalizeClaudeProjectKey(rawPath: string) {
  return rawPath.replace(/\\/g, '/').trim().replace(/\/+$/g, '');
}

function findClaudeProjectWriteKey(projects: Record<string, unknown>, projectDirectory: string) {
  for (const candidate of buildClaudeProjectKeyCandidates(projectDirectory)) {
    if (candidate in projects) {
      return candidate;
    }
  }

  const normalizedTarget = normalizeClaudeProjectKey(projectDirectory);
  for (const projectKey of Object.keys(projects)) {
    if (normalizeClaudeProjectKey(projectKey).toLowerCase() === normalizedTarget.toLowerCase()) {
      return projectKey;
    }
  }

  return normalizedTarget;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
