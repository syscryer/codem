import type { UsageTrendPoint } from '../types';

export type UsageTrendRange = 1 | 7 | 30 | 90 | 'all';
export type UsageTrendBucketUnit = 'day' | 'week' | 'month';

export type UsageTrendBucketResult = {
  unit: UsageTrendBucketUnit;
  points: UsageTrendPoint[];
};

const dayMs = 24 * 60 * 60 * 1000;

export function buildUsageTrendBuckets(
  sourcePoints: UsageTrendPoint[],
  range: UsageTrendRange,
  currentDate: Date | string = new Date(),
): UsageTrendBucketResult {
  if (range !== 'all') {
    return {
      unit: 'day',
      points: buildFixedDayWindow(sourcePoints, range, currentDate),
    };
  }

  return buildAllTimeBuckets(sourcePoints);
}

function buildFixedDayWindow(sourcePoints: UsageTrendPoint[], days: 1 | 7 | 30 | 90, currentDate: Date | string) {
  const byDate = aggregateByDate(sourcePoints, (point) => point.date);
  const endDate = parseDateInput(currentDate);
  const startDate = addDays(endDate, -(days - 1));
  const result: UsageTrendPoint[] = [];

  for (let index = 0; index < days; index += 1) {
    const date = toIsoDate(addDays(startDate, index));
    result.push(byDate.get(date) ?? emptyTrendPoint(date));
  }

  return result;
}

function buildAllTimeBuckets(sourcePoints: UsageTrendPoint[]): UsageTrendBucketResult {
  const sorted = sourcePoints
    .filter((point) => isIsoDate(point.date))
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date));
  if (sorted.length === 0) {
    return {
      unit: 'day',
      points: [],
    };
  }

  const firstDate = parseIsoDate(sorted[0].date);
  const lastDate = parseIsoDate(sorted[sorted.length - 1].date);
  const spanDays = diffDays(firstDate, lastDate) + 1;
  const unit: UsageTrendBucketUnit = spanDays > 365 ? 'month' : spanDays > 90 ? 'week' : 'day';
  const bucketStart = getBucketStart(firstDate, firstDate, unit);
  const bucketEnd = getBucketStart(lastDate, firstDate, unit);
  const byBucket = aggregateByDate(sorted, (point) => toIsoDate(getBucketStart(parseIsoDate(point.date), firstDate, unit)));
  const result: UsageTrendPoint[] = [];

  for (let cursor = bucketStart; cursor.getTime() <= bucketEnd.getTime(); cursor = addBucket(cursor, unit)) {
    const date = toIsoDate(cursor);
    result.push(byBucket.get(date) ?? emptyTrendPoint(date));
  }

  return {
    unit,
    points: result,
  };
}

function aggregateByDate(points: UsageTrendPoint[], resolveDate: (point: UsageTrendPoint) => string) {
  const byDate = new Map<string, UsageTrendPoint>();

  points.forEach((point) => {
    if (!isIsoDate(point.date)) {
      return;
    }

    const date = resolveDate(point);
    const existing = byDate.get(date) ?? emptyTrendPoint(date);
    byDate.set(date, mergeTrendPoints(existing, point, date));
  });

  return byDate;
}

function mergeTrendPoints(current: UsageTrendPoint, next: UsageTrendPoint, date: string): UsageTrendPoint {
  return {
    date,
    projects: current.projects + next.projects,
    threads: current.threads + next.threads,
    messages: current.messages + next.messages,
    toolCalls: current.toolCalls + next.toolCalls,
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
    cacheCreationInputTokens: current.cacheCreationInputTokens + next.cacheCreationInputTokens,
    cacheReadInputTokens: current.cacheReadInputTokens + next.cacheReadInputTokens,
    totalTokens: current.totalTokens + next.totalTokens,
    durationMs: current.durationMs + next.durationMs,
    totalCostUsd: current.totalCostUsd + next.totalCostUsd,
  };
}

function emptyTrendPoint(date: string): UsageTrendPoint {
  return {
    date,
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
}

function getBucketStart(date: Date, rangeStart: Date, unit: UsageTrendBucketUnit) {
  if (unit === 'month') {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }

  if (unit === 'week') {
    return addDays(rangeStart, Math.floor(diffDays(rangeStart, date) / 7) * 7);
  }

  return new Date(date.getTime());
}

function addBucket(date: Date, unit: UsageTrendBucketUnit) {
  if (unit === 'month') {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  }

  return addDays(date, unit === 'week' ? 7 : 1);
}

function parseDateInput(value: Date | string) {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  return parseIsoDate(value.slice(0, 10));
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day));
}

function toIsoDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * dayMs);
}

function diffDays(startDate: Date, endDate: Date) {
  return Math.floor((endDate.getTime() - startDate.getTime()) / dayMs);
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
