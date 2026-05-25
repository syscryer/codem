import { useEffect, useRef, useState, type FormEvent, type KeyboardEventHandler } from 'react';
import { ArrowUp, Brain, Check, CornerDownRight, File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, Folder, Image, Mic, Pencil, Plus, Puzzle, Settings, Shield, Square, Unlock, X, Zap, type LucideIcon } from 'lucide-react';
import { permissionMenuModes } from '../constants';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { useSlashCommands } from '../hooks/useSlashCommands';
import { buildComposerContextUsage } from '../lib/composer-context-usage';
import { classifyComposerFile, supportedComposerUploadAccept } from '../lib/composer-input-files';
import { extractAtFileReferences, normalizePathForComparison, shouldSearchFileReferenceQuery } from '../lib/file-reference-paths';
import { getWorkbenchFileIconKind, resolveWorkbenchFileIcon } from '../lib/workbench-files';
import { PopoverPortal } from './PopoverPortal';
import { ComposerContextIndicator } from './ComposerContextIndicator';
import { SlashCommandMenu } from './SlashCommandMenu';
import { hasClaudeContext1mOptions } from '../lib/claude-model-selection';
import { applySlashCommandSelection, getNextSlashCommandIndex } from '../lib/slash-command-editor';
import { getSlashDismissResetKey, resolveSlashCommandSubmission } from '../lib/slash-command-submit';
import { modelContext1mMenuActionLabel, modelMenuDescriptionLabel, modelMenuPrimaryLabel, modelTriggerLabel, permissionLabel } from '../lib/ui-labels';
import type { AgentType, ClaudeEffortSelection, ClaudeModelOption, ConversationTurn, InputContentBlock, PermissionMode, SlashCommand, UserImageAttachment } from '../types';

type PendingComposerAttachment =
  | {
      id: string;
      kind: 'image';
      file: File;
      previewUrl: string;
    }
  | {
      id: string;
      kind: 'file_text';
      file: File;
      text: string;
    }
  | {
      id: string;
      kind: 'file_reference';
      file: File;
      reason: 'too_large' | 'unsupported';
    };

type FileReferenceSearchResult = {
  path: string;
  rel: string;
  isDirectory: boolean;
};

const claudeEffortOptions: Array<{
  value: ClaudeEffortSelection;
  label: string;
  description: string;
}> = [
  { value: 'default', label: '默认', description: '使用 Claude Code 默认思考级别' },
  { value: 'low', label: 'Low', description: '更快，适合简单修改' },
  { value: 'medium', label: 'Medium', description: '平衡速度和推理' },
  { value: 'high', label: 'High', description: '复杂代码和排查问题' },
  { value: 'xhigh', label: 'XHigh', description: '更深入的推理' },
  { value: 'max', label: 'Max', description: '当前会话最高努力级别' },
];

type ComposerProps = {
  agent: AgentType;
  workspace: string;
  permissionMode: PermissionMode;
  model: string;
  effort: ClaudeEffortSelection;
  models: ClaudeModelOption[];
  turns: ConversationTurn[];
  isRunning: boolean;
  draftScopeKey: string;
  draft: string;
  queuedPrompts: Array<{ id: string; displayText: string; createdAtMs: number }>;
  queuedPromptGuideAvailability: { available: boolean; reason?: string };
  onDraftChange: (value: string) => void;
  onSubmitPrompt: (submission: {
    prompt: string;
    displayText: string;
    attachments?: UserImageAttachment[];
    contentBlocks?: InputContentBlock[];
  }) => Promise<boolean> | boolean;
  onRemoveQueuedPrompt: (promptId: string) => void;
  onRecallQueuedPrompt: (promptId: string) => void;
  onGuideQueuedPrompt: (promptId: string) => Promise<boolean> | boolean;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onSelectPermissionMode: (mode: PermissionMode) => void;
  onSelectModel: (model: string) => void;
  onSelectEffort: (effort: ClaudeEffortSelection) => void;
  onOpenPlugins: () => void;
  onCreateNewChat: () => Promise<void> | void;
  onStopRun: () => void | Promise<void>;
  onRunSlashSystemCommand: (command: SlashCommand, submittedText: string) => Promise<void> | void;
};

