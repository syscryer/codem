import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { AgentModelCatalog } from '../types.js';
import { createAgentModelCatalogCache } from './agent-model-catalog-cache.js';

const agentRunSource = await readFile(new URL('../hooks/useAgentRun.ts', import.meta.url), 'utf8');
const providerRegistrySource = await readFile(
  new URL('./agent-provider-registry.ts', import.meta.url),
  'utf8',
);

function catalog(providerId: string, suffix = 'v1'): AgentModelCatalog {
  return {
    providerId,
    defaultModelId: `${providerId}-${suffix}`,
    models: [
      {
        id: `${providerId}-${suffix}`,
        label: suffix,
        isDefault: true,
        supportedReasoningEfforts: [],
      },
    ],
  };
}

test('agent model catalog cache merges concurrent reads for one provider', async () => {
  let resolveLoad: ((value: AgentModelCatalog) => void) | undefined;
  let calls = 0;
  const cache = createAgentModelCatalogCache({
    loader: async () => {
      calls += 1;
      return await new Promise<AgentModelCatalog>((resolve) => {
        resolveLoad = resolve;
      });
    },
  });

  const first = cache.load('openai-codex');
  const second = cache.load('openai-codex');
  assert.equal(calls, 1);
  assert.equal(first, second);

  resolveLoad?.(catalog('openai-codex'));
  assert.equal(await first, await second);
});

test('agent model catalog cache exposes stale data while refreshing it', async () => {
  let now = 1_000;
  let version = 0;
  const cache = createAgentModelCatalogCache({
    maxAgeMs: 100,
    now: () => now,
    loader: async (providerId) => catalog(providerId, `v${++version}`),
  });

  await cache.load('openai-codex');
  now += 101;
  assert.equal(cache.peek('openai-codex')?.stale, true);
  assert.equal(cache.peek('openai-codex')?.catalog.defaultModelId, 'openai-codex-v1');

  await cache.load('openai-codex');
  assert.equal(cache.peek('openai-codex')?.stale, false);
  assert.equal(cache.peek('openai-codex')?.catalog.defaultModelId, 'openai-codex-v2');
});

test('forced refresh bypasses a fresh entry and keeps providers isolated', async () => {
  const calls: Array<{ providerId: string; refresh: boolean }> = [];
  const cache = createAgentModelCatalogCache({
    loader: async (providerId, refresh) => {
      calls.push({ providerId, refresh });
      return catalog(providerId, refresh ? 'forced' : 'initial');
    },
  });

  await cache.load('openai-codex');
  await cache.load('openai-codex');
  await cache.load('opencode');
  await cache.load('openai-codex', { force: true });

  assert.deepEqual(calls, [
    { providerId: 'openai-codex', refresh: false },
    { providerId: 'opencode', refresh: false },
    { providerId: 'openai-codex', refresh: true },
  ]);
  assert.equal(cache.peek('openai-codex')?.catalog.defaultModelId, 'openai-codex-forced');
  assert.equal(cache.peek('opencode')?.catalog.defaultModelId, 'opencode-initial');
});

test('failed refresh preserves the last usable model catalog', async () => {
  let fail = false;
  const cache = createAgentModelCatalogCache({
    loader: async (providerId) => {
      if (fail) {
        throw new Error('refresh failed');
      }
      return catalog(providerId);
    },
  });

  await cache.load('openai-codex');
  fail = true;
  await assert.rejects(cache.load('openai-codex', { force: true }), /refresh failed/);
  assert.equal(cache.peek('openai-codex')?.catalog.defaultModelId, 'openai-codex-v1');
});

test('useAgentRun prewarms the default provider and keeps cached draft controls synchronous', () => {
  assert.match(agentRunSource, /agentModelCatalogCache\.load\(defaultProviderId\)/);
  assert.match(agentRunSource, /resetDraftModelSelection\(providerId\)/);
  assert.match(agentRunSource, /const snapshot = [\s\S]*agentModelCatalogCache\.peek\(providerId\)/);
  assert.match(agentRunSource, /if \(snapshot\.stale\) \{[\s\S]*agentModelCatalogCache\.load\(providerId\)/);
});

test('manual model refresh bypasses both frontend and backend caches', () => {
  assert.match(agentRunSource, /agentModelCatalogCache\.load\(providerId, \{ force: true \}\)/);
  assert.match(providerRegistrySource, /options\?\.refresh \? '\?refresh=true' : ''/);
});
