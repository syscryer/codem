# Session Record: 修复 Agent Mux Runtime 阻塞 Windows 升级

- Session: session-20260807-044534-6ek5
- Started: 2026-08-07T04:45:34.060Z
- Task: .trellis/tasks/agent-mux-installer-upgrade-lock.md

## Notes
- 2026-08-07T04:48:11.241Z 确认根因是安装目录 codem-agent-mux.exe 被独立 Runtime 锁定；新增 NSIS preinstall/preuninstall hook，按 $INSTDIR 完整路径调用现有 stop 命令并等待退出，不影响开发目录同名进程。

- 2026-08-07T04:45:34.065Z Session started.

## Verification
- 2026-08-07T04:52:19.710Z `CodeM_0.1.21_x64-setup.exe /S（安装目录 Runtime 0.1.20 常驻）`: pass

- 2026-08-07T04:52:19.026Z `npm run desktop:build -- --bundles nsis`: pass
- 2026-08-07T04:52:18.387Z `npm run package:doctor`: pass

## Completed

- 2026-08-07T04:52:28.147Z NSIS 安装和卸载前会调用安装目录 Runtime 的 stop 命令并等待退出；真实覆盖升级已从 0.1.20 成功安装到 0.1.21，开发 Runtime 未受影响，安装版 Runtime 已恢复运行。
