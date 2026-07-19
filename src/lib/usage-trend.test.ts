import assert from 'node:assert/strict';
import test from 'node:test';
import type { UsageTrendPoint } from '../types';
import { buildUsageTrendBuckets } from './usage-trend';

const emptyPointTotals = {
  projects: 0,
  threads: 0,
  messages: 0,
  toolCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  totalTokens: 0,
  durationMs: 0,
  totalCostUsd: 0,
};

test('buildUsageTrendBuckets fills fixed day ranges through the selected current date', () => {
  const source: UsageTrendPoint[] = [
    {
      date: '2026-06-01',
      ...emptyPointTotals,
      threads: 2,
      totalTokens: 2_100_000,
      totalCostUsd: 22.13,
      durationMs: 591_000,
    },
  ];

  const result = buildUsageTrendBuckets(source, 7, '2026-06-02T12:00:00.000Z');

  assert.equal(result.unit, 'day');
  assert.equal(result.points.length, 7);
  assert.equal(result.points[0].date, '2026-05-27');
  assert.equal(result.points[5].date, '2026-06-01');
  assert.equal(result.points[5].totalTokens, 2_100_000);
  assert.equal(result.points[6].date, '2026-06-02');
  assert.equal(result.points[6].totalTokens, 0);
});

test('buildUsageTrendBuckets returns a single current-day point for today range', () => {
  const source: UsageTrendPoint[] = [
    {
      date: '2026-06-01',
      ...emptyPointTotals,
      totalTokens: 100,
    },
    {
      date: '2026-06-02',
      ...emptyPointTotals,
      totalTokens: 300,
    },
  ];

  const result = buildUsageTrendBuckets(source, 1, '2026-06-02T12:00:00.000Z');

  assert.equal(result.unit, 'day');
  assert.deepEqual(result.points.map((point) => [point.date, point.totalTokens]), [['2026-06-02', 300]]);
});

test('buildUsageTrendBuckets uses the browser local date across the UTC day boundary', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Asia/Singapore';
  try {
    const source: UsageTrendPoint[] = [
      {
        date: '2026-06-01',
        ...emptyPointTotals,
        totalTokens: 100,
      },
      {
        date: '2026-06-02',
        ...emptyPointTotals,
        totalTokens: 300,
      },
    ];

    const result = buildUsageTrendBuckets(source, 1, new Date('2026-06-01T16:30:00.000Z'));

    assert.deepEqual(result.points.map((point) => [point.date, point.totalTokens]), [['2026-06-02', 300]]);
  } finally {
    if (previousTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousTimezone;
    }
  }
});

test('buildUsageTrendBuckets aggregates all-time ranges by week when history is wider than 90 days', () => {
  const source: UsageTrendPoint[] = [
    {
      date: '2026-01-01',
      ...emptyPointTotals,
      totalTokens: 100,
    },
    {
      date: '2026-04-15',
      ...emptyPointTotals,
      totalTokens: 50,
      totalCostUsd: 2,
    },
  ];

  const result = buildUsageTrendBuckets(source, 'all', '2026-06-02T12:00:00.000Z');

  assert.equal(result.unit, 'week');
  assert.equal(result.points[0].date, '2026-01-01');
  assert.equal(result.points.at(-1)?.date, '2026-04-09');
  assert.deepEqual(
    result.points.filter((point) => point.totalTokens > 0).map((point) => [point.date, point.totalTokens, point.totalCostUsd]),
    [
      ['2026-01-01', 100, 0],
      ['2026-04-09', 50, 2],
    ],
  );
});

test('buildUsageTrendBuckets aggregates all-time ranges by month when history is wider than a year', () => {
  const source: UsageTrendPoint[] = [
    {
      date: '2025-01-12',
      ...emptyPointTotals,
      totalTokens: 100,
    },
    {
      date: '2026-06-02',
      ...emptyPointTotals,
      totalTokens: 300,
    },
  ];

  const result = buildUsageTrendBuckets(source, 'all', '2026-06-02T12:00:00.000Z');

  assert.equal(result.unit, 'month');
  assert.deepEqual(
    result.points.filter((point) => point.totalTokens > 0).map((point) => [point.date, point.totalTokens]),
    [
      ['2025-01-01', 100],
      ['2026-06-01', 300],
    ],
  );
});
