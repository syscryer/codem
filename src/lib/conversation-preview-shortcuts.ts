import { getWorkbenchPreviewKind } from './workbench-files';
import type { ToolStep, WorkbenchPreviewRequest } from '../types';

type ConversationToolPreview = {
  filePath: string;
  fileName: string;
};

export type ConversationFileChange = {
  path: string;
  name: string;
  kind: 'add' | 'update' | 'delete';
  oldText?: string;
  newText?: string;
  content?: string;
  diff?: string;
};

export function buildConversationPreviewRequest(
  preview: ConversationToolPreview | null,
): WorkbenchPreviewRequest | null {
  if (!preview?.filePath) {
    return null;
  }

  return {
    key: `conversation:${preview.filePath}`,
    path: preview.filePath,
    name: preview.fileName,
    kind: getWorkbenchPreviewKind(preview.filePath),
    source: 'conversation-card',
  };
}

export function collectConversationChangedFiles(tools: ToolStep[]) {
  const seen = new Set<string>();
  const files: Array<{ path: string; name: string }> = [];

  for (const tool of tools) {
    for (const change of collectToolConversationFileChanges(tool)) {
      if (seen.has(change.path)) {
        continue;
      }

      seen.add(change.path);
      files.push({ path: change.path, name: change.name });
    }
  }

  return files;
}

export function collectToolConversationFileChanges(tool: ToolStep): ConversationFileChange[] {
  const result = parseToolInput(tool.resultText);
  const resultChanges = extractCodexFileChanges(result);
  if (resultChanges.length > 0) {
    return resultChanges;
  }

  const input = parseToolInput(tool.inputText);
  if (!input) {
    return [];
  }

  const inputChanges = extractCodexFileChanges(input);
  if (inputChanges.length > 0) {
    return inputChanges;
  }

  if (tool.name !== 'Edit' && tool.name !== 'Write' && tool.name !== 'NotebookEdit') {
    return [];
  }

  const filePath = getToolInputString(input, ['file_path', 'path', 'notebook_path']);
  if (!filePath) {
    return [];
  }

  const changeType = getToolInputString(input, ['change_type']);
  return [{
    path: filePath,
    name: getFileName(filePath),
    kind: tool.name === 'Write' || changeType === 'create'
      ? 'add'
      : changeType === 'delete'
        ? 'delete'
        : 'update',
    oldText: getToolInputString(input, ['old_string']),
    newText: getToolInputString(input, ['new_string']),
    content: getToolInputString(input, ['content']),
    diff: getToolInputString(input, ['diff', 'patch']),
  }];
}

function extractCodexFileChanges(input: Record<string, unknown> | null) {
  if (!Array.isArray(input?.changes)) {
    return [];
  }

  return input.changes
    .map((value): ConversationFileChange | null => {
      if (!value || typeof value !== 'object') {
        return null;
      }

      const change = value as Record<string, unknown>;
      const sourcePath = getToolInputString(change, ['path']);
      if (!sourcePath) {
        return null;
      }
      const movePath = change.kind && typeof change.kind === 'object'
        ? getToolInputString(change.kind as Record<string, unknown>, ['move_path'])
        : undefined;
      const path = movePath || sourcePath;

      return {
        path,
        name: getFileName(path),
        kind: normalizeCodexChangeKind(change.kind),
        diff: getToolInputString(change, ['diff', 'unified_diff']),
      };
    })
    .filter((change): change is ConversationFileChange => Boolean(change));
}

function normalizeCodexChangeKind(value: unknown): ConversationFileChange['kind'] {
  const kind = typeof value === 'string'
    ? value
    : value && typeof value === 'object'
      ? (value as Record<string, unknown>).type
      : undefined;

  if (kind === 'add' || kind === 'create') {
    return 'add';
  }
  if (kind === 'delete') {
    return 'delete';
  }
  return 'update';
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

function getFileName(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return normalizedPath.split('/').pop() || normalizedPath;
}
