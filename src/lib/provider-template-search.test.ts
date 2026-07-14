import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterProviderTemplates,
  filterProviderVendors,
  groupProviderTemplates,
} from './provider-template-search';
import type { AiProviderTemplate } from '../types';

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
