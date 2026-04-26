# CodeM Settings System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build CodeM's permanent settings view foundation and ship the first usable Appearance section.

**Architecture:** Settings are an application-level view, not a modal. User preference data is stored in a local JSON settings file under the existing CodeM app data directory and exposed through backend APIs; the frontend applies appearance values through a settings hook and CSS variables. MCP and Skills are intentionally left as navigable placeholder sections in this plan because they are independent resource-management subsystems and should be implemented from separate plans using `D:\project\cc-switch` as reference.

**Tech Stack:** React 19, TypeScript strict mode, Vite, Express 5, Node.js fs APIs, existing CodeM CSS.

---

## File Structure

- Create: `server/lib/settings-store.ts`
  - Owns app settings defaults, normalization, local JSON file reads, and atomic writes.
- Modify: `server/index.ts`
  - Adds settings API routes.
- Modify: `src/types.ts`
  - Adds settings types shared by frontend state and API responses.
- Create: `src/lib/settings-api.ts`
  - Thin frontend fetch wrapper for settings APIs.
- Create: `src/hooks/useAppSettings.ts`
  - Loads settings, exposes appearance update function, applies defaults when loading fails.
- Create: `src/components/settings/SettingsView.tsx`
  - Top-level settings view shell with sidebar navigation and content area.
- Create: `src/components/settings/SettingsSidebar.tsx`
  - Settings section navigation with final category list.
- Create: `src/components/settings/AppearanceSettings.tsx`
  - Appearance page, preview, and controls.
- Create: `src/components/settings/SettingsEmptySection.tsx`
  - Placeholder for categories not implemented in this first delivery.
- Modify: `src/components/SidebarProjects.tsx`
  - Wires the existing bottom Settings button to open settings.
- Modify: `src/App.tsx`
  - Adds app view state, settings hook, settings view render path, and root appearance attributes.
- Modify: `src/styles.css`
  - Adds settings page styles and CSS variables for appearance application.
- Modify: `.trellis/tasks/settings-appearance.md`
  - Mark plan creation complete and note MCP/Skills follow-up references.

## Scope Boundary

This plan implements:

- Settings entry and return behavior.
- Final settings section list:
  - 基础设置
  - 外观
  - 快捷键
  - 供应商管理
  - 使用情况
  - 会话管理
  - MCP 管理
  - Skills
  - 全局提示词
  - 打开方式
- A fully functional Appearance section:
  - Theme mode
  - Density
  - UI font size
  - Code font size
  - Sidebar width
- Local file persistence through backend APIs.
- Typecheck, build, and browser verification.

This plan does not implement full MCP, Skills, Providers, or shortcut editing. Those sections remain navigable placeholders. MCP and Skills should later follow `D:\project\cc-switch`:

- MCP: `D:\project\cc-switch\src\lib\api\mcp.ts`, `D:\project\cc-switch\src\lib\schemas\mcp.ts`, `D:\project\cc-switch\src\components\mcp\UnifiedMcpPanel.tsx`
- Skills: `D:\project\cc-switch\src\lib\api\skills.ts`, `D:\project\cc-switch\src\components\skills\UnifiedSkillsPanel.tsx`, `D:\project\cc-switch\src\components\skills\SkillsPage.tsx`

---

### Task 1: Settings Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add shared settings types**

Append these types after the existing permission/runtime type block, before project/thread summary types:

```ts
export type SettingsSection =
  | 'basic'
  | 'appearance'
  | 'shortcuts'
  | 'providers'
  | 'usage'
  | 'sessions'
  | 'mcp'
  | 'skills'
  | 'globalPrompts'
  | 'openWith';

export type ThemeMode = 'system' | 'light' | 'dark';
export type InterfaceDensity = 'comfortable' | 'compact';
export type SidebarWidthMode = 'narrow' | 'default' | 'wide';

export type AppearanceSettings = {
  themeMode: ThemeMode;
  density: InterfaceDensity;
  uiFontSize: 12 | 13 | 14 | 15;
  codeFontSize: 12 | 13 | 14;
  sidebarWidth: SidebarWidthMode;
};

export type AppSettings = {
  appearance: AppearanceSettings;
};
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS, because no code consumes these types yet.

- [ ] **Step 3: Commit**

```powershell
git add src/types.ts
git commit -m "添加应用设置类型"
```

---

### Task 2: Backend Settings Store

**Files:**
- Create: `server/lib/settings-store.ts`

- [ ] **Step 1: Create the settings store**

Create `server/lib/settings-store.ts` with this content:

```ts
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import type { AppSettings, AppearanceSettings } from '../../src/types.js';

