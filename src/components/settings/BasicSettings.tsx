import { GitBranch, GitPullRequest, History, RotateCcw, Rows3, Search, Shield } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { permissionMenuModes } from '../../constants';
import type { GeneralSettings } from '../../types';
import type { GeneralSettingsUpdate } from '../../hooks/useAppSettings';
import { permissionLabel } from '../../lib/ui-labels';
import { defaultGeneralSettings } from '../../hooks/useAppSettings';
import { cloneDefaultWorkbenchIgnorePatterns } from '../../lib/review-ignore-patterns';
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
    showDebugButton: general.showDebugButton ?? defaultGeneralSettings.showDebugButton,
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

  useEffect(() => {
    setNoisePatternsDraft(savedNoisePatternsDraft);
  }, [savedNoisePatternsDraft]);

  function saveReviewNoisePatterns() {
    const nextPatterns = parseReviewNoisePatterns(noisePatternsDraft);
    const useRecommendedPatterns = areReviewIgnorePatternsEqual(nextPatterns, recommendedIgnorePatterns);
    void onUpdateGeneral({
      reviewNoisePatterns: nextPatterns,
      reviewIgnorePatternsCustomized: !useRecommendedPatterns,
    });
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

      <SettingsGroup title="Git 审查">
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
