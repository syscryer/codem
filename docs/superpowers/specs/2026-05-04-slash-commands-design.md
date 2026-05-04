# CodeM Slash Commands Design

Date: 2026-05-04
Status: Draft for review
Scope: CodeM Web frontend (`src/**`) and backend bridge (`server/**`)

## Summary

CodeM will add a unified slash command surface in the composer so users can type `/` at the start of the current line and discover practical commands from multiple sources in one menu. The first version will support built-in commands, project and user Claude custom commands, plugin and skill-derived commands, MCP commands, and CodeM local UI commands.

The product should feel like Claude Code's slash command entry while still fitting CodeM's existing workspace and thread model. The design keeps command discovery and command execution separate: the UI presents a unified menu, while execution is routed according to each command's declared action mode.

## Goals

- Provide one practical `/` menu in the composer instead of separate command entry paths.
- Support useful command sources in a single registry:
  - built-in commands
  - project `.claude/commands`
  - user `~/.claude/commands`
  - plugin and skill commands
  - MCP commands
  - CodeM local commands
- Only trigger slash command UI when `/` appears at the start of the current line.
- Support mixed execution semantics:
  - passthrough to Claude Code
  - insert template into the composer
  - execute local CodeM action
- Validate discovery and normalization with a standalone spike script before integrating the main app.

## Non-Goals

- No rich parameter form UI in the first version.
- No full MCP prompt discovery or schema-aware execution in the first version.
- No command editor or command management UI.
- No permission system specific to slash commands.
- No separate slash command runtime or background task center.

## Product Shape

### User Experience

When the user types `/` at the start of the current line in the composer, CodeM opens a lightweight command menu above the input. The menu supports keyboard and mouse navigation, shows a short description for each command, and groups commands by source.

The user flow depends on command type:

- `insert-template`: selecting the command replaces the current slash line with a template and keeps the user in the composer
- `passthrough`: selecting the command inserts the command text into the composer and waits for the user to send
- `local-action`: selecting the command executes a CodeM action directly

Examples:

- `/brainstorming` inserts a workflow template into the composer
- `/compact` remains a slash command and is sent through the normal Claude run path
- `/clear` executes a local CodeM thread-clearing action

### Trigger Rule

Slash command UI only opens when the current line begins with `/`, optionally preceded by whitespace.

Supported:

- `/brainstorming`
- `   /brainstorming`
- multi-line composer input where the active line begins with `/`

Not supported:

- `请执行 /brainstorming`
- path text, regex text, or normal prose containing `/`

## Approaches Considered

### A. Passthrough-first

Keep the slash menu thin and treat most commands as text sent to Claude Code.

Pros:

- small backend change
- closest to raw Claude behavior

Cons:

- weak normalization across sources
- command behavior becomes harder to reason about as sources grow
- special cases leak into the composer over time

### B. Unified registry with mixed execution

Build one normalized slash command registry on the backend and let each command declare its execution mode.

Pros:

- strongest long-term structure
- easy to extend with more sources
- keeps frontend and backend responsibilities clear
- supports mixed command semantics cleanly

Cons:

- requires one shared command schema up front

### C. Frontend-only aggregation

Query multiple data sources directly from the frontend and merge there.

Pros:

- fast to prototype
- flexible UI iteration

Cons:

- weak ownership boundaries
- duplicated normalization logic
- harder to test and maintain

### Decision

Adopt approach B: a unified backend registry with mixed execution.

This best matches the approved product direction:

- one menu
- practical commands from many sources
- support for both template insertion and execution
- future room for richer command metadata

## Core Design

### Command Model

CodeM will normalize all slash commands into one shared shape.

```ts
type SlashCommandSource =
  | 'builtin'
  | 'project'
  | 'user'
  | 'plugin'
  | 'skill'
  | 'mcp'
  | 'app';

type SlashCommandAction =
  | 'passthrough'
  | 'insert-template'
  | 'local-action';

type SlashCommand = {
  id: string;
  name: string;
  slash: string;
  title: string;
  description?: string;
  source: SlashCommandSource;
  action: SlashCommandAction;
  template?: string;
  argumentHint?: string;
  sourceLabel?: string;
  localActionId?: string;
};
```

Key principle: source and execution mode are separate fields.

Examples:

- `/compact`
  - `source: 'builtin'`
  - `action: 'passthrough'`
- `/brainstorming`
  - `source: 'skill'`
  - `action: 'insert-template'`
- `/clear`
  - `source: 'app'`
  - `action: 'local-action'`

### Command Sources

The first version includes these sources.

#### Built-in commands

Product-recognized commands that are meaningful to Claude Code or the CodeM workflow.

Initial examples:

- `/compact`
- `/review`

These are listed in the registry even when they are executed by passthrough.

#### Project commands

Discovered from:

- `<project>/.claude/commands/**/*.md`

These commands are normalized from file metadata and path name. They default to `passthrough`.

#### User commands

Discovered from:

- `~/.claude/commands/**/*.md`

These behave the same as project commands but are scoped globally to the user environment.

#### Plugin and skill commands

Derived from existing CodeM plugin and skill discovery data. These commands default to `insert-template` when a usable template is available.

Initial expectation:

- workflow skills such as `brainstorming` should insert a structured prompt template into the composer

Commands without a usable template are excluded from the first version rather than shown with incomplete behavior.

#### MCP commands

The first version exposes MCP commands in the menu as discoverable passthrough entries.

The first version does not attempt deep prompt discovery or argument schema extraction. MCP entries are present primarily for discoverability and command insertion.

#### App commands

CodeM-local commands handled without sending to Claude.

Initial examples:

- `/clear`
- `/help`

