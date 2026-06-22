# Slash Commands Implementation Plan

> **For agentic workers:** Follow this plan task-by-task. Steps use checkbox (`- [ ]`) syntax so progress can be tracked incrementally.

**Goal:** Add a unified slash command menu to the CodeM composer that discovers practical commands from multiple sources, only triggers at current-line start, supports mixed execution modes, and validates discovery with a standalone spike script before app integration.

**Architecture:** Build one backend slash command registry in `server/lib/slash-commands.ts` and expose it through a narrow read-only API. Keep the composer responsible for trigger detection and menu interaction, but keep execution routing thin and outside the menu UI. Reuse existing scanners where possible and preserve the current `useClaudeRun` submission flow for non-local commands.

**Tech Stack:** TypeScript, React 19, Vite, Express 5, Node built-ins, node:test, `tsx`.

---

## File Structure

- Create `scripts/slash-commands-spike.mjs`: standalone discovery and normalization validation script.
- Create `server/lib/slash-commands.ts`: unified slash command registry and source adapters.
- Create `server/lib/slash-commands.test.ts`: backend registry tests.
- Modify `server/lib/skills-scanner.ts` only if needed to expose enough metadata for skill-derived commands.
- Modify `server/lib/mcp-inspector.ts` only if needed to expose stable MCP command labels.
- Modify `server/index.ts`: add `GET /api/slash-commands`.
- Modify `src/types.ts`: add slash command source, action, and payload types.
- Create `src/hooks/useSlashCommands.ts`: command loading, caching, and current-line query state.
- Create `src/components/SlashCommandMenu.tsx`: grouped command menu UI.
- Modify `src/components/Composer.tsx`: line-start trigger detection, menu interaction, selection handling.
- Create `src/lib/slash-command-editor.ts`: helper functions for current-line detection and slash insertion/template replacement.
- Create `src/lib/slash-command-submit.ts`: submission-time routing for local actions and passthrough behavior.
- Create `src/lib/slash-command-templates.ts`: initial built-in template definitions for plugin/skill insertion commands if needed.
- Modify `src/hooks/useClaudeRun.ts`: wire local slash action dispatch and preserve normal run flow for passthrough commands.
- Modify `src/App.tsx`: pass active project path and slash handlers into `Composer`.
- Modify `src/styles.css`: slash menu and item styling.
- Create `tests/slash-command-editor.test.ts`: current-line detection and insertion tests.
- Create `tests/useSlashCommands.test.ts`: hook behavior tests.

## Task 1: Build a Standalone Slash Command Spike

**Files:**
- Create: `scripts/slash-commands-spike.mjs`

- [x] **Step 1: Define the normalized command shape in the spike**

Create a small internal schema that matches the approved design:

```ts
{ id, name, slash, title, description, source, action, template?, argumentHint?, sourceLabel?, localActionId? }
```

The spike should not import app code yet. Keep it independent so it can validate feasibility without app coupling.

- [x] **Step 2: Load all first-version command sources in the spike**

The spike must inspect:

- built-in commands
- `<project>/.claude/commands/**/*.md`
- `~/.claude/commands/**/*.md`
- skills and plugins from current CodeM discovery roots
- MCP entries from current local config sources
- CodeM local commands

Expected: command groups print even when one source is missing.

- [x] **Step 3: Print grouped output and sample templates**

Add grouped console output by source plus a short preview for any `insert-template` command.

Suggested run:

```bash
node scripts/slash-commands-spike.mjs --project <codem-workspace>
```

- [x] **Step 4: Validate spike behavior manually**

Confirm at least these sample mappings:

- `/compact` -> `passthrough`
- `/brainstorming` -> `insert-template`
- `/clear` -> `local-action`

Expected: grouped normalized output with no fatal crash if optional sources are absent.

## Task 2: Backend Slash Command Registry

**Files:**
- Create: `server/lib/slash-commands.ts`
- Test: `server/lib/slash-commands.test.ts`

- [x] **Step 1: Write failing backend tests for source aggregation**

Add tests that prove:

