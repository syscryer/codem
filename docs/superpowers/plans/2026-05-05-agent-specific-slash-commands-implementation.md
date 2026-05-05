# Agent-Specific Slash Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CodeM slash commands agent-aware, only show implemented commands for the active agent, and render implemented command results in the main conversation timeline as user command + system result card.

**Architecture:** Add an agent-scoped slash capability layer on top of the existing registry, then route implemented local slash commands through a shared conversation item model instead of toast. Reuse `turn.items` as the primary rendering surface, keep `/clear` as a new-thread special case, and implement the first real command-card flow for the Claude adapter.

**Tech Stack:** TypeScript, React 19, Vite, Express 5, Node built-ins, node:test, `tsx`.

---

## File Structure

- Create: `src/lib/agent-slash-capabilities.ts`
- Create: `src/lib/system-command-items.ts`
- Create: `tests/agent-slash-capabilities.test.ts`
- Create: `tests/system-command-items.test.ts`
- Modify: `server/lib/slash-commands.ts`
- Modify: `server/lib/slash-commands.test.ts`
- Modify: `scripts/slash-commands-spike.mjs`
- Modify: `tests/slash-commands-spike.test.ts`
- Modify: `src/types.ts`
- Modify: `src/lib/slash-command-submit.ts`
- Modify: `tests/slash-command-submit.test.ts`
- Modify: `src/hooks/useSlashCommands.ts`
- Modify: `tests/useSlashCommands.test.ts`
- Modify: `src/components/Composer.tsx`
- Modify: `src/App.tsx`
- Modify: `src/lib/conversation.ts`
- Modify: `src/components/ConversationTurn.tsx`
- Modify: `src/styles.css`
- Modify: `src/hooks/useClaudeRun.ts`

## Task 1: Add Agent-Scoped Slash Capability Filtering

**Files:**
- Create: `src/lib/agent-slash-capabilities.ts`
- Test: `tests/agent-slash-capabilities.test.ts`
- Modify: `server/lib/slash-commands.ts`
- Modify: `server/lib/slash-commands.test.ts`
- Modify: `scripts/slash-commands-spike.mjs`
- Modify: `tests/slash-commands-spike.test.ts`

- [ ] **Step 1: Write the failing capability filtering tests**

Create `tests/agent-slash-capabilities.test.ts` covering the first filtering rules:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { filterSlashCommandsForAgent } from '../src/lib/agent-slash-capabilities';
import type { SlashCommand } from '../src/types';

const commands: SlashCommand[] = [
  {
    id: 'builtin:/status',
    name: 'status',
    slash: '/status',
    title: 'Status',
    source: 'builtin',
    action: 'local-action',
    localActionId: 'show-status',
    agentScope: ['claude'],
  },
  {
    id: 'skill:/brainstorming',
    name: 'brainstorming',
    slash: '/brainstorming',
    title: 'Brainstorming',
    source: 'skill',
    action: 'insert-template',
    template: '...',
    agentScope: ['codex'],
  },
];

test('filterSlashCommandsForAgent keeps only commands allowed for the active agent', () => {
  assert.deepEqual(
    filterSlashCommandsForAgent(commands, 'claude').map((command) => command.slash),
    ['/status'],
  );
});
```

Run:

```bash
node --test --import tsx tests/agent-slash-capabilities.test.ts
```

Expected: FAIL because the capability helper does not exist yet.

- [ ] **Step 2: Implement the shared agent capability helper**

Create `src/lib/agent-slash-capabilities.ts` with a narrow API that can be reused by the frontend and tests:

```ts
import type { AgentType, SlashCommand } from '../types';

export function filterSlashCommandsForAgent(commands: SlashCommand[], agent: AgentType) {
  return commands.filter((command) => {
    const scope = command.agentScope;
    return Array.isArray(scope) && scope.includes(agent);
  });
}

