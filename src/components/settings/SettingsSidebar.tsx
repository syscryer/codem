import {
  AppWindow,
  BarChart3,
  Box,
  Braces,
  Command,
  Keyboard,
  MessageSquareText,
  Palette,
  RotateCcw,
  Server,
  Settings,
  Sparkles,
} from 'lucide-react';
import type { SettingsSection } from '../../types';

type SettingsSidebarProps = {
  activeSection: SettingsSection;
  onSelectSection: (section: SettingsSection) => void;
  onReturnWorkspace: () => void;
};

const settingsSections: Array<{ id: SettingsSection; label: string; icon: typeof Settings }> = [
  { id: 'basic', label: '基础设置', icon: Settings },
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'shortcuts', label: '快捷键', icon: Keyboard },
  { id: 'providers', label: '供应商管理', icon: Box },
  { id: 'usage', label: '使用情况', icon: BarChart3 },
  { id: 'sessions', label: '会话管理', icon: MessageSquareText },
  { id: 'mcp', label: 'MCP 管理', icon: Server },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'globalPrompts', label: '全局提示词', icon: Braces },
  { id: 'openWith', label: '打开方式', icon: AppWindow },
];

export function SettingsSidebar({
  activeSection,
  onSelectSection,
  onReturnWorkspace,
}: SettingsSidebarProps) {
  return (
    <aside className="settings-sidebar">
      <button type="button" className="settings-return" onClick={onReturnWorkspace}>
        <RotateCcw size={14} />
        <span>返回工作区</span>
      </button>
      <nav className="settings-nav" aria-label="设置分类">
        {settingsSections.map((section) => {
          const Icon = section.icon;
          return (
            <button
              key={section.id}
              type="button"
              className={`settings-nav-item${activeSection === section.id ? ' active' : ''}`}
              onClick={() => onSelectSection(section.id)}
            >
              <Icon size={14} />
              <span>{section.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="settings-sidebar-foot">
        <Command size={13} />
        <span>CodeM 设置</span>
      </div>
    </aside>
  );
}
