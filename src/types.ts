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
  modelContextWindow?: number;
  usageSource?: 'context' | 'message' | 'result';
};

export type ClaudeContextSummary = {
  hasContextUsage: boolean;
  hasMcpTools: boolean;
  hasFreeSpace: boolean;
  hasSystemPrompt: boolean;
  hasMemory: boolean;
  hasSkills: boolean;
  model?: string;
  usedTokens?: number;
  totalTokens?: number;
  freeTokens?: number;
  percent?: number;
  categories: {
    systemPrompt?: number;
    memoryFiles?: number;
    skills?: number;
    messages?: number;
    freeSpace?: number;
  };
  mcpToolCount: number;
  memoryFileCount: number;
  skillCount: number;
  markdownChars: number;
};

export type ClaudeContextSnapshot = {
  source: 'stream-json';
  requestedAtMs: number;
  durationMs: number;
  eventCount: number;
  markdown: string;
  markdownTruncated: boolean;
  summary: ClaudeContextSummary;
};

export type ClaudeContextRequestState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  context?: ClaudeContextSnapshot;
  error?: string;
  updatedAtMs?: number;
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
  readyAtMs?: number;
  submittedAnswers?: Record<string, string>;
  submittedAtMs?: number;
};

export type ApprovalRequest = {
  requestId?: string;
  kind?: 'permission' | 'plan-exit';
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
  data?: string;
};

export type InputReferenceReason = 'too_large' | 'binary' | 'unsupported' | 'provider_unsupported';

// file_reference 的来源：'mention' 来自 @文件（路径已体现在 prompt 文本，不单独显示卡片）；
// 'attachment' 来自桌面端拖拽 / 文件框选择的附件（需要在用户消息里显示成附件卡片）。
export type InputReferenceSource = 'mention' | 'attachment';

export type InputContentBlock =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image';
      id?: string;
      path?: string;
      name?: string;
      mimeType?: string;
      size?: number;
      data?: string;
    }
  | {
      type: 'file_text';
      id?: string;
      path: string;
      name: string;
      mimeType?: string;
      size?: number;
      text: string;
      textBytes?: number;
    }
  | {
      type: 'file_reference';
      id?: string;
      path: string;
      name: string;
      mimeType?: string;
      size?: number;
      reason?: InputReferenceReason;
      source?: InputReferenceSource;
    }
  | {
      type: 'attachment_metadata';
      id?: string;
      name: string;
      mimeType?: string;
      size?: number;
      reason: string;
    };

export type InputContentBlockSummary =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image';
      id?: string;
      path?: string;
      name?: string;
      mimeType?: string;
      size?: number;
      imageBytes?: number;
    }
  | {
      type: 'file_text';
      id?: string;
      path: string;
      name: string;
      mimeType?: string;
      size?: number;
      textBytes: number;
    }
  | {
      type: 'file_reference';
      id?: string;
      path: string;
      name: string;
      mimeType?: string;
      size?: number;
      reason?: InputReferenceReason;
      source?: InputReferenceSource;
    }
  | {
      type: 'attachment_metadata';
      id?: string;
      name: string;
      mimeType?: string;
      size?: number;
      reason: string;
    };

export type AgentType = 'claude' | 'codex' | 'gemini' | 'opencode';

export type SlashCardType = 'status' | 'context' | 'cost' | 'compact';

export type SystemCommandItem = {
  id: string;
  type: 'system-command';
  command: string;
  title: string;
  cardType: SlashCardType;
  state: 'running' | 'done' | 'error';
  summary?: string;
  // 引导随附的图片：只存路径 / 元数据（不含 base64），供卡片显示缩略图。
  attachments?: UserImageAttachment[];
  details?: Record<string, unknown>;
  errorMessage?: string;
};

export type AssistantItem =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'thinking'; text: string }
  | { id: string; type: 'tool'; tool: ToolStep }
  | SystemCommandItem;

