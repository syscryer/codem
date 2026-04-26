import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

const MAX_GLOBAL_PROMPT_LENGTH = 200_000;

export type ClaudeGlobalPrompt = {
  path: string;
  content: string;
  exists: boolean;
  updatedAt?: string;
  length: number;
};

type ClaudeGlobalPromptOptions = {
  homeDirectory?: string;
};

export function readClaudeGlobalPrompt(options: ClaudeGlobalPromptOptions = {}): ClaudeGlobalPrompt {
  const promptPath = resolveClaudeGlobalPromptPath(options);

  try {
    const stats = statSync(promptPath);
    const content = readFileSync(promptPath, 'utf8');
    return {
      path: promptPath,
      content,
      exists: true,
      updatedAt: stats.mtime.toISOString(),
      length: content.length,
    };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {
        path: promptPath,
        content: '',
        exists: false,
        length: 0,
      };
    }

    throw error;
  }
}

export function saveClaudeGlobalPrompt(
  content: unknown,
  options: ClaudeGlobalPromptOptions = {},
): ClaudeGlobalPrompt {
  if (typeof content !== 'string') {
    throw new Error('全局提示词必须是字符串');
  }
  if (content.length > MAX_GLOBAL_PROMPT_LENGTH) {
    throw new Error('全局提示词过大，最多 200000 个字符');
  }

  const promptPath = resolveClaudeGlobalPromptPath(options);
  const directory = path.dirname(promptPath);
  mkdirSync(directory, { recursive: true });

  const temporaryPath = `${promptPath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, content, 'utf8');
    renameSync(temporaryPath, promptPath);
  } catch (error) {
    try {
      rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original write/rename failure for callers.
    }
    throw error;
  }

  return readClaudeGlobalPrompt(options);
}

export function resolveClaudeGlobalPromptPath(options: ClaudeGlobalPromptOptions = {}) {
  const homeDirectory = options.homeDirectory || process.env.USERPROFILE || process.env.HOME || homedir();
  return path.join(homeDirectory, '.claude', 'CLAUDE.md');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
