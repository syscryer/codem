import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { APP_UPDATE_CHECK_INTERVAL_MS } from '../constants.js';
import {
  defaultAgentRuntimeSettings,
  defaultGeneralSettings,
  normalizeAgentRuntimeSettings,
  normalizeGeneralSettings,
} from './settings-api.js';

test('normalizeAgentRuntimeSettings defaults to Claude Code and preserves supported providers', () => {
  assert.equal(normalizeAgentRuntimeSettings({}).defaultProviderId, 'claude-code');
  assert.equal(defaultAgentRuntimeSettings.defaultProviderId, 'claude-code');
  assert.equal(normalizeAgentRuntimeSettings({ defaultProviderId: 'claude-code' }).defaultProviderId, 'claude-code');
  assert.equal(normalizeAgentRuntimeSettings({ defaultProviderId: 'grok-build' }).defaultProviderId, 'grok-build');
  assert.equal(normalizeAgentRuntimeSettings({ defaultProviderId: 'openai-codex' }).defaultProviderId, 'openai-codex');
  assert.equal(normalizeAgentRuntimeSettings({ defaultProviderId: 'opencode' }).defaultProviderId, 'opencode');
  assert.equal(normalizeAgentRuntimeSettings({ defaultProviderId: 'unknown-provider' }).defaultProviderId, 'claude-code');
  assert.deepEqual(
    normalizeAgentRuntimeSettings({ experimentalAgentRunEnabled: false, defaultProviderId: 'opencode' }),
    { defaultProviderId: 'opencode' },
  );
});

test('normalizeGeneralSettings enables thread system notifications by default for old settings', () => {
  assert.equal(
    normalizeGeneralSettings({}).enableThreadSystemNotifications,
    true,
  );
  assert.equal(defaultGeneralSettings.enableThreadSystemNotifications, true);
});

test('normalizeGeneralSettings preserves an explicit thread system notification choice', () => {
  assert.equal(
    normalizeGeneralSettings({ enableThreadSystemNotifications: false }).enableThreadSystemNotifications,
    false,
  );
  assert.equal(
    normalizeGeneralSettings({ enableThreadSystemNotifications: true }).enableThreadSystemNotifications,
    true,
  );
});

test('normalizeGeneralSettings disables automatic queued prompt guide by default', () => {
  assert.equal(normalizeGeneralSettings({}).autoGuideQueuedPrompts, false);
  assert.equal(defaultGeneralSettings.autoGuideQueuedPrompts, false);
});

test('normalizeGeneralSettings preserves automatic queued prompt guide choice', () => {
  assert.equal(normalizeGeneralSettings({ autoGuideQueuedPrompts: true }).autoGuideQueuedPrompts, true);
  assert.equal(normalizeGeneralSettings({ autoGuideQueuedPrompts: false }).autoGuideQueuedPrompts, false);
});

test('normalizeGeneralSettings enables automatic app update checks by default', () => {
  assert.equal(normalizeGeneralSettings({}).autoCheckAppUpdate, true);
  assert.equal(defaultGeneralSettings.autoCheckAppUpdate, true);
});

test('normalizeGeneralSettings preserves explicit automatic app update choice', () => {
  assert.equal(normalizeGeneralSettings({ autoCheckAppUpdate: false }).autoCheckAppUpdate, false);
  assert.equal(normalizeGeneralSettings({ autoCheckAppUpdate: true }).autoCheckAppUpdate, true);
});

test('app checks updates at a low-frequency interval and exposes a direct top-right action', () => {
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const menubarSource = readFileSync(new URL('../components/AppMenubar.tsx', import.meta.url), 'utf8');
  const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const periodicCheckSource = appSource.match(
    /useEffect\(\(\) => \{\s+if \(settingsLoading \|\| !general\.autoCheckAppUpdate\)[\s\S]*?\}, \[general\.autoCheckAppUpdate, settingsLoading\]\);/,
  )?.[0];

  assert.equal(APP_UPDATE_CHECK_INTERVAL_MS, 7_200_000);
  assert.ok(periodicCheckSource);
  assert.match(appSource, /general\.autoCheckAppUpdate/);
  assert.match(periodicCheckSource, /checkForAppUpdate\(\{ silent: true \}\)/);
  assert.match(periodicCheckSource, /window\.setTimeout\([\s\S]*?APP_UPDATE_CHECK_INTERVAL_MS/);
  assert.match(periodicCheckSource, /window\.clearTimeout\(nextCheckTimer\)/);
  assert.match(periodicCheckSource, /activeUpdate !== null && activeUpdate\.phase !== 'failed'/);
  assert.match(periodicCheckSource, /updateBecameActive[\s\S]*?result\?\.update\?\.close\(\)/);
  assert.doesNotMatch(periodicCheckSource, /window\.setInterval\(/);
  assert.match(appSource, /phase: 'available'/);
  assert.match(appSource, /downloadAppUpdate\(update,/);
  assert.match(appSource, /phase: 'downloaded'/);
  assert.match(appSource, /installDownloadedAppUpdate\(update,/);
  assert.match(appSource, /releaseNotes: appUpdateRuntime\.info\.message/);
  assert.match(appSource, /releaseDate: appUpdateRuntime\.info\.date/);
  assert.match(menubarSource, /className={`title-update-pill \$\{appUpdateNotice\.phase\}`}/);
  assert.doesNotMatch(menubarSource, /<span>\{formatUpdatePillLabel\(appUpdateNotice\.phase\)\}<\/span>/);
  assert.match(menubarSource, /onMouseEnter=\{openUpdateCard\}/);
  assert.match(menubarSource, /appUpdateNotice\.onAction\(\)/);
  assert.match(menubarSource, /v\$\{appUpdateNotice\.version\} 更新日志/);
  assert.match(stylesSource, /\.title-update-pill/);
  assert.match(stylesSource, /\.title-update-pill\s*\{[^}]*width:\s*28px;[^}]*background:\s*color-mix\([^;]*var\(--accent/s);
  assert.match(stylesSource, /\.title-update-pill::after\s*\{[^}]*width:\s*5px;[^}]*height:\s*5px;[^}]*background:\s*var\(--accent/s);
  assert.match(stylesSource, /\.title-update-pill\.failed::after\s*\{[^}]*background:\s*var\(--danger/s);
  assert.doesNotMatch(stylesSource, /\.title-update-pill\s*\{[^}]*box-shadow:\s*0\s+5px\s+14px/s);
  assert.match(stylesSource, /\.app-update-popover/);
});

test('normalizeGeneralSettings keeps intermediate process expansion off by default', () => {
  assert.equal(normalizeGeneralSettings({}).collapseIntermediateProcess, false);
  assert.equal(defaultGeneralSettings.collapseIntermediateProcess, false);
});

test('normalizeGeneralSettings preserves explicit intermediate process collapse choice', () => {
  assert.equal(normalizeGeneralSettings({ collapseIntermediateProcess: true }).collapseIntermediateProcess, true);
  assert.equal(normalizeGeneralSettings({ collapseIntermediateProcess: false }).collapseIntermediateProcess, false);
});
