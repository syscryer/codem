import type { ClaudeContextSnapshot, ClaudeContextSummary } from '../../src/types.js';

const CLAUDE_CONTEXT_MARKDOWN_MAX_CHARS = 50_000;

export function extractClaudeContextMarkdownFromPayload(payload: unknown) {
  const record = asRecord(payload);
  if (record.type === 'result' && typeof record.result === 'string') {
    return stripAnsiControlCodes(record.result);
  }

  const localCommandStdout = extractLocalCommandStdout(record);
  if (localCommandStdout) {
    return localCommandStdout;
  }

  if (record.type !== 'assistant') {
    return '';
  }

  const message = asRecord(record.message);
  const content = Array.isArray(message.content) ? message.content : [];
  return content
    .map((item) => {
      const block = asRecord(item);
      return block.type === 'text' && typeof block.text === 'string' ? block.text : '';
    })
    .filter(Boolean)
    .join('');
}

export function createClaudeContextSnapshot(
  markdown: string,
  options: {
    requestedAtMs: number;
    durationMs: number;
    eventCount: number;
  },
): ClaudeContextSnapshot {
  const markdownTruncated = markdown.length > CLAUDE_CONTEXT_MARKDOWN_MAX_CHARS;
  const safeMarkdown = markdownTruncated
    ? `${markdown.slice(0, CLAUDE_CONTEXT_MARKDOWN_MAX_CHARS)}\n\n...[已截断]...`
    : markdown;

  return {
    source: 'stream-json',
    requestedAtMs: options.requestedAtMs,
    durationMs: options.durationMs,
    eventCount: options.eventCount,
    markdown: safeMarkdown,
    markdownTruncated,
    summary: summarizeClaudeContextMarkdown(markdown),
  };
}

export function summarizeClaudeContextMarkdown(markdown: string): ClaudeContextSummary {
  const normalized = stripAnsiControlCodes(markdown).trim();
  const categories = parseCategoryUsage(normalized);
  const tokenLine = parseMainTokenLine(normalized);
  const freeTokens = categories.freeSpace ?? tokenLine.freeTokens;
  const totalTokens = tokenLine.totalTokens;
  const usedTokens = tokenLine.usedTokens ?? (
    typeof totalTokens === 'number' && typeof freeTokens === 'number'
      ? Math.max(0, totalTokens - freeTokens)
      : undefined
  );

  return {
    hasContextUsage: hasContextUsageHeading(normalized),
    hasMcpTools: hasSection(normalized, 'MCP Tools'),
    hasFreeSpace: typeof freeTokens === 'number' || /\bFree space\b/i.test(normalized),
    hasSystemPrompt: typeof categories.systemPrompt === 'number' || /\bSystem prompt\b/i.test(normalized),
    hasMemory: hasSection(normalized, 'Memory Files') || typeof categories.memoryFiles === 'number',
    hasSkills: hasSection(normalized, 'Skills') || typeof categories.skills === 'number',
    model: parseModel(normalized),
    usedTokens,
    totalTokens,
    freeTokens,
    percent: tokenLine.percent,
    categories,
    mcpToolCount: countMarkdownTableRows(normalized, 'MCP Tools'),
    memoryFileCount: countMarkdownTableRows(normalized, 'Memory Files'),
    skillCount: countMarkdownTableRows(normalized, 'Skills'),
    markdownChars: markdown.length,
  };
}

function parseModel(markdown: string) {
  const match = markdown.match(/(?:\*\*)?Model:(?:\*\*)?\s*([^\n\r]+?)(?:\s{2,})?(?:\r?\n|$)/i);
  return match?.[1]?.trim() || undefined;
}

function parseMainTokenLine(markdown: string) {
  const match = markdown.match(/(?:\*\*Tokens:\*\*\s*)?([~<]?\s*\d+(?:\.\d+)?\s*[km]?)\s*\/\s*([~<]?\s*\d+(?:\.\d+)?\s*[km]?)(?:\s*tokens?)?(?:\s*\(([\d.]+)%\))?/i);
  if (!match) {
    return {};
  }

  const usedTokens = parseTokenCount(match[1]);
  const totalTokens = parseTokenCount(match[2]);
  const percent = typeof match[3] === 'string' ? Number(match[3]) : undefined;

  return {
    usedTokens,
    totalTokens,
    freeTokens:
      typeof usedTokens === 'number' && typeof totalTokens === 'number'
        ? Math.max(0, totalTokens - usedTokens)
        : undefined,
    percent: Number.isFinite(percent) ? percent : undefined,
  };
}

function parseCategoryUsage(markdown: string): ClaudeContextSummary['categories'] {
  const rows = parseMarkdownTableRows(markdown, 'Estimated usage by category');
  const categories: ClaudeContextSummary['categories'] = {};

  for (const row of rows) {
    const label = row[0]?.trim().toLowerCase();
    const tokens = parseTokenCount(row[1] ?? '');
    if (typeof tokens !== 'number') {
      continue;
    }

    if (label === 'system prompt') {
      categories.systemPrompt = tokens;
    } else if (label === 'memory files') {
      categories.memoryFiles = tokens;
    } else if (label === 'skills') {
      categories.skills = tokens;
    } else if (label === 'messages') {
      categories.messages = tokens;
    } else if (label === 'free space') {
      categories.freeSpace = tokens;
    }
  }

  parsePlainCategoryUsage(markdown, categories);

  return categories;
}

