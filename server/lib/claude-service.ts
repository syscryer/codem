import { access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';

export type ClaudePermissionMode =
  | 'default'
  | 'plan'
  | 'acceptEdits'
  | 'auto'
  | 'dontAsk'
  | 'bypassPermissions';

type StreamInput = {
  threadId: string;
  turnId?: string;
  prompt: string;
  workingDirectory: string;
  sessionId?: string;
  permissionMode: ClaudePermissionMode;
  model?: string;
  requestReceivedAtMs?: number;
  clientSubmitAtMs?: number;
};

type StreamEvent =
  | { type: 'status'; runId: string; message: string }
  | { type: 'session'; runId: string; sessionId: string }
  | { type: 'delta'; runId: string; text: string }
  | { type: 'trace'; runId: string; name: string; atMs: number; elapsedMs: number; detail?: string }
  | { type: 'phase'; runId: string; phase: ClaudePhase; label: string; thoughtCount?: number }
  | ({ type: 'usage'; runId: string } & ClaudeUsage)
  | { type: 'claude-event'; runId: string; label: string; eventType?: string; subtype?: string; status?: string; raw: unknown }
  | { type: 'request-user-input'; runId: string; request: RequestUserInputRequest }
  | { type: 'approval-request'; runId: string; request: ApprovalRequest }
  | { type: 'runtime-reconnect-hint'; runId: string; hint: RuntimeRecoveryHint }
  | { type: 'retryable-error'; runId: string; message: string; hint: RuntimeRecoveryHint }
  | { type: 'tool-start'; runId: string; blockIndex: number; toolUseId?: string; name: string; input?: unknown }
  | { type: 'tool-input-delta'; runId: string; blockIndex: number; text: string }
  | { type: 'tool-stop'; runId: string; blockIndex: number }
  | { type: 'tool-result'; runId: string; toolUseId?: string; content: string; isError?: boolean }
  | { type: 'assistant-snapshot'; runId: string; blocks: ClaudeContentBlock[] }
  | { type: 'raw'; runId: string; raw: unknown }
  | { type: 'stderr'; runId: string; text: string }
  | ({ type: 'done'; runId: string; sessionId?: string; result: string; totalCostUsd?: number; durationMs?: number } & ClaudeUsage)
  | { type: 'error'; runId: string; message: string };

type ClaudePhase = 'requesting' | 'thinking' | 'computing' | 'tool';

type ClaudeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

type RuntimeReconnectReason =
  | 'resume-session-missing'
  | 'broken-pipe'
  | 'runtime-ended'
  | 'stale-session'
  | 'transport-error'
  | 'unknown';

type RuntimeSuggestedAction = 'retry' | 'resend' | 'recover';

type RuntimeEventSource = 'status' | 'stderr' | 'result' | 'process';

type RuntimeRecoveryHint = {
  reason: RuntimeReconnectReason;
  message: string;
  retryable: boolean;
  suggestedAction: RuntimeSuggestedAction;
  source: RuntimeEventSource;
};

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
};

type ApprovalRequest = {
  requestId?: string;
  title: string;
  description?: string;
  command?: string[];
  danger?: 'low' | 'medium' | 'high';
};

type ClaudeContentBlock = {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};

type ClaudeInputMessage = {
  type: 'user';
  message: {
    role: 'user';
    content: Array<{
      type: 'text';
      text: string;
    }>;
  };
};

type ClaudeJsonLine = {
  type?: string;
  subtype?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  errors?: string[];
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: ClaudeRawUsage;
  message?: {
    role?: string;
    model?: string;
    content?: ClaudeContentBlock[];
    usage?: ClaudeRawUsage;
  };
  event?: {
    type?: string;
    index?: number;
    message?: {
      usage?: ClaudeRawUsage;
    };
    usage?: ClaudeRawUsage;
    content_block?: ClaudeContentBlock;
    delta?: {
      type?: string;
      text?: string;
      partial_json?: string;
    };
  };
  status?: string;
};

type ClaudeRawUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

type ClaudeChildProcess = ChildProcessByStdio<Writable, Readable, Readable>;

type ToolInputAccumulator = {
  name: string;
  toolUseId?: string;
  inputText: string;
  emittedRequestUserInput: boolean;
  emittedApprovalRequest: boolean;
};

type RunState = {
  runId: string;
  input: StreamInput;
  traceStartedAtMs: number;
  queue: StreamEvent[];
  wakeQueue: (() => void) | null;
  eventLog: StreamEvent[];
  eventWaiters: Set<() => void>;
  finished: boolean;
  detached: boolean;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  pendingTextDelta: string;
  pendingTextDeltaTimer: ReturnType<typeof setTimeout> | null;
  firstStdoutAtMs?: number;
  firstDeltaAtMs?: number;
  firstDeltaFlushedAtMs?: number;
  sessionId?: string;
  finalResult: string;
  seenDoneEvent: boolean;
  thoughtCount: number;
  blockTypeByIndex: Map<number, string>;
  toolInputByIndex: Map<number, ToolInputAccumulator>;
  emittedRecoveryHintKeys: Set<string>;
};

type ClaudeRuntime = {
  key: string;
  child: ClaudeChildProcess;
  sessionId?: string;
  workingDirectory: string;
  permissionMode: ClaudePermissionMode;
  model?: string;
  inputMode: 'argv' | 'stdin';
  reusable: boolean;
  stdoutBuffer: string;
  stderrBuffer: string;
  currentRun: RunState | null;
  closed: boolean;
};

