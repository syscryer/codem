import { useRef, useState, type FormEvent, type KeyboardEventHandler } from 'react';
import { ArrowUp, Check, Mic, Plus, Square, X } from 'lucide-react';
import { permissionMenuModes } from '../constants';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { modelLabel, modelTriggerLabel, permissionLabel } from '../lib/ui-labels';
import type { PermissionMode } from '../types';

type ComposerProps = {
  permissionMode: PermissionMode;
  model: string;
  models: string[];
  isRunning: boolean;
  queuedPrompts: Array<{ id: string; text: string; createdAtMs: number }>;
  onSubmitPrompt: (prompt: string) => Promise<boolean> | boolean;
  onRemoveQueuedPrompt: (promptId: string) => void;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onSelectPermissionMode: (mode: PermissionMode) => void;
  onSelectModel: (model: string) => void;
  onStopRun: () => void | Promise<void>;
};

export function Composer({
  permissionMode,
  model,
  models,
  isRunning,
  queuedPrompts,
  onSubmitPrompt,
  onRemoveQueuedPrompt,
  onKeyDown,
  onSelectPermissionMode,
  onSelectModel,
  onStopRun,
}: ComposerProps) {
  const [draft, setDraft] = useState('');
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const permissionMenuRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);

  useOutsideDismiss({
    refs: [
      { ref: permissionMenuRef, onDismiss: () => setPermissionMenuOpen(false) },
      { ref: modelMenuRef, onDismiss: () => setModelMenuOpen(false) },
    ],
  });
  const hasDraft = Boolean(draft.trim());
  const showStopButton = isRunning && !hasDraft;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedDraft = draft;
    if (!submittedDraft.trim()) {
      if (isRunning) {
        await onStopRun();
      }
      return;
    }

    setDraft('');
    const submitted = await onSubmitPrompt(submittedDraft);
    if (!submitted) {
      setDraft(submittedDraft);
    }
  }

  return (
    <form className="composer" onSubmit={(event) => void handleSubmit(event)}>
      <div className="composer-card">
        {queuedPrompts.length > 0 ? (
          <div className="composer-queued-prompts" aria-label="已排队提示">
            {queuedPrompts.map((prompt, index) => (
              <div key={prompt.id} className="composer-queued-prompt">
                <span className="composer-queued-index">{index + 1}</span>
                <span className="composer-queued-text">{prompt.text}</span>
                <button
                  type="button"
                  className="composer-queued-remove"
                  aria-label="取消排队提示"
                  title="取消排队"
                  onClick={() => onRemoveQueuedPrompt(prompt.id)}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          className="composer-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={isRunning ? '追加下一轮提示' : '要求后续变更'}
        />
        <div className="composer-toolbar">
          <div className="composer-left-tools">
            <button type="button" className="plain-icon"><Plus size={16} /></button>
            <div className="permission-picker" ref={permissionMenuRef}>
              {permissionMenuOpen ? (
                <div className="permission-menu" role="menu">
                  {permissionMenuModes.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className="permission-menu-item"
                      role="menuitemradio"
                      aria-checked={permissionMode === mode}
                      onClick={() => {
                        onSelectPermissionMode(mode);
                        setPermissionMenuOpen(false);
                      }}
                    >
                      <span className={`permission-icon permission-icon-${mode}`} aria-hidden="true" />
                      <span>{permissionLabel(mode)}</span>
                      {permissionMode === mode ? <Check className="permission-check" size={14} /> : null}
                    </button>
                  ))}
                </div>
              ) : null}

              <button
                type="button"
                className="permission-trigger"
                aria-expanded={permissionMenuOpen}
                onClick={() => setPermissionMenuOpen((value) => !value)}
              >
                <span className="permission-trigger-icon" aria-hidden="true" />
                <span>{permissionLabel(permissionMode)}</span>
                <span className="permission-trigger-chevron" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="composer-right-tools">
            <div className="model-picker" ref={modelMenuRef}>
              {modelMenuOpen ? (
                <div className="model-menu" role="menu">
                  <div className="model-menu-title">模型</div>
                  {models.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="model-menu-item"
                      role="menuitemradio"
                      aria-checked={model === item}
                      onClick={() => {
                        onSelectModel(item);
                        setModelMenuOpen(false);
                      }}
                    >
                      <span>{modelLabel(item)}</span>
                      {model === item ? <Check className="model-check" size={15} /> : null}
                    </button>
                  ))}
                </div>
              ) : null}

              <button
                type="button"
                className="model-trigger"
                aria-expanded={modelMenuOpen}
                disabled={models.length === 0 || isRunning}
                title="Claude Code model"
                onClick={() => setModelMenuOpen((value) => !value)}
              >
                <span>{modelTriggerLabel(model, models)}</span>
                <span className="model-trigger-chevron" aria-hidden="true" />
              </button>
            </div>
            <button type="button" className="plain-icon"><Mic size={15} /></button>
            {showStopButton ? (
              <button type="button" className="send-button stop" onClick={() => void onStopRun()} title="停止">
                <Square size={13} fill="currentColor" />
              </button>
            ) : (
              <button type="submit" className="send-button" disabled={!hasDraft} title={isRunning ? '排队下一轮提示' : '发送'}>
                <ArrowUp size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
