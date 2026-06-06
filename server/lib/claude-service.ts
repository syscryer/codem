import { access } from 'node:fs/promises';
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';
import type { InputContentBlock, UserImageAttachment, ClaudeContextSnapshot } from '../../src/types.js';
import {
  normalizeInputContentBlocks,
  stripTransientInputBlockData,
  summarizeInputContentBlocksForTrace,
} from '../../src/lib/input-content-blocks.js';
import { getClaudeProviderSnapshot, getConfiguredModelOptions } from './claude-models.js';
import { parseClaudeApiRetryStatus, parseClaudeRetryStatus, splitClaudeStderrBuffer } from './claude-stderr.js';
import {
  createClaudeContextSnapshot,
  extractClaudeContextMarkdownFromPayload,
} from './claude-context.js';

export type ClaudePermissionMode =
  | 'default'
  | 'plan'
  | 'acceptEdits'
  | 'auto'
  | 'dontAsk'
  | 'bypassPermissions';

export type ClaudeEffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

type StreamInput = {
  threadId: string;
  turnId?: string;
  prompt: string;
  imageAttachments?: ClaudeInputImageAttachment[];
  contentBlocks?: InputContentBlock[];
  workingDirectory: string;
  sessionId?: string;
  permissionMode: ClaudePermissionMode;
  model?: string;
  effort?: ClaudeEffortLevel;
  providerFingerprint?: string;
  toolResult?: {
    requestId: string;
    content: string;
    isError?: boolean;
  };
  requestReceivedAtMs?: number;
  clientSubmitAtMs?: number;
};

type StreamEvent =
  | { type: 'status'; runId: string; message: string }
  | { type: 'session'; runId: string; sessionId: string }
  | { type: 'delta'; runId: string; text: string }
  | { type: 'thinking-delta'; runId: string; text: string }
  | { type: 'trace'; runId: string; name: string; atMs: number; elapsedMs: number; detail?: string }
  | { type: 'phase'; runId: string; phase: ClaudePhase; label: string; thoughtCount?: number }
  | ({ type: 'usage'; runId: string } & ClaudeUsage)
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
  | ({ type: 'done'; runId: string; sessionId?: string; result: string; totalCostUsd?: number; durationMs?: number } & ClaudeUsage)
  | { type: 'error'; runId: string; message: string };

type ClaudePhase = 'requesting' | 'thinking' | 'computing' | 'tool';

type ClaudeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  modelContextWindow?: number;
  usageSource?: 'context' | 'message' | 'result';
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
  kind?: 'permission' | 'plan-exit';
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
    content: ClaudeInputContentBlock[];
  };
};

type ClaudeInputContentBlock =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image';
      source: {
        type: 'base64';
        media_type: string;
        data: string;
      };
    }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

export type ClaudeInputImageAttachment = {
  mimeType: string;
  data: string;
};

type ClaudeJsonLine = {
  type?: string;
  subtype?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  parent_tool_use_id?: string;
  session_id?: string;
  request_id?: string;
  request?: Record<string, unknown>;
  is_error?: boolean;
  result?: string;
  errors?: string[];
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: ClaudeRawUsage;
  context_window?: {
    current_usage?: ClaudeRawUsage;
    context_window_size?: number;
  };
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
      thinking?: string;
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
  parentToolUseId?: string;
  isSidechain?: boolean;
  inputText: string;
  emittedRequestUserInput: boolean;
  emittedApprovalRequest: boolean;
};

type ClaudeContextErrorCode =
  | 'invalid-thread'
  | 'runtime-unavailable'
  | 'runtime-busy'
  | 'context-timeout'
  | 'context-write-failed'
  | 'context-json-parse-failed'
  | 'context-result-error'
  | 'context-empty-response'
  | 'context-runtime-ended';

type ClaudeContextRequestResult =
  | {
      ok: true;
      context: ClaudeContextSnapshot;
    }
  | {
      ok: false;
      code: ClaudeContextErrorCode;
      error: string;
      httpStatus: number;
    };

type ClaudeContextRequest = {
  id: string;
  threadId: string;
  requestedAtMs: number;
  timeoutTimer: ReturnType<typeof setTimeout>;
  eventCount: number;
  assistantTexts: string[];
  stderrLines: string[];
  settled: boolean;
  resolve: (result: ClaudeContextRequestResult) => void;
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
  emittedRequestUserInputKeys: Set<string>;
  emittedApprovalRequestKeys: Set<string>;
  emittedRecoveryHintKeys: Set<string>;
  controlApprovalToolUseIds: Map<string, string | undefined>;
  sidechainTextDeltaParents: Set<string>;
  pausedForUserInput: boolean;
};

