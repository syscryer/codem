import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { AgentProviderDescriptor, ClaudeCliVersionInfo } from '../types.js';
import {
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
const appSource = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
const agentRunSource = await readFile(new URL('../hooks/useAgentRun.ts', import.meta.url), 'utf8');

test('settings exposes Agent providers without adding a new navigation section', () => {
  assert.match(sidebarSource, /id: 'providers', label: 'Agent 与模型'/);
  assert.match(settingsViewSource, /<AgentModelSettingsSection/);
  assert.match(agentSettingsSource, />提供商</);
  assert.match(agentSettingsSource, />模型与默认值</);
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
  assert.match(providerSettingsSource, /Promise\.allSettled/);
  assert.match(providerSettingsSource, /agent-provider-list-skeleton/);
  assert.doesNotMatch(providerSettingsSource, /fetchAgentProviderRegistry/);
  assert.doesNotMatch(providerSettingsSource, /if \(loadState === 'loading' && !registry\)/);
});

test('provider management keeps Grok and Codex detection explicit and non-reentrant', () => {
  assert.match(providerSettingsSource, /async function runGrokProbe\(\)/);
  assert.match(providerSettingsSource, /async function runCodexProbe\(\)/);
  assert.match(providerSettingsSource, /probeGrokAgent\(controller\.signal\)/);
  assert.match(providerSettingsSource, /probeCodexAgent\(controller\.signal\)/);
  assert.match(providerSettingsSource, /disabled=\{probeState === 'checking' \|\| diagnosticChecking\}/);
  assert.match(providerSettingsSource, /fetchAgentSettingsDiagnostics\(providerId, undefined, true\)/);
  assert.doesNotMatch(
    providerSettingsSource.slice(
      providerSettingsSource.indexOf('useEffect(() =>'),
      providerSettingsSource.indexOf('const selectedProvider ='),
    ),
    /probe(?:Grok|Codex)Agent/,
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
