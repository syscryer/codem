import {
  AlertTriangle,
  GitMerge,
  ListTree,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react';

import { canContinueGitOperation } from '../../lib/git-conflict-resolution';
import type { GitOperationState, GitPullMode } from '../../types';

type GitConflictStatusStripProps = {
  operationState: GitOperationState;
  onOpenOverview: () => void;
  onRequestPull: (mode: GitPullMode) => void;
  onContinue: () => void;
  onAbort: () => void;
  onRefresh: () => void;
};

export function GitConflictStatusStrip({
  operationState,
  onOpenOverview,
  onRequestPull,
  onContinue,
  onAbort,
  onRefresh,
}: GitConflictStatusStripProps) {
  const status = resolveStatusStripCopy(operationState);
  const hasConflicts = operationState.hasConflicts && operationState.conflicts.length > 0;
  const canContinue = canContinueGitOperation(operationState);

  return (
    <section className={`git-conflict-status-strip ${operationState.status}`} aria-label="Git 冲突状态">
      <div className="git-conflict-status-icon" aria-hidden="true">
        <AlertTriangle size={17} />
      </div>
      <div className="git-conflict-status-copy">
        <strong>{status.title}</strong>
        <span>{status.description}</span>
      </div>
      <div className="git-conflict-status-actions">
        {operationState.status === 'diverged' ? (
          <>
            <button type="button" className="dialog-button primary" onClick={() => onRequestPull('merge')}>
              <GitMerge size={13} />
              合并拉取
            </button>
            <button type="button" className="dialog-button secondary" onClick={() => onRequestPull('rebase')}>
              <RotateCcw size={13} />
              变基拉取
            </button>
          </>
        ) : null}
        {hasConflicts ? (
          <button type="button" className="dialog-button primary" onClick={onOpenOverview}>
            <ListTree size={13} />
            解决冲突
          </button>
        ) : null}
        {operationState.operation !== 'none' || hasConflicts || operationState.status === 'in_progress' ? (
          <>
            <button type="button" className="dialog-button secondary" disabled={!canContinue} onClick={onContinue}>
              <GitMerge size={13} />
              继续操作
            </button>
            <button type="button" className="dialog-button secondary" disabled={!operationState.canAbort} onClick={onAbort}>
              <XCircle size={13} />
              中止操作
            </button>
          </>
        ) : null}
        <button type="button" className="dialog-button secondary" onClick={onRefresh}>
          <RefreshCw size={13} />
          刷新
        </button>
      </div>
    </section>
  );
}

function resolveStatusStripCopy(operationState: GitOperationState) {
  if (operationState.status === 'blocked_dirty') {
    return {
      title: '远端有更新，但工作区存在未提交变更',
      description: '请先提交、暂存或撤销本地变更，然后再拉取远端更新。',
    };
  }

  if (operationState.status === 'diverged') {
    return {
      title: '当前分支与远端分叉',
      description: `${operationState.branch ?? '当前分支'} ahead ${operationState.ahead} / behind ${operationState.behind}，请选择合并或变基拉取。`,
    };
  }

  if (operationState.hasConflicts && operationState.conflicts.length > 0) {
    return {
      title: `当前有 ${operationState.conflicts.length} 个冲突文件`,
      description: '打开总览处理冲突文件，解决并标记后才能继续当前 Git 操作。',
    };
  }

  if (operationState.status === 'in_progress') {
    return {
      title: 'Git 操作正在进行',
      description: '当前已没有未解决冲突，可以继续或中止操作。',
    };
  }

  return {
    title: 'Git 状态',
    description: operationState.message || '当前没有需要处理的 Git 操作。',
  };
}
