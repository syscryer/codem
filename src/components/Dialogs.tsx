import { useState } from 'react';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ConfirmDialogState,
  ConversationTurn,
  InputDialogState,
  ToastState,
} from '../types';

type DialogsProps = {
  approvalDialog: {
    turn: ConversationTurn;
    request: ApprovalRequest;
  } | null;
  inputDialog: InputDialogState | null;
  confirmDialog: ConfirmDialogState;
  toast: ToastState | null;
  onCloseApprovalDialog: () => void;
  onSubmitApprovalDecision: (
    turn: ConversationTurn,
    request: ApprovalRequest,
    decision: ApprovalDecision,
  ) => Promise<boolean>;
  onCloseInputDialog: () => void;
  onInputDialogValueChange: (value: string) => void;
  onSubmitInputDialog: () => void | Promise<void>;
  onCloseConfirmDialog: () => void;
  onConfirmRemoveDialog: () => void | Promise<void>;
};

export function Dialogs({
  approvalDialog,
  inputDialog,
  confirmDialog,
  toast,
  onCloseApprovalDialog,
  onSubmitApprovalDecision,
  onCloseInputDialog,
  onInputDialogValueChange,
  onSubmitInputDialog,
  onCloseConfirmDialog,
  onConfirmRemoveDialog,
}: DialogsProps) {
  return (
    <>
      {approvalDialog ? (
        <ApprovalRequestDialog
          turn={approvalDialog.turn}
          request={approvalDialog.request}
          onClose={onCloseApprovalDialog}
          onSubmitApprovalDecision={onSubmitApprovalDecision}
        />
      ) : null}

      {inputDialog ? (
        <div className="dialog-backdrop" role="presentation" onClick={onCloseInputDialog}>
          <div className="dialog-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-head">
              <h3>{inputDialog.title}</h3>
              <p>{inputDialog.description}</p>
            </div>
            <form
              className="dialog-form"
              onSubmit={(event) => {
                event.preventDefault();
                void onSubmitInputDialog();
              }}
            >
              <input
                autoFocus
                className="dialog-input"
                value={inputDialog.value}
                onChange={(event) => onInputDialogValueChange(event.target.value)}
              />
              <div className="dialog-actions">
                <button type="button" className="dialog-button secondary" onClick={onCloseInputDialog}>
                  取消
                </button>
                <button type="submit" className="dialog-button primary">
                  {inputDialog.confirmLabel}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {confirmDialog ? (
        <div className="dialog-backdrop" role="presentation" onClick={onCloseConfirmDialog}>
          <div className="dialog-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-head">
              <h3>{confirmDialog.title}</h3>
              <p>{confirmDialog.description}</p>
            </div>
            <div className="dialog-actions">
              <button type="button" className="dialog-button secondary" onClick={onCloseConfirmDialog}>
                取消
              </button>
              <button type="button" className="dialog-button danger" onClick={() => void onConfirmRemoveDialog()}>
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? <div className={`app-toast ${toast.tone}`}>{toast.message}</div> : null}
    </>
  );
}

function ApprovalRequestDialog({
  turn,
  request,
  onClose,
  onSubmitApprovalDecision,
}: {
  turn: ConversationTurn;
  request: ApprovalRequest;
  onClose: () => void;
  onSubmitApprovalDecision: (
    turn: ConversationTurn,
    request: ApprovalRequest,
    decision: ApprovalDecision,
  ) => Promise<boolean>;
}) {
  const [submittingDecision, setSubmittingDecision] = useState<ApprovalDecision | null>(null);
  const [submitError, setSubmitError] = useState('');

  async function handleDecision(decision: ApprovalDecision) {
    setSubmitError('');
    setSubmittingDecision(decision);
    try {
      const submitted = await onSubmitApprovalDecision(turn, request, decision);
      if (!submitted) {
        setSubmitError('操作未完成，请稍后重试。');
        return;
      }

      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '操作失败，请稍后重试。');
    } finally {
      setSubmittingDecision(null);
    }
  }

  const actionLocked = Boolean(submittingDecision);
  const planApproval = isPlanApprovalRequest(request);
  const footnote =
    planApproval
      ? '批准后继续执行计划；拒绝后会让 Claude 重新调整。'
      : request.danger === 'high'
      ? '该操作风险较高，批准前请确认目标范围。'
      : '批准后会以完全访问模式继续当前任务。';

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={() => {
        if (!actionLocked) {
          onClose();
        }
      }}
    >
      <div
        className="dialog-card approval-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <div className="dialog-badge-row">
            <span className="assistant-runtime-badge caution">{planApproval ? '计划确认' : '等待批准'}</span>
          </div>
          <h3 id="approval-dialog-title">{request.title}</h3>
          <p>{planApproval ? '请确认是否按这个计划继续。' : request.description || '该操作需要确认后才能继续。'}</p>
        </div>

        {planApproval && request.description ? (
          <pre className="assistant-runtime-code dialog-code plan-approval-code">{request.description}</pre>
        ) : null}

        {request.command?.length ? (
          <pre className="assistant-runtime-code dialog-code">{request.command.join(' ')}</pre>
        ) : null}

        <p className="assistant-runtime-footnote dialog-footnote">{footnote}</p>

        <div className="dialog-actions approval-dialog-actions">
          <button
            type="button"
            className="dialog-button secondary"
            disabled={actionLocked}
            onClick={onClose}
          >
            稍后处理
          </button>
          <button
            type="button"
            className="dialog-button danger"
            disabled={actionLocked}
            onClick={() => void handleDecision('reject')}
          >
            {submittingDecision === 'reject' ? '处理中...' : '拒绝'}
          </button>
          <button
            type="button"
            className="dialog-button primary"
            disabled={actionLocked}
            onClick={() => void handleDecision('approve')}
          >
            {submittingDecision === 'approve' ? '处理中...' : '批准并继续'}
          </button>
        </div>

        {submitError ? <div className="assistant-runtime-error dialog-error">{submitError}</div> : null}
      </div>
    </div>
  );
}

function isPlanApprovalRequest(request: ApprovalRequest) {
  return request.title === '计划待确认';
}
