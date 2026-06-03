# Sidebar Thread Status Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace sidebar thread text status badges with compact right-side icons: completed blue dot, running gray ring, hot-session lightning.

**Architecture:** Add one pure resolver for sidebar thread status priority, then let `SidebarProjects` render the resolved status. `App` will reuse the existing `/api/claude/runtimes` endpoint to pass runtime state into the sidebar so hot sessions are based on real runtime data.

**Tech Stack:** React, TypeScript, CSS, Node test runner.

---

## File Structure

- Create `src/lib/sidebar-thread-status.ts`: pure status priority resolver for sidebar thread rows.
- Create `src/lib/sidebar-thread-status.test.ts`: tests for running, hot, and completed priority.
- Create `src/lib/thread-runtime-statuses.ts`: shared fetch helper for `/api/claude/runtimes`.
- Modify `src/App.tsx`: poll runtime statuses every 5 seconds and pass them to `SidebarProjects`.
- Modify `src/components/SidebarProjects.tsx`: render right-side status icons instead of text badges.
- Modify `src/components/settings/SessionManagementSettings.tsx`: reuse the shared runtime fetch helper.
- Modify `src/styles.css`: style the new icon cluster at real sidebar scale.

## Task 1: Add Pure Sidebar Status Resolution

**Files:**
- Create: `src/lib/sidebar-thread-status.ts`
- Create: `src/lib/sidebar-thread-status.test.ts`

- [ ] **Step 1: Write the failing resolver test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSidebarThreadStatus } from './sidebar-thread-status.js';

test('resolveSidebarThreadStatus prioritizes running over hot and completed notices', () => {
  assert.equal(
    resolveSidebarThreadStatus({
      threadId: 'thread-1',
      runningThreadIds: new Set(['thread-1']),
      runtimeStatuses: {
        'thread-1': { threadId: 'thread-1', alive: true, activeRun: false },
      },
      threadActivityNotices: {
        'thread-1': {
          threadId: 'thread-1',
          kind: 'failed',
          title: '失败也按完成提示展示',
          key: 'failed:thread-1:turn-1',
          updatedAtMs: 100,
        },
      },
    }),
    'running',
  );
});

test('resolveSidebarThreadStatus marks alive inactive runtimes as hot sessions', () => {
  assert.equal(
    resolveSidebarThreadStatus({
      threadId: 'thread-1',
      runningThreadIds: new Set(),
      runtimeStatuses: {
        'thread-1': { threadId: 'thread-1', pid: 1234, alive: true, activeRun: false },
      },
      threadActivityNotices: {},
    }),
    'hot',
  );
});

test('resolveSidebarThreadStatus treats any background notice as completed indicator', () => {
  assert.equal(
    resolveSidebarThreadStatus({
      threadId: 'thread-1',
      runningThreadIds: new Set(),
      runtimeStatuses: {},
      threadActivityNotices: {
        'thread-1': {
          threadId: 'thread-1',
          kind: 'approval',
          title: '需要处理',
          key: 'approval:thread-1:turn-1',
          updatedAtMs: 100,
        },
      },
    }),
    'completed',
  );
});
```

- [ ] **Step 2: Run the resolver test and confirm it fails**

Run: `npm test -- src/lib/sidebar-thread-status.test.ts`

Expected: fail because `src/lib/sidebar-thread-status.ts` does not exist yet.

- [ ] **Step 3: Implement the resolver**

```ts
import type { ThreadRuntimeStatus } from '../types';
import type { ThreadActivityNoticeMap } from './thread-activity-notices';

export type SidebarThreadStatusKind = 'completed' | 'running' | 'hot';

type ResolveSidebarThreadStatusOptions = {
  threadId: string;
  runningThreadIds: ReadonlySet<string>;
  runtimeStatuses?: Record<string, ThreadRuntimeStatus>;
  threadActivityNotices: ThreadActivityNoticeMap;
};

export function resolveSidebarThreadStatus({
  threadId,
  runningThreadIds,
  runtimeStatuses = {},
  threadActivityNotices,
}: ResolveSidebarThreadStatusOptions): SidebarThreadStatusKind | null {
  const runtimeStatus = runtimeStatuses[threadId];

  if (runningThreadIds.has(threadId) || runtimeStatus?.activeRun) {
    return 'running';
  }

  if (runtimeStatus?.alive) {
    return 'hot';
  }

  if (threadActivityNotices[threadId]) {
    return 'completed';
  }

  return null;
}
```

- [ ] **Step 4: Run the resolver test and confirm it passes**

Run: `npm test -- src/lib/sidebar-thread-status.test.ts`

Expected: pass.

## Task 2: Connect Runtime Statuses and Render Icons

**Files:**
- Create: `src/lib/thread-runtime-statuses.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/SidebarProjects.tsx`
- Modify: `src/components/settings/SessionManagementSettings.tsx`

- [ ] **Step 1: Create the shared runtime fetch helper**

```ts
import type { ThreadRuntimeStatus } from '../types';

