import { useCallback, useEffect, useState } from 'react';
import { fetchAgentChannelBootstrap } from '../lib/agent-channel-api';
import type { AgentChannelBootstrap } from '../types';

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

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const next = await fetchAgentChannelBootstrap(signal);
      setBootstrap(next);
      setError('');
      return next;
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') {
        return null;
      }
      setError(requestError instanceof Error ? requestError.message : '读取 Agent 渠道失败');
      return null;
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
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