function countMarkdownTableRows(markdown: string, heading: string) {
  return parseMarkdownTableRows(markdown, heading).length || countPlainSectionRows(markdown, heading);
}

function parseMarkdownTableRows(markdown: string, heading: string) {
  const lines = getMarkdownSectionLines(markdown, heading);
  return lines
    .filter((line) => line.trim().startsWith('|'))
    .map(parseMarkdownTableLine)
    .filter((row) => row.length > 0)
    .filter((row) => !isTableHeader(row) && !isTableSeparator(row));
}

function getMarkdownSectionLines(markdown: string, heading: string) {
  const lines = markdown.split(/\r?\n/);
  const headingPattern = new RegExp(`^#{1,6}\\s*${escapeRegExp(heading)}\\s*$`, 'i');
  const startIndex = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (startIndex === -1) {
    return [];
  }

  const sectionLines: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/^#{1,6}\s+\S/.test(lines[index].trim())) {
      break;
    }
    sectionLines.push(lines[index]);
  }
  return sectionLines;
}

function getPlainSectionLines(markdown: string, heading: string) {
  const lines = markdown.split(/\r?\n/);
  const headingPattern = new RegExp(`^\\s*${escapeRegExp(heading)}\\s*$`, 'i');
  const startIndex = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (startIndex === -1) {
    return [];
  }

  const sectionLines: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (/^#{1,6}\s+\S/.test(trimmed) || isKnownPlainContextHeading(trimmed)) {
      break;
    }
    sectionLines.push(lines[index]);
  }
  return sectionLines;
}

function countPlainSectionRows(markdown: string, heading: string) {
  return getPlainSectionLines(markdown, heading)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\|/.test(line))
    .filter((line) => !/^-+$/.test(line))
    .length;
}

function parseMarkdownTableLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return [];
  }

  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

function isTableHeader(row: string[]) {
  return row.some((cell) => /^(category|tool|type|skill)$/i.test(cell));
}

function isTableSeparator(row: string[]) {
  return row.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function parseTokenCount(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/^~/, '')
    .replace(/^<\s*/, '')
    .replace(/\s*tokens?$/, '')
    .trim();
  const match = normalized.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!match) {
    return undefined;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return undefined;
  }

  const suffix = match[2];
  if (suffix === 'm') {
    return Math.round(amount * 1_000_000);
  }
  if (suffix === 'k') {
    return Math.round(amount * 1_000);
  }
  return Math.round(amount);
}

function hasSection(markdown: string, heading: string) {
  return getMarkdownSectionLines(markdown, heading).length > 0 || getPlainSectionLines(markdown, heading).length > 0;
}

function hasContextUsageHeading(markdown: string) {
  return /(^|\n)\s*(?:#{1,3}\s*)?Context Usage\b/i.test(markdown);
}

function parsePlainCategoryUsage(
  markdown: string,
  categories: ClaudeContextSummary['categories'],
) {
  const entries = [
    { key: 'systemPrompt' as const, label: 'System prompt' },
    { key: 'memoryFiles' as const, label: 'Memory files' },
    { key: 'skills' as const, label: 'Skills' },
    { key: 'messages' as const, label: 'Messages' },
    { key: 'freeSpace' as const, label: 'Free space' },
  ];

  for (const entry of entries) {
    if (typeof categories[entry.key] === 'number') {
      continue;
    }

    const match = markdown.match(new RegExp(`^\\s*${escapeRegExp(entry.label)}\\s*:\\s*([^\\n\\r]+)`, 'im'));
    const tokens = match ? parseTokenCount(match[1]) : undefined;
    if (typeof tokens === 'number') {
      categories[entry.key] = tokens;
    }
  }
}

function extractLocalCommandStdout(record: Record<string, unknown>) {
  if (record.type !== 'system' || record.subtype !== 'local_command') {
    return '';
  }

  const raw = collectTextFragments([
    record.content,
    record.stdout,
    record.result,
    record.text,
    asRecord(record.message).content,
  ]).join('\n');
  if (!/(\/context|Context Usage|local-command-stdout)/i.test(raw)) {
    return '';
  }

  const stdoutMatch = raw.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/i);
  const stdout = stdoutMatch?.[1] ?? collectTextFragments([record.stdout, record.result]).join('\n');
  return stdout ? stripAnsiControlCodes(decodeXmlEntities(stdout).trim()) : '';
}

function collectTextFragments(values: unknown[]): string[] {
  const fragments: string[] = [];

  for (const value of values) {
    if (typeof value === 'string') {
      fragments.push(value);
      continue;
    }

    if (Array.isArray(value)) {
      fragments.push(...collectTextFragments(value));
      continue;
    }

    const record = asRecord(value);
    if (typeof record.text === 'string') {
      fragments.push(record.text);
    }
    if (typeof record.content === 'string') {
      fragments.push(record.content);
    } else if (Array.isArray(record.content)) {
      fragments.push(...collectTextFragments(record.content));
    }
  }

  return fragments;
}

function stripAnsiControlCodes(value: string) {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function isKnownPlainContextHeading(value: string) {
  return /^(Context Usage|Estimated usage by category|MCP Tools|Memory Files|Skills|System Prompt|Messages|Free space)$/i.test(value);
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
