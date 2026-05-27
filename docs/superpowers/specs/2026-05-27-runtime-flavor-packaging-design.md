# 运行时双产物打包设计

## 背景

CodeM 当前桌面包默认把 `dist-server` 作为 Tauri 资源打入安装包，桌面端启动后端时会优先寻找包内 `dist-server/runtime/node(.exe)`，找不到时回退到系统 `PATH` 中的 `node`。

现在需要把所有平台的发布产物统一拆成两类：

- `with-node`：安装包内包含 Node 运行时，可直接启动内置后端。
- `no-node`：安装包不包含 Node 运行时，启动时直接依赖系统环境中的 `node`。

目标平台包括：

- Windows x64
- macOS arm64
- macOS x64
- Linux x64

GitHub Release 需要在打 tag 时同时发布上述 4 个平台各自的两类产物。

## 目标

1. 统一 Windows、macOS、Linux 的运行时打包语义。
2. 保持桌面端现有运行逻辑，尽量不扩散运行时分支。
3. 为本地手工打包和 GitHub Actions 构建同时提供清晰入口。
4. 让 release 资产名能直接区分 `with-node` 和 `no-node`。

## 非目标

1. 不实现运行时缺失时的额外 UI 提示或自动下载。
2. 不引入第三方 Node 下载源或安装器逻辑。
3. 不改动现有桌面后端启动协议和 Tauri 资源目录结构。
4. 不处理 macOS universal 的双架构 Node 合并；GitHub 构建仍按 arm64 和 x64 分开产出。

## 方案概览

### 运行时模式

引入统一的 `runtimeMode` 概念：

- `bundled`
  - 在 `dist-server/runtime/` 下写入真实 Node 可执行文件。
  - release 资产命名映射为 `with-node`。
- `external`
  - 不生成 `dist-server/runtime/`。
  - release 资产命名映射为 `no-node`。

本地脚本和 GitHub Actions 都使用同一套底层模式，只是在对外命名时使用更易懂的 flavor 名称。

### 构建链路

#### `scripts/build-server.mjs`

新增运行时模式输入，负责构建 `dist-server` 并控制 `runtime` 目录：

- 始终生成：
  - `dist-server/index.mjs`
  - `dist-server/package.json`
- `bundled` 模式额外生成：
  - Windows：`dist-server/runtime/node.exe`
  - 其他平台：`dist-server/runtime/node`
- `external` 模式：
  - 不生成 `runtime` 目录

运行时文件来源统一为当前构建环境的 `process.execPath`，这样 GitHub Actions 上的 Node 22 会自然成为被打入包内的运行时。

#### `scripts/build-platform.mjs`

扩展为支持 runtime mode 透传，同时保留现有平台选择：

- 平台维度：
  - `win-x64`
  - `mac-arm64`
  - `mac-x64`
  - `linux-x64`
  - `all`
- 运行时维度：
  - `bundled`
  - `external`

脚本职责：

1. 根据平台选择决定 Tauri 构建参数。
2. 通过环境变量或命令参数把 runtime mode 传给 `npm run build`。
3. 在构建完成后，把产物复制或重命名为带 flavor 后缀的文件名，避免同目录覆盖。

### `package.json` 命令

保留底层统一能力，同时暴露显式别名，便于本地与 CI 调用：

- `package:win:with-node`
- `package:win:no-node`
- `package:mac-arm64:with-node`
- `package:mac-arm64:no-node`
- `package:mac-x64:with-node`
- `package:mac-x64:no-node`
- `package:linux:with-node`
- `package:linux:no-node`
- `package:all:with-node`
- `package:all:no-node`

如需保留旧命令，旧命令应明确映射到默认 flavor，推荐默认映射到 `with-node`，以维持当前直觉。

## Tauri 资源与运行时行为

### Tauri 配置

不新增第二份 Tauri 配置文件，也不为 flavor 拆分 `tauri.conf`。

继续使用当前资源目录：

- `../dist-server`

原因：

