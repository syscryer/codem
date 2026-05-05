# ClaudeCode Context Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a ClaudeCode-only context usage ring to the composer that opens a lightweight token breakdown card.

**Architecture:** Keep the change frontend-only. Add one small view-model helper for usage aggregation and model context-window resolution, one focused composer UI component for the ring and popover, then wire it into `Composer` with narrow CSS updates.

**Tech Stack:** React 19, TypeScript, node:test, existing `PopoverPortal`/CSS architecture

---

### Task 1: Build the context usage view-model

**Files:**
- Create: `src/lib/composer-context-usage.ts`
- Test: `tests/composer-context-usage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComposerContextUsage } from '../src/lib/composer-context-usage';

test('buildComposerContextUsage only exposes the indicator for claude', () => {
  const usage = buildComposerContextUsage({
    agent: 'codex',
    model: 'claude-sonnet-4-5',
    turns: [],
  });

  assert.equal(usage.visible, false);
});

test('buildComposerContextUsage excludes output tokens from used context percentage', () => {
  const usage = buildComposerContextUsage({
    agent: 'claude',
    model: 'claude-sonnet-4-5',
    turns: [
      {
        id: 'turn-1',
        userText: 'hi',
        workspace: 'D:/project/codem',
        assistantText: 'hello',
        tools: [],
        items: [],
        status: 'done',
        inputTokens: 60000,
        outputTokens: 50000,
        cacheCreationInputTokens: 20000,
        cacheReadInputTokens: 10000,
      },
    ],
  });

  assert.equal(usage.visible, true);
  assert.equal(usage.hasUsage, true);
  assert.equal(usage.usedTokens, 90000);
  assert.equal(usage.totalTokens, 200000);
  assert.equal(usage.level, 'high');
  assert.equal(usage.percent, 45);
});

test('buildComposerContextUsage falls back to the default Claude window for unknown models', () => {
  const usage = buildComposerContextUsage({
    agent: 'claude',
    model: 'claude-unknown',
    turns: [],
  });

  assert.equal(usage.totalTokens, 200000);
  assert.equal(usage.hasUsage, false);
  assert.equal(usage.level, 'empty');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --import tsx tests/composer-context-usage.test.ts`
Expected: FAIL with `Cannot find module '../src/lib/composer-context-usage'`

- [ ] **Step 3: Write minimal implementation**

```ts
import type { AgentType, ConversationTurn } from '../types';

export type ComposerContextUsageLevel = 'empty' | 'low' | 'medium' | 'high' | 'critical';

export type ComposerContextUsage = {
  visible: boolean;
  hasUsage: boolean;
  percent: number;
  usedTokens: number;
  totalTokens: number;
  level: ComposerContextUsageLevel;
  breakdown: {
    inputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    outputTokens: number;
  };
};

export function buildComposerContextUsage(input: {
  agent: AgentType;
  model: string;
  turns: ConversationTurn[];
}): ComposerContextUsage {
  // aggregate usage, resolve Claude context window, and compute thresholds
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --import tsx tests/composer-context-usage.test.ts`
Expected: PASS with all tests green

- [ ] **Step 5: Commit**

```bash
git add tests/composer-context-usage.test.ts src/lib/composer-context-usage.ts
git commit -m "feat: add composer context usage model"
```

### Task 2: Render the ring and card in Composer

**Files:**
- Create: `src/components/ComposerContextIndicator.tsx`
- Modify: `src/components/Composer.tsx`
- Test: `tests/composer-context-usage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('buildComposerContextUsage marks empty threads with a neutral state', () => {
  const usage = buildComposerContextUsage({
    agent: 'claude',
    model: 'claude-sonnet-4-5',
    turns: [],
  });

  assert.equal(usage.visible, true);
  assert.equal(usage.hasUsage, false);
  assert.equal(usage.level, 'empty');
  assert.equal(usage.percent, 0);
});

test('buildComposerContextUsage maps threshold boundaries to stable levels', () => {
  assert.equal(
    buildComposerContextUsage({
      agent: 'claude',
      model: 'claude-sonnet-4-5',
      turns: [
        {
          id: 'turn-low',
          userText: '',
          workspace: '',
          assistantText: '',
          tools: [],
          items: [],
          status: 'done',
          inputTokens: 120000,
        },
      ],
    }).level,
    'medium',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --import tsx tests/composer-context-usage.test.ts`
Expected: FAIL because the new neutral state and threshold handling are not implemented yet

- [ ] **Step 3: Write minimal implementation**

```tsx
export function ComposerContextIndicator({ usage }: { usage: ComposerContextUsage }) {
  // render a button with a conic-gradient ring and a popover card
}

// In Composer.tsx
const contextUsage = buildComposerContextUsage({
  agent,
  model,
  turns,
});

<ComposerContextIndicator usage={contextUsage} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --import tsx tests/composer-context-usage.test.ts`
Expected: PASS with all tests green

- [ ] **Step 5: Commit**

```bash
git add src/components/Composer.tsx src/components/ComposerContextIndicator.tsx tests/composer-context-usage.test.ts
git commit -m "feat: add composer context indicator"
```

### Task 3: Style and verify the composer integration

**Files:**
- Modify: `src/styles.css`
- Modify: `src/App.tsx`
- Verify: `tests/composer-context-usage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('buildComposerContextUsage keeps critical usage above ninety percent', () => {
  const usage = buildComposerContextUsage({
    agent: 'claude',
    model: 'claude-sonnet-4-5',
    turns: [
      {
        id: 'turn-critical',
        userText: '',
        workspace: '',
        assistantText: '',
        tools: [],
        items: [],
        status: 'done',
        inputTokens: 181000,
      },
    ],
  });

  assert.equal(usage.level, 'critical');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --import tsx tests/composer-context-usage.test.ts`
Expected: FAIL if the threshold mapping is still incomplete

- [ ] **Step 3: Write minimal implementation**

```tsx
// In App.tsx
<Composer
  agent="claude"
  turns={activeThread?.turns ?? []}
  ...
/>
```

```css
.composer-context-indicator { /* toolbar placement */ }
.composer-context-ring { /* circular progress ring */ }
.composer-context-card { /* compact detail panel */ }
```

- [ ] **Step 4: Run verification**

Run:

```bash
node --test --import tsx tests/composer-context-usage.test.ts
npm run typecheck
```

Expected:

- test command PASS
- `npm run typecheck` exits 0

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/styles.css
git commit -m "style: integrate composer context indicator"
```
