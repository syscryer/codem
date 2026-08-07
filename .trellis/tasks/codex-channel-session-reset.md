# Task: 修复 Codex 渠道切换复用旧会话

## Background

待补充背景。

## Objective

切换系统与自定义 Codex 渠道后使用新渠道配置启动会话，并通过真实桌面 UI 验证

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

- 2026-08-07T13:32:21.238Z 将渠道切换元数据收口到 agentChannelMetadataPatch，Codex 自动清空 sessionId，其他 Provider 保持原会话。
- 2026-08-07T13:27:42.903Z 根因：Codex session 固化原渠道配置；渠道 PATCH 虽清空后端 session，但前端本地 summary 仍携带旧 sessionId。修复为切换 Codex 渠道时前后端同时清空 session，并保留渠道变化时禁止复用的保护。

- 2026-08-07T13:27:20.190Z Task created by Trellis automation.

## Verification Results

- 2026-08-07T13:32:21.828Z `Tauri WebView CDP: system -> DeepSeek -> 请只回复 UI4_OK`: pass: PATCH cleared sessionId, run omitted sessionId, UI returned UI4_OK
- 2026-08-07T13:32:21.524Z `node --import tsx --test src/lib/agent-channel-selection.test.ts`: pass: 18/18

- 2026-08-07T13:28:06.381Z `Tauri WebView CDP: system -> DeepSeek -> 请只回复 UI3_OK`: pass: run request omitted old sessionId and UI returned UI3_OK
- 2026-08-07T13:28:06.096Z `cargo test codex_thread_persists_official_thread_id_without_claude_transcript_path -- --nocapture`: pass

- 2026-08-07T13:28:05.817Z `node --import tsx --test src/lib/agent-channel-selection.test.ts`: pass: 17/17
- 2026-08-07T13:28:05.537Z `npm run typecheck`: pass

## Completion Summary

- 2026-08-07T13:32:22.117Z Codex 渠道切换会同步清理前后端旧 session，桌面 UI 连续实测 UI3_OK 和 UI4_OK 均成功。
- 2026-08-07T13:28:29.795Z Codex 渠道切换会清空旧 session；真实桌面 UI 从系统渠道切到 DeepSeek 后返回 UI3_OK，未再沿用 aihub.top 的旧会话。

## Follow-ups

- 待补充。
