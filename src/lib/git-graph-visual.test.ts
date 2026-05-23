import assert from 'node:assert/strict';
import test from 'node:test';
import * as gitGraphVisual from './git-graph-visual';

const { buildGitGraphTimelineVisual, buildGitGraphVisual } = gitGraphVisual;

test('buildGitGraphVisual turns commit markers into nodes', () => {
  const visual = buildGitGraphVisual('*', { cellWidth: 10, height: 40, paddingX: 5 });

  assert.equal(visual.nodes.length, 1);
  assert.equal(visual.nodes[0].cx, 10);
  assert.equal(visual.nodes[0].cy, 20);
  assert.equal(visual.lines.length, 1);
  assert.equal(visual.lines[0].x1, 10);
  assert.equal(visual.lines[0].y1, -1.5);
  assert.equal(visual.lines[0].y2, 41.5);
});

test('buildGitGraphVisual connects vertical graph lines through the row', () => {
  const visual = buildGitGraphVisual('| *', { cellWidth: 10, height: 40, paddingX: 5 });
  const vertical = visual.lines.find((line) => line.key.startsWith('vertical'));

  assert.equal(vertical?.x1, 10);
  assert.equal(vertical?.y1, -1.5);
  assert.equal(vertical?.x2, 10);
  assert.equal(vertical?.y2, 41.5);
});

test('buildGitGraphVisual creates diagonal segments for git merge routing', () => {
  const visual = buildGitGraphVisual('|\\\n| *', { cellWidth: 10, height: 40, paddingX: 5 });
  const diagonal = visual.curves.find((curve) => curve.key.startsWith('down-right'));

  assert.equal(diagonal?.d, 'M 10 -1.50 C 10 11.84 30 8.16 30 21.50');
  assert.equal(visual.lines.some((line) => line.key.startsWith('down-right')), false);
  assert.equal(visual.nodes.length, 1);
  assert.equal(visual.nodes[0].cy, 30);
});

test('buildGitGraphVisual creates curved paths for both merge directions', () => {
  const visual = buildGitGraphVisual('/\n\\', { cellWidth: 10, height: 40, paddingX: 5 });
  const downLeft = visual.curves.find((curve) => curve.key.startsWith('down-left'));
  const downRight = visual.curves.find((curve) => curve.key.startsWith('down-right'));

  assert.equal(downLeft?.d, 'M 20 -1.50 C 20 11.84 0 8.16 0 21.50');
  assert.equal(downRight?.d, 'M 0 18.50 C 0 31.84 20 28.16 20 41.50');
});

test('buildGitGraphVisual uses graph lanes to keep fixed-row commits connected', () => {
  const visual = buildGitGraphVisual('*', {
    cellWidth: 10,
    graph: {
      lane: 1,
      colorIndex: 2,
      segmentsBefore: [
        { lane: 0, colorIndex: 0, kind: 'vertical' },
        { lane: 1, colorIndex: 2, kind: 'vertical' },
      ],
      segmentsAfter: [
        { lane: 0, colorIndex: 0, kind: 'vertical' },
        { lane: 2, fromLane: 1, colorIndex: 2, kind: 'shift-right' },
      ],
    },
    height: 40,
    paddingX: 5,
  });

  const node = visual.nodes[0];
  const shifted = visual.curves.find((curve) => curve.key.startsWith('after-curve-1-2'));

  assert.equal(node.cx, 20);
  assert.equal(node.cy, 20);
  assert.equal(shifted?.d, 'M 20 18.50 C 20 31.84 30 28.16 30 41.50');
  assert.equal(visual.lines.some((line) => line.x1 === 10 && line.y1 === -1.5 && line.y2 === 21.5), true);
  assert.equal(visual.lines.some((line) => line.x1 === 10 && line.y1 === 18.5 && line.y2 === 41.5), true);
});

test('buildGitGraphTimelineVisual renders all rows in one continuous coordinate system', () => {
  const visual = buildGitGraphTimelineVisual(
    [
      {
        lane: 0,
        colorIndex: 0,
        segmentsBefore: [{ lane: 0, colorIndex: 0, kind: 'vertical' }],
        segmentsAfter: [{ lane: 0, colorIndex: 0, kind: 'vertical' }],
      },
      {
        lane: 0,
        colorIndex: 0,
        segmentsBefore: [{ lane: 0, colorIndex: 0, kind: 'vertical' }],
        segmentsAfter: [{ lane: 1, fromLane: 0, colorIndex: 0, kind: 'shift-right' }],
      },
    ],
    { cellWidth: 10, paddingX: 5, rowHeight: 40 },
  );

  const firstRowAfter = visual.lines.find((line) => line.key === 'timeline-after-0-0-0');
  const secondRowBefore = visual.lines.find((line) => line.key === 'timeline-before-1-0-0');
  const shift = visual.curves.find((curve) => curve.key === 'timeline-after-curve-1-0-1-0');

  assert.equal(visual.height, 80);
  assert.equal(firstRowAfter?.y2, 41.5);
  assert.equal(secondRowBefore?.y1, 38.5);
  assert.equal(shift?.d, 'M 10 58.50 C 10 71.84 20 68.16 20 81.50');
  assert.deepEqual(visual.nodes.map((node) => node.cy), [20, 60]);
});

