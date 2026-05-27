# Runtime Flavor Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 CodeM 的本地打包和 GitHub Release 同时支持 `with-node` / `no-node` 两套桌面产物，并在四个平台资产名中明确区分 flavor。

**Architecture:** 新增一个共享的 runtime flavor 映射层，把 `with-node` / `no-node` 统一映射到 `bundled` / `external`。`scripts/build-server.mjs` 只负责是否生成 `dist-server/runtime/node*`，`scripts/build-platform.mjs` 负责把 flavor 透传到构建环境，新的 release 资产整理脚本负责给 bundle 产物追加平台与 flavor 后缀，GitHub workflow 只消费这些稳定接口。

**Tech Stack:** Node.js ESM 脚本、`node:test`、Tauri CLI v2、GitHub Actions、PowerShell / Bash 文件收集

---

## File Structure

- Create: `scripts/runtime-flavor.mjs`
  - 统一维护 `with-node` / `no-node` 与 `bundled` / `external` 的映射、环境变量名、后缀名。
- Create: `scripts/runtime-flavor.test.mjs`
  - 验证 flavor 解析、默认值与后缀映射。
- Modify: `scripts/build-server.mjs`
  - 根据 runtime mode 决定是否生成 `dist-server/runtime/node(.exe)`。
- Create: `scripts/build-server.test.mjs`
  - 验证 `bundled` 会写入运行时文件，`external` 不会生成运行时目录。
- Modify: `scripts/build-platform.mjs`
  - 接收平台 + flavor，透传构建环境，并在构建完成后调用资产整理逻辑。
- Modify: `scripts/build-platform.test.mjs`
  - 验证 flavor 解析、spawn 环境与本地默认映射。
- Create: `scripts/release-assets.mjs`
  - 统一扫描 bundle 输出、复制到目标目录并追加平台与 flavor 后缀。
- Create: `scripts/release-assets.test.mjs`
  - 验证 `.exe` / `.msi` / `.dmg` / `.app.tar.gz` / `.AppImage` 重命名结果。
- Modify: `package.json`
  - 暴露显式 `package:*:with-node` / `package:*:no-node` 命令。
- Modify: `README.md`
  - 记录新的本地打包入口和双产物含义。
- Modify: `.github/workflows/release.yml`
  - 把平台矩阵扩成 `平台 × flavor`，并改用新的资产整理脚本。

### Task 1: Add shared runtime flavor helpers

**Files:**
- Create: `scripts/runtime-flavor.mjs`
- Create: `scripts/runtime-flavor.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_RUNTIME_FLAVOR,
  DEFAULT_RUNTIME_MODE,
  flavorToMode,
  normalizeRuntimeFlavor,
  flavorSuffix,
} from './runtime-flavor.mjs';

test('normalizeRuntimeFlavor defaults to with-node', () => {
  assert.equal(DEFAULT_RUNTIME_FLAVOR, 'with-node');
  assert.equal(DEFAULT_RUNTIME_MODE, 'bundled');
  assert.equal(normalizeRuntimeFlavor(undefined), 'with-node');
  assert.equal(normalizeRuntimeFlavor('with-node'), 'with-node');
  assert.equal(normalizeRuntimeFlavor('no-node'), 'no-node');
});

test('flavorToMode maps public flavor names to build runtime modes', () => {
  assert.equal(flavorToMode('with-node'), 'bundled');
  assert.equal(flavorToMode('no-node'), 'external');
});

test('flavorSuffix returns the asset suffix used in release filenames', () => {
  assert.equal(flavorSuffix('with-node'), 'with-node');
  assert.equal(flavorSuffix('no-node'), 'no-node');
});

test('normalizeRuntimeFlavor rejects unsupported values', () => {
  assert.throws(() => normalizeRuntimeFlavor('portable'), /Unsupported runtime flavor/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/runtime-flavor.test.mjs`
