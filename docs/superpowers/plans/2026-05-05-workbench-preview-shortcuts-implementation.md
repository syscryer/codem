# Workbench Preview Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let conversation cards open generated documents and changed files directly into the existing right-side workbench preview area.

**Architecture:** Keep the feature frontend-only. Extract a small shared preview-controller helper that normalizes preview targets and tab reuse, lift preview state to `App.tsx`, then thread a narrow `onOpenWorkbenchPreview(...)` callback through the conversation rendering path so chat cards and the file navigator both drive the same preview lifecycle.

**Tech Stack:** React 19, TypeScript strict mode, node:test, existing workbench preview APIs in `src/lib/file-preview-api.ts` and `src/lib/git-api.ts`

---

### Task 1: Extract shared preview target and tab state helpers

**Files:**
- Create: `src/lib/workbench-preview.ts`
- Modify: `src/types.ts`
- Test: `tests/workbench-preview-controller.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChangedFilePreviewRequest,
  buildProjectFilePreviewRequest,
  closeWorkbenchPreviewTab,
  openWorkbenchPreviewTab,
} from '../src/lib/workbench-preview';
import type { WorkbenchPreviewTab } from '../src/types';

test('openWorkbenchPreviewTab reuses an existing tab key instead of appending duplicates', () => {
  const existing: WorkbenchPreviewTab[] = [
    {
      key: 'file:README.md',
      path: 'README.md',
      name: 'README.md',
      kind: 'markdown',
      source: 'project-file',
    },
  ];

  const next = openWorkbenchPreviewTab(existing, buildProjectFilePreviewRequest({
    path: 'README.md',
    name: 'README.md',
    type: 'file',
  }));

  assert.equal(next.tabs.length, 1);
  assert.equal(next.activeKey, 'file:README.md');
});

test('buildChangedFilePreviewRequest keeps changed files on file-preview tabs', () => {
  const preview = buildChangedFilePreviewRequest({
    path: 'src/App.tsx',
    status: 'M',
    staged: false,
    unstaged: true,
    untracked: false,
    deleted: false,
  });

  assert.equal(preview.key, 'file:src/App.tsx');
  assert.equal(preview.kind, 'code');
  assert.equal(preview.source, 'changed-file');
});

test('closeWorkbenchPreviewTab moves focus to the previous surviving tab', () => {
  const tabs: WorkbenchPreviewTab[] = [
    { key: 'file:README.md', path: 'README.md', name: 'README.md', kind: 'markdown', source: 'project-file' },
    { key: 'file:src/App.tsx', path: 'src/App.tsx', name: 'App.tsx', kind: 'code', source: 'changed-file' },
  ];

  const next = closeWorkbenchPreviewTab(tabs, 'file:src/App.tsx', 'file:src/App.tsx');

  assert.deepEqual(next.tabs.map((tab) => tab.key), ['file:README.md']);
  assert.equal(next.activeKey, 'file:README.md');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --import tsx tests/workbench-preview-controller.test.ts`
Expected: FAIL with `Cannot find module '../src/lib/workbench-preview'`

- [ ] **Step 3: Write minimal implementation**

```ts
import { getWorkbenchPreviewKind } from './workbench-files';
import type { GitFileStatus, ProjectFileEntry, WorkbenchPreviewRequest, WorkbenchPreviewTab } from '../types';

export function buildProjectFilePreviewRequest(file: Pick<ProjectFileEntry, 'path' | 'name' | 'type'>): WorkbenchPreviewRequest {
  if (file.type !== 'file') {
    throw new Error('Only files can be previewed.');
  }

  return {
    key: `file:${file.path}`,
    path: file.path,
    name: file.name,
    kind: getWorkbenchPreviewKind(file.path),
    source: 'project-file',
  };
}

export function buildChangedFilePreviewRequest(file: Pick<GitFileStatus, 'path' | 'status'>): WorkbenchPreviewRequest {
  return {
    key: `file:${file.path}`,
    path: file.path,
    name: getFileName(file.path),
    kind: getWorkbenchPreviewKind(file.path),
    source: 'changed-file',
    status: file.status,
  };
}

export function openWorkbenchPreviewTab(currentTabs: WorkbenchPreviewTab[], request: WorkbenchPreviewRequest) {
  const existing = currentTabs.find((tab) => tab.key === request.key);
  return {
    tabs: existing ? currentTabs : [...currentTabs, request],
    activeKey: request.key,
  };
}

export function closeWorkbenchPreviewTab(currentTabs: WorkbenchPreviewTab[], activeKey: string, closingKey: string) {
  const closingIndex = currentTabs.findIndex((tab) => tab.key === closingKey);
  const tabs = currentTabs.filter((tab) => tab.key !== closingKey);
  const nextActiveKey =
    activeKey === closingKey
      ? tabs[Math.max(0, closingIndex - 1)]?.key ?? tabs[0]?.key ?? ''
      : activeKey;

  return { tabs, activeKey: nextActiveKey };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --import tsx tests/workbench-preview-controller.test.ts`
