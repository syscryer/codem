import { useEffect, useRef, useState, type FormEvent, type KeyboardEventHandler } from 'react';
import { ArrowUp, Check, Mic, Plus, Shield, Square, Unlock, X, Zap } from 'lucide-react';
import { permissionMenuModes } from '../constants';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { PopoverPortal } from './PopoverPortal';
import { buildPromptWithImageAttachments } from '../lib/composer-attachments';
import { modelLabel, modelTriggerLabel, permissionLabel } from '../lib/ui-labels';
import type { ClaudeModelOption, PermissionMode, UserImageAttachment } from '../types';

type PendingImageAttachment = {
  id: string;
  file: File;
  previewUrl: string;
};

type ComposerProps = {
  workspace: string;
  permissionMode: PermissionMode;
  model: string;
  models: ClaudeModelOption[];
  isRunning: boolean;
  queuedPrompts: Array<{ id: string; displayText: string; createdAtMs: number }>;
  onSubmitPrompt: (submission: {
    prompt: string;
    displayText: string;
    attachments?: UserImageAttachment[];
  }) => Promise<boolean> | boolean;
  onRemoveQueuedPrompt: (promptId: string) => void;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onSelectPermissionMode: (mode: PermissionMode) => void;
  onSelectModel: (model: string) => void;
  onStopRun: () => void | Promise<void>;
};

