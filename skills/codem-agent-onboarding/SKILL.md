---
name: codem-agent-onboarding
description: Standardize, implement, audit, and verify Agent Provider onboarding in CodeM. Use when adding or enabling a new Agent/CLI/driver/runtime, reviewing an incomplete Provider integration, or fixing missed product surfaces such as conversation documents, links, context, hot runtime state, settings, automation, persistence, security, and test coverage.
---

# CodeM Agent Onboarding

Use `openspec/agent-provider-onboarding.md` as the only source of truth. Do not copy its contract into task notes or this skill.

## Workflow

1. Establish context.
   - Follow the repository `AGENTS.md` and `.trellis/workflow.md`.
   - Start or resume a Trellis task before changing code.
   - Read `openspec/agent-provider-onboarding.md` completely.
   - Confirm the Provider ID, lifecycle, driver protocol, capability states, compatibility boundary, security impact, and real CLI acceptance scope with the user.

2. Trace the real integration.
   - Prefer codebase graph tools, then use targeted text search only when needed.
   - Trace Provider discovery through driver, runtime, unified events, frontend timeline, persistence, settings, automation, and runtime cleanup.
   - Record every applicable product surface from the OpenSpec checklist in the Trellis task.
   - Mark each optional capability `supported`, `unsupported`, or `runtime-detected`; never infer support from output text.

3. Implement the smallest complete adapter.
   - Update `AgentProviderId` and `src/lib/agent-provider-metadata.ts` together.
   - Update the backend registry and shared active Provider validation.
   - Keep Provider-native fields inside the Rust driver or adapter layer.
   - Preserve `contentBlocks`, attachment semantics, `AgentRunEvent`, terminal-event uniqueness, session identity, and redaction rules.
   - Route Markdown, links, file `changes[]`, context, and workspace status through shared CodeM components.
   - Add Provider-specific branches only where protocol behavior actually differs.

4. Prove the contract.
   - Add focused driver and regression tests for every declared supported capability.
   - Run `python <skill-directory>/scripts/check_onboarding.py <codem-repository>`.
   - Complete the OpenSpec real CLI acceptance on each target desktop platform before calling the Provider production-ready.
   - Treat missing credentials or unavailable real CLI validation as an explicit unverified boundary, not a pass.

5. Close the task.
   - Record decisions and actual command results with Trellis `record` and `verify`.
   - Update user-facing or release documentation when the selectable Provider set changes.
   - Complete the Trellis task only after automated gates pass and remaining real-world gaps are listed.

## Guardrails

- Do not build a dynamic Provider plugin system for a static integration.
- Do not add frontend branches for ACP, JSON-RPC, stream-json, or Pi-native fields.
- Do not synthesize file cards, precise context, usage, or hidden reasoning from assistant prose.
- Do not persist credentials, base64 payloads, unbounded raw events, or large attachment bodies.
- Do not modify Provider-global login or configuration outside the scope confirmed by the user.
