import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Windows portable 只打包 Rust 桌面可执行文件', async () => {
  const workflow = await readFile('.github/workflows/release.yml', 'utf8');

  assert.match(
    workflow,
    /cp src-tauri\/target\/release\/codem\.exe "\$portable_root\/CodeM\.exe"/,
  );
  assert.match(workflow, /CodeM-portable-\$\{\{ matrix\.artifact \}\}-\$\{\{ matrix\.flavor \}\}\.zip/);
  assert.doesNotMatch(workflow, /_up_/);
});
