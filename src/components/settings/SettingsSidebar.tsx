import {
  AppWindow,
  BarChart3,
  Bot,
  Braces,
  Command,
  Keyboard,
  MessageSquareText,
  Palette,
  RotateCcw,
  Server,
  Settings,
  Puzzle,
  TreePine,
} from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { SettingsSection } from '../../types';

type SettingsSidebarProps = {
  activeSection: SettingsSection;
  onSelectSection: (section: SettingsSection) => void;
  sidebarCustomWidth?: number;
  onUpdateSidebarCustomWidth?: (width: number | undefined) => void;
  onReturnWorkspace: () => void;
  returnLabel?: string;
};

const settingsSections: Array<{ id: SettingsSection; label: string; icon: typeof Settings }> = [
  { id: 'basic', label: '基础设置', icon: Settings },
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'shortcuts', label: '快捷键', icon: Keyboard },
  { id: 'providers', label: 'Agent 与模型', icon: Bot },
  { id: 'aiProviders', label: '普通聊天', icon: MessageSquareText },
  { id: 'usage', label: '使用情况', icon: BarChart3 },
  { id: 'sessions', label: '会话管理', icon: MessageSquareText },
  { id: 'worktree', label: '工作树', icon: TreePine },
  { id: 'mcp', label: 'MCP 管理', icon: Server },
  { id: 'plugins', label: '插件与技能', icon: Puzzle },
  { id: 'globalPrompts', label: '全局规则', icon: Braces },
  { id: 'openWith', label: '打开方式', icon: AppWindow },
];

export function SettingsSidebar({
  activeSection,
  onSelectSection,
  sidebarCustomWidth,
  onUpdateSidebarCustomWidth,
  onReturnWorkspace,
  returnLabel = '返回工作区',
}: SettingsSidebarProps) {
  function handleSidebarResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!onUpdateSidebarCustomWidth) {
      return;
    }

    event.preventDefault();
    const sidebarElement = (event.currentTarget.parentElement as HTMLElement | null) ?? null;
    const startX = event.clientX;
    const startWidth = sidebarElement?.getBoundingClientRect().width
      ?? sidebarCustomWidth
      ?? 300;
    const root = document.querySelector<HTMLElement>('.codex-desktop');

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    let latest = startWidth;

    function clampWidth(width: number) {
      return Math.round(Math.min(480, Math.max(220, width)));
    }

    function handlePointerMove(moveEvent: PointerEvent) {
      const next = clampWidth(startWidth + (moveEvent.clientX - startX));
      latest = next;
      if (root) {
        root.style.setProperty('--sidebar-width', `${next}px`);
      }
    }

    function handlePointerUp() {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      onUpdateSidebarCustomWidth?.(latest);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  function handleSidebarResizeDoubleClick() {
    if (!onUpdateSidebarCustomWidth) {
      return;
    }

    const root = document.querySelector<HTMLElement>('.codex-desktop');
    root?.style.removeProperty('--sidebar-width');
    onUpdateSidebarCustomWidth(undefined);
  }

  return (
    <aside className="settings-sidebar app-sidebar">
      <button type="button" className="settings-return" onClick={onReturnWorkspace}>
        <RotateCcw size={16} />
        <span>{returnLabel}</span>
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
              <Icon size={17} />
              <span>{section.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="settings-sidebar-foot">
        <Command size={13} />
        <span>CodeM 设置</span>
      </div>
      {onUpdateSidebarCustomWidth ? (
        <div
          className="app-sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调整侧边栏宽度，双击恢复默认"
          onPointerDown={handleSidebarResizePointerDown}
          onDoubleClick={handleSidebarResizeDoubleClick}
        />
      ) : null}
    </aside>
  );
}