export type ConversationTurn = {
  id: string;
  backendRunId?: string;
  userText: string;
  userAttachments?: UserImageAttachment[];
  userContentBlocks?: InputContentBlockSummary[];
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
  contextUsage?: UsageSnapshot;
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
  | 'worktree'
  | 'mcp'
  | 'plugins'
  | 'globalPrompts'
  | 'openWith';

export type PluginTab = 'plugins' | 'skills';
export type PluginSubTab = 'installed' | 'discover' | 'marketplaces';

export type ThemeMode = 'system' | 'light' | 'dark';
export type InterfaceDensity = 'comfortable' | 'compact';
export type SidebarWidthMode = 'narrow' | 'default' | 'wide';
export type DesktopPlatform = 'macos' | 'windows' | 'linux' | 'unknown';
export type WindowMaterialMode = 'auto' | 'none' | 'mica' | 'acrylic' | 'micaAlt';
export type AccentColorPreset = 'blue' | 'emerald' | 'amber' | 'rose' | 'violet';
export type AccentColorValue = AccentColorPreset | 'custom';
export type ReviewDisplayMode = 'tree' | 'flat';
export type UiFontFamilyPreset =
  | 'codex'
  | 'system'
  | 'segoe'
  | 'yahei'
  | 'dengxian'
  | 'song'
  | 'sourceHanSans'
  | 'misans'
  | 'harmony';
export type CodeFontFamilyPreset =
  | 'cascadia'
  | 'jetbrains'
  | 'consolas'
  | 'firaCode'
  | 'sourceCodePro';
export type FontSettingMode = 'preset' | 'custom';
export type ChatFontSettingMode = 'followUi' | 'preset' | 'custom';

export type GeneralSettings = {
  restoreLastSelectionOnLaunch: boolean;
  autoRefreshGitStatus: boolean;
  enableThreadSystemNotifications: boolean;
  autoGuideQueuedPrompts: boolean;
  autoCheckAppUpdate: boolean;
  showDebugButton: boolean;
  defaultPermissionMode: PermissionMode;
  reviewHideNoiseFilesByDefault: boolean;
  reviewDefaultDisplayMode: ReviewDisplayMode;
  reviewNoisePatterns: string[];
  reviewIgnorePatternsCustomized: boolean;
};

export type AppUpdateCheckState = 'idle' | 'checking' | 'latest' | 'available' | 'failed' | 'unsupported';

export type AppDistributionMode = 'desktop-nsis' | 'desktop-portable' | 'web';

export type AppRuntimeInfo = {
  version: string;
  repositoryUrl: string;
  distributionMode: AppDistributionMode;
  isTauri: boolean;
};

export type ClaudeCliVersionInfo = {
  installed: boolean;
  supported: boolean;
  version: string | null;
  recommendedVersion: string;
  command: string | null;
  updateCommand: string;
  installCommand: string;
  setupUrl: string;
  versionError?: string;
};

export type AppearanceSettings = {
  themeMode: ThemeMode;
  density: InterfaceDensity;
  accentColor: AccentColorValue;
  accentColorCustom: string;
  uiFontMode: FontSettingMode;
  uiFontPreset: UiFontFamilyPreset;
  uiFontCustom: string;
  chatFontMode: ChatFontSettingMode;
  chatFontPreset: UiFontFamilyPreset;
  chatFontCustom: string;
  codeFontMode: FontSettingMode;
  codeFontPreset: CodeFontFamilyPreset;
  codeFontCustom: string;
  uiFontSize: 12 | 13 | 14 | 15;
  chatFontSize: 13 | 14 | 15 | 16;
  codeFontSize: 12 | 13 | 14;
  sidebarWidth: SidebarWidthMode;
  /** 用户拖拽 sidebar 后的精确像素宽度；非空时优先级高于 sidebarWidth 预设。 */
  sidebarCustomWidth?: number;
  windowMaterial: WindowMaterialMode;
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

export type InstalledPlugin = {
  id: string;
  name: string;
  marketplace: string;
  scope: string;
  version?: string;
  installPath?: string;
  projectPath?: string;
  installedAt?: string;
  lastUpdated?: string;
  description?: string;
  author?: string;
  homepage?: string;
  category?: string;
};

export type Marketplace = {
  name: string;
  source?: string;
  installLocation?: string;
  lastUpdated?: string;
  plugins: Array<{
    name: string;
    description?: string;
    author?: string;
    homepage?: string;
    category?: string;
  }>;
};

export type Skill = {
  name: string;
  description?: string;
  source: 'user' | 'project' | `plugin:${string}`;
  path: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
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
  providerKey: string;
  host: string | null;
  inferred: boolean;
  lastUsedAt: string | null;
  models: UsageProviderModelRow[];
};

export type UsageProviderModelRow = UsageTotals & {
  model: string;
  lastUsedAt: string | null;
};

export type UsageProjectRow = UsageTotals & {
  projectId: string;
  projectName: string;
  projectPath: string;
  lastUsedAt: string | null;
};

export type UsageThreadRow = UsageTotals & {
  threadId: string;
  projectId: string;
  projectName: string;
  title: string;
  sessionId: string;
  provider: string;
  model: string;
  workingDirectory: string;
  updatedAt: string | null;
  lastUsedAt: string | null;
};

export type UsageTrendPoint = UsageTotals & {
  date: string;
};

export type UsageStatsResponse = {
  generatedAt: string;
  totals: UsageTotals;
  byProvider: UsageProviderRow[];
  byProject: UsageProjectRow[];
  byThread: UsageThreadRow[];
  byDay: UsageTrendPoint[];
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
  pinnedAt?: string;
};

export type ThreadRuntimeStatus = {
  threadId: string;
  pid?: number;
  alive: boolean;
  activeRun: boolean;
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
  isGitWorktree: boolean;
  threads: ThreadSummary[];
  pinnedAt?: string;
};

export type GitDiffSummary = {
  additions: number;
  deletions: number;
  filesChanged: number;
};

export type GitBranchSummary = {
  name: string;
  current: boolean;
  kind?: 'local' | 'remote' | 'tag';
  isRemote?: boolean;
  remoteName?: string | null;
  localName?: string | null;
  upstream?: string | null;
};

export type GitHistoryCommit = {
  sha: string;
  shortSha: string;
  summary: string;
  author: string;
  commitTime: number;
  message?: string;
  authorEmail?: string;
  parents?: string[];
  refs?: string[];
  graph?: GitHistoryGraphRow;
};

export type GitHistoryGraphLaneSegment = {
  lane: number;
  fromLane?: number;
  colorIndex: number;
  kind: 'vertical' | 'start' | 'end' | 'merge-left' | 'merge-right' | 'shift-left' | 'shift-right';
};

export type GitHistoryGraphRow = {
  lane: number;
  colorIndex: number;
  segmentsBefore: GitHistoryGraphLaneSegment[];
  segmentsAfter: GitHistoryGraphLaneSegment[];
};

export type GitHistoryLogCommit = {
  sha: string;
  shortSha: string;
  summary: string;
  message: string;
  author: string;
  authorEmail: string;
  commitTime: number;
  parents: string[];
  refs: string[];
  graphText: string;
  graph: GitHistoryGraphRow;
};

export type GitHistoryLogResponse = {
  commits: GitHistoryLogCommit[];
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  availableAuthors: string[];
  activeRefs: string[];
};

export type GitHistoryCommitFile = {
  path: string;
  originalPath?: string;
  status: string;
  additions: number;
  deletions: number;
  binary: boolean;
};

export type GitHistoryCommitDetails = GitHistoryCommit & {
  message: string;
  files: GitHistoryCommitFile[];
  totalAdditions: number;
  totalDeletions: number;
};

export type GitBranchCompareResult = {
  branch: string;
  compareBranch: string;
  targetOnlyCommits: GitHistoryCommit[];
  currentOnlyCommits: GitHistoryCommit[];
};

export type GitWorktreeInfo = {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: string | null;
  prunable: string | null;
  main: boolean;
  current: boolean;
  exists: boolean;
  changedFiles: number | null;
  statusError: string | null;
};

export type GitWorktreeList = {
  isRepo: boolean;
  currentRoot: string | null;
  worktrees: GitWorktreeInfo[];
};

export type GitCreateWorktreeResult = {
  ok: true;
  path: string;
  branch: string;
  projectId: string | null;
  workspace?: WorkspaceBootstrap;
};

export type ProjectGitSummary = Pick<ProjectSummary, 'gitBranch' | 'gitDiff' | 'isGitRepo' | 'isGitWorktree'>;

export type RightWorkbenchTab = 'overview' | 'files' | 'review' | 'browser';

export type WorkbenchFileScope = 'all' | 'changed';

export type WorkbenchFileTab = {
  path: string;
  name: string;
  language?: string;
};

export type WorkbenchPreviewSource = 'project-file' | 'changed-file' | 'conversation-card' | 'conversation-output-file';

export type WorkbenchPreviewKind = 'code' | 'markdown' | 'image';

export type WorkbenchPreviewRequest = {
  key: string;
  path: string;
  name: string;
  kind: WorkbenchPreviewKind;
  source: WorkbenchPreviewSource;
  previewMode?: 'file' | 'git-diff';
  status?: string;
  reviewDiff?: string[];
};

export type WorkbenchPreviewTab = WorkbenchPreviewRequest;

export type WorkbenchPreviewContentState = {
  loading: boolean;
  content: string;
  error?: string;
  mode?: 'code' | 'markdown' | 'git-diff' | 'image';
  previewUrl?: string;
  beforeContent?: string;
  afterContent?: string;
};

export type ProjectFileEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
};

export type GitFileStatus = {
  path: string;
  originalPath?: string;
  status: string;
  indexStatus?: string;
  worktreeStatus?: string;
  conflicted?: boolean;
  conflictKind?: GitConflictKind;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  deleted: boolean;
};

export type GitStatusSnapshot = {
  branch?: string;
  upstream?: string;
  remote?: string;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
};

export type GitPushPreview = {
  branch: string;
  remote: string;
  targetBranch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  commits: string[];
};

export type GitPullMode = 'ff-only' | 'merge' | 'rebase';

export type GitOperationKind = 'none' | 'merge' | 'rebase' | 'cherry-pick' | 'revert';

export type GitOperationStatus = 'clean' | 'dirty' | 'blocked_dirty' | 'diverged' | 'conflicted' | 'in_progress';

export type GitConflictKind =
  | 'both_modified'
  | 'both_added'
  | 'both_deleted'
  | 'deleted_by_us'
  | 'deleted_by_them'
  | 'added_by_us'
  | 'added_by_them'
  | 'unknown';

export type GitConflictFile = {
  path: string;
  originalPath?: string;
  status: string;
  conflictKind: GitConflictKind;
  label: string;
};

export type GitOperationState = {
  status: GitOperationStatus;
  operation: GitOperationKind;
  branch?: string;
  upstream?: string;
  remote?: string;
  ahead: number;
  behind: number;
  hasConflicts: boolean;
  canContinue: boolean;
  canAbort: boolean;
  conflicts: GitConflictFile[];
  files: GitFileStatus[];
  message: string;
};

export type GitConflictFileDetail = GitConflictFile & {
  baseContent: string;
  currentContent: string;
  incomingContent: string;
  resultContent: string;
  isText: boolean;
  binary: boolean;
};

export type GitFileDiffPreview = {
  path: string;
  content: string;
  beforeContent?: string;
  afterContent?: string;
};

export type GitCommitFilePreview = {
  sha: string;
  path: string;
  originalPath?: string;
  status: string;
  additions: number;
  deletions: number;
  binary: boolean;
  content: string;
  beforeContent: string;
  afterContent: string;
};

export type GitCommitResult = {
  output: string;
  summary: ProjectGitSummary;
};

export type GitPushResult = {
  output: string;
  summary: ProjectGitSummary;
};

export type GitRemoteSyncResult = {
  output: string;
  summary: ProjectGitSummary;
  commitsPulled?: number;
  filesChanged?: number;
};

export type UndoConversationChangeOperation = {
  kind: 'replace-snippet' | 'delete-file' | 'restore-file';
  beforeText: string;
  afterText: string;
};

export type UndoConversationChange = {
  path: string;
  operations: UndoConversationChangeOperation[];
};

export type UndoConversationChangeResult = {
  restored: string[];
  deleted: string[];
  summary: ProjectGitSummary;
};

export type GitBranchCreateResult = {
  output: string;
  summary: ProjectGitSummary;
  branch: string;
};

export type GitTagCreateResult = {
  output: string;
  summary: ProjectGitSummary;
  tag: string;
};

export type GitRefCheckoutResult = {
  output: string;
  summary: ProjectGitSummary;
};

export type GitBranchDeleteResult = {
  output: string;
  summary: ProjectGitSummary;
  branch: string;
};

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
  claudeContext?: ClaudeContextSnapshot;
};

