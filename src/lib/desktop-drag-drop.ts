import { isTauriRuntime } from './window-material';

// 监听 Tauri 窗口的原生文件拖放事件，回调里拿到的是文件真实磁盘绝对路径。
// 设计参考开源项目 desktop-cc-gui（MIT）的 dragDrop 服务，适配 CodeM 的单订阅场景。

export type DesktopDragDropPhase = 'enter' | 'over' | 'leave' | 'drop';

export type DesktopDragDropHandlers = {
  onPhaseChange?: (phase: DesktopDragDropPhase) => void;
  onDrop?: (paths: string[]) => void;
};

// 订阅一次窗口拖放事件，返回取消订阅函数。非 Tauri 环境下直接返回 no-op。
export function subscribeDesktopDragDrop(handlers: DesktopDragDropHandlers): () => void {
  if (!isTauriRuntime()) {
    return () => {};
  }

  let disposed = false;
  let unlisten: (() => void) | null = null;

  void (async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const currentWindow = getCurrentWindow();
      const handler = await currentWindow.onDragDropEvent((event) => {
        const payload = event.payload as { type?: string; paths?: string[] };
        const phase = payload?.type;
        if (phase === 'enter' || phase === 'over' || phase === 'leave' || phase === 'drop') {
          handlers.onPhaseChange?.(phase);
        }
        if (phase === 'drop' && Array.isArray(payload?.paths) && payload.paths.length > 0) {
          handlers.onDrop?.(payload.paths.filter((item): item is string => typeof item === 'string'));
        }
      });

      if (disposed) {
        handler();
        return;
      }
      unlisten = handler;
    } catch {
      // 拿不到窗口句柄时静默降级，不影响普通输入。
    }
  })();

  return () => {
    disposed = true;
    if (unlisten) {
      try {
        unlisten();
      } catch {
        // 忽略重复取消订阅。
      }
      unlisten = null;
    }
  };
}