type ActiveRun = {
  runtime: ClaudeRuntime;
  state: RunState;
  cancel: () => boolean;
};

const activeRuns = new Map<string, ActiveRun>();
const threadActiveRuns = new Map<string, string>();
const threadRuntimes = new Map<string, ClaudeRuntime>();
const TEXT_DELTA_COALESCE_MS = process.platform === 'win32' ? 32 : 0;
const RUN_RECONNECT_RETENTION_MS = 10 * 60 * 1000;
let cachedClaudeCommand: string | null | undefined;

export async function isDirectoryAccessible(directory: string) {
  try {
    await access(directory);
    return true;
  } catch {
    return false;
  }
}

export async function detectClaudeCommand() {
  const command = resolveClaudeCommand();

  if (command) {
    return {
      available: true,
      command,
    };
  }

  return {
    available: false,
    error: '未找到 claude 命令',
  };
}

export function getClaudeModels() {
  const command = resolveClaudeCommand();

  if (!command) {
    return {
      available: false,
      models: [],
      error: '未找到 claude 命令',
    };
  }

  return {
    available: true,
    models: getConfiguredModelOptions(),
  };
}

export function cancelRun(runId: string) {
  const activeRun = activeRuns.get(runId);
  if (!activeRun || activeRun.state.finished) {
    return false;
  }

  activeRun.cancel();
  activeRuns.delete(runId);
  return true;
}

export function closeThreadRuntime(threadId: string) {
  const runtime = threadRuntimes.get(threadId.trim());
  if (!runtime) {
    return false;
  }

  closeClaudeRuntime(runtime);
  return true;
}

export function markRunDetached(runId: string) {
  const activeRun = activeRuns.get(runId);
  if (!activeRun) {
    return false;
  }

  activeRun.state.detached = true;
  return true;
}

export function markThreadRunDetached(threadId: string) {
  const runId = threadActiveRuns.get(threadId.trim());
  return runId ? markRunDetached(runId) : false;
}

export function acknowledgeRunEvents(runId: string) {
  const activeRun = activeRuns.get(runId);
  if (!activeRun?.state.finished) {
    return false;
  }

  removeRunRecord(activeRun.state);
  return true;
}

export function getActiveRunForThread(threadId: string) {
  const normalizedThreadId = threadId.trim();
  const runId = threadActiveRuns.get(normalizedThreadId);
  if (!runId) {
    return null;
  }

  const activeRun = activeRuns.get(runId);
  if (!activeRun) {
    threadActiveRuns.delete(normalizedThreadId);
    return null;
  }

  const { state } = activeRun;
  if (state.finished && !state.detached) {
    return null;
  }

  return {
    runId: state.runId,
    threadId: state.input.threadId,
    turnId: state.input.turnId,
    prompt: state.input.prompt,
    workingDirectory: state.input.workingDirectory,
    sessionId: state.sessionId,
    permissionMode: state.input.permissionMode,
    model: state.input.model,
    startedAtMs: state.traceStartedAtMs,
    eventCount: state.eventLog.length,
    finished: state.finished,
  };
}

export async function* reconnectClaudeRunEvents(
  runId: string,
  afterEventIndex = 0,
): AsyncGenerator<StreamEvent> {
  const activeRun = activeRuns.get(runId);
  if (!activeRun) {
    return;
  }

  const { state } = activeRun;
  let index = Math.max(0, Math.floor(afterEventIndex));

  while (true) {
    while (index < state.eventLog.length) {
      yield state.eventLog[index];
      index += 1;
    }

    if (state.finished) {
      return;
    }

    await new Promise<void>((resolve) => {
      state.eventWaiters.add(resolve);
    });
  }
}

export async function* createClaudeStream(input: StreamInput): AsyncGenerator<StreamEvent> {
  const runId = randomUUID();
  const streamStartedAtMs = Date.now();
  const command = resolveClaudeCommand();
  const commandResolvedAtMs = Date.now();
  const runtimeKey = getRuntimeKey(input);

  if (!command) {
    yield {
      type: 'error',
      runId,
      message: '未找到 claude 命令，请先确认 Claude Code 已安装并在 PATH 中可见。',
    };
    return;
  }

  const spawnStartedAtMs = Date.now();
  const { runtime, reused } = getOrCreateClaudeRuntime(command, input);
  const spawnReturnedAtMs = Date.now();

  if (runtime.currentRun) {
    yield {
      type: 'error',
      runId,
      message: '当前会话仍有运行中的 Claude 请求，请等待结束或停止后再发送。',
    };
    return;
  }

  const state = createRunState(runId, input, runtime.sessionId ?? input.sessionId?.trim());
  runtime.currentRun = state;
  activeRuns.set(runId, {
    runtime,
    state,
    cancel: () => cancelRuntimeRun(runtime, runId),
  });
  threadActiveRuns.set(getRuntimeKey(input), runId);

  if (input.clientSubmitAtMs) {
    enqueueTrace(state, 'client_submit', input.clientSubmitAtMs);
  }
  if (input.requestReceivedAtMs) {
    enqueueTrace(state, 'server_request_received', input.requestReceivedAtMs);
  }
  enqueueTrace(state, 'create_stream_started', streamStartedAtMs);
  enqueueTrace(state, 'claude_command_resolved', commandResolvedAtMs, command);
  if (reused) {
    enqueueTrace(state, 'claude_runtime_reused', spawnReturnedAtMs, runtimeKey);
  } else {
    enqueueTrace(state, 'claude_spawn_started', spawnStartedAtMs);
    enqueueTrace(state, 'claude_process_spawned', spawnReturnedAtMs, `${spawnReturnedAtMs - spawnStartedAtMs}ms`);
  }
  enqueueRunEvent(state, {
    type: 'status',
    runId,
    message: reused ? '已复用 Claude Code 会话' : '已启动 Claude Code 会话',
  });

  writePromptToClaude(runtime, state, input.prompt);

  while (!state.finished || state.queue.length > 0) {
    const next = state.queue.shift();
    if (next) {
      yield next;
      continue;
    }

    await new Promise<void>((resolve) => {
      state.wakeQueue = resolve;
    });
  }
}

