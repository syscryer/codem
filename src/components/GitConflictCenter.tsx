import {
  AlertTriangle,
  Check,
  GitMerge,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Save,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  abortGitOperation,
  continueGitOperation,
  fetchGitConflictFile,
  fetchGitOperationState,
  markGitConflictResolved,
  pullGitBranch,
  saveGitConflictResult,
} from '../lib/git-api';
import type { GitConflictFileDetail, GitOperationState, GitPullMode } from '../types';

type GitConflictCenterProps = {
  projectId: string;
  operationState: GitOperationState | null;
  loading: boolean;
  onRefresh: () => void | Promise<void>;
  onChanged: () => void | Promise<void>;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

export function GitConflictCenter({
  projectId,
  operationState,
  loading,
  onRefresh,
  onChanged,
  showToast,
}: GitConflictCenterProps) {
  const conflicts = operationState?.conflicts ?? [];
  const [activePath, setActivePath] = useState('');
  const [detail, setDetail] = useState<GitConflictFileDetail | null>(null);
  const [resultContent, setResultContent] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [workingAction, setWorkingAction] = useState('');
  const [inlineStatus, setInlineStatus] = useState('');
  const [pendingPullMode, setPendingPullMode] = useState<GitPullMode | null>(null);
  const [abortConfirmOpen, setAbortConfirmOpen] = useState(false);
  const operationLabel = formatOperationLabel(operationState?.operation ?? 'none');
  const activeConflict = conflicts.find((conflict) => conflict.path === activePath) ?? conflicts[0] ?? null;
  const canContinue = Boolean(operationState?.canContinue);
  const canAbort = Boolean(operationState?.canAbort);
  const isDiverged = operationState?.status === 'diverged';
  const showOperationActions = Boolean(
    operationState && (operationState.operation !== 'none' || operationState.hasConflicts),
  );
  const summaryText = useMemo(() => {
    if (!operationState) {
      return '正在读取 Git 操作状态。';
    }
    if (operationState.hasConflicts) {
      return `当前有 ${conflicts.length} 个冲突文件，解决并标记后才能继续。`;
    }
    if (operationState.status === 'in_progress') {
      return `${operationLabel} 已无冲突，可以继续或中止。`;
    }
    if (operationState.status === 'diverged') {
      return '当前分支和远端已经分叉，不能快进。请选择合并拉取或变基拉取。';
    }
    if (operationState.status === 'blocked_dirty') {
      return '远端有更新，但工作区存在未提交变更。';
    }
    return operationState.message;
  }, [conflicts.length, operationLabel, operationState]);

  useEffect(() => {
    setActivePath((current) => {
      if (current && conflicts.some((conflict) => conflict.path === current)) {
        return current;
      }
      return conflicts[0]?.path ?? '';
    });
  }, [conflicts]);

  useEffect(() => {
    if (!isDiverged) {
      setPendingPullMode(null);
    }
    if (!canAbort) {
      setAbortConfirmOpen(false);
    }
  }, [canAbort, isDiverged]);

  useEffect(() => {
    if (!activeConflict) {
      setDetail(null);
      setResultContent('');
      setInlineStatus('');
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    fetchGitConflictFile(projectId, activeConflict.path)
      .then((nextDetail) => {
        if (!cancelled) {
          setDetail(nextDetail);
          setResultContent(nextDetail.resultContent);
          setInlineStatus('');
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetail(null);
          setResultContent('');
          showToast(error instanceof Error ? error.message : '读取冲突文件失败', 'error');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeConflict, projectId, showToast]);

  if (
    !operationState ||
    (!operationState.hasConflicts &&
      operationState.status !== 'in_progress' &&
      operationState.status !== 'diverged' &&
      operationState.status !== 'blocked_dirty')
  ) {
    return null;
  }

  async function refreshAll() {
    await Promise.resolve(onRefresh());
  }

  async function runAction(action: string, callback: () => Promise<void>) {
    setWorkingAction(action);
    try {
      await callback();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Git 冲突操作失败', 'error');
    } finally {
      setWorkingAction('');
    }
  }

  async function saveResult() {
    if (!activeConflict) {
      return;
    }
    await runAction('save', async () => {
      const nextDetail = await saveGitConflictResult(projectId, activeConflict.path, resultContent);
      setDetail(nextDetail);
      setResultContent(nextDetail.resultContent);
      setInlineStatus('冲突结果已保存');
    });
  }

  async function markResolved() {
    if (!activeConflict) {
      return;
    }
    await runAction('mark', async () => {
      await saveGitConflictResult(projectId, activeConflict.path, resultContent);
      await markGitConflictResolved(projectId, activeConflict.path);
      setInlineStatus('已标记冲突解决');
      await Promise.resolve(onChanged());
    });
  }

  async function continueOperation() {
    await runAction('continue', async () => {
      await continueGitOperation(projectId);
      showToast(`${operationLabel}已继续`);
      await Promise.resolve(onChanged());
    });
  }

  function requestDivergedPull(mode: GitPullMode) {
    if (!isDiverged || workingAction) {
      return;
    }

    setPendingPullMode(mode);
  }

  async function confirmDivergedPull() {
    const mode = pendingPullMode;
    if (!operationState || operationState.status !== 'diverged' || !mode) {
      return;
    }

    const label = formatPullModeLabel(mode);
    await runAction(`pull-${mode}`, async () => {
      setPendingPullMode(null);
      try {
        await pullGitBranch(projectId, operationState?.remote, operationState?.branch, mode);
        showToast(`${label}完成`);
        await Promise.resolve(onChanged());
      } catch (error) {
        const nextState = await fetchGitOperationState(projectId).catch(() => null);
        await Promise.resolve(onChanged());
        if (nextState?.hasConflicts) {
          showToast('拉取已进入冲突状态，请在冲突中心解决后继续。', 'info');
          return;
        }
        throw error;
      }
    });
  }

  function requestAbortOperation() {
    if (!canAbort || workingAction) {
      return;
    }

    setAbortConfirmOpen(true);
  }

  async function abortOperation() {
    if (!canAbort) {
      return;
    }

    await runAction('abort', async () => {
      setAbortConfirmOpen(false);
      await abortGitOperation(projectId);
      showToast(`${operationLabel}已中止`);
      await Promise.resolve(onChanged());
    });
  }

  function acceptCurrent() {
    if (detail) {
      setResultContent(detail.currentContent);
      setInlineStatus('');
    }
  }

  function acceptIncoming() {
    if (detail) {
      setResultContent(detail.incomingContent);
      setInlineStatus('');
    }
  }

  function acceptBoth() {
    if (detail) {
      setResultContent([detail.currentContent.trimEnd(), detail.incomingContent.trimStart()].filter(Boolean).join('\n'));
      setInlineStatus('');
    }
  }

  const pendingPullLabel = pendingPullMode ? formatPullModeLabel(pendingPullMode) : '';
  const pendingPullWorking = pendingPullMode ? workingAction === `pull-${pendingPullMode}` : false;

  return (
    <section className="git-conflict-center" aria-label="Git 冲突中心">
      <div className="git-conflict-summary">
        <AlertTriangle size={18} />
        <div>
          <strong>冲突中心</strong>
          <span>{summaryText}</span>
        </div>
        <div className="git-conflict-summary-actions">
          <button type="button" disabled={loading || Boolean(workingAction)} onClick={() => void refreshAll()}>
            <RefreshCw size={13} />
            刷新
          </button>
          {isDiverged ? (
            <>
              <button type="button" disabled={loading || Boolean(workingAction)} onClick={() => requestDivergedPull('merge')}>
                {workingAction === 'pull-merge' ? <LoaderCircle className="spin" size={13} /> : <GitMerge size={13} />}
                合并拉取
              </button>
              <button type="button" disabled={loading || Boolean(workingAction)} onClick={() => requestDivergedPull('rebase')}>
                {workingAction === 'pull-rebase' ? <LoaderCircle className="spin" size={13} /> : <RotateCcw size={13} />}
                变基拉取
              </button>
            </>
          ) : showOperationActions ? (
            <>
              <button type="button" disabled={!canContinue || Boolean(workingAction)} onClick={() => void continueOperation()}>
                {workingAction === 'continue' ? <LoaderCircle className="spin" size={13} /> : <GitMerge size={13} />}
                继续操作
              </button>
              <button type="button" disabled={!canAbort || Boolean(workingAction)} onClick={requestAbortOperation}>
                {workingAction === 'abort' ? <LoaderCircle className="spin" size={13} /> : <XCircle size={13} />}
                中止操作
              </button>
            </>
          ) : null}
        </div>
      </div>

      {pendingPullMode && isDiverged ? (
        <div className="git-conflict-confirm-strip" role="alertdialog" aria-label={`${pendingPullLabel}确认`}>
          <AlertTriangle size={16} />
          <div className="git-conflict-confirm-copy">
            <strong>确认{pendingPullLabel}当前分支？</strong>
            <span>如果发生冲突，会在这里继续处理；你也可以先在下方历史图里确认两边提交。</span>
          </div>
          <div className="git-conflict-confirm-actions">
            <button type="button" disabled={Boolean(workingAction)} onClick={() => setPendingPullMode(null)}>
              取消
            </button>
            <button type="button" className="primary" disabled={Boolean(workingAction)} onClick={() => void confirmDivergedPull()}>
              {pendingPullWorking ? <LoaderCircle className="spin" size={13} /> : <GitMerge size={13} />}
              确认{pendingPullLabel}
            </button>
          </div>
        </div>
      ) : null}

      {abortConfirmOpen ? (
        <div className="git-conflict-confirm-strip danger" role="alertdialog" aria-label="中止操作确认">
          <XCircle size={16} />
          <div className="git-conflict-confirm-copy">
            <strong>中止当前{operationLabel}？</strong>
            <span>会放弃这次 Git 操作产生的中间状态，已保存到文件但未提交的解决结果也可能被还原。</span>
          </div>
          <div className="git-conflict-confirm-actions">
            <button type="button" disabled={Boolean(workingAction)} onClick={() => setAbortConfirmOpen(false)}>
              取消
            </button>
            <button type="button" className="danger" disabled={Boolean(workingAction)} onClick={() => void abortOperation()}>
              {workingAction === 'abort' ? <LoaderCircle className="spin" size={13} /> : <XCircle size={13} />}
              确认中止
            </button>
          </div>
        </div>
      ) : null}

      {conflicts.length > 0 ? (
        <div className="git-conflict-body">
          <div className="git-conflict-list">
            {conflicts.map((conflict) => (
              <button
                key={conflict.path}
                type="button"
                className={conflict.path === activeConflict?.path ? 'active' : ''}
                onClick={() => setActivePath(conflict.path)}
              >
                <span>{conflict.status}</span>
                <strong title={conflict.path}>{conflict.path}</strong>
                <small>{conflict.label}</small>
              </button>
            ))}
          </div>

          <div className="git-conflict-resolver">
            {detailLoading ? (
              <div className="git-conflict-loading">
                <LoaderCircle className="spin" size={16} />
                正在读取冲突内容...
              </div>
            ) : detail ? (
              <>
                <div className="git-conflict-resolver-head">
                  <div>
                    <strong>{detail.path}</strong>
                    <span>{detail.label}</span>
                  </div>
                  <div className="git-conflict-resolver-actions">
                    <button type="button" onClick={acceptCurrent}>接受当前</button>
                    <button type="button" onClick={acceptIncoming}>接受传入</button>
                    <button type="button" onClick={acceptBoth}>接受双方</button>
                  </div>
                </div>

                <div className="git-conflict-side-grid">
                  <ConflictSide title="Base" content={detail.baseContent} />
                  <ConflictSide title="当前 ours" content={detail.currentContent} />
                  <ConflictSide title="传入 theirs" content={detail.incomingContent} />
                </div>

                <label className="git-conflict-result">
                  <span>Result</span>
                  <textarea
                    value={resultContent}
                    onChange={(event) => {
                      setResultContent(event.target.value);
                      setInlineStatus('');
                    }}
                  />
                </label>

                <div className="git-conflict-result-actions">
                  <button type="button" disabled={Boolean(workingAction)} onClick={() => void saveResult()}>
                    {workingAction === 'save' ? <LoaderCircle className="spin" size={13} /> : <Save size={13} />}
                    保存结果
                  </button>
                  <button type="button" className="primary" disabled={Boolean(workingAction)} onClick={() => void markResolved()}>
                    {workingAction === 'mark' ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}
                    标记已解决
                  </button>
                  {inlineStatus ? <span className="git-conflict-inline-status">{inlineStatus}</span> : null}
                </div>
              </>
            ) : (
              <div className="git-conflict-loading">选择冲突文件查看详情。</div>
            )}
          </div>
        </div>
      ) : (
        <div className="git-conflict-ready">
          <RotateCcw size={16} />
          {operationState.status === 'diverged'
            ? '当前分支与远端分叉。可以直接合并拉取生成一次合并提交，也可以变基拉取把本地提交重放到远端之后。'
            : operationState.status === 'blocked_dirty'
              ? '远端有更新且当前存在未提交变更。请先提交、暂存或撤销本地变更。'
              : '冲突文件已经清空，可以继续或中止当前 Git 操作。'}
        </div>
      )}
    </section>
  );
}

function ConflictSide({ title, content }: { title: string; content: string }) {
  return (
    <section className="git-conflict-side">
      <strong>{title}</strong>
      <pre>{content || '此版本不存在内容。'}</pre>
    </section>
  );
}

function formatPullModeLabel(mode: GitPullMode) {
  return mode === 'merge' ? '合并拉取' : '变基拉取';
}

function formatOperationLabel(operation: GitOperationState['operation']) {
  if (operation === 'merge') {
    return '合并';
  }
  if (operation === 'rebase') {
    return '变基';
  }
  if (operation === 'cherry-pick') {
    return 'Cherry-pick';
  }
  if (operation === 'revert') {
    return 'Revert';
  }
  return 'Git 操作';
}
