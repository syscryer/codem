import type { GitFileStatus, ProjectFileEntry } from '../types';

export type WorkbenchPreviewKind = 'code' | 'markdown';

export type CodeHighlightSegment = {
  text: string;
  kind?: 'comment' | 'keyword' | 'string' | 'number' | 'property' | 'punctuation' | 'tag';
};

export type WorkbenchFileTreeNode = {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children: WorkbenchFileTreeNode[];
  gitFile?: GitFileStatus;
  projectFile?: ProjectFileEntry;
};

export function buildWorkbenchFileTree(files: GitFileStatus[]) {
  const roots: WorkbenchFileTreeNode[] = [];

  for (const file of files) {
    const parts = normalizeFilePath(file.path).split('/').filter(Boolean);
    let siblings = roots;
    let currentPath = '';

    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = siblings.find((item) => item.name === part && item.type === (isFile ? 'file' : 'directory'));

      if (!node) {
        node = {
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
          children: [],
          gitFile: isFile ? file : undefined,
        };
        siblings.push(node);
        siblings.sort(compareWorkbenchFileTreeNodes);
      }

      if (isFile) {
        node.gitFile = file;
      }

      siblings = node.children;
    });
  }

  return roots;
}

export function getWorkbenchPreviewKind(filePath: string): WorkbenchPreviewKind {
  return /\.mdx?$/i.test(filePath) ? 'markdown' : 'code';
}

export function getWorkbenchFileIconKind(filePath: string, type: 'directory' | 'file') {
  if (type === 'directory') {
    return 'folder';
  }

  const normalizedPath = filePath.toLowerCase();
  if (/\.(tsx|jsx)$/.test(normalizedPath)) {
    return 'react';
  }
  if (/\.(ts|js|mjs|cjs)$/.test(normalizedPath)) {
    return 'ts';
  }
  if (/\.css$/.test(normalizedPath)) {
    return 'css';
  }
  if (/\.mdx?$/.test(normalizedPath)) {
    return 'md';
  }
  if (/\.json$/.test(normalizedPath)) {
    return 'json';
  }

  return 'file';
}

export function highlightWorkbenchCodeLine(line: string, filePath: string): CodeHighlightSegment[] {
  const normalizedPath = filePath.toLowerCase();
  if (/\.(json|jsonc)$/.test(normalizedPath)) {
    return highlightJsonLine(line);
  }

  if (/\.css$/.test(normalizedPath)) {
    return highlightCssLine(line);
  }

  if (/\.(tsx|ts|jsx|js|mjs|cjs)$/.test(normalizedPath)) {
    return highlightScriptLine(line);
  }

  return [{ text: line }];
}

export function combineProjectFilePath(projectPath: string, relativePath: string) {
  const normalizedProjectPath = projectPath.replace(/[\\/]+$/, '');
  const normalizedRelativePath = normalizeFilePath(relativePath);
  if (!normalizedRelativePath) {
    return normalizedProjectPath;
  }

  return `${normalizedProjectPath}\\${normalizedRelativePath.replace(/\//g, '\\')}`;
}

function highlightScriptLine(line: string): CodeHighlightSegment[] {
  const patterns = [
    { kind: 'comment' as const, pattern: /\/\/.*|\/\*.*?\*\//y },
    { kind: 'string' as const, pattern: /(['"`])(?:\\.|(?!\1).)*\1/y },
    { kind: 'keyword' as const, pattern: /\b(?:import|from|export|const|let|var|function|return|if|else|for|while|switch|case|type|interface|class|extends|async|await|new|try|catch|finally|throw|true|false|null|undefined)\b/y },
    { kind: 'number' as const, pattern: /\b\d+(?:\.\d+)?\b/y },
    { kind: 'punctuation' as const, pattern: /[{}()[\].,;:?<>/=+\-*|&!]+/y },
  ];

  return highlightLineWithPatterns(line, patterns);
}

function highlightCssLine(line: string): CodeHighlightSegment[] {
  const patterns = [
    { kind: 'comment' as const, pattern: /\/\*.*?\*\//y },
    { kind: 'string' as const, pattern: /(['"])(?:\\.|(?!\1).)*\1/y },
    { kind: 'property' as const, pattern: /[-a-zA-Z]+(?=\s*:)/y },
    { kind: 'number' as const, pattern: /#[0-9a-fA-F]{3,8}|\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw)?\b/y },
    { kind: 'keyword' as const, pattern: /\b(?:display|grid|flex|block|none|auto|relative|absolute|fixed|hidden|visible|solid|transparent|inherit)\b/y },
    { kind: 'punctuation' as const, pattern: /[{}()[\].,;:>~+=*|]+/y },
  ];

  return highlightLineWithPatterns(line, patterns);
}

function highlightJsonLine(line: string): CodeHighlightSegment[] {
  const patterns = [
    { kind: 'property' as const, pattern: /"(?:\\.|[^"\\])*"(?=\s*:)/y },
    { kind: 'string' as const, pattern: /"(?:\\.|[^"\\])*"/y },
    { kind: 'number' as const, pattern: /-?\b\d+(?:\.\d+)?\b/y },
    { kind: 'keyword' as const, pattern: /\b(?:true|false|null)\b/y },
    { kind: 'punctuation' as const, pattern: /[{}[\],:]/y },
  ];

  return highlightLineWithPatterns(line, patterns);
}

function highlightLineWithPatterns(
  line: string,
  patterns: Array<{ kind: CodeHighlightSegment['kind']; pattern: RegExp }>,
): CodeHighlightSegment[] {
  const segments: CodeHighlightSegment[] = [];
  let index = 0;

  while (index < line.length) {
    let matched: CodeHighlightSegment | null = null;
    for (const { kind, pattern } of patterns) {
      pattern.lastIndex = index;
      const match = pattern.exec(line);
      if (match?.index === index && match[0]) {
        matched = { text: match[0], kind };
        break;
      }
    }

    if (matched) {
      segments.push(matched);
      index += matched.text.length;
      continue;
    }

    segments.push({ text: line[index] });
    index += 1;
  }

  return mergePlainSegments(segments);
}

function mergePlainSegments(segments: CodeHighlightSegment[]) {
  return segments.reduce<CodeHighlightSegment[]>((merged, segment) => {
    const previous = merged[merged.length - 1];
    if (previous && previous.kind === segment.kind) {
      previous.text += segment.text;
    } else {
      merged.push({ ...segment });
    }

    return merged;
  }, []);
}

function normalizeFilePath(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function compareWorkbenchFileTreeNodes(left: WorkbenchFileTreeNode, right: WorkbenchFileTreeNode) {
  if (left.type !== right.type) {
    return left.type === 'directory' ? -1 : 1;
  }

  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}
