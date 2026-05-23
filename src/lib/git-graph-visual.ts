import type { GitHistoryGraphLaneSegment, GitHistoryGraphRow } from '../types';

export type GitGraphVisualLine = {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  colorIndex: number;
};

export type GitGraphVisualCurve = {
  key: string;
  d: string;
  colorIndex: number;
};

export type GitGraphVisualNode = {
  key: string;
  cx: number;
  cy: number;
  colorIndex: number;
};

export type GitGraphVisual = {
  width: number;
  height: number;
  lines: GitGraphVisualLine[];
  curves: GitGraphVisualCurve[];
  nodes: GitGraphVisualNode[];
};

export type GitGraphVisualOptions = {
  cellWidth?: number;
  graph?: GitHistoryGraphRow;
  height?: number;
  paddingX?: number;
};

export type GitGraphTimelineVisualOptions = {
  cellWidth?: number;
  paddingX?: number;
  rowHeight?: number;
};

const DEFAULT_CELL_WIDTH = 10;
const DEFAULT_HEIGHT = 52;
const DEFAULT_PADDING_X = 6;
const CONNECTOR_OVERDRAW = 1.5;

export function buildGitGraphVisual(graphText: string, options: GitGraphVisualOptions = {}): GitGraphVisual {
  if (options.graph) {
    return buildGitGraphLaneVisual(options.graph, options);
  }
  return buildGitGraphTextVisual(graphText, options);
}

export function buildGitGraphTimelineVisual(
  graphs: GitHistoryGraphRow[],
  options: GitGraphTimelineVisualOptions = {},
): GitGraphVisual {
  const cellWidth = options.cellWidth ?? DEFAULT_CELL_WIDTH;
  const rowHeight = options.rowHeight ?? DEFAULT_HEIGHT;
  const paddingX = options.paddingX ?? DEFAULT_PADDING_X;
  const lines: GitGraphVisualLine[] = [];
  const curves: GitGraphVisualCurve[] = [];
  const nodes: GitGraphVisualNode[] = [];
  const maxLane = Math.max(0, ...graphs.map(getMaxGraphLane));

  graphs.forEach((graph, rowIndex) => {
    const rowTop = rowIndex * rowHeight;
    const centerY = rowTop + rowHeight / 2;
    const rowBottom = rowTop + rowHeight;

    for (const segment of graph.segmentsBefore) {
      if (segment.kind !== 'vertical') {
        continue;
      }
      const x = resolveLaneX(segment.lane, cellWidth, paddingX);
      lines.push({
        key: `timeline-before-${rowIndex}-${segment.lane}-${segment.colorIndex}`,
        x1: x,
        y1: rowTop - CONNECTOR_OVERDRAW,
        x2: x,
        y2: centerY + CONNECTOR_OVERDRAW,
        colorIndex: segment.colorIndex,
      });
    }

    for (const [segmentIndex, segment] of graph.segmentsAfter.entries()) {
      appendTimelineGraphSegmentAfter(segment, rowIndex, segmentIndex, {
        cellWidth,
        centerY,
        curves,
        lines,
        paddingX,
        rowBottom,
      });
    }

    nodes.push({
      key: `timeline-node-${rowIndex}-${graph.lane}`,
      cx: resolveLaneX(graph.lane, cellWidth, paddingX),
      cy: centerY,
      colorIndex: graph.colorIndex,
    });
  });

  return {
    width: paddingX * 2 + (maxLane + 1) * cellWidth,
    height: graphs.length * rowHeight,
    lines,
    curves,
    nodes,
  };
}

