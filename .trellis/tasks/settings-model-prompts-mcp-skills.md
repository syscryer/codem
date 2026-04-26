# Task: Settings Extensions - Models, Prompt, MCP, Skills

## Objective

Extend CodeM settings beyond Appearance with focused, low-risk sections:

- 模型设置
- 全局提示词
- MCP 管理
- Skills 管理

This task intentionally does not replace `cc-switch`. Provider ownership stays in `cc-switch`; CodeM only adds local model selection settings and read-only visibility for MCP/Skills.

## Scope

In scope:

- Extend local settings JSON for model settings.
- Add custom model settings.
- Add Claude Code global prompt editing for `~/.claude/CLAUDE.md`.
- Add read-only MCP display.
- Add read-only Skills display.
- Wire these sections into the existing Settings first-level view.

Out of scope:

- Listing cc-switch providers.
- Switching providers.
- Editing base URL, API key, proxy, or provider live config.
- MCP add/edit/delete/enable/disable.
- Skills install/delete/update/import/backup/restore.
- Project-level, thread-level, or profile prompts.
- Runtime prompt injection managed by CodeM.

## Design Reference

Main design:

- `docs/superpowers/specs/2026-04-26-settings-extensions-design.md`

External references:

- `D:\project\desktop-cc-gui` for custom model UX patterns.
- `D:\project\cc-switch` for later MCP/Skills ideas, but first version remains read-only.
- `D:\project\any-code` for Claude Code global `CLAUDE.md` prompt editing behavior.

## Stage 1. Model Settings

Goal:

- Let users add custom Claude model IDs locally and use them in the Composer model picker.

Tasks:

- [ ] Add `CustomModel` and `ModelSettings` types.
- [ ] Extend settings defaults and normalization.
- [ ] Add/update settings API for model settings.
- [ ] Add frontend settings API/hook support.
- [ ] Create `ModelSettingsSection`.
- [ ] Display current configured default model from `/api/claude/models`.
- [ ] Add custom model form.
- [ ] Support delete custom model.
- [ ] Support set custom model as default selection.
- [ ] Merge custom models into Composer model picker.
- [ ] Preserve existing thread model restoration behavior.

Acceptance:

- Added custom models appear in the Composer model menu.
- Selected custom model is sent as `--model`.
- Refresh preserves custom models and default selection.
- No cc-switch provider files are modified.

## Stage 2. Global Prompt

Goal:

- Edit Claude Code's global `~/.claude/CLAUDE.md` prompt/memory file from CodeM settings.

Tasks:

- [ ] Add backend helper to resolve the Claude config directory from `USERPROFILE`/`HOME`.
- [ ] Add backend helper to read `~/.claude/CLAUDE.md`, returning empty content when missing.
- [ ] Add backend helper to save `~/.claude/CLAUDE.md`, creating `~/.claude` when needed.
- [ ] Prefer temp-file write plus rename for save safety where practical.
- [ ] Add `GET /api/claude/system-prompt`.
- [ ] Add `PUT /api/claude/system-prompt`.
- [ ] Add frontend API/hook support for load/save.
- [ ] Create `GlobalPromptSettingsSection`.
- [ ] Show resolved `CLAUDE.md` path, character count, and loaded/saved/error status.
- [ ] Use explicit save button.
- [ ] Keep Markdown content untrimmed on save.

Acceptance:

- Missing `CLAUDE.md` loads as empty content without failing the settings page.
- Saving creates or updates the actual Claude Code global `CLAUDE.md` file.
- Refresh reloads the saved file content.
- No CodeM prompt payloads are modified.
- Existing conversation rendering remains stable because user text is not injected or rewritten.

## Stage 3. MCP Read-Only Management

Goal:

- Show currently visible MCP servers and tools without modifying configuration.

Tasks:

- [ ] Add `McpServerSummary` type.
- [ ] Implement read-only backend MCP adapter.
- [ ] Add `GET /api/mcp/servers`.
- [ ] Add frontend API/hook.
- [ ] Create `McpSettingsSection`.
- [ ] Add refresh action.
- [ ] Add expandable tool list.
- [ ] Add inline unknown/error state handling.

Acceptance:

- MCP section loads without blocking the settings page.
- Partial failures appear per server or as an inline state.
- No MCP config files are written.

## Stage 4. Skills Read-Only Management

Goal:

- Show installed/available skills without modifying files.

Tasks:

- [ ] Add `SkillSummary` type.
- [ ] Implement backend skill scanner for known local skill roots.
- [ ] Parse `SKILL.md` frontmatter for name and description.
- [ ] Add `GET /api/skills`.
- [ ] Add frontend API/hook.
- [ ] Create `SkillsSettingsSection`.
- [ ] Add search.
- [ ] Add refresh.
- [ ] Add copy path.
- [ ] Add open containing folder only if an existing safe helper is available.

Acceptance:

- Skills section lists available skills.
- Search filters by name, description, and path.
- Invalid skill files do not break the whole page.
- No skill files are written or deleted.

## Verification

- [ ] Run model/settings unit tests.
- [ ] Run Claude global prompt adapter tests.
- [ ] Run MCP adapter tests.
- [ ] Run skill scanner tests.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Browser verify model settings.
- [ ] Browser verify global prompt read/save persistence against the actual `CLAUDE.md` file.
- [ ] Browser verify MCP refresh/read-only display.
- [ ] Browser verify Skills search/refresh.

## Risks

- Accidentally changing provider ownership from cc-switch to CodeM.
- Accidentally overwriting the user's Claude Code global `CLAUDE.md` content.
- Trimming or reformatting Markdown in the global prompt file.
- Custom model default overriding existing thread-specific model restoration.
- MCP/Skills scanners failing hard on malformed local files.
- Showing sensitive file contents instead of only metadata.

## Notes

- Commit messages should stay in Chinese.
- Keep each stage independently reviewable.
- MCP and Skills write operations require separate future plans with backup and confirmation behavior.
