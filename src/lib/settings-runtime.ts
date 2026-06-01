/// <reference types="vite/client" />

import type { AppDistributionMode, AppRuntimeInfo, ClaudeCliVersionInfo } from '../types';
import { isTauriRuntime } from './window-material';

const DEFAULT_REPOSITORY_URL = 'https://github.com/syscryer/codem';
const DEFAULT_CLAUDE_CLI_SETUP_URL = 'https://docs.anthropic.com/en/docs/claude-code/setup';
const DEFAULT_CLAUDE_CLI_MIN_VERSION = '2.1.123';

export type AppUpdateInfo = {
  status: 'available' | 'latest' | 'failed' | 'unsupported';
  version?: string;
  message?: string;
};

type AppUpdateCheckOptions = {
  silent?: boolean;
};

type TauriRuntimeInfo = {
  version?: string;
  repositoryUrl?: string;
  distributionMode?: AppDistributionMode;
  isTauri?: boolean;
};

type TauriUpdateCheckResult = {
  status?: 'available' | 'latest' | 'failed' | 'unsupported';
  version?: string;
  message?: string;
};

export async function getAppRuntimeInfo(): Promise<AppRuntimeInfo> {
  if (!isTauriRuntime()) {
    return {
      version: import.meta.env.PACKAGE_VERSION ?? '0.0.0',
      repositoryUrl: DEFAULT_REPOSITORY_URL,
      distributionMode: 'web',
      isTauri: false,
    };
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const runtime = await invoke<TauriRuntimeInfo>('get_app_runtime_info');
    return {
      version: normalizeString(runtime?.version) || import.meta.env.PACKAGE_VERSION || '0.0.0',
      repositoryUrl: normalizeString(runtime?.repositoryUrl) || DEFAULT_REPOSITORY_URL,
      distributionMode: normalizeDistributionMode(runtime?.distributionMode),
      isTauri: runtime?.isTauri !== false,
    };
  } catch {
    return {
      version: import.meta.env.PACKAGE_VERSION ?? '0.0.0',
      repositoryUrl: DEFAULT_REPOSITORY_URL,
      distributionMode: 'desktop-nsis',
      isTauri: true,
    };
  }
}

export async function checkForAppUpdate(_options: AppUpdateCheckOptions = {}): Promise<AppUpdateInfo | null> {
  if (!isTauriRuntime()) {
    return {
      status: 'unsupported',
      message: 'Web 版暂不支持应用内更新',
    };
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<TauriUpdateCheckResult>('check_app_update');
    const status = result?.status;
    if (status === 'available') {
      return {
        status,
        version: normalizeString(result.version) || undefined,
      };
    }
    if (status === 'failed') {
      return {
        status,
        message: normalizeString(result.message) || '检查更新失败',
      };
    }
    if (status === 'unsupported') {
      return {
        status,
        message: normalizeString(result.message) || '当前版本暂不支持应用内更新',
      };
    }
    return null;
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : '检查更新失败',
    };
  }
}

export async function readClaudeCliVersionInfo(): Promise<ClaudeCliVersionInfo> {
  try {
    const response = await fetch('/api/claude/version-info');
    if (!response.ok) {
      throw new Error('读取 Claude CLI 版本信息失败');
    }

    return normalizeClaudeCliVersionInfo(await response.json());
  } catch (error) {
    return {
      installed: false,
      supported: false,
      version: null,
      minimumSupportedVersion: DEFAULT_CLAUDE_CLI_MIN_VERSION,
      command: null,
      updateCommand: 'claude update',
      installCommand: 'npm install -g @anthropic-ai/claude-code',
      setupUrl: DEFAULT_CLAUDE_CLI_SETUP_URL,
      versionError: error instanceof Error ? error.message : '读取 Claude CLI 版本信息失败',
    };
  }
}

function normalizeClaudeCliVersionInfo(value: unknown): ClaudeCliVersionInfo {
  const record = isRecord(value) ? value : {};
  const installed = Boolean(record.installed);
  const supported = Boolean(record.supported);
  return {
    installed,
    supported,
    version: normalizeString(record.version) || null,
    minimumSupportedVersion: normalizeString(record.minimumSupportedVersion) || DEFAULT_CLAUDE_CLI_MIN_VERSION,
    command: normalizeString(record.command) || null,
    updateCommand: normalizeString(record.updateCommand) || 'claude update',
    installCommand: normalizeString(record.installCommand) || 'npm install -g @anthropic-ai/claude-code',
    setupUrl: normalizeString(record.setupUrl) || DEFAULT_CLAUDE_CLI_SETUP_URL,
    ...(normalizeString(record.versionError) ? { versionError: normalizeString(record.versionError) } : {}),
  };
}

function normalizeDistributionMode(value: unknown): AppDistributionMode {
  if (value === 'desktop-portable' || value === 'desktop-nsis' || value === 'web') {
    return value;
  }
  return 'desktop-nsis';
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