function createRunState(runId: string, input: StreamInput, sessionId?: string): RunState {
  return {
    runId,
    input,
    traceStartedAtMs: input.clientSubmitAtMs ?? input.requestReceivedAtMs ?? Date.now(),
    queue: [],
    wakeQueue: null,
    eventLog: [],
    eventWaiters: new Set(),
    finished: false,
    detached: false,
    cleanupTimer: null,
    pendingTextDelta: '',
    pendingTextDeltaTimer: null,
    firstStdoutAtMs: undefined,
    firstDeltaAtMs: undefined,
    firstDeltaFlushedAtMs: undefined,
    sessionId,
    finalResult: '',
    seenDoneEvent: false,
    thoughtCount: 0,
    blockTypeByIndex: new Map(),
    toolInputByIndex: new Map(),
    emittedRecoveryHintKeys: new Set(),
  };
}

function enqueueRunEvent(state: RunState, event: StreamEvent) {
  if (state.finished) {
    return;
  }

  if (event.type !== 'delta') {
    flushPendingTextDelta(state);
  }

  pushRunEvent(state, event);
}

function enqueueTrace(state: RunState, name: string, atMs = Date.now(), detail?: string) {
  enqueueRunEvent(state, {
    type: 'trace',
    runId: state.runId,
    name,
    atMs,
    elapsedMs: Math.max(0, atMs - state.traceStartedAtMs),
    detail,
  });
}

function pushRunEvent(state: RunState, event: StreamEvent) {
  state.eventLog.push(event);
  state.queue.push(event);
  state.wakeQueue?.();
  state.wakeQueue = null;
  for (const wake of state.eventWaiters) {
    wake();
  }
  state.eventWaiters.clear();
}

function finishRuntimeRun(runtime: ClaudeRuntime, state: RunState) {
  flushPendingTextDelta(state);

  if (runtime.currentRun === state) {
    runtime.currentRun = null;
  }

  state.finished = true;
  state.wakeQueue?.();
  state.wakeQueue = null;
  for (const wake of state.eventWaiters) {
    wake();
  }
  state.eventWaiters.clear();
  scheduleRunRecordCleanup(state);
}

function enqueueTextDelta(state: RunState, text: string) {
  if (!text) {
    return;
  }

  if (!state.firstDeltaAtMs) {
    state.firstDeltaAtMs = Date.now();
    enqueueTrace(state, 'first_delta_received', state.firstDeltaAtMs, `${text.length} chars`);
  }

  if (TEXT_DELTA_COALESCE_MS <= 0) {
    enqueueRunEvent(state, {
      type: 'delta',
      runId: state.runId,
      text,
    });
    return;
  }

  state.pendingTextDelta += text;
  if (state.pendingTextDeltaTimer) {
    return;
  }

  state.pendingTextDeltaTimer = setTimeout(() => {
    state.pendingTextDeltaTimer = null;
    flushPendingTextDelta(state);
  }, TEXT_DELTA_COALESCE_MS);
}

function flushPendingTextDelta(state: RunState) {
  if (state.pendingTextDeltaTimer) {
    clearTimeout(state.pendingTextDeltaTimer);
    state.pendingTextDeltaTimer = null;
  }

  if (!state.pendingTextDelta || state.finished) {
    return;
  }

  const text = state.pendingTextDelta;
  state.pendingTextDelta = '';
  if (!state.firstDeltaFlushedAtMs) {
    state.firstDeltaFlushedAtMs = Date.now();
    enqueueTrace(state, 'first_delta_flushed', state.firstDeltaFlushedAtMs, `${text.length} chars`);
  }
  pushRunEvent(state, {
    type: 'delta',
    runId: state.runId,
    text,
  });
}

function cancelRuntimeRun(runtime: ClaudeRuntime, runId: string) {
  const state = runtime.currentRun;
  if (!state || state.runId !== runId) {
    return false;
  }

  state.seenDoneEvent = true;
  enqueueRunEvent(state, {
    type: 'done',
    runId: state.runId,
    sessionId: state.sessionId,
    result: state.finalResult,
  });
  finishRuntimeRun(runtime, state);
  closeClaudeRuntime(runtime);
  return true;
}

function scheduleRunRecordCleanup(state: RunState) {
  if (state.cleanupTimer) {
    clearTimeout(state.cleanupTimer);
  }

  state.cleanupTimer = setTimeout(() => {
    removeRunRecord(state);
  }, RUN_RECONNECT_RETENTION_MS);
}

function removeRunRecord(state: RunState) {
  if (!state.finished) {
    return;
  }

  if (state.cleanupTimer) {
    clearTimeout(state.cleanupTimer);
    state.cleanupTimer = null;
  }

  activeRuns.delete(state.runId);
  if (threadActiveRuns.get(state.input.threadId) === state.runId) {
    threadActiveRuns.delete(state.input.threadId);
  }
}

