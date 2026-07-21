import { AlertCircle, Bell, CheckCircle2, LoaderCircle, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { PopoverPortal } from './PopoverPortal';
import type { BackgroundOperation } from '../types';

type BackgroundOperationCenterProps = {
  operations: BackgroundOperation[];
  runningCount: number;
  unreadFailureCount: number;
  onOpen: () => void;
  onClearCompleted: () => void;
};

export function BackgroundOperationCenter({
  operations,
  runningCount,
  unreadFailureCount,
  onOpen,
  onClearCompleted,
}: BackgroundOperationCenterProps) {
  const [open, setOpen] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const running = useMemo(() => operations.filter((operation) => operation.status === 'running'), [operations]);
  const completed = useMemo(() => operations.filter((operation) => operation.status !== 'running'), [operations]);
  const hasOperations = operations.length > 0;

  useOutsideDismiss({
    selectors: [
      { selector: '.background-operation-popover', onDismiss: () => setOpen(false), anchorRefs: [triggerRef] },
    ],
  });

  useEffect(() => {
    if (!open || runningCount === 0) {
      return;
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open, runningCount]);

  useEffect(() => {
    if (open && unreadFailureCount > 0) {
      onOpen();
    }
  }, [open, onOpen, unreadFailureCount]);

  function toggleOpen() {
    setOpen((value) => !value);
    setNowMs(Date.now());
  }

  return (
    <div className="background-operation-entry">
      <button
        ref={triggerRef}
        type="button"
        className={`background-operation-trigger${open ? ' active' : ''}${runningCount > 0 ? ' is-running' : ''}${unreadFailureCount > 0 ? ' has-unread' : ''}`}
        aria-label={formatTriggerLabel(runningCount, unreadFailureCount)}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <Bell size={16} strokeWidth={1.8} />
        {runningCount > 1 ? <span>{runningCount}</span> : null}
        {unreadFailureCount > 0 ? <i aria-hidden="true" /> : null}
      </button>
      <PopoverPortal open={open} anchorRef={triggerRef} placement="bottom-end" offset={8}>
        <section className="background-operation-popover" role="dialog" aria-label="任务中心">
          <header className="background-operation-head">
            <div>
              <strong>任务中心</strong>
              <span>{runningCount > 0 ? `${runningCount} 个任务进行中` : '后台操作记录'}</span>
            </div>
            <button type="button" disabled={completed.length === 0} onClick={onClearCompleted}>
              <Trash2 size={13} />
              清除已完成
            </button>
          </header>

          {!hasOperations ? (
            <div className="background-operation-empty">暂无后台任务</div>
          ) : (
            <div className="background-operation-list">
              {running.length > 0 ? (
                <OperationGroup title="进行中" operations={running} nowMs={nowMs} />
              ) : null}
              {completed.length > 0 ? (
                <OperationGroup title="最近完成" operations={completed} nowMs={nowMs} />
              ) : null}
            </div>
          )}
        </section>
      </PopoverPortal>
    </div>
  );
}

function OperationGroup({
  title,
  operations,
  nowMs,
}: {
  title: string;
  operations: BackgroundOperation[];
  nowMs: number;
}) {
  return (
    <section className="background-operation-group" aria-label={title}>
      <h3>{title}</h3>
      {operations.map((operation) => (
        <OperationItem key={operation.id} operation={operation} nowMs={nowMs} />
      ))}
    </section>
  );
}

function OperationItem({ operation, nowMs }: { operation: BackgroundOperation; nowMs: number }) {
  const finishedOrNowMs = operation.finishedAtMs ?? nowMs;
  const elapsed = formatElapsedMs(Math.max(0, finishedOrNowMs - operation.startedAtMs));
  return (
    <article className={`background-operation-item ${operation.status}`}>
      <span className="background-operation-icon" aria-hidden="true">
        {operation.status === 'running' ? (
          <LoaderCircle className="spin" size={15} />
        ) : operation.status === 'error' ? (
          <AlertCircle size={15} />
        ) : (
          <CheckCircle2 size={15} />
        )}
      </span>
      <div className="background-operation-body">
        <div className="background-operation-title-row">
          <strong>{operation.title}</strong>
          <span>{elapsed}</span>
        </div>
        <div className="background-operation-target">{operation.target}</div>
        <div className="background-operation-phase">
          {operation.status === 'error' ? operation.errorMessage ?? '操作失败' : operation.summary ?? operation.phase}
        </div>
      </div>
    </article>
  );
}

function formatTriggerLabel(runningCount: number, unreadFailureCount: number) {
  if (runningCount > 0 && unreadFailureCount > 0) {
    return `任务中心，${runningCount} 个任务进行中，${unreadFailureCount} 个失败待查看`;
  }
  if (runningCount > 0) {
    return `任务中心，${runningCount} 个任务进行中`;
  }
  if (unreadFailureCount > 0) {
    return `任务中心，${unreadFailureCount} 个失败待查看`;
  }
  return '任务中心';
}

function formatElapsedMs(elapsedMs: number) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;
}
