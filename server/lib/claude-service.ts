import { access } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

export type ClaudePermissionMode =
  | 'default'
  | 'plan'
  | 'acceptEdits'
  | 'auto'
  | 'dontAsk'
  | 'bypassPermissions';

type StreamInput = {
  prompt: string;
  workingDirectory: string;
  sessionId?: string;
  permissionMode: ClaudePermissionMode;
  model?: string;
};

type StreamEvent =
  | { type: 'status'; runId: string; message: string }
  | { type: 'session'; runId: string; sessionId: string }
  | { type: 'delta'; runId: string; text: string }
  | { type: 'phase'; runId: string; phase: ClaudePhase; label: string }
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

type ClaudeChildProcess = ChildProcessByStdio<null, Readable, Readable>;

type ToolInputAccumulator = {
  name: string;
  toolUseId?: string;
  inputText: string;
  emittedRequestUserInput: boolean;
  emittedApprovalRequest: boolean;
};

const activeRuns = new Map<string, ClaudeChildProcess>();

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
  const child = activeRuns.get(runId);
  if (!child) {
    return false;
  }

  child.kill();
  activeRuns.delete(runId);
  return true;
}

export async function* createClaudeStream(input: StreamInput): AsyncGenerator<StreamEvent> {
  const runId = randomUUID();
  const command = resolveClaudeCommand();

  if (!command) {
    yield {
      type: 'error',
      runId,
      message: '未找到 claude 命令，请先确认 Claude Code 已安装并在 PATH 中可见。',
    };
    return;
  }

  const resumeSessionId = getResumeSessionId(input.workingDirectory, input.sessionId);
  const args = [
    '-p',
    '--verbose',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--permission-mode',
    input.permissionMode,
  ];

  if (input.model) {
    args.push('--model', input.model);
  }

  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  }

  args.push(input.prompt);

  yield {
    type: 'status',
    runId,
    message: `已启动 Claude Code，工作目录：${input.workingDirectory}`,
  };

  if (input.sessionId && !resumeSessionId) {
    const message = `原会话 ${input.sessionId} 在 Claude 记录中不存在，已自动开启新会话。`;
    yield {
      type: 'status',
      runId,
      message,
    };
    yield {
      type: 'runtime-reconnect-hint',
      runId,
      hint: {
        reason: 'resume-session-missing',
        message,
        retryable: true,
        suggestedAction: 'recover',
        source: 'status',
      },
    };
  }

  const child = spawn(command, args, {
    cwd: input.workingDirectory,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  activeRuns.set(runId, child);

  const queue: StreamEvent[] = [];
  let wakeQueue: (() => void) | null = null;
  let finished = false;
  let sessionId = resumeSessionId;
  let finalResult = '';
  let seenDoneEvent = false;
  const blockTypeByIndex = new Map<number, string>();
  const toolInputByIndex = new Map<number, ToolInputAccumulator>();
  const emittedRecoveryHintKeys = new Set<string>();
  const enqueue = (event: StreamEvent) => {
    queue.push(event);
    wakeQueue?.();
    wakeQueue = null;
  };
  const markFinished = () => {
    finished = true;
    wakeQueue?.();
    wakeQueue = null;
  };

  const flushStdoutLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      const payload = JSON.parse(trimmed) as ClaudeJsonLine;
      if (payload.isSidechain) {
        return;
      }

      enqueue({
        type: 'raw',
        runId,
        raw: payload,
      });

      const resultErrorMessage = getResultErrorMessage(payload);
      if (payload.session_id && payload.session_id !== sessionId && !resultErrorMessage) {
        sessionId = payload.session_id;
        enqueue({
          type: 'session',
          runId,
          sessionId,
        });
      }

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

      if (payload.type === 'stream_event') {
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
          blockTypeByIndex.set(payload.event.index, block.type);
        }

        if (block?.type === 'thinking') {
          enqueue({
            type: 'phase',
            runId,
            phase: 'thinking',
            label: 'Thinking...',
          });
        }

        if (block?.type === 'tool_use' && block.name) {
          if (typeof payload.event.index === 'number') {
            toolInputByIndex.set(payload.event.index, {
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
              typeof payload.event.index === 'number' ? toolInputByIndex.get(payload.event.index) : undefined;
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
              typeof payload.event.index === 'number' ? toolInputByIndex.get(payload.event.index) : undefined;
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
          typeof payload.event.index === 'number' ? blockTypeByIndex.get(payload.event.index) : undefined;
        if (currentBlockType === 'thinking' || currentBlockType === 'redacted_thinking') {
          return;
        }

        enqueue({
          type: 'delta',
          runId,
          text: payload.event.delta.text,
        });
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
        });
      }

      if (
        payload.type === 'stream_event' &&
        payload.event?.type === 'content_block_delta' &&
        payload.event.delta?.type === 'input_json_delta' &&
        payload.event.delta.partial_json
      ) {
        if (typeof payload.event.index === 'number') {
          const accumulator = toolInputByIndex.get(payload.event.index);
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
          typeof payload.event.index === 'number' ? blockTypeByIndex.get(payload.event.index) : undefined;
        if (typeof payload.event.index === 'number') {
          blockTypeByIndex.delete(payload.event.index);
          const accumulator = toolInputByIndex.get(payload.event.index);
          if (accumulator) {
            emitStructuredToolEventsFromAccumulator(runId, accumulator, enqueue);
            toolInputByIndex.delete(payload.event.index);
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
          finalResult = assistantText;
        }
      }

      if (payload.type === 'user' && Array.isArray(payload.message?.content)) {
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
          enqueueRetryableRuntimeError(runId, errorMessage, 'result', emittedRecoveryHintKeys, enqueue);
          seenDoneEvent = true;
          enqueue({
            type: 'error',
            runId,
            message: errorMessage,
          });
          return;
        }

        finalResult = payload.result ?? finalResult;
        seenDoneEvent = true;
        enqueue({
          type: 'done',
          runId,
          sessionId,
          result: finalResult,
          totalCostUsd: payload.total_cost_usd,
          durationMs: payload.duration_ms,
          ...usage,
        });
      }
    } catch {
      enqueue({
        type: 'stderr',
        runId,
        text: trimmed,
      });
      enqueueRuntimeReconnectHint(runId, trimmed, 'stderr', emittedRecoveryHintKeys, enqueue);
    }
  };

  let stdoutBuffer = '';
  child.stdout.on('data', (chunk: Buffer | string) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      flushStdoutLine(line);
    }
  });

  let stderrBuffer = '';
  child.stderr.on('data', (chunk: Buffer | string) => {
    stderrBuffer += chunk.toString();
    const lines = stderrBuffer.split(/\r?\n/);
    stderrBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      enqueue({
        type: 'stderr',
        runId,
        text: line.trim(),
      });
      enqueueRuntimeReconnectHint(runId, line.trim(), 'stderr', emittedRecoveryHintKeys, enqueue);
    }
  });

  child.once('error', (error) => {
    enqueueRetryableRuntimeError(runId, error.message, 'process', emittedRecoveryHintKeys, enqueue);
    enqueue({
      type: 'error',
      runId,
      message: error.message,
    });
    markFinished();
  });

  child.once('close', (code, signal) => {
    if (stdoutBuffer.trim()) {
      flushStdoutLine(stdoutBuffer);
      stdoutBuffer = '';
    }

    if (stderrBuffer.trim()) {
      enqueue({
        type: 'stderr',
        runId,
        text: stderrBuffer.trim(),
      });
      stderrBuffer = '';
    }

    if (!seenDoneEvent) {
      if (code === 0 || signal === 'SIGTERM') {
        seenDoneEvent = true;
        enqueue({
          type: 'done',
          runId,
          sessionId,
          result: finalResult,
        });
      } else {
        const message = `Claude 退出异常，code=${code ?? 'null'} signal=${signal ?? 'null'}`;
        enqueueRetryableRuntimeError(runId, message, 'process', emittedRecoveryHintKeys, enqueue);
        enqueue({
          type: 'error',
          runId,
          message,
        });
      }
    }

    activeRuns.delete(runId);
    markFinished();
  });

  while (!finished || queue.length > 0) {
    const next = queue.shift();
    if (next) {
      yield next;
      continue;
    }

    await new Promise<void>((resolve) => {
      wakeQueue = resolve;
    });
  }
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
  const lookupCommand = process.platform === 'win32' ? 'where.exe' : 'which';
  const lookup = spawnSync(lookupCommand, ['claude'], {
    encoding: 'utf8',
  });

  if (lookup.status !== 0) {
    return null;
  }

  return (
    lookup.stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find(Boolean) ?? null
  );
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

function getResumeSessionId(workingDirectory: string, sessionId?: string) {
  const trimmedSessionId = sessionId?.trim();
  if (!trimmedSessionId) {
    return undefined;
  }

  return existsSync(resolveClaudeTranscriptPath(workingDirectory, trimmedSessionId))
    ? trimmedSessionId
    : undefined;
}

function resolveClaudeTranscriptPath(workingDirectory: string, sessionId: string) {
  return path.join(homedir(), '.claude', 'projects', sanitizeProjectPath(workingDirectory), `${sessionId}.jsonl`);
}

function sanitizeProjectPath(projectPath: string) {
  return path.resolve(projectPath).replace(/[^a-zA-Z0-9]/g, '-');
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
