import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  AGENT_PROVIDER_IDS,
  AGENT_PROVIDER_METADATA,
  getAgentProviderMetadata,
  isAgentProviderId,
} from './agent-provider-metadata.js';
import { resolveChatRuntimeKind } from './agent-provider-registry.js';

test('Agent Provider metadata is complete, unique, and routable', () => {
  assert.equal(AGENT_PROVIDER_METADATA.length, 10);
  assert.equal(new Set(AGENT_PROVIDER_IDS).size, AGENT_PROVIDER_IDS.length);

  for (const provider of AGENT_PROVIDER_METADATA) {
    assert.ok(provider.displayName);
    assert.ok(provider.driverId);
    assert.ok(provider.protocolLabel);
    assert.equal(isAgentProviderId(provider.id), true);
    assert.equal(getAgentProviderMetadata(provider.id), provider);
    assert.equal(resolveChatRuntimeKind(provider.id), provider.runtimeKind);
  }

  assert.equal(isAgentProviderId('future-provider'), false);
  assert.equal(getAgentProviderMetadata('future-provider'), undefined);
  assert.equal(resolveChatRuntimeKind('future-provider'), 'unsupported');
  assert.deepEqual(getAgentProviderMetadata('gemini-cli'), {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    driverId: 'acp',
    runtimeKind: 'generic',
    protocolLabel: 'Gemini ACP',
  });
  assert.deepEqual(getAgentProviderMetadata('hermes-agent'), {
    id: 'hermes-agent',
    displayName: 'Hermes Agent',
    driverId: 'hermes-json-rpc',
    runtimeKind: 'generic',
    protocolLabel: 'Hermes JSON-RPC',
  });
});

test('high-risk Provider surfaces consume shared metadata', () => {
  const expectations = [
    ['../components/settings/AgentSettingsProviderTabs.tsx', 'AGENT_PROVIDER_METADATA'],
    ['../components/settings/AgentProviderSettings.tsx', 'AGENT_PROVIDER_IDS'],
    ['../components/settings/AgentChannelSettings.tsx', 'getAgentProviderDisplayName'],
    ['../components/settings/UsageSettings.tsx', 'AGENT_PROVIDER_IDS'],
    ['../components/WorkspaceStatus.tsx', 'resolveChatRuntimeKind'],
    ['./settings-api.ts', 'isAgentProviderId'],
  ] as const;

  for (const [path, marker] of expectations) {
    assert.match(readFileSync(new URL(path, import.meta.url), 'utf8'), new RegExp(marker));
  }

  const iconSource = readFileSync(
    new URL('../components/AgentProviderIcon.tsx', import.meta.url),
    'utf8',
  );
  assert.match(iconSource, /satisfies Record<AgentProviderId, string>/);
});

test('onboarding gate retains artifact, link, context, and status coverage', () => {
  for (const path of [
    './conversation-output-files.test.ts',
    './markdown-link.test.ts',
    './conversation-context-prototype.test.ts',
    './workspace-session-status.test.ts',
  ]) {
    assert.ok(existsSync(new URL(path, import.meta.url)), `${path} must remain in the gate`);
  }

  const spec = readFileSync(
    new URL('../../openspec/agent-provider-onboarding.md', import.meta.url),
    'utf8',
  );
  assert.match(spec, /## Conversation And Artifact Contract/);
  assert.match(spec, /### Structured Plan And Progress/);
  assert.match(spec, /TodoWrite.*update_plan.*Provider 原生计划事件/s);
  assert.match(spec, /会话上下文岛只消费统一计划投影/);
  assert.match(spec, /## Context And Status Contract/);
  assert.match(spec, /## Verification Matrix/);
});
