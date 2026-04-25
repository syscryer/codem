import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

type OrganizeBy = 'project' | 'timeline' | 'chat-first';
type SortBy = 'created' | 'updated';
type Visibility = 'all' | 'relevant';

type RequestUserInputOption = {
  label: string;
  description?: string;
};

type RequestUserInputQuestion = {
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

type RequestUserInputRequest = {
  requestId?: string;
  title?: string;
  description?: string;
  questions: RequestUserInputQuestion[];
  submittedAnswers?: Record<string, string>;
  submittedAtMs?: number;
};

export type PanelState = {
  organizeBy: OrganizeBy;
  sortBy: SortBy;
  visibility: Visibility;
};

export type ThreadTurn = {
  id: string;
  userText: string;
  assistantText: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'stopped';
  activity?: string;
  metrics?: string;
  sessionId?: string;
  phase?: 'requesting' | 'thinking' | 'computing' | 'tool';
  startedAtMs?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  totalCostUsd?: number;
  items: Array<
    | { id: string; type: 'text'; text: string }
    | {
        id: string;
        type: 'tool';
        tool: {
          id: string;
          name: string;
          title: string;
          status: 'running' | 'done' | 'error';
          toolUseId?: string;
          inputText?: string;
          resultText?: string;
          isError?: boolean;
        };
      }
  >;
  tools: Array<{
    id: string;
    name: string;
    title: string;
    status: 'running' | 'done' | 'error';
    toolUseId?: string;
    inputText?: string;
    resultText?: string;
    isError?: boolean;
  }>;
  pendingUserInputRequests?: RequestUserInputRequest[];
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

type GitInfo = {
  isGitRepo: boolean;
  branch?: string;
  diff: GitDiffSummary;
};

type GitCommandResult = {
  status: number | null;
  stdout: string;
};

export type WorkspaceBootstrap = {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  activeThreadId: string | null;
  panelState: PanelState;
};

type ClaudeSessionMetadata = {
  sessionId: string;
  cwd: string;
  transcriptPath: string;
  updatedAt: string;
  sessionLabel?: string;
  lastPrompt?: string;
  firstUserText?: string;
  model?: string;
  permissionMode?: string;
  gitBranch?: string;
};

type StoredProjectRow = {
  id: string;
  path: string;
  name: string;
  custom_name: number;
  created_at: string;
  updated_at: string;
};

type StoredThreadRow = {
  id: string;
  project_id: string;
  provider: string;
  title: string;
  custom_title: number;
  session_id: string | null;
  transcript_path: string | null;
  working_directory: string;
  model: string | null;
  permission_mode: string | null;
  imported: number;
  created_at: string;
  updated_at: string;
};

type StoredMessageRow = {
  id: string;
  thread_id: string;
  turn_id: string;
  turn_sort: number;
  item_sort: number;
  role: 'user' | 'assistant';
  content: string;
  status: string | null;
  activity: string | null;
  metrics: string | null;
  session_id: string | null;
  phase: ThreadTurn['phase'] | null;
  started_at_ms: number | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  total_cost_usd: number | null;
  created_at: string;
};

type StoredToolCallRow = {
  id: string;
  thread_id: string;
  turn_id: string;
  turn_sort: number;
  item_sort: number;
  tool_sort: number;
  tool_id: string;
  name: string;
  title: string;
  status: 'running' | 'done' | 'error';
  tool_use_id: string | null;
  input_text: string | null;
  result_text: string | null;
  is_error: number;
};

type StoredTurnState = ThreadTurn & {
  turnSort: number;
  itemBuckets: Array<
    | { itemSort: number; type: 'text'; text: string }
    | {
        itemSort: number;
        type: 'tool';
        tool: ThreadTurn['tools'][number];
      }
  >;
};

const DEFAULT_PANEL_STATE: PanelState = {
  organizeBy: 'project',
  sortBy: 'updated',
  visibility: 'all',
};

const EMPTY_GIT_DIFF: GitDiffSummary = {
  additions: 0,
  deletions: 0,
  filesChanged: 0,
};
const GIT_COMMAND_TIMEOUT_MS = 3000;

const APP_DIR = resolveAppDirectory();
const DATABASE_PATH = path.join(APP_DIR, 'codem.sqlite');
const db = new DatabaseSync(DATABASE_PATH);

initializeDatabase();

export function getWorkspaceBootstrap(): WorkspaceBootstrap {
  importClaudeSessions();

  const panelState = readPanelState();
  const projectRows = db
    .prepare(`
      SELECT id, path, name, custom_name, created_at, updated_at
      FROM projects
      ORDER BY updated_at DESC, created_at DESC
    `)
    .all() as StoredProjectRow[];
  const threadRows = db
    .prepare(`
      SELECT id, project_id, provider, title, custom_title, session_id, transcript_path, working_directory, model, permission_mode, imported, created_at, updated_at
      FROM threads
      ORDER BY updated_at DESC, created_at DESC
    `)
    .all() as StoredThreadRow[];
  const visibleThreadRows = filterVisibleThreadRows(threadRows);

  const groupedThreads = new Map<string, ThreadSummary[]>();
  for (const row of visibleThreadRows) {
    const list = groupedThreads.get(row.project_id) ?? [];
    list.push({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      sessionId: row.session_id ?? '',
      workingDirectory: row.working_directory,
      updatedAt: row.updated_at,
      updatedLabel: formatRelativeTime(row.updated_at),
      provider: row.provider,
      imported: row.imported === 1,
      model: row.model ?? undefined,
      permissionMode: row.permission_mode ?? undefined,
    });
    groupedThreads.set(row.project_id, list);
  }

  const projects = projectRows.map((row) => {
    const gitInfo = readGitInfo(row.path);
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      gitBranch: gitInfo.branch,
      gitDiff: gitInfo.diff,
      isGitRepo: gitInfo.isGitRepo,
      threads: groupedThreads.get(row.id) ?? [],
    } satisfies ProjectSummary;
  });

  let activeProjectId = readStateValue('activeProjectId');
  let activeThreadId = readStateValue('activeThreadId');

  if (!activeProjectId || !projects.some((project) => project.id === activeProjectId)) {
    activeProjectId = projects[0]?.id ?? null;
  }

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  if (!activeThreadId || !activeProject?.threads.some((thread) => thread.id === activeThreadId)) {
    activeThreadId = activeProject?.threads[0]?.id ?? null;
  }

  if (activeProjectId) {
    writeStateValue('activeProjectId', activeProjectId);
  }
  if (activeThreadId) {
    writeStateValue('activeThreadId', activeThreadId);
  }

  return {
    projects,
    activeProjectId,
    activeThreadId,
    panelState,
  };
}

export function createProject(projectPath: string) {
  const normalizedPath = path.resolve(projectPath);
  const now = new Date().toISOString();
  const existing = db
    .prepare(`
      SELECT id, path, name, custom_name, created_at, updated_at
      FROM projects
      WHERE path = ?
    `)
    .get(normalizedPath) as StoredProjectRow | undefined;

  if (existing) {
    db.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(now, existing.id);
    writeStateValue('activeProjectId', existing.id);
    return existing.id;
  }

  const id = randomUUID();
  const defaultName = path.basename(normalizedPath) || normalizedPath;
  db.prepare(`
    INSERT INTO projects (id, path, name, custom_name, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?)
  `).run(id, normalizedPath, defaultName, now, now);
  writeStateValue('activeProjectId', id);
  return id;
}

export function renameProject(projectId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('项目名称不能为空');
  }

  db.prepare(`
    UPDATE projects
    SET name = ?, custom_name = 1, updated_at = ?
    WHERE id = ?
  `).run(trimmed, new Date().toISOString(), projectId);
}

