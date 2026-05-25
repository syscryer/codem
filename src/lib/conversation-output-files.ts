import type { ToolStep } from '../types';

export type ConversationOutputFile = {
  path: string;
  name: string;
  kindLabel: string;
  openMode: 'preview' | 'default-app';
  subtitle: string;
};

const PREVIEWABLE_EXTENSIONS = new Map<string, string>([
  ['md', 'MD'],
  ['markdown', 'MD'],
  ['txt', 'TXT'],
  ['json', 'JSON'],
  ['csv', 'CSV'],
  ['yml', 'YAML'],
  ['yaml', 'YAML'],
  ['html', 'HTML'],
  ['htm', 'HTML'],
]);

const DEFAULT_APP_EXTENSIONS = new Map<string, string>([
  ['pdf', 'PDF'],
  ['doc', 'Word'],
  ['docx', 'Word'],
  ['xls', 'Excel'],
  ['xlsx', 'Excel'],
  ['ppt', 'PowerPoint'],
  ['pptx', 'PowerPoint'],
]);

export function collectConversationOutputFiles(tools: ToolStep[]) {
  const seen = new Set<string>();
  const files: ConversationOutputFile[] = [];

  for (const tool of tools) {
    const filePath = extractToolOutputPath(tool);
    if (!filePath || seen.has(filePath)) {
      continue;
    }

    const descriptor = describeConversationOutputFile(filePath);
    if (!descriptor) {
      continue;
    }

    seen.add(filePath);
    files.push({
      path: filePath,
      name: getFileName(filePath),
      ...descriptor,
    });
  }

  return files;
}

export function describeConversationOutputFile(filePath: string) {
  const extension = getFileExtension(filePath);
  if (!extension) {
    return null;
  }

  const previewKind = PREVIEWABLE_EXTENSIONS.get(extension);
  if (previewKind) {
    return {
      kindLabel: previewKind,
      openMode: 'preview' as const,
      subtitle: `文档 · ${previewKind} · 右侧预览`,
    };
  }

  const defaultAppKind = DEFAULT_APP_EXTENSIONS.get(extension);
  if (defaultAppKind) {
    return {
      kindLabel: defaultAppKind,
      openMode: 'default-app' as const,
      subtitle: `文档 · ${defaultAppKind} 打开`,
    };
  }

  return null;
}

function extractToolOutputPath(tool: ToolStep) {
  if (tool.name !== 'Edit' && tool.name !== 'Write' && tool.name !== 'NotebookEdit') {
    return '';
  }

  const input = parseToolInput(tool.inputText);
  if (!input) {
    return '';
  }

  return getToolInputString(input, ['file_path', 'path', 'notebook_path']) ?? '';
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

function getFileExtension(filePath: string) {
  const fileName = getFileName(filePath);
  const extension = fileName.includes('.') ? fileName.split('.').pop() ?? '' : '';
  return extension.toLowerCase();
}

function getFileName(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return normalizedPath.split('/').pop() || normalizedPath;
}
