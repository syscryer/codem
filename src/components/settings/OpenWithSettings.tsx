import { AppWindow, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { OpenAppTarget, OpenWithSettings } from '../../types';
import type { OpenWithSettingsUpdate } from '../../hooks/useAppSettings';
import { defaultOpenWithSettings } from '../../hooks/useAppSettings';
import { getOpenAppIcon } from '../../lib/open-app-icons';
import { SettingsRow } from './SettingsControls';

type OpenWithSettingsSectionProps = {
  openWith: OpenWithSettings;
  openTargets: OpenAppTarget[];
  onUpdateOpenWith: (update: OpenWithSettingsUpdate) => void | Promise<void>;
};

export function OpenWithSettingsSection({
  openWith,
  openTargets,
  onUpdateOpenWith,
}: OpenWithSettingsSectionProps) {
  const [customLabel, setCustomLabel] = useState('');
  const [customCommand, setCustomCommand] = useState('');
  const [customArgs, setCustomArgs] = useState('');
  const selectedTarget = openTargets.find((target) => target.id === openWith.selectedTargetId) ?? openTargets[0];

  function addCustomTarget() {
    const command = customCommand.trim();
    if (!command) {
      return;
    }

    const label = customLabel.trim() || command;
    const id = `custom-${sanitizeTargetId(label) || Date.now()}`;
    void onUpdateOpenWith({
      selectedTargetId: id,
      customTargets: [
        ...openWith.customTargets.filter((target) => target.id !== id),
        {
          id,
          label,
          kind: 'command',
          command,
          args: parseArgs(customArgs),
        },
      ],
    });
    setCustomLabel('');
    setCustomCommand('');
    setCustomArgs('');
  }

  function removeCustomTarget(targetId: string) {
    const nextCustomTargets = openWith.customTargets.filter((target) => target.id !== targetId);
    void onUpdateOpenWith({
      selectedTargetId:
        openWith.selectedTargetId === targetId
          ? defaultOpenWithSettings.selectedTargetId
          : openWith.selectedTargetId,
      customTargets: nextCustomTargets,
    });
  }

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>打开方式</h1>
      </header>

      <div className="settings-panel">
        <SettingsRow icon={AppWindow} title="默认打开工具" description="控制顶部工具按钮直接打开项目时使用的目标">
          <select
            className="settings-select"
            value={selectedTarget?.id ?? openWith.selectedTargetId}
            onChange={(event) => void onUpdateOpenWith({ selectedTargetId: event.target.value })}
          >
            {openTargets.map((target) => (
              <option key={target.id} value={target.id}>{target.label}</option>
            ))}
          </select>
        </SettingsRow>

        <div className="settings-row settings-row-stack">
          <div className="settings-row-label">
            <AppWindow size={15} />
            <span>
              <strong>自动识别工具</strong>
              <small>顶部下拉菜单只展示这些当前可用的工具</small>
            </span>
          </div>
          <div className="settings-open-target-list">
            {openTargets.length === 0 ? (
              <div className="settings-list-empty">未发现可用工具</div>
            ) : (
              openTargets.map((target) => (
                <div key={target.id} className="settings-open-target-row">
                  <img src={getOpenAppIcon(target.id)} alt="" aria-hidden="true" />
                  <div>
                    <strong>{target.label}</strong>
                    <small>{describeTarget(target)}</small>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="settings-row settings-row-stack">
          <div className="settings-row-label">
            <Plus size={15} />
            <span>
              <strong>自定义工具</strong>
              <small>命令会接收项目路径作为最后一个参数</small>
            </span>
          </div>
          <div className="settings-inline-form settings-open-with-form">
            <input
              className="settings-input"
              value={customLabel}
              onChange={(event) => setCustomLabel(event.target.value)}
              placeholder="显示名"
            />
            <input
              className="settings-input"
              value={customCommand}
              onChange={(event) => setCustomCommand(event.target.value)}
              placeholder="命令或 exe 路径"
            />
            <input
              className="settings-input"
              value={customArgs}
              onChange={(event) => setCustomArgs(event.target.value)}
              placeholder="可选参数"
            />
            <button type="button" className="settings-action-button" onClick={addCustomTarget}>
              <Plus size={14} />
              <span>添加</span>
            </button>
          </div>
          {openWith.customTargets.length > 0 ? (
            <div className="settings-list">
              {openWith.customTargets.map((target) => (
                <div key={target.id} className="settings-list-row">
                  <div>
                    <strong>{target.label}</strong>
                    <small>{[target.command, ...target.args].filter(Boolean).join(' ')}</small>
                  </div>
                  <button
                    type="button"
                    className="settings-icon-button"
                    title="删除"
                    aria-label={`删除 ${target.label}`}
                    onClick={() => removeCustomTarget(target.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <SettingsRow icon={RotateCcw} title="重置打开方式" description="恢复默认工具选择并清空自定义工具">
          <button
            type="button"
            className="settings-action-button"
            onClick={() => void onUpdateOpenWith(defaultOpenWithSettings)}
          >
            <RotateCcw size={14} />
            <span>重置</span>
          </button>
        </SettingsRow>
      </div>
    </section>
  );
}

function describeTarget(target: OpenAppTarget) {
  if (target.kind === 'explorer') {
    return '打开项目所在文件夹';
  }
  if (target.kind === 'terminal') {
    return target.command?.toLowerCase().endsWith('wt.exe')
      ? 'Windows Terminal 中打开项目目录'
      : '终端窗口中打开项目目录';
  }
  if (target.kind === 'git-bash') {
    return 'Git Bash 中打开项目目录';
  }
  if (target.kind === 'wsl') {
    return 'WSL 中打开项目目录';
  }
  return target.command || '打开项目目录';
}

function sanitizeTargetId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function parseArgs(value: string) {
  return value.trim() ? value.trim().split(/\s+/) : [];
}