Expected: FAIL with `Cannot find module './runtime-flavor.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
export const DEFAULT_RUNTIME_FLAVOR = 'with-node';
export const DEFAULT_RUNTIME_MODE = 'bundled';
export const RUNTIME_ENV_NAME = 'CODEM_RUNTIME_MODE';

const FLAVOR_TO_MODE = new Map([
  ['with-node', 'bundled'],
  ['no-node', 'external'],
]);

export function normalizeRuntimeFlavor(value = DEFAULT_RUNTIME_FLAVOR) {
  if (!FLAVOR_TO_MODE.has(value)) {
    throw new Error(`Unsupported runtime flavor: ${value}`);
  }
  return value;
}

export function flavorToMode(flavor) {
  return FLAVOR_TO_MODE.get(normalizeRuntimeFlavor(flavor));
}

export function flavorSuffix(flavor) {
  return normalizeRuntimeFlavor(flavor);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/runtime-flavor.test.mjs`
Expected: PASS

- [ ] **Step 5: Inspect the diff for this slice**

Run: `git diff -- scripts/runtime-flavor.mjs scripts/runtime-flavor.test.mjs`
Expected: 仅包含 runtime flavor 常量与测试

### Task 2: Make `build-server.mjs` runtime-mode aware with TDD

**Files:**
- Modify: `scripts/build-server.mjs`
- Create: `scripts/build-server.test.mjs`
- Test: `scripts/runtime-flavor.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { stageRuntimeBinary } from './build-server.mjs';

test('stageRuntimeBinary writes a real runtime file in bundled mode', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codem-runtime-'));
  const fakeNode = path.join(root, 'fake-node.exe');
  const output = path.join(root, 'dist-server');
  await writeFile(fakeNode, Buffer.from('node-binary'));

  const runtimePath = await stageRuntimeBinary({
    outputDirectory: output,
    runtimeMode: 'bundled',
    platform: 'win32',
    nodeExecutablePath: fakeNode,
  });

  assert.match(runtimePath ?? '', /node\.exe$/);
  assert.deepEqual(await readFile(runtimePath), Buffer.from('node-binary'));
  await rm(root, { recursive: true, force: true });
});

test('stageRuntimeBinary skips runtime creation in external mode', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codem-runtime-'));
  const output = path.join(root, 'dist-server');
  const runtimePath = await stageRuntimeBinary({
    outputDirectory: output,
    runtimeMode: 'external',
    platform: 'linux',
    nodeExecutablePath: process.execPath,
  });

  assert.equal(runtimePath, null);
  await rm(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/build-server.test.mjs`
Expected: FAIL because `stageRuntimeBinary` is not exported yet

- [ ] **Step 3: Write minimal implementation**

```js
import process from 'node:process';
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { RUNTIME_ENV_NAME } from './runtime-flavor.mjs';

export async function stageRuntimeBinary({
  outputDirectory,
  runtimeMode,
  platform = process.platform,
  nodeExecutablePath = process.execPath,
}) {
  if (runtimeMode === 'external') {
    return null;
  }

  const runtimeDirectory = path.join(outputDirectory, 'runtime');
  await mkdir(runtimeDirectory, { recursive: true });
  const executableName = platform === 'win32' ? 'node.exe' : 'node';
  const runtimeExecutablePath = path.join(runtimeDirectory, executableName);

  if (platform === 'win32') {
    await writeFile(runtimeExecutablePath, await readFile(nodeExecutablePath));
  } else {
    await copyFile(nodeExecutablePath, runtimeExecutablePath);
    await chmod(runtimeExecutablePath, 0o755);
  }

  return runtimeExecutablePath;
}

const runtimeMode = process.env[RUNTIME_ENV_NAME] ?? 'bundled';
await stageRuntimeBinary({ outputDirectory, runtimeMode });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/runtime-flavor.test.mjs scripts/build-server.test.mjs`
Expected: PASS

- [ ] **Step 5: Inspect the diff for this slice**

Run: `git diff -- scripts/build-server.mjs scripts/build-server.test.mjs scripts/runtime-flavor.mjs`
Expected: `build-server.mjs` 只新增 runtimeMode 分支与可测试 helper

### Task 3: Extend platform packaging commands to carry flavor

