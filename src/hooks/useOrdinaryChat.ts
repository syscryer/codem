import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyAgentRunEventToTurn } from '../lib/agent-run-events';
import {
  cancelAiChatRun,
  createAiChat,
  deleteAiChat,
  deleteAiChatTurn,
  loadAiChat,
  loadAiChatBootstrap,
  loadActiveAiChatRun,
  pinAiChat,
  reconnectAiChatRun,
  startAiChatRun,
  submitAiChatApproval,
  updateAiChat,
} from '../lib/ordinary-chat-api';
import {
  buildHistoryContentBlocks,
  buildRunContentBlocks,
  stripTransientAttachmentData,
} from '../lib/claude-run-attachments';
import type {
  AgentRunEvent,
  ApprovalDecision,
  ApprovalRequest,
  AiChatDetail,
  AiChatProvider,
  AiChatSummary,
  AiKnowledgeBaseSummary,
  ConversationTurn,
  InputContentBlock,
  McpServerSummary,
  SkillSummary,
  ThreadDetail,
  UserImageAttachment,
} from '../types';

type ToastTone = 'success' | 'error' | 'info';

type OrdinaryChatSubmission = {
  prompt: string;
  displayText: string;
  attachments?: UserImageAttachment[];
  contentBlocks?: InputContentBlock[];
};

type AiChatRunEvent =
  | AgentRunEvent
  | { type: 'usage'; runId: string; usage: Record<string, unknown> };

type RunContext = {
  chatId: string;
  turnId: string;
  runId: string;
  controller: AbortController;
  pendingText: string;
  textFrame: number | null;
  terminal: boolean;
  cancelRequested: boolean;
};

type ReplayOptions = {
  operation: 'regenerate' | 'retry' | 'edit';
  sourceTurn: ConversationTurn;
};

