import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./pages/ProjectsPage.tsx', import.meta.url), 'utf8');

test('mobile projects expose independent expand and collapse controls', () => {
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(source, /toggleProject\(project\.id\)/);
  assert.match(source, /expanded \? <div id=\{contentId\}/);
  assert.match(source, /暂无最近会话/);
});
