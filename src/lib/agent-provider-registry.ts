import type {
  AgentCancelSupport,
  AgentCapabilities,
  AgentCapabilitySupport,
  AgentModelCatalog,
  AgentModelOption,
  AgentProviderDescriptor,
  AgentProviderLifecycle,
  AgentProviderRegistry,
  CodexAppServerProbeResult,
  GrokAcpProbeResult,
  GrokAcpProbeSummary,
} from '../types.js';
import {
  CLAUDE_CODE_PROVIDER_ID,
  GROK_BUILD_PROVIDER_ID,
  OPENAI_CODEX_PROVIDER_ID,
} from '../constants.js';

const CAPABILITY_SUPPORT = new Set<AgentCapabilitySupport>([
  'supported',
  'unsupported',
  'runtime-detected',
]);
const CANCEL_SUPPORT = new Set<AgentCancelSupport>(['none', 'hard', 'soft', 'runtime-detected']);

export async function fetchAgentProviderRegistry(signal?: AbortSignal): Promise<AgentProviderRegistry> {
  const response = await fetch('/api/agents/providers', { signal });
  if (!response.ok) {
    throw new Error('读取 Agent Provider 列表失败');
  }
  return normalizeAgentProviderRegistry(await response.json());
}

export async function fetchAgentModelCatalog(
  providerId: string,
  signal?: AbortSignal,
): Promise<AgentModelCatalog> {
  const response = await fetch(`/api/agents/${encodeURIComponent(providerId)}/models`, { signal });
  if (!response.ok) {
    let message = '读取 Agent 模型目录失败';
    try {
      const payload = await response.json() as { error?: unknown };
      if (typeof payload.error === 'string' && payload.error.trim()) {
        message = payload.error.trim();
      }
    } catch {
      // Keep the stable public fallback when the backend response is not JSON.
    }
    throw new Error(message);
  }
  return normalizeAgentModelCatalog(await response.json());
}

export function normalizeAgentModelCatalog(value: unknown): AgentModelCatalog {
  const catalog = requireRecord(value, 'modelCatalog');
  const providerId = requireString(catalog.providerId, 'modelCatalog.providerId');
  const models = requireArray(catalog.models, 'modelCatalog.models').map((model, index) =>
    normalizeAgentModel(model, `modelCatalog.models[${index}]`),
  );
  requireUniqueIds(models, 'modelCatalog.models');
  const defaultModelId = optionalString(catalog.defaultModelId) ?? undefined;
  return {
    providerId,
    ...(defaultModelId ? { defaultModelId } : {}),
    models,
  };
}

export async function probeGrokAgent(signal?: AbortSignal): Promise<GrokAcpProbeResult> {
  const response = await fetch('/api/agents/grok/probe', {
    method: 'POST',
    signal,
  });
  if (!response.ok) {
    throw new Error('检测 Grok Build 失败');
  }
  return normalizeGrokAcpProbe(await response.json());
}

export async function probeCodexAgent(signal?: AbortSignal): Promise<CodexAppServerProbeResult> {
  const response = await fetch('/api/agents/codex/probe', {
    method: 'POST',
    signal,
  });
  if (!response.ok) {
    throw new Error('检测 OpenAI Codex 失败');
  }
  return normalizeCodexAppServerProbe(await response.json());
}

export function normalizeAgentProviderRegistry(value: unknown): AgentProviderRegistry {
  const registry = requireRecord(value, 'registry');
  if (!Array.isArray(registry.providers)) {
    throw new Error('Agent Provider Registry 缺少 providers');
  }

  const providers = registry.providers.map((provider, index) => normalizeProvider(provider, index));
  const ids = new Set<string>();
  for (const provider of providers) {
    if (ids.has(provider.id)) {
      throw new Error(`Agent Provider ID 重复: ${provider.id}`);
    }
    ids.add(provider.id);
  }

  return { providers };
}

export function listSelectableAgentProviders(registry: AgentProviderRegistry) {
  return registry.providers.filter(
    (provider) => provider.lifecycle === 'active' && provider.available === true && provider.selectable,
  );
}

export function resolveChatRuntimeKind(providerId: string) {
  if (providerId === CLAUDE_CODE_PROVIDER_ID) {
    return 'claude' as const;
  }
  if (providerId === GROK_BUILD_PROVIDER_ID || providerId === OPENAI_CODEX_PROVIDER_ID) {
    return 'generic' as const;
  }
  return 'unsupported' as const;
}

export function normalizeCodexAppServerProbe(value: unknown): CodexAppServerProbeResult {
  const result = requireRecord(value, 'codexProbe');
  const installed = requireBoolean(result.installed, 'codexProbe.installed');
  const initialized = requireBoolean(result.initialized, 'codexProbe.initialized');

  if (!installed && initialized) {
    throw new Error('Codex 未安装时不能处于已初始化状态');
  }

  let probe: CodexAppServerProbeResult['probe'] = null;
  if (initialized) {
    const summary = requireRecord(result.probe, 'codexProbe.probe');
    probe = {
      authenticated: requireBoolean(summary.authenticated, 'codexProbe.probe.authenticated'),
      authMode: optionalString(summary.authMode),
      requiresOpenaiAuth: requireBoolean(
        summary.requiresOpenaiAuth,
        'codexProbe.probe.requiresOpenaiAuth',
      ),
    };
  }

  return {
    installed,
    initialized,
    command: optionalString(result.command),
    version: optionalString(result.version),
    error: optionalString(result.error),
    probe,
  };
}

