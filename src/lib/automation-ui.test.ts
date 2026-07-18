import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../components/SidebarProjects.tsx', import.meta.url), 'utf8');
const centerSource = readFileSync(new URL('../components/AutomationCenter.tsx', import.meta.url), 'utf8');
const hookSource = readFileSync(new URL('../hooks/useAutomations.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('automation is a first-class app location wired from the sidebar', () => {
  assert.match(appSource, /\| \{ kind: 'automation' \}/);
  assert.match(appSource, /<AutomationCenter/);
  assert.match(appSource, /onOpenAutomations=\{openAutomations\}/);
  assert.match(sidebarSource, /onClick=\{onOpenAutomations\}/);
  assert.match(sidebarSource, /automationsActive \? 'active' : ''/);
});

test('automation execution creates background threads and reuses both agent run paths', () => {
  assert.match(hookSource, /activate: false/);
  assert.match(hookSource, /submitClaudePrompt\(thread, automation\.prompt/);
  assert.match(hookSource, /submitAgentPrompt\(thread, automation\.prompt/);
  assert.match(hookSource, /claimScheduledAutomation/);
  assert.match(hookSource, /AutomationRequestError && claimError\.status === 409/);
});

test('automation scheduler uses one recursive timeout and clears it on unmount', () => {
  assert.match(hookSource, /AUTOMATION_POLL_INTERVAL_MS = 30_000/);
  assert.match(hookSource, /window\.setTimeout/);
  assert.match(hookSource, /window\.clearTimeout/);
  assert.doesNotMatch(hookSource, /setInterval/);
  assert.match(hookSource, /claimDueRef\.current\(\)/);
});

test('automation editor uses custom menus and shared theme tokens', () => {
  assert.doesNotMatch(centerSource, /<select\b/);
  assert.match(centerSource, /PopoverPortal/);
  assert.match(centerSource, /settings-select-menu automation-select-menu/);
  assert.match(centerSource, /AgentProviderIcon/);
  assert.match(stylesSource, /\.automation-center[\s\S]*var\(--app-bg\)/);
  assert.match(stylesSource, /\.automation-primary-button[\s\S]*var\(--accent\)/);
  assert.match(
    stylesSource,
    /\.automation-list-item\.active\s*\{[\s\S]*var\(--app-border-strong\)[\s\S]*var\(--app-surface-muted\)/,
  );
  assert.doesNotMatch(stylesSource, /\.automation-list-item\.active\s*\{[^}]*var\(--app-selected\)/);
});

test('automation list exposes an independent confirmed delete action', () => {
  assert.match(centerSource, /automation-list-item-row/);
  assert.match(centerSource, /className="automation-list-delete"/);
  assert.match(centerSource, /aria-label=\{`删除自动化：\$\{automation\.name\}`\}/);
  assert.match(centerSource, /event\.stopPropagation\(\)/);
  assert.match(centerSource, /window\.confirm\(`确定删除自动化/);
  assert.match(stylesSource, /\.automation-list-delete\s*\{[\s\S]*var\(--app-danger\)/);
});

test('automation list previews project context and the next execution', () => {
  assert.match(centerSource, /projectById/);
  assert.match(centerSource, /automation-list-project/);
  assert.match(centerSource, /automation-list-path/);
  assert.match(centerSource, /automation-list-next-run/);
  assert.match(centerSource, /formatAutomationNextRun\(automation\.nextRunAtMs\)/);
  assert.match(stylesSource, /grid-template-columns: minmax\(278px, 350px\)/);
});

test('automation editor exposes one-time custom schedule without a decorative calendar action', () => {
  assert.match(centerSource, /value: 'custom', label: '自定义'/);
  assert.match(centerSource, /type="date"/);
  assert.match(centerSource, /defaultCustomAutomationDate/);
  assert.doesNotMatch(centerSource, /CalendarClock/);
  assert.match(hookSource, /automation\.schedule\.kind === 'custom'[\s\S]*\? undefined/);
});

test('automation terminal notices update completed, failed, and waiting states', () => {
  assert.match(hookSource, /notice\.kind === 'approval'[\s\S]*'waiting'/);
  assert.match(hookSource, /notice\.kind === 'completed'[\s\S]*'completed'/);
  assert.match(hookSource, /markRun\(run, status/);
});

test('custom schedules are validated before saving', () => {
  assert.match(centerSource, /const scheduleError = automationScheduleError\(draft\.schedule\)/);
  assert.match(centerSource, /&& !scheduleError/);
  assert.match(centerSource, /className="automation-field-hint error"/);
  assert.match(centerSource, /\{scheduleError\}/);
});
