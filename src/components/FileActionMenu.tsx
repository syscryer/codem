import { ArrowUpRight, Copy, Folder, Maximize2 } from 'lucide-react';
import { useEffect, useId, useRef, type MouseEvent, type RefObject } from 'react';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { PopoverPortal } from './PopoverPortal';

export type FileActionMenuTarget = {
  path: string;
  name: string;
};

type FileActionMenuProps = {
  target: FileActionMenuTarget | null;
  anchorRef?: RefObject<HTMLElement | null>;
  virtualAnchor?: { x: number; y: number } | null;
  placement?: 'bottom-start' | 'bottom-end';
  offset?: number;
  canPreview?: boolean;
  onClose: () => void;
  onPreview: (target: FileActionMenuTarget) => void | Promise<void>;
  onOpen: (path: string) => void | Promise<void>;
  onReveal: (path: string) => void | Promise<void>;
  onCopy: (path: string) => void | Promise<void>;
};

export function FileActionMenu({
  target,
  anchorRef,
  virtualAnchor,
  placement = 'bottom-start',
  offset = 0,
  canPreview = true,
  onClose,
  onPreview,
  onOpen,
  onReveal,
  onCopy,
}: FileActionMenuProps) {
  const fallbackAnchorRef = useRef<HTMLSpanElement | null>(null);
  const effectiveAnchorRef = anchorRef ?? fallbackAnchorRef;
  const menuId = useId();

  useOutsideDismiss({
    selectors: [
      {
        selector: `[data-file-action-menu-id="${menuId}"]`,
        onDismiss: onClose,
        anchorRefs: [effectiveAnchorRef],
      },
    ],
  });

  useEffect(() => {
    if (!target) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, target]);

  async function run(
    event: MouseEvent<HTMLButtonElement>,
    action: () => void | Promise<void>,
  ) {
    event.stopPropagation();
    try {
      await action();
    } finally {
      onClose();
    }
  }

  return (
    <PopoverPortal
      open={Boolean(target)}
      anchorRef={effectiveAnchorRef}
      virtualAnchor={virtualAnchor}
      placement={placement}
      offset={offset}
    >
      {target ? (
        <div
          data-file-action-menu-id={menuId}
          className="workspace-menu conversation-output-file-menu"
          role="menu"
          aria-label={`文件操作 ${target.name}`}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {canPreview ? (
            <button
              type="button"
              className="workspace-menu-item conversation-output-file-menu-item"
              role="menuitem"
              onClick={(event) => void run(event, () => onPreview(target))}
            >
              <Maximize2 size={14} />
              <span>在右侧预览</span>
            </button>
          ) : null}
          <button
            type="button"
            className="workspace-menu-item conversation-output-file-menu-item"
            role="menuitem"
            onClick={(event) => void run(event, () => onOpen(target.path))}
          >
            <ArrowUpRight size={14} />
            <span>用默认应用打开</span>
          </button>
          <button
            type="button"
            className="workspace-menu-item conversation-output-file-menu-item"
            role="menuitem"
            onClick={(event) => void run(event, () => onReveal(target.path))}
          >
            <Folder size={14} />
            <span>在文件浏览器中显示</span>
          </button>
          <div className="workspace-menu-divider" role="separator" />
          <button
            type="button"
            className="workspace-menu-item conversation-output-file-menu-item"
            role="menuitem"
            onClick={(event) => void run(event, () => onCopy(target.path))}
          >
            <Copy size={14} />
            <span>复制完整路径</span>
          </button>
        </div>
      ) : null}
    </PopoverPortal>
  );
}