function getRuntimeKey(input: StreamInput) {
  return input.threadId.trim();
}

function getOrCreateClaudeRuntime(command: string, input: StreamInput): { runtime: ClaudeRuntime; reused: boolean } {
  const key = getRuntimeKey(input);
  const existing = threadRuntimes.get(key);

  if (existing) {
    if (existing.currentRun) {
      return { runtime: existing, reused: false };
    }

    if (isRuntimeCompatible(existing, input)) {
      return { runtime: existing, reused: true };
    }

    closeClaudeRuntime(existing);
  }

  if (input.sessionId?.trim()) {
    return { runtime: spawnClaudeRuntime(command, input, 'argv'), reused: false };
  }

  const runtime = spawnClaudeRuntime(command, input, 'stdin');
  threadRuntimes.set(key, runtime);
  return { runtime, reused: false };
}

function isRuntimeCompatible(runtime: ClaudeRuntime, input: StreamInput) {
  const requestedSessionId = input.sessionId?.trim();

  return (
    !runtime.closed &&
    runtime.reusable &&
    runtime.inputMode === 'stdin' &&
    runtime.workingDirectory === input.workingDirectory &&
    runtime.permissionMode === input.permissionMode &&
    runtime.model === input.model &&
    (!requestedSessionId || !runtime.sessionId || runtime.sessionId === requestedSessionId)
  );
}

function spawnClaudeRuntime(command: string, input: StreamInput, inputMode: ClaudeRuntime['inputMode']): ClaudeRuntime {
  const resumeSessionId = input.sessionId?.trim();
  const args = inputMode === 'stdin' ? ['-p', '', '--input-format', 'stream-json'] : ['-p', input.prompt];

  args.push('--verbose', '--output-format', 'stream-json', '--include-partial-messages');

  if (input.permissionMode === 'bypassPermissions') {
    args.push('--dangerously-skip-permissions');
  } else {
    args.push('--permission-mode', input.permissionMode);
  }

  if (input.model) {
    args.push('--model', input.model);
  }

  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  }

  const child = spawn(command, args, {
    cwd: input.workingDirectory,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const runtime: ClaudeRuntime = {
    key: getRuntimeKey(input),
    child,
    sessionId: resumeSessionId,
    workingDirectory: input.workingDirectory,
    permissionMode: input.permissionMode,
    model: input.model,
    inputMode,
    reusable: inputMode === 'stdin',
    stdoutBuffer: '',
    stderrBuffer: '',
    currentRun: null,
    closed: false,
  };

  bindClaudeRuntime(runtime);
  return runtime;
}

function bindClaudeRuntime(runtime: ClaudeRuntime) {
  runtime.child.stdout.on('data', (chunk: Buffer | string) => {
    runtime.stdoutBuffer += chunk.toString();
    const lines = runtime.stdoutBuffer.split(/\r?\n/);
    runtime.stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      flushRuntimeStdoutLine(runtime, line);
    }
  });

  runtime.child.stderr.on('data', (chunk: Buffer | string) => {
    runtime.stderrBuffer += chunk.toString();
    const lines = runtime.stderrBuffer.split(/\r?\n/);
    runtime.stderrBuffer = lines.pop() ?? '';

    for (const line of lines) {
      flushRuntimeStderrLine(runtime, line);
    }
  });

  runtime.child.stdin.on('error', (error) => {
    const state = runtime.currentRun;
    if (!state) {
      return;
    }

    const message = `写入 Claude Code 输入失败：${error.message}`;
    enqueueRetryableRuntimeError(state.runId, message, 'process', state.emittedRecoveryHintKeys, (event) =>
      enqueueRunEvent(state, event),
    );
    enqueueRunEvent(state, {
      type: 'error',
      runId: state.runId,
      message,
    });
    finishRuntimeRun(runtime, state);
    closeClaudeRuntime(runtime);
  });

  runtime.child.once('error', (error) => {
    const state = runtime.currentRun;
    if (state) {
      enqueueRetryableRuntimeError(state.runId, error.message, 'process', state.emittedRecoveryHintKeys, (event) =>
        enqueueRunEvent(state, event),
      );
      enqueueRunEvent(state, {
        type: 'error',
        runId: state.runId,
        message: error.message,
      });
      finishRuntimeRun(runtime, state);
    }

    closeClaudeRuntime(runtime);
  });

  runtime.child.once('close', (code, signal) => {
    if (runtime.stdoutBuffer.trim()) {
      flushRuntimeStdoutLine(runtime, runtime.stdoutBuffer);
      runtime.stdoutBuffer = '';
    }

    if (runtime.stderrBuffer.trim()) {
      flushRuntimeStderrLine(runtime, runtime.stderrBuffer);
      runtime.stderrBuffer = '';
    }

    const state = runtime.currentRun;
    if (state && !state.seenDoneEvent) {
      if (code === 0 || signal === 'SIGTERM') {
        state.seenDoneEvent = true;
        enqueueRunEvent(state, {
          type: 'done',
          runId: state.runId,
          sessionId: state.sessionId,
          result: state.finalResult,
        });
      } else {
        const message = `Claude 退出异常，code=${code ?? 'null'} signal=${signal ?? 'null'}`;
        enqueueRetryableRuntimeError(state.runId, message, 'process', state.emittedRecoveryHintKeys, (event) =>
          enqueueRunEvent(state, event),
        );
        enqueueRunEvent(state, {
          type: 'error',
          runId: state.runId,
          message,
        });
      }
      finishRuntimeRun(runtime, state);
    }

    closeClaudeRuntime(runtime);
  });
}