function buildGitGraphLaneVisual(graph: GitHistoryGraphRow, options: GitGraphVisualOptions): GitGraphVisual {
  const cellWidth = options.cellWidth ?? DEFAULT_CELL_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const paddingX = options.paddingX ?? DEFAULT_PADDING_X;
  const centerY = height / 2;
  const maxLane = getMaxGraphLane(graph);
  const lines: GitGraphVisualLine[] = [];
  const curves: GitGraphVisualCurve[] = [];
  const nodes: GitGraphVisualNode[] = [];

  for (const segment of graph.segmentsBefore) {
    if (segment.kind !== 'vertical') {
      continue;
    }
    const x = resolveLaneX(segment.lane, cellWidth, paddingX);
    lines.push({
      key: `before-${segment.lane}-${segment.colorIndex}`,
      x1: x,
      y1: -CONNECTOR_OVERDRAW,
      x2: x,
      y2: centerY + CONNECTOR_OVERDRAW,
      colorIndex: segment.colorIndex,
    });
  }

  for (const [index, segment] of graph.segmentsAfter.entries()) {
    appendGraphSegmentAfter(segment, index, {
      cellWidth,
      centerY,
      curves,
      height,
      lines,
      paddingX,
    });
  }

  nodes.push({
    key: `node-${graph.lane}`,
    cx: resolveLaneX(graph.lane, cellWidth, paddingX),
    cy: centerY,
    colorIndex: graph.colorIndex,
  });

  return {
    width: paddingX * 2 + (maxLane + 1) * cellWidth,
    height,
    lines,
    curves,
    nodes,
  };
}

type AppendGraphSegmentContext = {
  cellWidth: number;
  centerY: number;
  curves: GitGraphVisualCurve[];
  height: number;
  lines: GitGraphVisualLine[];
  paddingX: number;
};

type AppendTimelineGraphSegmentContext = {
  cellWidth: number;
  centerY: number;
  curves: GitGraphVisualCurve[];
  lines: GitGraphVisualLine[];
  paddingX: number;
  rowBottom: number;
};

function appendGraphSegmentAfter(
  segment: GitHistoryGraphLaneSegment,
  index: number,
  context: AppendGraphSegmentContext,
) {
  if (segment.kind === 'end') {
    return;
  }

  const targetX = resolveLaneX(segment.lane, context.cellWidth, context.paddingX);
  const sourceLane = segment.fromLane ?? segment.lane;
  const sourceX = resolveLaneX(sourceLane, context.cellWidth, context.paddingX);

  if (segment.kind === 'vertical' || sourceLane === segment.lane) {
    context.lines.push({
      key: `after-${segment.lane}-${index}`,
      x1: targetX,
      y1: context.centerY - CONNECTOR_OVERDRAW,
      x2: targetX,
      y2: context.height + CONNECTOR_OVERDRAW,
      colorIndex: segment.colorIndex,
    });
    return;
  }

  context.curves.push({
    key: `after-curve-${sourceLane}-${segment.lane}-${index}`,
    d: buildGitGraphCurvePath(
      sourceX,
      context.centerY - CONNECTOR_OVERDRAW,
      targetX,
      context.height + CONNECTOR_OVERDRAW,
    ),
    colorIndex: segment.colorIndex,
  });
}

function appendTimelineGraphSegmentAfter(
  segment: GitHistoryGraphLaneSegment,
  rowIndex: number,
  segmentIndex: number,
  context: AppendTimelineGraphSegmentContext,
) {
  if (segment.kind === 'end') {
    return;
  }

  const targetX = resolveLaneX(segment.lane, context.cellWidth, context.paddingX);
  const sourceLane = segment.fromLane ?? segment.lane;
  const sourceX = resolveLaneX(sourceLane, context.cellWidth, context.paddingX);

  if (segment.kind === 'vertical' || sourceLane === segment.lane) {
    context.lines.push({
      key: `timeline-after-${rowIndex}-${segment.lane}-${segmentIndex}`,
      x1: targetX,
      y1: context.centerY - CONNECTOR_OVERDRAW,
      x2: targetX,
      y2: context.rowBottom + CONNECTOR_OVERDRAW,
      colorIndex: segment.colorIndex,
    });
    return;
  }

  context.curves.push({
    key: `timeline-after-curve-${rowIndex}-${sourceLane}-${segment.lane}-${segmentIndex}`,
    d: buildGitGraphCurvePath(
      sourceX,
      context.centerY - CONNECTOR_OVERDRAW,
      targetX,
      context.rowBottom + CONNECTOR_OVERDRAW,
    ),
    colorIndex: segment.colorIndex,
  });
}

function getMaxGraphLane(graph: GitHistoryGraphRow) {
  return Math.max(
    graph.lane,
    ...graph.segmentsBefore.map((segment) => segment.lane),
    ...graph.segmentsAfter.flatMap((segment) => [segment.lane, segment.fromLane ?? segment.lane]),
  );
}

