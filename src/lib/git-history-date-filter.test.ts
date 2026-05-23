import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveGitHistoryDatePresetRange } from './git-history-date-filter';

test('resolveGitHistoryDatePresetRange 对 all 返回空范围', () => {
  assert.deepEqual(resolveGitHistoryDatePresetRange('all', new Date('2026-05-23T12:00:00.000Z')), {
    dateFrom: undefined,
    dateTo: undefined,
  });
});

test('resolveGitHistoryDatePresetRange 对过去 24 小时返回当天日期', () => {
  assert.deepEqual(resolveGitHistoryDatePresetRange('24h', new Date('2026-05-23T12:00:00.000Z')), {
    dateFrom: '2026-05-22',
    dateTo: '2026-05-23',
  });
});

test('resolveGitHistoryDatePresetRange 对过去 7 天返回对应范围', () => {
  assert.deepEqual(resolveGitHistoryDatePresetRange('7d', new Date('2026-05-23T12:00:00.000Z')), {
    dateFrom: '2026-05-16',
    dateTo: '2026-05-23',
  });
});