export type ThreadDetail = ThreadSummary & {
  turns: ConversationTurn[];
  debugEvents: DebugEvent[];
  rawEvents: string[];
  claudeContext?: ClaudeContextSnapshot;
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
  supportsContext1m?: boolean;
  context1mModel?: string;
  contextWindowTokens?: number;
};

export type ClaudeEffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ClaudeEffortSelection = 'default' | ClaudeEffortLevel;

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

export type McpScope = 'global' | 'project';
export type McpManagedScope = McpScope | 'claude-json-global' | 'claude-json-project';

export type McpServerConfig = {
  type?: 'stdio' | 'http' | string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  envPassthrough?: string[];
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  auth?: 'none' | 'bearer' | 'oauth' | string;
  disabled?: boolean;
  [key: string]: unknown;
};

export type McpConfigFile = {
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
};

export type McpManagementResponse = {
  paths: {
    global: string;
    project: string;
    claudeJson: string;
  };
  configs: {
    global: McpConfigFile;
    project: McpConfigFile;
    claudeJsonGlobal: McpConfigFile;
    claudeJsonProject: McpConfigFile;
  };
  hasProject: boolean;
  overview: McpServersResponse;
};

export type SkillSummary = {
  id: string;
  name: string;
  description?: string;
  path: string;
  source: 'user' | 'plugin' | 'project' | 'system' | 'unknown';
};

