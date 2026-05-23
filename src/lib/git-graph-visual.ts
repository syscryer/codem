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

export type VsCodeGitGraphTimelineCommit = {
  id: string;
  parentIds: string[];
};

export type VsCodeGitGraphTimelineOptions = {
  rowHeight?: number;
  swimlaneWidth?: number;
};

export type GitGraphTimelineColumnWidthOptions = {
  cellWidth?: number;
  minWidth?: number;
  paddingX?: number;
  trailingGap?: number;
};

const DEFAULT_CELL_WIDTH = 10;
const DEFAULT_HEIGHT = 52;
const DEFAULT_PADDING_X = 6;
const DEFAULT_TIMELINE_COLUMN_MIN_WIDTH = 32;
const DEFAULT_TIMELINE_COLUMN_TRAILING_GAP = 10;
const CONNECTOR_OVERDRAW = 1.5;
// Adapted from VS Code's MIT-licensed SCM history swimlane graph renderer.
// Matches its swimlane spacing and curve radius.
const VSCODE_SWIMLANE_WIDTH = 11;
const VSCODE_SWIMLANE_CURVE_RADIUS = 5;

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
  if (graphs.length > 0) {
    const primaryLaneX = resolveLaneX(0, cellWidth, paddingX);
    lines.push({
      key: 'timeline-primary-lane-0',
      x1: primaryLaneX,
      y1: -CONNECTOR_OVERDRAW,
      x2: primaryLaneX,
      y2: graphs.length * rowHeight + CONNECTOR_OVERDRAW,
      colorIndex: resolvePrimaryLaneColorIndex(graphs),
    });
  }

  graphs.forEach((graph, rowIndex) => {
    const rowTop = rowIndex * rowHeight;
    const centerY = rowTop + rowHeight / 2;
    const rowBottom = rowTop + rowHeight;

    for (const segment of graph.segmentsBefore) {
      if (segment.kind !== 'vertical') {
        continue;
      }
      const x = resolveLaneX(segment.lane, cellWidth, paddingX);
      const y1 = resolveTimelineBeforeStartY(graphs, rowIndex, segment, rowTop, rowHeight);
      lines.push({
        key: `timeline-before-${rowIndex}-${segment.lane}-${segment.colorIndex}`,
        x1: x,
        y1,
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

export function buildVsCodeGitGraphTimelineVisual(
  commits: VsCodeGitGraphTimelineCommit[],
  options: VsCodeGitGraphTimelineOptions = {},
): GitGraphVisual {
  const rowHeight = options.rowHeight ?? DEFAULT_HEIGHT;
  const swimlaneWidth = options.swimlaneWidth ?? VSCODE_SWIMLANE_WIDTH;
  const lines: GitGraphVisualLine[] = [];
  const curves: GitGraphVisualCurve[] = [];
  const nodes: GitGraphVisualNode[] = [];
  let maxColumnCount = 1;
  const viewModels = buildVsCodeGitGraphViewModels(commits);

  viewModels.forEach((viewModel, rowIndex) => {
    const columnCount = appendVsCodeGitGraphRowVisual(viewModel, rowIndex, {
      curves,
      lines,
      nodes,
      rowTop: rowIndex * rowHeight,
      rowHeight,
      swimlaneWidth,
    });
    maxColumnCount = Math.max(maxColumnCount, columnCount);
  });

  return {
    width: swimlaneWidth * (maxColumnCount + 1),
    height: commits.length * rowHeight,
    lines,
    curves,
    nodes,
  };
}

export function buildVsCodeGitGraphRowVisuals(
  commits: VsCodeGitGraphTimelineCommit[],
  options: VsCodeGitGraphTimelineOptions = {},
): GitGraphVisual[] {
  const rowHeight = options.rowHeight ?? DEFAULT_HEIGHT;
  const swimlaneWidth = options.swimlaneWidth ?? VSCODE_SWIMLANE_WIDTH;
  const viewModels = buildVsCodeGitGraphViewModels(commits);

  return viewModels.map((viewModel, rowIndex) => {
    const lines: GitGraphVisualLine[] = [];
    const curves: GitGraphVisualCurve[] = [];
    const nodes: GitGraphVisualNode[] = [];
    const columnCount = appendVsCodeGitGraphRowVisual(viewModel, rowIndex, {
      curves,
      lines,
      nodes,
      rowTop: 0,
      rowHeight,
      swimlaneWidth,
    });

    return {
      width: swimlaneWidth * (columnCount + 1),
      height: rowHeight,
      lines,
      curves,
      nodes,
    };
  });
}

export function resolveGitGraphTimelineColumnWidth(
  graphs: GitHistoryGraphRow[],
  options: GitGraphTimelineColumnWidthOptions = {},
) {
  const cellWidth = options.cellWidth ?? DEFAULT_CELL_WIDTH;
  const paddingX = options.paddingX ?? DEFAULT_PADDING_X;
  const minWidth = options.minWidth ?? DEFAULT_TIMELINE_COLUMN_MIN_WIDTH;
  const trailingGap = options.trailingGap ?? DEFAULT_TIMELINE_COLUMN_TRAILING_GAP;
  const maxLane = Math.max(0, ...graphs.map(getMaxGraphLane));
  const visualWidth = paddingX * 2 + (maxLane + 1) * cellWidth;

  return Math.max(minWidth, Math.ceil(visualWidth + trailingGap));
}

type VsCodeGitGraphSwimlaneNode = {
  id: string;
  colorIndex: number;
};

type VsCodeGitGraphViewModel = {
  commit: VsCodeGitGraphTimelineCommit;
  inputSwimlanes: VsCodeGitGraphSwimlaneNode[];
  outputSwimlanes: VsCodeGitGraphSwimlaneNode[];
};

type AppendVsCodeGitGraphRowVisualContext = {
  curves: GitGraphVisualCurve[];
  lines: GitGraphVisualLine[];
  nodes: GitGraphVisualNode[];
  rowTop: number;
  rowHeight: number;
  swimlaneWidth: number;
};

function appendVsCodeGitGraphRowVisual(
  viewModel: VsCodeGitGraphViewModel,
  rowIndex: number,
  context: AppendVsCodeGitGraphRowVisualContext,
) {
  const rowTop = context.rowTop;
  const centerY = rowTop + context.rowHeight / 2;
  const rowBottom = rowTop + context.rowHeight;
  const { commit, inputSwimlanes, outputSwimlanes } = viewModel;
  const inputIndex = inputSwimlanes.findIndex((node) => node.id === commit.id);
  const circleIndex = inputIndex !== -1 ? inputIndex : inputSwimlanes.length;
  const circleColorIndex =
    outputSwimlanes[circleIndex]?.colorIndex ??
    inputSwimlanes[circleIndex]?.colorIndex ??
    0;
  let outputSwimlaneIndex = 0;

  inputSwimlanes.forEach((inputNode, index) => {
    const inputX = resolveVsCodeSwimlaneX(index, context.swimlaneWidth);
    if (inputNode.id === commit.id) {
      if (index !== circleIndex) {
        context.curves.push({
          key: `vscode-base-${rowIndex}-${index}`,
          d: buildVsCodeBasePath(
            inputX,
            resolveVsCodeSwimlaneX(circleIndex, context.swimlaneWidth),
            rowTop,
            centerY,
            context.swimlaneWidth,
          ),
          colorIndex: inputNode.colorIndex,
        });
      } else {
        outputSwimlaneIndex += 1;
      }
      return;
    }

    const outputNode = outputSwimlanes[outputSwimlaneIndex];
    if (!outputNode || inputNode.id !== outputNode.id) {
      return;
    }

    if (index === outputSwimlaneIndex) {
      context.lines.push({
        key: `vscode-swimlane-${rowIndex}-${index}`,
        x1: inputX,
        y1: rowTop,
        x2: inputX,
        y2: rowBottom,
        colorIndex: inputNode.colorIndex,
      });
    } else {
      context.curves.push({
        key: `vscode-shift-${rowIndex}-${index}-${outputSwimlaneIndex}`,
        d: buildVsCodeShiftPath(
          inputX,
          resolveVsCodeSwimlaneX(outputSwimlaneIndex, context.swimlaneWidth),
          rowTop,
          centerY,
          rowBottom,
        ),
        colorIndex: inputNode.colorIndex,
      });
    }

    outputSwimlaneIndex += 1;
  });

  for (let parentIndex = 1; parentIndex < commit.parentIds.length; parentIndex += 1) {
    const parentOutputIndex = findLastVsCodeSwimlaneIndex(outputSwimlanes, commit.parentIds[parentIndex]);
    if (parentOutputIndex === -1) {
      continue;
    }
    context.curves.push({
      key: `vscode-merge-${rowIndex}-${parentIndex}`,
      d: buildVsCodeMergePath(
        parentOutputIndex,
        circleIndex,
        context.swimlaneWidth,
        centerY,
        rowBottom,
      ),
      colorIndex: outputSwimlanes[parentOutputIndex].colorIndex,
    });
  }

  const circleX = resolveVsCodeSwimlaneX(circleIndex, context.swimlaneWidth);
  if (inputIndex !== -1) {
    context.lines.push({
      key: `vscode-node-before-${rowIndex}`,
      x1: circleX,
      y1: rowTop,
      x2: circleX,
      y2: centerY,
      colorIndex: inputSwimlanes[inputIndex].colorIndex,
    });
  }
  if (commit.parentIds.length > 0) {
    context.lines.push({
      key: `vscode-node-after-${rowIndex}`,
      x1: circleX,
      y1: centerY,
      x2: circleX,
      y2: rowBottom,
      colorIndex: circleColorIndex,
    });
  }
  context.nodes.push({
    key: `vscode-node-${rowIndex}-${circleIndex}`,
    cx: circleX,
    cy: centerY,
    colorIndex: circleColorIndex,
  });

  return Math.max(inputSwimlanes.length, outputSwimlanes.length, 1);
}

function buildVsCodeGitGraphViewModels(commits: VsCodeGitGraphTimelineCommit[]): VsCodeGitGraphViewModel[] {
  let nextColorIndex = 1;
  const viewModels: VsCodeGitGraphViewModel[] = [];

  for (const commit of commits) {
    const inputSwimlanes = viewModels.at(-1)?.outputSwimlanes.map(cloneVsCodeSwimlaneNode) ?? [];
    const outputSwimlanes: VsCodeGitGraphSwimlaneNode[] = [];
    const inputIndex = inputSwimlanes.findIndex((node) => node.id === commit.id);
    let firstParentAdded = false;

    if (commit.parentIds.length > 0) {
      for (const node of inputSwimlanes) {
        if (node.id === commit.id) {
          if (!firstParentAdded) {
            outputSwimlanes.push({
              id: commit.parentIds[0],
              colorIndex: node.colorIndex,
            });
            firstParentAdded = true;
          }
          continue;
        }
        outputSwimlanes.push(cloneVsCodeSwimlaneNode(node));
      }
    }

    for (let parentIndex = firstParentAdded ? 1 : 0; parentIndex < commit.parentIds.length; parentIndex += 1) {
      const colorIndex = parentIndex === 0
        ? inputSwimlanes[inputIndex]?.colorIndex ?? 0
        : nextColorIndex;
      outputSwimlanes.push({
        id: commit.parentIds[parentIndex],
        colorIndex,
      });
      if (parentIndex > 0) {
        nextColorIndex = (nextColorIndex + 1) % 8;
        if (nextColorIndex === 0) {
          nextColorIndex = 1;
        }
      }
    }

    viewModels.push({
      commit,
      inputSwimlanes,
      outputSwimlanes,
    });
  }

  return viewModels;
}

function cloneVsCodeSwimlaneNode(node: VsCodeGitGraphSwimlaneNode): VsCodeGitGraphSwimlaneNode {
  return { id: node.id, colorIndex: node.colorIndex };
}

function resolveVsCodeSwimlaneX(index: number, swimlaneWidth: number) {
  return swimlaneWidth * (index + 1);
}

function findLastVsCodeSwimlaneIndex(nodes: VsCodeGitGraphSwimlaneNode[], id: string) {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (nodes[index].id === id) {
      return index;
    }
  }
  return -1;
}

function buildVsCodeBasePath(startX: number, endX: number, rowTop: number, centerY: number, swimlaneWidth: number) {
  return [
    `M ${formatPathNumber(startX)} ${formatPathNumber(rowTop)}`,
    `A ${formatPathNumber(swimlaneWidth)} ${formatPathNumber(swimlaneWidth)} 0 0 1`,
    `${formatPathNumber(startX - swimlaneWidth)} ${formatPathNumber(centerY)}`,
    `H ${formatPathNumber(endX)}`,
  ].join(' ');
}

function buildVsCodeShiftPath(startX: number, endX: number, rowTop: number, centerY: number, rowBottom: number) {
  const direction = endX >= startX ? 1 : -1;
  const firstArcEndX = startX + direction * VSCODE_SWIMLANE_CURVE_RADIUS;
  const secondArcStartX = endX - direction * VSCODE_SWIMLANE_CURVE_RADIUS;
  const firstSweep = direction > 0 ? 0 : 1;
  const secondSweep = direction > 0 ? 1 : 0;
  return [
    `M ${formatPathNumber(startX)} ${formatPathNumber(rowTop)}`,
    `V ${formatPathNumber(centerY - VSCODE_SWIMLANE_CURVE_RADIUS)}`,
    `A ${VSCODE_SWIMLANE_CURVE_RADIUS} ${VSCODE_SWIMLANE_CURVE_RADIUS} 0 0 ${firstSweep}`,
    `${formatPathNumber(firstArcEndX)} ${formatPathNumber(centerY)}`,
    `H ${formatPathNumber(secondArcStartX)}`,
    `A ${VSCODE_SWIMLANE_CURVE_RADIUS} ${VSCODE_SWIMLANE_CURVE_RADIUS} 0 0 ${secondSweep}`,
    `${formatPathNumber(endX)} ${formatPathNumber(centerY + VSCODE_SWIMLANE_CURVE_RADIUS)}`,
    `V ${formatPathNumber(rowBottom)}`,
  ].join(' ');
}

function buildVsCodeMergePath(
  parentOutputIndex: number,
  circleIndex: number,
  swimlaneWidth: number,
  centerY: number,
  rowBottom: number,
) {
  const startX = swimlaneWidth * parentOutputIndex;
  const parentX = resolveVsCodeSwimlaneX(parentOutputIndex, swimlaneWidth);
  const circleX = resolveVsCodeSwimlaneX(circleIndex, swimlaneWidth);
  return [
    `M ${formatPathNumber(startX)} ${formatPathNumber(centerY)}`,
    `A ${formatPathNumber(swimlaneWidth)} ${formatPathNumber(swimlaneWidth)} 0 0 1`,
    `${formatPathNumber(parentX)} ${formatPathNumber(rowBottom)}`,
    `M ${formatPathNumber(startX)} ${formatPathNumber(centerY)}`,
    `H ${formatPathNumber(circleX)}`,
  ].join(' ');
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

function resolveTimelineBeforeStartY(
  graphs: GitHistoryGraphRow[],
  rowIndex: number,
  segment: GitHistoryGraphLaneSegment,
  rowTop: number,
  rowHeight: number,
) {
  if (rowIndex === 0) {
    return rowTop - CONNECTOR_OVERDRAW;
  }

  const previousGraph = graphs[rowIndex - 1];
  const previousSegmentAfter = previousGraph.segmentsAfter.find(
    (candidate) => candidate.lane === segment.lane && candidate.colorIndex === segment.colorIndex,
  );
  if (previousSegmentAfter) {
    return rowTop - CONNECTOR_OVERDRAW;
  }

  const previousLaneWasActive =
    (previousGraph.lane === segment.lane && previousGraph.colorIndex === segment.colorIndex) ||
    previousGraph.segmentsBefore.some(
      (candidate) => candidate.lane === segment.lane && candidate.colorIndex === segment.colorIndex,
    );

  if (!previousLaneWasActive) {
    return rowTop - CONNECTOR_OVERDRAW;
  }

  return rowTop - rowHeight / 2 - CONNECTOR_OVERDRAW;
}

function resolvePrimaryLaneColorIndex(graphs: GitHistoryGraphRow[]) {
  for (const graph of graphs) {
    if (graph.lane === 0) {
      return graph.colorIndex;
    }
    const segment =
      graph.segmentsBefore.find((candidate) => candidate.lane === 0) ??
      graph.segmentsAfter.find((candidate) => candidate.lane === 0);
    if (segment) {
      return segment.colorIndex;
    }
  }
  return 0;
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
