# Slash Command Spike Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing slash-command spike script so it can validate discovery results, assert key command invariants, and emit machine-readable output before UI work continues.

**Architecture:** Keep the existing backend registry as the single source of truth and harden only the standalone script layer around it. Extend the spike script with CLI flags for assertion and JSON output, then backstop the new behavior with focused node:test coverage that exercises both success and failure paths without touching frontend code.

**Tech Stack:** Node.js, TypeScript via `tsx`, node:test, existing `server/lib/slash-commands.ts`

---

## File Structure

- Modify: `scripts/slash-commands-spike.mjs`
- Create: `tests/slash-commands-spike.test.ts`
- Reuse for assertions: `server/lib/slash-commands.ts`

## Task 1: Cover Spike Behavior with Tests First

**Files:**
- Create: `tests/slash-commands-spike.test.ts`
- Reference: `scripts/slash-commands-spike.mjs`
- Reference: `server/lib/slash-commands.ts`

- [ ] **Step 1: Write the failing test for JSON output**

```ts
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const scriptPath = path.resolve('scripts/slash-commands-spike.mjs');

test('slash command spike prints JSON payload when --json is provided', () => {
  const result = spawnSync(process.execPath, [scriptPath, '--project', process.cwd(), '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr.trim(), '');

  const payload = JSON.parse(result.stdout);
  assert.ok(Array.isArray(payload.commands));
  assert.ok(payload.commands.some((command: { slash: string }) => command.slash === '/compact'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test --import tsx tests/slash-commands-spike.test.ts
```

Expected: FAIL because the current script does not support `--json`.

- [ ] **Step 3: Add the second failing test for assertion mode**

```ts
test('slash command spike exits non-zero when required commands are missing in --assert mode', () => {
  const result = spawnSync(
    process.execPath,
    [scriptPath, '--project', process.cwd(), '--assert', '--require', '/missing-command'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing required slash command/i);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run:

```bash
node --test --import tsx tests/slash-commands-spike.test.ts
```

Expected: FAIL because the current script does not support `--assert` or `--require`.

## Task 2: Add Script Flag Parsing and Structured Output

**Files:**
- Modify: `scripts/slash-commands-spike.mjs`
- Test: `tests/slash-commands-spike.test.ts`

- [ ] **Step 1: Replace the ad hoc argument parsing with explicit flag parsing**

```js
const args = process.argv.slice(2);

function readFlagValue(flagName) {
  const index = args.findIndex((value) => value === flagName);
  if (index === -1) {
    return null;
  }
  return args[index + 1] ?? null;
}

function hasFlag(flagName) {
  return args.includes(flagName);
}

const projectArgument = readFlagValue('--project');
const projectDirectory = projectArgument ? path.resolve(projectArgument) : process.cwd();
const outputJson = hasFlag('--json');
const assertMode = hasFlag('--assert');
const requiredSlashValues = args
  .flatMap((value, index) => (value === '--require' ? [args[index + 1] ?? ''] : []))
  .map((value) => value.trim())
  .filter(Boolean);
```

- [ ] **Step 2: Add a stable JSON payload builder**

```js
function buildPayload(projectDirectory, commands) {
  return {
    projectDirectory,
    generatedAt: new Date().toISOString(),
    commands,
    summary: {
      total: commands.length,
      bySource: commands.reduce((accumulator, command) => {
        accumulator[command.source] = (accumulator[command.source] ?? 0) + 1;
        return accumulator;
      }, {}),
    },
  };
}
```

- [ ] **Step 3: Emit JSON when requested**

```js
const payload = buildPayload(projectDirectory, commands);

