export type WorkbenchSplitDiffRow =
  | {
      type: 'meta' | 'hunk';
      text: string;
    }
  | {
      type: 'collapsed';
      hiddenCount: number;
    }
  | {
      type: 'content';
      leftLineNumber: number | null;
      rightLineNumber: number | null;
      leftText: string;
      rightText: string;
      leftKind: 'context' | 'removed' | 'empty';
      rightKind: 'context' | 'added' | 'empty';
    };

type PendingDiffLine = {
  lineNumber: number;
  text: string;
};

export function buildWorkbenchSplitDiffRows(content: string) {
  const lines = normalizeWorkbenchDiffContent(content).split('\n');
  const rows: WorkbenchSplitDiffRow[] = [];
  let leftLineNumber = 1;
  let rightLineNumber = 1;
  let pendingRemoved: PendingDiffLine[] = [];
  let pendingAdded: PendingDiffLine[] = [];

  function flushPendingChanges() {
    const pairedCount = Math.max(pendingRemoved.length, pendingAdded.length);
    for (let index = 0; index < pairedCount; index += 1) {
      const removed = pendingRemoved[index];
      const added = pendingAdded[index];
      rows.push({
        type: 'content',
        leftLineNumber: removed?.lineNumber ?? null,
        rightLineNumber: added?.lineNumber ?? null,
        leftText: removed?.text ?? '',
        rightText: added?.text ?? '',
        leftKind: removed ? 'removed' : 'empty',
        rightKind: added ? 'added' : 'empty',
      });
    }

    pendingRemoved = [];
    pendingAdded = [];
  }

  for (const line of lines) {
    if (line.startsWith('@@')) {
      flushPendingChanges();
      const parsedHeader = parseDiffHunkHeader(line);
      if (parsedHeader) {
        leftLineNumber = parsedHeader.leftStart;
        rightLineNumber = parsedHeader.rightStart;
      }
      rows.push({ type: 'hunk', text: line });
      continue;
    }

    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
      flushPendingChanges();
      continue;
    }

    if (line.startsWith('-')) {
      pendingRemoved.push({
        lineNumber: leftLineNumber,
        text: line.slice(1),
      });
      leftLineNumber += 1;
      continue;
    }

    if (line.startsWith('+')) {
      pendingAdded.push({
        lineNumber: rightLineNumber,
        text: line.slice(1),
      });
      rightLineNumber += 1;
      continue;
    }

    flushPendingChanges();

    if (line.startsWith('\\')) {
      rows.push({ type: 'meta', text: line });
      continue;
    }

    const text = line.startsWith(' ') ? line.slice(1) : line;
    rows.push({
      type: 'content',
      leftLineNumber,
      rightLineNumber,
      leftText: text,
      rightText: text,
      leftKind: 'context',
      rightKind: 'context',
    });
    leftLineNumber += 1;
    rightLineNumber += 1;
  }

  flushPendingChanges();
  return rows;
}