function flushRuntimeStdoutLine(runtime: ClaudeRuntime, line: string) {
  const state = runtime.currentRun;
  if (!state) {
    return;
  }

  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  if (!state.firstStdoutAtMs) {
    state.firstStdoutAtMs = Date.now();
    enqueueTrace(state, 'first_stdout_line', state.firstStdoutAtMs);
  }

  try {
    const payload = JSON.parse(trimmed) as ClaudeJsonLine;
    if (payload.isSidechain) {
      return;
    }

    enqueueRunEvent(state, {
      type: 'raw',
      runId: state.runId,
      raw: payload,
    });

    const resultErrorMessage = getResultErrorMessage(payload);
    if (payload.session_id && payload.session_id !== state.sessionId && !resultErrorMessage) {
      state.sessionId = payload.session_id;
      runtime.sessionId = payload.session_id;
      enqueueRunEvent(state, {
        type: 'session',
        runId: state.runId,
        sessionId: payload.session_id,
      });
    }

    handleClaudePayload(runtime, state, payload);
  } catch {
    enqueueRunEvent(state, {
      type: 'stderr',
      runId: state.runId,
      text: trimmed,
    });
    enqueueRuntimeReconnectHint(state.runId, trimmed, 'stderr', state.emittedRecoveryHintKeys, (event) =>
      enqueueRunEvent(state, event),
    );
  }
}