export async function fetchThreadRuntimeStatuses() {
  try {
    const response = await fetch('/api/claude/runtimes');
    if (!response.ok) {
      return {};
    }

    return (await response.json()) as Record<string, ThreadRuntimeStatus>;
  } catch {
    return {};
  }
}
```

- [ ] **Step 2: Update `App.tsx` to poll runtime statuses**

Add `ThreadRuntimeStatus` to the `../types` import list if needed, add `fetchThreadRuntimeStatuses`, then add state near `threadActivityNotices`:

```ts
const [threadRuntimeStatuses, setThreadRuntimeStatuses] = useState<Record<string, ThreadRuntimeStatus>>({});
```

Add this effect:

```ts
useEffect(() => {
  let cancelled = false;

  async function refreshThreadRuntimeStatuses() {
    const statuses = await fetchThreadRuntimeStatuses();
    if (!cancelled) {
      setThreadRuntimeStatuses(statuses);
    }
  }

  void refreshThreadRuntimeStatuses();
  const timer = window.setInterval(() => void refreshThreadRuntimeStatuses(), 5000);
  return () => {
    cancelled = true;
    window.clearInterval(timer);
  };
}, []);
```

Pass the new prop:

```tsx
<SidebarProjects
  ...
  threadRuntimeStatuses={threadRuntimeStatuses}
  ...
/>
```

- [ ] **Step 3: Update `SidebarProjects.tsx` props and render path**

Add imports:

```ts
import { Zap } from 'lucide-react';
import { resolveSidebarThreadStatus, type SidebarThreadStatusKind } from '../lib/sidebar-thread-status';
import type { ThreadRuntimeStatus } from '../types';
```

Add the prop:

```ts
threadRuntimeStatuses: Record<string, ThreadRuntimeStatus>;
```

In `renderThreadRow`, compute:

```ts
const threadStatus = resolveSidebarThreadStatus({
  threadId: thread.id,
  runningThreadIds: runningThreadIdSet,
  runtimeStatuses: threadRuntimeStatuses,
  threadActivityNotices,
});
```

Change the button contents to:

```tsx
<span className="sidebar-thread-title">
  <span className="sidebar-thread-title-text">{thread.title}</span>
</span>
<span className="sidebar-thread-meta">
  <small>{thread.updatedLabel}</small>
  <SidebarThreadStatusIcon status={threadStatus} />
</span>
```

Add the icon component:

```tsx
function SidebarThreadStatusIcon({ status }: { status: SidebarThreadStatusKind | null }) {
  if (!status) {
    return null;
  }

  if (status === 'hot') {
    return (
      <span className="sidebar-thread-status-icon hot" aria-label="热会话" title="热会话">
        <Zap size={12} />
      </span>
    );
  }

  return (
    <span
      className={`sidebar-thread-status-icon ${status}`}
      aria-label={status === 'running' ? '运行中' : '完成'}
      title={status === 'running' ? '运行中' : '完成'}
    />
  );
}
```

- [ ] **Step 4: Remove old local `fetchThreadRuntimeStatuses` from settings**

Import the shared helper in `src/components/settings/SessionManagementSettings.tsx`:

```ts
import { fetchThreadRuntimeStatuses } from '../../lib/thread-runtime-statuses';
```

Delete the local `async function fetchThreadRuntimeStatuses()` at the bottom of the file.

## Task 3: Style and Verify

**Files:**
- Modify: `src/styles.css`
- Modify or create: `src/components/SidebarProjects.status-icons.test.ts`

- [ ] **Step 1: Add a source/style regression test**

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const componentSource = readFileSync(resolve(testDir, 'SidebarProjects.tsx'), 'utf8');
const stylesSource = readFileSync(resolve(testDir, '../styles.css'), 'utf8');

test('sidebar thread status icons use compact right-side indicators', () => {
  assert.match(componentSource, /SidebarThreadStatusIcon/);
  assert.match(componentSource, /className="sidebar-thread-meta"/);
  assert.doesNotMatch(componentSource, /sidebar-thread-activity-badge/);
  assert.match(stylesSource, /\.sidebar-thread-status-icon\.completed\s*\{[\s\S]*background:\s*#1a73e8;/);
  assert.match(stylesSource, /\.sidebar-thread-status-icon\.running\s*\{[\s\S]*border:\s*2px\s+solid/);
  assert.match(stylesSource, /\.sidebar-thread-status-icon\.hot\s+svg\s*\{/);
});
```

- [ ] **Step 2: Run the source/style test and confirm it fails**

Run: `npm test -- src/components/SidebarProjects.status-icons.test.ts`

Expected: fail because the component and CSS still use old badge classes.

- [ ] **Step 3: Update sidebar status styles**

Replace old `.sidebar-thread-running-dot` and `.sidebar-thread-activity-badge*` rules with:

```css
.sidebar-thread-meta {
  min-width: max-content;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.sidebar-thread-status-icon {
  flex: 0 0 auto;
  display: inline-grid;
  place-items: center;
}

.sidebar-thread-status-icon.completed {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #1a73e8;
}

.sidebar-thread-status-icon.running {
  width: 9px;
  height: 9px;
  border: 2px solid #7f8790;
  border-left-color: transparent;
  border-radius: 999px;
}

.sidebar-thread-status-icon.hot {
  width: 12px;
  height: 12px;
  color: #6f7d8d;
}

.sidebar-thread-status-icon.hot svg {
  width: 12px;
  height: 12px;
  stroke-width: 2.4;
}
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
npm test -- src/lib/sidebar-thread-status.test.ts src/components/SidebarProjects.status-icons.test.ts src/lib/session-management.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 5: Run typecheck or project test command**

Run: `npm test`

Expected: full test suite passes.

- [ ] **Step 6: Start the Web dev server if it is not already running**

Run: `npm run dev`

Expected: Vite and backend dev services start. Use the printed local URL for visual verification.

- [ ] **Step 7: Verify visually**

Open the app and confirm:

- Completed/background-notice rows show a right-side blue dot.
- Running rows show a right-side gray ring.
- Hot session rows show a right-side lightning icon.
- Row height and title truncation remain stable.
