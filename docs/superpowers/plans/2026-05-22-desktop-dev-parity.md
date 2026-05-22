# Desktop Dev Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm run desktop:dev` behave like `npm run dev`: frontend edits hot-reload, backend edits auto-restart, and `src-tauri/**` edits rebuild the desktop shell without manually reopening the window.

**Architecture:** Keep the current Tauri `devUrl` flow. Add a small shared dev-session state file that records the actual backend/web ports chosen by `scripts/dev.mjs`, then teach `scripts/desktop-dev.mjs` to reuse that exact session instead of guessing from the first available port. This keeps the desktop shell attached to the same live Vite and backend processes that Web dev already uses.

**Tech Stack:** Node.js ESM scripts, Tauri CLI v2, Vite, `tsx watch`, `node:test`

---

### Task 1: Add failing tests for dev-session discovery

**Files:**
- Create: `scripts/dev-session.test.mjs`
- Create: `scripts/dev-session.mjs`
- Modify: `scripts/dev-ports.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import {
  readDevSessionState,
  writeDevSessionState,
  clearDevSessionState,
} from './dev-session.mjs';

test('readDevSessionState returns null when the session file is missing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codem-dev-session-'));
  await assert.doesNotReject(async () => {
    const state = await readDevSessionState(root);
    assert.equal(state, null);
  });
  await rm(root, { recursive: true, force: true });
});

test('writeDevSessionState persists the selected backend and web ports', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codem-dev-session-'));
  await writeDevSessionState(root, {
    backendPort: 3004,
    webPort: 5173,
    pid: 4321,
  });

  const state = await readDevSessionState(root);
  assert.equal(state?.backendPort, 3004);
  assert.equal(state?.webPort, 5173);
  assert.equal(state?.pid, 4321);

  await clearDevSessionState(root);
  await rm(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/dev-session.test.mjs`
Expected: FAIL with `Cannot find module './dev-session.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
import path from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

export const DEV_SESSION_FILE = '.codem-dev-session.json';

export function getDevSessionPath(cwd = process.cwd()) {
  return path.join(cwd, DEV_SESSION_FILE);
}

export async function readDevSessionState(cwd = process.cwd()) {
  try {
    const content = await readFile(getDevSessionPath(cwd), 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function writeDevSessionState(cwd = process.cwd(), state) {
  const filePath = getDevSessionPath(cwd);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
}

export async function clearDevSessionState(cwd = process.cwd()) {
  await rm(getDevSessionPath(cwd), { force: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/dev-session.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/dev-session.mjs scripts/dev-session.test.mjs
git commit -m "test: cover shared dev session state"
```

### Task 2: Teach `dev.mjs` to publish the active dev session

**Files:**
- Modify: `scripts/dev.mjs`
- Modify: `scripts/dev-session.mjs`
- Test: `scripts/dev-session.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test('clearDevSessionState removes the state file after a dev session exits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codem-dev-session-'));
  await writeDevSessionState(root, { backendPort: 3001, webPort: 5173, pid: 999 });

  await clearDevSessionState(root);

  const state = await readDevSessionState(root);
  assert.equal(state, null);
  await rm(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/dev-session.test.mjs`
Expected: FAIL until cleanup behavior is implemented

- [ ] **Step 3: Write minimal implementation**

```js
// In scripts/dev.mjs
import { clearDevSessionState, writeDevSessionState } from './dev-session.mjs';

async function main() {
  const preferredPort = resolvePreferredBackendPort();
  const backendPort = await findAvailablePort(preferredPort);
  const childEnv = buildBackendPortEnv(process.env, backendPort);

  await writeDevSessionState(process.cwd(), {
    backendPort,
    webPort: DEFAULT_WEB_PORT,
    pid: process.pid,
  });

  // existing child startup...
}

async function stopChildren(except) {
  for (const child of children) {
    if (child === except || child.killed) {
      continue;
    }
    child.kill();
  }
  await clearDevSessionState(process.cwd());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/dev-session.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/dev.mjs scripts/dev-session.mjs scripts/dev-session.test.mjs
git commit -m "feat: publish active dev session state"
```

