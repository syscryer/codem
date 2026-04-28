export type PermissionMode =
  | 'default'
  | 'plan'
  | 'acceptEdits'
  | 'auto'
  | 'dontAsk'
  | 'bypassPermissions';

export type ClaudeContentBlock = {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};

export type TurnPhase = 'requesting' | 'thinking' | 'computing' | 'tool';

export type UsageSnapshot = {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

export type RuntimeReconnectReason =
  | 'resume-session-missing'
  | 'broken-pipe'
  | 'runtime-ended'
  | 'stale-session'
  | 'transport-error'
  | 'unknown';

export type RuntimeSuggestedAction = 'retry' | 'resend' | 'recover';

export type RuntimeEventSource = 'status' | 'stderr' | 'result' | 'process';

export type RuntimeRecoveryHint = {
  reason: RuntimeReconnectReason;
  message: string;
  retryable: boolean;
  suggestedAction: RuntimeSuggestedAction;
  source: RuntimeEventSource;
};

export type RequestUserInputOption = {
  label: string;
  description?: string;
};

export type RequestUserInputQuestion = {
  id?: string;
  header?: string;
  question: string;
  options?: RequestUserInputOption[];
  multiSelect?: boolean;
  required?: boolean;
  secret?: boolean;
  isOther?: boolean;
  placeholder?: string;
};

export type RequestUserInputRequest = {
  requestId?: string;
  title?: string;
  description?: string;
  questions: RequestUserInputQuestion[];
  submittedAnswers?: Record<string, string>;
  submittedAtMs?: number;
};

export type ApprovalRequest = {
  requestId?: string;
  title: string;
  description?: string;
  command?: string[];
  danger?: 'low' | 'medium' | 'high';
  historical?: boolean;
};

export type ApprovalDecision = 'approve' | 'reject';

export type ClaudeEvent =
  | { type: 'status'; runId: string; message: string }
  | { type: 'session'; runId: string; sessionId: string }
  | { type: 'delta'; runId: string; text: string }
  | { type: 'thinking-delta'; runId: string; text: string }
  | { type: 'trace'; runId: string; name: string; atMs: number; elapsedMs: number; detail?: string }
  | { type: 'phase'; runId: string; phase: TurnPhase; label: string; thoughtCount?: number }
  | ({ type: 'usage'; runId: string } & UsageSnapshot)
  | { type: 'claude-event'; runId: string; label: string; eventType?: string; subtype?: string; status?: string; raw: unknown }
  | { type: 'request-user-input'; runId: string; request: RequestUserInputRequest }
  | { type: 'approval-request'; runId: string; request: ApprovalRequest }
  | { type: 'runtime-reconnect-hint'; runId: string; hint: RuntimeRecoveryHint }
  | { type: 'retryable-error'; runId: string; message: string; hint: RuntimeRecoveryHint }
  | { type: 'tool-start'; runId: string; blockIndex: number; toolUseId?: string; parentToolUseId?: string; isSidechain?: boolean; name: string; input?: unknown }
  | { type: 'tool-input-delta'; runId: string; blockIndex: number; toolUseId?: string; parentToolUseId?: string; isSidechain?: boolean; text: string }
  | { type: 'tool-stop'; runId: string; blockIndex: number; toolUseId?: string; parentToolUseId?: string; isSidechain?: boolean }
  | { type: 'tool-result'; runId: string; toolUseId?: string; parentToolUseId?: string; isSidechain?: boolean; content: string; isError?: boolean }
  | { type: 'subagent-delta'; runId: string; parentToolUseId?: string; text: string }
  | { type: 'assistant-snapshot'; runId: string; blocks: ClaudeContentBlock[] }
  | { type: 'raw'; runId: string; raw: unknown }
  | { type: 'stderr'; runId: string; text: string }
  | ({ type: 'done'; runId: string; sessionId?: string; result: string; totalCostUsd?: number; durationMs?: number } & UsageSnapshot)
  | { type: 'error'; runId: string; message: string };

export type ToolStep = {
  id: string;
  name: string;
  title: string;
  status: 'running' | 'done' | 'error';
  blockIndex?: number;
  toolUseId?: string;
  parentToolUseId?: string;
  isSidechain?: boolean;
  inputText?: string;
  resultText?: string;
  isError?: boolean;
  subtools?: ToolStep[];
  subMessages?: string[];
};

export type UserImageAttachment = {
  id: string;
  path: string;
  name: string;
  mimeType?: string;
  size?: number;
};

export type AssistantItem =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'thinking'; text: string }
  | { id: string; type: 'tool'; tool: ToolStep };

export type ConversationTurn = {
  id: string;
  backendRunId?: string;
  userText: string;
  userAttachments?: UserImageAttachment[];
  workspace: string;
  assistantText: string;
  tools: ToolStep[];
  items: AssistantItem[];
  status: 'pending' | 'running' | 'done' | 'error' | 'stopped';
  activity?: string;
  metrics?: string;
  sessionId?: string;
  phase?: TurnPhase;
  startedAtMs?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  totalCostUsd?: number;
  thoughtCount?: number;
  pendingUserInputRequests?: RequestUserInputRequest[];
  pendingApprovalRequests?: ApprovalRequest[];
  recoveryHint?: RuntimeRecoveryHint;
};

export type DebugEvent = {
  id: string;
  title: string;
  content: string;
  tone?: 'neutral' | 'error';
};

export type SettingsSection =
  | 'basic'
  | 'appearance'
  | 'shortcuts'
  | 'providers'
  | 'usage'
  | 'sessions'
  | 'mcp'
  | 'skills'
  | 'globalPrompts'
  | 'openWith';