export function getImplementedClaudeSlashCommands() {
  return [
    '/status',
    '/compact',
    '/context',
    '/cost',
    '/clear',
  ];
}
```

Keep this file focused on agent-aware selection only. Do not put execution logic here.

- [ ] **Step 3: Extend backend slash registry records with `agentScope`**

Update `server/lib/slash-commands.ts` so normalized commands carry explicit agent scope:

```ts
type SlashAgent = 'claude' | 'codex' | 'gemini' | 'opencode';

export type SlashCommand = {
  id: string;
  name: string;
  slash: string;
  title: string;
  source: SlashCommandSource;
  action: SlashCommandAction;
  agentScope: SlashAgent[];
  description?: string;
  template?: string;
  argumentHint?: string;
  sourceLabel?: string;
  localActionId?: string;
  category?: SlashCommandCategory;
};
```

First-pass scope rules:

- Claude built-ins/app commands: `['claude']`
- current supported project/user/plugin markdown commands: `['claude']`
- current supported MCP prefixes: `['claude']`
- skills: start conservative and mark only the current supported agent set explicitly

- [ ] **Step 4: Replace the broad built-in list with Claude-only implemented commands**

Change the built-in/app list in `server/lib/slash-commands.ts` to emit only:

```ts
[
  { slash: '/status', localActionId: 'show-status', agentScope: ['claude'] },
  { slash: '/compact', localActionId: 'compact-thread', agentScope: ['claude'] },
  { slash: '/context', localActionId: 'show-context', agentScope: ['claude'] },
  { slash: '/cost', localActionId: 'show-cost', agentScope: ['claude'] },
  { slash: '/clear', localActionId: 'clear-thread', agentScope: ['claude'] },
]
```

Do not reintroduce `/help`, `/model`, or `/permissions`.

- [ ] **Step 5: Update backend registry tests and spike expectations**

Adjust `server/lib/slash-commands.test.ts` and `tests/slash-commands-spike.test.ts` so they assert the new Claude-visible baseline:

```ts
assert.equal(commands.some((command) => command.slash === '/status'), true);
assert.equal(commands.some((command) => command.slash === '/help'), false);
assert.equal(commands.some((command) => command.slash === '/compact'), true);
```

Run:

```bash
node --test --import tsx server/lib/slash-commands.test.ts tests/slash-commands-spike.test.ts tests/agent-slash-capabilities.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/lib/slash-commands.ts server/lib/slash-commands.test.ts scripts/slash-commands-spike.mjs tests/slash-commands-spike.test.ts src/lib/agent-slash-capabilities.ts tests/agent-slash-capabilities.test.ts
git commit -m "feat: add agent-scoped slash capability filtering"
```

## Task 2: Extend Shared Types and Add System Command Timeline Items

**Files:**
- Modify: `src/types.ts`
- Create: `src/lib/system-command-items.ts`
- Create: `tests/system-command-items.test.ts`
- Modify: `src/lib/conversation.ts`

- [ ] **Step 1: Write the failing system command item tests**

Create `tests/system-command-items.test.ts` for the new item builder:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSystemCommandItem, settleSystemCommandItem } from '../src/lib/system-command-items';

test('createSystemCommandItem starts in running state with the submitted command text', () => {
  const item = createSystemCommandItem('/status', 'Status', 'status');
  assert.equal(item.type, 'system-command');
  assert.equal(item.command, '/status');
  assert.equal(item.state, 'running');
});

test('settleSystemCommandItem stores summary and details', () => {
  const item = createSystemCommandItem('/status', 'Status', 'status');
  const settled = settleSystemCommandItem(item, {
    state: 'done',
    summary: '项目: codem',
    details: { project: 'codem' },
  });
  assert.equal(settled.state, 'done');
  assert.equal(settled.summary, '项目: codem');
});
```

Run:

```bash
node --test --import tsx tests/system-command-items.test.ts
```

Expected: FAIL because the helper does not exist yet.

- [ ] **Step 2: Extend `src/types.ts` with agent and system-command item types**

Add the new shared types:

