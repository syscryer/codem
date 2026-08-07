import type { AgentModelCatalog } from '../types.js';
import { fetchAgentModelCatalog } from './agent-provider-registry.js';

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

type CacheEntry = {
  catalog: AgentModelCatalog;
  loadedAt: number;
};

type CatalogLoader = (providerId: string, refresh: boolean, channelId?: string) => Promise<AgentModelCatalog>;

export type AgentModelCatalogSnapshot = {
  catalog: AgentModelCatalog;
  stale: boolean;
};

export type AgentModelCatalogCache = ReturnType<typeof createAgentModelCatalogCache>;

export function createAgentModelCatalogCache(options?: {
  loader?: CatalogLoader;
  maxAgeMs?: number;
  now?: () => number;
}) {
  const loader = options?.loader ?? ((providerId, refresh, channelId) =>
    fetchAgentModelCatalog(providerId, { refresh, channelId }));
  const maxAgeMs = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = options?.now ?? Date.now;
  const entries = new Map<string, CacheEntry>();
  const requests = new Map<string, Promise<AgentModelCatalog>>();
  const refreshRequests = new Map<string, Promise<AgentModelCatalog>>();
  const generations = new Map<string, number>();

  function cacheKey(providerId: string, channelId?: string) {
    return `${providerId}\u0000${channelId?.trim() || 'system'}`;
  }

  function peek(providerId: string, channelId?: string): AgentModelCatalogSnapshot | null {
    const entry = entries.get(cacheKey(providerId, channelId));
    if (!entry) {
      return null;
    }
    return {
      catalog: entry.catalog,
      stale: now() - entry.loadedAt >= maxAgeMs,
    };
  }

  function load(providerId: string, options?: { force?: boolean; channelId?: string }) {
    const force = options?.force === true;
    const key = cacheKey(providerId, options?.channelId);
    const snapshot = peek(providerId, options?.channelId);
    if (!force && snapshot && !snapshot.stale) {
      return Promise.resolve(snapshot.catalog);
    }

    if (!force) {
      const refreshing = refreshRequests.get(key);
      if (refreshing) {
        return refreshing;
      }
      const existing = requests.get(key);
      if (existing) {
        return existing;
      }
    } else {
      const existing = refreshRequests.get(key);
      if (existing) {
        return existing;
      }
    }

    const generation = (generations.get(key) ?? 0) + 1;
    generations.set(key, generation);
    const target = force ? refreshRequests : requests;
    const request = loader(providerId, force, options?.channelId)
      .then((catalog) => {
        if (catalog.providerId !== providerId) {
          throw new Error('模型目录 Provider 与请求不一致');
        }
        if (generations.get(key) === generation) {
          entries.set(key, { catalog, loadedAt: now() });
        }
        return catalog;
      })
      .finally(() => {
        if (target.get(key) === request) {
          target.delete(key);
        }
      });
    target.set(key, request);
    return request;
  }

  return {
    peek,
    load,
  };
}

export const agentModelCatalogCache = createAgentModelCatalogCache();
