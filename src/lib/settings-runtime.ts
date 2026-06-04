/// <reference types="vite/client" />

import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater';
import type { AppDistributionMode, AppRuntimeFlavor, AppRuntimeInfo, ClaudeCliVersionInfo } from '../types';
import { isTauriRuntime } from './window-material';

const DEFAULT_REPOSITORY_URL = 'https://github.com/syscryer/codem';
const DEFAULT_CLAUDE_CLI_SETUP_URL = 'https://docs.anthropic.com/en/docs/claude-code/setup';
const DEFAULT_CLAUDE_CLI_RECOMMENDED_VERSION = '2.1.123';

export type AppUpdateInfo = {
  status: 'available' | 'latest' | 'failed' | 'unsupported';
  version?: string;
  message?: string;
  update?: Update;
};

type AppUpdateCheckOptions = {
  silent?: boolean;
};

type UpdateDownloadProgressState = {
  downloaded: number;
  total: number;
};

type TauriRuntimeInfo = {
  version?: string;
  repositoryUrl?: string;
  distributionMode?: AppDistributionMode;
  runtimeFlavor?: AppRuntimeFlavor;
  isTauri?: boolean;
};

export async function getAppRuntimeInfo(): Promise<AppRuntimeInfo> {
  if (!isTauriRuntime()) {
    return {
      version: import.meta.env.PACKAGE_VERSION ?? '0.0.0',
      repositoryUrl: DEFAULT_REPOSITORY_URL,
      distributionMode: 'web',
      runtimeFlavor: 'unknown',
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
      runtimeFlavor: normalizeRuntimeFlavor(runtime?.runtimeFlavor),
      isTauri: runtime?.isTauri !== false,
    };
  } catch {
    return {
      version: import.meta.env.PACKAGE_VERSION ?? '0.0.0',
      repositoryUrl: DEFAULT_REPOSITORY_URL,
      distributionMode: 'desktop-nsis',
      runtimeFlavor: 'unknown',
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
  if (import.meta.env.DEV) {
    return {
      status: 'unsupported',
      message: '开发模式不会检查应用更新',
    };
  }

  try {
    const runtimeInfo = await getAppRuntimeInfo();
    if (runtimeInfo.distributionMode === 'desktop-portable') {
      return {
        status: 'unsupported',
        message: '绿色版暂不支持应用内自动安装，请到 Release 下载新版本',
      };
    }
    if (runtimeInfo.runtimeFlavor === 'no-node') {
      return {
        status: 'unsupported',
        message: 'no-node 安装版暂不支持应用内自动安装，请到 Release 手动下载新版本',
      };
    }

    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check({ timeout: 30_000 });
    if (!update) {
      return null;
    }

    return {
      status: 'available',
      version: normalizeString(update.version) || undefined,
      message: normalizeString(update.body) || undefined,
      update,
    };
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : '检查更新失败',
    };
  }
}

export async function installAppUpdate(
  update: Update,
  onProgress?: (message: string) => void,
): Promise<void> {
  const progress: UpdateDownloadProgressState = {
    downloaded: 0,
    total: 0,
  };

  try {
    onProgress?.('正在准备更新...');
    await update.downloadAndInstall((event) => {
      onProgress?.(formatUpdateDownloadProgress(event, progress));
    });
    onProgress?.('更新安装完成，正在重启应用...');
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } finally {
    await update.close().catch((error) => {
      console.error('释放更新资源失败', error);
    });
  }
}

export function formatUpdateDownloadProgress(
  event: DownloadEvent,
  state: UpdateDownloadProgressState,
) {
  if (event.event === 'Started') {
    state.downloaded = 0;
    state.total = event.data.contentLength ?? 0;
  }
  if (event.event === 'Progress') {
    state.downloaded += event.data.chunkLength;
  }
  if (event.event === 'Finished') {
    return '更新包下载完成，正在安装...';
  }
  if (state.total <= 0) {
    return '正在下载更新包...';
  }

  const percent = Math.min(100, Math.round((state.downloaded / state.total) * 100));
  return `正在下载更新包... ${percent}%`;
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
      recommendedVersion: DEFAULT_CLAUDE_CLI_RECOMMENDED_VERSION,
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
    recommendedVersion:
      normalizeString(record.recommendedVersion) ||
      normalizeString(record.minimumSupportedVersion) ||
      DEFAULT_CLAUDE_CLI_RECOMMENDED_VERSION,
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

function normalizeRuntimeFlavor(value: unknown): AppRuntimeFlavor {
  if (value === 'with-node' || value === 'no-node' || value === 'development' || value === 'unknown') {
    return value;
  }
  return 'unknown';
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