Expected: PASS with all tests green

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/lib/workbench-preview.ts tests/workbench-preview-controller.test.ts
git commit -m "refactor: extract shared workbench preview state helpers"
```

### Task 2: Lift right-workbench preview state into `App`

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/RightWorkbench.tsx`
- Modify: `src/types.ts`
- Verify: `tests/workbench-preview-controller.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('openWorkbenchPreviewTab appends a second file and activates it', () => {
  const first = openWorkbenchPreviewTab([], {
    key: 'file:README.md',
    path: 'README.md',
    name: 'README.md',
    kind: 'markdown',
    source: 'project-file',
  });

  const second = openWorkbenchPreviewTab(first.tabs, {
    key: 'file:src/App.tsx',
    path: 'src/App.tsx',
    name: 'App.tsx',
    kind: 'code',
    source: 'changed-file',
  });

  assert.deepEqual(second.tabs.map((tab) => tab.key), ['file:README.md', 'file:src/App.tsx']);
  assert.equal(second.activeKey, 'file:src/App.tsx');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --import tsx tests/workbench-preview-controller.test.ts`
Expected: FAIL until the helper handles the second open path cleanly

- [ ] **Step 3: Write minimal implementation**

```tsx
// In App.tsx
const [previewTabs, setPreviewTabs] = useState<WorkbenchPreviewTab[]>([]);
const [activePreviewKey, setActivePreviewKey] = useState('');
const [previewContentByKey, setPreviewContentByKey] = useState<Record<string, WorkbenchPreviewContentState>>({});

function openWorkbenchPreview(request: WorkbenchPreviewRequest) {
  const next = openWorkbenchPreviewTab(previewTabs, request);
  setPreviewTabs(next.tabs);
  setActivePreviewKey(next.activeKey);
  setRightWorkbenchOpen(true);
  setRightWorkbenchTab('files');
}

<RightWorkbench
  previewTabs={previewTabs}
  activePreviewKey={activePreviewKey}
  previewContentByKey={previewContentByKey}
  onOpenWorkbenchPreview={openWorkbenchPreview}
  onSelectPreviewTab={setActivePreviewKey}
  onClosePreviewTab={(tabKey) => {
    const next = closeWorkbenchPreviewTab(previewTabs, activePreviewKey, tabKey);
    setPreviewTabs(next.tabs);
    setActivePreviewKey(next.activeKey);
  }}
/>
```

