import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
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
