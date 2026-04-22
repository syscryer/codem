import { access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
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
  | { type: 'claude-event'; runId: string; label: string; eventType?: string; subtype?: string; status?: string; raw: unknown }
  | { type: 'tool-start'; runId: string; blockIndex: number; toolUseId?: string; name: string; input?: unknown }
  | { type: 'tool-input-delta'; runId: string; blockIndex: number; text: string }
  | { type: 'tool-stop'; runId: string; blockIndex: number }
  | { type: 'tool-result'; runId: string; toolUseId?: string; content: string; isError?: boolean }
  | { type: 'assistant-snapshot'; runId: string; blocks: ClaudeContentBlock[] }
  | { type: 'raw'; runId: string; raw: unknown }
  | { type: 'stderr'; runId: string; text: string }
  | { type: 'done'; runId: string; sessionId?: string; result: string; totalCostUsd?: number; durationMs?: number }
  | { type: 'error'; runId: string; message: string };

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
  session_id?: string;
  result?: string;
  duration_ms?: number;
  total_cost_usd?: number;
  message?: {
    content?: ClaudeContentBlock[];
  };
  event?: {
    type?: string;
    index?: number;
    content_block?: ClaudeContentBlock;
    delta?: {
      type?: string;
      text?: string;
      partial_json?: string;
    };
  };
  status?: string;
};

type ClaudeChildProcess = ChildProcessByStdio<null, Readable, Readable>;

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

  if (input.sessionId) {
    args.push('--resume', input.sessionId);
  }

  args.push(input.prompt);

  yield {
    type: 'status',
    runId,
    message: `已启动 Claude Code，工作目录：${input.workingDirectory}`,
  };

  const child = spawn(command, args, {
    cwd: input.workingDirectory,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  activeRuns.set(runId, child);

  const queue: StreamEvent[] = [];
  let finished = false;
  let sessionId = input.sessionId;
  let finalResult = '';

  const flushStdoutLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      const payload = JSON.parse(trimmed) as ClaudeJsonLine;
      queue.push({
        type: 'raw',
        runId,
        raw: payload,
      });

      if (payload.session_id && payload.session_id !== sessionId) {
        sessionId = payload.session_id;
        queue.push({
          type: 'session',
          runId,
          sessionId,
        });
      }

      if (payload.type === 'system') {
        queue.push({
          type: 'claude-event',
          runId,
          label: describeSystemEvent(payload),
          eventType: payload.type,
          subtype: payload.subtype,
          raw: payload,
        });
      }

      if (payload.type === 'system' && payload.subtype === 'status') {
        queue.push({
          type: 'claude-event',
          runId,
          label: `状态：${payload.status ?? 'unknown'}`,
          eventType: payload.type,
          subtype: payload.subtype,
          status: payload.status,
          raw: payload,
        });
      }

      if (payload.type === 'stream_event' && payload.event?.type === 'content_block_start') {
        const block = payload.event.content_block;
        if (block?.type === 'tool_use' && block.name) {
          queue.push({
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
        queue.push({
          type: 'delta',
          runId,
          text: payload.event.delta.text,
        });
      }

      if (
        payload.type === 'stream_event' &&
        payload.event?.type === 'content_block_delta' &&
        payload.event.delta?.type === 'input_json_delta' &&
        payload.event.delta.partial_json
      ) {
        queue.push({
          type: 'tool-input-delta',
          runId,
          blockIndex: payload.event.index ?? -1,
          text: payload.event.delta.partial_json,
        });
      }

      if (payload.type === 'stream_event' && payload.event?.type === 'content_block_stop') {
        queue.push({
          type: 'tool-stop',
          runId,
          blockIndex: payload.event.index ?? -1,
        });
      }

      if (payload.type === 'assistant' && Array.isArray(payload.message?.content)) {
        queue.push({
          type: 'assistant-snapshot',
          runId,
          blocks: payload.message.content,
        });

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

          queue.push({
            type: 'tool-result',
            runId,
            toolUseId: block.tool_use_id,
            content: stringifyClaudeContent(block.content),
            isError: block.is_error,
          });
        }
      }

      if (payload.type === 'result') {
        finalResult = payload.result ?? finalResult;
        queue.push({
          type: 'done',
          runId,
          sessionId,
          result: finalResult,
          totalCostUsd: payload.total_cost_usd,
          durationMs: payload.duration_ms,
        });
      }
    } catch {
      queue.push({
        type: 'stderr',
        runId,
        text: trimmed,
      });
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

      queue.push({
        type: 'stderr',
        runId,
        text: line.trim(),
      });
    }
  });

  child.once('error', (error) => {
    queue.push({
      type: 'error',
      runId,
      message: error.message,
    });
    finished = true;
  });

  child.once('close', (code, signal) => {
    if (stdoutBuffer.trim()) {
      flushStdoutLine(stdoutBuffer);
      stdoutBuffer = '';
    }

    if (stderrBuffer.trim()) {
      queue.push({
        type: 'stderr',
        runId,
        text: stderrBuffer.trim(),
      });
      stderrBuffer = '';
    }

    const hasDoneEvent = queue.some((item) => item.type === 'done');
    if (!hasDoneEvent) {
      if (code === 0 || signal === 'SIGTERM') {
        queue.push({
          type: 'done',
          runId,
          sessionId,
          result: finalResult,
        });
      } else {
        queue.push({
          type: 'error',
          runId,
          message: `Claude 退出异常，code=${code ?? 'null'} signal=${signal ?? 'null'}`,
        });
      }
    }

    activeRuns.delete(runId);
    finished = true;
  });

  while (!finished || queue.length > 0) {
    const next = queue.shift();
    if (next) {
      yield next;
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, 40));
  }
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