```tsx
// In RightWorkbench.tsx
type RightWorkbenchProps = {
  previewTabs: WorkbenchPreviewTab[];
  activePreviewKey: string;
  previewContentByKey: Record<string, WorkbenchPreviewContentState>;
  onOpenWorkbenchPreview: (request: WorkbenchPreviewRequest) => void;
  onSelectPreviewTab: (key: string) => void;
  onClosePreviewTab: (key: string) => void;
  onResolvePreviewContent: (key: string, state: WorkbenchPreviewContentState) => void;
};

// Keep overview/files/browser as the only top-level workbench tabs.
// Remove the dead `file:${string}` top bar branch and render preview tabs only inside the files panel.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --import tsx tests/workbench-preview-controller.test.ts`
Expected: PASS with the helper covering tab append + reuse behavior

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/RightWorkbench.tsx src/types.ts
git commit -m "refactor: lift workbench preview state to app"
```

### Task 3: Wire conversation cards into the shared preview callback

**Files:**
- Create: `src/lib/conversation-preview-shortcuts.ts`
- Modify: `src/components/ConversationPane.tsx`
- Modify: `src/components/ConversationTurn.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `tests/conversation-preview-shortcuts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildConversationPreviewRequest,
  collectConversationChangedFiles,
} from '../src/lib/conversation-preview-shortcuts';
import type { ToolStep } from '../src/types';

test('buildConversationPreviewRequest turns a write preview into a file preview request', () => {
  const preview = {
    kind: 'write',
    filePath: 'docs/notes.md',
    fileName: 'notes.md',
    beforeText: '',
    afterText: '# Notes',
    additions: 1,
    deletions: 0,
    rows: [],
  };

  const request = buildConversationPreviewRequest(preview);

  assert.equal(request?.key, 'file:docs/notes.md');
  assert.equal(request?.kind, 'markdown');
  assert.equal(request?.name, 'notes.md');
});

test('buildConversationPreviewRequest returns null for previews without a file path', () => {
  assert.equal(buildConversationPreviewRequest(null), null);
});

test('collectConversationChangedFiles keeps one row per changed file in tool order', () => {
  const tools: ToolStep[] = [
    {
      id: 'tool-1',
      name: 'Write',
      title: 'Write',
      status: 'done',
      inputText: JSON.stringify({
        file_path: 'docs/notes.md',
        content: '# Notes',
      }),
    },
    {
      id: 'tool-2',
      name: 'Edit',
      title: 'Edit',
      status: 'done',
      inputText: JSON.stringify({
        file_path: 'src/App.tsx',
        old_string: 'old',
        new_string: 'new',
      }),
    },
  ];

  assert.deepEqual(
    collectConversationChangedFiles(tools).map((file) => file.path),
    ['docs/notes.md', 'src/App.tsx'],
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --import tsx tests/conversation-preview-shortcuts.test.ts`
Expected: FAIL because conversation preview shortcut helpers do not exist yet

- [ ] **Step 3: Write minimal implementation**

```ts
// In src/lib/conversation-preview-shortcuts.ts
import { getWorkbenchPreviewKind } from './workbench-files';
import type { ToolStep, WorkbenchPreviewRequest } from '../types';

export function collectConversationChangedFiles(tools: ToolStep[]) {
  return tools
    .map((tool) => extractConversationChangedFile(tool))
    .filter((item): item is { path: string; name: string } => Boolean(item));
}

export function buildConversationPreviewRequest(preview: { filePath: string; fileName: string } | null): WorkbenchPreviewRequest | null {
  if (!preview?.filePath) {
    return null;
  }

  return {
    key: `file:${preview.filePath}`,
    path: preview.filePath,
    name: preview.fileName,
    kind: getWorkbenchPreviewKind(preview.filePath),
    source: 'conversation-card',
  };
}
```

```tsx
// In ConversationPane.tsx
<ConversationTurnView
  key={turn.id}
  turn={turn}
  nowMs={clockNowMs}
  isLiveRunning={isRunning && turn.id === activeTurnId}
  isLatest={index === activeThread.turns.length - 1}
  onSubmitRequestUserInput={onSubmitRequestUserInput}
  onSubmitRuntimeRecoveryAction={onSubmitRuntimeRecoveryAction}
  onSubmitApprovalDecision={onSubmitApprovalDecision}
  onOpenWorkbenchPreview={onOpenWorkbenchPreview}
/>
```

```tsx
// In ConversationTurn.tsx
const changedFiles = collectConversationChangedFiles(turn.tools);

{changedFiles.length ? (
  <ChangedFilesSummaryCard files={changedFiles} onOpenWorkbenchPreview={onOpenWorkbenchPreview} />
) : null}

function CompactToolPreview({
  tool,
  preview,
  onOpenWorkbenchPreview,
}: {
  tool: ToolStep;
  preview: ToolPreview;
  onOpenWorkbenchPreview: (request: WorkbenchPreviewRequest) => void;
}) {
  const request = buildConversationPreviewRequest(preview);
  return (
    <div className={`tool-step tool-preview-step tool-${tool.status}`}>
      <div className="tool-preview-summary-row">
        <button type="button" className="tool-preview-summary" onClick={() => setExpanded((current) => !current)}>
          <span className="tool-preview-kind">{getToolPreviewTitle(preview)}</span>
          <span className="tool-preview-name">{preview.fileName}</span>
        </button>
        {request ? (
          <button type="button" className="tool-preview-open-button" onClick={() => onOpenWorkbenchPreview(request)}>
            打开
          </button>
        ) : null}
      </div>
      {expanded ? <ToolPreviewPanel preview={preview} onOpenWorkbenchPreview={onOpenWorkbenchPreview} /> : null}
    </div>
  );
}

function ToolPreviewPanel({
  preview,
  onOpenWorkbenchPreview,
}: {
  preview: ToolPreview;
  onOpenWorkbenchPreview: (request: WorkbenchPreviewRequest) => void;
}) {
  return (
    <div className="tool-preview-card">
      <div className="tool-preview-card-head">
        <span className="tool-preview-file">{preview.fileName}</span>
        <button type="button" className="tool-preview-link-button" onClick={() => onOpenWorkbenchPreview(buildConversationPreviewRequest(preview)!)}>
          在右侧预览
        </button>
      </div>
      {preview.kind === 'write' ? <pre className="tool-preview-code">{preview.afterText}</pre> : null}
    </div>
  );
}

function ChangedFilesSummaryCard({
  files,
  onOpenWorkbenchPreview,
}: {
  files: Array<{ path: string; name: string }>;
  onOpenWorkbenchPreview: (request: WorkbenchPreviewRequest) => void;
}) {
  return (
    <section className="changed-files-summary-card">
      {files.map((file) => (
        <button
          key={file.path}
          type="button"
          className="changed-files-summary-row"
          onClick={() => onOpenWorkbenchPreview({
            key: `file:${file.path}`,
            path: file.path,
            name: file.name,
            kind: getWorkbenchPreviewKind(file.path),
            source: 'conversation-card',
          })}
        >
          <span>{file.name}</span>
          <code>{file.path}</code>
        </button>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --import tsx tests/conversation-preview-shortcuts.test.ts`
