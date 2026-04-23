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

export type ClaudeEvent =
  | { type: 'status'; runId: string; message: string }
  | { type: 'session'; runId: string; sessionId: string }
  | { type: 'delta'; runId: string; text: string }
  | { type: 'phase'; runId: string; phase: TurnPhase; label: string }
  | ({ type: 'usage'; runId: string } & UsageSnapshot)
  | { type: 'claude-event'; runId: string; label: string; eventType?: string; subtype?: string; status?: string; raw: unknown }
  | { type: 'tool-start'; runId: string; blockIndex: number; toolUseId?: string; name: string; input?: unknown }
  | { type: 'tool-input-delta'; runId: string; blockIndex: number; text: string }
  | { type: 'tool-stop'; runId: string; blockIndex: number }
  | { type: 'tool-result'; runId: string; toolUseId?: string; content: string; isError?: boolean }
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
  inputText?: string;
  resultText?: string;
  isError?: boolean;
};

export type AssistantItem =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'tool'; tool: ToolStep };

export type ConversationTurn = {
  id: string;
  backendRunId?: string;
  userText: string;
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
};

export type DebugEvent = {
  id: string;
  title: string;
  content: string;
  tone?: 'neutral' | 'error';
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
  models: string[];
  error?: string;
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
