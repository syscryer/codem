import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settingsViewSource = readFileSync(new URL('../components/settings/SettingsView.tsx', import.meta.url), 'utf8');
const settingsSidebarSource = readFileSync(new URL('../components/settings/SettingsSidebar.tsx', import.meta.url), 'utf8');
const aiProviderSettingsSource = readFileSync(new URL('../components/settings/AiProviderSettings.tsx', import.meta.url), 'utf8');
const composerSource = readFileSync(new URL('../components/Composer.tsx', import.meta.url), 'utf8');
const ordinaryWorkspaceSource = readFileSync(new URL('../components/OrdinaryChatWorkspace.tsx', import.meta.url), 'utf8');
const providerManagerSource = readFileSync(new URL('../components/AiProviderManagerDialog.tsx', import.meta.url), 'utf8');
const ordinaryApiSource = readFileSync(new URL('./ordinary-chat-api.ts', import.meta.url), 'utf8');
const ordinaryChatHookSource = readFileSync(new URL('../hooks/useOrdinaryChat.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const backendSource = readFileSync(new URL('../../src-tauri/src/ordinary_chat/mod.rs', import.meta.url), 'utf8');
const providerCatalogSource = readFileSync(new URL('../../src-tauri/src/ordinary_chat/provider.rs', import.meta.url), 'utf8');
const providerIconSource = readFileSync(new URL('../components/ProviderBrandIcon.tsx', import.meta.url), 'utf8');

test('普通聊天不再暴露或加载 Agent Skills，并提供思考等级与联网搜索控制', () => {
  assert.doesNotMatch(composerSource, /aria-label="Skills"/);
  assert.doesNotMatch(ordinaryWorkspaceSource, /onToggleSkill/);
  assert.doesNotMatch(ordinaryChatHookSource, /load.*Skills|setSkills|toggleSkill/);
  assert.match(composerSource, /ordinaryThinkingEnabled/);
  assert.match(composerSource, /ordinaryReasoningOptions/);
  assert.match(composerSource, /ordinaryWebSearchAvailable/);
  assert.doesNotMatch(backendSource, /list_codex_skills_value/);
});

test('普通聊天供应商保留兼容页面但不再占用设置主菜单', () => {
  assert.match(settingsViewSource, /activeSection === 'aiProviders'/);
  assert.match(settingsViewSource, /AiProviderSettingsSection/);
  assert.doesNotMatch(settingsSidebarSource, /id: 'aiProviders', label: '普通聊天'/);
  assert.match(aiProviderSettingsSource, /<h1>普通聊天<\/h1>/);
});

test('无供应商和无模型时会提供全局设置引导', () => {
  assert.match(ordinaryWorkspaceSource, /前往全局设置/);
  assert.match(composerSource, /ordinary-provider-settings/);
  assert.match(composerSource, /管理 AI 供应商/);
  assert.match(composerSource, /请先在全局设置中配置 AI 供应商和模型/);
});

test('厂商目录收口为右侧可搜索下拉并显示品牌图标', () => {
  assert.match(providerManagerSource, /placeholder="搜索厂商"/);
  assert.match(providerManagerSource, /filterProviderVendors/);
  assert.match(providerManagerSource, /ProviderBrandIcon/);
  assert.match(providerManagerSource, /ProviderVendorDropdown/);
  assert.match(providerManagerSource, /aria-haspopup="listbox"/);
  assert.doesNotMatch(providerManagerSource, /ai-manager-template-list|常用厂商/);
  assert.doesNotMatch(providerManagerSource, /国际厂商|国内厂商|聚合平台/);
});

test('主流厂商目录包含官方渠道并提供品牌图标', () => {
  for (const vendor of ['火山方舟 / 豆包', '硅基流动 / SiliconFlow', 'Xiaomi MiMo', '阶跃星辰 / StepFun', '魔搭 ModelScope', '百度千帆']) {
    assert.match(providerCatalogSource, new RegExp(vendor.replace('/', '\\/')));
  }
  for (const icon of ['volcengineIcon', 'siliconflowIcon', 'xiaomimimoIcon', 'stepfunIcon', 'modelscopeIcon', 'baiduIcon', 'xaiIcon', 'mistralIcon', 'nvidiaIcon']) {
    assert.match(providerIconSource, new RegExp(icon));
  }
  assert.doesNotMatch(providerCatalogSource, /api_key_url:\s*"[^"]*(?:utm_|aff=|cloud\.siliconflow\.cn\/i\/)/);
});

test('同一厂商支持新增多个独立配置', () => {
  assert.match(providerManagerSource, /aria-label="新增配置"/);
  assert.match(providerManagerSource, /matchingVendorCount/);
  assert.match(providerManagerSource, /`\$\{template\.vendorName\} \$\{matchingVendorCount \+ 1\}`/);
  assert.match(providerManagerSource, /startNewProvider/);
});

test('左侧供应商使用居中大图标和完整圆角选中态', () => {
  assert.match(providerManagerSource, /name=\{provider\.name\} size=\{34\}/);
  assert.match(stylesSource, /\.ai-manager-provider-row\s*\{[\s\S]*?grid-template-columns:\s*34px minmax\(0, 1fr\) auto;[\s\S]*?border-radius:\s*12px;/);
  assert.match(stylesSource, /\.ai-manager-provider-row\.active\s*\{[\s\S]*?border-color:[\s\S]*?background:/);
  assert.match(stylesSource, /\.provider-brand-icon\s*\{[\s\S]*?position:\s*relative;/);
  assert.match(stylesSource, /\.provider-brand-icon-svg\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*13%;/);
  assert.doesNotMatch(stylesSource, /\.ai-manager-provider-row > \.provider-brand-icon\s*\{[^}]*transform:/);
  assert.doesNotMatch(stylesSource, /\.ai-manager-provider-row\.active\s*\{[^}]*inset 2px 0/);
});

test('普通聊天供应商设置统一使用设置主页面滚动并保持左栏完整边框', () => {
  assert.match(stylesSource, /\.ai-provider-settings-shell\s*\{[\s\S]*?height:\s*auto;[\s\S]*?overflow:\s*visible;/);
  assert.match(stylesSource, /\.ai-provider-settings-shell\s*\{[\s\S]*?border-radius:\s*12px;/);
  assert.match(stylesSource, /\.ai-provider-settings-shell \.ai-manager-sidebar\s*\{[\s\S]*?border:\s*1px solid var\(--app-border,[\s\S]*?border-radius:\s*9px;/);
  assert.match(stylesSource, /\.ai-provider-settings-shell \.ai-manager-sidebar,[\s\S]*?\.ai-provider-settings-shell \.ai-manager-content\s*\{[\s\S]*?overflow:\s*visible;/);
  assert.match(stylesSource, /\.ai-provider-settings-shell \.ai-manager-provider-list\s*\{[\s\S]*?max-height:\s*none;/);
});

test('渠道管理中的普通聊天复用 Agent 双栏外框并将导入入口上移', () => {
  assert.match(providerManagerSource, /channelLayout \? ' agent-channel-layout ordinary-chat-channel-layout'/);
  assert.match(providerManagerSource, /channelLayout \? ' ordinary-chat-channel-sidebar'/);
  assert.match(providerManagerSource, /channelLayout \? ' agent-channel-content ordinary-chat-channel-content'/);
  assert.match(stylesSource, /\.ordinary-chat-channel-sidebar\s*\{[\s\S]*?align-self:\s*stretch;[\s\S]*?border-radius:\s*8px 0 0 8px;/);
  assert.match(stylesSource, /@media \(max-width: 760px\)[\s\S]*?\.ordinary-chat-channel-sidebar\s*\{[\s\S]*?border-right:\s*0;[\s\S]*?border-bottom:/);
});

test('全局搜索框聚焦时不显示浅色外扩光圈', () => {
  assert.match(stylesSource, /搜索框聚焦时只保留边框反馈/);
  assert.match(stylesSource, /\.ai-manager-vendor-search,[\s\S]*?\.ai-model-picker-search[\s\S]*?:focus-within\s*\{[\s\S]*?box-shadow:\s*none;/);
  assert.match(stylesSource, /\.settings-search input,[\s\S]*?\.ai-manager-vendor-search input[\s\S]*?:focus-visible\s*\{[\s\S]*?box-shadow:\s*none;/);
});

test('内置厂商按渠道和接口类型切换接口配置', () => {
  assert.match(providerManagerSource, /activeTemplate\?\.vendorId !== template\.vendorId/);
  assert.match(providerManagerSource, /startTemplate\(template\)/);
  assert.match(providerManagerSource, /aria-label="渠道"/);
  assert.match(providerManagerSource, /aria-label="接口类型"/);
  assert.match(providerManagerSource, /switchChannel/);
});

test('供应商创建态支持测试连接、获取模型和多选添加', () => {
  assert.match(providerManagerSource, /testCurrentProvider/);
  assert.match(providerManagerSource, /获取模型列表/);
  assert.match(providerManagerSource, /AiModelPickerDialog/);
  assert.match(providerManagerSource, /createAiModelsBatch/);
  assert.match(providerManagerSource, /models: draft\.models\.map/);
});

test('模型选择弹窗保留完整文本列且获取入口显示明确文字按钮', () => {
  assert.match(stylesSource, /\.ai-model-picker-row\s*\{[\s\S]*?grid-template-columns:\s*22px minmax\(0, 1fr\) auto/);
  assert.match(providerManagerSource, /className="ai-manager-model-discover-button"/);
  assert.match(providerManagerSource, /aria-label="获取模型"/);
  assert.match(providerManagerSource, /<span>获取模型<\/span>/);
  assert.doesNotMatch(providerManagerSource, /className="ai-manager-icon-button ai-manager-model-discover-button"/);
});

test('供应商支持单默认状态且保存入口位于配置头部', () => {
  assert.match(providerManagerSource, /draft\.isDefault \? '默认供应商' : '设为默认'/);
  assert.match(providerManagerSource, /className="ai-manager-save-button"/);
  assert.match(providerManagerSource, /isDefault: draft\.isDefault/);
  assert.match(providerManagerSource, /provider\.isDefault/);
  assert.match(ordinaryChatHookSource, /provider\.isDefault && provider\.enabled/);
  assert.match(ordinaryChatHookSource, /const provider = preferredProvider\(providers\);[\s\S]*?setDraftProviderId\(provider\?\.id \?\? ''\)/);
});

test('已保存 API Key 仅在主动查看时读取且响应禁止缓存', () => {
  assert.match(providerManagerSource, /revealAiProviderApiKey/);
  assert.match(providerManagerSource, /apiKeyVisible \? 'text' : 'password'/);
  assert.match(providerManagerSource, /setRevealedSavedApiKey\(false\)/);
  assert.match(ordinaryApiSource, /cache: 'no-store'/);
  assert.match(backendSource, /header::CACHE_CONTROL, "no-store"/);
});

test('普通聊天将供应商与模型作为相邻独立入口并使用厂商品牌图标', () => {
  assert.match(composerSource, /OrdinaryProviderModelControls/);
  assert.match(composerSource, /ordinary-provider-trigger/);
  assert.match(composerSource, /ordinary-model-trigger/);
  assert.match(composerSource, /ProviderBrandIcon/);
  assert.match(composerSource, /variant !== 'ordinary' \? <div className="permission-picker provider-picker"/);
  assert.match(ordinaryWorkspaceSource, /onSelectProvider=\{/);
  assert.match(ordinaryWorkspaceSource, /onSelectAgentModel=\{/);
  assert.match(ordinaryChatHookSource, /const selectProvider = useCallback/);
  assert.match(ordinaryChatHookSource, /const selectModel = useCallback/);
});