Expected: PASS with the conversation preview request helper covered

- [ ] **Step 5: Commit**

```bash
git add src/lib/conversation-preview-shortcuts.ts src/App.tsx src/components/ConversationPane.tsx src/components/ConversationTurn.tsx src/styles.css tests/conversation-preview-shortcuts.test.ts
git commit -m "feat: add workbench preview shortcuts from conversation cards"
```

### Task 4: Reconnect file navigator loading and run full verification

**Files:**
- Modify: `src/components/RightWorkbench.tsx`
- Modify: `src/lib/workbench-preview.ts`
- Verify: `tests/workbench-preview-controller.test.ts`
- Verify: `tests/conversation-preview-shortcuts.test.ts`
- Verify: `tests/workbench-files.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('buildChangedFilePreviewRequest uses code preview for modified TypeScript files', () => {
  const request = buildChangedFilePreviewRequest({
    path: 'src/components/RightWorkbench.tsx',
    status: 'M',
    staged: false,
    unstaged: true,
    untracked: false,
    deleted: false,
  });

  assert.equal(request.kind, 'code');
  assert.equal(request.name, 'RightWorkbench.tsx');
});
```

- [ ] **Step 2: Run tests to verify at least one fails before the final pass**

Run:

```bash
node --test --import tsx tests/workbench-preview-controller.test.ts tests/conversation-preview-shortcuts.test.ts tests/workbench-files.test.ts
```

Expected: FAIL until the final preview wiring and naming are consistent

- [ ] **Step 3: Write minimal implementation**

```tsx
// In RightWorkbench.tsx
useEffect(() => {
  if (!activeProject || !activePreviewTab || previewContentByKey[activePreviewTab.key]) {
    return;
  }

  const absolutePath = combineProjectFilePath(activeProject.path, activePreviewTab.path);
  fetchWorkspaceFilePreview(absolutePath)
    .then((payload) => onResolvePreviewContent(activePreviewTab.key, { loading: false, content: payload.content }))
    .catch((error) => onResolvePreviewContent(activePreviewTab.key, {
      loading: false,
      content: '',
      error: error instanceof Error ? error.message : '读取文件失败',
    }));
}, [activeProject?.id, activePreviewTab?.key, previewContentByKey]);
```

```ts
// In workbench-preview.ts
// Keep only shared tab-state helpers here.
// Conversation-specific preview request builders stay in `src/lib/conversation-preview-shortcuts.ts`.
```

- [ ] **Step 4: Run verification**

Run:

```bash
node --test --import tsx tests/workbench-preview-controller.test.ts tests/conversation-preview-shortcuts.test.ts tests/workbench-files.test.ts
npm run typecheck
npm run build
```

Expected:

- all three test files PASS
- `npm run typecheck` exits 0
- `npm run build` exits 0

- [ ] **Step 5: Commit**

```bash
git add src/components/RightWorkbench.tsx src/lib/workbench-preview.ts tests/workbench-preview-controller.test.ts tests/conversation-preview-shortcuts.test.ts tests/workbench-files.test.ts
git commit -m "test: verify shared workbench preview shortcuts"
```
