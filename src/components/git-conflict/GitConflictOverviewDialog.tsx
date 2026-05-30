import { Check, GitMerge, LoaderCircle, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  fetchGitConflictFile,
  markGitConflictResolved,
  saveGitConflictResult,
} from '../../lib/git-api';
import {
  buildConflictOperationTitle,
  buildConflictResolutionContent,
  canContinueGitOperation,
  type ConflictResolutionChoice,
} from '../../lib/git-conflict-resolution';
import type { GitOperationState } from '../../types';

type GitConflictOverviewDialogProps = {
  open: boolean;
  projectId: string;
  operationState: GitOperationState;
  onClose: () => void;
  onOpenMerge: (path: string) => void;
  onChanged: () => Promise<void> | void;
  onContinue: () => Promise<void> | void;
  onAbort: () => Promise<void> | void;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

export function GitConflictOverviewDialog({
  open,
  projectId,
  operationState,
  onClose,
  onOpenMerge,
  onChanged,
  onContinue,
  onAbort,
  showToast,
}: GitConflictOverviewDialogProps) {
  const conflicts = operationState.conflicts;
  const [activePath, setActivePath] = useState('');
  const [workingAction, setWorkingAction] = useState('');
  const activeConflict = useMemo(
    () => conflicts.find((conflict) => conflict.path === activePath) ?? conflicts[0] ?? null,
    [activePath, conflicts],
  );
  const canContinue = canContinueGitOperation(operationState);

  useEffect(() => {
    if (!open) {
      return;
    }

    setActivePath((current) => {
      if (current && conflicts.some((conflict) => conflict.path === current)) {
        return current;
      }
      return conflicts[0]?.path ?? '';
    });
  }, [conflicts, open]);

  if (!open) {
    return null;
  }

  async function runAction(action: string, callback: () => Promise<void>) {
    setWorkingAction(action);
    try {
      await callback();
    } catch (caughtError) {
      showToast(caughtError instanceof Error ? caughtError.message : 'Git 冲突操作失败', 'error');
    } finally {
      setWorkingAction('');
    }
  }

  async function acceptConflict(choice: Exclude<ConflictResolutionChoice, 'both'>) {
    if (!activeConflict) {
      return;
    }

    await runAction(choice, async () => {
      const detail = await fetchGitConflictFile(projectId, activeConflict.path);
      const content = buildConflictResolutionContent(detail, choice);
      await saveGitConflictResult(projectId, activeConflict.path, content);
      await markGitConflictResolved(projectId, activeConflict.path);
      showToast(choice === 'current' ? '已接受当前版本' : '已接受传入版本');
      await Promise.resolve(onChanged());
    });
  }

  return (
    <div className="dialog-backdrop git-conflict-dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        className="dialog-card git-conflict-overview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Git 冲突总览"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-head git-conflict-dialog-head">
          <div>
            <h3>{buildConflictOperationTitle(operationState)}</h3>
            <p>{conflicts.length > 0 ? `还有 ${conflicts.length} 个冲突文件需要处理。` : '冲突文件已清空，可以继续操作。'}</p>
          </div>
          <button type="button" className="dialog-button secondary" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="git-conflict-overview-body">
          <div className="git-conflict-overview-table" role="table" aria-label="冲突文件列表">
            <div className="git-conflict-overview-row head" role="row">
              <span role="columnheader">名称</span>
              <span role="columnheader">您的更改</span>
              <span role="columnheader">他们的更改</span>
              <span role="columnheader">状态</span>
            </div>
            {conflicts.length > 0 ? (
              conflicts.map((conflict) => (
                <button
                  key={conflict.path}
                  type="button"
                  className={`git-conflict-overview-row${conflict.path === activeConflict?.path ? ' active' : ''}`}
                  role="row"
                  onClick={() => setActivePath(conflict.path)}
                >
                  <strong role="cell" title={conflict.path}>{conflict.path}</strong>
                  <span role="cell">{formatSideLabel(conflict.status, 'current')}</span>
                  <span role="cell">{formatSideLabel(conflict.status, 'incoming')}</span>
                  <span role="cell">{conflict.label}</span>
                </button>
              ))
            ) : (
              <div className="git-conflict-overview-empty">没有未解决的冲突文件。</div>
            )}
          </div>

          <aside className="git-conflict-overview-actions" aria-label="文件级冲突操作">
            <strong>{activeConflict?.path ?? '未选择文件'}</strong>
            <span>{activeConflict?.label ?? '所有冲突文件已处理。'}</span>
            <button
              type="button"
              className="dialog-button secondary"
              disabled={!activeConflict || Boolean(workingAction)}
              onClick={() => void acceptConflict('current')}
            >
              {workingAction === 'current' ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}
              接受当前
            </button>
            <button
              type="button"
              className="dialog-button secondary"
              disabled={!activeConflict || Boolean(workingAction)}
              onClick={() => void acceptConflict('incoming')}
            >
              {workingAction === 'incoming' ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}
              接受传入
            </button>
            <button
              type="button"
              className="dialog-button primary"
              disabled={!activeConflict || Boolean(workingAction)}
              onClick={() => activeConflict ? onOpenMerge(activeConflict.path) : undefined}
            >
              <GitMerge size={13} />
              合并...
            </button>
          </aside>
        </div>

        <div className="dialog-actions git-conflict-dialog-actions">
          <button type="button" className="dialog-button danger" disabled={!operationState.canAbort || Boolean(workingAction)} onClick={() => void onAbort()}>
            <XCircle size={13} />
            中止操作
          </button>
          <button type="button" className="dialog-button primary" disabled={!canContinue || Boolean(workingAction)} onClick={() => void onContinue()}>
            <GitMerge size={13} />
            继续操作
          </button>
        </div>
      </section>
    </div>
  );
}

function formatSideLabel(status: string, side: 'current' | 'incoming') {
  if (status === 'AA') {
    return '新增';
  }
  if (status === 'DD') {
    return '删除';
  }
  if (side === 'current' && status[0] === 'D') {
    return '删除';
  }
  if (side === 'incoming' && status[1] === 'D') {
    return '删除';
  }
  return '修改';
}
