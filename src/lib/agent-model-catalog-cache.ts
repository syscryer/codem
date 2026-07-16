import type { AgentModelCatalog } from '../types.js';
import { fetchAgentModelCatalog } from './agent-provider-registry.js';

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

type CacheEntry = {
  catalog: AgentModelCatalog;
  loadedAt: number;
};

type CatalogLoader = (providerId: string, refresh: boolean) => Promise<AgentModelCatalog>;

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
  const loader = options?.loader ?? ((providerId, refresh) =>
    fetchAgentModelCatalog(providerId, { refresh }));
  const maxAgeMs = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = options?.now ?? Date.now;
  const entries = new Map<string, CacheEntry>();
  const requests = new Map<string, Promise<AgentModelCatalog>>();
  const refreshRequests = new Map<string, Promise<AgentModelCatalog>>();
  const generations = new Map<string, number>();

  function peek(providerId: string): AgentModelCatalogSnapshot | null {
    const entry = entries.get(providerId);
    if (!entry) {
      return null;
    }
    return {
      catalog: entry.catalog,
      stale: now() - entry.loadedAt >= maxAgeMs,
    };
  }

  function load(providerId: string, options?: { force?: boolean }) {
    const force = options?.force === true;
    const snapshot = peek(providerId);
    if (!force && snapshot && !snapshot.stale) {
      return Promise.resolve(snapshot.catalog);
    }

    if (!force) {
      const refreshing = refreshRequests.get(providerId);
      if (refreshing) {
        return refreshing;
      }
      const existing = requests.get(providerId);
      if (existing) {
        return existing;
      }
    } else {
      const existing = refreshRequests.get(providerId);
      if (existing) {
        return existing;
      }
    }

    const generation = (generations.get(providerId) ?? 0) + 1;
    generations.set(providerId, generation);
    const target = force ? refreshRequests : requests;
    const request = loader(providerId, force)
      .then((catalog) => {
        if (catalog.providerId !== providerId) {
          throw new Error('模型目录 Provider 与请求不一致');
        }
        if (generations.get(providerId) === generation) {
          entries.set(providerId, { catalog, loadedAt: now() });
        }
        return catalog;
      })
      .finally(() => {
        if (target.get(providerId) === request) {
          target.delete(providerId);
        }
      });
    target.set(providerId, request);
    return request;
  }

  return {
    peek,
    load,
  };
}

export const agentModelCatalogCache = createAgentModelCatalogCache();
