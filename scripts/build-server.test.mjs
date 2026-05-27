import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { stageRuntimeBinary } from './build-server.mjs';

async function withTempDirectory(run) {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'codem-build-server-'));
  try {
    await run(tempDirectory);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('stageRuntimeBinary 在 bundled + win32 时写入 node.exe 二进制', async () => {
  await withTempDirectory(async (tempDirectory) => {
    const fakeNodeExecutablePath = path.join(tempDirectory, 'fake-node.exe');
    const expectedBinary = Buffer.from([0, 1, 2, 3, 255]);
    await writeFile(fakeNodeExecutablePath, expectedBinary);

    const stagedRuntimePath = await stageRuntimeBinary({
      outputDirectory: tempDirectory,
      runtimeMode: 'bundled',
      platform: 'win32',
      nodeExecutablePath: fakeNodeExecutablePath,
    });

    assert.equal(stagedRuntimePath, path.join(tempDirectory, 'runtime', 'node.exe'));
    assert.deepEqual(await readFile(stagedRuntimePath), expectedBinary);
  });
});

test('stageRuntimeBinary 在 external 时返回 null 且不生成 runtime 文件', async () => {
  await withTempDirectory(async (tempDirectory) => {
    const fakeNodeExecutablePath = path.join(tempDirectory, 'fake-node.exe');
    await writeFile(fakeNodeExecutablePath, Buffer.from([7, 8, 9]));

    const stagedRuntimePath = await stageRuntimeBinary({
      outputDirectory: tempDirectory,
      runtimeMode: 'external',
      platform: 'win32',
      nodeExecutablePath: fakeNodeExecutablePath,
    });

    assert.equal(stagedRuntimePath, null);
    await assert.rejects(readFile(path.join(tempDirectory, 'runtime', 'node.exe')));
  });
});

test('stageRuntimeBinary 在 external 时会清理已有 runtime 文件', async () => {
  await withTempDirectory(async (tempDirectory) => {
    const runtimeDirectory = path.join(tempDirectory, 'runtime');
    const existingRuntimePath = path.join(runtimeDirectory, 'node.exe');
    const fakeNodeExecutablePath = path.join(tempDirectory, 'fake-node.exe');
    await writeFile(fakeNodeExecutablePath, Buffer.from([7, 8, 9]));
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(existingRuntimePath, Buffer.from([1, 2, 3]));

    const stagedRuntimePath = await stageRuntimeBinary({
      outputDirectory: tempDirectory,
      runtimeMode: 'external',
      platform: 'win32',
      nodeExecutablePath: fakeNodeExecutablePath,
    });

    assert.equal(stagedRuntimePath, null);
    await assert.rejects(access(existingRuntimePath));
    await assert.rejects(access(runtimeDirectory));
  });
});

test('stageRuntimeBinary 在 bundled + linux 时复制 node 到 runtime/node', async () => {
  await withTempDirectory(async (tempDirectory) => {
    const fakeNodeExecutablePath = path.join(tempDirectory, 'fake-node');
    const expectedBinary = Buffer.from([10, 20, 30, 40]);
    await writeFile(fakeNodeExecutablePath, expectedBinary);

    const stagedRuntimePath = await stageRuntimeBinary({
      outputDirectory: tempDirectory,
      runtimeMode: 'bundled',
      platform: 'linux',
      nodeExecutablePath: fakeNodeExecutablePath,
    });

    assert.equal(stagedRuntimePath, path.join(tempDirectory, 'runtime', 'node'));
    assert.deepEqual(await readFile(stagedRuntimePath), expectedBinary);
  });
});
