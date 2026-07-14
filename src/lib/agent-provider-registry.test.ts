import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRunEvent, ClaudeEvent } from '../types.js';
import {
  listSelectableAgentProviders,
  normalizeAgentModelCatalog,
  normalizeAgentProviderRegistry,
  normalizeCodexAppServerProbe,
  normalizeGrokAcpProbe,
  normalizeOpenCodeAcpProbe,
  resolveChatRuntimeKind,
} from './agent-provider-registry.js';

test('agent model catalog keeps dynamic public fields and Codex reasoning options', () => {
  const catalog = normalizeAgentModelCatalog({
    providerId: 'openai-codex',
    defaultModelId: 'gpt-codex-default',
    models: [{
      id: 'gpt-codex-default',
      label: 'GPT Codex Default',
      description: 'Default coding model',
      contextWindowTokens: 200000,
      isDefault: true,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [
        { id: 'low', description: 'Faster' },
        { id: 'medium', description: 'Balanced', private: 'drop-me' },
      ],
      account: 'drop-me',
    }],
    token: 'must-not-survive',
  });

  assert.equal(catalog.providerId, 'openai-codex');
  assert.equal(catalog.defaultModelId, 'gpt-codex-default');
  assert.equal(catalog.models[0]?.defaultReasoningEffort, 'medium');
  assert.deepEqual(
    catalog.models[0]?.supportedReasoningEfforts.map((effort) => effort.id),
    ['low', 'medium'],
  );
  assert.doesNotMatch(JSON.stringify(catalog), /drop-me|must-not-survive|account|private/);
});

test('agent model catalog rejects duplicate model and reasoning ids', () => {
  const model = {
    id: 'model-1',
    label: 'Model 1',
    isDefault: true,
    supportedReasoningEfforts: [],
  };
  assert.throws(
    () => normalizeAgentModelCatalog({ providerId: 'grok-build', models: [model, model] }),
    /ID 重复/,
  );
  assert.throws(
    () => normalizeAgentModelCatalog({
      providerId: 'openai-codex',
      models: [{
        ...model,
        supportedReasoningEfforts: [{ id: 'high' }, { id: 'high' }],
      }],
    }),
    /ID 重复/,
  );
});

const claudeCapabilities = {
  sessions: {
    create: 'supported',
    resume: 'supported',
    list: 'supported',
    import: 'supported',
  },
  input: {
    text: 'supported',
    images: 'supported',
    fileReferences: 'supported',
  },
  tools: {
    streaming: 'supported',
    approval: 'supported',
    userInput: 'supported',
    mcp: 'supported',
  },
  runtime: {
    cancel: 'soft',
    reconnect: 'supported',
    concurrentSessions: 'supported',
  },
} as const;

const plannedCapabilities = {
  sessions: {
    create: 'runtime-detected',
    resume: 'runtime-detected',
    list: 'runtime-detected',
    import: 'runtime-detected',
  },
  input: {
    text: 'runtime-detected',
    images: 'runtime-detected',
    fileReferences: 'runtime-detected',
  },
  tools: {
    streaming: 'runtime-detected',
    approval: 'runtime-detected',
    userInput: 'runtime-detected',
    mcp: 'runtime-detected',
  },
  runtime: {
    cancel: 'runtime-detected',
    reconnect: 'runtime-detected',
    concurrentSessions: 'runtime-detected',
  },
} as const;

test('provider registry exposes only active and available providers as selectable', () => {
  const registry = normalizeAgentProviderRegistry({
    providers: [
      {
        id: 'claude-code',
        displayName: 'Claude Code',
        driverId: 'claude-stream-json',
        lifecycle: 'active',
        available: true,
        selectable: true,
        capabilities: claudeCapabilities,
      },
      {
        id: 'grok-build',
        displayName: 'Grok Build',
        driverId: 'acp',
        lifecycle: 'planned',
        available: null,
        selectable: false,
        capabilities: plannedCapabilities,
      },
    ],
  });

  assert.deepEqual(
    listSelectableAgentProviders(registry).map((provider) => provider.id),
    ['claude-code'],
  );
  assert.equal(registry.providers[1]?.capabilities.tools.approval, 'runtime-detected');
});

test('enabled Grok is selectable without routing unknown providers to Claude', () => {
  const registry = normalizeAgentProviderRegistry({
    providers: [
      {
        id: 'grok-build',
        displayName: 'Grok Build',
        driverId: 'acp',
        lifecycle: 'active',
        available: true,
        selectable: true,
        capabilities: {
          ...claudeCapabilities,
          input: {
            text: 'supported',
            images: 'supported',
            fileReferences: 'supported',
          },
          runtime: {
            cancel: 'soft',
            reconnect: 'supported',
            concurrentSessions: 'supported',
          },
        },
      },
    ],
  });

  assert.deepEqual(listSelectableAgentProviders(registry).map((provider) => provider.id), ['grok-build']);
  assert.equal(registry.providers[0]?.capabilities.input.images, 'supported');
  assert.equal(registry.providers[0]?.capabilities.input.fileReferences, 'supported');
  assert.equal(resolveChatRuntimeKind('claude-code'), 'claude');
  assert.equal(resolveChatRuntimeKind('grok-build'), 'generic');
  assert.equal(resolveChatRuntimeKind('openai-codex'), 'generic');
  assert.equal(resolveChatRuntimeKind('opencode'), 'generic');
  assert.equal(resolveChatRuntimeKind('future-provider'), 'unsupported');
});

