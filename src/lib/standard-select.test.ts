import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const componentsDirectory = fileURLToPath(new URL('../components', import.meta.url));
const standardSelectSource = readFileSync(join(componentsDirectory, 'StandardSelect.tsx'), 'utf8');

function componentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? componentFiles(path) : entry.name.endsWith('.tsx') ? [path] : [];
  });
}

test('业务组件不使用原生 select', () => {
  const offenders = componentFiles(componentsDirectory)
    .filter((path) => /<select\b/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('全局标准下拉复用主题菜单和 Portal', () => {
  assert.match(standardSelectSource, /settings-select-trigger standard-select-trigger/);
  assert.match(standardSelectSource, /settings-select-menu standard-select-menu/);
  assert.match(standardSelectSource, /<PopoverPortal open=\{open && !disabled\}/);
  assert.match(standardSelectSource, /event\.key === 'Escape'/);
});
