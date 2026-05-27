#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const COMPOUND_EXTENSIONS = ['.app.tar.gz', '.tar.gz'];
const SUPPORTED_ASSET_EXTENSIONS = ['.AppImage', '.app.tar.gz', '.deb', '.dmg', '.exe', '.msi', '.rpm'];
const REQUIRED_CLI_OPTIONS = ['bundleRoot', 'outDir', 'artifact', 'flavor'];

export function splitAssetName(fileName) {
  for (const extension of COMPOUND_EXTENSIONS) {
    if (fileName.endsWith(extension)) {
      return {
        stem: fileName.slice(0, -extension.length),
        extension,
      };
    }
  }

  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex <= 0) {
    return {
      stem: fileName,
      extension: '',
    };
  }

  return {
    stem: fileName.slice(0, lastDotIndex),
    extension: fileName.slice(lastDotIndex),
  };
}

export function buildReleaseAssetName(fileName, artifact, flavor) {
  const { stem, extension } = splitAssetName(fileName);
  return `${stem}-${artifact}-${flavor}${extension}`;
}

export function isSupportedAssetFile(fileName) {
  return SUPPORTED_ASSET_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}

export async function collectBundleAssetFiles(bundleRoot) {
  const assetFiles = [];
  const pendingDirs = [bundleRoot];

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop();
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pendingDirs.push(fullPath);
        continue;
      }

      if (entry.isFile() && isSupportedAssetFile(entry.name)) {
        assetFiles.push(fullPath);
      }
    }
  }

  return assetFiles.sort((left, right) => left.localeCompare(right));
}

export async function collectAndCopyReleaseAssets({ bundleRoot, outDir, artifact, flavor }) {
  const assetFiles = await collectBundleAssetFiles(bundleRoot);
  await mkdir(outDir, { recursive: true });

  const copiedAssets = [];
  for (const source of assetFiles) {
    const destination = path.join(outDir, buildReleaseAssetName(path.basename(source), artifact, flavor));
    await copyFile(source, destination);

    const signatureSource = `${source}.sig`;
    const signatureDestination = `${destination}.sig`;
    let hasSignature = false;

    try {
      await copyFile(signatureSource, signatureDestination);
      hasSignature = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }

    copiedAssets.push({
      source,
      destination,
      signatureSource: hasSignature ? signatureSource : null,
      signatureDestination: hasSignature ? signatureDestination : null,
    });
  }

  return copiedAssets;
}

function toCamelOptionName(flagName) {
  return flagName.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

export function parseCliArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`不支持的位置参数: ${token}`);
    }

    const optionName = toCamelOptionName(token.slice(2));
    const optionValue = argv[index + 1];
    if (!optionValue || optionValue.startsWith('--')) {
      throw new Error(`缺少参数值: ${token}`);
    }

    options[optionName] = optionValue;
    index += 1;
  }

  for (const requiredOption of REQUIRED_CLI_OPTIONS) {
    if (!options[requiredOption]) {
      throw new Error(`缺少必填参数: --${requiredOption.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`);
    }
  }

  return {
    bundleRoot: options.bundleRoot,
    outDir: options.outDir,
    artifact: options.artifact,
    flavor: options.flavor,
  };
}

function formatUsage() {
  return [
    '用法:',
    'node scripts/release-assets.mjs --bundle-root <dir> --out-dir <dir> --artifact <artifact> --flavor <flavor>',
  ].join(' ');
}

async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  const copiedAssets = await collectAndCopyReleaseAssets(options);

  if (copiedAssets.length === 0) {
    throw new Error(`未在目录中找到可发布产物: ${options.bundleRoot}`);
  }

  for (const asset of copiedAssets) {
    console.log(asset.destination);
    if (asset.signatureDestination) {
      console.log(asset.signatureDestination);
    }
  }
}

function isExecutedAsCli() {
  if (!process.argv[1]) {
    return false;
  }

  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isExecutedAsCli()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(formatUsage());
    process.exit(1);
  });
}