```ts
export type AgentType = 'claude' | 'codex' | 'gemini' | 'opencode';

export type SlashCardType = 'status' | 'context' | 'cost' | 'compact';

export type SystemCommandItem = {
  id: string;
  type: 'system-command';
  command: string;
  title: string;
  cardType: SlashCardType;
  state: 'running' | 'done' | 'error';
  summary?: string;
  details?: Record<string, unknown>;
  errorMessage?: string;
};
```

Add `SystemCommandItem` into `AssistantItem`.

- [ ] **Step 3: Implement system command item helpers**

Create `src/lib/system-command-items.ts`:

```ts
import type { SlashCardType, SystemCommandItem } from '../types';

export function createSystemCommandItem(command: string, title: string, cardType: SlashCardType): SystemCommandItem {
  return {
    id: crypto.randomUUID(),
    type: 'system-command',
    command,
    title,
    cardType,
    state: 'running',
  };
}

export function settleSystemCommandItem(
  item: SystemCommandItem,
  next: Pick<SystemCommandItem, 'state' | 'summary' | 'details' | 'errorMessage'>,
): SystemCommandItem {
  return { ...item, ...next };
}
```

- [ ] **Step 4: Teach `repairTurnItems()` and visible-output helpers about system-command items**

Update `src/lib/conversation.ts` so these items are preserved and count as visible output:

```ts
turn.items.some((item) =>
  item.type === 'text'
    ? item.text.trim()
    : item.type === 'tool'
      ? true
      : item.type === 'system-command'
        ? true
        : false,
)
```

Do not collapse them into plain assistant text during repair.

- [ ] **Step 5: Verify tests pass**

Run:

```bash
node --test --import tsx tests/system-command-items.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/lib/system-command-items.ts src/lib/conversation.ts tests/system-command-items.test.ts
git commit -m "feat: add system command timeline item model"
```

## Task 3: Route Implemented Slash Commands Through Agent-Aware Submission

**Files:**
- Modify: `src/lib/slash-command-submit.ts`
- Modify: `tests/slash-command-submit.test.ts`
- Modify: `src/hooks/useSlashCommands.ts`
- Modify: `tests/useSlashCommands.test.ts`
- Modify: `src/components/Composer.tsx`

- [ ] **Step 1: Write failing submit-routing tests for the new Claude command set**

Extend `tests/slash-command-submit.test.ts` with explicit routing checks:

```ts
test('resolveSlashCommandSubmission maps /context to a dedicated local action kind', () => {
  const commands: SlashCommand[] = [
    {
      id: 'builtin:/context',
      name: 'context',
      slash: '/context',
      title: 'Context',
      source: 'builtin',
      action: 'local-action',
      localActionId: 'show-context',
      agentScope: ['claude'],
    },
  ];

  assert.deepEqual(resolveSlashCommandSubmission('/context', commands), {
    kind: 'show-context',
    command: commands[0],
  });
});
```

Run:

```bash
node --test --import tsx tests/slash-command-submit.test.ts
```

Expected: FAIL because the new route kinds do not exist yet.

- [ ] **Step 2: Replace the old `/help` and `not-implemented` routing with explicit command kinds**

Update `src/lib/slash-command-submit.ts` so only implemented local actions are routable:

```ts
type LocalSlashResolution =
  | { kind: 'clear-thread'; command: SlashCommand }
  | { kind: 'show-status'; command: SlashCommand }
  | { kind: 'show-context'; command: SlashCommand }
  | { kind: 'show-cost'; command: SlashCommand }
  | { kind: 'compact-thread'; command: SlashCommand };
```

Remove `slash-help` and `not-implemented` fallback paths.

- [ ] **Step 3: Filter visible slash commands by active agent in the hook**

Modify `src/hooks/useSlashCommands.ts` so fetched commands are filtered through `filterSlashCommandsForAgent()` before query matching:

```ts
const visibleCommands = filterSlashCommandsForAgent(payload.commands, activeAgent);
```

Add a hook test that proves Codex-only or out-of-scope commands are hidden for Claude.

- [ ] **Step 4: Change Composer local execution to dispatch through command-specific callbacks**

Replace the old toast actions in `src/components/Composer.tsx`:

```ts
if (localActionResolution.kind === 'show-status') {
  setDraft('');
  await onRunSlashSystemCommand(localActionResolution.command, submittedDraft.trim());
  return;
}
```

Do the same for `/context`, `/cost`, and `/compact`. Keep `/clear` as the only branch that creates a new chat directly.

Composer must no longer show success/info toast for these command results.

- [ ] **Step 5: Verify tests pass**

Run:

```bash
node --test --import tsx tests/slash-command-submit.test.ts tests/useSlashCommands.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/slash-command-submit.ts tests/slash-command-submit.test.ts src/hooks/useSlashCommands.ts tests/useSlashCommands.test.ts src/components/Composer.tsx
git commit -m "feat: route implemented slash commands through agent-aware submission"
```

## Task 4: Render System Command Cards in the Main Conversation Timeline

**Files:**
- Modify: `src/components/ConversationTurn.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add a system command card renderer branch**

In `src/components/ConversationTurn.tsx`, add a renderer for `system-command` items:

```tsx
if (item.type === 'system-command') {
  return <SystemCommandCard key={item.id} item={item} />;
}
```

The card should show:

- title
- compact summary
- command state
- optional expandable details block

- [ ] **Step 2: Implement compact status, context, cost, and compact card presentation**

Add a local card component in the same file first to minimize file churn:

```tsx
function SystemCommandCard({ item }: { item: SystemCommandItem }) {
  return (
    <div className={`system-command-card is-${item.state}`}>
      <div className="system-command-card-head">
        <strong>{item.title}</strong>
        <span>{item.state === 'running' ? '运行中' : item.state === 'error' ? '失败' : '已完成'}</span>
      </div>
      {item.summary ? <div className="system-command-card-summary preserve-format">{item.summary}</div> : null}
    </div>
  );
}
```

Use `summary` for the collapsed view and render `details` in a `<details>` block when present.

- [ ] **Step 3: Add minimal styles for in-thread command cards**

Extend `src/styles.css` with styles such as:

```css
.system-command-card {
  margin: 10px 0 0;
  border: 1px solid var(--panel-border);
  border-radius: 14px;
  padding: 12px 14px;
  background: var(--panel-bg);
}

.system-command-card.is-running {
  border-color: var(--accent-border);
}

.system-command-card.is-error {
  border-color: var(--danger-border);
}
```

Keep the visual language aligned with the existing timeline cards, not with the debug drawer.

- [ ] **Step 4: Manually verify the user command bubble remains above the system card**

Run:

```bash
npm run dev
```

Expected in the UI:

- user bubble shows `/status`
- system card shows the status result directly below it
- no right-bottom toast is used as the primary feedback

- [ ] **Step 5: Commit**

```bash
git add src/components/ConversationTurn.tsx src/styles.css
git commit -m "feat: render system command cards in conversation timeline"
```

## Task 5: Implement Claude Slash Command Card Execution

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/hooks/useClaudeRun.ts`
- Modify: `src/components/Composer.tsx`

- [ ] **Step 1: Write the failing command execution path test coverage**

Add or extend tests around the command execution helpers you introduce so the first assertions are explicit:

```ts
test('runClaudeSlashSystemCommand builds a status summary without toast output', async () => {
  const result = await runClaudeSlashSystemCommand('/status', context);
  assert.equal(result.cardType, 'status');
  assert.match(result.summary ?? '', /项目:/);
});
```

If this logic lands in a helper file instead of `App.tsx`, test the helper directly.

Run the targeted test command after choosing the concrete test file:

```bash
node --test --import tsx tests/system-command-items.test.ts
```

Expected: FAIL until the execution helper exists.

- [ ] **Step 2: Add a single Claude slash command runner in `App.tsx`**

Create one app-level function that receives the resolved command and delegates to Claude-specific behavior:

```ts
async function handleRunClaudeSlashSystemCommand(command: SlashCommand, submittedText: string) {
  switch (command.localActionId) {
    case 'show-status':
      return buildStatusCommandResult();
    case 'show-context':
      return buildContextCommandResult();
    case 'show-cost':
      return buildCostCommandResult();
    case 'compact-thread':
      return await startCompactCommandResult();
    default:
      throw new Error(`Unsupported slash command: ${command.slash}`);
  }
}
```

Pass this callback into `Composer`.

- [ ] **Step 3: For `/status`, `/context`, and `/cost`, create a turn and settle the system card synchronously**

Use the existing thread detail mutation path to append a turn with:

```ts
{
  userText: '/status',
  items: [
    settleSystemCommandItem(
      createSystemCommandItem('/status', 'Status', 'status'),
      {
        state: 'done',
        summary: [
          `项目: ${activeProject?.name ?? '(未选择)'}`,
          `线程: ${activeThread?.title ?? '(未选择)'}`,
          `模型: ${modelLabel(model)}`,
        ].join('\n'),
        details: {
          workspace,
          sessionId: activeThread?.sessionId ?? null,
        },
      },
    ),
  ],
}
```

Do not also call `showToast()` for successful completion.

- [ ] **Step 4: For `/compact`, create a running card and update it through the Claude command path**

Route `/compact` through the same dedicated Claude compact behavior, but surface it as a timeline card:

```ts
const initial = createSystemCommandItem('/compact', 'Compact Context', 'compact');
// append turn with initial running item
// await compact execution
// update item to done or error
```

If the command fails immediately, keep the turn and settle the card with:

```ts
{
  state: 'error',
  errorMessage: error instanceof Error ? error.message : '上下文压缩失败',
}
```

- [ ] **Step 5: Keep `/clear` as a no-history special case**

Verify that the `/clear` path still does only:

```ts
setDraft('');
setAttachments([]);
await onCreateNewChat();
```

Do not create a system card turn for the old thread.

- [ ] **Step 6: Verify typecheck and targeted slash tests**

Run:

```bash
npm run typecheck
node --test --import tsx server/lib/slash-commands.test.ts tests/slash-commands-spike.test.ts tests/agent-slash-capabilities.test.ts tests/system-command-items.test.ts tests/slash-command-submit.test.ts tests/useSlashCommands.test.ts
```

Expected: PASS.

- [ ] **Step 7: Restart the web/server dev service if needed and manually verify**

Run:

```bash
npm run dev
```

Manual checks:

- Claude slash menu shows only `/status`, `/compact`, `/context`, `/cost`, `/clear`
- `/help` does not appear
- `/status` creates a user bubble plus system card
- `/context` creates a user bubble plus system card
- `/cost` creates a user bubble plus system card
- `/compact` creates a running card and settles to done/error
- `/clear` starts a new chat without leaving a card in the old thread

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/hooks/useClaudeRun.ts src/components/Composer.tsx
git commit -m "feat: execute claude slash commands in conversation timeline"
```

## Task 6: Release Documentation and Final Cleanup

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-05-05-agent-specific-slash-commands-design.md` if implementation differences appear

- [ ] **Step 1: Update README slash command wording**

Add one short bullet that reflects the shipped behavior:

```md
- slash 命令会按当前 agent 过滤，只展示已实现命令
- `/status`、`/context`、`/cost`、`/compact` 等已实现命令会在主会话区显示结果卡片
```

- [ ] **Step 2: Reconcile the spec with any implementation-level naming changes**

If implementation renamed fields such as `agentScope`, `SlashCardType`, or `system-command`, update the design doc so it matches shipped code exactly.

- [ ] **Step 3: Run final verification**

Run:

```bash
npm run typecheck
node --test --import tsx server/lib/slash-commands.test.ts tests/slash-commands-spike.test.ts tests/agent-slash-capabilities.test.ts tests/system-command-items.test.ts tests/slash-command-submit.test.ts tests/useSlashCommands.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-05-05-agent-specific-slash-commands-design.md docs/superpowers/plans/2026-05-05-agent-specific-slash-commands-implementation.md
git commit -m "docs: document agent-specific slash command behavior"
```
