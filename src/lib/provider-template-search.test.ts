import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  agentChannelProtocolHint,
  filterProviderTemplates,
  filterProviderVendors,
  groupProviderTemplateChannels,
  groupProviderTemplates,
  protocolsForAgent,
} from './provider-template-search';
import type { AiProviderTemplate } from '../types';

const agentChannelSettingsSource = readFileSync(
  new URL('../components/settings/AgentChannelSettings.tsx', import.meta.url),
  'utf8',
);
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

const templates: AiProviderTemplate[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    vendorId: 'deepseek',
    vendorName: 'DeepSeek',
    channelId: 'standard',
    channelName: '标准 API',
    protocol: 'openai_chat',
    baseUrl: 'https://api.deepseek.com',
    apiKeyUrl: 'https://platform.deepseek.com',
    docsUrl: 'https://api-docs.deepseek.com',
    icon: 'deepseek',
    category: 'china',
  },
  {
    id: 'deepseek-anthropic',
    name: 'DeepSeek',
    vendorId: 'deepseek',
    vendorName: 'DeepSeek',
    channelId: 'standard',
    channelName: '标准 API',
    protocol: 'anthropic_messages',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKeyUrl: 'https://platform.deepseek.com',
    docsUrl: 'https://api-docs.deepseek.com',
    icon: 'deepseek',
    category: 'china',
  },
  {
    id: 'qwen',
    name: '阿里云百炼 / Qwen',
    vendorId: 'qwen',
    vendorName: '阿里云百炼 / Qwen',
    channelId: 'standard',
    channelName: '标准 API',
    protocol: 'openai_chat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyUrl: 'https://bailian.console.aliyun.com',
    docsUrl: 'https://help.aliyun.com/zh/model-studio',
    icon: 'qwen',
    category: 'china',
  },
];

test('供应商模板搜索支持名称、标识和 API 地址且忽略大小写', () => {
  assert.deepEqual(filterProviderTemplates(templates, 'DEEP').map((item) => item.id), ['deepseek', 'deepseek-anthropic']);
  assert.deepEqual(filterProviderTemplates(templates, 'qwen').map((item) => item.id), ['qwen']);
  assert.deepEqual(filterProviderTemplates(templates, 'dashscope').map((item) => item.id), ['qwen']);
});

test('空搜索保留全部模板，无匹配时返回空列表', () => {
  assert.equal(filterProviderTemplates(templates, '  ').length, templates.length);
  assert.deepEqual(filterProviderTemplates(templates, '不存在的厂商'), []);
});

test('同一厂商的不同接口配置只生成一个厂商入口', () => {
  const vendors = groupProviderTemplates(templates);
  assert.equal(vendors.length, 2);
  assert.deepEqual(vendors[0]?.templates.map((item) => item.id), ['deepseek', 'deepseek-anthropic']);
});

test('厂商搜索可以命中渠道和接口类型', () => {
  assert.deepEqual(filterProviderVendors(templates, 'Anthropic').map((item) => item.id), ['deepseek']);
  assert.deepEqual(filterProviderVendors(templates, '标准 API').map((item) => item.id), ['deepseek', 'qwen']);
});

test('同厂商模板可以继续按渠道聚合接口类型', () => {
  const channels = groupProviderTemplateChannels(templates.filter((item) => item.vendorId === 'deepseek'));
  assert.equal(channels.length, 1);
  assert.equal(channels[0]?.name, '标准 API');
  assert.deepEqual(channels[0]?.templates.map((item) => item.protocol), ['openai_chat', 'anthropic_messages']);
});

test('Agent 渠道设置使用两列厂商下拉并将渠道作为独立按钮组', () => {
  assert.match(agentChannelSettingsSource, /filterProviderVendors\(templates, query\)/);
  assert.match(agentChannelSettingsSource, /className="ai-manager-vendor-options"/);
  assert.match(agentChannelSettingsSource, /selectedVendorChannels\.map/);
  assert.match(agentChannelSettingsSource, /aria-label="Agent 渠道"/);
  assert.match(stylesSource, /\.agent-channel-template-menu \.ai-manager-vendor-options\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,/);
});

test('Agent 渠道列表优先显示匹配的厂商图标', () => {
  assert.match(
    agentChannelSettingsSource,
    /const channelTemplate = matchTemplate\(templates, channelToDraft\(channel\)\)/,
  );
  assert.match(
    agentChannelSettingsSource,
    /<ProviderBrandIcon icon=\{channelTemplate\.icon\} name=\{channelTemplate\.vendorName\} size=\{25\} \/>/,
  );
});

test('Agent 渠道接口矩阵使用真实运行协议并让 Grok 默认选择 OpenAI Chat', () => {
  assert.deepEqual(protocolsForAgent('claude-code'), ['anthropic_messages']);
  assert.deepEqual(protocolsForAgent('openai-codex'), ['openai_responses', 'openai_chat']);
  assert.deepEqual(protocolsForAgent('grok-build'), [
    'openai_chat',
    'openai_responses',
    'anthropic_messages',
  ]);
  assert.deepEqual(protocolsForAgent('opencode'), ['openai_chat', 'anthropic_messages']);
  assert.match(
    agentChannelProtocolHint('grok-build', 'openai_responses'),
    /上游明确提供 \/responses.*OpenAI Chat/,
  );
});
