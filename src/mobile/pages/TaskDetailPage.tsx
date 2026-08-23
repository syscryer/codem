import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ChevronLeft, CircleStop, Copy, FileText, Link2, LockKeyhole, Mic, MoreHorizontal, Paperclip, RefreshCw, X } from 'lucide-react';
import { AgentProviderIcon } from '../../components/AgentProviderIcon';
import { ConversationPane } from '../../components/ConversationPane';
import { ComposerContextIndicator } from '../../components/ComposerContextIndicator';
import { ProviderBrandIcon } from '../../components/ProviderBrandIcon';
import { buildComposerContextUsage } from '../../lib/composer-context-usage';
import { classifyComposerFile, supportedComposerUploadAccept } from '../../lib/composer-input-files';
import { openExternalUrl } from '../../lib/markdown-link';
import type { AgentType, ApprovalDecision, ApprovalRequest, ConversationTurn, InputContentBlock, InputContentBlockSummary, RequestUserInputRequest, RuntimeSuggestedAction, ThreadDetail } from '../../types';
import { MobileActionSheet } from '../components/MobileActionSheet';
import { MobileSelect } from '../components/MobileSelect';
import { useMobileThread } from '../hooks/useMobileThread';
import {
  channelModelCatalog,
  defaultMobileReasoningEffort,
  mobilePermissionOptions,
  mobileReasoningEffortRequest,
  mobileReasoningOptions,
  supportsDynamicModelCatalog,
} from '../lib/mobile-agent-options';
import { mobileApi } from '../lib/mobile-api';
import { resolveMobileBrowsableUrl } from '../lib/mobile-browser';
import type { MobileTaskSettingsRequest } from '../lib/mobile-api';
import type { MobileBootstrap, MobileModelCatalog } from '../types';

type MobileComposerAttachment =
  | { id: string; kind: 'image'; file: File; mimeType: string; previewUrl: string }
  | { id: string; kind: 'file_text'; file: File; mimeType: string; text: string };

