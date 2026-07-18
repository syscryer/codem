# Task: 修复 Claude 原生更新代理重试

## Background

待补充背景。

## Objective

识别 Claude 原生更新网络错误并触发已配置的 CodeM 或系统代理重试

## Scope

In scope:

- 待补充。

Out of scope:

- 待补充。

## Impact

- 待补充。

## Acceptance Criteria

- [ ] 待补充。

## Verification Commands

- 待补充。

## Implementation Record

- 2026-07-18T12:25:57.255Z Claude 原生 update 直连超时缩短为 30 秒，超时后自动走 CodeM/系统代理；更新完成后的可执行文件探测增加 5 秒稳定等待，避免符号链接替换竞态误报。
- 2026-07-18T12:18:17.216Z 将 failed to fetch、TelemetrySafeError 和 downloads.claude.ai 纳入网络失败识别，使 Claude 原生更新失败后能按现有策略重试 CodeM/系统代理。

- 2026-07-18T12:18:06.422Z Task created by Trellis automation.

## Verification Results
- 2026-07-18T12:25:57.258Z `git diff --check`: pass

- 2026-07-18T12:25:57.250Z `POST /api/agents/lifecycle claude-code update`: HTTP 200，networkPath=codem-proxy，version=2.1.214，installed=true
- 2026-07-18T12:25:57.245Z `cargo check --features custom-protocol`: pass（仅仓库既有 warning）

- 2026-07-18T12:18:17.212Z `curl -x http://127.0.0.1:7890 https://downloads.claude.ai/claude-code-releases/latest`: HTTP 200
- 2026-07-18T12:18:17.209Z `cargo test --features custom-protocol agent_lifecycle_mirror_retry_requires_a_network_failure`: pass

## Completion Summary

- 2026-07-18T12:26:03.612Z Claude 更新通过代理成功验证，避免直连长时间阻塞和更新后符号链接瞬时探测误报；接口返回 installed=true、version=2.1.214。
- 2026-07-18T12:18:23.816Z Claude 原生更新的网络失败文本现在会触发 CodeM/系统代理重试；已通过回归测试，代理访问官方更新源 HTTP 200。

## Follow-ups

- 待补充。
