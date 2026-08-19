export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export type LogFileSummary = {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
};

export type LogTailResponse = {
  file: string;
  lines: string[];
  matchedLines: number;
  scannedLines: number;
  truncatedByBytes: boolean;
};

export type LogFilesResponse = {
  files: LogFileSummary[];
  directory: string;
};

export type LogExportResponse = {
  path: string;
  opened: boolean;
};

/** 解析后端日志行 `[ts] [LEVEL] [target] message` 中的级别。 */
export function parseLogLevel(line: string): LogLevel | null {
  const segments = line.match(/\[([A-Z]+)\]/g) ?? [];
  for (const segment of segments) {
    const level = segment.slice(1, -1).toLowerCase();
    if (level === 'error' || level === 'warn' || level === 'info' || level === 'debug' || level === 'trace') {
      return level;
    }
  }
  return null;
}

export function logLevelClassName(line: string): string {
  const level = parseLogLevel(line);
  return level ? `log-line log-${level}` : 'log-line';
}

export function formatLogSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