- built-in commands are always present
- `.claude/commands` entries normalize correctly
- skill entries can produce `insert-template` commands
- malformed source files do not crash the registry
- MCP entries can appear as passthrough commands

Run:

```bash
node --test --import tsx server/lib/slash-commands.test.ts
```

Expected: FAIL because the registry does not exist yet.

- [x] **Step 2: Implement `listBuiltinSlashCommands()`**

Start with deterministic built-ins such as:

- `/compact`
- `/review`

Keep built-ins as plain normalized records, not hard-coded directly in the route.

- [x] **Step 3: Implement Claude custom command discovery**

Read:

- `<project>/.claude/commands/**/*.md`
- `~/.claude/commands/**/*.md`

Normalize command names from file structure and frontmatter where available. Default these commands to `passthrough`.

- [x] **Step 4: Implement skill/plugin-derived command discovery**

Adapt existing skill scanning data into slash commands. Only emit commands that can map to a valid insertion template in v1.

Expected example:

- `brainstorming` -> `/brainstorming` -> `insert-template`

- [x] **Step 5: Implement MCP and app/local command discovery**

Expose stable MCP entries for menu visibility and mark them `passthrough`. Add CodeM-local actions such as `/clear` and `/help` as `local-action`.

- [x] **Step 6: Implement `listSlashCommands(context)`**

Aggregate all sources, normalize, dedupe by slash name, and keep deterministic ordering.

Registry rules:

- one bad source file cannot fail the whole registry
- incomplete skill entries are skipped
- source and action stay explicitly separated

- [x] **Step 7: Verify backend registry tests pass**

Run:

```bash
node --test --import tsx server/lib/slash-commands.test.ts
```

Expected: PASS.

## Task 3: Backend API Route

**Files:**
- Modify: `server/index.ts`

- [x] **Step 1: Add `GET /api/slash-commands`**

Accept an optional `projectPath` query string so project-level `.claude/commands` can be resolved in the active workspace context.

Response:

```json
{
  "commands": [ ...normalizedSlashCommands ]
}
```

- [x] **Step 2: Keep route failure isolated**

If source scanning partially fails, still return successful command results where possible. Only return a hard 500 when the registry itself cannot produce any usable result due to a true internal error.

- [ ] **Step 3: Smoke test the route**

Suggested check:

```bash
Invoke-RestMethod "http://127.0.0.1:3001/api/slash-commands?projectPath=<codem-workspace>"
```

Expected: command payload includes built-in and local entries even if optional sources are empty.

## Task 4: Shared Frontend Types and Editor Helpers

**Files:**
- Modify: `src/types.ts`
- Create: `src/lib/slash-command-editor.ts`
- Test: `tests/slash-command-editor.test.ts`

- [x] **Step 1: Add shared slash command types**

Add frontend types for:

- `SlashCommandSource`
- `SlashCommandAction`
- `SlashCommand`
- `SlashCommandResponse`

- [x] **Step 2: Write failing editor helper tests**

Test helpers for:

- current-line slash trigger detection
- leading whitespace support
- non-line-start rejection
- replacing the active slash line with inserted content

Run:

```bash
node --test --import tsx tests/slash-command-editor.test.ts
```

Expected: FAIL because helpers do not exist yet.

- [x] **Step 3: Implement editor helpers**

Create small pure helpers for:

- `getCurrentLineSlashQuery(...)`
- `replaceCurrentLineWithText(...)`
- `insertPassthroughSlashCommand(...)`

These helpers should stay DOM-agnostic so they are easy to test.

- [x] **Step 4: Verify helper tests pass**

Run:

```bash
node --test --import tsx tests/slash-command-editor.test.ts
```

Expected: PASS.

## Task 5: Slash Command Hook

**Files:**
- Create: `src/hooks/useSlashCommands.ts`
- Test: `tests/useSlashCommands.test.ts`

- [x] **Step 1: Write failing hook tests**

Cover:

- loads command list for current project path
- opens only when current line starts with `/`
- filters by query
- keeps selection index bounded

Run:

```bash
node --test --import tsx tests/useSlashCommands.test.ts
```

Expected: FAIL because the hook does not exist.

- [x] **Step 2: Implement command loading and local filtering**