export function buildWorkbenchFullDiffRows(beforeContent: string, afterContent: string) {
  const beforeLines = normalizeWorkbenchDiffContent(beforeContent).split('\n');
  const afterLines = normalizeWorkbenchDiffContent(afterContent).split('\n');
  const commonPairs = buildWorkbenchCommonLinePairs(beforeLines, afterLines, (left, right) => left === right);
  const rows: WorkbenchSplitDiffRow[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  for (const pair of commonPairs) {
    rows.push(
      ...buildWorkbenchChangedBlockRows(
        beforeLines,
        afterLines,
        beforeIndex,
        pair.beforeIndex,
        afterIndex,
        pair.afterIndex,
      ),
    );
    rows.push({
      type: 'content',
      leftLineNumber: pair.beforeIndex + 1,
      rightLineNumber: pair.afterIndex + 1,
      leftText: beforeLines[pair.beforeIndex] ?? '',
      rightText: afterLines[pair.afterIndex] ?? '',
      leftKind: 'context',
      rightKind: 'context',
    });
    beforeIndex = pair.beforeIndex + 1;
    afterIndex = pair.afterIndex + 1;
  }

  rows.push(
    ...buildWorkbenchChangedBlockRows(
      beforeLines,
      afterLines,
      beforeIndex,
      beforeLines.length,
      afterIndex,
      afterLines.length,
    ),
  );

  return rows;
}

export function collapseWorkbenchContextRows(
  rows: WorkbenchSplitDiffRow[],
  options?: {
    minimumRunLength?: number;
    edgeContext?: number;
  },
) {
  const minimumRunLength = options?.minimumRunLength ?? 8;
  const edgeContext = options?.edgeContext ?? 2;
  const collapsed: WorkbenchSplitDiffRow[] = [];
  let index = 0;

  while (index < rows.length) {
    const row = rows[index];
    if (!isWorkbenchContextRow(row)) {
      collapsed.push(row);
      index += 1;
      continue;
    }

    let end = index;
    while (end < rows.length && isWorkbenchContextRow(rows[end])) {
      end += 1;
    }

    const runLength = end - index;
    if (runLength < minimumRunLength) {
      collapsed.push(...rows.slice(index, end));
      index = end;
      continue;
    }

    const headCount = Math.min(edgeContext, runLength);
    const tailCount = Math.min(edgeContext, Math.max(0, runLength - headCount));
    const hiddenCount = runLength - headCount - tailCount;
    collapsed.push(...rows.slice(index, index + headCount));
    if (hiddenCount > 0) {
      collapsed.push({
        type: 'collapsed',
        hiddenCount,
      });
    }
    if (tailCount > 0) {
      collapsed.push(...rows.slice(end - tailCount, end));
    }
    index = end;
  }

  return collapsed;
}

export function findWorkbenchChangeBlockIndices(rows: WorkbenchSplitDiffRow[]) {
  const indices: number[] = [];
  let insideChangeBlock = false;

  rows.forEach((row, index) => {
    if (row.type === 'hunk') {
      indices.push(index);
      insideChangeBlock = true;
      return;
    }

    if (row.type !== 'content') {
      insideChangeBlock = false;
      return;
    }

    const changed = row.leftKind !== 'context' || row.rightKind !== 'context';
    if (!changed) {
      insideChangeBlock = false;
      return;
    }

    if (!insideChangeBlock) {
      indices.push(index);
    }
    insideChangeBlock = true;
  });

  return indices;
}

function parseDiffHunkHeader(line: string) {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (!match) {
    return null;
  }

  return {
    leftStart: Number(match[1]),
    rightStart: Number(match[2]),
  };
}

function buildWorkbenchCommonLinePairs(
  beforeLines: string[],
  afterLines: string[],
  matcher: (beforeLine: string, afterLine: string) => boolean,
) {
  const beforeLength = beforeLines.length;
  const afterLength = afterLines.length;
  const table = Array.from({ length: beforeLength + 1 }, () => Array<number>(afterLength + 1).fill(0));

  for (let beforeIndex = beforeLength - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLength - 1; afterIndex >= 0; afterIndex -= 1) {
      table[beforeIndex][afterIndex] =
        matcher(beforeLines[beforeIndex], afterLines[afterIndex])
          ? table[beforeIndex + 1][afterIndex + 1] + 1
          : Math.max(table[beforeIndex + 1][afterIndex], table[beforeIndex][afterIndex + 1]);
    }
  }

  const pairs: Array<{ beforeIndex: number; afterIndex: number }> = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeLength && afterIndex < afterLength) {
    if (matcher(beforeLines[beforeIndex], afterLines[afterIndex])) {
      pairs.push({ beforeIndex, afterIndex });
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    if (table[beforeIndex + 1][afterIndex] >= table[beforeIndex][afterIndex + 1]) {
      beforeIndex += 1;
    } else {
      afterIndex += 1;
    }
  }

  return pairs;
}

