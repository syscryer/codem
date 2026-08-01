import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../components/settings/OpenWithSettings.tsx', import.meta.url), 'utf8');

test('打开方式设置页允许选择网页链接默认打开位置', () => {
  assert.match(source, /title="网页链接"/);
  assert.match(source, /value=\{openWith\.webLinkOpenTarget\}/);
  assert.match(source, /value: 'external', label: '外部浏览器'/);
  assert.match(source, /value: 'workbench', label: '右侧浏览器'/);
  assert.match(source, /onUpdateOpenWith\(\{ webLinkOpenTarget \}\)/);
});
