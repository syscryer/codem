export function normalizePathForComparison(filePath: string) {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return '';
  }

  // Windows 文件系统大小写不敏感，且 macOS 默认 HFS+/APFS 也不区分大小写。
  // 这里只用于"找回搜索结果"和 dedupe 比较，整段小写更符合实际行为。
  return trimmed.replace(/\\/g, '/').toLowerCase();
}

export function dedupeFileReferencePaths(paths: string[]) {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const filePath of paths) {
    const normalizedPath = normalizePathForComparison(filePath);
    if (!normalizedPath || seen.has(normalizedPath)) {
      continue;
    }

    seen.add(normalizedPath);
    deduped.push(filePath);
  }

  return deduped;
}

export function shouldSearchFileReferenceQuery(query: string) {
  return query.trim().length > 0;
}

export type FileReferenceSearchResult = {
  path: string;
  rel: string;
  isDirectory: boolean;
};

export function sortFileReferenceSearchResults(
  results: FileReferenceSearchResult[],
  query: string,
) {
  const normalizedQuery = normalizeFileReferenceSearchQuery(query);

  return results
    .map((result, index) => ({
      result,
      index,
      score: scoreFileReferenceSearchResult(result, normalizedQuery),
    }))
    .sort((a, b) => (
      a.score - b.score
      || Number(b.result.isDirectory) - Number(a.result.isDirectory)
      || a.result.rel.length - b.result.rel.length
      || a.result.rel.localeCompare(b.result.rel)
      || a.index - b.index
    ))
    .map(({ result }) => result);
}

function normalizeFileReferenceSearchQuery(query: string) {
  return query.replace(/\\/g, '/').toLowerCase();
}

function scoreFileReferenceSearchResult(
  result: FileReferenceSearchResult,
  normalizedQuery: string,
) {
  if (!normalizedQuery) {
    return 0;
  }

  const normalizedRel = result.rel.replace(/\\/g, '/').toLowerCase();
  const segments = normalizedRel.split('/').filter(Boolean);
  const basename = segments.at(-1) ?? normalizedRel;

  if (normalizedRel === normalizedQuery || basename === normalizedQuery) {
    return 0;
  }
  if (basename.startsWith(normalizedQuery)) {
    return 1;
  }
  if (normalizedRel.startsWith(normalizedQuery) || segments.some((segment) => segment === normalizedQuery)) {
    return 2;
  }
  if (segments.some((segment) => segment.startsWith(normalizedQuery))) {
    return 3;
  }
  if (normalizedRel.includes(normalizedQuery)) {
    return 4;
  }

  return 5;
}

export function extractAtFileReferences(text: string) {
  const references: string[] = [];
  const pattern = /(^|[\s([{\u3000])@(?:"([^"\n]+)"|'([^'\n]+)'|`([^`\n]+)`|([^\s@'"`][^\s@]*))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const quotedValue = match[2] ?? match[3] ?? match[4];
    const value = quotedValue ?? trimTrailingUnquotedReferencePunctuation(match[5] ?? '');
    if (value.trim()) {
      references.push(value.trim());
    }
  }

  return dedupeFileReferencePaths(references);
}

function trimTrailingUnquotedReferencePunctuation(value: string) {
  let normalized = value.trim();
  if (!normalized) {
    return '';
  }

  let changed = true;
  while (changed && normalized) {
    changed = false;

    const trimmedPunctuation = normalized.replace(/[，。；：！？、,.;:!?]+$/u, '');
    if (trimmedPunctuation !== normalized) {
      normalized = trimmedPunctuation;
      changed = true;
      continue;
    }

    const trailingChar = normalized.at(-1);
    if (!trailingChar) {
      break;
    }

    const bracketPair = trailingReferenceBracketPairs[trailingChar];
    if (!bracketPair) {
      continue;
    }

    const openCount = countOccurrences(normalized, bracketPair.open);
    const closeCount = countOccurrences(normalized, trailingChar);
    if (closeCount > openCount) {
      normalized = normalized.slice(0, -1);
      changed = true;
    }
  }

  return normalized;
}

const trailingReferenceBracketPairs: Record<string, { open: string }> = {
  ')': { open: '(' },
  ']': { open: '[' },
  '}': { open: '{' },
  '）': { open: '（' },
  '】': { open: '【' },
  '」': { open: '「' },
  '』': { open: '『' },
  '》': { open: '《' },
};

function countOccurrences(text: string, char: string) {
  let count = 0;
  for (const current of text) {
    if (current === char) {
      count += 1;
    }
  }
  return count;
}
