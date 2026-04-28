import { Bug, GitBranch, History, RotateCcw, Shield } from 'lucide-react';
import { permissionMenuModes } from '../../constants';
import type { GeneralSettings } from '../../types';
import type { GeneralSettingsUpdate } from '../../hooks/useAppSettings';
import { permissionLabel } from '../../lib/ui-labels';
import { defaultGeneralSettings } from '../../hooks/useAppSettings';
import { SettingsRow } from './SettingsControls';

type BasicSettingsSectionProps = {
  general: GeneralSettings;
  onUpdateGeneral: (update: GeneralSettingsUpdate) => void | Promise<void>;
};

export function BasicSettingsSection({ general, onUpdateGeneral }: BasicSettingsSectionProps) {
  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>基础设置</h1>
      </header>

      <div className="settings-panel">
        <SettingsRow icon={History} title="恢复上次选择" description="启动时自动回到上次打开的项目和聊天">
          <Toggle
            checked={general.restoreLastSelectionOnLaunch}
            onChange={(restoreLastSelectionOnLaunch) => void onUpdateGeneral({ restoreLastSelectionOnLaunch })}
            label="恢复上次选择"
          />
        </SettingsRow>

        <SettingsRow icon={GitBranch} title="自动刷新 Git 状态" description="切换项目或任务结束后自动刷新分支与变更统计">
          <Toggle
            checked={general.autoRefreshGitStatus}
            onChange={(autoRefreshGitStatus) => void onUpdateGeneral({ autoRefreshGitStatus })}
            label="自动刷新 Git 状态"
          />
        </SettingsRow>

        <SettingsRow icon={Bug} title="显示调试入口" description="在顶部工具栏显示调试日志按钮">
          <Toggle
            checked={general.showDebugButton}
            onChange={(showDebugButton) => void onUpdateGeneral({ showDebugButton })}
            label="显示调试入口"
          />
        </SettingsRow>

        <SettingsRow icon={Shield} title="默认权限模式" description="新聊天和未指定权限时使用的 Claude Code 权限模式">
          <select
            className="settings-select"
            value={general.defaultPermissionMode}
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
