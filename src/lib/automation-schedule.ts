import type { AutomationSchedule } from '../types.js';

const MIN_INTERVAL_MINUTES = 15;
const MAX_INTERVAL_MINUTES = 7 * 24 * 60;

export function currentAutomationTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
}

export function defaultAutomationSchedule(): AutomationSchedule {
  return {
    kind: 'daily',
    time: '09:00',
    timezone: currentAutomationTimezone(),
  };
}

export function calculateNextAutomationRun(schedule: AutomationSchedule, fromMs: number) {
  const from = new Date(fromMs);
  if (!Number.isFinite(from.getTime())) {
    throw new Error('自动化基准时间无效');
  }

  if (schedule.kind === 'interval') {
    const intervalMinutes = Math.min(
      MAX_INTERVAL_MINUTES,
      Math.max(MIN_INTERVAL_MINUTES, Math.round(schedule.intervalMinutes)),
    );
    return fromMs + intervalMinutes * 60_000;
  }

  const { hours, minutes } = parseAutomationTime(schedule.time);
  if (schedule.kind === 'daily') {
    return nextMatchingDate(from, hours, minutes, () => true).getTime();
  }
  if (schedule.kind === 'weekdays') {
    return nextMatchingDate(from, hours, minutes, (date) => {
      const weekday = date.getDay();
      return weekday >= 1 && weekday <= 5;
    }).getTime();
  }
  if (schedule.kind === 'weekly') {
    const weekdays = new Set(
      schedule.weekdays
        .filter((weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6),
    );
    if (weekdays.size === 0) {
      weekdays.add(1);
    }
    return nextMatchingDate(from, hours, minutes, (date) => weekdays.has(date.getDay())).getTime();
  }

  const monthDay = Math.min(31, Math.max(1, Math.round(schedule.monthDay)));
  for (let monthOffset = 0; monthOffset < 24; monthOffset += 1) {
    const firstOfMonth = new Date(from.getFullYear(), from.getMonth() + monthOffset, 1, hours, minutes, 0, 0);
    const daysInMonth = new Date(
      firstOfMonth.getFullYear(),
      firstOfMonth.getMonth() + 1,
      0,
    ).getDate();
    const candidate = new Date(
      firstOfMonth.getFullYear(),
      firstOfMonth.getMonth(),
      Math.min(monthDay, daysInMonth),
      hours,
      minutes,
      0,
      0,
    );
    if (candidate.getTime() > fromMs) {
      return candidate.getTime();
    }
  }
  throw new Error('无法计算自动化下次运行时间');
}

export function formatAutomationSchedule(schedule: AutomationSchedule) {
  if (schedule.kind === 'interval') {
    if (schedule.intervalMinutes % 60 === 0) {
      return `每 ${schedule.intervalMinutes / 60} 小时`;
    }
    return `每 ${schedule.intervalMinutes} 分钟`;
  }
  if (schedule.kind === 'daily') {
    return `每天 ${schedule.time}`;
  }
  if (schedule.kind === 'weekdays') {
    return `工作日 ${schedule.time}`;
  }
  if (schedule.kind === 'weekly') {
    const labels = schedule.weekdays
      .slice()
      .sort((left, right) => left - right)
      .map(weekdayLabel)
      .join('、');
    return `每周${labels || '一'} ${schedule.time}`;
  }
  return `每月 ${schedule.monthDay} 日 ${schedule.time}`;
}

export function formatAutomationNextRun(nextRunAtMs?: number) {
  if (!nextRunAtMs) {
    return '已停用';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(nextRunAtMs));
}

export function normalizeAutomationSchedule(value: unknown): AutomationSchedule {
  const timezone = currentAutomationTimezone();
  if (!value || typeof value !== 'object') {
    return defaultAutomationSchedule();
  }
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (kind === 'interval') {
    return {
      kind,
      intervalMinutes: finiteNumber(record.intervalMinutes, 60),
      timezone: optionalString(record.timezone) || timezone,
    };
  }
  if (kind === 'daily' || kind === 'weekdays') {
    return {
      kind,
      time: validTime(record.time) ? record.time : '09:00',
      timezone: optionalString(record.timezone) || timezone,
    };
  }
  if (kind === 'weekly') {
    return {
      kind,
      time: validTime(record.time) ? record.time : '09:00',
      weekdays: Array.isArray(record.weekdays)
        ? record.weekdays.filter((item): item is number => typeof item === 'number')
        : [1],
      timezone: optionalString(record.timezone) || timezone,
    };
  }
  if (kind === 'monthly') {
    return {
      kind,
      time: validTime(record.time) ? record.time : '09:00',
      monthDay: finiteNumber(record.monthDay, 1),
      timezone: optionalString(record.timezone) || timezone,
    };
  }
  return defaultAutomationSchedule();
}

function nextMatchingDate(
  from: Date,
  hours: number,
  minutes: number,
  matches: (date: Date) => boolean,
) {
  for (let dayOffset = 0; dayOffset <= 370; dayOffset += 1) {
    const candidate = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate() + dayOffset,
      hours,
      minutes,
      0,
      0,
    );
    if (candidate.getTime() > from.getTime() && matches(candidate)) {
      return candidate;
    }
  }
  throw new Error('无法计算自动化下次运行时间');
}

function parseAutomationTime(value: string) {
  if (!validTime(value)) {
    throw new Error('自动化执行时间格式无效');
  }
  const [hours, minutes] = value.split(':').map(Number);
  return { hours, minutes };
}

function validTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
    return false;
  }
  const [hours, minutes] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function weekdayLabel(weekday: number) {
  return ['日', '一', '二', '三', '四', '五', '六'][weekday] || '一';
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}