test('codex probe keeps only public account and runtime diagnostics', () => {
  const result = normalizeCodexAppServerProbe({
    installed: true,
    initialized: true,
    command: 'C:/tools/codex.exe',
    version: 'codex-cli 1.0.0',
    token: 'must-not-survive',
    probe: {
      authenticated: true,
      authMode: 'chatgpt',
      requiresOpenaiAuth: true,
      email: 'private@example.com',
    },
  });

  assert.deepEqual(result.probe, {
    authenticated: true,
    authMode: 'chatgpt',
    requiresOpenaiAuth: true,
  });
  assert.doesNotMatch(JSON.stringify(result), /must-not-survive|private@example\.com/);
});

test('codex probe normalizes unavailable CLI and rejects invalid initialized state', () => {
  assert.deepEqual(
    normalizeCodexAppServerProbe({
      installed: false,
      initialized: false,
      error: '未找到可用 Codex CLI',
    }),
    {
      installed: false,
      initialized: false,
      command: null,
      version: null,
      error: '未找到可用 Codex CLI',
      probe: null,
    },
  );
  assert.throws(
    () => normalizeCodexAppServerProbe({ installed: false, initialized: true }),
    /不能处于已初始化状态/,
  );
});

test('provider registry rejects duplicate provider ids', () => {
  const provider = {
    id: 'claude-code',
    displayName: 'Claude Code',
    driverId: 'claude-stream-json',
    lifecycle: 'active',
    available: true,
    selectable: true,
    capabilities: claudeCapabilities,
  };

  assert.throws(
    () => normalizeAgentProviderRegistry({ providers: [provider, provider] }),
    /Agent Provider ID 重复/,
  );
});

test('provider registry rejects selectable planned providers', () => {
  assert.throws(
    () =>
      normalizeAgentProviderRegistry({
        providers: [
          {
            id: 'grok-build',
            displayName: 'Grok Build',
            driverId: 'acp',
            lifecycle: 'planned',
            available: null,
            selectable: true,
            capabilities: plannedCapabilities,
          },
        ],
      }),
    /不能被选择/,
  );
});

test('ClaudeEvent remains assignment-compatible with AgentRunEvent', () => {
  const asAgentEvent = (event: ClaudeEvent): AgentRunEvent => event;
  const asClaudeEvent = (event: AgentRunEvent): ClaudeEvent => event;
  const event: ClaudeEvent = { type: 'delta', runId: 'run-1', text: 'ok' };

  assert.deepEqual(asClaudeEvent(asAgentEvent(event)), event);
});

test('grok probe keeps only public diagnostic fields', () => {
  const result = normalizeGrokAcpProbe({
    installed: true,
    initialized: true,
    command: 'C:/tools/grok.exe',
    version: '0.2.93',
    token: 'must-not-survive',
    probe: {
      initialize: {
        protocolVersion: 1,
        loadSession: true,
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: true,
        },
        mcpCapabilities: {
          http: true,
          sse: true,
        },
        authMethods: [{ id: 'cached_token', name: 'Cached token' }],
        defaultAuthMethodId: 'cached_token',
        agentVersion: '0.2.93',
        currentModelId: 'grok-4.5',
        models: [
          { modelId: 'grok-4.5', name: 'Grok 4.5', contextTokens: 131072 },
          { modelId: 'composer-2.5', name: 'Composer 2.5', contextTokens: null },
        ],
        email: 'private@example.com',
      },
      authenticated: true,
      authMethodId: 'cached_token',
      authError: null,
      rawEvents: ['private'],
    },
  });

  assert.equal(result.probe?.authenticated, true);
  assert.equal(result.probe?.initialize.models[0]?.modelId, 'grok-4.5');
  assert.equal(result.probe?.initialize.promptCapabilities.image, false);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /must-not-survive|private@example\.com|rawEvents/);
});

test('grok probe normalizes an unavailable CLI without requiring probe details', () => {
  assert.deepEqual(
    normalizeGrokAcpProbe({
      installed: false,
      initialized: false,
      error: '未找到 grok 命令',
    }),
    {
      installed: false,
      initialized: false,
      command: null,
      version: null,
      error: '未找到 grok 命令',
      probe: null,
    },
  );
});

test('grok probe rejects initialized responses without a valid public summary', () => {
  assert.throws(
    () => normalizeGrokAcpProbe({ installed: false, initialized: true }),
    /不能处于已初始化状态/,
  );
  assert.throws(
    () => normalizeGrokAcpProbe({ installed: true, initialized: true, probe: {} }),
    /initialize 无效/,
  );
});

test('OpenCode probe keeps only public ACP and model configuration diagnostics', () => {
  const result = normalizeOpenCodeAcpProbe({
    installed: true,
    initialized: true,
    command: 'C:/tools/opencode.exe',
    version: '1.17.7',
    apiKey: 'must-not-survive',
    probe: {
      configured: true,
      modelCount: 42,
      initialize: {
        protocolVersion: 1,
        loadSession: true,
        promptCapabilities: { image: true, audio: false, embeddedContext: true },
        mcpCapabilities: { http: true, sse: true },
        authMethods: [{ id: 'opencode-login', name: 'OpenCode Login' }],
        defaultAuthMethodId: 'opencode-login',
        agentVersion: '1.17.7',
        currentModelId: null,
        models: [],
        providerSecrets: ['private'],
      },
    },
  });

  assert.equal(result.probe?.configured, true);
  assert.equal(result.probe?.modelCount, 42);
  assert.equal(result.probe?.initialize.promptCapabilities.image, true);
  assert.doesNotMatch(JSON.stringify(result), /must-not-survive|providerSecrets|private/);
});

test('OpenCode probe rejects impossible initialized state', () => {
  assert.throws(
    () => normalizeOpenCodeAcpProbe({ installed: false, initialized: true }),
    /不能处于已初始化状态/,
  );
});
