import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const componentSource = readFileSync(resolve(testDir, 'SidebarProjects.tsx'), 'utf8');
const stylesSource = readFileSync(resolve(testDir, '../styles.css'), 'utf8');

test('sidebar thread status icons use compact right-side indicators', () => {
  assert.match(componentSource, /SidebarThreadStatusIcon/);
  assert.match(componentSource, /className="sidebar-thread-meta"/);
  assert.doesNotMatch(componentSource, /sidebar-thread-activity-badge/);
  assert.match(stylesSource, /\.sidebar-thread-status-icon\.completed\s*\{[\s\S]*background:\s*#1a73e8;/);
  assert.match(stylesSource, /\.sidebar-thread-status-icon\.running\s*\{[\s\S]*border:\s*2px\s+solid/);
  assert.match(stylesSource, /\.sidebar-thread-status-icon\.hot\s+svg\s*\{/);
});
