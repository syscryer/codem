import type { ConfirmDialogState, InputDialogState, ToastState } from '../types';

type DialogsProps = {
  inputDialog: InputDialogState | null;
  confirmDialog: ConfirmDialogState;
  toast: ToastState | null;
  onCloseInputDialog: () => void;
  onInputDialogValueChange: (value: string) => void;
  onSubmitInputDialog: () => void | Promise<void>;
  onCloseConfirmDialog: () => void;
  onConfirmRemoveDialog: () => void | Promise<void>;
};

export function Dialogs({
  inputDialog,
  confirmDialog,
  toast,
  onCloseInputDialog,
  onInputDialogValueChange,
  onSubmitInputDialog,
  onCloseConfirmDialog,
  onConfirmRemoveDialog,
}: DialogsProps) {
  return (
    <>
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