const SETTINGS_FILE_NAME = 'settings.json';

export const defaultAppearanceSettings: AppearanceSettings = {
  themeMode: 'system',
  density: 'comfortable',
  uiFontSize: 13,
  codeFontSize: 12,
  sidebarWidth: 'default',
};

export const defaultAppSettings: AppSettings = {
  appearance: defaultAppearanceSettings,
};

const appDirectory = resolveAppDirectory();
const settingsPath = path.join(appDirectory, SETTINGS_FILE_NAME);

export function getAppSettings(): AppSettings {
  const raw = readSettingsFile();
  return normalizeAppSettings(raw);
}

export function updateAppearanceSettings(nextAppearance: unknown): AppSettings {
  const current = getAppSettings();
  const next = normalizeAppSettings({
    ...current,
    appearance: nextAppearance,
  });
  writeSettingsFile(next);
  return next;
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const record = isRecord(value) ? value : {};
  return {
    appearance: normalizeAppearanceSettings(record.appearance),
  };
}

function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  const record = isRecord(value) ? value : {};
  return {
    themeMode: normalizeEnum(record.themeMode, ['system', 'light', 'dark'], defaultAppearanceSettings.themeMode),
    density: normalizeEnum(record.density, ['comfortable', 'compact'], defaultAppearanceSettings.density),
    uiFontSize: normalizeNumber(record.uiFontSize, [12, 13, 14, 15], defaultAppearanceSettings.uiFontSize),
    codeFontSize: normalizeNumber(record.codeFontSize, [12, 13, 14], defaultAppearanceSettings.codeFontSize),
    sidebarWidth: normalizeEnum(record.sidebarWidth, ['narrow', 'default', 'wide'], defaultAppearanceSettings.sidebarWidth),
  };
}

function readSettingsFile(): unknown {
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown;
  } catch {
    return defaultAppSettings;
  }
}

function writeSettingsFile(settings: AppSettings) {
  mkdirSync(appDirectory, { recursive: true });
  const temporaryPath = `${settingsPath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, settingsPath);
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeNumber<T extends number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'number' && allowed.includes(value as T) ? (value as T) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveAppDirectory() {
  const baseDirectory =
    process.env.LOCALAPPDATA ||
    process.env.APPDATA ||
    path.join(homedir(), 'AppData', 'Local');
  const directory = path.join(baseDirectory, 'CodeM');
  mkdirSync(directory, { recursive: true });
  return directory;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS. If TypeScript rejects importing frontend types from `server`, move the types to a shared file already accepted by the project or duplicate only the backend shape locally and keep response JSON compatible.

- [ ] **Step 3: Commit**

```powershell
git add server/lib/settings-store.ts
git commit -m "添加本地设置文件存储"
```

---

### Task 3: Settings API Routes

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Import settings store functions**

Add this import near the other server lib imports:

```ts
import {
  getAppSettings,
  updateAppearanceSettings,
} from './lib/settings-store.js';
```

- [ ] **Step 2: Add routes after `/api/claude/models`**

Add:

```ts
app.get('/api/settings', (_request, response) => {
  response.json(getAppSettings());
});

app.put('/api/settings/appearance', (request, response) => {
  response.json(updateAppearanceSettings(request.body));
});
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 4: Manual API smoke test**

Start the app if needed:

```powershell
npm run dev
```

In a second terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/settings
```

Expected: JSON contains `appearance.themeMode`, `density`, `uiFontSize`, `codeFontSize`, and `sidebarWidth`.

- [ ] **Step 5: Commit**

```powershell
git add server/index.ts
git commit -m "添加设置接口"
```

---

### Task 4: Frontend Settings API And Hook

**Files:**
- Create: `src/lib/settings-api.ts`
- Create: `src/hooks/useAppSettings.ts`

- [ ] **Step 1: Create frontend API wrapper**

Create `src/lib/settings-api.ts`:

```ts
import type { AppSettings, AppearanceSettings } from '../types';

export async function fetchAppSettings(): Promise<AppSettings> {
  const response = await fetch('/api/settings');
  if (!response.ok) {
    throw new Error('读取设置失败');
  }
  return (await response.json()) as AppSettings;
}

export async function saveAppearanceSettings(appearance: AppearanceSettings): Promise<AppSettings> {
  const response = await fetch('/api/settings/appearance', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(appearance),
  });
  if (!response.ok) {
    throw new Error('保存外观设置失败');
  }
  return (await response.json()) as AppSettings;
}
```

- [ ] **Step 2: Create settings hook**

Create `src/hooks/useAppSettings.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { fetchAppSettings, saveAppearanceSettings } from '../lib/settings-api';
import type { AppSettings, AppearanceSettings } from '../types';