function resolveLaneX(lane: number, cellWidth: number, paddingX: number) {
  return paddingX + lane * cellWidth + cellWidth / 2;
}

function buildGitGraphTextVisual(graphText: string, options: GitGraphVisualOptions): GitGraphVisual {
  const cellWidth = options.cellWidth ?? DEFAULT_CELL_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const paddingX = options.paddingX ?? DEFAULT_PADDING_X;
  const rows = normalizeGitGraphRows(graphText);
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const rowStep = height / rows.length;
  const halfRowStep = rowStep / 2;
  const lines: GitGraphVisualLine[] = [];
  const curves: GitGraphVisualCurve[] = [];
  const nodes: GitGraphVisualNode[] = [];

  rows.forEach((row, rowIndex) => {
    const y = halfRowStep + rowIndex * rowStep;
    [...row].forEach((char, columnIndex) => {
      const x = paddingX + columnIndex * cellWidth + cellWidth / 2;
      const colorIndex = resolveGitGraphColumnColorIndex(columnIndex);

      if (char === '*') {
        lines.push({
          key: `node-stem-${rowIndex}-${columnIndex}`,
          x1: x,
          y1: (rowIndex === 0 ? 0 : y - halfRowStep) - CONNECTOR_OVERDRAW,
          x2: x,
          y2: (rowIndex === rows.length - 1 ? height : y + halfRowStep) + CONNECTOR_OVERDRAW,
          colorIndex,
        });
        nodes.push({
          key: `node-${rowIndex}-${columnIndex}`,
          cx: x,
          cy: y,
          colorIndex,
        });
        return;
      }

      if (char === '|') {
        lines.push({
          key: `vertical-${rowIndex}-${columnIndex}`,
          x1: x,
          y1: (rowIndex === 0 ? 0 : y - halfRowStep) - CONNECTOR_OVERDRAW,
          x2: x,
          y2: (rowIndex === rows.length - 1 ? height : y + halfRowStep) + CONNECTOR_OVERDRAW,
          colorIndex,
        });
        return;
      }

      if (char === '\\') {
        const startX = x - cellWidth;
        const startY = y - halfRowStep;
        const endX = x + cellWidth;
        const endY = y + halfRowStep;
        curves.push({
          key: `down-right-${rowIndex}-${columnIndex}`,
          d: buildGitGraphCurvePath(startX, startY - CONNECTOR_OVERDRAW, endX, endY + CONNECTOR_OVERDRAW),
          colorIndex,
        });
        return;
      }

      if (char === '/') {
        const startX = x + cellWidth;
        const startY = y - halfRowStep;
        const endX = x - cellWidth;
        const endY = y + halfRowStep;
        curves.push({
          key: `down-left-${rowIndex}-${columnIndex}`,
          d: buildGitGraphCurvePath(startX, startY - CONNECTOR_OVERDRAW, endX, endY + CONNECTOR_OVERDRAW),
          colorIndex,
        });
        return;
      }

      if (char === '_' || char === '-') {
        lines.push({
          key: `horizontal-${rowIndex}-${columnIndex}`,
          x1: x - cellWidth / 2,
          y1: y,
          x2: x + cellWidth / 2,
          y2: y,
          colorIndex,
        });
      }
    });
  });

  return {
    width: paddingX * 2 + columnCount * cellWidth,
    height,
    lines,
    curves,
    nodes,
  };
}

function buildGitGraphCurvePath(startX: number, startY: number, endX: number, endY: number) {
  const curveY = Math.abs(endY - startY) * 0.58;
  return [
    `M ${formatPathNumber(startX)} ${formatPathNumber(startY)}`,
    `C ${formatPathNumber(startX)} ${formatPathNumber(startY + curveY)}`,
    `${formatPathNumber(endX)} ${formatPathNumber(endY - curveY)}`,
    `${formatPathNumber(endX)} ${formatPathNumber(endY)}`,
  ].join(' ');
}

function formatPathNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function normalizeGitGraphRows(graphText: string) {
  const rows = graphText
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  return rows.length > 0 ? rows : ['*'];
}

function resolveGitGraphColumnColorIndex(columnIndex: number) {
  return Math.floor(columnIndex / 2);
}
