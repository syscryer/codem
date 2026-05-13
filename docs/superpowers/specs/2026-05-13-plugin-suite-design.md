# CodeM Plugin Suite Integration Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Claudinal's full plugin management experience into CodeM under the existing Settings area, while keeping CodeM's visual system and app architecture.

**Architecture:** CodeM will keep its Node/Express bridge and Tauri desktop shell, but expand the backend with a first-class plugin service that reads Claude Code plugin/skill files from disk and shells out to `claude plugin` / skill installers when mutating state. The frontend will replace the current read-only Skills settings with a unified Plugins settings page that mirrors Claudinal's information architecture: Plugins and Skills tabs, with installed/discover/marketplaces subviews inside Plugins.

**Tech Stack:** React 19, TypeScript, Vite, Node.js, Express, Tauri 2, local filesystem IO, `claude` CLI.

---

### Task 1: Backend plugin service

**Files:**
- Create: `server/lib/plugins.ts`
- Modify: `server/index.ts`
- Modify: `server/lib/slash-commands.ts`
- Modify: `server/lib/skills-scanner.ts` or existing skill scan helpers if needed
- Test: `server/lib/plugins.test.ts`
- Test: update existing backend tests that depend on skills or plugin discovery

- [ ] **Step 1: Write the failing test**

```ts
import { listInstalledPlugins, listMarketplaces, listSkills, installSkillFromPath } from './plugins.js';

test('lists installed plugins, marketplaces, and skills from Claude paths', async () => {
  const installed = await listInstalledPlugins();
  const marketplaces = await listMarketplaces();
  const skills = await listSkills(null);

  expect(Array.isArray(installed)).toBe(true);
  expect(Array.isArray(marketplaces)).toBe(true);
  expect(Array.isArray(skills)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- server/lib/plugins.test.ts`
Expected: fail because `server/lib/plugins.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export async function listInstalledPlugins() { return []; }
export async function listMarketplaces() { return []; }
export async function listSkills(_cwd: string | null) { return []; }
export async function installSkillFromPath(_args: unknown) { return { installed: [] }; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- server/lib/plugins.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/plugins.ts server/lib/plugins.test.ts server/index.ts server/lib/slash-commands.ts
git commit -m "feat: add plugin backend service"
```

### Task 2: Settings navigation and page shell

**Files:**
- Modify: `src/components/settings/SettingsSidebar.tsx`
- Modify: `src/components/settings/SettingsView.tsx`
- Modify: `src/components/settings/SkillsSettings.tsx`
- Create: `src/components/settings/PluginsSettings.tsx`
- Modify: `src/types.ts`
- Test: `tests/settings-navigation.test.ts` or existing settings view tests

- [ ] **Step 1: Write the failing test**

```ts
import { renderSettingsSections } from './settings-test-helpers.js';

test('Settings exposes Plugins and nests Skills inside the new plugin suite', () => {
  const sections = renderSettingsSections();
  expect(sections).toContain('Plugins');
  expect(sections).not.toContain('Skills');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/settings-navigation.test.ts`
Expected: fail until the new section exists.

- [ ] **Step 3: Write minimal implementation**

```tsx
export function PluginsSettingsSection() {
  return <div>Plugins</div>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/settings-navigation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/SettingsSidebar.tsx src/components/settings/SettingsView.tsx src/components/settings/SkillsSettings.tsx src/components/settings/PluginsSettings.tsx src/types.ts
git commit -m "feat: add plugins settings entry"
```

### Task 3: Plugins settings UI

**Files:**
- Create: `src/components/settings/plugins/PluginsSuite.tsx`
- Create: `src/components/settings/plugins/InstalledPluginsPanel.tsx`
- Create: `src/components/settings/plugins/DiscoverPluginsPanel.tsx`
- Create: `src/components/settings/plugins/MarketplacesPanel.tsx`
- Create: `src/components/settings/plugins/SkillsPanel.tsx`
- Modify: `src/components/settings/PluginsSettings.tsx`
- Modify: `src/styles.css`
- Test: `tests/plugins-settings.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
render(<PluginsSettingsSection />);
expect(screen.getByText('Plugins')).toBeInTheDocument();
expect(screen.getByText('Skills')).toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/plugins-settings.test.tsx`
Expected: fail because the suite does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```tsx
export function PluginsSettingsSection() {
  return <PluginsSuite />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/plugins-settings.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/PluginsSettings.tsx src/components/settings/plugins src/styles.css
git commit -m "feat: add plugins management ui"
```

### Task 4: App integration and refresh hooks

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/lib/plugins.ts` or equivalent client API layer
- Modify: `src/lib/slashCommands.ts`
- Modify: `src/components/Composer.tsx`
- Modify: `src/components/SearchPalette.tsx`
- Test: existing composer and slash command tests

- [ ] **Step 1: Write the failing test**

```ts
import { slashCommandsFromSkills } from './slashCommands.js';

test('plugin skill refresh updates slash command exposure', () => {
  const commands = slashCommandsFromSkills([{ name: 'playwright-cli', user_invocable: true }]);
  expect(commands).toContain('playwright-cli');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/slashCommands.test.ts`
Expected: fail until skill refresh is wired into the app flow.

- [ ] **Step 3: Write minimal implementation**

```ts
export function refreshInstalledSkills() {
  return Promise.resolve();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/slashCommands.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/lib/plugins.ts src/lib/slashCommands.ts src/components/Composer.tsx src/components/SearchPalette.tsx
git commit -m "feat: refresh codem features after plugin changes"
```

### Task 5: Desktop and build verification

**Files:**
- Modify: `package.json` if scripts need adjustment
- Modify: `src-tauri/tauri.conf.json` only if plugin resources need bundling changes
- Test: `npm run typecheck`
- Test: `npm test`
- Test: `npm run build`
- Test: `npm run desktop:build`

- [ ] **Step 1: Run the failing/targeted checks first**

Run:
```bash
npm run typecheck
npm test
```
Expected: no type or test regressions from the plugin migration.

- [ ] **Step 2: Run the production build**

Run:
```bash
npm run build
npm run desktop:build
```
Expected: both complete successfully and generate the desktop bundle.

- [ ] **Step 3: Commit**

```bash
git add package.json src-tauri/tauri.conf.json src/App.tsx src/components/settings src/lib src-tauri/src
git commit -m "feat: ship claude plugin suite in codeM"
```