1. flavor 差异已经被收敛到 `dist-server/runtime` 是否存在。
2. 继续让 Tauri 只打包统一目录，避免多份配置长期漂移。
3. macOS 的专用配置仍只负责窗口与资源补充，不承担 runtime flavor 切换。

### Rust 端

Rust 端保持当前启动逻辑：

1. 先找包内 `dist-server/runtime/node(.exe)`
2. 找不到时回退到 `node`

允许做小幅整理，但不改动行为语义，不新增额外兜底提示。

## GitHub Actions 设计

### 构建矩阵

现有 `release.yml` 的平台矩阵扩展为二维矩阵：

- 平台：
  - `windows-x64`
  - `macos-arm64`
  - `macos-x64`
  - `linux-x64`
- flavor：
  - `with-node`
  - `no-node`

每个矩阵项都需要包含：

- `npmScript`
- `bundleRoot`
- `artifact`
- `flavor`

### 构建环境

继续由 `actions/setup-node@v4` 固定 Node 22：

- `with-node`：把 runner 上的 Node 22 可执行文件打进安装包。
- `no-node`：只把构建过程用到的 Node 当构建依赖，不打进产物。

这样可避免自行下载 Node 二进制，保持版本来源单一且可追踪。

### Release 资产命名

GitHub Release 中的所有资产都带 flavor 后缀，例如：

- `CodeM_0.1.0_x64-setup-windows-x64-with-node.exe`
- `CodeM_0.1.0_x64_en-US-windows-x64-no-node.msi`
- `CodeM_0.1.0_aarch64-macos-arm64-with-node.dmg`

最终命名不要求严格保持以上字符串结构，但必须满足：

1. 同平台两类产物可一眼区分。
2. 不同平台的同名 bundle 不会互相覆盖。
3. `.sig`、`.app.zip`、`SHA256SUMS.txt` 等后续资产处理保持可预期。

## 可借鉴实现

参考 `D:\cursor_project\claudinal` 的经验，吸收以下做法：

1. `package.json` 暴露显式打包命令，降低日常使用门槛。
2. 用独立脚本整理 release 产物命名，而不是把所有命名逻辑堆进 Tauri 配置。
3. GitHub workflow 在收集 release assets 时统一重命名，确保下载侧稳定。

不直接复用其实现的部分：

1. 它没有 `with-node` / `no-node` 双 runtime 设计。
2. 它的 zip/portable 逻辑与 CodeM 当前以 `dist-server` 为核心的桌面后端结构不同。
3. 它的 updater 资产组织不是本次目标。

## 验证策略

### 本地验证

至少验证 Windows 当前开发环境：

1. `package:doctor` 通过。
2. `package:win:with-node` 成功产出 NSIS 与 MSI。
3. `package:win:no-node` 成功产出 NSIS 与 MSI。
4. `with-node` 产物中存在 `dist-server/runtime/node.exe`。
5. `no-node` 产物中不存在 `dist-server/runtime/node.exe`。

### CI 验证

在 GitHub Actions 中验证：

1. 4 平台 × 2 flavor 的矩阵都能完成构建。
2. 每个平台的 release assets 均带 flavor 后缀。
3. 发布阶段能正确汇总全部资产并生成 `SHA256SUMS.txt`。

## 风险与注意事项

1. `with-node` 会增大安装包体积，尤其在 Windows 与 Linux 上更明显。
2. macOS 和 Linux 的 `bundled` 模式改为真正携带 Node 后，需要注意可执行权限保留。
3. 旧脚本若仍默认走单一命令，需要明确默认 flavor，避免 CI 和文档口径不一致。
4. `src-tauri/Cargo.toml` 当前已有独立本地修改，实施时要避免误覆盖无关改动。

## 实施拆分

建议按以下顺序落地：

1. 改 `scripts/build-server.mjs`，先让 runtime mode 生效。
2. 改 `scripts/build-platform.mjs` 与 `package.json`，打通本地命令。
3. 改 `README.md`，同步新的手工打包命令。
4. 改 `.github/workflows/release.yml`，引入 flavor 矩阵与资产命名。
5. 执行本地 Windows 验证，并记录实际产物路径。
