import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dialogSource = await readFile(
  new URL('../components/ExternalProviderImportDialog.tsx', import.meta.url),
  'utf8',
);
const agentChannelSource = await readFile(
  new URL('../components/settings/AgentChannelSettings.tsx', import.meta.url),
  'utf8',
);
const providerTabsSource = await readFile(
  new URL('../components/settings/AgentSettingsProviderTabs.tsx', import.meta.url),
  'utf8',
);
const apiSource = await readFile(new URL('./provider-import-api.ts', import.meta.url), 'utf8');
const settingsSource = await readFile(
  new URL('../components/settings/SettingsView.tsx', import.meta.url),
  'utf8',
);
const settingsSidebarSource = await readFile(
  new URL('../components/settings/SettingsSidebar.tsx', import.meta.url),
  'utf8',
);
const ordinaryProviderSource = await readFile(
  new URL('../components/AiProviderManagerDialog.tsx', import.meta.url),
  'utf8',
);
const stylesSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('external provider import uses isolated Agent and ordinary chat endpoints', () => {
  assert.match(apiSource, /\/api\/provider-import\/agent\/scan/);
  assert.match(apiSource, /\/api\/provider-import\/chat\/scan/);
  assert.match(apiSource, /\/api\/provider-import\/sync/);
  assert.match(apiSource, /\/api\/provider-import\/agent\/copy-to-chat/);
});

test('import dialog supports Agent tabs, search, imported state and explicit sync', () => {
  assert.match(dialogSource, /Claude/);
  assert.match(dialogSource, /OpenAI/);
  assert.match(dialogSource, /OpenCode/);
  assert.match(dialogSource, /搜索渠道、地址或模型/);
  assert.match(dialogSource, /同步更新/);
  assert.match(dialogSource, /确认覆盖并导入/);
  assert.match(dialogSource, /showToast\(`已导入[\s\S]*?onClose\(\);/);
  assert.doesNotMatch(dialogSource, /apiKey\s*:/);
});

test('ordinary chat is a peer channel tab without a duplicate main settings entry', () => {
  assert.match(providerTabsSource, /ordinary-chat/);
  assert.match(providerTabsSource, /普通聊天/);
  assert.match(agentChannelSource, /<AiProviderSettingsPanel\s+channelLayout/);
  assert.match(agentChannelSource, /ordinaryChatActive[\s\S]*?从 Cherry Studio 导入/);
  assert.match(agentChannelSource, /targetKind=\{ordinaryChatActive \? 'ordinary_chat' : 'agent'\}/);
  assert.match(agentChannelSource, /复制到聊天/);
  assert.match(settingsSource, /activeSection === 'aiProviders'/);
  assert.doesNotMatch(settingsSidebarSource, /id: 'aiProviders', label: '普通聊天'/);
});

test('channel import triggers reuse the themed settings action button', () => {
  assert.match(agentChannelSource, /className="settings-action-button agent-channel-import-button"/);
  assert.match(ordinaryProviderSource, /className="settings-action-button ai-provider-import-button"/);
  assert.match(dialogSource, /className="settings-action-button external-provider-import-refresh"/);
  assert.match(agentChannelSource, /className=\{`settings-action-button agent-channel-copy-button/);
  assert.doesNotMatch(agentChannelSource, /className="secondary"[^>]*>\s*<Download[^>]*\/>\s*导入渠道/);
  assert.doesNotMatch(ordinaryProviderSource, /className="secondary"[^>]*>\s*<Download[^>]*\/>\s*从 Cherry Studio 导入/);
  assert.doesNotMatch(dialogSource, /className="secondary external-provider-import-refresh"/);
});

test('provider import dialog adapts to short lists instead of forcing a tall empty body', () => {
  const dialogStyles = stylesSource.match(/\.external-provider-import-dialog\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(dialogStyles, /max-height:\s*min\(720px, calc\(100vh - 48px\)\)/);
  assert.doesNotMatch(dialogStyles, /(?:^|\s)height:\s*min\(720px/);
});
