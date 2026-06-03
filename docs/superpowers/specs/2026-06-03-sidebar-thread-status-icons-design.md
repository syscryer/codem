# Sidebar Thread Status Icons Design

## Scope

- Only adjust the small status indicator shown on the right side of sidebar thread rows.
- Do not change thread ordering, pinning, search, or thread menu actions.
- Do not change the main conversation pane, notification system, or backend run state logic.

## User-facing goal

- Make sidebar thread status easier to scan at a glance.
- Use a compact icon language with clear separation between completion, running, and hot-session states.

## Status mapping

- `completed` uses a blue solid dot on the right.
- `running` uses a gray ring on the right.
- `hot` uses a small lightning glyph on the right.

## Visual rules

- The icon stays small and aligned to the right edge of the thread row.
- The icon must not change row height or shift the thread title.
- The icon treatment should stay consistent across pinned and unpinned threads.
- The active row background remains unchanged.

## Behavior

- A thread marked completed always shows the blue solid dot.
- A thread currently running always shows the gray ring.
- A thread with a hot reusable session shows the lightning glyph.
- A running thread does not also show the hot icon.

## Implementation boundary

- Update the sidebar thread row rendering and shared sidebar status styles only.
- Keep the existing thread activity notice logic as-is unless the icon mapping requires a small adapter.

## Verification

- Open the sidebar thread list in a project with:
  - one completed thread
  - one running thread
  - one hot session thread
- Confirm the icons match the mapping above.
- Confirm row height and title truncation stay stable.
- Confirm the active row styling still reads clearly.