export function Composer({
  agent,
  workspace,
  permissionMode,
  model,
  effort,
  models,
  turns,
  isRunning,
  draftScopeKey,
  draft,
  queuedPrompts,
  queuedPromptGuideAvailability,
  onDraftChange,
  onSubmitPrompt,
  onRemoveQueuedPrompt,
  onRecallQueuedPrompt,
  onGuideQueuedPrompt,
  showToast,
  onKeyDown,
  onSelectPermissionMode,
  onSelectModel,
  onSelectEffort,
  onOpenPlugins,
  onCreateNewChat,
  onStopRun,
  onRunSlashSystemCommand,
}: ComposerProps) {
  const [attachments, setAttachments] = useState<PendingComposerAttachment[]>([]);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);
  const permissionMenuRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const effortMenuRef = useRef<HTMLDivElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerCardRef = useRef<HTMLDivElement | null>(null);
  const fileReferenceMenuRef = useRef<HTMLDivElement | null>(null);
  const fileReferenceItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const attachmentsRef = useRef<PendingComposerAttachment[]>([]);
  const draftScopeKeyRef = useRef(draftScopeKey);
  const pendingSelectionRef = useRef<{ start: number; end: number; restoreFocus: boolean } | null>(null);
  const [selectionStart, setSelectionStart] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);
  const [fileReferenceResults, setFileReferenceResults] = useState<FileReferenceSearchResult[]>([]);
  const [fileReferenceLoading, setFileReferenceLoading] = useState(false);
  const [fileReferenceSelectedIndex, setFileReferenceSelectedIndex] = useState(0);
  const [fileReferenceMenuDismissed, setFileReferenceMenuDismissed] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false);
  const activeFileReferenceToken = getActiveFileReferenceToken(draft, selectionStart, selectionEnd);
  const fileReferenceMenuOpen = Boolean(activeFileReferenceToken && workspace.trim() && !fileReferenceMenuDismissed);

  const {
    commands: slashCommands,
    filteredCommands,
    open: slashMenuOpen,
    loading: slashCommandsLoading,
    query: slashQuery,
    context: slashContext,
  } = useSlashCommands({
    projectPath: workspace.trim() || undefined,
    activeAgent: agent,
    draft,
    selectionStart,
    showToast,
  });

  useOutsideDismiss({
    selectors: [
      { selector: '.composer-add-menu', onDismiss: () => setAddMenuOpen(false), anchorRefs: [addMenuRef] },
      { selector: '.permission-menu', onDismiss: () => setPermissionMenuOpen(false), anchorRefs: [permissionMenuRef] },
      { selector: '.model-menu', onDismiss: () => setModelMenuOpen(false), anchorRefs: [modelMenuRef] },
      { selector: '.effort-menu', onDismiss: () => setEffortMenuOpen(false), anchorRefs: [effortMenuRef] },
      {
        selector: '.composer-file-reference-menu',
        onDismiss: () => setFileReferenceMenuDismissed(true),
        anchorRefs: [composerCardRef],
      },
    ],
  });
  const hasDraft = Boolean(draft.trim());
  const hasPendingContent = hasDraft || attachments.length > 0;
  const showStopButton = isRunning && !hasPendingContent;
  const contextUsage = buildComposerContextUsage({ agent, model, turns });
  const modelMenuHasContext1mOptions = hasClaudeContext1mOptions(models);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    draftScopeKeyRef.current = draftScopeKey;
  }, [draftScopeKey]);

  useEffect(() => {
    disposeAttachmentPreviews(attachmentsRef.current);
    attachmentsRef.current = [];
    setAttachments([]);
    setSelectionStart(draft.length);
    setSelectionEnd(draft.length);
    setSlashMenuDismissed(false);
  }, [draftScopeKey]);

  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [draft, selectionStart, filteredCommands.length]);

  useEffect(() => {
    setFileReferenceSelectedIndex(0);
  }, [activeFileReferenceToken?.query, fileReferenceResults.length]);

  useEffect(() => {
    if (!fileReferenceMenuOpen || fileReferenceLoading || fileReferenceResults.length === 0) {
      return;
    }

    const container = fileReferenceMenuRef.current;
    const selectedItem = fileReferenceItemRefs.current[fileReferenceSelectedIndex];
    if (!container || !selectedItem) {
      return;
    }

    // 在 fixed PopoverPortal 容器内手动算偏移，避免 scrollIntoView 在某些浏览器把"部分可见"判断成"无需滚动"。
    const itemTop = selectedItem.offsetTop;
    const itemBottom = itemTop + selectedItem.offsetHeight;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;

    if (itemTop < viewTop) {
      container.scrollTop = Math.max(0, itemTop);
    } else if (itemBottom > viewBottom) {
      container.scrollTop = itemBottom - container.clientHeight;
    }
  }, [fileReferenceLoading, fileReferenceMenuOpen, fileReferenceResults.length, fileReferenceSelectedIndex]);

  useEffect(() => {
    setFileReferenceMenuDismissed(false);
  }, [activeFileReferenceToken?.start, activeFileReferenceToken?.end, activeFileReferenceToken?.query]);

  useEffect(() => {
    setSlashMenuDismissed(false);
  }, [getSlashDismissResetKey(slashContext)]);

  useEffect(() => {
    const pendingSelection = pendingSelectionRef.current;
    if (!pendingSelection) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      const latestSelection = pendingSelectionRef.current;
      if (!textarea || !latestSelection) {
        return;
      }

      pendingSelectionRef.current = null;
      if (latestSelection.restoreFocus && document.activeElement !== textarea) {
        textarea.focus({ preventScroll: true });
      }
      if (textarea.selectionStart !== latestSelection.start || textarea.selectionEnd !== latestSelection.end) {
        textarea.setSelectionRange(latestSelection.start, latestSelection.end);
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [draft, selectionStart, selectionEnd]);

  useEffect(() => {
    if (!activeFileReferenceToken || !workspace.trim() || !shouldSearchFileReferenceQuery(activeFileReferenceToken.query)) {
      setFileReferenceLoading(false);
      setFileReferenceResults([]);
      return;
    }

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setFileReferenceLoading(true);
      try {
        const params = new URLSearchParams({
          workingDirectory: workspace.trim(),
          query: activeFileReferenceToken.query,
        });
        const response = await fetch(`/api/system/files/search?${params.toString()}`, {
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }

        const payload = await response.json() as { files?: FileReferenceSearchResult[] };
        setFileReferenceResults(Array.isArray(payload.files) ? payload.files : []);
      } catch (error) {
        if ((error as { name?: string }).name !== 'AbortError') {
          setFileReferenceResults([]);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setFileReferenceLoading(false);
        }
      }
    }, 180);

    return () => {
      abortController.abort();
      window.clearTimeout(timeoutId);
    };
  }, [activeFileReferenceToken?.query, workspace]);

  useEffect(() => {
    return () => {
      disposeAttachmentPreviews(attachmentsRef.current);
    };
  }, []);

  function setDraft(nextDraft: string) {
    onDraftChange(nextDraft);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedDraft = draft;
    const submittedAttachments = attachments;
    const submitDraftScopeKey = draftScopeKeyRef.current;
    const localActionResolution = resolveSlashCommandSubmission(submittedDraft, slashCommands);

    if (localActionResolution) {
      disposeAttachmentPreviews(submittedAttachments);
      setDraft('');
      setAttachments([]);
      setSelectionStart(0);
      setSelectionEnd(0);

      if (localActionResolution.kind === 'clear-thread') {
        await onCreateNewChat();
        return;
      }

      await onRunSlashSystemCommand(localActionResolution.command, submittedDraft.trim());
      return;
    }

    if (!submittedDraft.trim() && submittedAttachments.length === 0) {
      if (isRunning) {
        await onStopRun();
      }
      return;
    }

    const contentBlocks: InputContentBlock[] = [];
    const trimmedDraft = submittedDraft.trim();
    if (trimmedDraft) {
      contentBlocks.push({
        type: 'text',
        text: trimmedDraft,
      });
    }

    if (workspace.trim()) {
      const fileReferenceBlocks = await resolveExistingFileReferenceBlocks(submittedDraft, workspace.trim());
      contentBlocks.push(...fileReferenceBlocks);
    }

    let uploadedAttachments: UserImageAttachment[] | undefined;
    const imageAttachments = submittedAttachments.filter((attachment) => attachment.kind === 'image');
    if (submittedAttachments.length > 0) {
      if (!workspace.trim()) {
        showToast('请先选择工作目录后再添加附件。', 'info');
        return;
      }
    }

    if (imageAttachments.length > 0) {
      try {
        uploadedAttachments = await uploadImageAttachments(imageAttachments, workspace.trim());
      } catch (error) {
        showToast(error instanceof Error ? error.message : '图片粘贴上传失败。', 'error');
        return;
      }
    }

    const uploadedImageAttachmentsById = new Map(uploadedAttachments?.map((attachment) => [attachment.id, attachment]) ?? []);

    for (const attachment of submittedAttachments) {
      if (attachment.kind === 'image') {
        const uploadedImage = uploadedImageAttachmentsById.get(attachment.id);
        if (uploadedImage) {
          contentBlocks.push({
            type: 'image',
            id: uploadedImage.id,
            path: uploadedImage.path,
            name: uploadedImage.name,
            mimeType: uploadedImage.mimeType,
            size: uploadedImage.size,
            data: uploadedImage.data,
          });
        }
        continue;
      }

      if (attachment.kind === 'file_text') {
        contentBlocks.push({
          type: 'file_text',
          id: attachment.id,
          path: attachment.file.name,
          name: attachment.file.name || 'file.txt',
          mimeType: attachment.file.type || 'text/plain',
          size: attachment.file.size,
          text: attachment.text,
        });
        continue;
      }

      if (attachment.kind === 'file_reference') {
        contentBlocks.push({
          type: 'attachment_metadata',
          id: attachment.id,
          name: attachment.file.name || 'file',
          mimeType: attachment.file.type || undefined,
          size: attachment.file.size,
          reason: attachment.reason === 'too_large' ? '文件超过 1MB，第一阶段不会内联发送。' : '文件类型暂不支持。',
        });
      }
    }

    setDraft('');
    setAttachments([]);
    const submitted = await onSubmitPrompt({
      prompt: submittedDraft,
      displayText: trimmedDraft,
      attachments: uploadedAttachments,
      contentBlocks,
    });
    if (!submitted) {
      if (draftScopeKeyRef.current === submitDraftScopeKey) {
        setDraft(submittedDraft);
        setAttachments(submittedAttachments);
      } else {
        disposeAttachmentPreviews(submittedAttachments);
      }
      return;
    }

    disposeAttachmentPreviews(submittedAttachments);
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((current) => {
      const target = current.find((item) => item.id === attachmentId);
      if (target?.kind === 'image') {
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
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (selectedFiles.length === 0) {
      return;
    }

    await appendAttachments(selectedFiles);
  }

  async function appendAttachments(files: File[]) {
    const nextAttachments: PendingComposerAttachment[] = [];
    let imageCount = 0;
    let fileTextCount = 0;
    let fileReferenceCount = 0;
    let skippedCount = 0;

    try {
      for (const file of files) {
        const classification = classifyComposerFile(file);
        if (classification.kind === 'image') {
          nextAttachments.push({
            id: crypto.randomUUID(),
            kind: 'image',
            file,
            previewUrl: URL.createObjectURL(file),
          });
          imageCount += 1;
          continue;
        }

        if (classification.kind === 'text') {
          nextAttachments.push({
            id: crypto.randomUUID(),
            kind: 'file_text',
            file,
            text: await readFileAsText(file),
          });
          fileTextCount += 1;
          continue;
        }

        if (classification.kind === 'reference') {
          nextAttachments.push({
            id: crypto.randomUUID(),
            kind: 'file_reference',
            file,
            reason: classification.reason,
          });
          fileReferenceCount += 1;
          continue;
        }

        skippedCount += 1;
      }
    } catch (error) {
      disposeAttachmentPreviews(nextAttachments);
      showToast(error instanceof Error ? error.message : '附件读取失败。', 'error');
      return;
    }

    if (nextAttachments.length === 0) {
      showToast('当前只支持图片和 1MB 以内的文本/代码文件。', 'info');
      return;
    }

    setAttachments((current) => [...current, ...nextAttachments]);
    const summaryParts = [
      imageCount > 0 ? `${imageCount} 张图片` : '',
      fileTextCount > 0 ? `${fileTextCount} 个文本文件` : '',
      fileReferenceCount > 0 ? `${fileReferenceCount} 个大文件引用` : '',
      skippedCount > 0 ? `跳过 ${skippedCount} 个不支持的文件` : '',
    ].filter(Boolean);
    showToast(`已添加${summaryParts.join('，')}。`, skippedCount > 0 ? 'info' : 'success');
  }

  function updateDraftSelection(
    nextSelectionStart: number,
    nextSelectionEnd = nextSelectionStart,
    options?: { restoreFocus?: boolean },
  ) {
    pendingSelectionRef.current = {
      start: nextSelectionStart,
      end: nextSelectionEnd,
      restoreFocus: Boolean(options?.restoreFocus),
    };
    setSelectionStart(nextSelectionStart);
    setSelectionEnd(nextSelectionEnd);
  }

  function handleDraftChange(nextDraft: string, nextSelectionStartValue?: number, nextSelectionEndValue?: number) {
    setDraft(nextDraft);
    setSelectionStart(nextSelectionStartValue ?? nextDraft.length);
    setSelectionEnd(nextSelectionEndValue ?? nextSelectionStartValue ?? nextDraft.length);
  }

  async function executeLocalSlashCommand(command: SlashCommand) {
    setSlashMenuDismissed(true);
    disposeAttachmentPreviews(attachmentsRef.current);
    setDraft('');
    setAttachments([]);
    setSelectionStart(0);
    setSelectionEnd(0);

    if (command.localActionId === 'clear-thread') {
      await onCreateNewChat();
      return;
    }

    await onRunSlashSystemCommand(command, command.slash);
  }

  function applySelectedSlashCommand(command = filteredCommands[slashSelectedIndex]) {
    if (!command || !textareaRef.current) {
      return;
    }

    if (command.action === 'local-action') {
      void executeLocalSlashCommand(command);
      return;
    }

    setSlashMenuDismissed(false);
    const result = applySlashCommandSelection(draft, selectionStart, selectionEnd, command);
    handleDraftChange(result.text, result.selectionStart, result.selectionEnd);
    updateDraftSelection(result.selectionStart, result.selectionEnd);
  }

  function applyFileReference(file: FileReferenceSearchResult) {
    if (!activeFileReferenceToken) {
      return;
    }

    // 路径含空格/引号/反引号时，未加引号的 @ 引用会被 extractAtFileReferences 截断到首个空格前，
    // 必须用 @"..." 形式插入，发送时才能被正确解析为 file_reference block。
    const needsQuoting = /[\s"'`]/.test(file.rel);
    const replacement = needsQuoting ? `@"${file.rel}" ` : `@${file.rel} `;
    const nextDraft = `${draft.slice(0, activeFileReferenceToken.start)}${replacement}${draft.slice(activeFileReferenceToken.end)}`;
    const nextSelection = activeFileReferenceToken.start + replacement.length;
    handleDraftChange(nextDraft, nextSelection, nextSelection);
    updateDraftSelection(nextSelection, nextSelection);
    setFileReferenceResults([]);
    setFileReferenceLoading(false);
    setFileReferenceMenuDismissed(true);
  }

  function handleComposerInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (fileReferenceMenuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setFileReferenceSelectedIndex((current) => {
          if (fileReferenceResults.length === 0) {
            return 0;
          }
          return (current + 1) % fileReferenceResults.length;
        });
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setFileReferenceSelectedIndex((current) => {
          if (fileReferenceResults.length === 0) {
            return 0;
          }
          return (current - 1 + fileReferenceResults.length) % fileReferenceResults.length;
        });
        return;
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && fileReferenceResults.length > 0) {
        event.preventDefault();
        applyFileReference(fileReferenceResults[fileReferenceSelectedIndex] ?? fileReferenceResults[0]);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setFileReferenceMenuDismissed(true);
        return;
      }
    }

    const slashMenuVisible = slashMenuOpen && !slashMenuDismissed;

    if (slashMenuVisible && filteredCommands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashSelectedIndex((current) => getNextSlashCommandIndex(current, 'next', filteredCommands.length));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashSelectedIndex((current) => getNextSlashCommandIndex(current, 'previous', filteredCommands.length));
        return;
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        applySelectedSlashCommand();
        return;
      }
    }

    if (slashMenuVisible && event.key === 'Escape') {
      event.preventDefault();
      setSlashMenuDismissed(true);
      return;
    }

    onKeyDown(event);
  }

  return (
    <form className="composer" onSubmit={(event) => void handleSubmit(event)}>
      <div ref={composerCardRef} className="composer-card">
        <PopoverPortal
          open={fileReferenceMenuOpen}
          anchorRef={composerCardRef}
          placement="top-start"
          offset={10}
          matchAnchorWidth
        >
          <div ref={fileReferenceMenuRef} className="model-menu model-menu-compact composer-file-reference-menu" role="listbox" aria-label="@文件引用">
            <div className="model-menu-title">@文件</div>
            {fileReferenceLoading ? <div className="model-menu-item">搜索中...</div> : null}
            {!fileReferenceLoading && activeFileReferenceToken && !shouldSearchFileReferenceQuery(activeFileReferenceToken.query) ? (
              <div className="model-menu-item">输入文件名或路径后开始搜索</div>
            ) : null}
            {!fileReferenceLoading && activeFileReferenceToken && shouldSearchFileReferenceQuery(activeFileReferenceToken.query) && fileReferenceResults.length === 0 ? (
              <div className="model-menu-item">未找到匹配文件</div>
            ) : null}
            {!fileReferenceLoading
              ? fileReferenceResults.map((file, index) => (
                  <button
                    key={file.path}
                    ref={(element) => {
                      fileReferenceItemRefs.current[index] = element;
                    }}
                    type="button"
                    className="model-menu-item"
                    role="option"
                    aria-selected={index === fileReferenceSelectedIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyFileReference(file)}
                    >
                      <span className="composer-file-reference-row">
                        <ComposerFileReferenceIcon path={file.rel} isDirectory={file.isDirectory} />
                        <span className="composer-file-reference-copy">
                          <span className="composer-file-reference-name">{getPathBasename(file.rel)}</span>
                          {(() => {
                            const directoryLabel = getPathDirectoryLabel(file.rel);
                            return directoryLabel ? (
                              <span className="composer-file-reference-path">{directoryLabel}</span>
                            ) : null;
                          })()}
                        </span>
                      </span>
                      {index === fileReferenceSelectedIndex ? <Check className="model-check" size={15} /> : null}
                    </button>
                ))
              : null}
          </div>
        </PopoverPortal>
        <PopoverPortal
          open={slashMenuOpen && !slashMenuDismissed}
          anchorRef={composerCardRef}
          placement="top-start"
          offset={10}
          matchAnchorWidth
        >
          <SlashCommandMenu
            commands={filteredCommands}
            selectedIndex={slashSelectedIndex}
            loading={slashCommandsLoading}
            query={slashQuery}
            onSelect={(command) => {
              void applySelectedSlashCommand(command);
            }}
          />
        </PopoverPortal>
        {queuedPrompts.length > 0 ? (
          <div className="composer-queued-prompts" aria-label="已排队提示">
            <div className="composer-queued-head">
              <span>排队中，当前回复完成后发送</span>
              {!queuedPromptGuideAvailability.available && queuedPromptGuideAvailability.reason ? (
                <small>{queuedPromptGuideAvailability.reason}</small>
              ) : null}
            </div>
            {queuedPrompts.map((prompt, index) => (
              <div key={prompt.id} className="composer-queued-prompt">
                <span className="composer-queued-index">{index + 1}</span>
                <span className="composer-queued-text">{prompt.displayText || '图片消息'}</span>
                <div className="composer-queued-actions">
                  <button
                    type="button"
                    className="composer-queued-action"
                    aria-label="立即引导当前运行"
                    title={queuedPromptGuideAvailability.available ? '立即引导当前运行' : queuedPromptGuideAvailability.reason ?? '暂不能引导'}
                    disabled={!queuedPromptGuideAvailability.available}
                    onClick={() => void onGuideQueuedPrompt(prompt.id)}
                  >
                    <CornerDownRight size={13} />
                  </button>
                  <button
                    type="button"
                    className="composer-queued-action"
                    aria-label="编辑排队提示"
                    title="编辑消息"
                    onClick={() => onRecallQueuedPrompt(prompt.id)}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="composer-queued-action"
                    aria-label="取消排队提示"
                    title="取消排队"
                    onClick={() => onRemoveQueuedPrompt(prompt.id)}
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <div className="composer-attachments" aria-label="待发送附件">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="composer-attachment">
                {attachment.kind === 'image' ? (
                  <img src={attachment.previewUrl} alt={attachment.file.name || '粘贴图片'} className="composer-attachment-preview" />
                ) : (
                  <div className="composer-attachment-preview" aria-hidden="true">
                    <Pencil size={18} />
                  </div>
                )}
                <div className="composer-attachment-meta">
                  <span className="composer-attachment-name">{attachment.file.name || 'pasted-image.png'}</span>
                  <span className="composer-attachment-size">{formatAttachmentSize(attachment.file.size)}</span>
                  <span className="composer-attachment-size">{attachmentLabel(attachment)}</span>
                </div>
                <button
                  type="button"
                  className="composer-attachment-remove"
                  aria-label="移除附件"
                  title="移除附件"
                  onClick={() => removeAttachment(attachment.id)}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          className="composer-input"
          value={draft}
          onChange={(event) =>
            handleDraftChange(event.target.value, event.target.selectionStart ?? event.target.value.length, event.target.selectionEnd ?? event.target.value.length)
          }
          onClick={(event) => {
            setSelectionStart(event.currentTarget.selectionStart ?? 0);
            setSelectionEnd(event.currentTarget.selectionEnd ?? 0);
          }}
          onSelect={(event) => {
            setSelectionStart(event.currentTarget.selectionStart ?? 0);
            setSelectionEnd(event.currentTarget.selectionEnd ?? 0);
          }}
          onPaste={(event) => void handlePaste(event)}
          onKeyDown={handleComposerInputKeyDown}
          placeholder={isRunning ? '等待当前回复完成' : '要求后续变更'}
        />
        <div className="composer-toolbar">
          <div className="composer-left-tools">
            <input
              ref={fileInputRef}
              type="file"
              accept={supportedComposerUploadAccept}
              multiple
              className="composer-file-input"
              onChange={(event) => void handleFileSelection(event)}
            />
            <div className="composer-add-anchor" ref={addMenuRef}>
              <PopoverPortal open={addMenuOpen} anchorRef={addMenuRef} placement="top-start">
                <div className="composer-add-menu" role="menu">
                  <button
                    type="button"
                    className="composer-add-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setAddMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                  >
                    <Image size={15} />
                    <span>添加附件</span>
                  </button>
                  <button
                    type="button"
                    className="composer-add-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setAddMenuOpen(false);
                      onOpenPlugins();
                    }}
                  >
                    <Puzzle size={15} />
                    <span>插件管理</span>
                  </button>
                </div>
              </PopoverPortal>
              <button
                type="button"
                className="plain-icon"
                title="添加附件和插件"
                aria-expanded={addMenuOpen}
                onClick={() => setAddMenuOpen((value) => !value)}
              >
                <Plus size={16} />
              </button>
            </div>
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
                <div className={`model-menu${modelMenuHasContext1mOptions ? '' : ' model-menu-compact'}`} role="menu">
                  <div className="model-menu-title">模型</div>
                  {models.map((item) => {
                    const description = modelMenuDescriptionLabel(item);
                    const context1mModel = item.context1mModel;
                    const context1mSelected = Boolean(context1mModel && model === context1mModel);
                    const rowSelected = model === item.id || context1mSelected;
                    const selectBaseModel = () => {
                      onSelectModel(item.id);
                      setModelMenuOpen(false);
                    };
                    const toggleContext1m = () => {
                      if (!context1mModel) {
                        return;
                      }

                      onSelectModel(context1mSelected ? item.id : context1mModel);
                      setModelMenuOpen(false);
                    };

                    return (
                      <div
                        key={item.id}
                        className={`model-menu-item${item.supportsContext1m ? ' model-menu-item-with-toggle' : ''}`}
                        role="menuitemradio"
                        aria-checked={rowSelected}
                        tabIndex={0}
                        onClick={selectBaseModel}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            selectBaseModel();
                          }
                        }}
                      >
                        <span className="model-menu-item-copy">
                          <span>{modelMenuPrimaryLabel(item)}</span>
                          {description ? <small>{description}</small> : null}
                        </span>
                        {item.supportsContext1m && context1mModel ? (
                          <span
                            className={`model-context-toggle${context1mSelected ? ' active' : ''}`}
                            role="switch"
                            aria-checked={context1mSelected}
                            tabIndex={0}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleContext1m();
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                event.stopPropagation();
                                toggleContext1m();
                              }
                            }}
                          >
                            {modelContext1mMenuActionLabel(context1mSelected)}
                          </span>
                        ) : null}
                        {rowSelected ? <Check className="model-check" size={15} /> : null}
                      </div>
                    );
                  })}
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
            <div className="effort-picker" ref={effortMenuRef}>
              <PopoverPortal open={effortMenuOpen} anchorRef={effortMenuRef} placement="top-end">
                <div className="effort-menu" role="menu">
                  <div className="model-menu-title">思考级别</div>
                  {claudeEffortOptions.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className="effort-menu-item"
                      role="menuitemradio"
                      aria-checked={effort === item.value}
                      onClick={() => {
                        onSelectEffort(item.value);
                        setEffortMenuOpen(false);
                      }}
                    >
                      <Brain size={14} />
                      <span className="model-menu-item-copy">
                        <span>{item.label}</span>
                        <small>{item.description}</small>
                      </span>
                      {effort === item.value ? <Check className="model-check" size={15} /> : null}
                    </button>
                  ))}
                </div>
              </PopoverPortal>

              <button
                type="button"
                className="effort-trigger"
                aria-expanded={effortMenuOpen}
                disabled={isRunning}
                title="Claude Code effort"
                onClick={() => setEffortMenuOpen((value) => !value)}
              >
                <Brain size={14} />
                <span>{effortLabel(effort)}</span>
                <span className="model-trigger-chevron" aria-hidden="true" />
              </button>
            </div>
            <ComposerContextIndicator usage={contextUsage} />
            <button type="button" className="plain-icon"><Mic size={15} /></button>
            {showStopButton ? (
              <button type="button" className="send-button stop" onClick={() => void onStopRun()} title="停止">
                <Square size={13} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                className="send-button"
                disabled={!hasPendingContent}
                title={isRunning ? '发送到队列' : '发送'}
              >
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

async function uploadImageAttachments(attachments: PendingComposerAttachment[], workingDirectory: string) {
  const uploadedAttachments: UserImageAttachment[] = [];

  for (const attachment of attachments) {
    const dataUrl = await readFileAsDataUrl(attachment.file);
    const imagePayload = extractImageDataUrlPayload(dataUrl);
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
      data: imagePayload.data,
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

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('文本文件读取失败'));
    };
    reader.onerror = () => reject(new Error('文本文件读取失败'));
    reader.readAsText(file);
  });
}