### Task 3: Make `desktop-dev.mjs` reuse the real dev session instead of guessing

**Files:**
- Modify: `scripts/desktop-dev.mjs`
- Modify: `scripts/dev-session.mjs`
- Create: `scripts/desktop-dev.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDesktopDevPorts } from './desktop-dev.mjs';

test('resolveDesktopDevPorts reuses the backend port from the active dev session', async () => {
  const result = await resolveDesktopDevPorts({
    preferredPort: 3001,
    readSessionState: async () => ({ backendPort: 3004, webPort: 5173 }),
    isPortOpen: async (port) => port === 3004 || port === 5173,
    findAvailablePort: async () => 3005,
  });

  assert.deepEqual(result, {
    backendPort: 3004,
    webPort: 5173,
    shouldStartDevServer: false,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/desktop-dev.test.mjs`
Expected: FAIL because `resolveDesktopDevPorts` does not exist yet

- [ ] **Step 3: Write minimal implementation**

```js
export async function resolveDesktopDevPorts({
  preferredPort,
  readSessionState = readDevSessionState,
  isPortOpen: checkPort = isPortOpen,
  findAvailablePort: findPort = findAvailablePort,
}) {
  const session = await readSessionState(process.cwd());
  if (session?.backendPort && session?.webPort) {
    const sessionReady = await Promise.all([
      checkPort(session.backendPort),
      checkPort(session.webPort),
    ]);
    if (sessionReady.every(Boolean)) {
      return {
        backendPort: session.backendPort,
        webPort: session.webPort,
        shouldStartDevServer: false,
      };
    }
  }

  const backendPort = await findPort(preferredPort);
  return {
    backendPort,
    webPort: DEFAULT_WEB_PORT,
    shouldStartDevServer: true,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/desktop-dev.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/desktop-dev.mjs scripts/desktop-dev.test.mjs scripts/dev-session.mjs
git commit -m "fix: reuse active dev session in desktop mode"
```

### Task 4: Document and verify the desktop development workflow

**Files:**
- Modify: `README.md`
- Verify: `node --test scripts/dev-ports.test.mjs scripts/dev-session.test.mjs scripts/desktop-dev.test.mjs`
- Verify: `npm run desktop:dev`

- [ ] **Step 1: Write the failing test**

```md
README should mention that desktop development uses `npm run desktop:dev`, reuses the active Vite/backend session when available, and supports frontend/backend/Tauri watch updates without manually reopening the window.
```

- [ ] **Step 2: Run verification to capture the current gap**

Run: `rg -n "desktop:dev|桌面" README.md`
Expected: Missing or incomplete desktop dev workflow guidance

- [ ] **Step 3: Write minimal implementation**

```md
## 桌面开发

- 运行 `npm run desktop:dev`
- 如果已有 `npm run dev` 在当前仓库运行，桌面端会复用同一组 Vite / backend 服务
- `src/**` 依赖 Vite HMR，即时刷新
- `server/**` 依赖 `tsx watch` 自动重启
- `src-tauri/**` 依赖 `tauri dev` 自动重编译并重启窗口
```

- [ ] **Step 4: Run verification**

Run: `node --test scripts/dev-ports.test.mjs scripts/dev-session.test.mjs scripts/desktop-dev.test.mjs`
Expected: PASS

Run: `npm run desktop:dev`
Expected: Desktop window starts against the live dev server and stays usable after edits under `src/**`, `server/**`, and `src-tauri/**`

- [ ] **Step 5: Commit**

```bash
git add README.md scripts/dev.mjs scripts/desktop-dev.mjs scripts/dev-session.mjs scripts/dev-session.test.mjs scripts/desktop-dev.test.mjs
git commit -m "feat: align desktop dev workflow with web dev"
```
