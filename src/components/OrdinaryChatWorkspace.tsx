import { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { ReturnTypeUseOrdinaryChat } from '../hooks/useOrdinaryChat.types';
import type {
  AgentModelCatalog,
  AgentProviderDescriptor,
  AiChatSummary,
  ApprovalDecision,
  ApprovalRequest,
  ConversationTurn,
  RequestUserInputRequest,
} from '../types';
import { ordinaryChatReasoningOptions, ordinaryChatSupportsWebSearch } from '../lib/ordinary-chat-capabilities';
import { Composer } from './Composer';
import { ConversationPane } from './ConversationPane';
import { OrdinaryChatHeader } from './OrdinaryChatHeader';

type OrdinaryChatWorkspaceProps = {
  chat: ReturnTypeUseOrdinaryChat;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
  onOpenAiSettings: () => void;
  onOpenKnowledgeManager: () => void;
  onRenameChat: (chat: AiChatSummary) => void;
  onDeleteChat: (chat: AiChatSummary) => void;
};

export function OrdinaryChatWorkspace({
  chat,
  showToast,
  onOpenAiSettings,
  onOpenKnowledgeManager,
  onRenameChat,
  onDeleteChat,
}: OrdinaryChatWorkspaceProps) {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState('');
  const [editingTurn, setEditingTurn] = useState<ConversationTurn | null>(null);
  const [pendingDeleteTurn, setPendingDeleteTurn] = useState<ConversationTurn | null>(null);

  useEffect(() => {
    setDraft('');
    setEditingTurn(null);
    setPendingDeleteTurn(null);
  }, [chat.activeChatId]);

  const providerDescriptors = useMemo<AgentProviderDescriptor[]>(
    () => chat.providers.map((provider) => ({
      id: provider.id,
      displayName: provider.name,
      driverId: provider.protocol,
      icon: provider.presetId,
      models: provider.models.filter((model) => model.enabled).map((model) => ({
        id: model.id,
        label: model.displayName,
        description: model.modelId === model.displayName ? undefined : model.modelId,
        contextWindowTokens:
          typeof model.capabilities.contextWindowTokens === 'number'
            ? model.capabilities.contextWindowTokens
            : undefined,
        isDefault: model.isDefault,
        supportedReasoningEfforts: [],
      })),
      lifecycle: 'active',
      available: provider.enabled && provider.apiKeySaved,
      selectable: provider.enabled && provider.apiKeySaved && provider.models.some((model) => model.enabled),
      capabilities: {
        sessions: { create: 'supported', resume: 'supported', list: 'supported', import: 'unsupported' },
        input: { text: 'supported', images: 'supported', fileReferences: 'supported' },
        tools: { streaming: 'supported', approval: 'supported', userInput: 'unsupported', mcp: 'supported' },
        runtime: { cancel: 'hard', reconnect: 'supported', concurrentSessions: 'supported' },
      },
    })),
    [chat.providers],
  );

  const modelCatalog = useMemo<AgentModelCatalog | null>(() => {
    const provider = chat.selectedProvider;
    if (!provider) return null;
    const models = provider.models.filter((model) => model.enabled).map((model) => ({
      id: model.id,
      label: model.displayName,
      description: model.modelId === model.displayName ? undefined : model.modelId,
      contextWindowTokens:
        typeof model.capabilities.contextWindowTokens === 'number'
          ? model.capabilities.contextWindowTokens
          : undefined,
      isDefault: model.isDefault,
      supportedReasoningEfforts: [],
    }));
    return {
      providerId: provider.id,
      defaultModelId: models.find((model) => model.isDefault)?.id ?? models[0]?.id,
      models,
    };
  }, [chat.selectedProvider]);

  const reasoningOptions = ordinaryChatReasoningOptions(chat.selectedProvider, chat.selectedModel);
  const webSearchAvailable = ordinaryChatSupportsWebSearch(chat.selectedProvider, chat.selectedModel);

  const activeTurnId = findActiveTurnId(chat.activeThread?.turns ?? []);
  const hasUsableProvider = chat.providers.some((provider) => (
    provider.enabled
    && provider.apiKeySaved
    && provider.models.some((model) => model.enabled)
  ));
  const needsProviderSetup = !chat.loading && !hasUsableProvider;
  const providerSetupDescription = chat.providers.length === 0
    ? '普通聊天不使用 Agent 配置。请先在全局设置中添加一个 AI 供应商和模型。'
    : '已有供应商尚未完成 API Key、启用状态或模型配置，请前往全局设置检查。';

  return (
    <main className="chat-shell ordinary-chat-shell">
      <OrdinaryChatHeader
        chat={chat.activeChat?.summary ?? null}
        isDraft={chat.isNewChatDraft}
        onTogglePin={chat.togglePin}
        onRename={onRenameChat}
        onDelete={onDeleteChat}
        onExport={() => {
          chat.exportChat();
        }}
      />

      <ConversationPane
        activeThread={chat.activeThread}
        isNewChatDraft={chat.isNewChatDraft}
        activeProject={null}
        activeProjectName="普通聊天"
        attachmentPreviewScope="desktop"
        emptyDraftTitle={needsProviderSetup ? '配置 AI 供应商后开始聊天' : '开始普通聊天'}
        emptyDraftDescription={needsProviderSetup
          ? providerSetupDescription
          : '选择供应商和模型后发送消息；聊天不属于项目，也不会启动 Agent。'}
        emptyDraftActionLabel={needsProviderSetup ? '前往全局设置' : undefined}
        onEmptyDraftAction={needsProviderSetup ? onOpenAiSettings : undefined}
        collapseIntermediateProcess={false}
        thinkingLabel="思考"
        clockNowMs={Date.now()}
        isRunning={chat.isRunning}
        activeTurnId={activeTurnId}
        transcriptRef={transcriptRef}
        bottomRef={bottomRef}
        undoneTurnIds={{}}
        onOpenWorkbenchPreview={() => undefined}
        onOpenOutputPath={async () => undefined}
        onRevealOutputPath={async () => undefined}
        onUndoChangedFiles={() => undefined}
        onSubmitRequestUserInput={async (
          _turn: ConversationTurn,
          _request: RequestUserInputRequest,
          _answers: Record<string, string>,
        ) => false}
        onSubmitRuntimeRecoveryAction={async () => false}
        onSubmitApprovalDecision={async (
          turn: ConversationTurn,
          request: ApprovalRequest,
          decision: ApprovalDecision,
        ) => chat.submitApprovalDecision(turn, request, decision)}
        onEditUserMessage={(turn) => {
          setEditingTurn(turn);
          setDraft(turn.userText);
        }}
        onDeleteTurn={setPendingDeleteTurn}
        onRegenerateTurn={(turn) => {
          setEditingTurn(null);
          setDraft('');
          void chat.regenerateTurn(turn);
        }}
      />

      {editingTurn ? (
        <div className="ordinary-chat-editing-bar">
          <span><Pencil size={14} /> 正在编辑历史消息；发送后会从这一轮重新生成后续内容。</span>
          <button
            type="button"
            onClick={() => {
              setEditingTurn(null);
              setDraft('');
            }}
          >
            取消编辑
          </button>
        </div>
      ) : null}

      <Composer
        variant="ordinary"
        agent="generic"
        providerId={chat.selectedProviderId}
        providers={providerDescriptors}
        providersLoading={chat.loading}
        providersError={chat.error}
        canSelectProvider={!chat.isRunning}
        allowAttachments={true}
        supportsQueue={false}
        workspace=""
        permissionMode="default"
        model=""
        effort="default"
        models={[]}
        agentModel={chat.selectedModelId}
        agentReasoningEffort=""
        agentModelCatalog={modelCatalog}
        agentModelsLoading={false}
        agentModelsError=""
        agentModelSelectionWarning=""
        knowledgeBases={chat.knowledgeBases}
        selectedKnowledgeIds={chat.selectedKnowledgeIds}
        mcpServers={chat.mcpServers}
        selectedMcpIds={chat.selectedMcpIds}
        ordinaryThinkingEnabled={chat.selectedRuntimeOptions.thinkingEnabled}
        ordinaryReasoningEffort={chat.selectedRuntimeOptions.reasoningEffort}
        ordinaryReasoningOptions={reasoningOptions}
        ordinaryWebSearchEnabled={chat.selectedRuntimeOptions.webSearchEnabled}
        ordinaryWebSearchAvailable={webSearchAvailable}
        turns={chat.activeThread?.turns ?? []}
        isRunning={chat.isRunning}
        draftScopeKey={chat.activeChatId ?? 'ordinary-chat-draft'}
        draft={draft}
        queuedPrompts={[]}
        queuedPromptGuideAvailability={{ available: false }}
        onDraftChange={setDraft}
        onSelectProvider={(providerId) => {
          void chat.selectProvider(providerId);
          return true;
        }}
        onSubmitPrompt={async (submission) => {
          const submitted = editingTurn
            ? await chat.editAndResendTurn(editingTurn, submission)
            : await chat.submitPrompt(submission);
          if (submitted) {
            setDraft('');
            setEditingTurn(null);
          }
          return submitted;
        }}
        onRemoveQueuedPrompt={() => undefined}
        onRecallQueuedPrompt={() => undefined}
        onGuideQueuedPrompt={() => false}
        showToast={showToast}
        onKeyDown={() => undefined}
        onSelectPermissionMode={() => undefined}
        onSelectModel={() => undefined}
        onSelectEffort={() => undefined}
        onSelectAgentModel={(modelId) => void chat.selectModel(modelId)}
        onSelectAgentReasoningEffort={() => undefined}
        onRetryAgentModels={() => void chat.refreshBootstrap()}
        onToggleKnowledgeBase={chat.toggleKnowledgeBase}
        onManageKnowledgeBases={onOpenKnowledgeManager}
        onToggleMcpServer={chat.toggleMcpServer}
        onToggleOrdinaryThinking={() => chat.updateRuntimeOptions({
          thinkingEnabled: !chat.selectedRuntimeOptions.thinkingEnabled,
        })}
        onSelectOrdinaryReasoningEffort={(effort) => chat.updateRuntimeOptions({ reasoningEffort: effort })}
        onToggleOrdinaryWebSearch={() => chat.updateRuntimeOptions({
          webSearchEnabled: !chat.selectedRuntimeOptions.webSearchEnabled,
        })}
        onOpenPlugins={onOpenAiSettings}
        onCreateNewChat={() => {
          chat.createNewChatDraft();
        }}
        onStopRun={chat.stopRun}
        onRunSlashSystemCommand={() => undefined}
        onRefreshClaudeContext={async () => undefined}
      />

      {pendingDeleteTurn ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setPendingDeleteTurn(null)}>
          <section
            className="dialog-card ordinary-turn-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ordinary-turn-delete-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h3 id="ordinary-turn-delete-title">删除这一轮消息？</h3>
            <p>只删除选中的用户消息、回复和工具记录，不会删除整个聊天。</p>
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={() => setPendingDeleteTurn(null)}>取消</button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const turnId = pendingDeleteTurn.id;
                  setPendingDeleteTurn(null);
                  void chat.deleteTurn(turnId);
                }}
              >
                删除这一轮
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function findActiveTurnId(turns: ConversationTurn[]) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.status === 'running') return turns[index]?.id ?? '';
  }
  return '';
}
