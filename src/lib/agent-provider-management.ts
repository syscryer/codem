import { DEFAULT_MODEL_VALUE } from '../constants.js';
import type {
  AgentCancelSupport,
  AgentCapabilitySupport,
  AgentProviderDescriptor,
  ClaudeCliVersionInfo,
  ClaudeModelInfo,
  CodexAppServerProbeResult,
  GrokAcpProbeResult,
} from '../types.js';
import { modelLabel } from './ui-labels.js';

export type ProviderStatusTone = 'positive' | 'warning' | 'negative' | 'muted';

export type ProviderCapabilityItem = {
  label: string;
  value: AgentCapabilitySupport | AgentCancelSupport;
};

export type ProviderModelSummary = {
  id: string;
  label: string;
  detail?: string;
  current?: boolean;
};

export function getProviderCapabilityGroups(provider: AgentProviderDescriptor) {
  return [
    {
      title: '会话',
      items: [
        { label: '创建', value: provider.capabilities.sessions.create },
        { label: '恢复', value: provider.capabilities.sessions.resume },
        { label: '列表', value: provider.capabilities.sessions.list },
        { label: '导入', value: provider.capabilities.sessions.import },
      ],
    },
    {
      title: '输入',
      items: [
        { label: '文本', value: provider.capabilities.input.text },
        { label: '图片', value: provider.capabilities.input.images },
        { label: '文件引用', value: provider.capabilities.input.fileReferences },
      ],
    },
    {
      title: '工具',
      items: [
        { label: '流式工具', value: provider.capabilities.tools.streaming },
        { label: '权限审批', value: provider.capabilities.tools.approval },
        { label: '用户输入', value: provider.capabilities.tools.userInput },
        { label: 'MCP', value: provider.capabilities.tools.mcp },
      ],
    },
    {
      title: '运行时',
      items: [
        { label: '取消', value: provider.capabilities.runtime.cancel },
        { label: '重连', value: provider.capabilities.runtime.reconnect },
        { label: '并发会话', value: provider.capabilities.runtime.concurrentSessions },
      ],
    },
  ] satisfies Array<{ title: string; items: ProviderCapabilityItem[] }>;
}

export function resolveProviderStatus(
  provider: AgentProviderDescriptor,
  claudeCliInfo: ClaudeCliVersionInfo | null,
  grokProbe: GrokAcpProbeResult | null,
  codexProbe: CodexAppServerProbeResult | null = null,
): { label: string; tone: ProviderStatusTone } {
  if (provider.id === 'claude-code') {
    const available = claudeCliInfo?.installed === true || provider.available === true;
    return available
      ? { label: '可用', tone: 'positive' }
      : { label: '未安装', tone: 'negative' };
  }
  if (provider.id === 'grok-build' && grokProbe) {
    if (!grokProbe.installed) {
      return { label: '未安装', tone: 'negative' };
    }
    if (!grokProbe.initialized || !grokProbe.probe?.authenticated) {
      return { label: '待处理', tone: 'warning' };
    }
    return { label: '已检测', tone: 'positive' };
  }
  if (provider.id === 'openai-codex' && codexProbe) {
    if (!codexProbe.installed) {
      return { label: '未安装', tone: 'negative' };
    }
    if (!codexProbe.initialized || !codexProbe.probe?.authenticated) {
      return { label: '待处理', tone: 'warning' };
    }
    return { label: '已检测', tone: 'positive' };
  }
  return provider.lifecycle === 'planned'
    ? { label: '规划中', tone: 'muted' }
    : { label: provider.available ? '可用' : '不可用', tone: provider.available ? 'positive' : 'negative' };
}

export function resolveProviderDiagnostics(
  provider: AgentProviderDescriptor,
  claudeCliInfo: ClaudeCliVersionInfo | null,
  grokProbe: GrokAcpProbeResult | null,
  codexProbe: CodexAppServerProbeResult | null = null,
) {
  if (provider.id === 'claude-code') {
    const installed = claudeCliInfo?.installed === true || provider.available === true;
    return {
      cli: installed ? '已安装' : (claudeCliInfo?.versionError ? '检测失败' : '未安装'),
      auth: installed ? '由 Claude CLI 管理' : '不可用',
      version: claudeCliInfo?.version ?? (claudeCliInfo?.versionError ? '读取失败' : '未知'),
      command: claudeCliInfo?.command ?? '',
    };
  }
  if (provider.id === 'grok-build') {
    return {
      cli: grokProbe ? (grokProbe.installed ? '已安装' : '未安装') : '未检测',
      auth: grokProbe?.probe
        ? (grokProbe.probe.authenticated ? '已认证' : '需要登录')
        : '未检测',
      version: grokProbe?.version ?? grokProbe?.probe?.initialize.agentVersion ?? '未知',
      command: grokProbe?.command ?? '',
    };
  }
  if (provider.id === 'openai-codex') {
    return {
      cli: codexProbe ? (codexProbe.installed ? '已安装' : '未安装') : '未检测',
      auth: codexProbe?.probe
        ? (codexProbe.probe.authenticated ? '已认证' : '需要登录')
        : '未检测',
      version: codexProbe?.version ?? '未知',
      command: codexProbe?.command ?? '',
    };
  }
  return {
    cli: provider.id === 'codem-agent' ? '待实现' : '待接入检测',
    auth: '未检测',
    version: '未知',
    command: '',
  };
}

