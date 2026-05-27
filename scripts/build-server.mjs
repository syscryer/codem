import { build } from 'esbuild';
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_RUNTIME_MODE, RUNTIME_ENV_NAME } from './runtime-flavor.mjs';

function resolveRuntimeMode(environment = process.env) {
  return environment[RUNTIME_ENV_NAME] ?? DEFAULT_RUNTIME_MODE;
}

export async function stageRuntimeBinary({
  outputDirectory,
  runtimeMode = DEFAULT_RUNTIME_MODE,
  platform,
  nodeExecutablePath,
}) {
  const runtimeDirectory = path.join(outputDirectory, 'runtime');

  if (runtimeMode === 'external') {
    await rm(runtimeDirectory, { recursive: true, force: true });
    return null;
  }

  await mkdir(runtimeDirectory, { recursive: true });
  const runtimeExecutablePath = path.join(
    runtimeDirectory,
    platform === 'win32' ? 'node.exe' : 'node',
  );

  if (platform === 'win32') {
    // Rebuild the runtime binary from bytes instead of copyFile so the bundled
    // resource is detached from source-file metadata.
    await writeFile(runtimeExecutablePath, await readFile(nodeExecutablePath));
    return runtimeExecutablePath;
  }

  await copyFile(nodeExecutablePath, runtimeExecutablePath);
  await chmod(runtimeExecutablePath, 0o755);
  return runtimeExecutablePath;
}

export async function buildServer({
  projectRoot = process.cwd(),
  runtimeMode = resolveRuntimeMode(),
  platform = process.platform,
  nodeExecutablePath = process.execPath,
} = {}) {
  const outputDirectory = path.join(projectRoot, 'dist-server');

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  await build({
    entryPoints: [path.join(projectRoot, 'server/index.ts')],
    outfile: path.join(outputDirectory, 'index.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    packages: 'bundle',
    sourcemap: false,
    minify: false,
    banner: {
      js: [
        "import { createRequire as __codemCreateRequire } from 'node:module';",
        "const require = __codemCreateRequire(import.meta.url);",
      ].join('\n'),
    },
    external: ['node:*'],
  });

  await copyFile(
    path.join(projectRoot, 'package.json'),
    path.join(outputDirectory, 'package.json'),
  );

  await stageRuntimeBinary({
    outputDirectory,
    runtimeMode,
    platform,
    nodeExecutablePath,
  });

  return {
    outputDirectory,
    runtimeMode,
  };
}

const currentFilePath = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  await buildServer();
}
