# Settings Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build CodeM settings sections for model settings, Claude Code global `CLAUDE.md`, read-only MCP, and read-only Skills.

**Architecture:** Keep local app settings in `server/lib/settings-store.ts` and expose narrow Express routes from `server/index.ts`. Put Claude global prompt, MCP scanning, and Skills scanning behind focused backend adapters, then wire small React settings sections into `SettingsView` using the existing row/panel visual language.

**Tech Stack:** TypeScript, React 19, Vite, Express 5, Node built-ins, node:test.

---

## File Structure

- Modify `server/lib/settings-store.ts`: add `models` settings normalization, update API, and custom model validation.
- Modify `server/lib/settings-store.test.ts`: add model normalization and update tests.
- Create `server/lib/claude-global-prompt.ts`: resolve `~/.claude/CLAUDE.md`, read metadata, save atomically.
- Create `server/lib/claude-global-prompt.test.ts`: test missing file, preserve Markdown, create directory, cleanup temp files.
- Create `server/lib/mcp-inspector.ts`: read-only parse known MCP config files and summarize servers without secrets.
- Create `server/lib/mcp-inspector.test.ts`: test server parsing, secret redaction by omission, malformed files.
- Create `server/lib/skills-scanner.ts`: scan `SKILL.md` roots and parse frontmatter.
- Create `server/lib/skills-scanner.test.ts`: test frontmatter parsing, invalid file tolerance, source classification.
- Modify `server/index.ts`: add settings models, Claude global prompt, MCP, and Skills routes.
- Modify `src/types.ts`: add settings/model/global-prompt/MCP/Skills types.
- Modify `src/lib/settings-api.ts`: normalize app settings including models and add settings save API.
- Modify `src/hooks/useAppSettings.ts`: expose model settings update helper.
- Modify `src/hooks/useClaudeRun.ts`: merge app custom models into Composer model options and preserve thread-specific selection.
- Modify `src/App.tsx`: pass settings/model updater into `SettingsView` and `useClaudeRun`.
- Modify `src/components/settings/SettingsView.tsx`: render new sections.
- Create `src/components/settings/SettingsControls.tsx`: shared `SettingsRow`, `SegmentedControl`, small button/input helpers if needed.
- Modify `src/components/settings/AppearanceSettings.tsx`: use shared controls without changing visual behavior.
- Create `src/components/settings/ModelSettings.tsx`: custom model list/add/delete/default.
- Create `src/components/settings/GlobalPromptSettings.tsx`: explicit load/save editor for `CLAUDE.md`.
- Create `src/components/settings/McpSettings.tsx`: refreshable read-only MCP summary.
- Create `src/components/settings/SkillsSettings.tsx`: refreshable searchable skill summary.
- Modify `src/styles.css`: add classes for inputs, lists, textarea, badges, and compact section actions.
- Modify `tests/useAppSettings.test.ts`: add model update queue/merge tests if helper changes.

## Task 1: Model Settings Store

**Files:**
- Modify: `server/lib/settings-store.ts`
- Test: `server/lib/settings-store.test.ts`

- [ ] **Step 1: Write failing tests for model normalization**

Add tests that prove valid custom models survive, duplicates collapse, invalid IDs are removed, and default selection must exist in either `__default` or custom models.

Run:

```bash
node --test --import tsx server/lib/settings-store.test.ts
```

Expected: FAIL because `models` is not in `AppSettings`.

- [ ] **Step 2: Implement `CustomModel`, `ModelSettings`, defaults, normalization, and `updateModelSettings`**

Add `models` to `AppSettings`. Normalize IDs by trimming, rejecting whitespace and length over 160, removing duplicates. Normalize default to `__default` unless it matches a custom model.

- [ ] **Step 3: Verify store tests pass**

Run:

```bash
node --test --import tsx server/lib/settings-store.test.ts
```

Expected: PASS.

## Task 2: Frontend Settings Model Types and Hook

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/settings-api.ts`
- Modify: `src/hooks/useAppSettings.ts`
- Test: `tests/useAppSettings.test.ts`

- [ ] **Step 1: Write failing tests for frontend model merge/update**

Add tests for `resolveModelSettingsUpdate` and app settings merge. The test should fail because the helpers/types do not exist.

- [ ] **Step 2: Implement frontend normalization and update helper**

Add `CustomModel`, `ModelSettings`, default settings, `saveModelSettings()`, and `updateModels()` using the same optimistic pattern as appearance.

- [ ] **Step 3: Verify frontend settings tests pass**

Run:

```bash
node --test --import tsx tests/useAppSettings.test.ts
```

Expected: PASS.

## Task 3: Model Settings UI and Composer Merge

**Files:**
- Create: `src/components/settings/SettingsControls.tsx`
- Modify: `src/components/settings/AppearanceSettings.tsx`
- Create: `src/components/settings/ModelSettings.tsx`
- Modify: `src/components/settings/SettingsView.tsx`
- Modify: `src/hooks/useClaudeRun.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add shared settings controls**

Move `SettingsRow`, `SegmentedControl`, and `Stepper` into `SettingsControls.tsx`, exporting the same APIs used by appearance.

- [ ] **Step 2: Build `ModelSettingsSection`**

Show current configured model, add/delete custom model rows, and a default selector. Do not show provider lists and do not call cc-switch.

- [ ] **Step 3: Merge Composer model options**

