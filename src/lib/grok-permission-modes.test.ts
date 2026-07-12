import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { permissionMenuModes } from '../constants.js';
import { isVisiblePermissionMode } from './conversation.js';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const composerSource = readFileSync(new URL('../components/Composer.tsx', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../hooks/useWorkspaceState.ts', import.meta.url), 'utf8');
const agentRunSource = readFileSync(new URL('../hooks/useAgentRun.ts', import.meta.url), 'utf8');

test('Grok reuses the three visible CodeM permission modes', () => {
  assert.deepEqual(permissionMenuModes, ['default', 'auto', 'bypassPermissions']);
  assert.equal(isVisiblePermissionMode('default'), true);
  assert.equal(isVisiblePermissionMode('auto'), true);
  assert.equal(isVisiblePermissionMode('bypassPermissions'), true);
  assert.equal(isVisiblePermissionMode('dontAsk'), false);
  assert.equal(isVisiblePermissionMode('unknown'), false);
});

test('Grok permission mode follows thread creation, metadata, and run requests', () => {
  assert.match(workspaceSource, /permissionMode\?: PermissionMode/);
  assert.match(workspaceSource, /\{ permissionMode: options\.permissionMode \}/);
  assert.match(agentRunSource, /permissionMode: runPermissionMode/);
  assert.match(agentRunSource, /permissionMode: context\.permissionMode/);
  assert.match(agentRunSource, /persistThreadMetadata\(activeThreadId, \{ permissionMode: mode \}\)/);
});

test('App keeps Claude and Grok permission state separate', () => {
  assert.match(appSource, /permissionMode: claudePermissionMode/);
  assert.match(appSource, /permissionMode: genericAgentPermissionMode/);
  assert.match(
    appSource,
    /const permissionMode = activeUsesClaude \? claudePermissionMode : genericAgentPermissionMode;/,
  );
  assert.match(
    appSource,
    /activeUsesClaude\s*\? handleClaudePermissionModeSelect\s*:\s*handleGenericAgentPermissionModeSelect/,
  );
});

test('generic Agent permission menu is accessible and locked only while its run is active', () => {
  assert.match(composerSource, /const permissionSelectionDisabled = agent !== 'claude' && isRunning;/);
  assert.match(composerSource, /role="menu" aria-label="权限模式"/);
  assert.match(composerSource, /role="menuitemradio"/);
  assert.match(composerSource, /disabled=\{permissionSelectionDisabled\}/);
  assert.match(composerSource, /完全访问（YOLO）：跳过 \$\{providerName\} 工具权限确认，仅用于可信目录/);
});
