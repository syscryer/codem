import { ArrowLeft, ArrowRight, Minus, PanelLeft, Square, X } from 'lucide-react';
import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';

type AppMenuId = 'file' | 'edit' | 'view' | 'window' | 'help';

type AppMenubarProps = {
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  onNewChat: () => void | Promise<void>;
  onOpenFolder: () => void | Promise<void>;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  onToggleDebug: () => void;
  onShowAbout: () => void;
  onShowShortcuts: () => void;
  onUnsupportedWindowAction: (action: string) => void;
};

const menuLabels: Record<AppMenuId, string> = {
  file: '文件',
  edit: '编辑',
  view: '查看',
  window: '窗口',
  help: '帮助',
};

const WINDOW_DRAG_THRESHOLD_PX = 4;

export function AppMenubar({
  sidebarVisible,
  onToggleSidebar,
  onNewChat,
  onOpenFolder,
  onOpenSettings,
  onOpenSearch,
  onToggleDebug,
  onShowAbout,
  onShowShortcuts,
  onUnsupportedWindowAction,
}: AppMenubarProps) {
  const [openMenu, setOpenMenu] = useState<AppMenuId | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useOutsideDismiss({
    refs: [{ ref: menuRef, onDismiss: () => setOpenMenu(null) }],
  });

  function runAction(action: () => void | Promise<void>) {
    setOpenMenu(null);
    void action();
  }

  function handleDragStart(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || event.detail > 1 || isInteractiveDragTarget(event.target)) {
      return;
    }

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;

    function cleanup() {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
    }

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }

      const distanceX = Math.abs(moveEvent.clientX - startX);
      const distanceY = Math.abs(moveEvent.clientY - startY);
      if (distanceX < WINDOW_DRAG_THRESHOLD_PX && distanceY < WINDOW_DRAG_THRESHOLD_PX) {
        return;
      }

      cleanup();
      void startWindowDrag();
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  }

  function handleTitlebarDoubleClick(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0 || isInteractiveDragTarget(event.target)) {
      return;
    }

    event.preventDefault();
    void handleWindowAction('toggleMaximize');
  }

  async function handleWindowAction(action: 'minimize' | 'toggleMaximize' | 'close') {
    const handled = await runTauriWindowAction(action);
    if (handled) {
      return;
    }

    const label = action === 'minimize' ? '最小化' : action === 'toggleMaximize' ? '最大化/还原' : '关闭窗口';
    onUnsupportedWindowAction(label);
  }

  async function handleMaterialAction(material: number, label: string) {
    const handled = await runTauriMaterialAction(material);
    if (handled) {
      return;
    }

    onUnsupportedWindowAction(`${label} 材质切换`);
  }

  return (
    <header
      className="desktop-menubar"
      onDoubleClick={handleTitlebarDoubleClick}
      onPointerDown={handleDragStart}
    >
      <div className="window-nav">
        <button type="button" aria-label={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'} onClick={onToggleSidebar}>
          <PanelLeft size={13} />
        </button>
        <button type="button" aria-label="后退" onClick={() => window.history.back()}>
          <ArrowLeft size={13} />
        </button>
        <button type="button" aria-label="前进" onClick={() => window.history.forward()}>
          <ArrowRight size={13} />
        </button>
      </div>

      <nav className="desktop-menu" ref={menuRef} aria-label="应用菜单">
        {(['file', 'edit', 'view', 'window', 'help'] as const).map((menuId) => (
          <div key={menuId} className="desktop-menu-group">
            <button
              type="button"
              className={`desktop-menu-trigger${openMenu === menuId ? ' active' : ''}`}
              aria-haspopup="menu"
              aria-expanded={openMenu === menuId}
              onClick={() => setOpenMenu((current) => current === menuId ? null : menuId)}
            >
              {menuLabels[menuId]}
            </button>
            {openMenu === menuId ? (
              <div className="desktop-menu-popover" role="menu">
                {menuId === 'file' ? (
                  <>
                    <MenuItem label="新建聊天" shortcut="Ctrl+N" onSelect={() => runAction(onNewChat)} />
                    <MenuItem label="打开项目文件夹..." shortcut="Ctrl+O" onSelect={() => runAction(onOpenFolder)} />
                    <MenuSeparator />
                    <MenuItem label="设置..." onSelect={() => runAction(onOpenSettings)} />
                    <MenuSeparator />
                    <MenuItem label="退出" onSelect={() => runAction(() => onUnsupportedWindowAction('退出'))} />
                  </>
                ) : null}

                {menuId === 'edit' ? (
                  <>
                    <MenuItem label="撤销" shortcut="Ctrl+Z" onSelect={() => runAction(() => executeEditCommand('undo'))} />
                    <MenuItem label="重做" shortcut="Ctrl+Y" onSelect={() => runAction(() => executeEditCommand('redo'))} />
                    <MenuSeparator />
                    <MenuItem label="剪切" shortcut="Ctrl+X" onSelect={() => runAction(() => executeEditCommand('cut'))} />
                    <MenuItem label="复制" shortcut="Ctrl+C" onSelect={() => runAction(() => executeEditCommand('copy'))} />
                    <MenuItem label="粘贴" shortcut="Ctrl+V" onSelect={() => runAction(() => executeEditCommand('paste'))} />
                    <MenuItem label="删除" onSelect={() => runAction(() => executeEditCommand('delete'))} />
                    <MenuSeparator />
                    <MenuItem label="全选" shortcut="Ctrl+A" onSelect={() => runAction(() => executeEditCommand('selectAll'))} />
                  </>
                ) : null}

                {menuId === 'view' ? (
                  <>
                    <MenuItem label={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'} shortcut="Ctrl+B" onSelect={() => runAction(onToggleSidebar)} />
                    <MenuItem label="搜索" shortcut="Ctrl+G" onSelect={() => runAction(onOpenSearch)} />
                    <MenuItem label="调试面板" onSelect={() => runAction(onToggleDebug)} />
                    <MenuSeparator />
                    <MenuItem label="重新加载页面" shortcut="Ctrl+R" onSelect={() => runAction(() => window.location.reload())} />
                    <MenuItem label="切换全屏" shortcut="F11" onSelect={() => runAction(toggleFullscreen)} />
                  </>
                ) : null}

                {menuId === 'window' ? (
                  <>
                    <MenuItem label="自动材质" onSelect={() => runAction(() => handleMaterialAction(0, '自动材质'))} />
                    <MenuItem label="Mica" onSelect={() => runAction(() => handleMaterialAction(2, 'Mica'))} />
                    <MenuItem label="Acrylic" onSelect={() => runAction(() => handleMaterialAction(3, 'Acrylic'))} />
                    <MenuItem label="Mica Alt" onSelect={() => runAction(() => handleMaterialAction(4, 'Mica Alt'))} />
                    <MenuSeparator />
                    <MenuItem label="最小化" onSelect={() => runAction(() => handleWindowAction('minimize'))} />
                    <MenuItem label="最大化/还原" onSelect={() => runAction(() => handleWindowAction('toggleMaximize'))} />
                    <MenuItem label="关闭窗口" shortcut="Ctrl+W" onSelect={() => runAction(() => handleWindowAction('close'))} />
                  </>
                ) : null}

                {menuId === 'help' ? (
                  <>
                    <MenuItem label="键盘快捷键" onSelect={() => runAction(onShowShortcuts)} />
                    <MenuItem label="关于 CodeM" onSelect={() => runAction(onShowAbout)} />
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </nav>

      <div className="window-title-spacer" />

      <div className="window-controls">
        <button type="button" aria-label="最小化" onClick={() => void handleWindowAction('minimize')}>
          <Minus size={12} />
        </button>
        <button type="button" aria-label="最大化或还原" onClick={() => void handleWindowAction('toggleMaximize')}>
          <Square size={11} />
        </button>
        <button type="button" aria-label="关闭窗口" onClick={() => void handleWindowAction('close')}>
          <X size={12} />
        </button>
      </div>
    </header>
  );
}

function MenuItem({
  label,
  shortcut,
  onSelect,
}: {
  label: string;
  shortcut?: string;
  onSelect: () => void;
}) {
  return (
    <button type="button" className="desktop-menu-item" role="menuitem" onClick={onSelect}>
      <span>{label}</span>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </button>
  );
}

function MenuSeparator() {
  return <div className="desktop-menu-separator" role="separator" />;
}

function executeEditCommand(command: string) {
  document.execCommand(command);
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    void document.exitFullscreen();
    return;
  }

  void document.documentElement.requestFullscreen();
}

function isInteractiveDragTarget(target: EventTarget) {
  return target instanceof Element && Boolean(target.closest('button, input, textarea, select, a, [role="menu"], .desktop-menu-popover'));
}

async function startWindowDrag() {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startDragging();
  } catch {
    // Web mode keeps the same menu UI but cannot move a native window.
  }
}

async function runTauriWindowAction(action: 'minimize' | 'toggleMaximize' | 'close') {
  if (!isTauriRuntime()) {
    return false;
  }

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const currentWindow = getCurrentWindow();
    if (action === 'minimize') {
      await currentWindow.minimize();
    } else if (action === 'toggleMaximize') {
      await currentWindow.toggleMaximize();
    } else {
      await currentWindow.close();
    }
    return true;
  } catch {
    return false;
  }
}

async function runTauriMaterialAction(material: number) {
  if (!isTauriRuntime()) {
    return false;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_window_material', { material });
    return true;
  } catch {
    return false;
  }
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