function handleClaudePayload(runtime: ClaudeRuntime, state: RunState, payload: ClaudeJsonLine) {
  const enqueue = (event: StreamEvent) => enqueueRunEvent(state, event);
  const { runId } = state;

  if (payload.type === 'system') {
    enqueue({
      type: 'claude-event',
      runId,
      label: describeSystemEvent(payload),
      eventType: payload.type,
      subtype: payload.subtype,
      raw: payload,
    });
  }

  if (payload.type === 'system' && payload.subtype === 'status') {
    if (payload.status === 'requesting') {
      enqueue({
        type: 'phase',
        runId,
        phase: 'requesting',
        label: 'Thinking...',
      });
    }

    enqueue({
      type: 'claude-event',
      runId,
      label: `状态：${payload.status ?? 'unknown'}`,
      eventType: payload.type,
      subtype: payload.subtype,
      status: payload.status,
      raw: payload,
    });
  }

  if (payload.type !== 'result') {
    const usage = extractUsage(payload);
    if (usage) {
      enqueue({
        type: 'usage',
        runId,
        ...usage,
      });
    }
  }

  if (payload.type === 'stream_event' && payload.event?.type === 'content_block_start') {
    const block = payload.event.content_block;
    if (typeof payload.event.index === 'number' && block?.type) {
      state.blockTypeByIndex.set(payload.event.index, block.type);
    }

    if (block?.type === 'thinking') {
      state.thoughtCount += 1;
      enqueue({
        type: 'phase',
        runId,
        phase: 'thinking',
        label: 'Thinking...',
        thoughtCount: state.thoughtCount,
      });
    }

    if (block?.type === 'tool_use' && block.name) {
      if (typeof payload.event.index === 'number') {
        state.toolInputByIndex.set(payload.event.index, {
          name: block.name,
          toolUseId: block.id,
          inputText: getToolInputSeed(block.input),
          emittedRequestUserInput: false,
          emittedApprovalRequest: false,
        });
      }

      const requestUserInput = parseRequestUserInputEvent(block.name, block.input, block.id);
      if (requestUserInput) {
        const accumulator =
          typeof payload.event.index === 'number' ? state.toolInputByIndex.get(payload.event.index) : undefined;
        if (accumulator) {
          accumulator.emittedRequestUserInput = true;
        }
        enqueue({
          type: 'request-user-input',
          runId,
          request: requestUserInput,
        });
      }

      const approvalRequest = parseApprovalRequestEvent(block.name, block.input, block.id);
      if (approvalRequest) {
        const accumulator =
          typeof payload.event.index === 'number' ? state.toolInputByIndex.get(payload.event.index) : undefined;
        if (accumulator) {
          accumulator.emittedApprovalRequest = true;
        }
        enqueue({
          type: 'approval-request',
          runId,
          request: approvalRequest,
        });
      }

      enqueue({
        type: 'phase',
        runId,
        phase: 'tool',
        label: 'Computing...',
      });
      enqueue({
        type: 'tool-start',
        runId,
        blockIndex: payload.event.index ?? -1,
        toolUseId: block.id,
        name: block.name,
        input: block.input,
      });
    }
  }

  if (
    payload.type === 'stream_event' &&
    payload.event?.type === 'content_block_delta' &&
    payload.event.delta?.type === 'text_delta' &&
    payload.event.delta.text
  ) {
    const currentBlockType =
      typeof payload.event.index === 'number' ? state.blockTypeByIndex.get(payload.event.index) : undefined;
    if (currentBlockType === 'thinking' || currentBlockType === 'redacted_thinking') {
      return;
    }

    enqueueTextDelta(state, payload.event.delta.text);
    enqueue({
      type: 'phase',
      runId,
      phase: 'computing',
      label: 'Computing...',
    });
  }

  if (
    payload.type === 'stream_event' &&
    payload.event?.type === 'content_block_delta' &&
    payload.event.delta?.type === 'thinking_delta'
  ) {
    enqueue({
      type: 'phase',
      runId,
      phase: 'thinking',
      label: 'Thinking...',
      thoughtCount: state.thoughtCount || undefined,
    });
  }

  if (
    payload.type === 'stream_event' &&
    payload.event?.type === 'content_block_delta' &&
    payload.event.delta?.type === 'input_json_delta' &&
    payload.event.delta.partial_json
  ) {
    if (typeof payload.event.index === 'number') {
      const accumulator = state.toolInputByIndex.get(payload.event.index);
      if (accumulator) {
        accumulator.inputText += payload.event.delta.partial_json;
        emitStructuredToolEventsFromAccumulator(runId, accumulator, enqueue);
      }
    }

    enqueue({
      type: 'tool-input-delta',
      runId,
      blockIndex: payload.event.index ?? -1,
      text: payload.event.delta.partial_json,
    });
    enqueue({
      type: 'phase',
      runId,
      phase: 'tool',
      label: 'Computing...',
    });
  }

  if (payload.type === 'stream_event' && payload.event?.type === 'content_block_stop') {
    const currentBlockType =
      typeof payload.event.index === 'number' ? state.blockTypeByIndex.get(payload.event.index) : undefined;
    if (typeof payload.event.index === 'number') {
      state.blockTypeByIndex.delete(payload.event.index);
      const accumulator = state.toolInputByIndex.get(payload.event.index);
      if (accumulator) {
        emitStructuredToolEventsFromAccumulator(runId, accumulator, enqueue);
        state.toolInputByIndex.delete(payload.event.index);
      }
    }

    if (currentBlockType === 'tool_use') {
      enqueue({
        type: 'tool-stop',
        runId,
        blockIndex: payload.event.index ?? -1,
      });
    }
  }

  if (payload.type === 'assistant' && isNoResponseRequestedAssistant(payload)) {
    return;
  }

  if (payload.type === 'assistant' && Array.isArray(payload.message?.content)) {
    enqueue({
      type: 'assistant-snapshot',
      runId,
      blocks: payload.message.content,
    });

    for (const block of payload.message.content) {
      if (block.type !== 'tool_use' || !block.name) {
        continue;
      }

      const requestUserInput = parseRequestUserInputEvent(block.name, block.input, block.id);
      if (requestUserInput) {
        enqueue({
          type: 'request-user-input',
          runId,
          request: requestUserInput,
        });
      }

      const approvalRequest = parseApprovalRequestEvent(block.name, block.input, block.id);
      if (approvalRequest) {
        enqueue({
          type: 'approval-request',
          runId,
          request: approvalRequest,
        });
      }
    }

    const assistantText = payload.message.content
      .filter((item) => item.type === 'text' && item.text)
      .map((item) => item.text ?? '')
      .join('');

    if (assistantText) {
      state.finalResult = assistantText;
    }
  }

  if (payload.type === 'user' && Array.isArray(payload.message?.content)) {
    if (isReplayedPrompt(payload, state.input.prompt)) {
      enqueue({
        type: 'status',
        runId,
        message: 'Claude Code 已接收用户消息',
      });
    }

    for (const block of payload.message.content) {
      if (block.type !== 'tool_result') {
        continue;
      }

      enqueue({
        type: 'tool-result',
        runId,
        toolUseId: block.tool_use_id,
        content: stringifyClaudeContent(block.content),
        isError: block.is_error,
      });
    }
  }

  if (payload.type === 'result') {
    const usage = normalizeUsage(payload.usage);
    if (usage) {
      enqueue({
        type: 'usage',
        runId,
        ...usage,
      });
    }

    const errorMessage = getResultErrorMessage(payload);
    if (errorMessage) {
      enqueueRetryableRuntimeError(runId, errorMessage, 'result', state.emittedRecoveryHintKeys, enqueue);
      state.seenDoneEvent = true;
      enqueue({
        type: 'error',
        runId,
        message: errorMessage,
      });
      finishRuntimeRun(runtime, state);
      return;
    }

    state.finalResult = payload.result ?? state.finalResult;
    state.seenDoneEvent = true;
    enqueue({
      type: 'done',
      runId,
      sessionId: state.sessionId,
      result: state.finalResult,
      totalCostUsd: payload.total_cost_usd,
      durationMs: payload.duration_ms,
      ...usage,
    });
    finishRuntimeRun(runtime, state);
  }
}

function flushRuntimeStderrLine(runtime: ClaudeRuntime, line: string) {
  const state = runtime.currentRun;
  const trimmed = line.trim();
  if (!state || !trimmed) {
    return;
  }

  enqueueRunEvent(state, {
    type: 'stderr',
    runId: state.runId,
    text: trimmed,
  });
  enqueueRuntimeReconnectHint(state.runId, trimmed, 'stderr', state.emittedRecoveryHintKeys, (event) =>
    enqueueRunEvent(state, event),
  );
}

function closeClaudeRuntime(runtime: ClaudeRuntime) {
  if (runtime.closed) {
    return;
  }

  runtime.closed = true;
  threadRuntimes.delete(runtime.key);
  const state = runtime.currentRun;
  if (state) {
    state.seenDoneEvent = true;
    enqueueRunEvent(state, {
      type: 'error',
      runId: state.runId,
      message: 'Claude 会话已关闭。',
    });
    finishRuntimeRun(runtime, state);
  }
  runtime.child.kill();
}

