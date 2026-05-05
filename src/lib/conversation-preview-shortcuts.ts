import { getWorkbenchPreviewKind } from './workbench-files';
import type { ToolStep, WorkbenchPreviewRequest } from '../types';

type ConversationToolPreview = {
  filePath: string;
  fileName: string;
};

export function buildConversationPreviewRequest(
  preview: ConversationToolPreview | null,
): WorkbenchPreviewRequest | null {
  if (!preview?.filePath) {
    return null;
  }

  return {
    key: `file:${preview.filePath}`,
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
    const changedFile = extractConversationChangedFile(tool);
    if (!changedFile || seen.has(changedFile.path)) {
      continue;
    }

    seen.add(changedFile.path);
    files.push(changedFile);
  }

  return files;
}

function extractConversationChangedFile(tool: ToolStep) {
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

  return {
    path: filePath,
    name: getFileName(filePath),
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

function getFileName(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return normalizedPath.split('/').pop() || normalizedPath;
}
