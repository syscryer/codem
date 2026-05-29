import type { ToastDetail, ToastDetailSection } from '../types';

type GitOperationToastDetailInput = {
  operation: string;
  target?: string;
  branch?: string;
  result: string;
  command?: string;
  errorText?: string;
  outputText?: string;
  occurredAt?: Date;
};

export function buildGitOperationToastDetail(input: GitOperationToastDetailInput): ToastDetail {
  const errorText = normalizeMultilineText(input.errorText);
  const outputText = normalizeMultilineText(input.outputText);
  const command = normalizeMultilineText(input.command);
  const sections: ToastDetailSection[] = [];
  if (errorText) {
    sections.push({ label: 'stderr', content: errorText, defaultOpen: true });
  }
  if (outputText) {
    sections.push({ label: 'stdout', content: outputText, defaultOpen: !errorText });
  }
  if (command) {
    sections.push({ label: '命令', content: command });
  }

  return {
    title: 'Git 操作详情',
    summary: normalizeGitOperationToastMessage(errorText || outputText, `${input.operation}${input.result}`),
    rows: [
      { label: '操作', value: input.operation },
      input.target ? { label: '目标', value: input.target } : null,
      input.branch ? { label: '分支', value: input.branch } : null,
      { label: '结果', value: input.result },
      { label: '时间', value: formatOperationTime(input.occurredAt ?? new Date()) },
    ].filter((row): row is { label: string; value: string } => Boolean(row)),
    sections,
  };
}

export function normalizeGitOperationToastMessage(text: string, fallback: string) {
  const firstLine = normalizeMultilineText(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) {
    return fallback;
  }
  return firstLine.length > 96 ? `${firstLine.slice(0, 95)}…` : firstLine;
}

function normalizeMultilineText(text?: string) {
  return (text ?? '').replace(/\r\n/g, '\n').trim();
}

function formatOperationTime(date: Date) {
  const parts = [
    date.getFullYear(),
    padTimePart(date.getMonth() + 1),
    padTimePart(date.getDate()),
    padTimePart(date.getHours()),
    padTimePart(date.getMinutes()),
    padTimePart(date.getSeconds()),
  ];
  return `${parts[0]}-${parts[1]}-${parts[2]} ${parts[3]}:${parts[4]}:${parts[5]}`;
}

function padTimePart(value: number) {
  return String(value).padStart(2, '0');
}