if (outputJson) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}
```

- [ ] **Step 4: Run tests to verify JSON output passes and assert mode still fails**

Run:

```bash
node --test --import tsx tests/slash-commands-spike.test.ts
```

Expected: the JSON test now passes, while the assert-mode test still fails.

## Task 3: Add Assertion Mode for Required Commands and Action Types

**Files:**
- Modify: `scripts/slash-commands-spike.mjs`
- Test: `tests/slash-commands-spike.test.ts`

- [ ] **Step 1: Add reusable command lookup helpers**

```js
function findCommand(commands, slash) {
  return commands.find((command) => command.slash.toLowerCase() === slash.toLowerCase()) ?? null;
}

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
```

- [ ] **Step 2: Enforce built-in spike assertions when `--assert` is enabled**

```js
function runAssertions(commands, requiredSlashValues) {
  const compact = findCommand(commands, '/compact');
  const clear = findCommand(commands, '/clear');

  invariant(compact, 'Missing required slash command: /compact');
  invariant(compact.action === 'passthrough', 'Expected /compact to use passthrough action');
  invariant(clear, 'Missing required slash command: /clear');
  invariant(clear.action === 'local-action', 'Expected /clear to use local-action');

  for (const slash of requiredSlashValues) {
    invariant(findCommand(commands, slash), `Missing required slash command: ${slash}`);
  }
}
```

- [ ] **Step 3: Exit non-zero with a clear error message when assertions fail**

```js
try {
  if (assertMode) {
    runAssertions(commands, requiredSlashValues);
    console.error('Slash command assertions passed.');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
```

- [ ] **Step 4: Add the success-path assertion test**

```ts
test('slash command spike succeeds in --assert mode for the current workspace', () => {
  const result = spawnSync(process.execPath, [scriptPath, '--project', process.cwd(), '--assert'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stderr, /assertions passed/i);
});
```

- [ ] **Step 5: Run tests to verify assertion mode passes**

Run:

```bash
node --test --import tsx tests/slash-commands-spike.test.ts
```

Expected: PASS.

## Task 4: Preserve Human-Readable Grouped Output

**Files:**
- Modify: `scripts/slash-commands-spike.mjs`
- Test: `tests/slash-commands-spike.test.ts`

- [ ] **Step 1: Refactor grouped text rendering into a helper**

```js
function renderGroupedOutput(projectDirectory, commands) {
  const groups = new Map();
  for (const command of commands) {
    const label = command.source;
    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label).push(command);
  }

  const lines = [
    `Slash command spike for: ${projectDirectory}`,
    `Total commands: ${commands.length}`,
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
```

- [ ] **Step 2: Print grouped text output only when `--json` is not set**

```js
if (!outputJson) {
  console.log(renderGroupedOutput(projectDirectory, commands));
}
```

- [ ] **Step 3: Add a regression test for the default output**

```ts
test('slash command spike keeps human-readable grouped output by default', () => {
  const result = spawnSync(process.execPath, [scriptPath, '--project', process.cwd()], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Slash command spike for:/);
  assert.match(result.stdout, /\[builtin\]/);
});
```

- [ ] **Step 4: Run tests to verify both default and JSON output paths**

Run:

```bash
node --test --import tsx tests/slash-commands-spike.test.ts
```

Expected: PASS.

## Task 5: Final Verification

**Files:**
- Verify: `scripts/slash-commands-spike.mjs`
- Verify: `tests/slash-commands-spike.test.ts`

- [ ] **Step 1: Run the focused spike script tests**

Run:

```bash
node --test --import tsx tests/slash-commands-spike.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the existing backend registry tests to ensure the script changes did not drift from the registry**

Run:

```bash
node --test --import tsx server/lib/slash-commands.test.ts
```

Expected: PASS.

- [ ] **Step 3: Smoke-test the human-readable spike output**

Run:

```bash
node scripts/slash-commands-spike.mjs --project D:\project\codem
```

Expected: grouped output with source sections and template previews.

- [ ] **Step 4: Smoke-test the assertion mode**

Run:

```bash
node scripts/slash-commands-spike.mjs --project D:\project\codem --assert
```

Expected: zero exit code and `Slash command assertions passed.` on stderr.

- [ ] **Step 5: Smoke-test the JSON output**

Run:

```bash
node scripts/slash-commands-spike.mjs --project D:\project\codem --json
```

Expected: valid JSON containing `commands` and `summary`.
