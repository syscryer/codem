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

test('mobile projects default collapsed and persist manual expansion', () => {
  // 默认收起：初始化不再基于 recentTasks 自动展开
  assert.doesNotMatch(source, /recentTasks\.length > 0\)\.map/);
  assert.match(source, /useState<Set<string>>\(loadExpandedProjectIds\)/);
  assert.match(source, /codem-mobile-expanded-projects/);
  assert.match(source, /localStorage\.setItem\(EXPANDED_PROJECTS_STORAGE_KEY/);
});