export const defaultAppearanceSettings: AppearanceSettings = {
  themeMode: 'system',
  density: 'comfortable',
  uiFontSize: 13,
  codeFontSize: 12,
  sidebarWidth: 'default',
};

export const defaultAppSettings: AppSettings = {
  appearance: defaultAppearanceSettings,
};

export function useAppSettings(showToast?: (message: string, tone?: 'info' | 'success' | 'error') => void) {
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loaded = await fetchAppSettings();
        if (active) {
          setSettings(mergeAppSettings(loaded));
        }
      } catch {
        if (active) {
          showToast?.('读取设置失败，已使用默认外观。', 'error');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [showToast]);

  const updateAppearance = useCallback(
    async (nextAppearance: AppearanceSettings) => {
      const merged = mergeAppSettings({ ...settings, appearance: nextAppearance });
      setSettings(merged);
      try {
        const saved = await saveAppearanceSettings(merged.appearance);
        setSettings(mergeAppSettings(saved));
      } catch {
        showToast?.('保存外观设置失败。', 'error');
      }
    },
    [settings, showToast],
  );

  return {
    settings,
    appearance: settings.appearance,
    loading,
    updateAppearance,
  };
}

function mergeAppSettings(value: Partial<AppSettings>): AppSettings {
  return {
    appearance: {
      ...defaultAppearanceSettings,
      ...(value.appearance ?? {}),
    },
  };
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add src/lib/settings-api.ts src/hooks/useAppSettings.ts
git commit -m "添加前端设置状态"
```

---

### Task 5: Settings View Components

**Files:**
- Create: `src/components/settings/SettingsView.tsx`
- Create: `src/components/settings/SettingsSidebar.tsx`
- Create: `src/components/settings/SettingsEmptySection.tsx`

- [ ] **Step 1: Create settings sidebar**

Create `src/components/settings/SettingsSidebar.tsx`:

```tsx
import {
  AppWindow,
  BarChart3,
  Box,
  Braces,
  Command,
  Keyboard,
  MessageSquareText,
  Palette,
  RotateCcw,
  Server,
  Settings,
  Sparkles,
} from 'lucide-react';
import type { SettingsSection } from '../../types';

type SettingsSidebarProps = {
  activeSection: SettingsSection;
  onSelectSection: (section: SettingsSection) => void;
  onReturnWorkspace: () => void;
};

const settingsSections: Array<{ id: SettingsSection; label: string; icon: typeof Settings }> = [
  { id: 'basic', label: '基础设置', icon: Settings },
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'shortcuts', label: '快捷键', icon: Keyboard },
  { id: 'providers', label: '供应商管理', icon: Box },
  { id: 'usage', label: '使用情况', icon: BarChart3 },
  { id: 'sessions', label: '会话管理', icon: MessageSquareText },
  { id: 'mcp', label: 'MCP 管理', icon: Server },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'globalPrompts', label: '全局提示词', icon: Braces },
  { id: 'openWith', label: '打开方式', icon: AppWindow },
];

