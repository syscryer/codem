import type { GitConflictFileDetail, GitOperationState } from '../types';

export type ConflictResolutionChoice = 'current' | 'incoming' | 'both';

export type ConflictEditorLine = {
  lineNumber: number;
  text: string;
};

export type ConflictSideLineMetadata = {
  conflict: boolean;
};

export type CodeLineToken = {
  text: string;
  kind: 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'punctuation';
};

export type ConflictMarkerBlock = {
  startLine: number;
  separatorLine: number;
  endLine: number;
  currentLines: string[];
  incomingLines: string[];
};

export function buildConflictOperationTitle(state: GitOperationState | null) {
  const branch = state?.branch || '当前分支';
  const upstream = state?.upstream || (state?.remote ? [state.remote, state.branch].filter(Boolean).join('/') : '');
  const hasMeaningfulUpstream = Boolean(upstream && upstream !== branch);

  if (state?.operation === 'rebase') {
    if (!hasMeaningfulUpstream && state.status === 'conflicted') {
      return `解决 ${branch} 的变基冲突`;
    }
    return `将 ${branch} 变基到 ${hasMeaningfulUpstream ? upstream : '远端分支'}`;
  }

  if (state?.operation === 'merge' && !hasMeaningfulUpstream && state.status === 'conflicted') {
    return `解决 ${branch} 的合并冲突`;
  }

  return `将 ${hasMeaningfulUpstream ? upstream : '远端分支'} 合并到 ${branch}`;
}

export function buildConflictResolutionContent(
  detail: GitConflictFileDetail,
  choice: ConflictResolutionChoice,
) {
  if (choice === 'current') {
    return detail.currentContent;
  }
  if (choice === 'incoming') {
    return detail.incomingContent;
  }
  return `${trimTrailingNewline(detail.currentContent)}\n${detail.incomingContent}`;
}

export function canContinueGitOperation(state: GitOperationState | null) {
  return Boolean(state?.canContinue && !state.hasConflicts && state.conflicts.length === 0);
}

export function buildConflictEditorLines(content: string): ConflictEditorLine[] {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return (lines.length ? lines : ['']).map((text, index) => ({
    lineNumber: index + 1,
    text,
  }));
}

export function detectConflictBlocks(content: string): ConflictMarkerBlock[] {
  const lines = buildConflictEditorLines(content).map((line) => line.text);
  const blocks: ConflictMarkerBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index]?.startsWith('<<<<<<<')) {
      continue;
    }

    const startIndex = index;
    const currentLines: string[] = [];
    const incomingLines: string[] = [];
    let separatorIndex = -1;
    let endIndex = -1;

    index += 1;
    for (; index < lines.length; index += 1) {
      if (lines[index] === '=======') {
        separatorIndex = index;
        index += 1;
        break;
      }
      currentLines.push(lines[index] ?? '');
    }

    for (; index < lines.length; index += 1) {
      if (lines[index]?.startsWith('>>>>>>>')) {
        endIndex = index;
        break;
      }
      incomingLines.push(lines[index] ?? '');
    }

    if (separatorIndex !== -1 && endIndex !== -1) {
      blocks.push({
        startLine: startIndex + 1,
        separatorLine: separatorIndex + 1,
        endLine: endIndex + 1,
        currentLines,
        incomingLines,
      });
    }
  }

  return blocks;
}

export function buildConflictSideLineMetadata(
  content: string,
  blocks: ConflictMarkerBlock[],
  side: 'current' | 'incoming',
): Map<number, ConflictSideLineMetadata> {
  const sideLines = buildConflictEditorLines(content).map((line) => line.text);
  const metadata = new Map<number, ConflictSideLineMetadata>();
  let searchStartIndex = 0;

  for (const block of blocks) {
    const conflictLines = side === 'current' ? block.currentLines : block.incomingLines;
    if (conflictLines.length === 0) {
      continue;
    }

    const matchIndex = findLineSequence(sideLines, conflictLines, searchStartIndex);
    if (matchIndex === -1) {
      continue;
    }

    conflictLines.forEach((_, index) => {
      metadata.set(matchIndex + index + 1, { conflict: true });
    });
    searchStartIndex = matchIndex + conflictLines.length;
  }

  return metadata;
}