export function removeProject(projectId: string) {
  db.prepare(`DELETE FROM threads WHERE project_id = ?`).run(projectId);
  db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);

  if (readStateValue('activeProjectId') === projectId) {
    deleteStateValue('activeProjectId');
  }
  if (readStateValue('activeThreadId')) {
    const remainingThread = db.prepare(`SELECT id FROM threads LIMIT 1`).get() as { id: string } | undefined;
    if (!remainingThread) {
      deleteStateValue('activeThreadId');
    }
  }
}

export function createThread(projectId: string, title?: string) {
  const project = db
    .prepare(`SELECT id, path, name, custom_name, created_at, updated_at FROM projects WHERE id = ?`)
    .get(projectId) as StoredProjectRow | undefined;

  if (!project) {
    throw new Error('项目不存在');
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const threadTitle = title?.trim() || '新建聊天';
  db.prepare(`
    INSERT INTO threads (
      id, project_id, provider, title, custom_title, session_id, transcript_path, working_directory, model, permission_mode, imported, created_at, updated_at
    )
    VALUES (?, ?, 'claude-code', ?, 0, NULL, NULL, ?, NULL, NULL, 0, ?, ?)
  `).run(id, projectId, threadTitle, project.path, now, now);

  db.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(now, projectId);
  writeStateValue('activeProjectId', projectId);
  writeStateValue('activeThreadId', id);

  return id;
}

export function renameThread(threadId: string, title: string) {
  const trimmed = title.trim();
  if (!trimmed) {
    throw new Error('聊天名称不能为空');
  }

  db.prepare(`
    UPDATE threads
    SET title = ?, custom_title = 1, updated_at = ?
    WHERE id = ?
  `).run(trimmed, new Date().toISOString(), threadId);
}

export function removeThread(threadId: string) {
  const row = db
    .prepare(`
      SELECT id, project_id, session_id, transcript_path
      FROM threads
      WHERE id = ?
    `)
    .get(threadId) as { id: string; project_id: string; session_id: string | null; transcript_path: string | null } | undefined;

  if (!row) {
    throw new Error('聊天不存在');
  }

  const now = new Date().toISOString();
  try {
    db.exec('BEGIN');
    if (row.session_id) {
      db.prepare(`
        INSERT INTO ignored_imported_sessions (session_id, transcript_path, deleted_at)
        VALUES (?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          transcript_path = excluded.transcript_path,
          deleted_at = excluded.deleted_at
      `).run(row.session_id, row.transcript_path, now);
    }
    db.prepare(`DELETE FROM tool_calls WHERE thread_id = ?`).run(threadId);
    db.prepare(`DELETE FROM messages WHERE thread_id = ?`).run(threadId);
    db.prepare(`DELETE FROM threads WHERE id = ?`).run(threadId);
    db.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(now, row.project_id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  scheduleClaudeTranscriptDeletion(row.transcript_path);

  if (readStateValue('activeThreadId') === threadId) {
    deleteStateValue('activeThreadId');
  }
}

export function updateThreadMetadata(
  threadId: string,
  payload: {
    sessionId?: string;
    workingDirectory?: string;
    model?: string;
    permissionMode?: string;
    title?: string;
  },
) {
  const row = db
    .prepare(`
      SELECT id, project_id, provider, title, custom_title, session_id, transcript_path, working_directory, model, permission_mode, imported, created_at, updated_at
      FROM threads
      WHERE id = ?
    `)
    .get(threadId) as StoredThreadRow | undefined;

  if (!row) {
    throw new Error('聊天不存在');
  }

  const workingDirectory = payload.workingDirectory?.trim() || row.working_directory;
  const sessionId = payload.sessionId?.trim() || row.session_id || null;
  const transcriptPath = sessionId ? resolveClaudeTranscriptPath(workingDirectory, sessionId) : row.transcript_path;
  const title = payload.title?.trim() || row.title;
  const customTitle = payload.title?.trim() ? 1 : row.custom_title;
  const now = new Date().toISOString();
  const sessionChanged = Boolean(row.session_id && sessionId && row.session_id !== sessionId);

  try {
    db.exec('BEGIN');
    if (sessionChanged && row.session_id) {
      ignoreImportedSession(row.session_id, row.transcript_path, now);
      deleteDuplicateThreadsBySessionId(row.session_id, threadId);
    }

    db.prepare(`
      UPDATE threads
      SET title = ?,
          custom_title = ?,
          session_id = ?,
          transcript_path = ?,
          working_directory = ?,
          model = ?,
          permission_mode = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      title,
      customTitle,
      sessionId,
      transcriptPath,
      workingDirectory,
      payload.model?.trim() || row.model,
      payload.permissionMode?.trim() || row.permission_mode,
      now,
      threadId,
    );

    db.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(now, row.project_id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function setActiveSelection(projectId: string | null, threadId: string | null) {
  if (projectId) {
    writeStateValue('activeProjectId', projectId);
  }
  if (threadId) {
    writeStateValue('activeThreadId', threadId);
  }
}

export function updatePanelState(nextState: Partial<PanelState>) {
  const panelState = {
    ...readPanelState(),
    ...nextState,
  };

  writeStateValue('panel.organizeBy', panelState.organizeBy);
  writeStateValue('panel.sortBy', panelState.sortBy);
  writeStateValue('panel.visibility', panelState.visibility);
}

export function getThreadHistory(threadId: string) {
  const thread = db
    .prepare(`
      SELECT id, project_id, provider, title, custom_title, session_id, transcript_path, working_directory, model, permission_mode, imported, created_at, updated_at
      FROM threads
      WHERE id = ?
    `)
    .get(threadId) as StoredThreadRow | undefined;

  if (!thread) {
    throw new Error('聊天不存在');
  }

  if (thread.session_id) {
    const turns = hasUsableTranscript(thread)
      ? parseClaudeTranscript(thread.transcript_path ?? '', thread.session_id)
      : [];

    if (turns.length > 0) {
      saveThreadHistory(threadId, turns);
    }

    return {
      threadId,
      turns,
    };
  }

  const storedTurns = readStoredThreadHistory(threadId);
  if (storedTurns.length > 0) {
    if (
      thread.transcript_path &&
      existsSync(thread.transcript_path) &&
      shouldRefreshStoredHistory(threadId, thread.transcript_path, storedTurns)
    ) {
      const reparsedTurns = parseClaudeTranscript(thread.transcript_path, thread.session_id ?? undefined);
      if (reparsedTurns.length > 0) {
        saveThreadHistory(threadId, reparsedTurns);
        return {
          threadId,
          turns: reparsedTurns,
        };
      }
    }

    return {
      threadId,
      turns: storedTurns,
    };
  }

  const turns =
    thread.transcript_path && existsSync(thread.transcript_path)
      ? parseClaudeTranscript(thread.transcript_path, thread.session_id ?? undefined)
      : [];

  if (turns.length > 0) {
    saveThreadHistory(threadId, turns);
  }

  return {
    threadId,
    turns,
  };
}

export function saveThreadHistory(threadId: string, turns: ThreadTurn[]) {
  const thread = db
    .prepare(`
      SELECT id, project_id, provider, title, custom_title, session_id, transcript_path, working_directory, model, permission_mode, imported, created_at, updated_at
      FROM threads
      WHERE id = ?
    `)
    .get(threadId) as StoredThreadRow | undefined;

  if (!thread) {
    throw new Error('聊天不存在');
  }

  const now = new Date().toISOString();
  const insertMessage = db.prepare(`
    INSERT INTO messages (
      id, thread_id, turn_id, turn_sort, item_sort, role, content, status, activity, metrics, session_id,
      phase, started_at_ms, duration_ms, input_tokens, output_tokens, cache_creation_input_tokens,
      cache_read_input_tokens, total_cost_usd, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertToolCall = db.prepare(`
    INSERT INTO tool_calls (
      id, thread_id, turn_id, turn_sort, item_sort, tool_sort, tool_id, name, title, status, tool_use_id, input_text, result_text, is_error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  try {
    db.exec('BEGIN');
    db.prepare(`DELETE FROM tool_calls WHERE thread_id = ?`).run(threadId);
    db.prepare(`DELETE FROM messages WHERE thread_id = ?`).run(threadId);

    turns.forEach((turn, turnIndex) => {
      const baseCreatedAt = new Date(Date.now() + turnIndex).toISOString();
      const turnStatus = normalizePersistedTurnStatus(turn);
      insertMessage.run(
        randomUUID(),
        threadId,
        turn.id,
        turnIndex,
        0,
        'user',
        turn.userText ?? '',
        turnStatus,
        turn.activity ?? null,
        turn.metrics ?? null,
        turn.sessionId ?? null,
        turn.phase ?? null,
        turn.startedAtMs ?? null,
        turn.durationMs ?? null,
        turn.inputTokens ?? null,
        turn.outputTokens ?? null,
        turn.cacheCreationInputTokens ?? null,
        turn.cacheReadInputTokens ?? null,
        turn.totalCostUsd ?? null,
        baseCreatedAt,
      );

      let nextToolSort = 0;
      const assistantItems =
        turn.items.length > 0
          ? turn.items.filter((item) => item.type === 'tool' || item.text.trim())
          : turn.assistantText.trim()
            ? [{ id: randomUUID(), type: 'text' as const, text: turn.assistantText || '' }]
            : [];

      assistantItems.forEach((item, itemIndex) => {
        if (item.type === 'text') {
          insertMessage.run(
            randomUUID(),
            threadId,
            turn.id,
            turnIndex,
            itemIndex,
            'assistant',
            item.text,
            turnStatus,
            turn.activity ?? null,
            turn.metrics ?? null,
            turn.sessionId ?? null,
            turn.phase ?? null,
            turn.startedAtMs ?? null,
            turn.durationMs ?? null,
            turn.inputTokens ?? null,
            turn.outputTokens ?? null,
            turn.cacheCreationInputTokens ?? null,
            turn.cacheReadInputTokens ?? null,
            turn.totalCostUsd ?? null,
            baseCreatedAt,
          );
          return;
        }

        insertToolCall.run(
          randomUUID(),
          threadId,
          turn.id,
          turnIndex,
          itemIndex,
          nextToolSort,
          item.tool.id,
          item.tool.name,
          item.tool.title,
          normalizeToolStatus(item.tool.status),
          item.tool.toolUseId ?? null,
          item.tool.inputText ?? null,
          item.tool.resultText ?? null,
          item.tool.isError ? 1 : 0,
        );
        nextToolSort += 1;
      });
    });

    db.prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`).run(now, threadId);
    db.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(now, thread.project_id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function openProjectInExplorer(projectId: string) {
  const projectPath = readProjectPath(projectId);

  spawnSync('explorer.exe', [projectPath], {
    windowsHide: true,
  });
}

export function openProjectInEditor(projectId: string) {
  const projectPath = readProjectPath(projectId);
  const editorCommand = resolveEditorCommand();
  if (!editorCommand) {
    throw new Error('未找到可用编辑器，请安装 Cursor 或 VS Code，或设置 CODEM_EDITOR。');
  }

  const opened = startEditorProcess(editorCommand, projectPath);
  if (!opened) {
    throw new Error(`编辑器启动失败：${editorCommand}`);
  }
}

export function canPreviewWorkspaceFile(filePath: string) {
  const resolvedPath = path.resolve(filePath);
  const projectRows = db
    .prepare(`
      SELECT path
      FROM projects
    `)
    .all() as Array<{ path: string }>;

  return projectRows.some((row) => isPathInsideRoot(resolvedPath, row.path));
}

export async function getProjectGitSummary(projectId: string) {
  const projectPath = readProjectPath(projectId);
  const gitInfo = await readGitInfoAsync(projectPath, true);

  return {
    gitBranch: gitInfo.branch,
    gitDiff: gitInfo.diff,
    isGitRepo: gitInfo.isGitRepo,
  };
}

function initializeDatabase() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      custom_name INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      title TEXT NOT NULL,
      custom_title INTEGER NOT NULL DEFAULT 0,
      session_id TEXT UNIQUE,
      transcript_path TEXT,
      working_directory TEXT NOT NULL,
      model TEXT,
      permission_mode TEXT,
      imported INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ignored_imported_sessions (
      session_id TEXT PRIMARY KEY,
      transcript_path TEXT,
      deleted_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      turn_id TEXT NOT NULL,
      turn_sort INTEGER NOT NULL,
      item_sort INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT,
      activity TEXT,
      metrics TEXT,
      session_id TEXT,
      phase TEXT,
      started_at_ms INTEGER,
      duration_ms INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_creation_input_tokens INTEGER,
      cache_read_input_tokens INTEGER,
      total_cost_usd REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      turn_id TEXT NOT NULL,
      turn_sort INTEGER NOT NULL,
      item_sort INTEGER NOT NULL,
      tool_sort INTEGER NOT NULL,
      tool_id TEXT NOT NULL,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      tool_use_id TEXT,
      input_text TEXT,
      result_text TEXT,
      is_error INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_messages_thread_turn
    ON messages (thread_id, turn_sort, item_sort, role);

    CREATE INDEX IF NOT EXISTS idx_tool_calls_thread_turn
    ON tool_calls (thread_id, turn_sort, item_sort, tool_sort);
  `);

  ensureColumn('tool_calls', 'turn_sort', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('messages', 'phase', 'TEXT');
  ensureColumn('messages', 'started_at_ms', 'INTEGER');
  ensureColumn('messages', 'duration_ms', 'INTEGER');
  ensureColumn('messages', 'input_tokens', 'INTEGER');
  ensureColumn('messages', 'output_tokens', 'INTEGER');
  ensureColumn('messages', 'cache_creation_input_tokens', 'INTEGER');
  ensureColumn('messages', 'cache_read_input_tokens', 'INTEGER');
  ensureColumn('messages', 'total_cost_usd', 'REAL');
}

function resolveAppDirectory() {
  const baseDirectory =
    process.env.LOCALAPPDATA ||
    process.env.APPDATA ||
    path.join(homedir(), 'AppData', 'Local');
  const directory = path.join(baseDirectory, 'CodeM');
  mkdirSync(directory, { recursive: true });
  return directory;
}

function ensureColumn(tableName: string, columnName: string, definition: string) {
  const tableIdentifier = quoteSqlIdentifier(tableName);
  const columnIdentifier = quoteSqlIdentifier(columnName);
  const rows = db.prepare(`PRAGMA table_info(${tableIdentifier})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableIdentifier} ADD COLUMN ${columnIdentifier} ${definition}`);
}

function quoteSqlIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`非法数据库标识符：${identifier}`);
  }

  return `"${identifier}"`;
}

function importClaudeSessions() {
  const root = path.join(homedir(), '.claude', 'projects');
  if (!existsSync(root)) {
    return;
  }

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directory = path.join(root, entry.name);
    for (const fileEntry of readdirSync(directory, { withFileTypes: true })) {
      if (!fileEntry.isFile() || !fileEntry.name.endsWith('.jsonl')) {
        continue;
      }
      if (fileEntry.name.startsWith('agent-')) {
        continue;
      }

      const transcriptPath = path.join(directory, fileEntry.name);
      const metadata = readClaudeSessionMetadata(transcriptPath);
      if (!metadata?.cwd || !existsSync(metadata.cwd)) {
        continue;
      }
      if (isIgnoredImportedSession(metadata.sessionId)) {
        continue;
      }

      const projectId = upsertImportedProject(metadata.cwd, metadata.updatedAt);
      upsertImportedThread(projectId, metadata);
    }
  }
}

function isIgnoredImportedSession(sessionId: string) {
  const row = db
    .prepare(`SELECT session_id FROM ignored_imported_sessions WHERE session_id = ?`)
    .get(sessionId) as { session_id: string } | undefined;

  return Boolean(row);
}

function ignoreImportedSession(sessionId: string, transcriptPath: string | null, deletedAt: string) {
  db.prepare(`
    INSERT INTO ignored_imported_sessions (session_id, transcript_path, deleted_at)
    VALUES (?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      transcript_path = excluded.transcript_path,
      deleted_at = excluded.deleted_at
  `).run(sessionId, transcriptPath, deletedAt);
}

function deleteDuplicateThreadsBySessionId(sessionId: string, excludeThreadId: string) {
  const rows = db
    .prepare(`
      SELECT id
      FROM threads
      WHERE session_id = ? AND id <> ?
    `)
    .all(sessionId, excludeThreadId) as Array<{ id: string }>;

  for (const row of rows) {
    db.prepare(`DELETE FROM tool_calls WHERE thread_id = ?`).run(row.id);
    db.prepare(`DELETE FROM messages WHERE thread_id = ?`).run(row.id);
    db.prepare(`DELETE FROM threads WHERE id = ?`).run(row.id);
  }
}

function filterVisibleThreadRows(threadRows: StoredThreadRow[]) {
  return threadRows.filter(hasVisibleThreadSource);
}

function hasUsableTranscript(row: StoredThreadRow) {
  if (!row.session_id || !row.transcript_path) {
    return false;
  }

  return existsSync(row.transcript_path);
}

function hasVisibleThreadSource(row: StoredThreadRow) {
  if (!row.session_id) {
    return row.imported !== 1;
  }

  return hasUsableTranscript(row);
}

function isPathInsideRoot(targetPath: string, rootPath: string) {
  const normalizedTarget = path.resolve(targetPath).toLowerCase();
  const normalizedRoot = path.resolve(rootPath).toLowerCase();

  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

function scheduleClaudeTranscriptDeletion(transcriptPath: string | null) {
  if (!transcriptPath) {
    return;
  }

  setImmediate(() => {
    try {
      deleteClaudeTranscriptFile(transcriptPath);
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Claude Code session 文件删除失败');
    }
  });
}

function deleteClaudeTranscriptFile(transcriptPath: string) {
  if (!transcriptPath) {
    return;
  }

  const resolvedPath = path.resolve(transcriptPath);
  const claudeProjectsRoot = path.resolve(homedir(), '.claude', 'projects');
  const normalizedPath = resolvedPath.toLowerCase();
  const normalizedRoot = claudeProjectsRoot.toLowerCase();
  if (!normalizedPath.startsWith(`${normalizedRoot}${path.sep}`) || path.extname(resolvedPath) !== '.jsonl') {
    throw new Error('拒绝删除非 Claude Code session 文件');
  }

  try {
    if (existsSync(resolvedPath)) {
      unlinkSync(resolvedPath);
    }
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return;
    }

    throw error;
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function upsertImportedProject(projectPath: string, updatedAt: string) {
  const normalizedPath = path.resolve(projectPath);
  const existing = db
    .prepare(`
      SELECT id, path, name, custom_name, created_at, updated_at
      FROM projects
      WHERE path = ?
    `)
    .get(normalizedPath) as StoredProjectRow | undefined;

  if (existing) {
    if (updatedAt > existing.updated_at) {
      db.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(updatedAt, existing.id);
    }
    return existing.id;
  }

  const id = randomUUID();
  const defaultName = path.basename(normalizedPath) || normalizedPath;
  db.prepare(`
    INSERT INTO projects (id, path, name, custom_name, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?)
  `).run(id, normalizedPath, defaultName, updatedAt, updatedAt);
  return id;
}

function upsertImportedThread(projectId: string, metadata: ClaudeSessionMetadata) {
  const existing = db
    .prepare(`
      SELECT id, project_id, provider, title, custom_title, session_id, transcript_path, working_directory, model, permission_mode, imported, created_at, updated_at
      FROM threads
      WHERE session_id = ?
    `)
    .get(metadata.sessionId) as StoredThreadRow | undefined;

  const importedTitle = deriveImportedThreadTitle(metadata);

  if (existing) {
    db.prepare(`
      UPDATE threads
      SET transcript_path = ?,
          working_directory = ?,
          model = COALESCE(?, model),
          permission_mode = COALESCE(permission_mode, ?),
          updated_at = ?,
          title = CASE WHEN custom_title = 0 THEN ? ELSE title END
      WHERE id = ?
    `).run(
      metadata.transcriptPath,
      metadata.cwd,
      metadata.model ?? null,
      metadata.permissionMode ?? null,
      metadata.updatedAt,
      importedTitle,
      existing.id,
    );
    return existing.id;
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO threads (
      id, project_id, provider, title, custom_title, session_id, transcript_path, working_directory, model, permission_mode, imported, created_at, updated_at
    )
    VALUES (?, ?, 'claude-code', ?, 0, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    projectId,
    importedTitle,
    metadata.sessionId,
    metadata.transcriptPath,
    metadata.cwd,
    metadata.model ?? null,
    metadata.permissionMode ?? null,
    metadata.updatedAt,
    metadata.updatedAt,
  );
  return id;
}

function readClaudeSessionMetadata(transcriptPath: string): ClaudeSessionMetadata | null {
  const content = readFileSync(transcriptPath, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean);

  let sessionId = '';
  let cwd = '';
  let lastPrompt = '';
  let firstUserText = '';
  let updatedAt = '';
  let sessionLabel = '';
  let model = '';
  let permissionMode = '';
  let gitBranch = '';

  for (const line of lines) {
    try {
      const payload = JSON.parse(line) as Record<string, unknown>;
      if (payload.isSidechain || payload.isMeta) {
        continue;
      }

      if (!sessionId) {
        const candidate = readString(payload, ['sessionId', 'session_id']);
        if (candidate) {
          sessionId = candidate;
        }
      }

      const timestamp = readString(payload, ['timestamp']);
      if (timestamp && timestamp > updatedAt) {
        updatedAt = timestamp;
      }

      if (!sessionLabel) {
        const candidate = readString(payload, ['sessionName', 'displayName', 'title']);
        if (candidate) {
          sessionLabel = candidate;
        } else {
          const slug = readString(payload, ['slug']);
          if (slug) {
            sessionLabel = slug.replace(/-/g, ' ');
          }
        }
      }

      if (!cwd) {
        const workingDirectory = readString(payload, ['cwd']);
        if (workingDirectory) {
          cwd = workingDirectory;
        }
      }

      if (!lastPrompt && payload.type === 'last-prompt') {
        const prompt = readString(payload, ['lastPrompt']);
        const normalizedPrompt = normalizeImportedTitleText(prompt);
        if (normalizedPrompt) {
          lastPrompt = normalizedPrompt;
        }
      }

      const message = payload.message;
      if (!firstUserText && message && typeof message === 'object') {
        const role = readString(message as Record<string, unknown>, ['role']);
        const contentValue = (message as Record<string, unknown>).content;
        if (role === 'user') {
          const userText = normalizeImportedTitleText(extractUserText(contentValue));
          if (userText) {
            firstUserText = userText;
          }
        }

        const assistantModel = readString(message as Record<string, unknown>, ['model']);
        if (assistantModel) {
          model = assistantModel;
        }
      }

      if (!permissionMode) {
        const nextPermission = readString(payload, ['permissionMode']);
        if (nextPermission) {
          permissionMode = nextPermission;
        }
      }

      if (!gitBranch) {
        const nextBranch = readString(payload, ['gitBranch']);
        if (nextBranch) {
          gitBranch = nextBranch;
        }
      }
    } catch {
      continue;
    }
  }

  if (!sessionId || !cwd) {
    return null;
  }

  return {
    sessionId,
    cwd,
    transcriptPath,
    updatedAt: updatedAt || new Date().toISOString(),
    sessionLabel: sessionLabel || undefined,
    lastPrompt: lastPrompt || undefined,
    firstUserText: firstUserText || undefined,
    model: model || undefined,
    permissionMode: permissionMode || undefined,
    gitBranch: gitBranch || undefined,
  };
}

function deriveImportedThreadTitle(metadata: ClaudeSessionMetadata) {
  const title = metadata.sessionLabel || metadata.lastPrompt || metadata.firstUserText || metadata.sessionId;
  const trimmed = title.trim();
  if (!trimmed) {
    return metadata.sessionId;
  }

  return trimmed.length > 28 ? `${trimmed.slice(0, 28)}...` : trimmed;
}

function parseClaudeTranscript(transcriptPath: string, sessionId?: string): ThreadTurn[] {
  const lines = readFileSync(transcriptPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const turns: ThreadTurn[] = [];
  let currentTurn: ThreadTurn | null = null;
  const toolLookup = new Map<string, ThreadTurn['tools'][number]>();

  for (const line of lines) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (payload.isSidechain || payload.isMeta) {
      continue;
    }

    const message = payload.message;
    if (payload.type === 'user' && message && typeof message === 'object') {
      const role = readString(message as Record<string, unknown>, ['role']);
      const contentValue = (message as Record<string, unknown>).content;

      if (role === 'user' && !containsToolResult(contentValue)) {
        const userText = extractUserText(contentValue) || '';
        currentTurn = {
          id: randomUUID(),
          userText,
          assistantText: '',
          status: 'stopped',
          activity: '运行结束但没有返回正文',
          sessionId,
          items: [],
          tools: [],
        };
        turns.push(currentTurn);
        continue;
      }

      if (role === 'user' && currentTurn) {
        attachToolResults(currentTurn, contentValue);
      }
    }

    if (payload.type === 'assistant' && message && typeof message === 'object') {
      const role = readString(message as Record<string, unknown>, ['role']);
      if (role !== 'assistant') {
        continue;
      }

      if (!currentTurn) {
        currentTurn = {
          id: randomUUID(),
          userText: '',
          assistantText: '',
          status: 'done',
          sessionId,
          items: [],
          tools: [],
        };
        turns.push(currentTurn);
      }

      applyTranscriptMetrics(currentTurn, payload, message as Record<string, unknown>);
      const contentBlocks = extractContentBlocks((message as Record<string, unknown>).content);
      for (const block of contentBlocks) {
        if (block.type === 'text' && block.text) {
          currentTurn.status = 'done';
          currentTurn.activity = undefined;
          currentTurn.assistantText += block.text;
          pushTextItem(currentTurn, block.text);
          continue;
        }

        if (block.type === 'tool_use' && block.name) {
          currentTurn.status = 'done';
          currentTurn.activity = undefined;
          const tool = {
            id: block.id || randomUUID(),
            name: block.name,
            title: describeToolCall(block.name, formatJson(block.input)),
            status: 'done' as const,
            toolUseId: block.id,
            inputText: formatJson(block.input),
          };
          currentTurn.tools.push(tool);
          currentTurn.items.push({
            id: tool.id,
            type: 'tool',
            tool,
          });
          if (tool.toolUseId) {
            toolLookup.set(tool.toolUseId, tool);
          }
          const requestUserInput = parseRequestUserInputEvent(block.name, block.input, block.id);
          if (requestUserInput) {
            upsertRequestUserInput(currentTurn, requestUserInput);
          }
        }
      }
    }

    if (payload.type === 'result' && currentTurn) {
      applyTranscriptMetrics(currentTurn, payload);
    }
  }

  return turns.filter((turn) => turn.userText.trim() || turn.assistantText.trim() || turn.tools.length > 0);

  function attachToolResults(turn: ThreadTurn, contentValue: unknown) {
    if (!Array.isArray(contentValue)) {
      return;
    }

    for (const item of contentValue) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const block = item as Record<string, unknown>;
      if (block.type !== 'tool_result') {
        continue;
      }

      const toolUseId = readString(block, ['tool_use_id']);
      if (!toolUseId) {
        continue;
      }

      const resultText = stringifyClaudeContent(block.content);
      const isError = Boolean(block.is_error);
      const tool = toolLookup.get(toolUseId) ?? turn.tools.find((entry) => entry.toolUseId === toolUseId);
      if (!tool) {
        continue;
      }

      tool.resultText = resultText;
      tool.isError = isError;
      tool.status = isError ? 'error' : 'done';
      markRequestUserInputSubmitted(turn, toolUseId, resultText);
    }
  }
}

function applyTranscriptMetrics(
  turn: ThreadTurn,
  payload: Record<string, unknown>,
  message?: Record<string, unknown>,
) {
  const usage = asRecord(payload.usage) ?? asRecord(message?.usage);
  if (usage) {
    turn.inputTokens = readNumber(usage, ['input_tokens']) ?? turn.inputTokens;
    turn.outputTokens = readNumber(usage, ['output_tokens']) ?? turn.outputTokens;
    turn.cacheCreationInputTokens = readNumber(usage, ['cache_creation_input_tokens']) ?? turn.cacheCreationInputTokens;
    turn.cacheReadInputTokens = readNumber(usage, ['cache_read_input_tokens']) ?? turn.cacheReadInputTokens;
  }

  turn.durationMs = readNumber(payload, ['duration_ms']) ?? turn.durationMs;
  turn.totalCostUsd = readNumber(payload, ['total_cost_usd']) ?? turn.totalCostUsd;
}

function readStoredThreadHistory(threadId: string): ThreadTurn[] {
  const messageRows = db
    .prepare(`
      SELECT id, thread_id, turn_id, turn_sort, item_sort, role, content, status, activity, metrics, session_id, created_at
      , phase, started_at_ms, duration_ms, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, total_cost_usd
      FROM messages
      WHERE thread_id = ?
      ORDER BY turn_sort ASC, item_sort ASC, CASE role WHEN 'user' THEN 0 ELSE 1 END ASC
    `)
    .all(threadId) as StoredMessageRow[];
  const toolRows = db
    .prepare(`
      SELECT id, thread_id, turn_id, turn_sort, item_sort, tool_sort, tool_id, name, title, status, tool_use_id, input_text, result_text, is_error
      FROM tool_calls
      WHERE thread_id = ?
      ORDER BY turn_sort ASC, item_sort ASC, tool_sort ASC
    `)
    .all(threadId) as StoredToolCallRow[];

  if (messageRows.length === 0 && toolRows.length === 0) {
    return [];
  }

  const turnMap = new Map<string, StoredTurnState>();

  for (const row of messageRows) {
    let turn: StoredTurnState | undefined = turnMap.get(row.turn_id);
    if (!turn) {
      turn = {
        id: row.turn_id,
        userText: '',
        assistantText: '',
        status: (row.status as ThreadTurn['status'] | null) ?? 'done',
        activity: row.activity ?? undefined,
        metrics: row.metrics ?? undefined,
        sessionId: row.session_id ?? undefined,
        phase: row.phase ?? undefined,
        startedAtMs: row.started_at_ms ?? undefined,
        durationMs: row.duration_ms ?? undefined,
        inputTokens: row.input_tokens ?? undefined,
        outputTokens: row.output_tokens ?? undefined,
        cacheCreationInputTokens: row.cache_creation_input_tokens ?? undefined,
        cacheReadInputTokens: row.cache_read_input_tokens ?? undefined,
        totalCostUsd: row.total_cost_usd ?? undefined,
        items: [],
        tools: [],
        turnSort: row.turn_sort,
        itemBuckets: [],
      } as StoredTurnState;
    }

    turn.turnSort = Math.min(turn.turnSort, row.turn_sort);
    const nextStatus = normalizeTurnStatus(row.status);
    if (nextStatus) {
      (turn as StoredTurnState).status = nextStatus;
    }
    turn.activity = row.activity ?? turn.activity;
    turn.metrics = row.metrics ?? turn.metrics;
    turn.sessionId = row.session_id ?? turn.sessionId;
    turn.phase = row.phase ?? turn.phase;
    turn.startedAtMs = row.started_at_ms ?? turn.startedAtMs;
    turn.durationMs = row.duration_ms ?? turn.durationMs;
    turn.inputTokens = row.input_tokens ?? turn.inputTokens;
    turn.outputTokens = row.output_tokens ?? turn.outputTokens;
    turn.cacheCreationInputTokens = row.cache_creation_input_tokens ?? turn.cacheCreationInputTokens;
    turn.cacheReadInputTokens = row.cache_read_input_tokens ?? turn.cacheReadInputTokens;
    turn.totalCostUsd = row.total_cost_usd ?? turn.totalCostUsd;

    if (row.role === 'user') {
      turn.userText = row.content;
    } else if (row.content.trim()) {
      turn.assistantText += row.content;
      turn.itemBuckets.push({
        itemSort: row.item_sort,
        type: 'text',
        text: row.content,
      });
    }

    turnMap.set(row.turn_id, turn);
  }

  for (const row of toolRows) {
    let turn: StoredTurnState | undefined = turnMap.get(row.turn_id);
    if (!turn) {
      turn = {
        id: row.turn_id,
        userText: '',
        assistantText: '',
        status: 'done',
        items: [],
        tools: [],
        turnSort: row.turn_sort,
        itemBuckets: [],
      } as StoredTurnState;
    }

    turn.turnSort = Math.min(turn.turnSort, row.turn_sort);
    const tool = {
      id: row.tool_id,
      name: row.name,
      title: row.title,
      status: normalizeToolStatus(row.status),
      toolUseId: row.tool_use_id ?? undefined,
      inputText: row.input_text ?? undefined,
      resultText: row.result_text ?? undefined,
      isError: row.is_error === 1,
    };

    turn.tools.push(tool);
    turn.itemBuckets.push({
      itemSort: row.item_sort,
      type: 'tool',
      tool,
    });
    const requestUserInput = parseRequestUserInputEvent(tool.name, parseJsonObject(tool.inputText), tool.toolUseId);
    if (requestUserInput) {
      upsertRequestUserInput(turn, requestUserInput);
      if (tool.resultText) {
        markRequestUserInputSubmitted(turn, requestUserInput.requestId ?? tool.toolUseId, tool.resultText);
      }
    }

    turnMap.set(row.turn_id, turn);
  }

  return [...turnMap.values()]
    .sort((left, right) => left.turnSort - right.turnSort)
    .map(({ itemBuckets, turnSort: _turnSort, ...turn }) => ({
      ...normalizePersistedTurn(turn),
      items: itemBuckets
        .sort((left, right) => left.itemSort - right.itemSort)
        .map((entry) =>
          entry.type === 'text'
            ? { id: randomUUID(), type: 'text' as const, text: entry.text }
            : { id: entry.tool.id, type: 'tool' as const, tool: entry.tool },
        ),
    }));
}

function shouldReparseStoredHistory(turns: ThreadTurn[]) {
  return turns.some((turn) =>
    turn.tools.some(
      (tool) =>
        tool.name === 'tool_result' ||
        ((tool.name === 'Agent' || tool.name === 'Task') &&
          tool.inputText?.trim() &&
          tool.title !== describeToolCall(tool.name, tool.inputText)),
    ),
  );
}

function shouldRefreshStoredHistory(threadId: string, transcriptPath: string, turns: ThreadTurn[]) {
  return shouldReparseStoredHistory(turns) || isStoredHistoryOutdated(threadId, transcriptPath);
}

function isStoredHistoryOutdated(threadId: string, transcriptPath: string) {
  const latestStoredRow = db
    .prepare(`
      SELECT MAX(created_at) AS latest_created_at
      FROM messages
      WHERE thread_id = ?
    `)
    .get(threadId) as { latest_created_at: string | null } | undefined;

  if (!latestStoredRow?.latest_created_at) {
    return true;
  }

  try {
    const transcriptUpdatedAt = statSync(transcriptPath).mtime.toISOString();
    return transcriptUpdatedAt > latestStoredRow.latest_created_at;
  } catch {
    return false;
  }
}

function readPanelState(): PanelState {
  return {
    organizeBy: (readStateValue('panel.organizeBy') as OrganizeBy | null) ?? DEFAULT_PANEL_STATE.organizeBy,
    sortBy: (readStateValue('panel.sortBy') as SortBy | null) ?? DEFAULT_PANEL_STATE.sortBy,
    visibility: (readStateValue('panel.visibility') as Visibility | null) ?? DEFAULT_PANEL_STATE.visibility,
  };
}

function readStateValue(key: string) {
  const row = db.prepare(`SELECT value FROM app_state WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function writeStateValue(key: string, value: string) {
  db.prepare(`
    INSERT INTO app_state (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function deleteStateValue(key: string) {
  db.prepare(`DELETE FROM app_state WHERE key = ?`).run(key);
}

function readProjectPath(projectId: string) {
  const project = db
    .prepare(`SELECT path FROM projects WHERE id = ?`)
    .get(projectId) as { path: string } | undefined;

  if (!project) {
    throw new Error('项目不存在');
  }

  return project.path;
}

function readGitInfo(projectPath: string, includeDiff = false): GitInfo {
  if (!existsSync(projectPath)) {
    return {
      isGitRepo: false,
      branch: undefined,
      diff: EMPTY_GIT_DIFF,
    };
  }

  const workTreeCheck = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: projectPath,
    encoding: 'utf8',
    timeout: GIT_COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });

  if (workTreeCheck.status !== 0 || workTreeCheck.stdout.trim() !== 'true') {
    return {
      isGitRepo: false,
      branch: undefined,
      diff: EMPTY_GIT_DIFF,
    };
  }

  const branchResult = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: projectPath,
    encoding: 'utf8',
    timeout: GIT_COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  const branch = branchResult.status === 0 ? branchResult.stdout.trim() || 'HEAD' : 'HEAD';

  return {
    isGitRepo: true,
    branch,
    diff: includeDiff ? readGitDiff(projectPath) : EMPTY_GIT_DIFF,
  };
}

function readGitDiff(projectPath: string): GitDiffSummary {
  let additions = 0;
  let deletions = 0;
  let filesChanged = 0;

  const diffResult = spawnSync('git', ['diff', '--numstat', 'HEAD', '--'], {
    cwd: projectPath,
    encoding: 'utf8',
    timeout: GIT_COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  const diffOutput =
    diffResult.status === 0
      ? diffResult.stdout
      : spawnSync('git', ['diff', '--numstat', '--'], {
          cwd: projectPath,
          encoding: 'utf8',
          timeout: GIT_COMMAND_TIMEOUT_MS,
          windowsHide: true,
        }).stdout;

  for (const line of diffOutput.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const [added, deleted] = line.split('\t');
    filesChanged += 1;
    additions += parseGitNumstatValue(added);
    deletions += parseGitNumstatValue(deleted);
  }

  const untrackedFiles = readUntrackedFiles(projectPath);
  filesChanged += untrackedFiles.length;

  return {
    additions,
    deletions,
    filesChanged,
  };
}

function parseGitNumstatValue(value: string | undefined) {
  if (!value || value === '-') {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readUntrackedFiles(projectPath: string) {
  const result = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: projectPath,
    encoding: 'utf8',
    timeout: GIT_COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });

  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  return result.stdout.split('\0').filter(Boolean);
}

async function readGitInfoAsync(projectPath: string, includeDiff = false): Promise<GitInfo> {
  if (!existsSync(projectPath)) {
    return {
      isGitRepo: false,
      branch: undefined,
      diff: EMPTY_GIT_DIFF,
    };
  }

  const workTreeCheck = await runGitCommand(projectPath, ['rev-parse', '--is-inside-work-tree']);

  if (workTreeCheck.status !== 0 || workTreeCheck.stdout.trim() !== 'true') {
    return {
      isGitRepo: false,
      branch: undefined,
      diff: EMPTY_GIT_DIFF,
    };
  }

  const branchResult = await runGitCommand(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchResult.status === 0 ? branchResult.stdout.trim() || 'HEAD' : 'HEAD';

  return {
    isGitRepo: true,
    branch,
    diff: includeDiff ? await readGitDiffAsync(projectPath) : EMPTY_GIT_DIFF,
  };
}

async function readGitDiffAsync(projectPath: string): Promise<GitDiffSummary> {
  let additions = 0;
  let deletions = 0;
  let filesChanged = 0;

  const diffResult = await runGitCommand(projectPath, ['diff', '--numstat', 'HEAD', '--']);
  const diffOutput =
    diffResult.status === 0
      ? diffResult.stdout
      : (await runGitCommand(projectPath, ['diff', '--numstat', '--'])).stdout;

  for (const line of diffOutput.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const [added, deleted] = line.split('\t');
    filesChanged += 1;
    additions += parseGitNumstatValue(added);
    deletions += parseGitNumstatValue(deleted);
  }

  const untrackedFiles = await readUntrackedFilesAsync(projectPath);
  filesChanged += untrackedFiles.length;

  return {
    additions,
    deletions,
    filesChanged,
  };
}

async function readUntrackedFilesAsync(projectPath: string) {
  const result = await runGitCommand(projectPath, ['ls-files', '--others', '--exclude-standard', '-z']);

  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  return result.stdout.split('\0').filter(Boolean);
}

function runGitCommand(projectPath: string, args: string[]): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd: projectPath,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    let settled = false;
    const settle = (result: GitCommandResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      settle({ status: null, stdout });
    }, GIT_COMMAND_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.once('error', () => settle({ status: null, stdout: '' }));
    child.once('close', (code) => settle({ status: code, stdout }));
  });
}

function resolveEditorCommand() {
  const configuredCommand = [process.env.CODEM_EDITOR, process.env.VISUAL, process.env.EDITOR].find(
    (value) => value?.trim(),
  );
  const candidates = [configuredCommand, 'cursor', 'code'].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const command = resolveCommandPath(candidate);
    if (command) {
      return command;
    }
  }

  return '';
}

function resolveCommandPath(command: string) {
  if (existsSync(command)) {
    return command;
  }

  const result = spawnSync('where.exe', [command], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout) {
    return '';
  }

  const paths = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return paths.find((item) => /\.(cmd|exe|bat)$/i.test(item)) ?? paths[0] ?? '';
}

function startEditorProcess(command: string, projectPath: string) {
  const script = `
$ErrorActionPreference = 'Stop'
Start-Process -FilePath '${escapePowerShellString(command)}' -ArgumentList @('${escapePowerShellString(projectPath)}')
`.trim();
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: true,
    },
  );

  return result.status === 0;
}

function escapePowerShellString(value: string) {
  return value.replace(/'/g, "''");
}

function readString(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

function readNumber(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeTurnStatus(value: string | null) {
  if (value === 'pending' || value === 'running' || value === 'done' || value === 'error' || value === 'stopped') {
    return value;
  }
  return null;
}

function normalizeToolStatus(value: string | null): ThreadTurn['tools'][number]['status'] {
  if (value === 'running' || value === 'done' || value === 'error') {
    return value;
  }
  return 'done';
}

function normalizePersistedTurn<T extends Pick<ThreadTurn, 'status' | 'activity' | 'metrics' | 'assistantText' | 'durationMs' | 'outputTokens' | 'totalCostUsd'>>(turn: T): T {
  return {
    ...turn,
    status: normalizePersistedTurnStatus(turn),
  };
}

function normalizePersistedTurnStatus(turn: Pick<ThreadTurn, 'status' | 'activity' | 'metrics' | 'assistantText' | 'durationMs' | 'outputTokens' | 'totalCostUsd'>): ThreadTurn['status'] {
  if (turn.status !== 'pending' && turn.status !== 'running') {
    return turn.status;
  }

  if (
    turn.durationMs ||
    turn.totalCostUsd ||
    ((turn.outputTokens || turn.metrics) && turn.assistantText.trim()) ||
    turn.activity === '运行完成'
  ) {
    return 'done';
  }

  return 'stopped';
}

function extractUserText(content: unknown) {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      const block = item as Record<string, unknown>;
      if (block.type === 'text' && typeof block.text === 'string') {
        return block.text;
      }

      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function normalizeImportedTitleText(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) {
        return false;
      }
      if (line.startsWith('<local-command-')) {
        return false;
      }
      if (line.startsWith('<command-name>') || line.startsWith('<command-message>') || line.startsWith('<command-args>')) {
        return false;
      }
      if (line.startsWith('<system-reminder>') || line.startsWith('</system-reminder>')) {
        return false;
      }
      return true;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsToolResult(content: unknown) {
  return Array.isArray(content) && content.some((item) => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'tool_result');
}

function extractContentBlocks(content: unknown) {
  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as Record<string, unknown>)
    .filter((item) => {
      const type = typeof item.type === 'string' ? item.type : '';
      return type !== 'thinking' && type !== 'redacted_thinking';
    })
    .filter((item) => {
      if (item.type !== 'text' || typeof item.text !== 'string') {
        return true;
      }

      return item.text.trim() !== 'No response requested.';
    })
    .map((item) => ({
      type: typeof item.type === 'string' ? item.type : undefined,
      text: typeof item.text === 'string' ? item.text : undefined,
      id: typeof item.id === 'string' ? item.id : undefined,
      name: typeof item.name === 'string' ? item.name : undefined,
      input: item.input,
    }));
}

function pushTextItem(turn: ThreadTurn, text: string) {
  const last = turn.items.at(-1);
  if (last?.type === 'text') {
    last.text += text;
    return;
  }

  turn.items.push({
    id: randomUUID(),
    type: 'text',
    text,
  });
}

function parseRequestUserInputEvent(
  toolName: string,
  input: unknown,
  toolUseId?: string,
): RequestUserInputRequest | null {
  const normalizedToolName = normalizeToolName(toolName);
  const payload = asRecord(input) ?? {};
  const rawQuestions = Array.isArray(payload.questions) ? payload.questions : [];
  const matchesStructuredQuestions = rawQuestions.some((question) => hasRequestUserInputShape(question));
  if (
    normalizedToolName !== 'requestuserinput' &&
    normalizedToolName !== 'askuserquestion' &&
    !matchesStructuredQuestions
  ) {
    return null;
  }

  const questions = rawQuestions
    .map((question, index) => parseRequestUserInputQuestion(question, index))
    .filter((question): question is RequestUserInputQuestion => Boolean(question));
  if (questions.length === 0) {
    return null;
  }

  return {
    requestId:
      firstNonEmptyString(payload, ['requestId', 'request_id', 'toolUseId', 'tool_use_id']) ??
      toolUseId,
    title: firstNonEmptyString(payload, ['title', 'message', 'prompt']) ?? '需要你的选择',
    description: firstNonEmptyString(payload, ['description', 'instructions']),
    questions,
  };
}

function parseRequestUserInputQuestion(
  value: unknown,
  index: number,
): RequestUserInputQuestion | null {
  const question = asRecord(value);
  if (!question) {
    return null;
  }

  const text = firstNonEmptyString(question, ['question', 'prompt', 'label']);
  if (!text) {
    return null;
  }

  const rawOptions = Array.isArray(question.options) ? question.options : [];
  const options = rawOptions
    .map((option) => parseRequestUserInputOption(option))
    .filter((option): option is RequestUserInputOption => Boolean(option));

  return {
    id: firstNonEmptyString(question, ['id']) ?? `question-${index}`,
    header: firstNonEmptyString(question, ['header']),
    question: text,
    options: options.length > 0 ? options : undefined,
    multiSelect: Boolean(question.multiSelect ?? question.multi_select),
    required: Boolean(question.required),
    secret: Boolean(question.secret),
    isOther: Boolean(question.isOther ?? question.is_other),
    placeholder: firstNonEmptyString(question, ['placeholder']),
  };
}

function parseRequestUserInputOption(value: unknown): RequestUserInputOption | null {
  const option = asRecord(value);
  if (!option) {
    return null;
  }

  const label = firstNonEmptyString(option, ['label', 'title', 'value']);
  if (!label) {
    return null;
  }

  return {
    label,
    description: firstNonEmptyString(option, ['description']),
  };
}

function hasRequestUserInputShape(value: unknown) {
  const question = asRecord(value);
  if (!question) {
    return false;
  }

  const hasQuestionText = Boolean(firstNonEmptyString(question, ['question', 'prompt', 'label']));
  if (!hasQuestionText) {
    return false;
  }

  if (!('options' in question)) {
    return true;
  }

  return Array.isArray(question.options);
}

function upsertRequestUserInput(turn: ThreadTurn, request: RequestUserInputRequest) {
  const current = turn.pendingUserInputRequests ?? [];
  if (!request.requestId) {
    turn.pendingUserInputRequests = [...current, request];
    return;
  }

  const index = current.findIndex((item) => item.requestId === request.requestId);
  if (index === -1) {
    turn.pendingUserInputRequests = [...current, request];
    return;
  }

  const next = [...current];
  next[index] = {
    ...request,
    submittedAnswers: current[index].submittedAnswers,
    submittedAtMs: current[index].submittedAtMs,
  };
  turn.pendingUserInputRequests = next;
}

function markRequestUserInputSubmitted(
  turn: ThreadTurn,
  requestId: string | undefined,
  resultText: string,
) {
  if (!requestId || !turn.pendingUserInputRequests?.length) {
    return;
  }

  const index = turn.pendingUserInputRequests.findIndex((request) => request.requestId === requestId);
  if (index === -1) {
    return;
  }

  const request = turn.pendingUserInputRequests[index];
  const answers = parseSubmittedRequestUserInputAnswers(request, resultText);
  if (Object.keys(answers).length === 0) {
    return;
  }

  const next = [...turn.pendingUserInputRequests];
  next[index] = {
    ...request,
    submittedAnswers: answers,
    submittedAtMs: request.submittedAtMs ?? 1,
  };
  turn.pendingUserInputRequests = next;
}

function parseSubmittedRequestUserInputAnswers(
  request: RequestUserInputRequest,
  resultText: string,
) {
  const trimmed = resultText.trim();
  if (!trimmed) {
    return {};
  }

  const answers: Record<string, string> = {};
  const parsed = parseJsonObject(trimmed);
  if (parsed) {
    request.questions.forEach((question, index) => {
      const key = question.id ?? `question-${index}`;
      const value = parsed[key] ?? parsed[question.question];
      const text = formatSubmittedAnswer(value);
      if (text) {
        answers[key] = text;
      }
    });
  }

  if (Object.keys(answers).length === 0 && request.questions.length === 1) {
    const key = request.questions[0].id ?? 'question-0';
    answers[key] = trimmed;
  }

  return answers;
}

function formatSubmittedAnswer(value: unknown) {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => typeof item === 'string' ? item.trim() : formatJson(item))
      .filter(Boolean)
      .join('\n');
  }

  if (value == null) {
    return '';
  }

  return formatJson(value);
}

function firstNonEmptyString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

function parseJsonObject(value: unknown) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeToolName(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function formatJson(value: unknown) {
  if (value == null || value === '') {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function stringifyClaudeContent(content: unknown) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (item && typeof item === 'object') {
          const block = item as Record<string, unknown>;
          if (typeof block.text === 'string') {
            return block.text;
          }
        }
        return formatJson(item);
      })
      .filter(Boolean)
      .join('\n');
  }

  return formatJson(content);
}

function describeToolCall(name: string, inputText?: string) {
  let parsed: Record<string, unknown> | undefined;
  if (inputText?.trim()) {
    try {
      parsed = JSON.parse(inputText) as Record<string, unknown>;
    } catch {
      parsed = undefined;
    }
  }

  const filePath = parsed && readString(parsed, ['file_path', 'path', 'notebook_path']);
  const pattern = parsed && readString(parsed, ['pattern', 'query']);
  const command = parsed && readString(parsed, ['command', 'cmd', 'cmdString']);
  const agentName = parsed && readString(parsed, ['subagent_type', 'agent', 'agent_name', 'name']);
  const taskDescription = parsed && readString(parsed, ['description', 'summary', 'task', 'prompt']);

  if (name === 'Read' && filePath) {
    return `Read(${compactToolArgument(filePath)})`;
  }
  if (name === 'Grep' && pattern) {
    return `Grep(${compactToolArgument(pattern)})`;
  }
  if (name === 'Glob' && pattern) {
    return `Glob(${compactToolArgument(pattern)})`;
  }
  if (name === 'Bash' && command) {
    return `Bash(${compactToolArgument(command)})`;
  }
  if ((name === 'Edit' || name === 'Write' || name === 'NotebookEdit') && filePath) {
    return `${name}(${compactToolArgument(filePath)})`;
  }
  if (name === 'Agent' || name === 'Task') {
    const summary = taskDescription || agentName;
    return summary ? `Agent(${compactToolArgument(summary)})` : 'Agent';
  }
  if (name.startsWith('mcp__')) {
    return `MCP(${getReadableToolName(name)})`;
  }
  return getReadableToolName(name);
}

function compactToolArgument(value: string) {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= 96) {
    return clean;
  }
  return `${clean.slice(0, 93)}...`;
}

function getReadableToolName(name: string) {
  if (name.startsWith('mcp__')) {
    const segments = name.split('__').filter(Boolean);
    return segments.at(-1) ?? name;
  }

  return name;
}

function resolveClaudeTranscriptPath(workingDirectory: string, sessionId: string) {
  const root = path.join(homedir(), '.claude', 'projects', sanitizeProjectPath(workingDirectory));
  return path.join(root, `${sessionId}.jsonl`);
}

function sanitizeProjectPath(projectPath: string) {
  return path.resolve(projectPath).replace(/[^a-zA-Z0-9]/g, '-');
}

function formatRelativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return '现在';
  }

  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) {
    return '现在';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays} 天前`;
  }

  return new Date(timestamp).toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  });
}
