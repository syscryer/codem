export type GitHistoryDatePreset = 'all' | '24h' | '7d' | '30d';

export function resolveGitHistoryDatePresetRange(
  preset: GitHistoryDatePreset,
  now = new Date(),
) {
  if (preset === 'all') {
    return {
      dateFrom: undefined,
      dateTo: undefined,
    };
  }

  const end = toDateOnly(now);
  const start = new Date(now);
  const offsetDays = preset === '24h' ? 1 : preset === '7d' ? 7 : 30;
  start.setUTCDate(start.getUTCDate() - offsetDays);

  return {
    dateFrom: toDateOnly(start),
    dateTo: end,
  };
}

function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}
