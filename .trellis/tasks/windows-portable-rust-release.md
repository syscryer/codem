# Task: 修复 Rust 版 Windows portable 发布

## Background

`v0.1.10` GitHub Release 的 macOS、Linux 构建成功，Windows 的 Tauri 安装包和 updater 签名也已生成，但 `Collect release assets` 仍尝试复制旧 Node 架构的 `src-tauri/target/release/_up_`，最终因目录不存在而失败。当前 runtime flavor 仅支持 `rust`，Tauri bundle resources 为空，portable 产物只需要 Rust 桌面可执行文件。

## Objective

移除 Windows portable 对旧 Node _up_ sidecar 的依赖并恢复 v0.1.10 Release

## Scope

In scope:

- 移除 Windows portable 对 `_up_` sidecar 的依赖。
- 保留 Windows `CodeM.exe` portable zip 产物。
- 修正 README 中与 Rust 单包架构冲突的 with-node/no-node 说明。
- 增加 workflow 回归测试，防止重新引入 `_up_` 依赖。

Out of scope:

- 不恢复旧 Node sidecar 打包链路。
- 不调整 macOS、Linux 安装包结构。
- 不更换 updater 签名密钥。

## Impact

- CI：`.github/workflows/release.yml` 的 Windows portable 资产收集。
- 文档：`README.md` 下载说明。
- 测试：`scripts/release-workflow.test.mjs`。

## Acceptance Criteria

- [ ] Windows portable zip 仅包含 Rust 桌面可执行文件，不读取 `_up_`。
- [ ] README 明确桌面安装包不依赖系统 Node.js。
- [ ] release workflow 回归测试、typecheck、package doctor 和 diff check 通过。
- [ ] `v0.1.10` GitHub Release workflow 全部成功并发布资产。

## Verification Commands

- `node --test scripts/release-workflow.test.mjs`
- `npm run typecheck`
- `npm run package:doctor`
- `git diff --check`

## Implementation Record
- 2026-07-15T06:33:34.708Z GitHub Actions run 29393805854 失败于 Windows Collect release assets：Tauri 安装包与签名已生成，但旧 workflow 复制不存在的 _up_ 目录。已移除该过期依赖，README 对齐 Rust 单包架构，并增加 workflow 回归测试。

- 2026-07-15T06:31:56.862Z Task created by Trellis automation.

## Verification Results

- 2026-07-15T06:51:18.778Z `GitHub Release v0.1.10 assets`: 通过：Windows portable/EXE/MSI、macOS、Linux、updater 签名、latest.json、SHA256SUMS 和源码包均已生成。
- 2026-07-15T06:51:18.007Z `GitHub Actions run 29394671337`: 通过：Windows、macOS、Linux 构建及 Publish GitHub Release 全部 success。

- 2026-07-15T06:33:54.243Z `git diff --check`: 通过：无 whitespace 错误，仅有 Windows LF/CRLF 提示。
- 2026-07-15T06:33:53.346Z `npm run package:doctor`: 通过：发布环境检查 Doctor: OK。

- 2026-07-15T06:33:52.261Z `npm run typecheck`: 通过：TypeScript 类型检查无错误。
- 2026-07-15T06:33:51.152Z `node --test scripts/release-workflow.test.mjs`: 通过：Windows portable 仅打包 Rust CodeM.exe，workflow 不再引用 _up_。

## Completion Summary

- 2026-07-15T06:51:19.540Z v0.1.10 已基于 GitHub main 成功发布；Windows portable 不再依赖旧 _up_，各平台安装包、签名、latest.json 和校验文件齐全。
- 2026-07-15T06:33:55.280Z 修复 Rust 版 Windows portable 发布：移除旧 _up_ sidecar 依赖，README 对齐 Rust 单包架构，新增 workflow 回归测试；本地验证全部通过。

## Follow-ups

- 无。