export function getProviderModels(
  providerId: string,
  claudeModels: ClaudeModelInfo,
  grokProbe: GrokAcpProbeResult | null,
): ProviderModelSummary[] {
  if (providerId === 'claude-code') {
    return claudeModels.models
      .filter((model) => model.id !== DEFAULT_MODEL_VALUE)
      .map((model) => ({
        id: model.id,
        label: modelLabel(model),
        detail: model.contextWindowTokens ? formatTokenCount(model.contextWindowTokens) : undefined,
      }));
  }
  if (providerId === 'grok-build') {
    const initialize = grokProbe?.probe?.initialize;
    return initialize?.models.map((model) => ({
      id: model.modelId,
      label: model.name,
      detail: model.contextTokens ? formatTokenCount(model.contextTokens) : undefined,
      current: model.modelId === initialize.currentModelId,
    })) ?? [];
  }
  return [];
}

export function formatProviderListMeta(
  provider: AgentProviderDescriptor,
  claudeCliInfo: ClaudeCliVersionInfo | null,
  grokProbe: GrokAcpProbeResult | null,
  codexProbe: CodexAppServerProbeResult | null = null,
) {
  if (provider.id === 'claude-code' && claudeCliInfo?.version) {
    return `v${claudeCliInfo.version} · ${provider.driverId}`;
  }
  if (provider.id === 'grok-build' && grokProbe?.version) {
    return `v${grokProbe.version} · ${provider.driverId}`;
  }
  if (provider.id === 'openai-codex' && codexProbe?.version) {
    return `${codexProbe.version} · ${provider.driverId}`;
  }
  return provider.driverId;
}

export function formatProviderCapabilityState(
  value: AgentCapabilitySupport | AgentCancelSupport,
) {
  if (value === 'supported') {
    return { label: '支持', tone: 'positive' as const };
  }
  if (value === 'unsupported' || value === 'none') {
    return { label: '不支持', tone: 'negative' as const };
  }
  if (value === 'soft') {
    return { label: '软取消', tone: 'positive' as const };
  }
  if (value === 'hard') {
    return { label: '强制终止', tone: 'warning' as const };
  }
  return { label: '运行时检测', tone: 'muted' as const };
}

export function getGrokProbeStatusMessage(
  state: 'idle' | 'checking' | 'ready' | 'error',
  result: GrokAcpProbeResult | null,
  requestError: string,
) {
  if (state === 'checking') {
    return '正在启动 Grok ACP 并检测认证与能力';
  }
  if (state === 'error') {
    return `${requestError || '检测失败'}。请检查后重新检测。`;
  }
  if (state === 'ready' && result) {
    if (!result.installed) {
      return `${result.error || '未找到 grok 命令'}。安装后可重新检测。`;
    }
    if (!result.initialized) {
      return `${result.error || 'ACP 初始化失败'}。请检查 CLI 和网络后重新检测。`;
    }
    if (!result.probe?.authenticated) {
      return `${result.probe?.authError || 'Grok 缓存认证不可用'}。运行 grok login 后重新检测。`;
    }
    return '检测完成：CLI、ACP 初始化和缓存认证均可用；聊天入口是否开放以当前 Provider 状态为准。';
  }
  return '尚未检测。检测会启动一次本机 Grok ACP 子进程。';
}

export function getCodexProbeStatusMessage(
  state: 'idle' | 'checking' | 'ready' | 'error',
  result: CodexAppServerProbeResult | null,
  requestError: string,
) {
  if (state === 'checking') {
    return '正在启动 Codex App Server 并检测本机认证状态';
  }
  if (state === 'error') {
    return `${requestError || '检测失败'}。请检查后重新检测。`;
  }
  if (state === 'ready' && result) {
    if (!result.installed) {
      return `${result.error || '未找到可启动的 Codex CLI'}。安装独立 CLI 或设置 CODEX_CLI_PATH 后重新检测。`;
    }
    if (!result.initialized) {
      return `${result.error || 'App Server 初始化失败'}。请检查 CLI 版本和网络后重新检测。`;
    }
    if (!result.probe?.authenticated) {
      return 'Codex 尚未登录。请先在终端完成 codex login，再重新检测。';
    }
    const mode = result.probe.authMode ? `（${result.probe.authMode}）` : '';
    return `检测完成：Codex App Server 和本机认证${mode}均可用。`;
  }
  return '尚未检测。检测会启动一次本机 Codex App Server 子进程。';
}

function formatTokenCount(tokens: number) {
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) {
    return `${tokens / 1_000_000}M tokens`;
  }
  if (tokens >= 1_000 && tokens % 1_000 === 0) {
    return `${tokens / 1_000}K tokens`;
  }
  return `${tokens.toLocaleString('en-US')} tokens`;
}