Later candidates:

- `/model`
- `/permissions`

## Information Architecture

The menu groups commands by source to keep the list legible without turning grouping into the main focus.

Initial group order:

1. Built-in
2. Project and user commands
3. Plugins and skills
4. MCP
5. CodeM

Within each group, commands sort alphabetically. A future version may add recent or pinned commands, but the first version keeps ordering deterministic.

## Frontend Design

### Component Placement

The slash command surface belongs in the composer and should not create a separate page or modal.

Primary touchpoints:

- `src/components/Composer.tsx`
- new `src/components/SlashCommandMenu.tsx`
- new `src/hooks/useSlashCommands.ts`

### Frontend State

```ts
type SlashMenuState = {
  open: boolean;
  query: string;
  selectedIndex: number;
  commands: SlashCommand[];
  loading: boolean;
};
```

### UI Behavior

- Typing `/` at current-line start opens the menu
- Additional characters filter the list
- `ArrowUp` and `ArrowDown` move selection
- `Enter` selects
- `Escape` closes
- Mouse click selects

Selection behavior:

- `insert-template`: replace current slash line with template content and place cursor at the insertion target
- `passthrough`: insert the chosen slash command into the current line and wait for explicit send
- `local-action`: execute immediately

### Composer Rule

Slash logic stays shallow in the composer. The composer detects and presents commands, but it does not become the main command router.

## Backend Design

### New Service

Add a registry service:

- `server/lib/slash-commands.ts`

Suggested responsibilities:

- `listBuiltinSlashCommands()`
- `listClaudeCustomSlashCommands(projectPath?: string)`
- `listSkillSlashCommands(projectPath?: string)`
- `listMcpSlashCommands()`
- `listAppSlashCommands()`
- `listSlashCommands(context)`

### New API

Add a read-only endpoint:

- `GET /api/slash-commands?projectPath=...`

The response is a normalized array of `SlashCommand`.

The backend owns discovery and normalization so the frontend only deals with one stable contract.

## Execution Flow

### Discovery Flow

1. Composer mounts or active project changes
2. Frontend requests `/api/slash-commands`
3. Backend discovers and normalizes commands
4. Frontend stores command list
5. Typing `/` filters the local in-memory list

### Submission Flow

Slash commands still use the existing message submission pipeline unless they are local actions.

Suggested split:

- detection in composer
- lightweight resolution before `useClaudeRun` submission

Resolution behavior:

- `local-action`: handle in CodeM and do not send to Claude
- `insert-template`: transform composer text before send; user still chooses when to send
- `passthrough`: treat as normal prompt text and continue through the existing `/api/claude/run` flow

This keeps thread, queue, runtime, and approval behavior aligned with existing CodeM message sending.

## Standalone Spike

Before implementation, build a separate validation script:

- `scripts/slash-commands-spike.mjs`

Purpose:

- verify command discovery across all first-version sources
- verify normalization into the shared schema
- verify correct action assignment
- verify line-start detection assumptions on sample inputs

Suggested script input:

- `--project D:\\project\\codem`

Suggested script output:

- grouped command list by source
- normalized sample payloads
- template previews for insert-template commands

This script is a validation tool only, not production code.

## Error Handling

The registry must be resilient to partial failures.

- If one source fails, the full slash menu still loads from other sources
- `.claude/commands` parse errors are logged and skipped per file
- skills without usable templates are hidden in v1
- MCP commands without rich metadata are still shown as passthrough entries
- local-action failures surface via toast and do not corrupt composer state

The menu should never fail closed just because one source is malformed.

## Testing Strategy

### Spike validation

- verify command discovery across all sources
- verify normalized payload shape
- verify action assignment for:
  - `/compact`
  - `/brainstorming`
  - `/clear`

### Backend tests

- custom command scanning
- skill-to-template mapping
- mixed source aggregation
- error isolation when one source fails

### Frontend tests

- line-start trigger detection
- filtering and keyboard navigation
- insert-template replacement behavior
- passthrough command insertion behavior
- local-action dispatch behavior

### Integration tests

- `/brainstorming` inserts template and does not send automatically
- `/compact` remains a normal message submission through Claude flow
- `/clear` executes locally and does not submit to Claude

## First-Version Scope

### Included

- unified slash command menu
- line-start-only trigger
- backend registry
- normalized command schema
- built-in, project, user, plugin, skill, MCP, and app command sources
- mixed actions:
  - passthrough
  - insert-template
  - local-action
- standalone spike script

### Explicitly excluded

- parameter forms
- command authoring UI
- rich MCP prompt inspection
- command-specific permissions
- separate slash execution center

## Risks and Mitigations

### Risk: Source sprawl creates inconsistent entries

Mitigation: require all sources to normalize into one schema before the frontend sees them.

### Risk: Composer behavior becomes cluttered

Mitigation: keep detection and presentation in the composer, but keep execution routing outside the menu component.

### Risk: Plugin and skill commands are too loose to trust

Mitigation: first version only exposes skill entries that can produce a clear insertion template.

### Risk: MCP command support looks more complete than it is

Mitigation: label MCP entries clearly and keep them passthrough-only in v1.

## Rollout Order

1. Create `scripts/slash-commands-spike.mjs`
2. Implement backend registry service
3. Add `/api/slash-commands`
4. Add frontend slash command hook and menu
5. Add submission resolver for local-action and template insertion
6. Add tests and polish copy

## Final Recommendation

Build CodeM slash commands as a unified registry with mixed execution semantics. Let the frontend present one coherent `/` menu, let the backend own discovery and normalization, and keep actual message sending inside the existing Claude run pipeline whenever the command is not a local CodeM action.