test('resolveGitGraphTimelineColumnWidth keeps sparse graph lanes compact', () => {
  assert.equal(typeof gitGraphVisual.resolveGitGraphTimelineColumnWidth, 'function');

  const columnWidth = gitGraphVisual.resolveGitGraphTimelineColumnWidth([
    {
      lane: 0,
      colorIndex: 0,
      segmentsBefore: [{ lane: 0, colorIndex: 0, kind: 'vertical' }],
      segmentsAfter: [{ lane: 0, colorIndex: 0, kind: 'vertical' }],
    },
    {
      lane: 1,
      colorIndex: 1,
      segmentsBefore: [
        { lane: 0, colorIndex: 0, kind: 'vertical' },
        { lane: 1, colorIndex: 1, kind: 'vertical' },
      ],
      segmentsAfter: [{ lane: 0, fromLane: 1, colorIndex: 1, kind: 'shift-left' }],
    },
  ]);

  assert.equal(columnWidth, 42);
});

test('buildGitGraphTimelineVisual bridges consecutive before-only lane rows', () => {
  const visual = buildGitGraphTimelineVisual(
    [
      {
        lane: 0,
        colorIndex: 0,
        segmentsBefore: [{ lane: 0, colorIndex: 0, kind: 'vertical' }],
        segmentsAfter: [],
      },
      {
        lane: 0,
        colorIndex: 0,
        segmentsBefore: [{ lane: 0, colorIndex: 0, kind: 'vertical' }],
        segmentsAfter: [],
      },
    ],
    { cellWidth: 10, paddingX: 5, rowHeight: 40 },
  );

  const secondRowBefore = visual.lines.find((line) => line.key === 'timeline-before-1-0-0');

  assert.equal(secondRowBefore?.y1, 18.5);
  assert.equal(secondRowBefore?.y2, 61.5);
});

test('buildGitGraphTimelineVisual keeps the primary lane continuous like VS Code', () => {
  const visual = buildGitGraphTimelineVisual(
    [
      {
        lane: 0,
        colorIndex: 0,
        segmentsBefore: [{ lane: 0, colorIndex: 0, kind: 'vertical' }],
        segmentsAfter: [],
      },
      {
        lane: 1,
        colorIndex: 1,
        segmentsBefore: [{ lane: 1, colorIndex: 1, kind: 'vertical' }],
        segmentsAfter: [],
      },
      {
        lane: 0,
        colorIndex: 0,
        segmentsBefore: [{ lane: 0, colorIndex: 0, kind: 'vertical' }],
        segmentsAfter: [],
      },
    ],
    { cellWidth: 10, paddingX: 5, rowHeight: 40 },
  );

  const primaryLane = visual.lines.find((line) => line.key === 'timeline-primary-lane-0');

  assert.equal(primaryLane?.x1, 10);
  assert.equal(primaryLane?.x2, 10);
  assert.equal(primaryLane?.y1, -1.5);
  assert.equal(primaryLane?.y2, 121.5);
  assert.equal(primaryLane?.colorIndex, 0);
});

test('buildVsCodeGitGraphTimelineVisual builds swimlane graph from commit parents', () => {
  assert.equal(typeof gitGraphVisual.buildVsCodeGitGraphTimelineVisual, 'function');

  const visual = gitGraphVisual.buildVsCodeGitGraphTimelineVisual(
    [
      { id: 'merge', parentIds: ['main', 'feature'] },
      { id: 'main', parentIds: ['base'] },
      { id: 'feature', parentIds: ['base'] },
      { id: 'base', parentIds: [] },
    ],
    { rowHeight: 34 },
  );

  assert.equal(visual.height, 136);
  assert.equal(visual.width, 33);
  assert.deepEqual(visual.nodes.map((node) => [node.cx, node.cy, node.colorIndex]), [
    [11, 17, 0],
    [11, 51, 0],
    [22, 85, 1],
    [11, 119, 0],
  ]);
  assert.equal(
    visual.lines.some((line) => line.key === 'vscode-node-before-1' && line.x1 === 11 && line.y1 === 34 && line.y2 === 51),
    true,
  );
  assert.equal(
    visual.lines.some((line) => line.key === 'vscode-node-after-1' && line.x1 === 11 && line.y1 === 51 && line.y2 === 68),
    true,
  );
  assert.equal(
    visual.curves.some((curve) => curve.key === 'vscode-merge-0-1' && curve.d.includes('H 11')),
    true,
  );
});

test('buildVsCodeGitGraphTimelineVisual uses VS Code arc direction when a lane shifts left', () => {
  const visual = gitGraphVisual.buildVsCodeGitGraphTimelineVisual(
    [
      { id: 'a', parentIds: ['b', 'c', 'x'] },
      { id: 'c', parentIds: ['b'] },
      { id: 'b', parentIds: ['e'] },
      { id: 'x', parentIds: [] },
      { id: 'e', parentIds: [] },
    ],
    { rowHeight: 34 },
  );

  const shiftLeft = visual.curves.find((curve) => curve.key === 'vscode-shift-2-2-1');

  assert.equal(shiftLeft?.d, 'M 33 68 V 80 A 5 5 0 0 1 28 85 H 27 A 5 5 0 0 0 22 90 V 102');
});

test('buildVsCodeGitGraphRowVisuals keeps each row as narrow as VS Code does', () => {
  assert.equal(typeof gitGraphVisual.buildVsCodeGitGraphRowVisuals, 'function');

  const rows = gitGraphVisual.buildVsCodeGitGraphRowVisuals(
    [
      { id: 'a', parentIds: ['b', 'c'] },
      { id: 'b', parentIds: ['d'] },
      { id: 'c', parentIds: ['d'] },
      { id: 'd', parentIds: ['e'] },
      { id: 'e', parentIds: [] },
    ],
    { rowHeight: 34 },
  );

  assert.deepEqual(rows.map((row) => row.width), [33, 33, 33, 33, 22]);
  assert.deepEqual(rows[4].nodes.map((node) => [node.cx, node.cy]), [[11, 17]]);
});
