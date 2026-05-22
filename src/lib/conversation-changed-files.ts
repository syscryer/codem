import {
  buildConversationPreviewRequest,
  collectConversationChangedFiles,
} from './conversation-preview-shortcuts';
import type { ConversationTurn, ToolStep, WorkbenchPreviewRequest } from '../types';

export type ConversationToolPreview = {
  kind: 'edit' | 'write';
  filePath: string;
  fileName: string;
  beforeText: string;
  afterText: string;
  additions: number;
  deletions: number;
  rows: Array<{ type: 'context' | 'add' | 'remove'; text: string }>;
};

export type ConversationChangedFileGroup = {
  path: string;
  name: string;
  additions: number;
  deletions: number;
  previews: ConversationToolPreview[];
};

export type ConversationUndoOperation = {
  kind: 'replace-snippet' | 'delete-file' | 'restore-file';
  beforeText: string;
  afterText: string;
};

export type ConversationUndoChange = {
  path: string;
  operations: ConversationUndoOperation[];
};

export function buildChangedFileReviewRequest(file: ConversationChangedFileGroup) {
  const request = buildConversationPreviewRequest({
    filePath: file.path,
    fileName: file.name,
  });
  if (!request) {
    return null;
  }

  return {
    ...request,
    reviewDiff: buildConversationReviewDiff(file),
  } satisfies WorkbenchPreviewRequest;
}

export function buildChangedFilesReviewRequests(files: ConversationChangedFileGroup[]) {
  return files
    .map((file) => buildChangedFileReviewRequest(file))
    .filter((request): request is NonNullable<typeof request> => Boolean(request));
}

export function buildConversationUndoChanges(tools: ToolStep[]) {
  const grouped = new Map<string, ConversationUndoChange>();

  for (const tool of tools) {
    const change = extractUndoChange(tool);
    if (!change) {
      continue;
    }

    const current = grouped.get(change.path) ?? {
      path: change.path,
      operations: [],
    };
    current.operations.push(change.operation);
    grouped.set(change.path, current);
  }

  return [...grouped.values()];
}

export function findLatestChangedFilesTurnId(turns: ConversationTurn[]) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (collectConversationChangedFiles(turns[index].tools).length > 0) {
      return turns[index].id;
    }
  }

  return null;
}

function extractUndoChange(tool: ToolStep) {
  if (tool.name !== 'Edit' && tool.name !== 'Write' && tool.name !== 'NotebookEdit') {
    return null;
  }

  const input = parseToolInput(tool.inputText);
  if (!input) {
    return null;
  }

  const filePath = getToolInputString(input, ['file_path', 'path', 'notebook_path']);
  if (!filePath) {
    return null;
  }

  const oldString = getToolInputString(input, ['old_string']);
  const newString = getToolInputString(input, ['new_string']);
  const content = getToolInputString(input, ['content']);
  const diff = getToolInputString(input, ['diff', 'patch']);
  const changeType = getToolInputString(input, ['change_type']) ?? 'update';

  if (oldString !== undefined || newString !== undefined) {
    return {
      path: filePath,
      operation: {
        kind: 'replace-snippet' as const,
        beforeText: oldString ?? '',
        afterText: newString ?? '',
      },
    };
  }

  if (content !== undefined) {
    if (changeType === 'delete') {
      return {
        path: filePath,
        operation: {
          kind: 'restore-file' as const,
          beforeText: content,
          afterText: '',
        },
      };
    }

    return {
      path: filePath,
      operation: {
        kind: 'delete-file' as const,
        beforeText: '',
        afterText: content,
      },
    };
  }

  if (!diff) {
    return null;
  }

  const parsedDiff = parseDiffContent(diff);
  return {
    path: filePath,
    operation: {
      kind: 'replace-snippet' as const,
      beforeText: parsedDiff.beforeText,
      afterText: parsedDiff.afterText,
    },
  };
}

function parseToolInput(inputText?: string) {
  if (!inputText?.trim()) {
    return null;
  }

  try {
    return JSON.parse(inputText) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getToolInputString(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

function parseDiffContent(diff: string) {
  const lines = normalizePreviewText(diff).split('\n');
  const beforeLines: string[] = [];
  const afterLines: string[] = [];

  for (const line of lines) {
    if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('@@')
    ) {
      continue;
    }

    if (line.startsWith('-')) {
      beforeLines.push(line.slice(1));
      continue;
    }

    if (line.startsWith('+')) {
      afterLines.push(line.slice(1));
      continue;
    }

    const text = line.startsWith(' ') ? line.slice(1) : line;
    beforeLines.push(text);
    afterLines.push(text);
  }

  return {
    beforeText: beforeLines.join('\n'),
    afterText: afterLines.join('\n'),
  };
}

function normalizePreviewText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function buildConversationReviewDiff(file: ConversationChangedFileGroup) {
  const lines = [`--- a/${file.path}`, `+++ b/${file.path}`];

  file.previews.forEach((preview, index) => {
    if (file.previews.length > 1) {
      lines.push(`@@ ${preview.kind === 'write' ? '新增片段' : '编辑片段'} ${index + 1} @@`);
    }

    lines.push(...buildPreviewDiffLines(preview));
  });

  return lines;
}

function buildPreviewDiffLines(preview: ConversationToolPreview) {
  const beforeLines = splitPreviewLines(preview.beforeText);
  const afterLines = splitPreviewLines(preview.afterText);

  if (preview.kind === 'write') {
    return afterLines.map((line) => `+${line}`);
  }

  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const lines: string[] = [];
  const contextStart = Math.max(0, prefix - 2);
  const beforeChangedEnd = Math.max(prefix, beforeLines.length - suffix);
  const afterChangedEnd = Math.max(prefix, afterLines.length - suffix);

  for (let index = contextStart; index < prefix; index += 1) {
    lines.push(` ${afterLines[index] ?? ''}`);
  }

  for (let index = prefix; index < beforeChangedEnd; index += 1) {
    lines.push(`-${beforeLines[index] ?? ''}`);
  }

  for (let index = prefix; index < afterChangedEnd; index += 1) {
    lines.push(`+${afterLines[index] ?? ''}`);
  }

  const trailingContextEnd = Math.min(afterChangedEnd + 2, afterLines.length);
  for (let index = afterChangedEnd; index < trailingContextEnd; index += 1) {
    lines.push(` ${afterLines[index] ?? ''}`);
  }

  return lines.length > 0 ? lines : [' '];
}

function splitPreviewLines(value: string) {
  return normalizePreviewText(value).split('\n');
}
