# Task: 修复 Agent Mux Runtime 阻塞 Windows 升级

## Background

Agent Mux Runtime 在 CodeM 关闭后仍可独立运行。Windows 安装或升级时，安装目录中的
`codem-agent-mux.exe` 可能仍被常驻进程占用，导致 NSIS 无法覆盖该文件并中断安装。

## Objective

安装或升级前安全停止安装目录中的 Agent Mux Runtime，避免 NSIS 无法覆盖文件

## Scope

In scope:

- NSIS 安装或升级复制文件前，停止安装目录中的 Agent Mux Runtime。
- NSIS 卸载删除文件前，停止安装目录中的 Agent Mux Runtime。
- 保留 Runtime 脱离 CodeM 主窗口常驻的既有行为。

Out of scope:

- 不改变 Runtime 生命周期和任务调度逻辑。
- 不终止开发目录或其他目录中的同名进程。

## Impact

- Windows NSIS 安装、升级和卸载流程。

## Acceptance Criteria

- [x] NSIS 安装器在复制文件前调用旧安装目录 Runtime 的 `stop` 命令。
- [x] NSIS 卸载器在删除文件前调用安装目录 Runtime 的 `stop` 命令。
- [x] 目标文件不存在或 Runtime 未运行时，安装和卸载仍可继续。
- [x] NSIS 安装包可成功构建。

## Verification Commands

- `npm run package:doctor`
- `npm run desktop:build -- --bundles nsis`

## Implementation Record
- 2026-08-07T04:48:11.241Z 确认根因是安装目录 codem-agent-mux.exe 被独立 Runtime 锁定；新增 NSIS preinstall/preuninstall hook，按 $INSTDIR 完整路径调用现有 stop 命令并等待退出，不影响开发目录同名进程。

- 2026-08-07T04:45:34.061Z Task created by Trellis automation.

## Verification Results
- 2026-08-07T04:52:19.710Z `CodeM_0.1.21_x64-setup.exe /S（安装目录 Runtime 0.1.20 常驻）`: pass

- 2026-08-07T04:52:19.026Z `npm run desktop:build -- --bundles nsis`: pass
- 2026-08-07T04:52:18.387Z `npm run package:doctor`: pass

## Completion Summary
- 2026-08-07T04:52:28.147Z NSIS 安装和卸载前会调用安装目录 Runtime 的 stop 命令并等待退出；真实覆盖升级已从 0.1.20 成功安装到 0.1.21，开发 Runtime 未受影响，安装版 Runtime 已恢复运行。

## Follow-ups

- 无。
