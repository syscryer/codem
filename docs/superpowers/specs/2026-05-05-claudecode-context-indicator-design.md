# ClaudeCode Context Indicator Design

## Goal

Add a persistent context-usage entry point to the composer for `claudecode`, modeled after the lightweight AnyCode interaction:

- show a small ring in the composer toolbar
- click the ring to open a context stats card
- keep the implementation generic enough to support other agents later

## Scope

This change only affects the Web frontend in `src/**`.

Included:

- a `claudecode`-only composer indicator
- a reusable context-usage view-model/helper
- a popover card with token breakdown
- tests for the view-model and visibility rules

Not included:

- auto-compact thresholds or warnings
- compact actions inside the card
- placeholder UI for non-Claude agents
- backend API changes
- removing `/context`

## Options Considered

### Option 1: Standalone ring in composer toolbar

Show a compact circular indicator next to the existing right-side composer controls and open a popover card on click.

Pros:

- always visible without polluting chat history
- consistent with the user's AnyCode reference
- minimal coupling with model / permissions menus

Cons:

- requires a new toolbar affordance

### Option 2: Merge into model selector

Append context state to the model trigger or its dropdown.

Pros:

- fewer visible controls

Cons:

- hides a high-frequency status behind an unrelated control
- harder to extend per agent

### Option 3: Chat-card only

Keep `/context` as the only entry point and improve its output.

Pros:

- no persistent UI changes

Cons:

- too slow for frequent checking
- does not match the desired interaction

## Decision

Use Option 1.

## UX Design

### Visibility

- Render only when `agent === 'claude'`.
- Keep the API generic so other agents can supply their own resolver later.

### Toolbar Behavior

- Place the ring in `Composer` right-side tools, before the send button area.
- Default state is ring-only with no inline label.
- Ring color follows usage bands:
  - `0-60%`: green
  - `60-80%`: yellow
  - `80-90%`: orange
  - `90%+`: red
- When there is no usage data yet, render a neutral gray ring.

### Popover Card

Clicking the ring toggles a popover card. The card shows:

- title: `Context Usage`
- primary summary: percentage and `used / total`
- breakdown rows:
  - input tokens
  - cache creation
  - cache read
  - output tokens

Empty state copy:

- `当前线程还没有上下文数据`

## Data Model

Add a frontend-only helper/view-model that accepts:

- current `agent`
- current `model`
- current thread `turns`

The helper returns:

- `visible`
- `hasUsage`
- `percent`
- `usedTokens`
- `totalTokens`
- `level`
- `breakdown`

## Calculation Rules

For `claudecode`, context usage is calculated from aggregated thread turns using:

`usedTokens = inputTokens + cacheCreationInputTokens + cacheReadInputTokens`

Notes:

- `outputTokens` are shown in the card but do not count toward the ring percentage.
- totals are aggregated from the thread's persisted `ConversationTurn` usage fields.
- context-window size is resolved from the current Claude model through a small frontend resolver table. If the model is unknown, fall back to a safe Claude default rather than hiding the control.

## Architecture

### New frontend helper

Create a small helper in `src/lib/**` that:

- summarizes thread token usage
- resolves Claude context-window size by model
- produces a UI-ready view-model

### New UI component

Create a focused component in `src/components/**` that:

- renders the ring
- manages popover open/close state
- renders the detail card from the supplied view-model

### Composer integration

`Composer` stays responsible only for placement and wiring:

- pass `agent`, `model`, and active thread `turns`
- render nothing for non-Claude agents

## Error Handling

- Missing turns: show neutral ring and empty-state card.
- Unknown model: use fallback Claude context size and still render.
- Partial token data on turns: treat missing numeric fields as `0`.

## Testing

Add tests for:

- visibility gated to `claude`
- usage aggregation excludes output from percentage
- color/level thresholds at 60/80/90
- empty-state view-model
- unknown model fallback

## Acceptance Criteria

- `claude` threads show a context ring in the composer toolbar.
- Clicking the ring opens a context card with AnyCode-like summary and breakdown.
- Non-Claude agents do not show the ring.
- `/context` continues to work unchanged.
