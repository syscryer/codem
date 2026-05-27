import { ArrowLeft, ArrowRight, Check, Minus, PanelLeft, Square, X } from 'lucide-react';
import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { getWindowMaterialLabel, isTauriRuntime } from '../lib/window-material';
import { ChatHeaderActions } from './ChatHeader';
import { PopoverPortal } from './PopoverPortal';
import type { DesktopPlatform, OpenAppTarget, ProjectSummary, ThreadDetail, WindowMaterialMode } from '../types';

type AppMenuId = 'file' | 'edit' | 'view' | 'window' | 'help';

type AppMenubarProps = {
  platform: DesktopPlatform;
  activeProject: ProjectSummary | null;
  activeThread: ThreadDetail | null;
  isNewChatDraft: boolean;
  sidebarVisible: boolean;
  windowMaterial: WindowMaterialMode;
  supportedWindowMaterials: WindowMaterialMode[];
  openTargets: OpenAppTarget[];
  selectedOpenTargetId: string;
  runAvailable: boolean;
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  onToggleSidebar: () => void;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  onNewChat: () => void | Promise<void>;
  onOpenFolder: () => void | Promise<void>;
  onOpenCloneDialog: () => void;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  onRunLaunchScript: (command: string) => void;
  onOpenTarget: (targetId?: string) => void;
  onSelectOpenTarget: (targetId: string) => void;
  onOpenFilesWorkbench: () => void;
  onOpenGitCommit: () => void;
  onOpenGitPush: () => void;
  onOpenGitBranch: () => void;
  onOpenGitHistory: () => void;
  onGitFetch: () => void;
  onGitPull: () => void;
  terminalDockOpen: boolean;
  onToggleTerminalDock: () => void;
  terminalDockAvailable: boolean;
  rightWorkbenchOpen: boolean;
  onToggleRightWorkbench: () => void;
  onOpenReviewWorkbench: () => void;
  onSelectWindowMaterial: (material: WindowMaterialMode) => void;
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

const defaultShortcutLabels = {
  newChat: 'Ctrl+N',
  openFolder: 'Ctrl+O',
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Y',
  cut: 'Ctrl+X',
  copy: 'Ctrl+C',
  paste: 'Ctrl+V',
  selectAll: 'Ctrl+A',
  toggleSidebar: 'Ctrl+B',
  search: 'Ctrl+G',
  reload: 'Ctrl+R',
  fullscreen: 'F11',
  closeWindow: 'Ctrl+W',
};

const macShortcutLabels = {
  newChat: 'Cmd+N',
  openFolder: 'Cmd+O',
  undo: 'Cmd+Z',
  redo: 'Shift+Cmd+Z',
  cut: 'Cmd+X',
  copy: 'Cmd+C',
  paste: 'Cmd+V',
  selectAll: 'Cmd+A',
  toggleSidebar: 'Cmd+B',
  search: 'Cmd+G',
  reload: 'Cmd+R',
  fullscreen: 'Ctrl+Cmd+F',
  closeWindow: 'Cmd+W',
};

export function AppMenubar({
  platform,
  activeProject,
  activeThread,
  isNewChatDraft,
  sidebarVisible,
  windowMaterial,
  supportedWindowMaterials,
  openTargets,
  selectedOpenTargetId,
  runAvailable,
  canNavigateBack,
  canNavigateForward,
  onToggleSidebar,
  onNavigateBack,
  onNavigateForward,
  onNewChat,
  onOpenFolder,
  onOpenCloneDialog,
  onOpenSettings,
  onOpenSearch,
  onRunLaunchScript,
  onOpenTarget,
  onSelectOpenTarget,
  onOpenFilesWorkbench,
  onOpenGitCommit,
  onOpenGitPush,
  onOpenGitBranch,
  onOpenGitHistory,
  onGitFetch,
  onGitPull,
  terminalDockOpen,
  onToggleTerminalDock,
  terminalDockAvailable,
  rightWorkbenchOpen,
  onToggleRightWorkbench,
  onOpenReviewWorkbench,
  onSelectWindowMaterial,
  onShowAbout,
  onShowShortcuts,
  onUnsupportedWindowAction,
}: AppMenubarProps) {
  const [openMenu, setOpenMenu] = useState<AppMenuId | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useOutsideDismiss({
    selectors: [{ selector: '.desktop-menu-popover', onDismiss: () => setOpenMenu(null), anchorRefs: [triggerRef] }],
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

  function handleMaterialAction(material: WindowMaterialMode) {
    onSelectWindowMaterial(material);
  }

  const isMacos = platform === 'macos';
  const showWindowMaterialMenu = supportedWindowMaterials.length > 1;
  const shortcutLabels = isMacos ? macShortcutLabels : defaultShortcutLabels;
  const title = activeThread?.title ?? (isNewChatDraft ? '新建聊天' : activeProject?.name ?? 'CodeM');
  const subtitle =
    activeThread && activeProject
      ? activeProject.name
      : isNewChatDraft
        ? activeProject?.name ? `在 ${activeProject.name} 中创建会话` : '创建新会话'
        : activeThread
          ? '当前会话'
          : activeProject?.path ?? '工作区';
  const navIconSize = isMacos ? 15 : 13;

  const navigation = (
    <div className="window-nav">
      <button type="button" aria-label={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'} onClick={onToggleSidebar}>
        <PanelLeft size={navIconSize} />
      </button>
      <button type="button" aria-label="后退" disabled={!canNavigateBack} onClick={onNavigateBack}>
        <ArrowLeft size={navIconSize} />
      </button>
      <button type="button" aria-label="前进" disabled={!canNavigateForward} onClick={onNavigateForward}>
        <ArrowRight size={navIconSize} />
      </button>
    </div>
  );

  const menu = (
    <nav className="desktop-menu" aria-label="应用菜单">
      {(['file', 'edit', 'view', 'window', 'help'] as const).map((menuId) => (
        <div key={menuId} className="desktop-menu-group">
          <button
            type="button"
            className={`desktop-menu-trigger${openMenu === menuId ? ' active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={openMenu === menuId}
            ref={openMenu === menuId ? triggerRef : undefined}
            onClick={() => setOpenMenu((current) => current === menuId ? null : menuId)}
          >
            {menuLabels[menuId]}
          </button>
          {openMenu === menuId ? (
            <PopoverPortal open anchorRef={triggerRef} placement="bottom-start" offset={6}>
              <div className="desktop-menu-popover" role="menu">
                {menuId === 'file' ? (
                  <>
                    <MenuItem label="新建聊天" shortcut={shortcutLabels.newChat} onSelect={() => runAction(onNewChat)} />
                    <MenuItem label="打开项目文件夹..." shortcut={shortcutLabels.openFolder} onSelect={() => runAction(onOpenFolder)} />
                    <MenuItem label="克隆仓库..." onSelect={() => runAction(onOpenCloneDialog)} />
                    <MenuSeparator />
                    <MenuItem label="设置..." onSelect={() => runAction(onOpenSettings)} />
                    <MenuSeparator />
                    <MenuItem label="退出" onSelect={() => runAction(() => onUnsupportedWindowAction('退出'))} />
                  </>
                ) : null}

                {menuId === 'edit' ? (
                  <>
                    <MenuItem label="撤销" shortcut={shortcutLabels.undo} onSelect={() => runAction(() => executeEditCommand('undo'))} />
                    <MenuItem label="重做" shortcut={shortcutLabels.redo} onSelect={() => runAction(() => executeEditCommand('redo'))} />
                    <MenuSeparator />
                    <MenuItem label="剪切" shortcut={shortcutLabels.cut} onSelect={() => runAction(() => executeEditCommand('cut'))} />
                    <MenuItem label="复制" shortcut={shortcutLabels.copy} onSelect={() => runAction(() => executeEditCommand('copy'))} />
                    <MenuItem label="粘贴" shortcut={shortcutLabels.paste} onSelect={() => runAction(() => executeEditCommand('paste'))} />
                    <MenuItem label="删除" onSelect={() => runAction(() => executeEditCommand('delete'))} />
                    <MenuSeparator />
                    <MenuItem label="全选" shortcut={shortcutLabels.selectAll} onSelect={() => runAction(() => executeEditCommand('selectAll'))} />
                  </>
                ) : null}

                {menuId === 'view' ? (
                  <>
                    <MenuItem label={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'} shortcut={shortcutLabels.toggleSidebar} onSelect={() => runAction(onToggleSidebar)} />
                    <MenuItem label="搜索" shortcut={shortcutLabels.search} onSelect={() => runAction(onOpenSearch)} />
                    <MenuSeparator />
                    <MenuItem label="重新加载页面" shortcut={shortcutLabels.reload} onSelect={() => runAction(() => window.location.reload())} />
                    <MenuItem label="切换全屏" shortcut={shortcutLabels.fullscreen} onSelect={() => runAction(toggleFullscreen)} />
                  </>
                ) : null}

                {menuId === 'window' ? (
                  <>
                    {showWindowMaterialMenu ? (
                      <>
                        {supportedWindowMaterials.map((material) => (
                          <MenuItem
                            key={material}
                            label={getWindowMaterialLabel(material)}
                            selected={windowMaterial === material}
                            onSelect={() => runAction(() => handleMaterialAction(material))}
                          />
                        ))}
                        <MenuSeparator />
                      </>
                    ) : null}
                    <MenuItem label="最小化" onSelect={() => runAction(() => handleWindowAction('minimize'))} />
                    <MenuItem label="最大化/还原" onSelect={() => runAction(() => handleWindowAction('toggleMaximize'))} />
                    <MenuItem label="关闭窗口" shortcut={shortcutLabels.closeWindow} onSelect={() => runAction(() => handleWindowAction('close'))} />
                  </>
                ) : null}

                {menuId === 'help' ? (
                  <>
                    <MenuItem label="键盘快捷键" onSelect={() => runAction(onShowShortcuts)} />
                    <MenuItem label="关于 CodeM" onSelect={() => runAction(onShowAbout)} />
                  </>
                ) : null}
              </div>
            </PopoverPortal>
          ) : null}
        </div>
      ))}
    </nav>
  );

  const windowControls = (
    <div className="window-controls">
      {isMacos ? (
        <>
          <button
            type="button"
            className="window-control window-control-close"
            aria-label="关闭窗口"
            onClick={() => void handleWindowAction('close')}
          >
            <span className="window-control-dot" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="window-control window-control-minimize"
            aria-label="最小化"
            onClick={() => void handleWindowAction('minimize')}
          >
            <span className="window-control-dot" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="window-control window-control-maximize"
            aria-label="最大化或还原"
            onClick={() => void handleWindowAction('toggleMaximize')}
          >
            <span className="window-control-dot" aria-hidden="true" />
          </button>
        </>
      ) : (
        <>
          <button type="button" aria-label="最小化" onClick={() => void handleWindowAction('minimize')}>
            <Minus size={12} />
          </button>
          <button type="button" aria-label="最大化或还原" onClick={() => void handleWindowAction('toggleMaximize')}>
            <Square size={11} />
          </button>
          <button type="button" aria-label="关闭窗口" onClick={() => void handleWindowAction('close')}>
            <X size={12} />
          </button>
        </>
      )}
    </div>
  );

  if (isMacos) {
    return (
      <header
        className="desktop-menubar is-macos"
        onDoubleClick={handleTitlebarDoubleClick}
        onPointerDown={handleDragStart}
      >
        <div className="desktop-menubar-leading">
          {navigation}
        </div>
        <div className="desktop-menubar-title">
          <strong className="desktop-menubar-title-text">{title}</strong>
          <span className="desktop-menubar-subtitle">{subtitle}</span>
        </div>
        <div className="desktop-menubar-toolbar">
          <ChatHeaderActions
            activeProject={activeProject}
            openTargets={openTargets}
            selectedOpenTargetId={selectedOpenTargetId}
            runAvailable={runAvailable}
            onRunLaunchScript={onRunLaunchScript}
            onOpenTarget={onOpenTarget}
            onSelectOpenTarget={onSelectOpenTarget}
            onOpenFilesWorkbench={onOpenFilesWorkbench}
            onOpenGitCommit={onOpenGitCommit}
            onOpenGitPush={onOpenGitPush}
            onOpenGitBranch={onOpenGitBranch}
            onOpenGitHistory={onOpenGitHistory}
            onGitFetch={onGitFetch}
            onGitPull={onGitPull}
            terminalDockOpen={terminalDockOpen}
            onToggleTerminalDock={onToggleTerminalDock}
            terminalDockAvailable={terminalDockAvailable}
            rightWorkbenchOpen={rightWorkbenchOpen}
            onToggleRightWorkbench={onToggleRightWorkbench}
            onOpenReviewWorkbench={onOpenReviewWorkbench}
            compact
          />
        </div>
      </header>
    );
  }

  return (
    <header
      className="desktop-menubar"
      onDoubleClick={handleTitlebarDoubleClick}
      onPointerDown={handleDragStart}
    >
      {navigation}
      {menu}
      <div className="window-title-spacer" />
      {windowControls}
    </header>
  );
}

function MenuItem({
  label,
  shortcut,
  selected = false,
  onSelect,
}: {
  label: string;
  shortcut?: string;
  selected?: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" className="desktop-menu-item" role="menuitem" onClick={onSelect}>
      <span>{label}</span>
      {selected ? <Check size={14} /> : null}
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
