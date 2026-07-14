import { useEffect, useState } from 'react';
import type { AiChatSummary } from '../types';

type OrdinaryChatDialogsProps = {
  renameTarget: AiChatSummary | null;
  deleteTarget: AiChatSummary | null;
  onCloseRename: () => void;
  onCloseDelete: () => void;
  onRename: (chat: AiChatSummary, title: string) => void | Promise<void>;
  onDelete: (chat: AiChatSummary) => void | Promise<void>;
};

export function OrdinaryChatDialogs({
  renameTarget,
  deleteTarget,
  onCloseRename,
  onCloseDelete,
  onRename,
  onDelete,
}: OrdinaryChatDialogsProps) {
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTitle(renameTarget?.title ?? '');
    setError('');
    setSubmitting(false);
  }, [renameTarget?.id, renameTarget?.title]);

  useEffect(() => {
    setError('');
    setSubmitting(false);
  }, [deleteTarget?.id]);

  async function submitRename() {
    if (!renameTarget || submitting) return;
    const nextTitle = title.trim();
    if (!nextTitle) {
      setError('请输入聊天名称。');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onRename(renameTarget, nextTitle);
      onCloseRename();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '重命名聊天失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitDelete() {
    if (!deleteTarget || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onDelete(deleteTarget);
      onCloseDelete();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '删除聊天失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {renameTarget ? (
        <div className="dialog-backdrop" role="presentation" onClick={submitting ? undefined : onCloseRename}>
          <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="ordinary-chat-rename-title" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-head">
              <h3 id="ordinary-chat-rename-title">重命名聊天</h3>
              <p>名称只用于本地聊天列表，不会发送给模型。</p>
            </div>
            <form
              className="dialog-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitRename();
              }}
            >
              <input
                autoFocus
                className="dialog-input"
                value={title}
                maxLength={120}
                disabled={submitting}
                onChange={(event) => setTitle(event.target.value)}
              />
              {error ? <div className="assistant-runtime-error dialog-error">{error}</div> : null}
              <div className="dialog-actions">
                <button type="button" className="dialog-button secondary" disabled={submitting} onClick={onCloseRename}>
                  取消
                </button>
                <button type="submit" className="dialog-button primary" disabled={submitting || !title.trim()}>
                  {submitting ? '保存中...' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="dialog-backdrop" role="presentation" onClick={submitting ? undefined : onCloseDelete}>
          <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="ordinary-chat-delete-title" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-head">
              <h3 id="ordinary-chat-delete-title">删除聊天</h3>
              <p>确定删除“{deleteTarget.title}”吗？聊天消息和本地工具记录会一并删除，此操作无法撤销。</p>
            </div>
            {error ? <div className="assistant-runtime-error dialog-error">{error}</div> : null}
            <div className="dialog-actions">
              <button type="button" className="dialog-button secondary" disabled={submitting} onClick={onCloseDelete}>
                取消
              </button>
              <button type="button" className="dialog-button danger" disabled={submitting} onClick={() => void submitDelete()}>
                {submitting ? '删除中...' : '删除聊天'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
