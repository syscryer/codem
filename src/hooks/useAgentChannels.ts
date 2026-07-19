import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAgentChannelBootstrap } from '../lib/agent-channel-api';
import type { AgentChannelBootstrap } from '../types';

const EXTERNAL_CONFIG_REFRESH_THROTTLE_MS = 2000;

const EMPTY_BOOTSTRAP: AgentChannelBootstrap = {
  channels: [],
  systemChannels: [],
  ccSwitch: { detected: false, currentProviders: {} },
  templates: [],
  defaultChannelIds: {
    'claude-code': 'system',
    'openai-codex': 'system',
    'grok-build': 'system',
    opencode: 'system',
  },
};

export function useAgentChannels() {
  const [bootstrap, setBootstrap] = useState<AgentChannelBootstrap>(EMPTY_BOOTSTRAP);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refreshControllerRef = useRef<AbortController | null>(null);
  const lastRefreshAtRef = useRef(0);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (signal?.aborted) {
      return null;
    }

    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener('abort', abortFromCaller, { once: true });
    lastRefreshAtRef.current = Date.now();
    setLoading(true);
    try {
      const next = await fetchAgentChannelBootstrap(controller.signal);
      setBootstrap(next);
      setError('');
      return next;
    } catch (requestError) {
      if (controller.signal.aborted) {
        return null;
      }
      setError(requestError instanceof Error ? requestError.message : '读取 Agent 渠道失败');
      return null;
    } finally {
      signal?.removeEventListener('abort', abortFromCaller);
      if (refreshControllerRef.current === controller) {
        refreshControllerRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => refreshControllerRef.current?.abort();
  }, [refresh]);

  useEffect(() => {
    const refreshFromExternalConfig = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      if (Date.now() - lastRefreshAtRef.current < EXTERNAL_CONFIG_REFRESH_THROTTLE_MS) {
        return;
      }
      void refresh();
    };

    window.addEventListener('focus', refreshFromExternalConfig);
    document.addEventListener('visibilitychange', refreshFromExternalConfig);
    return () => {
      window.removeEventListener('focus', refreshFromExternalConfig);
      document.removeEventListener('visibilitychange', refreshFromExternalConfig);
    };
  }, [refresh]);

  return {
    bootstrap,
    channels: bootstrap.channels,
    systemChannels: bootstrap.systemChannels,
    ccSwitch: bootstrap.ccSwitch,
    templates: bootstrap.templates,
    defaultChannelIds: bootstrap.defaultChannelIds,
    loading,
    error,
    refresh,
  };
}