**Files:**
- Modify: `scripts/build-platform.mjs`
- Modify: `scripts/build-platform.test.mjs`
- Modify: `package.json`
- Test: `scripts/runtime-flavor.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createBuildContext,
  getBuildPlan,
  resolveSpawnInvocation,
} from './build-platform.mjs';

test('createBuildContext defaults to the with-node flavor', () => {
  assert.deepEqual(
    createBuildContext(['win-x64'], undefined),
    { targets: ['win-x64'], flavor: 'with-node', runtimeMode: 'bundled' },
  );
});

test('getBuildPlan exposes runtime mode in the spawned environment', () => {
  const plan = getBuildPlan('linux-x64', 'no-node');
  assert.equal(plan.runtimeFlavor, 'no-node');
  assert.equal(plan.runtimeMode, 'external');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/build-platform.test.mjs`
Expected: FAIL because `createBuildContext` and flavored `getBuildPlan` do not exist yet

- [ ] **Step 3: Write minimal implementation**

```js
import { DEFAULT_RUNTIME_FLAVOR, RUNTIME_ENV_NAME, flavorToMode, normalizeRuntimeFlavor } from './runtime-flavor.mjs';

export function createBuildContext(targets, flavor = DEFAULT_RUNTIME_FLAVOR) {
  const runtimeFlavor = normalizeRuntimeFlavor(flavor);
  return {
    targets,
    flavor: runtimeFlavor,
    runtimeMode: flavorToMode(runtimeFlavor),
  };
}

export function getBuildPlan(target, flavor = DEFAULT_RUNTIME_FLAVOR) {
  const plan = SUPPORTED_TARGETS.get(target);
  if (!plan) {
    throw new Error(`Unsupported platform target: ${target}`);
  }
  const runtimeFlavor = normalizeRuntimeFlavor(flavor);
  return {
    ...plan,
    runtimeFlavor,
    runtimeMode: flavorToMode(runtimeFlavor),
  };
}

function runPlan(target, flavor) {
  const plan = getBuildPlan(target, flavor);
  const invocation = resolveSpawnInvocation(command, args);
  const env = { ...process.env, [RUNTIME_ENV_NAME]: plan.runtimeMode };
  spawnSync(invocation.command, invocation.args, { env, cwd: process.cwd(), shell: false, stdio: 'inherit' });
}
```

在 `package.json` 里补充显式脚本：

```json
{
  "scripts": {
    "package:win:with-node": "node scripts/build-platform.mjs win-x64 with-node",
    "package:win:no-node": "node scripts/build-platform.mjs win-x64 no-node",
    "package:mac-arm64:with-node": "node scripts/build-platform.mjs mac-arm64 with-node",
    "package:mac-arm64:no-node": "node scripts/build-platform.mjs mac-arm64 no-node",
    "package:mac-x64:with-node": "node scripts/build-platform.mjs mac-x64 with-node",
    "package:mac-x64:no-node": "node scripts/build-platform.mjs mac-x64 no-node",
    "package:linux:with-node": "node scripts/build-platform.mjs linux-x64 with-node",
    "package:linux:no-node": "node scripts/build-platform.mjs linux-x64 no-node",
    "package:all:with-node": "node scripts/build-platform.mjs all with-node",
    "package:all:no-node": "node scripts/build-platform.mjs all no-node"
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/runtime-flavor.test.mjs scripts/build-platform.test.mjs`
Expected: PASS

Run: `npm run package:doctor`
Expected: `Doctor: OK`

- [ ] **Step 5: Inspect the diff for this slice**

Run: `git diff -- scripts/build-platform.mjs scripts/build-platform.test.mjs package.json`
Expected: 仅包含 flavor 入口、环境透传和新增脚本别名

### Task 4: Add deterministic release asset renaming and document local usage

**Files:**
- Create: `scripts/release-assets.mjs`
- Create: `scripts/release-assets.test.mjs`
- Modify: `README.md`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReleaseAssetName } from './release-assets.mjs';

