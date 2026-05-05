# Agent-Specific Slash Commands Design

Date: 2026-05-05
Status: Draft for review
Scope: CodeM Web frontend (`src/**`) and backend bridge (`server/**`)

## Summary

CodeM will refine slash commands from a generic mixed source list into an agent-aware command surface. The slash menu should only show commands that are both relevant to the current agent and already implemented in CodeM.

The main UX change is that implemented slash commands stop using right-bottom toast notifications as their primary feedback. Instead, command execution is rendered in the main conversation timeline as:

1. a user bubble containing the original slash command text
2. a system result card containing the command result or command status

This preserves command history, keeps feedback near the conversation, and creates a UI model that can scale to more agents later.

## Background

The current slash command work introduced a normalized command registry and local-action handling, but two product issues remain:

- the menu exposed commands that were not actually implemented, which produced low-value "not implemented" feedback
- implemented local commands such as `/status` and `/help` used toast as the primary output surface, which made them hard to revisit and inconsistent with the rest of the conversation model

The approved direction is:

- only show commands that are implemented for the current agent
- render command results in the conversation timeline instead of toast
- support different implemented command sets for different agents

## Goals

- Show only implemented slash commands for the current agent.
- Remove "not implemented" slash commands from the visible menu.
- Render implemented slash commands in the main chat history, not in transient toast.
- Keep the rendering model compatible with the existing `turn.items` timeline direction.
- Make command capability registration extensible so Claude, Codex, Gemini, OpenCode, or future agents can advertise different command sets.
- Apply the same current-agent filtering rule to built-in commands, CodeM app commands, skills, MCP commands, and custom command sources.

## Non-Goals

- No attempt to support every official slash command immediately.
- No cross-agent requirement that all agents expose the same slash command names.
- No right-side debug panel as the primary result surface for implemented slash commands.
- No full command authoring UI or command permissions UI.
- No history entry for `/clear` in the old thread.

## Product Decisions

### Command Visibility

The slash menu must only show commands that satisfy both conditions:

1. the command belongs to the active agent
2. the command is implemented in CodeM

Unsupported or placeholder commands are not shown. They are not greyed out, grouped under "coming soon", or exposed with "not implemented" fallback behavior.

This rule applies to the entire slash registry, not only built-in commands.

That means these source groups are all filtered by current agent:

- built-in agent commands
- CodeM app commands
- skills
- MCP commands
- project commands
- user commands
- plugin commands

### First Agent Rollout

The first adapter will target Claude.

Initial Claude command set:

- `/status`
- `/compact`
- `/context`
- `/cost`
- `/clear`

Commands intentionally excluded from the first implemented set:

- `/help`
- `/model`
- `/permissions`

Reasons:

- `/help` adds little value in a GUI and pollutes history
- `/model` and `/permissions` already have direct GUI controls

### Conversation Rendering

Implemented slash commands use a single UX pattern:

1. user command bubble
2. system result card

Example:

- user bubble: `/status`
- system card: summary of project, thread, model, permission, session, and runtime state

Cards remain in conversation history. They do not disappear automatically.

### `/clear` Special Case

`/clear` keeps its "start a new chat" behavior and does not append a result card into the old thread. Its semantic meaning is thread creation, not "run a command and report a result".

### Toast Role

Toast remains valid for short-lived side effects such as:

- copy success
- save success
- open-in-editor success

Toast is no longer the primary output surface for implemented slash commands.

## Approaches Considered

### A. Global command list with per-command unsupported fallback

Show a large command list and let unsupported commands respond with "not implemented".

Pros:

- easy to populate the menu quickly

Cons:

- weak trust signal
- poor user experience
- harder to scale across multiple agents

### B. Frontend hardcoded per-agent slash menu

Keep different hardcoded slash lists in the frontend and branch execution logic there.

Pros:

- fast to prototype

Cons:

- duplicates capability knowledge
- grows brittle as agents increase
- tends toward `ccgui`-style drift between menu and execution

### C. Agent capability registry with unified rendering

Each agent advertises its implemented slash capabilities. The menu only shows those capabilities. Rendering stays shared.

Pros:

- cleanest multi-agent scaling model
- separates capability declaration from UI rendering
- easy to reason about implemented surface area

Cons:

- requires a small new abstraction layer up front

### Decision

Adopt approach C.

## Core Design

### Capability Model

Add an agent-aware slash capability layer instead of treating all built-in commands as a flat static list.

Proposed shape:

```ts
type SlashCapabilityKind =
  | 'system-card'
  | 'new-thread'
  | 'agent-native';

type SlashCardType =
  | 'status'
  | 'context'
  | 'cost'
  | 'compact';

type AgentSlashCapability = {
  id: string;
  agent: 'claude' | 'codex' | 'gemini' | 'opencode';
  slash: string;
  title: string;
  description: string;
  kind: SlashCapabilityKind;
  cardType?: SlashCardType;
};
```

Notes:

- `kind` controls execution semantics
- `cardType` controls how the shared conversation card renders
- only implemented commands are registered

### Registry Scope Model

The registry should distinguish command source from agent availability.

Proposed additional shape:

```ts
type SlashAgent = 'claude' | 'codex' | 'gemini' | 'opencode';

type SlashCommandSource =
  | 'builtin'
  | 'app'
  | 'project'
  | 'user'
  | 'plugin'
  | 'skill'
  | 'mcp';

type AgentScopedSlashCommand = {
  id: string;
  slash: string;
  title: string;
  description?: string;
  source: SlashCommandSource;
  agentScope: SlashAgent[];
};
```

Rules:

