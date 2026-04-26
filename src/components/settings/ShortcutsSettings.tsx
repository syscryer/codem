import type { KeyboardEvent } from 'react';
import { Bug, Keyboard, MessageSquarePlus, RotateCcw, Search, Send } from 'lucide-react';
import type { ShortcutSettings } from '../../types';
import type { ShortcutSettingsUpdate } from '../../hooks/useAppSettings';
import { defaultShortcutSettings } from '../../hooks/useAppSettings';
import { buildShortcutValue, formatShortcut } from '../../lib/shortcuts';
import { SegmentedControl, SettingsRow } from './SettingsControls';

type ShortcutAction = 'newChat' | 'toggleSearch' | 'toggleDebug';

type ShortcutsSettingsSectionProps = {
  shortcuts: ShortcutSettings;
  onUpdateShortcuts: (update: ShortcutSettingsUpdate) => void | Promise<void>;
};

const shortcutRows: Array<{
  action: ShortcutAction;
  title: string;
  description: string;
  icon: typeof Keyboard;
}> = [
  {
    action: 'newChat',
    title: '新建聊天',
    description: '在当前项目下创建一条新聊天',
    icon: MessageSquarePlus,
  },
  {
    action: 'toggleSearch',
    title: '搜索项目和会话',
    description: '打开或聚焦左侧搜索',
    icon: Search,
  },
  {
    action: 'toggleDebug',
    title: '调试面板',
    description: '显示或隐藏当前会话的事件面板',
    icon: Bug,
  },
];

export function ShortcutsSettingsSection({
  shortcuts,
  onUpdateShortcuts,
}: ShortcutsSettingsSectionProps) {
  function captureShortcut(event: KeyboardEvent<HTMLInputElement>, action: ShortcutAction) {
    event.preventDefault();
    event.stopPropagation();

    const shortcut = buildShortcutValue(event.nativeEvent);
    if (!shortcut) {
      return;
    }

    void onUpdateShortcuts({ [action]: shortcut });
  }

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>快捷键</h1>
      </header>

      <div className="settings-panel">
        <SettingsRow icon={Send} title="发送消息" description="控制输入框中发送提示词的按键">
          <SegmentedControl<ShortcutSettings['composerSend']>
            value={shortcuts.composerSend}
            options={[
              { value: 'enter', label: 'Enter' },
              { value: 'modEnter', label: 'Ctrl+Enter' },
            ]}
            onChange={(composerSend) => void onUpdateShortcuts({ composerSend })}
          />
        </SettingsRow>

        {shortcutRows.map((row) => {
          const Icon = row.icon;
          const value = shortcuts[row.action];
          return (
            <SettingsRow
              key={row.action}
              icon={Icon}
              title={row.title}
              description={row.description}
            >
              <div className="settings-shortcut-control">
                <input
                  className="settings-input settings-shortcut-input"
                  value={formatShortcut(value)}
                  onKeyDown={(event) => captureShortcut(event, row.action)}
                  placeholder="聚焦后按下新快捷键"
                  readOnly
                  aria-label={`${row.title}快捷键`}
                />
                <button
                  type="button"
                  className="settings-action-button"
                  onClick={() => void onUpdateShortcuts({ [row.action]: null })}
                >
                  清除
                </button>
              </div>
            </SettingsRow>
          );
        })}

        <SettingsRow icon={RotateCcw} title="重置快捷键" description="恢复 CodeM 默认快捷键">
          <button
            type="button"
            className="settings-action-button"
            onClick={() => void onUpdateShortcuts(defaultShortcutSettings)}
          >
            <RotateCcw size={14} />
            <span>重置</span>
          </button>
        </SettingsRow>
      </div>
    </section>
  );
}