function extractUsage(payload: ClaudeJsonLine) {
  return (
    normalizeUsage(payload.event?.usage) ??
    normalizeUsage(payload.event?.message?.usage) ??
    normalizeUsage(payload.message?.usage)
  );
}

function normalizeUsage(usage?: ClaudeRawUsage) {
  if (!usage) {
    return undefined;
  }

  const next: ClaudeUsage = {};
  if (typeof usage.input_tokens === 'number') {
    next.inputTokens = usage.input_tokens;
  }
  if (typeof usage.output_tokens === 'number') {
    next.outputTokens = usage.output_tokens;
  }
  if (typeof usage.cache_creation_input_tokens === 'number') {
    next.cacheCreationInputTokens = usage.cache_creation_input_tokens;
  }
  if (typeof usage.cache_read_input_tokens === 'number') {
    next.cacheReadInputTokens = usage.cache_read_input_tokens;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function resolveClaudeCommand() {
  if (cachedClaudeCommand !== undefined) {
    return cachedClaudeCommand;
  }

  const lookupCommand = process.platform === 'win32' ? 'where.exe' : 'which';
  const lookup = spawnSync(lookupCommand, ['claude'], {
    encoding: 'utf8',
  });

  if (lookup.status !== 0) {
    cachedClaudeCommand = null;
    return null;
  }

  cachedClaudeCommand =
    lookup.stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find(Boolean) ?? null;

  return cachedClaudeCommand;
}

function getConfiguredModelOptions() {
  const configuredModel = readConfiguredClaudeModel();
  return ['__default', configuredModel].filter((value): value is string => Boolean(value));
}

function readConfiguredClaudeModel() {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) {
    return undefined;
  }

  try {
    const settingsPath = `${home}\\.claude\\settings.json`;
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      env?: Record<string, unknown>;
    };
    const model = settings.env?.ANTHROPIC_MODEL;
    return typeof model === 'string' && model.trim() ? model.trim() : undefined;
  } catch {
    return undefined;
  }
}

function isNoResponseRequestedAssistant(payload: ClaudeJsonLine) {
  if (payload.type !== 'assistant' || !Array.isArray(payload.message?.content)) {
    return false;
  }

  const visibleText = payload.message.content
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text?.trim() ?? '')
    .join('\n')
    .trim();

  return visibleText === 'No response requested.';
}

function buildClaudeInputMessage(prompt: string): ClaudeInputMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: prompt,
        },
      ],
    },
  };
}

function writePromptToClaude(runtime: ClaudeRuntime, state: RunState, prompt: string) {
  if (runtime.inputMode === 'argv') {
    enqueueTrace(state, 'prompt_sent_as_arg', Date.now(), `${prompt.length} chars`);
    runtime.child.stdin.end();
    return;
  }

  const payload = `${JSON.stringify(buildClaudeInputMessage(prompt))}\n`;
  runtime.child.stdin.write(payload, (error) => {
    if (error) {
      const message = `写入 Claude Code 输入失败：${error.message}`;
      enqueueRetryableRuntimeError(state.runId, message, 'process', state.emittedRecoveryHintKeys, (event) =>
        enqueueRunEvent(state, event),
      );
      enqueueRunEvent(state, {
        type: 'error',
        runId: state.runId,
        message,
      });
      finishRuntimeRun(runtime, state);
      closeClaudeRuntime(runtime);
      return;
    }

    enqueueTrace(state, 'stdin_prompt_written', Date.now(), `${prompt.length} chars`);
  });
}

function isReplayedPrompt(payload: ClaudeJsonLine, prompt: string) {
  if (payload.type !== 'user' || !Array.isArray(payload.message?.content)) {
    return false;
  }

  const text = payload.message.content
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text ?? '')
    .join('')
    .trim();

  return text === prompt.trim();
}

function getResultErrorMessage(payload: ClaudeJsonLine) {
  if (payload.type !== 'result') {
    return '';
  }

  const errors = Array.isArray(payload.errors) ? payload.errors.filter(Boolean) : [];
  const hasError = payload.is_error || payload.subtype === 'error_during_execution' || errors.length > 0;
  if (!hasError) {
    return '';
  }

  const details = errors.join('\n').trim();
  return details || payload.result?.trim() || 'Claude 运行失败，但未返回具体错误。';
}

function describeSystemEvent(payload: ClaudeJsonLine) {
  if (payload.subtype === 'init') {
    return '初始化 Claude Code 运行环境';
  }

  if (payload.subtype === 'hook_started') {
    return 'Hook 开始执行';
  }

  if (payload.subtype === 'hook_response') {
    return 'Hook 执行完成';
  }

  if (payload.subtype === 'status') {
    return `状态：${payload.status ?? 'unknown'}`;
  }

  return payload.subtype ? `系统事件：${payload.subtype}` : '系统事件';
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

        if (
          item &&
          typeof item === 'object' &&
          'text' in item &&
          typeof (item as { text?: unknown }).text === 'string'
        ) {
          return (item as { text: string }).text;
        }

        return JSON.stringify(item, null, 2);
      })
      .join('\n');
  }

  if (content == null) {
    return '';
  }

  return JSON.stringify(content, null, 2);
}

function enqueueRuntimeReconnectHint(
  runId: string,
  message: string,
  source: RuntimeEventSource,
  emittedRecoveryHintKeys: Set<string>,
  enqueue: (event: StreamEvent) => void,
) {
  const hint = createRuntimeRecoveryHint(message, source);
  if (!hint) {
    return null;
  }

  const key = `${hint.reason}:${hint.message}`;
  if (emittedRecoveryHintKeys.has(key)) {
    return hint;
  }

  emittedRecoveryHintKeys.add(key);
  enqueue({
    type: 'runtime-reconnect-hint',
    runId,
    hint,
  });
  return hint;
}

