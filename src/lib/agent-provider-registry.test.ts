import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRunEvent, ClaudeEvent } from '../types.js';
import {
  fetchAgentLatestVersion,
  listSelectableAgentProviders,
  normalizeAgentModelCatalog,
  normalizeAgentProviderRegistry,
  normalizeCodexAppServerProbe,
  normalizeGeminiAcpProbe,
  normalizeGrokAcpProbe,
  normalizeOpenCodeAcpProbe,
  normalizePiRpcProbe,
  probeGeminiAgent,
  probePiAgent,
  resolveChatRuntimeKind,
  runAgentLifecycleAction,
} from './agent-provider-registry.js';

test('latest Agent version query uses an independent endpoint and current version', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      providerId: 'openai-codex',
      latestVersion: '0.144.5',
      updateAvailable: true,
      error: null,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await fetchAgentLatestVersion('openai-codex', '0.144.1');
    assert.equal(result.latestVersion, '0.144.5');
    assert.equal(result.updateAvailable, true);
    assert.match(requestedUrl, /^\/api\/agents\/latest-version\?/);
    assert.match(requestedUrl, /providerId=openai-codex/);
    assert.match(requestedUrl, /currentVersion=0\.144\.1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('DSH lifecycle update forwards the detected target version', async () => {
  const originalFetch = globalThis.fetch;
  let lifecycleBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/agents/lifecycle') {
      lifecycleBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        providerId: 'deepseek-dsh',
        action: 'update',
        installed: true,
        command: 'C:/Users/test/AppData/Roaming/npm/dsh.cmd',
        version: '0.1.2-alpha.2',
        output: 'updated',
        usedMirror: false,
        mirrorRegistry: null,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/api/agents/settings-diagnostics?')) {
      return new Response(JSON.stringify({
        providerId: 'deepseek-dsh',
        installed: true,
        version: '0.1.2-alpha.2',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/api/agents/latest-version?')) {
      return new Response(JSON.stringify({
        providerId: 'deepseek-dsh',
        latestVersion: '0.1.2-alpha.2',
        updateAvailable: false,
        error: null,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    await runAgentLifecycleAction('deepseek-dsh', 'update', '0.1.2-alpha.2');
    assert.deepEqual(lifecycleBody, {
      providerId: 'deepseek-dsh',
      action: 'update',
      targetVersion: '0.1.2-alpha.2',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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
  assert.equal(resolveChatRuntimeKind('pi-agent'), 'generic');
  assert.equal(resolveChatRuntimeKind('gemini-cli'), 'generic');
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

test('Gemini ACP probe keeps only public initialization metadata', () => {
  const result = normalizeGeminiAcpProbe({
    installed: true,
    initialized: true,
    command: 'C:/tools/gemini.cmd',
    version: '0.54.4',
    apiKey: 'must-not-survive',
    probe: {
      initialize: {
        protocolVersion: 1,
        loadSession: true,
        promptCapabilities: { image: true, audio: false, embeddedContext: true },
        mcpCapabilities: { http: true, sse: true },
        authMethods: [],
        defaultAuthMethodId: null,
        agentVersion: '0.54.4',
        currentModelId: 'gemini-2.5-pro',
        models: [{ modelId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextTokens: 1048576 }],
        credentials: { token: 'private' },
      },
    },
  });

  assert.equal(result.probe?.initialize.currentModelId, 'gemini-2.5-pro');
  assert.equal(result.probe?.initialize.models[0]?.contextTokens, 1048576);
  assert.doesNotMatch(JSON.stringify(result), /must-not-survive|credentials|private/);
});

test('Gemini probe uses the shared ACP probe endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedMethod = '';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = String(input);
    requestedMethod = init?.method ?? 'GET';
    return new Response(JSON.stringify({
      installed: false,
      initialized: false,
      error: '未找到 Gemini CLI',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await probeGeminiAgent();
    assert.equal(result.installed, false);
    assert.equal(requestedUrl, '/api/agents/gemini/probe');
    assert.equal(requestedMethod, 'POST');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Pi RPC probe keeps only bounded public runtime diagnostics', () => {
  const result = normalizePiRpcProbe({
    installed: true,
    initialized: true,
    command: 'C:/tools/pi.cmd',
    nodeVersion: 'v24.18.0',
    token: 'must-not-survive',
    probe: {
      authenticated: true,
      sessionId: 'session-1',
      currentModel: 'anthropic/claude-sonnet-4',
      thinkingLevel: 'high',
      thinkingLevels: ['off', 'high'],
      modelCount: 2,
      isStreaming: false,
      sessionFile: 'C:/private/session.jsonl',
      auth: { apiKey: 'private' },
    },
  });

  assert.deepEqual(result.probe, {
    authenticated: true,
    sessionId: 'session-1',
    currentModel: 'anthropic/claude-sonnet-4',
    thinkingLevel: 'high',
    thinkingLevels: ['off', 'high'],
    modelCount: 2,
    isStreaming: false,
  });
  assert.doesNotMatch(JSON.stringify(result), /must-not-survive|sessionFile|private|apiKey/);
});

test('Pi RPC probe rejects impossible state and duplicate thinking levels', () => {
  assert.throws(
    () => normalizePiRpcProbe({ installed: false, initialized: true }),
    /不能处于已初始化状态/,
  );
  assert.throws(
    () => normalizePiRpcProbe({
      installed: true,
      initialized: true,
      probe: {
        authenticated: false,
        sessionId: 'session-1',
        currentModel: null,
        thinkingLevel: 'off',
        thinkingLevels: ['off', 'off'],
        modelCount: 0,
        isStreaming: false,
      },
    }),
    /重复/,
  );
});

test('Pi probe uses the native RPC probe endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedMethod = '';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = String(input);
    requestedMethod = init?.method ?? 'GET';
    return new Response(JSON.stringify({
      installed: false,
      initialized: false,
      error: '未找到 pi 命令',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await probePiAgent();
    assert.equal(result.installed, false);
    assert.equal(requestedUrl, '/api/agents/pi/probe');
    assert.equal(requestedMethod, 'POST');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