export function normalizeGrokAcpProbe(value: unknown): GrokAcpProbeResult {
  const result = requireRecord(value, 'grokProbe');
  const installed = requireBoolean(result.installed, 'grokProbe.installed');
  const initialized = requireBoolean(result.initialized, 'grokProbe.initialized');

  if (!installed && initialized) {
    throw new Error('Grok 未安装时不能处于已初始化状态');
  }

  const probe = initialized
    ? normalizeGrokProbeSummary(result.probe, 'grokProbe.probe')
    : null;

  return {
    installed,
    initialized,
    command: optionalString(result.command),
    version: optionalString(result.version),
    error: optionalString(result.error),
    probe,
  };
}

function normalizeProvider(value: unknown, index: number): AgentProviderDescriptor {
  const provider = requireRecord(value, `providers[${index}]`);
  const id = requireString(provider.id, `providers[${index}].id`);
  const lifecycle = requireLifecycle(provider.lifecycle, `providers[${index}].lifecycle`);
  const available = requireAvailability(provider.available, lifecycle, `providers[${index}].available`);
  const selectable = requireBoolean(provider.selectable, `providers[${index}].selectable`);

  if (lifecycle === 'planned' && selectable) {
    throw new Error(`Planned Agent Provider 不能被选择: ${id}`);
  }

  return {
    id,
    displayName: requireString(provider.displayName, `providers[${index}].displayName`),
    driverId: requireString(provider.driverId, `providers[${index}].driverId`),
    lifecycle,
    available,
    selectable,
    capabilities: normalizeCapabilities(provider.capabilities, `providers[${index}].capabilities`),
  };
}

function normalizeAgentModel(value: unknown, path: string): AgentModelOption {
  const model = requireRecord(value, path);
  const efforts = requireArray(
    model.supportedReasoningEfforts,
    `${path}.supportedReasoningEfforts`,
  ).map((effort, index) => {
    const record = requireRecord(effort, `${path}.supportedReasoningEfforts[${index}]`);
    const description = optionalString(record.description) ?? undefined;
    return {
      id: requireString(record.id, `${path}.supportedReasoningEfforts[${index}].id`),
      ...(description ? { description } : {}),
    };
  });
  requireUniqueIds(efforts, `${path}.supportedReasoningEfforts`);
  const description = optionalString(model.description) ?? undefined;
  const defaultReasoningEffort = optionalString(model.defaultReasoningEffort) ?? undefined;
  const contextWindowTokens = optionalNonNegativeInteger(
    model.contextWindowTokens,
    `${path}.contextWindowTokens`,
  );
  return {
    id: requireString(model.id, `${path}.id`),
    label: requireString(model.label, `${path}.label`),
    ...(description ? { description } : {}),
    ...(contextWindowTokens === null ? {} : { contextWindowTokens }),
    isDefault: requireBoolean(model.isDefault, `${path}.isDefault`),
    ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
    supportedReasoningEfforts: efforts,
  };
}

function normalizeCapabilities(value: unknown, path: string): AgentCapabilities {
  const capabilities = requireRecord(value, path);
  const sessions = requireRecord(capabilities.sessions, `${path}.sessions`);
  const input = requireRecord(capabilities.input, `${path}.input`);
  const tools = requireRecord(capabilities.tools, `${path}.tools`);
  const runtime = requireRecord(capabilities.runtime, `${path}.runtime`);

  return {
    sessions: {
      create: requireCapability(sessions.create, `${path}.sessions.create`),
      resume: requireCapability(sessions.resume, `${path}.sessions.resume`),
      list: requireCapability(sessions.list, `${path}.sessions.list`),
      import: requireCapability(sessions.import, `${path}.sessions.import`),
    },
    input: {
      text: requireCapability(input.text, `${path}.input.text`),
      images: requireCapability(input.images, `${path}.input.images`),
      fileReferences: requireCapability(input.fileReferences, `${path}.input.fileReferences`),
    },
    tools: {
      streaming: requireCapability(tools.streaming, `${path}.tools.streaming`),
      approval: requireCapability(tools.approval, `${path}.tools.approval`),
      userInput: requireCapability(tools.userInput, `${path}.tools.userInput`),
      mcp: requireCapability(tools.mcp, `${path}.tools.mcp`),
    },
    runtime: {
      cancel: requireCancelSupport(runtime.cancel, `${path}.runtime.cancel`),
      reconnect: requireCapability(runtime.reconnect, `${path}.runtime.reconnect`),
      concurrentSessions: requireCapability(
        runtime.concurrentSessions,
        `${path}.runtime.concurrentSessions`,
      ),
    },
  };
}