Pass `settings.models` into `useClaudeRun`. Model menu order: `__default`, configured Claude model, custom IDs. Prefer `settings.models.defaultModelId` only when there is no stored thread model.

- [ ] **Step 4: Typecheck model UI**

Run:

```bash
npm run typecheck
```

Expected: PASS.

## Task 4: Claude Global Prompt Adapter and UI

**Files:**
- Create: `server/lib/claude-global-prompt.ts`
- Create: `server/lib/claude-global-prompt.test.ts`
- Modify: `server/index.ts`
- Modify: `src/types.ts`
- Create: `src/components/settings/GlobalPromptSettings.tsx`
- Modify: `src/components/settings/SettingsView.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing backend tests**

Test `readClaudeGlobalPrompt({ homeDirectory })` returns empty content for missing `CLAUDE.md`, `saveClaudeGlobalPrompt()` creates `.claude`, preserves leading/trailing Markdown, and removes temp files after rename.

- [ ] **Step 2: Implement adapter and routes**

Add `GET /api/claude/system-prompt` and `PUT /api/claude/system-prompt`. Use `USERPROFILE || HOME`, `~/.claude/CLAUDE.md`, explicit save, max 200,000 characters, temp file plus rename.

- [ ] **Step 3: Build UI section**

Load content on mount, show path/status/character count, edit in textarea, save with explicit button. Missing file shows empty editor.

- [ ] **Step 4: Verify tests**

Run:

```bash
node --test --import tsx server/lib/claude-global-prompt.test.ts
npm run typecheck
```

Expected: PASS.

## Task 5: MCP Read-Only Adapter and UI

**Files:**
- Create: `server/lib/mcp-inspector.ts`
- Create: `server/lib/mcp-inspector.test.ts`
- Modify: `server/index.ts`
- Modify: `src/types.ts`
- Create: `src/components/settings/McpSettings.tsx`
- Modify: `src/components/settings/SettingsView.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing MCP parser tests**

Test parsing of JSON object-style `mcpServers`, malformed JSON returning an error summary, and no secret fields in the response.

- [ ] **Step 2: Implement read-only MCP inspector**

Read known files if present: `~/.claude/settings.json`, `~/.codex/config.toml` only as best-effort metadata. Do not write config and do not display env/API keys. Return `status: 'unknown'` unless a static config can be parsed safely.

- [ ] **Step 3: Add route and UI**

Add `GET /api/mcp/servers`; render refresh button, server rows, source/path metadata, status badge, command/args summary if safe, and error state.

- [ ] **Step 4: Verify tests**

Run:

```bash
node --test --import tsx server/lib/mcp-inspector.test.ts
npm run typecheck
```

Expected: PASS.

## Task 6: Skills Read-Only Scanner and UI

**Files:**
- Create: `server/lib/skills-scanner.ts`
- Create: `server/lib/skills-scanner.test.ts`
- Modify: `server/index.ts`
- Modify: `src/types.ts`
- Create: `src/components/settings/SkillsSettings.tsx`
- Modify: `src/components/settings/SettingsView.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing scanner tests**

Test a valid `SKILL.md` frontmatter file, a missing description, invalid frontmatter tolerance, and source detection for `.codex/skills` and `.codex/plugins/cache`.

- [ ] **Step 2: Implement scanner and route**

Scan bounded known roots under `USERPROFILE || HOME`: `.codex/skills`, `.codex/plugins/cache`, and project `.codex/skills` if present. Parse only `name` and `description`. Return per-file errors instead of failing the whole API.

- [ ] **Step 3: Build UI**

Add `GET /api/skills` client call inside the component, search by name/description/path, refresh, copy path.

- [ ] **Step 4: Verify tests**

Run:

```bash
node --test --import tsx server/lib/skills-scanner.test.ts
npm run typecheck
```

Expected: PASS.

## Task 7: Full Verification, Browser QA, Commit, Push

**Files:**
- Modify as needed based on verification.

- [ ] **Step 1: Run all targeted tests**

Run:

```bash
node --test --import tsx server/lib/settings-store.test.ts server/lib/claude-global-prompt.test.ts server/lib/mcp-inspector.test.ts server/lib/skills-scanner.test.ts tests/useAppSettings.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Start or restart dev server**

Run:

```bash
npm run dev
```

Expected: frontend at `http://127.0.0.1:5173`, backend at `http://127.0.0.1:3001`.

- [ ] **Step 4: Browser verify**

Use the in-app browser at `http://127.0.0.1:5173`:

- Settings -> 模型设置: add custom model, set default, return to workspace and confirm Composer model menu includes it.
- Settings -> 全局提示词: load, edit a safe test marker, save, refresh, confirm it persisted, then restore the previous file content.
- Settings -> MCP 管理: refresh and verify read-only rows/errors render.
- Settings -> Skills: search for `superpowers`, refresh, copy path.

- [ ] **Step 5: Commit and push**

Run:

```bash
git status --short
git add -- .
git commit -m "实现设置扩展功能"
git -c http.proxy= -c https.proxy= push -u origin codex/settings-system
```

Expected: clean working tree and pushed branch.

## Self-Review

- Spec coverage: model settings, Claude global `CLAUDE.md`, MCP read-only, Skills read-only, UI wiring, and verification all have tasks.
- Placeholder scan: no `TBD` or deferred implementation steps are required for in-scope work.
- Type consistency: backend and frontend both use `CustomModel`, `ModelSettings`, `ClaudeGlobalPrompt`, `McpServerSummary`, and `SkillSummary`.