test('buildReleaseAssetName appends artifact and flavor before the extension', () => {
  assert.equal(
    buildReleaseAssetName('CodeM_0.1.0_x64-setup.exe', 'windows-x64', 'with-node'),
    'CodeM_0.1.0_x64-setup-windows-x64-with-node.exe',
  );
  assert.equal(
    buildReleaseAssetName('CodeM.app.tar.gz', 'macos-arm64', 'no-node'),
    'CodeM-macos-arm64-no-node.app.tar.gz',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/release-assets.test.mjs`
Expected: FAIL because `release-assets.mjs` does not exist yet

- [ ] **Step 3: Write minimal implementation**

```js
export function splitAssetName(fileName) {
  if (fileName.endsWith('.app.tar.gz')) {
    return { stem: fileName.slice(0, -'.app.tar.gz'.length), ext: 'app.tar.gz' };
  }
  if (fileName.endsWith('.tar.gz')) {
    return { stem: fileName.slice(0, -'.tar.gz'.length), ext: 'tar.gz' };
  }
  const dot = fileName.lastIndexOf('.');
  return { stem: fileName.slice(0, dot), ext: fileName.slice(dot + 1) };
}

export function buildReleaseAssetName(fileName, artifact, flavor) {
  const { stem, ext } = splitAssetName(fileName);
  return `${stem}-${artifact}-${flavor}.${ext}`;
}
```

README 打包段落替换为：

```md
npm run package:win:with-node
npm run package:win:no-node
npm run package:mac-arm64:with-node
npm run package:mac-arm64:no-node
npm run package:linux:with-node
npm run package:linux:no-node
```

并补充说明：

```md
- `with-node`：桌面包内包含 Node 运行时
- `no-node`：桌面包依赖系统环境中的 `node`
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/release-assets.test.mjs`
Expected: PASS

Run: `rg -n "with-node|no-node" README.md`
Expected: README 的多平台打包段落出现新的 flavor 说明与命令

- [ ] **Step 5: Inspect the diff for this slice**

Run: `git diff -- scripts/release-assets.mjs scripts/release-assets.test.mjs README.md`
Expected: 仅包含资产命名 helper 和 README 打包说明更新

### Task 5: Upgrade GitHub Release workflow to build all flavors

**Files:**
- Modify: `.github/workflows/release.yml`
- Test: `scripts/runtime-flavor.test.mjs`
- Test: `scripts/build-server.test.mjs`
- Test: `scripts/build-platform.test.mjs`
- Test: `scripts/release-assets.test.mjs`

- [ ] **Step 1: Write the failing verification target**

```yaml
matrix:
  include:
    - platform: windows-latest
      artifact: windows-x64
      flavor: with-node
      npmScript: package:win:with-node
```

验证目标：

```text
当前 workflow 只有单一 flavor，收集到的产物名也没有 `with-node` / `no-node` 后缀。
```

- [ ] **Step 2: Run verification to capture the current gap**

Run: `rg -n "flavor|with-node|no-node|package:win:with-node" .github/workflows/release.yml`
Expected: 找不到 flavor 矩阵与新脚本名

- [ ] **Step 3: Write minimal implementation**

把构建矩阵改成：

```yaml
matrix:
  include:
    - platform: windows-latest
      artifact: windows-x64
      flavor: with-node
      npmScript: package:win:with-node
      bundleRoot: src-tauri/target/release/bundle
    - platform: windows-latest
      artifact: windows-x64
      flavor: no-node
      npmScript: package:win:no-node
      bundleRoot: src-tauri/target/release/bundle
```

并把资产收集逻辑收敛为：

```bash
node scripts/release-assets.mjs \
  --bundle-root "${{ matrix.bundleRoot }}" \
  --out-dir release-assets \
  --artifact "${{ matrix.artifact }}" \
  --flavor "${{ matrix.flavor }}"
```

上传 artifact 名也带上 flavor：

```yaml
with:
  name: codem-${{ matrix.artifact }}-${{ matrix.flavor }}
```

- [ ] **Step 4: Run verification**

Run: `node --test scripts/runtime-flavor.test.mjs scripts/build-server.test.mjs scripts/build-platform.test.mjs scripts/release-assets.test.mjs`
Expected: PASS

Run: `npm run package:win:with-node`
Expected: PASS，并生成 Windows `with-node` bundle

Run: `npm run package:win:no-node`
Expected: PASS，并生成 Windows `no-node` bundle

- [ ] **Step 5: Inspect the final diff and working tree**

Run: `git diff -- .github/workflows/release.yml scripts/build-server.mjs scripts/build-platform.mjs scripts/release-assets.mjs package.json README.md`
Expected: 只包含 runtime flavor 打包链路相关改动

Run: `git status --short`
Expected: 看到计划内文件改动；不要自动提交，保留给人工审核