type ClaudeRuntime = {
  key: string;
  child: ClaudeChildProcess;
  sessionId?: string;
  workingDirectory: string;
  permissionMode: ClaudePermissionMode;
  model?: string;
  effort?: ClaudeEffortLevel;
  providerFingerprint?: string;
  inputMode: 'argv' | 'stdin';
  reusable: boolean;
  stdoutBuffer: string;
  stderrBuffer: string;
  currentRun: RunState | null;
  contextRequest?: ClaudeContextRequest;
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
const RUN_RECONNECT_BUFFER_MAX_EVENTS = 1000;
const RUN_RECONNECT_BUFFER_TEXT_MAX_CHARS = 16_000;
const RUN_RECONNECT_BUFFER_MESSAGE_MAX_CHARS = 8_000;
const RUN_RECONNECT_BUFFER_TRUNCATION_MARKER = '\n...[已截断]...\n';
const RUNTIME_STREAM_BUFFER_MAX_CHARS = 1_000_000;
const CLAUDE_CONTEXT_REQUEST_TIMEOUT_MS = 12_000;
const CLAUDE_CONTEXT_STDERR_MAX_LINES = 3;
const CLAUDE_CLI_RECOMMENDED_VERSION = '2.1.123';
const CLAUDE_CLI_INSTALL_COMMAND = 'npm install -g @anthropic-ai/claude-code';
const CLAUDE_CLI_UPDATE_COMMAND = 'claude update';
const CLAUDE_CLI_SETUP_URL = 'https://docs.anthropic.com/en/docs/claude-code/setup';
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

export function getClaudeCliVersionInfo() {
  const command = resolveClaudeCommand();
  if (!command) {
    return {
      installed: false,
      supported: false,
      version: null,
      recommendedVersion: CLAUDE_CLI_RECOMMENDED_VERSION,
      command: null,
      updateCommand: CLAUDE_CLI_UPDATE_COMMAND,
      installCommand: CLAUDE_CLI_INSTALL_COMMAND,
      setupUrl: CLAUDE_CLI_SETUP_URL,
      versionError: '未找到 claude 命令',
    };
  }

  const versionResult = spawnSync(resolveClaudeSpawnCommand(command), resolveClaudeSpawnArgs(command, ['--version']), {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });

  const output = `${versionResult.stdout ?? ''}\n${versionResult.stderr ?? ''}`.trim();
  const version = parseClaudeCliVersion(output);

  if (versionResult.status !== 0 || !version) {
    return {
      installed: true,
      supported: false,
      version: null,
      recommendedVersion: CLAUDE_CLI_RECOMMENDED_VERSION,
      command,
      updateCommand: CLAUDE_CLI_UPDATE_COMMAND,
      installCommand: CLAUDE_CLI_INSTALL_COMMAND,
      setupUrl: CLAUDE_CLI_SETUP_URL,
      versionError: output || '读取 Claude CLI 版本失败',
    };
  }

  return {
    installed: true,
    supported: compareSemanticVersions(version, CLAUDE_CLI_RECOMMENDED_VERSION) >= 0,
    version,
    recommendedVersion: CLAUDE_CLI_RECOMMENDED_VERSION,
    command,
    updateCommand: CLAUDE_CLI_UPDATE_COMMAND,
    installCommand: CLAUDE_CLI_INSTALL_COMMAND,
    setupUrl: CLAUDE_CLI_SETUP_URL,
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

export function getThreadRuntimeStatuses() {
  const statuses: Record<string, { threadId: string; pid?: number; alive: boolean; activeRun: boolean }> = {};

  for (const [threadId, runtime] of threadRuntimes.entries()) {
    const alive = isRuntimeProcessAlive(runtime);
    if (!alive) {
      continue;
    }

    statuses[threadId] = {
      threadId,
      pid: runtime.child.pid,
      alive,
      activeRun: Boolean(runtime.currentRun),
    };
  }

  return statuses;
}

export function requestThreadRuntimeContext(
  threadId: string,
  options: { timeoutMs?: number } = {},
): Promise<ClaudeContextRequestResult> {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    return Promise.resolve(createContextRequestError(
      'invalid-thread',
      'threadId 不能为空。',
      400,
    ));
  }

  const runtime = threadRuntimes.get(normalizedThreadId);
  if (!runtime || !isRuntimeProcessAlive(runtime) || runtime.inputMode !== 'stdin') {
    if (runtime) {
      threadRuntimes.delete(normalizedThreadId);
    }
    return Promise.resolve(createContextRequestError(
      'runtime-unavailable',
      '当前线程没有可复用的 Claude stream-json 会话，请先发送一轮消息后再获取上下文。',
      404,
    ));
  }

  if (runtime.currentRun) {
    return Promise.resolve(createContextRequestError(
      'runtime-busy',
      '当前 Claude 会话正在运行中，请等待本轮结束后再获取上下文信息。',
      409,
    ));
  }

  if (runtime.contextRequest) {
    return Promise.resolve(createContextRequestError(
      'runtime-busy',
      '已有上下文信息请求正在进行，请稍后再试。',
      409,
    ));
  }

  return new Promise<ClaudeContextRequestResult>((resolve) => {
    const timeoutMs = normalizeContextTimeout(options.timeoutMs);
    const request: ClaudeContextRequest = {
      id: randomUUID(),
      threadId: normalizedThreadId,
      requestedAtMs: Date.now(),
      timeoutTimer: setTimeout(() => {
        settleRuntimeContextRequest(
          runtime,
          request,
          createContextRequestError(
            'context-timeout',
            'Claude 未在限定时间内返回 /context 结果。',
            504,
          ),
        );
      }, timeoutMs),
      eventCount: 0,
      assistantTexts: [],
      stderrLines: [],
      settled: false,
      resolve,
    };

    runtime.contextRequest = request;
    const payload = `${JSON.stringify(buildClaudeContextRequestMessage(runtime.key))}\n`;
    runtime.child.stdin.write(payload, (error) => {
      if (!error) {
        return;
      }

      settleRuntimeContextRequest(
        runtime,
        request,
        createContextRequestError(
          'context-write-failed',
          `写入 Claude Code /context 请求失败：${error.message}`,
          500,
        ),
      );
    });
  });
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

export function submitRunRequestUserInput(
  runId: string,
  requestId: string,
  questions: RequestUserInputQuestion[],
  answers: Record<string, string>,
) {
  const activeRun = activeRuns.get(runId);
  if (!activeRun || activeRun.state.finished) {
    return {
      submitted: false,
      error: '当前运行不存在或已经结束。',
    };
  }

  if (!requestId.trim()) {
    return {
      submitted: false,
      error: '缺少提问请求 ID。',
    };
  }

  if (activeRun.runtime.inputMode !== 'stdin' || activeRun.runtime.closed) {
    return {
      submitted: false,
      error: '当前 Claude 运行不支持运行中回答，请等待结束后再继续。',
    };
  }

  if (!activeRun.state.pausedForUserInput) {
    return {
      submitted: false,
      error: 'Claude 还没有完成提问，请稍后再提交答案。',
    };
  }

  let controlRequestId: string | undefined;
  for (const [cReqId, toolUseId] of activeRun.state.controlApprovalToolUseIds) {
    if (toolUseId === requestId) {
      controlRequestId = cReqId;
      break;
    }
  }
  const message = controlRequestId
    ? buildAskUserQuestionControlResponse(controlRequestId, requestId, questions, answers)
    : buildClaudeToolResultMessage(requestId, buildRequestUserInputToolResultContent(questions, answers));
  const payload = `${JSON.stringify(message)}\n`;
  console.warn('[codem:human-input] submitRunRequestUserInput.write_begin', {
    runId,
    requestId,
    threadId: activeRun.state.input.threadId,
    inputMode: activeRun.runtime.inputMode,
    runtimeClosed: activeRun.runtime.closed,
    pausedForUserInput: activeRun.state.pausedForUserInput,
    finished: activeRun.state.finished,
    controlRequestId: controlRequestId ?? null,
  });
  activeRun.runtime.child.stdin.write(payload, (error) => {
    if (error) {
      console.warn('[codem:human-input] submitRunRequestUserInput.write_error', {
        runId,
        requestId,
        threadId: activeRun.state.input.threadId,
        error: error.message,
        runtimeClosed: activeRun.runtime.closed,
        childKilled: activeRun.runtime.child.killed,
        childExitCode: activeRun.runtime.child.exitCode,
      });
      const message = `写入 Claude Code 提问答案失败：${error.message}`;
      enqueueRetryableRuntimeError(
        activeRun.state.runId,
        message,
        'process',
        activeRun.state.emittedRecoveryHintKeys,
        (event) => enqueueRunEvent(activeRun.state, event),
      );
      enqueueRunEvent(activeRun.state, {
        type: 'error',
        runId: activeRun.state.runId,
        message,
      });
      finishRuntimeRun(activeRun.runtime, activeRun.state);
      closeClaudeRuntime(activeRun.runtime);
      return;
    }

    activeRun.state.pausedForUserInput = false;
    if (controlRequestId) {
      activeRun.state.controlApprovalToolUseIds.delete(controlRequestId);
    }
    enqueueTrace(activeRun.state, 'stdin_tool_result_written', Date.now(), requestId);
    console.warn('[codem:human-input] submitRunRequestUserInput.write_ok', {
      runId,
      requestId,
      threadId: activeRun.state.input.threadId,
    });
  });

  return {
    submitted: true,
  };
}

export function submitRunGuidePrompt(
  runId: string,
  prompt: string,
  imageAttachments: ClaudeInputImageAttachment[] = [],
  guideContentBlocks: InputContentBlock[] = [],
) {
  const activeRun = activeRuns.get(runId);
  if (!activeRun || activeRun.state.finished) {
    return {
      submitted: false,
      error: '当前运行不存在或已经结束。',
    };
  }

  const trimmedPrompt = prompt.trim();
  if (guideContentBlocks.length === 0 && (trimmedPrompt || imageAttachments.length > 0)) {
    guideContentBlocks = normalizeInputContentBlocks({
      prompt: trimmedPrompt,
      imageAttachments: buildLegacyImageAttachmentsForNormalize(imageAttachments),
    });
  }

  if (!trimmedPrompt && guideContentBlocks.length === 0) {
    return {
      submitted: false,
      error: '缺少有效引导内容。',
    };
  }

  if (activeRun.runtime.inputMode !== 'stdin' || activeRun.runtime.closed) {
    return {
      submitted: false,
      error: '当前 Claude 运行不支持运行中引导，请等待结束后再继续。',
    };
  }

  if (activeRun.state.pausedForUserInput) {
    return {
      submitted: false,
      error: '当前运行正在等待问答或审批，请先处理卡片后再引导。',
    };
  }

  const baseInput = activeRun.state.input;
  const guideInput: StreamInput = {
    threadId: baseInput.threadId,
    turnId: baseInput.turnId,
    prompt: trimmedPrompt,
    contentBlocks: guideContentBlocks,
    workingDirectory: baseInput.workingDirectory,
    sessionId: baseInput.sessionId,
    permissionMode: baseInput.permissionMode,
    model: baseInput.model,
    effort: baseInput.effort,
    clientSubmitAtMs: Date.now(),
  };
  const message = buildClaudeInputMessage(guideInput);
  const traceDetail = summarizeClaudeInputForTrace(guideInput);
  const payload = `${JSON.stringify(message)}\n`;
  activeRun.runtime.child.stdin.write(payload, (error) => {
    if (error) {
      const messageText = `写入 Claude Code 引导消息失败：${error.message}`;
      enqueueRetryableRuntimeError(
        activeRun.state.runId,
        messageText,
        'process',
        activeRun.state.emittedRecoveryHintKeys,
        (event) => enqueueRunEvent(activeRun.state, event),
      );
      enqueueRunEvent(activeRun.state, {
        type: 'error',
        runId: activeRun.state.runId,
        message: messageText,
      });
      finishRuntimeRun(activeRun.runtime, activeRun.state);
      closeClaudeRuntime(activeRun.runtime);
      return;
    }

    enqueueTrace(activeRun.state, 'stdin_guide_prompt_written', Date.now(), traceDetail);
  });

  return {
    submitted: true,
  };
}

export function submitRunApprovalDecision(
  runId: string,
  requestId: string,
  decision: 'approve' | 'reject',
  content: string,
) {
  const activeRun = activeRuns.get(runId);
  if (!activeRun || activeRun.state.finished) {
    return {
      submitted: false,
      error: '当前运行不存在或已经结束。',
    };
  }

  if (!requestId.trim()) {
    return {
      submitted: false,
      error: '缺少批准请求 ID。',
    };
  }

  if (activeRun.runtime.inputMode !== 'stdin' || activeRun.runtime.closed) {
    return {
      submitted: false,
      error: '当前 Claude 运行不支持运行中批准，请等待结束后再继续。',
    };
  }

  writeApprovalDecisionToRuntime(activeRun.runtime, activeRun.state, requestId, decision, content, (error) => {
    if (error) {
      const message = `写入 Claude Code 批准结果失败：${error.message}`;
      enqueueRetryableRuntimeError(
        activeRun.state.runId,
        message,
        'process',
        activeRun.state.emittedRecoveryHintKeys,
        (event) => enqueueRunEvent(activeRun.state, event),
      );
      enqueueRunEvent(activeRun.state, {
        type: 'error',
        runId: activeRun.state.runId,
        message,
      });
      finishRuntimeRun(activeRun.runtime, activeRun.state);
      closeClaudeRuntime(activeRun.runtime);
      return;
    }

    activeRun.state.pausedForUserInput = false;
    enqueueTrace(activeRun.state, 'stdin_approval_result_written', Date.now(), requestId);
  });

  return {
    submitted: true,
  };
}

function writeApprovalDecisionToRuntime(
  runtime: ClaudeRuntime,
  state: RunState,
  requestId: string,
  decision: 'approve' | 'reject',
  content: string,
  callback: (error?: Error | null) => void,
) {
  const controlToolUseId = state.controlApprovalToolUseIds.get(requestId);
  const message = state.controlApprovalToolUseIds.has(requestId)
    ? buildClaudeControlResponseMessage(requestId, decision, controlToolUseId)
    : buildClaudeToolResultMessage(requestId, content, decision === 'reject');
  const payload = `${JSON.stringify(message)}\n`;

  runtime.child.stdin.write(payload, (error) => {
    if (!error) {
      state.controlApprovalToolUseIds.delete(requestId);
    }
    callback(error);
  });
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

  if (!isRuntimeProcessAlive(activeRun.runtime)) {
    activeRuns.delete(runId);
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
    userContentBlocks: summarizeClaudeInputForHistory(state.input),
    workingDirectory: state.input.workingDirectory,
    sessionId: state.sessionId,
    permissionMode: state.input.permissionMode,
    model: state.input.model,
    effort: state.input.effort,
    startedAtMs: state.traceStartedAtMs,
    eventCount: state.eventLog.length,
    finished: state.finished,
  };
}

export async function* reconnectClaudeRunEvents(
  runId: string,
  afterEventIndex = 0,
  options?: { signal?: AbortSignal },
): AsyncGenerator<StreamEvent> {
  const activeRun = activeRuns.get(runId);
  if (!activeRun) {
    return;
  }

  const { state } = activeRun;
  let index = Math.max(0, Math.floor(afterEventIndex));

  while (!options?.signal?.aborted) {
    while (index < state.eventLog.length) {
      yield state.eventLog[index];
      index += 1;
    }

    if (state.finished || options?.signal?.aborted) {
      return;
    }

    await waitForRunEvent(state, options?.signal);
  }
}

export async function* createClaudeStream(input: StreamInput): AsyncGenerator<StreamEvent> {
  const runId = randomUUID();
  const streamStartedAtMs = Date.now();
  const command = resolveClaudeCommand();
  const commandResolvedAtMs = Date.now();
  const providerSnapshot = getClaudeProviderSnapshot();
  const runtimeInput = {
    ...input,
    providerFingerprint: providerSnapshot.fingerprint,
  };
  const runtimeKey = getRuntimeKey(runtimeInput);

  if (!command) {
    yield {
      type: 'error',
      runId,
      message: '未找到 claude 命令，请先确认 Claude Code 已安装并在 PATH 中可见。',
    };
    return;
  }

  const spawnStartedAtMs = Date.now();
  const { runtime, reused } = getOrCreateClaudeRuntime(command, runtimeInput);
  const spawnReturnedAtMs = Date.now();

  if (runtime.currentRun || runtime.contextRequest) {
    yield {
      type: 'error',
      runId,
      message: runtime.contextRequest
        ? '当前会话正在获取上下文信息，请稍后再发送。'
        : '当前会话仍有运行中的 Claude 请求，请等待结束或停止后再发送。',
    };
    return;
  }

  const state = createRunState(runId, runtimeInput, runtime.sessionId ?? runtimeInput.sessionId?.trim());
  runtime.currentRun = state;
  activeRuns.set(runId, {
    runtime,
    state,
    cancel: () => cancelRuntimeRun(runtime, runId),
  });
  threadActiveRuns.set(getRuntimeKey(runtimeInput), runId);

  if (input.clientSubmitAtMs) {
    enqueueTrace(state, 'client_submit', input.clientSubmitAtMs);
  }
  if (input.requestReceivedAtMs) {
    enqueueTrace(state, 'server_request_received', input.requestReceivedAtMs);
  }
  enqueueTrace(state, 'create_stream_started', streamStartedAtMs);
  enqueueTrace(state, 'claude_command_resolved', commandResolvedAtMs, command);
  enqueueTrace(state, 'claude_provider_fingerprint', commandResolvedAtMs, providerSnapshot.fingerprint);
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

  writePromptToClaude(runtime, state, runtimeInput);

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
    emittedRequestUserInputKeys: new Set(),
    emittedApprovalRequestKeys: new Set(),
    emittedRecoveryHintKeys: new Set(),
    controlApprovalToolUseIds: new Map(),
    sidechainTextDeltaParents: new Set(),
    pausedForUserInput: false,
  };
}

function buildClaudeContextRequestMessage(_threadId: string): ClaudeInputMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: '/context',
        },
      ],
    },
  };
}