export function TaskDetailPage({
  threadId,
  bootstrap,
  onBack,
  onChanged,
  onOpenBrowser,
}: {
  threadId: string;
  bootstrap: MobileBootstrap | null;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onOpenBrowser: (url: string) => void;
}) {
  const fallbackTask = bootstrap?.tasks.find((task) => task.threadId === threadId);
  const thread = useMobileThread(threadId, fallbackTask);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [actionNotice, setActionNotice] = useState<string>();
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  const [modelCatalog, setModelCatalog] = useState<MobileModelCatalog>();
  const [selectedChannelId, setSelectedChannelId] = useState('system');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState('');
  const [selectedPermissionMode, setSelectedPermissionMode] = useState(bootstrap?.defaults?.permissionMode || 'default');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [attachments, setAttachments] = useState<MobileComposerAttachment[]>([]);
  const [clockNowMs, setClockNowMs] = useState(Date.now());
  const transcriptRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const viewportRootRef = useRef<HTMLDivElement>(null);
  const taskMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef<MobileComposerAttachment[]>([]);
  const task = thread.task;
  const running = task?.phase === 'running' || task?.phase === 'starting' || task?.phase === 'waiting';
  const canSend = bootstrap?.permissions.includes('send') ?? false;
  const canStop = running && (bootstrap?.permissions.includes('stop') ?? false);
  const canApprove = bootstrap?.permissions.includes('approve') ?? false;
  const providerChannels = useMemo(
    () => (bootstrap?.channels.channels ?? []).filter((channel) => channel.providerId === task?.providerId && channel.enabled),
    [bootstrap?.channels.channels, task?.providerId],
  );
  const selectedChannel = providerChannels.find((channel) => channel.id === selectedChannelId);
  const modelCatalogScopeKey = buildModelCatalogScopeKey(task?.providerId, selectedChannelId, selectedChannel?.models);
  const closeTaskMenu = useCallback(() => setTaskMenuOpen(false), []);

  useEffect(() => {
    if (!actionNotice) return undefined;
    const timer = window.setTimeout(() => setActionNotice(undefined), 2_000);
    return () => window.clearTimeout(timer);
  }, [actionNotice]);

  useEffect(() => {
    const root = viewportRootRef.current;
    const viewport = window.visualViewport;
    if (!root || !viewport) return undefined;

    let frame = 0;
    const syncViewport = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        root.style.setProperty('--mobile-visual-viewport-height', `${Math.round(viewport.height)}px`);
        root.style.setProperty('--mobile-visual-viewport-top', `${Math.round(viewport.offsetTop)}px`);
      });
    };

    syncViewport();
    viewport.addEventListener('resize', syncViewport);
    viewport.addEventListener('scroll', syncViewport);
    window.addEventListener('resize', syncViewport);
    return () => {
      window.cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', syncViewport);
      viewport.removeEventListener('scroll', syncViewport);
      window.removeEventListener('resize', syncViewport);
      root.style.removeProperty('--mobile-visual-viewport-height');
      root.style.removeProperty('--mobile-visual-viewport-top');
    };
  }, []);

  useEffect(() => {
    if (canStop) setTaskMenuOpen(false);
  }, [canStop]);

  useEffect(() => {
    setSelectedChannelId(task?.channelId?.trim() || 'system');
    setSelectedModel(task?.model?.trim() || '');
    setSelectedReasoningEffort(task?.reasoningEffort?.trim() || '');
    setSelectedPermissionMode(normalizePermissionMode(task?.permissionMode));
  }, [task?.channelId, task?.model, task?.permissionMode, task?.reasoningEffort, threadId]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => () => disposeMobileAttachments(attachmentsRef.current), [threadId]);

  useEffect(() => {
    let active = true;
    const providerId = task?.providerId;
    if (!providerId) {
      setModelCatalog(undefined);
      return () => { active = false; };
    }
    if (selectedChannel?.models.length) {
      setModelCatalog(channelModelCatalog(providerId, selectedChannel.models));
      if (!supportsDynamicModelCatalog(providerId)) {
        return () => { active = false; };
      }
      void mobileApi.models(providerId, selectedChannelId).then((nativeCatalog) => {
        if (active) setModelCatalog(channelModelCatalog(providerId, selectedChannel.models, nativeCatalog));
      }).catch(() => undefined);
      return () => { active = false; };
    }
    if (!supportsDynamicModelCatalog(providerId)) {
      setModelCatalog({ providerId, models: [] });
      return () => { active = false; };
    }
    setModelCatalog(undefined);
    void mobileApi.models(providerId, selectedChannelId === 'system' ? undefined : selectedChannelId).then((catalog) => {
      if (active) setModelCatalog(catalog);
    }).catch(() => {
      if (active) setModelCatalog({ providerId, models: [] });
    });
    return () => { active = false; };
  }, [modelCatalogScopeKey]);

  const modelOptions = useMemo(() => {
    const options = [
      { value: '', label: 'Provider 默认' },
      ...(modelCatalog?.models ?? []).map((option) => ({
        value: option.id,
        label: option.label,
        description: option.description,
      })),
    ];
    if (selectedModel && !options.some((option) => option.value === selectedModel)) {
      options.push({ value: selectedModel, label: selectedModel, description: '当前会话模型' });
    }
    return options;
  }, [modelCatalog, selectedModel]);

  const channelOptions = useMemo(() => {
    const options = [
      { value: 'system', label: '系统渠道' },
      ...providerChannels.map((channel) => ({
        value: channel.id,
        label: channel.name,
        description: channel.models.length ? `${channel.models.length} 个模型` : undefined,
      })),
    ];
    if (selectedChannelId !== 'system' && !options.some((option) => option.value === selectedChannelId)) {
      options.push({ value: selectedChannelId, label: selectedChannelId, description: '当前会话渠道' });
    }
    return options;
  }, [providerChannels, selectedChannelId]);

  const reasoningOptions = useMemo(
    () => mobileReasoningOptions(task?.providerId || '', modelCatalog, selectedModel),
    [modelCatalog, selectedModel, task?.providerId],
  );
  const effectiveReasoningEffort = selectedReasoningEffort
    || defaultMobileReasoningEffort(task?.providerId || '', modelCatalog, selectedModel);

  const contextUsage = useMemo(() => buildComposerContextUsage({
    agent: mobileAgentType(task?.providerId),
    providerId: task?.providerId,
    model: selectedModel || task?.model || '',
    turns: thread.page?.turns ?? [],
  }), [selectedModel, task?.model, task?.providerId, thread.page?.turns]);
  const canSubmit = canSend && !busy && Boolean(prompt.trim() || attachments.length);

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => setClockNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);

  const activeThread = useMemo<ThreadDetail | null>(() => {
    if (!task || !thread.page) return null;
    return {
      id: task.threadId,
      projectId: task.projectId,
      title: task.title,
      sessionId: '',
      workingDirectory: '',
      updatedAt: task.updatedAt,
      updatedLabel: '',
      provider: task.providerId,
      model: task.model,
      reasoningEffort: task.reasoningEffort,
      permissionMode: task.permissionMode,
      agentChannelId: task.channelId,
      turns: thread.page.turns,
      debugEvents: [],
      rawEvents: [],
      historyLoaded: true,
      historyLoading: thread.loadingEarlier,
    };
  }, [task, thread.loadingEarlier, thread.page]);

  async function send() {
    const text = prompt.trim();
    if ((!text && attachments.length === 0) || busy || !canSend) return;
    if (running && attachments.length > 0) {
      setActionError('运行中的指引暂不支持附件，请等待当前运行结束后发送。');
      return;
    }
    setBusy(true);
    setActionError(undefined);
    const submittedAttachments = attachments;
    let optimisticTurnId: string | undefined;
    try {
      const contentBlocks = await buildMobileContentBlocks(text, submittedAttachments);
      optimisticTurnId = thread.appendOptimisticTurn(text, summarizeMobileContentBlocks(contentBlocks));
      setPrompt('');
      setAttachments([]);
      const runReasoningEffort = mobileReasoningEffortRequest(task?.providerId || '', effectiveReasoningEffort);
      await mobileApi.send(threadId, {
        prompt: text,
        mode: running ? 'guide' : 'follow-up',
        ...(running ? {} : { model: selectedModel || null }),
        ...(running ? {} : {
          reasoningEffort: runReasoningEffort ?? null,
        }),
        ...(running ? {} : { permissionMode: selectedPermissionMode }),
        ...(running ? {} : { channelId: selectedChannelId === 'system' ? null : selectedChannelId }),
        contentBlocks,
      });
      disposeMobileAttachments(submittedAttachments);
      await Promise.all([thread.reload(), onChanged()]);
    } catch (reason) {
      if (optimisticTurnId) {
        thread.removeOptimisticTurn(optimisticTurnId);
        setPrompt(text);
        setAttachments(submittedAttachments);
      }
      setActionError(reason instanceof Error ? reason.message : '发送失败');
    } finally {
      setBusy(false);
    }
  }

  async function appendAttachments(files: File[]) {
    if (running) {
      setActionError('运行中的指引暂不支持附件。');
      return;
    }
    const next: MobileComposerAttachment[] = [];
    try {
      for (const file of files) {
        const classification = classifyComposerFile(file);
        if (classification.kind === 'image') {
          next.push({
            id: crypto.randomUUID(),
            kind: 'image',
            file,
            mimeType: classification.mimeType,
            previewUrl: URL.createObjectURL(file),
          });
          continue;
        }
        if (classification.kind === 'text') {
          next.push({
            id: crypto.randomUUID(),
            kind: 'file_text',
            file,
            mimeType: classification.mimeType,
            text: await file.text(),
          });
          continue;
        }
        setActionError(classification.kind === 'reference'
          ? `${file.name} 超过 1MB，移动端暂不内联发送。`
          : `${file.name} 暂不支持，请选择图片或文本/代码文件。`);
      }
      if (next.length > 0) setAttachments((current) => [...current, ...next]);
    } catch (reason) {
      disposeMobileAttachments(next);
      setActionError(reason instanceof Error ? reason.message : '附件读取失败');
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.id === id);
      if (target?.kind === 'image') URL.revokeObjectURL(target.previewUrl);
      return current.filter((attachment) => attachment.id !== id);
    });
  }

  function selectChannel(channelId: string) {
    const previous = {
      channelId: selectedChannelId,
      model: selectedModel,
      reasoningEffort: selectedReasoningEffort,
    };
    setSelectedChannelId(channelId);
    setSelectedModel('');
    setSelectedReasoningEffort('');
    void saveTaskSettings(
      { channelId: channelId === 'system' ? null : channelId, model: null, reasoningEffort: null },
      () => {
        setSelectedChannelId(previous.channelId);
        setSelectedModel(previous.model);
        setSelectedReasoningEffort(previous.reasoningEffort);
      },
    );
  }

  function selectModel(model: string) {
    const previousModel = selectedModel;
    const previousEffort = selectedReasoningEffort;
    const nextEffort = defaultMobileReasoningEffort(task?.providerId || '', modelCatalog, model);
    setSelectedModel(model);
    setSelectedReasoningEffort(nextEffort);
    void saveTaskSettings(
      {
        model: model || null,
        reasoningEffort: mobileReasoningEffortRequest(task?.providerId || '', nextEffort) ?? null,
      },
      () => {
        setSelectedModel(previousModel);
        setSelectedReasoningEffort(previousEffort);
      },
    );
  }

  function selectReasoningEffort(reasoningEffort: string) {
    const previous = selectedReasoningEffort;
    setSelectedReasoningEffort(reasoningEffort);
    void saveTaskSettings(
      { reasoningEffort: mobileReasoningEffortRequest(task?.providerId || '', reasoningEffort) ?? null },
      () => setSelectedReasoningEffort(previous),
    );
  }

  function selectPermissionMode(permissionMode: string) {
    const previous = selectedPermissionMode;
    setSelectedPermissionMode(permissionMode);
    void saveTaskSettings(
      { permissionMode },
      () => setSelectedPermissionMode(previous),
    );
  }

  async function saveTaskSettings(
    settings: MobileTaskSettingsRequest,
    rollback: () => void,
  ) {
    if (settingsSaving || running || !canSend) return;
    setSettingsSaving(true);
    setActionError(undefined);
    try {
      await mobileApi.updateSettings(threadId, settings);
      await onChanged();
    } catch (reason) {
      rollback();
      setActionError(reason instanceof Error ? reason.message : '保存会话设置失败');
    } finally {
      setSettingsSaving(false);
    }
  }

  async function stop() {
    if (!canStop || busy) return;
    setBusy(true);
    try {
      await mobileApi.stop(threadId);
      await thread.reload();
      await onChanged();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '停止失败');
    } finally {
      setBusy(false);
    }
  }

  async function refreshTask() {
    if (busy) return;
    setBusy(true);
    setActionError(undefined);
    setActionNotice(undefined);
    try {
      const next = await thread.reload();
      if (!next) throw new Error('刷新会话失败');
      await onChanged();
      setActionNotice('已同步最新会话');
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '刷新会话失败');
    } finally {
      setBusy(false);
    }
  }

  async function copyTaskLink() {
    const cleanUrl = `${window.location.origin}/mobile/tasks/${encodeURIComponent(threadId)}`;
    await copyTaskValue(cleanUrl, '任务链接已复制');
  }

  async function copyTaskId() {
    await copyTaskValue(threadId, '任务 ID 已复制');
  }

  async function copyTaskValue(value: string, successMessage: string) {
    setActionError(undefined);
    setActionNotice(undefined);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('当前浏览器不支持复制');
      await navigator.clipboard.writeText(value);
      setActionNotice(successMessage);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '复制失败');
    }
  }

  async function submitApproval(request: ApprovalRequest, decision: ApprovalDecision) {
    if (!canApprove || !request.requestId) return false;
    try {
      await mobileApi.approval(threadId, request.requestId, decision === 'approve');
      await thread.reload();
      await onChanged();
      return true;
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '审批提交失败');
      return false;
    }
  }

  async function submitUserInput(request: RequestUserInputRequest, answers: Record<string, string>) {
    if (!canApprove || !request.requestId) return false;
    try {
      await mobileApi.userInput(threadId, request.requestId, answers, request.questions);
      await thread.reload();
      await onChanged();
      return true;
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '回答提交失败');
      return false;
    }
  }

  async function submitRuntimeRecoveryAction(turn: ConversationTurn, action: RuntimeSuggestedAction) {
    const text = turn.userText.trim();
    if (!text || busy || !canSend) return false;
    setBusy(true);
    setActionError(undefined);
    try {
      await mobileApi.send(threadId, {
        prompt: text,
        mode: 'follow-up',
        model: selectedModel || null,
        reasoningEffort: mobileReasoningEffortRequest(
          task?.providerId || '',
          effectiveReasoningEffort,
        ) ?? null,
        permissionMode: selectedPermissionMode,
        channelId: selectedChannelId === 'system' ? null : selectedChannelId,
        contentBlocks: [],
        recoveryAction: action,
      });
      await thread.reload();
      await onChanged();
      return true;
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '恢复任务失败');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={viewportRootRef} className="mobile-prototype prototype-detail mobile-live-detail codex-desktop">
      <header className="prototype-detail-header">
        <button type="button" className="prototype-back-button" onClick={onBack} aria-label="返回任务列表">
          <ChevronLeft size={24} />
          <span>任务</span>
        </button>
        <div className="prototype-detail-title">
          <strong title={task?.title || 'CodeM'}>
            {task?.providerId ? <AgentProviderIcon providerId={task.providerId} size={13} /> : null}
            <span className="prototype-detail-title-name">{task?.title || 'CodeM'}</span>
          </strong>
          <span title={task?.projectName}>{task?.projectName || '项目'}</span>
        </div>
        <button
          ref={taskMenuTriggerRef}
          type="button"
          className="prototype-icon-button"
          aria-label="更多操作"
          aria-haspopup="dialog"
          aria-expanded={taskMenuOpen}
          disabled={busy}
          onClick={() => setTaskMenuOpen(true)}
        >
          <MoreHorizontal size={21} />
        </button>
      </header>

      <MobileActionSheet
        open={taskMenuOpen}
        title="任务操作"
        triggerRef={taskMenuTriggerRef}
        onClose={closeTaskMenu}
        items={[
          ...(canStop ? [{ id: 'stop', label: '停止任务', description: '中断当前运行', icon: CircleStop, onSelect: stop }] : []),
          { id: 'refresh', label: '刷新会话', description: '重新同步任务状态和消息', icon: RefreshCw, disabled: busy, onSelect: refreshTask },
          { id: 'copy-link', label: '复制任务链接', description: '复制不含登录凭据的访问地址', icon: Link2, onSelect: copyTaskLink },
          { id: 'copy-id', label: '复制任务 ID', description: threadId, icon: Copy, onSelect: copyTaskId },
        ]}
      >
        <section className="mobile-task-config" aria-label="会话配置">
          <button
            type="button"
            className="mobile-task-config-provider mobile-task-config-provider-button"
            onClick={() => setActionNotice('已有任务的 Agent 在创建后锁定，请返回任务页新建任务选择其他 Agent。')}
            aria-label={`当前 Agent 为 ${task?.providerLabel || 'Agent'}，创建后不可切换`}
          >
            <span>Agent</span>
            <strong><ProviderBrandIcon icon={providerIconKey(task?.providerId)} name={task?.providerLabel || 'Agent'} size={21} />{task?.providerLabel || 'Agent'}<LockKeyhole size={14} aria-hidden="true" /></strong>
          </button>
          <div className="mobile-task-config-row">
            <span>渠道</span>
            <MobileSelect label={running ? '运行中渠道已锁定' : '选择渠道'} value={selectedChannelId} options={channelOptions} disabled={running || busy || settingsSaving || !canSend} onChange={selectChannel} />
          </div>
          <div className="mobile-task-config-row">
            <span>权限</span>
            <MobileSelect label={running ? '运行中权限已锁定' : '选择权限模式'} value={selectedPermissionMode} options={mobilePermissionOptions} disabled={running || busy || settingsSaving || !canSend} onChange={selectPermissionMode} />
          </div>
        </section>
      </MobileActionSheet>

      <main className="mobile-conversation-region">
        {activeThread ? (
          <ConversationPane
            activeThread={activeThread}
            isNewChatDraft={false}
            activeProject={null}
            activeProjectName={task?.projectName}
            providerId={task?.providerId}
            attachmentPreviewScope="mobile"
            collapseIntermediateProcess
            thinkingLabel="思考"
            clockNowMs={clockNowMs}
            isRunning={running}
            activeTurnId={findActiveTurnId(activeThread.turns)}
            transcriptRef={transcriptRef}
            bottomRef={bottomRef}
            hasEarlierTurns={thread.page?.hasMore}
            isLoadingEarlierTurns={thread.loadingEarlier}
            onLoadEarlierTurns={thread.loadEarlier}
            undoneTurnIds={{}}
            onOpenWorkbenchPreview={() => undefined}
            onOpenOutputPath={async () => undefined}
            onRevealOutputPath={async () => undefined}
            onOpenWebLink={async (url, target) => {
              const browsable = resolveMobileBrowsableUrl(url);
              if (browsable && target !== 'external') {
                onOpenBrowser(browsable);
                return;
              }
              if (!await openExternalUrl(url)) setActionError('无法打开此链接');
            }}
            onCopyWebLink={async (url) => copyTaskValue(url, '链接已复制')}
            onUndoChangedFiles={() => undefined}
            onSubmitRequestUserInput={async (_turn, request, answers) => submitUserInput(request, answers)}
            onSubmitRuntimeRecoveryAction={submitRuntimeRecoveryAction}
            onSubmitApprovalDecision={async (_turn, request, decision) => submitApproval(request, decision)}
          />
        ) : (
          <div className="mobile-conversation-loading">{thread.error || '正在加载会话…'}</div>
        )}
      </main>

      {actionError || thread.error
        ? <div className="mobile-action-error" role="alert">{actionError || thread.error}</div>
        : actionNotice
          ? <div className="mobile-action-notice" role="status" aria-live="polite">{actionNotice}</div>
          : null}
      <section className="prototype-composer mobile-live-composer" aria-label="消息输入">
        {attachments.length > 0 ? (
          <div className="mobile-composer-attachments" aria-label="待发送附件">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="mobile-composer-attachment">
                {attachment.kind === 'image'
                  ? <img src={attachment.previewUrl} alt="" />
                  : <span aria-hidden="true"><FileText size={17} /></span>}
                <strong>{attachment.file.name || (attachment.kind === 'image' ? '图片' : '文本文件')}</strong>
                <button type="button" onClick={() => removeAttachment(attachment.id)} aria-label={`移除 ${attachment.file.name || '附件'}`} title="移除附件">
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          value={prompt}
          enterKeyHint="send"
          disabled={!canSend || busy}
          onChange={(event) => setPrompt(event.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
            if (files.length === 0) return;
            event.preventDefault();
            void appendAttachments(files);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!event.repeat) void send();
            }
          }}
          placeholder={!canSend ? '此设备没有发送权限' : running ? '向运行中的 Agent 发送指引…' : '继续当前任务…'}
          rows={1}
        />
        <div className="prototype-composer-toolbar mobile-composer-action-row">
          <input
            ref={fileInputRef}
            className="mobile-composer-file-input"
            type="file"
            multiple
            accept={supportedComposerUploadAccept}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (files.length > 0) void appendAttachments(files);
            }}
          />
          <button
            type="button"
            className="prototype-icon-button"
            disabled={running || busy || !canSend}
            aria-label={running ? '运行中暂不支持附件' : '添加附件'}
            title={running ? '运行中暂不支持附件' : '添加附件'}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip size={18} />
          </button>
          <span className="mobile-composer-select mobile-composer-model-select">
            <MobileSelect
              label={running ? '运行中模型已锁定' : '选择模型'}
              value={selectedModel}
              options={modelOptions}
              disabled={running || busy || settingsSaving || !canSend}
              onChange={selectModel}
            />
          </span>
          {reasoningOptions.length > 0 ? (
            <span className="mobile-composer-select mobile-composer-reasoning-select">
              <MobileSelect
                label={running ? '运行中推理强度已锁定' : '选择推理强度'}
                value={effectiveReasoningEffort}
                options={reasoningOptions}
                disabled={running || busy || settingsSaving || !canSend}
                onChange={selectReasoningEffort}
              />
            </span>
          ) : null}
          <span className="mobile-composer-context-slot">
            <ComposerContextIndicator usage={contextUsage} />
          </span>
          <button type="button" className="prototype-icon-button mobile-voice-disabled" disabled aria-label="语音输入暂未开放" title="语音输入暂未开放">
            <Mic size={18} />
          </button>
          {running && canStop && !prompt.trim() && attachments.length === 0 ? (
            <button type="button" className="prototype-send-button mobile-stop-button" onClick={() => void stop()} aria-label="停止任务" title="停止任务">
              <CircleStop size={19} />
            </button>
          ) : (
            <button type="button" className="prototype-send-button" disabled={!canSubmit} onClick={() => void send()} aria-label="发送消息">
              <ArrowUp size={19} />
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function normalizePermissionMode(mode?: string) {
  if (mode === 'acceptEdits' || mode === 'auto') return 'auto';
  if (mode === 'dontAsk' || mode === 'bypassPermissions') return 'bypassPermissions';
  return 'default';
}

function mobileAgentType(providerId?: string): AgentType {
  if (providerId === 'claude-code') return 'claude';
  if (providerId === 'openai-codex') return 'codex';
  if (providerId === 'grok-build') return 'grok';
  if (providerId === 'gemini-cli') return 'gemini';
  if (providerId === 'opencode') return 'opencode';
  return 'generic';
}

function providerIconKey(providerId?: string) {
  if (providerId === 'claude-code') return 'anthropic';
  if (providerId === 'openai-codex') return 'openai';
  if (providerId === 'grok-build') return 'xai';
  if (providerId === 'gemini-cli') return 'gemini';
  if (providerId === 'deepseek-dsh') return 'deepseek';
  return providerId;
}

async function buildMobileContentBlocks(text: string, attachments: MobileComposerAttachment[]): Promise<InputContentBlock[]> {
  const blocks: InputContentBlock[] = text ? [{ type: 'text', text }] : [];
  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      blocks.push({
        type: 'image',
        id: attachment.id,
        name: attachment.file.name || 'image',
        mimeType: attachment.mimeType,
        size: attachment.file.size,
        data: await readFileBase64(attachment.file),
      });
      continue;
    }
    blocks.push({
      type: 'file_text',
      id: attachment.id,
      path: attachment.file.name || 'file.txt',
      name: attachment.file.name || 'file.txt',
      mimeType: attachment.mimeType,
      size: attachment.file.size,
      text: attachment.text,
      textBytes: new TextEncoder().encode(attachment.text).byteLength,
    });
  }
  return blocks;
}

