import assert from 'node:assert/strict';
import test from 'node:test';

import {
  automationScheduleError,
  calculateNextAutomationRun,
  defaultCustomAutomationDate,
  formatAutomationSchedule,
  normalizeAutomationSchedule,
} from './automation-schedule.js';

test('interval automation advances from the actual claim time', () => {
  const from = new Date(2026, 6, 18, 10, 0, 0, 0).getTime();
  assert.equal(
    calculateNextAutomationRun(
      { kind: 'interval', intervalMinutes: 90, timezone: 'Asia/Shanghai' },
      from,
    ),
    from + 90 * 60_000,
  );
});

test('daily and weekday schedules move past an elapsed local time', () => {
  const fridayMorning = new Date(2026, 6, 17, 10, 30, 0, 0).getTime();
  assert.equal(
    new Date(calculateNextAutomationRun(
      { kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' },
      fridayMorning,
    )).getDate(),
    18,
  );
  const weekday = new Date(calculateNextAutomationRun(
    { kind: 'weekdays', time: '09:00', timezone: 'Asia/Shanghai' },
    fridayMorning,
  ));
  assert.equal(weekday.getDay(), 1);
  assert.equal(weekday.getDate(), 20);
});

test('weekly schedule supports selected weekdays', () => {
  const mondayAfterRun = new Date(2026, 6, 20, 11, 0, 0, 0).getTime();
  const next = new Date(calculateNextAutomationRun(
    { kind: 'weekly', time: '10:00', weekdays: [1, 3], timezone: 'Asia/Shanghai' },
    mondayAfterRun,
  ));
  assert.equal(next.getDay(), 3);
  assert.equal(next.getDate(), 22);
});

test('monthly schedule clamps to the last day of a short month', () => {
  const january = new Date(2026, 0, 31, 12, 0, 0, 0).getTime();
  const next = new Date(calculateNextAutomationRun(
    { kind: 'monthly', time: '09:00', monthDay: 31, timezone: 'Asia/Shanghai' },
    january,
  ));
  assert.equal(next.getMonth(), 1);
  assert.equal(next.getDate(), 28);
});

test('schedule normalization and labels keep invalid persisted values usable', () => {
  const normalized = normalizeAutomationSchedule({ kind: 'weekly', time: '99:99', weekdays: [] });
  assert.equal(normalized.kind, 'weekly');
  assert.equal(normalized.time, '09:00');
  assert.equal(formatAutomationSchedule(normalized), '每周一 09:00');
});

test('custom schedule uses one future local date and keeps its label', () => {
  const from = new Date(2026, 6, 18, 10, 0, 0, 0);
  const schedule = {
    kind: 'custom' as const,
    date: '2026-07-19',
    time: '10:30',
    timezone: 'Asia/Shanghai',
  };

  assert.equal(
    calculateNextAutomationRun(schedule, from.getTime()),
    new Date(2026, 6, 19, 10, 30, 0, 0).getTime(),
  );
  assert.equal(formatAutomationSchedule(schedule), '自定义 2026-07-19 10:30');
  assert.equal(defaultCustomAutomationDate(from), '2026-07-19');
  assert.throws(
    () => calculateNextAutomationRun(schedule, new Date(2026, 6, 20, 10, 0, 0, 0).getTime()),
    /必须晚于当前时间/,
  );
});

test('custom schedule normalization repairs invalid date and time', () => {
  const normalized = normalizeAutomationSchedule({
    kind: 'custom',
    date: '2026-02-31',
    time: '25:90',
    timezone: 'Asia/Shanghai',
  });

  assert.equal(normalized.kind, 'custom');
  assert.match(normalized.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(normalized.time, '09:00');
});

test('custom schedule validation reports an elapsed time without throwing', () => {
  const from = new Date(2026, 6, 18, 10, 0, 0, 0).getTime();
  assert.equal(
    automationScheduleError({
      kind: 'custom',
      date: '2026-07-18',
      time: '09:00',
      timezone: 'Asia/Shanghai',
    }, from),
    '自定义执行时间必须晚于当前时间',
  );
  assert.equal(
    automationScheduleError({
      kind: 'custom',
      date: '2026-07-19',
      time: '09:00',
      timezone: 'Asia/Shanghai',
    }, from),
    '',
  );
});
