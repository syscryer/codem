import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const componentSource = readFileSync(resolve(testDir, 'SidebarProjects.tsx'), 'utf8');
const stylesSource = readFileSync(resolve(testDir, '../styles.css'), 'utf8');

test('sidebar thread status icons render before timestamps and hide running timestamps', () => {
  assert.match(componentSource, /SidebarThreadStatusIcon/);
  assert.match(componentSource, /className="sidebar-thread-meta"/);
  assert.match(
    componentSource,
    /<SidebarThreadStatusIcon status=\{threadStatus\} \/>\s*\{isRunningThread \? null : <small>\{thread\.updatedLabel\}<\/small>\}/,
  );
  assert.doesNotMatch(componentSource, /sidebar-thread-activity-badge/);
  assert.match(stylesSource, /\.sidebar-thread-status-icon\.completed\s*\{[\s\S]*background:\s*#1a73e8;/);
  assert.match(
    stylesSource,
    /\.sidebar-thread-status-icon\.running\s*\{[\s\S]*width:\s*12px;[\s\S]*border:\s*2px\s+solid\s+#8f949a;/,
  );
  assert.match(stylesSource, /\.sidebar-thread-status-icon\.hot\s*\{[\s\S]*color:\s*#8f949a;/);
  assert.match(stylesSource, /\.sidebar-thread-status-icon\.hot\s+svg\s*\{/);
});