function buildWorkbenchChangedBlockRows(
  beforeLines: string[],
  afterLines: string[],
  beforeStart: number,
  beforeEnd: number,
  afterStart: number,
  afterEnd: number,
): WorkbenchSplitDiffRow[] {
  const beforeChunk = beforeLines.slice(beforeStart, beforeEnd);
  const afterChunk = afterLines.slice(afterStart, afterEnd);
  const similarPairs = buildWorkbenchCommonLinePairs(beforeChunk, afterChunk, areWorkbenchLinesSimilar);
  const rows: WorkbenchSplitDiffRow[] = [];
  let beforeIndex = beforeStart;
  let afterIndex = afterStart;

  for (const pair of similarPairs) {
    const absoluteBeforeIndex = beforeStart + pair.beforeIndex;
    const absoluteAfterIndex = afterStart + pair.afterIndex;

    rows.push(
      ...buildWorkbenchUnmatchedBlockRows(
        beforeLines,
        afterLines,
        beforeIndex,
        absoluteBeforeIndex,
        afterIndex,
        absoluteAfterIndex,
      ),
    );
    rows.push({
      type: 'content',
      leftLineNumber: absoluteBeforeIndex + 1,
      rightLineNumber: absoluteAfterIndex + 1,
      leftText: beforeLines[absoluteBeforeIndex] ?? '',
      rightText: afterLines[absoluteAfterIndex] ?? '',
      leftKind: 'removed',
      rightKind: 'added',
    });
    beforeIndex = absoluteBeforeIndex + 1;
    afterIndex = absoluteAfterIndex + 1;
  }

  rows.push(
    ...buildWorkbenchUnmatchedBlockRows(
      beforeLines,
      afterLines,
      beforeIndex,
      beforeEnd,
      afterIndex,
      afterEnd,
    ),
  );

  return rows;
}

function buildWorkbenchUnmatchedBlockRows(
  beforeLines: string[],
  afterLines: string[],
  beforeStart: number,
  beforeEnd: number,
  afterStart: number,
  afterEnd: number,
) {
  const rows: WorkbenchSplitDiffRow[] = [];

  for (let beforeIndex = beforeStart; beforeIndex < beforeEnd; beforeIndex += 1) {
    rows.push({
      type: 'content',
      leftLineNumber: beforeIndex + 1,
      rightLineNumber: null,
      leftText: beforeLines[beforeIndex] ?? '',
      rightText: '',
      leftKind: 'removed',
      rightKind: 'empty',
    });
  }

  for (let afterIndex = afterStart; afterIndex < afterEnd; afterIndex += 1) {
    rows.push({
      type: 'content',
      leftLineNumber: null,
      rightLineNumber: afterIndex + 1,
      leftText: '',
      rightText: afterLines[afterIndex] ?? '',
      leftKind: 'empty',
      rightKind: 'added',
    });
  }

  return rows;
}

function isWorkbenchContextRow(row: WorkbenchSplitDiffRow) {
  return row.type === 'content' && row.leftKind === 'context' && row.rightKind === 'context';
}

function areWorkbenchLinesSimilar(beforeLine: string, afterLine: string) {
  const normalizedBefore = normalizeComparableWorkbenchLine(beforeLine);
  const normalizedAfter = normalizeComparableWorkbenchLine(afterLine);
  return Boolean(normalizedBefore && normalizedAfter && normalizedBefore === normalizedAfter);
}

function normalizeComparableWorkbenchLine(line: string) {
  return line
    .trim()
    .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '$1$1')
    .replace(/\b\d+(?:\.\d+)?\b/g, '0')
    .replace(/\b(?:true|false|null|undefined)\b/g, 'value')
    .replace(/\s+/g, ' ');
}

function normalizeWorkbenchDiffContent(content: string) {
  if (!content) {
    return '';
  }

  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