function normalizeContextTimeout(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return CLAUDE_CONTEXT_REQUEST_TIMEOUT_MS;
  }

  return Math.min(60_000, Math.max(1_000, Math.floor(value)));
}

function createContextRequestError(
  code: ClaudeContextErrorCode,
  error: string,
  httpStatus: number,
): Extract<ClaudeContextRequestResult, { ok: false }> {
  return {
    ok: false,
    code,
    error,
    httpStatus,
  };
}

function settleRuntimeContextRequest(
  runtime: ClaudeRuntime,
  request: ClaudeContextRequest,
  result: ClaudeContextRequestResult,
) {
  if (request.settled || runtime.contextRequest !== request) {
    return;
  }

  request.settled = true;
  clearTimeout(request.timeoutTimer);
  runtime.contextRequest = undefined;
  request.resolve(result);
}

function failRuntimeContextRequest(
  runtime: ClaudeRuntime,
  code: ClaudeContextErrorCode,
  error: string,
  httpStatus: number,
) {
  const request = runtime.contextRequest;
  if (!request) {
    return;
  }

  settleRuntimeContextRequest(runtime, request, createContextRequestError(code, error, httpStatus));
}

function handleRuntimeContextStdoutLine(
  runtime: ClaudeRuntime,
  request: ClaudeContextRequest,
  line: string,
) {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let payload: ClaudeJsonLine;
  try {
    payload = JSON.parse(trimmed) as ClaudeJsonLine;
  } catch (error) {
    settleRuntimeContextRequest(
      runtime,
      request,
      createContextRequestError(
        'context-json-parse-failed',
        `Claude /context 返回了无法解析的 stream-json 行：${error instanceof Error ? error.message : 'JSON 解析失败'}`,
        502,
      ),
    );
    return;
  }

  request.eventCount += 1;

  const resultErrorMessage = getResultErrorMessage(payload);
  if (payload.session_id && !resultErrorMessage) {
    runtime.sessionId = payload.session_id;
  }

  const markdown = extractClaudeContextMarkdownFromPayload(payload);
  if (payload.type === 'assistant' && markdown.trim()) {
    request.assistantTexts.push(markdown);
  }

  if (payload.type !== 'result') {
    return;
  }

  if (resultErrorMessage) {
    settleRuntimeContextRequest(
      runtime,
      request,
      createContextRequestError(
        'context-result-error',
        resultErrorMessage,
        502,
      ),
    );
    return;
  }

  const resultMarkdown = markdown.trim() ? markdown : request.assistantTexts.at(-1) ?? '';
  if (!resultMarkdown.trim()) {
    settleRuntimeContextRequest(
      runtime,
      request,
      createContextRequestError(
        'context-empty-response',
        'Claude 已返回 /context 结果事件，但没有可展示的 Markdown 内容。',
        502,
      ),
    );
    return;
  }

  settleRuntimeContextRequest(runtime, request, {
    ok: true,
    context: createClaudeContextSnapshot(resultMarkdown, {
      requestedAtMs: request.requestedAtMs,
      durationMs: Math.max(0, Date.now() - request.requestedAtMs),
      eventCount: request.eventCount,
    }),
  });
}