function summarizeMobileContentBlocks(blocks: InputContentBlock[]): InputContentBlockSummary[] {
  return blocks.flatMap<InputContentBlockSummary>((block) => {
    if (block.type === 'text') return [];
    if (block.type === 'image') {
      return [{
        type: 'image',
        id: block.id,
        name: block.name,
        mimeType: block.mimeType,
        size: block.size,
        imageBytes: block.size,
      }];
    }
    if (block.type === 'file_text') {
      return [{
        type: 'file_text',
        id: block.id,
        path: block.name,
        name: block.name,
        mimeType: block.mimeType,
        size: block.size,
        textBytes: block.textBytes ?? block.size ?? 0,
      }];
    }
    return [block];
  });
}

function readFileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name || '图片'} 读取失败`));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma < 0) {
        reject(new Error(`${file.name || '图片'} 格式无效`));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function disposeMobileAttachments(attachments: MobileComposerAttachment[]) {
  for (const attachment of attachments) {
    if (attachment.kind === 'image') URL.revokeObjectURL(attachment.previewUrl);
  }
}

function buildModelCatalogScopeKey(
  providerId: string | undefined,
  channelId: string | undefined,
  models: MobileBootstrap['channels']['channels'][number]['models'] | undefined,
) {
  const modelSignature = (models ?? []).map((model) => [
    model.id,
    model.modelId,
    model.displayName,
    model.isDefault ? '1' : '0',
    JSON.stringify(model.capabilities ?? {}),
  ].join(':')).join('|');
  return `${providerId || ''}\u0000${channelId || 'system'}\u0000${modelSignature}`;
}

function findActiveTurnId(turns: ThreadDetail['turns']) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].status === 'running' || turns[index].status === 'pending') return turns[index].id;
  }
  return '';
}
