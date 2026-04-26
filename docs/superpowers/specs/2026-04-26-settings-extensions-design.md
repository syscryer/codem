# Settings Extensions Design

## Goal

Extend the new CodeM settings view with four focused sections:

1. Model settings
2. Global prompt
3. MCP management
4. Skills management

This is not a provider-management replacement for `cc-switch`. CodeM keeps `cc-switch` responsible for provider, base URL, API key, proxy, and live config switching. CodeM only exposes local app settings and read-only operational visibility where that is safe.

## Decisions

- "供应商管理" becomes a model-focused section in behavior. The left navigation can keep the existing label for now, but the page title should be "模型设置".
- CodeM does not list cc-switch providers.
- CodeM does not switch providers.
- CodeM can show the current default model read from the existing Claude configuration path.
- CodeM can store custom model IDs locally and include them in the Composer model picker.
- Global prompt means the Claude Code global `CLAUDE.md` prompt/memory file, matching Any-code's behavior. It is not stored as CodeM app settings and is not injected into prompts by CodeM.
- MCP and Skills are read-only in the first version.

## Model Settings

### Data Model

Extend app settings with a `models` section:

```ts
type CustomModel = {
  id: string;
  label?: string;
  description?: string;
};

type ModelSettings = {
  customModels: CustomModel[];
  defaultModelId?: string;
};
```

`id` is the actual model string passed to Claude Code via `--model`.

Validation:

- Trim all string fields.
- Reject empty model IDs.
- Reject duplicate IDs after trimming.
- Keep model IDs without spaces. Allow slash, colon, dot, dash, underscore, and bracket characters so IDs like `provider/model:202603[beta]` work.
- Limit ID length to a practical maximum such as 160 characters.
- Label and description are optional display fields.

### Backend

Reuse the current local JSON settings file and `settings-store` pattern:

- Merge missing `models` fields with defaults.
- Normalize custom model entries.
- Add API routes:
  - `PUT /api/settings/models`
  - optionally keep `GET /api/settings` as the main read endpoint.

No cc-switch files are modified.

### Frontend

Create a `ModelSettingsSection` inside settings.

The section shows:

- Current configured default model from `/api/claude/models`.
- Custom model list.
- Add custom model inline form.
- Delete custom model.
- Set custom model as default selection.

Composer model list should be:

1. `__default`
2. configured Claude default model if available
3. custom models from settings

When `defaultModelId` is set, new Composer selection should prefer it unless the current thread has a stored model. Existing thread model restoration should keep taking precedence.

## Global Prompt

### Scope

This section edits Claude Code's global prompt file:

- Path: `~/.claude/CLAUDE.md`, resolved from `USERPROFILE` on Windows or `HOME` elsewhere.
- Behavior reference: Any-code's `get_system_prompt()` and `save_system_prompt()` commands.
- Empty content means an empty `CLAUDE.md` file, not "disabled prompt injection".

CodeM must not copy this content into its local settings JSON.

### Backend

Add a small Claude global prompt adapter:

- Resolve the Claude config directory using the same home-directory assumption already used by `readConfiguredClaudeModel()`.
- Ensure `~/.claude` exists before saving.
- Read `CLAUDE.md`; if the file does not exist, return an empty string and the expected path.
- Save `CLAUDE.md` with explicit user action only.
- Prefer temp-file write plus rename where practical to reduce overwrite/corruption risk.
- Return metadata the UI can show: `path`, `exists`, `updatedAt` if available, and content length.

Suggested APIs:

- `GET /api/claude/system-prompt`
- `PUT /api/claude/system-prompt`

Validation:

- Preserve content exactly except normalizing line endings only if the rest of the app already does so.
- Do not trim Markdown content.
- Limit size to a conservative maximum such as 200,000 characters so a pasted file cannot exhaust memory.

### Frontend

Create `GlobalPromptSettingsSection`:

- Load the current `CLAUDE.md` content.
- Show the resolved file path.
- Use a Markdown-friendly textarea/editor.
- Save with an explicit button.
- Show character count and loaded/saved/error status.
- If the file is missing, show an empty editor and make the first save create the file.

### Runtime Behavior

No runtime prompt injection is added.

Claude Code is responsible for applying `~/.claude/CLAUDE.md` as its global prompt/memory. CodeM only edits that file. Conversation history and submitted user text should remain unchanged.

## MCP Management

### Scope

Read-only first version.

No add, edit, delete, enable, disable, import, or config write.

### Backend

Add a read-only adapter that gathers currently visible MCP information from local configuration or runtime-discoverable sources.

Suggested API:

- `GET /api/mcp/servers`

Response shape:

```ts
type McpServerSummary = {
  id: string;
  name: string;
  source: string;
  status: 'available' | 'unknown' | 'error';
  tools: Array<{ name: string; description?: string }>;
  error?: string;
};
```

If the adapter cannot inspect a server safely, return `status: 'unknown'` instead of failing the whole response.

### Frontend

Create `McpSettingsSection`:

- Refresh button.
- Server rows.
- Tool count.
- Expandable tool list.
- Error/unknown badges.

No write actions.

## Skills Management

### Scope

Read-only first version.

No install, delete, update, import zip, backup, or restore.

### Backend

Scan known skill locations:

- Codex user skills.
- Enabled plugin skill cache if accessible.
- Project-local skill locations only if already used by the app.

Parse each `SKILL.md` frontmatter enough to extract:

```ts
type SkillSummary = {
  id: string;
  name: string;
  description?: string;
  path: string;
  source: 'user' | 'plugin' | 'project' | 'system' | 'unknown';
};
```

Suggested API:

- `GET /api/skills`

Parsing failures should be surfaced per skill path, not as a whole-page failure.

### Frontend

Create `SkillsSettingsSection`:

- Search input.
- Refresh button.
- Skill rows with name, description, source, path.
- Copy path.
- Open containing folder if an existing backend helper is available; otherwise omit the button in the first version.

No write actions.

## UI Structure

Keep the current system-settings visual language:

- Left settings nav remains stable.
- Right content stays centered and row-based.
- Each section is independent and imported by `SettingsView`.
- Avoid nested cards and large decorative layouts.

Section mapping:

- `providers` renders `ModelSettingsSection` with title "模型设置".
- `globalPrompts` renders `GlobalPromptSettingsSection`.
- `mcp` renders `McpSettingsSection`.
- `skills` renders `SkillsSettingsSection`.

## Error Handling

- Settings save failures show toast and keep UI usable.
- Read-only MCP/Skills failures show inline empty/error states.
- Backend responses must not leak sensitive file contents.
- Paths may be shown only where they identify local config or skill files; no secrets are read or displayed.

## Testing

Backend:

- Settings normalization for models.
- Duplicate/invalid custom model filtering.
- Claude global prompt adapter read/missing-file/save behavior.
- Save path creates `~/.claude` when missing and does not trim Markdown content.
- MCP adapter partial failure behavior.
- Skill scanner frontmatter parsing and invalid file tolerance.

Frontend/type:

- `npm run typecheck`
- Build after all sections are wired.

Browser:

- Model settings: add custom model, set default, confirm Composer picker includes it.
- Global prompt: load, edit, save, refresh, confirm it persisted to the actual Claude global `CLAUDE.md` file.
- MCP: refresh and inspect read-only rows.
- Skills: search and refresh.
- Settings navigation does not reset workspace state.

## Deferred Work

- Provider list display.
- Provider switching.
- API key/base URL editing.
- MCP add/edit/delete/enable/disable.
- Skills install/delete/update/import/backup/restore.
- Project-level or thread-level prompts.