export function Composer({
  workspace,
  permissionMode,
  model,
  models,
  isRunning,
  queuedPrompts,
  onSubmitPrompt,
  onRemoveQueuedPrompt,
  showToast,
  onKeyDown,
  onSelectPermissionMode,
  onSelectModel,
  onStopRun,
}: ComposerProps) {
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<PendingImageAttachment[]>([]);
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const permissionMenuRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentsRef = useRef<PendingImageAttachment[]>([]);

  useOutsideDismiss({
    selectors: [
      { selector: '.permission-menu', onDismiss: () => setPermissionMenuOpen(false), anchorRefs: [permissionMenuRef] },
      { selector: '.model-menu', onDismiss: () => setModelMenuOpen(false), anchorRefs: [modelMenuRef] },
    ],
  });
  const hasDraft = Boolean(draft.trim());
  const hasPendingContent = hasDraft || attachments.length > 0;
  const showStopButton = isRunning && !hasPendingContent;

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    return () => {
      for (const attachment of attachmentsRef.current) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedDraft = draft;
    const submittedAttachments = attachments;
    if (!submittedDraft.trim() && submittedAttachments.length === 0) {
      if (isRunning) {
        await onStopRun();
      }
      return;
    }

    let finalPrompt = submittedDraft;
    let uploadedAttachments: UserImageAttachment[] | undefined;
    if (submittedAttachments.length > 0) {
      if (!workspace.trim()) {
        showToast('请先选择工作目录后再粘贴图片。', 'info');
        return;
      }

      try {
        uploadedAttachments = await uploadImageAttachments(submittedAttachments, workspace.trim());
        finalPrompt = buildPromptWithImageAttachments(
          submittedDraft,
          uploadedAttachments.map((attachment) => attachment.path),
        );
      } catch (error) {
        showToast(error instanceof Error ? error.message : '图片粘贴上传失败。', 'error');
        return;
      }
    }

    setDraft('');
    setAttachments([]);
    const submitted = await onSubmitPrompt({
      prompt: finalPrompt,
      displayText: submittedDraft.trim(),
      attachments: uploadedAttachments,
    });
    if (!submitted) {
      setDraft(submittedDraft);
      setAttachments(submittedAttachments);
      return;
    }

    for (const attachment of submittedAttachments) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((current) => {
      const target = current.find((item) => item.id === attachmentId);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((item) => item.id !== attachmentId);
    });
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = extractImageFiles(event.clipboardData.items);
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    await appendAttachments(files);
  }

  async function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []).filter((item) => item.type.startsWith('image/'));
    if (selectedFiles.length === 0) {
      return;
    }

    await appendAttachments(selectedFiles);
    event.target.value = '';
  }

  async function appendAttachments(files: File[]) {
    const nextAttachments = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setAttachments((current) => [...current, ...nextAttachments]);
    showToast(`已添加 ${nextAttachments.length} 张图片。`, 'success');
  }

  return (
    <form className="composer" onSubmit={(event) => void handleSubmit(event)}>
      <div className="composer-card">
        {queuedPrompts.length > 0 ? (
          <div className="composer-queued-prompts" aria-label="已排队提示">
            {queuedPrompts.map((prompt, index) => (
              <div key={prompt.id} className="composer-queued-prompt">
                <span className="composer-queued-index">{index + 1}</span>
                <span className="composer-queued-text">{prompt.displayText || '图片消息'}</span>
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
        {attachments.length > 0 ? (
          <div className="composer-attachments" aria-label="待发送图片">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="composer-attachment">
                <img src={attachment.previewUrl} alt={attachment.file.name || '粘贴图片'} className="composer-attachment-preview" />
                <div className="composer-attachment-meta">
                  <span className="composer-attachment-name">{attachment.file.name || 'pasted-image.png'}</span>
                  <span className="composer-attachment-size">{formatAttachmentSize(attachment.file.size)}</span>
                </div>
                <button
                  type="button"
                  className="composer-attachment-remove"
                  aria-label="移除图片"
                  title="移除图片"
                  onClick={() => removeAttachment(attachment.id)}
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
          onPaste={(event) => void handlePaste(event)}
          onKeyDown={onKeyDown}
          placeholder={isRunning ? '追加下一轮提示' : '要求后续变更'}
        />
        <div className="composer-toolbar">
          <div className="composer-left-tools">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="composer-file-input"
              onChange={(event) => void handleFileSelection(event)}
            />
            <button type="button" className="plain-icon" title="添加图片" onClick={() => fileInputRef.current?.click()}>
              <Plus size={16} />
            </button>
            <div className="permission-picker" ref={permissionMenuRef}>
              <PopoverPortal open={permissionMenuOpen} anchorRef={permissionMenuRef} placement="top-end">
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
                      <PermissionModeIcon mode={mode} size={15} />
                      <span>{permissionLabel(mode)}</span>
                      {permissionMode === mode ? <Check className="permission-check" size={14} /> : null}
                    </button>
                  ))}
                </div>
              </PopoverPortal>

              <button
                type="button"
                className="permission-trigger"
                aria-expanded={permissionMenuOpen}
                onClick={() => setPermissionMenuOpen((value) => !value)}
              >
                <PermissionModeIcon mode={permissionMode} size={15} />
                <span>{permissionLabel(permissionMode)}</span>
                <span className="permission-trigger-chevron" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="composer-right-tools">
            <div className="model-picker" ref={modelMenuRef}>
              <PopoverPortal open={modelMenuOpen} anchorRef={modelMenuRef} placement="top-end">
                <div className="model-menu" role="menu">
                  <div className="model-menu-title">模型</div>
                  {models.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="model-menu-item"
                      role="menuitemradio"
                      aria-checked={model === item.id}
                      onClick={() => {
                        onSelectModel(item.id);
                        setModelMenuOpen(false);
                      }}
                    >
                      <span className="model-menu-item-copy">
                        <span>{modelLabel(item)}</span>
                        {item.description ? <small>{item.description}</small> : null}
                      </span>
                      {model === item.id ? <Check className="model-check" size={15} /> : null}
                    </button>
                  ))}
                </div>
              </PopoverPortal>

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
              <button type="submit" className="send-button" disabled={!hasPendingContent} title={isRunning ? '排队下一轮提示' : '发送'}>
                <ArrowUp size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

function extractImageFiles(items: DataTransferItemList) {
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) {
      continue;
    }
    const file = item.getAsFile();
    if (file) {
      files.push(file);
    }
  }
  return files;
}

async function uploadImageAttachments(attachments: PendingImageAttachment[], workingDirectory: string) {
  const uploadedAttachments: UserImageAttachment[] = [];

  for (const attachment of attachments) {
    const dataUrl = await readFileAsDataUrl(attachment.file);
    const response = await fetch('/api/system/attachments/image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workingDirectory,
        fileName: attachment.file.name,
        mimeType: attachment.file.type,
        dataUrl,
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || '图片上传失败');
    }

    const payload = await response.json() as {
      path: string;
      mimeType?: string;
      size?: number;
      name?: string;
    };
    uploadedAttachments.push({
      id: attachment.id,
      path: payload.path,
      mimeType: payload.mimeType || attachment.file.type,
      size: typeof payload.size === 'number' ? payload.size : attachment.file.size,
      name: payload.name || attachment.file.name || 'pasted-image.png',
    });
  }

  return uploadedAttachments;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('图片读取失败'));
    };
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

function formatAttachmentSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function PermissionModeIcon({ mode, size }: { mode: PermissionMode; size: number }) {
  if (mode === 'auto') {
    return <Zap className="permission-lucide-icon" size={size} aria-hidden="true" />;
  }

  if (mode === 'bypassPermissions') {
    return <Unlock className="permission-lucide-icon" size={size} aria-hidden="true" />;
  }

  return <Shield className="permission-lucide-icon" size={size} aria-hidden="true" />;
}