- `source` explains where the command comes from
- `agentScope` explains where the command is allowed to appear
- a command is visible only when the current agent is included in `agentScope`

This same scope rule must apply to:

- implemented built-in/app commands
- skill-derived commands
- MCP commands
- project/user/plugin markdown commands

### Menu Composition

The slash menu should be derived from:

1. implemented capabilities for the active agent
2. custom/project/user/plugin/skill/MCP commands that are already supported by the existing registry model and allowed for the active agent

For built-in agent commands, the visible list comes from the capability registry, not from a broad "official commands" placeholder table.

For all other sources, visibility also requires agent-scope compatibility.

The menu should be thought of as:

`visible slash commands = implemented current-agent built-ins/app commands + current-agent-compatible supported external commands`

Examples:

- a Codex-only skill does not appear while Claude is active
- a Claude-only MCP prefix does not appear while Codex is active
- a Claude-only project custom command does not appear while another agent is active

### Timeline Model

Implemented command results should be represented as timeline items rather than external UI state.

Add a new `turn.items` entry shape:

```ts
type SystemCommandItem = {
  id: string;
  type: 'system-command';
  command: string;
  title: string;
  cardType: 'status' | 'context' | 'cost' | 'compact';
  state: 'running' | 'done' | 'error';
  summary?: string;
  details?: Record<string, unknown>;
  errorMessage?: string;
};
```

This keeps slash command feedback aligned with the existing conversation model direction:

- user-visible content lives in `turn.items`
- history can persist the same shape
- rendering stays in the main timeline

### Turn Creation Rules

For implemented slash commands other than `/clear`:

1. create a normal turn
2. set `turn.userText` to the submitted slash command text
3. append a `system-command` item to `turn.items`
4. mark that item `running`, `done`, or `error` depending on command behavior

This means a slash command is visible as a normal conversation action rather than an out-of-band UI event.

### Command Result Cards

#### `/status`

Collapsed summary should include:

- active project
- active thread
- current model
- permission mode
- running state

Expanded details can include:

- workspace path
- session id
- CLI health state

#### `/context`

Collapsed summary should include:

- current context usage summary
- compression relevance when available

Expanded details can include more precise context counters if available.

#### `/cost`

Collapsed summary should include:

- current token/cost summary relevant to the active agent or active thread

Expanded details can include a fuller breakdown if available.

#### `/compact`

This command uses a status-oriented card:

- `running`: compaction has started
- `done`: compaction completed
- `error`: compaction failed with reason

It should feel like a command-state card rather than a plain text message.

## Agent Adapter Responsibilities

Each agent adapter owns:

- which slash commands are implemented
- how each command executes
- what card data shape is produced
- which external slash command sources are compatible with that agent when compatibility cannot be inferred globally

Shared UI owns:

- command menu rendering
- user bubble rendering
- system command card rendering
- item persistence and history display

This allows different agents to expose different commands without forcing a shared command vocabulary.

## External Source Filtering

### Skills

Skills should not be treated as globally visible by default.

Each skill-derived slash command should declare or resolve an allowed agent scope. If the current agent is not in scope, the skill command does not appear in the slash menu.

### MCP Commands

MCP commands should also be filtered by current agent.

Even if a server exists in local configuration, its slash-prefix entry should only appear when the active agent supports that MCP interaction model.

### Project, User, and Plugin Commands

Markdown commands discovered from project, user, or plugin directories should also participate in agent filtering.

If a command is only valid for Claude-style slash execution, it should not be shown while another incompatible agent is active.

If current metadata is insufficient to infer agent compatibility, the implementation may start with conservative defaults such as:

- explicit metadata wins
- otherwise, unsupported agents do not show the command

The design should prefer hidden-over-incorrect visibility.

## Execution Semantics by Command

### `system-card`

Used for commands like:

- `/status`
- `/context`
- `/cost`

Behavior:

- create turn immediately
- generate card content locally or through the agent adapter
- write result into the same turn

### `agent-native`

Used for commands like:

- `/compact`

Behavior:

- create turn immediately
- start command execution through the agent-specific path
- update card state as execution progresses

### `new-thread`

Used for:

- `/clear`

Behavior:

- do not append a result card to the old thread
- create a new thread and clear composer state as needed

## Error Handling

If an implemented slash command fails:

- keep the user slash command bubble in the timeline
- render the corresponding system card in `error` state
- show the error inside the card

Do not fall back to a toast-only failure mode except for true secondary notification needs.

## Persistence

System command cards should persist through the same thread history path as other turns.

Requirements:

- stored turns must retain `system-command` items
- reload must reproduce the same history shape
- history should not silently collapse command cards back into plain text

`/clear` remains exempt because it intentionally does not write a result turn into the old thread.

## Testing Requirements

Implementation should include coverage for:

- current-agent filtering only shows implemented commands
- unsupported agent commands are absent from the menu
- skill commands are absent when the active agent is out of scope
- MCP commands are absent when the active agent is out of scope
- project/user/plugin commands are absent when the active agent is out of scope
- `/status` creates a user turn plus system result card
- `/context` creates a user turn plus system result card
- `/cost` creates a user turn plus system result card
- `/compact` shows running and terminal card states
- `/clear` starts a new thread and does not append a result card to the old thread
- history persistence preserves `system-command` items
- toast is not the primary feedback path for implemented slash commands

## Rollout Notes

This design intentionally keeps the first implementation narrow:

- one agent adapter: Claude
- five implemented built-in commands
- one shared card rendering primitive
- full-registry agent filtering semantics, even if only Claude is populated first

That narrow scope is sufficient to validate the product direction before expanding to more agents or more slash commands.