The hook should:

- fetch `/api/slash-commands`
- store normalized commands
- derive current slash query from draft text and caret position
- expose `open`, `query`, `selectedIndex`, filtered commands, and selection helpers

- [ ] **Step 3: Verify hook tests pass**

Run:

```bash
node --test --import tsx tests/useSlashCommands.test.ts
```

Expected: PASS.

## Task 6: Slash Command Menu UI

**Files:**
- Create: `src/components/SlashCommandMenu.tsx`
- Modify: `src/styles.css`

- [x] **Step 1: Build the lightweight grouped menu**

Render grouped commands with:

- slash label
- short title
- one-line description
- selected row styling

Keep it visually aligned with existing composer popover language, not a separate command center.

- [x] **Step 2: Add source grouping and stable item sizing**

Groups:

1. Built-in
2. Project and user
3. Plugins and skills
4. MCP
5. CodeM

Keep rows compact and keyboard-friendly.

- [x] **Step 3: Add minimal CSS**

Include only the menu container, group label, item row, selected state, and description text. Avoid heavyweight panel styling.

## Task 7: Composer Integration

**Files:**
- Modify: `src/components/Composer.tsx`
- Modify: `src/App.tsx`

- [x] **Step 1: Wire line-start trigger detection into `Composer`**

Use current text and caret position to decide whether slash mode is active.

Rule:

- only the current line matters
- `/` must be first non-whitespace token on that line

- [x] **Step 2: Mount `SlashCommandMenu` above the composer**

Integrate with keyboard navigation:

- `ArrowUp`
- `ArrowDown`
- `Enter`
- `Escape`

Selection behavior:

- `insert-template` replaces the active slash line
- `passthrough` inserts the command text
- `local-action` marks the draft as a pending local action or dispatches immediately depending on handler shape

- [x] **Step 3: Preserve existing composer behavior**

Do not break:

- image attachments
- queued prompts
- send shortcut behavior
- permission/model pickers

## Task 8: Submission Routing

**Files:**
- Create: `src/lib/slash-command-submit.ts`
- Modify: `src/hooks/useClaudeRun.ts`

- [x] **Step 1: Create a thin slash submission resolver**

Handle:

- `local-action`
- `passthrough`

For v1, `insert-template` is resolved before send, so submission only needs to handle local actions and normal passthrough text.

- [x] **Step 2: Add initial local-action handlers**

Support at least:

- `/clear`
- `/help`

These should not go through `/api/claude/run`.

- [x] **Step 3: Preserve normal Claude run flow**

Commands such as `/compact` must continue through the same `useClaudeRun` submission path as any other message text, unless later intentionally specialized.

## Task 9: Integration and Regression Coverage

**Files:**
- Modify or create tests near composer and run hooks as needed

- [ ] **Step 1: Add integration coverage for template insertion**

Assert:

- `/brainstorming` opens in menu
- selecting it inserts template content
- nothing is auto-sent

- [ ] **Step 2: Add integration coverage for passthrough**

Assert:

- `/compact` can be selected
- command text remains in composer
- send still uses the normal Claude request path

- [ ] **Step 3: Add integration coverage for local actions**

Assert:

- `/clear` executes locally
- no Claude request is sent

## Task 10: Verification

**Files:**
- Spike script
- backend tests
- frontend tests

- [x] **Step 1: Run spike validation**

```bash
node scripts/slash-commands-spike.mjs --project <codem-workspace>
```

Expected: grouped normalized command output.

- [x] **Step 2: Run backend tests**

```bash
node --test --import tsx server/lib/slash-commands.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run frontend tests**

```bash
node --test --import tsx tests/slash-command-editor.test.ts tests/useSlashCommands.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run app safety checks**

```bash
npm run typecheck
npm run build
```

Expected: PASS.

## Notes

- Keep `.codex-logs/` out of commits.
- Reuse existing scanners and menu patterns where they genuinely fit; do not import reference-project complexity wholesale.
- Do not special-case many commands in the first version. Local handling should stay intentionally small.
- If backend or frontend service changes need a running dev server refresh during implementation, restart the relevant project service and mention it in the delivery note.
