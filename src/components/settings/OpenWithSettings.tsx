import { AppWindow, Code2, FileTerminal, RotateCcw } from 'lucide-react';
import type { OpenWithSettings, OpenWithTarget } from '../../types';
import type { OpenWithSettingsUpdate } from '../../hooks/useAppSettings';
import { defaultOpenWithSettings } from '../../hooks/useAppSettings';
import { SegmentedControl, SettingsRow } from './SettingsControls';

type OpenWithSettingsSectionProps = {
  openWith: OpenWithSettings;
  onUpdateOpenWith: (update: OpenWithSettingsUpdate) => void | Promise<void>;
};

export function OpenWithSettingsSection({
  openWith,
  onUpdateOpenWith,
}: OpenWithSettingsSectionProps) {
  function update(next: Partial<OpenWithSettings>) {
    void onUpdateOpenWith(next);
  }

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>打开方式</h1>
      </header>

      <div className="settings-panel">
        <SettingsRow icon={AppWindow} title="项目打开方式" description="控制标题栏编辑器按钮使用的应用">
          <SegmentedControl<OpenWithTarget>
            value={openWith.target}
            options={[
              { value: 'auto', label: '自动' },
              { value: 'cursor', label: 'Cursor' },
              { value: 'vscode', label: 'VS Code' },
              { value: 'custom', label: '自定义' },
            ]}
            onChange={(target) => update({ target })}
          />
        </SettingsRow>

        <div className="settings-row settings-row-stack">
          <div className="settings-row-label">
            <FileTerminal size={15} />
            <span>
              <strong>自定义命令</strong>
              <small>仅在选择自定义时使用，项目路径会作为最后一个参数传入</small>
            </span>
          </div>
          <div className="settings-inline-form settings-open-with-form">
            <input
              className="settings-input"
              value={openWith.customCommand}
              onChange={(event) => update({ customCommand: event.target.value })}
              placeholder="C:\\Program Files\\Editor\\editor.exe"
              disabled={openWith.target !== 'custom'}
            />
            <input
              className="settings-input"
              value={openWith.customArgs}
              onChange={(event) => update({ customArgs: event.target.value })}
              placeholder="可选参数，例如 --reuse-window"
              disabled={openWith.target !== 'custom'}
            />
          </div>
        </div>

        <SettingsRow icon={Code2} title="当前策略" description="自动模式优先使用 CODEM_EDITOR、VISUAL、EDITOR，然后查找 Cursor 和 VS Code">
          <span className="settings-inline-value">{describeOpenWith(openWith)}</span>
        </SettingsRow>

        <SettingsRow icon={RotateCcw} title="重置打开方式" description="恢复自动查找编辑器">
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

function describeOpenWith(openWith: OpenWithSettings) {
  if (openWith.target === 'cursor') {
    return '固定使用 Cursor';
  }
  if (openWith.target === 'vscode') {
    return '固定使用 VS Code';
  }
  if (openWith.target === 'custom') {
    return openWith.customCommand || '自定义命令未填写';
  }
  return '自动查找可用编辑器';
}
