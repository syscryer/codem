# Plugin Suite Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full Claude Code plugin management workflow to CodeM's Settings area, with CodeM styling and both web and desktop entry points.

**Architecture:** Keep CodeM's Node/Express backend and Tauri shell, but add a dedicated plugin service that exposes plugin, marketplace, and skill discovery plus the mutating claude plugin/skill commands. On the frontend, replace the current read-only Skills settings entry with a unified Plugins settings suite based on CodeM's settings information architecture and existing UI primitives.

**Tech Stack:** TypeScript, React 19, Vite, Express 5, Node built-ins, Tauri 2, `claude` CLI, node:test.

---

## File Structure

- Create: `server/lib/plugins.ts`
- Create: `server/lib/plugins.test.ts`
- Modify: `server/index.ts`
- Modify: `src/types.ts`
- Modify: `src/components/settings/SettingsSidebar.tsx`
- Modify: `src/components/settings/SettingsView.tsx`
- Modify: `src/components/settings/SkillsSettings.tsx`
- Create: `src/components/settings/PluginsSettings.tsx`
- Create: `src/components/settings/plugins/PluginsSuite.tsx`
- Create: `src/components/settings/plugins/InstalledPluginsPanel.tsx`
- Create: `src/components/settings/plugins/DiscoverPluginsPanel.tsx`
- Create: `src/components/settings/plugins/MarketplacesPanel.tsx`
- Create: `src/components/settings/plugins/SkillsPanel.tsx`
- Create: `src/lib/plugins.ts`
- Modify: `src/lib/slashCommands.ts`
- Modify: `src/components/Composer.tsx`
- Modify: `src/components/SearchPalette.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `src/components/settings/SettingsEmptySection.tsx` if the layout needs a fallback tweak
- Test: existing settings, skills, composer, and app integration tests
- Test: `npm run typecheck`
- Test: `npm test`
- Test: `npm run build`
- Test: `npm run desktop:build`

## Task 1: Add the backend plugin service

**Files:**
- Create: `server/lib/plugins.ts`
- Create: `server/lib/plugins.test.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { listInstalledPlugins, listMarketplaces, listSkills, installSkillFromPath, runPluginCommand } from './plugins.js';

test('plugin service exposes installed plugins, marketplaces, and skills', async () => {
  const installed = await listInstalledPlugins();
  const marketplaces = await listMarketplaces();
  const skills = await listSkills(null);

  expect(Array.isArray(installed)).toBe(true);
  expect(Array.isArray(marketplaces)).toBe(true);
  expect(Array.isArray(skills)).toBe(true);
});