export type ThemeMode = 'system' | 'light' | 'dark';
export type InterfaceDensity = 'comfortable' | 'compact';
export type SidebarWidthMode = 'narrow' | 'default' | 'wide';

export type GeneralSettings = {
  restoreLastSelectionOnLaunch: boolean;
  autoRefreshGitStatus: boolean;
  showDebugButton: boolean;
};

export type AppearanceSettings = {
  themeMode: ThemeMode;
  density: InterfaceDensity;
  uiFontSize: 12 | 13 | 14 | 15;
  codeFontSize: 12 | 13 | 14;
  sidebarWidth: SidebarWidthMode;
};

export type CustomModel = {
  id: string;
  label?: string;
  description?: string;
};

export type ModelSettings = {
  customModels: CustomModel[];
  defaultModelId: string;
};

export type ComposerSendShortcut = 'enter' | 'modEnter';

export type ShortcutSettings = {
  newChat: string | null;
  toggleSearch: string | null;
  toggleDebug: string | null;
  composerSend: ComposerSendShortcut;
};

export type OpenAppTargetKind = 'app' | 'command' | 'explorer' | 'terminal' | 'git-bash' | 'wsl';

export type OpenAppTarget = {
  id: string;
  label: string;
  kind: OpenAppTargetKind;
  command?: string;
  args: string[];
};

export type OpenWithSettings = {
  selectedTargetId: string;
  customTargets: OpenAppTarget[];
};

export type OpenWithTargetsResponse = {
  targets: OpenAppTarget[];
  selectedTargetId: string;
};

export type AppSettings = {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  models: ModelSettings;
  shortcuts: ShortcutSettings;
  openWith: OpenWithSettings;
};

export type UsageTotals = {
  projects: number;
  threads: number;
  messages: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  durationMs: number;
  totalCostUsd: number;
};

export type UsageProviderRow = UsageTotals & {
  provider: string;
  model: string;
  lastUsedAt: string | null;
};

export type UsageProjectRow = UsageTotals & {
  projectId: string;
  projectName: string;
  projectPath: string;
  lastUsedAt: string | null;
};

export type UsageStatsResponse = {
  generatedAt: string;
  totals: UsageTotals;
  byProvider: UsageProviderRow[];
  byProject: UsageProjectRow[];
};

export type ThreadSummary = {
  id: string;
  projectId: string;
  title: string;
  sessionId: string;
  workingDirectory: string;
  updatedAt: string;
  updatedLabel: string;
  provider: string;
  imported?: boolean;
  model?: string;
  permissionMode?: string;
};

export type ProjectSummary = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  gitBranch?: string;
  gitDiff: GitDiffSummary;
  isGitRepo: boolean;
  threads: ThreadSummary[];
};

export type GitDiffSummary = {
  additions: number;
  deletions: number;
  filesChanged: number;
};

export type GitBranchSummary = {
  name: string;
  current: boolean;
};

export type ProjectGitSummary = Pick<ProjectSummary, 'gitBranch' | 'gitDiff' | 'isGitRepo'>;

export type PanelState = {
  organizeBy: 'project' | 'timeline' | 'chat-first';
  sortBy: 'created' | 'updated';
  visibility: 'all' | 'relevant';
};

export type WorkspaceBootstrap = {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  activeThreadId: string | null;
  panelState: PanelState;
};

export type ThreadHistoryPayload = {
  threadId: string;
  turns: ConversationTurn[];
};

export type ThreadDetail = ThreadSummary & {
  turns: ConversationTurn[];
  debugEvents: DebugEvent[];
  rawEvents: string[];
  historyLoaded: boolean;
  historyLoading: boolean;
};

export type ClaudeModelInfo = {
  available: boolean;
  models: ClaudeModelOption[];
  error?: string;
};

export type ClaudeModelOption = {
  id: string;
  label: string;
  description?: string;
  model?: string;
  kind?: 'default' | 'slot' | 'custom';
};

export type ClaudeGlobalPrompt = {
  path: string;
  content: string;
  exists: boolean;
  updatedAt?: string;
  length: number;
};

export type McpServerSummary = {
  id: string;
  name: string;
  source: string;
  status: 'available' | 'unknown' | 'error';
  tools: Array<{ name: string; description?: string }>;
  command?: string;
  args?: string[];
  error?: string;
};

export type McpSourceError = {
  source: string;
  path: string;
  message: string;
};

export type McpServersResponse = {
  servers: McpServerSummary[];
  errors: McpSourceError[];
};

export type SkillSummary = {
  id: string;
  name: string;
  description?: string;
  path: string;
  source: 'user' | 'plugin' | 'project' | 'system' | 'unknown';
};

export type SkillScanError = {
  path: string;
  message: string;
};

export type SkillsResponse = {
  skills: SkillSummary[];
  errors: SkillScanError[];
};

export type InputDialogState =
  | {
      kind: 'rename-project';
      title: string;
      description: string;
      confirmLabel: string;
      value: string;
      projectId: string;
    }
  | {
      kind: 'rename-thread';
      title: string;
      description: string;
      confirmLabel: string;
      value: string;
      threadId: string;
    };

export type ConfirmDialogState =
  | {
      kind: 'remove-project';
      title: string;
      description: string;
      confirmLabel: string;
      projectId: string;
    }
  | {
      kind: 'remove-thread';
      title: string;
      description: string;
      confirmLabel: string;
      threadId: string;
    }
  | null;

export type ToastState = {
  id: string;
  message: string;
  tone: 'success' | 'error' | 'info';
};
