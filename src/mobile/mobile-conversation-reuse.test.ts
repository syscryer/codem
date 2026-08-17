import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const detailSource = readFileSync(new URL('./pages/TaskDetailPage.tsx', import.meta.url), 'utf8');
const threadHookSource = readFileSync(new URL('./hooks/useMobileThread.ts', import.meta.url), 'utf8');
const workspaceHookSource = readFileSync(new URL('./hooks/useMobileWorkspace.ts', import.meta.url), 'utf8');
const mobileAppSource = readFileSync(new URL('./MobileApp.tsx', import.meta.url), 'utf8');
const mobileStyles = readFileSync(new URL('./mobile.css', import.meta.url), 'utf8');
const prototypeStyles = readFileSync(new URL('./prototype/prototype.css', import.meta.url), 'utf8');
const newTaskSource = readFileSync(new URL('./pages/NewTaskPage.tsx', import.meta.url), 'utf8');
const mobileAgentOptionsSource = readFileSync(new URL('./lib/mobile-agent-options.ts', import.meta.url), 'utf8');
const mobileApiSource = readFileSync(new URL('./lib/mobile-api.ts', import.meta.url), 'utf8');
const mobileActionSheetSource = readFileSync(new URL('./components/MobileActionSheet.tsx', import.meta.url), 'utf8');
const mobileSelectSource = readFileSync(new URL('./components/MobileSelect.tsx', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('./pages/SettingsPage.tsx', import.meta.url), 'utf8');
const prototypeAppSource = readFileSync(new URL('./prototype/MobilePrototypeApp.tsx', import.meta.url), 'utf8');
const appEntrySource = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
const conversationPaneSource = readFileSync(new URL('../components/ConversationPane.tsx', import.meta.url), 'utf8');
const conversationTurnSource = readFileSync(new URL('../components/ConversationTurn.tsx', import.meta.url), 'utf8');

test('mobile conversation reuses desktop conversation components and event reducer', () => {
  assert.match(detailSource, /import \{ ConversationPane \} from '\.\.\/\.\.\/components\/ConversationPane'/);
  assert.match(detailSource, /<ConversationPane/);
  assert.match(threadHookSource, /applyAgentRunEventToTurn/);
  assert.doesNotMatch(detailSource, /ReactMarkdown/);
  assert.doesNotMatch(detailSource, /MobileTimelineItem/);
});

test('mobile conversation keeps remote pagination and desktop scroll mechanism', () => {
  assert.match(detailSource, /hasEarlierTurns=\{thread\.page\?\.hasMore\}/);
  assert.match(detailSource, /onLoadEarlierTurns=\{thread\.loadEarlier\}/);
  assert.match(detailSource, /transcriptRef=\{transcriptRef\}/);
  assert.match(detailSource, /bottomRef=\{bottomRef\}/);
  assert.match(conversationPaneSource, /const remoteHistoryTurnCount = hasEarlierTurns \? activeThread\?\.turns\.length : undefined/);
  assert.match(conversationPaneSource, /\[remoteHistoryTurnCount, visibleTurnCount, transcriptRef\]/);
  assert.doesNotMatch(conversationPaneSource, /\[activeThread\?\.turns\.length, visibleTurnCount, transcriptRef\]/);
});

test('mobile styles reuse desktop conversation rules without changing the desktop entry', () => {
  assert.match(mobileStyles, /^@import '\.\.\/styles\.css';\s*@import '\.\/prototype\/prototype\.css';/);
  assert.match(appEntrySource, /else if \(isMobileRoute\) \{[\s\S]*?await import\('\.\/mobile\/mobile\.css'\);/);
  assert.match(appEntrySource, /installClientIdCompatibility\(\);/);
  assert.match(appEntrySource, /<MobileErrorBoundary><MobileApp \/><\/MobileErrorBoundary>/);
  assert.match(appEntrySource, /else \{\s*await import\('\.\/styles\.css'\);\s*App = \(await import\('\.\/App'\)\)\.default;/);
});

test('mobile composer owns the focus treatment instead of outlining its textarea', () => {
  assert.match(prototypeStyles, /\.prototype-composer:focus-within\s*\{[^}]*border-color:[^}]*box-shadow:/);
  assert.match(prototypeStyles, /#root \.mobile-prototype\.codex-desktop textarea:focus,[\s\S]*?#root \.mobile-prototype\.codex-desktop textarea:focus-visible\s*\{\s*outline: none;\s*box-shadow: none;/);
});

test('mobile form controls use restrained container focus states', () => {
  assert.doesNotMatch(prototypeStyles, /textarea:focus-visible\s*\{[^}]*outline: 3px/);
  assert.match(mobileStyles, /\.mobile-form-field:focus-within\{background:/);
  assert.match(mobileStyles, /\.mobile-prototype\.codex-desktop \.mobile-form-field select:focus,[\s\S]*?box-shadow:none/);
  assert.match(mobileStyles, /\.mobile-new-prompt:focus-within\{[^}]*border-color:[^}]*box-shadow:/);
  assert.match(mobileStyles, /\.mobile-connect-card input:focus,\.mobile-connect-card input:focus-visible\{outline:none/);
  assert.doesNotMatch(newTaskSource, /<textarea autoFocus/);
  assert.match(prototypeStyles, /#root \.mobile-prototype :is\([\s\S]*?\.prototype-task-row,[\s\S]*?\.prototype-tab-bar button[\s\S]*?:focus-visible\s*\{[\s\S]*?box-shadow: inset/);
  assert.match(mobileStyles, /#root \.mobile-conversation-region \.assistant-runtime-textarea:focus,[\s\S]*?box-shadow:/);
});

test('mobile settings and task lists keep the compact grouped layout', () => {
  assert.match(settingsSource, /className="mobile-settings-page"/);
  assert.match(settingsSource, /aria-pressed=\{selected\}/);
  assert.match(settingsSource, /setThemeState\(nextTheme\)/);
  assert.match(mobileStyles, /\.mobile-settings-page\s*\{/);
  assert.match(mobileStyles, /\.mobile-prototype:not\(\.prototype-detail\) \.prototype-safe-shell\s*\{[\s\S]*?width: min\(100%, 600px\)/);
  assert.match(prototypeStyles, /\.prototype-section:has\(\.prototype-task-row\) \.prototype-grouped-list\s*\{[\s\S]*?gap: 8px/);
  assert.doesNotMatch(prototypeStyles, /\.prototype-task-row \+ \.prototype-task-row::before/);
  assert.match(prototypeStyles, /--mobile-prototype-divider-width: 1px/);
  assert.match(mobileStyles, /height: var\(--mobile-prototype-divider-width\)/);
  assert.match(prototypeAppSource, /import '\.\.\/mobile\.css'/);
});

test('mobile new task treats providers without dynamic catalogs as provider-default', () => {
  assert.match(newTaskSource, /supportsDynamicModelCatalog\(providerId\)/);
  assert.match(mobileAgentOptionsSource, /providerId === OPENAI_CODEX_PROVIDER_ID/);
  assert.match(newTaskSource, /channelModelCatalog\(providerId, selectedChannel\.models\)/);
  assert.match(mobileApiSource, /body\?\.error \|\| `请求失败/);
});

test('mobile new task reuses desktop agent configuration sources', () => {
  assert.match(mobileAgentOptionsSource, /CLAUDE_EFFORT_OPTIONS/);
  assert.match(mobileAgentOptionsSource, /permissionMenuModes\.map/);
  assert.match(mobileAgentOptionsSource, /getAgentModelForSelection/);
  assert.match(newTaskSource, /Field label="思考级别"/);
  assert.doesNotMatch(newTaskSource, /\['low', 'medium', 'high'\]/);
  assert.doesNotMatch(newTaskSource, /value: 'acceptEdits'/);
});

test('mobile detail keeps its model catalog stable across equivalent workspace syncs', () => {
  assert.match(detailSource, /const modelCatalogScopeKey = buildModelCatalogScopeKey/);
  assert.match(detailSource, /\}, \[modelCatalogScopeKey\]\);/);
  assert.doesNotMatch(detailSource, /\}, \[bootstrap\?\.channels\.channels, task\?\.channelId, task\?\.providerId\]\);/);
});

test('mobile new task uses an accessible custom bottom-sheet select', () => {
  assert.match(newTaskSource, /import \{ MobileSelect \} from '\.\.\/components\/MobileSelect'/);
  assert.doesNotMatch(newTaskSource, /<select\b/);
  assert.match(mobileSelectSource, /createPortal/);
  assert.match(mobileSelectSource, /role="dialog" aria-modal="true"/);
  assert.match(mobileSelectSource, /role="listbox"/);
  assert.match(mobileSelectSource, /event\.key === 'Escape'/);
  assert.match(mobileSelectSource, /event\.key !== 'Tab'/);
  assert.match(mobileSelectSource, /history\.pushState/);
  assert.match(mobileSelectSource, /window\.addEventListener\('popstate'/);
  assert.match(mobileSelectSource, /triggerRef\.current\?\.focus/);
  assert.doesNotMatch(mobileSelectSource, /\bCheck\b/);
  assert.match(mobileStyles, /\.mobile-select-sheet\{/);
  assert.match(mobileStyles, /\.mobile-select-options button\.selected/);
  assert.match(mobileStyles, /\.mobile-select-backdrop\s*\{\s*align-items:\s*flex-end;/);
  assert.match(mobileStyles, /\.mobile-select-sheet\s*\{[^}]*width:\s*min\(100%, 600px\);[^}]*border-bottom:\s*0;/s);
});

test('mobile new task keeps unavailable Agent choices visible with an explicit reason', () => {
  assert.match(newTaskSource, /function providerOptions/);
  assert.match(newTaskSource, /电脑端未检测到/);
  assert.match(newTaskSource, /disabled: provider\.available !== true \|\| !provider\.selectable/);
  assert.match(newTaskSource, /mobile-form-hint/);
  assert.match(newTaskSource, /defaultAgentChannelId/);
  assert.match(newTaskSource, /channelSelectionProviderRef/);
  assert.match(newTaskSource, /channelStillAvailable/);
});

test('mobile conversation exposes the desktop runtime controls in an isolated mobile layout', () => {
  assert.match(detailSource, /import \{ MobileSelect \} from '\.\.\/components\/MobileSelect'/);
  assert.match(detailSource, /import \{ ComposerContextIndicator \} from '\.\.\/\.\.\/components\/ComposerContextIndicator'/);
  assert.match(detailSource, /import \{ ProviderBrandIcon \} from '\.\.\/\.\.\/components\/ProviderBrandIcon'/);
  assert.match(detailSource, /className="mobile-task-config"/);
  assert.match(detailSource, /className="mobile-task-config-provider(?:\s|\")/);
  assert.match(detailSource, /mobile-task-config-provider-button/);
  assert.match(detailSource, /已有任务的 Agent 在创建后锁定/);
  assert.match(detailSource, /LockKeyhole/);
  assert.match(detailSource, /label=\{running \? '运行中渠道已锁定' : '选择渠道'\}/);
  assert.match(detailSource, /label=\{running \? '运行中模型已锁定' : '选择模型'\}/);
  assert.match(detailSource, /label=\{running \? '运行中权限已锁定' : '选择权限模式'\}/);
  assert.match(detailSource, /label=\{running \? '运行中推理强度已锁定' : '选择推理强度'\}/);
  assert.match(detailSource, /disabled=\{running \|\| busy \|\| !canSend\}/);
  assert.doesNotMatch(detailSource, /className="prototype-model-button" disabled/);
  assert.match(detailSource, /className="mobile-composer-file-input"/);
  assert.match(detailSource, /aria-label="语音输入暂未开放"/);
  assert.match(detailSource, /<ComposerContextIndicator usage=\{contextUsage\}/);
  assert.match(detailSource, /className="mobile-composer-select mobile-composer-model-select"/);
  assert.match(detailSource, /className="mobile-composer-select mobile-composer-reasoning-select"/);
  assert.match(detailSource, /mobile-composer-model-select[\s\S]*mobile-composer-reasoning-select[\s\S]*mobile-composer-context-slot[\s\S]*mobile-voice-disabled[\s\S]*prototype-send-button/);
  assert.doesNotMatch(detailSource, /mobile-task-config-row[\s\S]{0,100}<span>模型<\/span>/);
  assert.doesNotMatch(detailSource, /mobile-task-config-row[\s\S]{0,100}<span>推理强度<\/span>/);
  assert.doesNotMatch(detailSource, /mobile-composer-config-strip/);
  assert.doesNotMatch(detailSource, /mobile-composer-mode-label/);
  assert.doesNotMatch(detailSource, />就绪</);
  assert.doesNotMatch(mobileStyles, /\.mobile-composer-permission-select\{flex:0 1 92px\}/);
  assert.match(mobileStyles, /\.mobile-live-composer \.mobile-composer-action-row > \.prototype-icon-button,[\s\S]*?min-width: 44px;/);
  assert.match(mobileStyles, /\.mobile-live-composer \.mobile-composer-action-row \.prototype-send-button\s*\{\s*margin-left: auto;/);
  assert.match(mobileStyles, /\.mobile-live-composer \.mobile-composer-select \.mobile-select-trigger\s*\{[\s\S]*?min-height: 44px;/);
  assert.match(mobileStyles, /\.mobile-live-composer \.mobile-composer-model-select\s*\{[\s\S]*?margin-left: auto;/);
  assert.match(mobileStyles, /\.mobile-live-composer \.mobile-composer-select \.mobile-select-trigger span\s*\{[\s\S]*?text-overflow: ellipsis;/);
  assert.match(mobileStyles, /\.popover-portal-host:has\(\.composer-context-card\)\s*\{[\s\S]*?bottom: calc\(130px \+ env\(safe-area-inset-bottom\)\) !important;/);
  assert.match(mobileStyles, /\.popover-portal-host \.composer-context-card\s*\{[\s\S]*?max-height: min\(52dvh, 420px\);[\s\S]*?overflow-y: auto;/);
  assert.match(mobileStyles, /body:has\(\.mobile-composer-attachments\) \.popover-portal-host:has\(\.composer-context-card\)/);
  assert.match(mobileStyles, /\.mobile-task-config-row,\s*\.mobile-task-config-provider\s*\{[\s\S]*?grid-template-columns: 82px minmax\(0, 1fr\)/);
});

test('mobile task overflow button opens a safe action sheet', () => {
  assert.match(detailSource, /import \{ MobileActionSheet \} from '\.\.\/components\/MobileActionSheet'/);
  assert.match(detailSource, /aria-label="更多操作"/);
  assert.match(detailSource, /onClick=\{\(\) => setTaskMenuOpen\(true\)\}/);
  assert.match(detailSource, /\.\.\.\(canStop \? \[\{ id: 'stop'/);
  assert.match(detailSource, /<section className="mobile-task-config"/);
  assert.match(detailSource, /label: '刷新会话'/);
  assert.match(detailSource, /label: '复制任务链接'/);
  assert.match(detailSource, /label: '复制任务 ID'/);
  assert.match(detailSource, /`\$\{window\.location\.origin\}\/mobile\/tasks\/\$\{encodeURIComponent\(threadId\)\}`/);
  assert.doesNotMatch(detailSource, /window\.location\.href/);
  assert.match(mobileActionSheetSource, /role="dialog" aria-modal="true"/);
  assert.match(mobileActionSheetSource, /event\.key === 'Escape'/);
  assert.match(mobileActionSheetSource, /history\.pushState/);
  assert.match(mobileActionSheetSource, /window\.addEventListener\('popstate'/);
  assert.match(mobileActionSheetSource, /triggerRef\.current\?\.focus/);
  assert.match(mobileActionSheetSource, /children \? <div className="mobile-action-sheet-content">/);
  assert.match(mobileActionSheetSource, /mobile-select-backdrop:not\(\.mobile-action-sheet-backdrop\)/);
  assert.match(mobileActionSheetSource, /window\.history\.state\?\.codemMobileActionSheet/);
  assert.match(mobileActionSheetSource, /Promise\.resolve\(item\.onSelect\(\)\)\.finally\(closeSheet\)/);
  assert.match(mobileStyles, /\.mobile-action-sheet-item\s*\{/);
});

test('mobile follow-up sends the selected runtime configuration', () => {
  assert.match(detailSource, /await mobileApi\.send\(threadId, \{/);
  assert.match(detailSource, /model: selectedModel/);
  assert.match(detailSource, /mobileReasoningEffortRequest\(task\?\.providerId \|\| '', effectiveReasoningEffort\)/);
  assert.match(detailSource, /permissionMode: selectedPermissionMode/);
  assert.match(detailSource, /channelId: selectedChannelId/);
  assert.match(detailSource, /const contentBlocks = await buildMobileContentBlocks\(text, submittedAttachments\)/);
  assert.match(detailSource, /contentBlocks,/);
  assert.match(detailSource, /type: 'image'/);
  assert.match(detailSource, /type: 'file_text'/);
  assert.match(detailSource, /if \(running && attachments\.length > 0\)/);
  assert.match(mobileApiSource, /send: \(threadId: string, body: MobileSendRequest\)/);
  assert.match(mobileApiSource, /contentBlocks: InputContentBlock\[\]/);
  assert.match(mobileApiSource, /body: JSON\.stringify\(body\)/);
});

test('mobile send is optimistic and supports the software keyboard send action', () => {
  assert.match(detailSource, /enterKeyHint="send"/);
  assert.match(detailSource, /event\.key === 'Enter' && !event\.shiftKey && !event\.nativeEvent\.isComposing/);
  assert.match(detailSource, /optimisticTurnId = thread\.appendOptimisticTurn/);
  assert.match(detailSource, /setPrompt\(''\);\s*setAttachments\(\[\]\);\s*const runReasoningEffort/);
  assert.match(detailSource, /thread\.removeOptimisticTurn\(optimisticTurnId\)/);
  assert.match(detailSource, /setPrompt\(text\);\s*setAttachments\(submittedAttachments\)/);
  assert.match(threadHookSource, /const appendOptimisticTurn = useCallback/);
  assert.match(threadHookSource, /status: 'pending'/);
  assert.match(threadHookSource, /activity: '正在发送'/);
});

test('mobile detail follows the visual viewport when the software keyboard opens', () => {
  assert.match(detailSource, /const viewport = window\.visualViewport/);
  assert.match(detailSource, /viewport\.addEventListener\('resize', syncViewport\)/);
  assert.match(detailSource, /viewport\.addEventListener\('scroll', syncViewport\)/);
  assert.match(detailSource, /window\.addEventListener\('resize', syncViewport\)/);
  assert.match(detailSource, /--mobile-visual-viewport-height/);
  assert.match(detailSource, /--mobile-visual-viewport-top/);
  assert.match(mobileStyles, /\.mobile-live-detail \{[\s\S]*height: var\(--mobile-visual-viewport-height, 100dvh\)/);
  assert.doesNotMatch(prototypeStyles, /--mobile-visual-viewport-height/);
});

test('mobile history images use an authenticated opaque preview id', () => {
  assert.match(detailSource, /attachmentPreviewScope="mobile"/);
  assert.match(conversationTurnSource, /scope === 'mobile'/);
  assert.match(conversationTurnSource, /`\/api\/mobile\/attachments\/\$\{encodeURIComponent\(block\.previewId\)\}`/);
  assert.doesNotMatch(conversationTurnSource, /scope === 'mobile'[\s\S]{0,160}buildWorkspaceImagePreviewUrl/);
});

test('mobile realtime state distinguishes idle completion from an actual reconnect', () => {
  assert.match(threadHookSource, /let streamSettled = false/);
  assert.match(threadHookSource, /events\.onerror = \(\) => setStreamState\(streamSettled \? 'idle' : 'reconnecting'\)/);
  assert.match(detailSource, /connectionLabel\(running, thread\.streamState\)/);
  assert.match(detailSource, /if \(!running\) return '已同步'/);
});

test('mobile runtime changes trigger bootstrap without a global polling interval', () => {
  assert.match(workspaceHookSource, /new EventSource\('\/api\/mobile\/events'/);
  assert.match(workspaceHookSource, /events\.addEventListener\('sync',/);
  assert.match(workspaceHookSource, /void refresh\(\)/);
  assert.doesNotMatch(workspaceHookSource, /setInterval/);
  assert.doesNotMatch(mobileAppSource, /enteredAuthenticatedRouteRef/);
  assert.doesNotMatch(mobileAppSource, /\[route\.name, route\.threadId,/);
  assert.match(detailSource, /useMobileThread\(threadId, fallbackTask\)/);
  assert.match(threadHookSource, /const next = await mobileApi\.thread\(threadId\)/);
  assert.match(threadHookSource, /params\.set\('runId', initial\.liveRunId\)/);
});

test('mobile new task always returns to the task list without relying on browser history', () => {
  assert.match(mobileAppSource, /const replaceRoute = \(path: string\) => \{ history\.replaceState\(null, '', path\); setRoute\(parseRoute\(\)\); \}/);
  assert.match(mobileAppSource, /<NewTaskPage bootstrap=\{workspace\.data\} onBack=\{\(\) => replaceRoute\('\/mobile\/tasks'\)\}/);
  assert.doesNotMatch(mobileAppSource, /<NewTaskPage[^>]+onBack=\{\(\) => history\.back\(\)\}/);
});

test('mobile task detail always returns to the task list without leaving the webview', () => {
  assert.match(mobileAppSource, /<TaskDetailPage[^>]+onBack=\{\(\) => replaceRoute\('\/mobile\/tasks'\)\}/);
  assert.doesNotMatch(mobileAppSource, /<TaskDetailPage[^>]+onBack=\{\(\) => history\.back\(\)\}/);
  assert.doesNotMatch(mobileAppSource, /history\.length > 1/);
});
