# CodeM Multi-Agent Runtime Platform

## Status

Foundation complete; Grok ACP driver POC complete; product integration not enabled.

## Goal

CodeM needs to support Claude Code, Grok Build, OpenAI Codex, and future first-party agents without duplicating the conversation runtime for each product. Existing Claude Code behavior is the compatibility baseline and must remain unchanged while the shared boundary is introduced.

## Architecture

The platform separates four concerns:

1. **Provider** identifies the product, models, authentication ownership, and user-facing name.
2. **Driver** implements a transport or protocol such as Claude stream-json, ACP, JSON-RPC, HTTP, or an embedded runtime.
3. **Runtime** owns a live process or connection and implements prompt, cancel, resume, approval, and close operations.
4. **Run events** are CodeM's stable timeline contract for text, tools, approvals, user input, usage, completion, and failure.

Provider identity and runtime transport are intentionally separate. A provider may change protocols without changing persisted thread identity, and multiple providers may share one protocol driver.

## Compatibility Boundary

The foundation phase is additive:

- `/api/claude/*` remains the production Claude Code API.
- `useClaudeRun` remains the production frontend runtime hook.
- `ClaudeEvent` remains available as a compatibility alias.
- Claude process spawning, stdin control messages, stream parsing, hot-runtime reuse, session recovery, and history import are unchanged.
- Existing SQLite rows keep `provider = 'claude-code'` and require no migration.

No planned provider is selectable or allowed to receive prompts until its driver passes provider-specific contract and end-to-end tests.

## Provider Lifecycle

- `active`: implemented and eligible for availability detection; it may become selectable when the product UI opts in.
- `planned`: registered for architecture visibility only; availability is unknown and it is never selectable.

Installation and authentication are separate from lifecycle. An active provider may be unavailable because its local CLI is missing or not authenticated.

## Capability Model

Capabilities use three states:

- `supported`: implemented and covered by the provider contract.
- `unsupported`: known not to be available.
- `runtime-detected`: depends on protocol negotiation, CLI version, model, or deployment.

Cancellation additionally distinguishes soft interrupt from hard process termination. The UI must be capability-driven and must not expose unsupported controls.

## Planned Drivers

- Claude Code: existing stdin/stdout stream-json bridge.
- Grok Build: official ACP over `grok agent stdio`.
- OpenAI Codex: official stable app-server/JSON-RPC interface available at implementation time.
- CodeM Agent: ACP by default; CodeM-specific extensions only when a required feature cannot be represented by ACP.

Terminal text scraping is not an accepted integration strategy.

## Grok ACP POC

The POC was validated against Grok Build `0.2.93` on Windows using `grok agent stdio`:

- Transport is newline-delimited JSON-RPC 2.0, not terminal output and not Content-Length framing.
- `initialize`, `authenticate`, `session/new`, `session/load`, `session/prompt`, and `session/cancel` were exercised successfully.
- The advertised agent capabilities include session loading, embedded context, and HTTP/SSE MCP transport. Image and audio prompt capabilities are currently false.
- Cached-token authentication succeeds when the Grok child process can reach xAI. The validation environment required a child-process-local HTTP proxy at `127.0.0.1:7890`; CodeM does not persist or change proxy settings in this phase.
- A text prompt streamed public `agent_message_chunk` updates and ended with `stopReason = end_turn`.
- Cancellation on a new active session ended with `stopReason = cancelled`.
- Loading a persisted session replays public message updates. Grok `0.2.93` also emits a `Post-replay flush ... session not found` warning even though `session/load` succeeds and replay data is delivered; this needs version tracking before product enablement.
- The Rust driver discards authentication response payloads, counts thought chunks without retaining their text, bounds collected public message text, and reaps the child process after probing or testing.

Grok remains `planned` and non-selectable. Tool calls, interactive permission decisions, user-input requests, attachments, MCP configuration, usage, history persistence, and the production run API remain follow-up work.

## Data And Security

Threads persist a stable provider ID and provider-owned external session ID. Driver-specific metadata must be versioned and must not become a dumping ground for credentials.

CodeM may report whether a CLI is installed or authenticated, but API keys, access tokens, proxy passwords, and CLI login caches remain owned by the operating system, environment, or provider CLI. Raw provider events follow the existing trace redaction rules.

## Delivery Sequence

1. Add provider-neutral event naming and a read-only Provider Registry.
2. Implement an ACP Driver and validate Grok text streaming, cancellation, and session recovery.
3. Add provider selection only after Grok passes compatibility and privacy tests.
4. Integrate Codex and use it to validate that the Driver abstraction is not ACP-specific.
5. Let first-party agents implement ACP where possible.
