import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const sidebarProjectsSource = readFileSync(new URL('../components/SidebarProjects.tsx', import.meta.url), 'utf8');

test('侧边栏使用稳定的纵向布局承载置顶区和项目区', () => {
  assert.match(
    stylesSource,
    /\.app-sidebar\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;[^}]*\}/,
  );
});

test('置顶区和项目区共享同一个滚动容器', () => {
  assert.match(sidebarProjectsSource, /<div className="sidebar-scroll-region">[\s\S]*sidebar-pinned[\s\S]*sidebar-projects[\s\S]*<\/div>/);
  assert.match(
    stylesSource,
    /\.sidebar-scroll-region\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow:\s*auto;[^}]*\}/,
  );
});