function appendRuntimeContextStderrLine(runtime: ClaudeRuntime, line: string) {
  const request = runtime.contextRequest;
  const trimmed = line.trim();
  if (!request || !trimmed) {
    return false;
  }

  request.stderrLines.push(trimmed.slice(0, 1_000));
  if (request.stderrLines.length > CLAUDE_CONTEXT_STDERR_MAX_LINES) {
    request.stderrLines.splice(0, request.stderrLines.length - CLAUDE_CONTEXT_STDERR_MAX_LINES);
  }
  return true;
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
  pushReconnectBufferedEvent(state.eventLog, event);
  state.queue.push(event);
  state.wakeQueue?.();
  state.wakeQueue = null;
  for (const wake of state.eventWaiters) {
    wake();
  }
  state.eventWaiters.clear();
}

export function pushReconnectBufferedEvent(
  eventLog: StreamEvent[],
  event: StreamEvent,
  maxEvents = RUN_RECONNECT_BUFFER_MAX_EVENTS,
) {
  const bufferedEvent = createBufferedRunEventForReconnect(event);
  if (!bufferedEvent) {
    return;
  }

  const normalizedMaxEvents = Math.max(0, Math.floor(maxEvents));
  if (normalizedMaxEvents === 0) {
    eventLog.length = 0;
    return;
  }

  eventLog.push(bufferedEvent);
  const overflow = eventLog.length - normalizedMaxEvents;
  if (overflow > 0) {
    eventLog.splice(0, overflow);
  }
}

function createBufferedRunEventForReconnect(event: StreamEvent) {
  if (
    event.type === 'trace' ||
    event.type === 'claude-event' ||
    event.type === 'assistant-snapshot' ||
    event.type === 'raw'
  ) {
    return null;
  }

  switch (event.type) {
    case 'delta':
    case 'thinking-delta':
    case 'tool-input-delta':
    case 'subagent-delta':
    case 'stderr':
      return {
        ...event,
        text: truncateBufferedRunText(event.text, RUN_RECONNECT_BUFFER_TEXT_MAX_CHARS),
      };
    case 'tool-result':
      return {
        ...event,
        content: truncateBufferedRunText(event.content, RUN_RECONNECT_BUFFER_TEXT_MAX_CHARS),
      };
    case 'status':
    case 'error':
      return {
        ...event,
        message: truncateBufferedRunText(event.message, RUN_RECONNECT_BUFFER_MESSAGE_MAX_CHARS),
      };
    default:
      return event;
  }
}

function truncateBufferedRunText(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return text;
  }

  const markerLength = RUN_RECONNECT_BUFFER_TRUNCATION_MARKER.length;
  if (maxChars <= markerLength + 32) {
    return `${RUN_RECONNECT_BUFFER_TRUNCATION_MARKER.trim()}${text.slice(-(maxChars - markerLength))}`;
  }

  const headLength = Math.floor((maxChars - markerLength) * 0.5);
  const tailLength = Math.max(0, maxChars - markerLength - headLength);
  return `${text.slice(0, headLength)}${RUN_RECONNECT_BUFFER_TRUNCATION_MARKER}${text.slice(-tailLength)}`;
}

export function appendBoundedRuntimeBuffer(
  buffer: string,
  chunk: string,
  maxChars = RUNTIME_STREAM_BUFFER_MAX_CHARS,
) {
  const next = `${buffer}${chunk}`;
  if (next.length <= maxChars) {
    return next;
  }

  const marker = RUN_RECONNECT_BUFFER_TRUNCATION_MARKER.trim();
  if (maxChars <= marker.length) {
    return next.slice(-maxChars);
  }

  return `${marker}${next.slice(-(maxChars - marker.length))}`;
}

function waitForRunEvent(state: RunState, signal?: AbortSignal) {
  if (signal?.aborted) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    const cleanup = () => {
      state.eventWaiters.delete(wake);
      signal?.removeEventListener('abort', abort);
    };
    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve();
    };
    const wake = () => finish();
    const abort = () => finish();

    state.eventWaiters.add(wake);
    signal?.addEventListener('abort', abort, { once: true });
  });
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

function pauseRuntimeRunForHumanInput(
  runtime: ClaudeRuntime,
  state: RunState,
  traceName: string,
  options?: { closeRuntime?: boolean },
) {
  if (state.finished || state.pausedForUserInput) {
    return;
  }

  state.pausedForUserInput = true;
  enqueueTrace(state, traceName, Date.now());

  if (options?.closeRuntime && runtime.inputMode !== 'stdin') {
    state.seenDoneEvent = true;
    enqueueRunEvent(state, {
      type: 'done',
      runId: state.runId,
      sessionId: state.sessionId,
      result: state.finalResult,
    });
    finishRuntimeRun(runtime, state);

    runtime.closed = true;
    threadRuntimes.delete(runtime.key);
    runtime.child.kill();
  }
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
    if (existing.currentRun || existing.contextRequest) {
      return { runtime: existing, reused: false };
    }

    if (isRuntimeCompatible(existing, input)) {
      return { runtime: existing, reused: true };
    }

    closeClaudeRuntime(existing);
  }

  const runtime = spawnClaudeRuntime(command, input, 'stdin');
  threadRuntimes.set(key, runtime);
  return { runtime, reused: false };
}

function isRuntimeCompatible(runtime: ClaudeRuntime, input: StreamInput) {
  const requestedSessionId = input.sessionId?.trim();

  return (
    isRuntimeProcessAlive(runtime) &&
    !runtime.closed &&
    runtime.reusable &&
    runtime.inputMode === 'stdin' &&
    runtime.workingDirectory === input.workingDirectory &&
    runtime.permissionMode === input.permissionMode &&
    runtime.model === input.model &&
    runtime.effort === input.effort &&
    runtime.providerFingerprint === input.providerFingerprint &&
    (!requestedSessionId || !runtime.sessionId || runtime.sessionId === requestedSessionId)
  );
}

function buildRequestUserInputToolResultContent(
  questions: RequestUserInputQuestion[],
  answers: Record<string, string>,
) {
  return JSON.stringify({
    questions,
    answers: buildRequestUserInputResponseAnswers(questions, answers),
  });
}

function buildRequestUserInputResponseAnswers(
  questions: RequestUserInputQuestion[],
  answers: Record<string, string>,
) {
  const responseAnswers: Record<string, string> = {};

  questions.forEach((question, index) => {
    const key = question.id ?? `question-${index}`;
    const answer = answers[key]?.trim();
    if (!answer) {
      return;
    }

    const normalizedAnswer = normalizeRequestUserInputAnswerValue(question, answer);
    responseAnswers[key] = normalizedAnswer;
    responseAnswers[question.question] = normalizedAnswer;
  });

  return responseAnswers;
}

function normalizeRequestUserInputAnswerValue(
  question: RequestUserInputQuestion,
  answer: string,
) {
  if (!question.options?.length) {
    return answer;
  }

  const optionLabels = new Set(question.options.map((option) => option.label));
  const parts = answer
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean);
  const selectedLabels = parts.filter((part) => optionLabels.has(part));
  const freeText = parts.filter((part) => !optionLabels.has(part)).join('\n').trim();

  if (question.isOther && freeText) {
    return freeText;
  }

  if (question.multiSelect) {
    return selectedLabels.join(', ');
  }

  if (selectedLabels[0]) {
    return selectedLabels[0];
  }

  return freeText || answer;
}