function enqueueRetryableRuntimeError(
  runId: string,
  message: string,
  source: RuntimeEventSource,
  emittedRecoveryHintKeys: Set<string>,
  enqueue: (event: StreamEvent) => void,
) {
  const hint = enqueueRuntimeReconnectHint(runId, message, source, emittedRecoveryHintKeys, enqueue);
  if (!hint) {
    return;
  }

  enqueue({
    type: 'retryable-error',
    runId,
    message,
    hint,
  });
}

function createRuntimeRecoveryHint(
  message: string,
  source: RuntimeEventSource,
): RuntimeRecoveryHint | null {
  const normalized = message.trim();
  if (!normalized) {
    return null;
  }

  const lower = normalized.toLowerCase();
  let reason: RuntimeReconnectReason | null = null;
  if (lower.includes('broken pipe') || lower.includes('epipe')) {
    reason = 'broken-pipe';
  } else if (
    lower.includes('socket hang up') ||
    lower.includes('connection reset') ||
    lower.includes('stream closed') ||
    lower.includes('network error')
  ) {
    reason = 'transport-error';
  } else if (
    lower.includes('runtime ended') ||
    lower.includes('unexpected eof') ||
    lower.includes(' has ended') ||
    lower === 'eof'
  ) {
    reason = 'runtime-ended';
  } else if (
    lower.includes('stale') ||
    lower.includes('session expired') ||
    lower.includes('thread expired')
  ) {
    reason = 'stale-session';
  } else if (lower.includes('resume') && lower.includes('not exist')) {
    reason = 'resume-session-missing';
  }

  if (!reason) {
    return null;
  }

  return {
    reason,
    message: normalized,
    retryable: true,
    suggestedAction: getSuggestedRuntimeAction(reason),
    source,
  };
}

function getSuggestedRuntimeAction(reason: RuntimeReconnectReason): RuntimeSuggestedAction {
  if (reason === 'resume-session-missing') {
    return 'recover';
  }

  if (reason === 'stale-session') {
    return 'resend';
  }

  return 'retry';
}

function parseRequestUserInputEvent(
  toolName: string,
  input: unknown,
  toolUseId?: string,
): RequestUserInputRequest | null {
  const normalizedToolName = normalizeToolName(toolName);
  const payload = asRecord(input);
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

function emitStructuredToolEventsFromAccumulator(
  runId: string,
  accumulator: ToolInputAccumulator,
  enqueue: (event: StreamEvent) => void,
) {
  const input = parseJsonObject(accumulator.inputText);
  if (!input) {
    return;
  }

  if (!accumulator.emittedRequestUserInput) {
    const request = parseRequestUserInputEvent(accumulator.name, input, accumulator.toolUseId);
    if (request) {
      accumulator.emittedRequestUserInput = true;
      enqueue({
        type: 'request-user-input',
        runId,
        request,
      });
    }
  }

  if (!accumulator.emittedApprovalRequest) {
    const request = parseApprovalRequestEvent(accumulator.name, input, accumulator.toolUseId);
    if (request) {
      accumulator.emittedApprovalRequest = true;
      enqueue({
        type: 'approval-request',
        runId,
        request,
      });
    }
  }
}

function parseJsonObject(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getToolInputSeed(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return '';
  }

  if (Object.keys(input).length === 0) {
    return '';
  }

  return JSON.stringify(input);
}

function parseRequestUserInputQuestion(
  value: unknown,
  index: number,
): RequestUserInputQuestion | null {
  const question = asRecord(value);
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

function hasRequestUserInputShape(value: unknown) {
  const question = asRecord(value);
  const hasQuestionText = Boolean(firstNonEmptyString(question, ['question', 'prompt', 'label']));
  if (!hasQuestionText) {
    return false;
  }

  if (!('options' in question)) {
    return true;
  }

  return Array.isArray(question.options);
}

function parseRequestUserInputOption(value: unknown): RequestUserInputOption | null {
  const option = asRecord(value);
  const label = firstNonEmptyString(option, ['label', 'title', 'value']);
  if (!label) {
    return null;
  }

  return {
    label,
    description: firstNonEmptyString(option, ['description']),
  };
}

function parseApprovalRequestEvent(
  toolName: string,
  input: unknown,
  toolUseId?: string,
): ApprovalRequest | null {
  const normalizedToolName = normalizeToolName(toolName);
  if (normalizedToolName !== 'approvalrequest') {
    return null;
  }

  const payload = asRecord(input);
  const title = firstNonEmptyString(payload, ['title', 'message', 'question']) ?? '等待批准';
  const command = normalizeCommand(payload.command ?? payload.argv ?? payload.args);

  return {
    requestId: firstNonEmptyString(payload, ['requestId', 'request_id', 'toolUseId', 'tool_use_id']) ?? toolUseId,
    title,
    description: firstNonEmptyString(payload, ['description', 'reason']),
    command,
    danger: normalizeDangerLevel(firstNonEmptyString(payload, ['danger', 'risk'])),
  };
}

function normalizeCommand(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const command = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  return command.length > 0 ? command : undefined;
}

function normalizeDangerLevel(value?: string): ApprovalRequest['danger'] | undefined {
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value;
  }

  return undefined;
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeToolName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function firstNonEmptyString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}