export function useOrdinaryChat(
  showToast: (message: string, tone?: ToastTone) => void,
) {
  const [providers, setProviders] = useState<AiChatProvider[]>([]);
  const [chats, setChats] = useState<AiChatSummary[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<AiKnowledgeBaseSummary[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerSummary[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<AiChatDetail | null>(null);
  const [turnsByChatId, setTurnsByChatId] = useState<Record<string, ConversationTurn[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draftProviderId, setDraftProviderId] = useState('');
  const [draftModelId, setDraftModelId] = useState('');
  const [draftKnowledgeIds, setDraftKnowledgeIds] = useState<string[]>([]);
  const [draftMcpIds, setDraftMcpIds] = useState<string[]>([]);
  const [draftSkillIds, setDraftSkillIds] = useState<string[]>([]);
  const [runningChatIds, setRunningChatIds] = useState<string[]>([]);
  const runContextsRef = useRef(new Map<string, RunContext>());
  const activeChatIdRef = useRef<string | null>(null);
  const reconnectAttemptedRef = useRef(new Set<string>());
  const turnsByChatIdRef = useRef<Record<string, ConversationTurn[]>>({});

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    turnsByChatIdRef.current = turnsByChatId;
  }, [turnsByChatId]);

  const turns = activeChatId ? turnsByChatId[activeChatId] ?? [] : [];
  const isRunning = Boolean(activeChatId && runningChatIds.includes(activeChatId));

  const selectedProviderId = activeChat?.summary.providerId || draftProviderId;
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const selectedModelId = activeChat?.summary.modelId || draftModelId;
  const selectedModel = selectedProvider?.models.find((model) => model.id === selectedModelId && model.enabled)
    ?? preferredModel(selectedProvider);
  const selectedKnowledgeIds = activeChat?.summary.selectedKnowledgeIds ?? draftKnowledgeIds;
  const selectedMcpIds = activeChat?.summary.selectedMcpIds ?? draftMcpIds;
  const selectedSkillIds = activeChat?.summary.selectedSkillIds ?? draftSkillIds;

  const applyDefaultSelection = useCallback((nextProviders: AiChatProvider[]) => {
    const provider = nextProviders.find((item) => item.enabled && item.models.some((model) => model.enabled));
    setDraftProviderId((current) => {
      const currentProvider = nextProviders.find((item) => item.id === current && item.enabled);
      return currentProvider ? current : provider?.id ?? '';
    });
    setDraftModelId((current) => {
      if (nextProviders.some((item) => item.models.some((model) => model.id === current && model.enabled))) {
        return current;
      }
      return preferredModel(provider)?.id ?? '';
    });
  }, []);

  const refreshBootstrap = useCallback(async () => {
    const bootstrap = await loadAiChatBootstrap();
    setProviders(bootstrap.providers);
    setChats(bootstrap.chats);
    setKnowledgeBases(bootstrap.knowledgeBases ?? []);
    setMcpServers(bootstrap.mcpServers ?? []);
    setSkills(bootstrap.skills ?? []);
    applyDefaultSelection(bootstrap.providers);
    return bootstrap;
  }, [applyDefaultSelection]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        const bootstrap = await loadAiChatBootstrap();
        if (cancelled) return;
        setProviders(bootstrap.providers);
        setChats(bootstrap.chats);
        setKnowledgeBases(bootstrap.knowledgeBases ?? []);
        setMcpServers(bootstrap.mcpServers ?? []);
        setSkills(bootstrap.skills ?? []);
        applyDefaultSelection(bootstrap.providers);
        setError('');
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : '普通聊天加载失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyDefaultSelection]);

  const selectChat = useCallback(async (chatId: string) => {
    const detail = await loadAiChat(chatId);
    setActiveChatId(chatId);
    setActiveChat(detail);
    setTurnsByChatId((current) => {
      const liveTurns = current[chatId];
      if (liveTurns?.some((turn) => turn.status === 'pending' || turn.status === 'running')) {
        return current;
      }
      return { ...current, [chatId]: chatDetailToTurns(detail) };
    });
    return detail;
  }, []);

  const createNewChatDraft = useCallback(() => {
    setActiveChatId(null);
    setActiveChat(null);
    return true;
  }, []);

  const selectProvider = useCallback(async (providerId: string) => {
    if (isRunning) return false;
    const provider = providers.find((item) => item.id === providerId && item.enabled);
    if (!provider) return false;
    const model = preferredModel(provider);
    setDraftProviderId(provider.id);
    setDraftModelId(model?.id ?? '');
    if (activeChatId) {
      const detail = await updateAiChat(activeChatId, {
        providerId: provider.id,
        modelId: model?.id,
      });
      setActiveChat(detail);
      await refreshBootstrap();
    }
    return true;
  }, [activeChatId, isRunning, providers, refreshBootstrap]);

  const selectModel = useCallback(async (modelId: string) => {
    if (isRunning || !selectedProvider) return false;
    const model = selectedProvider.models.find((item) => item.id === modelId && item.enabled);
    if (!model) return false;
    setDraftModelId(model.id);
    if (activeChatId) {
      const detail = await updateAiChat(activeChatId, {
        providerId: selectedProvider.id,
        modelId: model.id,
      });
      setActiveChat(detail);
      await refreshBootstrap();
    }
    return true;
  }, [activeChatId, isRunning, refreshBootstrap, selectedProvider]);

  const toggleKnowledgeBase = useCallback(async (knowledgeBaseId: string) => {
    if (!knowledgeBases.some((item) => item.id === knowledgeBaseId)) return false;
    const nextIds = selectedKnowledgeIds.includes(knowledgeBaseId)
      ? selectedKnowledgeIds.filter((id) => id !== knowledgeBaseId)
      : [...selectedKnowledgeIds, knowledgeBaseId];
    if (!activeChatId) {
      setDraftKnowledgeIds(nextIds);
      return true;
    }
    const detail = await updateAiChat(activeChatId, { selectedKnowledgeIds: nextIds });
    setActiveChat(detail);
    await refreshBootstrap();
    return true;
  }, [activeChatId, knowledgeBases, refreshBootstrap, selectedKnowledgeIds]);

  const toggleSkill = useCallback(async (skillId: string) => {
    if (!skills.some((item) => item.id === skillId)) return false;
    const nextIds = selectedSkillIds.includes(skillId)
      ? selectedSkillIds.filter((id) => id !== skillId)
      : [...selectedSkillIds, skillId];
    if (!activeChatId) {
      setDraftSkillIds(nextIds);
      return true;
    }
    const detail = await updateAiChat(activeChatId, { selectedSkillIds: nextIds });
    setActiveChat(detail);
    await refreshBootstrap();
    return true;
  }, [activeChatId, refreshBootstrap, selectedSkillIds, skills]);

  const toggleMcpServer = useCallback(async (serverId: string) => {
    if (!mcpServers.some((item) => item.id === serverId)) return false;
    const nextIds = selectedMcpIds.includes(serverId)
      ? selectedMcpIds.filter((id) => id !== serverId)
      : [...selectedMcpIds, serverId];
    if (!activeChatId) {
      setDraftMcpIds(nextIds);
      return true;
    }
    const detail = await updateAiChat(activeChatId, { selectedMcpIds: nextIds });
    setActiveChat(detail);
    await refreshBootstrap();
    return true;
  }, [activeChatId, mcpServers, refreshBootstrap, selectedMcpIds]);

  const updateTurn = useCallback((chatId: string, turnId: string, updater: (turn: ConversationTurn) => ConversationTurn) => {
    setTurnsByChatId((current) => ({
      ...current,
      [chatId]: (current[chatId] ?? []).map((turn) => (turn.id === turnId ? updater(turn) : turn)),
    }));
  }, []);

  const flushTextDelta = useCallback((context: RunContext) => {
    if (context.textFrame !== null) {
      window.cancelAnimationFrame(context.textFrame);
      context.textFrame = null;
    }
    const text = context.pendingText;
    context.pendingText = '';
    if (!text) return;
    updateTurn(context.chatId, context.turnId, (turn) =>
      applyAgentRunEventToTurn(turn, { type: 'delta', runId: context.runId, text }),
    );
  }, [updateTurn]);

  const finishRun = useCallback(async (context: RunContext) => {
    flushTextDelta(context);
    if (runContextsRef.current.get(context.chatId) === context) {
      runContextsRef.current.delete(context.chatId);
      setRunningChatIds((current) => current.filter((chatId) => chatId !== context.chatId));
    }
    try {
      const detail = await loadAiChat(context.chatId);
      if (activeChatIdRef.current === context.chatId) {
        setActiveChat(detail);
      }
      setTurnsByChatId((current) => ({
        ...current,
        [context.chatId]: chatDetailToTurns(detail),
      }));
      await refreshBootstrap();
    } catch (nextError) {
      showToast(nextError instanceof Error ? nextError.message : '普通聊天历史刷新失败', 'error');
    }
  }, [flushTextDelta, refreshBootstrap, showToast]);

  const handleEvent = useCallback((event: AiChatRunEvent, context: RunContext) => {
    if (context.terminal || runContextsRef.current.get(context.chatId) !== context) return;
    context.runId = event.runId || context.runId;
    if (event.type === 'delta') {
      context.pendingText += event.text;
      if (context.textFrame === null) {
        context.textFrame = window.requestAnimationFrame(() => flushTextDelta(context));
      }
      return;
    }
    if (event.type === 'usage') {
      const usageEvent = 'usage' in event
        ? normalizeAiUsageEvent(event.runId, event.usage)
        : event;
      updateTurn(context.chatId, context.turnId, (turn) => applyAgentRunEventToTurn(turn, usageEvent));
      return;
    }
    flushTextDelta(context);
    updateTurn(context.chatId, context.turnId, (turn) => applyAgentRunEventToTurn(turn, event));
    if (event.type === 'done' || event.type === 'error') {
      context.terminal = true;
      void finishRun(context);
    }
  }, [finishRun, flushTextDelta, updateTurn]);

  const consumeStream = useCallback(async (response: Response, context: RunContext) => {
    if (!response.body) throw new Error('普通聊天事件流不可读');
    const headerRunId = response.headers.get('X-CodeM-AI-Run-Id')?.trim();
    if (headerRunId) context.runId = headerRunId;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        handleEvent(JSON.parse(line) as AiChatRunEvent, context);
      }
      if (done) {
        if (buffer.trim()) handleEvent(JSON.parse(buffer) as AiChatRunEvent, context);
        break;
      }
    }
    if (!context.terminal) {
      throw new Error('普通聊天事件流提前结束');
    }
  }, [handleEvent]);

  useEffect(() => {
    const chatId = activeChatId;
    if (!chatId || runContextsRef.current.has(chatId) || reconnectAttemptedRef.current.has(chatId)) return;
    const liveTurn = [...(turnsByChatIdRef.current[chatId] ?? [])]
      .reverse()
      .find((turn) => turn.status === 'pending' || turn.status === 'running');
    if (!liveTurn) return;
    reconnectAttemptedRef.current.add(chatId);
    const controller = new AbortController();
    let reconnectContext: RunContext | null = null;
    void (async () => {
      try {
        const runId = await loadActiveAiChatRun(chatId, controller.signal);
        if (!runId) {
          reconnectAttemptedRef.current.delete(chatId);
          return;
        }
        if (runContextsRef.current.has(chatId)) return;
        const context: RunContext = {
          chatId,
          turnId: liveTurn.id,
          runId,
          controller,
          pendingText: '',
          textFrame: null,
          terminal: false,
          cancelRequested: false,
        };
        reconnectContext = context;
        runContextsRef.current.set(chatId, context);
        setRunningChatIds((current) => current.includes(chatId) ? current : [...current, chatId]);
        const response = await reconnectAiChatRun(runId, controller.signal);
        await consumeStream(response, context);
      } catch (nextError) {
        if (!controller.signal.aborted) {
          reconnectAttemptedRef.current.delete(chatId);
          const message = nextError instanceof Error ? nextError.message : '普通聊天运行重连失败';
          if (reconnectContext && runContextsRef.current.get(chatId) === reconnectContext) {
            reconnectContext.terminal = true;
            reconnectContext.cancelRequested = true;
            if (reconnectContext.runId) {
              try {
                await cancelAiChatRun(reconnectContext.runId);
              } catch {
                // 重连失败后的清理以解除前端卡死为主，停止失败由后端最终状态恢复。
              }
            }
            flushTextDelta(reconnectContext);
            runContextsRef.current.delete(chatId);
            setRunningChatIds((current) => current.filter((id) => id !== chatId));
            updateTurn(chatId, reconnectContext.turnId, (turn) => ({
              ...turn,
              status: 'error',
              activity: '运行重连失败',
              metrics: message,
            }));
          }
          showToast(message, 'error');
        }
      }
    })();
    return undefined;
  }, [activeChatId, consumeStream, flushTextDelta, showToast, updateTurn]);

  const submitPrompt = useCallback(async (
    submission: OrdinaryChatSubmission,
    replay?: ReplayOptions,
  ) => {
    if (activeChatId && runContextsRef.current.has(activeChatId)) return false;
    const replayUsesOriginalModel = replay && replay.operation !== 'edit';
    const provider = replayUsesOriginalModel
      ? providers.find((item) => item.id === replay.sourceTurn.providerId) ?? null
      : selectedProvider;
    const model = replayUsesOriginalModel
      ? provider?.models.find((item) => item.id === replay.sourceTurn.modelId) ?? null
      : selectedModel ?? preferredModel(provider);
    if (!provider || !model) {
      showToast('请先配置并选择普通聊天供应商和模型', 'error');
      return false;
    }
    const prompt = submission.prompt.trim();
    const contentBlocks = buildRunContentBlocks({
      prompt,
      attachments: submission.attachments,
      contentBlocks: submission.contentBlocks,
    });
    if (contentBlocks.length === 0) return false;
    let chat = activeChat;
    if (replay && !chat) {
      showToast('要重新发送的普通聊天不存在', 'error');
      return false;
    }
    if (!chat) {
      chat = await createAiChat({ providerId: provider.id, modelId: model.id });
      if (draftKnowledgeIds.length > 0 || draftSkillIds.length > 0 || draftMcpIds.length > 0) {
        chat = await updateAiChat(chat.summary.id, {
          selectedKnowledgeIds: draftKnowledgeIds,
          selectedSkillIds: draftSkillIds,
          selectedMcpIds: draftMcpIds,
        });
      }
      setActiveChatId(chat.summary.id);
      setActiveChat(chat);
      setDraftKnowledgeIds([]);
      setDraftSkillIds([]);
      setDraftMcpIds([]);
    }
    const turnId = replay?.sourceTurn.id ?? crypto.randomUUID();
    const controller = new AbortController();
    const context: RunContext = {
      chatId: chat.summary.id,
      turnId,
      runId: '',
      controller,
      pendingText: '',
      textFrame: null,
      terminal: false,
      cancelRequested: false,
    };
    runContextsRef.current.set(chat.summary.id, context);
    setRunningChatIds((current) => current.includes(chat.summary.id)
      ? current
      : [...current, chat.summary.id]);
    setTurnsByChatId((current) => {
      const existingTurns = current[chat.summary.id] ?? [];
      const sourceIndex = replay
        ? existingTurns.findIndex((turn) => turn.id === turnId)
        : -1;
      const previousTurns = replay && sourceIndex >= 0
        ? existingTurns.slice(0, sourceIndex)
        : existingTurns;
      return {
        ...current,
        [chat.summary.id]: [
        ...previousTurns,
        {
        id: turnId,
        userText: submission.displayText.trim() || prompt,
        userAttachments: stripTransientAttachmentData(submission.attachments),
        userContentBlocks: buildHistoryContentBlocks({
          prompt,
          attachments: submission.attachments,
          contentBlocks,
        }),
        workspace: '',
        assistantText: '',
        tools: [],
        items: [],
        status: 'pending',
        activity: `正在连接 ${provider.name}`,
        phase: 'requesting',
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.id,
        modelName: model.displayName,
        pendingApprovalRequests: [],
        pendingUserInputRequests: [],
        },
        ],
      };
    });
    try {
      const response = await startAiChatRun({
        chatId: chat.summary.id,
        providerId: provider.id,
        modelId: model.id,
        turnId,
        prompt,
        contentBlocks,
        operation: replay?.operation,
        sourceTurnId: replay?.sourceTurn.id,
      }, controller.signal);
      await consumeStream(response, context);
      return true;
    } catch (nextError) {
      if (!context.terminal) {
        context.terminal = true;
        updateTurn(context.chatId, turnId, (turn) => ({
          ...turn,
          status: context.cancelRequested ? 'stopped' : 'error',
          activity: context.cancelRequested ? '已停止' : '运行失败',
          metrics: nextError instanceof Error ? nextError.message : '普通聊天运行失败',
        }));
        await finishRun(context);
      }
      return false;
    }
  }, [activeChat, consumeStream, draftKnowledgeIds, draftMcpIds, draftSkillIds, finishRun, providers, selectedModel, selectedProvider, showToast, updateTurn]);

  const regenerateTurn = useCallback(async (turn: ConversationTurn) => submitPrompt(
    {
      prompt: turn.userText,
      displayText: turn.userText,
    },
    {
      operation: turn.status === 'error' ? 'retry' : 'regenerate',
      sourceTurn: turn,
    },
  ), [submitPrompt]);

  const editAndResendTurn = useCallback(async (
    turn: ConversationTurn,
    submission: OrdinaryChatSubmission,
  ) => submitPrompt(submission, { operation: 'edit', sourceTurn: turn }), [submitPrompt]);

  const deleteTurn = useCallback(async (turnId: string) => {
    if (!activeChatId || runContextsRef.current.has(activeChatId)) return false;
    try {
      const detail = await deleteAiChatTurn(activeChatId, turnId);
      setActiveChat(detail);
      setTurnsByChatId((current) => ({
        ...current,
        [activeChatId]: chatDetailToTurns(detail),
      }));
      await refreshBootstrap();
      return true;
    } catch (nextError) {
      showToast(nextError instanceof Error ? nextError.message : '删除普通聊天消息失败', 'error');
      return false;
    }
  }, [activeChatId, refreshBootstrap, showToast]);

  const stopRun = useCallback(async () => {
    const context = activeChatId ? runContextsRef.current.get(activeChatId) : undefined;
    if (!context || context.cancelRequested) return;
    context.cancelRequested = true;
    if (context.runId) {
      try {
        await cancelAiChatRun(context.runId);
      } catch (nextError) {
        showToast(nextError instanceof Error ? nextError.message : '停止普通聊天失败', 'error');
      }
    } else {
      context.controller.abort();
    }
  }, [activeChatId, showToast]);

  const submitApprovalDecision = useCallback(async (
    turn: ConversationTurn,
    request: ApprovalRequest,
    decision: ApprovalDecision,
  ) => {
    const context = activeChatId ? runContextsRef.current.get(activeChatId) : undefined;
    const requestId = request.requestId?.trim();
    if (!context || context.chatId !== activeChatId || context.turnId !== turn.id || !requestId) {
      showToast('该 MCP 审批已经不在活动运行中', 'error');
      return false;
    }
    updateTurn(context.chatId, context.turnId, (current) => ({
      ...current,
      pendingApprovalRequests: current.pendingApprovalRequests?.filter(
        (item) => item.requestId !== requestId,
      ),
      activity: decision === 'approve' ? '已批准，继续执行' : '已拒绝，正在返回模型',
    }));
    try {
      await submitAiChatApproval(context.runId, requestId, decision);
      return true;
    } catch (nextError) {
      updateTurn(context.chatId, context.turnId, (current) => ({
        ...current,
        pendingApprovalRequests: [
          ...(current.pendingApprovalRequests ?? []).filter((item) => item.requestId !== requestId),
          request,
        ],
      }));
      showToast(nextError instanceof Error ? nextError.message : '提交 MCP 审批失败', 'error');
      return false;
    }
  }, [activeChatId, showToast, updateTurn]);

  const togglePin = useCallback(async (chatId: string, pinned: boolean) => {
    const detail = await pinAiChat(chatId, pinned);
    if (activeChatId === chatId) setActiveChat(detail);
    await refreshBootstrap();
  }, [activeChatId, refreshBootstrap]);

  const renameChat = useCallback(async (chatId: string, title: string) => {
    const detail = await updateAiChat(chatId, { title });
    if (activeChatId === chatId) setActiveChat(detail);
    await refreshBootstrap();
  }, [activeChatId, refreshBootstrap]);

  const removeChat = useCallback(async (chatId: string) => {
    await deleteAiChat(chatId);
    if (activeChatId === chatId) createNewChatDraft();
    await refreshBootstrap();
  }, [activeChatId, createNewChatDraft, refreshBootstrap]);

  const exportChat = useCallback(() => {
    if (!activeChat) {
      showToast('当前没有可导出的普通聊天', 'info');
      return false;
    }
    const turns = chatDetailToTurns(activeChat);
    const lines = [
      `# ${activeChat.summary.title}`,
      '',
      `导出时间：${new Date().toLocaleString()}`,
      '',
    ];
    for (const turn of turns) {
      lines.push('## 用户', '', turn.userText || '[仅附件消息]', '');
      lines.push(
        `## ${turn.providerName || 'AI'}${turn.modelName ? ` · ${turn.modelName}` : ''}`,
        '',
        turn.assistantText || (turn.status === 'error' ? '[生成失败]' : '[无文本回复]'),
        '',
      );
      if (turn.tools.length > 0) {
        lines.push('### 工具记录', '');
        for (const tool of turn.tools) {
          lines.push(`- ${tool.title || tool.name}：${tool.status}`);
        }
        lines.push('');
      }
      if (turn.citations?.length) {
        lines.push('### 知识库来源', '');
        for (const citation of turn.citations) {
          lines.push(`- ${citation.sourceName}${citation.sourcePath ? ` · ${citation.sourcePath}` : ''}`);
        }
        lines.push('');
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeExportFileName(activeChat.summary.title)}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }, [activeChat, showToast]);

  const activeThread = useMemo<ThreadDetail | null>(() => {
    if (!activeChat && turns.length === 0) return null;
    const summary = activeChat?.summary;
    return {
      id: summary?.id ?? 'ordinary-chat-draft',
      projectId: '',
      title: summary?.title ?? '新建聊天',
      sessionId: '',
      workingDirectory: '',
      updatedAt: summary?.updatedAt ?? new Date().toISOString(),
      updatedLabel: '',
      provider: 'ordinary-chat',
      model: selectedModelId,
      pinnedAt: summary?.pinnedAt,
      turns,
      debugEvents: [],
      rawEvents: [],
      historyLoaded: true,
      historyLoading: false,
    };
  }, [activeChat, selectedModelId, turns]);

  return {
    providers,
    chats,
    knowledgeBases,
    mcpServers,
    skills,
    activeChatId,
    activeChat,
    activeThread,
    isNewChatDraft: !activeChatId,
    selectedProviderId,
    selectedProvider,
    selectedModelId,
    selectedModel,
    selectedKnowledgeIds,
    selectedMcpIds,
    selectedSkillIds,
    isRunning,
    runningChatIds,
    loading,
    error,
    refreshBootstrap,
    selectChat,
    createNewChatDraft,
    selectProvider,
    selectModel,
    toggleKnowledgeBase,
    toggleMcpServer,
    toggleSkill,
    submitPrompt,
    regenerateTurn,
    editAndResendTurn,
    deleteTurn,
    stopRun,
    submitApprovalDecision,
    togglePin,
    renameChat,
    removeChat,
    exportChat,
  };
}

function safeExportFileName(value: string) {
  const normalized = [...value]
    .map((character) => character.charCodeAt(0) < 32 ? '_' : character)
    .join('')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return normalized || '普通聊天';
}

function preferredModel(provider: AiChatProvider | null | undefined) {
  return provider?.models.find((model) => model.enabled && model.isDefault)
    ?? provider?.models.find((model) => model.enabled)
    ?? null;
}

function chatDetailToTurns(detail: AiChatDetail): ConversationTurn[] {
  const grouped = new Map<string, AiChatDetail['messages']>();
  for (const message of detail.messages) {
    const messages = grouped.get(message.turnId) ?? [];
    messages.push(message);
    grouped.set(message.turnId, messages);
  }
  return [...grouped.entries()].map(([turnId, messages]) => {
    const user = messages.find((message) => message.role === 'user');
    const assistant = messages.find((message) => message.role === 'assistant');
    const assistantText = assistant?.content ?? '';
    const status = assistant?.status ?? 'done';
    let turn: ConversationTurn = {
      id: turnId,
      userText: user?.content ?? '',
      userContentBlocks: user?.contentBlocks,
      workspace: '',
      assistantText,
      tools: [],
      items: assistantText ? [{ id: `${assistant?.id ?? turnId}-text`, type: 'text', text: assistantText }] : [],
      status,
      activity: status === 'error' ? '运行失败' : undefined,
      providerId: assistant?.providerId ?? user?.providerId,
      providerName: assistant?.providerName ?? user?.providerName,
      modelId: assistant?.modelId ?? user?.modelId,
      modelName: assistant?.modelName ?? user?.modelName,
      citations: assistant?.citations,
      pendingApprovalRequests: [],
      pendingUserInputRequests: [],
    };
    const toolCalls = detail.toolCalls.filter((call) => call.turnId === turnId);
    for (let index = 0; index < toolCalls.length; index += 1) {
      const call = toolCalls[index];
      turn = applyAgentRunEventToTurn(turn, {
        type: 'tool-start',
        runId: '',
        blockIndex: index,
        toolUseId: call.toolCallId,
        name: call.name,
        input: call.input,
      });
      turn = applyAgentRunEventToTurn(turn, {
        type: 'tool-stop',
        runId: '',
        blockIndex: index,
        toolUseId: call.toolCallId,
      });
      if (call.result !== undefined) {
        turn = applyAgentRunEventToTurn(turn, {
          type: 'tool-result',
          runId: '',
          toolUseId: call.toolCallId,
          content: toolCallResultContent(call.result),
          isError: call.status === 'error' || call.status === 'rejected',
        });
      }
      if (call.status === 'waiting_approval' && call.approval?.requestId) {
        turn = applyAgentRunEventToTurn(turn, {
          type: 'approval-request',
          runId: '',
          request: call.approval,
        });
      }
    }
    if (assistant?.usage) {
      turn = applyAgentRunEventToTurn(
        turn,
        normalizeAiUsageEvent('', assistant.usage),
      );
    }
    return {
      ...turn,
      status,
      activity: status === 'error'
        ? '运行失败'
        : status === 'running' && turn.pendingApprovalRequests?.length
          ? '等待批准'
          : turn.activity,
      phase: status === 'running' ? turn.phase : undefined,
    };
  });
}

function toolCallResultContent(result: unknown) {
  if (!result || typeof result !== 'object') return String(result ?? '');
  const content = (result as { content?: unknown }).content;
  return typeof content === 'string' ? content : JSON.stringify(result);
}

function normalizeAiUsageEvent(
  runId: string,
  usage: Record<string, unknown>,
): Extract<AgentRunEvent, { type: 'usage' }> {
  const inputTokens = firstNumber(
    usage.input_tokens,
    usage.prompt_tokens,
    usage.promptTokenCount,
  );
  const outputTokens = firstNumber(
    usage.output_tokens,
    usage.completion_tokens,
    usage.candidatesTokenCount,
  );
  const cacheCreationInputTokens = firstNumber(usage.cache_creation_input_tokens);
  const cacheReadInputTokens = firstNumber(
    usage.cache_read_input_tokens,
    usage.cachedContentTokenCount,
    nestedNumber(usage.prompt_tokens_details, 'cached_tokens'),
    nestedNumber(usage.input_tokens_details, 'cached_tokens'),
  );
  return {
    type: 'usage',
    runId,
    usageSource: 'result',
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
  };
}

function nestedNumber(value: unknown, key: string) {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}
