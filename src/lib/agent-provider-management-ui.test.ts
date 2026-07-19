import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type {
  AgentProviderDescriptor,
  AgentSettingsDiagnostics,
  ClaudeCliVersionInfo,
  OpenCodeAcpProbeResult,
} from '../types.js';
import {
  reconcileProviderAvailability,
  resolveProviderDiagnostics,
  resolveProviderStatus,
} from './agent-provider-management.js';

const sidebarSource = await readFile(
  new URL('../components/settings/SettingsSidebar.tsx', import.meta.url),
  'utf8',
);
const settingsViewSource = await readFile(
  new URL('../components/settings/SettingsView.tsx', import.meta.url),
  'utf8',
);
const agentSettingsSource = await readFile(
  new URL('../components/settings/AgentModelSettings.tsx', import.meta.url),
  'utf8',
);
const providerSettingsSource = await readFile(
  new URL('../components/settings/AgentProviderSettings.tsx', import.meta.url),
  'utf8',
);
const providerManagementSource = await readFile(
  new URL('./agent-provider-management.ts', import.meta.url),
  'utf8',
);
const stylesSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
const agentRunSource = await readFile(new URL('../hooks/useAgentRun.ts', import.meta.url), 'utf8');

test('settings exposes Agent providers without adding a new navigation section', () => {
  assert.match(sidebarSource, /id: 'providers', label: 'Agent 设置'/);
  assert.match(settingsViewSource, /<AgentModelSettingsSection/);
  assert.match(agentSettingsSource, />Agent 管理</);
  assert.match(agentSettingsSource, />渠道管理</);
  assert.doesNotMatch(agentSettingsSource, />模型与默认值</);
});

test('Agent providers are formal features without an experimental runtime switch', () => {
  assert.doesNotMatch(providerSettingsSource, /experimentalAgentRunEnabled/);
  assert.doesNotMatch(providerSettingsSource, /启用实验性 Agent 运行/);
  assert.doesNotMatch(agentRunSource, /实验运行未开启/);
});

test('provider settings exposes a persistent default Agent selector with brand icons', () => {
  assert.match(settingsViewSource, /agentRuntime=\{agentRuntime\}/);
  assert.match(agentSettingsSource, /onUpdateAgentRuntime=\{onUpdateAgentRuntime\}/);
  assert.match(providerSettingsSource, /<strong>默认 Agent<\/strong>/);
  assert.match(providerSettingsSource, /value=\{agentRuntime\.defaultProviderId\}/);
  assert.match(providerSettingsSource, /<AgentProviderIcon providerId=\{provider\.id\} size=\{16\} \/>/);
  assert.match(providerSettingsSource, /disabled=\{!selectable\}/);
  assert.match(providerSettingsSource, /await onUpdateAgentRuntime\(\{ defaultProviderId \}\)/);
});