function isRuntimeProcessAlive(runtime: ClaudeRuntime) {
  return !runtime.closed && runtime.child.exitCode === null && runtime.child.signalCode === null && !runtime.child.killed;
}

function spawnClaudeRuntime(command: string, input: StreamInput, inputMode: ClaudeRuntime['inputMode']): ClaudeRuntime {
  const resumeSessionId = input.sessionId?.trim();
  const args = inputMode === 'stdin' ? ['-p', '', '--input-format', 'stream-json'] : ['-p', input.prompt];

  args.push(
    '--verbose',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--permission-prompt-tool',
    'stdio',
  );

  if (input.permissionMode === 'bypassPermissions') {
    args.push('--dangerously-skip-permissions');
  } else {
    args.push('--permission-mode', input.permissionMode);
  }

  if (input.model) {
    args.push('--model', input.model);
  }

  if (input.effort) {
    args.push('--effort', input.effort);
  }

  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  }

  const child = spawn(resolveClaudeSpawnCommand(command), resolveClaudeSpawnArgs(command, args), {
    cwd: input.workingDirectory,
    env: process.env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });

  const runtime: ClaudeRuntime = {
    key: getRuntimeKey(input),
    child,
    sessionId: resumeSessionId,
    workingDirectory: input.workingDirectory,
    permissionMode: input.permissionMode,
    model: input.model,
    effort: input.effort,
    providerFingerprint: input.providerFingerprint,
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

function resolveClaudeSpawnCommand(command: string) {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(command) ? 'cmd.exe' : command;
}

function resolveClaudeSpawnArgs(command: string, args: string[]) {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
    ? ['/d', '/s', '/c', command, ...args]
    : args;
}

function bindClaudeRuntime(runtime: ClaudeRuntime) {
  runtime.child.stdout.on('data', (chunk: Buffer | string) => {
    const stdoutBuffer = `${runtime.stdoutBuffer}${chunk.toString()}`;
    const lines = stdoutBuffer.split(/\r?\n/);
    runtime.stdoutBuffer = appendBoundedRuntimeBuffer('', lines.pop() ?? '');

    for (const line of lines) {
      flushRuntimeStdoutLine(runtime, line);
    }
  });

  runtime.child.stderr.on('data', (chunk: Buffer | string) => {
    const stderrBuffer = `${runtime.stderrBuffer}${chunk.toString()}`;
    const { lines, rest } = splitClaudeStderrBuffer(stderrBuffer);
    runtime.stderrBuffer = appendBoundedRuntimeBuffer('', rest);

    for (const line of lines) {
      flushRuntimeStderrLine(runtime, line);
    }

    if (parseClaudeRetryStatus(runtime.stderrBuffer)) {
      flushRuntimeStderrLine(runtime, runtime.stderrBuffer);
      runtime.stderrBuffer = '';
    }
  });

  runtime.child.stdin.on('error', (error) => {
    if (runtime.contextRequest) {
      failRuntimeContextRequest(
        runtime,
        'context-write-failed',
        `写入 Claude Code /context 请求失败：${error.message}`,
        500,
      );
      return;
    }

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
    if (runtime.contextRequest) {
      failRuntimeContextRequest(
        runtime,
        'context-runtime-ended',
        `Claude 运行时异常，/context 请求未完成：${error.message}`,
        500,
      );
    }

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

    if (runtime.contextRequest) {
      const stderrTail = runtime.contextRequest.stderrLines.length
        ? ` stderr: ${runtime.contextRequest.stderrLines.join('\n')}`
        : '';
      failRuntimeContextRequest(
        runtime,
        'context-runtime-ended',
        `Claude 运行时已结束，/context 请求未完成。code=${code ?? 'null'} signal=${signal ?? 'null'}${stderrTail}`,
        502,
      );
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
  if (runtime.contextRequest) {
    handleRuntimeContextStdoutLine(runtime, runtime.contextRequest, line);
    return;
  }

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
  const isSidechain = Boolean(payload.isSidechain);
  const parentToolUseId = payload.parent_tool_use_id;

  if (payload.type === 'control_request') {
    const requestUserInput = parseControlRequestUserInputEvent(payload);
    if (requestUserInput) {
      if (typeof payload.request_id === 'string' && payload.request_id.trim()) {
        state.controlApprovalToolUseIds.set(payload.request_id.trim(), getControlRequestToolUseId(payload));
      }
      if (emitRequestUserInputEvent(state, runId, requestUserInput, enqueue)) {
        pauseRuntimeRunForHumanInput(runtime, state, 'paused_for_user_input');
      }
      return;
    }

    const approvalRequest = parseControlApprovalRequestEvent(payload);
    if (approvalRequest) {
      if (approvalRequest.requestId) {
        state.controlApprovalToolUseIds.set(approvalRequest.requestId, getControlRequestToolUseId(payload));
      }
      if (emitOrAutoApproveApprovalRequestEvent(runtime, state, runId, approvalRequest, enqueue) === 'approval-request') {
        pauseRuntimeRunForHumanInput(runtime, state, 'paused_for_approval_request');
      }
      return;
    }
  }

  if (payload.type === 'system' && !isSidechain) {
    enqueue({
      type: 'claude-event',
      runId,
      label: describeSystemEvent(payload),
      eventType: payload.type,
      subtype: payload.subtype,
      raw: payload,
    });
  }

  if (payload.type === 'system' && payload.subtype === 'api_retry' && !isSidechain) {
    const retryStatus = parseClaudeApiRetryStatus(payload);
    if (retryStatus) {
      enqueue({
        type: 'phase',
        runId,
        phase: 'requesting',
        label: retryStatus.message,
      });
    }
  }

  if (payload.type === 'system' && payload.subtype === 'status' && !isSidechain) {
    if (payload.status === 'requesting') {
      enqueue({
        type: 'phase',
        runId,
        phase: 'requesting',
        label: '等待 Claude 响应',
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

  if (payload.type !== 'result' && !isSidechain) {
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
      if (!isSidechain) {
        enqueue({
          type: 'phase',
          runId,
          phase: 'thinking',
          label: '思考中',
          thoughtCount: state.thoughtCount,
        });
      }
    }

    if (block?.type === 'tool_use' && block.name) {
      if (typeof payload.event.index === 'number') {
        state.toolInputByIndex.set(payload.event.index, {
          name: block.name,
          toolUseId: block.id,
          parentToolUseId,
          isSidechain,
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
        if (emitRequestUserInputEvent(state, runId, requestUserInput, enqueue)) {
          pauseRuntimeRunForHumanInput(runtime, state, 'paused_for_user_input', { closeRuntime: true });
        }
        return;
      }

      const approvalRequest = parseRuntimeApprovalRequestEvent(block.name, block.input, block.id);
      if (approvalRequest) {
        const accumulator =
          typeof payload.event.index === 'number' ? state.toolInputByIndex.get(payload.event.index) : undefined;
        if (accumulator) {
          accumulator.emittedApprovalRequest = true;
        }
        if (emitOrAutoApproveApprovalRequestEvent(runtime, state, runId, approvalRequest, enqueue) === 'approval-request') {
          pauseRuntimeRunForHumanInput(runtime, state, 'paused_for_approval_request');
        }
        return;
      }

      if (!isSidechain) {
        enqueue({
          type: 'phase',
          runId,
          phase: 'tool',
          label: '执行工具中',
        });
      }
      enqueue({
        type: 'tool-start',
        runId,
        blockIndex: payload.event.index ?? -1,
        toolUseId: block.id,
        parentToolUseId,
        isSidechain,
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

    if (isSidechain) {
      if (parentToolUseId) {
        state.sidechainTextDeltaParents.add(parentToolUseId);
      }
      enqueue({
        type: 'subagent-delta',
        runId,
        parentToolUseId,
        text: payload.event.delta.text,
      });
    } else {
      enqueueTextDelta(state, payload.event.delta.text);
      enqueue({
        type: 'phase',
        runId,
        phase: 'computing',
        label: '生成回复中',
      });
    }
  }

  if (
    payload.type === 'stream_event' &&
    payload.event?.type === 'content_block_delta' &&
    payload.event.delta?.type === 'thinking_delta'
  ) {
    const thinkingText = payload.event.delta.thinking ?? payload.event.delta.text ?? '';
    if (thinkingText && !isSidechain) {
      enqueue({
        type: 'thinking-delta',
        runId,
        text: thinkingText,
      });
    }
    if (!isSidechain) {
      enqueue({
        type: 'phase',
        runId,
        phase: 'thinking',
        label: '思考中',
        thoughtCount: state.thoughtCount || undefined,
      });
    }
  }

  if (
    payload.type === 'stream_event' &&
    payload.event?.type === 'content_block_delta' &&
    payload.event.delta?.type === 'input_json_delta' &&
    payload.event.delta.partial_json
  ) {
    const accumulator =
      typeof payload.event.index === 'number' ? state.toolInputByIndex.get(payload.event.index) : undefined;
    if (typeof payload.event.index === 'number') {
      if (accumulator) {
        if (accumulator.emittedRequestUserInput || accumulator.emittedApprovalRequest) {
          return;
        }

        accumulator.inputText += payload.event.delta.partial_json;
        const emittedHumanInput = emitStructuredToolEventsFromAccumulator(runtime, state, runId, accumulator, enqueue);
        if (emittedHumanInput === 'request-user-input') {
          pauseRuntimeRunForHumanInput(runtime, state, 'paused_for_user_input', { closeRuntime: true });
          return;
        }
        if (emittedHumanInput === 'approval-request') {
          pauseRuntimeRunForHumanInput(runtime, state, 'paused_for_approval_request');
          return;
        }
      }
    }

    enqueue({
      type: 'tool-input-delta',
      runId,
      blockIndex: payload.event.index ?? -1,
      toolUseId: accumulator?.toolUseId,
      parentToolUseId,
      isSidechain,
      text: payload.event.delta.partial_json,
    });
    if (!isSidechain) {
      enqueue({
        type: 'phase',
        runId,
        phase: 'tool',
        label: '执行工具中',
      });
    }
  }

  if (payload.type === 'stream_event' && payload.event?.type === 'content_block_stop') {
    const currentBlockType =
      typeof payload.event.index === 'number' ? state.blockTypeByIndex.get(payload.event.index) : undefined;
    const accumulator =
      typeof payload.event.index === 'number' ? state.toolInputByIndex.get(payload.event.index) : undefined;
    if (typeof payload.event.index === 'number') {
      state.blockTypeByIndex.delete(payload.event.index);
      if (accumulator) {
        const emittedHumanInput =
          accumulator.emittedRequestUserInput || accumulator.emittedApprovalRequest
            ? null
            : emitStructuredToolEventsFromAccumulator(runtime, state, runId, accumulator, enqueue);
        state.toolInputByIndex.delete(payload.event.index);
        if (emittedHumanInput === 'request-user-input') {
          pauseRuntimeRunForHumanInput(runtime, state, 'paused_for_user_input', { closeRuntime: true });
          return;
        }
        if (emittedHumanInput === 'approval-request') {
          pauseRuntimeRunForHumanInput(runtime, state, 'paused_for_approval_request');
          return;
        }
        if (accumulator.emittedRequestUserInput || accumulator.emittedApprovalRequest) {
          return;
        }
      }
    }

    if (currentBlockType === 'tool_use') {
      enqueue({
        type: 'tool-stop',
        runId,
        blockIndex: payload.event.index ?? -1,
        toolUseId: accumulator?.toolUseId,
        parentToolUseId,
        isSidechain,
      });
    }
  }

  if (payload.type === 'assistant' && isNoResponseRequestedAssistant(payload)) {
    return;
  }

  if (payload.type === 'assistant' && Array.isArray(payload.message?.content)) {
    if (!isSidechain) {
      enqueue({
        type: 'assistant-snapshot',
        runId,
        blocks: payload.message.content,
      });
    }

    for (const block of payload.message.content) {
      if (block.type !== 'tool_use' || !block.name) {
        continue;
      }

      const requestUserInput = parseRequestUserInputEvent(block.name, block.input, block.id);
      if (requestUserInput) {
        if (emitRequestUserInputEvent(state, runId, requestUserInput, enqueue)) {
          pauseRuntimeRunForHumanInput(runtime, state, 'paused_for_user_input', { closeRuntime: true });
        }
        return;
      }

      const approvalRequest = parseRuntimeApprovalRequestEvent(block.name, block.input, block.id);
      if (approvalRequest) {
        if (emitOrAutoApproveApprovalRequestEvent(runtime, state, runId, approvalRequest, enqueue) === 'approval-request') {
          pauseRuntimeRunForHumanInput(runtime, state, 'paused_for_approval_request');
        }
        return;
      }
    }

    const assistantText = payload.message.content
      .filter((item) => item.type === 'text' && item.text)
      .map((item) => item.text ?? '')
      .join('');

    if (assistantText) {
      if (isSidechain) {
        if (parentToolUseId && !state.sidechainTextDeltaParents.has(parentToolUseId)) {
          enqueue({
            type: 'subagent-delta',
            runId,
            parentToolUseId,
            text: assistantText,
          });
        }
      } else {
        state.finalResult = assistantText;
      }
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

      const content = stringifyClaudeContent(block.content);
      if (isInternalHumanInputToolResult(state, block, content)) {
        enqueueTrace(state, 'internal_human_input_tool_result_skipped', Date.now(), block.tool_use_id);
        continue;
      }

      enqueue({
        type: 'tool-result',
        runId,
        toolUseId: block.tool_use_id,
        parentToolUseId,
        isSidechain,
        content,
        isError: block.is_error,
      });

      if (block.is_error && isHumanApprovalToolResultContent(content)) {
        pauseRuntimeRunForHumanInput(runtime, state, 'paused_for_approval_result', { closeRuntime: true });
        return;
      }
    }
  }

  if (payload.type === 'result' && !isSidechain) {
    const usage = normalizeUsage(payload.usage, 'result');
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
  if (appendRuntimeContextStderrLine(runtime, line)) {
    return;
  }

  const state = runtime.currentRun;
  const trimmed = line.trim();
  if (!state || !trimmed) {
    return;
  }

  const retryStatus = parseClaudeRetryStatus(trimmed);
  if (retryStatus) {
    enqueueRunEvent(state, {
      type: 'phase',
      runId: state.runId,
      phase: 'requesting',
      label: retryStatus.message,
    });
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
  if (runtime.contextRequest) {
    failRuntimeContextRequest(
      runtime,
      'context-runtime-ended',
      'Claude 会话已关闭，/context 请求未完成。',
      500,
    );
  }
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
  const contextUsage = normalizeUsage(payload.context_window?.current_usage, 'context');
  if (contextUsage && typeof payload.context_window?.context_window_size === 'number') {
    contextUsage.modelContextWindow = payload.context_window.context_window_size;
  }

  return (
    contextUsage ??
    normalizeUsage(payload.event?.usage, 'message') ??
    normalizeUsage(payload.event?.message?.usage, 'message') ??
    normalizeUsage(payload.message?.usage, 'message')
  );
}

function normalizeUsage(usage?: ClaudeRawUsage, usageSource?: ClaudeUsage['usageSource']) {
  if (!usage) {
    return undefined;
  }

  const next: ClaudeUsage = {};
  if (usageSource) {
    next.usageSource = usageSource;
  }
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

  return next.inputTokens !== undefined ||
    next.outputTokens !== undefined ||
    next.cacheCreationInputTokens !== undefined ||
    next.cacheReadInputTokens !== undefined
    ? next
    : undefined;
}

function resolveClaudeCommand() {
  if (cachedClaudeCommand !== undefined) {
    return cachedClaudeCommand;
  }

  const lookupInvocation = buildClaudeCommandLookupInvocation();
  const lookup = spawnSync(lookupInvocation.command, lookupInvocation.args, {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (lookup.status !== 0) {
    cachedClaudeCommand = null;
    return null;
  }

  const candidates = lookup.stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  cachedClaudeCommand = selectSpawnableClaudeCommand(candidates);

  return cachedClaudeCommand;
}

export function buildClaudeCommandLookupInvocation(platform: NodeJS.Platform | string = process.platform) {
  if (platform !== 'win32') {
    return {
      command: 'which',
      args: ['claude'],
    };
  }

  const script = [
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    "Get-Command claude -CommandType Application,ExternalScript -All -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Source) { $_.Source } elseif ($_.Path) { $_.Path } }",
  ].join('; ');

  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
  };
}

function parseClaudeCliVersion(output: string) {
  const trimmed = output.trim();
  if (!trimmed) {
    return '';
  }

  const match = trimmed.match(/\b(\d+\.\d+\.\d+)\b/);
  return match?.[1] ?? '';
}

function compareSemanticVersions(left: string, right: string) {
  const leftParts = left.split('.').map((part) => Number(part));
  const rightParts = right.split('.').map((part) => Number(part));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

function selectSpawnableClaudeCommand(candidates: string[]) {
  if (candidates.length === 0) {
    return null;
  }

  if (process.platform !== 'win32') {
    return candidates[0] ?? null;
  }

  const spawnableExtensions = new Set(['.exe', '.cmd', '.bat', '.com']);
  const preferredCandidate = candidates.find((candidate) =>
    spawnableExtensions.has(candidate.slice(candidate.lastIndexOf('.')).toLowerCase()),
  );

  return preferredCandidate ?? candidates[0] ?? null;
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

export function buildClaudeInputMessage(input: StreamInput): ClaudeInputMessage {
  if (input.toolResult?.requestId) {
    return buildClaudeToolResultMessage(
      input.toolResult.requestId,
      input.toolResult.content,
      input.toolResult.isError,
    );
  }

  const content = normalizeStreamInputContentBlocks(input).flatMap((block) =>
    buildClaudeContentBlocksFromInputBlock(block),
  );

  return {
    type: 'user',
    message: {
      role: 'user',
      content,
    },
  };
}

export function summarizeClaudeInputForTrace(
  input: Pick<StreamInput, 'prompt' | 'imageAttachments' | 'contentBlocks'>,
) {
  return summarizeInputContentBlocksForTrace(normalizeStreamInputContentBlocks(input));
}

export function summarizeClaudeInputForHistory(
  input: Pick<StreamInput, 'prompt' | 'imageAttachments' | 'contentBlocks'>,
) {
  return stripTransientInputBlockData(normalizeStreamInputContentBlocks(input)) ?? [];
}

function normalizeStreamInputContentBlocks(
  input: Pick<StreamInput, 'prompt' | 'imageAttachments' | 'contentBlocks'>,
) {
  const normalizedContentBlocks = normalizeInputContentBlocks({
    contentBlocks: input.contentBlocks,
  });
  const legacyNormalizedBlocks = normalizeInputContentBlocks({
    prompt: input.prompt,
    imageAttachments: buildLegacyImageAttachmentsForNormalize(input.imageAttachments),
  });

  if (!input.contentBlocks?.length) {
    return legacyNormalizedBlocks;
  }

  if (normalizedContentBlocks.length === 0) {
    return legacyNormalizedBlocks;
  }

  if (normalizedContentBlocks.length < input.contentBlocks.length && legacyNormalizedBlocks.length > 0) {
    return [...normalizedContentBlocks, ...legacyNormalizedBlocks];
  }

  return normalizedContentBlocks;
}

function buildLegacyImageAttachmentsForNormalize(
  imageAttachments: ClaudeInputImageAttachment[] | undefined,
): UserImageAttachment[] {
  return (imageAttachments ?? []).map((attachment, index) => ({
    id: `runtime-image-${index}`,
    path: '',
    name: '',
    mimeType: attachment.mimeType,
    data: attachment.data,
  }));
}

function buildClaudeContentBlocksFromInputBlock(block: InputContentBlock): ClaudeInputContentBlock[] {
  switch (block.type) {
    case 'text':
      return [
        {
          type: 'text',
          text: block.text,
        },
      ];
    case 'image': {
      // 多模态模型用 base64 image block 直接“看”图；非多模态模型看不懂 image block，
      // 因此只要图片落了本地路径，就额外补一条路径兜底文本，让它知道有图片并能用 ViewImage 打开。
      if (block.data && block.mimeType) {
        const imageBlock: ClaudeInputContentBlock = {
          type: 'image',
          source: {
            type: 'base64',
            media_type: block.mimeType,
            data: block.data,
          },
        };
        const fallbackText = buildInputImagePathFallbackText(block);
        return fallbackText ? [imageBlock, { type: 'text', text: fallbackText }] : [imageBlock];
      }
      return [
        {
          type: 'text',
          text: buildInputImageReferenceText(block),
        },
      ];
    }
    case 'file_text':
      return [
        {
          type: 'text',
          text: buildInputFileTextBlockText(block),
        },
      ];
    case 'file_reference':
      return [
        {
          type: 'text',
          text: buildInputFileReferenceText(block),
        },
      ];
    case 'attachment_metadata':
      return [
        {
          type: 'text',
          text: buildInputAttachmentMetadataText(block),
        },
      ];
    default:
      return [];
  }
}

// Windows 反斜杠路径出现在发给模型的纯文本里时，\U、\D、\n 等会被模型当作转义序列，
// 导致路径被理解 / 复述错乱（实测 C:\Users\...\Downloads\x.zip 会被还原成错误路径）。
// 统一改成正斜杠：Claude Code 在 Windows 的 Read / Bash 等工具同样接受 /，无歧义。
function toModelReadablePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

// base64 image block 已发送给多模态模型时使用的兜底文本：仅在有本地路径时补充，
// 措辞先说明图片已作为附件提供，再把 ViewImage + 路径作为兜底，避免诱导用 Read/Grep 读图。
function buildInputImagePathFallbackText(
  block: Extract<InputContentBlock, { type: 'image' }>,
) {
  if (!block.path) {
    return '';
  }

  return [
    '（以下为图片附件信息，多模态模型可直接查看上面的图片，无需读取文件）',
    block.name ? `名称：${block.name}` : '',
    `路径：${toModelReadablePath(block.path)}`,
    '如果你无法直接识别上面的图片，请使用 ViewImage 查看该路径，不要用 Read 或 Grep 读取图片内容。',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildInputImageReferenceText(
  block: Extract<InputContentBlock, { type: 'image' }>,
) {
  return [
    '[图片引用]',
    block.name ? `名称：${block.name}` : '',
    block.path ? `路径：${toModelReadablePath(block.path)}` : '',
    block.mimeType ? `类型：${block.mimeType}` : '',
    typeof block.size === 'number' ? `大小：${block.size} bytes` : '',
    '请使用 ViewImage 查看这张图片，不要用 Read 或 Grep 读取图片内容。',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildInputFileTextBlockText(
  block: Extract<InputContentBlock, { type: 'file_text' }>,
) {
  return `文件 ${toModelReadablePath(block.path)} 内容：\n\n${block.text}`;
}

function buildInputFileReferenceText(
  block: Extract<InputContentBlock, { type: 'file_reference' }>,
) {
  return [
    `文件已作为路径引用提供：${toModelReadablePath(block.path)}`,
    block.reason ? `原因：${block.reason}` : '',
    '可使用 Read 等工具按需读取该文件内容。',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildInputAttachmentMetadataText(
  block: Extract<InputContentBlock, { type: 'attachment_metadata' }>,
) {
  return `附件未直接发送：${block.name}\n原因：${block.reason}`;
}

function buildClaudeToolResultMessage(requestId: string, content: string, isError?: boolean): ClaudeInputMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: requestId,
          content,
          is_error: isError,
        },
      ],
    },
  };
}

function buildClaudeControlResponseMessage(
  requestId: string,
  decision: 'approve' | 'reject',
  toolUseId?: string,
) {
  return {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response:
        decision === 'approve'
          ? {
              behavior: 'allow',
              updatedInput: {},
              toolUseID: toolUseId,
              decisionClassification: 'user_temporary',
            }
          : {
              behavior: 'deny',
              message: 'Permission denied by user.',
              toolUseID: toolUseId,
              decisionClassification: 'user_reject',
            },
    },
  };
}

function buildAskUserQuestionControlResponse(
  requestId: string,
  toolUseId: string,
  questions: RequestUserInputQuestion[],
  answers: Record<string, string>,
) {
  return {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: {
        behavior: 'allow',
        updatedInput: {
          questions,
          answers: buildRequestUserInputResponseAnswers(questions, answers),
        },
        toolUseID: toolUseId,
        decisionClassification: 'user_temporary',
      },
    },
  };
}

function writePromptToClaude(runtime: ClaudeRuntime, state: RunState, input: StreamInput) {
  const traceDetail = summarizeClaudeInputForTrace(input);
  if (runtime.inputMode === 'argv') {
    enqueueTrace(state, 'prompt_sent_as_arg', Date.now(), traceDetail);
    runtime.child.stdin.end();
    return;
  }

  const payload = `${JSON.stringify(buildClaudeInputMessage(input))}\n`;
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

    enqueueTrace(state, 'stdin_prompt_written', Date.now(), traceDetail);
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

function isHumanApprovalToolResultContent(content: string) {
  const normalized = content.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('this command requires approval') ||
    normalized.includes('requires approval') ||
    normalized.includes('requires your approval') ||
    normalized.includes('approval required') ||
    (normalized.includes('was blocked') &&
      normalized.includes('for security') &&
      normalized.includes('claude code'))
  );
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
  runtime: ClaudeRuntime,
  state: RunState,
  runId: string,
  accumulator: ToolInputAccumulator,
  enqueue: (event: StreamEvent) => void,
) {
  const input = parseJsonObject(accumulator.inputText);
  if (!input) {
    return null;
  }

  if (!accumulator.emittedRequestUserInput) {
    const request = parseRequestUserInputEvent(accumulator.name, input, accumulator.toolUseId);
    if (request) {
      accumulator.emittedRequestUserInput = true;
      return emitRequestUserInputEvent(state, runId, request, enqueue) ? 'request-user-input' : null;
    }
  }

  if (!accumulator.emittedApprovalRequest) {
    const request = parseRuntimeApprovalRequestEvent(accumulator.name, input, accumulator.toolUseId);
    if (request) {
      accumulator.emittedApprovalRequest = true;
      return emitOrAutoApproveApprovalRequestEvent(runtime, state, runId, request, enqueue);
    }
  }

  return null;
}

function emitRequestUserInputEvent(
  state: RunState,
  runId: string,
  request: RequestUserInputRequest,
  enqueue: (event: StreamEvent) => void,
) {
  const key = getRequestUserInputKey(request);
  if (state.emittedRequestUserInputKeys.has(key)) {
    return false;
  }

  state.emittedRequestUserInputKeys.add(key);
  enqueue({
    type: 'request-user-input',
    runId,
    request,
  });
  return true;
}

function emitOrAutoApproveApprovalRequestEvent(
  runtime: ClaudeRuntime,
  state: RunState,
  runId: string,
  request: ApprovalRequest,
  enqueue: (event: StreamEvent) => void,
) {
  const key = getApprovalRequestKey(request);
  if (state.emittedApprovalRequestKeys.has(key)) {
    return null;
  }

  state.emittedApprovalRequestKeys.add(key);
  if (shouldAutoApproveBypassPermissionRequest(runtime, state, request)) {
    const requestId = request.requestId?.trim();
    if (requestId) {
      writeApprovalDecisionToRuntime(
        runtime,
        state,
        requestId,
        'approve',
        'The user approved this request. Continue the original task.',
        (error) => {
          if (error) {
            enqueue({
              type: 'approval-request',
              runId,
              request,
            });
            pauseRuntimeRunForHumanInput(runtime, state, 'paused_for_approval_request');
            return;
          }

          state.pausedForUserInput = false;
          enqueueTrace(state, 'auto_approved_bypass_permission', Date.now(), requestId);
        },
      );
      return 'auto-approved';
    }
  }

  enqueue({
    type: 'approval-request',
    runId,
    request,
  });
  return 'approval-request';
}

function shouldAutoApproveBypassPermissionRequest(
  runtime: ClaudeRuntime,
  state: RunState,
  request: ApprovalRequest,
) {
  return (
    state.input.permissionMode === 'bypassPermissions' &&
    runtime.inputMode === 'stdin' &&
    !runtime.closed &&
    !state.finished &&
    request.kind === 'permission' &&
    Boolean(request.requestId?.trim())
  );
}

function getRequestUserInputKey(request: RequestUserInputRequest) {
  if (request.requestId?.trim()) {
    return `id:${request.requestId.trim()}`;
  }

  return `shape:${JSON.stringify({
    title: request.title,
    description: request.description,
    questions: request.questions,
  })}`;
}

function getApprovalRequestKey(request: ApprovalRequest) {
  if (request.requestId?.trim()) {
    return `id:${request.requestId.trim()}`;
  }

  return `shape:${JSON.stringify({
    title: request.title,
    description: request.description,
    command: request.command,
    danger: request.danger,
  })}`;
}

function isInternalHumanInputToolResult(state: RunState, block: ClaudeContentBlock, content: string) {
  const toolUseId = block.tool_use_id?.trim();
  if (!toolUseId) {
    return false;
  }

  const key = `id:${toolUseId}`;
  if (state.emittedRequestUserInputKeys.has(key)) {
    return true;
  }

  if (!state.emittedApprovalRequestKeys.has(key)) {
    return false;
  }

  return !block.is_error || isExpectedApprovalInterruptionContent(content);
}

function isExpectedApprovalInterruptionContent(content: string) {
  const normalized = content.trim().toLowerCase();
  return (
    normalized === 'exit plan mode?' ||
    normalized.includes('exit plan mode?') ||
    isHumanApprovalToolResultContent(content)
  );
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

function parseControlApprovalRequestEvent(payload: ClaudeJsonLine): ApprovalRequest | null {
  const request = asRecord(payload.request);
  if (request.subtype !== 'can_use_tool') {
    return null;
  }

  const requestId = typeof payload.request_id === 'string' && payload.request_id.trim()
    ? payload.request_id.trim()
    : undefined;
  if (!requestId) {
    return null;
  }

  const toolName = firstNonEmptyString(request, ['tool_name', 'toolName', 'name']) ?? 'tool';
  const input = asRecord(request.input);
  if (normalizeToolName(toolName) === 'exitplanmode') {
    return {
      requestId,
      kind: 'plan-exit',
      title: '计划待确认',
      description: firstNonEmptyString(input, ['plan', 'description', 'reason', 'message']),
      danger: 'low',
    };
  }

  return {
    requestId,
    kind: 'permission',
    title:
      firstNonEmptyString(request, ['title', 'display_name', 'displayName', 'message', 'question']) ??
      `等待批准：${toolName}`,
    description: firstNonEmptyString(request, ['description', 'decision_reason', 'decisionReason']),
    command: normalizeCommand(input.command ?? input.argv ?? input.args),
    danger: normalizeDangerLevel(firstNonEmptyString(request, ['danger', 'risk'])),
  };
}

function parseControlRequestUserInputEvent(payload: ClaudeJsonLine): RequestUserInputRequest | null {
  const request = asRecord(payload.request);
  if (request.subtype !== 'can_use_tool') {
    return null;
  }

  const toolName = firstNonEmptyString(request, ['tool_name', 'toolName', 'name']);
  if (!toolName) {
    return null;
  }

  return parseRequestUserInputEvent(toolName, request.input, getControlRequestToolUseId(payload));
}

function getControlRequestToolUseId(payload: ClaudeJsonLine) {
  const request = asRecord(payload.request);
  const value = request.tool_use_id ?? request.toolUseId;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseRuntimeApprovalRequestEvent(
  toolName: string,
  input: unknown,
  toolUseId?: string,
): ApprovalRequest | null {
  if (normalizeToolName(toolName) === 'exitplanmode') {
    return null;
  }

  return parseApprovalRequestEvent(toolName, input, toolUseId);
}

function parseApprovalRequestEvent(
  toolName: string,
  input: unknown,
  toolUseId?: string,
): ApprovalRequest | null {
  const normalizedToolName = normalizeToolName(toolName);
  if (normalizedToolName === 'exitplanmode') {
    const payload = asRecord(input);
    return {
      requestId: firstNonEmptyString(payload, ['requestId', 'request_id', 'toolUseId', 'tool_use_id']) ?? toolUseId,
      kind: 'plan-exit',
      title: '计划待确认',
      description: firstNonEmptyString(payload, ['plan', 'description', 'reason', 'message']),
      danger: 'low',
    };
  }

  if (normalizedToolName !== 'approvalrequest') {
    return null;
  }

  const payload = asRecord(input);
  const title = firstNonEmptyString(payload, ['title', 'message', 'question']) ?? '等待批准';
  const command = normalizeCommand(payload.command ?? payload.argv ?? payload.args);

  return {
    requestId: firstNonEmptyString(payload, ['requestId', 'request_id', 'toolUseId', 'tool_use_id']) ?? toolUseId,
    kind: 'permission',
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
