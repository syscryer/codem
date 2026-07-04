import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { generateLatestJson } from './generate-latest-json.mjs';

async function withTempDirectory(run) {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'codem-latest-json-'));
  try {
    await run(tempDirectory);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function writeAssetPair(directory, fileName, signature) {
  await writeFile(path.join(directory, fileName), fileName);
  await writeFile(path.join(directory, `${fileName}.sig`), signature);
}

test('generateLatestJson writes updater metadata for rust artifacts only', async () => {
  await withTempDirectory(async (assetsDir) => {
    await mkdir(assetsDir, { recursive: true });
    await writeAssetPair(assetsDir, 'CodeM_0.1.5_x64-setup-windows-x64-rust.exe', 'windows-sig');
    await writeAssetPair(assetsDir, 'CodeM_0.1.5_x64_en-US-windows-x64-rust.msi', 'windows-msi-sig');
    await writeAssetPair(assetsDir, 'CodeM-macos-arm64-rust.app.tar.gz', 'macos-sig');
    await writeAssetPair(assetsDir, 'CodeM_0.1.5_amd64-linux-x64-rust.AppImage', 'linux-sig');

    const latestPath = await generateLatestJson({
      assetsDir,
      repository: 'syscryer/codem',
      tag: 'v0.1.5',
      version: '0.1.5',
      now: new Date('2026-06-04T12:00:00.000Z'),
    });

    const latest = JSON.parse(await readFile(latestPath, 'utf8'));
    assert.deepEqual(latest, {
      version: '0.1.5',
      notes: 'https://github.com/syscryer/codem/releases/tag/v0.1.5',
      pub_date: '2026-06-04T12:00:00.000Z',
      platforms: {
        'windows-x86_64': {
          signature: 'windows-sig',
          url: 'https://github.com/syscryer/codem/releases/download/v0.1.5/CodeM_0.1.5_x64-setup-windows-x64-rust.exe',
        },
        'darwin-aarch64': {
          signature: 'macos-sig',
          url: 'https://github.com/syscryer/codem/releases/download/v0.1.5/CodeM-macos-arm64-rust.app.tar.gz',
        },
        'linux-x86_64': {
          signature: 'linux-sig',
          url: 'https://github.com/syscryer/codem/releases/download/v0.1.5/CodeM_0.1.5_amd64-linux-x64-rust.AppImage',
        },
      },
    });
  });
});

test('generateLatestJson fails when a selected updater artifact has no signature', async () => {
  await withTempDirectory(async (assetsDir) => {
    await writeFile(path.join(assetsDir, 'CodeM_0.1.5_x64-setup-windows-x64-rust.exe'), 'exe');
    await writeAssetPair(assetsDir, 'CodeM-macos-arm64-rust.app.tar.gz', 'macos-sig');
    await writeAssetPair(assetsDir, 'CodeM_0.1.5_amd64-linux-x64-rust.AppImage', 'linux-sig');

    await assert.rejects(
      generateLatestJson({
        assetsDir,
        repository: 'syscryer/codem',
        tag: 'v0.1.5',
        version: '0.1.5',
      }),
      /Missing updater signature/,
    );
  });
});
