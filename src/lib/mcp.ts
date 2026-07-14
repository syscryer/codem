import type {
  AgentProviderId,
  McpConfigFile,
  McpManagementResponse,
  McpManagedScope,
  McpServerConfig,
} from '../types';

export function normalizeMcpConfig(value: unknown): McpConfigFile {
  if (!isRecord(value)) {
    return { mcpServers: {} };
  }

  const servers = isRecord(value.mcpServers)
    ? Object.fromEntries(
        Object.entries(value.mcpServers)
          .filter(([name, config]) => Boolean(name.trim()) && isRecord(config))
          .map(([name, config]) => [name, { ...config } as McpServerConfig]),
      )
    : {};

  return {
    ...value,
    mcpServers: servers,
  };
}

export async function fetchMcpManagement(
  providerId: AgentProviderId,
  projectPath?: string | null,
): Promise<McpManagementResponse> {
  const query = new URLSearchParams({ providerId });
  if (projectPath?.trim()) {
    query.set('projectPath', projectPath.trim());
  }
  const response = await fetch(`/api/mcp/configs?${query.toString()}`);
  if (!response.ok) {
    throw new Error('读取 MCP 管理配置失败');
  }
  return normalizeMcpManagementResponse(await response.json());
}

export async function saveMcpConfig(
  scope: McpManagedScope,
  config: McpConfigFile,
  providerId: AgentProviderId,
  projectPath?: string | null,
) {
  const query = new URLSearchParams({ providerId });
  if (projectPath?.trim()) {
    query.set('projectPath', projectPath.trim());
  }
  const response = await fetch(`/api/mcp/configs/${scope}?${query.toString()}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });

  const payload = await response.json().catch(() => null) as McpConfigFile | { error?: string } | null;
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : '保存 MCP 配置失败';
    throw new Error(message);
  }

  return normalizeMcpConfig(payload);
}

export async function openMcpConfig(
  scope: McpManagedScope,
  providerId: AgentProviderId,
  projectPath?: string | null,
) {
  const response = await fetch('/api/mcp/open', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      scope,
      providerId,
      projectPath: projectPath?.trim() || null,
    }),
  });

  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error || '打开 MCP 配置失败');
  }
}

function normalizeMcpManagementResponse(value: unknown): McpManagementResponse {
  const record = isRecord(value) ? value : {};
  const paths = isRecord(record.paths) ? record.paths : {};
  const configs = isRecord(record.configs) ? record.configs : {};
  const overview = isRecord(record.overview) ? record.overview : {};

  return {
    providerId: record.providerId === 'openai-codex'
      || record.providerId === 'grok-build'
      || record.providerId === 'opencode'
      ? record.providerId
      : 'claude-code',
    supportsClaudeJson: Boolean(record.supportsClaudeJson),
    paths: {
      global: normalizeOptionalString(paths.global),
      project: normalizeOptionalString(paths.project),
      claudeJson: normalizeOptionalString(paths.claudeJson),
    },
    configs: {
      global: normalizeMcpConfig(configs.global),
      project: normalizeMcpConfig(configs.project),
      claudeJsonGlobal: normalizeMcpConfig(configs.claudeJsonGlobal),
      claudeJsonProject: normalizeMcpConfig(configs.claudeJsonProject),
    },
    hasProject: Boolean(record.hasProject),
    overview: {
      servers: Array.isArray(overview.servers)
        ? overview.servers.flatMap((item) => {
            if (!isRecord(item) || typeof item.name !== 'string' || typeof item.source !== 'string') {
              return [];
            }

            return [{
              id: normalizeOptionalString(item.id) || `${item.source}:${item.name}`,
              name: item.name,
              source: item.source,
              status: item.status === 'available' || item.status === 'error' ? item.status : 'unknown',
              tools: Array.isArray(item.tools)
                ? item.tools.flatMap((tool) => (
                    isRecord(tool) && typeof tool.name === 'string'
                      ? [{ name: tool.name, description: normalizeOptionalString(tool.description) || undefined }]
                      : []
                  ))
                : [],
              command: normalizeOptionalString(item.command) || undefined,
              args: Array.isArray(item.args) ? item.args.filter((arg): arg is string => typeof arg === 'string') : undefined,
              error: normalizeOptionalString(item.error) || undefined,
            }];
          })
        : [],
      errors: Array.isArray(overview.errors)
        ? overview.errors.flatMap((item) => (
            isRecord(item) && typeof item.source === 'string' && typeof item.path === 'string' && typeof item.message === 'string'
              ? [{ source: item.source, path: item.path, message: item.message }]
              : []
          ))
        : [],
    },
  };
}

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