export function SettingsSidebar({
  activeSection,
  onSelectSection,
  onReturnWorkspace,
}: SettingsSidebarProps) {
  return (
    <aside className="settings-sidebar">
      <button type="button" className="settings-return" onClick={onReturnWorkspace}>
        <RotateCcw size={14} />
        <span>返回工作区</span>
      </button>
      <nav className="settings-nav" aria-label="设置分类">
        {settingsSections.map((section) => {
          const Icon = section.icon;
          return (
            <button
              key={section.id}
              type="button"
              className={`settings-nav-item${activeSection === section.id ? ' active' : ''}`}
              onClick={() => onSelectSection(section.id)}
            >
              <Icon size={14} />
              <span>{section.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Create empty section**

Create `src/components/settings/SettingsEmptySection.tsx`:

```tsx
type SettingsEmptySectionProps = {
  title: string;
};

export function SettingsEmptySection({ title }: SettingsEmptySectionProps) {
  return (
    <section className="settings-page-section">
      <h1>{title}</h1>
      <div className="settings-empty-panel">
        <strong>{title}</strong>
        <span>此分类稍后接入。</span>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Create settings view shell**

Create `src/components/settings/SettingsView.tsx`:

```tsx
import { useMemo } from 'react';
import type { AppearanceSettings, SettingsSection } from '../../types';
import { AppearanceSettingsSection } from './AppearanceSettings';
import { SettingsEmptySection } from './SettingsEmptySection';
import { SettingsSidebar } from './SettingsSidebar';

type SettingsViewProps = {
  activeSection: SettingsSection;
  appearance: AppearanceSettings;
  onSelectSection: (section: SettingsSection) => void;
  onUpdateAppearance: (appearance: AppearanceSettings) => Promise<void>;
  onReturnWorkspace: () => void;
};

const sectionTitles: Record<SettingsSection, string> = {
  basic: '基础设置',
  appearance: '外观',
  shortcuts: '快捷键',
  providers: '供应商管理',
  usage: '使用情况',
  sessions: '会话管理',
  mcp: 'MCP 管理',
  skills: 'Skills',
  globalPrompts: '全局提示词',
  openWith: '打开方式',
};

export function SettingsView({
  activeSection,
  appearance,
  onSelectSection,
  onUpdateAppearance,
  onReturnWorkspace,
}: SettingsViewProps) {
  const content = useMemo(() => {
    if (activeSection === 'appearance') {
      return (
        <AppearanceSettingsSection
          appearance={appearance}
          onUpdateAppearance={onUpdateAppearance}
        />
      );
    }
    return <SettingsEmptySection title={sectionTitles[activeSection]} />;
  }, [activeSection, appearance, onUpdateAppearance]);

  return (
    <main className="settings-view">
      <SettingsSidebar
        activeSection={activeSection}
        onSelectSection={onSelectSection}
        onReturnWorkspace={onReturnWorkspace}
      />
      <div className="settings-content">
        {content}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: FAIL because `AppearanceSettingsSection` does not exist yet. This is the intentional red step.

- [ ] **Step 5: Commit after Task 6, not now**

Do not commit this task alone because it intentionally references the next component.

---

### Task 6: Appearance Section Component

**Files:**
- Create: `src/components/settings/AppearanceSettings.tsx`

- [ ] **Step 1: Create the Appearance section**

Create `src/components/settings/AppearanceSettings.tsx`:

```tsx
import { Code2, Columns3, Moon, Monitor, Rows3, Sun, Type } from 'lucide-react';
import type { AppearanceSettings, InterfaceDensity, SidebarWidthMode, ThemeMode } from '../../types';

type AppearanceSettingsSectionProps = {
  appearance: AppearanceSettings;
  onUpdateAppearance: (appearance: AppearanceSettings) => Promise<void>;
};

export function AppearanceSettingsSection({
  appearance,
  onUpdateAppearance,
}: AppearanceSettingsSectionProps) {
  function update(next: Partial<AppearanceSettings>) {
    void onUpdateAppearance({ ...appearance, ...next });
  }

  return (
    <section className="settings-page-section settings-appearance-section">
      <h1>外观</h1>
      <div className="appearance-preview" aria-hidden="true">
        <div className="appearance-preview-sidebar" />
        <div className="appearance-preview-main">
          <div className="appearance-preview-header" />
          <div className="appearance-preview-message" />
          <div className="appearance-preview-message short" />
          <div className="appearance-preview-composer" />
          <div className="appearance-preview-footer" />
        </div>
      </div>

      <div className="settings-panel">
        <SettingsRow icon={Monitor} title="主题" description="选择 CodeM 的明暗显示方式">
          <SegmentedControl<ThemeMode>
            value={appearance.themeMode}
            options={[
              { value: 'system', label: '系统', icon: Monitor },
              { value: 'light', label: '浅色', icon: Sun },
              { value: 'dark', label: '深色', icon: Moon },
            ]}
            onChange={(themeMode) => update({ themeMode })}
          />
        </SettingsRow>
        <SettingsRow icon={Rows3} title="界面密度" description="控制列表、消息和底部状态栏间距">
          <SegmentedControl<InterfaceDensity>
            value={appearance.density}
            options={[
              { value: 'comfortable', label: '舒适' },
              { value: 'compact', label: '紧凑' },
            ]}
            onChange={(density) => update({ density })}
          />
        </SettingsRow>
        <SettingsRow icon={Type} title="UI 字号" description="调整主要界面文字大小">
          <Stepper
            value={appearance.uiFontSize}
            values={[12, 13, 14, 15]}
            onChange={(uiFontSize) => update({ uiFontSize })}
          />
        </SettingsRow>
        <SettingsRow icon={Code2} title="代码字号" description="调整代码块和等宽文本字号">
          <Stepper
            value={appearance.codeFontSize}
            values={[12, 13, 14]}
            onChange={(codeFontSize) => update({ codeFontSize })}
          />
        </SettingsRow>
        <SettingsRow icon={Columns3} title="侧边栏宽度" description="调整项目侧栏宽度">
          <SegmentedControl<SidebarWidthMode>
            value={appearance.sidebarWidth}
            options={[
              { value: 'narrow', label: '窄' },
              { value: 'default', label: '默认' },
              { value: 'wide', label: '宽' },
            ]}
            onChange={(sidebarWidth) => update({ sidebarWidth })}
          />
        </SettingsRow>
      </div>
    </section>
  );
}

type SettingsRowProps = {
  icon: typeof Monitor;
  title: string;
  description: string;
  children: React.ReactNode;
};

function SettingsRow({ icon: Icon, title, description, children }: SettingsRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <Icon size={15} />
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
  icon?: typeof Monitor;
};

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<SegmentedControlOption<T>>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="settings-segmented">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            className={option.value === value ? 'active' : ''}
            onClick={() => onChange(option.value)}
          >
            {Icon ? <Icon size={13} /> : null}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Stepper<T extends number>({
  value,
  values,
  onChange,
}: {
  value: T;
  values: readonly T[];
  onChange: (value: T) => void;
}) {
  const currentIndex = values.indexOf(value);
  const canDecrease = currentIndex > 0;
  const canIncrease = currentIndex >= 0 && currentIndex < values.length - 1;
  return (
    <div className="settings-stepper">
      <button
        type="button"
        disabled={!canDecrease}
        onClick={() => canDecrease && onChange(values[currentIndex - 1])}
        aria-label="减小"
      >
        -
      </button>
      <span>{value}</span>
      <button
        type="button"
        disabled={!canIncrease}
        onClick={() => canIncrease && onChange(values[currentIndex + 1])}
        aria-label="增大"
      >
        +
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS for settings components.

- [ ] **Step 3: Commit**

```powershell
git add src/components/settings
git commit -m "添加设置页面组件"
```

---

### Task 7: Wire Settings View Into App

**Files:**
- Modify: `src/components/SidebarProjects.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add settings button prop**

In `src/components/SidebarProjects.tsx`, add to `SidebarProjectsProps`:

```ts
onOpenSettings: () => void;
```

Add it to the component parameter list and change the footer button:

```tsx
<button type="button" onClick={onOpenSettings}>
  <span><Settings size={14} /></span>
  设置
</button>
```

- [ ] **Step 2: Add app view state**

In `src/App.tsx`, import settings view and hook:

```ts
import { SettingsView } from './components/settings/SettingsView';
import { useAppSettings } from './hooks/useAppSettings';
import type { SettingsSection } from './types';
```

Add state inside `App`:

```ts
const [appView, setAppView] = useState<{ kind: 'workspace' } | { kind: 'settings'; section: SettingsSection }>({
  kind: 'workspace',
});
const {
  appearance,
  updateAppearance,
} = useAppSettings(showToast);
```

Add helpers:

```ts
function openSettings(section: SettingsSection = 'appearance') {
  setAppView({ kind: 'settings', section });
}

function returnWorkspace() {
  setAppView({ kind: 'workspace' });
}
```

- [ ] **Step 3: Render settings view instead of workspace shell**

Wrap the existing main workspace layout so that when `appView.kind === 'settings'`, render:

```tsx
<SettingsView
  activeSection={appView.section}
  appearance={appearance}
  onSelectSection={(section) => setAppView({ kind: 'settings', section })}
  onUpdateAppearance={updateAppearance}
  onReturnWorkspace={returnWorkspace}
/>
```

Pass `onOpenSettings={() => openSettings('appearance')}` into `SidebarProjects`.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: PASS. If `showToast` is not declared before `useAppSettings`, move the `useAppSettings` call after the `workspaceState` destructuring.

- [ ] **Step 5: Commit**

```powershell
git add src/App.tsx src/components/SidebarProjects.tsx
git commit -m "接入设置一级视图"
```

---

### Task 8: Apply Appearance CSS Variables

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add root attributes and inline CSS variables**

In `src/App.tsx`, apply these props to the top-level app container:

```tsx
className="app-shell"
data-theme-mode={appearance.themeMode}
data-density={appearance.density}
data-sidebar-width={appearance.sidebarWidth}
style={{
  '--app-ui-font-size': `${appearance.uiFontSize}px`,
  '--app-code-font-size': `${appearance.codeFontSize}px`,
} as React.CSSProperties}
```

If the root class already has a different name, keep the existing class and add these attributes/style.

- [ ] **Step 2: Add settings and appearance CSS**

Append to `src/styles.css`:

```css
.app-shell {
  font-size: var(--app-ui-font-size, 13px);
}

.app-shell[data-sidebar-width="narrow"] {
  --sidebar-width: 260px;
}

.app-shell[data-sidebar-width="default"] {
  --sidebar-width: 300px;
}

.app-shell[data-sidebar-width="wide"] {
  --sidebar-width: 340px;
}

.app-shell[data-density="compact"] {
  --workspace-footer-height: 18px;
  --workspace-footer-content-height: 16px;
}

.app-shell[data-density="comfortable"] {
  --workspace-footer-height: 20px;
  --workspace-footer-content-height: 18px;
}

code,
pre,
.tool-raw,
.diff-file-name {
  font-size: var(--app-code-font-size, 12px);
}

.settings-view {
  height: 100vh;
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  background: #ffffff;
  color: #242424;
}

.settings-sidebar {
  min-height: 0;
  padding: 8px 6px;
  background: #f4f2f2;
  border-right: 1px solid #ebe7e4;
}

.settings-return,
.settings-nav-item {
  width: 100%;
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #454545;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.settings-return {
  margin-bottom: 8px;
  color: #666;
}

.settings-nav {
  display: grid;
  gap: 2px;
}

.settings-nav-item.active {
  background: #e7e5e4;
  color: #1f1f1f;
}

.settings-content {
  min-width: 0;
  overflow: auto;
  background: #ffffff;
}

.settings-page-section {
  width: min(100% - 48px, 640px);
  margin: 0 auto;
  padding: 88px 0 48px;
}

.settings-page-section > h1 {
  margin: 0 0 28px;
  text-align: center;
  font-size: 18px;
  font-weight: 650;
}

.appearance-preview,
.settings-panel,
.settings-empty-panel {
  border: 1px solid #ececec;
  border-radius: 12px;
  background: #ffffff;
}

.appearance-preview {
  height: 144px;
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  overflow: hidden;
  margin-bottom: 14px;
}

.appearance-preview-sidebar {
  background: #f4f2f2;
  border-right: 1px solid #ececec;
}

.appearance-preview-main {
  display: grid;
  grid-template-rows: 24px 1fr 1fr 30px 18px;
  gap: 8px;
  padding: 10px 12px;
}

.appearance-preview-header,
.appearance-preview-message,
.appearance-preview-composer,
.appearance-preview-footer {
  border-radius: 999px;
  background: #ededed;
}

.appearance-preview-message {
  width: 72%;
}

.appearance-preview-message.short {
  width: 48%;
}

.appearance-preview-composer {
  border-radius: 10px;
  background: #f7f7f7;
  border: 1px solid #e4e4e4;
}

.appearance-preview-footer {
  height: 12px;
  align-self: center;
}

.settings-panel {
  overflow: hidden;
}

.settings-row {
  min-height: 56px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  padding: 8px 12px;
  border-bottom: 1px solid #f0f0f0;
}

.settings-row:last-child {
  border-bottom: 0;
}

.settings-row-label {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.settings-row-label > span {
  display: grid;
  gap: 2px;
}

.settings-row-label strong {
  font-size: 13px;
  font-weight: 600;
}

.settings-row-label small {
  font-size: 12px;
  color: #8a8a8a;
}

.settings-row-control {
  display: flex;
  justify-content: flex-end;
}

.settings-segmented,
.settings-stepper {
  height: 28px;
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border-radius: 8px;
  background: #f3f3f3;
}

.settings-segmented button,
.settings-stepper button {
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #555;
  cursor: pointer;
}

.settings-segmented button {
  min-width: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 8px;
  font-size: 12px;
}

.settings-segmented button.active {
  background: #ffffff;
  color: #202020;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.settings-stepper {
  gap: 4px;
}

.settings-stepper button {
  width: 24px;
  font-size: 14px;
}

.settings-stepper button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.settings-stepper span {
  width: 28px;
  text-align: center;
  font-size: 12px;
}

.settings-empty-panel {
  display: grid;
  gap: 6px;
  padding: 18px;
  color: #737373;
}

.settings-empty-panel strong {
  color: #333;
}
```

- [ ] **Step 3: Ensure sidebar width uses variable**

Find the app layout CSS rule that defines the sidebar column width and replace the fixed value with:

```css
grid-template-columns: var(--sidebar-width, 300px) minmax(0, 1fr);
```

- [ ] **Step 4: Run typecheck and build**

Run:

```powershell
npm run typecheck
npm run build
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/App.tsx src/styles.css
git commit -m "应用外观设置样式"
```

---

### Task 9: Settings Task Document Update

**Files:**
- Modify: `.trellis/tasks/settings-appearance.md`

- [ ] **Step 1: Mark Superpowers plan creation**

In `.trellis/tasks/settings-appearance.md`, add this under `Stage 1. Task And Contract`:

```md
- [x] 建立 Superpowers 执行计划：`docs/superpowers/plans/2026-04-26-settings-system-plan.md`。
- [x] 明确 MCP / Skills 不在第一版实现，后续参考 `D:\project\cc-switch` 单独规划。
```

- [ ] **Step 2: Run status check**

Run: `git status --short`

Expected: only planned docs and code files from the current implementation are modified.

- [ ] **Step 3: Commit**

```powershell
git add .trellis/tasks/settings-appearance.md docs/superpowers/plans/2026-04-26-settings-system-plan.md
git commit -m "补充设置系统执行计划"
```

---

### Task 10: Browser Verification

**Files:**
- No source file changes expected unless verification reveals bugs.

- [ ] **Step 1: Start or reuse dev server**

Run:

```powershell
npm run dev
```

Expected: server and Vite are running; current in-app browser can open `http://127.0.0.1:5173/`.

- [ ] **Step 2: Verify settings entry**

In browser:

1. Click left footer `设置`.
2. Confirm settings page opens as a full view.
3. Confirm left sidebar includes all final categories.
4. Confirm `外观` is selected by default.

Expected: no modal overlay, no project/thread reset.

- [ ] **Step 3: Verify appearance controls**

In browser:

1. Change `主题`.
2. Change `界面密度`.
3. Change `UI 字号`.
4. Change `代码字号`.
5. Change `侧边栏宽度`.

Expected:

- Controls stay visually aligned.
- UI updates immediately.
- No text overlaps.
- Footer height changes only with density.

- [ ] **Step 4: Verify persistence**

In browser:

1. Set `UI 字号` to `15`.
2. Refresh page.
3. Confirm `UI 字号` still shows `15`.
4. Restart dev server.
5. Confirm `UI 字号` still shows `15`.

Expected: settings persist through refresh and restart.

- [ ] **Step 5: Verify return path**

Click `返回工作区`.

Expected:

- Workspace view returns.
- Previously selected project/thread remains selected.
- Running state and visible conversation are not cleared.

- [ ] **Step 6: Final status**

Run:

```powershell
git status --short
```

Expected: no uncommitted source changes except local `.codex-*` runtime logs if dev server is active.

---

## Self-Review

Spec coverage:

- Settings entry: Task 7.
- Final category list: Task 5.
- Appearance section: Task 6.
- Local JSON persistence: Tasks 2 and 3.
- Frontend state: Task 4.
- CSS variable application: Task 8.
- Browser verification: Task 10.

Known deferred subsystems:

- MCP management is deferred to a dedicated plan because it edits external tool configuration and needs validation/import/delete semantics.
- Skills management is deferred to a dedicated plan because it installs/uninstalls files and needs backup/restore semantics.
- Full provider management is deferred because it can involve credentials and should be designed with explicit sensitive-data handling.

No placeholder implementation is allowed inside the shipped Appearance section. Placeholder UI is only allowed for non-Appearance categories and must be explicit user-facing empty state.
