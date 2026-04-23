import type { ThreadDetail } from '../types';

type DebugDrawerProps = {
  activeThread: ThreadDetail | null;
  open: boolean;
  onClose: () => void;
};

export function DebugDrawer({ activeThread, open, onClose }: DebugDrawerProps) {
  if (!open || !activeThread) {
    return null;
  }

  return (
    <aside className="debug-drawer">
      <div className="debug-head">
        <div>
          <p className="eyebrow">Debug</p>
          <h2>运行细节</h2>
        </div>
        <button type="button" className="ghost-button" onClick={onClose}>
          关闭
        </button>
      </div>

      <details className="debug-section" open>
        <summary>事件摘要</summary>
        {activeThread.debugEvents.length === 0 ? (
          <p className="muted">暂无调试事件</p>
        ) : (
          activeThread.debugEvents.map((event) => (
            <article key={event.id} className={`debug-item ${event.tone === 'error' ? 'debug-error' : ''}`}>
              <h3>{event.title}</h3>
              <pre>{event.content}</pre>
            </article>
          ))
        )}
      </details>

      <details className="debug-section">
        <summary>Raw Events ({activeThread.rawEvents.length})</summary>
        <pre className="raw-pre">{activeThread.rawEvents.join('\n') || '暂无原始事件'}</pre>
      </details>
    </aside>
  );
}
