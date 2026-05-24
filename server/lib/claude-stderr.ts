export type ClaudeRetryStatus = {
  attempt: number;
  maxAttempts: number;
  retryDelay: string;
  message: string;
};

type ClaudeApiRetryPayload = {
  type?: string;
  subtype?: string;
  attempt?: unknown;
  max_retries?: unknown;
  retry_delay_ms?: unknown;
};

const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export function splitClaudeStderrBuffer(buffer: string) {
  const lines: string[] = [];
  let lineStart = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    const char = buffer[index];
    if (char !== '\r' && char !== '\n') {
      continue;
    }

    lines.push(buffer.slice(lineStart, index));
    if (char === '\r' && buffer[index + 1] === '\n') {
      index += 1;
    }
    lineStart = index + 1;
  }

  return {
    lines,
    rest: buffer.slice(lineStart),
  };
}

export function parseClaudeRetryStatus(text: string): ClaudeRetryStatus | null {
  const normalized = text.replace(ANSI_PATTERN, '').trim();
  const match = /retrying\s+in\s+([^\s]+)\s*[·-]\s*attempt\s+(\d+)\s*\/\s*(\d+)/i.exec(normalized);
  if (!match) {
    return null;
  }

  const retryDelay = match[1] ?? '';
  const attempt = Number.parseInt(match[2] ?? '', 10);
  const maxAttempts = Number.parseInt(match[3] ?? '', 10);
  if (!Number.isFinite(attempt) || !Number.isFinite(maxAttempts)) {
    return null;
  }

  return {
    attempt,
    maxAttempts,
    retryDelay,
    message: retryDelay === '0s' ? `连接重试中 ${attempt}/${maxAttempts}` : `连接重试中 ${attempt}/${maxAttempts}，${retryDelay} 后重试`,
  };
}

export function parseClaudeApiRetryStatus(payload: ClaudeApiRetryPayload): ClaudeRetryStatus | null {
  if (payload.type !== 'system' || payload.subtype !== 'api_retry') {
    return null;
  }

  const attempt = typeof payload.attempt === 'number' ? payload.attempt : Number.NaN;
  const maxAttempts = typeof payload.max_retries === 'number' ? payload.max_retries : Number.NaN;
  if (!Number.isFinite(attempt) || !Number.isFinite(maxAttempts)) {
    return null;
  }

  const retryDelayMs = typeof payload.retry_delay_ms === 'number' && Number.isFinite(payload.retry_delay_ms)
    ? Math.max(0, payload.retry_delay_ms)
    : 0;
  const retryDelay = `${Math.ceil(retryDelayMs / 1000)}s`;

  return {
    attempt,
    maxAttempts,
    retryDelay,
    message: retryDelay === '0s' ? `连接重试中 ${attempt}/${maxAttempts}` : `连接重试中 ${attempt}/${maxAttempts}，${retryDelay} 后重试`,
  };
}
