import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';

import {
  buildReleaseAssetName,
  collectAndCopyReleaseAssets,
  parseCliArgs,
  splitAssetName,
} from './release-assets.mjs';

test('splitAssetName 优先识别 .app.tar.gz', () => {
  assert.deepEqual(splitAssetName('CodeM.app.tar.gz'), {
    stem: 'CodeM',
    extension: '.app.tar.gz',
  });
});

test('splitAssetName 识别 .tar.gz', () => {
  assert.deepEqual(splitAssetName('codem-source.tar.gz'), {
    stem: 'codem-source',
    extension: '.tar.gz',
  });
});

test('splitAssetName 识别普通扩展名', () => {
  assert.deepEqual(splitAssetName('CodeM_0.1.0_x64-setup.exe'), {
    stem: 'CodeM_0.1.0_x64-setup',
    extension: '.exe',
  });
});

test('buildReleaseAssetName 为 Windows 安装包追加 artifact 与 flavor', () => {
  assert.equal(
    buildReleaseAssetName('CodeM_0.1.0_x64-setup.exe', 'windows-x64', 'with-node'),
    'CodeM_0.1.0_x64-setup-windows-x64-with-node.exe',
  );
});

test('buildReleaseAssetName 为 macOS app tarball 追加 artifact 与 flavor', () => {
  assert.equal(
    buildReleaseAssetName('CodeM.app.tar.gz', 'macos-arm64', 'no-node'),
    'CodeM-macos-arm64-no-node.app.tar.gz',
  );
});

test('parseCliArgs 解析 workflow 所需参数', () => {
  assert.deepEqual(
    parseCliArgs([
      '--bundle-root',
      'src-tauri/target/release/bundle',
      '--out-dir',
      'release-assets',
      '--artifact',
      'windows-x64',
      '--flavor',
      'with-node',
    ]),
    {
      bundleRoot: 'src-tauri/target/release/bundle',
      outDir: 'release-assets',
      artifact: 'windows-x64',
      flavor: 'with-node',
    },
  );
});

test('collectAndCopyReleaseAssets 递归复制支持的产物并重命名', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'release-assets-test-'));
  const bundleRoot = path.join(tempRoot, 'bundle');
  const outDir = path.join(tempRoot, 'release-assets');

  try {
    await mkdir(path.join(bundleRoot, 'nsis'), { recursive: true });
    await mkdir(path.join(bundleRoot, 'nested', 'deep'), { recursive: true });

    await writeFile(path.join(bundleRoot, 'nsis', 'CodeM_0.1.0_x64-setup.exe'), 'exe');
    await writeFile(path.join(bundleRoot, 'nsis', 'CodeM_0.1.0_x64-setup.exe.sig'), 'exe-sig');
    await writeFile(path.join(bundleRoot, 'nested', 'deep', 'CodeM_0.1.0_x64_en-US.msi'), 'msi');
    await writeFile(path.join(bundleRoot, 'nested', 'deep', 'CodeM_0.1.0_amd64.deb'), 'deb');
    await writeFile(path.join(bundleRoot, 'nested', 'deep', 'CodeM-portable.zip'), 'zip');
    await writeFile(path.join(bundleRoot, 'nested', 'deep', 'README.txt'), 'ignore');

    const copiedAssets = await collectAndCopyReleaseAssets({
      bundleRoot,
      outDir,
      artifact: 'windows-x64',
      flavor: 'with-node',
    });

    assert.deepEqual(copiedAssets.map((asset) => path.basename(asset.destination)).sort(), [
      'CodeM-portable-windows-x64-with-node.zip',
      'CodeM_0.1.0_amd64-windows-x64-with-node.deb',
      'CodeM_0.1.0_x64-setup-windows-x64-with-node.exe',
      'CodeM_0.1.0_x64_en-US-windows-x64-with-node.msi',
    ]);

    assert.deepEqual((await readdir(outDir)).sort(), [
      'CodeM-portable-windows-x64-with-node.zip',
      'CodeM_0.1.0_amd64-windows-x64-with-node.deb',
      'CodeM_0.1.0_x64-setup-windows-x64-with-node.exe',
      'CodeM_0.1.0_x64-setup-windows-x64-with-node.exe.sig',
      'CodeM_0.1.0_x64_en-US-windows-x64-with-node.msi',
    ]);

    assert.equal(
      await readFile(path.join(outDir, 'CodeM_0.1.0_x64-setup-windows-x64-with-node.exe'), 'utf8'),
      'exe',
    );
    assert.equal(
      await readFile(path.join(outDir, 'CodeM_0.1.0_x64-setup-windows-x64-with-node.exe.sig'), 'utf8'),
      'exe-sig',
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
