import { ArrowLeft, ArrowRight, Check, Download, LoaderCircle, Minus, RefreshCw, Square, X } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { renderMarkdownLink } from '../lib/markdown-link';
import { getWindowMaterialLabel, isTauriRuntime } from '../lib/window-material';
import { BackgroundOperationCenter } from './BackgroundOperationCenter';
import { PopoverPortal } from './PopoverPortal';
import type { BackgroundOperation, DesktopPlatform, WindowMaterialMode } from '../types';

type AppMenuId = 'file' | 'edit' | 'view' | 'window' | 'help';

type AppMenubarProps = {
  platform: DesktopPlatform;
  appUpdateNotice: AppUpdateTitlebarNotice | null;
  backgroundOperations: BackgroundOperation[];
  backgroundOperationsRunningCount: number;
  backgroundOperationsUnreadFailureCount: number;
  sidebarVisible: boolean;
  windowMaterial: WindowMaterialMode;
  supportedWindowMaterials: WindowMaterialMode[];
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
  onSelectWindowMaterial: (material: WindowMaterialMode) => void;
  onShowAbout: () => void;
  onShowShortcuts: () => void;
  onUnsupportedWindowAction: (action: string) => void;
  onOpenBackgroundOperations: () => void;
  onClearCompletedBackgroundOperations: () => void;
};

type AppUpdateTitlebarNotice = {
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  phase: 'available' | 'downloading' | 'downloaded' | 'installing' | 'failed';
  message?: string;
  onAction: () => void | Promise<void>;
};

