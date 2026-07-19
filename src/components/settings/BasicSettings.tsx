import { Bell, Download, ExternalLink, GitBranch, GitPullRequest, History, ListCollapse, LoaderCircle, RefreshCw, RotateCcw, Rows3, Search, Send, Shield } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { permissionMenuModes } from '../../constants';
import type { AppRuntimeInfo, AppUpdateCheckState, GeneralSettings } from '../../types';
import type { GeneralSettingsUpdate } from '../../hooks/useAppSettings';
import { permissionLabel } from '../../lib/ui-labels';
import { defaultGeneralSettings } from '../../hooks/useAppSettings';
import { cloneDefaultWorkbenchIgnorePatterns } from '../../lib/review-ignore-patterns';
import { openExternalUrl } from '../../lib/markdown-link';
import {
  checkForAppUpdate,
  getAppRuntimeInfo,
  installAppUpdate,
  type AppUpdateInfo,
} from '../../lib/settings-runtime';
import { SegmentedControl, SettingsGroup, SettingsRow } from './SettingsControls';

type BasicSettingsSectionProps = {
  general: GeneralSettings;
  onUpdateGeneral: (update: GeneralSettingsUpdate) => void | Promise<void>;
};

export function BasicSettingsSection({ general, onUpdateGeneral }: BasicSettingsSectionProps) {
  const recommendedIgnorePatterns = useMemo(() => cloneDefaultWorkbenchIgnorePatterns(), []);
  const resolvedGeneral: GeneralSettings = {
    restoreLastSelectionOnLaunch:
      general.restoreLastSelectionOnLaunch ?? defaultGeneralSettings.restoreLastSelectionOnLaunch,
    autoRefreshGitStatus: general.autoRefreshGitStatus ?? defaultGeneralSettings.autoRefreshGitStatus,
    enableThreadSystemNotifications:
      general.enableThreadSystemNotifications ?? defaultGeneralSettings.enableThreadSystemNotifications,
    autoGuideQueuedPrompts: general.autoGuideQueuedPrompts ?? defaultGeneralSettings.autoGuideQueuedPrompts,
    autoCheckAppUpdate: general.autoCheckAppUpdate ?? defaultGeneralSettings.autoCheckAppUpdate,
    showDebugButton: general.showDebugButton ?? defaultGeneralSettings.showDebugButton,
    collapseIntermediateProcess:
      general.collapseIntermediateProcess ?? defaultGeneralSettings.collapseIntermediateProcess,
    defaultPermissionMode: general.defaultPermissionMode ?? defaultGeneralSettings.defaultPermissionMode,
    reviewHideNoiseFilesByDefault:
      general.reviewHideNoiseFilesByDefault ?? defaultGeneralSettings.reviewHideNoiseFilesByDefault,
    reviewDefaultDisplayMode:
      general.reviewDefaultDisplayMode ?? defaultGeneralSettings.reviewDefaultDisplayMode,
    reviewNoisePatterns: Array.isArray(general.reviewNoisePatterns)
      ? general.reviewNoisePatterns
      : recommendedIgnorePatterns,
    reviewIgnorePatternsCustomized:
      general.reviewIgnorePatternsCustomized ?? defaultGeneralSettings.reviewIgnorePatternsCustomized,
  };
  const recommendedNoisePatternsDraft = useMemo(
    () => formatReviewNoisePatterns(recommendedIgnorePatterns),
    [recommendedIgnorePatterns],
  );
  const [noisePatternsDraft, setNoisePatternsDraft] = useState(() =>
    formatReviewNoisePatterns(resolvedGeneral.reviewNoisePatterns),
  );
  const savedNoisePatternsDraft = useMemo(
    () => formatReviewNoisePatterns(resolvedGeneral.reviewNoisePatterns),
    [resolvedGeneral.reviewNoisePatterns],
  );
  const noisePatternsDirty = noisePatternsDraft !== savedNoisePatternsDraft;
  const [runtimeInfo, setRuntimeInfo] = useState<AppRuntimeInfo | null>(null);
  const [runtimeInfoLoading, setRuntimeInfoLoading] = useState(true);
  const [updateCheckState, setUpdateCheckState] = useState<AppUpdateCheckState>('idle');
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [updateInstallMessage, setUpdateInstallMessage] = useState<string | null>(null);
  const updateInstalling = updateCheckState === 'installing';

  useEffect(() => {
    setNoisePatternsDraft(savedNoisePatternsDraft);
  }, [savedNoisePatternsDraft]);

  useEffect(() => {
    let cancelled = false;

    async function loadRuntimeInfo() {
      setRuntimeInfoLoading(true);
      const nextRuntimeInfo = await getAppRuntimeInfo();
      if (!cancelled) {
        setRuntimeInfo(nextRuntimeInfo);
        setRuntimeInfoLoading(false);
      }
    }

    void loadRuntimeInfo();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!resolvedGeneral.autoCheckAppUpdate) {
      return;
    }

    let cancelled = false;

    async function runAutoCheck() {
      setUpdateInstallMessage(null);
      setUpdateCheckState('checking');
      const result = await checkForAppUpdate({ silent: true });
      if (cancelled) {
        return;
      }

      setUpdateInfo(result);
      setUpdateCheckState(resolveUpdateCheckState(result));
    }

    void runAutoCheck();
    return () => {
      cancelled = true;
    };
  }, [resolvedGeneral.autoCheckAppUpdate]);

  function saveReviewNoisePatterns() {
    const nextPatterns = parseReviewNoisePatterns(noisePatternsDraft);
    const useRecommendedPatterns = areReviewIgnorePatternsEqual(nextPatterns, recommendedIgnorePatterns);
    void onUpdateGeneral({
      reviewNoisePatterns: nextPatterns,
      reviewIgnorePatternsCustomized: !useRecommendedPatterns,
    });
  }

  async function handleCheckAppUpdate() {
    setUpdateInstallMessage(null);
    setUpdateCheckState('checking');
    const result = await checkForAppUpdate();
    setUpdateInfo(result);
    setUpdateCheckState(resolveUpdateCheckState(result));
  }

  async function handleInstallAppUpdate() {
    const update = updateInfo?.update;
    if (!update) {
      return;
    }

    setUpdateCheckState('installing');
    setUpdateInstallMessage('正在准备更新...');
    try {
      await installAppUpdate(update, setUpdateInstallMessage);
    } catch (error) {
      setUpdateInfo({
        status: 'failed',
        message: error instanceof Error ? error.message : '安装更新失败',
      });
      setUpdateCheckState('failed');
    }
  }

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>基础设置</h1>
      </header>

      <div className="settings-panel">
        <SettingsRow icon={History} title="恢复上次选择" description="启动时自动回到上次打开的项目和聊天">
          <Toggle
            checked={resolvedGeneral.restoreLastSelectionOnLaunch}
            onChange={(restoreLastSelectionOnLaunch) => void onUpdateGeneral({ restoreLastSelectionOnLaunch })}
            label="恢复上次选择"
          />
        </SettingsRow>

        <SettingsRow icon={GitBranch} title="自动刷新 Git 状态" description="切换项目或任务结束后自动刷新分支与变更统计">
          <Toggle
            checked={resolvedGeneral.autoRefreshGitStatus}
            onChange={(autoRefreshGitStatus) => void onUpdateGeneral({ autoRefreshGitStatus })}
            label="自动刷新 Git 状态"
          />
        </SettingsRow>

        <SettingsRow icon={Bell} title="任务系统通知" description="窗口不在焦点时，在右下角提示任务完成、失败或等待确认">
          <Toggle
            checked={resolvedGeneral.enableThreadSystemNotifications}
            onChange={(enableThreadSystemNotifications) => void onUpdateGeneral({ enableThreadSystemNotifications })}
            label="任务系统通知"
          />
        </SettingsRow>

        <SettingsRow icon={Send} title="排队消息立即发送" description="运行中再次发送时，尽量立即引导当前运行；不可引导时仍保留队列">
          <Toggle
            checked={resolvedGeneral.autoGuideQueuedPrompts}
            onChange={(autoGuideQueuedPrompts) => void onUpdateGeneral({ autoGuideQueuedPrompts })}
            label="排队消息立即发送"
          />
        </SettingsRow>

        <SettingsRow icon={ListCollapse} title="收起中间过程" description="已完成的回复默认折叠 Thinking、工具调用和文件修改过程，只保留最终回复与汇总">
          <Toggle
            checked={resolvedGeneral.collapseIntermediateProcess}
            onChange={(collapseIntermediateProcess) => void onUpdateGeneral({ collapseIntermediateProcess })}
            label="收起中间过程"
          />
        </SettingsRow>

        <SettingsRow icon={Shield} title="默认权限模式" description="新聊天和未指定权限时使用的 Claude Code 权限模式">
          <select
            className="settings-select"
            value={resolvedGeneral.defaultPermissionMode}
            onChange={(event) =>
              void onUpdateGeneral({
                defaultPermissionMode: event.currentTarget.value as GeneralSettings['defaultPermissionMode'],
              })}
          >
            {permissionMenuModes.map((mode) => (
              <option key={mode} value={mode}>{permissionLabel(mode)}</option>
            ))}
          </select>
        </SettingsRow>
      </div>

      <SettingsGroup title="应用更新" insetTitle>
        <SettingsRow
          icon={Download}
          title={`当前版本 ${runtimeInfoLoading ? '读取中...' : `v${runtimeInfo?.version ?? import.meta.env.PACKAGE_VERSION ?? '0.0.0'}`}`}
          description={(
            <span className="settings-runtime-description">
              <span>{runtimeInfo ? formatRuntimeSummary(runtimeInfo) : '读取应用运行信息中'}</span>
              <span className={`settings-runtime-state settings-runtime-state-${updateCheckState}`}>
                {formatUpdateCheckState(updateCheckState, updateInfo, updateInstallMessage)}
              </span>
            </span>
          )}
        >
          <div className="settings-runtime-actions">
            <button
              type="button"
              className="settings-action-button"
              onClick={() => void handleCheckAppUpdate()}
              disabled={updateCheckState === 'checking' || updateInstalling}
            >
              <RefreshCw size={14} className={updateCheckState === 'checking' ? 'spin' : ''} />
              <span>立即检查</span>
            </button>
            {updateInfo?.status === 'available' && updateInfo.update ? (
              <button
                type="button"
                className="settings-action-button primary"
                onClick={() => void handleInstallAppUpdate()}
                disabled={updateInstalling}
              >
                {updateInstalling ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}
                <span>安装并重启</span>
              </button>
            ) : null}
          </div>
        </SettingsRow>
        <SettingsRow
          icon={ExternalLink}
          muted
          title={(
            <button
              type="button"
              className="settings-runtime-link settings-runtime-link-strong"
              onClick={() => void openExternalUrl(runtimeInfo?.repositoryUrl ?? 'https://github.com/syscryer/codem')}
            >
              <span>{runtimeInfo?.repositoryUrl ?? 'https://github.com/syscryer/codem'}</span>
            </button>
          )}
          description=""
        />
        <SettingsRow icon={RefreshCw} title="自动检查更新" description="启动时检查新版本，并在桌面安装版里提示安装更新">
          <Toggle
            checked={resolvedGeneral.autoCheckAppUpdate}
            onChange={(autoCheckAppUpdate) => void onUpdateGeneral({ autoCheckAppUpdate })}
            label="自动检查更新"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Git 审查" insetTitle>
        <SettingsRow icon={GitPullRequest} title="默认隐藏忽略文件" description="审查页默认隐藏命中忽略规则的未跟踪文件">
          <Toggle
            checked={resolvedGeneral.reviewHideNoiseFilesByDefault}
            onChange={(reviewHideNoiseFilesByDefault) => void onUpdateGeneral({ reviewHideNoiseFilesByDefault })}
            label="默认隐藏忽略文件"
          />
        </SettingsRow>

        <SettingsRow icon={Rows3} title="默认展示方式" description="控制审查页初始按目录还是平铺展示变更文件">
          <SegmentedControl<GeneralSettings['reviewDefaultDisplayMode']>
            value={resolvedGeneral.reviewDefaultDisplayMode}
            options={[
              { value: 'tree', label: '目录' },
              { value: 'flat', label: '平铺' },
            ]}
            onChange={(reviewDefaultDisplayMode) => void onUpdateGeneral({ reviewDefaultDisplayMode })}
          />
        </SettingsRow>

        <SettingsRow
          icon={Search}
          title="忽略规则"
          description="推荐默认规则会作为初始值，你可以直接删改，一行一条支持目录名、文件名或简单 glob"
          stack
        >
          <div className="settings-ignore-editor">
            <div className="settings-ignore-editor-head">
              <span className="settings-ignore-editor-badge">推荐默认规则可编辑</span>
              <span className="settings-ignore-editor-meta">
                例如：.idea、logs、*.log、cache/**
              </span>
            </div>
            <textarea
              className="settings-textarea settings-ignore-editor-textarea"
              value={noisePatternsDraft}
              placeholder={recommendedNoisePatternsDraft}
              spellCheck={false}
              onChange={(event) => setNoisePatternsDraft(event.currentTarget.value)}
            />
            <div className="settings-ignore-editor-actions">
              <div className="settings-ignore-editor-meta">
                清空并保存后，将不再自动忽略任何文件。
              </div>
              <div className="settings-editor-actions">
                <button
                  type="button"
                  className="settings-action-button"
                  onClick={() => setNoisePatternsDraft(recommendedNoisePatternsDraft)}
                >
                  <span>恢复默认</span>
                </button>
                <button
                  type="button"
                  className="settings-action-button"
                  disabled={!noisePatternsDirty}
                  onClick={() => setNoisePatternsDraft(savedNoisePatternsDraft)}
                >
                  <span>撤销修改</span>
                </button>
                <button
                  type="button"
                  className="settings-action-button primary"
                  disabled={!noisePatternsDirty}
                  onClick={saveReviewNoisePatterns}
                >
                  <span>保存</span>
                </button>
              </div>
            </div>
          </div>
        </SettingsRow>
      </SettingsGroup>

      <div className="settings-panel settings-panel-spaced">
        <SettingsRow icon={RotateCcw} title="重置基础设置" description="恢复基础设置默认值">
          <button
            type="button"
            className="settings-action-button"
            onClick={() => void onUpdateGeneral(defaultGeneralSettings)}
          >
            <RotateCcw size={14} />
            <span>重置</span>
          </button>
        </SettingsRow>
      </div>
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="settings-toggle" aria-label={label}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span aria-hidden="true" />
    </label>
  );
}

function formatReviewNoisePatterns(patterns?: string[]) {
  return Array.isArray(patterns) ? patterns.join('\n') : '';
}

function parseReviewNoisePatterns(value: string) {
  const seen = new Set<string>();
  const patterns: string[] = [];

  value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      if (!seen.has(item)) {
        seen.add(item);
        patterns.push(item);
      }
    });

  return patterns;
}

function areReviewIgnorePatternsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((pattern, index) => pattern === right[index]);
}

function resolveUpdateCheckState(updateInfo: AppUpdateInfo | null): AppUpdateCheckState {
  if (!updateInfo) {
    return 'latest';
  }
  if (updateInfo.status === 'available') {
    return 'available';
  }
  if (updateInfo.status === 'unsupported') {
    return 'unsupported';
  }
  if (updateInfo.status === 'failed') {
    return 'failed';
  }
  return 'latest';
}

function formatUpdateCheckState(
  state: AppUpdateCheckState,
  updateInfo: AppUpdateInfo | null,
  installMessage?: string | null,
) {
  if (state === 'checking') {
    return '检查中...';
  }
  if (state === 'installing') {
    return installMessage ?? '正在安装更新...';
  }
  if (state === 'available') {
    return updateInfo?.version ? `发现新版本 ${updateInfo.version}` : '发现新版本';
  }
  if (state === 'failed') {
    return updateInfo?.message ?? '检查失败';
  }
  if (state === 'unsupported') {
    return updateInfo?.message ?? '当前环境不支持';
  }
  return '已是最新';
}

function formatDistributionMode(mode: AppRuntimeInfo['distributionMode']) {
  if (mode === 'desktop-nsis') {
    return '桌面安装版';
  }
  if (mode === 'desktop-portable') {
    return '桌面绿色版';
  }
  return 'Web 版';
}

function formatRuntimeSummary(info: AppRuntimeInfo) {
  const mode = formatDistributionMode(info.distributionMode);
  if (info.distributionMode !== 'desktop-nsis') {
    return mode;
  }
  if (info.runtimeFlavor === 'rust') {
    return `${mode} · Rust 后端`;
  }
  return mode;
}