test('plugin service can shell out to claude plugin commands', async () => {
  const result = await runPluginCommand({ action: 'list', kind: 'plugin' });
  expect(result).toHaveProperty('exit_code');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --import tsx server/lib/plugins.test.ts`
Expected: fail because the plugin service does not exist yet.

- [ ] **Step 3: Implement the backend service**

```ts
export async function listInstalledPlugins() { return []; }
export async function listMarketplaces() { return []; }
export async function listSkills(_cwd: string | null) { return []; }
export async function installSkillFromPath(_args: unknown) { return { installed: [] }; }
export async function installBuiltinSkill(_args: unknown) { return { stdout: '', stderr: '', exit_code: 0 }; }
export async function runPluginCommand(_args: unknown) { return { stdout: '', stderr: '', exit_code: 0 }; }
```

Wire the API routes in `server/index.ts` so the settings page can call them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --import tsx server/lib/plugins.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/plugins.ts server/lib/plugins.test.ts server/index.ts
git commit -m "feat: add plugin backend service"
```

## Task 2: Replace the Skills-only settings entry with a Plugins suite

**Files:**
- Modify: `src/types.ts`
- Modify: `src/components/settings/SettingsSidebar.tsx`
- Modify: `src/components/settings/SettingsView.tsx`
- Modify: `src/components/settings/SkillsSettings.tsx`
- Create: `src/components/settings/PluginsSettings.tsx`

- [ ] **Step 1: Write the failing settings test**

```ts
import { render, screen } from '@testing-library/react';
import { PluginsSettingsSection } from '../src/components/settings/PluginsSettings.js';

test('settings exposes Plugins instead of a standalone Skills entry', () => {
  const view = renderSettingsView();
  expect(view).toContain('Plugins');
  expect(view).not.toContain('Skills');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/useAppSettings.test.ts`
Expected: fail until the settings tree is updated.

- [ ] **Step 3: Update the settings section model**

```ts
export type SettingsSection =
  | 'basic'
  | 'appearance'
  | 'shortcuts'
  | 'providers'
  | 'usage'
  | 'sessions'
  | 'mcp'
  | 'plugins'
  | 'globalPrompts'
  | 'openWith';
```

Move the old Skills entry into the new Plugins suite and update sidebar labels accordingly.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/useAppSettings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/components/settings/SettingsSidebar.tsx src/components/settings/SettingsView.tsx src/components/settings/SkillsSettings.tsx src/components/settings/PluginsSettings.tsx
git commit -m "feat: add plugins settings entry"
```

## Task 3: Build the full Plugins suite UI in CodeM style

**Files:**
- Create: `src/components/settings/plugins/PluginsSuite.tsx`
- Create: `src/components/settings/plugins/InstalledPluginsPanel.tsx`
- Create: `src/components/settings/plugins/DiscoverPluginsPanel.tsx`
- Create: `src/components/settings/plugins/MarketplacesPanel.tsx`
- Create: `src/components/settings/plugins/SkillsPanel.tsx`
- Modify: `src/components/settings/PluginsSettings.tsx`
- Modify: `src/styles.css`
- Test: existing settings UI tests or new `tests/plugins-settings.test.tsx`

- [ ] **Step 1: Write the failing UI test**

```tsx
render(<PluginsSettingsSection />);
expect(screen.getByText('Plugins')).toBeInTheDocument();
expect(screen.getByText('Skills')).toBeInTheDocument();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/plugins-settings.test.tsx`
Expected: fail because the suite has not been built yet.

- [ ] **Step 3: Implement the suite shell and panels**

```tsx
export function PluginsSettingsSection() {
  return <PluginsSuite />;
}
```

Use CodeM's existing settings panel classes and CodeM's spacing/typography rather than copying styling or component structure from another implementation.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/plugins-settings.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/PluginsSettings.tsx src/components/settings/plugins src/styles.css
git commit -m "feat: add plugins management ui"
```

## Task 4: Wire plugin/skill refresh into app state

**Files:**
- Create or modify: `src/lib/plugins.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/Composer.tsx`
- Modify: `src/components/SearchPalette.tsx`
- Modify: `src/lib/slashCommands.ts`
- Test: existing composer and skill exposure tests

- [ ] **Step 1: Write the failing refresh test**

```ts
import { loadInstalledSkills } from './plugins.js';

test('refreshing installed skills updates the visible skill list', async () => {
  const skills = await loadInstalledSkills();
  expect(Array.isArray(skills)).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/useSlashCommands.test.ts`
Expected: fail until the frontend refresh path exists.

- [ ] **Step 3: Hook the plugin refresh into the app**

Refresh the visible skill list and related command exposure after install/uninstall/import operations so the composer and search surfaces see the updated state without a full restart.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/useSlashCommands.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/Composer.tsx src/components/SearchPalette.tsx src/lib/plugins.ts src/lib/slashCommands.ts
git commit -m "feat: refresh codem features after plugin changes"
```

## Task 5: Verify web and desktop behavior

**Files:**
- Modify: `package.json` only if a script needs to be added for verification
- Modify: `src-tauri/tauri.conf.json` only if packaging needs a resource change
- Test: `npm run typecheck`
- Test: `npm test`
- Test: `npm run build`
- Test: `npm run desktop:build`

- [ ] **Step 1: Run the typecheck and test suite**

Run:
```bash
npm run typecheck
npm test
```
Expected: no type or test regressions from the plugin migration.

- [ ] **Step 2: Run the production builds**

Run:
```bash
npm run build
npm run desktop:build
```
Expected: both complete successfully and generate updated web and desktop artifacts.

- [ ] **Step 3: Commit**

```bash
git add package.json src-tauri/tauri.conf.json src/App.tsx src/components/settings src/components src/lib server/lib server/index.ts src-tauri/src
git commit -m "feat: ship claude plugin suite in codem"
```