const menuLabels: Record<AppMenuId, string> = {
  file: '文件',
  edit: '编辑',
  view: '查看',
  window: '窗口',
  help: '帮助',
};

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
  appUpdateNotice,
  backgroundOperations,
  backgroundOperationsRunningCount,
  backgroundOperationsUnreadFailureCount,
  sidebarVisible,
  windowMaterial,
  supportedWindowMaterials,
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
  onSelectWindowMaterial,
  onShowAbout,
  onShowShortcuts,
  onUnsupportedWindowAction,
  onOpenBackgroundOperations,
  onClearCompletedBackgroundOperations,
}: AppMenubarProps) {
  const [openMenu, setOpenMenu] = useState<AppMenuId | null>(null);
  const [updateCardOpen, setUpdateCardOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const updateTriggerRef = useRef<HTMLButtonElement | null>(null);
  const updateCloseTimerRef = useRef<number | null>(null);
  const previousUpdatePhaseRef = useRef<AppUpdateTitlebarNotice['phase'] | null>(null);

  useOutsideDismiss({
    selectors: [
      { selector: '.desktop-menu-popover', onDismiss: () => setOpenMenu(null), anchorRefs: [triggerRef] },
      { selector: '.app-update-popover', onDismiss: () => setUpdateCardOpen(false), anchorRefs: [updateTriggerRef] },
    ],
  });

  useEffect(() => {
    return () => {
      if (updateCloseTimerRef.current !== null) {
        window.clearTimeout(updateCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (appUpdateNotice?.phase === 'downloaded' && previousUpdatePhaseRef.current !== 'downloaded') {
      openUpdateCard();
    }
    previousUpdatePhaseRef.current = appUpdateNotice?.phase ?? null;
  }, [appUpdateNotice?.phase]);

  function openUpdateCard() {
    if (updateCloseTimerRef.current !== null) {
      window.clearTimeout(updateCloseTimerRef.current);
      updateCloseTimerRef.current = null;
    }
    setUpdateCardOpen(true);
  }

  function scheduleUpdateCardClose() {
    if (updateCloseTimerRef.current !== null) {
      window.clearTimeout(updateCloseTimerRef.current);
    }
    updateCloseTimerRef.current = window.setTimeout(() => {
      updateCloseTimerRef.current = null;
      setUpdateCardOpen(false);
    }, 180);
  }

  function runAction(action: () => void | Promise<void>) {
    setOpenMenu(null);
    void action();
  }

  function handleDragStart(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || event.detail > 1 || isInteractiveDragTarget(event.target)) {
      return;
    }

    event.preventDefault();
    void startWindowDrag();
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
  const navIconSize = isMacos ? 15 : 13;

  const navigation = (
    <div className="window-nav" data-tauri-drag-region>
      <button type="button" className="window-nav-sidebar-toggle" aria-label={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'} onClick={onToggleSidebar}>
        <SidebarToggleIcon visible={sidebarVisible} />
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
                    <MenuItem label="新建任务" shortcut={shortcutLabels.newChat} onSelect={() => runAction(onNewChat)} />
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

  const updateEntry = appUpdateNotice ? (
    <div className="title-update-entry" onMouseEnter={openUpdateCard} onMouseLeave={scheduleUpdateCardClose}>
      <button
        ref={updateTriggerRef}
        type="button"
        className={`title-update-pill ${appUpdateNotice.phase}`}
        aria-label={formatUpdatePillAriaLabel(appUpdateNotice)}
        disabled={appUpdateNotice.phase === 'downloading' || appUpdateNotice.phase === 'installing'}
        onFocus={openUpdateCard}
        onClick={() => {
          openUpdateCard();
          void appUpdateNotice.onAction();
        }}
      >
        {appUpdateNotice.phase === 'downloading' || appUpdateNotice.phase === 'installing' ? (
          <LoaderCircle className="spin" size={13} />
        ) : appUpdateNotice.phase === 'failed' ? (
          <RefreshCw size={13} />
        ) : (
          <Download size={13} />
        )}
      </button>
      <PopoverPortal open={updateCardOpen} anchorRef={updateTriggerRef} placement="bottom-end" offset={8}>
        <div className="app-update-popover" onMouseEnter={openUpdateCard} onMouseLeave={scheduleUpdateCardClose}>
          <div className="app-update-popover-head">
            <strong>{appUpdateNotice.version ? `v${appUpdateNotice.version} 更新日志` : 'CodeM 更新日志'}</strong>
            <span>{formatUpdateReleaseMeta(appUpdateNotice.releaseDate)}</span>
          </div>
          <div className="app-update-popover-content markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a({ href, title, children }) {
                  return renderMarkdownLink({ href, title, children });
                },
              }}
            >
              {appUpdateNotice.releaseNotes?.trim() || '此版本包含功能改进与问题修复。'}
            </ReactMarkdown>
          </div>
          <div className="app-update-popover-footer">
            <span role="status">{formatUpdateStatusMessage(appUpdateNotice)}</span>
            <button
              type="button"
              onClick={() => void appUpdateNotice.onAction()}
              disabled={appUpdateNotice.phase === 'downloading' || appUpdateNotice.phase === 'installing'}
            >
              {appUpdateNotice.phase === 'downloading' || appUpdateNotice.phase === 'installing' ? (
                <LoaderCircle className="spin" size={14} />
              ) : appUpdateNotice.phase === 'failed' ? (
                <RefreshCw size={14} />
              ) : (
                <Download size={14} />
              )}
              <span>{formatUpdateActionLabel(appUpdateNotice.phase)}</span>
            </button>
          </div>
        </div>
      </PopoverPortal>
    </div>
  ) : null;

  if (isMacos) {
    return (
      <header
        className="desktop-menubar is-macos"
        data-tauri-drag-region
        onDoubleClick={handleTitlebarDoubleClick}
        onPointerDown={handleDragStart}
      >
        <div className="desktop-menubar-leading">
          {navigation}
        </div>
        <div className="window-title-spacer" />
        <BackgroundOperationCenter
          operations={backgroundOperations}
          runningCount={backgroundOperationsRunningCount}
          unreadFailureCount={backgroundOperationsUnreadFailureCount}
          onOpen={onOpenBackgroundOperations}
          onClearCompleted={onClearCompletedBackgroundOperations}
        />
        {updateEntry}
      </header>
    );
  }

  return (
    <header
      className="desktop-menubar"
      data-tauri-drag-region
      onDoubleClick={handleTitlebarDoubleClick}
      onPointerDown={handleDragStart}
    >
      {navigation}
      {menu}
      <div className="window-title-spacer" />
      <BackgroundOperationCenter
        operations={backgroundOperations}
        runningCount={backgroundOperationsRunningCount}
        unreadFailureCount={backgroundOperationsUnreadFailureCount}
        onOpen={onOpenBackgroundOperations}
        onClearCompleted={onClearCompletedBackgroundOperations}
      />
      {updateEntry}
      {windowControls}
    </header>
  );
}

function formatUpdatePillLabel(phase: AppUpdateTitlebarNotice['phase']) {
  if (phase === 'downloading') return '下载中';
  if (phase === 'downloaded') return '立即更新';
  if (phase === 'installing') return '安装中';
  if (phase === 'failed') return '重试更新';
  return '更新';
}

function formatUpdatePillAriaLabel(notice: AppUpdateTitlebarNotice) {
  if (notice.phase === 'available') {
    return notice.version ? `下载 CodeM v${notice.version} 更新` : '下载 CodeM 更新';
  }
  if (notice.phase === 'downloaded') {
    return notice.version ? `更新 CodeM 到 v${notice.version}` : '更新 CodeM';
  }
  return formatUpdatePillLabel(notice.phase);
}

function formatUpdateStatusMessage(notice: AppUpdateTitlebarNotice) {
  if (notice.phase === 'installing') return notice.message ?? '正在准备更新...';
  if (notice.phase === 'downloading') return notice.message ?? '正在后台下载更新...';
  if (notice.phase === 'downloaded') return notice.message ?? '更新包已下载，可以安装并重启。';
  if (notice.phase === 'failed') return notice.message ?? '更新失败，请检查网络后重试。';
  return '点击后在后台下载，不会影响当前工作';
}

function formatUpdateActionLabel(phase: AppUpdateTitlebarNotice['phase']) {
  if (phase === 'failed') return '重新尝试';
  if (phase === 'downloading') return '下载中...';
  if (phase === 'downloaded') return '安装并重启';
  if (phase === 'installing') return '安装中...';
  return '后台下载';
}

function formatUpdateReleaseMeta(value?: string) {
  if (!value) {
    return '来自 GitHub Release';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '来自 GitHub Release';
  }

  return `${new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)} · GitHub Release`;
}

function SidebarToggleIcon({ visible }: { visible: boolean }) {
  const railX = visible ? 6 : 11;

  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="13" height="13" rx="3" />
      <rect x={railX} y="6.25" width="3" height="7.5" rx="1" fill="currentColor" stroke="none" />
    </svg>
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
