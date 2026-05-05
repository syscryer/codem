# Workbench Preview Shortcuts Design

## Goal

Allow chat cards to open documents and changed files directly into the existing right-side preview area, without launching an external editor.

## Scope

This change stays inside the Web frontend in `src/**`.

Included:

- a shared right-workbench preview controller
- chat-card shortcuts that open files into the right preview area
- reuse of the existing Markdown / code / diff preview rendering

Not included:

- external editor open actions
- new file preview backend APIs
- inline preview inside the chat card
- multi-target "open with" handling for files

## Current Problem

The right preview area already supports:

- Markdown preview
- code preview
- git diff preview

But the preview tab state is currently local to `WorkbenchFiles` inside `RightWorkbench.tsx`. That makes the file tree the only place that can open preview tabs. Chat cards cannot reuse the same behavior.

## Options Considered

### Option 1: Lift preview state to `App`

Move preview tab state and preview-opening actions up to `App`, then pass them down to `RightWorkbench` and chat-card entry points.

Pros:

- one preview system for the whole app
- chat cards and file tree reuse the same behavior
- clean foundation for future file-opening entry points

Cons:

- requires prop reshaping across `App` and `RightWorkbench`

### Option 2: Event bridge into `WorkbenchFiles`

Keep preview state inside `WorkbenchFiles`, and push "open file" requests into it via a bridge prop or event.

Pros:

- smaller initial refactor

Cons:

- splits authority between state owner and external triggers
- harder to maintain as more entry points appear

### Option 3: Inline preview inside cards

Render Markdown / code directly in the conversation card.

Pros:

- local implementation

Cons:

- wrong UX target
- duplicates existing preview rendering

## Decision

Use Option 1.

## UX Design

### Shortcut Entry Points

First version adds two chat-originated entry points:

- document card `打开`
- changed-file rows inside the modification summary card

### Resulting Behavior

When the user triggers one of these shortcuts:

- the right workbench opens if collapsed
- the file preview area becomes active
- the requested file opens in a preview tab
- if the tab already exists, it becomes active instead of duplicating

### Preview Types

Use existing preview routing:

- `.md` -> Markdown preview
- source files -> code preview
- changed-file summary rows can open as file preview first; git diff preview can stay a later enhancement if needed

## Architecture

### Shared preview controller in `App`

`App.tsx` becomes the owner of:

- preview tabs
- active preview key
- preview content cache
- shared open/close/select actions

### `RightWorkbench` becomes presentational for preview state

`RightWorkbench.tsx` and its child sections receive preview state and callbacks from above instead of owning the full tab lifecycle internally.

### Chat cards use callback props

`ConversationPane` / `ConversationTurn` receive a callback such as:

- `onOpenWorkbenchPreview(file)`

Chat cards do not fetch preview data themselves. They only emit a file-open intent.

## Data Model

Add a shared preview target shape that can represent:

- project file preview
- changed file preview

It should include enough data for:

- tab key
- file path
- display name
- preview kind

## File Summary Card Behavior

The modification summary card should expose a compact list of changed files. Clicking one row should open the corresponding file in the right preview area.

The top document card should use the same open callback for its primary `打开` action.

## Error Handling

- If no active project exists, ignore the open request and show a toast.
- If preview loading fails, reuse the existing workbench error state.
- If a file path cannot be resolved, show an inline toast instead of opening an empty tab.

## Testing

Add tests for:

- shared preview target normalization
- duplicate tab reuse
- activating existing tabs instead of appending duplicates
- document-card shortcut building the expected preview target

## Acceptance Criteria

- Clicking `打开` on a document card opens the file in the right preview area.
- Clicking a changed-file row in the summary card opens that file in the right preview area.
- Existing preview tabs are reused instead of duplicated.
- The existing file tree in the workbench still opens files normally.
