import { Download, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import type { AiChatSummary } from '../types';
import { PopoverPortal } from './PopoverPortal';

type OrdinaryChatHeaderProps = {
  chat: AiChatSummary | null;
  isDraft: boolean;
  onTogglePin: (chatId: string, pinned: boolean) => void | Promise<void>;
  onRename: (chat: AiChatSummary) => void;
  onDelete: (chat: AiChatSummary) => void;
  onExport: () => void | Promise<void>;
};

export function OrdinaryChatHeader({
  chat,
  isDraft,
  onTogglePin,
  onRename,
  onDelete,
  onExport,
}: OrdinaryChatHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const pinned = Boolean(chat?.pinnedAt);

  useOutsideDismiss({
    selectors: [
      {
        selector: '.ordinary-chat-menu-popover',
        onDismiss: () => setMenuOpen(false),
        anchorRefs: [menuRef],
      },
    ],
  });

  useEffect(() => setMenuOpen(false), [chat?.id, isDraft]);

  function run(action: () => void | Promise<void>) {
    setMenuOpen(false);
    void action();
  }

  return (
    <header className="chat-header ordinary-chat-header" data-tauri-drag-region>
      <div className="thread-title" data-tauri-drag-region>
        <h2 data-tauri-drag-region>{chat?.title ?? (isDraft ? '新建聊天' : '普通聊天')}</h2>
        <span className="thread-project" data-tauri-drag-region>普通聊天</span>
        <div className="chat-thread-menu" ref={menuRef}>
          <button
            type="button"
            className="more-button thread-more-button"
            aria-label="更多聊天操作"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={!chat}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal size={15} />
          </button>
          <PopoverPortal open={menuOpen && Boolean(chat)} anchorRef={menuRef} placement="bottom-end" offset={6}>
            <div className="workspace-menu thread-menu-popover ordinary-chat-menu-popover" role="menu">
              <button
                type="button"
                className="workspace-menu-item"
                role="menuitem"
                onClick={() => chat ? run(() => onTogglePin(chat.id, !pinned)) : undefined}
              >
                {pinned ? <PinOff size={14} /> : <Pin size={14} />}
                <span>{pinned ? '取消置顶' : '置顶聊天'}</span>
              </button>
              <button
                type="button"
                className="workspace-menu-item"
                role="menuitem"
                onClick={() => chat ? run(() => onRename(chat)) : undefined}
              >
                <Pencil size={14} />
                <span>重命名聊天</span>
              </button>
              <button
                type="button"
                className="workspace-menu-item"
                role="menuitem"
                onClick={() => run(onExport)}
              >
                <Download size={14} />
                <span>导出 Markdown</span>
              </button>
              <div className="workspace-menu-divider" />
              <button
                type="button"
                className="workspace-menu-item danger"
                role="menuitem"
                onClick={() => chat ? run(() => onDelete(chat)) : undefined}
              >
                <Trash2 size={14} />
                <span>删除聊天</span>
              </button>
            </div>
          </PopoverPortal>
        </div>
      </div>
    </header>
  );
}