function extractImageDataUrlPayload(dataUrl: string) {
  const matched = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!matched) {
    throw new Error('图片读取失败');
  }

  return {
    mimeType: matched[1],
    data: matched[2],
  };
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

function effortLabel(effort: ClaudeEffortSelection) {
  return claudeEffortOptions.find((item) => item.value === effort)?.label ?? '默认';
}

function attachmentLabel(attachment: PendingComposerAttachment) {
  if (attachment.kind === 'image') {
    return '图片';
  }
  if (attachment.kind === 'file_text') {
    return '文本内联';
  }
  return '大文件引用';
}

function disposeAttachmentPreviews(attachments: PendingComposerAttachment[]) {
  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }
}

function getActiveFileReferenceToken(text: string, selectionStart: number, selectionEnd: number) {
  if (selectionStart !== selectionEnd) {
    return null;
  }

  const cursor = Math.max(0, Math.min(selectionStart, text.length));
  // 注意：String.prototype.lastIndexOf(s, fromIndex) 的 fromIndex 在 <0 时会被 clamp 为 0，
  // 仍可能命中位置 0 的 '@'，导致 atIndex 一直停在 0 形成死循环。这里显式在 atIndex==0 时终止。
  for (
    let atIndex = text.lastIndexOf('@', cursor - 1);
    atIndex >= 0;
    atIndex = atIndex > 0 ? text.lastIndexOf('@', atIndex - 1) : -1
  ) {
    const previousChar = atIndex > 0 ? text[atIndex - 1] : '';
    if (previousChar && !/[\s([{]/.test(previousChar)) {
      continue;
    }

    const quoted = text[atIndex + 1] === '"';
    if (quoted) {
      const contentStart = atIndex + 2;
      let contentEnd = contentStart;
      while (contentEnd < text.length && text[contentEnd] !== '"') {
        contentEnd += 1;
      }
      if (cursor < contentStart || cursor > contentEnd) {
        continue;
      }

      return {
        start: atIndex,
        end: contentEnd < text.length && text[contentEnd] === '"' ? contentEnd + 1 : contentEnd,
        query: text.slice(contentStart, cursor),
      };
    }

    const tokenStart = atIndex + 1;
    let tokenEnd = tokenStart;
    while (tokenEnd < text.length && isFileReferenceTokenChar(text[tokenEnd])) {
      tokenEnd += 1;
    }
    if (cursor < tokenStart || cursor > tokenEnd) {
      continue;
    }

    return {
      start: atIndex,
      end: tokenEnd,
      query: text.slice(tokenStart, cursor),
    };
  }

  return null;
}

function isFileReferenceTokenChar(char: string) {
  return /[A-Za-z0-9_./\\:-]/.test(char);
}

async function resolveExistingFileReferenceBlocks(draft: string, workspace: string): Promise<InputContentBlock[]> {
  const references = extractAtFileReferences(draft);
  const blocks: InputContentBlock[] = [];

  for (const reference of references) {
    const matchedFile = await findExistingRelativeFile(workspace, reference);
    if (!matchedFile) {
      continue;
    }

    blocks.push({
      type: 'file_reference',
      path: matchedFile.path,
      name: getPathBasename(matchedFile.path),
    });
  }

  return blocks;
}

async function findExistingRelativeFile(workspace: string, reference: string) {
  const params = new URLSearchParams({
    workingDirectory: workspace,
    query: reference,
  });
  const response = await fetch(`/api/system/files/search?${params.toString()}`);
  if (!response.ok) {
    return null;
  }

  const payload = await response.json() as { files?: FileReferenceSearchResult[] };
  const normalizedReference = normalizePathForComparison(reference);
  return (payload.files ?? []).find((file) => normalizePathForComparison(file.rel) === normalizedReference) ?? null;
}

function getPathBasename(filePath: string) {
  return filePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? filePath;
}

function getPathDirectoryLabel(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return '';
  }

  return segments.slice(0, -1).join('/');
}

function ComposerFileReferenceIcon({ path, isDirectory }: { path: string; isDirectory: boolean }) {
  const [iconFailed, setIconFailed] = useState(false);
  const iconSrc = resolveWorkbenchFileIcon(path, isDirectory ? 'directory' : 'file');
  if (!iconFailed && iconSrc) {
    return (
      <img
        className="composer-file-reference-icon"
        src={iconSrc}
        alt=""
        aria-hidden="true"
        onError={() => setIconFailed(true)}
      />
    );
  }

  // CDN 不可达或被 CSP 拦掉时，用着色后的 lucide 图标兜底，保证条目前面始终能看到清晰可见的图标。
  const iconKind = getWorkbenchFileIconKind(path, isDirectory ? 'directory' : 'file');
  const Icon = getComposerFallbackIcon(iconKind);
  return (
    <Icon
      className={`composer-file-reference-icon composer-file-reference-icon-fallback composer-file-reference-icon-${iconKind}`}
      size={16}
      aria-hidden="true"
    />
  );
}

function getComposerFallbackIcon(iconKind: string): LucideIcon {
  switch (iconKind) {
    case 'folder':
      return Folder;
    case 'react':
    case 'script':
    case 'html':
    case 'style':
      return FileCode;
    case 'md':
    case 'document':
      return FileText;
    case 'json':
    case 'config':
      return Settings;
    case 'database':
    case 'sheet':
      return FileSpreadsheet;
    case 'image':
      return FileImage;
    case 'archive':
      return FileArchive;
    case 'media':
      return FileAudio;
    default:
      return File;
  }
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