export type SlashCommandSource =
  | 'builtin'
  | 'project'
  | 'user'
  | 'plugin'
  | 'skill'
  | 'mcp'
  | 'app';

export type SlashCommandAction = 'passthrough' | 'insert-template' | 'local-action';

export type SlashCommandCategory =
  | 'session'
  | 'context'
  | 'system'
  | 'git'
  | 'config'
  | 'workflow'
  | 'tooling'
  | 'custom'
  | 'plugin';

export type SlashCommand = {
  id: string;
  name: string;
  slash: string;
  title: string;
  description?: string;
  source: SlashCommandSource;
  action: SlashCommandAction;
  template?: string;
  argumentHint?: string;
  sourceLabel?: string;
  localActionId?: string;
  category?: SlashCommandCategory;
  agentScope: AgentType[];
  supportsNonInteractive?: boolean;
};

export type SlashCommandsResponse = {
  commands: SlashCommand[];
};

export type SkillScanError = {
  path: string;
  message: string;
};

export type SkillsResponse = {
  skills: SkillSummary[];
  errors: SkillScanError[];
};

export type CloneTaskStatus = 'cloning' | 'attaching' | 'failed';

export type CloneTaskPhase = 'clone' | 'attach';

export type CloneTask = {
  id: string;
  repoUrl: string;
  projectName: string;
  baseDirectory: string;
  folderName: string;
  targetPath: string;
  status: CloneTaskStatus;
  phase: CloneTaskPhase;
  detail: string;
  errorMessage?: string;
  rawLog?: string;
  createdAt: string;
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
  | {
      kind: 'undo-ai-change';
      title: string;
      description: string;
      confirmLabel: string;
      projectId: string;
      turnId: string;
      changes: UndoConversationChange[];
    }
  | null;

export type ToastDetailRow = {
  label: string;
  value: string;
};

export type ToastDetailSection = {
  label: string;
  content: string;
  defaultOpen?: boolean;
};

export type ToastDetail = {
  title: string;
  summary?: string;
  rows: ToastDetailRow[];
  sections: ToastDetailSection[];
};

export type ToastOptions = {
  title?: string;
  detail?: ToastDetail;
  durationMs?: number;
};

export type ToastState = {
  id: string;
  message: string;
  title?: string;
  tone: 'success' | 'error' | 'info';
  durationMs?: number;
  detail?: ToastDetail;
  detailOpen?: boolean;
};