function normalizeGrokProbeSummary(value: unknown, path: string): GrokAcpProbeSummary {
  const probe = requireRecord(value, path);
  const initialize = requireRecord(probe.initialize, `${path}.initialize`);
  const promptCapabilities = requireRecord(
    initialize.promptCapabilities,
    `${path}.initialize.promptCapabilities`,
  );
  const mcpCapabilities = requireRecord(
    initialize.mcpCapabilities,
    `${path}.initialize.mcpCapabilities`,
  );
  const authMethods = requireArray(initialize.authMethods, `${path}.initialize.authMethods`).map(
    (method, index) => {
      const record = requireRecord(method, `${path}.initialize.authMethods[${index}]`);
      return {
        id: requireString(record.id, `${path}.initialize.authMethods[${index}].id`),
        name: requireString(record.name, `${path}.initialize.authMethods[${index}].name`),
      };
    },
  );
  const models = requireArray(initialize.models, `${path}.initialize.models`).map(
    (model, index) => {
      const record = requireRecord(model, `${path}.initialize.models[${index}]`);
      return {
        modelId: requireString(record.modelId, `${path}.initialize.models[${index}].modelId`),
        name: requireString(record.name, `${path}.initialize.models[${index}].name`),
        contextTokens: optionalNonNegativeInteger(
          record.contextTokens,
          `${path}.initialize.models[${index}].contextTokens`,
        ),
      };
    },
  );

  requireUniqueIds(authMethods, `${path}.initialize.authMethods`);
  requireUniqueIds(models.map((model) => ({ id: model.modelId })), `${path}.initialize.models`);

  return {
    initialize: {
      protocolVersion: requireNonNegativeInteger(
        initialize.protocolVersion,
        `${path}.initialize.protocolVersion`,
      ),
      loadSession: requireBoolean(initialize.loadSession, `${path}.initialize.loadSession`),
      promptCapabilities: {
        image: requireBoolean(promptCapabilities.image, `${path}.initialize.promptCapabilities.image`),
        audio: requireBoolean(promptCapabilities.audio, `${path}.initialize.promptCapabilities.audio`),
        embeddedContext: requireBoolean(
          promptCapabilities.embeddedContext,
          `${path}.initialize.promptCapabilities.embeddedContext`,
        ),
      },
      mcpCapabilities: {
        http: requireBoolean(mcpCapabilities.http, `${path}.initialize.mcpCapabilities.http`),
        sse: requireBoolean(mcpCapabilities.sse, `${path}.initialize.mcpCapabilities.sse`),
      },
      authMethods,
      defaultAuthMethodId: optionalString(initialize.defaultAuthMethodId),
      agentVersion: optionalString(initialize.agentVersion),
      currentModelId: optionalString(initialize.currentModelId),
      models,
    },
    authenticated: requireBoolean(probe.authenticated, `${path}.authenticated`),
    authMethodId: optionalString(probe.authMethodId),
    authError: optionalString(probe.authError),
  };
}

function requireLifecycle(value: unknown, path: string): AgentProviderLifecycle {
  if (value === 'active' || value === 'planned') {
    return value;
  }
  throw new Error(`${path} 无效`);
}

function requireAvailability(
  value: unknown,
  lifecycle: AgentProviderLifecycle,
  path: string,
): boolean | null {
  if (lifecycle === 'planned' && value === null) {
    return null;
  }
  if (lifecycle === 'active' && typeof value === 'boolean') {
    return value;
  }
  throw new Error(`${path} 与 Provider 生命周期不匹配`);
}

function requireCapability(value: unknown, path: string): AgentCapabilitySupport {
  if (typeof value === 'string' && CAPABILITY_SUPPORT.has(value as AgentCapabilitySupport)) {
    return value as AgentCapabilitySupport;
  }
  throw new Error(`${path} 无效`);
}

function requireCancelSupport(value: unknown, path: string): AgentCancelSupport {
  if (typeof value === 'string' && CANCEL_SUPPORT.has(value as AgentCancelSupport)) {
    return value as AgentCancelSupport;
  }
  throw new Error(`${path} 无效`);
}

function requireString(value: unknown, path: string) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  throw new Error(`${path} 无效`);
}

function requireBoolean(value: unknown, path: string) {
  if (typeof value === 'boolean') {
    return value;
  }
  throw new Error(`${path} 无效`);
}

function requireArray(value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  throw new Error(`${path} 无效`);
}

function requireNonNegativeInteger(value: unknown, path: string) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  throw new Error(`${path} 无效`);
}

function optionalNonNegativeInteger(value: unknown, path: string) {
  if (value === null || value === undefined) {
    return null;
  }
  return requireNonNegativeInteger(value, path);
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireUniqueIds(items: Array<{ id: string }>, path: string) {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) {
      throw new Error(`${path} ID 重复: ${item.id}`);
    }
    ids.add(item.id);
  }
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`${path} 无效`);
}
