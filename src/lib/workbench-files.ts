import { getIconForFile, getIconForFolder, getIconForOpenFolder } from 'vscode-icons-js';
import { codeToTokensBase, type BundledLanguage } from 'shiki';

import type { GitFileStatus, ProjectFileEntry, WorkbenchPreviewKind } from '../types';

export type CodeHighlightSegment = {
  text: string;
  kind?: 'comment' | 'keyword' | 'string' | 'number' | 'property' | 'punctuation' | 'tag';
};

export type HighlightedCodeToken = {
  content: string;
  color?: string;
  fontStyle?: number;
};

const VSCODE_ICONS_BASE_URL = 'https://cdn.jsdelivr.net/gh/vscode-icons/vscode-icons/icons';

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
  if (/\.(html|htm|vue|svelte|astro)$/.test(normalizedPath)) {
    return 'html';
  }
  if (/\.(css|scss|sass|less|styl|pcss|postcss)$/.test(normalizedPath)) {
    return 'style';
  }
  if (/\.mdx?$/.test(normalizedPath)) {
    return 'md';
  }
  if (/\.(json|jsonc)$/.test(normalizedPath)) {
    return 'json';
  }
  if (/\.(ya?ml|toml|ini|conf|config)$/.test(normalizedPath) || /(^|\/)(dockerfile|\.env(\..+)?)$/i.test(normalizedPath)) {
    return 'config';
  }
  if (/\.(sql|psql|prisma|db)$/.test(normalizedPath)) {
    return 'database';
  }
  if (/\.(csv|tsv|xlsx?|ods)$/.test(normalizedPath)) {
    return 'sheet';
  }
  if (/\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/.test(normalizedPath)) {
    return 'image';
  }
  if (/\.(pdf|docx?|rtf|odt|txt)$/.test(normalizedPath)) {
    return 'document';
  }
  if (/\.(zip|tar|gz|tgz|bz2|7z|rar|jar|war)$/.test(normalizedPath)) {
    return 'archive';
  }
  if (/\.(mp3|wav|ogg|flac|mp4|mov|avi|mkv|webm)$/.test(normalizedPath)) {
    return 'media';
  }
  if (/\.(ts|mts|cts|js|mjs|cjs|py|rb|php|go|rs|java|kt|kts|swift|lua|sh|bash|zsh|fish|ps1|psm1|psd1|c|cc|cpp|cxx|h|hpp|cs)$/.test(normalizedPath)) {
    return 'script';
  }

  return 'file';
}

export function resolveWorkbenchCodeLanguage(filePath: string) {
  const normalizedPath = filePath.toLowerCase();

  if (/\.(tsx)$/.test(normalizedPath)) return 'tsx';
  if (/\.(jsx)$/.test(normalizedPath)) return 'jsx';
  if (/\.(ts|mts|cts)$/.test(normalizedPath)) return 'ts';
  if (/\.(js|mjs|cjs)$/.test(normalizedPath)) return 'js';
  if (/\.(html|htm)$/.test(normalizedPath)) return 'html';
  if (/\.vue$/.test(normalizedPath)) return 'vue';
  if (/\.svelte$/.test(normalizedPath)) return 'svelte';
  if (/\.astro$/.test(normalizedPath)) return 'astro';
  if (/\.css$/.test(normalizedPath)) return 'css';
  if (/\.scss$/.test(normalizedPath)) return 'scss';
  if (/\.sass$/.test(normalizedPath)) return 'sass';
  if (/\.less$/.test(normalizedPath)) return 'less';
  if (/\.(json|jsonc)$/.test(normalizedPath)) return 'json';
  if (/\.mdx?$/.test(normalizedPath)) return 'markdown';
  if (/\.(ya?ml)$/.test(normalizedPath)) return 'yaml';
  if (/\.toml$/.test(normalizedPath)) return 'toml';
  if (/\.(xml|svg)$/.test(normalizedPath)) return 'xml';
  if (/\.(py)$/.test(normalizedPath)) return 'python';
  if (/\.(rb)$/.test(normalizedPath)) return 'ruby';
  if (/\.(php)$/.test(normalizedPath)) return 'php';
  if (/\.(java)$/.test(normalizedPath)) return 'java';
  if (/\.(kt|kts)$/.test(normalizedPath)) return 'kotlin';
  if (/\.(go)$/.test(normalizedPath)) return 'go';
  if (/\.(rs)$/.test(normalizedPath)) return 'rust';
  if (/\.(c)$/.test(normalizedPath)) return 'c';
  if (/\.(cc|cpp|cxx|hpp|h)$/.test(normalizedPath)) return 'cpp';
  if (/\.(cs)$/.test(normalizedPath)) return 'csharp';
  if (/\.(swift)$/.test(normalizedPath)) return 'swift';
  if (/\.(sh|bash|zsh|fish)$/.test(normalizedPath) || /(^|\/)(dockerfile)$/i.test(normalizedPath)) return 'bash';
  if (/\.(ps1|psm1|psd1)$/.test(normalizedPath)) return 'powershell';
  if (/\.(sql|psql|prisma)$/.test(normalizedPath)) return 'sql';
  if (/\.(graphql|gql)$/.test(normalizedPath)) return 'graphql';

  return 'text';
}

export function resolveWorkbenchFileIcon(
  filePath: string,
  type: 'directory' | 'file',
  options?: { expanded?: boolean },
) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const name = normalizedPath.split('/').pop() || normalizedPath;

  const iconFileName =
    type === 'directory'
      ? options?.expanded
        ? getIconForOpenFolder(name)
        : getIconForFolder(name)
      : getIconForFile(name);

  if (!iconFileName) {
    return null;
  }

  return `${VSCODE_ICONS_BASE_URL}/${iconFileName}`;
}

export async function highlightWorkbenchCode(content: string, filePath: string) {
  const language = resolveWorkbenchCodeLanguage(filePath);
  if (language === 'text') {
    return null;
  }

  try {
    const lines = await codeToTokensBase(content, {
      lang: language as BundledLanguage,
      theme: 'github-light',
    });
    return lines.map((line) =>
      line.map((token) => ({
        content: token.content,
        color: token.color,
        fontStyle: token.fontStyle,
      })),
    );
  } catch {
    return null;
  }
}

export function highlightWorkbenchCodeLine(line: string, filePath: string): CodeHighlightSegment[] {
  const normalizedPath = filePath.toLowerCase();
  if (/\.(html?|vue|svelte|astro|xml|svg)$/.test(normalizedPath)) {
    return highlightMarkupLine(line);
  }
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

function highlightMarkupLine(line: string): CodeHighlightSegment[] {
  const patterns = [
    { kind: 'comment' as const, pattern: /<!--.*?-->/y },
    { kind: 'string' as const, pattern: /(['"])(?:\\.|(?!\1).)*\1/y },
    { kind: 'tag' as const, pattern: /<\/?[A-Za-z][^>\s/]*/y },
    { kind: 'property' as const, pattern: /[A-Za-z_:][-A-Za-z0-9_:.]*(?==)/y },
    { kind: 'punctuation' as const, pattern: /[<>/=]+/y },
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