export function tokenizeCodeLine(line: string): CodeLineToken[] {
  const tokens: CodeLineToken[] = [];
  let plainBuffer = '';
  let index = 0;

  function flushPlainBuffer() {
    if (!plainBuffer) {
      return;
    }

    for (const part of splitPlainCodeChunk(plainBuffer)) {
      if (part) {
        tokens.push({ text: part, kind: 'plain' });
      }
    }
    plainBuffer = '';
  }

  while (index < line.length) {
    const rest = line.slice(index);

    if (rest.startsWith('//')) {
      flushPlainBuffer();
      tokens.push({ text: rest, kind: 'comment' });
      break;
    }

    const stringMatch = rest.match(/^(['"`])(?:\\.|(?!\1).)*\1/);
    if (stringMatch) {
      flushPlainBuffer();
      tokens.push({ text: stringMatch[0], kind: 'string' });
      index += stringMatch[0].length;
      continue;
    }

    const numberMatch = rest.match(/^\b\d+(?:\.\d+)?\b/);
    if (numberMatch) {
      flushPlainBuffer();
      tokens.push({ text: numberMatch[0], kind: 'number' });
      index += numberMatch[0].length;
      continue;
    }

    const wordMatch = rest.match(/^[A-Za-z_$][\w$]*/);
    if (wordMatch && CODE_KEYWORDS.has(wordMatch[0])) {
      flushPlainBuffer();
      tokens.push({ text: wordMatch[0], kind: 'keyword' });
      index += wordMatch[0].length;
      continue;
    }

    const character = line[index] ?? '';
    if (CODE_PUNCTUATION.has(character)) {
      flushPlainBuffer();
      tokens.push({ text: character, kind: 'punctuation' });
      index += 1;
      continue;
    }

    plainBuffer += character;
    index += 1;
  }

  flushPlainBuffer();
  return tokens.length ? tokens : [{ text: ' ', kind: 'plain' }];
}

const CODE_KEYWORDS = new Set([
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'import',
  'in',
  'interface',
  'let',
  'new',
  'null',
  'of',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'undefined',
  'var',
  'while',
]);

const CODE_PUNCTUATION = new Set(['{', '}', '[', ']', ')', ':', ';', ',', '.']);

function findLineSequence(lines: string[], targetLines: string[], startIndex: number) {
  const forwardMatch = findLineSequenceFrom(lines, targetLines, startIndex);
  if (forwardMatch !== -1) {
    return forwardMatch;
  }
  return findLineSequenceFrom(lines, targetLines, 0);
}

function findLineSequenceFrom(lines: string[], targetLines: string[], startIndex: number) {
  for (let index = startIndex; index <= lines.length - targetLines.length; index += 1) {
    let matched = true;
    for (let offset = 0; offset < targetLines.length; offset += 1) {
      if (lines[index + offset] !== targetLines[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return index;
    }
  }
  return -1;
}

function splitPlainCodeChunk(chunk: string) {
  const parts: string[] = [];
  let cursor = 0;
  const callLikePattern = /\([A-Za-z_$][\w$]*/g;
  let match: RegExpExecArray | null;

  while ((match = callLikePattern.exec(chunk)) !== null) {
    if (match.index > cursor) {
      parts.push(chunk.slice(cursor, match.index));
    }
    parts.push(match[0]);
    cursor = match.index + match[0].length;
  }

  if (cursor < chunk.length) {
    parts.push(chunk.slice(cursor));
  }

  return parts.length ? parts : [chunk];
}

function trimTrailingNewline(value: string) {
  return value.replace(/\n+$/g, '');
}
