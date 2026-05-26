import { build } from 'esbuild';
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
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

const runtimeDirectory = path.join(outputDirectory, 'runtime');
await mkdir(runtimeDirectory, { recursive: true });
const runtimeExecutablePath = path.join(
  runtimeDirectory,
  process.platform === 'win32' ? 'node.exe' : 'node',
);

if (process.platform === 'win32') {
  // Rebuild the runtime binary from bytes instead of copyFile so the bundled
  // resource is detached from source-file metadata.
  await writeFile(runtimeExecutablePath, await readFile(process.execPath));
} else {
  // On macOS/Linux, package a tiny launcher instead of copying the host Node
  // binary into app resources. The desktop backend already supports falling
  // back to a PATH-visible `node` runtime.
  await writeFile(
    runtimeExecutablePath,
    '#!/bin/sh\nexec /usr/bin/env node "$@"\n',
    'utf8',
  );
  await chmod(runtimeExecutablePath, 0o755);
}
