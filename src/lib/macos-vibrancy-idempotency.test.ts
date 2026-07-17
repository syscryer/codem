import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const workspaceStateSource = readFileSync(new URL('../hooks/useWorkspaceState.ts', import.meta.url), 'utf8');

test('workspace toast 操作保持稳定引用', () => {
  assert.match(workspaceStateSource, /const showToast = useCallback\([\s\S]*?\}, \[\]\);/);
  assert.match(workspaceStateSource, /const dismissToast = useCallback\([\s\S]*?\}, \[\]\);/);
  assert.match(workspaceStateSource, /const setToastDetailOpen = useCallback\([\s\S]*?\}, \[\]\);/);
});

test('窗口材质 effect 会跳过已应用的相同材质', () => {
  assert.match(
    appSource,
    /const appliedWindowMaterialRef = useRef<WindowMaterialMode \| null>\(null\);/,
  );
  assert.match(
    appSource,
    /if \(appliedWindowMaterialRef\.current === requestedMaterial\) \{\s*return;\s*\}/,
  );
  assert.match(
    appSource,
    /appliedWindowMaterialRef\.current = requestedMaterial;[\s\S]*?setWindowMaterial\(requestedMaterial\)/,
  );
});

test('窗口材质失败只回滚对应请求的应用标记', () => {
  assert.match(
    appSource,
    /if \(appliedWindowMaterialRef\.current === requestedMaterial\) \{\s*appliedWindowMaterialRef\.current = null;\s*\}/,
  );
});
