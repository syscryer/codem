#!/usr/bin/env node
import path from 'node:path';

const args = process.argv.slice(2);

function readFlagValue(flagName) {
  const index = args.findIndex((value) => value === flagName);
  if (index === -1) {
    return null;
  }
  return args[index + 1] ?? null;
}

function readRepeatedFlagValues(flagName) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flagName) {
      continue;
    }
    const nextValue = args[index + 1];
    if (nextValue && !nextValue.startsWith('--')) {
      values.push(nextValue);
    }
  }
  return values;
}

function hasFlag(flagName) {
  return args.includes(flagName);
}

const projectArgument = readFlagValue('--project');
const homeArgument = readFlagValue('--home');
const appDataArgument = readFlagValue('--app-data');
const projectDirectory = projectArgument ? path.resolve(projectArgument) : process.cwd();
const homeDirectory = homeArgument ? path.resolve(homeArgument) : undefined;
const appDataDirectory = appDataArgument ? path.resolve(appDataArgument) : undefined;
const outputJson = hasFlag('--json');
const assertMode = hasFlag('--assert');
const requiredSlashValues = readRepeatedFlagValues('--require').map((value) => value.trim()).filter(Boolean);

try {
  const { tsImport } = await import('tsx/esm/api');
  const { listSlashCommands } = await tsImport('../server/lib/slash-commands.ts', import.meta.url);
  const commands = listSlashCommands({
    projectDirectory,
    homeDirectory,
    appDataDirectory,
  });
  const payload = buildPayload(projectDirectory, commands);

  if (assertMode) {
    runAssertions(commands, requiredSlashValues);
    console.error('Slash command assertions passed.');
  }

  if (outputJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(renderGroupedOutput(projectDirectory, commands));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function buildPayload(resolvedProjectDirectory, resolvedCommands) {
  return {
    projectDirectory: resolvedProjectDirectory,
    generatedAt: new Date().toISOString(),
    commands: resolvedCommands,
    summary: {
      total: resolvedCommands.length,
      bySource: resolvedCommands.reduce((accumulator, command) => {
        accumulator[command.source] = (accumulator[command.source] ?? 0) + 1;
        return accumulator;
      }, {}),
    },
  };
}

function renderGroupedOutput(resolvedProjectDirectory, resolvedCommands) {
  const groups = new Map();
  for (const command of resolvedCommands) {
    const label = command.source;
    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label).push(command);
  }

  const lines = [
    `Slash command spike for: ${resolvedProjectDirectory}`,
    `Total commands: ${resolvedCommands.length}`,
  ];

  for (const [source, entries] of groups.entries()) {
    lines.push('', `[${source}] ${entries.length}`);
    for (const command of entries) {
      const parts = [command.slash, `action=${command.action}`];
      if (command.argumentHint) {
        parts.push(`args=${JSON.stringify(command.argumentHint)}`);
      }
      if (command.sourceLabel) {
        parts.push(`label=${JSON.stringify(command.sourceLabel)}`);
      }
      lines.push(`- ${parts.join(' | ')}`);
      if (command.description) {
        lines.push(`  ${command.description}`);
      }
      if (command.action === 'insert-template' && command.template) {
        const preview = command.template.split(/\r?\n/).slice(0, 4).join(' / ');
        lines.push(`  template: ${preview}`);
      }
    }
  }

  return lines.join('\n');
}

function runAssertions(resolvedCommands, additionalRequiredSlashValues) {
  const status = findCommand(resolvedCommands, '/status');
  const clear = findCommand(resolvedCommands, '/clear');
  const brainstorming = findCommand(resolvedCommands, '/brainstorming');

  invariant(status, 'Missing required slash command: /status');
  invariant(status.action === 'local-action', 'Expected /status to use local-action');
  invariant(clear, 'Missing required slash command: /clear');
  invariant(clear.action === 'local-action', 'Expected /clear to use local-action');
  invariant(brainstorming, 'Missing required slash command: /brainstorming');
  invariant(brainstorming.action === 'insert-template', 'Expected /brainstorming to use insert-template action');

  for (const slash of additionalRequiredSlashValues) {
    invariant(findCommand(resolvedCommands, slash), `Missing required slash command: ${slash}`);
  }
}

function findCommand(resolvedCommands, slash) {
  return resolvedCommands.find((command) => command.slash.toLowerCase() === slash.toLowerCase()) ?? null;
}

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