test('provider settings reuses shared registry and progressively loads diagnostics', () => {
  assert.match(appSource, /agentProviders=\{agentProviders\}/);
  assert.match(settingsViewSource, /providers=\{agentProviders\}/);
  assert.match(agentRunSource, /refreshProviders/);
  assert.match(providerSettingsSource, /new Map<AgentProviderId, AbortController>/);
  assert.match(providerSettingsSource, /providerIds\.map\(async \(providerId\) =>/);
  assert.match(providerSettingsSource, /setSettingsDiagnostics\(\(current\)[\s\S]*fetchAgentLatestVersion/);
  assert.match(providerSettingsSource, /latestVersion: previous\?\.latestVersion \?\? null/);
  assert.match(providerSettingsSource, /updateAvailable: previous\?\.updateAvailable \?\? false/);
  assert.match(providerSettingsSource, /setDiagnosticsLoading\(\(current\) => \(\{ \.\.\.current, \[providerId\]: false \}\)\)/);
  assert.match(providerSettingsSource, /setLatestVersionLoading\(\(current\) => \(\{ \.\.\.current, \[providerId\]: false \}\)\)/);
  assert.doesNotMatch(providerSettingsSource, /detailsLoading/);
  assert.match(providerSettingsSource, /agent-provider-list-skeleton/);
  assert.doesNotMatch(providerSettingsSource, /fetchAgentProviderRegistry/);
  assert.doesNotMatch(providerSettingsSource, /if \(loadState === 'loading' && !registry\)/);
});

test('Agent lifecycle refreshes diagnostics and the matching runtime probe', () => {
  assert.match(agentSettingsSource, /showToast=\{showToast\}/);
  assert.match(providerSettingsSource, /Promise\.resolve\(\)\.then\(\(\) => onRefreshProviders\(\)\)/);
  assert.match(providerSettingsSource, /loadProviderDetails\(\[providerId\]\)/);
  assert.match(providerSettingsSource, /claudeInfoRequestIdRef\.current === claudeInfoRequestId/);
  assert.match(providerSettingsSource, /providerId === 'grok-build'[\s\S]*runGrokProbe\(\)/);
  assert.match(providerSettingsSource, /providerId === 'openai-codex'[\s\S]*runCodexProbe\(\)/);
  assert.match(providerSettingsSource, /providerId === 'opencode'[\s\S]*runOpenCodeProbe\(\)/);
  assert.match(providerSettingsSource, /安装' : '更新'}完成/);
  assert.match(providerSettingsSource, /diagnostics\.updateAvailable/);
  assert.match(providerSettingsSource, /result\.usedMirror/);
  assert.match(providerSettingsSource, /settingsDiagnostics\?\.installed \?\? provider\.available/);
  assert.match(providerSettingsSource, />当前版本</);
  assert.match(providerSettingsSource, />最新版本</);
  assert.match(providerSettingsSource, /isInstalled \? '更新' : '一键安装'/);
  assert.match(providerSettingsSource, /getProviderInstallDocsUrl/);
  assert.match(providerSettingsSource, /<span>安装文档<\/span>/);
});

test('Agent version facts use per-item loading and compact CC Switch-style rows', () => {
  assert.match(providerSettingsSource, /latestVersionLoading \? \(/);
  assert.match(providerSettingsSource, /agent-provider-version-loading/);
  assert.match(stylesSource, /\.agent-provider-version-facts \{[\s\S]*grid-template-columns: repeat\(2, max-content\)/);
  assert.match(stylesSource, /\.agent-provider-version-facts > div \{[\s\S]*grid-template-columns: max-content minmax\(0, max-content\)/);
  const factRows = stylesSource.slice(
    stylesSource.indexOf('.agent-provider-version-facts > div'),
    stylesSource.indexOf('.agent-provider-version-facts dt'),
  );
  assert.doesNotMatch(factRows, /space-between/);
});

test('Agent command facts use compact copy icons', () => {
  assert.match(providerSettingsSource, /<Copy size=\{13\} \/>/);
  assert.match(providerSettingsSource, /<Check size=\{13\} \/>/);
  assert.doesNotMatch(providerSettingsSource, /copied \? '已复制' : '复制'/);
});

test('provider management keeps Grok, Codex, and OpenCode detection explicit and non-reentrant', () => {
  assert.match(providerSettingsSource, /async function runGrokProbe\(\)/);
  assert.match(providerSettingsSource, /async function runCodexProbe\(\)/);
  assert.match(providerSettingsSource, /async function runOpenCodeProbe\(\)/);
  assert.match(providerSettingsSource, /probeGrokAgent\(controller\.signal\)/);
  assert.match(providerSettingsSource, /probeCodexAgent\(controller\.signal\)/);
  assert.match(providerSettingsSource, /probeOpenCodeAgent\(controller\.signal\)/);
  assert.match(providerSettingsSource, /disabled=\{probeState === 'checking' \|\| diagnosticChecking\}/);
  assert.match(providerSettingsSource, /fetchAgentSettingsDiagnostics\(providerId, undefined, true\)/);
  assert.doesNotMatch(
    providerSettingsSource.slice(
      providerSettingsSource.indexOf('useEffect(() =>'),
      providerSettingsSource.indexOf('const selectedProvider ='),
    ),
    /probe(?:Grok|Codex|OpenCode)Agent/,
  );
});

test('provider management labels planned providers as unavailable for selection', () => {
  assert.match(providerSettingsSource, /provider\.lifecycle === 'active' \? '已启用' : '规划中'/);
  assert.match(providerSettingsSource, /provider\.selectable \? '聊天可用' : '不可选择'/);
  assert.match(providerSettingsSource, /aria-live="polite"/);
});

test('Claude registry availability wins when version details temporarily fail', () => {
  const provider = {
    id: 'claude-code',
    displayName: 'Claude Code',
    driverId: 'claude-stream-json',
    lifecycle: 'active',
    available: true,
    selectable: true,
    capabilities: {
      sessions: { create: 'supported', resume: 'supported', list: 'supported', import: 'supported' },
      input: { text: 'supported', images: 'supported', fileReferences: 'supported' },
      tools: { streaming: 'supported', approval: 'supported', userInput: 'supported', mcp: 'supported' },
      runtime: { cancel: 'soft', reconnect: 'supported', concurrentSessions: 'supported' },
    },
  } satisfies AgentProviderDescriptor;
  const versionInfo = {
    installed: false,
    supported: false,
    version: null,
    recommendedVersion: '2.1.123',
    command: null,
    updateCommand: 'claude update',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    setupUrl: 'https://example.com',
    versionError: '读取版本失败',
  } satisfies ClaudeCliVersionInfo;

  assert.deepEqual(resolveProviderStatus(provider, versionInfo, null), {
    label: '可用',
    tone: 'positive',
  });
  assert.equal(resolveProviderDiagnostics(provider, versionInfo, null).cli, '已安装');
});

test('Codex diagnostics distinguish CLI, app-server initialization, and authentication', () => {
  const provider = {
    id: 'openai-codex',
    displayName: 'OpenAI Codex',
    driverId: 'codex-json-rpc',
    lifecycle: 'active',
    available: true,
    selectable: true,
    capabilities: {
      sessions: { create: 'supported', resume: 'supported', list: 'unsupported', import: 'unsupported' },
      input: { text: 'supported', images: 'unsupported', fileReferences: 'unsupported' },
      tools: { streaming: 'supported', approval: 'supported', userInput: 'supported', mcp: 'runtime-detected' },
      runtime: { cancel: 'soft', reconnect: 'supported', concurrentSessions: 'supported' },
    },
  } satisfies AgentProviderDescriptor;
  const probe = {
    installed: true,
    initialized: true,
    command: 'C:/tools/codex.exe',
    version: 'codex-cli 1.0.0',
    error: null,
    probe: { authenticated: true, authMode: 'chatgpt', requiresOpenaiAuth: true },
  } as const;

  assert.deepEqual(resolveProviderStatus(provider, null, null, probe), {
    label: '已检测',
    tone: 'positive',
  });
  assert.equal(resolveProviderDiagnostics(provider, null, null, probe).auth, '已认证');
});

test('successful OpenCode diagnostics reconcile a stale unavailable registry entry', () => {
  const provider = {
    id: 'opencode',
    displayName: 'OpenCode',
    driverId: 'acp',
    lifecycle: 'active',
    available: false,
    selectable: false,
    capabilities: {
      sessions: { create: 'supported', resume: 'supported', list: 'supported', import: 'unsupported' },
      input: { text: 'supported', images: 'supported', fileReferences: 'supported' },
      tools: { streaming: 'supported', approval: 'supported', userInput: 'supported', mcp: 'runtime-detected' },
      runtime: { cancel: 'soft', reconnect: 'supported', concurrentSessions: 'supported' },
    },
  } satisfies AgentProviderDescriptor;
  const diagnostics = {
    providerId: 'opencode',
    installed: true,
    command: 'C:/tools/opencode.exe',
    version: '1.17.7',
    latestVersion: '1.18.2',
    updateAvailable: true,
    versionCheckError: null,
    configDirectory: 'C:/Users/test/.config/opencode',
    skillsDirectory: 'C:/Users/test/.config/opencode/skills',
    updateCommand: 'npm install -g opencode-ai@latest',
    installCommand: 'npm install -g opencode-ai@latest',
    diagnosticCommand: 'opencode debug info',
    diagnostic: { available: true, success: null },
    capabilities: { plugins: false, mcp: true, skills: true },
  } satisfies AgentSettingsDiagnostics;

  const reconciled = reconcileProviderAvailability(provider, diagnostics);
  assert.equal(reconciled.available, true);
  assert.equal(reconciled.selectable, true);
  assert.equal(reconcileProviderAvailability({ ...provider, lifecycle: 'planned' }, diagnostics).selectable, false);
  assert.equal(reconcileProviderAvailability(provider, { ...diagnostics, installed: false }).available, false);
  assert.match(providerSettingsSource, /registrySyncAttemptsRef/);
  assert.match(providerSettingsSource, /\.then\(\(\) => onRefreshProviders\(\)\)/);
  assert.match(providerSettingsSource, /providers=\{effectiveProviders\}/);
  assert.match(providerSettingsSource, /effectiveProviders\.map\(\(provider\) =>/);
});

test('OpenCode diagnostics report ACP and model configuration without exposing credentials', () => {
  const provider = {
    id: 'opencode',
    displayName: 'OpenCode',
    driverId: 'acp',
    lifecycle: 'active',
    available: true,
    selectable: true,
    capabilities: {
      sessions: { create: 'supported', resume: 'supported', list: 'supported', import: 'unsupported' },
      input: { text: 'supported', images: 'supported', fileReferences: 'supported' },
      tools: { streaming: 'supported', approval: 'supported', userInput: 'supported', mcp: 'runtime-detected' },
      runtime: { cancel: 'soft', reconnect: 'supported', concurrentSessions: 'supported' },
    },
  } satisfies AgentProviderDescriptor;
  const probe: OpenCodeAcpProbeResult = {
    installed: true,
    initialized: true,
    command: 'C:/tools/opencode.exe',
    version: '1.17.7',
    error: null,
    probe: {
      configured: true,
      modelCount: 42,
      initialize: {
        protocolVersion: 1,
        loadSession: true,
        promptCapabilities: { image: true, audio: false, embeddedContext: true },
        mcpCapabilities: { http: true, sse: true },
        authMethods: [],
        defaultAuthMethodId: null,
        agentVersion: '1.17.7',
        currentModelId: null,
        models: [],
      },
    },
  };

  assert.deepEqual(resolveProviderStatus(provider, null, null, null, probe), {
    label: '已检测',
    tone: 'positive',
  });
  assert.equal(
    resolveProviderDiagnostics(provider, null, null, null, probe).auth,
    '由 OpenCode 管理 · 42 个模型',
  );
  assert.match(providerSettingsSource, /provider\.id === 'opencode'/);
  assert.match(providerManagementSource, /OPENCODE_CLI_PATH/);
});
