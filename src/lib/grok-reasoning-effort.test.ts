import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GROK_BUILD_PROVIDER_ID } from '../constants.js';
import { buildAgentChannelModelCatalog } from './agent-channel-selection.js';

const composerSource = readFileSync(new URL('../components/Composer.tsx', import.meta.url), 'utf8');
const agentRunSource = readFileSync(new URL('../hooks/useAgentRun.ts', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../hooks/useWorkspaceState.ts', import.meta.url), 'utf8');

test('Grok keeps runtime-detected reasoning efforts and Composer renders by capability', () => {
  const catalog = buildAgentChannelModelCatalog(GROK_BUILD_PROVIDER_ID, undefined, {
    providerId: GROK_BUILD_PROVIDER_ID,
    defaultModelId: 'grok-4.6',
    models: [{
      id: 'grok-4.6',
      label: 'Grok 4.6',
      isDefault: true,
      defaultReasoningEffort: 'high',
      supportedReasoningEfforts: [
        { id: 'high', description: 'Highest implementation quality' },
        { id: 'medium', description: 'Balanced effort' },
        { id: 'low', description: 'Quick implementations' },
      ],
    }],
  });

  assert.equal(catalog?.models[0]?.defaultReasoningEffort, 'high');
  assert.deepEqual(
    catalog?.models[0]?.supportedReasoningEfforts.map((effort) => effort.id),
    ['high', 'medium', 'low'],
  );
  assert.match(composerSource, /\{agentReasoningEffortOptions\.length > 0 \? \(/);
  assert.doesNotMatch(composerSource, /agent === 'codex'.*agentReasoningEffortOptions\.length/);
});

test('Grok models without advertised efforts keep the control hidden', () => {
  const catalog = buildAgentChannelModelCatalog(GROK_BUILD_PROVIDER_ID, undefined, {
    providerId: GROK_BUILD_PROVIDER_ID,
    defaultModelId: 'grok-composer',
    models: [{
      id: 'grok-composer',
      label: 'Grok Composer',
      isDefault: true,
      supportedReasoningEfforts: [],
    }],
  });

  assert.deepEqual(catalog?.models[0]?.supportedReasoningEfforts, []);
});

test('reasoning effort persistence keeps the newest optimistic selection stable', () => {
  assert.match(workspaceSource, /threadMetadataPersistQueueRef/);
  assert.match(workspaceSource, /previous\.catch\(\(\) => undefined\)\.then/);
  assert.match(agentRunSource, /pendingReasoningEffortRef/);
  assert.match(agentRunSource, /pendingReasoningEffort\?\.reasoningEffort/);
  assert.match(agentRunSource, /pendingReasoningEffortRef\.current\?\.revision !== revision/);
});
