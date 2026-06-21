import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const CURRENT_SESSION_FILE = 'current-session.json';

export function getTrellisRoot(cwd = process.cwd()) {
  return path.join(cwd, '.trellis');
}

export function getTrellisTasksRoot(cwd = process.cwd()) {
  return path.join(getTrellisRoot(cwd), 'tasks');
}

export function getTrellisWorkspaceRoot(cwd = process.cwd()) {
  return path.join(getTrellisRoot(cwd), 'workspace');
}

export function getTrellisSessionsRoot(cwd = process.cwd()) {
  return path.join(getTrellisWorkspaceRoot(cwd), 'sessions');
}

export function getCurrentSessionPath(cwd = process.cwd()) {
  return path.join(getTrellisWorkspaceRoot(cwd), CURRENT_SESSION_FILE);
}

export async function getCurrentTrellisSession(cwd = process.cwd()) {
  try {
    const raw = await readFile(getCurrentSessionPath(cwd), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function startTrellisSession(cwd = process.cwd(), options = {}) {
  const slug = normalizeSlug(options.slug);
  const title = options.title?.trim() || titleFromSlug(slug);
  const now = new Date();
  const id = buildSessionId(now);
  const taskPath = path.join(getTrellisTasksRoot(cwd), `${slug}.md`);
  const sessionPath = path.join(getTrellisSessionsRoot(cwd), `${id}-${slug}.md`);
  const statePath = getCurrentSessionPath(cwd);

  await ensureTrellisDirectories(cwd);

  const currentSession = await getCurrentTrellisSession(cwd);
  if (currentSession && !options.force) {
    throw new Error(
      `Active Trellis session already exists: ${currentSession.id}. Complete it first or pass --force.`,
    );
  }

  if (!existsSync(taskPath)) {
    await writeFile(taskPath, buildTaskTemplate({ title, objective: options.objective }), 'utf8');
  }

  const session = {
    id,
    slug,
    title,
    taskPath,
    sessionPath,
    startedAt: now.toISOString(),
  };

  await writeFile(sessionPath, buildSessionTemplate(cwd, session), 'utf8');
  await writeFile(statePath, JSON.stringify(session, null, 2), 'utf8');
  return session;
}

export async function recordTrellisNote(cwd = process.cwd(), note) {
  const session = await requireCurrentSession(cwd);
  const text = normalizeRequiredText(note, 'record note');
  const line = `- ${timestamp()} ${text}\n`;

  await appendSectionEntry(session.sessionPath, 'Notes', line);
  await appendSectionEntry(session.taskPath, 'Implementation Record', line);
  return session;
}

export async function verifyTrellisSession(cwd = process.cwd(), options = {}) {
  const session = await requireCurrentSession(cwd);
  const command = normalizeRequiredText(options.command, 'verification command');
  const result = normalizeRequiredText(options.result, 'verification result');
  const entry = `- ${timestamp()} \`${command}\`: ${result}\n`;

  await appendSectionEntry(session.sessionPath, 'Verification', entry);
  await appendSectionEntry(session.taskPath, 'Verification Results', entry);
  return session;
}

export async function completeTrellisSession(cwd = process.cwd(), summary) {
  const session = await requireCurrentSession(cwd);
  const text = normalizeRequiredText(summary, 'completion summary');
  const entry = `- ${timestamp()} ${text}\n`;

  await appendSectionEntry(session.sessionPath, 'Completed', entry);
  await appendSectionEntry(session.taskPath, 'Completion Summary', entry);
  await rm(getCurrentSessionPath(cwd), { force: true });
  return session;
}

export async function runTrellisCli(argv = process.argv.slice(2), cwd = process.cwd(), io = console) {
  const [command, ...rest] = argv;
  const options = parseArgs(rest);

  switch (command) {
    case 'start': {
      const slug = options._[0] ?? options.slug;
      const session = await startTrellisSession(cwd, {
        slug,
        title: options.title,
        objective: options.objective,
        force: Boolean(options.force),
      });
      io.log(`Started Trellis session ${session.id}`);
      io.log(`Task: ${relativePath(cwd, session.taskPath)}`);
      io.log(`Record: ${relativePath(cwd, session.sessionPath)}`);
      return session;
    }
    case 'status': {
      const session = await getCurrentTrellisSession(cwd);
      if (!session) {
        io.log('No active Trellis session.');
        return null;
      }
      io.log(`Active Trellis session ${session.id}`);
      io.log(`Task: ${relativePath(cwd, session.taskPath)}`);
      io.log(`Record: ${relativePath(cwd, session.sessionPath)}`);
      return session;
    }
    case 'record': {
      const note = options._.join(' ') || options.note;
      const session = await recordTrellisNote(cwd, note);
      io.log(`Recorded note for ${session.id}`);
      return session;
    }
    case 'verify': {
      const commandText = options._.join(' ') || options.command;
      const session = await verifyTrellisSession(cwd, {
        command: commandText,
        result: options.result,
      });
      io.log(`Recorded verification for ${session.id}`);
      return session;
    }
    case 'complete': {
      const summary = options._.join(' ') || options.summary;
      const session = await completeTrellisSession(cwd, summary);
      io.log(`Completed Trellis session ${session.id}`);
      return session;
    }
    default:
      printHelp(io);
      return null;
  }
}

function buildTaskTemplate({ title, objective }) {
  const goal = objective?.trim() || '记录目标、范围、验收标准和实现过程。';
  return `# Task: ${title}

## Background

待补充背景。

## Objective

${goal}

## Scope

In scope:

- 待补充。

Out of scope:

- 待补充。

## Impact

- 待补充。

## Acceptance Criteria

- [ ] 待补充。

## Verification Commands

- 待补充。

## Implementation Record

- ${timestamp()} Task created by Trellis automation.

## Verification Results

## Completion Summary

## Follow-ups

- 待补充。
`;
}

function buildSessionTemplate(cwd, session) {
  return `# Session Record: ${session.title}

- Session: ${session.id}
- Started: ${session.startedAt}
- Task: ${relativePath(cwd, session.taskPath)}

## Notes

- ${timestamp()} Session started.

## Verification

## Completed
`;
}

async function appendSectionEntry(filePath, heading, entry) {
  const content = existsSync(filePath) ? await readFile(filePath, 'utf8') : '';
  const headingLine = `## ${heading}`;

  if (!content.includes(headingLine)) {
    const prefix = content.endsWith('\n') || content.length === 0 ? content : `${content}\n`;
    await writeFile(filePath, `${prefix}\n${headingLine}\n\n${entry}`, 'utf8');
    return;
  }

  const index = content.indexOf(headingLine);
  const afterHeadingIndex = content.indexOf('\n', index);
  const insertIndex = afterHeadingIndex === -1 ? content.length : afterHeadingIndex + 1;
  const before = content.slice(0, insertIndex);
  const after = content.slice(insertIndex);
  const separator = after.startsWith('\n') ? '' : '\n';
  await writeFile(filePath, `${before}${separator}${entry}${after}`, 'utf8');
}

async function requireCurrentSession(cwd) {
  const session = await getCurrentTrellisSession(cwd);
  if (!session) {
    throw new Error('No active Trellis session. Run `npm run trellis -- start <slug>` first.');
  }
  return session;
}

async function ensureTrellisDirectories(cwd) {
  await mkdir(getTrellisTasksRoot(cwd), { recursive: true });
  await mkdir(getTrellisSessionsRoot(cwd), { recursive: true });
}

function normalizeSlug(value) {
  const slug = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) {
    throw new Error('Trellis task slug is required.');
  }
  return slug;
}

function titleFromSlug(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function normalizeRequiredText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) {
    throw new Error(`${label} is required.`);
  }
  return text;
}

function buildSessionId(date) {
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '-');
  const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `session-${stamp}-${suffix}`;
}

function timestamp() {
  return new Date().toISOString();
}

function parseArgs(args) {
  const options = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }
  return options;
}

function relativePath(cwd, target) {
  return path.relative(cwd, target).replaceAll(path.sep, '/');
}

function printHelp(io) {
  io.log(`Usage:
  npm run trellis -- start <slug> --title "Task title" --objective "Goal"
  npm run trellis -- start <slug> --force
  npm run trellis -- status
  npm run trellis -- record "Implementation note"
  npm run trellis -- verify "command" --result "pass"
  npm run trellis -- complete --summary "Finished"
`);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  runTrellisCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
